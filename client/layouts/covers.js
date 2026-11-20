// 封面模板：每个模板是一个固定的版式，有清楚的槽位（主标题、引子、标签、编号、可选配图），
// 文字按框自动求字号、均衡断行，所以长标题、短标题、各种卡片比例都不会溢出。
// 版式用绝对定位画在卡片正文区里：同一份几何数据既拼 HTML，也给「封面检查」算字号、对比度、文字面积和边距。
// 配色只取主题的颜色（底色、标题色、正文色、强调色），强调色做色块时上面的字按对比度选黑或白；
// 强调色直接当字色时，必须和底色有足够对比度，不够就换成标题色（浅色强调色用作色块，避免直接作为白底文字）。
import { fitText, textWidth } from './fit.js'
import { contrastRatio, css, escapeHtml, inkOn, mixColor, themeSwatch } from './yanqi.js'

/** 新增的封面模板。name / hint 是中文原文，界面显示时再翻译。 */
export const COVER_TEMPLATES = [
  { id: 'cover-poster', name: '大字报+', hint: '整版大字，标题下压一道强调色', slots: ['title', 'kicker', 'tag', 'number'] },
  { id: 'cover-versus', name: '左右对比', hint: '标题里用 vs / 还是 / | 分开两边', slots: ['title', 'kicker', 'tag'] },
  { id: 'cover-stack', name: '上下对比', hint: '上下两块，适合前后变化', slots: ['title', 'kicker', 'tag'] },
  { id: 'cover-list', name: '清单数字', hint: '大数字 + 小节清单', slots: ['title', 'number', 'tag'] },
  { id: 'cover-question', name: '问句', hint: '大问号压底，标题提问', slots: ['title', 'kicker', 'tag'] },
  { id: 'cover-steps', name: '教程步骤', hint: '小节标题排成步骤', slots: ['title', 'tag'] },
  { id: 'cover-quote', name: '金句引用', hint: '一句话做封面，下面署名', slots: ['title', 'kicker'] },
  { id: 'cover-data', name: '数据冲击', hint: '标题里的数字放到最大', slots: ['title', 'number', 'tag'] },
  { id: 'cover-frame', name: '截图框', hint: '配图放进窗口框，标题在下', slots: ['title', 'tag', 'image'] },
  { id: 'cover-masthead', name: '刊头大图', hint: '刊名 + 期号 + 大图渐隐', slots: ['title', 'kicker', 'number', 'image'] },
  { id: 'cover-sticky', name: '便签', hint: '一张贴着胶带的便签纸', slots: ['title', 'kicker', 'tag'] },
]

export const COVER_TEMPLATE_IDS = new Set(COVER_TEMPLATES.map(row => row.id))

const MARGIN = 12

/** 标题里「A vs B」「A 还是 B」「A | B」这类写法拆成两边；拆不出返回 null。 */
export function splitVersus(title) {
  const parts = String(title ?? '').split(/\s*(?:\s[vV][sS]\.?\s|[vV][sS]\.?(?=[一-鿿])|(?<=[一-鿿])[vV][sS]\.?|还是|对比|｜|\||→|->|⇢)\s*/)
  const clean = parts.map(part => part.trim().replace(/^[，,：:]+|[？?。！!，,]+$/g, '')).filter(Boolean)
  return clean.length >= 2 ? [clean[0], clean.slice(1).join(' ')] : null
}

/** 标题里第一个带单位的数字，比如「5k」「48,000 字」「3 倍」「90%」；没有返回 null。 */
export function findNumber(title) {
  const match = /(\d[\d,.]*\s?(?:%|％|倍|万|亿|[kKwW](?![a-zA-Z])|天|小时|分钟|篇|个|条|步|年|月|字|元|块|次|人|x|X)?)/.exec(String(title ?? ''))
  if (!match) return null
  const value = match[1].trim()
  const rest = String(title).replace(match[0], ' ').replace(/\s+/g, ' ').replace(/^[，,：:、\s]+|[，,：:、\s]+$/g, '').trim()
  return { value, rest }
}

