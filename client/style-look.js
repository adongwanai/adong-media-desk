// 风格卡的图标怎么画：纯函数，选择器和风格页共用，测试也直接调它。

// 预设风格原来用 emoji 当图标，小尺寸、深色底下都发糊。换成线条图标，放在按板块着色的小方块里
const GLYPH_BY_EMOJI = {
  '🧭': 'compass', '🤖': 'bot', '📱': 'phone', '✈️': 'plane', '🍜': 'utensils', '🎬': 'clapper', '🏡': 'house', '📚': 'book',
  '💼': 'briefcase', '🛠️': 'wrench', '📈': 'trend', '💄': 'palette', '👗': 'shirt', '🌙': 'moon', '🧸': 'baby', '📰': 'news', '✍️': 'feather',
}
const GLYPH_BY_CATEGORY = { 科技数码: 'bot', 旅行探店: 'plane', 'Vlog 生活': 'clapper', 观点认知: 'book', 干货教程: 'wrench', 种草测评: 'spark', 情感故事: 'moon', 热点资讯: 'news' }
const TINT_BY_CATEGORY = { 科技数码: 'blue', 旅行探店: 'teal', 'Vlog 生活': 'amber', 观点认知: 'violet', 干货教程: 'green', 种草测评: 'rose', 情感故事: 'indigo', 热点资讯: 'orange' }

function firstGrapheme(text) {
  const value = String(text ?? '').trim()
  if (!value) return ''
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter().segment(value)][0]?.segment ?? ''
  return [...value][0]
}

/** 一种风格怎么画：线条图标，或者首字（自己的风格），再加一个色调。 */
export function styleLook(style) {
  if (!style) return { glyph: 'feather', tint: 'ink' }
  const tint = style.preset ? TINT_BY_CATEGORY[style.category] ?? 'ink' : 'ink'
  const glyph = GLYPH_BY_EMOJI[style.icon] ?? (style.preset ? GLYPH_BY_CATEGORY[style.category] : null)
  if (glyph) return { glyph, tint }
  // 自己填的 emoji 保留；什么都没填就用名字的第一个字
  if (style.icon && /\p{Extended_Pictographic}/u.test(style.icon)) return { emoji: firstGrapheme(style.icon), tint }
  return { mono: firstGrapheme(style.name).toUpperCase() || '·', tint }
}
