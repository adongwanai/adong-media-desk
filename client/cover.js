// 合成视频封面：有画面就叠大字，没有画面就用渐变做一张纯文字封面。
// 另外提供 typeCover：没有封面图的稿子，在浏览器里排一张文字封面（大屏和排期用）。
import { t } from './i18n.js'
import { PLATFORM_ICON } from './platform-icons.js'
import { hash, seeded } from './util.js'

const WIDTH = 1920
const HEIGHT = 1080

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t('封面图读取失败')))
    image.src = src
  })
}

// 中文按字断行，英文按词断行，单词本身太长时再按字母拆开
function wrap(ctx, text, maxWidth, maxLines) {
  const lines = []
  let line = ''
  const tokens = text.match(/[\u0021-\u024f]+\s*|\s+|[^\s]/gu) ?? []
  for (const token of tokens) {
    if (ctx.measureText((line + token).trimEnd()).width <= maxWidth || !line.trim()) {
      line += token
      continue
    }
    lines.push(line.trimEnd())
    line = token.trimStart()
  }
  if (line.trim()) lines.push(line.trimEnd())
  const out = []
  for (const row of lines) {
    if (ctx.measureText(row).width <= maxWidth) {
      out.push(row)
      continue
    }
    let part = ''
    for (const ch of row) {
      if (ctx.measureText(part + ch).width > maxWidth && part) {
        out.push(part)
        part = ch
      } else {
        part += ch
      }
    }
    if (part) out.push(part)
  }
  return out.slice(0, maxLines)
}

function drawBackground(ctx) {
  const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  base.addColorStop(0, '#1a1b3a')
  base.addColorStop(0.55, '#4a2f6b')
  base.addColorStop(1, '#d9745a')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const glow = ctx.createRadialGradient(WIDTH * 0.8, HEIGHT * 0.15, 0, WIDTH * 0.8, HEIGHT * 0.15, WIDTH * 0.6)
  glow.addColorStop(0, 'rgba(255, 196, 150, .55)')
  glow.addColorStop(1, 'rgba(255, 196, 150, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
}

/**
 * @param {{src?: string, text: string}} options - 封面图地址和封面大字。
 * @returns {Promise<HTMLCanvasElement>} 1920×1080 的封面。
 */
export async function composeCover({ src, text }) {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  drawBackground(ctx)
  if (src) {
    const image = await loadImage(src)
    const scale = Math.max(WIDTH / image.width, HEIGHT / image.height)
    ctx.drawImage(image, (WIDTH - image.width * scale) / 2, (HEIGHT - image.height * scale) / 2, image.width * scale, image.height * scale)
    const shade = ctx.createLinearGradient(0, HEIGHT * 0.35, 0, HEIGHT)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)')
    shade.addColorStop(1, 'rgba(0, 0, 0, .72)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
  }
  // 西文字母大约半个汉字宽
  const units = [...text].reduce((n, ch) => n + (/[\u0000-\u024f]/.test(ch) ? 0.55 : 1), 0)
  const size = units > 12 ? 112 : 148
  ctx.font = `700 ${size}px "Songti SC", "STSong", "Noto Serif SC", serif`
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0, 0, 0, .35)'
  ctx.shadowBlur = 24
  const lines = wrap(ctx, text, WIDTH - 200, 3)
  const lineHeight = size * 1.24
  lines.forEach((line, index) => {
    ctx.fillText(line, 100, HEIGHT - 100 - (lines.length - 1 - index) * lineHeight)
  })
  return canvas
}

export async function coverDataUrl(options) {
  const canvas = await composeCover(options)
  return canvas.toDataURL('image/jpeg', 0.9)
}

export async function downloadCover(options, name) {
  const url = await coverDataUrl(options)
  const link = document.createElement('a')
  link.href = url
  link.download = `${String(name).replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 40) || t('视频封面')}.jpg`
  link.click()
}

/* ───────────── 文字封面：没有封面图时排一张 ───────────── */

