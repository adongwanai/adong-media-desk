// 按「我的方向」给订阅和热榜排序。只用看得见的输入：标题、摘要、发布时间、榜单热度，每一项都能在界面上说清楚。
// 不依赖 Node 模块，浏览器里直接用。
import { tokens } from './tokens.js'

export const MAX_TOPICS = 12
export const MAX_BLOCKED = 30
export const MAX_WORD = 20
export const WEIGHTS = { relevance: 0.65, freshness: 0.25, heat: 0.1 }
// 一个方向至少一半的词出现在条目里才算命中，分数全部来自列出来的命中
const HIT_SHARE = 0.5
const DAY = 86_400_000
const FRESH_DAYS = 30
const SAME_STORY = 0.5

/** 读取状态里的方向，缺了就是空的。 */
export function focusOf(state) {
  const focus = state?.focus ?? {}
  return { topics: Array.isArray(focus.topics) ? focus.topics : [], blocked: Array.isArray(focus.blocked) ? focus.blocked : [] }
}

// 英文词允许词形变化：agent 也算命中 agents、agentic；太短的词只认完全一样
function found(token, have) {
  if (have.has(token)) return true
  if (!/^[a-z0-9]/.test(token) || token.length < 4) return false
  for (const word of have) if (word.startsWith(token)) return true
  return false
}

/**
 * 条目命中了哪些方向。
 * @param {string} text - 标题加摘要。
 * @param {string[]} topics - 我的方向。
 * @returns {Array<{topic: string, share: number}>} 命中的方向和它的词有多大比例出现了。
 */
export function topicHits(text, topics) {
  const have = tokens(text)
  const lower = String(text ?? '').toLowerCase()
  const hits = []
  for (const topic of topics ?? []) {
    const wanted = tokens(topic)
    // 单个汉字之类切不出词的方向，直接看原文里有没有
    if (!wanted.size) {
      const word = String(topic).trim().toLowerCase()
      if (word && lower.includes(word)) hits.push({ topic, share: 1 })
      continue
    }
    let n = 0
    for (const token of wanted) if (found(token, have)) n += 1
    const share = n / wanted.size
    if (share >= HIT_SHARE) hits.push({ topic, share })
  }
  return hits
}

/**
 * 和我的方向有多相关：命中得最完整的那个方向，它的词出现了几成（0–1）。
 * @param {string} text - 标题加摘要。
 * @param {string[]} topics - 我的方向。
 * @returns {number} 0–1。
 */
export function relevance(text, topics) {
  return topicHits(text, topics).reduce((best, hit) => Math.max(best, hit.share), 0)
}

/**
 * 新鲜度：今天发的是 1，30 天前及更早是 0；没写时间的按 0.5。
 * @param {string|null} date - ISO 时间。
 * @param {Date|number} [now] - 现在。
 * @returns {number} 0–1。
 */
export function freshness(date, now = Date.now()) {
  const time = date ? Date.parse(date) : NaN
  if (Number.isNaN(time)) return 0.5
  const age = (Number(now) - time) / DAY
  return Math.min(1, Math.max(0, 1 - age / FRESH_DAYS))
}

/**
 * 同一个榜里的热度换成 0–1：先取 log1p 压掉量级差，再按榜内最小、最大值拉伸。没有热度的是 0。
 * @param {Array<number|null>} heats - 榜内每条的热度。
 * @returns {number[]} 0–1。
 */
export function heatNorms(heats) {
  const logs = heats.map(heat => (Number.isFinite(heat) && heat >= 0 ? Math.log1p(heat) : null))
  const known = logs.filter(value => value !== null)
  if (!known.length) return heats.map(() => 0)
  const min = Math.min(...known)
  const max = Math.max(...known)
  return logs.map(value => (value === null || max === min ? 0 : (value - min) / (max - min)))
}

/** 条目碰到的第一个「不想看」的词，没碰到是 null。按原文包含判断，不分大小写。 */
export function blockedBy(text, blocked) {
  const lower = String(text ?? '').toLowerCase()
  return (blocked ?? []).find(word => String(word).trim() && lower.includes(String(word).trim().toLowerCase())) ?? null
}

/**
 * 给一组条目打分排序。
 * @param {Array<{title: string, summary?: string, date?: string|null, heat?: number|null}>} entries - 一个列表里的条目，原始顺序。
 * @param {{topics?: string[], blocked?: string[]}} focus - 我的方向和不想看的词。
 * @param {{now?: Date|number, groupOf?: (entry: object) => string}} [options] - groupOf 用于几个来源混排：热度只在同一来源里拉伸。
 * @returns {{original: Array<object>, byFocus: Array<object>, hidden: number, hasTopics: boolean}} 两种顺序的行；行是 {entry, index, why}，没设方向时 why 为 null。
 */
