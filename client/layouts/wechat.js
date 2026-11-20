// 公众号长文：Markdown 转成全部样式写在标签上的 HTML。公众号编辑器会去掉 <style> 和 class，只有行内样式能留下来。
// 样式取自言起 YANQI 的主题（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian；
// 言起基于 Note to RED，Yeban8090，MIT，https://github.com/Yeban8090/note-to-red）。
// 纯函数，不碰 DOM。所有文字先转义，模型输出里的 HTML 不会变成可执行的标签。
import { dropLeadingTitle, parseBlocks } from './markdown.js'
import { DEFAULT_FONT, DEFAULT_THEME, blockHtml, clampFontSize, css, cssValue, escapeHtml, fontFamily, headingHtml, pageBackground, richBlocks, yanqiTheme } from './yanqi.js'

export { escapeHtml }

/** 长文默认字号：公众号正文常用 16px，比卡片小一号。 */
export const DEFAULT_WECHAT_SIZE = 16
export const DEFAULT_WECHAT_THEME = DEFAULT_THEME

// 卡片里二级标题是整页的大标题；放进长文要收一点字号，再拉开上下距离
const H2 = { base: 'margin: 1.6em 0 0.8em; font-size: 1.32em; line-height: 1.4' }
const H1 = { base: 'margin: 1.6em 0 0.8em; font-size: 1.45em; line-height: 1.4' }

