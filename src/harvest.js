// 抓取网页和个人主页的公开信息。只读公开 HTML，不登录，也不绕过平台限制。
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPrivateAddress, safeFetch } from './net.js'
import { tr } from './i18n.js'

const MAX_BYTES = 1_500_000
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4

/** 粘贴的链接可能来自任何地方，不能让它访问本机或内网服务。 */
export async function assertPublicUrl(raw) {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(tr('只支持 http 和 https 链接'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error(tr('不能抓取本机地址'))
  const records = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (records.some(record => isPrivateAddress(record.address))) throw new Error(tr('不能抓取内网地址'))
  return url
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all)
    .trim()
}

function meta(html, names) {
  for (const name of names) {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
    if (a?.[1]) return decodeEntities(a[1])
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i').exec(html)
    if (b?.[1]) return decodeEntities(b[1])
  }
  return null
}

/**
 * @param {{maxRedirects?: number, refuse?: (url: URL) => string|null}} [options] - refuse 返回原因时不去打开那一页，直接报这个原因。
 */
async function fetchPublic(raw, fetchImpl, extraHeaders = {}, { maxRedirects = MAX_REDIRECTS, refuse = () => null } = {}) {
  let current = raw
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = await assertPublicUrl(current)
    const why = hop > 0 ? refuse(url) : null
    if (why) throw new Error(why)
    const res = await fetchImpl(url, {
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', ...extraHeaders },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      // 不读的响应体要放掉，不然连接一直占着
      await res.body?.cancel().catch(() => {})
      current = new URL(res.headers.get('location'), url).toString()
      continue
    }
    return { res, url }
  }
  throw new Error(tr('跳转次数过多'))
}

/** 跳去登录、人机验证这类页面就是平台不给看：不打开那一页，直接说清楚。 */
function walledUrl(url) {
  if (url.hostname === 'accounts.google.com' || /^consent\./i.test(url.hostname) || /\/(?:login|signin|passport|captcha|sorry|unhuman|verify|challenge)(?:[/?.]|$)/i.test(url.pathname)) {
    return tr('被跳到了登录或人机验证页（{host}），不登录读不到', { host: url.hostname })
  }
  return null
}

/**
 * 读一个账号主页的原文，给只取页面里内嵌结构化数据的读取器用。最多跟一次跳转；跳到登录、验证页就停下报原因。
 * @param {string} raw - 主页地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{html: string, url: URL}>} 页面原文和最后落到的地址。
 */
export async function readProfilePage(raw, fetchImpl = safeFetch) {
  const { res, url } = await fetchPublic(raw, fetchImpl, {}, { maxRedirects: 1, refuse: walledUrl })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw Object.assign(new Error(tr('页面返回 {status}，可能需要登录或被平台拦截', { status: res.status })), { httpStatus: res.status })
  }
  return { html: await readCapped(res), url }
}

/** 读一个公开页面或订阅源的原文，带内网拦截、跳转上限和大小上限。 */
export async function readPage(raw, fetchImpl = safeFetch) {
  return readHtml(raw, fetchImpl)
}

/** 最多读 MAX_BYTES，超出的部分直接丢掉。 */
async function readCapped(res) {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks).toString('utf8')
}

async function readHtml(raw, fetchImpl, extraHeaders) {
  const { res, url } = await fetchPublic(raw, fetchImpl, extraHeaders)
  if (!res.ok) throw new Error(tr('页面返回 {status}，可能需要登录或被平台拦截', { status: res.status }))
  const type = res.headers.get('content-type') || ''
  if (!/html|xml/i.test(type)) throw new Error(tr('这不是网页（{type}）', { type: type || tr('未知类型') }))
  return { html: await readCapped(res), url }
}

/**
 * 读一个公开的 JSON 接口。和网页一样：内网拦截、跳转上限、超时、大小上限都有。
 * @param {string} raw - 接口地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @param {{headers?: Record<string, string>}} [options] - 个别接口要带来源页（referer）。
 * @returns {Promise<any>} 解析后的 JSON。
 */
export async function readJson(raw, fetchImpl = safeFetch, { headers = {} } = {}) {
  const { res } = await fetchPublic(raw, fetchImpl, { accept: 'application/json, text/plain, */*', ...headers })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    // httpStatus 给调用方区分「被风控」「不存在」；不用 status，免得被接口层当成自己的返回码
    throw Object.assign(new Error(tr('接口返回 {status}，可能需要登录或被平台拦截', { status: res.status })), { httpStatus: res.status })
  }
  const text = await readCapped(res)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(tr('接口返回的不是 JSON，可能被平台拦截'))
  }
}

/**
 * 打开一个公开页面，只取它下发的访客 cookie（name=value 用「; 」连起来），给要访客身份才回数据的公开接口用。不读正文。
 * @param {string} raw - 页面地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<string>} cookie 请求头的值；一个都没有时是空字符串。
 */
export async function readCookies(raw, fetchImpl = safeFetch) {
  const { res } = await fetchPublic(raw, fetchImpl)
  await res.body?.cancel().catch(() => {})
  if (!res.ok) throw new Error(tr('页面返回 {status}，可能需要登录或被平台拦截', { status: res.status }))
  const rows = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return rows.map(row => row.split(';')[0].trim()).filter(pair => /^[\w.-]+=[^\s;,]*$/.test(pair)).join('; ')
}

/** 网络层的报错（超时、连不上）换成人话；其余原样返回。 */
export function fetchErrorText(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return tr('{s} 秒内没有响应，这台电脑可能连不上它', { s: TIMEOUT_MS / 1000 })
  if (err?.message === 'fetch failed') return tr('连不上（{reason}）', { reason: err.cause?.code || err.cause?.message || tr('网络错误') })
  return err?.message || String(err)
}

