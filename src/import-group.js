// 导入文件夹的「合篇」规则：哪些文件其实是同一篇稿子。只做判断，不改 state。
// 1. 同一文件夹、同一天、同类文件、标题几乎一样：可能重复，默认留最近改过的那份。
// 2. 小红书文件夹里 X.md（正文）和 X_图片版*.md（卡片）合成一篇；文件名对不上时，同一天、标题明显是同一件事也合。
// 3. 小红书那篇和公众号某篇日期相同或差一天、标题明显是同一件事，就挂到公众号那篇下面当小红书版本。
// 证据不够就不合，宁可多一篇。
import { tokens } from './tokens.js'

export const stripDate = text => text.replace(/^\d{4}([-_.]?)\d{2}\1\d{2}(?!\d)[_\s.-]*/, '')

/** 同一篇的不同版本（图片版、短版、600字版、正文版、短笔记、初稿、_v2）：从文件名末尾取出来，挂在标题后面区分。 */
export function variantOf(fileBase) {
  const match = /[_-]((?:[^_-]*版|短笔记|\d+字笔记|初稿)(?:[_-]v\d+)?)$/i.exec(fileBase)
  return match ? match[1] : null
}

/** 去掉日期、版本后缀和 Obsidian 默认的「未命名」，剩下的文件名。 */
export function stemOf(fileBase) {
  const variant = variantOf(fileBase)
  const base = variant ? fileBase.slice(0, -variant.length - 1) : fileBase
  return base.replace(/未命名\s*\d*$/, '').replace(/[_\s.-]+$/, '')
}

/** 文件名里像样的标题：至少 4 个字，纯英文要两个词以上；「未命名 3」「0213」这种不算。 */
export function fileTitleOf(fileBase) {
  const text = stripDate(stemOf(fileBase)).replace(/[_]+/g, ' ').trim()
  if (!text || /^(未命名|无标题|新建|untitled|drawing)/i.test(text)) return null
  const chars = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
  if (chars < 4 || !/[\p{L}]/u.test(text)) return null
  if (!/[一-鿿]/.test(text) && text.split(/[\s-]+/).filter(Boolean).length < 2 && text.length < 10) return null
  return text
}

const LABEL_WORDS = new Set(['一句话定位', '一句话总结', '项目背景', '背景', '前言', '引言', '导语', '目录', '摘要', '总结', '小结', '结语', '写在前面', '正文', '封面', '首页', '图片版', '简介', '概述', '核心观点', '要点', 'tldr'])

