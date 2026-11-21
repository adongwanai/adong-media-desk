// 图文卡片（小红书 / 抖音图文 / B 站图文 / 微博……）：骨架 × 主题 × 封面三层独立，同言起 YANQI。
// 排版来自言起 YANQI（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian），
// 言起基于 Note to RED（Yeban8090，MIT，https://github.com/Yeban8090/note-to-red）。
// 这里全是纯函数：拆节、切页规划、拼卡片 HTML。量高度的函数从外面传进来（界面里量真实 DOM，测试里估算）。
// 卡片 HTML 只有行内样式，文字全部转义，图片只收 data:image，导出成 PNG 时不依赖任何外部资源。
import { COVER_TEMPLATES, COVER_TEMPLATE_IDS, coverChecks, coverLayout } from './covers.js'
import { dropLeadingTitle, parseBlocks, parseInline } from './markdown.js'
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, blockHtml, clampFontSize, coverImageBox, css, cssValue, escapeHtml, fontFamily, headingHtml, imageKey, richBlocks, yanqiTheme } from './yanqi.js'

/** 卡片按言起预览的尺寸排版（3:4 是 450×600），导出时按选的像素放大。 */
export const CARD_WIDTH = 450
export const CARD_HEIGHT = 600
export const EXPORT_WIDTH = 1080
export const EXPORT_HEIGHT = 1440

/**
 * 卡片比例。小红书图文支持 3:4 / 1:1 / 4:3，整篇笔记跟第一张图的比例走；抖音图文用 9:16。
 * 推荐像素：3:4 是 1080×1440 或 1242×1660，言起导出是 450×600 的 3 倍 = 1350×1800。
 * 出处（都是第三方指南，小红书没有公开的官方规格页）：linkbloom.ai/resources/xiaohongshu-image-size-guide、
 * www.biaojixia.com/specs/xiaohongshu、www.cardcrafter.cn/guides/xiaohongshu-image-sizes。
 * exports 按短边分三档：1080 / 1242 / 1350。
 */
export const CARD_RATIOS = [
  { id: '3:4', name: '3:4 竖图', platform: '小红书', width: 450, exports: { 1080: [1080, 1440], 1242: [1242, 1660], 1350: [1350, 1800] } },
  { id: '1:1', name: '1:1 方图', platform: '小红书', width: 450, exports: { 1080: [1080, 1080], 1242: [1242, 1242], 1350: [1350, 1350] } },
  { id: '4:3', name: '4:3 横图', platform: '小红书', width: 600, exports: { 1080: [1440, 1080], 1242: [1656, 1242], 1350: [1800, 1350] } },
  { id: '9:16', name: '9:16 长图', platform: '抖音图文', width: 450, exports: { 1080: [1080, 1920], 1242: [1242, 2208], 1350: [1350, 2400] } },
]
export const EXPORT_TIERS = [1080, 1242, 1350]
export const DEFAULT_RATIO = '3:4'
export const DEFAULT_TIER = 1080

/** 某个比例、某一档导出像素下，排版用的卡片尺寸和导出尺寸。排版宽度固定，高度按导出像素的比例算。 */
export function cardSize(ratio = DEFAULT_RATIO, tier = DEFAULT_TIER) {
  const row = CARD_RATIOS.find(item => item.id === ratio) ?? CARD_RATIOS[0]
  const [exportWidth, exportHeight] = row.exports[tier] ?? row.exports[DEFAULT_TIER]
  return { ratio: row.id, tier: row.exports[tier] ? Number(tier) : DEFAULT_TIER, width: row.width, height: Math.round((row.width * exportHeight / exportWidth) * 100) / 100, exportWidth, exportHeight }
}

/**
 * 安全区（预览里可以叠一层虚线框看）：左右各留 8%，上下各留 10% 不放关键文字；
 * 信息流里点赞数和标题可能压在图片下沿，最下面 15% 也尽量不放字。出处同上，属于运营经验值。
 */
export const SAFE_AREA = { side: 0.08, top: 0.1, bottom: 0.1, overlay: 0.15 }

/** 12 套骨架，分组同言起 README。name 是中文原文，界面显示时再翻译。 */
export const CARD_TEMPLATES = [
  { id: 'xhs', name: '小红书笔记', group: '社媒卡片' },
  { id: 'weibo', name: '微博卡', group: '社媒卡片' },
  { id: 'wechat', name: '公众号卡', group: '社媒卡片' },
  { id: 'notes', name: '备忘录', group: '社媒卡片' },
  { id: 'magazine', name: '杂志刊头', group: '媒体 / 编辑风' },
  { id: 'newspaper', name: '报纸报头', group: '媒体 / 编辑风' },
  { id: 'quote', name: '语录卡', group: '媒体 / 编辑风' },
  { id: 'terminal', name: '终端窗口', group: '开发者 / 极简' },
  { id: 'github', name: 'GitHub 卡', group: '开发者 / 极简' },
  { id: 'default', name: '默认模板', group: '开发者 / 极简' },
  { id: 'minimal-cover', name: '极简无头', group: '开发者 / 极简' },
  { id: 'signature', name: '纯署名', group: '开发者 / 极简' },
]

/** 言起的 5 种封面（标题 + 开头几段），后面是新增的固定版式封面（只放封面槽位，开头几段挪到第 2 页）。 */
export const YANQI_COVERS = [
  { id: 'cover-classic', name: '经典居中', hint: '标题居中，稳重通用' },
  { id: 'cover-bold', name: '大字报', hint: '超大字号，强冲击力' },
  { id: 'cover-mag', name: '杂志', hint: '杂志刊头式排版' },
  { id: 'cover-number', name: '编号', hint: '带序号的系列感封面' },
  { id: 'cover-min', name: '极简', hint: '中号左对齐，克制' },
]
export const CARD_COVERS = [...YANQI_COVERS, ...COVER_TEMPLATES]
export { COVER_TEMPLATES }

export const DEFAULT_TEMPLATE = 'default'
export const DEFAULT_COVER = 'cover-bold'
export const HEADING_LEVELS = [1, 2, 3]
export const DEFAULT_HEADING_LEVEL = 2

/** 卡片上印的固定文字。界面传翻译后的版本进来。 */
export const CARD_LABELS = { like: '点赞', save: '收藏', comment: '评论', repost: '转发', thumb: '赞', readMore: '阅读原文', follow: '+ 关注', notes: '备忘录', masthead: '今日笔记' }

const AVATAR = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i
const IMAGE_SRC = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i
const MONO = "'SF Mono', Menlo, monospace"

/**
 * 日期格式。locale 开头的四种同言起（toLocaleDateString 的地区写法），其余是模板：YYYY 年、MM / M 月、DD / D 日。
 */