/** 色块：保证黑字或白字放在上面至少 4.5:1，不够就把色块往反方向压一点。 */
export function solidFill(color) {
  let fill = color
  for (let k = 0; k < 14 && contrastRatio(inkOn(fill), fill) < 4.5; k += 1) fill = mixColor(fill, inkOn(fill) === '#ffffff' ? '#000000' : '#ffffff', 0.14)
  return fill
}

/** 放在 bg 上的字色：先用 preferred，对比度不够就往黑或白推，推到 min 为止；都不行用黑或白。 */
export function readableOn(bg, preferred, min = 4.5) {
  if (contrastRatio(preferred, bg) >= min) return preferred
  const target = inkOn(bg) === '#ffffff' ? '#ffffff' : '#000000'
  for (let t = 0.15; t < 1; t += 0.15) {
    const next = mixColor(preferred, target, t)
    if (contrastRatio(next, bg) >= min) return next
  }
  return inkOn(bg)
}

/** 主题里封面要用的几种颜色，并保证字色和底色的对比度。 */
export function coverPalette(theme) {
  const sw = themeSwatch(theme)
  const bg = sw.bg
  const title = readableOn(bg, sw.title, 4.5)
  const text = readableOn(bg, sw.text, 4.5)
  // 强调色当字色时至少 3:1（只用在大字上），否则推深一点
  const accent = sw.accent
  const accentText = readableOn(bg, accent, 3)
  const accentFill = solidFill(accent)
  const onAccent = inkOn(accentFill)
  const tint = mixColor(bg, sw.dark ? '#ffffff' : text, sw.dark ? 0.1 : 0.06)
  return { bg, title, text, accent, accentText, accentFill, onAccent, tint, onTint: readableOn(tint, title, 4.5), dark: sw.dark }
}

function lineHtml(fit) {
  return fit.lines.map(escapeHtml).join('<br>')
}

/**
 * 画一段自动排字的文字，同时记下它的几何信息。
 * @returns {{html: string, box: object}}
 */
function text(model, role, value, box, options = {}) {
  const fit = fitText(value, box.w, box.h, options)
  if (!fit.lines.length) return null
  const align = options.align ?? 'left'
  const valign = options.valign ?? 'top'
  const top = box.y + (valign === 'center' ? (box.h - fit.height) / 2 : valign === 'bottom' ? box.h - fit.height : 0)
  const left = box.x + (align === 'center' ? (box.w - fit.width) / 2 : align === 'right' ? box.w - fit.width : 0)
  const style = css(
    `position: absolute; left: ${round(box.x)}px; top: ${round(top)}px; width: ${round(box.w)}px`,
    `font-family: ${model.font}`, `font-size: ${fit.size}px`, `line-height: ${fit.lineHeight}`,
    `font-weight: ${options.weight ?? 800}`, `color: ${options.color}`, `text-align: ${align}`,
    'white-space: nowrap; overflow: hidden; letter-spacing: 0',
    options.extra,
  )
  model.parts.push(`<div data-slot="${role}" style="${style}">${lineHtml(fit)}</div>`)
  const placed = { role, x: left, y: top, w: fit.width, h: fit.height, size: fit.size, lines: fit.lines, fg: options.color, bg: options.on ?? model.palette.bg, fits: fit.fits, box }
  model.boxes.push(placed)
  return placed
}

function block(model, box, style) {
  model.parts.push(`<div style="${css(`position: absolute; left: ${round(box.x)}px; top: ${round(box.y)}px; width: ${round(box.w)}px; height: ${round(box.h)}px`, style)}"></div>`)
}

function round(n) {
  return Math.round(n * 10) / 10
}

/** 小标签：强调色块 + 黑或白的字，宽度跟着字走。 */
function badge(model, role, value, x, y, h, maxW, align = 'left') {
  if (!value) return null
  const size = Math.round(h * 0.5)
  const width = Math.min(maxW, textWidth(value) * size + h * 0.9)
  const left = align === 'right' ? x - width : x
  block(model, { x: left, y, w: width, h }, `background: ${model.palette.accentFill}; border-radius: ${Math.round(h / 2)}px`)
  return text(model, role, value, { x: left + h * 0.45, y: y + (h - size * 1.2) / 2, w: width - h * 0.9, h: size * 1.2 + 1 }, { maxLines: 1, max: size, min: 9, color: model.palette.onAccent, on: model.palette.accentFill, weight: 700, lineHeight: 1.2, safety: 0.98, ellipsis: true })
}