/** 开头那行像不像小节名：编号开头、表情符号加几个字、「一句话定位」这类固定词，或者太短。 */
export function looksLikeLabel(text) {
  const core = text.replace(/[（(][^）)]*[）)]\s*$/, '').trim()
  if (/^(第?[一二三四五六七八九十百]+[、.．:：]|\d{1,2}\s*[、.．:：)）]|[（(]\d+[）)]|part\s*\d|p\d+\b)/i.test(core)) return true
  const plain = core.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
  if (/^[^\p{L}\p{N}"“'‘《【(（]/u.test(core) && plain.length <= 8) return true
  return LABEL_WORDS.has(plain) || plain.length <= 3
}

/** 文件属于哪一类：图片版是卡片，没后缀或正文版是正文，别的（短版、600字版…）是另一个版本。 */
export function kindOf(variant) {
  if (!variant) return 'body'
  if (/图片/.test(variant)) return 'cards'
  return /^正文版/.test(variant) ? 'body' : 'alt'
}

const XHS = '小红书'
const WECHAT = '公众号'
const DAY_MS = 86_400_000
export const MATCH_SCORE = 0.5
const SAME_SCORE = 0.8

// 文件名里常用 - 和 _ 连英文名（ERNIE-Evolve-RSI），拆开再分词，不然整串算一个词，和 ERNIE-Evolve 对不上
const words = text => tokens(String(text ?? '').replace(/[-_]+/g, ' '))

/** 两个标题的重合度：共同的词占较短那个标题的比例。只共有一个词时，这个词得是 8 个字符以上的英文名（比如 paddleocr）才算。 */
export function titleScore(a, b) {
  const x = words(a)
  const y = words(b)
  const small = Math.min(x.size, y.size)
  if (!small) return 0
  const shared = [...x].filter(word => y.has(word))
  if (shared.length < 2 && !(shared.length === 1 && /^[a-z0-9][a-z0-9+#.-]{7,}$/.test(shared[0]))) return 0
  return shared.length / small
}

function titlesOf(file) {
  return [...new Set([file.baseTitle, file.fileTitle, file.heading, file.ownTitle].filter(Boolean))]
}

/** 两组标题里最像的一对的重合度。 */
function bestScore(left, right) {
  let best = 0
  for (const a of left) for (const b of right) best = Math.max(best, titleScore(a, b))
  return best
}

const squash = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** 标题几乎一样：去掉标点后相同，或者用词重合八成以上（至少 3 个词）。 */
function nearSame(left, right) {
  for (const a of left) {
    for (const b of right) {
      if (squash(a) && squash(a) === squash(b)) return true
      const x = words(a)
      const y = words(b)
      const shared = [...x].filter(word => y.has(word)).length
      if (shared >= 3 && shared / (x.size + y.size - shared) >= SAME_SCORE) return true
    }
  }
  return false
}

function dayDiff(a, b) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS
}

const keyOf = (prefix, paths) => `${prefix}:${[...paths].sort().join('|')}`

/**
 * 同一文件夹里可能重复的文件：同一天（按创建日期）、同类（正文 / 图片版 / 同一种短版）、标题几乎一样。
 * @returns {Array<{key: string, paths: string[], suggested: string}>} suggested 是最近改过的那份。
 */
export function findDuplicates(files) {
  const parent = new Map(files.map(file => [file.path, file.path]))
  const find = path => (parent.get(path) === path ? path : find(parent.get(path)))
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const [a, b] = [files[i], files[j]]
      if (a.root !== b.root || a.dupFamily !== b.dupFamily || a.createdDay !== b.createdDay) continue
      if (nearSame(titlesOf(a), titlesOf(b))) parent.set(find(b.path), find(a.path))
    }
  }
  const clusters = new Map()
  for (const file of files) {
    const root = find(file.path)
    clusters.set(root, [...(clusters.get(root) ?? []), file])
  }
  return [...clusters.values()].filter(list => list.length > 1).map((list) => {
    const newest = [...list].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    return { key: keyOf('dup', list.map(file => file.path)), paths: list.map(file => file.path), suggested: newest.path }
  })
}

function versionNo(file) {
  return Number(/v(\d+)$/i.exec(file.variant ?? '')?.[1] ?? 1)
}

/**
 * 小红书文件夹里把正文和图片版配成一篇。先按文件名（去掉日期后缀前的同一个名字），再按同一天 + 标题。
 * @returns {{units: object[], alone: object[]}} units 是 {body, cards, key, how}；alone 是不参与配对的文件。
 */
export function pairXhs(files, split = new Set()) {
  const families = new Map()
  for (const file of files) families.set(`${file.root}\n${file.stemKey}`, [...(families.get(`${file.root}\n${file.stemKey}`) ?? []), file])
  const units = []
  const alone = []
  for (const list of families.values()) {
    const cards = list.filter(file => file.kind === 'cards').sort((a, b) => versionNo(b) - versionNo(a) || b.mtimeMs - a.mtimeMs)
    const bodies = [
      ...list.filter(file => file.kind === 'body').sort((a, b) => Number(Boolean(a.variant)) - Number(Boolean(b.variant)) || b.mtimeMs - a.mtimeMs),
      ...list.filter(file => file.kind === 'alt').sort((a, b) => b.mtimeMs - a.mtimeMs),
    ]
    const body = bodies[0] ?? null
    const card = cards[0] ?? null
    alone.push(...bodies.slice(1), ...cards.slice(1))
    units.push({ body, cards: card, how: body && card ? 'name' : null })
  }
  // 文件名对不上的图片版：找同一天、标题明显是同一件事、还没配上图片版的正文
  const lonelyCards = units.filter(unit => unit.cards && !unit.body)
  const openBodies = units.filter(unit => unit.body && !unit.cards)
  const taken = new Set()
  for (const unit of lonelyCards) {
    const card = unit.cards
    if (!card.day) continue
    const scored = openBodies
      .filter(other => !taken.has(other) && other.body.root === card.root && other.body.day === card.day)
      .map(other => ({ other, score: bestScore(titlesOf(card), titlesOf(other.body)) }))
      .filter(row => row.score >= MATCH_SCORE)
      .sort((a, b) => b.score - a.score)
    if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) continue
    taken.add(scored[0].other)
    scored[0].other.cards = card
    scored[0].other.how = 'title'
    unit.cards = null
  }
  const out = []
  for (const unit of units) {
    if (!unit.body && !unit.cards) continue
    if (unit.body && unit.cards) {
      const key = keyOf('pair', [unit.body.path, unit.cards.path])
      if (split.has(key)) {
        alone.push(unit.body, unit.cards)
        out.push({ key, off: true, body: unit.body, cards: unit.cards, how: unit.how })
        continue
      }
      out.push({ ...unit, key })
    } else out.push(unit)
  }
  return { units: out, alone }
}

