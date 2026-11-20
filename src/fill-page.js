// 在一个标签页里像人一样操作：按文字找按钮、按特征找输入框、交文件、打字。
// 每一次点击都过安全闸（fill-guard.js）：文字必须完全等于平台白名单里的一项、不碰黑名单；
// 而且按下鼠标前再确认一次落点上真的是这个按钮（被遮住、页面挪动了都不点）。找不到就停下报错，不猜坐标。
import { allowedUrl, blockedPage, canClick, humanDelay, normalizeText } from './fill-guard.js'

/** 填草稿时的错误：code 给界面翻成人话，vars 是占位符。 */
export class FillError extends Error {
  constructor(code, vars = {}) {
    super(`${code}${vars.what ? `: ${vars.what}` : ''}`)
    this.code = code
    this.vars = vars
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const SKIP = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'IFRAME'])

// 页面快照：地址、可见状态、编辑框以外的文字（编辑框里是用户的稿子，不拿来判断验证码）、有没有验证码元素
const SNAPSHOT = `(() => {
  const editors = [...document.querySelectorAll('[contenteditable="true"]')].map(el => el.innerText).filter(Boolean)
  let text = document.body ? document.body.innerText.slice(0, 20000) : ''
  for (const part of editors) text = text.split(part).join(' ')
  const captcha = [...document.querySelectorAll('[class*="captcha" i], [id*="captcha" i], iframe[src*="captcha" i]')].some(el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 20 })
  return { href: location.href, ready: document.readyState, visible: document.visibilityState, text: text.slice(0, 8000), captcha }
})()`

/** 整棵 DOM（含影子树）拍平成元素列表：每个元素的文字、子孙节点 id。 */
function flatten(root) {
  const list = []
  const visit = (node) => {
    if (node.nodeType === 3) return { text: node.nodeValue ?? '', ids: [node.backendNodeId] }
    if (SKIP.has(node.nodeName)) return { text: '', ids: [node.backendNodeId] }
    const kids = [...(node.shadowRoots ?? []), ...(node.children ?? [])].map(visit)
    const text = kids.map(kid => kid.text).join(' ')
    const ids = [node.backendNodeId, ...kids.flatMap(kid => kid.ids)]
    if (node.nodeType === 1) list.push({ backendNodeId: node.backendNodeId, name: node.nodeName, text: normalizeText(text), ids: new Set(ids) })
    return { text, ids }
  }
  visit(root)
  return list
}

/** 盒模型的四个角 → 中心点和面积。 */
function centerOf(quad) {
  const xs = [quad[0], quad[2], quad[4], quad[6]]
  const ys = [quad[1], quad[3], quad[5], quad[7]]
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return { x: (left + right) / 2, y: (top + bottom) / 2, left, right, top, bottom, area: (right - left) * (bottom - top) }
}

/**
 * 包一层标签页，给平台适配器用。
 * @param {{send: Function, activate: Function}} tab - cdp.js openPage 的结果（测试里是假的）。
 * @param {object} adapter - 平台适配器：hosts、clicks、deny、loginPath。
 * @param {{pause?: (ms: number) => Promise<void>, delay?: () => number, fileRoot?: string, probe?: Function, shotSaver?: Function}} [options]
 *   pause 测试里换成不等；fileRoot 是允许交给页面的文件所在的文件夹；
 *   probe 打开平台列表页（只读查看，查重、确认草稿用）；shotSaver 把截图交出去存文件。
 */