/** 配图槽：图片铺满槽位（object-fit: cover），可带拖动缩放的记忆和渐隐遮罩。 */
function picture(model, box, { radius = 0, mask = '' } = {}) {
  const image = model.data.image
  if (!image?.src) return false
  const state = model.imageState?.(image) ?? { s: 1, x: 0, y: 0 }
  const keyAttr = model.lines && image.key ? ` data-img="${escapeHtml(image.key)}" data-fixed="1"` : ''
  const img = `<img src="${escapeHtml(image.src)}" alt="" draggable="false" style="${css('display: block; width: 100%; height: 100%; object-fit: cover; max-width: none; max-height: none; margin: 0; border: 0; border-radius: 0; box-shadow: none; user-select: none', `transform: translate(${round(state.x)}px, ${round(state.y)}px) scale(${state.s}); transform-origin: center center`)}">`
  const overlay = mask ? `<div style="${css('position: absolute; inset: 0; pointer-events: none', `background: ${mask}`)}"></div>` : ''
  model.parts.push(`<div${keyAttr} style="${css(`position: absolute; left: ${round(box.x)}px; top: ${round(box.y)}px; width: ${round(box.w)}px; height: ${round(box.h)}px; overflow: hidden; line-height: 0; border-radius: ${radius}px`)}">${img}${overlay}</div>`)
  model.image = { ...box }
  return true
}

