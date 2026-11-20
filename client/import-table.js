// 从平台后台复制或导出的数据表：按表头认列，再逐行解析。纯函数，不碰界面也不发请求。
// 认不出的格子不猜：整行列进「没导入」，并带上原因代码，界面负责翻成人话。
import { titleMatcher } from '../src/title-match.js'
import { workIdFromText } from '../src/work-id.js'

// 表里没有的列就不出现在导入的数据里：缺着是不知道，不是 0
// 公众号的「在看」单独记成 recommends：它和点赞是两个按钮，并进点赞会把两份数加在一起；互动里会算上它
export const METRIC_KEYS = ['views', 'impressions', 'likes', 'comments', 'shares', 'saves', 'recommends', 'completion', 'newFollowers', 'minutes']

const SYNONYMS = {
  date: ['日期', '时间', '发布时间', 'date'],
  title: ['标题', '作品', '笔记', '内容', 'title'],
  views: ['播放', '播放量', '阅读', '阅读量', '浏览', '观看', 'views'],
  impressions: ['曝光', '曝光量', '展现', '展现量', 'impressions'],
  likes: ['点赞', '赞', 'likes'],
  comments: ['评论', '留言', 'comments'],
  shares: ['转发', '分享', 'shares'],
  saves: ['收藏', 'saves', 'bookmarks'],
  recommends: ['在看', 'recommends'],
  completion: ['完播', '完播率', 'completion', 'completion rate'],
  newFollowers: ['涨粉', '新增关注', '新增粉丝', 'new followers'],
  minutes: ['制作时长', '制作分钟', '分钟', 'minutes'],
}

// 比率、时长、编号、链接这类列名里也会带「播放」「作品」等字，但不是要导入的数
const SKIP = /率|占比|时长|平均|人均|赞藏|%|rate|ratio|avg|average|duration|链接|url|link|封面|类型|状态|完播(人数|次数|数|量)|(^|[^a-z])id$/i
// 完播率本身就是比率、制作时长本身就是时长，这两类不受上面的排除
const KEEP = /完播(?!人数|次数|数|量)|completion|制作时长|制作分钟/i
// 链接列不导入数字，但从链接里取作品 ID：标题在平台上改过时靠它认回同一条。整列的名字以链接结尾才算（「链接数」不算）
const LINK = /链接$|网址$|地址$|(?:^|[^a-z])(?:url|link)$/i

function normalize(header) {
  return String(header ?? '').replace(/^﻿/, '').replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 按表头认列。每个字段最多认一列，每列最多算一个字段；完全一样的名字优先，其次是包含得最长的那个词。
 * 链接列不算数据，单独认出来：从里面的地址取作品 ID。
 * @param {string[]} headerCells - 表头的每一格。
 * @returns {{fields: Partial<Record<'date'|'title'|'views'|'impressions'|'likes'|'comments'|'shares'|'saves'|'completion'|'newFollowers'|'minutes'|'link', number>>, columns: Array<{index: number, header: string, field: string|null}>}} 字段到列号，以及每列认成了什么。
 */
export function detectColumns(headerCells) {
  const candidates = []
  headerCells.forEach((cell, index) => {
    const name = normalize(cell)
    if (!name) return
    if (LINK.test(name) && !KEEP.test(name)) {
      candidates.push({ index, field: 'link', score: 90 })
      return
    }
    if (SKIP.test(name) && !KEEP.test(name)) return
    for (const [field, words] of Object.entries(SYNONYMS)) {
      for (const word of words) {
        if (name === word) candidates.push({ index, field, score: 100 + word.length })
        else if (name.includes(word)) candidates.push({ index, field, score: word.length })
      }
    }
  })
  candidates.sort((a, b) => b.score - a.score || a.index - b.index)
  const fields = {}
  const taken = new Set()
  for (const { index, field } of candidates) {
    if (fields[field] !== undefined || taken.has(index)) continue
    fields[field] = index
    taken.add(index)
  }
  const byIndex = Object.fromEntries(Object.entries(fields).map(([field, index]) => [index, field]))
  return { fields, columns: headerCells.map((header, index) => ({ index, header: String(header ?? '').trim(), field: byIndex[index] ?? null })) }
}

const UNIT = { 万: 1e4, w: 1e4, 亿: 1e8, 千: 1e3, k: 1e3, m: 1e6 }

/**
 * 「1.2万」「3,456」「12.5k」这类数字。
 * @param {unknown} raw - 一格的原文。
 * @returns {number|null} 空格或「-」是 null（没填），看不懂是 NaN。
 */
export function parseNumber(raw) {
  const s = String(raw ?? '').trim().replace(/[\s,，]/g, '')
  if (!s || /^[-—–]+$/.test(s)) return null
  const match = /^\+?(\d+(?:\.\d+)?)(万|w|亿|千|k|m)?(次|人|个|条)?$/i.exec(s)
  if (!match) return NaN
  return Math.round(Number(match[1]) * (UNIT[match[2]?.toLowerCase()] ?? 1))
}

/**
 * 完播率这类比例：「35%」「0.35」都是 0.35；不带 % 且大于 1 的按百分数读（「35」是 35%）。
 * @param {unknown} raw - 一格的原文。
 * @returns {number|null} 0–1；空格或「-」是 null（没填），看不懂或超过 100% 是 NaN。
 */
export function parseRatio(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '')
  if (!s || /^[-—–]+$/.test(s)) return null
  const match = /^(\d+(?:\.\d+)?)(%)?$/.exec(s)
  if (!match) return NaN
  const n = Number(match[1])
  const ratio = match[2] || n > 1 ? n / 100 : n
  return ratio <= 1 ? Math.round(ratio * 1e6) / 1e6 : NaN
}