export const TIME_FORMATS = ['zh-CN', 'en-US', 'en-GB', 'ja-JP', 'YYYY.MM.DD', 'YYYY-MM-DD', 'YYYY年M月D日', 'M月D日']

/** 按格式写日期。格式不认识时按 zh-CN。 */
export function formatDate(date, format = 'zh-CN') {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const value = String(format ?? '').trim().slice(0, 24)
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(value)) {
    try {
      return d.toLocaleDateString(value)
    } catch {
      return d.toLocaleDateString('zh-CN')
    }
  }
  if (!/Y|M|D/.test(value)) return d.toLocaleDateString('zh-CN')
  const pad = n => String(n).padStart(2, '0')
  return value.replace(/YYYY|MM|DD|M|D/g, token => ({ YYYY: String(d.getFullYear()), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), M: String(d.getMonth() + 1), D: String(d.getDate()) }[token]))
}

const IMAGE_LIMITS = { min: 60, scaleMin: 0.5, scaleMax: 3 }
export const TABLE_SCALE = { min: 0.5, max: 1.6, step: 0.05 }

/** 图片调整的记忆值收紧到合法范围，同言起：缩放 0.5–3，宽高至少 60px。 */
export function cleanImageState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {}
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
  const out = { s: Math.min(IMAGE_LIMITS.scaleMax, Math.max(IMAGE_LIMITS.scaleMin, num(state.s, 1))), x: Math.max(-2000, Math.min(2000, num(state.x, 0))), y: Math.max(-2000, Math.min(2000, num(state.y, 0))) }
  if (Number.isFinite(Number(state.w))) out.w = Math.max(IMAGE_LIMITS.min, Math.min(2000, Number(state.w)))
  if (Number.isFinite(Number(state.h))) out.h = Math.max(IMAGE_LIMITS.min, Math.min(2000, Number(state.h)))
  return out
}

/** 表格缩放的记忆值，同言起：0.5–1.6。 */
export function cleanTableScale(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(TABLE_SCALE.max, Math.max(TABLE_SCALE.min, Math.round(n * 100) / 100)) : 1
}

function paddingOf(style) {
  const value = cssValue(style, 'padding')
  const parts = String(value ?? '').split(/\s+/).map(part => parseFloat(part)).filter(Number.isFinite)
  const [top = 20, right = top, bottom = top, left = right] = parts
  const one = (prop, fallback) => {
    const n = parseFloat(cssValue(style, prop))
    return Number.isFinite(n) ? n : fallback
  }
  return { top, right: one('padding-right', right), bottom: one('padding-bottom', bottom), left: one('padding-left', left) }
}

/**
 * 卡片排版需要的全部选择，缺的用言起默认值补上。
 * @param {object} prefs - { theme, template, cover, font, fontSize, ratio, tier, headingLevel }。
 * @param {object} [signature] - { name, id, avatar, left, right, showDate, showFooter, timeFormat }，默认全空。
 * @param {object} [extra] - { date, labels, themes: 自定义主题, images: key → 图片调整, tables: key → 表格缩放,
 *   background: { src, scale, x, y }, lines: 预览时带行号, cover: { kicker, tag, number, image }, article, headings }。
 */
export function cardContext(prefs = {}, signature = {}, extra = {}) {
  const theme = yanqiTheme(prefs.theme, extra.themes)
  const size = cardSize(prefs.ratio, prefs.tier)
  const pad = paddingOf(theme.styles.imagePreview)
  const background = extra.background && IMAGE_SRC.test(String(extra.background.src ?? '')) ? { src: extra.background.src, scale: Math.min(3, Math.max(0.1, Number(extra.background.scale) || 1)), x: Number(extra.background.x) || 0, y: Number(extra.background.y) || 0 } : null
  return {
    theme,
    s: theme.styles,
    template: CARD_TEMPLATES.some(row => row.id === prefs.template) ? prefs.template : DEFAULT_TEMPLATE,
    cover: CARD_COVERS.some(row => row.id === prefs.cover) ? prefs.cover : DEFAULT_COVER,
    font: fontFamily(prefs.font ?? DEFAULT_FONT),
    size: clampFontSize(prefs.fontSize, DEFAULT_FONT_SIZE),
    width: size.width,
    height: size.height,
    exportWidth: size.exportWidth,
    exportHeight: size.exportHeight,
    ratio: size.ratio,
    pad: { ...pad, top: 8 },
    headingLevel: HEADING_LEVELS.includes(Number(prefs.headingLevel)) ? Number(prefs.headingLevel) : DEFAULT_HEADING_LEVEL,
    signature: {
      name: String(signature.name ?? '').trim().slice(0, 40),
      id: String(signature.id ?? '').trim().slice(0, 40),
      avatar: AVATAR.test(String(signature.avatar ?? '')) ? signature.avatar : '',
      left: String(signature.left ?? '').trim().slice(0, 40),
      right: String(signature.right ?? '').trim().slice(0, 40),
      showDate: signature.showDate !== false,
      ...(signature.showFooter === false ? { showFooter: false } : {}),
    },
    date: String(extra.date ?? ''),
    labels: { ...CARD_LABELS, ...extra.labels },
    images: extra.images ?? {},
    tables: extra.tables ?? {},
    background,
    lines: Boolean(extra.lines),
    coverData: extra.cover ?? {},
    article: extra.article,
    headings: extra.headings ?? [],
  }
}

// 封面标题输入框的上限：小红书标题建议 20 字内，留出余量又不让一段正文贴进来
export const COVER_TITLE_MAX = 60

/**
 * 图文卡片封面上印的标题：自己填过就用填的（只改卡片，不动稿子标题），空着就回退到稿子标题。
 * 换行、连续空白压成一个空格：封面标题是一行字，换行交给排版自己折。
 * @param {string} custom - 用户在卡片里填的封面标题。
 * @param {string} fallback - 稿子标题。
 */
export function cardTitle(custom, fallback = '') {
  const text = Array.from(String(custom ?? '').replace(/\s+/g, ' ').trim()).slice(0, COVER_TITLE_MAX).join('').trim()
  return text || String(fallback ?? '').trim()
}

/**
 * 某个图片或表格（按记忆键）现在落在第几页：调完大小重新切页后，预览跟着翻到它那一页。
 * 表格拆到几页时取第一页。找不到返回 -1。
 */
export function pageOfKey(pages, key) {
  if (!key) return -1
  return pages.findIndex(page => page.blocks.some(block => block.key === key))
}

/** 这个封面是不是新增的固定版式封面。 */
export function isTemplateCover(id) {
  return COVER_TEMPLATE_IDS.has(id)
}

// ---------- 拆节 ----------

function plain(runs) {
  return runs.map(run => run.text).join('').trim()
}

