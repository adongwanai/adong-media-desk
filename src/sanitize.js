// 浏览器排好版的公众号正文，进草稿箱之前在 Host 这边按白名单再洗一遍。
// 只留少数排版标签和行内样式；别的标签去掉外壳只留文字，脚本、样式表这类连内容一起丢。
// 不依赖 DOM：自己切标签，切不出来的 < 一律当文字转义。

const ALLOWED = new Set(['section', 'p', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'span', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'a', 'img', 'sup'])
// 排版里会出现的近义标签，换成白名单里的写法，样式照留
const RENAME = { mark: 'span', b: 'strong', i: 'em' }
const VOID = new Set(['br', 'hr', 'img'])
// 正文图片只认公众号自己的图片域名（素材接口 uploadimg 返回的地址），别的地址公众号也不会显示
const WECHAT_IMAGE = /^https:\/\/mmbiz\.(?:qpic|qlogo)\.cn\/[^\s"'<>`\\]+$/i
// 这些标签连同里面的内容一起丢掉
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed', 'noframes', 'template', 'textarea', 'title', 'xmp', 'plaintext', 'svg', 'math', 'select', 'head', 'canvas', 'audio', 'video', 'form', 'button'])
const MAX_DEPTH = 64
const MAX_TAG = 16_384

// 行内样式只放这些属性
const CSS_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image', 'background-position', 'background-repeat', 'background-size',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-style', 'border-width', 'border-radius', 'border-collapse', 'border-spacing',
  'box-shadow', 'box-sizing', 'box-decoration-break', '-webkit-box-decoration-break', 'display', 'gap', 'align-items', 'justify-content',
  'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'line-height',
  'list-style', 'list-style-type', 'list-style-position',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'width', 'max-width', 'min-width', 'height', 'opacity', 'overflow', 'overflow-x', 'overflow-wrap', 'word-wrap', 'word-break', 'white-space',
  'text-align', 'text-decoration', 'text-indent', 'text-shadow', 'text-underline-offset', 'vertical-align',
])
const CSS_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'calc', 'linear-gradient', 'radial-gradient', 'repeating-linear-gradient'])
const DISPLAY = new Set(['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'table', 'table-row', 'table-cell', 'list-item'])
// 整段 style 里只要出现这些就整段不要
const CSS_DANGER = /[\\<>]|\/\*|@import|expression|url\s*\(|image-set|javascript:|vbscript:|behavior|-moz-binding|&#/i

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/y
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function escapeAttr(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

function codePoint(n) {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�'
}

/** 属性值里的字符实体先还原，再做检查，免得 &#106;avascript: 这类写法绕过去。 */
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (all, body) => {
    if (body[0] === '#') return codePoint(body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10))
    return NAMED[body.toLowerCase()] ?? all
  })
}

/** 正文文字：已经是实体的保留，裸的 & 和 > 转义。 */
function text(raw) {
  return raw.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;').replace(/>/g, '&gt;')
}

function splitDeclarations(style) {
  const parts = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < style.length; i += 1) {
    const ch = style[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) { parts.push(style.slice(start, i)); start = i + 1 }
  }
  parts.push(style.slice(start))
  return parts
}

