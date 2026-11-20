// 快速记灵感时输入的一段文字怎么拆：#标签 拿出来当标签，剩下的如果只是一个网址就按链接收藏。

// # 前面是开头或空白，后面到空白、下一个 # 或结尾为止。网址里的 #片段 前面不是空白，不会被当成标签
const TAG = /(^|\s)#([^\s#]{1,24})(?=\s|#|$)/g
const URL_ONLY = /^https?:\/\/\S+$/i

/**
 * @param {string} raw - 输入框里的原文。
 * @returns {{ text: string, tags: string[], url: string | null }} 去掉标签后的正文、标签（去重）和单独一个网址时的地址。
 */
export function parseCapture(raw) {
  const source = String(raw ?? '').trim()
  const tags = []
  const text = source.replace(TAG, (match, lead, tag) => {
    if (!tags.includes(tag)) tags.push(tag)
    return lead
  }).replace(/[ \t]{2,}/g, ' ').trim()
  // 只写了标签没写别的，就把原文当正文，免得记下一条空灵感
  if (!text) return { text: source, tags: [], url: null }
  return { text, tags, url: URL_ONLY.test(text) && isHttp(text) ? text : null }
}

function isHttp(value) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

// 和 host 侧 src/note-file.js 的 looksLikePath 同一条规则：整段只有一个路径、扩展名是文本稿。
// 贴在首页输入框或快捷小窗里时先认它，别把路径当成灵感标题存下来。
const NOTE_EXTS = ['.md', '.markdown', '.txt']

/**
 * @param {string} value - 用户贴进来的一段文字。
 * @returns {boolean} 整段就是一个本地文本稿路径时为 true。
 */
export function looksLikeNotePath(value) {
  const text = String(value ?? '').trim()
  if (!text || text.includes('\n') || text.length > 400) return false
  const lower = text.toLowerCase()
  if (!NOTE_EXTS.some(ext => lower.endsWith(ext))) return false
  return text.startsWith('/') || text.startsWith('~/') || text.startsWith('./') || /^[a-z]:[\\/]/i.test(text)
}
