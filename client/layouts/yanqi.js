// 言起主题的公共部分：查主题、字体、颜色工具，以及正文各种块的 HTML。公众号长文和图文卡片共用，纯函数，不碰 DOM。
// 排版主题来自言起 YANQI（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian），
// 言起基于 Note to RED（Yeban8090，MIT，https://github.com/Yeban8090/note-to-red）。
// 文字一律先转义；style 里的 CSS 只来自打包进来的主题数据和这里的常量，不来自正文。
import { parseInline } from './markdown.js'
import { YANQI_DEFAULTS, YANQI_FONTS, YANQI_GROUPS, YANQI_THEMES } from './yanqi-themes.js'

export { YANQI_FONTS, YANQI_GROUPS, YANQI_THEMES }

export const DEFAULT_THEME = YANQI_DEFAULTS.themeId
export const DEFAULT_FONT = YANQI_DEFAULTS.font
export const DEFAULT_FONT_SIZE = YANQI_DEFAULTS.fontSize
export const FONT_SIZE_RANGE = { min: 12, max: 24, step: 0.5 }

/** 旧版三套主题的 id，继续能用，指到最接近的言起主题。 */
export const THEME_ALIASES = { clean: 'clean-min', tech: 'tech-blue', essay: 'ink-classic', night: 'terminal-dark', journal: 'cream-journal' }

const BY_ID = new Map(YANQI_THEMES.map(theme => [theme.id, theme]))

/** 主题 id → 实际用的 id：别名换成言起 id，不认识的退回默认。 */
export function resolveThemeId(id) {
  const real = THEME_ALIASES[id] ?? id
  return BY_ID.has(real) ? real : DEFAULT_THEME
}

/**
 * 主题 id → 主题。custom 是「我的主题」（已经校验过的自定义主题），同 id 时优先。
 * @param {string} id - 主题 id。
 * @param {Array<object>} [custom] - 自定义主题列表。
 */
export function yanqiTheme(id, custom = []) {
  const mine = Array.isArray(custom) ? custom.find(theme => theme?.id === id && theme.styles) : null
  return mine ?? BY_ID.get(resolveThemeId(id))
}

export function fontFamily(id) {
  return (YANQI_FONTS.find(font => font.id === id) ?? YANQI_FONTS.find(font => font.id === DEFAULT_FONT) ?? YANQI_FONTS[0]).family
}

export function clampFontSize(value, fallback = DEFAULT_FONT_SIZE) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const stepped = Math.round(n / FONT_SIZE_RANGE.step) * FONT_SIZE_RANGE.step
  return Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, stepped))
}

/** 转义文字。属性值只来自主题，不来自正文。 */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

/** 把几段 CSS 接起来，后面的覆盖前面的。 */
export function css(...parts) {
  const text = parts.filter(Boolean).map(part => String(part).trim().replace(/;+$/, '')).filter(Boolean).join('; ')
  return text ? `${text};` : ''
}

/** 一段 CSS 里某个属性最后一次出现的值。 */
export function cssValue(style, prop) {
  let value
  for (const decl of String(style ?? '').split(';')) {
    const at = decl.indexOf(':')
    if (at > 0 && decl.slice(0, at).trim().toLowerCase() === prop) value = decl.slice(at + 1).trim()
  }
  return value
}

const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i

/** 一个 CSS 值里的第一个颜色。 */
export function firstColor(value) {
  return COLOR.exec(String(value ?? ''))?.[0]
}

/** 颜色转 [r, g, b]；几乎透明的颜色当作没有。同言起 ThemeManager.parseCssColor。 */
export function parseColor(color) {
  const input = String(color ?? '').trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(input)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map(i => parseInt(h[i] + h[i], 16))
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(input)
  if (rgb) {
    const parts = rgb[1].split(',').map(part => part.trim())
    if (parts.length >= 4 && Number(parts[3]) < 0.1) return null
    return parts.slice(0, 3).map(part => (part.endsWith('%') ? Math.round(parseFloat(part) * 2.55) : Math.round(parseFloat(part))))
  }
  return null
}

