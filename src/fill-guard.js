// 填草稿的安全闸和纯逻辑：哪些按钮绝不能点、哪些可以点、能去哪些地址、页面是不是停在了登录或验证上。
// 这里不碰浏览器，平台适配器和浏览器侧都从这里取判断，单元测试直接测这些函数。

// 所有平台共用的黑名单：按钮文字里带这些字就不点，哪怕它在某个平台的白名单里
export const DENY_WORDS = Object.freeze(['发布', '发表', '群发', '定时', '提交', '审核', '投稿', '上架', '推送', '分享到', '删除'])

/** 文字里的空白统一成一个空格、去掉首尾。 */
export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** 这个按钮文字是不是落在黑名单上（全局的加平台自己的）。 */
export function isDenied(text, extra = []) {
  const value = normalizeText(text)
  return [...DENY_WORDS, ...extra].some(word => word && value.includes(word))
}

/**
 * 点之前的判断：文字必须完全等于平台白名单里的一项，而且不碰黑名单。
 * @param {{clicks: string[], deny?: string[]}} adapter - 平台适配器。
 * @param {string} text - 要点的按钮文字。
 * @returns {{ok: boolean, reason?: 'denied'|'unlisted'}}
 */
export function canClick(adapter, text) {
  const value = normalizeText(text)
  if (!value || isDenied(value, adapter?.deny)) return { ok: false, reason: 'denied' }
  return (adapter?.clicks ?? []).includes(value) ? { ok: true } : { ok: false, reason: 'unlisted' }
}

/** 只允许去平台白名单里的主机，而且必须是 https。 */
export function allowedUrl(adapter, url) {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (adapter?.hosts ?? []).includes(hostname)
  } catch {
    return false
  }
}

const CAPTCHA_TEXT = /请完成.{0,4}验证|拖动.{0,6}滑块|向右滑动|滑动.{0,4}完成|安全验证|人机验证|captcha/i

/**
 * 页面停在哪：null 是正常的发布页；'offsite' 跳去了白名单外；'login' 登录页；'captcha' 弹了验证。
 * @param {object} adapter - 平台适配器（hosts、loginPath）。
 * @param {{href: string, text?: string, captcha?: boolean}} snap - 页面快照：地址、编辑框之外的文字、有没有验证码元素。
 */
export function blockedPage(adapter, snap) {
  const href = String(snap?.href ?? '')
  if (!href || href === 'about:blank') return null
  let url
  try { url = new URL(href) } catch { return 'offsite' }
  if (url.protocol !== 'https:') return 'offsite'
  // 平台的登录主机（比如统一登录页）算要登录，其他陌生主机算跳出了白名单
  if ((adapter?.loginHosts ?? []).includes(url.hostname)) return 'login'
  if (!(adapter?.hosts ?? []).includes(url.hostname)) return 'offsite'
  if (adapter?.loginPath?.test(url.pathname)) return 'login'
  if (snap?.captcha || CAPTCHA_TEXT.test(String(snap?.text ?? ''))) return 'captcha'
  if (adapter?.loginText?.test(String(snap?.text ?? ''))) return 'login'
  return null
}

/** 粘进平台正文框的纯文本：去掉 Markdown 标记和本地图片引用（和发布页「去发布」复制的一样）。 */
export function plainText(markdown) {
  return String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))
    .map(line => line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/==([^=]+)==/g, '$1'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 话题标签：去掉 #、空白和小红书的「[话题]」尾巴，去重；正文里已经有「#标签」的不再加。
 * @param {string[]} tags - 版本里的标签。
 * @param {string} body - 正文。
 * @param {number} [max] - 最多几个。
 */
export function extractTags(tags, body = '', max = 10) {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? '').replace(/\[话题\]/g, '').replace(/^[#＃\s]+/, '').replace(/[#＃\s]+/g, '').trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    if (new RegExp(`[#＃]${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u').test(body)) continue
    out.push(tag)
  }
  return out.slice(0, max)
}

/** 两步之间停 0.5–1.5 秒，像人在操作。random 可注入，测试里固定。 */
export function humanDelay(random = Math.random) {
  return 500 + Math.round(random() * 1000)
}