// 预览里能直接显示的图片：工作台自己的文件、data:image、http(s)
const PREVIEWABLE = /^(media-desk\/(?:files\/[\w.-]+|imported\/[\w-]+\.[a-z0-9]{2,5})|data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+|https?:\/\/[^\s"'<>]+)$/i
// 工作台自己的图片，和导入稿里引用的本地图片（media-desk/imported/…）
const LOCAL = /^media-desk\/(?:files\/[\w.-]+|imported\/[\w-]+\.[a-z0-9]{2,5})$/i
const REMOTE = /^https?:\/\/[^\s"'<>]+$/i

/** 配图放回对应小标题那一节的末尾，找不到就按顺序摊开，同成稿页。 */
function placeFigures(blocks, figures) {
  const placed = (figures ?? []).filter(figure => figure?.src)
  if (!placed.length) return blocks
  const out = [...blocks]
  const headings = out.map((block, i) => [block, i]).filter(([block]) => block.type === 'heading')
  placed.forEach((figure, n) => {
    const plain = row => row.runs.map(run => run.text).join('').trim()
    let at = headings.findIndex(([block]) => figure.anchor && plain(block) === String(figure.anchor).trim())
    if (at < 0) at = Math.min(headings.length - 1, Math.round(((n + 1) * headings.length) / (placed.length + 1)) - 1)
    const start = at >= 0 ? out.indexOf(headings[at][0]) : -1
    let end = out.length
    for (let i = start + 1; i < out.length; i += 1) if (out[i].type === 'heading' && (start < 0 || out[i].level <= out[start].level)) { end = i; break }
    const prev = out[end - 1]
    out.splice(end, 0, { type: 'image', src: figure.src, alt: String(figure.caption ?? ''), line: prev?.end ?? prev?.line ?? 0, figure: true })
  })
  return out
}

/**
 * 长文的各个块，带原文行号。预览按块渲染（改一处只重画一块），复制和推草稿时拼成一整段。
 * @param {string} markdown - 成稿正文。
 * @param {string} [themeId] - 言起主题 id；旧版的 clean / tech / essay 也认。
 * @param {object} [options] - { font, fontSize, themes: 自定义主题, figures: 配图, images: 'preview' | 'draft' | { 原地址: 公网地址 }, lines }。
 *   images 为 'preview' 时直接显示图片；'draft' 时保留工作台地址给 Host 上传；对象时换成图床地址；不给时只留一行提示。
 * @returns {{root: string, blocks: Array<{html: string, line: number, type: string}>, missing: string[]}}
 *   missing 是没法放进正文的图片（本地图且没有图床地址）。
 */
export function wechatParts(markdown, themeId = DEFAULT_WECHAT_THEME, options = {}) {
  const theme = yanqiTheme(themeId, options.themes)
  const s = theme.styles
  const size = clampFontSize(options.fontSize, DEFAULT_WECHAT_SIZE)
  const font = fontFamily(options.font ?? DEFAULT_FONT)
  const missing = []
  const placeholder = block => `<p style="${css(s.paragraph, `font-family: ${font}`, 'font-size: 13px; text-align: center; opacity: 0.6')}">〔${escapeHtml(block.alt || '配图')}〕</p>`
  const imageTag = (src, block) => `<p style="${css('margin: 1.2em 0; text-align: center; line-height: 0')}"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}" style="${css('display: block; max-width: 100%; height: auto; margin: 0 auto', cssValue(s.image, 'border-radius') && `border-radius: ${cssValue(s.image, 'border-radius')}`)}"></p>`
  const image = (block) => {
    const src = String(block.src ?? '')
    const mode = options.images
    if (mode === 'preview') return PREVIEWABLE.test(src) ? imageTag(src, block) : placeholder(block)
    // 推草稿：工作台图片和公网图片都交给 Host 传到公众号素材库
    if (mode === 'draft' && (LOCAL.test(src) || REMOTE.test(src))) return imageTag(src, block)
    if (mode && typeof mode === 'object' && typeof mode[src] === 'string' && /^https?:\/\//.test(mode[src])) return imageTag(mode[src], block)
    // 复制：公网图片原样带上，公众号编辑器粘贴时会自己转存
    if (REMOTE.test(src) && mode !== undefined) return imageTag(src, block)
    missing.push(block.alt || src.split('/').pop())
    return placeholder(block)
  }
  const ctx = {
    s,
    font,
    size,
    codeSize: Math.round(size * 0.875 * 2) / 2,
    tableSize: Math.round(size * 0.875 * 2) / 2,
    links: 'url',
    lines: Boolean(options.lines),
    image,
  }
  const rich = placeFigures(richBlocks(dropLeadingTitle(parseBlocks(markdown))), options.figures)
  const blocks = rich.map((block) => {
    const html = block.type === 'heading' && block.level <= 2 ? headingHtml(block.level, block.runs, ctx, { ...(block.level === 1 ? H1 : H2), line: block.line }) : blockHtml(block, ctx)
    return { html, line: block.line, type: block.type }
  })
  const color = cssValue(s.paragraph, 'color')
  const root = css(pageBackground(theme), 'padding: 20px 16px', 'border-radius: 4px', `font-family: ${font}`, `font-size: ${size}px`, 'line-height: 1.75', color && `color: ${color}`, 'letter-spacing: 0.3px', 'word-break: break-word', 'overflow-wrap: break-word', 'text-align: left')
  return { root, blocks, missing }
}

/**
 * Markdown → 公众号可粘贴的 HTML，样式全部写在标签上。
 * 外层 section 带上主题底色，暗色主题粘进编辑器后文字也看得清。
 * @param {string} markdown - 成稿正文。
 * @param {string} [themeId] - 言起主题 id；旧版的 clean / tech / essay 也认。
 * @param {object} [options] - 同 wechatParts。
 * @returns {string} 一段以 <section> 包住的 HTML。
 */
export function renderWechat(markdown, themeId = DEFAULT_WECHAT_THEME, options = {}) {
  const { root, blocks } = wechatParts(markdown, themeId, options)
  return `<section style="${root}">${blocks.map(block => block.html).join('')}</section>`
}

/** 长文里引用的工作台本地图片（正文图和配图），复制前要传到图床的就是这些。 */
export function localImages(markdown, figures = []) {
  const inline = parseBlocks(markdown).filter(block => block.type === 'image').map(block => block.src)
  return [...new Set([...inline, ...(figures ?? []).map(figure => figure?.src)].filter(src => LOCAL.test(String(src ?? ''))))]
}
