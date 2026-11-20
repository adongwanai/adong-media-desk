// 公众号草稿箱：用官方接口把成稿推成一篇草稿。
// 公开发布（freepublish）只在用户每次在确认框里点了确认之后才调用，入口见 wechat-publish.js；这里不会自己发起发布。
// AppSecret 和 access_token 只在这个文件里用来拼请求，不写日志，也不出现在返回给浏览器的错误里。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tr } from './i18n.js'
import { hasText, sanitizeArticleHtml } from './sanitize.js'

const API = 'https://api.weixin.qq.com/cgi-bin'
const TIMEOUT_MS = 30_000
// 永久图片素材上限 10MB，只收 bmp/png/jpeg/jpg/gif
const MAX_COVER_BYTES = 10 * 1024 * 1024
// 浏览器传来的排版正文上限；公众号正文本身限制在 1MB 以内，这里留些余量给行内样式
const MAX_HTML = 2_000_000
const WECHAT = '公众号'

// 常见错误码的人话版本；没收录的原样带上错误码，方便对照官方文档
const ERRORS = {
  '-1': '公众号接口繁忙，稍后再试',
  40001: 'AppSecret 不对，或者 access_token 已失效，请到设置里核对公众号的 AppID 和 AppSecret',
  40002: '凭证类型不对',
  40005: '封面图片格式不支持，公众号只收 JPG、PNG、GIF',
  40007: '封面素材无效，重新推一次试试',
  40009: '封面图片太大，公众号限制 10MB 以内',
  40013: 'AppID 不对，请到设置里核对',
  40125: 'AppSecret 不对，请到公众号后台「设置与开发 → 基本配置」重新复制',
  41001: '缺少 access_token，请检查 AppID 和 AppSecret',
  42001: 'access_token 已过期，重新推一次试试',
  45002: '正文太长，超过了公众号的限制',
  45003: '标题太长，超过了公众号的限制',
  45004: '摘要太长，超过了公众号的限制',
  45009: '今天的接口调用次数用完了，明天再试',
  45110: '作者名太长，请到设置里改短一些',
  48001: '这个公众号没有草稿箱接口权限（未认证的订阅号通常没有），只能手动复制到后台',
  53404: '这个公众号暂时不能新建草稿，请到后台查看账号状态',
}

// 发布接口（freepublish/submit、freepublish/get）文档里列出的错误码；48001 在这里的意思和草稿接口不同，单独放
const PUBLISH_ERRORS = {
  40002: '发布请求的参数不对，请重新推一次草稿再试',
  48001: '接口未授权：未认证的公众号不能用发布接口，请到公众号后台手动点发表',
  53503: '草稿未通过发布检查，请到公众号后台打开这篇草稿检查内容',
  53504: '这篇草稿需要到公众号后台网页上处理后才能发表',
  53505: '请先到公众号后台手动保存这篇草稿，保存成功后再发表',
}

// freepublish/get 的 publish_status：0 成功，1 发布中，其余都是没发出去或发出去后被删、被封
const PUBLISH_STATUS = {
  2: '原创声明没有通过，文章没有发出去',
  3: '发布失败，文章没有发出去，请到公众号后台「发表记录」查看原因',
  4: '平台审核没有通过，文章没有发出去',
  5: '文章发出去之后已被删除',
  6: '文章发出去之后已被系统封禁',
}

/** 错误信息里万一带出了密钥或令牌，一律打码。 */
function scrub(text, secrets) {
  let clean = String(text ?? '').slice(0, 300)
  for (const secret of secrets) if (secret) clean = clean.split(secret).join('***')
  return clean
}

/**
 * 把公众号返回的 errcode 翻成用户看得懂的话。40164 时带上被拦的 IP，告诉用户去加白名单。
 * @param {{errcode: number, errmsg?: string}} data - 接口返回。
 * @param {string[]} [secrets] - 需要从错误里抹掉的敏感值。
 * @param {Record<string, string>} [overrides] - 某个接口专用的错误说明，优先于通用说明。
 * @returns {Error} 带 status 的错误。
 */