const LAYOUTS = {
  'cover-poster'(m, { W, H }) {
    let y = 4
    const kicker = m.data.kicker ? text(m, 'kicker', m.data.kicker, { x: MARGIN, y, w: W, h: H * 0.06 }, { maxLines: 1, max: 15, min: 10, color: m.palette.text, weight: 600, ellipsis: true }) : null
    if (kicker) y = kicker.y + kicker.h + H * 0.05
    const title = text(m, 'title', m.data.title, { x: MARGIN, y, w: W, h: H * 0.66 - y }, { maxLines: 4, max: W * 0.2, min: 18, color: m.palette.title, lineHeight: 1.12 })
    if (title) block(m, { x: MARGIN, y: title.y + title.h + 12, w: Math.max(48, W * 0.24), h: 8 }, `background: ${m.palette.accent}; border-radius: 4px`)
    badge(m, 'tag', m.data.tag, MARGIN, H - 34, 28, W * 0.6)
    if (m.data.number) text(m, 'number', `NO.${m.data.number}`, { x: MARGIN + W * 0.6, y: H - 32, w: W * 0.4, h: 24 }, { maxLines: 1, max: 15, min: 10, color: m.palette.text, weight: 700, align: 'right' })
  },
  'cover-versus'(m, { W, H }) {
    versusLayout(m, W, H, 'row')
  },
  'cover-stack'(m, { W, H }) {
    versusLayout(m, W, H, 'column')
  },
  'cover-list'(m, { W, H }) {
    const rows = m.data.headings.slice(0, 4)
    const number = m.data.number || findNumber(m.data.title)?.value.replace(/[^\d.,]/g, '') || (rows.length ? String(m.data.headings.length) : '')
    let y = 4
    if (number) {
      const big = text(m, 'number', number, { x: MARGIN, y, w: W * 0.5, h: H * 0.3 }, { maxLines: 1, max: H * 0.3, min: 24, color: m.palette.accentText, lineHeight: 1 })
      y = big.y + big.h + H * 0.03
    }
    const titleH = (rows.length ? H * 0.64 : H - 40) - y
    const title = text(m, 'title', m.data.title, { x: MARGIN, y, w: W, h: titleH }, { maxLines: 3, max: W * 0.13, min: 16, color: m.palette.title })
    let top = (title ? title.y + title.h : y) + H * 0.05
    // 放不下就少放几行，每行至少 24px
    const room = H - 44 - top
    const shown = rows.slice(0, Math.max(0, Math.floor(room / 24)))
    const rowH = Math.min(34, room / Math.max(1, shown.length))
    for (const [i, row] of shown.entries()) {
      const chip = rowH * 0.78
      block(m, { x: MARGIN, y: top + (rowH - chip) / 2, w: chip, h: chip }, `background: ${m.palette.accentFill}; border-radius: 6px`)
      text(m, 'index', String(i + 1), { x: MARGIN, y: top + (rowH - chip) / 2 + chip * 0.14, w: chip, h: chip * 0.72 }, { maxLines: 1, max: chip * 0.6, min: 8, color: m.palette.onAccent, on: m.palette.accentFill, align: 'center', lineHeight: 1.1, safety: 0.98 })
      text(m, 'row', row, { x: MARGIN + chip + 10, y: top + (rowH - chip * 0.8) / 2, w: W - chip - 10, h: chip * 0.8 }, { maxLines: 1, max: 15, min: 9, color: m.palette.text, weight: 600, lineHeight: 1.2, ellipsis: true })
      top += rowH
    }
    badge(m, 'tag', m.data.tag, MARGIN + W, H - 30, 26, W * 0.5, 'right')
  },
  'cover-question'(m, { W, H }) {
    text(m, 'glyph', '?', { x: MARGIN + W * 0.42, y: H * 0.18, w: W * 0.58, h: H * 0.8 }, { maxLines: 1, max: H * 0.75, min: 40, color: m.palette.accent, lineHeight: 1, align: 'right', extra: 'opacity: 0.16', decorative: true })
    m.boxes[m.boxes.length - 1].decorative = true
    let y = 4
    const pill = badge(m, 'kicker', m.data.kicker, MARGIN, y, 26, W * 0.7)
    if (pill) y += 26 + H * 0.06
    else y += H * 0.04
    text(m, 'title', m.data.title, { x: MARGIN, y, w: W * 0.92, h: H * 0.62 }, { maxLines: 4, max: W * 0.17, min: 18, color: m.palette.title, lineHeight: 1.16 })
    if (m.data.tag) text(m, 'tag', m.data.tag, { x: MARGIN, y: H - 30, w: W * 0.6, h: 22 }, { maxLines: 1, max: 14, min: 10, color: m.palette.text, weight: 600, ellipsis: true })
  },
  'cover-steps'(m, { W, H }) {
    let y = 4
    badge(m, 'tag', m.data.tag || 'HOW TO', MARGIN, y, 26, W * 0.6)
    y += 26 + H * 0.05
    const steps = m.data.headings.slice(0, 4)
    const title = text(m, 'title', m.data.title, { x: MARGIN, y, w: W, h: (steps.length ? H * 0.5 : H - 20) - y }, { maxLines: 3, max: W * 0.14, min: 16, color: m.palette.title })
    let top = (title ? title.y + title.h : y) + H * 0.06
    const stepH = Math.min(44, (H - 8 - top) / Math.max(1, steps.length))
    if (steps.length > 1 && stepH >= 22) block(m, { x: MARGIN + stepH * 0.3 - 1, y: top + stepH * 0.3, w: 2, h: stepH * (steps.length - 1) }, `background: ${m.palette.accent}; opacity: 0.5`)
    for (const [i, step] of steps.entries()) {
      if (stepH < 22) break
      const dot = stepH * 0.6
      block(m, { x: MARGIN, y: top, w: dot, h: dot }, `background: ${m.palette.accentFill}; border-radius: 50%`)
      text(m, 'index', String(i + 1), { x: MARGIN, y: top + dot * 0.16, w: dot, h: dot * 0.7 }, { maxLines: 1, max: dot * 0.56, min: 8, color: m.palette.onAccent, on: m.palette.accentFill, align: 'center', lineHeight: 1.1, safety: 0.98 })
      text(m, 'row', step, { x: MARGIN + dot + 10, y: top + dot * 0.12, w: W - dot - 10, h: dot * 0.8 }, { maxLines: 1, max: 15, min: 9, color: m.palette.text, weight: 600, lineHeight: 1.2, ellipsis: true })
      top += stepH
    }
  },
  'cover-quote'(m, { W, H }) {
    text(m, 'glyph', '“', { x: MARGIN - 4, y: 0, w: W * 0.4, h: H * 0.24 }, { maxLines: 1, max: H * 0.3, min: 30, color: m.palette.accent, lineHeight: 1, weight: 900, extra: "font-family: Georgia, 'Times New Roman', serif" })
    m.boxes[m.boxes.length - 1].decorative = true
    const quote = text(m, 'title', m.data.title, { x: MARGIN, y: H * 0.22, w: W, h: H * 0.56 }, { maxLines: 5, max: W * 0.12, min: 15, color: m.palette.title, weight: 700, lineHeight: 1.38, valign: 'center' })
    const by = m.data.kicker || m.data.name
    if (by) text(m, 'kicker', `—— ${by}`, { x: MARGIN, y: Math.max(H * 0.8, (quote ? quote.y + quote.h : 0) + 12), w: W, h: 24 }, { maxLines: 1, max: 15, min: 10, color: m.palette.text, weight: 600, align: 'right' })
  },
  'cover-data'(m, { W, H }) {
    const found = findNumber(m.data.title)
    const value = m.data.number || found?.value || ''
    const rest = m.data.number ? m.data.title : found?.rest || m.data.title
    let y = 4
    const kicker = m.data.kicker ? text(m, 'kicker', m.data.kicker, { x: MARGIN, y, w: W, h: 22 }, { maxLines: 1, max: 14, min: 10, color: m.palette.text, weight: 600, ellipsis: true }) : null
    if (kicker) y = kicker.y + kicker.h + 12
    if (value) {
      const big = text(m, 'number', value, { x: MARGIN, y, w: W, h: H * 0.36 }, { maxLines: 1, max: H * 0.34, min: 30, color: m.palette.title, lineHeight: 1 })
      block(m, { x: MARGIN, y: big.y + big.h * 0.62, w: Math.min(W, big.w + 8), h: big.h * 0.3 }, `background: ${m.palette.accent}; opacity: 0.35; border-radius: 3px`)
      // 色块垫在数字后面：把它挪到数字前面画
      m.parts.splice(m.parts.length - 1, 0, m.parts.pop())
      y = big.y + big.h + H * 0.06
    }
    text(m, 'title', rest, { x: MARGIN, y, w: W, h: H - 40 - y }, { maxLines: 3, max: W * 0.12, min: 15, color: m.palette.title, weight: 800 })
    badge(m, 'tag', m.data.tag, MARGIN, H - 30, 26, W * 0.6)
  },
  'cover-frame'(m, { W, H }) {
    const frame = { x: MARGIN, y: 4, w: W, h: H * 0.56 }
    block(m, frame, `background: ${m.palette.tint}; border-radius: 12px; box-shadow: 0 0 0 1px ${mixColor(m.palette.bg, m.palette.text, 0.22)}, 0 10px 24px rgba(0, 0, 0, 0.12)`)
    const bar = 22
    for (const [i, color] of ['#ff5f56', '#ffbd2e', '#27c93f'].entries()) block(m, { x: frame.x + 12 + i * 14, y: frame.y + 7, w: 8, h: 8 }, `background: ${color}; border-radius: 50%`)
    const shot = { x: frame.x + 6, y: frame.y + bar, w: frame.w - 12, h: frame.h - bar - 6 }
    if (!picture(m, shot, { radius: 8 })) {
      const hint = m.data.headings[0] || m.data.kicker
      if (hint) text(m, 'row', hint, { x: shot.x + 16, y: shot.y + 16, w: shot.w - 32, h: shot.h - 32 }, { maxLines: 3, max: 22, min: 10, color: readableOn(m.palette.tint, m.palette.text), weight: 600, valign: 'center', align: 'center', on: m.palette.tint })
    }
    const tag = badge(m, 'tag', m.data.tag, frame.x + 14, frame.y + frame.h - 14, 28, W * 0.6)
    const y = frame.y + frame.h + (tag ? 26 : 16)
    text(m, 'title', m.data.title, { x: MARGIN, y, w: W, h: H - 8 - y }, { maxLines: 3, max: W * 0.12, min: 15, color: m.palette.title })
  },
  'cover-masthead'(m, { W, H }) {
    const name = String(m.data.kicker || m.data.name || 'WEEKLY').toUpperCase()
    const head = text(m, 'kicker', name, { x: MARGIN, y: 0, w: W, h: H * 0.13 }, { maxLines: 1, max: H * 0.13, min: 16, color: m.palette.title, weight: 900, lineHeight: 1.05, extra: "font-family: Georgia, 'Songti SC', serif" })
    const lineY = head.y + head.h + 4
    block(m, { x: MARGIN, y: lineY, w: W, h: 2 }, `background: ${m.palette.title}`)
    const meta = [m.data.number ? `VOL.${m.data.number}` : '', m.data.date].filter(Boolean).join('  ·  ')
    if (meta) text(m, 'meta', meta, { x: MARGIN, y: lineY + 6, w: W, h: 18 }, { maxLines: 1, max: 12, min: 9, color: m.palette.text, weight: 600, lineHeight: 1.3 })
    const top = lineY + 30
    const titleH = H * 0.3
    const area = { x: MARGIN, y: top, w: W, h: H - top - titleH - 4 }
    if (!picture(m, area, { radius: 4, mask: `linear-gradient(to bottom, rgba(0, 0, 0, 0) 55%, ${m.palette.bg} 100%)` })) {
      block(m, area, `background: ${m.palette.accentFill}; border-radius: 4px`)
      if (m.data.number) text(m, 'number', `NO.${m.data.number}`, { x: area.x + 16, y: area.y + 12, w: area.w - 32, h: area.h - 24 }, { maxLines: 1, max: area.h * 0.5, min: 18, color: m.palette.onAccent, on: m.palette.accentFill, valign: 'center', align: 'center', lineHeight: 1 })
    }
    text(m, 'title', m.data.title, { x: MARGIN, y: H - titleH, w: W, h: titleH - 4 }, { maxLines: 3, max: W * 0.12, min: 15, color: m.palette.title, valign: 'bottom' })
  },
  'cover-sticky'(m, { W, H }) {
    let y = 4
    const kicker = m.data.kicker ? text(m, 'kicker', m.data.kicker, { x: MARGIN, y, w: W, h: 22 }, { maxLines: 1, max: 14, min: 10, color: m.palette.text, weight: 600, ellipsis: true }) : null
    y = kicker ? kicker.y + kicker.h + 18 : H * 0.06
    const note = m.palette.dark ? mixColor(m.palette.accent, m.palette.bg, 0.55) : mixColor(m.palette.accent, '#ffffff', 0.8)
    const ink = readableOn(note, m.palette.title, 4.5)
    const box = { x: MARGIN + W * 0.05, y, w: W * 0.9, h: H - 44 - y }
    // 便签整体转一点角度：外框留出转动后多占的宽度
    m.parts.push(`<div style="${css(`position: absolute; left: ${round(box.x)}px; top: ${round(box.y)}px; width: ${round(box.w)}px; height: ${round(box.h)}px; transform: rotate(-1.6deg); transform-origin: center`, `background: ${note}; border-radius: 3px; box-shadow: 0 12px 22px rgba(0, 0, 0, 0.14), 0 1px 0 rgba(0, 0, 0, 0.05)`)}"></div>`)
    block(m, { x: box.x + box.w / 2 - 34, y: box.y - 9, w: 68, h: 20 }, `background: ${mixColor(m.palette.bg, m.palette.text, 0.18)}; opacity: 0.55; transform: rotate(2deg)`)
    text(m, 'title', m.data.title, { x: box.x + 22, y: box.y + 26, w: box.w - 44, h: box.h - 52 }, { maxLines: 5, max: W * 0.13, min: 15, color: ink, on: note, weight: 800, lineHeight: 1.3, valign: 'center', extra: 'transform: rotate(-1.6deg)' })
    badge(m, 'tag', m.data.tag, MARGIN, H - 30, 26, W * 0.6)
  },
}

