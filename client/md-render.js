// 成稿预览用的 Markdown 渲染：纯函数，不碰 DOM。
// 安全约定：所有文字先转义再加标签；链接只认 http(s) 和 mailto，图片只认 http(s) 和工作台自己的 media-desk/ 路径，
// 其余一律当普通文字。模型输出或导入稿里夹带的 HTML、脚本、javascript: 链接都不会生效。

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST = /^(\s*)([-*+·•]|\d{1,9}[.)、])\s+(.*)$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/
const QUOTE = /^\s{0,3}>/
const IMAGE_LINE = /^\s*!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)\s*$/
const TASK = /^\[([ xX])\]\s+/
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|SUCCESS|QUESTION|EXAMPLE)\][+-]?(?:\s+(.*))?$/i
const CALLOUT_TITLE = { note: '说明', info: '信息', tip: '技巧', success: '结论', important: '重点', example: '示例', warning: '注意', question: '思考', caution: '警惕' }
const MAX_DEPTH = 4

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

/** 链接地址：只放行 http(s) 和 mailto，返回 null 表示不做成链接。 */
export function safeHref(url) {
  const value = String(url ?? '').trim()
  return /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(value) ? value : null
}

/** 图片地址：只放行 http(s) 和工作台自己的 media-desk/ 文件。 */
export function safeImageSrc(url) {
  const value = String(url ?? '').trim()
  if (/^https?:\/\/[^\s<>"']+$/i.test(value)) return value
  return /^\/?media-desk\/[\w./-]+$/.test(value) && !value.includes('..') ? value : null
}

/** 去掉开头的 YAML 头信息（--- 包起来、里面是 key: value 的那一段）。 */
export function stripFrontmatter(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!/^---[ \t]*\n/.test(text)) return text
  const end = text.indexOf('\n---', 4)
  if (end < 0) return text
  const head = text.slice(4, end).split('\n')
  const yaml = head.length <= 80 && head.every(line => !line.trim() || /^[\w一-鿿][\w一-鿿 -]*:(\s|$)/.test(line) || /^\s+/.test(line) || /^-\s/.test(line))
  if (!yaml || !head.some(line => /^[^\s-][^:]*:/.test(line))) return text
  return text.slice(end + 4).replace(/^\s*\n/, '')
}

function fileName(src) {
  return String(src).split(/[?#]/)[0].split('/').pop() || String(src)
}

function imageHtml(alt, src, opts) {
  const safe = safeImageSrc(src)
  if (!safe) return `<span class="md-read-noimg" title="${escapeHtml(src)}">${escapeHtml(alt || fileName(src))}${opts.missingImage ? `<small>${escapeHtml(opts.missingImage)}</small>` : ''}</span>`
  return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
}

// 行内：代码、图片、链接、尖括号链接、裸链接、加粗、高亮、删除线、斜体。左边先匹配到的先处理
const INLINE = /(`+)([^`\n]+?)\1|!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)|\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)|<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>()（）　-〿＀-￯"']+[^\s<>()（）　-〿＀-￯"'.,;:!?])|\*\*(?=\S)([^\n]+?)\*\*|__(?=\S)([^\n]+?)__|==(?=\S)([^=\n]+?)==|~~(?=\S)([^~\n]+?)~~|\*(?=[^\s*])([^*\n]+?)\*/g