/**
 * 小红书那篇挂到哪篇公众号下面：日期相同或差一天、标题重合度 ≥ 0.5；同分的两篇分不出就不挂；一篇公众号只挂一组小红书。
 * @param {object[]} units - pairXhs 给的组（没被拆开的）。
 * @param {Array<{id: string, day: string|null, titles: string[], plain: boolean}>} mothers - 本次的公众号文件和已经导入的公众号稿子。
 * @returns {Map<object, object>} 小红书组 → 公众号。
 */
export function matchMothers(units, mothers) {
  const picks = []
  for (const unit of units) {
    const parts = [unit.body, unit.cards].filter(Boolean)
    const day = parts.map(file => file.day).find(Boolean)
    if (!day) continue
    const titles = [...new Set(parts.flatMap(titlesOf))]
    const scored = mothers
      .filter(mother => mother.day && dayDiff(mother.day, day) <= 1)
      .map(mother => ({ mother, score: bestScore(titles, mother.titles) }))
      .filter(row => row.score >= MATCH_SCORE)
      .sort((a, b) => b.score - a.score || Number(b.mother.plain) - Number(a.mother.plain))
    if (!scored.length) continue
    const [first, second] = scored
    if (second && second.score === first.score && second.mother.plain === first.mother.plain) continue
    picks.push({ unit, mother: first.mother, score: first.score })
  }
  const used = new Set()
  const out = new Map()
  for (const pick of picks.sort((a, b) => b.score - a.score)) {
    if (used.has(pick.mother.id)) continue
    used.add(pick.mother.id)
    out.set(pick.unit, pick.mother)
  }
  return out
}

export function crossKey(motherId, unit) {
  return `cross:${motherId}|${[unit.body?.path, unit.cards?.path].filter(Boolean).sort().join('|')}`
}

/**
 * 把这次扫到的文件分成一篇篇：去重、小红书配对、挂到公众号。
 * @param {object[]} files - 各文件夹 scanFolder 的结果合在一起（每个带 root）。
 * @param {{split?: Set<string>, keep?: object, existing?: object[], held?: Set<string>}} choices - 用户拆开的组、重复文件留哪份；existing 是可以挂上去的已导入公众号稿子；held 是已经挂在别的文件夹稿子下面的小红书文件，不再重新挑。
 * @returns {{units: object[], groups: object[], duplicates: object[], dropped: Set<string>}}
 */
