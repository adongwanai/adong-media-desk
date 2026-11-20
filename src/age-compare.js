// 同龄对比：拿这一篇和上一篇在「发布后第 1/3/7 天」的数据比。纯函数，规则参考麦田的 review。
// 按发布后第 N 天取那一时刻的数据，和上一期的同龄数据比；那一期那个时间点没有真实数据就是 null，
// 不硬比，也不拿 0 当分母。同一篇在多个平台有数据时按平台分开，另外给一个合计。
// 数据的「观察时间」：从创作后台导入的每条作品行是抓取那一刻的累计数（fetchedAt）；
// 手动记的、粘贴表里带观察日期的，按记录日期（date）算。
// 纯函数，不引用 node 模块；要拼成句子时由调用方把翻译函数传进来（Host 用 tr，浏览器用 t）。

const DAY = 86_400_000
// 目标日之后几天内记的数还算这一期的：发布后 N 天到 N+2 天
const WINDOW_DAYS = 2
const ARTICLE_PLATFORMS = new Set(['公众号', '知乎', '头条'])
const VIDEO_PLATFORMS = new Set(['抖音', 'B站', '视频号', 'TikTok', 'YouTube'])

export const AGES = [1, 3, 7]

/** 本地时区的 YYYY-MM-DD。 */
export function dayKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 按本地时区的日历日加 n 天。 */
function addDays(key, n) {
  const [year, month, day] = key.split('-').map(Number)
  return dayKey(new Date(year, month - 1, day + n, 12))
}

/**
 * 「views」在这批数据里叫什么：记了这个数的平台全是图文平台叫阅读，全是视频平台叫播放，混着就是「阅读/播放」。
 * @param {string[]} platforms - 记了 views 的平台。
 * @returns {'阅读'|'播放'|'阅读/播放'}
 */
export function viewWord(platforms) {
  const list = [...new Set(platforms.filter(Boolean))]
  if (list.length && list.every(p => ARTICLE_PLATFORMS.has(p))) return '阅读'
  if (list.length && list.every(p => VIDEO_PLATFORMS.has(p))) return '播放'
  return '阅读/播放'
}

/**
 * 这条数据是什么时候观察到的：导入的作品行是抓取那一刻的累计数，按 fetchedAt 算；
 * 手动记的、粘贴表里给的是哪天就按哪天算。没有可用的时间就是 null。
 */
export function observedAt(metric) {
  const date = Date.parse(metric?.date ?? '')
  const fetched = Date.parse(metric?.fetchedAt ?? '')
  if (Number.isFinite(date) && Number.isFinite(fetched) && fetched >= date) return fetched
  return Number.isFinite(date) ? date : null
}

/** 这一篇的发布时间：publishedAt，或者某个平台记了「已发布」的时间。 */
export function publishedAtOf(item) {
  if (item?.publishedAt && Number.isFinite(Date.parse(item.publishedAt))) return item.publishedAt
  const rows = Object.values(item?.publish ?? {}).filter(row => row?.state === 'published' && Number.isFinite(Date.parse(row.at ?? '')))
  return rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]?.at ?? null
}

/** 赞评藏转里记了的那几项之和；一项都没记就是 null，不当 0。 */
function engagementOf(metric) {
  const parts = [metric.likes, metric.comments, metric.shares, metric.saves, metric.recommends].filter(Number.isFinite)
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null
}

/**
 * 这一篇在「发布后第 age 天」的数据：当天或之后最近的一条，且必须在发布后 age+2 天内；没有就是 null。
 * 同一篇在多个平台有数据时按平台分开，各平台取离目标最近的那一条。
 * @param {Array<object>} metrics - 全部数据记录（带 itemId、platform、date、fetchedAt、views…）。
 * @param {{id: string, publishedAt?: string, publish?: object}} piece - 一篇内容。
 * @param {number} age - 发布后第几天。
 * @returns {{age: number, day: string, at: string, rows: Array<object>, views: number|null, engaged: number|null, word: string}|null}
 */
