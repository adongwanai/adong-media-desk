// 内置信息源的读取器：几个不用登录、不用密钥的公开 JSON。用户打开哪组才读哪组，每个来源每次只请求一次；
// 读不到就把原因带回去，不拿旧数据充数。分组的名字和说明在 feed-catalog.js。
// 「一手 · X 建设者」「一手 · 建设者播客」的数据来自 follow-builders（MIT 许可，https://github.com/zarazhangrui/follow-builders）。
import { fetchErrorText, readJson } from './harvest.js'
import { BUILTIN_GROUPS } from './feed-catalog.js'
import { tr } from './i18n.js'
import { safeFetch } from './net.js'

const MAX_ENTRIES = 30
const MAX_SUMMARY = 200
const FOLLOW_BUILDERS = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/'
// ainav.cn 的文件按北京时间的日期命名
const AINAV = [['36kr', '36氪'], ['liangziwei', '量子位'], ['jiqizhixing', '机器之心'], ['baai', '智源社区'], ['hellogithub', 'HelloGitHub'], ['xinzhiyuan', '新智元'], ['aibase', 'AIbase'], ['ithome', 'IT之家'], ['jikegongyuan', '极客公园']]

function httpUrl(raw) {
  try {
    const url = new URL(String(raw ?? ''))
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function isoDate(raw) {
  const time = Date.parse(String(raw ?? ''))
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

function clip(text, n) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n)}…` : value
}

/** 北京时间的日期，YYYY-MM-DD。 */
export function chinaDay(now = new Date()) {
  return new Date(Number(now) + 8 * 3_600_000).toISOString().slice(0, 10)
}

/** follow-builders 的 feed-x.json：每位建设者几条帖子。标题取帖子开头，热度用点赞数，身份取他自己简介的第一行。 */
export function parseBuildersX(data) {
  if (!Array.isArray(data?.x)) throw new Error(tr('数据格式不对'))
  const rows = []
  for (const builder of data.x) {
    const role = clip(String(builder.bio ?? '').split('\n')[0], 60)
    for (const tweet of builder.tweets ?? []) {
      const text = String(tweet.text ?? '').trim()
      const url = httpUrl(tweet.url)
      if (!text || !url) continue
      rows.push({ title: clip(text.split('\n')[0], 120), url, date: isoDate(tweet.createdAt), summary: clip(text, MAX_SUMMARY), heat: Number.isFinite(tweet.likes) ? tweet.likes : null, author: String(builder.name ?? builder.handle ?? ''), role })
    }
  }
  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

/** follow-builders 的 feed-podcasts.json：每档播客最新一期，摘要取文字稿开头。 */
export function parseBuildersPodcasts(data) {
  if (!Array.isArray(data?.podcasts)) throw new Error(tr('数据格式不对'))
  return data.podcasts.map(row => ({
    title: clip(row.title, 200), url: httpUrl(row.url), date: isoDate(row.publishedAt), summary: clip(row.transcript, MAX_SUMMARY), heat: null, author: String(row.name ?? ''), role: '',
  })).filter(row => row.title && row.url)
}

/** Hugging Face 每日论文：[{paper: {id, title, summary, upvotes, publishedAt}}]。 */
export function parseHfPapers(data) {
  if (!Array.isArray(data)) throw new Error(tr('数据格式不对'))
  return data.map(({ paper }) => ({ title: clip(paper?.title, 200), url: paper?.id ? `https://huggingface.co/papers/${encodeURIComponent(paper.id)}` : null, date: isoDate(paper?.publishedAt), summary: clip(paper?.summary, MAX_SUMMARY), heat: Number.isFinite(paper?.upvotes) ? paper.upvotes : null }))
    .filter(row => row.title && row.url)
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0))
}

/** ainav.cn 的每日汇总：{channel, items: [{title, link, pubDate, description}]}。 */
export function parseAinav(data) {
  if (!Array.isArray(data?.items)) throw new Error(tr('数据格式不对'))
  return data.items.map(row => ({ title: clip(row.title, 200), url: httpUrl(row.link), date: isoDate(row.pubDate), summary: clip(row.description, MAX_SUMMARY), heat: null }))
    .filter(row => row.title && row.url)
}

function readers(now) {
  const day = chinaDay(now)
  const ainav = AINAV.map(([id, name]) => ({
    id: `ainav-${id}`, name,
    read: f => readJson(`https://www.ainav.cn/news/json/${id}_${day}.json`, f).then(parseAinav).catch((err) => {
      // 当天的文件还没生成时是 404
      if (/404/.test(err.message)) throw new Error(tr('ainav.cn 还没有 {date} 的数据', { date: day }))
      throw err
    }),
  }))
  return {
    'builders-x': [{ id: 'builders-x', name: tr('X · 建设者'), read: f => readJson(`${FOLLOW_BUILDERS}feed-x.json`, f).then(parseBuildersX) }],
    'builders-podcasts': [{ id: 'builders-podcasts', name: tr('播客 · 建设者'), read: f => readJson(`${FOLLOW_BUILDERS}feed-podcasts.json`, f).then(parseBuildersPodcasts) }],
    'hf-papers': [{ id: 'hf-papers', name: 'HF Daily Papers', read: f => readJson('https://huggingface.co/api/daily_papers?limit=30', f).then(parseHfPapers) }],
    'cn-ai': ainav,
  }
}

/**
 * 读内置信息源。每个来源单独成败，失败原因原样带回；不缓存。
 * @param {string[]} ids - 要读的分组。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @param {Date} [now] - 决定读哪一天的汇总。
 * @returns {Promise<{groups: Array<{id: string, name: string, sources: Array<{id: string, name: string, entries: Array<object>, error: string|null, fetchedAt: string}>}>}>} 按分组、来源排好的条目。
 */
export async function fetchBuiltin(ids, fetchImpl = safeFetch, now = new Date()) {
  const table = readers(now)
  const wanted = BUILTIN_GROUPS.filter(group => (ids ?? []).includes(group.id))
  const groups = await Promise.all(wanted.map(async group => ({
    id: group.id,
    name: tr(group.name),
    sources: await Promise.all(table[group.id].map(async (source) => {
      try {
        const rows = (await source.read(fetchImpl)).slice(0, MAX_ENTRIES)
        if (!rows.length) throw new Error(tr('没有读到条目'))
        return { id: source.id, name: source.name, entries: rows.map(row => ({ ...row, source: source.name, groupId: group.id })), error: null, fetchedAt: new Date().toISOString() }
      } catch (err) {
        return { id: source.id, name: source.name, entries: [], error: fetchErrorText(err), fetchedAt: new Date().toISOString() }
      }
    })),
  })))
  return { groups }
}
