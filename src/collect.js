// 自动读取各平台账号的公开数据：粉丝（GitHub 是 Star、谷歌学术是被引）、其他账号级数字和最新一条内容。
// 只读接口 JSON 和页面里内嵌的结构化数据，字段名对得上才收；不登录、不带 cookie、不算签名、不解验证码。
// 不从页面可见文字里用正则猜「数字 + 粉丝」：那样会把关注数、推荐人数当成粉丝数记下来。
import { fetchErrorText, githubLogin, githubUser, readJson, readProfilePage } from './harvest.js'
import { safeFetch } from './net.js'
import { ACCOUNT_PLATFORMS } from './ops.js'
import { tr } from './i18n.js'

/**
 * 实测（2026-11）不登录读不到的平台，和读不到的真实原因。这些平台不发请求，直接说明，留给用户手动记录。
 * 平台放开了以后再补读取器，不在这里猜。
 */
const BLOCKED = {
  公众号: '公众号没有公开的主页数据，粉丝数只在公众号后台看得到',
  小红书: '小红书主页不登录会跳到登录页，读不到',
  抖音: '抖音主页不登录会先返回人机校验页，读不到',
  视频号: '视频号没有网页版主页，粉丝数只在视频号助手里看得到',
  知乎: '知乎的用户接口和主页不登录都返回 403（要求登录或人机验证），读不到',
  头条: '头条主页的数据要带签名的接口才给，不登录读不到',
  TikTok: 'TikTok 主页不登录会先返回人机校验页，读不到',
  Instagram: 'Instagram 主页不登录不给数据，读不到',
}

const toInt = value => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.isInteger(value) && value >= 0 ? value : undefined)
/** 只留 0 或更大的整数；接口没给的项就是不知道，不放、不补 0。 */
function numbers(raw) {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, toInt(value)]).filter(([, value]) => value !== undefined))
}

/* ───────────── B 站 ───────────── */

/** B 站 card 接口一次给出粉丝、获赞和投稿数。最新视频列表（space/wbi/arc/search）要 wbi 签名，不读。 */
export function parseBilibiliAccount(data) {
  if (data?.code !== 0) throw new Error(data?.message ? tr('B 站接口：{message}', { message: String(data.message).slice(0, 60) }) : tr('B 站接口没有返回数据'))
  const followers = toInt(data.data?.follower) ?? toInt(data.data?.card?.fans) ?? null
  return {
    name: typeof data.data?.card?.name === 'string' ? data.data.card.name : null,
    followers,
    stats: numbers({ likes: data.data?.like_num, works: data.data?.archive_count }),
  }
}

async function bilibili(url, fetchImpl) {
  const uid = /space\.bilibili\.com\/(\d+)/.exec(url)?.[1]
  if (!uid) throw new Error(tr('需要 space.bilibili.com/数字 这样的主页地址'))
  return parseBilibiliAccount(await readJson(`https://api.bilibili.com/x/web-interface/card?mid=${uid}`, fetchImpl))
}

/* ───────────── GitHub ───────────── */

/** users 接口给关注者和公开仓库数；Star 总数、最新仓库、star 最多的仓库从仓库列表里数。一共最多三个请求。 */
async function github(url, fetchImpl) {
  const login = githubLogin(url)
  if (!login) throw new Error(tr('需要 github.com/用户名 这样的主页地址'))
  const user = await readJson(`https://api.github.com/users/${login}`, fetchImpl, { headers: { accept: 'application/vnd.github+json' } })
  if (typeof user?.login !== 'string') throw new Error(tr('GitHub 接口没有返回这个用户'))
  const repos = await githubUser(url, fetchImpl)
  return {
    name: typeof user.name === 'string' && user.name ? user.name : user.login,
    followers: repos.followers,
    stats: numbers({ fans: user.followers, works: repos.works }),
    latest: repos.latest,
    top: repos.top,
  }
}

/* ───────────── X（经 FxTwitter） ───────────── */

