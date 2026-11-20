// 口播稿的时长和字幕：全部按语速从字数估算，不对齐真实音频。纯函数，浏览器和测试共用。

export const DEFAULT_RATE = 4.5
export const MIN_RATE = 3
export const MAX_RATE = 6
// 一条字幕最多 16 个汉字宽；西文字母和数字按半个字算
export const CAPTION_WIDTH = 16
// 一句再短也要留出念出来的时间
const MIN_LINE_SECONDS = 0.6
// 一条字幕至少要看得清的时间；不够时从同一句里最长的那条借
const MIN_CUE_SECONDS = 0.4
// 断行时尽量不留在行尾（多半是跟后面的字连在一起的虚词）
const BAD_END = /[的地得着了过和与及或而但就都也还又很更最不没把被让给对向从在是介]$/
// 尽量不放在行首
const BAD_START = /^[的了着过吧吗呢啊呀嘛哦]/

// 汉字、假名、韩文；不含 U+3000–303F 的全角标点
const CJK = /[⺀-⿿぀-ヿ㐀-鿿豈-﫿가-힯]/u
// 西文单词、数字、版本号、网址、缩写都当一个整体：3.5、github.com、Seedance2.5、GPT-4o、1,200、80%
const ATOM = /[A-Za-z0-9][A-Za-z0-9'’_+\-/]*(?:\.[A-Za-z0-9][A-Za-z0-9'’_+\-]*)*(?:,[0-9]{3}(?:\.[0-9]+)?)*%?/y
const WORD = ATOM
// 句中可以断开的标点；断开后句末的这些标点不显示
const SOFT = '，、；：,;:。.'
const HARD = '！？!?'

/** 成稿的口播稿：改写过或改过的优先；脚本体裁的原稿本身就是口播稿；文章体裁还没改写时为空。 */
export function scriptOf(production) {
  if (!production) return ''
  if (typeof production.spoken === 'string' && production.spoken.trim()) return production.spoken
  // Early native sessions saved the same script as { text, updatedAt }.
  if (typeof production.spoken?.text === 'string' && production.spoken.text.trim()) return production.spoken.text
  return production.format === 'article' ? '' : String(production.article ?? '')
}

/** 把语速限制在滑块的范围里，保留一位小数。 */
export function clampRate(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_RATE
  return Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, n)) * 10) / 10
}

/** 去掉 Markdown 记号，剩下要念的那句话。 */
export function cleanLine(line) {
  return String(line ?? '')
    .replace(/^\s*(?:[-*+>]|\d+[.)、])\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
}

