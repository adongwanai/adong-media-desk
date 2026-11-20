// 单条作品的时间序列：发布后 72 小时内的加密采样、按作品查「某一刻的数」、采样点容量。
// 这里全是纯函数，不碰浏览器也不碰文件。
// 采样点存在 state.metricSamples 里：每行带 ts（采样的时间），date 仍是这条作品的发布日期。
// 日表（state.metrics）不受影响：同一天既有日表也有采样时各算各的，大屏和复盘不会把采样当天的数加两遍。
import { cleanWorkId } from './work-id.js'

// 每条作品最多留多少个采样点，超了丢最旧的
export const MAX_SAMPLES_PER_WORK = 60
// 全部采样点的上限，按时间淘汰最旧的
export const MAX_SAMPLES = 5000
// 发布后多久之内加密采样
export const SAMPLE_WINDOW_HOURS = 72
// 加密采样间隔：头 72 小时每 6 小时一次
export const SAMPLE_GAP_MS = 6 * 3600_000
// 72 小时以后回到每天两次（由每天两轮的常规读取接手），这里不再另外跑
export const SAMPLE_COOL_GAP_MS = 12 * 3600_000

/** 按这台电脑的时区取日期。 */
function localDay(value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 一条数据属于哪条作品：作品 ID 优先，其次挂的内容，再其次标题+平台。和 add_metric 的去重顺序一致。
 * @param {object} row - 一条数据（日表或采样点）。
 * @returns {string|null} 认不出这条作品时是 null。
 */
export function workKeyOf(row) {
  if (!row?.platform) return null
  const workId = cleanWorkId(row.workId)
  if (workId) return `w:${row.platform}|${workId}`
  if (row.itemId) return `i:${row.platform}|${row.itemId}`
  if (row.title) return `t:${row.platform}|${row.title}`
  return null
}

/**
 * 现在该不该给一条作品再采一次。纯函数。
 * 发布后 72 小时内每 6 小时一次；72 小时以后由每天两轮的常规读取接手，这里不再加密采样。
 * 发布时间看不懂、还没发布、上次采样就在刚刚（时钟偏了）都不采。
 * @param {{now: Date|number|string, lastSampleAt?: string|null, publishedAt?: string|null}} input
 * @returns {{due: boolean, intervalMs: number|null}} intervalMs：这次该用的间隔；不该采时是 null。
 */
export function sampleDue({ now, lastSampleAt = null, publishedAt = null } = {}) {
  const at = now instanceof Date ? now.getTime() : Date.parse(String(now ?? ''))
  const published = Date.parse(String(publishedAt ?? ''))
  const none = { due: false, intervalMs: null }
  if (!Number.isFinite(at) || !Number.isFinite(published)) return none
  const age = at - published
  if (age < 0 || age > SAMPLE_WINDOW_HOURS * 3600_000) return none
  const last = Date.parse(String(lastSampleAt ?? ''))
  if (!Number.isFinite(last)) return { due: true, intervalMs: SAMPLE_GAP_MS }
  return { due: at - last >= SAMPLE_GAP_MS, intervalMs: SAMPLE_GAP_MS }
}

/**
 * 把一个新的采样点并进采样列表：同一个作品同一个小时里只留一条（这一小时内的重复采样是更新），
 * 每条作品最多 60 个点、总共最多 5000 个，超了丢最旧的。纯函数，返回新列表。
 * @param {Array<object>} samples - 现有的采样点。
 * @param {object} point - 新的采样点，必须有 ts、platform 和至少一个能认出作品的身份字段。
 * @returns {Array<object>} 新的采样列表。
 */
export function pushSample(samples, point, { perWork = MAX_SAMPLES_PER_WORK, total = MAX_SAMPLES } = {}) {
  const list = Array.isArray(samples) ? samples : []
  const key = workKeyOf(point)
  if (!key || !point?.ts) return list
  const hour = String(point.ts).slice(0, 13)
  const same = list.findIndex(row => workKeyOf(row) === key && String(row.ts ?? '').slice(0, 13) === hour)
  const next = same >= 0 ? list.map((row, index) => (index === same ? { ...point, id: row.id ?? point.id } : row)) : [...list, point]
  // 每条作品只留最近的 perWork 个点
  const mine = next.filter(row => workKeyOf(row) === key).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  const dropped = new Set(mine.slice(0, Math.max(0, mine.length - perWork)).map(row => row.id))
  const kept = dropped.size ? next.filter(row => !dropped.has(row.id)) : next
  if (kept.length <= total) return kept
  // 总量超了：按采样时间淘汰最旧的
  return [...kept].sort((a, b) => String(a.ts).localeCompare(String(b.ts))).slice(kept.length - total)
}

/**
 * 一条作品在时刻 at 的数：有采样用采样（取不晚于 at 的最后一条），没有就用日表里不晚于那天的最后一条。
 * 采样和日表都有时，谁的日期更新用谁的；一样新时用采样（更精确）。
 * @param {Array<object>} metrics - 日表和采样点混在一起的列表都行（state.metricSamples + state.metrics）。
 * @param {{workId?: string|null, itemId?: string|null, title?: string|null, platform?: string|null, at?: Date|string|null}} target
 *   workId / itemId / title 按这个顺序认作品；platform 给了就只在那个平台里找；at 是目标时刻（不给就是现在之前全部）。
 * @returns {object|null} 选中的那条（带 source：'sample' 或 'daily'；at：那一刻），没有就是 null。
 */
export function metricAt(metrics, { workId = null, itemId = null, title = null, platform = null, at = null } = {}) {
  const cutoff = at instanceof Date ? at.getTime() : at === null || at === undefined ? Infinity : Date.parse(String(at))
  if (Number.isNaN(cutoff)) return null
  const wantedWork = cleanWorkId(workId)
  const sameWork = (row) => {
    if (!row || typeof row !== 'object') return false
    if (platform && row.platform !== platform) return false
    if (wantedWork && row.workId) return row.workId === wantedWork
    if (itemId && row.itemId) return row.itemId === itemId
    if (title && row.title) return row.title === title
    return false
  }
  let sample = null
  let daily = null
  for (const row of Array.isArray(metrics) ? metrics : []) {
    if (!sameWork(row)) continue
    if (row.ts) {
      const ts = Date.parse(String(row.ts))
      if (!Number.isFinite(ts) || ts > cutoff) continue
      if (!sample || ts > Date.parse(String(sample.ts))) sample = row
    } else {
      const day = localDay(row.date)
      if (!day || (Number.isFinite(cutoff) && day > localDay(cutoff))) continue
      if (!daily || String(row.date) > String(daily.date)) daily = row
    }
  }
  if (sample && (!daily || String(sample.ts).slice(0, 10) >= localDay(daily.date))) return { ...sample, source: 'sample', at: sample.ts }
  if (daily) return { ...daily, source: 'daily', at: daily.date }
  return sample ? { ...sample, source: 'sample', at: sample.ts } : null
}

/**
 * 发布后 72 小时内、还值得加密采样的作品。编号、标题任一相同就算同一条，合成的记录补上后来读到的 ID。
 * @param {object} state - 当前状态。
 * @param {Date} [now]
 * @returns {Array<{platform: string, workId: string|null, itemId: string|null, title: string|null, date: string}>}
 */
export function youngWorks(state, now = new Date()) {
  const at = now instanceof Date ? now.getTime() : Date.parse(String(now ?? ''))
  if (!Number.isFinite(at)) return []
  const rows = [...(state?.metricSamples ?? []), ...(state?.metrics ?? [])]
  const merged = []
  const absorb = (row) => {
    const published = Date.parse(String(row?.date ?? ''))
    if (!row?.platform || row.sample) return
    if (!Number.isFinite(published) || published > at || at - published > SAMPLE_WINDOW_HOURS * 3600_000) return
    const same = merged.find(work => work.platform === row.platform && ((work.workId && row.workId && work.workId === row.workId) || (work.title && row.title && work.title === row.title) || (work.itemId && row.itemId && work.itemId === row.itemId)))
    if (same) {
      same.workId ??= cleanWorkId(row.workId)
      same.itemId ??= row.itemId ?? null
      same.title ??= row.title ?? null
      return
    }
    merged.push({ platform: row.platform, workId: cleanWorkId(row.workId), itemId: row.itemId ?? null, title: row.title ?? null, date: row.date })
  }
  for (const row of rows) absorb(row)
  return merged
}

/** 一条作品最近一次拿到数的时间：采样点的 ts，或日表那次读取的 fetchedAt。 */
export function lastSampleAt(state, work) {
  const at = (row) => {
    if (!row || row.sample) return NaN
    const samePlatform = !work?.platform || row.platform === work.platform
    const belongs = samePlatform && ((work?.workId && row.workId === work.workId) || (work?.itemId && row.itemId === work.itemId) || (work?.title && row.title === work.title))
    if (!belongs) return NaN
    return Date.parse(String(row.ts ?? row.fetchedAt ?? ''))
  }
  const times = [...(state?.metricSamples ?? []), ...(state?.metrics ?? [])].map(at).filter(Number.isFinite)
  return times.length ? new Date(Math.max(...times)).toISOString() : null
}