function versusLayout(m, W, H, direction) {
  const pair = splitVersus(m.data.title) ?? (m.data.headings.length >= 2 ? m.data.headings.slice(0, 2) : null) ?? [m.data.kicker || 'A', m.data.tag || 'B']
  const titleOnly = splitVersus(m.data.title) ? (m.data.kicker || '') : m.data.title
  let y = 4
  if (titleOnly) {
    const title = text(m, 'title', titleOnly, { x: MARGIN, y, w: W, h: H * (direction === 'row' ? 0.24 : 0.2) }, { maxLines: 2, max: W * 0.11, min: 15, color: m.palette.title })
    if (title) y = title.y + title.h + H * 0.05
  }
  const gap = 12
  const area = { x: MARGIN, y, w: W, h: H - 8 - y }
  const boxes = direction === 'row'
    ? [{ x: area.x, y: area.y, w: (area.w - gap) / 2, h: area.h }, { x: area.x + (area.w + gap) / 2, y: area.y, w: (area.w - gap) / 2, h: area.h }]
    : [{ x: area.x, y: area.y, w: area.w, h: (area.h - gap) / 2 }, { x: area.x, y: area.y + (area.h + gap) / 2, w: area.w, h: (area.h - gap) / 2 }]
  const fills = [m.palette.tint, m.palette.accentFill]
  const inks = [m.palette.onTint, m.palette.onAccent]
  boxes.forEach((box, i) => {
    block(m, box, `background: ${fills[i]}; border-radius: 12px`)
    text(m, 'label', i ? 'B' : 'A', { x: box.x + 14, y: box.y + 12, w: 30, h: 18 }, { maxLines: 1, max: 13, min: 9, color: inks[i], on: fills[i], weight: 800, lineHeight: 1.2, safety: 0.98 })
    text(m, 'side', pair[i], { x: box.x + 14, y: box.y + 38, w: box.w - 28, h: box.h - 52 }, { maxLines: 4, max: Math.min(box.w, box.h) * 0.26, min: 12, color: inks[i], on: fills[i], weight: 800, valign: 'center', align: direction === 'row' ? 'left' : 'left' })
  })
  const chip = 40
  const cx = direction === 'row' ? area.x + area.w / 2 : area.x + area.w - chip / 2 - 18
  const cy = direction === 'row' ? area.y + area.h / 2 : area.y + area.h / 2
  block(m, { x: cx - chip / 2, y: cy - chip / 2, w: chip, h: chip }, `background: ${m.palette.bg}; border-radius: 50%; box-shadow: 0 0 0 3px ${m.palette.accent}`)
  text(m, 'vs', 'VS', { x: cx - chip / 2, y: cy - 8, w: chip, h: 16 }, { maxLines: 1, max: 13, min: 9, color: m.palette.title, weight: 900, align: 'center', lineHeight: 1.2, safety: 0.98 })
}