// 六套配色：底色两端、标题色、次要文字色、点缀色和标题字体气质。按条目 id 固定选一套，同一条每次一样。
const PALETTES = [
  { from: '#16223d', to: '#2a4572', ink: '#f6efdd', soft: 'rgba(246, 239, 221, .62)', accent: '#e9b44c', face: 'serif', motif: 'ring' },
  { from: '#f5efe3', to: '#e7dcc7', ink: '#1f1b16', soft: 'rgba(31, 27, 22, .56)', accent: '#c4432f', face: 'serif', motif: 'rules', light: true },
  { from: '#15342a', to: '#2d5b46', ink: '#eef4e7', soft: 'rgba(238, 244, 231, .62)', accent: '#c8de6c', face: 'sans', motif: 'glyph' },
  { from: '#a4442a', to: '#d9895a', ink: '#fff7ed', soft: 'rgba(255, 247, 237, .74)', accent: '#2b170e', face: 'sans', motif: 'ring' },
  { from: '#e6ecf2', to: '#c8d5e3', ink: '#131f2b', soft: 'rgba(19, 31, 43, .55)', accent: '#2d63d6', face: 'sans', motif: 'rules', light: true },
  { from: '#27182c', to: '#58294d', ink: '#fcebf2', soft: 'rgba(252, 235, 242, .62)', accent: '#ff9f78', face: 'serif', motif: 'glyph' },
]

const FACES = {
  serif: '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", serif',
  sans: '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
}
const WEIGHT = { serif: 900, sans: 700 }
const LATIN = '"Iowan Old Style", "Palatino", Georgia, serif'

