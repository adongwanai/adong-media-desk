// 每天自动读一遍各平台账号数据：DSH 开着时，到设定时间（默认早上 6:30）跑一次；当天还没跑过而 DSH 是之后才打开或唤醒的，补跑一次。
// 同一天只跑一次，手动点「立即读取」也算。跑完把每个平台的结果（读到的数或读不到的原因）记在 state.autoRead，大屏顶栏显示。
// 有平台这次没读到：过 20 分钟、再过 40 分钟各重读一次没读到的那几个；要重新登录的、连着两轮没读到的记在 autoRead.attention，等作者处理。
import { readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readAccounts, readSupport } from './collect.js'
import { BACKSTAGE, BACKSTAGE_PLATFORMS, readBackstage } from './backstage.js'
import { applyOps } from './ops.js'
import { mergeSource, resultOps, resultRow, succeeded } from './read-merge.js'
import { runSample, samplingPlan } from './sample-run.js'
import { tr, withLang } from './i18n.js'
import { pushAttention } from './notify.js'

export { mergeSource, resultOps, succeeded }

// time：每天一整轮（公开接口 + 创作后台）；evening：只读创作后台的第二轮，空字符串表示关掉
export const AUTO_READ_DEFAULTS = { enabled: true, time: '06:30', evening: '18:30' }
// 创作后台同一个平台两次打开至少隔这么久（手动读取也算）
export const MIN_GAP_MS = 10 * 60_000
// 打开大屏时，公开接口距上次读到超过这么久就在后台补读一次
export const PUBLIC_STALE_MS = 6 * 3600_000
// 到点后这么久以内跑的算「按时」，再晚算「补跑」
const ON_TIME_MS = 10 * 60_000
// 「正在读」超过这么久还没结束，当它已经断掉（比如中途退出了）
const STALE_RUN_MS = 10 * 60_000
const TICK_MS = 60_000
const FIRST_TICK_MS = 20_000
// 一轮里有平台没读到：结束 20 分钟后重读一次没读到的，还不行再过 40 分钟读第二次，之后不再自动重读
export const RETRY_DELAYS_MS = [20 * 60_000, 40 * 60_000]
// 读不到时留的页面截图：每轮最多存几张，每个平台最多留几张
export const MAX_SHOTS_PER_RUN = 3
export const MAX_SHOTS_PER_PLATFORM = 3