/**
 * 抓一个公开页面的正文，用来提炼风格。
 * @param {string} raw - 页面地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string|null, text: string}>} 页面文字。
 */
export async function harvestText(raw, fetchImpl = safeFetch) {
  const { html, url } = await readHtml(raw, fetchImpl)
  const title = meta(html, ['og:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body).split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 8).join('\n')
  return { url: url.toString(), title: title || null, text }
}

/**
 * 读取一个公开页面的标题、简介、封面和可见的粉丝数。
 * @param {string} raw - 页面地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string|null, description: string|null, image: string|null, siteName: string|null}>} 页面信息。
 */
export async function harvest(raw, fetchImpl = safeFetch) {
  const { html, url } = await readHtml(raw, fetchImpl)
  const title = meta(html, ['og:title', 'twitter:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  const description = meta(html, ['og:description', 'description', 'twitter:description'])
  let image = meta(html, ['og:image', 'twitter:image', 'og:image:url'])
  if (image) {
    try {
      image = new URL(image, url).toString()
      if (!/^https?:/.test(image)) image = null
    } catch {
      image = null
    }
  }
  const siteName = meta(html, ['og:site_name']) ?? url.hostname.replace(/^www\./, '')
  return { url: url.toString(), title: title || null, description, image, siteName }
}

/** GitHub 用户名：只认 github.com/用户名 这种主页地址，仓库、组织页里的路径不算。 */
export function githubLogin(url) {
  return /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z\d](?:[A-Za-z\d-]{0,38}))\/?(?:[?#].*)?$/.exec(String(url ?? '').trim())?.[1] ?? null
}

// 一页 100 个仓库，最多翻两页（每个账号每次最多发三个请求）；再多就不报不完整的数
const GITHUB_MAX_PAGES = 2

/** 仓库在卡片上显示的样子；地址不是 github.com 的不收。 */
function repoCard(repo) {
  if (!repo || typeof repo.name !== 'string' || !/^https:\/\/github\.com\//.test(String(repo.html_url))) return null
  return { title: repo.name, url: repo.html_url, at: typeof repo.created_at === 'string' ? repo.created_at : null, stars: repo.stargazers_count }
}

/**
 * GitHub 的公开接口：把这个账号名下公开仓库（不含 fork 来的）的 star 加起来。不登录每小时限 60 次。
 * 返回值里的 followers 就是 star 总数，和其他平台的粉丝数走同一套记录；latest 是最新建的仓库，top 是 star 最多的仓库。
 */
export async function githubUser(url, fetchImpl) {
  const login = githubLogin(url)
  if (!login) throw new Error(tr('需要 github.com/用户名 这样的主页地址'))
  const headers = { accept: 'application/vnd.github+json' }
  const owned = []
  for (let page = 1; ; page += 1) {
    if (page > GITHUB_MAX_PAGES) throw new Error(tr('名下仓库超过 {n} 个，不登录一次数不完 star', { n: GITHUB_MAX_PAGES * 100 }))
    const list = await readJson(`https://api.github.com/users/${login}/repos?type=owner&sort=created&direction=desc&per_page=100&page=${page}`, fetchImpl, { headers })
    if (!Array.isArray(list)) throw new Error(tr('GitHub 接口没有返回仓库列表'))
    owned.push(...list.filter(repo => !repo?.fork && Number.isFinite(repo?.stargazers_count)))
    if (list.length < 100) break
  }
  const newest = owned.reduce((a, b) => (!a || String(b.created_at) > String(a.created_at) ? b : a), null)
  const top = owned.reduce((a, b) => (!a || b.stargazers_count > a.stargazers_count ? b : a), null)
  return { name: login, followers: owned.reduce((sum, repo) => sum + repo.stargazers_count, 0), works: owned.length, latest: repoCard(newest), top: repoCard(top) }
}

/* ───────────── 单条帖子的完整正文 ───────────── */

/** x.com / twitter.com 的单条帖子：地址里带 /status/<数字>。 */
export function tweetId(url) {
  try {
    const { hostname, pathname } = new URL(url)
    if (!/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i.test(hostname)) return null
    return /\/status(?:es)?\/(\d{5,25})/.exec(pathname)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * 读一条推文的完整正文。X 的页面里只给了被截断的 og:description（约 300 字），
 * 这里走 FxTwitter 的公开接口拿全文——收藏时正文写进灵感，成稿时也有完整依据。
 * @param {string} raw - 帖子地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string, body: string, author: string|null, siteName: string}>} 帖子正文和作者。
 */
export async function readTweet(raw, fetchImpl = safeFetch) {
  const id = tweetId(raw)
  if (!id) throw new Error(tr('这不是一条推文的地址'))
  const data = await readJson(`https://api.fxtwitter.com/i/status/${id}`, fetchImpl)
  const tweet = data?.tweet
  if (data?.code !== 200 || !tweet) throw new Error(tr('FxTwitter 没有返回这条推文：可能已删除，或者账号设了保护'))
  const author = typeof tweet.author?.name === 'string' ? tweet.author.name : null
  const handle = typeof tweet.author?.screen_name === 'string' ? `@${tweet.author.screen_name}` : null
  const text = typeof tweet.text === 'string' ? tweet.text.trim() : ''
  if (!text) throw new Error(tr('这条推文没有文字内容'))
  return { url: typeof tweet.url === 'string' ? tweet.url : raw, title: `${author ?? handle ?? 'X'} 的推文`, body: text, author, siteName: 'X' }
}
