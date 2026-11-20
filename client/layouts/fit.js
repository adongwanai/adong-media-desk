// 封面大字的自动排字：估字宽、均衡断行、按框求最大字号。纯函数，不碰 DOM，测试里可以直接算「会不会溢出」。
// 字宽按常见中文无衬线字体估：汉字和全角标点 1em，拉丁字母、数字约半个字宽，宁大勿小；最后再乘一个安全系数。

// 不能放在行首的标点（放到上一行末尾）
const NO_START = /^[，。！？；：、,.!?;:)）」』》〉”’%…—]/u
// 不能放在行尾的标点（带到下一行开头）
const NO_END = /[（(「『《〈“‘]$/u
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〿\u{20000}-\u{3fffd}]/u
const LATIN_RUN = /^[A-Za-z0-9][A-Za-z0-9'’.\-+#%/&]*/
// 拉丁字符的粗略字宽（em），粗体再放大一点
const NARROW = { i: 0.28, l: 0.28, j: 0.3, f: 0.34, t: 0.36, r: 0.4, I: 0.3, ' ': 0.3, '.': 0.3, ',': 0.3, "'": 0.24, '’': 0.24, '-': 0.4, '/': 0.4, m: 0.86, w: 0.8, M: 0.88, W: 0.98 }

/** 一个字符的估计宽度（em）。 */
export function charWidth(ch, bold = true) {
  if (WIDE.test(ch)) return 1
  const base = NARROW[ch] ?? (/[A-Z]/.test(ch) ? 0.68 : /[0-9]/.test(ch) ? 0.6 : /[a-z]/.test(ch) ? 0.56 : 0.6)
  return bold ? base * 1.06 : base
}

/** 一段文字的估计宽度（em）。 */
export function textWidth(text, bold = true) {
  let width = 0
  for (const ch of String(text ?? '')) width += charWidth(ch, bold)
  return width
}

// 单独成词时不放在行首的虚词（接到上一行末尾）
const PARTICLE = /^[了的吗呢吧啊么着过地得]$/u
const SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null

/** 中文按词切（有 Intl.Segmenter 时），没有就按字切。 */
function pieces(source) {
  if (SEGMENTER) {
    const out = []
    for (const { segment } of SEGMENTER.segment(source)) {
      // 词切出来的英文串里可能夹着空格以外的符号，原样保留
      if (/^\s+$/.test(segment)) out.push(' ')
      else out.push(segment)
    }
    return out
  }
  const out = []
  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    const latin = LATIN_RUN.exec(rest)
    const piece = latin ? latin[0] : String.fromCodePoint(rest.codePointAt(0))
    out.push(/^\s+$/.test(piece) ? ' ' : piece)
    i += piece.length
  }
  return out
}

/**
 * 切成不可再分的小单位：一个词（或一个汉字）、一个英文单词或数字串、一个空格；
 * 标点和虚词粘在相邻的单位上，保证不出现在错误的行首行尾。太长的中文词（超过 4 个字）再拆成单字，免得一行放不下。
 * @returns {string[]} 单位列表。
 */
export function units(text) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  const list = []
  for (const raw of pieces(source)) {
    const parts = /^[\u4e00-\u9fff]{5,}$/u.test(raw) ? Array.from(raw) : [raw]
    for (const piece of parts) {
      const last = list[list.length - 1]
      // 数字和后面的量词（「1 万粉」「3 个月」）不拆开
      const before = last === ' ' ? list[list.length - 2] : last
      const unit = /\d$/.test(before ?? '') && /^[万亿千百个倍年月天次条步篇]/u.test(piece)
      const sticky = piece !== ' ' && (unit || NO_START.test(piece) || PARTICLE.test(piece.replace(/[，。！？；：、,.!?;:]+$/u, '')))
      if (last === ' ' && sticky && list.length >= 2) {
        // 「star 了，」：虚词和标点隔着空格也跟上一个词走
        list.pop()
        list[list.length - 1] += ` ${piece}`
      } else if (last !== undefined && last !== ' ' && piece !== ' ' && (sticky || NO_END.test(last))) list[list.length - 1] = last + piece
      else list.push(piece)
    }
  }
  return list
}

function lineWidth(parts, bold) {
  return textWidth(parts.join('').trim(), bold)
}

