// 工作台的唯一写入口：对话、界面操作都走这里，统一校验字段并产出回执。
// 模型输出也是不可信输入，所以这里只放行白名单字段。
import { currentLang, platformName, tr } from './i18n.js'
import { draftFormat } from './style.js'
import { cleanTags, specOf } from './platform-specs.js'
import { cleanPlatformRules } from './platform-rules.js'
import { BUILTIN_GROUP_IDS } from './feed-catalog.js'
import { cleanScoreParts } from './idea-score.js'
import { cleanWords, MAX_BLOCKED, MAX_TOPICS } from './rank.js'
import { MAX_LAYOUT_THEMES, validateLayoutTheme } from './layout-theme.js'
import { incomeHandlers } from './income.js'
import { cleanWorkId } from './work-id.js'
import { CREATION_GOALS } from './creation.js'
import { pushSample } from './metric-samples.js'

export const STATUSES = ['idea', 'outline', 'draft', 'ready', 'published']
export const STATUS_LABEL = { idea: '灵感', outline: '大纲', draft: '草稿', ready: '待发布', published: '已发布' }
export const MAX_FEEDS = 30
export const MAX_RIVALS = 50
const KINDS = ['image', 'video', 'web', 'quote', 'note']
export const PLATFORMS = ['公众号', '小红书', '抖音', 'B站', '视频号', '知乎', '头条', 'TikTok', 'Instagram', 'YouTube', 'X']
/** 记粉丝、看账号、做对标用的平台：比发布平台多出 GitHub 和谷歌学术，它们有关注者但不在这里发稿。 */
export const ACCOUNT_PLATFORMS = [...PLATFORMS, 'GitHub', '谷歌学术']
// 单个平台的发布进度：已复制去发布 → 已推草稿 → 已发布
export const PUBLISH_LABEL = { copied: '已复制去发布', drafted: '已推草稿', published: '已发布' }

/** 状态在当前语言下的名字。 */
export function statusLabel(status) {
  return tr(STATUS_LABEL[status] ?? String(status))
}

const ITEM_FIELDS = {
  title: 'text', body: 'text', kind: 'kind', url: 'url', source: 'text', tags: 'list', status: 'status', angleId: 'id',
  personaIds: 'list', parentId: 'id', rel: 'text', scheduledAt: 'date', platform: 'platform', pinned: 'bool', media: 'media', pos: 'pos', score: 'score',
  // 从热榜记下时的名次、热度和榜单名，选题评分卡用；scoreParts 是评分卡每一项的明细
  rank: 'rank', heat: 'num', sourceList: 'text', scoreParts: 'scoreParts',
}
const PERSON_FIELDS = { name: 'text', role: 'text', note: 'text', traits: 'list', tone: 'num' }
const ANGLE_FIELDS = { name: 'text', hook: 'text', prompt: 'text' }
const STYLE_FIELDS = { name: 'text', icon: 'text', summary: 'text', tone: 'text', sentences: 'text', opening: 'text', structure: 'text', logic: 'text', story: 'text', flow: 'text', words: 'list', avoid: 'list', samples: 'list', guide: 'longtext', platforms: 'platforms', visual: 'longtext' }
const SKILL_FIELDS = { name: 'text', rule: 'text', source: 'text', status: 'skillStatus', confidence: 'num', evidence: 'text' }
// impressions 曝光、completion 完播率（0–1）、newFollowers 新增关注、minutes 制作分钟。没给的数就是没记，不补 0
// fetchedAt：按发布链接自动读到这组数的时间（手动录入和表格导入没有）
// workId：平台自己的作品 ID（bvid、noteId、aweme_id……），标题改了也认得出是同一条
// ts：这是一次采样（那一刻的累计值），写进采样序列 state.metricSamples，不并进日表；没有 ts 就是日表的一条
const METRIC_FIELDS = { itemId: 'id', workId: 'workId', title: 'text', platform: 'platform', date: 'date', ts: 'date', views: 'num', likes: 'num', comments: 'num', shares: 'num', saves: 'num', recommends: 'num', impressions: 'num', completion: 'ratio', newFollowers: 'num', minutes: 'num', fetchedAt: 'date' }
const METRIC_NUMBERS = ['views', 'likes', 'comments', 'shares', 'saves', 'recommends', 'impressions', 'completion', 'newFollowers', 'minutes']
export const MAX_RIVAL_WORKS = 200
export const MAX_TAKES = 60
// 对标作品的跟进状态：值得跟进 / 继续观察 / 不相关 / 已采用
export const RIVAL_WORK_STATUS = ['follow', 'watch', 'irrelevant', 'adopted']
const RIVAL_WORK_NUMBERS = ['likes', 'saves', 'comments', 'shares', 'views']
// 账号级数字：likes 获赞（小红书是获赞与收藏）、works 作品数（GitHub 是仓库数）、fans 关注者（GitHub 的主数字是 Star）、h 指数和 i10 指数
export const ACCOUNT_STAT_KEYS = ['likes', 'works', 'fans', 'hIndex', 'i10Index']
// 创作后台里一段时间（近 7 日这类，原文记在 period）的数：曝光、播放、点击率、完播率、点赞、评论、收藏、分享、净涨粉、新增关注、取消关注、主页访客
export const PERIOD_STAT_KEYS = ['impressions', 'views', 'ctr', 'completion', 'periodLikes', 'comments', 'saves', 'shares', 'netFollowers', 'newFollowers', 'unfollows', 'visitors']
// 比率存 0–1 的小数；净涨粉可以是负数；其余都是 0 或更大的整数
const RATIO_STATS = new Set(['ctr', 'completion'])
const SIGNED_STATS = new Set(['netFollowers'])
// 自动读到的数从哪来，同一天同一平台高的不被低的覆盖：创作后台 > 主页链接。手动记的不受限制
export const SOURCE_RANK = { backstage: 2, public: 1 }
const sourceRank = source => SOURCE_RANK[source] ?? 0
function statValue(key, value) {
  if (RATIO_STATS.has(key)) return typeof value === 'number' && value >= 0 && value <= 1 ? value : undefined
  if (!Number.isInteger(value)) return undefined
  return SIGNED_STATS.has(key) || value >= 0 ? value : undefined
}
const POST_NUMBERS = ['views', 'likes', 'comments', 'shares', 'saves', 'stars', 'citations']
export const MAX_ACCOUNT_DAYS = 400
const ACCOUNT_FIELDS = { platform: 'text', handle: 'text', url: 'url', followers: 'num', note: 'text', title: 'text', description: 'text', avatar: 'url', fetchedAt: 'date', fetchError: 'text' }

