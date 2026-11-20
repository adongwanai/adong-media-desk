// 风格卡里「各平台的写法」：一段自由文字的规则，加上流程要用到的几个数（长度、页数、预算、禁用词、自检项）。
// 流程本身（几步、怎么查、怎么改）是工作台的逻辑；谁的规则写多少、数定多少，都在风格卡里，可以改。
// 纯数据和小函数，Host 和浏览器共用，不能引用 node 模块。
import { COUNTING, specOf } from './platform-specs.js'

export const RULES_MAX = 6000
const NUM_MAX = 20000
const MAX_BANNED = 80
const MAX_REVIEW = 20

/** 每个数的含义。界面按这里画输入框，校验也按这里来。 */
export const KNOBS = {
  titleMax: '标题最多字数',
  bodyMin: '正文最少字数',
  bodyMax: '正文最多字数',
  tagsMin: '标签最少个数',
  tagsMax: '标签最多个数',
  boldMin: '加粗最少处数',
  boldMax: '加粗最多处数',
  highlightMin: '高亮最少处数',
  highlightMax: '高亮最多处数',
  adviceMax: '「你应该 / 建议你 / 你要」最多次数',
  emojiMax: 'emoji 最多个数',
  cardsMin: '图片版最少页数',
  cardsMax: '图片版最多页数',
  cardChars: '每页最多字数',
  cardImageChars: '有图的页最多字数',
  cardMinChars: '每页最少字数（太少就并到上一页）',
  cardsTotalMin: '图片版合计最少字数',
  cardsTotalMax: '图片版合计最多字数',
  cardTitleMin: '页标题最少字数',
  cardTitleMax: '页标题最多字数',
  postMax: '每条最多（X 计数）',
  threadMin: '串最少条数',
  threadMax: '串最多条数',
}

/** 哪些平台用得到哪些数。没列的平台用通用的一组。 */
const COMMON = ['titleMax', 'bodyMin', 'bodyMax', 'tagsMin', 'tagsMax', 'boldMin', 'boldMax', 'highlightMin', 'highlightMax', 'adviceMax', 'emojiMax']
export const PLATFORM_KNOBS = {
  小红书: [...COMMON, 'cardsMin', 'cardsMax', 'cardChars', 'cardImageChars', 'cardMinChars', 'cardsTotalMin', 'cardsTotalMax', 'cardTitleMin', 'cardTitleMax'],
  X: ['postMax', 'threadMin', 'threadMax', 'tagsMin', 'tagsMax', 'adviceMax', 'emojiMax'],
}
export const knobsOf = platform => PLATFORM_KNOBS[platform] ?? COMMON

/** 写给谁看的语言：跟随界面 / 中文 / 英文。 */
export const LANGS = ['auto', 'zh', 'en']

/**
 * 不调模型的自检项。id 是稳定的键，风格卡里的 checks 只能从这里选。
 * fix 是让模型改时说的话；没有 fix 的项只提示，不拿去让模型改（比如母稿本来就不够长，改写也补不出事实）。
 */
export const CHECKS = {
  'title-length': { label: '标题长度' },
  'body-length': { label: '正文长度' },
  tags: { label: '标签个数' },
  banned: { label: '禁用词' },
  tone: { label: '机器腔句式' },
  advice: { label: '「你应该 / 建议你」的次数' },
  bold: { label: '加粗处数' },
  highlight: { label: '高亮处数' },
  emoji: { label: 'emoji 个数' },
  signature: { label: '署名' },
  experience: { label: '没做过的事写成做过' },
  numbers: { label: '母稿里没有的数字' },
  'similar-mother': { label: '和母稿太像' },
  'caption-format': { label: '正文能直接粘进正文框', platforms: ['小红书'] },
  'cards-count': { label: '图片版节数', platforms: ['小红书'] },
  'card-chars': { label: '每节字数', platforms: ['小红书'] },
  'cards-total': { label: '图片版合计字数', platforms: ['小红书'] },
  'card-title': { label: '小节标题长度', platforms: ['小红书'] },
  'card-images': { label: '每节最多一张图、没有占位图', platforms: ['小红书'] },
  'similar-cards': { label: '正文和图片版是两段不同的话', platforms: ['小红书'] },
  'post-length': { label: '每条长度', platforms: ['X'] },
  'thread-count': { label: '串的条数', platforms: ['X'] },
  'question-end': { label: '串以问题收尾', platforms: ['X'] },
}

