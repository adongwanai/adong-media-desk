// 热榜：读几个不用登录就能看的公开榜单。每次用户点一下，每个榜只请求一次；读不到就把原因带回去，不拿旧数据充数。
// 微博要带来源页才给数据，不需要 cookie。抖音热搜要先打开登录页拿访客 cookie（passport_csrf_token），所以这个榜每次是两次请求。
import { fetchErrorText, readCookies, readJson, readPage } from './harvest.js'
import { safeFetch } from './net.js'
import { tr } from './i18n.js'

const MAX_ENTRIES = 30
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => NAMED[name.toLowerCase()])
    .replace(/\s+/g, ' ')
    .trim()
}

// 摘要里常带着「点击查看原文>」「阅读全文」「Read more »」这类按钮文字，不是内容。
// 只在两种情况下去掉，免得误删正文里的「原文」「详情」：后面跟着箭头，或者带着「查看 / 阅读」出现在末尾
const BUTTON_ARROW = /\s*[（(【[]?\s*(?:(?:点击|点此|戳)\s*)?(?:(?:查看|阅读|展开)\s*)?(?:原文|全文|更多|详情)(?:链接)?\s*[）)】\]]?\s*[>》›»→]+/g
const BUTTON_END = /\s*[（(【[]?\s*(?:(?:点击|点此|戳)\s*)?(?:查看|阅读|展开)\s*(?:原文|全文|更多|详情)(?:链接)?\s*[）)】\]]?\s*[…。.]*\s*$/
const EN_BUTTON = /\s*(?:Read more|Continue reading|Read the full (?:story|article))\s*(?:[»›>→]+|[.…]*\s*$)/gi
const ELLIPSIS_TAG = /\s*\[(?:…|\.\.\.)\]\s*$/

/**
 * 去掉摘要里的「点击查看原文>」「阅读全文」「Read more »」这类按钮文字。热榜和订阅源共用。
 * @param {string} summary - 原摘要。
 * @returns {string} 干净的摘要。
 */
export function cleanSummary(summary) {
  return String(summary ?? '').replace(BUTTON_ARROW, ' ').replace(EN_BUTTON, ' ').replace(ELLIPSIS_TAG, '').replace(BUTTON_END, '').replace(/\s+/g, ' ').trim()
}

/**
 * 读不到的原因翻成人话：超时、被拒、被风控、太频繁、空榜单、平台出错、连不上。
 * @param {unknown} err - 读取时抛出的错误。
 * @returns {{code: 'timeout'|'forbidden'|'blocked'|'limited'|'empty'|'server'|'network'|'other', reason: string}}
 */
export function hotFailure(err) {
  const status = err?.httpStatus ?? Number(/返回 (\d{3})/.exec(String(err?.message ?? ''))?.[1])
  const said = `${err?.name ?? ''} ${err?.message ?? ''} ${err?.cause?.name ?? ''} ${err?.cause?.code ?? ''} ${err?.cause?.message ?? ''}`
  if (/abort|timeout|timed out|UND_ERR_.*TIMEOUT|ETIMEDOUT/i.test(said)) return { code: 'timeout', reason: tr('等了一会儿没有回应，可能是网络慢或者这台电脑连不上它') }
  if (status === 403 || status === 401) return { code: 'forbidden', reason: tr('平台不让未登录的访客读这个榜') }
  if (status === 412 || status === 418) return { code: 'blocked', reason: tr('平台把这次读取当成了机器访问，暂时拦下了') }
  if (status === 429) return { code: 'limited', reason: tr('读得太频繁，平台让过一会儿再来') }
  if (err?.empty) return { code: 'empty', reason: tr('榜单是空的，可能被平台拦下了') }
  if (status >= 500) return { code: 'server', reason: tr('平台那边出错了，过一会儿再试') }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(said)) return { code: 'network', reason: tr('连不上，检查一下网络或代理') }
  return { code: 'other', reason: fetchErrorText(err) }
}

/** 接口里的数字有时是字符串；读不出来就是 null，不补 0。 */
function count(value) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
  return Number.isFinite(n) ? n : null
}

function httpUrl(raw, base) {
  try {
    const url = new URL(raw, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** GitHub Trending 页面：每个仓库一个 article，热度取「今天新增 star」。 */
export function parseGithubTrending(html) {
  const blocks = html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) ?? []
  return blocks.map((block) => {
    const href = /<h2[\s\S]*?<a[^>]*href="([^"]+)"/.exec(block)?.[1]
    const today = /([\d,]+)\s+stars?\s+today/.exec(block)?.[1]
    const description = /<p class="[^"]*">([\s\S]*?)<\/p>/.exec(block)?.[1]
    return {
      title: href ? href.replace(/^\//, '').replace('/', ' / ') : '',
      url: href ? httpUrl(href, 'https://github.com/') : null,
      heat: today ? count(today) : null,
      summary: description ? text(description).slice(0, 200) : '',
    }
  })
}