export function snapshotAt(metrics, piece, age) {
  const published = Date.parse(publishedAtOf(piece) ?? '')
  if (!Number.isFinite(published)) return null
  const start = addDays(dayKey(published), age)
  const end = addDays(dayKey(published), age + WINDOW_DAYS)
  const candidates = new Map()
  ;(metrics ?? []).forEach((metric, index) => {
    if (!metric || metric.sample || metric.itemId !== piece.id || !metric.platform) return
    const at = observedAt(metric)
    if (at === null) return
    const day = dayKey(at)
    if (day < start || day > end) return
    candidates.set(metric.platform, [...(candidates.get(metric.platform) ?? []), { metric, day, at, index }])
  })
  if (!candidates.size) return null
  const rows = [...candidates.entries()].map(([platform, list]) => {
    // 离目标最近的是最早的那天；同一天记了几条，以最后记的为准
    const day = list.map(row => row.day).sort()[0]
    const hit = list.filter(row => row.day === day).sort((a, b) => a.index - b.index).at(-1)
    return { platform, at: new Date(hit.at).toISOString(), day: hit.day, views: Number.isFinite(hit.metric.views) ? hit.metric.views : null, engaged: engagementOf(hit.metric) }
  }).sort((a, b) => ((b.views ?? -1) - (a.views ?? -1)) || a.platform.localeCompare(b.platform))
  const views = rows.map(row => row.views).filter(Number.isFinite)
  const engaged = rows.map(row => row.engaged).filter(Number.isFinite)
  return {
    age, day: start,
    // 数据取于何时：几条里最早的那个观察时间（离目标最近）
    at: new Date(rows.map(row => Date.parse(row.at)).sort((a, b) => a - b)[0]).toISOString(),
    rows,
    views: views.length ? views.reduce((a, b) => a + b, 0) : null,
    engaged: engaged.length ? engaged.reduce((a, b) => a + b, 0) : null,
    word: viewWord(rows.filter(row => Number.isFinite(row.views)).map(row => row.platform)),
  }
}

/** 倍数：上一篇大于 0 才算得出来；算不出来就是 null，不拿 0 当分母。 */
export function ratioOf(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return { ratio: current / previous, percent: Math.round((current / previous) * 100) }
}

/**
 * 一篇内容在某个龄期上的同龄对比：这一篇和上一篇各自「发布后第 age 天」的数据。
 * @param {{metrics: Array<object>, current: object, previous?: object|null, age: number}} input
 * @returns {object} current / previous 是各自的快照；overall 是合计对比；platforms 是按平台的对比；
 *   reason 说明为什么比不了：no-previous（还没有上一篇）、no-current（这一篇那天没数据）、
 *   no-previous-data（上一篇那天没数据）、no-previous-views（上一篇那天没记播放）。
 */
export function compareAtAge({ metrics, current, previous, age }) {
  const cur = snapshotAt(metrics, current, age)
  const prev = previous ? snapshotAt(metrics, previous, age) : null
  const result = { age, current: cur, previous: prev, overall: null, platforms: [], reason: null }
  if (!previous) return { ...result, reason: 'no-previous' }
  if (!cur) return { ...result, reason: 'no-current' }
  if (!prev) return { ...result, reason: 'no-previous-data' }
  const views = ratioOf(cur.views, prev.views)
  result.overall = { views, engaged: ratioOf(cur.engaged, prev.engaged) }
  const platforms = new Set([...cur.rows.map(row => row.platform), ...prev.rows.map(row => row.platform)])
  result.platforms = [...platforms].map((platform) => {
    const a = cur.rows.find(row => row.platform === platform)
    const b = prev.rows.find(row => row.platform === platform)
    return { platform, current: a?.views ?? null, previous: b?.views ?? null, views: ratioOf(a?.views, b?.views) }
  }).filter(row => row.views).sort((a, b) => ((b.current ?? -1) - (a.current ?? -1)) || a.platform.localeCompare(b.platform))
  if (!views) result.reason = 'no-previous-views'
  return result
}

/**
 * 这一篇和上一篇在三个龄期上的对比。
 * latest 是「这一篇有数据」的龄期里最靠后的一天，界面上通常只写这一条；一次数据都没有就是 null。
 * @param {{metrics: Array<object>, current: object, previous?: object|null, ages?: number[]}} input
 * @returns {{at: string|null, previous: object|null, ages: Array<object>, latest: object|null}}
 */
export function compareAges({ metrics, current, previous = null, ages = AGES }) {
  const at = publishedAtOf(current)
  const rows = at ? ages.map(age => compareAtAge({ metrics, current, previous, age })) : []
  const latest = [...rows].reverse().find(row => row.current && Number.isFinite(row.current.views)) ?? null
  return {
    at,
    mine: { id: current.id, title: current.title ?? '', publishedAt: at },
    previous: previous ? { id: previous.id, title: previous.title ?? '', publishedAt: publishedAtOf(previous) } : null,
    ages: rows,
    latest,
  }
}

/**
 * 这一篇之前最近的一篇已发布内容：按发布时间，不按平台。
 * 给了 metrics 时优先取「有数据」的最近一篇，免得上一篇只是排了期、一条数都没记时永远没法比。
 * @param {Array<object>} items - 全部内容。
 * @param {{id: string}} current - 这一篇。
 * @param {{metrics?: Array<object>}} [options]
 * @returns {object|null} 上一篇；没有就是 null。
 */