/** 按这台电脑的时区取日期。 */
export function localDay(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 设置里的时间：HH:MM，24 小时制。 */
export function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/** 今天的设定时间点。 */
function slotOf(now, time) {
  const [hour, minute] = (validTime(time) ? time : AUTO_READ_DEFAULTS.time).split(':').map(Number)
  const slot = new Date(now)
  slot.setHours(hour, minute, 0, 0)
  return slot
}

/**
 * 现在该不该自动跑、跑哪一部分。纯函数，只看现在时间、上次运行记录和设置。
 * 早上那一轮是整轮；当天整轮跑过以后，到了第二轮的时间再跑一次只读创作后台的。
 * 当天一轮都还没跑过时，不管现在过了哪个时间点，先补一轮整的。
 * @param {{now: Date, last?: {day?: string, slotAt?: string}|null, settings?: {enabled?: boolean, time?: string, evening?: string}}} input
 * @returns {{due: boolean, trigger: 'schedule'|'catchup'|null, scope?: 'full'|'login', slotAt?: string}} trigger：按时跑还是补跑；slotAt：这一轮对应的时间点。
 */
export function dueRun({ now, last, settings }) {
  const { enabled, time, evening } = { ...AUTO_READ_DEFAULTS, ...(settings ?? {}) }
  const none = { due: false, trigger: null }
  if (!enabled) return none
  const morning = slotOf(now, time)
  const second = validTime(evening) && evening !== time ? slotOf(now, evening) : null
  const passed = [morning, second].filter(slot => slot && now >= slot).sort((a, b) => a - b)
  if (!passed.length) return none
  const latest = passed.at(-1)
  const served = Date.parse(last?.slotAt ?? '')
  const fullDone = last?.day === localDay(now)
  if (Number.isFinite(served) && served >= latest.getTime()) return none
  // 当天的整轮已经跑过：只有到了第二轮的时间点，才再跑只读登录数据的那一轮
  if (fullDone && latest !== second) return none
  return { due: true, trigger: now - latest <= ON_TIME_MS ? 'schedule' : 'catchup', scope: fullDone ? 'login' : 'full', slotAt: latest.toISOString() }
}

/**
 * 打开大屏时要不要在后台补读公开接口：自动读取开着、填了主页地址、没在读、距上次读到超过 maxAgeMs（默认 6 小时，或从没读到过）。纯函数。
 * @param {{now: Date, last?: {publicOkAt?: string, running?: boolean, startedAt?: string, pid?: number}|null, settings?: {enabled?: boolean}, hasLinks: boolean, maxAgeMs?: number}} input
 */
export function publicStale({ now, last, settings, hasLinks, maxAgeMs = PUBLIC_STALE_MS }) {
  if (!hasLinks || settings?.enabled === false || isRunning(last, now)) return false
  const ok = Date.parse(last?.publicOkAt ?? '')
  return !Number.isFinite(ok) || now - ok > maxAgeMs
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

/** 上一轮是不是还在跑：开始了但没结束、记了 pid 时那个进程还活着，且没超过 STALE_RUN_MS。 */
export function isRunning(last, now = new Date()) {
  if (!last?.running || !last.startedAt || now - new Date(last.startedAt) >= STALE_RUN_MS) return false
  return pidAlive(last.pid)
}

/**
 * 这条结果是不是「这次没读到、过一会儿再读可能就好」。要重新登录的（得人来）、粉丝数待确认的、读到了一部分的、
 * 这个平台的主页本来就读不了的（只能手动记）都不算。纯函数。
 * @param {object} row - autoRead.results 里的一条。
 */
export function flaky(row, support = readSupport()) {
  if (!row || row.ok || row.needLogin || row.pending || row.skipped || row.got?.length) return false
  return row.source === 'backstage' || support[row.platform]?.readable !== false
}

/**
 * 要不要排下一次自动重读、重读哪些平台。纯函数。
 * 只重读这一轮没读到、过会儿可能就好的平台。第 1 次在上一轮结束 20 分钟后，第 2 次在第 1 次结束 40 分钟后；两次之后不再排。
 * retries 只认当天的；关掉自动读取后也不再重读。
 * @param {{now: Date, autoRead?: {results?: Array<object>, retries?: {day: string, count: number, at: string}}|null, settings?: {enabled?: boolean}}} input
 * @returns {{due: boolean, platforms: string[], count: number, nextAt: string|null, exhausted: boolean}} count：今天这一轮已经重读了几次；exhausted：次数用完了。
 */
export function retryPlan({ now, autoRead, settings }) {
  const platforms = (autoRead?.results ?? []).filter(row => flaky(row)).map(row => row.platform)
  const retries = autoRead?.retries
  const count = retries?.count ?? 0
  const none = { due: false, platforms, count, nextAt: null, exhausted: false }
  if (settings?.enabled === false || !platforms.length || retries?.day !== localDay(now)) return none
  if (count >= RETRY_DELAYS_MS.length) return { ...none, exhausted: true }
  const last = Date.parse(retries.at ?? '')
  if (!Number.isFinite(last)) return none
  const next = new Date(last + RETRY_DELAYS_MS[count])
  return { ...none, due: now >= next, nextAt: next.toISOString() }
}

/** 一轮之后的重读记录：定时轮和手动整轮从 0 数；重读那一轮开始时已经加过 1，这里只记结束时间；别的轮次不动。 */
function retriesAfter({ trigger, whole, retries, day, at }) {
  if (trigger === 'retry') return { retries: { day: retries?.day ?? day, count: retries?.count ?? 1, at } }
  if (trigger === 'schedule' || trigger === 'catchup' || (trigger === 'manual' && whole)) return { retries: { day, count: 0, at } }
  return retries ? { retries } : {}
}

/**
 * 一轮读完后，哪些平台要作者来处理：要重新登录的，和连着两轮都没读到的（单独一次没读到的会自动重读，不算）。纯函数。
 * 这一轮读到了的平台清掉；这一轮没读的平台照旧。要重新登录的那条，只有这一轮真的打开了它的创作后台才有新结论。
 * @param {{before?: Array<object>, after?: Array<object>, read?: string[], opened?: string[], attention?: Array<object>, at: string}} input
 *   before / after：这一轮前后的 autoRead.results；read：这一轮读了的平台；opened：这一轮打开了创作后台的平台。
 * @returns {Array<{platform: string, reason: string, needLogin: boolean, at: string, shot?: string}>} shot 是读不到时页面截图的文件名。
 */
export function collectAttention({ before = [], after = [], read = [], opened = [], attention = [], at }) {
  const support = readSupport()
  const item = (row, needLogin) => ({ platform: row.platform, reason: String((needLogin ? row.backstageError : null) ?? row.error ?? ''), needLogin, at, ...(row.shot ? { shot: row.shot } : {}) })
  const platforms = [...new Set([...(attention ?? []).map(entry => entry.platform), ...read])]
  return platforms.flatMap((platform) => {
    const kept = (attention ?? []).find(entry => entry.platform === platform)
    const row = (after ?? []).find(entry => entry.platform === platform)
    if (!read.includes(platform) || !row) return kept ? [kept] : []
    if (row.needLogin) return [item(row, true)]
    if (kept?.needLogin && !opened.includes(platform)) return [kept]
    const prior = (before ?? []).find(entry => entry.platform === platform)
    if (flaky(row, support) && (kept || (prior && !prior.ok && !prior.skipped))) return [item(row, false)]
    return []
  })
}

/** 截图文件名：backstage-<平台英文名>-<本机日期时间>.jpg。文件接口只收 ASCII 文件名，平台用英文名。 */
export function shotName(platform, date) {
  const d = new Date(date)
  const two = n => String(n).padStart(2, '0')
  return `backstage-${BACKSTAGE[platform]?.slug ?? 'page'}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.jpg`
}

/** 每个平台只留最近几张截图：返回要删的文件名。纯函数。 */
export function staleShots(names, keep = MAX_SHOTS_PER_PLATFORM) {
  const shots = names.filter(name => /^backstage-[a-z]+-\d{8}-\d{6}\.jpg$/.test(name))
  const slugs = [...new Set(shots.map(name => name.split('-')[1]))]
  return slugs.flatMap(slug => shots.filter(name => name.split('-')[1] === slug).sort().reverse().slice(keep))
}

/**
 * 把读不到时截的页面存进素材目录：每轮最多 3 张，每个平台只留最近 3 张。
 * 存不下不影响读取结果，原因记在那一条的 shotError。
 * @param {string|undefined} dir - store.filesDir。
 * @param {Array<object>} rows - readBackstage 的结果，shot 是 base64。
 * @returns {Promise<Array<object>>} 同样的结果，shot 换成文件名；没存的去掉 shot。
 */
export async function saveShots(dir, rows, date) {
  const out = []
  let saved = 0
  for (const { shot, ...row } of rows) {
    if (!shot || !dir || saved >= MAX_SHOTS_PER_RUN) { out.push(row); continue }
    const name = shotName(row.platform, date)
    try {
      await writeFile(join(dir, name), Buffer.from(shot, 'base64'))
      saved += 1
      out.push({ ...row, shot: name })
    } catch (err) {
      out.push({ ...row, shotError: tr('页面截图没存下：{error}', { error: err.message || String(err) }) })
    }
  }
  if (saved) {
    const names = await readdir(dir).catch(() => [])
    await Promise.all(staleShots(names).map(name => unlink(join(dir, name)).catch(() => {})))
  }
  return out
}

/** 只读了几个平台时，把它们的新结果换进上一轮的结果里，别的平台照旧。 */
function mergeResults(previous, rows) {
  // 只读公开接口的那几轮：主页链接读不到，不盖掉之前创作后台读到的那条
  const weaker = row => !row.ok && !row.source && (previous ?? []).some(old => old.platform === row.platform && old.ok && old.source === 'backstage')
  const fresh = rows.filter(row => !weaker(row))
  const names = new Set(fresh.map(row => row.platform))
  return [...(previous ?? []).filter(row => !names.has(row.platform)), ...fresh]
}

/** 创作后台这次没打开（离上次不到 10 分钟）的平台：上一轮后台读到的那条结果留着，不让一条「读不到」盖掉它。 */
function keepSkipped(rows, previous, skipped) {
  const kept = skipped
    .map(({ platform }) => (previous ?? []).find(row => row.platform === platform && row.source === 'backstage' && row.ok))
    .filter(old => old && !rows.find(row => row.platform === old.platform)?.ok)
  const gone = new Set(kept.map(row => row.platform))
  return [...rows.filter(row => !gone.has(row.platform)), ...kept]
}

/** 每个平台最近一次记的粉丝数：创作后台读到的数和它比，变化太大先不记。 */
function lastFollowers(state) {
  const latest = {}
  for (const row of state.followerLog ?? []) {
    if (row.sample) continue
    if (!latest[row.platform] || row.date > latest[row.platform].date) latest[row.platform] = row
  }
  return Object.fromEntries(Object.entries(latest).map(([platform, row]) => [platform, row.followers]))
}

/** 这一轮要读哪些平台的创作后台：force 为真（用户在界面手点立即读取/重试）直接读；否则只读离上次超过 10 分钟的。 */
function backstagePlan({ platforms, lastAt = {}, now, force = false }) {
  const run = []
  const skipped = []
  for (const platform of platforms) {
    const last = Date.parse(lastAt?.[platform] ?? '')
    if (!force && Number.isFinite(last) && now - last < MIN_GAP_MS) skipped.push({ platform, reason: tr('距上次读创作后台不到 10 分钟，这次没再打开') })
    else run.push(platform)
  }
  return { run, skipped }
}

/**
 * 跑一轮：先在状态里占住（另一个 DSH 进程看到就不会再跑），读完写入数据，再记下这一轮的结果。
 * 定时跑的数据不进撤销栈：不是用户做的事，不该被一次撤销抹掉；手动点的可以撤销。运行记录不进撤销栈，撤销数据不会把它退回「正在读」。
 * scope：full 整轮（公开接口 + 创作后台）；login 只读创作后台（每天第二轮）；public 只读公开接口（打开大屏时补读）。
 * platforms：只读这几个平台（刚填好主页地址时读一次），不算今天的整轮。slotAt：定时轮对应的时间点，记下来免得同一个时间点跑两次。
 * backstage：设置里开了「登录后的创作后台」时给；open() 打开专用浏览器，callText 调模型认数。每个平台两次至少隔 10 分钟，时间记在 autoRead.backstageAt。
 * 来源优先级：创作后台 > 主页链接。
 * trigger 是 retry 的是自动重读：只读 platforms 这几个，开始时就把今天的重读次数加 1（中途退出也不重复），不算今天的整轮。
 * 每轮结束重算 autoRead.attention（要作者处理的平台）和 autoRead.retries（今天重读了几次、最近一次什么时候）。
 * 创作后台读不到时浏览器截的页面存到素材目录，文件名记在那个平台的结果和 attention 里。
 * @param {{read: Function, mutate: Function, filesDir?: string}} store - 数据存储。
 * @param {{trigger: 'schedule'|'catchup'|'manual'|'refresh'|'retry', scope?: 'full'|'login'|'public', slotAt?: string, platforms?: string[], fetchImpl?: typeof fetch, backstage?: {open: () => Promise<{readPage: Function, close: Function}>, callText: Function, wait?: Function}, now?: () => Date}} options
 * @returns {Promise<{results: Array<object>, state: object, skipped?: string}>} results 里每条带 ok；创作后台没打开的平台另有一条 skipped。
 */
export async function runAccountRead(store, { trigger, scope = 'full', slotAt, platforms, force = false, fetchImpl, backstage, now = () => new Date() }) {
  const started = now()
  const partial = (trigger === 'manual' || trigger === 'retry') && Array.isArray(platforms)
  // 整轮（不是只读几个平台）才算今天的那一轮，才改 day
  const whole = scope === 'full' && !partial
  const skipped = await store.mutate('', (draft) => {
    if (isRunning(draft.autoRead, started)) return tr('上一轮还在读，等它结束再试')
    if (slotAt && Date.parse(draft.autoRead?.slotAt ?? '') >= Date.parse(slotAt)) return tr('这个时间点已经读过')
    if (!['manual', 'refresh', 'retry'].includes(trigger) && scope === 'full' && draft.autoRead?.day === localDay(started)) return tr('今天已经读过')
    if (trigger === 'retry') {
      // 另一个 DSH 进程刚重读过：这次不再读
      if (!retryPlan({ now: started, autoRead: draft.autoRead }).due) return tr('这次重读已经做过了')
      const retries = draft.autoRead.retries
      draft.autoRead = { ...draft.autoRead, retries: { ...retries, count: retries.count + 1, at: started.toISOString() } }
    }
    if (!partial) draft.autoRead = { ...(draft.autoRead ?? {}), ...(whole ? { day: localDay(started) } : {}), running: true, pid: process.pid, startedAt: started.toISOString(), progress: null }
    return null
  }, { undoable: false })
  if (skipped) return { results: [], state: await store.read(), skipped }
  const undoBefore = trigger === 'manual' && Array.isArray(store.undo) ? JSON.parse(JSON.stringify(await store.read())) : null
  let results = []
  let failure = null
  let skippedRows = []
  let publicOk = false
  const backstageAt = {}
  // 读不到时截的页面：平台 → {shot: 文件名, shotError}
  const shots = {}
  /** 边读边落盘：公开接口或单个平台刚读出数就立刻写进 state，大屏轮询不用傻等整轮跑完。 */
  const flushRows = async (rowsToFlush, progress = undefined) => {
    const flushAt = now().toISOString()
    const incOps = rowsToFlush?.length ? resultOps(rowsToFlush, flushAt, (await store.read()).items) : []
    if (!incOps.length && progress === undefined) return
    await store.mutate('', (draft) => {
      if (incOps.length) applyOps(draft, incOps)
      if (!partial && draft.autoRead && progress !== undefined) draft.autoRead = { ...draft.autoRead, progress }
      return draft
    }, { undoable: false })
  }
  try {
    const before = await store.read()
    const support = readSupport()
    const accounts = before.accounts ?? []
    if (scope !== 'login') {
      const targetAccounts = partial
        ? accounts.filter(account => platforms.includes(account.platform))
        : scope === 'public'
          ? accounts.filter(account => support[account.platform]?.readable !== false)
          : accounts
      results = await readAccounts(targetAccounts, fetchImpl)
      publicOk = results.some(succeeded)
    }
    if (scope !== 'public' && backstage) {
      const plan = backstagePlan({ platforms: BACKSTAGE_PLATFORMS.filter(name => !partial || platforms.includes(name)), lastAt: before.autoRead?.backstageAt, now: now(), force })
      skippedRows = plan.skipped
      // 公开接口已经读完，接下来要开浏览器跑后台：先把公开接口读到的新数落盘，界面立刻能看到
      if (plan.run.length) await flushRows(results, { current: plan.run[0], done: 0, total: plan.run.length })
      if (plan.run.length) {
        let rows
        try {
          const browser = await backstage.open()
          try {
            for (const platform of plan.run) backstageAt[platform] = now().toISOString()
            rows = await readBackstage({
              platforms: plan.run,
              browser,
              callText: backstage.callText,
              previous: lastFollowers(before),
              wait: backstage.wait,
              onStartPlatform: async (platform, done, total) => {
                await flushRows([], { current: platform, done, total })
              },
              onStep: async (stepRow, done, total) => {
                await flushRows([stepRow], { current: stepRow.platform, done, total })
              },
            })
          } finally {
            await browser.close()
          }
          rows = await saveShots(store.filesDir, rows, now())
          for (const row of rows) if (row.shot || row.shotError) shots[row.platform] = { ...(row.shot ? { shot: row.shot } : {}), ...(row.shotError ? { shotError: String(row.shotError).slice(0, 300) } : {}) }
        } catch (err) {
          // 浏览器都打不开：每个平台记同一个原因，别的来源读到的照常
          rows = plan.run.map(platform => ({ platform, name: null, followers: null, stats: {}, latest: null, top: null, posts: [], source: 'backstage', error: err.message || String(err) }))
        }
        results = mergeSource(results, rows)
      }
    }
  } catch (err) {
    failure = err.message || String(err)
  }
  const at = now().toISOString()
  const ops = resultOps(results, at, (await store.read()).items)
  if (ops.length) await store.mutate('', draft => (applyOps(draft, ops), draft), { undoable: false })
  if (undoBefore && ops.length && Array.isArray(store.undo)) {
    const afterState = JSON.parse(JSON.stringify(await store.read()))
    afterState.autoRead = undoBefore.autoRead
    const beforeStr = JSON.stringify(undoBefore)
    const afterStr = JSON.stringify(afterState)
    if (afterStr !== beforeStr) {
      store.undo.push({ label: tr('自动读取账号数据'), before: beforeStr, after: afterStr })
      if (store.undo.length > 30) store.undo.shift()
    }
  }
  const rows = results.map(row => ({ ...resultRow(row), ...(shots[row.platform] ?? {}), at }))
  const state = await store.mutate('', (draft) => {
    const prior = draft.autoRead ?? {}
    const previous = prior.results
    const opened = { ...(prior.backstageAt ?? {}), ...backstageAt }
    const marks = {
      ...(Object.keys(opened).length ? { backstageAt: opened } : {}),
      ...(slotAt ? { slotAt } : {}),
      ...(publicOk ? { publicOkAt: at } : {}),
    }
    const kept = { ...prior, ...marks }
    delete kept.progress
    delete kept.pid
    // 整轮换掉全部结果；只读一部分平台、一部分来源的那几轮：新结果换进上一轮的结果里，别的平台照旧
    const next = keepSkipped(whole ? rows : mergeResults(previous, rows), previous, skippedRows)
    // 整轮里既没读、也不是因为 10 分钟内读过才跳过的平台（主页地址删了、后台关了）：不再提醒
    const still = new Set([...rows, ...skippedRows].map(row => row.platform))
    const attention = whole ? (prior.attention ?? []).filter(entry => still.has(entry.platform)) : prior.attention
    const watch = {
      attention: collectAttention({ before: previous, after: next, read: rows.map(row => row.platform), opened: Object.keys(backstageAt), attention, at }),
      ...retriesAfter({ trigger, whole, retries: prior.retries, day: localDay(started), at }),
    }
    const error = failure ? { error: failure.slice(0, 300) } : {}
    // 自动重读那几个平台：也算一次读取，记下时间，状态条能看出来是重读的
    if (partial) draft.autoRead = { ...kept, results: next, ...watch, ...(trigger === 'retry' ? { at, trigger } : {}) }
    else if (whole) draft.autoRead = { day: localDay(started), at, trigger, running: false, ...pickMarks(kept), results: next, ...watch, ...error }
    else draft.autoRead = { ...kept, at, trigger, running: false, results: next, ...watch, ...error }
    return draft
  }, { undoable: false })
  return {
    results: [...results.map(row => ({ ...row, ok: succeeded(row) })), ...skippedRows.map(row => ({ platform: row.platform, followers: null, ok: false, skipped: true, error: row.reason }))],
    state,
  }
}

/** 整轮重写运行记录时要留下的那几项：各后台上次打开的时间，定时轮的时间点，公开接口上次读到的时间。 */
function pickMarks(autoRead) {
  return Object.fromEntries(['backstageAt', 'slotAt', 'publicOkAt'].filter(key => autoRead[key] !== undefined).map(key => [key, autoRead[key]]))
}

/**
 * 看一眼现在该不该读：该跑整轮或重读就跑那一轮，都不是就看发布 72 小时内的作品要不要加密采样（6 小时一次）。
 * 定时器每分钟调一次；测试里也直接调这个。返回这次做了什么：'read'、'sample' 或 null。
 * @param {{store: object, settings: {read: Function}, desk: object, fetchImpl?: typeof fetch, notifyFetch?: typeof fetch, backstage?: (saved: object) => object|null, lang?: () => string}} deps - backstage 按设置给出读创作后台要用的东西，没开时返回 null。
 * @returns {Promise<'read'|'sample'|null>}
 */
export async function dailyTick({ store, settings, desk, fetchImpl, notifyFetch, backstage = () => null, lang = () => 'zh' }) {
  if (desk.readingAccounts) return null
  let mine = false
  try {
    const saved = await settings.read()
    const state = await store.read()
    const now = new Date()
    const { due, trigger, scope, slotAt } = dueRun({ now, last: state.autoRead, settings: saved.autoRead })
    const retry = due ? null : retryPlan({ now, autoRead: state.autoRead, settings: saved.autoRead })
    // 该跑整轮、该重读时先跑那个；都不是时看发布 72 小时内的作品要不要加密采样；自动读取关掉时也不采
    const samplingOff = saved.autoRead?.enabled === false
    const sample = due || retry.due || samplingOff || isRunning(state.autoRead, now) ? null : samplingPlan({ state, now, lastAt: state.autoRead?.backstageAt, minGapMs: MIN_GAP_MS, hold: state.autoRead?.sampleHold })
    const sampling = Boolean(sample?.works.length)
    if (!(due || retry.due || sampling) || desk.readingAccounts || isRunning(state.autoRead, now)) return null
    // 什么都没得读就不占这个时间点：用户中午填好地址，当天还能补跑
    const studio = backstage(saved)
    const links = (state.accounts ?? []).some(account => !account.sample && account.url)
    if (desk.readingAccounts || (due && !(scope === 'login' ? studio : links || studio))) return null
    // 要采样但没有后台可读：不采，也不编造
    if (sampling && !studio) return null
    desk.readingAccounts = true
    mine = true
    const job = due ? { trigger, scope, slotAt } : { trigger: 'retry', platforms: retry.platforms }
    // 后台跑没有请求带语言：沿用用户最近一次打开工作台时的语言，读不到的原因按这个语言记
    const did = await withLang(lang(), async () => {
      if (sampling) {
        await runSample(store, { works: sample.works, platforms: sample.platforms, backstage: studio })
        return 'sample'
      }
      await runAccountRead(store, { ...job, fetchImpl, backstage: studio ?? undefined })
      // 用户开了提醒推送时：要重新登录的、连着几轮没读到的平台，每个平台每天往他填的地址推一条
      await pushAttention({ store, settings: saved, fetchImpl: notifyFetch })
      return 'read'
    })
    return did
  } finally {
    if (mine) desk.readingAccounts = false
  }
}

/**
 * 插件 host 里的轻量定时：每分钟看一眼该不该跑（电脑睡眠醒来后也能补上），启动后稍等一会儿先看一次。
 * 不到该跑整轮的时候，再看要不要重读上一轮没读到的平台（retryPlan），再不然看要不要加密采样（dailyTick）。
 * @param {{store: object, settings: {read: Function}, desk: object, fetchImpl?: typeof fetch, notifyFetch?: typeof fetch, backstage?: (saved: object) => object|null, lang?: () => string, onError?: (err: Error) => void}} deps - backstage 按设置给出读创作后台要用的东西，没开时返回 null。
 * @returns {() => void} 停止定时器；插件卸载、热重载时调用。
 */
export function startDailyRead({ store, settings, desk, fetchImpl, notifyFetch, backstage = () => null, lang = () => 'zh', onError = () => {} }) {
  // 新进程刚启动时，清理上一次进程意外退出遗留的 running 僵尸锁，避免大屏卡在「正在读取」
  store.read().then((state) => {
    const ar = state?.autoRead
    if (!ar?.running || desk.readingAccounts) return null
    if (ar.pid && ar.pid !== process.pid && pidAlive(ar.pid)) return null
    return store.mutate('', (draft) => {
      if (draft.autoRead?.running) {
        draft.autoRead = { ...draft.autoRead, running: false }
        delete draft.autoRead.progress
        delete draft.autoRead.pid
      }
      return draft
    }, { undoable: false })
  }).catch(() => {})
  const tick = () => dailyTick({ store, settings, desk, fetchImpl, notifyFetch, backstage, lang }).catch(onError)
  const first = setTimeout(tick, FIRST_TICK_MS)
  const timer = setInterval(tick, TICK_MS)
  // 不让这两个定时器拖住进程退出
  first.unref?.()
  timer.unref?.()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
