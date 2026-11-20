// 主题编辑器的取值和改值：每个「旋钮」对应主题里的一处或几处 CSS（同言起 CreateThemeModal 的各项设置）。
// 纯函数，不改原主题，返回新的样式对象。改完的样式交给 src/layout-theme.js 校验后才能保存。
import { cssValue, firstColor, parseColor } from './yanqi.js'

/** 把一段声明串里某个属性改成新值（最后一次出现的那条），没有就加在后面。 */
export function setDecl(style, prop, value) {
  const parts = String(style ?? '').split(';').map(part => part.trim()).filter(Boolean)
  let hit = -1
  parts.forEach((part, i) => { if (part.slice(0, part.indexOf(':')).trim().toLowerCase() === prop) hit = i })
  const decl = `${prop}: ${value}`
  if (hit >= 0) parts[hit] = decl
  else parts.push(decl)
  return `${parts.join('; ')};`
}

/** 颜色转成 #rrggbb，取色器只认这种写法。 */
export function toHex(color, fallback = '#333333') {
  const rgb = parseColor(firstColor(color) ?? color)
  return rgb ? `#${rgb.map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}` : fallback
}

const get = (styles, path) => path.split('.').reduce((node, key) => node?.[key], styles)

function setPath(styles, path, fn) {
  const keys = path.split('.')
  const walk = (node, i) => (i === keys.length ? fn(node) : { ...node, [keys[i]]: walk(node?.[keys[i]] ?? (i === keys.length - 1 ? '' : {}), i + 1) })
  return walk(styles, 0)
}

// 全局主题色要改的地方（同言起 addGlobalStylesSettings；代码块不改，免得底色和字色撞在一起）
const GLOBAL_TEXT = ['header.userName', 'header.userId', 'header.postTime', 'footer.container', 'paragraph', 'emphasis.strong', 'emphasis.em', 'emphasis.del', 'title.h2.content', 'title.h3.content', 'title.base.content', 'list.container', 'list.item', 'list.taskList', 'quote', 'link', 'table.header', 'table.cell', 'footnote.ref', 'footnote.backref']

/**
 * 编辑器里的旋钮。kind：color 取色器、em 标题字号（em）、px 像素。
 * group 是界面上的分组，name / hint 是中文原文。
 */