export function luminance(rgb) {
  const [r, g, b] = rgb.map((value) => {
    const c = Math.max(0, Math.min(255, value)) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const hi = Math.max(luminance(a), luminance(b))
  const lo = Math.min(luminance(a), luminance(b))
  return (hi + 0.05) / (lo + 0.05)
}

/** 两个颜色（CSS 颜色字符串）的对比度，WCAG 2 的算法；认不出颜色时返回 0。 */
export function contrastRatio(a, b) {
  const x = parseColor(a)
  const y = parseColor(b)
  return x && y ? contrast(x, y) : 0
}

/** 两个颜色按比例混合，t = 0 是 a，t = 1 是 b。认不出时返回 a。 */
export function mixColor(a, b, t) {
  const x = parseColor(a)
  const y = parseColor(b)
  if (!x || !y) return a
  const hex = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${x.map((v, i) => hex(v + (y[i] - v) * t)).join('')}`
}

/** 放在这个底色上读得清的字色：黑或白里对比度高的那个。 */
export function inkOn(background) {
  const bg = parseColor(background)
  if (!bg) return '#111827'
  return contrast(bg, [255, 255, 255]) >= contrast(bg, [17, 24, 39]) ? '#ffffff' : '#111827'
}

/** 代码块的字色：和底色对比度不够时换成黑或白。同言起 ThemeManager.getReadableCodeColor。 */
export function readableColor(background, current) {
  const bg = parseColor(background)
  const fg = parseColor(current)
  if (!bg) return current || '#111827'
  if (fg && contrast(bg, fg) >= 4.5) return current
  return contrast(bg, [248, 250, 252]) >= contrast(bg, [17, 24, 39]) ? '#f8fafc' : '#111827'
}

function backgroundOf(style) {
  return firstColor(cssValue(style, 'background-color')) ?? firstColor(cssValue(style, 'background'))
}

/** 主题底色那几条声明（底色、底纹、底纹尺寸），长文外层和缩略图用。 */
export function pageBackground(theme) {
  const preview = theme.styles.imagePreview
  return css(
    cssValue(preview, 'background-color') && `background-color: ${cssValue(preview, 'background-color')}`,
    cssValue(preview, 'background-image') && `background-image: ${cssValue(preview, 'background-image')}`,
    cssValue(preview, 'background-size') && `background-size: ${cssValue(preview, 'background-size')}`,
  )
}

/** 主题缩略图要用的几种颜色。 */
export function themeSwatch(theme) {
  const s = theme.styles
  const bg = backgroundOf(s.imagePreview) ?? '#ffffff'
  const title = firstColor(cssValue(s.title.h2.content, 'color')) ?? '#222222'
  const text = firstColor(cssValue(s.paragraph, 'color')) ?? title
  const accent = firstColor(cssValue(s.emphasis.strong, 'color')) ?? title
  const accentBg = firstColor(cssValue(s.emphasis.strong, 'background')) ?? firstColor(cssValue(s.emphasis.strong, 'background-color'))
  const rgb = parseColor(bg)
  return { background: pageBackground(theme), bg, title, text, accent, accentBg: accentBg && parseColor(accentBg) ? accentBg : null, dark: rgb ? luminance(rgb) < 0.2 : false }
}

const MARK = 'background-color: #fff3a0; color: #1f1f1f; padding: 0.05em 0.22em; border-radius: 4px; box-decoration-break: clone; -webkit-box-decoration-break: clone;'

/** 一行 Markdown 的片段；多行之间插一个换行片段。 */
export function linesToRuns(lines) {
  return lines.flatMap((line, i) => [...(i ? [{ text: '\n', br: true }] : []), ...parseInline(line)])
}

/** 字符串的 32 位哈希，同言起 _imgKey / _tableKey 的算法。 */
export function hash32(text) {
  let h = 0
  const s = String(text ?? '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}

/** 表格的记忆键：表格文字压掉空白后取前 200 字，同言起 _tableKey。 */
export function tableKey(head, rows) {
  const text = [head, ...rows].map(row => row.join(' ')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `t${hash32(text)}`
}

/** 图片的记忆键：图片原地址的哈希，同言起 _imgKey。 */
export function imageKey(src) {
  return `i${hash32(src)}`
}

function rawText(text) {
  return String(text ?? '').replace(/[*_`~=[\]()!^]/g, '')
}