// 不能放在行首的标点（跟前一个字走）和不能放在行尾的标点（跟后一个字走）
const CLOSERS = /^[，。、：；！？）」』》】〉…—”’,.!?:;)\]%]+$/u
const OPENERS = /[（「『《【〈“‘(\[]$/u

/** 一套配色。导出给页面用，缩略图没生成出来时用同一套底色兜底。 */
export function paletteOf(id) {
  // 相近的 id（只差最后几位）也要散开，先打散再取余
  return PALETTES[Math.floor(seeded(hash(String(id ?? '')))() * PALETTES.length)]
}

/** 去掉「（图片版）」「（正文版_v2）」这类版本备注，拆出主标题和副标题。 */
export function splitTitle(title) {
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim()
  const note = clean.match(/[（(]([^（）()]*(?:版|v\d)[^（）()]*)[）)]\s*$/u)
  const body = note ? clean.slice(0, note.index).trim() : clean
  const parts = body.split(/\s*(?:——|—|：|:|｜|\|)\s*/u).filter(Boolean)
  if (parts.length > 1 && [...parts[0]].length >= 4) return { head: parts[0], kicker: parts.slice(1).join(' · '), note: note?.[1] ?? '' }
  return { head: body || clean, kicker: '', note: note?.[1] ?? '' }
}

// 浏览器支持时按词切，「豆包」「方向」这种词不会被拆到两行
const words = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null
const CJK = /[\u3400-\u9fff]/u

function rawPieces(text) {
  if (!words) return text.match(/[A-Za-z0-9][A-Za-z0-9.+#%&'’_/-]*\s*|\s+|./gu) ?? []
  const out = []
  for (const { segment } of words.segment(text)) {
    // 太长的中文词再按两个字一段拆开，免得一个词比一行还宽
    if (CJK.test(segment) && [...segment].length > 4) out.push(...(segment.match(/.{1,2}/gu) ?? []))
    else out.push(segment)
  }
  return out
}

/** 断行用的最小单位：一个词（或一个字）、一个英文词或数字；标点粘在该粘的那边，空格跟着前一个词。 */
function tokensOf(text) {
  const out = []
  for (const piece of rawPieces(text)) {
    const prev = out[out.length - 1]
    if (prev !== undefined && (!piece.trim() || CLOSERS.test(piece.trim()) || OPENERS.test(prev))) out[out.length - 1] = prev + piece
    else out.push(piece)
  }
  return out.filter(token => token.trim())
}

/**
 * 把 tokens 分成正好 n 行：每行不超过 maxWidth，各行尽量一样长，优先在标点后断开。
 * 返回 { lines, cost }；分不出来时返回 null。
 */
function partition(tokens, widths, n, maxWidth) {
  const total = widths.reduce((a, b) => a + b, 0)
  const target = total / n
  const count = tokens.length
  const prefix = [0]
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w)
  const best = Array.from({ length: n + 1 }, () => new Array(count + 1).fill(Infinity))
  const from = Array.from({ length: n + 1 }, () => new Array(count + 1).fill(-1))
  best[0][0] = 0
  for (let line = 1; line <= n; line += 1) {
    for (let end = line; end <= count; end += 1) {
      for (let start = line - 1; start < end; start += 1) {
        if (best[line - 1][start] === Infinity) continue
        const width = prefix[end] - prefix[start]
        if (width > maxWidth) continue
        const last = tokens[end - 1]
        // 在标点后断开奖励，单个字孤零零一行罚分
        const nice = end < count && /[，。、：；！？）」』》,.!?:;)…]\s*$/u.test(last) ? -0.12 : 0
        const lonely = end - start === 1 && n > 1 ? 0.35 : 0
        const cost = best[line - 1][start] + ((width - target) / target) ** 2 + nice + lonely
        if (cost < best[line][end]) { best[line][end] = cost; from[line][end] = start }
      }
    }
  }
  if (best[n][count] === Infinity) return null
  const lines = []
  let end = count
  for (let line = n; line > 0; line -= 1) {
    const start = from[line][end]
    lines.unshift(tokens.slice(start, end).join('').trim())
    end = start
  }
  return { lines, cost: best[n][count] }
}

/** 从大字号往小试，找出能放进框里的最大字号和最匀称的断行。放不下就截断加省略号。 */
function fitTitle(ctx, text, { face, maxSize, minSize, maxWidth, maxHeight, minLines, maxLines, leading }) {
  const tokens = tokensOf(text)
  if (!tokens.length) return { size: minSize, lines: [] }
  const lower = Math.min(minLines, tokens.length)
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${WEIGHT[face]} ${size}px ${FACES[face]}`
    // 有英文长词比一行还宽：先缩小字号；缩到最小还放不下才按字母拆开
    const tooWide = tokens.some(token => ctx.measureText(token.trim()).width > maxWidth)
    if (tooWide && size - 2 >= minSize) continue
    const pieces = tokens.flatMap(token => (ctx.measureText(token.trim()).width > maxWidth ? [...token] : [token]))
    const widths = pieces.map(token => ctx.measureText(token).width)
    const fitLines = Math.min(maxLines, Math.floor(maxHeight / (size * leading)))
    let pick = null
    for (let n = lower; n <= Math.min(fitLines, pieces.length); n += 1) {
      const found = partition(pieces, widths, n, maxWidth)
      if (found && (!pick || found.cost < pick.cost - 0.05)) pick = found
    }
    if (pick) return { size, lines: pick.lines }
  }
  // 最小字号也放不下：按行塞满，最后一行截断
  ctx.font = `${WEIGHT[face]} ${minSize}px ${FACES[face]}`
  const lines = []
  let line = ''
  for (const token of tokens.flatMap(piece => (ctx.measureText(piece).width > maxWidth ? [...piece] : [piece]))) {
    if (ctx.measureText((line + token).trim()).width <= maxWidth) { line += token; continue }
    lines.push(line.trim())
    line = token
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && line.trim()) lines.push(line.trim())
  const last = lines.length - 1
  // 按字符（不是 UTF-16 码元）往回删，emoji 不会被切成半个
  while (last >= 0 && [...lines[last]].length > 1 && ctx.measureText(`${lines[last]}…`).width > maxWidth) lines[last] = [...lines[last]].slice(0, -1).join('')
  if (last >= 0) lines[last] = `${lines[last].replace(/[，。、：；\s]+$/u, '')}…`
  return { size: minSize, lines }
}

function paintGround(ctx, w, h, palette, seed) {
  const random = seeded(seed)
  const ground = ctx.createLinearGradient(0, 0, w * (0.4 + random() * 0.4), h)
  ground.addColorStop(0, palette.from)
  ground.addColorStop(1, palette.to)
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, w, h)
  // 一团很淡的光，位置按 id 定
  const gx = w * (0.55 + random() * 0.4)
  const gy = h * (0.05 + random() * 0.3)
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * 0.9)
  glow.addColorStop(0, palette.light ? 'rgba(255, 255, 255, .55)' : 'rgba(255, 255, 255, .13)')
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)
  return random
}

function paintMotif(ctx, w, h, palette, random, glyph) {
  ctx.save()
  if (palette.motif === 'ring') {
    ctx.strokeStyle = palette.accent
    ctx.globalAlpha = 0.28
    ctx.lineWidth = Math.max(1.5, w * 0.006)
    const r = w * (0.36 + random() * 0.12)
    ctx.beginPath()
    ctx.arc(w * 0.92, h * 0.18, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 0.14
    ctx.beginPath()
    ctx.arc(w * 0.92, h * 0.18, r * 0.62, 0, Math.PI * 2)
    ctx.stroke()
  } else if (palette.motif === 'rules') {
    // 稿纸一样的细横线
    ctx.strokeStyle = palette.ink
    ctx.globalAlpha = 0.06
    ctx.lineWidth = Math.max(1, w * 0.002)
    const step = h / 22
    for (let y = step * 3; y < h; y += step) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
  } else if (glyph) {
    // 标题第一个字放大做水印
    ctx.fillStyle = palette.ink
    ctx.globalAlpha = 0.07
    ctx.font = `${WEIGHT[palette.face]} ${w * 0.95}px ${FACES[palette.face]}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(glyph, w * 0.3, h * 0.62)
  }
  ctx.restore()
}

// 一小块随机颗粒，平铺在封面上，让纯色底有一点纸感
let grain = null
function grainPattern(ctx) {
  if (!grain) {
    grain = document.createElement('canvas')
    grain.width = 96
    grain.height = 96
    const g = grain.getContext('2d')
    const data = g.createImageData(96, 96)
    const random = seeded(20261113)
    for (let i = 0; i < data.data.length; i += 4) {
      const v = random() * 255
      data.data[i] = v
      data.data[i + 1] = v
      data.data[i + 2] = v
      data.data[i + 3] = 255
    }
    g.putImageData(data, 0, 0)
  }
  return ctx.createPattern(grain, 'repeat')
}

function paintBadge(ctx, platform, x, y, height, palette) {
  const icon = PLATFORM_ICON[platform]
  ctx.save()
  ctx.font = `600 ${Math.round(height * 0.44)}px ${FACES.sans}`
  const label = t(platform)
  const textW = ctx.measureText(label).width
  const width = height * 0.18 + height * 0.7 + height * 0.26 + textW + height * 0.42
  ctx.fillStyle = palette.light ? 'rgba(0, 0, 0, .07)' : 'rgba(255, 255, 255, .14)'
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, height / 2)
  ctx.fill()
  const mark = height * 0.7
  const mx = x + height * 0.15
  const my = y + (height - mark) / 2
  ctx.fillStyle = icon?.color ?? palette.accent
  ctx.beginPath()
  ctx.arc(mx + mark / 2, my + mark / 2, mark / 2, 0, Math.PI * 2)
  ctx.fill()
  if (icon) {
    ctx.save()
    const scale = (mark * 0.6) / 24
    ctx.translate(mx + mark * 0.2, my + mark * 0.2)
    ctx.scale(scale, scale)
    ctx.fillStyle = '#fff'
    ctx.fill(new Path2D(icon.path))
    ctx.restore()
  }
  ctx.fillStyle = palette.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(label, mx + mark + height * 0.26, y + height / 2 + 1)
  ctx.restore()
}

function fmtCoverDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let out = text
  while ([...out].length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = [...out].slice(0, -1).join('')
  return `${out}…`
}

/** 大封面 600×800：平台、日期、居下的大标题、点缀线和副标题。 */
function paintCard(ctx, { id, title, platform, date }) {
  const W = 600
  const H = 800
  const P = 48
  const palette = paletteOf(id)
  const { head, kicker, note } = splitTitle(title)
  const random = paintGround(ctx, W, H, palette, hash(String(id)))
  paintMotif(ctx, W, H, palette, random, [...head][0])
  ctx.save()
  ctx.globalAlpha = palette.light ? 0.05 : 0.07
  ctx.globalCompositeOperation = palette.light ? 'multiply' : 'overlay'
  ctx.fillStyle = grainPattern(ctx)
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  if (platform) paintBadge(ctx, platform, P, P, 46, palette)
  const day = fmtCoverDate(date)
  if (day) {
    ctx.font = `400 24px ${LATIN}`
    ctx.fillStyle = palette.soft
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(day, W - P, P + 23)
    ctx.textAlign = 'left'
  }

  const sub = kicker || note
  const bottom = H - P - (sub ? 64 : 12)
  const fit = fitTitle(ctx, head, { face: palette.face, maxSize: 96, minSize: 40, maxWidth: W - P * 2, maxHeight: H * 0.56, minLines: 2, maxLines: 4, leading: 1.2 })
  const lineH = fit.size * 1.2
  ctx.font = `${WEIGHT[palette.face]} ${fit.size}px ${FACES[palette.face]}`
  ctx.fillStyle = palette.ink
  ctx.textBaseline = 'alphabetic'
  const firstBase = bottom - (fit.lines.length - 1) * lineH
  fit.lines.forEach((line, index) => ctx.fillText(line, P - fit.size * 0.04, firstBase + index * lineH))
  // 标题上方一道点缀色短线
  ctx.fillStyle = palette.accent
  ctx.fillRect(P, firstBase - fit.size - 30, 64, 6)
  if (sub) {
    ctx.font = `500 23px ${FACES.sans}`
    ctx.fillStyle = palette.soft
    ctx.fillText(ellipsize(ctx, sub, W - P * 2), P, H - P - 6)
  }
}