/** 按宽度 limit 贪心断行；空格单位不放在行首。 */
function greedy(list, limit, bold) {
  const lines = [[]]
  let width = 0
  for (const unit of list) {
    const w = textWidth(unit, bold)
    const line = lines[lines.length - 1]
    if (line.length && width + w > limit + 1e-6 && unit !== ' ') {
      lines.push([unit])
      width = w
    } else if (!(unit === ' ' && !line.length)) {
      line.push(unit)
      width += w
    }
  }
  return lines.map(line => line.join('').trim()).filter(Boolean)
}

/**
 * 均衡断行：分成不超过 n 行，并让最长的一行尽量短（各行长度接近），再优先在标点后断。
 * @returns {string[]} 各行文字。
 */
export function balance(text, n, bold = true) {
  const list = units(text)
  if (!list.length) return []
  const total = lineWidth(list, bold)
  let lo = Math.max(...list.map(unit => textWidth(unit, bold)))
  let hi = total
  if (n <= 1 || lo >= hi) return [list.join('').trim()]
  for (let k = 0; k < 24; k += 1) {
    const mid = (lo + hi) / 2
    if (greedy(list, mid, bold).length <= n) hi = mid
    else lo = mid
  }
  const lines = greedy(list, hi, bold)
  // 断点挪到附近的标点后面：只在不增加行数、最长行不超过 8% 时挪
  const punct = /[，。！？；：、,.!?;:]$/u
  const better = []
  let rest = list
  for (let row = 0; row < lines.length - 1; row += 1) {
    let taken = 0
    let width = 0
    while (taken < rest.length && width + textWidth(rest[taken], bold) <= hi + 1e-6) { width += textWidth(rest[taken], bold); taken += 1 }
    let cut = taken
    for (let back = taken; back > Math.max(1, taken - 3); back -= 1) {
      if (punct.test(rest[back - 1]) || rest[back - 1] === ' ') { cut = back; break }
    }
    better.push(rest.slice(0, cut).join('').trim())
    rest = rest.slice(cut)
  }
  better.push(rest.join('').trim())
  const ok = better.every(Boolean) && better.length <= n && Math.max(...better.map(line => textWidth(line, bold))) <= hi * 1.08
  return ok ? better : lines
}

/**
 * 在 width × height 的框里给一段文字求最大字号：试 1…maxLines 行，各自均衡断行，取字号最大的那种（字号差不多时取行少的）。
 * @param {string} text - 文字。
 * @param {number} width - 框宽（px）。
 * @param {number} height - 框高（px）。
 * @param {{maxLines?: number, min?: number, max?: number, lineHeight?: number, bold?: boolean, safety?: number}} [options]
 * @returns {{size: number, lines: string[], lineHeight: number, width: number, height: number, fits: boolean}}
 *   width / height 是排出来的文字块实际占的大小（px）；fits 为 false 表示最小字号也放不下。
 */
export function fitText(text, width, height, options = {}) {
  const { maxLines = 3, min = 12, max = 120, lineHeight = 1.18, bold = true, safety = 0.92 } = options
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean || width <= 0 || height <= 0) return { size: 0, lines: [], lineHeight, width: 0, height: 0, fits: true }
  let best = null
  for (let n = 1; n <= Math.max(1, maxLines); n += 1) {
    const lines = balance(clean, n, bold)
    const widest = Math.max(...lines.map(line => textWidth(line, bold)), 0.5)
    const size = Math.floor(Math.min(max, (width * safety) / widest, (height * safety) / (lines.length * lineHeight)) * 2) / 2
    if (!best || size > best.size * 1.04) best = { size, lines }
    if (lines.length < n) break
  }
  const size = Math.max(min, best.size)
  let lines = best.lines
  // 单行的小字槽位（标签、清单行）最小字号也放不下时，截断加省略号，不让字出框
  if (options.ellipsis && lines.length === 1 && textWidth(lines[0], bold) * size > width) {
    const room = width / size - textWidth('…', bold)
    let cut = ''
    for (const ch of lines[0]) {
      if (textWidth(cut + ch, bold) > room) break
      cut += ch
    }
    lines = [`${cut.trimEnd()}…`]
  }
  const used = { width: Math.max(...lines.map(line => textWidth(line, bold))) * size, height: lines.length * lineHeight * size }
  return { size, lines, lineHeight, width: used.width, height: used.height, fits: used.width <= width + 0.5 && used.height <= height + 0.5 }
}
