// 排版用的 Markdown 解析：只拆成块和行内片段，不拼 HTML。公众号和小红书两边共用，纯函数，不碰 DOM。
// 每个块都记下它在原文里的起止行（line / end，从 0 数），左边编辑器和右边预览靠它互相跳转。

const LIST = /^(\s*)([-*+·•]|\d+[.)、])\s+/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/
const FENCE = /^\s*(```|~~~)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
// 单独一行的图片：![说明](地址)，地址后面可以带 "标题"
const IMAGE = /^\s*!\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+["'][^"'\n]*["'])?\s*\)\s*$/
const TASK = /^\[([ xX])\]\s+/
// 脚注定义：[^名字]: 内容
const FOOTDEF = /^\[\^([^\]\s]{1,40})\]:\s?(.*)$/

function startsBlock(line, next) {
  return /^#{1,6}\s/.test(line) || /^\s*>/.test(line) || LIST.test(line) || FENCE.test(line) || RULE.test(line) || IMAGE.test(line) || FOOTDEF.test(line) || (TABLE_ROW.test(line) && TABLE_RULE.test(next ?? ''))
}

function cells(row) {
  return row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
}

/** 缩进宽度：制表符算 4 格。 */
function indentOf(text) {
  let width = 0
  for (const ch of text) width += ch === '\t' ? 4 - (width % 4) : 1
  return width
}

/**
 * 连续的列表行收成一个列表块。缩进更深的行是嵌套项，记下层级；缩进的非列表行接在上一项后面。
 * @returns {{block: object, next: number}} 列表块和下一行的位置。
 */
function readList(lines, i) {
  const first = LIST.exec(lines[i])
  const ordered = /^\d/.test(first[2])
  const start = ordered ? Number(/^\d+/.exec(first[2])[0]) : 1
  const items = []
  // 每层缩进对应的层级，从外到里
  const stack = [indentOf(first[1])]
  while (i < lines.length) {
    const line = lines[i]
    const match = LIST.exec(line)
    if (match) {
      const indent = indentOf(match[1])
      const itemOrdered = /^\d/.test(match[2])
      // 最外层换了列表类型就另起一个列表
      if (indent <= stack[0] && itemOrdered !== ordered) break
      while (stack.length > 1 && indent < stack[stack.length - 1]) stack.pop()
      if (indent > stack[stack.length - 1] + 1 && items.length) stack.push(indent)
      else if (indent < stack[0]) stack[0] = indent
      const depth = Math.min(stack.length - 1, 5)
      items.push({ text: line.replace(LIST, ''), depth, ordered: itemOrdered, start: itemOrdered ? Number(/^\d+/.exec(match[2])[0]) : 1, line: i })
      i += 1
      continue
    }
    // 缩进的续行接到上一项；空行后面紧跟缩进的列表行时不打断列表
    if (line.trim() && /^\s{2,}\S/.test(line) && items.length && !startsBlock(line.trim(), lines[i + 1])) {
      items[items.length - 1].text += ` ${line.trim()}`
      i += 1
      continue
    }
    if (!line.trim() && LIST.test(lines[i + 1] ?? '') && indentOf(LIST.exec(lines[i + 1])[1]) > stack[0]) {
      i += 1
      continue
    }
    break
  }
  const texts = items.map(item => item.text)
  const tasks = texts.map(text => (TASK.test(text) ? /\[[xX]\]/.test(text.slice(0, 3)) : null))
  let end = i - 1
  while (end > items[0].line && !lines[end].trim()) end -= 1
  const block = { type: 'list', ordered, items: texts.map(text => text.replace(TASK, '')), lines: items.map(item => item.line), line: items[0].line, end }
  if (ordered && start !== 1) block.start = start
  if (tasks.some(task => task !== null)) block.tasks = tasks
  if (items.some(item => item.depth > 0)) {
    block.depths = items.map(item => item.depth)
    block.kinds = items.map(item => (item.ordered ? 'o' : 'u'))
    block.starts = items.map(item => item.start)
  }
  return { block, next: i }
}

/**
 * 把 Markdown 拆成块。
 * @param {string} source - Markdown 原文。
 * @returns {Array<object>} 块：heading / paragraph / list / quote / table / code / rule / image / footdef。
 *   每块带 line / end（原文起止行，从 0 数）。列表项是字符串，lines 是每项所在行；
 *   任务列表另有 tasks：[null | true | false]；有嵌套时另有 depths（层级）、kinds（'o' 有序 / 'u' 无序）、starts（起始编号）。
 */
export function parseBlocks(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const at = i
    if (!line.trim()) { i += 1; continue }
    if (FENCE.test(line)) {
      const fence = FENCE.exec(line)[1]
      const body = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(fence)) { body.push(lines[i]); i += 1 }
      blocks.push({ type: 'code', text: body.join('\n'), line: at, end: Math.min(i, lines.length - 1) })
      i += 1
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], line: at, end: at })
      i += 1
      continue
    }
    if (RULE.test(line)) { blocks.push({ type: 'rule', line: at, end: at }); i += 1; continue }
    const image = IMAGE.exec(line)
    if (image) { blocks.push({ type: 'image', alt: image[1].trim(), src: image[2], line: at, end: at }); i += 1; continue }
    const footdef = FOOTDEF.exec(line.trim())
    if (footdef) {
      const text = [footdef[2]]
      i += 1
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) { text.push(lines[i].trim()); i += 1 }
      blocks.push({ type: 'footdef', id: footdef[1], text: text.join(' ').trim(), line: at, end: i - 1 })
      continue
    }
    if (/^\s*>/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i += 1 }
      blocks.push({ type: 'quote', lines: quote.filter(row => row.trim()), line: at, end: i - 1 })
      continue
    }
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) { rows.push(cells(lines[i])); i += 1 }
      blocks.push({ type: 'table', head, rows, line: at, end: i - 1 })
      continue
    }
    if (LIST.test(line)) {
      const { block, next } = readList(lines, i)
      blocks.push(block)
      i = next
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && (!para.length || !startsBlock(lines[i], lines[i + 1]))) { para.push(lines[i].trim()); i += 1 }
    blocks.push({ type: 'paragraph', lines: para, line: at, end: i - 1 })
  }
  return blocks
}

const INLINE = /(`[^`\n]+`)|(\[\^[^\]\s]{1,40}\])|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\*[^*\s][^*\n]*?\*)|(!?\[[^\]\n]*\]\([^)\s]+\))|(~~[^~\n]+?~~)|(==[^=\n]+?==)/g