export function createPage(tab, adapter, { pause = sleep, delay = humanDelay, fileRoot = null, probe = null, shotSaver = null } = {}) {
  const send = (method, params) => tab.send(method, params)
  const evaluate = async (expression) => {
    const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (out?.exceptionDetails) throw new FillError('script')
    return out?.result?.value
  }

  // 窗口被别的程序挡住时页面会变成 hidden：照样填（每步填完都核对），只记下来，核对不上时好说清原因
  let hiddenSeen = false
  /** 看一眼页面：跳出白名单、登录页、验证码就停。标签页被切到后台时拉回前台一次。 */
  const guard = async () => {
    const snap = await evaluate(SNAPSHOT)
    if (!snap) throw new FillError('script')
    const blocked = blockedPage(adapter, snap)
    if (blocked) throw new FillError(blocked, { url: snap.href.slice(0, 120) })
    if (snap.visible !== 'visible') {
      await tab.activate()
      if ((await evaluate('document.visibilityState')) !== 'visible' && !hiddenSeen) {
        hiddenSeen = true
        // 让页面以为自己有焦点，输入框才收字
        await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
      }
    }
    return snap
  }

  const elements = async () => flatten((await send('DOM.getDocument', { depth: -1, pierce: true })).root)

  /** 视口里、文字完全等于 text、落点没被别的东西挡住的元素；有几个就挑面积最小的那个。 */
  const locate = async (text) => {
    const want = normalizeText(text)
    const { cssLayoutViewport: view } = await send('Page.getLayoutMetrics')
    const hits = []
    for (const el of (await elements()).filter(row => row.text === want)) {
      let box
      try {
        box = centerOf((await send('DOM.getBoxModel', { backendNodeId: el.backendNodeId })).model.border)
      } catch { continue }
      // 没渲染、在视口外（藏在 -9999px 的那种）都不算
      if (box.area < 4 || box.left < 0 || box.top < 0 || box.right > view.clientWidth + 1 || box.bottom > view.clientHeight + 1) continue
      const at = await send('DOM.getNodeForLocation', { x: Math.round(box.x), y: Math.round(box.y) }).catch(() => null)
      if (!at || !el.ids.has(at.backendNodeId)) continue
      hits.push({ ...el, box })
    }
    hits.sort((a, b) => a.box.area - b.box.area)
    return hits[0] ?? null
  }

  const mouse = (type, { x, y }) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })

  /** 光标放进输入框或编辑区，并全选（重填时覆盖掉旧内容）。 */
  const focus = async (selector) => {
    const { root } = await send('DOM.getDocument', { depth: 0 })
    const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
    for (const nodeId of nodeIds ?? []) {
      try {
        await send('DOM.getBoxModel', { nodeId })
      } catch { continue }
      await send('DOM.focus', { nodeId })
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2, commands: ['selectAll'] })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 })
      return true
    }
    return false
  }

  const enter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  }

  return {
    guard,
    evaluate,
    /** 填的过程中页面有没有被挡住过（看不见）。 */
    wasHidden: () => hiddenSeen,
    /** 停一会儿（0.5–1.5 秒）。 */
    rest: () => pause(delay()),
    /** 页面上有没有能点的这个文字（只看，不点）。 */
    has: async text => Boolean(await locate(text)),
    /** 匹配这个选择器的元素有几个（只看普通 DOM）。 */
    count: selector => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`),
    /** 读输入框的值，或编辑区的文字。 */
    read: selector => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? ('value' in el && el.tagName !== 'DIV' ? el.value : el.innerText) : null })()`),
    /** 编辑框以外的页面文字。 */
    text: async () => (await guard()).text,

    /**
     * 点一个按钮：先过安全闸，再找元素，按下前再核对一次落点。
     * @param {string} text - 按钮上的文字，必须完全相同。
     */
    async click(text) {
      const gate = canClick(adapter, text)
      if (!gate.ok) throw new FillError('denied', { what: normalizeText(text) })
      await guard()
      const target = await locate(text)
      if (!target) throw new FillError('changed', { what: normalizeText(text) })
      const point = { x: Math.round(target.box.x), y: Math.round(target.box.y) }
      await mouse('mouseMoved', point)
      await pause(80 + Math.round(delay() / 10))
      // 按下前最后核对：落点上还是这个按钮（页面挪了、弹出了别的东西就不点）
      const at = await send('DOM.getNodeForLocation', { x: point.x, y: point.y }).catch(() => null)
      if (!at || !target.ids.has(at.backendNodeId)) throw new FillError('changed', { what: normalizeText(text) })
      await mouse('mousePressed', point)
      await mouse('mouseReleased', point)
    },

    /**
     * 把本地文件交给页面上的文件输入框（不弹系统对话框）。只交 fileRoot 里的图片。
     * @param {string} selector - 文件输入框的选择器。
     * @param {string[]} files - 绝对路径。
     */
    async upload(selector, files) {
      const root = fileRoot ? `${fileRoot.replace(/[\\/]+$/, '')}/` : null
      if (!files.length || files.some(file => !root || !String(file).startsWith(root) || String(file).includes('..') || !/\.(png|jpe?g|webp)$/i.test(file))) throw new FillError('files')
      await guard()
      const { root: doc } = await send('DOM.getDocument', { depth: 0 })
      const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: doc.nodeId, selector })
      if (!nodeIds?.length) throw new FillError('changed', { what: selector })
      await send('DOM.setFileInputFiles', { nodeId: nodeIds[0], files })
    },

    /**
     * 在输入框或编辑区里打字：先全选，再一行一行输入；多行时行与行之间按回车。
     * @param {string} selector - 输入框的选择器（placeholder、contenteditable 这类稳定特征）。
     * @param {string} text - 要输入的内容。
     * @param {{multiline?: boolean}} [options]
     */
    async type(selector, text, { multiline = false } = {}) {
      await guard()
      if (!(await focus(selector))) throw new FillError('changed', { what: selector })
      const lines = multiline ? String(text).split('\n') : [String(text).replace(/\s*\n\s*/g, ' ')]
      for (let i = 0; i < lines.length; i += 1) {
        if (i > 0) await enter()
        if (lines[i]) await send('Input.insertText', { text: lines[i] })
        if (multiline) await pause(40 + Math.round(delay() / 20))
      }
    },

    /** 接着光标处输入（不全选）。 */
    insert: text => send('Input.insertText', { text: String(text) }),
    /** 在编辑区里按一下回车（选中话题联想、换行用）。 */
    enter,

    /**
     * 等到 check() 为真；每次都先看一眼页面（登录、验证码就停）。
     * @param {() => Promise<any>} check
     * @param {{what: string, timeout?: number, every?: number}} options
     */
    async waitFor(check, { what, timeout = 20_000, every = 500 }) {
      const started = Date.now()
      for (;;) {
        await guard()
        const value = await check()
        if (value) return value
        if (Date.now() - started > timeout) throw new FillError('timeout', { what })
        await pause(every)
      }
    },

    /** 只允许打开白名单里的地址。 */
    allowed: url => allowedUrl(adapter, url),

    /**
     * 只读地另一个页面：打开、等文字稳定、读回来、关掉。用来查重（草稿箱、笔记管理）和确认草稿。
     * 必须由 Host 注入 probe，和专用浏览器的连接绑在一起；测试里换成假的。
     * @param {string} url - 必须是平台白名单里的地址。
     * @param {{what?: string}} [options]
     * @returns {Promise<{url: string, text: string|null, href: string}>} text 为 null 表示跳出了白名单（没登录）。
     */
    async visit(url, { what } = {}) {
      if (!probe) throw new FillError('changed', { what: what || url })
      if (!allowedUrl(adapter, url)) throw new FillError('offsite', { url: String(url).slice(0, 120) })
      const page = await probe(url)
      if (!page) throw new FillError('timeout', { what: what || '列表页' })
      if (page.text === null || page.text === undefined) throw new FillError('login')
      return page
    },

    /**
     * 把当前页面截一张 jpg。截图失败不抛错（不挡流程），返回失败原因。
     * @returns {Promise<{name: string|null, error: string|null}>}
     */
    async snapshot() {
      if (!shotSaver) return { name: null, error: 'no-saver' }
      try {
        const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 })
        if (!data) return { name: null, error: 'empty' }
        return { name: await shotSaver(Buffer.from(String(data), 'base64')), error: null }
      } catch (err) {
        return { name: null, error: String(err?.message ?? err).slice(0, 200) }
      }
    },
  }
}