function validDay(y, m, d) {
  const date = new Date(y, m - 1, d, 12)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * 2026-11-12、2026/11/12、2026年11月12日、11月12日（当年），后面带时间也行。
 * @param {unknown} raw - 一格的原文。
 * @param {Date} [now] - 只写月日时用它的年份。
 * @returns {string|null} 'YYYY-MM-DD'，看不懂就是 null。
 */
export function parseDate(raw, now = new Date()) {
  const s = String(raw ?? '').trim()
  const full = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:$|[\sT])/.exec(s)
  if (full) return validDay(Number(full[1]), Number(full[2]), Number(full[3]))
  const short = /^(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:$|\s)/.exec(s)
  if (short) return validDay(now.getFullYear(), Number(short[1]), Number(short[2]))
  return null
}

/** 切成行和格。分隔符看第一行：有制表符就按制表符，否则按逗号；双引号里的逗号和换行不切。 */
export function splitTable(text) {
  const source = String(text ?? '').replace(/^﻿/, '')
  const first = source.split(/\r?\n/).find(line => line.trim()) ?? ''
  const sep = first.includes('\t') ? '\t' : first.includes(',') ? ',' : first.includes('，') ? '，' : '\t'
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && !cell.trim()) {
      quoted = true
      cell = ''
    } else if (ch === sep) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1
      rows.push([...row, cell.trim()])
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell || row.length) rows.push([...row, cell.trim()])
  return rows.filter(cells => cells.some(Boolean))
}

/**
 * 解析整张表。第一行是表头。
 * @param {string} text - 粘贴进来的原文。
 * @param {Date} [now] - 只写月日的日期按它的年份。
 * @returns {{columns: Array<object>, fields: object, rows: Array<object>, errors: Array<{line: number, code: 'date'|'no-date'|'number'|'empty', header?: string, value?: string}>, problem: 'no-date'|'no-metric'|null}} problem 不为空时整张表都导不了。
 */
export function parseTable(text, now = new Date()) {
  const [header = [], ...body] = splitTable(text)
  const { fields, columns } = detectColumns(header)
  const metrics = METRIC_KEYS.filter(key => fields[key] !== undefined)
  const result = { columns, fields, rows: [], errors: [], problem: null }
  if (fields.date === undefined) return { ...result, problem: 'no-date' }
  if (!metrics.length) return { ...result, problem: 'no-metric' }
  body.forEach((cells, offset) => {
    const line = offset + 2
    const rawDate = cells[fields.date] ?? ''
    const date = parseDate(rawDate, now)
    if (!date) {
      result.errors.push(rawDate ? { line, code: 'date', value: rawDate } : { line, code: 'no-date' })
      return
    }
    const values = {}
    for (const key of metrics) {
      const raw = cells[fields[key]] ?? ''
      const value = key === 'completion' ? parseRatio(raw) : parseNumber(raw)
      if (Number.isNaN(value)) {
        result.errors.push({ line, code: 'number', header: columns[fields[key]].header, value: raw })
        return
      }
      if (value !== null) values[key] = value
    }
    if (!Object.keys(values).length) {
      result.errors.push({ line, code: 'empty' })
      return
    }
    const title = fields.title === undefined ? '' : String(cells[fields.title] ?? '').trim()
    // 有链接列就从地址里取作品 ID；取不到是不知道，不是错
    const workId = fields.link === undefined ? null : workIdFromText(cells[fields.link] ?? '')
    result.rows.push({ line, date, title, ...(workId ? { workId } : {}), ...values })
  })
  return result
}

/**
 * 把解析好的行变成 add_metric 操作。标题和已有内容（灵感标题或成稿标题）完全一样、且只对上一条时挂到那条内容下，否则不挂。
 * @param {Array<object>} rows - parseTable 的 rows。
 * @param {{platform: string, items: Array<object>}} options - 平台和现有内容。
 * @returns {{ops: Array<object>, attached: number}} 操作和挂上的条数。
 */
export function buildImportOps(rows, { platform, items }) {
  const owner = titleMatcher(items)
  let attached = 0
  const ops = rows.map((row) => {
    const itemId = owner(row.title)
    if (itemId) attached += 1
    const metrics = Object.fromEntries(METRIC_KEYS.filter(key => row[key] !== undefined).map(key => [key, row[key]]))
    return { op: 'add_metric', replace: true, platform, itemId, ...(row.workId ? { workId: row.workId } : {}), ...(row.title ? { title: row.title } : {}), date: new Date(`${row.date}T12:00:00`).toISOString(), ...metrics }
  })
  return { ops, attached }
}