/**
 * 行内片段：加粗、斜体、删除线、高亮、行内代码、链接、脚注引用，其余是普通文字。只认结构，不做转义。
 * 行内图片只留说明文字。脚注引用的 text 先是名字，整篇编号时再换成数字。
 * @param {string} text - 一行 Markdown。
 * @returns {Array<{text: string, bold?: boolean, italic?: boolean, del?: boolean, mark?: boolean, code?: boolean, href?: string, fn?: string}>} 片段。
 */
export function parseInline(text) {
  const source = String(text ?? '')
  const runs = []
  let last = 0
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) runs.push({ text: source.slice(last, match.index) })
    const [whole, code, foot, bold, italic, link, del, mark] = match
    if (code) runs.push({ text: code.slice(1, -1), code: true })
    else if (foot) runs.push({ text: foot.slice(2, -1), fn: foot.slice(2, -1) })
    else if (bold) runs.push({ text: bold.slice(2, -2), bold: true })
    else if (italic) runs.push({ text: italic.slice(1, -1), italic: true })
    else if (del) runs.push({ text: del.slice(2, -2), del: true })
    else if (mark) runs.push({ text: mark.slice(2, -2), mark: true })
    else if (link.startsWith('!')) runs.push({ text: /^!\[([^\]]*)\]/.exec(link)[1] })
    else {
      const parts = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(link)
      runs.push(parts[1] ? { text: parts[1], href: parts[2] } : { text: parts[2] })
    }
    last = match.index + whole.length
  }
  if (last < source.length) runs.push({ text: source.slice(last) })
  return runs.filter(run => run.text)
}

/** 去掉行内标记，只留文字。 */
export function plainInline(text) {
  return parseInline(text).map(run => run.text).join('')
}

/** 成稿正文开头的一级标题和成稿标题重复，排版时去掉。 */
export function dropLeadingTitle(blocks) {
  return blocks[0]?.type === 'heading' && blocks[0].level === 1 ? blocks.slice(1) : blocks
}

/** 原文第 offset 个字符在第几行（从 0 数）。 */
export function lineAt(text, offset) {
  const source = String(text ?? '')
  const end = Math.max(0, Math.min(source.length, Number(offset) || 0))
  let line = 0
  for (let i = source.indexOf('\n'); i >= 0 && i < end; i = source.indexOf('\n', i + 1)) line += 1
  return line
}

/** 第 line 行（从 0 数）开头的字符位置；超出末行时给末行开头。 */
export function offsetOfLine(text, line) {
  const source = String(text ?? '')
  let offset = 0
  for (let n = 0; n < line; n += 1) {
    const next = source.indexOf('\n', offset)
    if (next < 0) break
    offset = next + 1
  }
  return offset
}