export function groupFiles(files, { split = new Set(), keep = {}, existing = [], held = new Set() } = {}) {
  const duplicates = findDuplicates(files).map((dup) => {
    const chosen = keep[dup.key]
    return { ...dup, keep: chosen === 'all' || dup.paths.includes(chosen) ? chosen : dup.suggested }
  })
  const dropped = new Set(duplicates.flatMap(dup => (dup.keep === 'all' ? [] : dup.paths.filter(path => path !== dup.keep))))
  const live = files.filter(file => !dropped.has(file.path))
  const xhsFiles = live.filter(file => file.platform === XHS)
  const { units: xhsUnits, alone } = pairXhs(xhsFiles, split)
  const groups = []
  const units = []
  for (const unit of xhsUnits.filter(row => row.off)) groups.push({ key: unit.key, kind: 'pair', on: false, how: unit.how, paths: [unit.body.path, unit.cards.path] })
  const open = xhsUnits.filter(row => !row.off)
  const mothers = [
    ...live.filter(file => file.platform === WECHAT).map(file => ({ id: file.path, file, day: file.day, titles: titlesOf(file), plain: file.kind === 'body' })),
    ...existing,
  ]
  const matched = matchMothers(open.filter(unit => ![unit.body, unit.cards].some(file => file && held.has(file.path))), mothers)
  const byMother = new Map()
  for (const unit of open) {
    const mother = matched.get(unit)
    const key = mother ? crossKey(mother.id, unit) : null
    if (unit.key) groups.push({ key: unit.key, kind: 'pair', on: true, how: unit.how, paths: [unit.body.path, unit.cards.path] })
    if (mother && split.has(key)) {
      groups.push({ key, kind: 'cross', on: false, paths: [mother.file?.path ?? mother.id, unit.body?.path, unit.cards?.path].filter(Boolean), targetId: mother.file ? null : mother.id })
      units.push({ mother: null, body: unit.body, cards: unit.cards, keys: [unit.key].filter(Boolean) })
    } else if (mother) {
      groups.push({ key, kind: 'cross', on: true, paths: [mother.file?.path ?? mother.id, unit.body?.path, unit.cards?.path].filter(Boolean), targetId: mother.file ? null : mother.id })
      if (mother.file) byMother.set(mother.file.path, { unit, key })
      else units.push({ mother: null, targetId: mother.id, body: unit.body, cards: unit.cards, keys: [unit.key, key].filter(Boolean) })
    } else units.push({ mother: null, body: unit.body, cards: unit.cards, keys: [unit.key].filter(Boolean) })
  }
  const xhsTaken = new Set(open.flatMap(unit => [unit.body?.path, unit.cards?.path]).filter(Boolean))
  for (const file of live) {
    if (xhsTaken.has(file.path)) continue
    const attach = byMother.get(file.path)
    if (attach) units.push({ mother: file, body: attach.unit.body, cards: attach.unit.cards, keys: [attach.unit.key, attach.key].filter(Boolean) })
    else if (file.platform !== XHS || alone.includes(file)) units.push({ mother: file, body: null, cards: null, keys: [] })
  }
  return { units, groups, duplicates, dropped }
}

const cleanKeep = raw => (raw && typeof raw === 'object' && !Array.isArray(raw)
  ? Object.fromEntries(Object.entries(raw).filter(([key, value]) => typeof value === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)).slice(0, 2000))
  : {})
const cleanSplit = raw => (Array.isArray(raw) ? raw.filter(key => typeof key === 'string').slice(0, 2000) : [])

/**
 * 把用户的选择收拾成能用的样子：拆开的组、重复文件留哪份、只导入哪些文件。
 * 请求里没带选择（比如「重新导入」按钮）时，沿用这几个文件夹上次导入时记下的选择。
 */
export function choicesOf(state, scans, raw = {}) {
  const given = Array.isArray(raw.split) || Boolean(raw.keep && typeof raw.keep === 'object')
  const rows = given ? [] : (state.importDirs ?? []).filter(row => scans.some(scan => scan.dir === row.dir))
  const split = given ? cleanSplit(raw.split) : rows.flatMap(row => cleanSplit(row.split))
  const keep = given ? cleanKeep(raw.keep) : Object.assign({}, ...rows.map(row => cleanKeep(row.keep)))
  const paths = Array.isArray(raw.paths) ? new Set(raw.paths.filter(path => typeof path === 'string')) : null
  return { split: new Set(split), keep, paths }
}