export function renderInline(text, opts = {}, depth = 0) {
  const source = String(text ?? '')
  if (depth > MAX_DEPTH) return escapeHtml(source)
  // 表格里常见的 <br> 当换行用：先按它切开，每一段照常转义
  if (/<br\s*\/?>/i.test(source)) return source.split(/\s*<br\s*\/?>\s*/i).map(part => renderInline(part, opts, depth + 1)).join('<br>')
  let out = ''
  let last = 0
  const inner = value => renderInline(value, opts, depth + 1)
  for (const m of source.matchAll(INLINE)) {
    out += escapeHtml(source.slice(last, m.index))
    last = m.index + m[0].length
    const [whole, , code, imgAlt, imgSrc, linkText, linkHref, angle, bare, bold, bold2, mark, del, em] = m
    if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`
    else if (imgSrc !== undefined) out += imageHtml(imgAlt, imgSrc, opts)
    else if (linkHref !== undefined) {
      const href = opts.noLinks ? null : safeHref(linkHref)
      const label = renderInline(linkText, { ...opts, noLinks: true }, depth + 1)
      out += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
    } else if (angle !== undefined || bare !== undefined) {
      const url = angle ?? bare
      const href = opts.noLinks ? null : safeHref(url)
      out += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : escapeHtml(whole)
    } else if (bold !== undefined || bold2 !== undefined) out += `<strong>${inner(bold ?? bold2)}</strong>`
    else if (mark !== undefined) out += `<mark>${inner(mark)}</mark>`
    else if (del !== undefined) out += `<del>${inner(del)}</del>`
    else if (em !== undefined) out += `<em>${inner(em)}</em>`
    else out += escapeHtml(whole)
  }
  return out + escapeHtml(source.slice(last))
}

function cells(row) {
  return row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
}

function startsBlock(line, next) {
  return HEADING.test(line) || QUOTE.test(line) || LIST.test(line) || FENCE.test(line) || RULE.test(line) || IMAGE_LINE.test(line) || (TABLE_ROW.test(line) && TABLE_RULE.test(next ?? ''))
}

const indentOf = line => line.replace(/\t/g, '    ').match(/^ */)[0].length

/** 列表：按缩进建嵌套。返回 [html, 下一行的位置]。 */
function renderList(lines, start, opts, depth) {
  const root = { children: [] }
  // 每一层：缩进、这一层的列表、这一层最后一项
  const stack = []
  const containerOf = depthIndex => (depthIndex < 0 ? root.children : stack[depthIndex].item.children)
  const newList = (ordered, marker) => ({ ordered, start: ordered ? Number.parseInt(marker, 10) || 1 : 1, items: [] })
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      // 空行之后还是列表项（或缩进的续行），就算同一个列表
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j += 1
      if (j < lines.length && (LIST.test(lines[j]) || indentOf(lines[j]) >= 2)) { i = j; continue }
      break
    }
    const m = LIST.exec(line)
    if (!m) {
      // 续行接在上一项后面，遇到别的块就停
      if (startsBlock(line, lines[i + 1])) break
      stack[stack.length - 1].item.lines.push(line.trim())
      i += 1
      continue
    }
    const indent = indentOf(m[1])
    const ordered = /\d/.test(m[2])
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop()
    const top = stack[stack.length - 1]
    const item = { lines: [m[3]], children: [] }
    if (top && top.indent === indent) {
      if (top.list.ordered !== ordered) {
        // 同一层换了有序 / 无序：另起一个列表
        top.list = newList(ordered, m[2])
        containerOf(stack.length - 2).push(top.list)
      }
      top.list.items.push(item)
      top.item = item
    } else {
      const list = newList(ordered, m[2])
      containerOf(stack.length - 1).push(list)
      list.items.push(item)
      stack.push({ indent, list, item })
    }
    i += 1
  }
  const html = node => node.children.map(list => {
    const tag = list.ordered ? 'ol' : 'ul'
    const startAttr = list.ordered && list.start !== 1 ? ` start="${list.start}"` : ''
    return `<${tag}${startAttr}>${list.items.map((item) => {
      const first = item.lines[0]
      const task = TASK.exec(first)
      const lead = task ? `<span class="md-read-task${/x/i.test(task[1]) ? ' is-done' : ''}" aria-hidden="true"></span>` : ''
      const text = [task ? first.replace(TASK, '') : first, ...item.lines.slice(1)].map(row => renderInline(row, opts, depth)).join('<br>')
      return `<li${task ? ' class="is-task"' : ''}>${lead}${text}${html(item)}</li>`
    }).join('')}</${tag}>`
  }).join('')
  return [html(root), i]
}

function renderBlocks(lines, opts, depth) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i += 1; continue }
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1]
      const body = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(mark)) { body.push(lines[i]); i += 1 }
      i += 1
      const lang = fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : ''
      out.push(`<pre${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2], opts, depth)}</h${level}>`)
      i += 1
      continue
    }
    if (RULE.test(line)) { out.push('<hr>'); i += 1; continue }
    const image = IMAGE_LINE.exec(line)
    if (image) {
      const alt = image[1].trim()
      // 看不到的本地图片已经在占位里写了说明，不再重复一行图注
      const caption = alt && safeImageSrc(image[2]) && !/^(image|img|图片|截图|pasted image.*)$/i.test(alt) && alt !== fileName(image[2]) ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ''
      out.push(`<figure>${imageHtml(alt, image[2], opts)}${caption}</figure>`)
      i += 1
      continue
    }
    if (QUOTE.test(line)) {
      const quote = []
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && quote.length && !startsBlock(lines[i], lines[i + 1])))) {
        quote.push(lines[i].replace(/^\s{0,3}>\s?/, ''))
        i += 1
      }
      const firstNonEmpty = quote.findIndex(row => row.trim())
      const alert = firstNonEmpty >= 0 ? CALLOUT.exec(quote[firstNonEmpty].trim()) : null
      if (alert) {
        const kind = alert[1].toLowerCase()
        const title = (alert[2] ?? '').trim() || CALLOUT_TITLE[kind] || '提示'
        const restLines = quote.slice(firstNonEmpty + 1)
        const inner = restLines.some(row => row.trim())
          ? (depth >= MAX_DEPTH ? `<p>${restLines.map(row => renderInline(row, opts, depth)).join('<br>')}</p>` : renderBlocks(restLines, opts, depth + 1))
          : ''
        out.push(`<blockquote class="md-callout is-${escapeHtml(kind)}"><p class="md-callout-title"><strong>${renderInline(title, opts, depth)}</strong></p>${inner}</blockquote>`)
      } else {
        out.push(depth >= MAX_DEPTH ? `<blockquote><p>${quote.map(row => renderInline(row, opts, depth)).join('<br>')}</p></blockquote>` : `<blockquote>${renderBlocks(quote, opts, depth + 1)}</blockquote>`)
      }
      continue
    }
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      const align = cells(lines[i + 1]).map(cell => (/^:-+:$/.test(cell) ? 'center' : /-:$/.test(cell) ? 'right' : ''))
      i += 2
      const rows = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) { rows.push(cells(lines[i])); i += 1 }
      const cell = (tag, text, col) => `<${tag}${align[col] ? ` style="text-align:${align[col]}"` : ''}>${renderInline(text, opts, depth)}</${tag}>`
      out.push(`<div class="md-read-table"><table><thead><tr>${head.map((text, col) => cell('th', text, col)).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${head.map((_, col) => cell('td', row[col] ?? '', col)).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (LIST.test(line)) {
      const [html, next] = renderList(lines, i, opts, depth)
      out.push(html)
      i = next
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && (!para.length || !startsBlock(lines[i], lines[i + 1]))) { para.push(lines[i].trim()); i += 1 }
    out.push(`<p>${para.map(row => renderInline(row, opts, depth)).join('<br>')}</p>`)
  }
  return out.join('')
}