function lineOf(blocks, fallback) {
  const lines = blocks.map(block => block.line).filter(Number.isInteger)
  return lines.length ? Math.min(...lines) : fallback
}

/**
 * 正文按小标题拆节（默认「## 」，可选一 / 二 / 三级，同言起 headingLevel）；节内的「---」是手动分页，同言起。
 * 第一节是封面：大标题用卡片自己填的封面标题，没填就用成稿标题；下面是开头几段。
 * @param {string} markdown - 成稿正文。
 * @param {object} options - { title, coverTitle, figures: [{ src, caption, anchor }], resolveImage: src => { src, width, height } | null, headingLevel }。
 *   title 是稿子标题（还用来判断正文开头那个一级标题要不要去掉）；coverTitle 只换封面上印的字。
 *   resolveImage 返回 null 的图片直接跳过（地址不安全或读不到）。
 * @returns {Array<{kind: 'cover'|'content', heading: Array<object>, blocks: Array<object>, section: number, line: number}>} 切页前的页。
 */
export function planSections(markdown, { title = '', coverTitle = '', figures = [], resolveImage = () => null, headingLevel = DEFAULT_HEADING_LEVEL } = {}) {
  const level = HEADING_LEVELS.includes(Number(headingLevel)) ? Number(headingLevel) : DEFAULT_HEADING_LEVEL
  const parsed = parseBlocks(markdown)
  // 按一级标题分页时，开头那个一级标题和成稿标题一样才去掉
  const leading = parsed[0]?.type === 'heading' && parsed[0].level === 1
  const blocks = level === 1 && leading && String(parsed[0].text).trim() !== String(title).trim() ? parsed : dropLeadingTitle(parsed)
  const sections = [{ kind: 'cover', heading: parseInline(cardTitle(coverTitle, title)), blocks: [], line: 0 }]
  for (const block of richBlocks(blocks)) {
    if (block.type === 'heading' && block.level === level) sections.push({ kind: 'content', heading: block.runs, blocks: [], line: block.line })
    else sections[sections.length - 1].blocks.push(block)
  }
  // 配图放回对应小标题那一节的末尾，找不到就按顺序摊开，同成稿页
  const placed = figures.filter(figure => figure?.src)
  placed.forEach((figure, i) => {
    let at = sections.findIndex(section => figure.anchor && plain(section.heading) === String(figure.anchor).trim())
    if (at < 0) at = Math.min(sections.length - 1, Math.round(((i + 1) * sections.length) / (placed.length + 1)))
    const last = sections[at].blocks[sections[at].blocks.length - 1]
    sections[at].blocks.push({ type: 'image', src: figure.src, alt: String(figure.caption ?? ''), line: last?.end ?? sections[at].line, end: last?.end ?? sections[at].line, figure: true })
  })
  const pages = []
  let pendingHardBreak = false
  sections.forEach((section, index) => {
    const blocks = section.blocks.flatMap((block) => {
      if (block.type !== 'image') return [block]
      const image = resolveImage(block.src)
      return image ? [{ ...block, ...image, origin: block.src, key: imageKey(block.src) }] : []
    })
    const parts = [[]]
    for (const block of blocks) {
      if (block.type === 'rule') parts.push([])
      else parts[parts.length - 1].push(block)
    }
    let emittedInSection = 0
    parts.forEach((part, i) => {
      // 节末写了 ---（如导语和第一个 ## 之间写 ---）：把强制分页标记传递给下一节，绝不吞掉用户的 ---
      if (i > 0 && !part.length) {
        pendingHardBreak = true
        return
      }
      // 节首紧跟 ---（如 ## 标题下面第一行写了 ---）：标题留给后面真正有正文的块，同时记下强制分页
      if (i === 0 && !part.length && parts.some((p, idx) => idx > 0 && p.length > 0)) {
        pendingHardBreak = true
        return
      }
      const cover = section.kind === 'cover'
      if (!cover && !part.length && !plain(section.heading) && emittedInSection === 0) return
      const hardBreak = i > 0 || pendingHardBreak
      pendingHardBreak = false
      pages.push({
        kind: cover && emittedInSection === 0 ? 'cover' : 'content',
        heading: cover && emittedInSection > 0 ? [] : section.heading,
        blocks: part,
        section: index,
        hardBreak,
        line: emittedInSection === 0 ? section.line : lineOf(part, section.line),
      })
      emittedInSection += 1
    })
  })
  return pages
}

/**
 * 新增的固定版式封面只放封面槽位：开头几段挪到紧跟着的一页（不带标题）。
 * @param {Array<object>} sections - planSections 的结果。
 * @param {string} cover - 封面 id。
 */
export function applyCoverMode(sections, cover, coverOnly = false) {
  if (!isTemplateCover(cover) && !coverOnly) return sections
  return sections.flatMap((section) => {
    if (section.kind !== 'cover' || !section.blocks.length) return [section]
    return [{ ...section, blocks: [] }, { kind: 'content', heading: [], blocks: section.blocks, section: section.section, line: lineOf(section.blocks, section.line), intro: true }]
  })
}

/** 估算一张内容卡上的可读字数，用来标出只剩一两句话的孤页。 */
export function pageCharCount(page) {
  if (!page || page.kind === 'cover') return Infinity
  let chars = plain(page.heading ?? []).length
  for (const block of page.blocks ?? []) {
    if (block.type === 'image' || block.type === 'table' || block.type === 'code') return Infinity
    if (block.runs) chars += plain(block.runs).length
    if (block.title) chars += plain(block.title).length
    if (block.items) for (const item of block.items) chars += plain(item.runs ?? []).length
  }
  return chars
}

/** 正文里的小标题（按分页的那一级），新封面的清单、步骤槽位用。 */
export function sectionHeadings(sections) {
  return sections.filter(section => section.kind === 'content' && plain(section.heading)).map(section => plain(section.heading)).filter((text, i, all) => all.indexOf(text) === i)
}

// ---------- 切页 ----------

function chars(runs) {
  return runs.flatMap(run => Array.from(run.text).map(ch => ({ ...run, text: ch })))
}

function joinChars(list) {
  const runs = []
  for (const ch of list) {
    const last = runs[runs.length - 1]
    const same = last && !ch.br && !last.br && ['bold', 'italic', 'code', 'del', 'mark', 'href'].every(key => last[key] === ch[key])
    if (same) last.text += ch.text
    else runs.push({ ...ch })
  }
  return runs
}

const SOFT_BREAK = /[，。！？；：、,.!?;:)）」』》”’\s]/u

/** 在第 k 个字附近找一个好断点：优先标点后，其次空白后，找不到就硬断。 */
function snap(list, k) {
  for (let i = k; i > Math.max(0, k - 16); i -= 1) if (SOFT_BREAK.test(list[i - 1].text)) return i
  return k
}