/** x.com/用户名 或 twitter.com/用户名 主页里的用户名；帖子、搜索这些页面不算。 */
export function xHandle(url) {
  try {
    const { hostname, pathname } = new URL(url)
    if (!/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i.test(hostname)) return null
    const name = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(pathname)?.[1]
    return name && !['home', 'explore', 'search', 'i', 'settings', 'messages', 'notifications'].includes(name.toLowerCase()) ? name : null
  } catch {
    return null
  }
}

/** FxTwitter /2/profile：followers 粉丝、statuses 帖子数。likes 是这个人点过的赞，不是收到的，不收。 */
export function parseFxProfile(data) {
  const user = data?.user
  if (data?.code !== 200 || !user) throw new Error(tr('FxTwitter 没有返回这个账号'))
  return { name: typeof user.name === 'string' ? user.name : null, followers: toInt(user.followers) ?? null, stats: numbers({ works: user.statuses ?? user.tweets }) }
}

/** 最近的帖子里挑本人发的最新一条：转帖、别人的帖子、置顶的旧帖都不算最新。 */
export function parseFxLatest(data, handle) {
  const own = (Array.isArray(data?.results) ? data.results : [])
    .filter(row => row?.author?.screen_name?.toLowerCase() === handle.toLowerCase() && !row.reposted_by && Number.isFinite(row.created_timestamp) && typeof row.url === 'string')
    .sort((a, b) => b.created_timestamp - a.created_timestamp)[0]
  if (!own) return null
  const title = String(own.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return { title, url: own.url, at: new Date(own.created_timestamp * 1000).toISOString(), ...numbers({ views: own.views, likes: own.likes, comments: own.replies, shares: own.reposts, saves: own.bookmarks }) }
}

async function x(url, fetchImpl) {
  const handle = xHandle(url)
  if (!handle) throw new Error(tr('需要 x.com/用户名 这样的主页地址'))
  let profile
  try {
    profile = parseFxProfile(await readJson(`https://api.fxtwitter.com/2/profile/${handle}`, fetchImpl))
  } catch (err) {
    if (err.httpStatus === 404) throw new Error(tr('FxTwitter 找不到这个账号：用户名对不对，或者账号设了保护'))
    throw err
  }
  // 最新一条读不到不影响粉丝数
  const latest = await readJson(`https://api.fxtwitter.com/2/profile/${handle}/statuses`, fetchImpl).then(data => parseFxLatest(data, handle), () => null)
  return { ...profile, latest, via: 'FxTwitter' }
}

/* ───────────── 谷歌学术 ───────────── */

function decode(text) {
  return String(text).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

/**
 * 学术主页右上角那张固定 id 的引用统计表（gsc_rsb_st）：按行名取「全部」那一列。
 * 文章列表按发表时间排，第一行就是最新的论文。页面固定用英文打开，行名才对得上。
 */
export function parseScholar(html) {
  const table = /<table id="gsc_rsb_st">([\s\S]*?)<\/table>/.exec(html)?.[1]
  if (!table) throw new Error(tr('页面里没有引用统计表，可能被要求人机验证'))
  const row = (label) => {
    const cells = new RegExp(`>${label}</a></td><td class="gsc_rsb_std">(\\d+)</td>`).exec(table)
    return cells ? Number(cells[1]) : undefined
  }
  const name = /<div id="gsc_prf_in">([^<]*)<\/div>/.exec(html)?.[1]
  const first = /<tr class="gsc_a_tr">([\s\S]*?)<\/tr>/.exec(html)?.[1]
  let latest = null
  if (first) {
    const link = /<a href="([^"]+)" class="gsc_a_at">([\s\S]*?)<\/a>/.exec(first)
    const year = /<span class="gsc_a_h gsc_a_hc gs_ibl">(\d{4})<\/span>/.exec(first)?.[1]
    const cited = /class="gsc_a_ac gs_ibl">(\d*)<\/a>/.exec(first)?.[1]
    if (link) latest = { title: decode(link[2]).slice(0, 200), url: new URL(decode(link[1]), 'https://scholar.google.com/').toString(), ...(year ? { year: Number(year) } : {}), ...numbers({ citations: cited || undefined }) }
  }
  return { name: name ? decode(name) : null, followers: row('Citations') ?? null, stats: numbers({ hIndex: row('h-index'), i10Index: row('i10-index') }), latest }
}