export function wechatError(data, secrets = [], overrides = {}) {
  const code = Number(data?.errcode)
  const raw = scrub(data?.errmsg, secrets)
  let message
  if (Object.hasOwn(overrides, String(code))) {
    message = tr(overrides[String(code)])
  } else if (code === 40164) {
    const ip = /invalid ip ([0-9a-f.:]+)/i.exec(raw)?.[1]
    message = ip
      ? tr('这台电脑的出口 IP {ip} 不在公众号的 IP 白名单里。请到公众号后台「设置与开发 → 基本配置 → IP 白名单」加上 {ip}，几分钟后再试', { ip })
      : tr('这台电脑的出口 IP 不在公众号的 IP 白名单里。请到公众号后台「设置与开发 → 基本配置 → IP 白名单」加上它，几分钟后再试')
  } else if (Object.hasOwn(ERRORS, String(code))) {
    message = tr(ERRORS[String(code)])
  } else {
    message = tr('公众号接口返回错误 {code}：{detail}', { code, detail: raw || tr('未知') })
  }
  return Object.assign(new Error(message), { status: 502, errcode: code })
}

async function call(fetchImpl, url, init, secrets, overrides) {
  let res
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw Object.assign(new Error(tr('连不上公众号接口：{error}', { error: scrub(err?.message, secrets) })), { status: 502 })
  }
  let data
  try {
    data = await res.json()
  } catch {
    throw Object.assign(new Error(tr('公众号接口返回了无法识别的内容（{status}）', { status: res.status })), { status: 502 })
  }
  if (data?.errcode) throw wechatError(data, secrets, overrides)
  return data
}

// 只放在内存里，进程退出就没了
const tokens = new Map()

/** 清掉内存里缓存的 token，测试之间互不影响时用。 */
export function clearTokenCache() {
  tokens.clear()
}

/** 用 AppID 和 AppSecret 换 access_token，有效期内复用。 */
export async function getAccessToken({ appId, appSecret }, fetchImpl = fetch) {
  const cached = tokens.get(appId)
  if (cached && cached.secret === appSecret && cached.expiresAt > Date.now()) return cached.token
  // 用 stable_token：普通的 token 接口每调一次都会让同一个公众号上别的系统手里的 token 失效
  const data = await call(fetchImpl, `${API}/stable_token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: false }) }, [appSecret])
  if (typeof data?.access_token !== 'string' || !data.access_token) throw Object.assign(new Error(tr('公众号没有返回 access_token')), { status: 502 })
  tokens.set(appId, { token: data.access_token, secret: appSecret, expiresAt: Date.now() + Math.max((Number(data.expires_in) || 0) - 300, 0) * 1000 })
  return data.access_token
}

/** 认得出的图片格式；webp 公众号不收。 */
export function coverType(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return { type: 'image/png', ext: '.png' }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return { type: 'image/jpeg', ext: '.jpg' }
  if (buffer.length > 6 && buffer.toString('latin1', 0, 3) === 'GIF') return { type: 'image/gif', ext: '.gif' }
  return null
}

/** 封面上传成永久图片素材，拿到 thumb_media_id。 */
export async function uploadCover(token, buffer, fetchImpl = fetch) {
  const kind = coverType(buffer)
  if (!kind) throw Object.assign(new Error(tr('封面图片格式不支持，公众号只收 JPG、PNG、GIF')), { status: 400 })
  if (buffer.length > MAX_COVER_BYTES) throw Object.assign(new Error(tr('封面图片太大，公众号限制 10MB 以内')), { status: 400 })
  const form = new FormData()
  form.append('media', new Blob([buffer], { type: kind.type }), `cover${kind.ext}`)
  const data = await call(fetchImpl, `${API}/material/add_material?access_token=${encodeURIComponent(token)}&type=image`, { method: 'POST', body: form }, [token])
  if (typeof data?.media_id !== 'string' || !data.media_id) throw Object.assign(new Error(tr('公众号没有返回封面素材 ID')), { status: 502 })
  return data.media_id
}

/** 新建一篇草稿，返回草稿的 media_id。 */
export async function addDraft(token, article, fetchImpl = fetch) {
  const data = await call(fetchImpl, `${API}/draft/add?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ articles: [article] }),
  }, [token])
  if (typeof data?.media_id !== 'string' || !data.media_id) throw Object.assign(new Error(tr('公众号没有返回草稿 ID')), { status: 502 })
  return data.media_id
}

