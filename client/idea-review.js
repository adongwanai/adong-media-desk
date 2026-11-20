// 灵感页「今日回顾」：从自己记下、放了很久没动的灵感里挑 3 条拿出来看看。纯函数，Node 里能测。
// 同一天里挑出来的固定不变（按日期和 ID 算），换一天换一批；够格的不到 3 条就不显示。
import { dayKey, hash } from './util.js'

export const REVIEW_COUNT = 3
const MIN_AGE_DAYS = 7
// 从最久没动的这么多条里按天轮换，免得天天都是同样三条
const POOL = 9
const DAY_MS = 86_400_000

/** 这条灵感最后一次被动过的时间：记下、写草稿、开始成稿，取最晚的那个；一个都读不出来时是 NaN。 */
export function lastTouched(item) {
  const times = [item.createdAt, item.production?.startedAt, ...Object.values(item.drafts ?? {}).map(draft => draft?.at)]
    .map(value => Date.parse(value ?? ''))
    .filter(Number.isFinite)
  return times.length ? Math.max(...times) : Number.NaN
}

/** 能拿出来回顾的：自己记的（不是导入的、不是示例）、还是灵感状态、7 天以上没动、没被设成先不提醒。 */
export function reviewable(item, now = Date.now()) {
  if (item.parentId || item.imported || item.sample || item.status !== 'idea') return false
  const touched = lastTouched(item)
  if (!Number.isFinite(touched) || now - touched < MIN_AGE_DAYS * DAY_MS) return false
  const snoozed = Date.parse(item.reviewSnoozedUntil ?? '')
  return !(Number.isFinite(snoozed) && snoozed > now)
}

/**
 * 今天回顾哪几条。
 * @param {Array<object>} items - 全部内容。
 * @param {Date|number} [now] - 现在；测试时固定。
 * @returns {Array<object>} 0 条或 3 条，最久没动的排在前面。
 */
export function pickReview(items, now = new Date()) {
  const at = typeof now === 'number' ? now : now.getTime()
  const day = dayKey(at)
  const pool = (Array.isArray(items) ? items : [])
    .filter(item => reviewable(item, at))
    .sort((a, b) => lastTouched(a) - lastTouched(b) || String(a.id).localeCompare(String(b.id)))
  if (pool.length < REVIEW_COUNT) return []
  return pool.slice(0, POOL)
    .map(item => ({ item, order: hash(`${day}|${item.id}`) }))
    .sort((a, b) => a.order - b.order)
    .slice(0, REVIEW_COUNT)
    .map(row => row.item)
    .sort((a, b) => lastTouched(a) - lastTouched(b))
}

/** 多少天没动了（向下取整）。 */
export function idleDays(item, now = new Date()) {
  const at = typeof now === 'number' ? now : now.getTime()
  return Math.floor((at - lastTouched(item)) / DAY_MS)
}