async function scholar(url, fetchImpl) {
  let user = null
  try {
    const parsed = new URL(url)
    user = /(^|\.)scholar\.google\.[a-z.]+$/i.test(parsed.hostname) ? parsed.searchParams.get('user') : null
  } catch { /* 下面统一报格式不对 */ }
  if (!user || !/^[\w-]{6,20}$/.test(user)) throw new Error(tr('需要 scholar.google.com/citations?user=… 这样的主页地址'))
  const { html } = await readProfilePage(`https://scholar.google.com/citations?user=${user}&hl=en&sortby=pubdate`, fetchImpl)
  return parseScholar(html)
}

/* ───────────── YouTube ───────────── */

/** 页面里 var 名字 = {...}; 这一段内嵌的 JSON。 */
function embedded(html, name) {
  const start = html.indexOf(`var ${name} = {`)
  if (start < 0) return null
  const from = html.indexOf('{', start)
  const end = html.indexOf('};', from)
  for (let cut = end; cut > 0; cut = html.indexOf('};', cut + 2)) {
    try {
      return JSON.parse(html.slice(from, cut + 1))
    } catch { /* 字符串里也可能有 };，往后找下一个 */ }
    if (cut - from > 2_000_000) break
  }
  return null
}

/** 频道地址统一成 youtube.com/@名字、/channel/UC…、/c/名字 或 /user/名字。 */
export function youtubeChannel(url) {
  try {
    const { hostname, pathname } = new URL(url)
    if (!/^(?:www\.|m\.)?youtube\.com$/i.test(hostname)) return null
    const path = /^\/(@[\w.-]{1,100}|channel\/UC[\w-]{22}|c\/[\w.-]{1,100}|user\/[\w.-]{1,100})(?:\/|$)/.exec(decodeURIComponent(pathname))?.[1]
    return path ? `https://www.youtube.com/${path}` : null
  } catch {
    return null
  }
}

/**
 * 频道「视频」页内嵌的 ytInitialData：频道名和最新一条长视频的编号。
 * 订阅数在这里只有四舍五入后的文字（「176万位订阅者」），不当精确数记。
 */
export function parseYoutubeChannel(html) {
  const data = embedded(html, 'ytInitialData')
  if (!data) throw new Error(tr('页面里没有频道数据，YouTube 可能改了页面'))
  const name = data.metadata?.channelMetadataRenderer?.title
  const tab = (data.contents?.twoColumnBrowseResultsRenderer?.tabs ?? []).find(row => row?.tabRenderer?.selected)?.tabRenderer
  const first = (tab?.content?.richGridRenderer?.contents ?? []).map(row => row?.richItemRenderer?.content).find(Boolean)
  const lockup = first?.lockupViewModel
  const videoId = lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? lockup.contentId : first?.videoRenderer?.videoId
  return { name: typeof name === 'string' ? name : null, videoId: typeof videoId === 'string' && /^[\w-]{11}$/.test(videoId) ? videoId : null }
}

/** 视频页内嵌的 ytInitialPlayerResponse：标题、精确播放数、点赞数和发布时间。 */
export function parseYoutubeVideo(html, videoId) {
  const data = embedded(html, 'ytInitialPlayerResponse')
  const details = data?.videoDetails
  if (!details || details.videoId !== videoId) throw new Error(tr('视频页里没有这条视频的数据'))
  const micro = data.microformat?.playerMicroformatRenderer ?? {}
  const at = Date.parse(micro.publishDate ?? micro.uploadDate ?? '')
  return {
    title: String(details.title ?? '').slice(0, 200),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    ...(Number.isFinite(at) ? { at: new Date(at).toISOString() } : {}),
    ...numbers({ views: details.viewCount, likes: micro.likeCount }),
  }
}