export function previousPublished(items, current, { metrics = null } = {}) {
  const at = Date.parse(publishedAtOf(current) ?? '')
  if (!Number.isFinite(at)) return null
  const before = (items ?? []).filter((item) => {
    if (!item || item.sample || item.parentId || item.id === current?.id) return false
    const when = Date.parse(publishedAtOf(item) ?? '')
    return Number.isFinite(when) && when < at
  }).sort((a, b) => Date.parse(publishedAtOf(b)) - Date.parse(publishedAtOf(a)))
  if (!before.length) return null
  if (!metrics) return before[0]
  const hasData = item => metrics.some(metric => !metric.sample && metric.itemId === item.id)
  return before.find(hasData) ?? before[0]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// 整句进词典，英文不用拼「次」和「阅读」
const REACH = { 阅读: '{views} 次阅读', 播放: '{views} 次播放', '阅读/播放': '{views} 次阅读/播放' }
const fmtNum = value => Math.round(value).toLocaleString('en-US')
/** 「11月3日」；英文交给词典里的 {m}月{d}日 那条。 */
const shortDate = (iso, t) => {
  const d = new Date(iso)
  return t('{m}月{d}日', { m: d.getMonth() + 1, d: d.getDate(), mon: MONTHS[d.getMonth()] })
}

/** 倍数或百分比：涨了写「1.8 倍」，不到上一篇写「43%」。 */
export function timesText(views, t) {
  if (!views) return ''
  return views.ratio >= 1 ? t('{n} 倍', { n: views.ratio >= 10 ? String(Math.round(views.ratio)) : views.ratio.toFixed(1) }) : t('{n}%', { n: String(views.percent) })
}

/**
 * 一句话的同龄对比，给复盘页的单篇诊断用。
 * 「发帖后第 3 天：全平台 3,120 次播放，是上一篇同时点的 1.8 倍；其中小红书 2.4 倍、抖音 0.7 倍」
 * 数据不够时写「上一篇第 3 天没有数据，无法对比」。没有上一篇、或者这一篇那天还没数据时不生成。
 * @param {ReturnType<typeof compareAges>} compare
 * @returns {{text: string, note: string, age: number, reason: string}|null}
 */
export function ageLine(compare, t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (match, key) => (vars?.[key] === undefined ? match : String(vars[key])))) {
  const { latest, previous } = compare ?? {}
  if (!latest || !previous) return null
  const n = latest.age
  const views = latest.current
  if (!latest.overall?.views) {
    const reason = latest.reason === 'no-previous-views'
      ? t('上一篇第 {n} 天没记播放，无法对比', { n })
      : t('上一篇第 {n} 天没有数据，无法对比', { n })
    return { text: t('发帖后第 {n} 天：{reason}', { n, reason }), note: '', age: n, reason: latest.reason }
  }
  const compareText = latest.overall.views.ratio >= 1
    ? t('是上一篇同时点的 {n}', { n: timesText(latest.overall.views, t) })
    : t('只有上一篇同时点的 {n}', { n: timesText(latest.overall.views, t) })
  const reach = t(REACH[views.word], { views: fmtNum(views.views) })
  // 分平台一律写倍数（0.7 倍也写倍数，读起来是同一个尺子）
  const list = latest.platforms.slice(0, 3).map(row => `${t(row.platform)} ${t('{n} 倍', { n: row.views.ratio >= 10 ? String(Math.round(row.views.ratio)) : row.views.ratio.toFixed(1) })}`).join(t('、'))
  const text = list
    ? t('发帖后第 {n} 天：全平台 {views}，{compare}；其中{list}。', { n, views: reach, compare: compareText, list })
    : t('发帖后第 {n} 天：全平台 {views}，{compare}。', { n, views: reach, compare: compareText })
  const mine = t('这一篇《{title}》{date}发布', { title: compare.mine?.title ?? '', date: shortDate(compare.at, t) })
  const rival = t('上一篇《{title}》{date}发布', { title: previous.title, date: shortDate(previous.publishedAt, t) })
  const observed = t('数据取于 {date}', { date: shortDate(views.at, t) })
  return { text, note: t('对照：{mine}，{rival}；{observed}', { mine, rival, observed }), age: n, reason: null }
}

/**
 * 每篇有发布时间的内容一条诊断用的同龄对比：按 itemId 建表，只放能出一句话的。
 * @param {{items: Array<object>, metrics: Array<object>}} state
 * @returns {Map<string, {text: string, note: string, age: number, reason: string|null}>}
 */
export function ageLinesByItem(state, t) {
  const out = new Map()
  const metrics = state.metrics ?? []
  for (const item of state.items ?? []) {
    if (!item || item.sample || item.parentId || out.has(item.id)) continue
    if (!publishedAtOf(item)) continue
    const previous = previousPublished(state.items, item, { metrics })
    if (!previous) continue
    const line = ageLine(compareAges({ metrics, current: { ...item, title: item.production?.title || item.title }, previous }), t)
    if (line) out.set(item.id, { text: line.text, note: line.note, age: line.age, reason: line.reason })
  }
  return out
}

/** 大屏「最新发布」卡片上的那一行：上一篇在同一个龄期有数据、算得出倍数时才有。 */
export function boardAgeLine(metrics, current, previous, t) {
  if (!current || !previous) return null
  const line = ageLine(compareAges({ metrics, current, previous }), t)
  return line && !line.reason ? { text: line.text, age: line.age } : null
}

export { DAY, WINDOW_DAYS }