/**
 * 三步：换 token → 传封面 → 建草稿。
 * @param {{appId: string, appSecret: string, author?: string}} credentials - 公众号凭证。
 * @param {{title: string, html: string, digest: string, cover: Buffer}} draft - 草稿内容。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{mediaId: string}>} 草稿的 media_id。
 */
export async function pushDraft(credentials, draft, fetchImpl = fetch) {
  const token = await getAccessToken(credentials, fetchImpl)
  const thumb = await uploadCover(token, draft.cover, fetchImpl)
  const mediaId = await addDraft(token, {
    title: String(draft.title ?? '').slice(0, 64),
    author: String(credentials.author ?? '').slice(0, 16),
    digest: String(draft.digest ?? '').slice(0, 120),
    content: draft.html,
    thumb_media_id: thumb,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  }, fetchImpl)
  return { mediaId }
}

/** 提交发布任务，返回 publish_id。提交成功只代表任务进了队列，结果要另外查。 */
export async function submitPublish(token, mediaId, fetchImpl = fetch) {
  const data = await call(fetchImpl, `${API}/freepublish/submit?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ media_id: mediaId }),
  }, [token], PUBLISH_ERRORS)
  const publishId = data?.publish_id
  if ((typeof publishId !== 'string' && typeof publishId !== 'number') || publishId === '') throw Object.assign(new Error(tr('公众号没有返回发布任务 ID')), { status: 502 })
  return String(publishId)
}

/**
 * 查一次发布结果。成功时带回文章永久链接；没发出去时抛出带人话说明的错误。
 * @returns {Promise<{done: boolean, url?: string|null, articleId?: string|null}>}
 */
export async function publishStatus(token, publishId, fetchImpl = fetch) {
  const data = await call(fetchImpl, `${API}/freepublish/get?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ publish_id: String(publishId) }),
  }, [token], PUBLISH_ERRORS)
  const status = Number(data?.publish_status)
  if (status === 1) return { done: false }
  if (status === 0) {
    const items = Array.isArray(data?.article_detail?.item) ? data.article_detail.item : []
    const link = items.map(row => row?.article_url).find(href => typeof href === 'string' && /^https?:\/\/\S+$/i.test(href))
    return { done: true, url: link ? link.slice(0, 2000) : null, articleId: typeof data?.article_id === 'string' ? data.article_id : null }
  }
  const message = Object.hasOwn(PUBLISH_STATUS, String(status)) ? tr(PUBLISH_STATUS[status]) : tr('发布没有成功（状态 {status}），请到公众号后台「发表记录」查看', { status: Number.isFinite(status) ? status : tr('未知') })
  throw Object.assign(new Error(message), { status: 502, publishStatus: status })
}

/** 等一会儿；取消时立刻醒来。 */
function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

/**
 * 轮询发布结果，次数有上限，可以用 signal 中途停止。停止或次数用完时返回 done: false，发布任务本身不受影响。
 * @param {{appId: string, appSecret: string}} credentials - 公众号凭证。
 * @param {string} publishId - submitPublish 返回的任务 ID。
 * @param {{fetchImpl?: typeof fetch, signal?: AbortSignal, attempts?: number, interval?: number, sleep?: Function}} [options]
 */
