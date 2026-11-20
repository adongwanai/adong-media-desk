// 专用浏览器的最小控制层：找到（或无界面地启动）资料目录对应的 Chrome，用 DevTools 协议开标签页、取页面文字、关掉自己开的标签页。
// 只连 127.0.0.1：DevTools 端口在本机，所以这里不走 safeFetch（它专门拦本机地址），主机名写死，不接受外部传入。
// 不点击、不输入、不提交表单、不读写 cookie；不关用户自己开的标签页，也不关不是自己启动的浏览器。
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tr } from './i18n.js'

const HOST = '127.0.0.1'
const LAUNCH_WAIT_MS = 15_000
const CALL_TIMEOUT_MS = 20_000
// 截图等不了太久：有界面的浏览器里，后台标签页可能一直不出画面
const SHOT_TIMEOUT_MS = 8_000

/** 各系统上 Chrome、Edge、Chromium 的常见安装位置。 */
export function browserCandidates(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Chromium'].flatMap(app => [`/Applications/${app}.app/Contents/MacOS/${app}`, join(home, 'Applications', `${app}.app`, 'Contents', 'MacOS', app)])
  }
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
    return roots.flatMap(root => [join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(root, 'Chromium', 'Application', 'chrome.exe')])
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
}

/** 第一个找得到的浏览器可执行文件；都没有就是 null。 */
export async function findBrowser(candidates = browserCandidates()) {
  for (const file of candidates) {
    try {
      await access(file, constants.X_OK)
      return file
    } catch { /* 下一个 */ }
  }
  return null
}

/** 资料目录里的 DevToolsActivePort：第一行是端口。 */
export function parseActivePort(text) {
  const port = Number(String(text ?? '').split('\n')[0].trim())
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

async function getJson(port, path, fetchImpl) {
  const res = await fetchImpl(`http://${HOST}:${port}${path}`, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** 这个端口上是不是真有一个开着调试接口的浏览器；是就返回浏览器级的 WebSocket 地址。 */
async function probe(port, fetchImpl) {
  try {
    const version = await getJson(port, '/json/version', fetchImpl)
    const url = String(version?.webSocketDebuggerUrl ?? '')
    return url.startsWith(`ws://${HOST}:${port}/`) ? url : null
  } catch {
    return null
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 浏览器正在跑又没写 DevToolsActivePort 时，常见调试端口挨个探一遍（专用窗口习惯开在 9333）
const FALLBACK_PORTS = [9333, 9222, 9223]

/** 先读资料目录里的 DevToolsActivePort，没有或连不上就探几个常见端口。 */
async function activePort(profileDir, fetchImpl) {
  const saved = parseActivePort(await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8').catch(() => ''))
  if (saved && await probe(saved, fetchImpl)) return saved
  for (const port of FALLBACK_PORTS) {
    if (await probe(port, fetchImpl)) return port
  }
  return saved ?? null
}

/** 一条 DevTools 协议连接：发命令、等回复。 */
async function openSocket(url) {
  if (typeof WebSocket !== 'function') throw new Error(tr('这个版本的 DSH 不支持 WebSocket，读不了创作后台'))
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error(tr('连不上专用浏览器的调试接口'))), { once: true })
  })
  let next = 0
  const waiting = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    const pending = waiting.get(msg.id)
    if (!pending) return
    waiting.delete(msg.id)
    if (msg.error) pending.reject(new Error(String(msg.error.message ?? 'CDP error')))
    else pending.resolve(msg.result ?? {})
  })
  return {
    send(method, params = {}, sessionId, timeoutMs = CALL_TIMEOUT_MS) {
      next += 1
      const id = next
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error(tr('专用浏览器没有响应'))) }, timeoutMs)
        waiting.set(id, { resolve: v => { clearTimeout(timer); resolve(v) }, reject: e => { clearTimeout(timer); reject(e) } })
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    },
    close() { try { ws.close() } catch { /* 已经关了 */ } },
  }
}

/**
 * 连上资料目录对应的浏览器：给了 port 就连那个端口；否则看资料目录里的 DevToolsActivePort；都不在跑时无界面地启动一个，用完关掉。
 * @param {{profileDir: string, port?: number|null, headless?: boolean, fetchImpl?: typeof fetch, find?: Function}} options
 * @returns {Promise<{socket: object, port: number, launched: boolean, close: () => Promise<void>}>}
 */