let counter = 0
export function newId(prefix = 'x') {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function coerce(type, value) {
  switch (type) {
    case 'text': return typeof value === 'string' ? value.slice(0, 40000) : undefined
    case 'id': return value === null || typeof value === 'string' ? value : undefined
    // 平台的作品 ID：只认字母、数字、下划线、连字符，1–80 个字符；别的一律不收
    case 'workId': return cleanWorkId(value) ?? undefined
    case 'kind': return KINDS.includes(value) ? value : undefined
    case 'status': return STATUSES.includes(value) ? value : undefined
    case 'longtext': return typeof value === 'string' ? value.trim().slice(0, 6000) : undefined
    // 风格卡里各平台的写法：只留认识的平台和键
    case 'platforms': return cleanPlatformRules(value, PLATFORMS)
    case 'skillStatus': return ['proposed', 'active', 'exported'].includes(value) ? value : undefined
    case 'platform': return value === null || PLATFORMS.includes(value) ? value : undefined
    case 'list': return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 24) : undefined
    case 'bool': return typeof value === 'boolean' ? value : undefined
    case 'num': return Number.isFinite(value) ? value : undefined
    // null 是清掉旧的总分（知道的项不够两项时不打总分）
    case 'score': return value === null ? null : Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : undefined
    case 'rank': return Number.isInteger(value) && value >= 1 ? value : undefined
    case 'scoreParts': return cleanScoreParts(value)
    case 'ratio': return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
    case 'url': return value === null || value === '' ? null : isHttpUrl(value) ? value : undefined
    case 'date': return value === null ? null : typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined
    case 'pos': return value && [value.x, value.y].every(Number.isFinite) ? { x: value.x, y: value.y, r: Number.isFinite(value.r) ? value.r : 0 } : undefined
    case 'media': {
      if (value === null) return null
      if (!value || typeof value.src !== 'string') return undefined
      // 媒体只允许插件自己的相对路径或 http(s) 地址
      const local = /^media-desk\/(assets|files)\/[\w.-]+$/.test(value.src)
      if (!local && !isHttpUrl(value.src)) return undefined
      const poster = typeof value.poster === 'string' && (/^media-desk\/(assets|files)\/[\w.-]+$/.test(value.poster) || isHttpUrl(value.poster)) ? value.poster : undefined
      return { src: value.src, ...(poster ? { poster } : {}), ...(Number.isFinite(value.w) ? { w: value.w } : {}), ...(Number.isFinite(value.h) ? { h: value.h } : {}) }
    }
    default: return undefined
  }
}

