// 图床：长文里的本地图片粘不进平台编辑器，先传到一个公网地址再用。三种方式：
//  - wechat：公众号素材接口 cgi-bin/media/uploadimg，返回的地址只能在公众号文章里用（思路来自 baoyu-post-to-wechat，MIT，作者 Jim Liu）；
//  - custom：用户自己的图床，HTTP POST multipart，字段名、请求头（令牌）和返回 JSON 里地址的路径都可以配（PicGo-Server / 兰空 / SM.MS 这一类）；
//  - none：不上传，复制到公众号时提示哪些图会丢。
// 上传都在 Host 这边做：令牌不发给浏览器。自定义图床默认只连公网地址，用户勾了「这是我本机/内网的图床」才放行内网。
// 同一张图（按内容哈希）只传一次，结果记在缓存文件里。
import { createHash, randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tr } from './i18n.js'
import { safeFetch } from './net.js'
import { getAccessToken } from './wechat.js'

export const IMAGE_HOST_MODES = ['none', 'wechat', 'custom']
const TIMEOUT_MS = 30_000
// 公众号正文图片接口只收 jpg / png，1MB 以内
const WECHAT_MAX = 1024 * 1024
const CUSTOM_MAX = 20 * 1024 * 1024
const MAX_CACHE = 3000

/** 认得出的图片格式。 */
export function imageType(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { type: 'image/png', ext: '.png' }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return { type: 'image/jpeg', ext: '.jpg' }
  if (buffer.length > 6 && buffer.toString('latin1', 0, 3) === 'GIF') return { type: 'image/gif', ext: '.gif' }
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return { type: 'image/webp', ext: '.webp' }
  return null
}

/**
 * 拼一个 multipart/form-data 请求体。
 * @param {Array<{name: string, value?: string, filename?: string, type?: string, data?: Buffer}>} fields
 * @returns {{body: Buffer, contentType: string}}
 */