/**
 * 解析好的块换成按片段存的块，卡片切页时可以按字拆开。脚注按第一次引用的顺序编号，定义收到最后一个 footnotes 块里。
 * @param {Array<object>} blocks - parseBlocks 的结果。
 * @returns {Array<object>} heading / paragraph / quote 带 runs，list 的每项带 runs，table 的每格是 runs。都保留 line / end。
 */
const CALLOUT_SPEC = {
  note: { label: '说明', color: '#3b82f6' },
  info: { label: '信息', color: '#3b82f6' },
  tip: { label: '技巧', color: '#10b981' },
  success: { label: '结论', color: '#10b981' },
  important: { label: '重点', color: '#8b5cf6' },
  example: { label: '示例', color: '#8b5cf6' },
  warning: { label: '注意', color: '#d97706' },
  question: { label: '思考', color: '#d97706' },
  caution: { label: '警惕', color: '#dc2626' },
}

export function richBlocks(blocks) {
  const pos = block => ({ line: block.line, end: block.end })
  const rich = blocks.map((block) => {
    switch (block.type) {
      case 'heading': return { type: 'heading', level: block.level, runs: parseInline(block.text), ...pos(block) }
      case 'paragraph': return { type: 'paragraph', runs: linesToRuns(block.lines), ...pos(block) }
      case 'quote': {
        if (block.callout) {
          const spec = CALLOUT_SPEC[block.callout.kind] ?? CALLOUT_SPEC.note
          return {
            type: 'callout',
            kind: block.callout.kind,
            title: parseInline(block.callout.title || spec.label),
            runs: linesToRuns(block.lines),
            ...pos(block),
          }
        }
        return block.lines.length ? { type: 'quote', runs: linesToRuns(block.lines), ...pos(block) } : null
      }
      case 'list': return {
        type: 'list',
        ordered: block.ordered,
        start: block.start ?? 1,
        items: block.items.map((item, i) => ({
          runs: parseInline(item),
          task: block.tasks?.[i] ?? null,
          line: block.lines?.[i] ?? block.line,
          ...(block.depths?.[i] ? { depth: block.depths[i], ordered: block.kinds[i] === 'o', start: block.starts[i] } : {}),
        })),
        ...pos(block),
      }
      case 'table': return { type: 'table', head: block.head.map(parseInline), rows: block.rows.map(row => row.map(parseInline)), key: tableKey(block.head.map(rawText), block.rows.map(row => row.map(rawText))), ...pos(block) }
      case 'footdef': return block
      default: return { ...block }
    }
  }).filter(Boolean)
  return numberFootnotes(rich)
}

function eachRuns(block, fn) {
  if (block.title) block.title = fn(block.title)
  if (block.runs) block.runs = fn(block.runs)
  if (block.items) block.items = block.items.map(item => ({ ...item, runs: fn(item.runs) }))
  if (block.head) {
    block.head = block.head.map(fn)
    block.rows = block.rows.map(row => row.map(fn))
  }
  return block
}

const WECHAT_LINK = /^https?:\/\/mp\.weixin\.qq\.com\//i

