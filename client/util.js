import { lang, lookupEn, t } from './i18n.js'

export const PLATFORM_EN_NAMES = {
  公众号: 'WeChat', 小红书: 'Xiaohongshu', 抖音: 'Douyin', B站: 'Bilibili', 视频号: 'Channels',
  知乎: 'Zhihu', 头条: 'Toutiao', TikTok: 'TikTok', Instagram: 'Instagram', YouTube: 'YouTube', X: 'X',
  GitHub: 'GitHub', 谷歌学术: 'Google Scholar',
}

// 这些表只放中文原文，显示时再用 t() 翻译
export const STATUSES = ['idea', 'outline', 'draft', 'ready', 'published']
export const STATUS_LABEL = { idea: '灵感', outline: '大纲', draft: '草稿', ready: '待发布', published: '已发布' }
export const KIND_LABEL = { image: '图片', video: '视频', web: '网页', quote: '金句', note: '笔记' }
export const PLATFORMS = ['公众号', '小红书', '抖音', 'B站', '视频号', '知乎', '头条', 'TikTok', 'Instagram', 'YouTube', 'X']
/** 记粉丝、看账号、做对标用的平台：比发布平台多出 GitHub 和谷歌学术。 */
export const ACCOUNT_PLATFORMS = [...PLATFORMS, 'GitHub', '谷歌学术']
/** 大屏上这个平台记的是什么数：GitHub 是 star，谷歌学术是被引，其余是粉丝。 */
export const countName = platform => (platform === 'GitHub' ? 'Star' : platform === '谷歌学术' ? '被引' : '粉丝')
const OVERSEAS = new Set(['TikTok', 'Instagram', 'YouTube', 'X'])
/** 下拉框里的平台顺序：英文界面把海外平台放前面。 */
export function platformChoices() {
  return lang() === 'en' ? [...PLATFORMS.filter(p => OVERSEAS.has(p)), ...PLATFORMS.filter(p => !OVERSEAS.has(p))] : PLATFORMS
}
export const STYLE_CATEGORIES = ['科技数码', '旅行探店', 'Vlog 生活', '观点认知', '干货教程', '种草测评', '情感故事', '热点资讯']

export function styleIcon(style) {
  return style?.icon || '✍️'
}
export const PLATFORM_URL = {
  公众号: 'https://mp.weixin.qq.com/', 小红书: 'https://creator.xiaohongshu.com/publish/publish', 抖音: 'https://creator.douyin.com/creator-micro/content/upload',
  B站: 'https://member.bilibili.com/platform/upload/video/frame', 视频号: 'https://channels.weixin.qq.com/platform/post/create', 知乎: 'https://zhuanlan.zhihu.com/write', 头条: 'https://mp.toutiao.com/profile_v4/graphic/publish', TikTok: 'https://www.tiktok.com/tiktokstudio/upload', Instagram: 'https://www.instagram.com/', YouTube: 'https://studio.youtube.com/', X: 'https://x.com/compose/post',
}

/** 各平台创作后台的首页：看数据、管理作品的地方。 */
export const PLATFORM_HOME = {
  公众号: 'https://mp.weixin.qq.com/', 小红书: 'https://creator.xiaohongshu.com/', 抖音: 'https://creator.douyin.com/', B站: 'https://member.bilibili.com/platform/home',
  视频号: 'https://channels.weixin.qq.com/platform', 知乎: 'https://www.zhihu.com/creator', 头条: 'https://mp.toutiao.com/', TikTok: 'https://www.tiktok.com/tiktokstudio',
  Instagram: 'https://www.instagram.com/', YouTube: 'https://studio.youtube.com/', X: 'https://x.com/i/account_analytics',
  GitHub: 'https://github.com/', 谷歌学术: 'https://scholar.google.com/citations',
}

export function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function seeded(seed) {
  let s = seed || 1
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507)
    s = Math.imul(s ^ (s >>> 13), 3266489909)
    s ^= s >>> 16
    return (s >>> 0) / 4294967296
  }
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 把弹簧响应采样成 CSS linear() 缓动，WAAPI 和 CSS 都能用。 */
export function springEasing(stiffness = 170, damping = 20, mass = 1) {
  const w0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  const wd = w0 * Math.sqrt(Math.max(1 - zeta * zeta, 1e-4))
  const at = t => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
  let duration = 0.1
  while (duration < 4 && (Math.abs(at(duration) - 1) > 0.002 || Math.abs(at(duration + 0.05) - 1) > 0.002)) duration += 0.05
  const points = []
  const N = 36
  for (let i = 0; i <= N; i += 1) points.push(Number(at((i / N) * duration).toFixed(4)))
  points[N] = 1
  return { easing: `linear(${points.join(',')})`, duration: Math.round(duration * 1000) }
}

export const SPRING_SOFT = springEasing(120, 16)
export const SPRING_SNAP = springEasing(260, 24)

export function dayKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function pad(n) {
  return String(n).padStart(2, '0')
}