/** 列表缩略图 112×144：只放主标题，2–3 行。 */
function paintThumb(ctx, { id, title }) {
  const W = 112
  const H = 144
  const P = 11
  const palette = paletteOf(id)
  const { head } = splitTitle(title)
  // 缩略图太小，只放主标题的第一句
  const first = head.split(/[，,。！？!?]/u)[0]
  const core = [...first].length >= 3 ? first : head
  const random = paintGround(ctx, W, H, palette, hash(String(id)))
  paintMotif(ctx, W, H, palette, random, null)
  ctx.fillStyle = palette.accent
  ctx.fillRect(P, P + 2, 16, 3)
  const fit = fitTitle(ctx, core, { face: palette.face, maxSize: 32, minSize: 16, maxWidth: W - P * 2, maxHeight: H - P * 2 - 18, minLines: 2, maxLines: 3, leading: 1.16 })
  const lineH = fit.size * 1.16
  ctx.font = `${WEIGHT[palette.face]} ${fit.size}px ${FACES[palette.face]}`
  ctx.fillStyle = palette.ink
  ctx.textBaseline = 'alphabetic'
  fit.lines.forEach((line, index) => ctx.fillText(line, P - 1, H - P - 2 - (fit.lines.length - 1 - index) * lineH))
}

const SIZES = { card: [600, 800, paintCard, 0.88], thumb: [112, 144, paintThumb, 0.9] }
const cache = new Map()
const CACHE_MAX = 400

/**
 * 没有封面图时在浏览器里排一张文字封面，按 id + 标题 + 平台 + 日期缓存成 data URL。
 * @param {{id: string, title: string, platform?: string, date?: string, size?: 'card'|'thumb'}} spec - 条目信息和尺寸。
 * @returns {string|null} JPEG data URL；浏览器画不了时返回 null，调用方用底色兜底。
 */
export function typeCover({ id, title, platform = '', date = '', size = 'card' }) {
  const key = `${size}|${id}|${title}|${platform}|${size === 'card' ? date : ''}`
  if (cache.has(key)) return cache.get(key)
  const [w, h, paint, quality] = SIZES[size] ?? SIZES.card
  let url = null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) {
      paint(ctx, { id, title, platform, date })
      url = canvas.toDataURL('image/jpeg', quality)
    }
  } catch {
    url = null
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, url)
  return url
}