/**
 * 公众号外链自动沉底转文末脚注：非公众号域名的 http(s) 链接换成上标 [n]，相同地址合并编号，追加到文末参考链接。
 * @param {Array<object>} blocks - richBlocks 的结果。
 * @returns {{blocks: Array<object>, count: number}} 转换后的块与外链个数。
 */
export function extractLinkFootnotes(blocks) {
  const existing = blocks.find(block => block.type === 'footnotes')
  let nextNum = existing ? existing.items.length : 0
  const byUrl = new Map()
  const added = []
  const mark = (runs, line) => runs.map((run) => {
    if (!run.href || !/^https?:\/\//i.test(run.href) || WECHAT_LINK.test(run.href)) return run
    let entry = byUrl.get(run.href)
    if (!entry) {
      nextNum += 1
      entry = { n: nextNum, href: run.href, label: run.text !== run.href ? run.text : '', line }
      byUrl.set(run.href, entry)
      added.push(entry)
    }
    return { text: run.text, linkRef: entry.n }
  })
  const body = blocks
    .filter(block => block.type !== 'footnotes')
    .map(block => eachRuns({ ...block, ...(block.items ? { items: block.items.map(item => ({ ...item })) } : {}) }, runs => mark(runs, block.line)))
  if (!added.length) return { blocks, count: 0 }
  const extraItems = added.map(item => ({
    n: item.n,
    runs: [{ text: item.label ? `${item.label}：${item.href}` : item.href }],
    line: item.line ?? 0,
  }))
  const merged = existing
    ? { ...existing, items: [...existing.items, ...extraItems] }
    : { type: 'footnotes', heading: '参考链接', items: extraItems, line: extraItems[0].line, end: extraItems.at(-1).line }
  return { blocks: [...body, merged], count: added.length }
}

function numberFootnotes(blocks) {
  const defs = new Map(blocks.filter(block => block.type === 'footdef').map(block => [block.id, block]))
  const order = []
  const mark = runs => runs.map((run) => {
    if (!run.fn) return run
    if (!defs.has(run.fn)) return { text: `[^${run.fn}]` }
    if (!order.includes(run.fn)) order.push(run.fn)
    return { text: String(order.indexOf(run.fn) + 1), fn: run.fn }
  })
  const body = blocks.filter(block => block.type !== 'footdef').map(block => eachRuns({ ...block }, mark))
  if (!order.length) return body
  const items = order.map((id, i) => {
    const def = defs.get(id)
    // 脚注里再引用脚注不展开，按原样显示
    return { n: i + 1, runs: parseInline(def.text).map(run => (run.fn ? { text: `[^${run.fn}]` } : run)), line: def.line }
  })
  return [...body, { type: 'footnotes', items, line: items[0].line, end: Math.max(...order.map(id => defs.get(id).end)) }]
}

function inlineCodeStyle(s, size) {
  const color = readableColor(backgroundOf(s.code.inline), firstColor(cssValue(s.code.inline, 'color')))
  return css(s.code.inline, `font-size: ${size}px`, color && `color: ${color}`)
}

/** 片段 → HTML。links 为 'url' 时在链接文字后写出地址（公众号正文里外链点不开）。 */
export function runsHtml(runs, ctx) {
  const { s } = ctx
  return runs.map((run) => {
    if (run.br) return '<br>'
    const body = escapeHtml(run.text)
    if (run.fn) return `<sup style="${css('font-size: 0.75em; line-height: 0; vertical-align: super; margin: 0 1px', s.footnote?.ref, 'font-size: 0.75em')}">[${body}]</sup>`
    if (run.linkRef) return `<span style="${css(s.link)}">${body}</span><sup style="${css('font-size: 0.75em; line-height: 0; vertical-align: super; margin: 0 1px', s.footnote?.ref, 'font-size: 0.75em')}">[${run.linkRef}]</sup>`
    if (run.code) return `<code style="${inlineCodeStyle(s, ctx.codeSize)}">${body}</code>`
    if (run.bold) return `<strong style="${css(s.emphasis.strong, /background/.test(s.emphasis.strong ?? '') && !ctx.inHeadingBg && 'box-decoration-break: clone; -webkit-box-decoration-break: clone', ctx.inHeadingBg && 'background: transparent; padding: 0')}">${body}</strong>`
    if (run.italic) return `<em style="${css(s.emphasis.em)}">${body}</em>`
    if (run.del) return `<del style="${css(s.emphasis.del)}">${body}</del>`
    if (run.mark) return `<mark style="${css(s.highlight || MARK)}">${body}</mark>`
    if (run.href) {
      const isRawUrl = /^https?:\/\//i.test(run.text.trim())
      const text = `<span style="${css(s.link, isRawUrl && 'word-break: break-all; font-size: 0.92em')}">${body}</span>`
      const showHref = ctx.links === 'url' && run.text.trim() !== run.href.trim()
      return showHref ? `${text}<span style="${css('color: #8a8f98; font-size: 0.85em; word-break: break-all')}">（${escapeHtml(run.href)}）</span>` : text
    }
    return body
  }).join('')
}

/** 标题：外层 base，里面一层 content，主题有装饰时再加一层 after。同言起 applyTheme。 */
export function headingHtml(level, runs, ctx, extra = {}) {
  const key = level === 2 || level === 1 ? 'h2' : level === 3 ? 'h3' : 'base'
  const title = ctx.s.title[key]
  const tag = `h${Math.min(6, Math.max(1, level))}`
  const after = title.after ? `<span style="${css(title.after)}"></span>` : ''
  const inHeadingBg = /background(?:-color)?\s*:(?!\s*(?:none|transparent))/i.test(`${title.content ?? ''};${extra.content ?? ''}`)
  // extra.attr：预览里给封面标题打的标记（data-slot="title"），点它就去改封面标题；导出时不带
  return `<${tag}${lineAttr(ctx, extra.line)}${extra.attr ?? ''} style="${css(title.base, `font-family: ${ctx.font}`, extra.base)}"><span style="${css(title.content, extra.content)}">${runsHtml(runs, inHeadingBg ? { ...ctx, inHeadingBg: true } : ctx)}</span>${after}</${tag}>`
}

/** 预览里给块记上原文行号（data-line），点块时跳回编辑器；复制和导出时不带。 */
export function lineAttr(ctx, line) {
  return ctx.lines && Number.isInteger(line) ? ` data-line="${line}"` : ''
}

const DOTS = ['#ff5f56', '#ffbd2e', '#27c93f']

function codeHtml(block, ctx, at = '') {
  const { s } = ctx
  const color = readableColor(backgroundOf(s.code.block), firstColor(cssValue(s.code.block, 'color')))
  const dots = DOTS.map(c => `<span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: ${c};"></span>`).join('')
  const head = block.lang
    ? `<span style="display: flex; align-items: center; justify-content: space-between; margin: 8px 0 12px 0;"><span style="display: inline-flex; gap: 6px;">${dots}</span><span style="font-size: 11px; opacity: 0.65; letter-spacing: 0.4px; text-transform: lowercase;">${escapeHtml(block.lang)}</span></span>`
    : `<span style="display: flex; gap: 6px; margin: 8px 0 12px 0;">${dots}</span>`
  return `<pre${at} style="${css(s.code.block, `font-size: ${ctx.codeSize}px`, color && `color: ${color}`, 'text-shadow: none')}">${head}<code style="color: inherit; background: transparent; font-family: inherit; font-size: inherit; text-shadow: none;">${escapeHtml(block.text)}</code></pre>`
}

function calloutHtml(block, ctx, at = '') {
  const { s } = ctx
  const spec = CALLOUT_SPEC[block.kind] ?? CALLOUT_SPEC.note
  const pageBg = backgroundOf(s.imagePreview) ?? '#ffffff'
  const rgb = parseColor(pageBg)
  const dark = rgb ? luminance(rgb) < 0.2 : false
  const tint = mixColor(pageBg, spec.color, dark ? 0.2 : 0.08)
  const textColor = firstColor(cssValue(s.paragraph, 'color')) ?? (dark ? '#f3f4f6' : '#1f2937')
  const titleHtml = block.title?.length
    ? `<p style="${css(`margin: 0 0 ${block.runs?.length ? '0.45em' : '0'}`, `font-family: ${ctx.font}`, `font-size: ${ctx.size}px`, 'line-height: 1.5')}"><strong style="${css(`color: ${spec.color}`, 'font-weight: 700')}">${runsHtml(block.title, ctx)}</strong></p>`
    : ''
  const bodyHtml = block.runs?.length
    ? `<p style="${css(`margin: 0`, `font-family: ${ctx.font}`, `font-size: ${Math.max(12, ctx.size - 0.5)}px`, `color: ${textColor}`, 'line-height: 1.7')}">${runsHtml(block.runs, ctx)}</p>`
    : ''
  return `<blockquote${at} style="${css('margin: 1em 0; padding: 12px 16px; border-radius: 8px', `border-left: 4px solid ${spec.color}`, `background-color: ${tint}`, `color: ${textColor}`)}">${titleHtml}${bodyHtml}</blockquote>`
}

const UL_TYPES = ['disc', 'circle', 'square']
const OL_TYPES = ['decimal', 'lower-alpha', 'lower-roman']

/** 列表：按每项的层级拼出嵌套的 ul / ol。跨页接着写的那一项不再画项目符号。 */
function listHtml(block, ctx, edgeTrim = '') {
  const { s } = ctx
  const open = []
  let html = ''
  const openList = (depth, ordered, start) => {
    const tag = ordered ? 'ol' : 'ul'
    const type = (ordered ? OL_TYPES : UL_TYPES)[depth % 3]
    const from = ordered && start !== 1 ? ` start="${Number(start) || 1}"` : ''
    const style = depth ? css(`list-style-type: ${type}`, 'margin: 0.3em 0 0.1em; padding-left: 1.4em') : css(`list-style-type: ${type}`, s.list.container, edgeTrim)
    html += `<${tag}${from} style="${style}">`
    open.push({ depth, tag })
  }
  block.items.forEach((item, i) => {
    const depth = Math.max(0, Math.min(5, item.depth ?? 0))
    const ordered = depth ? Boolean(item.ordered) : block.ordered
    while (open.length && open[open.length - 1].depth > depth) html += `</li></${open.pop().tag}>`
    const top = open[open.length - 1]
    if (top && top.depth === depth && top.tag !== (ordered ? 'ol' : 'ul')) html += `</li></${open.pop().tag}>`
    const current = open[open.length - 1]
    if (!current) {
      // 从嵌套项开始的一页：外层补一个不画符号的空项
      if (depth > 0) {
        openList(0, block.ordered, block.start)
        html += `<li style="${css(s.list.item, 'list-style-type: none')}">`
        for (let d = 1; d < depth; d += 1) { openList(d, false, 1); html += '<li style="list-style-type: none;">' }
      }
      openList(depth, ordered, depth ? item.start ?? 1 : block.start)
    } else if (current.depth < depth) {
      openList(depth, ordered, item.start ?? 1)
    } else if (i > 0) {
      html += '</li>'
    }
    const base = item.task === null || item.task === undefined ? s.list.item : s.list.taskList
    const box = item.task === true ? '☑ ' : item.task === false ? '☐ ' : ''
    html += `<li${lineAttr(ctx, item.line)} style="${css(base, `font-family: ${ctx.font}`, `font-size: ${ctx.size}px`, depth && 'margin-bottom: 0.25em', item.cont && 'list-style-type: none')}">${box}${runsHtml(item.runs, ctx)}`
  })
  while (open.length) html += `</li></${open.pop().tag}>`
  return html
}

/**
 * 表格自然排下来有多宽（估算，单位 px）。列数一多，450px 的卡片会把每列压到比一个字还窄，
 * 中文竖着排、数字从中间断开，所以按每列最长一格给个下限，再由调用方决定缩小字号还是换个版式。
 * 中文和全角标点按 1 个字宽算，ASCII 按 0.56 个字宽算；每格再加左右 padding。
 */
export function tableNaturalWidth(block, size, cellPad = 16) {
  const rows = [block.head, ...block.rows]
  const width = Math.max(block.head.length, ...block.rows.map(row => row.length))
  let total = 0
  for (let i = 0; i < width; i += 1) total += Math.max(1, longestCell(rows, i)) * size + cellPad * 2
  return Math.ceil(total)
}

/** 一列里最长那格的字符宽度（中文 1、ASCII 0.56）。 */
function longestCell(rows, index) {
  const cellChars = runs => Array.from(String((runs ?? []).map(run => run.text ?? '').join(''))).reduce((sum, ch) => sum + (/[\x00-\x7f]/.test(ch) ? 0.56 : 1), 0)
  return rows.reduce((max, row) => Math.max(max, cellChars(row[index])), 0)
}

/** 一格里读者看得到的字（标签用）。 */
function plainRuns(runs) {
  return String((runs ?? []).map(run => run.text ?? '').join('')).replace(/\s+/g, ' ').trim()
}

function tableHtml(block, ctx) {
  const { s } = ctx
  const width = Math.max(block.head.length, ...block.rows.map(row => row.length))
  const all = [block.head, ...block.rows]
  // 整列都空的先去掉：稿子里常有多余的 | | 列，留着只会把每一列都挤窄
  const columns = Array.from({ length: width }, (_, i) => i).filter(i => all.some(row => plainRuns(row[i])))
  if (!columns.length) return ''
  const scale = ctx.tableScale ? ctx.tableScale(block) : 1
  const size = Math.round((ctx.tableSize ?? ctx.size) * scale * 100) / 100
  const body = Number(ctx.bodyWidth)
  const natural = Number.isFinite(body) && body > 0
    ? Math.ceil(columns.reduce((sum, i) => sum + Math.max(1, longestCell(all, i)) * size + 16 * 2, 0))
    : 0
  // 卡片有正文宽度时，表格比正文还宽就按比例缩字号（最小 8px）。卡片 450px 排版、导出放到 1080px，
  // 8px 在导出的图里约等于 19px，还看得清。缩到 8px 仍然放不下（列特别多的表），改成等分列宽、按字折行：
  // 每列窄但不裁切，整张表都在图里，表格太长时跟着分页拆到下一页。
  const shrink = body > 0 && natural > body
  const fit = shrink ? Math.max(8, Math.floor(size * body / natural * 10) / 10) : size
  const fixed = shrink && natural * (fit / size) > body
  const pad = row => columns.map(i => row[i] ?? [])
  const cell = (tag, style) => runs => `<${tag} style="${css('text-align: left', style, 'overflow-wrap: anywhere', `font-family: ${ctx.font}`, `font-size: ${fit}px`)}">${runsHtml(runs, ctx)}</${tag}>`
  const head = pad(block.head).map(cell('th', s.table.header)).join('')
  const rows = block.rows.map(row => `<tr>${pad(row).map(cell('td', s.table.cell)).join('')}</tr>`).join('')
  const keyAttr = ctx.lines && block.key ? ` data-table="${escapeHtml(block.key)}"` : ''
  const table = `<table${keyAttr}${lineAttr(ctx, block.line)} style="${css(s.table.container, fixed && 'table-layout: fixed; width: 100%')}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
  return ctx.links === 'url' ? `<section style="overflow-x: auto;">${table}</section>` : table
}

/** 脚注：一条一行，编号在前，放在全文最后。 */
function footnotesHtml(block, ctx) {
  const { s } = ctx
  const ref = css('font-size: 0.8em; margin-right: 4px', s.footnote?.ref, 'font-size: 0.8em')
  const head = block.heading ? `<p style="${css(s.paragraph, `font-family: ${ctx.font}`, `font-size: ${Math.round(ctx.size * 0.82 * 2) / 2}px`, 'margin: 0 0 0.45em; font-weight: 600; line-height: 1.4')}">${escapeHtml(block.heading)}</p>` : ''
  const rows = block.items.map(item => `<p${lineAttr(ctx, item.line)} style="${css(s.paragraph, `font-family: ${ctx.font}`, `font-size: ${Math.round(ctx.size * 0.82 * 2) / 2}px`, 'margin: 0 0 0.35em; line-height: 1.55; word-break: break-all')}"><span style="${ref}">[${item.n}]</span>${runsHtml(item.runs, ctx)}</p>`).join('')
  return `<section${lineAttr(ctx, block.line)} style="${css('margin: 1.2em 0 0.4em; padding-top: 0.6em; border-top: 1px solid currentColor; opacity: 0.82')}">${head}${rows}</section>`
}

/**
 * 一个块 → HTML。
 * @param {object} block - richBlocks 的一项。
 * @param {object} ctx - { s: 主题样式, font, size, codeSize, links, paragraph?: 额外段落样式, image?: (block) => HTML }。
 */
export function blockHtml(block, ctx, edge = {}) {
  const { s } = ctx
  const at = lineAttr(ctx, block.line)
  const trim = css(edge.first && 'margin-top: 2px', edge.last && 'margin-bottom: 0')
  switch (block.type) {
    case 'heading': return headingHtml(block.level, block.runs, ctx, { line: block.line, base: trim })
    case 'paragraph': return `<p${at} style="${css(s.paragraph, `font-family: ${ctx.font}`, `font-size: ${ctx.size}px`, ctx.paragraph, trim)}">${runsHtml(block.runs, ctx)}</p>`
    case 'quote': return `<blockquote${at} style="${css(s.quote, `font-family: ${ctx.font}`, `font-size: ${ctx.size}px`, trim)}">${runsHtml(block.runs, ctx)}</blockquote>`
    case 'callout': return calloutHtml(block, ctx, at)
    case 'list': return listHtml(block, ctx, trim)
    case 'table': return tableHtml(block, ctx)
    case 'code': return codeHtml(block, ctx, at)
    case 'rule': return `<hr${at} style="${css(s.hr)}">`
    case 'image': return ctx.image ? ctx.image(block, edge) : ''
    case 'footnotes': return footnotesHtml(block, ctx)
    default: return ''
  }
}

/**
 * 计算图片在裁剪框 (frameW × frameH) 内的完整未预裁切几何尺寸（同言起 .red-img-crop 思路并支持双向拉缩）：
 * 避免使用 CSS object-fit: cover 先把超出 img 盒子的像素裁掉导致平移 (translate) 拖出白边。
 * 当框比例与原图一致时 left=0, top=0, imgW=frameW, imgH=frameH（100% 完整无裁剪）；
 * 当用户上下拉缩或左右拉缩改变外框比例时，img 保持原图宽高比完整铺底居中，随时可在框内自由拖动查看任意局部。
 */
export function coverImageBox(frameW, frameH, aspect = 4 / 3) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3
  const fw = Math.max(1, Number(frameW) || 1)
  const fh = Math.max(1, Number(frameH) || 1)
  let imgW = fw
  let imgH = fw / ratio
  if (imgH < fh - 0.01) {
    imgH = fh
    imgW = fh * ratio
  }
  const round2 = v => Math.round(v * 100) / 100
  return {
    imgW: round2(imgW),
    imgH: round2(imgH),
    left: round2((fw - imgW) / 2),
    top: round2((fh - imgH) / 2),
  }
}
