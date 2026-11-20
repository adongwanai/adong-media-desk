// 「我的主题」（图文卡片 / 长文排版的自定义主题）的校验。Host 的 save_layout_theme 和浏览器的主题编辑器共用这一份。
// 主题就是一组写在元素 style 上的 CSS 字符串：结构必须和内置的 30 套言起主题一样，
// CSS 属性只能是内置主题用到的那些；url() 只允许背景上的 data:image，expression、@import、</style、注释、转义一律拒绝。
// 内置主题来自言起 YANQI（阿东玩AI），言起基于 Note to RED（Yeban8090，MIT）。

/** 内置主题用到的 CSS 属性（从 30 套主题里统计出来的）。 */
export const THEME_PROPS = new Set([
  'align-items', 'backdrop-filter', 'background', 'background-color', 'background-image', 'background-position', 'background-repeat', 'background-size',
  'border', 'border-bottom', 'border-collapse', 'border-left', 'border-radius', 'border-right', 'border-spacing', 'border-top', 'bottom', 'box-shadow', 'box-sizing',
  'color', 'cursor', 'display', 'fill', 'filter', 'font-family', 'font-size', 'font-style', 'font-weight', 'gap', 'height', 'inset', 'justify-content', 'left',
  'letter-spacing', 'line-height', 'list-style', 'margin', 'margin-bottom', 'margin-left', 'margin-top', 'max-height', 'max-width', 'object-fit', 'opacity', 'overflow',
  'padding', 'padding-left', 'position', 'right', 'text-align', 'text-decoration', 'text-shadow', 'text-underline-offset', 'transform', 'transition', 'vertical-align',
  'white-space', 'width', 'word-wrap', 'z-index',
])

const FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'linear-gradient', 'radial-gradient', 'repeating-linear-gradient', 'calc', 'blur', 'brightness', 'contrast', 'saturate', 'translate', 'translatex', 'translatey', 'scale', 'rotate', 'url'])

/** 主题的结构：叶子是 CSS 字符串；带 ? 的可以没有。 */
export const THEME_SHAPE = {
  imagePreview: 'css',
  header: { avatar: { container: 'css', placeholder: 'css', image: 'css' }, 'container?': 'css', nameContainer: 'css', postTime: 'css', userId: 'css', 'userInfo?': 'css', 'userLeft?': 'css', userName: 'css', verifiedIcon: 'css' },
  footer: { container: 'css', separator: 'css', text: 'css' },
  footnote: { ref: 'css', backref: 'css' },
  title: { h2: { base: 'css', content: 'css', after: 'css' }, h3: { base: 'css', content: 'css', after: 'css' }, base: { base: 'css', content: 'css', after: 'css' } },
  paragraph: 'css',
  emphasis: { strong: 'css', em: 'css', del: 'css' },
  list: { container: 'css', item: 'css', taskList: 'css' },
  code: { block: 'css', inline: 'css' },
  quote: 'css',
  image: 'css',
  link: 'css',
  table: { container: 'css', header: 'css', cell: 'css' },
  hr: 'css',
}

export const MAX_LAYOUT_THEMES = 30
const MAX_VALUE = 400
const MAX_DATA_IMAGE = 700_000
const DATA_IMAGE = /^url\(\s*data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+\s*\)$/i
// 出现就整个主题拒收
const HOSTILE = /[<>\\]|\/\*|\*\/|@import|@charset|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|image-set|&#|\u0000/i

function fail(message) {
  return Object.assign(new Error(message), { status: 400 })
}

/** 按分号切声明，括号里的分号（data URL 里有）不切。 */
export function splitDeclarations(style) {
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

function cleanValue(prop, value, allowImage) {
  if (!value) return null
  if (/url\s*\(/i.test(value)) {
    // 只有底图上的 background-image 可以是 data:image
    if (!allowImage || prop !== 'background-image' || !DATA_IMAGE.test(value) || value.length > MAX_DATA_IMAGE) return 'reject'
    return value
  }
  if (value.length > MAX_VALUE) return null
  if (/[{};]/.test(value)) return null
  if (!/^[\p{L}\p{N}\s#%.,'"()+\-/!*_]*$/u.test(value)) return null
  if ((value.match(/"/g) ?? []).length % 2 || (value.match(/'/g) ?? []).length % 2) return null
  for (const match of value.matchAll(/([a-z-]*)\s*\(/gi)) if (!FUNCS.has(match[1].toLowerCase())) return null
  return value
}

/**
 * 洗一段主题 CSS：不认识的属性、带花括号的残片丢掉；出现危险写法直接抛错。
 * @param {string} raw - CSS 声明串。
 * @param {{allowImage?: boolean, where?: string}} [options] - allowImage：允许 data:image 底图（只给 imagePreview）。
 * @returns {string} 洗过的声明串。
 */
export function cleanThemeCss(raw, { allowImage = false, where = '' } = {}) {
  if (typeof raw !== 'string') throw fail(`主题样式格式不对：${where}`)
  if (HOSTILE.test(raw) || /<\/style/i.test(raw)) throw fail(`主题样式里有不允许的写法：${where}`)
  const kept = []
  for (const declaration of splitDeclarations(raw)) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim().replace(/\s*!important$/i, '')
    if (!/^[a-z-]+$/.test(prop) || !THEME_PROPS.has(prop)) continue
    const clean = cleanValue(prop, value, allowImage)
    if (clean === 'reject') throw fail(`主题样式里只有底图可以用 data:image：${where}`)
    if (clean) kept.push(`${prop}: ${clean}`)
  }
  return kept.length ? `${kept.join('; ')};` : ''
}

function cleanShape(shape, input, path) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(`主题缺少「${path || 'styles'}」`)
  const out = {}
  for (const [rawKey, kind] of Object.entries(shape)) {
    const optional = rawKey.endsWith('?')
    const key = optional ? rawKey.slice(0, -1) : rawKey
    const where = path ? `${path}.${key}` : key
    if (input[key] === undefined) {
      if (optional) continue
      throw fail(`主题缺少「${where}」`)
    }
    out[key] = kind === 'css' ? cleanThemeCss(input[key], { allowImage: where === 'imagePreview', where }) : cleanShape(kind, input[key], where)
  }
  return out
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : ''
}

/**
 * 校验并洗干净一套自定义主题。
 * @param {object} input - { id: 'my-…', name, description, base, styles }。
 * @returns {{id: string, name: string, description: string, base: string, styles: object}} 可以存的主题。
 */
export function validateLayoutTheme(input) {
  if (!input || typeof input !== 'object') throw fail('主题格式不对')
  const id = String(input.id ?? '')
  if (!/^my-[a-z0-9-]{1,40}$/.test(id)) throw fail('主题 id 要以 my- 开头，只能有小写字母、数字和横线')
  const name = cleanText(input.name, 30)
  if (!name) throw fail('主题名称不能为空')
  const styles = cleanShape(THEME_SHAPE, input.styles, '')
  if (JSON.stringify(styles).length > MAX_DATA_IMAGE + 60_000) throw fail('主题太大了')
  return { id, name, description: cleanText(input.description, 80), base: cleanText(input.base, 40), styles }
}