/** Hacker News 首页（经 Algolia 的公开接口，按得分排）。没有外链的帖子指向讨论页。 */
export function parseHackerNews(data) {
  return (data?.hits ?? []).map(hit => ({
    title: String(hit.title ?? ''),
    url: httpUrl(hit.url ?? '') ?? `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`,
    heat: count(hit.points),
    summary: Number.isFinite(hit.num_comments) ? tr('{n} 条评论', { n: hit.num_comments }) : '',
  }))
}

/** 微博热搜：只取实时榜，去掉广告位（is_ad）和置顶的政务话题。 */
export function parseWeibo(data) {
  if (data?.ok !== 1) throw new Error(tr('微博没有返回榜单'))
  return (data.data?.realtime ?? []).filter(row => !row.is_ad && row.word).map(row => ({
    title: String(row.note || row.word),
    url: `https://s.weibo.com/weibo?q=${encodeURIComponent(row.word_scheme || `#${row.word}#`)}`,
    heat: count(row.num),
    summary: row.label_name ? String(row.label_name) : '',
  }))
}

/** B 站综合热门：热度用播放数。 */
export function parseBilibiliPopular(data) {
  if (data?.code !== 0) throw new Error(data?.message || tr('B 站没有返回榜单'))
  return (data.data?.list ?? []).map(row => ({
    title: String(row.title ?? ''),
    url: row.bvid ? `https://www.bilibili.com/video/${row.bvid}` : null,
    heat: count(row.stat?.view),
    summary: row.owner?.name ? `UP：${row.owner.name}` : '',
  }))
}

/** 百度热搜：页面里嵌着一段 <!--s-data:{…}--> 的 JSON。置顶的那条不算排名。 */
export function parseBaidu(html) {
  const raw = /<!--s-data:([\s\S]*?)-->/.exec(html)?.[1]
  if (!raw) throw new Error(tr('页面里没有找到榜单数据，百度可能改版了'))
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(tr('百度榜单数据解析不了'))
  }
  const list = data?.data?.cards?.find(card => card.component === 'hotList')?.content ?? []
  return list.filter(row => !row.isTop).map(row => ({
    title: String(row.word || row.query || ''),
    url: httpUrl(row.rawUrl || row.url || ''),
    heat: count(row.hotScore),
    summary: row.desc ? String(row.desc).slice(0, 200) : '',
  }))
}

// 下面四个国内榜的接口地址参考了 newsnow（MIT，© ourongxing，github.com/newsnext/newsnow）；解析是按 2026-11-13 实际返回的字段写的。

/** 知乎热榜：标题在 title_area，热度是「2686 万热度」这样的文字，问题地址由 card_id 里的编号拼出来。 */
export function parseZhihu(data) {
  if (!Array.isArray(data?.data)) throw new Error(tr('数据格式不对'))
  return data.data.map((row) => {
    const id = /^Q_(\d+)$/.exec(row.card_id ?? '')?.[1]
    const heat = /([\d.]+)\s*(万|亿)?/.exec(row.target?.metrics_area?.text ?? '')
    return {
      title: String(row.target?.title_area?.text ?? '').trim(),
      url: id ? `https://www.zhihu.com/question/${id}` : httpUrl(row.target?.link?.url ?? ''),
      heat: heat ? Math.round(Number(heat[1]) * ({ 万: 1e4, 亿: 1e8 }[heat[2]] ?? 1)) : null,
      summary: String(row.target?.excerpt_area?.text ?? '').slice(0, 200),
    }
  })
}

export function parseToutiao(data) {
  if (!Array.isArray(data?.data)) throw new Error(tr('数据格式不对'))
  return data.data.map(row => ({
    title: String(row.Title ?? '').trim(),
    // 地址后面一长串统计参数不要
    url: row.ClusterIdStr ? `https://www.toutiao.com/trending/${encodeURIComponent(row.ClusterIdStr)}/` : httpUrl(row.Url ?? ''),
    heat: count(row.HotValue),
    summary: '',
  }))
}

export function parseJuejin(data) {
  if (!Array.isArray(data?.data)) throw new Error(tr('数据格式不对'))
  return data.data.map(row => ({
    title: String(row.content?.title ?? '').trim(),
    url: row.content?.content_id ? `https://juejin.cn/post/${encodeURIComponent(row.content.content_id)}` : null,
    heat: count(row.content_counter?.hot_rank),
    summary: String(row.content?.brief ?? '').slice(0, 200),
  }))
}

export function parseSspai(data) {
  if (!Array.isArray(data?.data)) throw new Error(tr('数据格式不对'))
  return data.data.map(row => ({
    title: String(row.title ?? '').trim(),
    url: row.id ? `https://sspai.com/post/${encodeURIComponent(row.id)}` : null,
    heat: count(row.like_count),
    summary: String(row.summary ?? '').replace(/^>+/gm, '').replace(/\s+/g, ' ').slice(0, 200),
  }))
}