export const THEME_KNOBS = [
  { id: 'global', group: '全局', name: '全局主题色', hint: '一次改掉所有文字相关的颜色', kind: 'color', read: s => cssValue(s.title.h2.content, 'color') },
  { id: 'background', group: '全局', name: '背景颜色', hint: '卡片和长文的底色，建议浅色', kind: 'color', paths: [['imagePreview', 'background-color']] },
  { id: 'h2', group: '标题', name: '大标题颜色', kind: 'color', paths: [['title.h2.content', 'color']] },
  { id: 'h2size', group: '标题', name: '大标题字号', kind: 'em', min: 1, max: 2.6, step: 0.05, paths: [['title.h2.base', 'font-size']] },
  { id: 'h3', group: '标题', name: '小标题颜色', kind: 'color', paths: [['title.h3.content', 'color'], ['title.base.content', 'color']] },
  { id: 'h3size', group: '标题', name: '小标题字号', kind: 'em', min: 0.9, max: 2, step: 0.05, paths: [['title.h3.base', 'font-size']] },
  { id: 'text', group: '正文', name: '正文颜色', kind: 'color', paths: [['paragraph', 'color'], ['list.item', 'color'], ['list.container', 'color'], ['list.taskList', 'color'], ['table.cell', 'color']] },
  { id: 'lineHeight', group: '正文', name: '正文行距', kind: 'num', min: 1.3, max: 2.2, step: 0.05, paths: [['paragraph', 'line-height'], ['list.item', 'line-height']] },
  { id: 'strong', group: '正文', name: '加粗颜色', kind: 'color', paths: [['emphasis.strong', 'color']] },
  { id: 'em', group: '正文', name: '斜体颜色', kind: 'color', paths: [['emphasis.em', 'color']] },
  { id: 'link', group: '正文', name: '链接颜色', kind: 'color', paths: [['link', 'color']] },
  { id: 'quote', group: '引用与代码', name: '引用颜色', kind: 'color', paths: [['quote', 'color']] },
  { id: 'quoteBar', group: '引用与代码', name: '引用竖线', kind: 'color', paths: [['quote', 'border-left']], format: value => `3px solid ${value}`, read: s => firstColor(cssValue(s.quote, 'border-left')) },
  { id: 'codeBg', group: '引用与代码', name: '代码底色', kind: 'color', paths: [['code.block', 'background'], ['code.inline', 'background']], read: s => firstColor(cssValue(s.code.block, 'background')) ?? firstColor(cssValue(s.code.block, 'background-color')) },
  { id: 'tableHead', group: '表格与分隔线', name: '表头底色', kind: 'color', paths: [['table.header', 'background']], read: s => firstColor(cssValue(s.table.header, 'background')) ?? firstColor(cssValue(s.table.header, 'background-color')) },
  { id: 'tableHeadText', group: '表格与分隔线', name: '表头文字', kind: 'color', paths: [['table.header', 'color']] },
  { id: 'hr', group: '表格与分隔线', name: '分隔线颜色', kind: 'color', paths: [['hr', 'border-top']], format: value => `1px solid ${value}`, read: s => firstColor(cssValue(s.hr, 'border-top')) ?? firstColor(cssValue(s.hr, 'border')) },
  { id: 'header', group: '页眉页脚', name: '页眉主色调', kind: 'color', paths: [['header.userName', 'color'], ['header.userId', 'color'], ['header.postTime', 'color']] },
  { id: 'verified', group: '页眉页脚', name: '认证图标颜色', kind: 'color', paths: [['header.verifiedIcon', 'fill']] },
  { id: 'footer', group: '页眉页脚', name: '页脚颜色', kind: 'color', paths: [['footer.container', 'color']] },
  { id: 'footerBg', group: '页眉页脚', name: '页脚背景', kind: 'color', paths: [['footer.container', 'background']], read: s => firstColor(cssValue(s.footer.container, 'background')) ?? firstColor(cssValue(s.footer.container, 'background-color')) },
  { id: 'radius', group: '图片', name: '图片圆角', kind: 'px', min: 0, max: 32, step: 1, paths: [['image', 'border-radius']] },
]

/** 旋钮现在的值：颜色是 #rrggbb，字号、行距、圆角是数字。 */
export function knobValue(styles, knob) {
  const raw = knob.read ? knob.read(styles) : cssValue(get(styles, knob.paths[0][0]), knob.paths[0][1])
  if (knob.kind === 'color') return toHex(raw, '#888888')
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : knob.min
}

/**
 * 改一个旋钮，返回新的样式对象。
 * @param {object} styles - 主题样式。
 * @param {object} knob - THEME_KNOBS 里的一项。
 * @param {string|number} value - 取色器的 #rrggbb，或者数字。
 */
export function applyKnob(styles, knob, value) {
  if (knob.id === 'global') {
    if (!/^#[0-9a-f]{6}$/i.test(String(value))) return styles
    return GLOBAL_TEXT.reduce((next, path) => (cssValue(get(next, path), 'color') ? setPath(next, path, style => setDecl(style, 'color', value)) : next), styles)
  }
  let text
  if (knob.kind === 'color') {
    if (!/^#[0-9a-f]{6}$/i.test(String(value))) return styles
    text = knob.format ? knob.format(value) : value
  } else {
    const n = Math.min(knob.max, Math.max(knob.min, Number(value)))
    if (!Number.isFinite(n)) return styles
    text = knob.kind === 'em' ? `${n}em` : knob.kind === 'px' ? `${n}px` : String(n)
  }
  return knob.paths.reduce((next, [path, prop]) => setPath(next, path, style => setDecl(style, prop, text)), styles)
}

/** 新主题的 id：my- + 名字里的英文数字 + 随机尾巴。 */
export function newThemeId(name) {
  const slug = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return `my-${slug ? `${slug}-` : ''}${Date.now().toString(36).slice(-5)}`
}
