// 发布后 72 小时内的加密采样：从创作后台的作品列表页再读一遍，把这一刻的累计数记成采样点（add_metric 带 ts）。
// 只采编得动单个作品的平台（有作品列表页的那几个）；没有列表页的平台不编造数据。
import { BACKSTAGE, readBackstage } from './backstage.js'
import { applyOps } from './ops.js'
import { lastSampleAt, sampleDue, youngWorks } from './metric-samples.js'

// 能单独读到每条作品的平台：哪几个有作品列表页就是哪几个
export const SAMPLEABLE = Object.keys(BACKSTAGE).filter(platform => BACKSTAGE[platform].list !== undefined)
// 要重新登录的平台先停这么久再来，别每 10 分钟开一次浏览器
export const HOLD_MS = 6 * 3600_000
// 采样只认这几项数，和作品列表页读出来的一致
const FIELDS = ['views', 'likes', 'saves', 'comments', 'shares']

/**
 * 现在要采哪些作品。纯函数。
 * 发布后 72 小时内、这次该采的（sampleDue）、平台能单独读到作品的；离上次打开这个平台的后台不到 minGapMs 的先跳过。
 * 上次读要重新登录的（hold 里有时间），6 小时内不再试。
 * @param {{state: object, now?: Date, lastAt?: Record<string, string>, minGapMs?: number, platforms?: string[], hold?: Record<string, string>}} input
 * @returns {{works: Array<object>, platforms: string[]}} 要采的作品和这次要打开后台的平台。
 */
export function samplingPlan({ state, now = new Date(), lastAt = {}, minGapMs = 0, platforms = SAMPLEABLE, hold = {} } = {}) {
  const at = now instanceof Date ? now.getTime() : Date.parse(String(now ?? ''))
  if (!Number.isFinite(at)) return { works: [], platforms: [] }
  const works = youngWorks(state, now).filter(work => platforms.includes(work.platform)
    && sampleDue({ now, lastSampleAt: lastSampleAt(state, work), publishedAt: work.date }).due)
  const ready = [...new Set(works.map(work => work.platform))].filter((platform) => {
    const last = Date.parse(String(lastAt?.[platform] ?? ''))
    if (Number.isFinite(last) && at - last < minGapMs) return false
    const blocked = Date.parse(String(hold?.[platform] ?? ''))
    return !Number.isFinite(blocked) || at - blocked >= HOLD_MS
  })
  return { works: works.filter(work => ready.includes(work.platform)), platforms: ready }
}

/**
 * 一轮读到的作品数换成采样操作：只给要采的那几条作品记，别的作品这次读到也不记（免得采样点白白变多）。纯函数。
 * @param {Array<object>} rows - readBackstage 的结果。
 * @param {Array<object>} works - samplingPlan 的 works。
 * @param {string} ts - 这次采样的时间（ISO）。
 * @returns {Array<object>} add_metric 操作，带 ts。
 */
export function sampleOps(rows, works, ts) {
  const ops = []
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const post of row?.posts ?? []) {
      if (!FIELDS.some(key => Number.isInteger(post[key]))) continue
      const work = works.find(target => target.platform === row.platform && ((target.workId && post.workId && target.workId === post.workId)
        || (target.title && post.title && target.title === post.title)
        || (target.itemId && post.itemId && target.itemId === post.itemId)))
      if (!work) continue
      const workId = post.workId ?? work.workId ?? null
      const title = post.title ?? work.title ?? null
      const counts = Object.fromEntries(FIELDS.filter(key => Number.isInteger(post[key])).map(key => [key, post[key]]))
      ops.push({
        op: 'add_metric', platform: row.platform, ts, date: post.at ?? work.date,
        ...(workId ? { workId } : {}), ...(title ? { title } : {}), ...counts,
      })
    }
  }
  return ops
}

/**
 * 跑一次采样：开后台、读作品列表页、把要采的作品记成采样点。读不到不抛错，原因在返回值里。
 * 不论读没读到，都记下这次打开各平台后台的时间（和常规读取共用这个记录，10 分钟内不会重复开）。
 * @param {{read: Function, mutate: Function}} store - 数据存储。
 * @param {{works: Array<object>, platforms: string[], backstage: {open: Function, callText: Function, wait?: Function}, now?: () => Date}} options
 * @returns {Promise<{applied: number, error?: string}>} applied：这次记下的采样点条数。
 */
export async function runSample(store, { works, platforms, backstage, now = () => new Date() }) {
  const started = now()
  const at = started.toISOString()
  let rows = []
  let error = null
  let browser = null
  try {
    browser = await backstage.open()
    rows = await readBackstage({ platforms, browser, callText: backstage.callText, previous: {}, wait: backstage.wait, postsOnly: true })
  } catch (err) {
    error = err.message || String(err)
  } finally {
    await Promise.resolve(browser?.close?.()).catch(() => {})
  }
  const ops = sampleOps(rows, works, at)
  if (ops.length) await store.mutate('', draft => (applyOps(draft, ops), draft), { undoable: false })
  const stuck = rows.filter(row => row.needLogin).map(row => row.platform)
  await store.mutate('', (draft) => {
    draft.autoRead = {
      ...(draft.autoRead ?? {}),
      backstageAt: { ...(draft.autoRead?.backstageAt ?? {}), ...Object.fromEntries(platforms.map(platform => [platform, at])) },
      ...(stuck.length ? { sampleHold: { ...(draft.autoRead?.sampleHold ?? {}), ...Object.fromEntries(stuck.map(platform => [platform, at])) } } : {}),
    }
  }, { undoable: false })
  return { applied: ops.length, ...(error ? { error } : {}) }
}