export function fmtTime(iso) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso) {
  const d = new Date(iso)
  if (lang() === 'en') return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function fmtWhen(iso) {
  if (!iso) return t('未排期')
  return `${fmtDate(iso)} ${fmtTime(iso)}`
}

export function relativeDay(iso) {
  const diff = Math.round((new Date(dayKey(iso)) - new Date(dayKey(new Date()))) / 86400000)
  if (diff === 0) return t('今天')
  if (diff === 1) return t('明天')
  if (diff === 2) return t('后天')
  if (diff === -1) return t('昨天')
  if (diff < 0 && diff > -8) return t('{n}天前', { n: -diff })
  return fmtDate(iso)
}

export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function compact(n) {
  if (n === null || n === undefined) return '—'
  if (lang() === 'en') {
    // 英文用 K / M，去掉多余的 .0
    const short = (value, suffix) => `${value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, '')}${suffix}`
    if (n >= 999500) return short(n / 1000000, 'M')
    if (n >= 10000) return short(n / 1000, 'K')
    return n.toLocaleString('en-US')
  }
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`
  return n.toLocaleString()
}

/** 数量后面的单位。英文在 n 为 1 时用单数，词典里 key 写成「单位|1」。 */
export function unit(n, zh) {
  const singular = lang() === 'en' && n === 1 ? lookupEn(`${zh}|1`) : undefined
  if (singular !== undefined) return singular
  return t(zh)
}

/** 连续记录天数：今天还没记时，从昨天往回算，不会让今天一早就断掉。 */
/** 灵感墙和邮票只放自己记下的灵感，从账号导入的已发内容不算。 */
export function isIdea(item) {
  return !item.parentId && !item.imported
}

/** 发出去了：状态是已发布，或者任何一个平台记了「已发布」。 */
export function isPublished(item) {
  return item?.status === 'published' || Object.values(item?.publish ?? {}).some(row => row?.state === 'published')
}

/** 看板和各处计数用的状态：哪个平台发出去了就算已发布，其余照状态走。 */
export function pieceStatus(item) {
  return isPublished(item) ? 'published' : item.status
}

/** 算不算一篇内容：还停在灵感状态的分支只是发散草图，不算。 */
export function isPiece(item) {
  return !(item.parentId && item.status === 'idea' && !isPublished(item))
}

/** 有成稿：一键成稿写完了，或者保存过文章、脚本。 */
export function isFinished(item) {
  return item.production?.status === 'done' || Boolean(item.drafts?.article || item.drafts?.script)
}

/**
 * 全站共用的一套计数：内容页、看板列、灵感页、导航角标、大屏都用它，数字才对得上。
 * 每篇只落在 ideas / drafting / ready / published 其中一格，四格加起来等于 total。
 * @param {object[]} items - state.items（示例数据也算，界面上看得到）。
 * @returns {{total: number, ideas: number, importedIdeas: number, drafting: number, ready: number, published: number, finished: number}}
 *   ideas 含导入的（importedIdeas 是其中导入的那些）；drafting 是大纲和草稿；finished 是有成稿的，和前几格交叉。
 */
export function pieceCounts(items) {
  const out = { total: 0, ideas: 0, importedIdeas: 0, drafting: 0, ready: 0, published: 0, finished: 0 }
  for (const item of items ?? []) {
    if (!isPiece(item)) continue
    out.total += 1
    if (isFinished(item)) out.finished += 1
    const status = pieceStatus(item)
    if (status === 'published') out.published += 1
    else if (status === 'ready') out.ready += 1
    else if (status === 'outline' || status === 'draft') out.drafting += 1
    else if (status === 'idea') {
      out.ideas += 1
      if (item.imported) out.importedIdeas += 1
    }
  }
  return out
}

const DAY_MS = 86_400_000
/** 趋势图能不能连成折线：至少两天，而且相邻两点正好差一天。中间空着的日子不能画成一条线。 */
export function isDense(dates) {
  const at = date => Date.parse(`${date}T12:00:00Z`)
  return dates.length >= 2 && dates.every((date, i) => i === 0 || Math.round((at(date) - at(dates[i - 1])) / DAY_MS) === 1)
}

/** 发布页仅列出真实成稿；导航与筛选共用入口和阶段。 */
export const isPublishable = item => !item.sample && item.production?.status === 'done'
export function publishPhase(item, platform = '') {
  if (platform) {
    const state = item.publish?.[platform]?.state ?? 'none'
    return state === 'published' ? 'done' : state === 'none' ? 'todo' : 'doing'
  }
  if (isPublished(item)) return 'done'
  return Object.values(item.publish ?? {}).some(row => ['copied', 'drafted'].includes(row?.state)) ? 'doing' : 'todo'
}

/** 导航角标，和各页标题用同一套数：灵感（自己记的、等着成稿）、内容（大纲和草稿）、发布（待发布）。 */
export function navBadges(items) {
  const counts = pieceCounts(items)
  return { home: counts.ideas - counts.importedIdeas, content: counts.drafting, publish: (items ?? []).filter(item => isPublishable(item) && publishPhase(item) === 'todo').length }
}

export function computeStreak(items, now = new Date()) {
  const days = new Set(items.filter(isIdea).map(i => dayKey(i.createdAt)))
  const cursor = new Date(now)
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 成稿之后，卡片显示封面和最终标题。 */
export function displayItem(item) {
  const production = item.production
  if (!production?.title || production.status === 'running') return item
  const src = production.cover?.src
  return { ...item, title: production.title, ...(src ? { kind: 'image', media: { src, w: 3, h: 2 } } : {}) }
}

export function posterOf(item) {
  if (!item.media) return null
  return item.media.poster || (item.kind === 'video' ? null : item.media.src)
}

// 成稿预览的 Markdown 渲染在 md-render.js：先转义再加标签，链接和图片地址都过白名单
export { renderMarkdown } from './md-render.js'

/** 正文长度：中文按字数（不算空白），英文按词数，中文字在英文里各算一个。 */
export function textLength(text) {
  if (lang() !== 'en') return text.replace(/\s/g, '').length
  return (text.match(/[\u4e00-\u9fff]|[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length
}