function safeValue(prop, value) {
  if (!value || value.length > 300) return false
  if (!/^[\p{L}\p{N}\s#%.,'"()+\-/!*]*$/u.test(value)) return false
  if ((value.match(/"/g) ?? []).length % 2 || (value.match(/'/g) ?? []).length % 2) return false
  for (const match of value.matchAll(/([a-z-]*)\s*\(/gi)) if (!CSS_FUNCS.has(match[1].toLowerCase())) return false
  if (prop === 'display' && !DISPLAY.has(value.toLowerCase())) return false
  return true
}

/**
 * 行内样式按属性白名单过滤；值里有 url()、expression、@import、转义或注释时整段丢掉。
 * @param {string} raw - style 属性的原始值（可能带字符实体）。
 * @returns {string} 过滤后的样式，可能为空。
 */
export function sanitizeStyle(raw) {
  const style = decodeEntities(raw)
  if (CSS_DANGER.test(style) || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(style)) return ''
  const kept = []
  for (const declaration of splitDeclarations(style)) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (CSS_PROPS.has(prop) && safeValue(prop, value)) kept.push(`${prop}: ${value}`)
  }
  return kept.join('; ')
}

/** 链接只放 http / https，别的协议和带空白、控制字符的地址都不要。 */
function safeHref(raw) {
  const href = decodeEntities(raw).trim()
  if (!/^https?:\/\//i.test(href) || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(href)) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : null
  } catch {
    return null
  }
}

function attributes(name, raw) {
  let style = ''
  let href = null
  let src = null
  for (const match of raw.matchAll(ATTR)) {
    const key = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (key === 'style' && !style) style = sanitizeStyle(value)
    else if (key === 'href' && name === 'a' && href === null) href = safeHref(value)
    else if (key === 'src' && name === 'img' && src === null) src = WECHAT_IMAGE.test(decodeEntities(value).trim()) ? decodeEntities(value).trim() : ''
  }
  return { style, href, src }
}

/**
 * 公众号正文 HTML 白名单清洗。
 * 标签：section、p、h1–h4、strong、em、span、ul、ol、li、blockquote、pre、code、表格、hr、br，以及只认 http(s) 地址的 a；
 * 属性只留 style（再按 CSS 白名单过滤）和 a 的 href。其余一律丢掉，标签结构自动补齐。
 * @param {string} html - 浏览器排好版的 HTML。
 * @returns {string} 清洗后的 HTML。
 */
export function sanitizeArticleHtml(html) {
  const src = String(html ?? '')
  const out = []
  const stack = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { out.push(text(src.slice(i))); break }
    out.push(text(src.slice(i, lt)))
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      i = end < 0 ? src.length : end + 3
      continue
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const end = src.indexOf('>', i)
      i = end < 0 ? src.length : end + 1
      continue
    }
    const window = src.slice(i, i + MAX_TAG)
    TAG.lastIndex = 0
    const match = TAG.exec(window)
    if (!match) { out.push('&lt;'); i += 1; continue }
    i += match[0].length
    const closing = match[1] === '/'
    const raw = match[2].toLowerCase()
    if (!closing && DROP_WITH_CONTENT.has(raw)) {
      const end = new RegExp(`</${raw}\\s*>`, 'ig')
      end.lastIndex = i
      const found = end.exec(src)
      i = found ? found.index + found[0].length : src.length
      continue
    }
    const name = RENAME[raw] ?? raw
    if (!ALLOWED.has(name)) continue
    if (closing) {
      const at = stack.lastIndexOf(name)
      if (at < 0) continue
      while (stack.length > at) out.push(`</${stack.pop()}>`)
      continue
    }
    const { style, href, src: imageSrc } = attributes(name, match[3])
    // 没有合格地址的链接只留文字；不是公众号图片地址的图片整个去掉
    if (name === 'a' && !href) continue
    if (name === 'img' && !imageSrc) continue
    const attrs = `${imageSrc ? ` src="${escapeAttr(imageSrc)}"` : ''}${href ? ` href="${escapeAttr(href)}"` : ''}${style ? ` style="${escapeAttr(style)}"` : ''}`
    if (VOID.has(name)) { out.push(`<${name}${attrs}>`); continue }
    if (stack.length >= MAX_DEPTH) continue
    stack.push(name)
    out.push(`<${name}${attrs}>`)
  }
  while (stack.length) out.push(`</${stack.pop()}>`)
  return out.join('')
}

/** 清洗后还有没有正文文字。 */
export function hasText(html) {
  return /[^\s ]/.test(decodeEntities(String(html ?? '').replace(/<[^>]*>/g, '')))
}