export async function connectBrowser({ profileDir, port = null, headless = true, fetchImpl = fetch, find = findBrowser }) {
  let target = port ?? await activePort(profileDir, fetchImpl)
  let wsUrl = target ? await probe(target, fetchImpl) : null
  if (!wsUrl && port) throw new Error(tr('端口 {port} 上没有开着的专用浏览器', { port }))
  let child = null
  if (!wsUrl) {
    const file = await find()
    if (!file) throw new Error(tr('这台电脑上没找到 Chrome、Edge 或 Chromium，读不了创作后台'))
    const args = [`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', `--remote-debugging-address=${HOST}`, '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new'] : [])]
    child = spawn(file, args, { stdio: 'ignore', detached: false })
    // 刚启动的浏览器写 DevToolsActivePort 可能比我们读得慢，每一轮都重新解析
    const readLaunchedPort = async () => parseActivePort(await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8').catch(() => ''))
    const deadline = Date.now() + LAUNCH_WAIT_MS
    while (!wsUrl && Date.now() < deadline) {
      await sleep(300)
      if (child.exitCode !== null) break
      target = await readLaunchedPort()
      wsUrl = target ? await probe(target, fetchImpl) : null
    }
    if (!wsUrl) {
      child.kill()
      // 同一个资料目录已经被一个没开调试端口的浏览器占着时，新启动的会把事交给它然后马上退出
      throw new Error(tr('专用浏览器启动后连不上：如果它正开着，先把它关掉再读'))
    }
  }
  const socket = await openSocket(wsUrl)
  return {
    socket,
    port: target,
    launched: Boolean(child),
    async close() {
      socket.close()
      if (child) child.kill()
    },
  }
}

/**
 * 当前页面截一张 jpeg（质量 60），读不到时留着以后看页面当时停在哪。截不到不抛错，原因放在 shotError。
 * @returns {Promise<{shot: string}|{shotError: string}>} shot 是 base64。
 */
export async function captureShot(socket, sessionId) {
  try {
    const { data } = await socket.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }, sessionId, SHOT_TIMEOUT_MS)
    return data ? { shot: String(data) } : { shotError: tr('截图是空的') }
  } catch (err) {
    return { shotError: tr('没截到当时的页面：{error}', { error: err.message || String(err) }) }
  }
}

/** 等页面文字稳定：跳去了不允许的地址就停下，text 为 null。 */
async function watchTab(evaluate, url, { allowed, maxWaitMs, maxChars, pollMs }) {
  const started = Date.now()
  let last = ''
  let links = []
  let stable = 0
  let away = 0
  let href = url
  while (Date.now() - started < maxWaitMs) {
    await sleep(pollMs)
    // links：页面上带地址的链接和链接上的字。作品的 ID 在链接里，列表页的文字里看不到
    const snap = await evaluate(`JSON.stringify({ href: location.href, ready: document.readyState, text: document.body ? document.body.innerText.slice(0, ${maxChars}) : '', links: [...document.querySelectorAll('a[href]')].slice(0, 300).map(a => ({ href: String(a.href), text: String(a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) })) })`).then(JSON.parse).catch(() => null)
    // 还在跳转（about:blank、首页跳带参数的后台页）时不下结论
    if (!snap || snap.href === 'about:blank') continue
    href = snap.href
    if (!allowed(href)) {
      // 加载完了（或者等了 5 秒）还连着两次停在不允许的地址（登录页、验证页、别的主机）：要重新登录，文字不读
      if (snap.ready === 'complete' || Date.now() - started >= 5 * pollMs) away += 1
      if (away >= 2) return { url: href, text: null }
      continue
    }
    away = 0
    // 有的后台页面一直有请求挂着，readyState 停在 interactive；不等它，只看文字稳没稳
    const text = String(snap.text ?? '')
    stable = text.trim() && text === last ? stable + 1 : 0
    if (text.trim()) {
      last = text
      links = Array.isArray(snap.links) ? snap.links.filter(row => row?.href) : []
    }
    // 连着两次一样、而且已经过了 3 秒：数据渲染完了
    if (stable >= 2 && Date.now() - started >= 3 * pollMs) break
  }
  return { url: href, text: allowed(href) ? last : null, ...(allowed(href) && links.length ? { links } : {}) }
}

/**
 * 在一个新标签页里打开地址，等页面文字稳定后取 innerText，最后关掉这个标签页。
 * 每次轮询前先看当前地址：allowed(url) 不通过（跳去了登录页、验证页）就停下，不再等也不读文字。
 * screenshot：没读到文字（跳走了、页面是空的）时，关标签页之前截一张当时的页面。
 * @param {{socket: object}} browser - connectBrowser 的结果。
 * @param {string} url - 已经过白名单检查的地址。
 * @param {{allowed: (url: string) => boolean, maxWaitMs?: number, maxChars?: number, pollMs?: number, screenshot?: boolean}} options - pollMs 测试时调小。
 * @returns {Promise<{url: string, text: string|null, links?: Array<{href: string, text: string}>, shot?: string, shotError?: string}>} text 为 null 表示跳出了允许的地址；
 *   links 是页面上的链接（地址和链接上的字），列表页里作品 ID 只在链接上有；shot 是截图的 base64。
 */
export async function readTab({ socket }, url, { allowed, maxWaitMs = 15_000, maxChars = 20_000, pollMs = 1_000, screenshot = false }) {
  const { targetId } = await socket.send('Target.createTarget', { url, background: true })
  try {
    const { sessionId } = await socket.send('Target.attachToTarget', { targetId, flatten: true })
    const evaluate = async expression => (await socket.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result?.value
    const page = await watchTab(evaluate, url, { allowed, maxWaitMs, maxChars, pollMs })
    if (!screenshot || page.text?.trim()) return page
    return { ...page, ...(await captureShot(socket, sessionId)) }
  } finally {
    // 只关自己开的这个标签页
    await socket.send('Target.closeTarget', { targetId }).catch(() => {})
  }
}

/** 在浏览器里开新标签页打开这些地址（去登录用）：只开标签页，别的什么都不做。 */
export async function openTabs({ socket }, urls) {
  for (const url of urls) await socket.send('Target.createTarget', { url })
}

/** 有界面地启动专用浏览器并打开这些地址；已经在跑就在它里面开新标签页。浏览器留给用户自己关。 */
export async function launchVisible({ profileDir, urls, port = null, fetchImpl = fetch, find = findBrowser }) {
  let target = port || parseActivePort(await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8').catch(() => ''))
  const wsUrl = target ? await probe(target, fetchImpl) : null
  if (wsUrl) {
    const socket = await openSocket(wsUrl)
    try {
      await openTabs({ socket }, urls)
    } finally {
      socket.close()
    }
    return { reused: true }
  }
  const file = await find()
  if (!file) throw new Error(tr('这台电脑上没找到 Chrome、Edge 或 Chromium，读不了创作后台'))
  const child = spawn(file, [`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', `--remote-debugging-address=${HOST}`, '--no-first-run', '--no-default-browser-check', ...urls], { stdio: 'ignore', detached: true })
  child.unref()
  return { reused: false }
}