/** 小标题、分隔线和只有标点的行不念。 */
export function isSpoken(line) {
  const text = String(line ?? '').trim()
  if (!text || /^#{1,6}\s/.test(text) || /^(-{3,}|\*{3,})$/.test(text)) return false
  return spokenUnits(cleanLine(text)) > 0
}

/**
 * 一行要念的量：一个汉字算 1，一个西文单词或一串数字算 1.5（大约两三个音节），标点和空格不算。
 * @param {string} text - 一行文字。
 * @returns {number} 念的量。
 */
export function spokenUnits(text) {
  const s = String(text ?? '')
  let units = 0
  let i = 0
  while (i < s.length) {
    WORD.lastIndex = i
    const word = WORD.exec(s)
    if (word) {
      units += 1.5
      i += word[0].length
      continue
    }
    const ch = String.fromCodePoint(s.codePointAt(i))
    if (CJK.test(ch)) units += 1
    i += ch.length
  }
  return units
}

/** 一行大约念几秒（不念的行是 0）。 */
export function lineSeconds(line, rate = DEFAULT_RATE) {
  if (!isSpoken(line)) return 0
  return Math.max(MIN_LINE_SECONDS, spokenUnits(cleanLine(line)) / clampRate(rate))
}

/**
 * 把口播稿拆成逐行的时长表。
 * @param {string} text - 口播稿，一句一行。
 * @param {number} rate - 每秒念几个字。
 * @returns {{lines: Array<{index: number, text: string, spoken: boolean, units: number, seconds: number, start: number}>, total: number, spokenCount: number}}
 */
export function scriptTiming(text, rate = DEFAULT_RATE) {
  let start = 0
  let spokenCount = 0
  const lines = String(text ?? '').split('\n').map((raw, index) => {
    const spoken = isSpoken(raw)
    const clean = cleanLine(raw)
    const seconds = spoken ? lineSeconds(raw, rate) : 0
    const row = { index, text: spoken ? clean : raw.trim(), spoken, units: spoken ? spokenUnits(clean) : 0, seconds, start }
    start += seconds
    if (spoken) spokenCount += 1
    return row
  })
  return { lines, total: start, spokenCount }
}

/** 显示宽度：汉字和全角符号算 1，其余算 0.5。 */
export function displayWidth(text) {
  let width = 0
  for (const ch of String(text ?? '')) width += ch.charCodeAt(0) > 0x2e7f || /[‘-‟…]/.test(ch) ? 1 : 0.5
  return width
}

// 把一行拆成 token：西文单词、数字、版本号、网址当一个整体（ATOM 里的小数点不拆），其余一个字符一个 token
function scan(text) {
  const out = []
  const s = String(text ?? '')
  let i = 0
  while (i < s.length) {
    ATOM.lastIndex = i
    const word = ATOM.exec(s)
    if (word) { out.push(word[0]); i += word[0].length; continue }
    const ch = String.fromCodePoint(s.codePointAt(i))
    out.push(ch)
    i += ch.length
  }
  return out
}

const isSoft = ch => ch.length === 1 && SOFT.includes(ch)
const isHard = ch => ch.length === 1 && HARD.includes(ch)

// 字幕里句中的逗号句号换成空格，句末的去掉；问号叹号留着。
// 按 token 走，所以 3.5、github.com 里的小数点和点不会被当成标点换掉。
function captionText(text) {
  const out = scan(text).map(ch => (isSoft(ch) ? ' ' : ch))
  // 句末的软标点连同它前面的空格一起去掉
  while (out.length && (out[out.length - 1] === ' ' || isSoft(out[out.length - 1]))) out.pop()
  return out.join('').replace(/\s+/g, ' ').trim()
}

// 按 token 切开，用来找宽度
function tokens(text) {
  return scan(text).map(ch => ch)
}

const CJK_CHAR = /[⺀-鿿豈-﫿぀-힯]/
const ASCII_CHAR = /[A-Za-z0-9]/
const isCjkChar = ch => CJK_CHAR.test(ch ?? '')

/**
 * 一段太长，切成几条，每条不超过 max。
 * 贪心往后装，装不下时回退到这一行里最后面的一个「像样的断点」——空格，或汉字与西文/数字的交界；
 * 回退得太狠（剩不下半行）才硬切。按 token 走，github.com、3.5、Agent 永远不会被拆开。
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
function hardSplit(text, max) {
  const tokens = scan(text)
  const total = displayWidth(text)
  // 分几条：总宽 / max 向上取整；每条的目标宽度按这个算，最后一条才不会只剩一两个字
  const pieces = Math.max(1, Math.ceil(total / max))
  const target = total / pieces
  const out = []
  let i = 0
  while (i < tokens.length) {
    let end = i
    let width = 0
    while (end < tokens.length) {
      const w = displayWidth(tokens[end])
      // 单个 token 就超宽（一长串没有空格的字母）：独占一行，按字切开
      if (w > max) {
        if (end > i) break
        let piece = ''
        for (const ch of tokens[end]) {
          if (displayWidth(piece + ch) > max) { out.push(piece); piece = '' }
          piece += ch
        }
        if (piece) out.push(piece)
        i = end + 1
        end = -2
        break
      }
      if (width + w > max && end > i) break
      width += w
      end += 1
      // 已经到这一条的目标宽度就停（除非断在空格上，空格留给下一行开头去掉）
      if (width >= target - 0.01 && end < tokens.length && tokens[end] !== ' ') break
    }
    if (end === -2) continue
    const row = tokens.slice(i, end).join('').trim()
    if (row) out.push(row)
    i = end
    while (i < tokens.length && tokens[i] === ' ') i += 1
  }
  return out
}

/**
 * 已经在标点处断开的几条，再调一下相邻的切点：上一行别停在「的、地、了」这类虚词上，
 * 下一行别从「了、吧、吗」开头。只在不超宽、两边都还有余量时挪一个字。
 * @param {string[]} rows - 按标点/宽度分好的字幕。
 * @param {number} max - 每条最大宽度。
 * @returns {string[]}
 */
export function refineBreaks(rows, max = CAPTION_WIDTH) {
  const out = rows.slice()
  const isAscii = ch => /[A-Za-z0-9.%+\-_’',]/.test(ch ?? '')
  const isCjk = ch => /[⺀-鿿豈-﫿぀-힯]/.test(ch ?? '')
  // 只在汉字的位置挪字：挪西文会把 github.com、3.5 这些拆开
  const moveHead = (left, right) => {
    const head = [...right][0] ?? ''
    if (!isCjk(head)) return null
    if (displayWidth(left + head) > max) return null
    return [left + head, [...right].slice(1).join('')]
  }
  const moveTail = (left, right) => {
    const chars = [...left]
    const tail = chars.at(-1) ?? ''
    // 上一行以空格收尾时不挪（会把两行之间的间隔吃掉）
    if (tail === ' ' || !isCjk(tail)) return null
    if (chars.length <= 4) return null
    // 汉字挪到西文前面时补一个空格，别读成「在github」
    const glue = isCjk(tail) && /[A-Za-z0-9]/.test(right[0] ?? '') ? ' ' : ''
    if (displayWidth(tail + glue + right) > max) return null
    return [chars.slice(0, -1).join(''), tail + glue + right]
  }
  // 太短的尾巴（一两个字）并回上一行；并不进去就从上一行挪字过来，直到两条都说得过去
  for (let i = out.length - 1; i > 0; i -= 1) {
    if (displayWidth(out[i]) >= 4 || !out[i - 1]) continue
    if (displayWidth(out[i - 1] + out[i]) <= max) {
      out[i - 1] = out[i - 1] + out[i]
      out.splice(i, 1)
      continue
    }
    for (let k = 0; k < 4 && displayWidth(out[i]) < 4; k += 1) {
      const moved = moveTail(out[i - 1], out[i])
      if (!moved) break
      out[i - 1] = moved[0]
      out[i] = moved[1]
    }
  }
  // 上一行别停在「的、了、在」这类虚词上，下一行别从「了、吧、吗」开头
  for (let i = 0; i + 1 < out.length; i += 1) {
    const left = out[i]
    const right = out[i + 1]
    if (!BAD_END.test(left) && !BAD_START.test(right)) continue
    // 优先把下一行开头那个字挪过来；挪过来会把西文单词拆开时，换成把上一行末尾的字推过去
    const head = moveHead(left, right)
    if (head) { out[i] = head[0]; out[i + 1] = head[1].trimStart(); continue }
    const tail = moveTail(left, right)
    if (tail) { out[i] = tail[0]; out[i + 1] = tail[1] }
  }
  return out.filter(row => (row && spokenUnits(row) > 0) || /[A-Za-z0-9]/.test(row ?? ''))
}

/**
 * 把一句话拆成几条字幕：优先在标点处断，每条不超过 max 个汉字宽。
 * @param {string} line - 一句口播。
 * @param {number} [max] - 每条字幕的最大宽度。
 * @returns {string[]} 字幕文字。
 */
export function splitCaption(line, max = CAPTION_WIDTH) {
  if (!isSpoken(line)) return []
  const text = cleanLine(line)
  // 按 token 分句：标点单独成句，跟着它前面那一句走。
  // 不能按字符切：3.5 的点和 github.com 的点都是 token 的一部分，切开数字就断了。
  const clauses = []
  let buf = ''
  for (const token of scan(text)) {
    buf += token
    if (isSoft(token) || isHard(token)) { clauses.push(buf); buf = '' }
  }
  if (buf) clauses.push(buf)
  const out = []
  let cur = ''
  for (const clause of clauses) {
    const joined = cur + clause
    if (displayWidth(captionText(joined)) <= max) {
      cur = joined
      continue
    }
    if (captionText(cur)) out.push(captionText(cur))
    if (displayWidth(captionText(clause)) <= max) {
      cur = clause
    } else {
      out.push(...hardSplit(captionText(clause), max))
      cur = ''
    }
  }
  if (captionText(cur)) out.push(captionText(cur))
  return refineBreaks(out.filter(Boolean), max)
}

/**
 * 生成字幕条：每句占它估算出来的时长，句内按念的量分给几条字幕。时间单调递增、互不重叠。
 * @param {string} text - 口播稿。
 * @param {{rate?: number, offset?: number, max?: number}} [options] - 语速、整体后移的秒数、每条宽度。
 * @returns {Array<{index: number, start: number, end: number, text: string}>} 时间以秒计，精确到毫秒。
 */
export function buildCues(text, { rate = DEFAULT_RATE, offset = 0, max = CAPTION_WIDTH } = {}) {
  const { lines } = scriptTiming(text, rate)
  const shift = Number.isFinite(offset) && offset > 0 ? offset : 0
  const cues = []
  let group = 0
  for (const line of lines) {
    if (!line.spoken) continue
    const parts = splitCaption(line.text, max)
    if (parts.length) group += 1
    const weights = parts.map(part => Math.max(0.5, spokenUnits(part)))
    const sum = weights.reduce((a, b) => a + b, 0)
    let at = shift + line.start
    parts.forEach((part, i) => {
      const end = shift + line.start + (line.seconds * weights.slice(0, i + 1).reduce((a, b) => a + b, 0)) / sum
      cues.push({ start: at, end, text: part, group })
      at = end
    })
  }
  // 同一句里太短的借一点时间（同一句的时间总长不变），再统一到毫秒、保证至少 1 毫秒、不和上一条重叠
  const lent = lendTime(cues)
  let last = 0
  return lent.map((cue, i) => {
    const start = Math.max(last, Math.round(cue.start * 1000))
    const end = Math.max(start + 1, Math.round(cue.end * 1000))
    last = end
    return { index: i + 1, start: start / 1000, end: end / 1000, text: cue.text }
  })
}

/**
 * 太短的字幕看不清：在同一句里把时间从最长的那条借过来。只在句内借，不改变每句的总时长和句与句的边界。
 * @param {Array<{start: number, end: number, text: string}>} cues
 * @param {{group?: number}} [options] - group 是同一句的几条字幕的分组号，默认按 cue.group 分。
 * @returns {Array<{start: number, end: number, text: string}>} 新的字幕条，时间只动句内边界。
 */
export function lendTime(cues, { min = MIN_CUE_SECONDS } = {}) {
  const out = cues.map(row => ({ ...row }))
  let from = 0
  while (from < out.length) {
    let to = from + 1
    while (to < out.length && out[to].group !== undefined && out[to].group === out[from].group) to += 1
    const group = out.slice(from, to)
    // 一条一条地把最短的那条补到 min，时间从组里最长的那条扣
    for (let pass = 0; pass < group.length * 2; pass += 1) {
      const short = group.filter(row => row.end - row.start < min - 0.001)
      if (!short.length) break
      const target = short[0]
      const donor = group.filter(row => row !== target).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
      if (!donor || donor.end - donor.start <= min) break
      const need = Math.min(min - (target.end - target.start), donor.end - donor.start - min)
      if (need <= 0.001) break
      // 目标在捐赠者前面：把边界往前挪；在后面：往后挪
      if (target.end <= donor.start + 0.001) { target.end += need; donor.start += need }
      else if (target.start >= donor.end - 0.001) { target.start -= need; donor.end -= need }
      else break
    }
    from = to
  }
  return out
}

function clock(seconds, sep) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`
}

export function toSrt(cues) {
  return cues.map((cue, i) => `${i + 1}\n${clock(cue.start, ',')} --> ${clock(cue.end, ',')}\n${cue.text}\n`).join('\n')
}

export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map(cue => `${clock(cue.start, '.')} --> ${clock(cue.end, '.')}\n${cue.text}\n`).join('\n')}`
}

/**
 * 把字幕重排到真实的说话段上（没有提词记录时用）。
 * 思路：把「念的量」当成一条连续的时间，一条一条铺在说话段上；遇到停顿就把停顿挤掉。
 * 这样开头没人说话时不会冒出字幕，停顿期间也不会一直挂着一条字幕。
 * @param {Array<{start: number, end: number, text: string, group?: number}>} cues - 原来的字幕（用到顺序、文字和 group）。
 * @param {Array<[number, number]>} speech - 检测出来的说话段，升序、不重叠。
 * @param {{rate?: number, linger?: number}} [options] - rate 估算语速，linger 是念完后字幕多留多久。
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function retimeCues(cues, speech, { rate = DEFAULT_RATE, linger = 0.35 } = {}) {
  const rows = (Array.isArray(cues) ? cues : []).map(row => ({ ...row }))
  const ranges = (Array.isArray(speech) ? speech : [])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s > 0.05)
    .sort((a, b) => a[0] - b[0])
  if (!rows.length || !ranges.length) return rows
  const total = ranges.reduce((sum, [s, e]) => sum + (e - s), 0)
  if (total <= 0.05) return rows
  // 累计的说话时间（不含停顿）→ 真实时间
  const at = (fraction) => {
    let left = Math.max(0, Math.min(1, fraction)) * total
    for (const [s, e] of ranges) {
      const span = e - s
      if (left <= span) return s + left
      left -= span
    }
    return ranges.at(-1)[1]
  }
  const weights = rows.map(row => Math.max(0.4, spokenUnits(row.text)))
  const sum = weights.reduce((a, b) => a + b, 0)
  const out = []
  let acc = 0
  let last = ranges[0][0]
  rows.forEach((row, i) => {
    const from = acc / sum
    acc += weights[i]
    const to = acc / sum
    const start = Math.max(last, at(from))
    // 念完就收：按偏快的语速估，再多留 linger；这样两条字幕之间停顿的地方是干净的
    const spoken = (weights[i] / Math.max(MIN_RATE, clampRate(rate))) + linger
    const end = Math.max(start + 0.05, Math.min(at(to), start + spoken))
    out.push({ ...row, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 })
    last = out.at(-1).end
  })
  // 别把字幕拖进长停顿里：一条字幕要是跨过一段「说完之后停得比较久」的地方，就收到那句话说完处。
  // 句中短换气（相邻两段之间只隔一点点）不断字幕，读者不会觉得字幕在跳。
  const stopAt = (t) => {
    for (let i = 0; i < ranges.length; i += 1) {
      const [a, b] = ranges[i]
      if (t < a - 0.001 || t >= b) continue
      const nextStart = ranges[i + 1]?.[0] ?? null
      // 后面没有新的一段（说完了），或者中间歇了超过 0.9 秒：字幕收到这里
      if (nextStart === null) return b
      return nextStart - b > 0.9 ? b : null
    }
    return null
  }
  for (const cue of out) {
    const end = stopAt(cue.start)
    if (end !== null && cue.end > end + linger) cue.end = Math.max(cue.start + 0.06, end + linger)
  }
  // 太短的一条从后一条借一点，保证看得清
  for (let i = 0; i + 1 < out.length; i += 1) {
    const cue = out[i]
    const next = out[i + 1]
    const short = MIN_CUE_SECONDS - (cue.end - cue.start)
    if (short <= 0) continue
    const take = Math.min(short, Math.max(0, next.end - next.start - MIN_CUE_SECONDS))
    if (take > 0) { cue.end += take; next.start = cue.end }
  }
  return out
}

/** 纯文字字幕：一条一行，方便贴进剪映之类的「导入文稿」。 */
export function toPlainText(cues) {
  return `${cues.map(cue => cue.text).join('\n')}\n`
}

/** 秒数写成 1:05 或 1:05.3。 */
export function fmtClock(seconds, { tenths = false } = {}) {
  const s = Math.max(0, Number(seconds) || 0)
  const whole = tenths ? Math.floor(s * 10) / 10 : Math.round(s)
  const m = Math.floor(whole / 60)
  const rest = whole - m * 60
  const sec = tenths ? rest.toFixed(1).padStart(4, '0') : String(Math.round(rest)).padStart(2, '0')
  return `${m}:${sec}`
}

/**
 * 用新开头换掉前 count 句要念的话；中间的空行和小标题留在原处。
 * @param {string} text - 口播稿。
 * @param {string[]} opening - 新开头，一句一项。
 * @param {number} count - 换掉前几句。
 * @returns {string} 新口播稿。
 */
export function replaceOpening(text, opening, count) {
  const rows = String(text ?? '').split('\n')
  const spoken = rows.map((row, i) => (isSpoken(row) ? i : -1)).filter(i => i >= 0).slice(0, Math.max(0, count))
  const fresh = opening.map(row => String(row).trim()).filter(Boolean)
  if (!spoken.length) return [...fresh, ...rows].join('\n')
  const drop = new Set(spoken)
  const out = []
  rows.forEach((row, i) => {
    if (i === spoken[0]) out.push(...fresh)
    if (!drop.has(i)) out.push(row)
  })
  return out.join('\n')
}

/**
 * 按每镜口播估算的时长，把总秒数分给各镜（整数，合计正好等于四舍五入后的总时长）。
 * @param {number[]} estimates - 每镜估算秒数。
 * @param {number} total - 要分出去的总秒数。
 * @returns {number[]} 每镜秒数，至少 1 秒。
 */
export function spreadSeconds(estimates, total) {
  const n = estimates.length
  if (!n) return []
  const target = Math.max(n, Math.round(total))
  const weights = estimates.map(v => (Number.isFinite(v) && v > 0 ? v : 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map(w => Math.max(1, (w / sum) * target))
  const out = raw.map(Math.floor)
  let left = target - out.reduce((a, b) => a + b, 0)
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0; k = (k + 1) % n, left -= 1) out[order[k][1]] += 1
  // 都被抬到 1 秒时可能分多了：从最长的那镜往回扣
  while (left < 0) {
    const i = out.indexOf(Math.max(...out))
    out[i] -= 1
    left += 1
  }
  return out
}

/**
 * 用提词记录排字幕：每句从它出现在阅读线上开始、到下一句为止，句内按念的量分给几条字幕。
 * 这是录制时的真实时间（提词跟着人走的时间），比按语速估的准。
 * @param {Array<{t: number, text: string}>} log - 提词记录。
 * @param {number} duration - 录像时长。
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function cuesFromLog(log, duration, max = CAPTION_WIDTH) {
  const rows = (Array.isArray(log) ? log : []).filter(row => Number.isFinite(row?.t) && row.t < duration)
  const cues = []
  rows.forEach((row, i) => {
    const start = Math.max(0, row.t)
    // 到下一句出现为止：提词记录只记「这一句什么时候上场」，不记念到哪个字；
    // 按语速估的「念完」可能比真人慢，掐早了字幕会先于声音消失，所以宁可留到下一句。
    const end = i + 1 < rows.length ? Math.max(start, rows[i + 1].t) : duration
    const parts = splitCaption(row.text, max)
    const weights = parts.map(part => Math.max(0.5, spokenUnits(part)))
    const sum = weights.reduce((a, b) => a + b, 0)
    let at = start
    parts.forEach((part, k) => {
      const next = start + ((end - start) * weights.slice(0, k + 1).reduce((a, b) => a + b, 0)) / sum
      if (next - at > 0.001) cues.push({ start: at, end: next, text: part, group: i + 1 })
      at = next
    })
  })
  return lendTime(cues).map(cue => ({ start: Math.round(cue.start * 1000) / 1000, end: Math.round(cue.end * 1000) / 1000, text: cue.text }))
}
