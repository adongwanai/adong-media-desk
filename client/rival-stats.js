// 对标账号的走势：只用真正记下的日子算涨跌，没记的那天不拿前后的数顶替（和大屏一个规矩）。
const DAYS = 30

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' 往前或往后挪几天，按本地日历算。 */
export function shiftDate(date, offset) {
  const [y, m, d] = date.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + offset, 12))
}

/**
 * 一个对标账号的当前粉丝、涨跌和走势。
 * @param {Array<{rivalId: string, date: string, followers: number, works?: number}>} log - state.rivalLog。
 * @param {string} rivalId - 对标账号 id。
 * @param {Date} [now] - 基准时间。
 * @returns {{followers: number|null, works: number|null, loggedAt: string|null, d1: number|null, d7: number|null, spark: Array<{date: string, followers: number}>}} 读数和涨跌；两头没记全就是 null。
 */
export function rivalTrend(log, rivalId, now = new Date()) {
  const rows = log.filter(row => row.rivalId === rivalId).sort((a, b) => a.date.localeCompare(b.date))
  const last = rows.at(-1) ?? null
  const today = dayKey(now)
  const on = date => rows.find(row => row.date === date)?.followers ?? null
  // 最新一条得是今天或昨天记的，才算「现在」
  const fresh = Boolean(last) && last.date >= shiftDate(today, -1)
  const diff = (before) => (fresh && before !== null ? last.followers - before : null)
  return {
    followers: last?.followers ?? null,
    works: Number.isFinite(last?.works) ? last.works : null,
    loggedAt: last?.date ?? null,
    d1: last ? diff(on(shiftDate(last.date, -1))) : null,
    d7: diff(on(shiftDate(today, -7)) ?? on(shiftDate(today, -8))),
    spark: rows.filter(row => row.date >= shiftDate(today, -(DAYS - 1)) && row.date <= today).map(row => ({ date: row.date, followers: row.followers })),
  }
}

/** 自己在某个平台最近一次记下的粉丝数；示例数据不算。 */
export function myFollowers(followerLog, platform) {
  const rows = (followerLog ?? []).filter(row => row.platform === platform && !row.sample)
  if (!rows.length) return null
  const last = rows.reduce((a, b) => (a.date >= b.date ? a : b))
  return { followers: last.followers, date: last.date }
}