/**
 * 算一个封面模板的版式。
 * @param {string} id - 模板 id。
 * @param {{width: number, height: number}} body - 正文区的宽高（px）。
 * @param {object} data - { title, kicker, tag, number, name, date, headings: string[], image: {src, key, width, height} | null }。
 * @param {object} options - { theme, font, lines: 预览时为 true, imageState: (image) => {s, x, y} }。
 * @returns {{html: string, boxes: Array<object>, image: object|null, palette: object, body: object}}
 */
export function coverLayout(id, body, data, options) {
  const palette = coverPalette(options.theme)
  const model = { parts: [], boxes: [], image: null, palette, font: options.font, data: { headings: [], ...data, title: String(data.title ?? '').trim() || ' ' }, lines: options.lines, imageState: options.imageState }
  const W = body.width - MARGIN * 2
  const H = body.height
  ;(LAYOUTS[id] ?? LAYOUTS['cover-poster'])(model, { W, H })
  const html = `<div data-cover="${escapeHtml(id)}" style="${css(`position: relative; width: ${round(body.width)}px; height: ${round(body.height)}px; overflow: hidden`)}">${model.parts.join('')}</div>`
  return { html, boxes: model.boxes, image: model.image, palette, body }
}

// ---------- 封面检查 ----------

/** 标题的「字数」：汉字算 1，拉丁字母和数字算半个。 */
export function titleLength(title) {
  let n = 0
  for (const ch of String(title ?? '').replace(/\s+/g, '')) n += /[A-Za-z0-9]/.test(ch) ? 0.5 : 1
  return Math.ceil(n)
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * 封面检查：把版式数据换成几条能打勾的规则。阈值和出处见 README「封面检查」一节：
 * 对比度用 WCAG 2.2 SC 1.4.3（正文 4.5:1，大字 3:1）；字号下限按信息流缩略图约 0.17 倍估算（1080 宽对应 70px）；
 * 标题字数、行数、边距、文字面积是小红书运营指南里常见的经验值，只做提醒。
 * @param {object} layout - coverLayout 的结果，或者旧封面的近似版式（boxes 里至少有 title）。
 * @param {{cardWidth: number, cardHeight: number, offsetX: number, offsetY: number, title: string, article?: string}} frame
 * @returns {Array<{id: string, state: 'ok'|'warn'|'bad', value: string}>}
 */
export function coverChecks(layout, frame) {
  const text = layout.boxes.filter(box => !box.decorative)
  const title = text.find(box => box.role === 'title')
  const checks = []
  const length = titleLength(frame.title)
  checks.push({ id: 'length', state: length <= 12 ? 'ok' : length <= 16 ? 'warn' : 'bad', value: String(length) })
  const lines = title?.lines.length ?? 0
  checks.push({ id: 'lines', state: lines && lines <= 2 ? 'ok' : lines === 3 ? 'warn' : 'bad', value: String(lines) })
  const ratio = title ? title.size / frame.cardWidth : 0
  checks.push({ id: 'size', state: ratio >= 0.065 ? 'ok' : ratio >= 0.05 ? 'warn' : 'bad', value: `${Math.round(ratio * 1080)}px` })
  const worst = text.reduce((min, box) => Math.min(min, contrastRatio(box.fg, box.bg) || 21), 21)
  const large = text.every(box => box.size >= 24 || box.role !== 'title')
  checks.push({ id: 'contrast', state: worst >= 4.5 ? 'ok' : worst >= 3 && large ? 'warn' : 'bad', value: `${worst.toFixed(1)}:1` })
  const area = text.reduce((sum, box) => sum + box.w * box.h, 0) / (frame.cardWidth * frame.cardHeight)
  checks.push({ id: 'area', state: area >= 0.08 && area <= 0.7 ? 'ok' : 'warn', value: `${Math.round(area * 100)}%` })
  const edge = text.reduce((min, box) => Math.min(min, box.x + frame.offsetX, frame.cardWidth - (box.x + frame.offsetX + box.w)), Infinity)
  checks.push({ id: 'margin', state: edge / frame.cardWidth >= 0.075 ? 'ok' : 'warn', value: `${Math.round((edge / frame.cardWidth) * 100)}%` })
  const overflow = text.some(box => !box.fits)
  checks.push({ id: 'fit', state: overflow ? 'bad' : 'ok', value: overflow ? '!' : '✓' })
  if (layout.image) {
    const covered = text.reduce((sum, box) => sum + overlap(box, layout.image), 0) / (layout.image.w * layout.image.h)
    checks.push({ id: 'image', state: covered <= 0.15 ? 'ok' : covered <= 0.35 ? 'warn' : 'bad', value: `${Math.round(covered * 100)}%` })
  }
  // 封面上的数字要在正文里找得到（不做标题党）
  const numbers = String(frame.title ?? '').match(/\d[\d,.]*/g) ?? []
  if (numbers.length && frame.article !== undefined) {
    const body = String(frame.article).replace(/,/g, '')
    const missing = numbers.filter(n => !body.includes(n.replace(/,/g, '')))
    checks.push({ id: 'claims', state: missing.length ? 'warn' : 'ok', value: missing.join(' ') || '✓' })
  }
  return checks
}