export async function pollPublish(credentials, publishId, { fetchImpl = fetch, signal, attempts = 20, interval = 3000, sleep = wait } = {}) {
  for (let n = 0; n < attempts; n += 1) {
    if (interval > 0) await sleep(interval, signal)
    if (signal?.aborted) return { done: false, cancelled: true }
    const token = await getAccessToken(credentials, fetchImpl)
    const result = await publishStatus(token, publishId, fetchImpl)
    if (result.done) return result
  }
  return { done: false }
}

/**
 * 公开发布一篇已经在草稿箱里的草稿：提交任务，再轮询结果。
 * 调用方必须先确认用户这一次明确点了确认；这个函数本身不做任何确认。
 * @param {{appId: string, appSecret: string}} credentials - 公众号凭证。
 * @param {string} mediaId - 草稿的 media_id。
 * @param {{fetchImpl?: typeof fetch, signal?: AbortSignal, attempts?: number, interval?: number, sleep?: Function, onSubmitted?: (publishId: string) => Promise<void>|void}} [options]
 * @returns {Promise<{publishId: string, done: boolean, url?: string|null, cancelled?: boolean}>}
 */
export async function publishDraft(credentials, mediaId, options = {}) {
  // 公众号的所有接口走同一条网络出口（直连）：IP 白名单只认一个出口，草稿和发布不能一个直连一个走代理
  const fetchImpl = options.fetchImpl ?? fetch
  const token = await getAccessToken(credentials, fetchImpl)
  const publishId = await submitPublish(token, mediaId, fetchImpl)
  await options.onSubmitted?.(publishId)
  return { publishId, ...await pollPublish(credentials, publishId, { ...options, fetchImpl }) }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

const STYLE = {
  p: 'margin:0 0 1.2em;font-size:16px;line-height:1.8;color:#333;letter-spacing:.5px;',
  h2: 'margin:1.8em 0 .8em;font-size:20px;line-height:1.5;font-weight:bold;color:#111;',
  h3: 'margin:1.5em 0 .6em;font-size:18px;line-height:1.5;font-weight:bold;color:#111;',
  h4: 'margin:1.2em 0 .5em;font-size:16px;line-height:1.5;font-weight:bold;color:#111;',
  blockquote: 'margin:0 0 1.2em;padding:10px 14px;border-left:3px solid #d0d0d0;background:#f7f7f7;font-size:15px;line-height:1.8;color:#555;',
  list: 'margin:0 0 1.2em;padding-left:1.6em;font-size:16px;line-height:1.8;color:#333;',
  li: 'margin:0 0 .4em;',
  strong: 'font-weight:bold;color:#111;',
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, `<strong style="${STYLE.strong}">$1</strong>`)
    .replace(/==([^=]+)==/g, `<strong style="${STYLE.strong}">$1</strong>`)
}