function pick(fields, input) {
  const out = {}
  for (const [key, type] of Object.entries(fields)) {
    if (input?.[key] === undefined) continue
    const value = coerce(type, input[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

/** 按这台电脑的时区取日期。 */
function localDay(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 记录的日期：没给就是今天；要是真实存在、不在未来的 YYYY-MM-DD。 */
function logDate(raw, now) {
  const date = raw === undefined || raw === null || raw === '' ? localDay(now) : String(raw)
  const [year, month, dayOfMonth] = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').map(Number) : []
  // 2 月 31 日这种日期 Date 会悄悄进位，转回来对不上就说明这一天不存在
  if (!year || localDay(new Date(year, month - 1, dayOfMonth, 12)) !== date) throw new Error(tr('日期格式不对'))
  if (date > localDay(now)) throw new Error(tr('不能记录未来的日期'))
  return date
}

/** 账号的最新一条内容（或 star 最多的仓库）：标题和链接必须有，数字只收 0 或更大的整数，没读到的项不放。 */
function cleanPost(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !raw.title.trim() || !isHttpUrl(raw.url)) return null
  const at = coerce('date', raw.at)
  return {
    title: raw.title.replace(/\s+/g, ' ').trim().slice(0, 200),
    url: raw.url,
    ...(at ? { at } : {}),
    ...(Number.isInteger(raw.year) && raw.year > 1900 && raw.year < 3000 ? { year: raw.year } : {}),
    ...Object.fromEntries(POST_NUMBERS.filter(key => Number.isInteger(raw[key]) && raw[key] >= 0).map(key => [key, raw[key]])),
  }
}

function findById(list, id) {
  const entry = list.find(row => row.id === id)
  if (!entry) throw new Error(tr('找不到对象：{id}', { id }))
  return entry
}

function short(text, n = 22) {
  const s = String(text || '').trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtWhen(iso) {
  if (!iso) return tr('未排期')
  const d = new Date(iso)
  const pad = v => String(v).padStart(2, '0')
  return `${fmtShort(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtShort(iso) {
  const d = new Date(iso)
  return currentLang() === 'en' ? `${MONTHS_EN[d.getMonth()]} ${d.getDate()}` : `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 改状态时一并维护发布时间：进入已发布记下时间，离开已发布清掉。 */
function applyStatus(item, status) {
  item.status = status
  if (status === 'published' && !item.publishedAt) item.publishedAt = new Date().toISOString()
  if (status !== 'published') delete item.publishedAt
}

/** 排上日历就是待发布（还没成稿的算大纲）；取消排期退回去。已发布的不动。 */
function applySchedule(item, when) {
  item.scheduledAt = when
  if (item.status === 'published') return
  const produced = item.production?.status === 'done'
  if (when) item.status = produced || ['draft', 'ready'].includes(item.status) ? 'ready' : 'outline'
  else if (item.status === 'ready') item.status = 'draft'
  else if (item.status === 'outline' && !produced) item.status = 'idea'
}

/** 一条对标作品：标题和日期必须有；数字只收 0 或更大的，给了但不是数字就整条不收；没给的就没有。 */
function rivalWork(input) {
  const title = typeof input?.title === 'string' ? input.title.trim().slice(0, 200) : ''
  const raw = typeof input?.date === 'string' ? input.date.trim() : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : Number.isNaN(Date.parse(raw)) ? '' : localDay(raw)
  const [y, m, d] = date.split('-').map(Number)
  if (!title || !date || localDay(new Date(y, m - 1, d, 12)) !== date) return null
  const work = { title, date }
  if (input.url !== undefined && input.url !== null && input.url !== '') {
    if (!isHttpUrl(input.url)) return null
    work.url = String(input.url).slice(0, 2000)
  }
  for (const key of RIVAL_WORK_NUMBERS) {
    const value = input[key]
    if (value === undefined || value === null) continue
    if (!Number.isFinite(value) || value < 0) return null
    work[key] = Math.round(value)
  }
  return work
}

const handlers = {
  add_item(state, op, now) {
    const fields = pick(ITEM_FIELDS, op)
    const item = {
      id: newId('it'), kind: 'note', title: '', body: '', tags: [], status: 'idea', personaIds: [], createdAt: now, drafts: {}, ...fields,
    }
    if (!item.title && !item.body && !item.media) throw new Error(tr('灵感内容为空'))
    // 只贴了图或视频也要有个名字，卡片和回执才有东西可显示
    if (!item.title) item.title = short(item.body, 28) || (item.media ? tr(item.kind === 'video' ? '{date}的视频' : '{date}的图片', { date: fmtShort(now) }) : '')
    // 新灵感落在首屏文字旁边，一眼就能看到，也不会打乱已有布局
    if (!item.pos && !item.parentId) {
      const n = state.items.filter(row => !row.parentId && row.pos).length
      const scale = 1 + (n % 6) * 0.2
      item.pos = { x: Math.round(Math.cos(n * 2.39996) * 580 * scale), y: Math.round(Math.sin(n * 2.39996) * 340 * scale), r: ((n % 5) - 2) * 1.2 }
    }
    if (item.scheduledAt) applySchedule(item, item.scheduledAt)
    if (item.status === 'published') applyStatus(item, 'published')
    state.items.unshift(item)
    return { text: tr('记下灵感《{title}》', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  update_item(state, op) {
    const item = findById(state.items, op.id)
    const { status, scheduledAt, ...fields } = pick(ITEM_FIELDS, op)
    Object.assign(item, fields)
    if (scheduledAt !== undefined) applySchedule(item, scheduledAt)
    if (status !== undefined) applyStatus(item, status)
    const names = [...Object.keys(fields), ...(status !== undefined ? ['status'] : []), ...(scheduledAt !== undefined ? ['scheduledAt'] : [])].filter(key => key !== 'pos')
    return names.length ? { text: tr('更新《{title}》', { title: short(item.title) }), target: item.id, kind: 'item' } : null
  },
  delete_item(state, op) {
    const item = findById(state.items, op.id)
    state.items = state.items.filter(row => row.id !== op.id)
    for (const child of state.items) if (child.parentId === op.id) child.parentId = item.parentId ?? null
    state.metrics = state.metrics.filter(row => row.itemId !== op.id)
    return { text: tr('删除《{title}》', { title: short(item.title) }) }
  },
  schedule_item(state, op) {
    const item = findById(state.items, op.id)
    const when = coerce('date', op.scheduledAt)
    if (when === undefined) throw new Error(tr('排期时间无效'))
    const platform = coerce('platform', op.platform)
    if (platform !== undefined) item.platform = platform
    applySchedule(item, when)
    return { text: when ? tr('把《{title}》排到 {when}', { title: short(item.title), when: fmtWhen(when) }) + (item.platform ? ` · ${platformName(item.platform)}` : '') : tr('取消《{title}》的排期', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  // 灵感页「今日回顾」里点了「不再提醒这条」：这么多天之内不再拿它出来回顾，内容本身不动
  snooze_idea(state, op, now) {
    const item = findById(state.items, op.id)
    if (!Number.isInteger(op.days) || op.days < 1 || op.days > 3650) throw new Error(tr('不再提醒的天数要是 1 到 3650 的整数'))
    item.reviewSnoozedUntil = new Date(Date.parse(now) + op.days * 86_400_000).toISOString()
    return { text: tr('《{title}》先不回顾了', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  set_status(state, op) {
    const item = findById(state.items, op.id)
    const status = coerce('status', op.status)
    if (!status) throw new Error(tr('状态无效'))
    applyStatus(item, status)
    return { text: tr('《{title}》状态改为「{status}」', { title: short(item.title), status: statusLabel(status) }), target: item.id, kind: 'item' }
  },
  // 各平台的发布进度只是记录：公众号的公开发布另有确认流程，这里只记结果
  set_publish(state, op, now) {
    const item = findById(state.items, op.id)
    if (!PLATFORMS.includes(op.platform)) throw new Error(tr('发布平台无效'))
    if (op.state !== null && !Object.hasOwn(PUBLISH_LABEL, op.state)) throw new Error(tr('发布状态无效'))
    const url = op.url === undefined || op.url === null || op.url === '' ? null : typeof op.url === 'string' && isHttpUrl(op.url) ? op.url.slice(0, 2000) : undefined
    if (url === undefined) throw new Error(tr('发布链接要以 http 或 https 开头'))
    // 公众号草稿的 media_id 和已提交的发布任务 ID：只在给了的时候才记，格式不对就拒绝
    const ids = {}
    for (const key of ['mediaId', 'publishId']) {
      if (op[key] === undefined || op[key] === null) continue
      if (typeof op[key] !== 'string' || !/^[\w-]{1,200}$/.test(op[key])) throw new Error(tr('草稿 ID 无效'))
      ids[key] = op[key]
    }
    const { [op.platform]: _previous, ...rest } = item.publish ?? {}
    item.publish = op.state === null ? rest : { ...rest, [op.platform]: { state: op.state, at: now, url, ...ids } }
    const names = { title: short(item.production?.title || item.title), platform: platformName(op.platform) }
    return op.state === null
      ? { text: tr('清除《{title}》在{platform}的发布记录', names), target: item.id, kind: 'item' }
      : { text: tr('《{title}》在{platform}：{state}', { ...names, state: tr(PUBLISH_LABEL[op.state]) }), target: item.id, kind: 'item' }
  },
  save_draft(state, op, now) {
    const item = findById(state.items, op.id)
    const format = op.format === 'script' ? 'script' : 'article'
    if (typeof op.text !== 'string') throw new Error(tr('草稿内容无效'))
    const previous = item.drafts?.[format]
    item.drafts = { ...item.drafts, [format]: { text: op.text.slice(0, 200000), by: op.by === 'ai' ? 'ai' : 'user', engine: typeof op.engine === 'string' ? op.engine : undefined, at: now, aiText: op.by === 'ai' ? op.text : previous?.aiText } }
    if (['idea', 'outline'].includes(item.status)) item.status = 'draft'
    return { text: tr(format === 'script' ? '保存《{title}》的脚本' : '保存《{title}》的文章', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  set_creation(state, op) {
    const item = findById(state.items, op.id)
    if (item.production?.status === 'running') throw new Error(tr('正在成稿，完成后再修改创作要求'))
    const next = { ...item.creation }
    if (CREATION_GOALS.includes(op.goal)) next.goal = op.goal
    item.creation = next
    return { text: tr('已保存创作进度'), target: item.id, kind: 'item' }
  },
  update_production(state, op) {
    const item = findById(state.items, op.id)
    if (!item.production) throw new Error(tr('这条灵感还没有成稿'))
    if (typeof op.title === 'string') item.production.title = op.title.slice(0, 200)
    if (typeof op.coverText === 'string') item.production.coverText = op.coverText.slice(0, 40)
    if (typeof op.article === 'string') {
      item.production.article = op.article.slice(0, 200000)
      // 模型（对话）改的正文记成模型稿；作者自己改的留在 article 里，和模型稿一比就知道哪些句子是作者写的
      if (op.by === 'ai') item.production.aiArticle = item.production.article
    }
    return { text: tr('修改《{title}》', { title: short(item.production.title) }), target: item.id, kind: 'item' }
  },
  // 视频页：口播稿（spoken，空字符串表示清掉）和每镜秒数
  update_video(state, op) {
    const item = findById(state.items, op.id)
    if (item.production?.status !== 'done') throw new Error(tr('这条灵感还没有成稿'))
    const production = item.production
    if (typeof op.spoken === 'string') {
      const { spoken: _old, ...rest } = production
      item.production = op.spoken.trim() ? { ...rest, spoken: op.spoken.slice(0, 20000) } : rest
    }
    if (op.shotSeconds !== undefined) {
      const shots = item.production.shots ?? []
      if (!Array.isArray(op.shotSeconds) || op.shotSeconds.length !== shots.length || !op.shotSeconds.every(Number.isFinite)) throw new Error(tr('分镜秒数无效'))
      item.production = { ...item.production, shots: shots.map((shot, i) => ({ ...shot, seconds: Math.max(1, Math.min(120, Math.round(op.shotSeconds[i]))) })) }
    }
    return { text: tr(typeof op.spoken === 'string' ? '修改《{title}》的口播稿' : '修改《{title}》的分镜秒数', { title: short(item.production.title) }), target: item.id, kind: 'item' }
  },
  // 录像只登记插件自己存下的 webm/mp4；文件由 Host 的上传和剪辑接口写入
  add_take(state, op, now) {
    const item = findById(state.items, op.id)
    if (item.production?.status !== 'done') throw new Error(tr('这条灵感还没有成稿'))
    if (typeof op.src !== 'string' || !/^media-desk\/files\/[\w-]+\.(?:webm|mp4)$/.test(op.src)) throw new Error(tr('录像文件无效'))
    // camera 摄像头、screen 录屏、voice 只录了旁白、render 图文成片
    if (!['camera', 'screen', 'voice', 'render'].includes(op.kind)) throw new Error(tr('录像类型无效'))
    if (!Number.isFinite(op.seconds) || op.seconds < 0 || op.seconds > 4 * 3600) throw new Error(tr('录像时长无效'))
    const takes = item.production.takes ?? []
    if (takes.length >= MAX_TAKES) throw new Error(tr('一篇最多存 {n} 条录像，先删掉几条', { n: MAX_TAKES }))
    const from = typeof op.from === 'string' && takes.some(row => row.id === op.from) ? op.from : undefined
    // 提词记录：录制时每一句出现在阅读线上的时刻，按文稿剪用；只收按时间排好的、在录像时长以内的
    const log = Array.isArray(op.log) ? op.log.slice(0, 1000).filter(row => Number.isFinite(row?.t) && row.t >= 0 && row.t <= op.seconds + 5 && typeof row.text === 'string')
      .map(row => ({ t: Math.round(row.t * 1000) / 1000, text: row.text.slice(0, 300) })).filter((row, i, all) => i === 0 || row.t >= all[i - 1].t) : []
    const take = { id: newId('tk'), src: op.src, kind: op.kind, seconds: Math.round(op.seconds * 10) / 10, at: now, ...(from ? { from } : {}), ...(log.length ? { log } : {}) }
    item.production = { ...item.production, takes: [...takes, take] }
    return { text: tr('存好一条录像'), target: item.id, kind: 'item', take }
  },
  delete_take(state, op) {
    const item = findById(state.items, op.id)
    const takes = item.production?.takes ?? []
    if (!takes.some(row => row.id === op.takeId)) throw new Error(tr('找不到这条录像'))
    item.production = { ...item.production, takes: takes.filter(row => row.id !== op.takeId) }
    return { text: tr('删除一条录像'), target: item.id, kind: 'item' }
  },
  // 手动改某个平台的版本；版本本身由 Host 的生成任务创建，这里只改已有的
  update_version(state, op, now) {
    const item = findById(state.items, op.id)
    const version = PLATFORMS.includes(op.platform) ? item.production?.versions?.[op.platform] : undefined
    if (!version) throw new Error(tr('这个平台还没有版本'))
    if (version.status === 'running') throw new Error(tr('这个版本还在生成，等它写完再改'))
    const next = { ...version }
    if (typeof op.title === 'string' && specOf(op.platform)?.title) next.title = op.title.replace(/\s*\n\s*/g, ' ').trim().slice(0, 200)
    if (typeof op.body === 'string') next.body = op.body.slice(0, 20000)
    if (Array.isArray(op.tags)) next.tags = cleanTags(op.tags, specOf(op.platform)?.tags.max ?? 10)
    if (typeof op.firstComment === 'string') next.firstComment = op.firstComment.trim().slice(0, 500)
    // 小红书的图片版：和正文分开存
    if (typeof op.cards === 'string' && specOf(op.platform)?.cards) next.cards = op.cards.slice(0, 20000)
    if (JSON.stringify(next) === JSON.stringify(version)) return null
    item.production.versions = { ...item.production.versions, [op.platform]: { ...next, edited: true, editedAt: now } }
    return { text: tr('修改《{title}》的{platform}版本', { title: short(item.production.title || item.title), platform: platformName(op.platform) }), target: item.id, kind: 'item' }
  },
  add_person(state, op, now) {
    const person = { id: newId('p'), name: '', role: tr('目标读者'), note: '', traits: [], tone: Math.floor(Math.random() * 6), createdAt: now, ...pick(PERSON_FIELDS, op) }
    if (!person.name) throw new Error(tr('人物需要名字'))
    state.people.push(person)
    return { text: tr('添加人物「{name}」', { name: person.name }), target: person.id, kind: 'person' }
  },
  update_person(state, op) {
    const person = findById(state.people, op.id)
    Object.assign(person, pick(PERSON_FIELDS, op))
    return { text: tr('更新人物「{name}」', { name: person.name }), target: person.id, kind: 'person' }
  },
  delete_person(state, op) {
    const person = findById(state.people, op.id)
    state.people = state.people.filter(row => row.id !== op.id)
    for (const item of state.items) item.personaIds = (item.personaIds || []).filter(id => id !== op.id)
    return { text: tr('删除人物「{name}」', { name: person.name }) }
  },
  add_angle(state, op, now) {
    const angle = { id: newId('a'), name: '', hook: '', prompt: '', createdAt: now, ...pick(ANGLE_FIELDS, op) }
    if (!angle.name) throw new Error(tr('角度需要名字'))
    state.angles.push(angle)
    return { text: tr('添加创作角度「{name}」', { name: angle.name }), target: angle.id, kind: 'angle' }
  },
  update_angle(state, op) {
    const angle = findById(state.angles, op.id)
    Object.assign(angle, pick(ANGLE_FIELDS, op))
    return { text: tr('更新创作角度「{name}」', { name: angle.name }), target: angle.id, kind: 'angle' }
  },
  delete_angle(state, op) {
    const angle = findById(state.angles, op.id)
    state.angles = state.angles.filter(row => row.id !== op.id)
    for (const item of state.items) if (item.angleId === op.id) item.angleId = null
    return { text: tr('删除创作角度「{name}」', { name: angle.name }) }
  },
  add_style(state, op, now) {
    const style = { id: newId('st'), source: tr('手动'), createdAt: now, words: [], avoid: [], samples: [], ...pick(STYLE_FIELDS, op) }
    if (!style.name) throw new Error(tr('风格需要名字'))
    state.styles = [style, ...(state.styles ?? [])]
    return { text: tr('添加风格「{name}」', { name: style.name }), target: style.id, kind: 'style' }
  },
  update_style(state, op) {
    const style = findById(state.styles ?? [], op.id)
    Object.assign(style, pick(STYLE_FIELDS, op))
    return { text: tr('更新风格「{name}」', { name: style.name }) }
  },
  delete_style(state, op) {
    const style = findById(state.styles ?? [], op.id)
    state.styles = state.styles.filter(row => row.id !== op.id)
    if (state.activeStyleId === op.id) state.activeStyleId = null
    return { text: tr('删除风格「{name}」', { name: style.name }) }
  },
  set_style(state, op) {
    if (op.id === null) {
      state.activeStyleId = null
      return { text: tr('不再使用特定风格') }
    }
    const style = findById(state.styles ?? [], op.id)
    state.activeStyleId = style.id
    return { text: tr('之后按「{name}」的风格写', { name: style.name }) }
  },
  set_format(state, op) {
    state.draftFormat = draftFormat(op.format)
    return { text: state.draftFormat === 'article' ? tr('之后写成文章') : tr('之后写成口播脚本') }
  },
  add_skill(state, op, now) {
    const skill = { id: newId('s'), name: '', rule: '', source: tr('对话'), status: 'proposed', confidence: 0.5, createdAt: now, ...pick(SKILL_FIELDS, op) }
    if (!skill.name || !skill.rule) throw new Error(tr('写作规则需要名字和内容'))
    state.skills.unshift(skill)
    return { text: tr('沉淀规则「{name}」', { name: skill.name }), target: skill.id, kind: 'skill' }
  },
  update_skill(state, op) {
    const skill = findById(state.skills, op.id)
    Object.assign(skill, pick(SKILL_FIELDS, op))
    return { text: tr('更新规则「{name}」', { name: skill.name }), target: skill.id, kind: 'skill' }
  },
  delete_skill(state, op) {
    const skill = findById(state.skills, op.id)
    state.skills = state.skills.filter(row => row.id !== op.id)
    return { text: tr('删除规则「{name}」', { name: skill.name }) }
  },
  link_metrics(state, op) {
    const ids = Array.isArray(op.ids) ? [...new Set(op.ids)] : []
    if (!ids.length) throw new Error(tr('请选择要关联的数据'))
    const rows = ids.map(id => findById(state.metrics, id))
    const itemId = op.itemId || null
    if (itemId) findById(state.items, itemId)
    for (const row of rows) row.itemId = itemId
    return { text: tr('已更新数据与稿件的关联') }
  },
  add_metric(state, op) {
    // 0 是记下的 0；没给的项留空，表示不知道
    const metric = { id: newId('m'), date: new Date().toISOString(), ...pick(METRIC_FIELDS, op) }
    if (!metric.platform) throw new Error(tr('数据需要平台'))
    if (!METRIC_NUMBERS.some(key => metric[key] !== undefined)) throw new Error(tr('这条数据一个数都没有'))
    const said = verb => (Number.isFinite(metric.views)
      ? tr(verb === 'update' ? '更新 {platform} 数据 {views} 阅读' : '记录 {platform} 数据 {views} 阅读', { platform: platformName(metric.platform), views: metric.views })
      : tr(verb === 'update' ? '更新 {platform} 数据' : '记录 {platform} 数据', { platform: platformName(metric.platform) }))
    // 带 ts 的是一次采样：那一刻的累计值，各存一条，不动日表（同一天既有日表也有采样时互不影响）
    if (metric.ts) {
      if (!metric.workId && !metric.itemId && !metric.title) throw new Error(tr('采样需要作品 ID、内容或标题'))
      state.metricSamples = pushSample(state.metricSamples, { ...metric, id: newId('ms') })
      return { text: tr('记下 {platform} 的一次采样', { platform: platformName(metric.platform) }) }
    }
    // 后台导出的是每条作品的累计数：同一条再导一次是更新，不是再加一份
    if (op.replace === true) {
      metric.imported = true
      const imported = row => row.imported && row.platform === metric.platform
      // 认同一条的顺序：作品 ID > 挂的内容 > 标题 + 平台 + 日期。标题在平台上可能改过，有 ID 时按 ID 认
      const byWork = row => Boolean(metric.workId) && row.workId === metric.workId
      // 两边都有作品 ID 却不一样：是两条不同的作品，即使挂的内容、标题一样也不合并
      const otherWork = row => Boolean(metric.workId) && Boolean(row.workId) && row.workId !== metric.workId
      const byItem = row => Boolean(metric.itemId) && row.itemId === metric.itemId && !otherWork(row)
      // 先按标题导入、后来才建了同名内容：旧的那条没挂内容，按标题认出来并挂上；反过来也一样
      const byTitle = row => Boolean(metric.title) && row.title === metric.title && (!row.itemId || !metric.itemId) && !otherWork(row)
      const byDay = row => !metric.workId && !metric.itemId && !metric.title && !row.workId && !row.itemId && !row.title && localDay(row.date) === localDay(metric.date)
      const index = [byWork, byItem, byTitle, byDay].map(match => state.metrics.findIndex(row => imported(row) && match(row))).find(i => i >= 0) ?? -1
      if (index >= 0) {
        // 整条换成这次导出的数：这次表里没有的列就是不知道，不沿用上次的。作品 ID 和挂的内容认过一次就留着
        const existing = state.metrics[index]
        const workId = metric.workId || existing.workId
        state.metrics[index] = { ...metric, id: existing.id, itemId: metric.itemId || existing.itemId || null, ...(workId ? { workId } : {}) }
        return { text: said('update') }
      }
    }
    state.metrics.push(metric)
    return { text: said('add') }
  },
  add_account(state, op, now) {
    const account = { id: newId('ac'), platform: '', handle: '', url: null, followers: null, createdAt: now, ...pick(ACCOUNT_FIELDS, op) }
    if (!account.platform && !account.handle && !account.url) throw new Error(tr('账号信息为空'))
    state.accounts.push(account)
    return { text: tr('添加账号档案「{name}」', { name: account.handle || account.title || platformName(account.platform) }), target: account.id, kind: 'account' }
  },
  update_account(state, op) {
    const account = findById(state.accounts, op.id)
    Object.assign(account, pick(ACCOUNT_FIELDS, op))
    return { text: tr('更新账号档案「{name}」', { name: account.handle || account.title || platformName(account.platform) }) }
  },
  log_followers(state, op, now) {
    const platform = ACCOUNT_PLATFORMS.includes(op.platform) ? op.platform : null
    if (!platform) throw new Error(tr('粉丝记录需要平台'))
    const followers = Number(op.followers)
    if (!Number.isFinite(followers) || followers < 0) throw new Error(tr('粉丝数要填 0 或更大的数字'))
    const date = logDate(op.date, now)
    const count = Math.round(followers)
    // fetchedAt：自动读到这个数的时间。手动记的没有，同一天手动改过就不再算自动读的
    const fetchedAt = op.fetchedAt === undefined ? undefined : coerce('date', op.fetchedAt) ?? undefined
    // source：自动读的来源；approx：页面上只给了「1.13万」这种约数
    const source = fetchedAt && SOURCE_RANK[op.source] ? op.source : undefined
    const approx = Boolean(fetchedAt && op.approx === true)
    state.followerLog ??= []
    const existing = state.followerLog.find(row => row.platform === platform && row.date === date && !row.sample)
    // 同一天已经有更可靠来源自动读到的数：这次不覆盖
    if (existing && fetchedAt && existing.fetchedAt && sourceRank(existing.source) > sourceRank(source)) {
      return { text: tr('{platform}今天已有更可靠来源的粉丝数，这次没覆盖', { platform: platformName(platform) }) }
    }
    const extra = { ...(fetchedAt ? { fetchedAt } : {}), ...(source ? { source } : {}), ...(approx ? { approx: true } : {}) }
    if (existing) {
      existing.followers = count
      for (const key of ['fetchedAt', 'source', 'approx']) delete existing[key]
      Object.assign(existing, extra)
    } else state.followerLog.push({ id: newId('fl'), platform, date, followers: count, ...extra })
    // 账号档案上的数字跟着最新的一天走，补记旧日期不会盖掉它
    const latest = state.followerLog.filter(row => row.platform === platform && !row.sample).reduce((a, b) => (a.date > b.date ? a : b))
    const account = state.accounts.find(row => row.platform === platform && !row.sample)
    if (account) account.followers = latest.followers
    else state.accounts.push({ id: newId('ac'), platform, handle: '', url: null, followers: latest.followers, createdAt: now })
    return { text: tr('记录{platform}粉丝 {followers}', { platform: platformName(platform), followers: count.toLocaleString('en-US') }) }
  },
  // 自动读到的账号级数字（获赞、作品数、h 指数……）和最新一条内容，同平台同一天一条，再读一次是更新
  log_account_stats(state, op, now) {
    const platform = ACCOUNT_PLATFORMS.includes(op.platform) ? op.platform : null
    if (!platform) throw new Error(tr('账号数据需要平台'))
    const date = logDate(op.date, now)
    const stats = Object.fromEntries([...ACCOUNT_STAT_KEYS, ...PERIOD_STAT_KEYS].map(key => [key, statValue(key, op.stats?.[key])]).filter(([, value]) => value !== undefined))
    const latest = cleanPost(op.latest)
    const top = cleanPost(op.top)
    if (!Object.keys(stats).length && !latest && !top) throw new Error(tr('没有可记的账号数据'))
    const source = SOURCE_RANK[op.source] ? op.source : undefined
    const current = (state.accountDaily ?? []).find(item => item.platform === platform && item.date === date)
    if (current && sourceRank(current.source) > sourceRank(source)) return { text: tr('{platform}今天已有更可靠来源的账号数据，这次没覆盖', { platform: platformName(platform) }) }
    // period：周期指标对应的统计周期原文（「近7日」）；approx：哪些项是约数
    const period = PERIOD_STAT_KEYS.some(key => key in stats) && typeof op.period === 'string' && op.period.trim() ? op.period.replace(/\s+/g, ' ').trim().slice(0, 40) : null
    const approx = Array.isArray(op.approx) ? [...new Set(op.approx.filter(key => key in stats))] : []
    const row = { id: newId('ad'), platform, date, fetchedAt: coerce('date', op.fetchedAt) ?? now, stats, ...(source ? { source } : {}), ...(period ? { period } : {}), ...(approx.length ? { approx } : {}), ...(latest ? { latest } : {}), ...(top ? { top } : {}) }
    const others = (state.accountDaily ?? []).filter(item => !(item.platform === platform && item.date === date))
    // 每个平台只留最近 MAX_ACCOUNT_DAYS 天，状态文件不会越长越大
    const mine = [...others.filter(item => item.platform === platform), row].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ACCOUNT_DAYS)
    state.accountDaily = [...others.filter(item => item.platform !== platform), ...mine]
    return { text: tr('记录{platform}账号数据', { platform: platformName(platform) }) }
  },
  set_author(state, op) {
    const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
    state.author = { bio: text(op.bio, 200), signature: text(op.signature, 60) }
    return { text: tr('更新作者信息') }
  },
  add_feed(state, op, now) {
    const url = coerce('url', op.url)
    if (!url) throw new Error(tr('订阅地址要以 http 或 https 开头'))
    state.feeds ??= []
    if (state.feeds.some(row => row.url === url)) throw new Error(tr('这个订阅源已经加过了'))
    if (state.feeds.length >= MAX_FEEDS) throw new Error(tr('最多 {n} 个订阅源', { n: MAX_FEEDS }))
    const feed = { id: newId('fd'), url, title: String(op.title ?? '').trim().slice(0, 40), createdAt: now }
    state.feeds.push(feed)
    return { text: tr('添加订阅源「{name}」', { name: feed.title || url }), target: feed.id, kind: 'feed' }
  },
  // 我的方向和不想看的词：给订阅和热榜排序、隐藏用。不传的那一项保持原样
  set_focus(state, op) {
    const focus = { topics: state.focus?.topics ?? [], blocked: state.focus?.blocked ?? [] }
    const reasons = { type: tr('方向要是一组文字'), length: tr('每个词不超过 20 个字'), count: tr('最多 {n} 个') }
    for (const [key, max] of [['topics', MAX_TOPICS], ['blocked', MAX_BLOCKED]]) {
      if (op[key] === undefined) continue
      const result = cleanWords(op[key], max)
      if (!result.ok) throw new Error(reasons[result.error].replace('{n}', String(max)))
      focus[key] = result.value
    }
    state.focus = focus
    return { text: focus.topics.length ? tr('更新我的方向：{topics}', { topics: focus.topics.join('、') }) : tr('清空我的方向') }
  },
  // 内置信息源分组的开关，默认全关
  set_builtin(state, op) {
    if (!BUILTIN_GROUP_IDS.includes(op.id)) throw new Error(tr('没有这个内置信息源'))
    if (typeof op.on !== 'boolean') throw new Error(tr('开关状态无效'))
    const current = (state.builtin ?? []).filter(id => id !== op.id)
    state.builtin = op.on ? [...current, op.id] : current
    return { text: op.on ? tr('打开内置信息源') : tr('关闭内置信息源') }
  },
  // 大屏下面那排显示哪些平台、按什么顺序。空列表表示「自动」：有数据的平台，没有就放最常用的几个
  set_board_platforms(state, op) {
    if (!Array.isArray(op.platforms)) throw new Error(tr('平台列表要是一组平台名'))
    // 用 findIndex 而不是 find：列表里混着 undefined 时 find 也返回 undefined，会被当成没问题
    const bad = op.platforms.findIndex(name => !ACCOUNT_PLATFORMS.includes(name))
    if (bad !== -1) throw new Error(tr('不认识的平台：{name}', { name: String(op.platforms[bad]).slice(0, 20) }))
    const platforms = [...new Set(op.platforms)]
    if (platforms.length) state.boardPlatforms = platforms
    else delete state.boardPlatforms
    return { text: platforms.length ? tr('大屏显示 {list}', { list: platforms.map(platformName).join('、') }) : tr('大屏平台改回自动') }
  },
  delete_feed(state, op) {
    findById(state.feeds ?? [], op.id)
    state.feeds = state.feeds.filter(row => row.id !== op.id)
    return { text: tr('删除订阅源') }
  },
  add_rival(state, op, now) {
    if (!ACCOUNT_PLATFORMS.includes(op.platform)) throw new Error(tr('对标账号需要平台'))
    const url = coerce('url', op.url)
    if (!url) throw new Error(tr('主页地址要以 http 或 https 开头'))
    const rivals = state.rivals ?? []
    if (rivals.some(row => row.url === url)) throw new Error(tr('这个账号已经加过了'))
    if (rivals.length >= MAX_RIVALS) throw new Error(tr('最多 {n} 个对标账号', { n: MAX_RIVALS }))
    const rival = { id: newId('rv'), platform: op.platform, url, name: String(op.name ?? '').trim().slice(0, 40), note: String(op.note ?? '').trim().slice(0, 400), createdAt: now }
    state.rivals = [...rivals, rival]
    return { text: tr('添加对标账号「{name}」', { name: rival.name || url }), target: rival.id, kind: 'rival' }
  },
  update_rival(state, op) {
    const rival = findById(state.rivals ?? [], op.id)
    const patch = {}
    if (typeof op.name === 'string') patch.name = op.name.trim().slice(0, 40)
    if (typeof op.note === 'string') patch.note = op.note.trim().slice(0, 400)
    // 上一次读取的结果：读不到时记下原因，下次打开还能看到为什么
    if (typeof op.fetchError === 'string') patch.fetchError = op.fetchError.slice(0, 300)
    const fetchedAt = coerce('date', op.fetchedAt)
    if (fetchedAt) patch.fetchedAt = fetchedAt
    state.rivals = state.rivals.map(row => (row.id === rival.id ? { ...row, ...patch } : row))
    return { text: tr('更新对标账号「{name}」', { name: patch.name ?? rival.name ?? rival.url }) }
  },
  delete_rival(state, op) {
    const rival = findById(state.rivals ?? [], op.id)
    state.rivals = state.rivals.filter(row => row.id !== op.id)
    state.rivalLog = (state.rivalLog ?? []).filter(row => row.rivalId !== op.id)
    state.rivalWorks = (state.rivalWorks ?? []).filter(row => row.rivalId !== op.id)
    return { text: tr('删除对标账号「{name}」', { name: rival.name || rival.url }) }
  },
  // 自动读取时写一笔：同一个账号同一天只留一条，以最后一次读到的为准
  log_rival(state, op, now) {
    const rival = findById(state.rivals ?? [], op.rivalId)
    const followers = Number(op.followers)
    if (!Number.isFinite(followers) || followers < 0) throw new Error(tr('粉丝数要填 0 或更大的数字'))
    const works = Number.isFinite(op.works) && op.works >= 0 ? Math.round(op.works) : undefined
    const date = localDay(now)
    const row = { rivalId: rival.id, date, followers: Math.round(followers), ...(works === undefined ? {} : { works }) }
    const log = state.rivalLog ?? []
    const existing = log.find(entry => entry.rivalId === rival.id && entry.date === date)
    state.rivalLog = existing ? log.map(entry => (entry === existing ? { id: entry.id, ...row } : entry)) : [...log, { id: newId('rl'), ...row }]
    // 没起名字的账号用读到的名字
    if (!rival.name && typeof op.name === 'string' && op.name.trim()) state.rivals = state.rivals.map(entry => (entry.id === rival.id ? { ...entry, name: op.name.trim().slice(0, 40) } : entry))
    return { text: tr('记录对标账号粉丝 {followers}', { followers: row.followers.toLocaleString('en-US') }) }
  },
  // 用户贴进来的对标作品表：同一个账号同名的作品是更新，整条换成这次的数，跟进状态保留
  add_rival_works(state, op, now) {
    const rival = findById(state.rivals ?? [], op.rivalId)
    const input = Array.isArray(op.works) ? op.works.slice(0, 1000) : []
    const valid = input.map(rivalWork).filter(Boolean)
    if (!valid.length) throw new Error(tr('没有能导入的作品：每条要有标题和日期'))
    let list = [...(state.rivalWorks ?? [])]
    let added = 0
    for (const work of valid) {
      const old = list.find(row => row.rivalId === rival.id && row.title === work.title)
      if (old) list = list.map(row => (row === old ? { id: old.id, rivalId: rival.id, ...work, addedAt: old.addedAt, ...(old.status ? { status: old.status } : {}) } : row))
      else {
        list = [...list, { id: newId('rw'), rivalId: rival.id, ...work, addedAt: now }]
        added += 1
      }
    }
    // 每个账号最多留 200 条，超出时去掉发布日期最早的
    const drop = new Set(list.filter(row => row.rivalId === rival.id).sort((a, b) => b.date.localeCompare(a.date)).slice(MAX_RIVAL_WORKS).map(row => row.id))
    state.rivalWorks = list.filter(row => !drop.has(row.id))
    const skipped = input.length - valid.length
    return { text: tr('导入「{name}」的作品：新增 {added} 条，更新 {updated} 条', { name: rival.name || rival.url, added, updated: valid.length - added }) + (skipped ? tr('；{n} 条缺标题、日期或数字不对，没导入', { n: skipped }) : '') }
  },
  set_rival_work(state, op) {
    const work = findById(state.rivalWorks ?? [], op.id)
    if (op.status !== null && !RIVAL_WORK_STATUS.includes(op.status)) throw new Error(tr('作品状态无效'))
    state.rivalWorks = state.rivalWorks.map((row) => {
      if (row !== work) return row
      const { status: _old, ...rest } = row
      return op.status === null ? rest : { ...rest, status: op.status }
    })
    return { text: tr('更新作品《{title}》', { title: short(work.title) }) }
  },
  delete_rival_work(state, op) {
    const work = findById(state.rivalWorks ?? [], op.id)
    state.rivalWorks = state.rivalWorks.filter(row => row.id !== op.id)
    return { text: tr('删除作品《{title}》', { title: short(work.title) }) }
  },
  delete_account(state, op) {
    findById(state.accounts, op.id)
    state.accounts = state.accounts.filter(row => row.id !== op.id)
    return { text: tr('删除账号档案') }
  },
  // 排版的「我的主题」：结构和 CSS 属性按内置主题校验，见 layout-theme.js
  save_layout_theme(state, op) {
    const theme = validateLayoutTheme(op.theme)
    const list = state.layoutThemes ?? []
    const exists = list.some(row => row.id === theme.id)
    if (!exists && list.length >= MAX_LAYOUT_THEMES) throw new Error(tr('最多保存 {n} 套自己的主题', { n: MAX_LAYOUT_THEMES }))
    state.layoutThemes = exists ? list.map(row => (row.id === theme.id ? theme : row)) : [...list, theme]
    return { text: tr('保存排版主题「{name}」', { name: theme.name }) }
  },
  delete_layout_theme(state, op) {
    const theme = (state.layoutThemes ?? []).find(row => row.id === op.id)
    if (!theme) throw new Error(tr('找不到这套主题'))
    state.layoutThemes = state.layoutThemes.filter(row => row.id !== op.id)
    return { text: tr('删除排版主题「{name}」', { name: theme.name }) }
  },
  // 收入：记一笔、删一笔，见 income.js
  ...incomeHandlers(newId),
  clear_samples(state) {
    state.items = state.items.filter(row => !row.sample)
    state.people = state.people.filter(row => !row.sample)
    state.angles = state.angles.filter(row => !row.sample)
    state.metrics = state.metrics.filter(row => !row.sample)
    state.metricSamples = (state.metricSamples ?? []).filter(row => !row.sample)
    state.accounts = state.accounts.filter(row => !row.sample)
    state.followerLog = (state.followerLog ?? []).filter(row => !row.sample)
    state.skills = state.skills.filter(row => !row.sample)
    state.styles = (state.styles ?? []).filter(row => !row.sample)
    if (!state.styles.some(row => row.id === state.activeStyleId)) state.activeStyleId = null
    // 自己的数据可能挂在示例内容下面：父条目没了就断开，指标没了对应内容就删掉
    const ids = new Set(state.items.map(row => row.id))
    for (const row of state.items) if (row.parentId && !ids.has(row.parentId)) row.parentId = null
    state.metrics = state.metrics.filter(row => !row.itemId || ids.has(row.itemId))
    state.sampleCleared = true
    return { text: tr('已清空全部示例数据') }
  },
}

/**
 * 依次执行一批操作。任何一条失败都不影响已成功的操作，失败写进回执。
 * @param {object} state - 会被就地修改的状态。
 * @param {Array<object>} ops - 操作列表。
 * @returns {{receipts: Array<object>, errors: string[]}} 面向用户的回执。
 */
export function applyOps(state, ops) {
  const receipts = []
  const errors = []
  const now = new Date().toISOString()
  for (const op of Array.isArray(ops) ? ops : []) {
    const handler = Object.hasOwn(handlers, op?.op) ? handlers[op.op] : undefined
    if (!handler) {
      errors.push(tr('不支持的操作：{op}', { op: String(op?.op) }))
      continue
    }
    try {
      const receipt = handler(state, op, now)
      if (receipt) receipts.push(receipt)
    } catch (err) {
      errors.push(err.message)
    }
  }
  return { receipts, errors }
}