export function rankEntries(entries, focus, { now = Date.now(), groupOf = () => '' } = {}) {
  const topics = focus?.topics ?? []
  const hasTopics = topics.length > 0
  const visible = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => !blockedBy(`${entry.title} ${entry.summary ?? ''}`, focus?.blocked))
  const heats = new Array(visible.length).fill(0)
  const byGroup = new Map()
  visible.forEach(({ entry }, i) => byGroup.set(groupOf(entry), [...(byGroup.get(groupOf(entry)) ?? []), i]))
  for (const members of byGroup.values()) {
    const norms = heatNorms(members.map(i => visible[i].entry.heat ?? null))
    members.forEach((i, k) => { heats[i] = norms[k] })
  }
  const original = visible.map((row, i) => {
    if (!hasTopics) return { ...row, why: null }
    const hits = topicHits(`${row.entry.title} ${row.entry.summary ?? ''}`, topics)
    const parts = { relevance: hits.reduce((best, hit) => Math.max(best, hit.share), 0), freshness: freshness(row.entry.date ?? null, now), heat: heats[i] }
    const score = WEIGHTS.relevance * parts.relevance + WEIGHTS.freshness * parts.freshness + WEIGHTS.heat * parts.heat
    // partial：只命中了一部分词的方向（比如「AI 编程」只出现了 AI），界面上要标出来
    return { ...row, why: { score, hits: hits.map(hit => hit.topic), partial: hits.filter(hit => hit.share < 1).map(hit => hit.topic), ...parts } }
  })
  const byFocus = hasTopics ? [...original].sort((a, b) => b.why.score - a.why.score || a.index - b.index) : original
  return { original, byFocus, hidden: entries.length - visible.length, hasTopics }
}

/** 两个标题的相似度：分词后的 Jaccard。 */
export function titleSimilarity(a, b) {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size || !right.size) return 0
  let both = 0
  for (const token of left) if (right.has(token)) both += 1
  return both / (left.size + right.size - both)
}

/** 是不是同一件事：链接一样，或者标题分词的 Jaccard ≥ 0.5。 */
export function sameStory(a, b) {
  if (a.url && a.url === b.url) return true
  return titleSimilarity(a.title, b.title) >= SAME_STORY
}

/**
 * 找出同时出现在两个及以上榜单里的事。
 * @param {Array<{id: string, name: string, entries: Array<{title: string, url: string, rank: number, heat?: number|null, summary?: string}>}>} sources - 读到的榜单。
 * @returns {{groups: Array<{entries: Array<object>, names: string[]}>, tags: Record<string, string[]>}} groups 按上榜个数、最好名次排；tags 的键是 `榜单id|链接`，值是它同时在的所有榜单名。
 */
export function crossLists(sources) {
  const rows = []
  for (const source of sources ?? []) for (const entry of source.entries ?? []) rows.push({ ...entry, sourceId: source.id, source: source.name })
  // 并查集：只合并不同榜单之间的同一件事
  const parent = rows.map((_, i) => i)
  const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[i].sourceId !== rows[j].sourceId && sameStory(rows[i], rows[j])) parent[root(j)] = root(i)
    }
  }
  const buckets = new Map()
  rows.forEach((row, i) => buckets.set(root(i), [...(buckets.get(root(i)) ?? []), row]))
  const groups = []
  const tags = {}
  for (const members of buckets.values()) {
    const names = [...new Set(members.map(row => row.source))]
    if (names.length < 2) continue
    const entries = [...members].sort((a, b) => a.rank - b.rank)
    groups.push({ entries, names })
    for (const row of members) tags[`${row.sourceId}|${row.url}`] = names
  }
  groups.sort((a, b) => b.names.length - a.names.length || a.entries[0].rank - b.entries[0].rank)
  return { groups, tags }
}

/**
 * 校验并整理要保存的方向：去空白、去重，超出上限或太长就报错，不悄悄截断。
 * @param {unknown} list - 用户给的词。
 * @param {number} max - 最多几个。
 * @returns {{ok: true, value: string[]}|{ok: false, error: 'type'|'count'|'length'}} 整理结果。
 */
export function cleanWords(list, max) {
  if (!Array.isArray(list) || list.some(word => typeof word !== 'string')) return { ok: false, error: 'type' }
  const seen = new Set()
  const value = []
  for (const raw of list) {
    const word = raw.trim().replace(/\s+/g, ' ')
    if (!word || seen.has(word.toLowerCase())) continue
    if ([...word].length > MAX_WORD) return { ok: false, error: 'length' }
    seen.add(word.toLowerCase())
    value.push(word)
  }
  return value.length > max ? { ok: false, error: 'count' } : { ok: true, value }
}