const LIST = /^\s*([-*·]|\d+\.)\s+/
const BLOCK = /^(#{1,6}\s|>)/

/**
 * 公众号正文用的极简 Markdown → HTML：先整段转义，再识别标题、段落、加粗、列表和引用，样式全部写成行内。
 * 图片语法直接去掉：本地图片的地址公众号读不到。
 * @param {string} source - Markdown 正文。
 * @returns {string} HTML。
 */
export function articleHtml(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n').filter(line => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { i += 1; continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      // 文章标题在草稿的标题栏里，正文里的一级标题降成二级
      const tag = `h${Math.min(4, Math.max(2, heading[1].length))}`
      out.push(`<${tag} style="${STYLE[tag]}">${inline(heading[2].trim())}</${tag}>`)
      i += 1
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(inline(lines[i].replace(/^>\s?/, ''))); i += 1 }
      out.push(`<blockquote style="${STYLE.blockquote}">${quote.join('<br>')}</blockquote>`)
      continue
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const rows = []
      while (i < lines.length && LIST.test(lines[i])) { rows.push(`<li style="${STYLE.li}">${inline(lines[i].replace(LIST, ''))}</li>`); i += 1 }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag} style="${STYLE.list}list-style-type:${ordered ? 'decimal' : 'disc'};">${rows.join('')}</${tag}>`)
      continue
    }
    const para = []
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK.test(lines[i]) && !LIST.test(lines[i])) { para.push(inline(lines[i])); i += 1 }
    out.push(`<p style="${STYLE.p}">${para.join('<br>')}</p>`)
  }
  return out.join('')
}

/** 摘要：正文去掉标记后的前 120 个字。 */
export function articleDigest(source) {
  return String(source ?? '')
    .split('\n')
    .filter(line => line.trim() && !/^\s*(#{1,6}\s|!\[)/.test(line))
    .map(line => line.replace(/^>\s?/, '').replace(LIST, '').replace(/\*\*|==/g, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

export function wechatReady(settings) {
  return Boolean(settings?.wechat?.appId && settings?.wechat?.appSecret)
}

const pushing = new Set()

function reject(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

/**
 * 推草稿接口的主体：检查成稿、凭证和封面，推成功后由调用方记下状态。
 * 有写好的公众号版本就推版本，没有就推母稿。
 * 浏览器传来排好版的 html 时先按白名单清洗再用；没传就在这里把 Markdown 转成朴素排版。
 * 正文里引用工作台图片的 <img> 由 hostImages 先换成公众号图片地址（见 image-host.js），换不了的图去掉并在 imageErrors 里说明。
 * @param {{store: object, settings: object, id: unknown, html?: unknown, fetchImpl?: typeof fetch, hostImages?: (html: string) => Promise<{html: string, errors: object}>}} options
 * @returns {Promise<{mediaId: string, imageErrors?: object}>} 草稿的 media_id。
 */
export async function draftFromItem({ store, settings, id, html, fetchImpl = fetch, hostImages }) {
  if (typeof id !== 'string' || !id) throw reject(tr('缺少内容 ID'))
  if (html !== undefined && html !== null && typeof html !== 'string') throw reject(tr('排好版的正文格式不对'))
  if (typeof html === 'string' && html.length > MAX_HTML) throw reject(tr('排好版的正文太大了，公众号放不下'), 413)
  const state = await store.read()
  const item = state.items.find(row => row.id === id)
  if (!item) throw reject(tr('找不到这条内容'))
  const production = item.production
  if (production?.status !== 'done' || !String(production.article ?? '').trim()) throw reject(tr('这条内容还没有成稿，先一键成稿再推到草稿箱'))
  const version = production.versions?.[WECHAT]
  const source = version?.status === 'done' && String(version.body ?? '').trim() ? { title: version.title, body: version.body } : { title: production.title, body: production.article }
  if (!wechatReady(settings)) throw reject(tr('先在设置里填好公众号的 AppID 和 AppSecret'))
  let imageErrors = {}
  let body = typeof html === 'string' ? html : ''
  if (body.trim() && hostImages && /<img\b/i.test(body)) ({ html: body, errors: imageErrors } = await hostImages(body))
  const content = body.trim() ? sanitizeArticleHtml(body) : articleHtml(source.body)
  if (!hasText(content)) throw reject(tr('排好版的正文是空的，请回到成稿检查'))
  const match = /^media-desk\/files\/([\w.-]+)$/.exec(production.cover?.src ?? '')
  if (!match) throw reject(tr('这篇成稿还没有封面图，公众号草稿必须有封面'))
  let cover
  try {
    cover = await readFile(join(store.filesDir, match[1]))
  } catch {
    throw reject(tr('封面文件找不到了，重新生成封面后再试'))
  }
  if (!coverType(cover)) throw reject(tr('封面图片格式不支持，公众号只收 JPG、PNG、GIF'))
  if (pushing.has(id)) throw reject(tr('这篇正在推送，稍等一下'), 409)
  pushing.add(id)
  try {
    const result = await pushDraft(settings.wechat, {
      title: source.title || production.title || item.title,
      html: content,
      digest: articleDigest(source.body),
      cover,
    }, fetchImpl)
    return Object.keys(imageErrors).length ? { ...result, imageErrors } : result
  } finally {
    pushing.delete(id)
  }
}