/**
 * Markdown 转 HTML，用于工作台里的成稿预览。
 * @param {string} source - Markdown 原文。
 * @param {{ missingImage?: string, dropTitle?: string }} [opts] - missingImage：本地图片看不到时的说明；dropTitle：开头一级标题和它相同时去掉。
 * @returns {string} 已转义的 HTML。
 */
export function renderMarkdown(source, opts = {}) {
  const lines = stripFrontmatter(source).split('\n')
  if (opts.dropTitle) {
    const first = lines.findIndex(line => line.trim())
    const h1 = first >= 0 ? /^#\s+(.*?)\s*#*\s*$/.exec(lines[first]) : null
    if (h1 && h1[1].replace(/\s+/g, '') === String(opts.dropTitle).replace(/\s+/g, '')) lines.splice(first, 1)
  }
  return renderBlocks(lines, opts, 0)
}

/**
 * 长稿先只渲染前一段：在 maxChars 之后最近的空行处切开，代码块中间不切。
 * @returns {{ head: string, rest: string }} rest 为空表示没有切。
 */
export function splitForPreview(source, maxChars) {
  const text = stripFrontmatter(source)
  if (text.length <= maxChars) return { head: text, rest: '' }
  const lines = text.split('\n')
  let size = 0
  let inFence = false
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) inFence = !inFence
    size += lines[i].length + 1
    if (size >= maxChars && !inFence && !lines[i].trim()) {
      return { head: lines.slice(0, i).join('\n'), rest: lines.slice(i + 1).join('\n') }
    }
  }
  return { head: text, rest: '' }
}

/** 去掉 Markdown 记号，只留读者看得到的文字，用来数字数。 */
export function markdownPlain(source) {
  return stripFrontmatter(source)
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, '')
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|([-*+·•]|\d{1,9}[.)、])\s+(\[[ xX]\]\s+)?)/gm, '')
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '')
    .replace(/^\s*\|[\s:|-]+\|\s*$/gm, '')
    .replace(/\*\*|__|==|~~|`|\|/g, '')
}
