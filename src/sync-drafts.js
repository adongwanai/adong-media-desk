// 多平台草稿同步：通过 Wechatsync 浏览器扩展，把成稿存成各平台的草稿。只建草稿，不发布。
// 只开放已经核对过扩展源码、确认只存草稿的平台（知乎、B站专栏都是调各自的草稿接口，结果里带草稿编辑页链接）。
// 头条、小红书、抖音、X 在扩展里用的是不公开源码的适配器，存的是不是草稿没法核实，所以不放进来。
import { tr } from './i18n.js'

// 工作台平台名 → Wechatsync 平台 ID
export const SYNC_PLATFORMS = { 知乎: 'zhihu', B站: 'bilibili' }
const BY_ID = Object.fromEntries(Object.entries(SYNC_PLATFORMS).map(([name, id]) => [id, name]))
const CHECK_WAIT_MS = 15_000
const SYNC_TIMEOUT_MS = 180_000

function refuse(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

/** 扩展、转发口返回的错误翻成人话；不把 Token 带出去。 */
export function syncErrorMessage(err, token) {
  const code = err?.code
  const raw = String(err?.message ?? '')
  if (code === 401 || /token not configured/i.test(raw)) return tr('Wechatsync 扩展里还没开启「MCP 连接」或没设 Token。请在扩展设置里打开它')
  if (code === 403 || /invalid or missing token/i.test(raw)) return tr('Token 和 Wechatsync 扩展里设的不一致，请到扩展设置里重新复制')
  if (code === 'timeout') return tr('Wechatsync 扩展没有在规定时间内回应，请稍后再试')
  if (code === 'disconnected') return tr('Wechatsync 扩展断开了连接，请确认浏览器开着、扩展已启用')
  if (code === 'relay-down' || code === 'relay') return tr('9527 端口被别的程序占着，又连不上 Wechatsync 的转发口。请关掉占用端口的程序后再试')
  let detail = raw.slice(0, 200)
  if (token) detail = detail.split(token).join('***')
  return tr('Wechatsync 扩展返回错误：{detail}', { detail: detail || tr('未知') })
}

async function connect(bridge, waitMs) {
  const mode = await bridge.start()
  if (mode === 'relay') {
    const relay = await bridge.relayStatus()
    if (!relay.reachable) return { reachable: false, mode, message: tr('9527 端口被别的程序占着，又连不上 Wechatsync 的转发口。请关掉占用端口的程序后再试') }
    if (!relay.connected) return { reachable: false, mode, message: tr('Wechatsync 的命令行或 MCP 服务在运行，但浏览器扩展还没连上它') }
    return { reachable: true, mode }
  }
  if (await bridge.waitForExtension(waitMs)) return { reachable: true, mode }
  return {
    reachable: false,
    mode,
    message: tr('在 {seconds} 秒内没等到 Wechatsync 扩展连上来。请确认浏览器开着、扩展设置里打开了「MCP 连接」；扩展闲着时最慢一分钟重连一次，打开扩展设置页会立刻重连，稍后再点一次检测', { seconds: Math.round(waitMs / 1000) }),
  }
}

function tokenOf(settings) {
  const token = settings?.wechatsync?.token
  if (!token) throw refuse(tr('先在设置里填上 Wechatsync 扩展里的 Token'))
  return token
}

/**
 * 检测连接：扩展连没连上，看得到哪些平台、登没登录。
 * @returns {Promise<{reachable: boolean, mode: string, message?: string, platforms?: Array<{id: string, name: string, loggedIn: boolean, username: string, workbench: string|null}>}>}
 */
export async function checkSync({ bridge, settings, waitMs = CHECK_WAIT_MS }) {
  const token = tokenOf(settings)
  const status = await connect(bridge, waitMs)
  if (!status.reachable) return status
  let list
  try {
    list = await bridge.request('listPlatforms', { forceRefresh: false }, { token, timeoutMs: 60_000 })
  } catch (err) {
    return { reachable: false, mode: status.mode, message: syncErrorMessage(err, token) }
  }
  const platforms = (Array.isArray(list) ? list : []).filter(row => row && typeof row.id === 'string').slice(0, 100).map(row => ({
    id: row.id.slice(0, 40),
    name: String(row.name ?? row.id).slice(0, 40),
    loggedIn: row.isAuthenticated === true,
    username: typeof row.username === 'string' ? row.username.slice(0, 60) : '',
    workbench: BY_ID[row.id] ?? null,
  }))
  return { reachable: true, mode: status.mode, platforms }
}

/** 本地图片引用对方平台读不到，同步前去掉。 */
function stripLocalImages(markdown) {
  return String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n').filter(line => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)).join('\n').trim()
}

/** 这个平台要同步的内容：有写好的版本就用版本，没有就用母稿。 */
export function syncContent(item, platform) {
  const production = item.production
  const version = production?.versions?.[platform]
  if (version?.status === 'done' && String(version.body ?? '').trim()) return { from: 'version', title: String(version.title || production.title || item.title), markdown: stripLocalImages(version.body) }
  return { from: 'mother', title: String(production?.title || item.title), markdown: stripLocalImages(production?.article) }
}

/**
 * 把一篇成稿同步成所选平台的草稿，一个平台一个请求，结果逐个返回。
 * @returns {Promise<Array<{platform: string, ok: boolean, url: string|null, from: string, error?: string, draftOnly?: boolean}>>}
 */
export async function syncDrafts({ bridge, settings, item, platforms }) {
  const token = tokenOf(settings)
  if (item?.production?.status !== 'done' || !String(item.production.article ?? '').trim()) throw refuse(tr('这条内容还没有成稿，先一键成稿再同步'))
  const chosen = [...new Set(Array.isArray(platforms) ? platforms : [])]
  if (!chosen.length) throw refuse(tr('至少选一个平台'))
  const unknown = chosen.find(name => !Object.hasOwn(SYNC_PLATFORMS, name))
  if (unknown !== undefined) throw refuse(tr('这个平台不支持同步草稿：{platform}', { platform: String(unknown).slice(0, 20) }))
  const status = await connect(bridge, 5000)
  if (!status.reachable) throw refuse(status.message, 502)
  const results = []
  for (const platform of chosen) {
    const content = syncContent(item, platform)
    if (!content.markdown) { results.push({ platform, ok: false, url: null, from: content.from, error: tr('正文是空的') }); continue }
    try {
      const data = await bridge.request('syncArticle', { platforms: [SYNC_PLATFORMS[platform]], article: { title: content.title.slice(0, 100), markdown: content.markdown } }, { token, timeoutMs: SYNC_TIMEOUT_MS })
      const row = (Array.isArray(data?.results) ? data.results : []).find(entry => entry?.platform === SYNC_PLATFORMS[platform])
      if (!row?.success) { results.push({ platform, ok: false, url: null, from: content.from, error: String(row?.error ?? tr('扩展没有返回这个平台的结果')).slice(0, 200) }); continue }
      const url = typeof row.postUrl === 'string' && /^https?:\/\/\S+$/i.test(row.postUrl) ? row.postUrl.slice(0, 2000) : null
      results.push({ platform, ok: true, url, from: content.from, draftOnly: row.draftOnly !== false })
    } catch (err) {
      results.push({ platform, ok: false, url: null, from: content.from, error: syncErrorMessage(err, token) })
    }
  }
  return results
}