/** 抖音热搜：word_list 按 position 排好，热度是 hot_value；话题页地址由 sentence_id 拼出来。 */
export function parseDouyin(data) {
  if (data?.status_code !== 0 || !Array.isArray(data?.data?.word_list)) throw new Error(tr('抖音没有返回榜单'))
  return data.data.word_list.map(row => ({
    title: String(row.word ?? '').trim(),
    url: row.sentence_id ? `https://www.douyin.com/hot/${encodeURIComponent(row.sentence_id)}` : null,
    heat: count(row.hot_value),
    summary: '',
  }))
}

const DOUYIN_HOT = 'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1'

/** 先拿访客 cookie，再读热搜；没给 cookie 时接口回空白，直接说明原因。 */
async function readDouyin(fetchImpl) {
  const cookie = await readCookies('https://login.douyin.com/', fetchImpl)
  if (!cookie) throw new Error(tr('抖音没有给访客 cookie，读不了热搜'))
  return parseDouyin(await readJson(DOUYIN_HOT, fetchImpl, { headers: { cookie, referer: 'https://www.douyin.com/' } }))
}

// unit 是热度数字的含义，界面上跟在数字后面
const SOURCES = [
  { id: 'github', name: () => 'GitHub Trending', unit: () => tr('今日 star'), read: f => readPage('https://github.com/trending', f).then(page => parseGithubTrending(page.html)) },
  { id: 'hackernews', name: () => 'Hacker News', unit: () => tr('分'), read: f => readJson('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30', f).then(parseHackerNews) },
  { id: 'weibo', name: () => tr('微博热搜'), unit: () => tr('热度'), read: f => readJson('https://weibo.com/ajax/side/hotSearch', f, { headers: { referer: 'https://weibo.com/' } }).then(parseWeibo) },
  { id: 'bilibili', name: () => tr('B 站热门'), unit: () => tr('播放'), read: f => readJson('https://api.bilibili.com/x/web-interface/popular?ps=20', f).then(parseBilibiliPopular) },
  { id: 'baidu', name: () => tr('百度热搜'), unit: () => tr('热度'), read: f => readPage('https://top.baidu.com/board?tab=realtime', f).then(page => parseBaidu(page.html)) },
  { id: 'zhihu', name: () => tr('知乎热榜'), unit: () => tr('热度'), read: f => readJson('https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=30&desktop=true', f).then(parseZhihu) },
  { id: 'toutiao', name: () => tr('头条热榜'), unit: () => tr('热度'), read: f => readJson('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', f).then(parseToutiao) },
  { id: 'juejin', name: () => tr('掘金热榜'), unit: () => tr('热度'), read: f => readJson('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&spider=0', f).then(parseJuejin) },
  { id: 'sspai', name: () => tr('少数派热门'), unit: () => tr('赞'), read: f => readJson(`https://sspai.com/api/v1/article/tag/page/get?limit=30&offset=0&created_at=${Date.now()}&tag=${encodeURIComponent('热门文章')}&released=false`, f).then(parseSspai) },
  { id: 'douyin', name: () => tr('抖音热搜'), unit: () => tr('热度'), read: readDouyin },
]

export const HOT_SOURCE_IDS = SOURCES.map(source => source.id)
export const hotSourceInfo = id => {
  const source = SOURCES.find(row => row.id === id)
  return source ? { id, name: source.name(), unit: source.unit() } : { id, name: id }
}

/**
 * 拉取热榜。每个榜单独成败，失败原因原样带回；不缓存，fetchedAt 就是这次读的时间。
 * @param {string[]} [ids] - 要读的榜单，不传就全读。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{sources: Array<{id: string, name: string, unit: string, entries: Array<{title: string, url: string, heat: number|null, source: string, rank: number, summary: string}>, error: string|null, errorCode: string|null, fetchedAt: string}>}>} 按榜单分组的条目；error 是给人看的原因，errorCode 见 hotFailure。
 */
export async function fetchHot(ids, fetchImpl = safeFetch) {
  const wanted = Array.isArray(ids) && ids.length ? SOURCES.filter(source => ids.includes(source.id)) : SOURCES
  const sources = await Promise.all(wanted.map(async (source) => {
    const name = source.name()
    const base = { id: source.id, name, unit: source.unit() }
    try {
      const rows = (await source.read(fetchImpl)).filter(row => row.title && row.url).slice(0, MAX_ENTRIES)
      if (!rows.length) throw Object.assign(new Error(tr('榜单是空的，可能被平台拦截了')), { empty: true })
      const entries = rows.map((row, index) => ({ ...row, title: row.title.slice(0, 200), summary: cleanSummary(row.summary), source: name, rank: index + 1 }))
      return { ...base, entries, error: null, errorCode: null, fetchedAt: new Date().toISOString() }
    } catch (err) {
      const { code, reason } = hotFailure(err)
      return { ...base, entries: [], error: reason, errorCode: code, fetchedAt: new Date().toISOString() }
    }
  }))
  return { sources }
}
