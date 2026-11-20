// 一轮自动读取里，两种来源（主页链接、登录后的创作后台）的结果怎么合并、怎么记、怎么写进数据。纯函数。
import { SOURCE_RANK } from './ops.js'
import { localDay } from './daily-read.js'
import { titleMatcher } from './title-match.js'
import { workIdFromText } from './work-id.js'

const sourceOf = row => row.source ?? 'public'

/** 这个平台这一轮算不算读到了：读到主数字、账号级数字，或者读到了作品的数。顶栏计数和提示都按它算。 */
export function succeeded(row) {
  return row.followers !== null || (row.posts?.length ?? 0) > 0 || (row.source === 'backstage' && (Object.keys(row.stats ?? {}).length > 0 || Boolean(row.latest)))
}

/** 一个平台的结果在记录里的样子：成功的记数，失败的记原因，另外记下读到了哪些项、来源、要不要重新登录、有没有待确认的数。 */
export function resultRow(row) {
  const got = [...Object.keys(row.stats ?? {}), ...(row.latest ? ['latest'] : [])]
  const clip = text => String(text).slice(0, 300)
  return {
    platform: row.platform,
    ok: succeeded(row),
    ...(row.followers !== null ? { followers: row.followers } : {}),
    ...(row.followersApprox ? { followersApprox: true } : {}),
    ...(row.error ? { error: clip(row.error) } : {}),
    ...(got.length ? { got } : {}),
    ...(sourceOf(row) !== 'public' ? { source: sourceOf(row) } : {}),
    ...(row.posts?.length ? { posts: row.posts.length } : {}),
    ...(row.backstageError ? { backstageError: clip(row.backstageError) } : {}),
    ...(row.postsError ? { postsError: clip(row.postsError) } : {}),
    ...(row.needLogin ? { needLogin: true } : {}),
    ...(row.pending ? { pending: { followers: row.pending.followers, previous: row.pending.previous, reason: clip(row.pending.reason) } } : {}),
  }
}

/**
 * 读到的结果换成写入操作：主数字记进粉丝记录，其他项和最新一条记进当天的账号数据，都带上来源（高的不被低的覆盖）。
 * 创作后台读到的每条作品写成 add_metric（replace，同一条再读是更新）：日期用发布时间，标题和工作台里的内容对得上就挂上。
 */
export function resultOps(results, fetchedAt, items = []) {
  // 账号数据的日期用这次读取的时间（本机时区），不用机器上拨一下就走偏的当前时间
  const day = localDay(fetchedAt)
  const owner = titleMatcher(items)
  return results.flatMap(row => [
    ...(row.followers !== null ? [{ op: 'log_followers', platform: row.platform, followers: row.followers, date: day, fetchedAt, source: row.followersSource ?? sourceOf(row), ...(row.followersApprox ? { approx: true } : {}) }] : []),
    ...(Object.keys(row.stats ?? {}).length || row.latest || row.top ? [{
      op: 'log_account_stats', platform: row.platform, date: day, fetchedAt, source: sourceOf(row), stats: row.stats, latest: row.latest ?? undefined, top: row.top ?? undefined,
      ...(row.period ? { period: row.period } : {}), ...(row.approx?.length ? { approx: row.approx } : {}),
    }] : []),
    ...(row.posts ?? []).filter(post => ['views', 'likes', 'saves', 'comments', 'shares'].some(key => Number.isInteger(post[key]))).map(({ id, url, at, title, workId, ...counts }) => {
      // 作品 ID：列表页链接里给的优先，其次是这条作品链接里的（标题在平台上改过时靠它认回同一条）
      const work = workId ?? workIdFromText(url, row.platform)
      return { op: 'add_metric', replace: true, platform: row.platform, itemId: owner(title), ...(work ? { workId: work } : {}), title, date: at ?? fetchedAt, fetchedAt, ...counts }
    }),
  ])
}

/**
 * 把来源更可靠的一组结果（创作后台）并进已有的结果：同一个平台合成一条，能用高的就用高的，高的没有的项沿用低的。
 * 高的那次读不到、低的读到了：照样算读到，高的原因记在 backstageError。
 */
export function mergeSource(rows, extra) {
  const merged = [...rows]
  for (const high of extra) {
    const index = merged.findIndex(row => row.platform === high.platform)
    if (index < 0) { merged.push(high); continue }
    const low = merged[index]
    const sideError = { [`${sourceOf(high)}Error`]: high.error, ...(high.needLogin ? { needLogin: true } : {}) }
    if (high.error && succeeded(low)) { merged[index] = { ...low, ...sideError }; continue }
    const followers = high.followers ?? low.followers
    const fromHigh = high.followers !== null
    const combined = {
      ...low,
      ...high,
      name: high.name ?? low.name,
      followers,
      followersSource: fromHigh ? sourceOf(high) : low.followersSource ?? sourceOf(low),
      followersApprox: fromHigh ? Boolean(high.followersApprox) : Boolean(low.followersApprox),
      stats: { ...low.stats, ...high.stats },
      latest: high.latest ?? low.latest,
      top: high.top ?? low.top,
      posts: high.posts?.length ? high.posts : low.posts ?? [],
    }
    merged[index] = { ...combined, error: succeeded(combined) ? null : high.error ?? low.error }
  }
  return merged
}

export { SOURCE_RANK }