export function multipart(fields) {
  const boundary = `----media-desk-${randomBytes(12).toString('hex')}`
  const quote = text => String(text).replace(/["\r\n\\]/g, '_')
  const parts = []
  for (const field of fields) {
    const head = field.data
      ? `--${boundary}\r\nContent-Disposition: form-data; name="${quote(field.name)}"; filename="${quote(field.filename ?? 'image')}"\r\nContent-Type: ${field.type ?? 'application/octet-stream'}\r\n\r\n`
      : `--${boundary}\r\nContent-Disposition: form-data; name="${quote(field.name)}"\r\n\r\n`
    parts.push(Buffer.from(head, 'utf8'), field.data ?? Buffer.from(String(field.value ?? ''), 'utf8'), Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

/**
 * 按路径从 JSON 里取值：data.url、data.links.url、0.url、data[0].url 都行。
 * @returns {unknown} 取不到时 undefined。
 */
export function pickPath(data, path) {
  const keys = String(path ?? '').replace(/\[(\d+)\]/g, '.$1').split('.').map(key => key.trim()).filter(Boolean)
  let value = data
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined
    value = value[key]
  }
  return value
}

function refuse(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function scrub(text, secrets) {
  let out = String(text ?? '')
  for (const secret of secrets.filter(Boolean)) out = out.split(secret).join('***')
  return out.slice(0, 300)
}

/**
 * 设置里图床那一节的校验。
 * @param {object} current - 现在的 imageHost 设置。
 * @param {object} patch - 浏览器传来的改动；token 空字符串表示不改，clearToken 才删除。
 * @returns {object} 新的 imageHost 设置。
 */
export function cleanImageHost(current, patch) {
  const next = { ...current }
  if (!patch || typeof patch !== 'object') return next
  if (patch.mode !== undefined) {
    if (!IMAGE_HOST_MODES.includes(patch.mode)) throw refuse(tr('图床方式无效'))
    next.mode = patch.mode
  }
  if (typeof patch.endpoint === 'string') {
    const endpoint = patch.endpoint.trim()
    if (endpoint) {
      let url
      try {
        url = new URL(endpoint)
      } catch {
        throw refuse(tr('图床地址要以 http:// 或 https:// 开头'))
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw refuse(tr('图床地址要以 http:// 或 https:// 开头'))
    }
    next.endpoint = endpoint.slice(0, 500)
  }
  if (typeof patch.field === 'string') {
    const field = patch.field.trim() || 'file'
    if (!/^[\w.[\]-]{1,40}$/.test(field)) throw refuse(tr('上传字段名只能有字母、数字、下划线和横线'))
    next.field = field
  }
  if (typeof patch.header === 'string') {
    const header = patch.header.trim()
    if (header && !/^[A-Za-z0-9-]{1,60}$/.test(header)) throw refuse(tr('请求头名称只能有字母、数字和横线'))
    if (/^(host|content-length|content-type|cookie|transfer-encoding|connection)$/i.test(header)) throw refuse(tr('这个请求头不能自己设置'))
    next.header = header
  }
  if (typeof patch.token === 'string' && patch.token.trim()) {
    const token = patch.token.trim()
    if (!/^[\x20-\x7e]{1,500}$/.test(token)) throw refuse(tr('令牌只能是英文字符'))
    next.token = token
  }
  if (patch.clearToken === true) next.token = ''
  if (typeof patch.urlPath === 'string') {
    const urlPath = patch.urlPath.trim() || 'url'
    if (!/^[\w.[\]-]{1,80}$/.test(urlPath)) throw refuse(tr('返回地址的路径写法不对，比如 data.url'))
    next.urlPath = urlPath
  }
  if (typeof patch.allowPrivate === 'boolean') next.allowPrivate = patch.allowPrivate
  return next
}

export const IMAGE_HOST_DEFAULTS = { mode: 'none', endpoint: '', field: 'file', header: '', token: '', urlPath: 'url', allowPrivate: false }

/** 发给浏览器的版本：不带令牌。 */
export function publicImageHost(host = {}) {
  const { token, ...rest } = { ...IMAGE_HOST_DEFAULTS, ...host }
  return { ...rest, hasToken: Boolean(token) }
}

/** 现在的设置能不能上传。 */
export function imageHostReady(settings) {
  const host = { ...IMAGE_HOST_DEFAULTS, ...settings?.imageHost }
  if (host.mode === 'wechat') return Boolean(settings?.wechat?.appId && settings?.wechat?.appSecret)
  if (host.mode === 'custom') return Boolean(host.endpoint)
  return false
}

async function uploadWechat(settings, buffer, kind, fetchImpl) {
  if (!['image/png', 'image/jpeg'].includes(kind.type)) throw refuse(tr('公众号正文图片只收 JPG 和 PNG'))
  if (buffer.length > WECHAT_MAX) throw refuse(tr('公众号正文图片要小于 1MB'))
  const token = await getAccessToken(settings.wechat, fetchImpl)
  const form = multipart([{ name: 'media', filename: `image${kind.ext}`, type: kind.type, data: buffer }])
  let res
  try {
    res = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': form.contentType }, body: form.body, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw refuse(tr('连不上公众号接口：{error}', { error: scrub(err?.message, [token]) }), 502)
  }
  const data = await res.json().catch(() => null)
  if (data?.errcode) throw refuse(tr('公众号图片上传失败：{error}', { error: scrub(`${data.errcode} ${data.errmsg ?? ''}`, [token]) }), 502)
  if (typeof data?.url !== 'string' || !/^https?:\/\//.test(data.url)) throw refuse(tr('公众号没有返回图片地址'), 502)
  return data.url.replace(/^http:/, 'https:')
}

async function uploadCustom(host, buffer, kind, fetchImpl) {
  if (!host.endpoint) throw refuse(tr('先在设置里填好图床地址'))
  if (buffer.length > CUSTOM_MAX) throw refuse(tr('图片太大了，超过 20MB'))
  const form = multipart([{ name: host.field || 'file', filename: `image${kind.ext}`, type: kind.type, data: buffer }])
  const headers = { 'content-type': form.contentType, accept: 'application/json' }
  if (host.header && host.token) headers[host.header] = host.token
  let res
  try {
    res = await fetchImpl(host.endpoint, { method: 'POST', headers, body: form.body, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const message = err?.code === 'EPRIVATE' ? tr('图床地址指向本机或内网；如果确实是你自己的图床，到设置里勾上「这是我本机/内网的图床」') : tr('连不上图床：{error}', { error: scrub(err?.message, [host.token]) })
    throw refuse(message, 502)
  }
  const raw = await res.text().catch(() => '')
  if (!res.ok) throw refuse(tr('图床返回错误（{status}）：{error}', { status: res.status, error: scrub(raw, [host.token]).slice(0, 120) }), 502)
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw refuse(tr('图床返回的不是 JSON'), 502)
  }
  const url = pickPath(data, host.urlPath || 'url')
  if (typeof url !== 'string' || !/^https?:\/\/[^\s"'<>]+$/i.test(url)) throw refuse(tr('图床返回里找不到图片地址（路径：{path}）', { path: host.urlPath || 'url' }), 502)
  return url
}

/** 缓存文件：内容哈希 + 图床 → 地址。 */
export class ImageHostCache {
  constructor(root) {
    this.file = root ? join(root, 'image-host-cache.json') : null
    this.map = null
  }

  async load() {
    if (this.map) return this.map
    this.map = new Map()
    if (!this.file) return this.map
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      for (const [key, url] of Object.entries(saved)) if (typeof url === 'string') this.map.set(key, url)
    } catch { /* 没有缓存就从空的开始 */ }
    return this.map
  }

  async get(key) {
    return (await this.load()).get(key)
  }

  async set(key, url) {
    const map = await this.load()
    map.delete(key)
    map.set(key, url)
    while (map.size > MAX_CACHE) map.delete(map.keys().next().value)
    if (!this.file) return
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(Object.fromEntries(map)), { mode: 0o600 })
    await rename(tmp, this.file)
  }
}

function cacheKey(host, buffer) {
  const target = host.mode === 'custom' ? `custom:${host.endpoint}` : host.mode
  return `${target}#${createHash('sha256').update(buffer).digest('hex')}`
}

/**
 * 上传一张图，返回公网地址。同一张图（按内容）只传一次。
 * @param {{settings: object, buffer: Buffer, cache?: ImageHostCache, fetchImpl?: typeof fetch, mode?: string}} options
 *   mode 可以临时指定（推公众号草稿时固定用 wechat）。
 * @returns {Promise<{url: string, cached: boolean}>}
 */
export async function uploadImage({ settings, buffer, cache, fetchImpl, mode }) {
  const host = { ...IMAGE_HOST_DEFAULTS, ...settings?.imageHost }
  if (mode) host.mode = mode
  if (host.mode === 'none') throw refuse(tr('还没有设置图床'))
  const kind = imageType(buffer)
  if (!kind) throw refuse(tr('认不出这张图片的格式'))
  const key = cacheKey(host, buffer)
  const hit = cache ? await cache.get(key) : undefined
  if (hit) return { url: hit, cached: true }
  // 自定义图床走 safeFetch（连接时拦内网地址），用户确认是本机/内网图床时才用普通请求
  const send = fetchImpl ?? (host.mode === 'custom' && !host.allowPrivate ? safeFetch : fetch)
  const url = host.mode === 'wechat' ? await uploadWechat(settings, buffer, kind, send) : await uploadCustom(host, buffer, kind, send)
  if (cache) await cache.set(key, url)
  return { url, cached: false }
}

const LOCAL = /^\/?media-desk\/files\/([\w.-]+)$/
// 导入的稿子里引用的本地图片：/?media-desk/imported/<base64url>.<ext>，由调用方核对后给出真实路径
const IMPORTED = /^\/?media-desk\/imported\/([\w-]+\.[a-z0-9]{2,5})$/i
const REMOTE_MAX = 10 * 1024 * 1024

/**
 * 取一张公网图片（正文里引用的 http(s) 图床图片）。只连公网地址，最多跟 3 次跳转，只收图片，10MB 以内。
 * @returns {Promise<{buffer: Buffer, type: string}>}
 */
export async function fetchRemoteImage(url, fetchImpl = safeFetch) {
  let target = String(url ?? '')
  for (let hop = 0; hop < 4; hop += 1) {
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(target)) throw refuse(tr('图片地址无效'))
    let res
    try {
      res = await fetchImpl(target, { headers: { accept: 'image/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      throw refuse(err?.code === 'EPRIVATE' ? tr('不能读取本机或内网的图片') : tr('图片下载失败：{error}', { error: String(err?.message ?? '').slice(0, 120) }), 502)
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      target = new URL(res.headers.get('location'), target).href
      continue
    }
    if (!res.ok) throw refuse(tr('图片下载失败（{status}）', { status: res.status }), 502)
    const length = Number(res.headers.get('content-length'))
    if (length > REMOTE_MAX) throw refuse(tr('图片太大了，超过 10MB'))
    // 没写长度的响应边读边数，超了就停，不先整个读进内存
    const chunks = []
    let size = 0
    const reader = res.body?.getReader()
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > REMOTE_MAX) {
        await reader.cancel().catch(() => {})
        throw refuse(tr('图片太大了，超过 10MB'))
      }
      chunks.push(value)
    }
    const buffer = Buffer.concat(chunks)
    const kind = imageType(buffer)
    if (!kind) throw refuse(tr('认不出这张图片的格式'))
    return { buffer, type: kind.type }
  }
  throw refuse(tr('图片地址跳转太多次'))
}

/**
 * 一批图片地址（工作台自己的文件 media-desk/files/…）逐个上传。读不到或传失败的记在 errors 里，不影响别的图。
 * @returns {Promise<{urls: Record<string, string>, errors: Record<string, string>}>}
 */
export async function uploadMany({ settings, srcs, filesDir, cache, fetchImpl, mode, remoteFetch, importedPath }) {
  const urls = {}
  const errors = {}
  for (const src of [...new Set((Array.isArray(srcs) ? srcs : []).filter(item => typeof item === 'string'))].slice(0, 60)) {
    const match = LOCAL.exec(src)
    const imported = IMPORTED.exec(src)
    if (!match && !imported && !/^https?:\/\//i.test(src)) {
      errors[src] = tr('只能上传工作台里的图片')
      continue
    }
    try {
      // 公网图片（比如 GitHub 图床）先取回来再传；推公众号草稿时必须这样，公众号不收外链图片
      let buffer
      if (match) buffer = await readFile(join(filesDir, match[1]))
      else if (imported) {
        const file = importedPath ? await importedPath(imported[1]) : null
        if (!file) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        buffer = await readFile(file)
      } else buffer = (await fetchRemoteImage(src, remoteFetch)).buffer
      urls[src] = (await uploadImage({ settings, buffer, cache, fetchImpl, mode })).url
    } catch (err) {
      errors[src] = err.code === 'ENOENT' ? tr('图片文件找不到了') : err.message
    }
  }
  return { urls, errors }
}

/**
 * 推公众号草稿前：正文里引用工作台图片的 <img>，先传到公众号素材库，把地址换成公众号的地址。
 * 传不上去的图片整个去掉，记在 errors 里。
 * @returns {Promise<{html: string, errors: Record<string, string>}>}
 */
export async function hostArticleImages({ html, settings, filesDir, cache, fetchImpl, remoteFetch, importedPath }) {
  // 工作台图片、导入稿的本地图片和公网图片都要换成公众号自己的地址；已经是公众号地址的不动
  const IMG = /<img\b[^>]*?\ssrc="(\/?media-desk\/files\/[\w.-]+|\/?media-desk\/imported\/[\w-]+\.[a-z0-9]{2,5}|https?:\/\/(?!mmbiz\.q(?:pic|logo)\.cn\/)[^"\s<>]+)"[^>]*>/gi
  const srcs = [...String(html).matchAll(IMG)].map(match => match[1].replace(/&amp;/g, '&'))
  if (!srcs.length) return { html, errors: {} }
  const { urls, errors } = await uploadMany({ settings, srcs, filesDir, cache, fetchImpl, mode: 'wechat', remoteFetch, importedPath })
  const out = String(html).replace(IMG, (tag, raw) => {
    const src = raw.replace(/&amp;/g, '&')
    return urls[src] ? tag.replace(`src="${raw}"`, `src="${urls[src]}"`) : ''
  })
  return { html: out, errors }
}