async function youtube(url, fetchImpl) {
  const channel = youtubeChannel(url)
  if (!channel) throw new Error(tr('需要 youtube.com/@频道名 这样的频道地址'))
  const { name, videoId } = parseYoutubeChannel((await readProfilePage(`${channel}/videos`, fetchImpl)).html)
  const latest = videoId ? await readProfilePage(`https://www.youtube.com/watch?v=${videoId}`, fetchImpl).then(page => parseYoutubeVideo(page.html, videoId), () => null) : null
  return { name, followers: null, missing: tr('YouTube 只公开四舍五入后的订阅数文字，不当精确数记，订阅数请手动记录'), stats: {}, latest }
}

const READERS = { B站: bilibili, GitHub: github, X: x, 谷歌学术: scholar, YouTube: youtube }

/**
 * 每个平台能不能自动读、读得到哪些项；读不到的给出原因。大屏用它决定卡片上放「填主页链接」还是「手动记录」。
 * @param {string[]} [backstagePlatforms] - 开了「登录后的创作后台」时读后台的平台：标 backstage。
 * @returns {Record<string, {readable: boolean, reason?: string, partial?: string, backstage?: boolean}>}
 */
export function readSupport(backstagePlatforms = []) {
  return Object.fromEntries(ACCOUNT_PLATFORMS.map((platform) => {
    // 开了「登录后的创作后台」：这几个平台从后台读，不用填主页链接
    if (backstagePlatforms.includes(platform)) return [platform, { readable: true, backstage: true }]
    if (platform === 'YouTube') return [platform, { readable: true, partial: tr('只读最新一条视频，订阅数要手动记录') }]
    if (READERS[platform]) return [platform, { readable: true }]
    return [platform, { readable: false, reason: tr(BLOCKED[platform] ?? '这个平台还不能自动读') }]
  }))
}

/**
 * 读一个账号。每个账号最多发三个请求，失败不重试。
 * @param {{platform: string, url: string}} account - 账号档案。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{platform: string, name: string|null, followers: number|null, stats: object, latest: object|null, top: object|null, via?: string, error: string|null}>}
 *   followers 读不到时 error 写原因；stats、latest 能读到多少放多少。
 */
export async function readAccount(account, fetchImpl = safeFetch) {
  const base = { platform: account.platform, name: null, followers: null, stats: {}, latest: null, top: null }
  const reader = READERS[account.platform]
  if (!reader) return { ...base, error: tr(BLOCKED[account.platform] ?? '这个平台还不能自动读') }
  try {
    const got = await reader(account.url, fetchImpl)
    const followers = Number.isFinite(got.followers) ? Math.round(got.followers) : null
    return {
      ...base,
      name: got.name || null,
      followers,
      stats: got.stats ?? {},
      latest: got.latest ?? null,
      top: got.top ?? null,
      ...(got.via ? { via: got.via } : {}),
      error: followers === null ? got.missing ?? tr('读到了页面，但里面没有粉丝数') : null,
    }
  } catch (err) {
    return { ...base, error: fetchErrorText(err) }
  }
}

/**
 * 逐个账号读取：填了主页地址的、不是示例的才读。各平台不在同一个站点，并发读。
 * @param {Array<{platform: string, url?: string|null, sample?: boolean}>} accounts - 账号档案。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<Array<object>>} 每个平台的 readAccount 结果。
 */
export async function readAccounts(accounts, fetchImpl = safeFetch) {
  const seen = new Set()
  const targets = (accounts ?? []).filter((account) => {
    if (account.sample || !account.url || !ACCOUNT_PLATFORMS.includes(account.platform) || seen.has(account.platform)) return false
    seen.add(account.platform)
    return true
  })
  return Promise.all(targets.map(account => readAccount(account, fetchImpl)))
}
