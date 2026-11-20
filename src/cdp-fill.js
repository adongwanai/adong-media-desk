// 专用浏览器的连接层：找到资料目录对应的 Chrome（不在跑就启动它），用 DevTools 协议开标签页、按标签页发命令。
// 只连 127.0.0.1：主机名写死，不接受外部传入。这里只管连接；点哪里、填什么、哪些按钮绝不能点，由 draft-fill.js 把关。
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tr } from './i18n.js'

const HOST = '127.0.0.1'
// 工作台开专用浏览器时惯用的调试端口；资料目录里没有 DevToolsActivePort 时再试它
export const DEFAULT_PORTS = [9333]
const LAUNCH_WAIT_MS = 15_000
const CALL_TIMEOUT_MS = 30_000

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

/** 这个端口上是不是真有一个开着调试接口的浏览器；是就返回浏览器级的 WebSocket 地址（也必须在 127.0.0.1 上）。 */
async function probe(port, fetchImpl) {
  try {
    const res = await fetchImpl(`http://${HOST}:${port}/json/version`, { signal: AbortSignal.timeout(3_000) })
    if (!res.ok) return null
    const url = String((await res.json())?.webSocketDebuggerUrl ?? '')
    return url.startsWith(`ws://${HOST}:${port}/`) ? url : null
  } catch {
    return null
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const activePort = profileDir => readFile(join(profileDir, 'DevToolsActivePort'), 'utf8').then(parseActivePort, () => null)

/** 一条 DevTools 协议连接：发命令、等回复。sessionId 指定发给哪个标签页。 */
export async function openSocket(url, { WebSocketImpl = globalThis.WebSocket } = {}) {
  if (typeof WebSocketImpl !== 'function') throw new Error(tr('这个版本的 DSH 不支持 WebSocket，控制不了专用浏览器'))
  const ws = new WebSocketImpl(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error(tr('连不上专用浏览器的调试接口'))), { once: true })
  })
  let next = 0
  const waiting = new Map()
  const fail = (err) => {
    for (const pending of waiting.values()) pending.reject(err)
    waiting.clear()
  }
  ws.addEventListener('message', (event) => {
    let msg
    try { msg = JSON.parse(String(event.data)) } catch { return }
    const pending = waiting.get(msg.id)
    if (!pending) return
    waiting.delete(msg.id)
    if (msg.error) pending.reject(new Error(String(msg.error.message ?? 'CDP error')))
    else pending.resolve(msg.result ?? {})
  })
  ws.addEventListener('close', () => fail(new Error(tr('专用浏览器被关掉了'))))
  return {
    send(method, params = {}, sessionId) {
      next += 1
      const id = next
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error(tr('专用浏览器没有响应'))) }, CALL_TIMEOUT_MS)
        waiting.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    },
    close() { try { ws.close() } catch { /* 已经关了 */ } },
  }
}

/**
 * 连上资料目录对应的浏览器：先看资料目录里的 DevToolsActivePort，再试惯用端口；都不在跑就启动一个。
 * 有界面启动的浏览器留给用户（close 只断开连接）；无界面启动的用完关掉。
 * @param {{profileDir: string, headless?: boolean, ports?: number[], fetchImpl?: typeof fetch, find?: Function, spawnImpl?: Function}} options
 * @returns {Promise<{socket: object, port: number, launched: boolean, close: () => Promise<void>}>}
 */
export async function connectBrowser({ profileDir, headless = false, ports = DEFAULT_PORTS, fetchImpl = fetch, find = findBrowser, spawnImpl = spawn, WebSocketImpl }) {
  let port = null
  let wsUrl = null
  for (const candidate of [await activePort(profileDir), ...ports]) {
    if (!candidate) continue
    wsUrl = await probe(candidate, fetchImpl)
    if (wsUrl) { port = candidate; break }
  }
  let child = null
  if (!wsUrl) {
    const file = await find()
    if (!file) throw new Error(tr('这台电脑上没找到 Chrome、Edge 或 Chromium，开不了专用浏览器'))
    const args = [`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', `--remote-debugging-address=${HOST}`, '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new'] : [])]
    child = spawnImpl(file, args, { stdio: 'ignore', detached: !headless })
    if (!headless) child.unref?.()
    const deadline = Date.now() + LAUNCH_WAIT_MS
    while (!wsUrl && Date.now() < deadline) {
      await sleep(300)
      if (child.exitCode !== null && child.exitCode !== undefined) break
      port = await activePort(profileDir)
      wsUrl = port ? await probe(port, fetchImpl) : null
    }
    if (!wsUrl) {
      if (headless) child.kill?.()
      // 同一个资料目录已经被一个没开调试端口的浏览器占着时，新启动的会把事交给它然后马上退出
      throw new Error(tr('专用浏览器启动后连不上：如果它正开着，先把它关掉再试'))
    }
  }
  const socket = await openSocket(wsUrl, { WebSocketImpl })
  return {
    socket,
    port,
    launched: Boolean(child),
    async close() {
      socket.close()
      if (child && headless) child.kill?.()
    },
  }
}

/**
 * 新开一个标签页并接管它：返回只发给这个标签页的 send。前台显示由调用方决定（activate）。
 * @param {{socket: object}} browser - connectBrowser 的结果。
 * @param {string} url - 已经过白名单检查的地址。
 * @returns {Promise<{targetId: string, send: (method: string, params?: object) => Promise<object>, activate: () => Promise<void>}>}
 */
export async function openPage({ socket }, url) {
  const { targetId } = await socket.send('Target.createTarget', { url })
  const { sessionId } = await socket.send('Target.attachToTarget', { targetId, flatten: true })
  return {
    targetId,
    send: (method, params = {}) => socket.send(method, params, sessionId),
    activate: async () => { await socket.send('Target.activateTarget', { targetId }) },
  }
}