function trimEdge(list) {
  let start = 0
  let end = list.length
  while (start < end && (list[start].br || !list[start].text.trim())) start += 1
  while (end > start && (list[end - 1].br || !list[end - 1].text.trim())) end -= 1
  return list.slice(start, end)
}

/** 二分找最多能放下几个单位（至少 1 个）；1 个都放不下返回 0。 */
function maxFit(total, test) {
  if (total < 1 || !test(1)) return 0
  let lo = 1
  let hi = total
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (test(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

function splitRuns(runs, test) {
  const list = chars(runs)
  const k = maxFit(list.length - 1, n => test(joinChars(trimEdge(list.slice(0, n)))))
  if (!k) return null
  const at = snap(list, k)
  const head = trimEdge(list.slice(0, at))
  const tail = trimEdge(list.slice(at))
  return head.length && tail.length ? [joinChars(head), joinChars(tail)] : null
}

/** 段落按字数比例估一下拆开后的后半从第几行开始。 */
function splitLine(block, headRuns) {
  if (!Number.isInteger(block.line) || !Number.isInteger(block.end) || block.end <= block.line) return block.line
  const total = block.runs.reduce((sum, run) => sum + run.text.length, 0) || 1
  const head = headRuns.reduce((sum, run) => sum + run.text.length, 0)
  return Math.min(block.end, block.line + Math.floor(((block.end - block.line + 1) * head) / total))
}

/** 把一个放不下的块拆成「这页放得下的前半」和「剩下的」。拆不了返回 null。两半都带上大致的原文行号。 */
function splitBlock(block, test) {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
    case 'callout': {
      const parts = splitRuns(block.runs, runs => test({ ...block, runs }))
      if (!parts) return null
      const at = splitLine(block, parts[0])
      return [{ ...block, runs: parts[0], end: at }, { ...block, ...(block.type === 'callout' ? { title: [] } : {}), runs: parts[1], line: at }]
    }
    case 'list': {
      const m = maxFit(block.items.length - 1, n => test({ ...block, items: block.items.slice(0, n) }))
      // 编号只数最外层
      const top = items => items.filter(item => !item.depth && !item.cont).length
      if (m) return [{ ...block, items: block.items.slice(0, m), end: block.items[m].line }, { ...block, items: block.items.slice(m), start: block.start + top(block.items.slice(0, m)), line: block.items[m].line ?? block.line }]
      const [first, ...rest] = block.items
      const parts = splitRuns(first.runs, runs => test({ ...block, items: [{ ...first, runs }] }))
      return parts && [{ ...block, items: [{ ...first, runs: parts[0] }] }, { ...block, items: [{ ...first, runs: parts[1], cont: true, task: null }, ...rest], start: block.start }]
    }
    case 'table': {
      const m = maxFit(block.rows.length - 1, n => test({ ...block, rows: block.rows.slice(0, n) }))
      const at = Number.isInteger(block.line) ? block.line + 2 + m : block.line
      return m ? [{ ...block, rows: block.rows.slice(0, m), end: at - 1 }, { ...block, rows: block.rows.slice(m), line: at }] : null
    }
    case 'code': {
      const lines = block.text.split('\n')
      const m = maxFit(lines.length - 1, n => test({ ...block, text: lines.slice(0, n).join('\n') }))
      const at = Number.isInteger(block.line) ? block.line + 1 + m : block.line
      return m ? [{ ...block, text: lines.slice(0, m).join('\n'), end: at - 1 }, { ...block, text: lines.slice(m).join('\n'), line: at }] : null
    }
    case 'footnotes': {
      const m = maxFit(block.items.length - 1, n => test({ ...block, items: block.items.slice(0, n) }))
      return m ? [{ ...block, items: block.items.slice(0, m) }, { ...block, items: block.items.slice(m), line: block.items[m].line }] : null
    }
    default: return null
  }
}

/**
 * 按真实高度切页：一页放不下就把块拆开接到下一页，保证每张卡都不溢出。
 * 同一节拆出来的后续页重复小标题（同言起的手动分页）；封面拆出来的后续页不带标题。
 * @param {Array<object>} sections - planSections 的结果。
 * @param {(page: object) => boolean} fits - 这一页放不放得下。
 * @returns {Array<object>} 最终的页，带 number / total，以及 line（这一页在原文里从第几行开始）。
 */
export function paginate(sections, fits) {
  const pages = sections.flatMap(section => paginateSection(section, fits))
  return numberPages(pages)
}

/** 给切好的页编上页码。 */
export function numberPages(pages) {
  return pages.map((page, i) => ({ ...page, number: i + 1, total: pages.length }))
}

function blockPlainChars(block) {
  if (!block) return 0
  let total = 0
  if (block.runs) total += plain(block.runs).length
  if (block.title) total += plain(block.title).length
  if (block.items) for (const item of block.items) total += plain(item.runs ?? []).length
  return total
}

/** Keep explicit page breaks; combine sections and flow paragraphs/lists/images across cards to minimize whitespace. */
export function packPages(pages, fits, { includeCover = false } = {}) {
  const packed = []
  for (const rawPage of pages) {
    // 在连续信息流排版（packPages）下，跨页续接绝不凭空重复上一页已经印过的小标题
    const page = rawPage.continued ? { ...rawPage, heading: [] } : rawPage
    const last = packed.at(-1)
    const sameSectionCont = Boolean(last && page.continued && last.section === page.section && !page.hardBreak)
    if (!last || (!includeCover && last.kind === 'cover') || page.hardBreak || (page.continued && !sameSectionCont)) {
      packed.push({ ...page, blocks: [...page.blocks] })
      continue
    }
    const heading = !sameSectionCont && page.heading.length ? [{ type: 'heading', level: 2, runs: page.heading, line: page.line, end: page.line }] : []
    const joined = { ...last, section: page.section, blocks: [...last.blocks, ...heading, ...page.blocks] }
    if (fits(joined)) packed[packed.length - 1] = joined
    else {
      // A whole section may not fit, while its opening paragraphs do.
      // Keep the lead-in paragraph immediately preceding an image attached to that image,
      // and never leave a lone heading at card bottom.
      let count = 0
      const firstImageIdx = page.blocks.findIndex(block => block.type === 'image')
      const maxMovable = firstImageIdx < 0 ? page.blocks.length - 1 : Math.max(0, firstImageIdx - 1)
      for (let n = 1; n <= maxMovable; n++) {
        const blocks = [...last.blocks, ...heading, ...page.blocks.slice(0, n)]
        if (!fits({ ...last, blocks })) break
        const tail = blocks.at(-1)
        if (tail.type !== 'heading') count = n
      }
      if (count) {
        packed[packed.length - 1] = { ...last, section: page.section, blocks: [...last.blocks, ...heading, ...page.blocks.slice(0, count)] }
        packed.push({ ...page, heading: [], blocks: page.blocks.slice(count), line: lineOf(page.blocks.slice(count), page.line), continued: true })
      } else if (firstImageIdx < 0 && page.blocks.length > 0 && page.blocks[0].type !== 'heading') {
        const parts = splitBlock(page.blocks[0], part => fits({ ...last, blocks: [...last.blocks, ...heading, part] }))
        if (parts && blockPlainChars(parts[0]) >= 28) {
          packed[packed.length - 1] = { ...last, section: page.section, blocks: [...last.blocks, ...heading, parts[0]] }
          const rest = [parts[1], ...page.blocks.slice(1)]
          packed.push({ ...page, heading: [], blocks: rest, line: lineOf(rest, page.line), continued: true })
        } else {
          packed.push({ ...page, blocks: [...page.blocks] })
        }
      } else {
        packed.push({ ...page, blocks: [...page.blocks] })
      }
    }
  }
  return numberPages(packed)
}

/** 同一节因 --- 手动换页或内容超长续页时，只在第一节首页印一次小标题，后续卡片不凭空重复幽灵标题。 */
export function dedupeSectionHeadings(sections) {
  const seen = new Set()
  return sections.map((sec) => {
    if (sec.kind === 'cover') {
      seen.add(sec.section)
      return sec
    }
    if (Number.isInteger(sec.section) && seen.has(sec.section)) {
      return sec.heading?.length ? { ...sec, heading: [] } : sec
    }
    if (Number.isInteger(sec.section)) seen.add(sec.section)
    return sec
  })
}

/** 只切一节。界面里按节缓存，改了哪节只重切哪节。 */
export function paginateSection(section, fits, { repeatHeading = true } = {}) {
  const pages = []
  const queue = [...section.blocks]
  let first = true
  do {
    const keepHeading = first || (repeatHeading && section.kind !== 'cover')
    const page = { kind: first ? section.kind : 'content', heading: keepHeading ? section.heading : [], blocks: [], section: section.section, continued: !first, hardBreak: first && Boolean(section.hardBreak), ...(section.intro ? { intro: true } : {}) }
    while (queue.length) {
      const block = queue[0]
      if (fits({ ...page, blocks: [...page.blocks, block] })) {
        page.blocks.push(queue.shift())
        continue
      }
      const parts = splitBlock(block, part => fits({ ...page, blocks: [...page.blocks, part] }))
      if (parts) {
        page.blocks.push(parts[0])
        queue[0] = parts[1]
      } else if (!page.blocks.length) {
        // 空页也放不下（比如一张图）：硬放，靠卡片裁切兜底
        page.blocks.push(queue.shift())
      }
      break
    }
    // 小标题不留在页尾，挪到下一页和正文在一起
    if (queue.length && page.blocks.length > 1 && page.blocks[page.blocks.length - 1].type === 'heading') queue.unshift(page.blocks.pop())
    page.line = first ? section.line : lineOf(page.blocks, section.line)
    pages.push(page)
    first = false
  } while (queue.length)
  return pages
}

/**
 * 原文第 line 行落在哪一页：取起始行不超过它的最后一页。
 * @param {Array<{line: number}>} pages - 切好的页。
 * @returns {number} 页的下标。
 */
export function pageAtLine(pages, line) {
  let best = 0
  for (let i = 0; i < pages.length; i += 1) {
    if (Number.isInteger(pages[i].line) && pages[i].line <= line && pages[i].line >= (pages[best].line ?? -1)) best = i
  }
  return best
}

// ---------- 估算高度（没有 DOM 时用，比如测试） ----------

const HEADER_HEIGHT = { notes: 34, newspaper: 64, quote: 44, terminal: 44, github: 40, 'minimal-cover': 0, signature: 0 }

/** 页眉占的高度（估算；固定版式封面那一页按这个值把页眉框死）。 */
export function headerHeight(ctx) {
  return HEADER_HEIGHT[ctx.template] ?? 56
}

/** 正文区的宽高：卡片减去主题内边距和页眉。 */
export function bodyBox(ctx) {
  return { width: ctx.width - ctx.pad.left - ctx.pad.right, height: ctx.height - ctx.pad.top - ctx.pad.bottom - headerHeight(ctx) }
}

/** 一张图在卡片里的框：默认按原图比例放下（宽不超过正文宽，高不超过上限）；调过大小就按原图比例保持不裁剪。 */
export function imageFrame(block, ctx, cover = false) {
  const state = cleanImageState(ctx.images?.[block.key])
  const box = bodyBox(ctx)
  const maxH = Math.round(ctx.height * (cover ? 0.44 : 0.40))
  const aspect = Number(block.width) > 0 && Number(block.height) > 0 ? block.width / block.height : 4 / 3
  const fitW = Math.min(box.width, maxH * aspect)
  const baseW = Math.round(fitW * 10) / 10
  const baseH = Math.max(IMAGE_LIMITS.min, Math.round((fitW / aspect) * 10) / 10)
  const width = Math.min(box.width, state.w ?? fitW)
  const height = Math.min(box.height - 24, state.h ?? (state.w ? state.w / aspect : fitW / aspect))
  return {
    width: Math.round(width * 10) / 10,
    height: Math.max(IMAGE_LIMITS.min, Math.round(height * 10) / 10),
    baseW,
    baseH,
    aspect,
    state,
  }
}

/** 粗估一页正文的高度，单位 px。宁大勿小。 */
export function estimateHeight(page, ctx) {
  const width = bodyBox(ctx).width
  const lineOf = (count, size, lineHeight = 1.62) => Math.max(1, Math.ceil((count * size) / width)) * size * lineHeight
  const textLength = runs => runs.reduce((sum, run) => sum + Array.from(run.text).length, 0)
  const size = ctx.size
  let height = page.kind === 'cover' ? 0.04 * width + size * 0.7 * 1.6 : 0
  if (plain(page.heading)) height += lineOf(textLength(page.heading), page.kind === 'cover' ? size * 2.5 : 16 * 2, 1.3) + 12
  for (const block of page.blocks) {
    if (block.type === 'paragraph' || block.type === 'quote') height += lineOf(textLength(block.runs), size) + size * 0.8
    else if (block.type === 'heading') height += lineOf(textLength(block.runs), 16 * 1.2, 1.4) + 26
    else if (block.type === 'list') height += block.items.reduce((sum, item) => sum + lineOf(textLength(item.runs) + 2 + (item.depth ?? 0) * 2, size) + size * 0.45, 0) + size * 0.7
    else if (block.type === 'table') height += (block.rows.length + 1) * (size * cleanTableScale(ctx.tables?.[block.key] ?? 1) * 1.6 + 16) + 20
    else if (block.type === 'code') height += block.text.split('\n').length * size * 1.6 + 70
    else if (block.type === 'image') height += imageFrame(block, ctx, page.kind === 'cover').height + 20
    else if (block.type === 'footnotes') height += block.items.reduce((sum, item) => sum + lineOf(textLength(item.runs) + 4, size * 0.82, 1.55) + 6, 0) + 30
  }
  return height
}

/** 估算版的 fits。 */
export function estimateFits(ctx) {
  const available = ctx.height - 10 - 40 - (HEADER_HEIGHT[ctx.template] ?? 54)
  return page => (page.kind === 'cover' && isTemplateCover(ctx.cover) ? !page.blocks.length : estimateHeight(page, ctx) <= available)
}

// ---------- 卡片 HTML ----------

const VERIFIED = 'M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z'

const div = (style, body = '') => `<div style="${style}">${body}</div>`
const span = (style, body = '') => `<span style="${style}">${body}</span>`

/** 作者行：头像、名字、认证标、账号、日期。没填的部分不画。同言起 DefaultTemplate。 */
function userInfo(ctx, { avatar = true, time = true, nameExtra = '', idExtra = '', infoExtra = '', trailing = '' } = {}) {
  const { s, signature: sig } = ctx
  const parts = []
  if (avatar && sig.avatar) {
    parts.push(div(css('width: 42px; height: 42px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; flex: none', s.header.avatar.container), `<img src="${escapeHtml(sig.avatar)}" alt="" style="${css('display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 50%', s.header.avatar.image, 'height: 100%')}">`))
  }
  const meta = []
  if (sig.name) {
    const icon = `<svg viewBox="0 0 22 22" style="${css('display: inline-block; flex: none; width: 18px; height: 18px', s.header.verifiedIcon)}"><path fill-rule="evenodd" d="${VERIFIED}"></path></svg>`
    meta.push(div(css('display: flex; align-items: center; gap: 4px', s.header.nameContainer), div(css('font-size: 16px; font-weight: 600', s.header.userName, nameExtra), escapeHtml(sig.name)) + icon))
  }
  if (sig.id) meta.push(div(css('font-size: 14px', s.header.userId, idExtra), escapeHtml(sig.id)))
  if (meta.length) parts.push(div('display: flex; flex-direction: column; gap: 0;', meta.join('')))
  const right = time && sig.showDate && ctx.date ? div('font-size: 14px;', div(css(s.header.postTime), escapeHtml(ctx.date))) : ''
  if (!parts.length && !right && !trailing) return ''
  return div(css('position: relative; display: flex; justify-content: space-between; align-items: center; line-height: normal; padding: 2px 0 5px 0', infoExtra), div('display: flex; align-items: center; gap: 8px; min-width: 0;', parts.join('')) + right + trailing)
}

function footerTexts(ctx) {
  const { s, signature: sig } = ctx
  const texts = [sig.left, sig.right].filter(Boolean).map(text => div(css('line-height: 1.2', s.footer.text), escapeHtml(text)))
  return texts.join(div(css('line-height: 1.2', s.footer.separator), '|'))
}

function actions(ctx, rows) {
  return rows.map(([icon, label]) => div('display: flex; align-items: center; gap: 4px; font-size: 12px; opacity: 0.72;', span('font-size: 14px; line-height: 1;', icon) + span('', escapeHtml(label)))).join('')
}

const NOTES_ICON = {
  back: '<path d="m15 18-6-6 6-6"></path>',
  more: '<circle cx="12" cy="12" r="10"></circle><path d="M17 12h.01"></path><path d="M12 12h.01"></path><path d="M7 12h.01"></path>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" x2="12" y1="2" y2="15"></line>',
}
const notesIcon = (name, style) => `<svg viewBox="0 0 24 24" fill="none" stroke="rgb(248, 199, 68)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; width: 24px; height: 24px; ${style}">${NOTES_ICON[name]}</svg>`

/** 各骨架的页眉、页脚。返回 { header, headerStyle, footer, footerStyle }，空字符串表示不画。 */
function shell(ctx) {
  const { signature: sig, labels } = ctx
  const L = key => escapeHtml(labels[key])
  switch (ctx.template) {
    case 'notes':
      return {
        header: div('position: relative; height: 30px; padding: 30px 0 0 0; color: #f8c744; font-size: 17px; box-sizing: border-box;', notesIcon('back', 'left: 0; top: 3px;') + div('position: absolute; left: 24px; top: 3px; height: 24px; line-height: 28px; white-space: nowrap;', L('notes')) + notesIcon('share', 'right: 60px; top: 2px;') + notesIcon('more', 'right: 0; top: 3px;')),
        footer: '',
      }
    case 'xhs':
      return { header: userInfo(ctx), footer: actions(ctx, [['♡', labels.like], ['☆', labels.save], ['○', labels.comment]]), footerStyle: 'justify-content: space-around; gap: 0' }
    case 'weibo':
      return { header: userInfo(ctx), footer: actions(ctx, [['↻', labels.repost], ['○', labels.comment], ['♡', labels.thumb]]), footerStyle: 'justify-content: space-around; gap: 0' }
    case 'wechat':
      return {
        header: userInfo(ctx, { time: false, trailing: span('position: absolute; right: 0; top: 50%; transform: translateY(-50%); font-size: 11.5px; line-height: 1.4; padding: 3px 11px; border: 1px solid currentColor; border-radius: 14px; opacity: 0.8; white-space: nowrap;', L('follow')) }),
        footer: span('', L('readMore')) + span('margin-left: 4px;', '›'),
        footerStyle: 'justify-content: flex-start; opacity: 0.7',
      }
    case 'magazine':
      return {
        header: userInfo(ctx, { avatar: false, nameExtra: 'font-size: 19px; letter-spacing: 3px', idExtra: 'letter-spacing: 1.5px; opacity: 0.6', infoExtra: 'align-items: flex-end' }),
        headerStyle: 'padding-bottom: 9px; margin-bottom: 6px; box-shadow: 0 1.5px 0 currentColor',
        footer: footerTexts(ctx),
      }
    case 'newspaper': {
      const meta = [sig.id, sig.showDate ? ctx.date : ''].filter(Boolean).map(text => span('', escapeHtml(text))).join('')
      return {
        header: div('display: flex; flex-direction: column; align-items: center; gap: 3px;', div(css(ctx.s.header.userName, "font-family: Georgia, 'Songti SC', '宋体', serif; font-size: 1.7em; font-weight: 800; letter-spacing: 1.5px; text-align: center"), escapeHtml(sig.name || labels.masthead)) + (meta ? div('display: flex; justify-content: center; gap: 14px; font-size: 11px; opacity: 0.6; letter-spacing: 1px;', meta) : '')),
        headerStyle: 'text-align: center; border-bottom: 3px double currentColor; padding-bottom: 8px',
        footer: sig.name ? span('', `—— ${escapeHtml(sig.name)} ——`) : '',
        footerStyle: 'justify-content: center; font-style: italic; opacity: 0.7',
      }
    }
    case 'quote':
      return {
        header: div('font-family: Georgia, serif; font-size: 3em; line-height: 0.7; opacity: 0.22;', '❝'),
        footer: sig.name ? div('font-size: 13px; opacity: 0.75;', escapeHtml(sig.name)) : '',
        footerStyle: 'justify-content: flex-end',
      }
    case 'terminal': {
      const dots = ['#ff5f56', '#ffbd2e', '#27c93f'].map(c => span(`width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: ${c};`)).join('')
      return {
        header: div('display: flex; align-items: center; gap: 9px; width: 100%;', div('display: flex; gap: 5px;', dots) + div(css(ctx.s.header.userName, `font-family: ${MONO}; font-size: 12px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`), escapeHtml(sig.name || '~/notes'))),
        headerStyle: 'background: rgba(127,127,127,0.14); margin: -4px -6px 10px; padding: 7px 12px; border-radius: 8px 8px 0 0',
        footer: span('opacity: 0.7; white-space: pre;', '$ ') + span('', escapeHtml(sig.left || sig.id)) + span('margin-left: 1px;', '█'),
        footerStyle: `justify-content: flex-start; font-family: ${MONO}`,
      }
    }
    case 'github':
      return {
        header: div('display: flex; align-items: center; justify-content: space-between; width: 100%;', div(css(ctx.s.header.userName, `font-family: ${MONO}; font-size: 14px`), escapeHtml(sig.name || 'notes')) + div('display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.72;', span('width: 10px; height: 10px; border-radius: 50%; background: #f1e05a; display: inline-block;') + span('', '★ Star'))),
        footer: span('white-space: pre;', escapeHtml(sig.id ? `${sig.id}  ·  View on GitHub` : 'View on GitHub')),
        footerStyle: 'justify-content: flex-start; font-size: 11px; opacity: 0.62',
      }
    case 'minimal-cover':
      return { header: '', footer: footerTexts(ctx) }
    case 'signature':
      return { header: '', footer: sig.name ? span('', '—— ') + div('font-size: 13px; opacity: 0.78;', escapeHtml(sig.name)) : '', footerStyle: 'justify-content: flex-end' }
    default:
      return { header: userInfo(ctx), footer: footerTexts(ctx) }
  }
}

// 封面：言起 styles.css 里 .red-cover 的字号梯度，下方可直接排正文段落、列表与配图，不留空封面
const COVER_TITLE = {
  'cover-classic': 'font-size: 2.05em; text-align: center',
  'cover-bold': 'font-size: 2.5em; text-align: left',
  'cover-mag': 'font-size: 2.0em; text-align: left',
  'cover-number': 'font-size: 2.0em; text-align: left',
  'cover-min': 'font-size: 1.85em; text-align: left',
}

function coverKicker(ctx) {
  if (ctx.cover === 'cover-mag') {
    const text = [(ctx.signature.name || 'NOTES').toUpperCase(), ctx.date].filter(Boolean).join(' · ')
    return div('display: block; font-size: 0.7em; letter-spacing: 0.16em; opacity: 0.55; border-bottom: 1.5px solid currentColor; padding-bottom: 6px; margin-bottom: 10px;', escapeHtml(text))
  }
  if (ctx.cover === 'cover-number') return div('display: block; font-size: 2.2em; font-weight: 800; line-height: 1; opacity: 0.85; margin-bottom: 4px;', '01')
  return ''
}

function imageHtml(block, cover, ctx, edge = {}) {
  // 只收已经转成 data URL 的图：导出时卡片里不能有任何外部地址
  if (!IMAGE_SRC.test(String(block.src ?? ''))) return ''
  const { s } = ctx
  const frame = imageFrame(block, ctx, cover)
  const { state } = frame
  const geom = coverImageBox(frame.width, frame.height, frame.aspect)
  // 主题给图片的圆角、阴影、边框加在外框上（同言起 setupImageZoom 把它们挪到 .red-img-frame）
  const look = ['border-radius', 'box-shadow', 'border'].map(prop => cssValue(s.image, prop) && `${prop}: ${cssValue(s.image, prop)}`)
  const keyAttr = ctx.lines && block.key
    ? ` data-img="${escapeHtml(block.key)}" data-aspect="${frame.aspect.toFixed(5)}" data-base-w="${frame.baseW}" data-base-h="${frame.baseH}"`
    : ''
  const lineAttr = ctx.lines && Number.isInteger(block.line) ? ` data-line="${block.line}"` : ''
  const margin = edge.last ? 'margin: 0.42em auto 0' : 'margin: 0.45em auto'
  const frameStyle = css(`position: relative; display: block; overflow: hidden; line-height: 0; box-sizing: border-box; ${margin}`, ...look, `width: ${frame.width}px; max-width: 100%; height: ${frame.height}px`)
  // 使用 coverImageBox 渲染完整未预裁切的位图：四角等比缩放时 100% 完整无裁剪；上下/左右拉缩或缩放后可在框内自由拖动全景平移不露白边
  const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" draggable="false" style="${css(`position: absolute; left: ${geom.left}px; top: ${geom.top}px; width: ${geom.imgW}px; height: ${geom.imgH}px; display: block; max-width: none; max-height: none; margin: 0; border: 0; border-radius: 0; box-shadow: none; user-select: none`, `transform: translate(${state.x}px, ${state.y}px) scale(${state.s}); transform-origin: center center`)}">`
  return `<div${keyAttr}${lineAttr} style="${frameStyle}">${img}</div>`
}

/** 固定版式封面要用的槽位数据。 */
function coverData(page, ctx) {
  const data = ctx.coverData ?? {}
  const image = data.image && IMAGE_SRC.test(String(data.image.src ?? '')) ? data.image : null
  return {
    title: plain(page.heading),
    kicker: String(data.kicker ?? '').trim().slice(0, 30),
    tag: String(data.tag ?? '').trim().slice(0, 16),
    number: String(data.number ?? '').trim().slice(0, 8),
    name: ctx.signature.name,
    date: ctx.signature.showDate ? ctx.date : '',
    headings: ctx.headings,
    image,
  }
}

/** 固定版式封面的版式（预览、导出、封面检查共用同一份）。 */
export function templateCover(page, ctx) {
  return coverLayout(ctx.cover, bodyBox(ctx), coverData(page, ctx), {
    theme: ctx.theme,
    font: ctx.font,
    lines: ctx.lines,
    imageState: image => cleanImageState(ctx.images?.[image.key]),
  })
}

/**
 * 封面检查：新封面用真实版式算，旧的 5 种按标题字号与实际首页正文高度计算。
 * @returns {Array<{id: string, state: string, value: string}>}
 */
export function checkCover(page, ctx) {
  const box = bodyBox(ctx)
  const frame = { cardWidth: ctx.width, cardHeight: ctx.height, offsetX: ctx.pad.left, offsetY: ctx.pad.top + headerHeight(ctx), title: plain(page.heading), article: ctx.article }
  if (isTemplateCover(ctx.cover)) return coverChecks(templateCover(page, ctx), frame)
  const em = { 'cover-classic': 1.85, 'cover-bold': 1.95, 'cover-mag': 1.8, 'cover-number': 1.8, 'cover-min': 1.65 }[ctx.cover] ?? 1.9
  const size = ctx.size * em
  const perLine = Math.max(1, Math.floor(box.width / size))
  const lines = Math.max(1, Math.ceil(Array.from(frame.title).length / perLine))
  const sw = coverLayout('cover-poster', box, { title: frame.title }, { theme: ctx.theme, font: ctx.font }).palette
  const titleBox = { role: 'title', x: 4, y: 4, w: Math.min(box.width - 8, Array.from(frame.title).length * size), h: lines * size * 1.26, size, lines: Array.from({ length: lines }, () => ''), fg: sw.title, bg: sw.bg, fits: true }
  const extraH = page.blocks?.length ? Math.min(Math.max(40, box.height - titleBox.h - 16), estimateHeight({ ...page, kind: 'content', heading: [] }, ctx)) : 0
  const boxes = extraH > 0
    ? [titleBox, { role: 'body', x: 4, y: titleBox.y + titleBox.h + 10, w: Math.max(60, box.width - 8), h: extraH, size: ctx.size, lines: [''], fg: sw.text ?? sw.title, bg: sw.bg, fits: true }]
    : [titleBox]
  return coverChecks({ boxes, image: null }, frame)
}

/**
 * 一页卡片的 HTML：根节点是卡片大小（3:4 是 450×600），样式全部写在元素上。
 * @param {object} page - paginate 的一页。
 * @param {object} ctx - cardContext 的结果。
 * @returns {string} 以 <div> 开头的 HTML，正文那一节带 data-part="body"，量高度时找它。
 */
export function renderCard(page, ctx) {
  const { s } = ctx
  const cover = page.kind === 'cover'
  const fixed = cover && isTemplateCover(ctx.cover)
  const color = /(?:^|;)\s*color:\s*([^;]+)/.exec(s.paragraph)?.[1]?.trim()
  const blockCtx = {
    s,
    font: ctx.font,
    size: ctx.size,
    codeSize: ctx.size,
    links: 'text',
    lines: ctx.lines,
    // 首页正文与普通内容页完全同字号同行高，仅经典居中封面居中对齐
    paragraph: cover && ctx.cover === 'cover-classic' ? 'text-align: center' : '',
    image: (block, edge) => imageHtml(block, cover, ctx, edge),
    tableScale: block => cleanTableScale(ctx.tables?.[block.key] ?? 1),
    // 正文实际可用宽度：表格比它宽时按比例缩字号，不把列压成竖排
    bodyWidth: bodyBox(ctx).width,
  }
  let body
  if (fixed) {
    body = templateCover(page, ctx).html
  } else {
    const hasHeading = page.heading.length > 0
    const heading = hasHeading
      ? headingHtml(2, page.heading, blockCtx, {
        line: page.continued ? undefined : page.line,
        ...(cover
          ? { base: `margin: 0.08em 0 0.38em; line-height: 1.26; letter-spacing: -0.02em; ${COVER_TITLE[ctx.cover]}`, attr: ctx.lines ? ' data-slot="title"' : '' }
          : { base: 'margin-top: 2px' }),
      })
      : ''
    const totalBlocks = page.blocks.length
    const blocksHtml = page.blocks.map((block, idx) => blockHtml(block, blockCtx, {
      first: !hasHeading && idx === 0,
      last: idx === totalBlocks - 1,
    })).join('')
    body = (cover ? coverKicker(ctx) : '') + heading + blocksHtml
  }
  const section = css('display: block; box-sizing: border-box; height: 100%; margin: 0; overflow: hidden', cover && !fixed && `position: relative; padding-top: 2px; font-size: ${ctx.size}px`)
  const { header, headerStyle, footer, footerStyle } = shell(ctx)
  const bg = ctx.background
  const root = css(
    'position: relative; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; margin: 0; padding: 16px; text-align: left; font-weight: 400; font-style: normal; letter-spacing: normal; line-height: 1.5; white-space: normal; word-break: break-word; overflow-wrap: break-word; -webkit-font-smoothing: antialiased',
    `font-family: ${ctx.font}`,
    'font-size: 16px',
    color && `color: ${color}`,
    s.imagePreview,
    `padding-top: 8px; width: ${ctx.width}px; height: ${ctx.height}px; box-sizing: border-box; border-radius: 0`,
    // 背景图（同言起 BackgroundManager）：盖在主题底色上，缩放和位置可调
    bg && `background-image: url(${bg.src}); background-size: ${Math.round(bg.scale * 1000) / 10}%; background-position: ${Math.round(bg.x)}px ${Math.round(bg.y)}px; background-repeat: no-repeat`,
  )
  const lock = fixed ? `height: ${headerHeight(ctx)}px; margin-top: 0; margin-bottom: 0; overflow: hidden` : ''
  const headerHtml = header ? div(css('flex: 0 0 auto; padding-top: 0; padding-bottom: 2px; box-sizing: border-box', headerStyle, lock), header) : fixed && headerHeight(ctx) ? div(`flex: 0 0 auto; height: ${headerHeight(ctx)}px;`) : ''
  const showFooter = footer && ctx.signature.showFooter !== false
  // 主题页脚的 backdrop-filter 去掉：卡片排成一长串时会拖垮绘制，导出成图片也画不出来
  const footerHtml = showFooter ? div(css('box-sizing: border-box; min-height: 24px', s.footer.container, footerStyle, 'backdrop-filter: none; -webkit-backdrop-filter: none'), footer) : ''
  const lineAttr = ctx.lines && Number.isInteger(page.line) ? ` data-line="${page.line}"` : ''
  return `<div${lineAttr} style="${root}">${headerHtml}<div style="flex: 1 1 auto; min-height: 0; overflow: hidden;"><section data-part="body" style="${section}">${body}</section></div>${footerHtml}</div>`
}