/** 这个平台能跑哪些自检。 */
export function checksFor(platform) {
  return Object.entries(CHECKS).filter(([, row]) => !row.platforms || row.platforms.includes(platform)).map(([id]) => id)
}

function cleanList(value, max, len) {
  if (!Array.isArray(value)) return undefined
  const out = []
  for (const row of value) {
    if (typeof row !== 'string') continue
    const text = row.trim().slice(0, len)
    if (text && !out.includes(text)) out.push(text)
    if (out.length >= max) break
  }
  return out
}

/** 一个平台的一块规则：只留认识的键，数字取整并限在范围里，文字截断。 */
function cleanBlock(platform, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  if (typeof raw.rules === 'string') out.rules = raw.rules.trim().slice(0, RULES_MAX)
  for (const key of knobsOf(platform)) {
    const n = raw[key]
    if (n === null || n === '' || n === undefined) continue
    const value = Number(n)
    if (Number.isFinite(value)) out[key] = Math.min(NUM_MAX, Math.max(0, Math.round(value)))
  }
  if (LANGS.includes(raw.lang)) out.lang = raw.lang
  const banned = cleanList(raw.banned, MAX_BANNED, 30)
  if (banned) out.banned = banned
  const allowed = new Set(checksFor(platform))
  const checks = cleanList(raw.checks, 40, 40)
  if (checks) out.checks = checks.filter(id => allowed.has(id))
  const review = cleanList(raw.review, MAX_REVIEW, 200)
  if (review) out.review = review
  return out
}

/**
 * 风格卡的 platforms 字段：{平台: 规则块}。不认识的平台、不认识的键一律丢掉。
 * @param {unknown} value - 用户或导入文件给的值。
 * @param {string[]} platforms - 认识的平台。
 * @returns {object|undefined} 清理后的对象；完全不像时返回 undefined（不改原值）。
 */
export function cleanPlatformRules(value, platforms) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out = {}
  for (const platform of platforms) {
    if (!Object.hasOwn(value, platform)) continue
    const block = cleanBlock(platform, value[platform])
    if (block && Object.keys(block).length) out[platform] = block
  }
  return out
}

/** 某个风格在某个平台的那一块规则；没有就是空对象。 */
export function rulesOf(style, platform) {
  const block = style?.platforms?.[platform]
  return block && typeof block === 'object' ? block : {}
}

/**
 * 平台规矩叠上风格卡里的数：标题、正文、标签、X 每条和串的条数、小红书图片版。
 * 返回一份新对象，不改 PLATFORM_SPECS。
 */
export function effectiveSpec(platform, style) {
  const base = specOf(platform)
  if (!base) return null
  const knobs = rulesOf(style, platform)
  const pick = (key, fallback) => (Number.isFinite(knobs[key]) ? knobs[key] : fallback)
  const spec = structuredClone(base)
  if (spec.title) spec.title.max = pick('titleMax', spec.title.max)
  if (spec.body) {
    spec.body.min = pick('bodyMin', spec.body.min)
    spec.body.max = Math.max(spec.body.min + 1, pick('bodyMax', spec.body.max))
  }
  spec.tags.min = pick('tagsMin', spec.tags.min)
  spec.tags.max = Math.max(spec.tags.min, pick('tagsMax', spec.tags.max))
  if (spec.post) {
    spec.post.max = pick('postMax', spec.post.max)
    spec.post.threadMin = pick('threadMin', spec.post.threadMin)
    spec.post.threadMax = Math.max(spec.post.threadMin, pick('threadMax', spec.post.threadMax))
  }
  if (spec.cards) {
    const cards = spec.cards
    cards.min = pick('cardsMin', cards.min)
    cards.max = Math.max(cards.min, pick('cardsMax', cards.max))
    cards.perCard = pick('cardChars', cards.perCard)
    cards.perImageCard = pick('cardImageChars', cards.perImageCard)
    cards.minCard = pick('cardMinChars', cards.minCard)
    cards.total = { min: pick('cardsTotalMin', cards.total.min), max: Math.max(pick('cardsTotalMin', cards.total.min), pick('cardsTotalMax', cards.total.max)) }
    cards.heading = { ...cards.heading, min: pick('cardTitleMin', cards.heading.min), max: Math.max(pick('cardTitleMin', cards.heading.min), pick('cardTitleMax', cards.heading.max)) }
  }
  // 加粗、高亮、建议句、emoji：风格卡里没定数就不查
  spec.budgets = Object.fromEntries(['boldMin', 'boldMax', 'highlightMin', 'highlightMax', 'adviceMax', 'emojiMax'].filter(key => Number.isFinite(knobs[key])).map(key => [key, knobs[key]]))
  spec.lang = LANGS.includes(knobs.lang) ? knobs.lang : 'auto'
  return spec
}

