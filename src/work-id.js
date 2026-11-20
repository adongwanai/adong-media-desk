// 作品 ID：平台自己给一条作品编的号（B 站 bvid、小红书 noteId、抖音 aweme_id、公众号 article id、视频号 id、YouTube video id、X status id）。
// 标题在平台上可能改过，按 ID 认才认得准。这里只做纯函数：从链接或页面文字里取 ID，校验、规整。

/** 能存进 state 的作品 ID：字母、数字、下划线、连字符，1–80 个字符。 */
export const WORK_ID = /^[A-Za-z0-9_-]{1,80}$/

// 每个平台一条正则，第一个括号里就是 ID。按 2026-11 各平台链接和页面文字的写法整理。
// 小红书创作后台的笔记卡片地址带 noteId=…，公开笔记地址是 /explore/<id>；公众号发表后的文章地址是 /s?…或 /s/<短码>。
const PATTERNS = {
  B站: /(BV[0-9A-Za-z]{10})/,
  小红书: /(?:explore\/|discovery\/item\/|note\/|[?&]noteId=|noteId["':=\s]+)([0-9a-fA-F]{24})/,
  抖音: /(?:\/video\/|aweme_id=)(\d{15,20})/,
  公众号: /(?:appmsgid=|[?&]mid=|mp\.weixin\.qq\.com\/s\/)([A-Za-z0-9_-]{6,})/,
  视频号: /(?:post_id|feed_id|object_id)=([A-Za-z0-9_-]{6,})/,
  YouTube: /(?:[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  X: /\/status\/(\d{6,25})/,
}

// 网址的主机名对到平台：表格里的链接列、作品列表页上的链接都靠它判断这是哪个平台的
const HOSTS = {
  'bilibili.com': 'B站',
  'b23.tv': 'B站',
  'xiaohongshu.com': '小红书',
  'xhslink.com': '小红书',
  'douyin.com': '抖音',
  'iesdouyin.com': '抖音',
  'mp.weixin.qq.com': '公众号',
  'channels.weixin.qq.com': '视频号',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'x.com': 'X',
  'twitter.com': 'X',
}

// 没有主机名可参考时按这个顺序试：先试特征最强的，避免一串文字被认成别的平台
const ANY_ORDER = ['X', 'YouTube', 'B站', '小红书', '抖音', '公众号', '视频号']

/** 规整并校验一个作品 ID；不合法就是 null（不猜，也不截断）。 */
export function cleanWorkId(value) {
  const id = String(value ?? '').trim()
  return WORK_ID.test(id) ? id : null
}

/** 链接里的主机名对到平台；认不出就是 null。 */
export function platformOfUrl(url) {
  const host = /^https?:\/\/([^/?#\s]+)/i.exec(String(url ?? ''))?.[1]?.toLowerCase() ?? ''
  if (!host) return null
  const bare = host.replace(/:\d+$/, '')
  for (const [domain, platform] of Object.entries(HOSTS)) {
    if (bare === domain || bare.endsWith(`.${domain}`)) return platform
  }
  return null
}

/**
 * 按平台的正则从一个链接或一段文字里取作品 ID。
 * @param {string} platform - 平台名（和工作台里的一致）。
 * @param {string} text - 链接或页面原文。
 * @returns {string|null} 取不到或不合法是 null。
 */
export function workIdOf(platform, text) {
  const pattern = PATTERNS[platform]
  if (!pattern) return null
  const match = pattern.exec(String(text ?? ''))
  return match ? cleanWorkId(match[1]) : null
}

/**
 * 从链接里取作品 ID：给了平台就按那个平台，没给就按主机名判断。
 * @param {string} url - 链接。
 * @param {string|null} [platform] - 已知的平台。
 * @returns {string|null}
 */
export function workIdFromUrl(url, platform = null) {
  const target = platform ?? platformOfUrl(url)
  return target ? workIdOf(target, url) : null
}

/**
 * 从一格文字（可能是纯 ID、链接、或带链接的一段话）里取作品 ID。
 * 没给平台时：先看有没有能认出平台的链接，再看有没有光秃秃的 BV 号这类特征串。
 * @param {string} text - 一格的原文。
 * @param {string|null} [platform] - 已知的平台，给了就只用这个平台的正则。
 * @returns {string|null}
 */
export function workIdFromText(text, platform = null) {
  const source = String(text ?? '').trim()
  if (!source) return null
  if (platform) return workIdOf(platform, source)
  const linked = /https?:\/\/\S+/i.exec(source)
  if (linked) {
    const inferred = platformOfUrl(linked[0])
    const id = inferred ? workIdOf(inferred, linked[0]) : null
    if (id) return id
  }
  for (const name of ANY_ORDER) {
    const id = workIdOf(name, source)
    if (id) return id
  }
  return null
}