/** 风格卡定下的平台数写成一段给模型看的说明。 */
export function specBriefFor(platform, style) {
  const spec = effectiveSpec(platform, style)
  if (!spec) return ''
  const lines = [`平台：${platform}`]
  if (spec.title) lines.push(`标题：不超过 ${spec.title.max}（${COUNTING[spec.title.count]}）`)
  else lines.push('这个平台没有标题，title 留空字符串')
  if (spec.thread) lines.push(`正文：一条不超过 ${spec.post.max}（${COUNTING[spec.post.count]}；${spec.post.max} 大约是 ${Math.round(spec.post.max / 6)} 个英文单词或 ${Math.floor(spec.post.max / 2)} 个汉字），或 ${spec.post.threadMin} 到 ${spec.post.threadMax} 条的串，每条不超过 ${spec.post.max}；写完每条数一下，超了就删或拆成两条`)
  else if (spec.cards) lines.push(`正文（发在正文框里的那段）：${spec.body.min} 到 ${spec.body.max} 字（不算空白）`)
  else lines.push(`正文：${spec.body.min} 到 ${spec.body.max}（${COUNTING[spec.body.count]}）`)
  if (spec.cards) {
    const c = spec.cards
    lines.push(`图片版：${c.min} 到 ${c.max} 节，按语义自然分节，不凑节数；「## 小节标题」不是强制分页。每节正文建议不超过 ${c.perCard} 字，有图时 ${c.perImageCard} 字，少于 ${c.minCard} 字就合并；图片版合计 ${c.total.min} 到 ${c.total.max} 字（不算空白）；小节标题 ${c.heading.min} 到 ${c.heading.max} 字。渲染时按实际容量合并短节和分页`)
  }
  lines.push(spec.tags.max ? `标签：${spec.tags.min} 到 ${spec.tags.max} 个，不带 #` : '标签：不要')
  const b = spec.budgets
  if (Number.isFinite(b.boldMin) || Number.isFinite(b.boldMax)) lines.push(`加粗（**…**）：${b.boldMin ?? 0} 到 ${b.boldMax ?? '不限'} 处，只标核心判断和关键结论`)
  if (Number.isFinite(b.highlightMin) || Number.isFinite(b.highlightMax)) lines.push(`高亮（==…==）：${b.highlightMin ?? 0} 到 ${b.highlightMax ?? '不限'} 处，只留给最值得记住的洞察`)
  if (Number.isFinite(b.adviceMax)) lines.push(`「你应该」「建议你」「你要」合计不超过 ${b.adviceMax} 次，用「我观察到」「我的判断是」代替说教`)
  if (Number.isFinite(b.emojiMax)) lines.push(`emoji 不超过 ${b.emojiMax} 个`)
  if (spec.lang === 'en') lines.push('语言：用英文写（标题、正文、标签和首评都用英文），不是逐句翻译母稿')
  if (spec.lang === 'zh') lines.push('语言：用中文写')
  lines.push(`结构：${spec.structure}`)
  lines.push(`语气：${spec.tone}`)
  if (spec.links === 'block') lines.push('正文里不能出现任何外部链接、联系方式或引导私信、加微信的话')
  return lines.join('\n')
}
