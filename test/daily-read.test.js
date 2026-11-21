// 每日自动读取：该不该跑的纯函数、跑一轮怎么写数据、账号数据怎么存、设置怎么校验。
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { computeBoard } from '../src/board.js'
import { collectAttention, dailyTick, dueRun, flaky, isRunning, localDay, MAX_SHOTS_PER_RUN, publicStale, resultOps, retryPlan, runAccountRead, saveShots, shotName, staleShots, startDailyRead } from '../src/daily-read.js'
import { applyOps, MAX_ACCOUNT_DAYS } from '../src/ops.js'
import { migrateState } from '../src/seed.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'

const at = (day, hh, mm) => new Date(2026, 10, day, hh, mm)
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

test('dueRun：到点跑、之后打开补跑、同一天不重复、关掉不跑', () => {
  const settings = { enabled: true, time: '06:30', evening: '' }
  const pick = run => ({ due: run.due, trigger: run.trigger })
  assert.deepEqual(pick(dueRun({ now: at(13, 6, 29), last: null, settings })), { due: false, trigger: null })
  assert.deepEqual(pick(dueRun({ now: at(13, 6, 30), last: null, settings })), { due: true, trigger: 'schedule' })
  assert.deepEqual(pick(dueRun({ now: at(13, 6, 39), last: { day: '2026-11-12' }, settings })), { due: true, trigger: 'schedule' })
  // DSH 九点才打开（或电脑九点才醒）：当天还没跑过就补一次
  assert.deepEqual(pick(dueRun({ now: at(13, 9, 5), last: { day: '2026-11-12' }, settings })), { due: true, trigger: 'catchup' })
  assert.deepEqual(pick(dueRun({ now: at(13, 9, 5), last: { day: '2026-11-13' }, settings })), { due: false, trigger: null })
  assert.deepEqual(pick(dueRun({ now: at(13, 9, 5), last: null, settings: { enabled: false, time: '06:30' } })), { due: false, trigger: null })
  // 改成晚上跑：早上打开不提前跑
  assert.deepEqual(pick(dueRun({ now: at(13, 9, 5), last: null, settings: { enabled: true, time: '22:00', evening: '' } })), { due: false, trigger: null })
  // 没有设置时按默认的 6:30
  assert.equal(dueRun({ now: at(13, 7, 0), last: null }).due, true)
})

test('dueRun：每天两轮，早上整轮，18:30 那轮只读本机工具和创作后台；一轮都没跑过时先补整轮；第二轮可以关', () => {
  const settings = { enabled: true, time: '06:30', evening: '18:30' }
  const morning = dueRun({ now: at(13, 6, 31), last: { day: '2026-11-12' }, settings })
  assert.deepEqual([morning.due, morning.scope, morning.trigger, morning.slotAt], [true, 'full', 'schedule', at(13, 6, 30).toISOString()])
  // 早上跑过，下午不再跑
  const ranMorning = { day: '2026-11-13', slotAt: at(13, 6, 30).toISOString() }
  assert.equal(dueRun({ now: at(13, 15, 0), last: ranMorning, settings }).due, false)
  const evening = dueRun({ now: at(13, 18, 35), last: ranMorning, settings })
  assert.deepEqual([evening.due, evening.scope, evening.trigger, evening.slotAt], [true, 'login', 'schedule', at(13, 18, 30).toISOString()])
  // 晚上那轮跑过就不再跑
  assert.equal(dueRun({ now: at(13, 21, 0), last: { day: '2026-11-13', slotAt: at(13, 18, 30).toISOString() }, settings }).due, false)
  // 晚上九点才打开、当天一轮都没跑：先补整轮
  const late = dueRun({ now: at(13, 21, 0), last: { day: '2026-11-12' }, settings })
  assert.deepEqual([late.scope, late.trigger], ['full', 'catchup'])
  // 旧的运行记录没有 slotAt：当天 day 对上就当早上那轮跑过了
  assert.equal(dueRun({ now: at(13, 18, 40), last: { day: '2026-11-13' }, settings }).scope, 'login')
  // 第二轮关掉
  assert.equal(dueRun({ now: at(13, 18, 40), last: ranMorning, settings: { ...settings, evening: '' } }).due, false)
})

test('publicStale：打开大屏时，公开接口超过 6 小时没读到才补读；在读、没填地址、关了自动读取都不补', () => {
  const now = at(13, 15, 0)
  assert.equal(publicStale({ now, last: null, hasLinks: true }), true)
  assert.equal(publicStale({ now, last: { publicOkAt: at(13, 9, 30).toISOString() }, hasLinks: true }), false)
  assert.equal(publicStale({ now, last: { publicOkAt: at(13, 8, 59).toISOString() }, hasLinks: true }), true)
  assert.equal(publicStale({ now, last: null, hasLinks: false }), false)
  assert.equal(publicStale({ now, last: null, hasLinks: true, settings: { enabled: false } }), false)
  assert.equal(publicStale({ now, last: { running: true, startedAt: at(13, 14, 58).toISOString() }, hasLinks: true }), false)
})

test('isRunning：开始了没结束算在跑，超过十分钟或进程已退出当它已经断了', () => {
  const now = at(13, 7, 0)
  assert.equal(isRunning({ running: true, startedAt: at(13, 6, 55).toISOString() }, now), true)
  assert.equal(isRunning({ running: true, pid: process.pid, startedAt: at(13, 6, 55).toISOString() }, now), true)
  assert.equal(isRunning({ running: true, pid: 99999999, startedAt: at(13, 6, 55).toISOString() }, now), false)
  assert.equal(isRunning({ running: true, startedAt: at(13, 6, 30).toISOString() }, now), false)
  assert.equal(isRunning({ running: false, startedAt: at(13, 6, 55).toISOString() }, now), false)
  assert.equal(isRunning(null, now), false)
})

test('resultOps：主数字记粉丝，其他项和最新一条记账号数据；读不到的不写', () => {
  const ops = resultOps([
    { platform: 'B站', followers: 10, stats: { likes: 5 }, latest: null },
    { platform: 'YouTube', followers: null, stats: {}, latest: { title: 'v', url: 'https://www.youtube.com/watch?v=x' }, error: '订阅数要手动记录' },
    { platform: '小红书', followers: null, stats: {}, latest: null, error: '跳到登录页' },
  ], '2026-11-13T06:30:00.000Z')
  assert.deepEqual(ops.map(op => [op.op, op.platform]), [['log_followers', 'B站'], ['log_account_stats', 'B站'], ['log_account_stats', 'YouTube']])
})

test('log_account_stats：同平台同一天一条，只收白名单里的整数，没读到的不补 0；log_followers 记下是不是自动读的', () => {
  const state = migrateState({ items: [], metrics: [], accounts: [] })
  assert.deepEqual(state.accountDaily, [])
  const now = new Date()
  const { errors } = applyOps(state, [
    { op: 'log_account_stats', platform: 'B站', fetchedAt: now.toISOString(), stats: { likes: 100, works: 3, fake: 9, fans: -1, hIndex: 1.5 }, latest: { title: ' 一条  视频 ', url: 'https://www.bilibili.com/video/BV1', views: 9, likes: 'x' } },
    { op: 'log_account_stats', platform: 'B站', stats: { likes: 120 } },
    { op: 'log_account_stats', platform: 'B站', stats: {}, latest: { title: 'x', url: 'javascript:alert(1)' } },
    { op: 'log_account_stats', platform: '微博', stats: { likes: 1 } },
    { op: 'log_followers', platform: 'B站', followers: 50, fetchedAt: now.toISOString() },
  ])
  assert.equal(errors.length, 2)
  assert.equal(state.accountDaily.length, 1)
  // 同一天再记一次是整条换掉：这次没读到的项就是不知道，不沿用上一次的
  assert.deepEqual(state.accountDaily[0].stats, { likes: 120 })
  assert.equal(state.accountDaily[0].latest, undefined)
  assert.equal(state.followerLog[0].fetchedAt, now.toISOString())
  // 同一天手动改了数，就不再标成自动读的
  applyOps(state, [{ op: 'log_followers', platform: 'B站', followers: 52 }])
  assert.deepEqual([state.followerLog[0].followers, state.followerLog[0].fetchedAt], [52, undefined])
  applyOps(state, [{ op: 'log_account_stats', platform: 'B站', stats: { likes: 1 }, latest: { title: ' 一条  视频 ', url: 'https://www.bilibili.com/video/BV1', views: 9, likes: 'x', year: 2026 } }])
  assert.deepEqual(state.accountDaily[0].latest, { title: '一条 视频', url: 'https://www.bilibili.com/video/BV1', year: 2026, views: 9 })
})

test('log_account_stats：每个平台只留最近 400 天', () => {
  const state = migrateState({ items: [], metrics: [], accounts: [] })
  const start = new Date()
  start.setDate(start.getDate() - MAX_ACCOUNT_DAYS - 5)
  const ops = []
  for (let i = 0; i < MAX_ACCOUNT_DAYS + 5; i += 1) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    ops.push({ op: 'log_account_stats', platform: 'GitHub', date: localDay(d), stats: { fans: i } })
  }
  ops.push({ op: 'log_account_stats', platform: 'B站', stats: { likes: 1 } })
  applyOps(state, ops)
  assert.equal(state.accountDaily.filter(row => row.platform === 'GitHub').length, MAX_ACCOUNT_DAYS)
  assert.equal(state.accountDaily.filter(row => row.platform === 'B站').length, 1)
})

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'md-autoread-'))
  try {
    return await run(new Store(dir, { samples: false }), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('runAccountRead：读完写粉丝、账号数据和这一轮的结果；定时跑不进撤销栈，同一天不再跑', () => withStore(async (store) => {
  await store.mutate('加地址', draft => (applyOps(draft, [
    { op: 'add_account', platform: 'B站', url: 'https://space.bilibili.com/2' },
    { op: 'add_account', platform: '小红书', url: 'https://www.xiaohongshu.com/user/profile/1' },
  ]), draft))
  const undoBefore = store.undo.length
  const calls = []
  const fetchImpl = async (url) => { calls.push(String(url)); return json({ code: 0, data: { follower: 1437920, like_num: 9, archive_count: 44, card: { name: '碧诗' } } }) }
  const run = await runAccountRead(store, { trigger: 'schedule', fetchImpl })
  assert.equal(calls.length, 1)
  const { state } = run
  assert.equal(state.followerLog.find(row => row.platform === 'B站').followers, 1437920)
  assert.ok(state.followerLog[0].fetchedAt)
  assert.deepEqual(state.accountDaily.map(row => [row.platform, row.stats]), [['B站', { likes: 9, works: 44 }]])
  assert.equal(state.autoRead.day, localDay(new Date()))
  assert.equal(state.autoRead.trigger, 'schedule')
  assert.equal(state.autoRead.running, false)
  assert.deepEqual(state.autoRead.results.map(row => [row.platform, row.ok]), [['B站', true], ['小红书', false]])
  assert.match(state.autoRead.results[1].error, /登录/)
  assert.equal(store.undo.length, undoBefore)
  const again = await runAccountRead(store, { trigger: 'catchup', fetchImpl })
  assert.match(again.skipped, /今天已经读过/)
  assert.equal(calls.length, 1)
  // 手动点的不受「今天读过」限制，可以撤销
  const manual = await runAccountRead(store, { trigger: 'manual', fetchImpl })
  assert.equal(manual.skipped, undefined)
  assert.equal(store.undo.length, undoBefore + 1)
  // 大屏卡片上看得出哪项是自动读的、读于何时，读不到的写原因
  const board = computeBoard(manual.state)
  const bili = board.platforms.find(row => row.platform === 'B站')
  assert.deepEqual([bili.followers, bili.stats, Boolean(bili.fetchedAt), bili.url], [1437920, { likes: 9, works: 44 }, true, 'https://space.bilibili.com/2'])
  const xhs = board.platforms.find(row => row.platform === '小红书')
  assert.match(xhs.readError, /登录/)
}))

test('runAccountRead：上一轮还没结束就不再开一轮', () => withStore(async (store) => {
  await store.mutate('', draft => { draft.autoRead = { day: '2000-01-01', running: true, startedAt: new Date().toISOString() } }, { undoable: false })
  const run = await runAccountRead(store, { trigger: 'manual', fetchImpl: async () => { throw new Error('不该发请求') } })
  assert.match(run.skipped, /上一轮还在读/)
}))

test('startDailyRead：返回的函数能停掉定时器；没填主页地址时不占今天', () => withStore(async (store, dir) => {
  const desk = {}
  const stop = startDailyRead({ store, settings: new Settings(dir), desk, fetchImpl: async () => { throw new Error('不该发请求') } })
  assert.equal(typeof stop, 'function')
  stop()
  assert.equal((await store.read()).autoRead, undefined)
}))

test('startDailyRead：到了采样时间读一遍作品列表页，记成采样点；不采没有列表页的平台', () => withStore(async (store, dir) => {
  await store.mutate('', (draft) => {
    // 8 小时前发布的小红书笔记和视频号作品：小红书有作品列表页，视频号没有
    const date = new Date(Date.now() - 8 * 3600_000).toISOString()
    applyOps(draft, [
      { op: 'add_metric', replace: true, platform: '小红书', workId: '65f0c1a2000000000b00a1b2', title: '刚发的', date, views: 100 },
      { op: 'add_metric', replace: true, platform: '视频号', workId: 'v_1', title: '没列表页', date, views: 50 },
    ])
    // 今天的整轮已经跑过、也没有要重读的：接下来只看要不要加密采样
    draft.autoRead = { day: new Date().toISOString().slice(0, 10), slotAt: new Date().toISOString(), results: [] }
    return draft
  }, { undoable: false })
  const browser = {
    readPage: async (url) => (url.includes('note-manager')
      ? { url, text: '刚发的\n120\n0\n8\n3\n2', links: [{ href: 'https://www.xiaohongshu.com/explore/65f0c1a2000000000b00a1b2', text: '刚发的' }] }
      : { url, text: '粉丝 21844', links: [] }),
  }
  const opened = []
  let texts = 0
  const studio = {
    open: async () => { opened.push('open'); return browser },
    callText: async () => { texts += 1; return { text: JSON.stringify({ items: [{ title: '刚发的', views: '120', comments: '0', likes: '8', saves: '3', shares: '2' }] }) } },
    wait: async () => {},
  }
  const stop = startDailyRead({
    store,
    settings: new Settings(dir),
    desk: {},
    fetchImpl: async () => { throw new Error('不该读公开接口') },
    backstage: () => studio,
  })
  try {
    // 定时器和 host 里每分钟调的是同一个 dailyTick：这里直接调，不用等真的 20 秒
    assert.equal(await dailyTick({ store, settings: new Settings(dir), desk: {}, fetchImpl: async () => { throw new Error('不该读公开接口') }, backstage: () => studio }), 'sample')
  } finally {
    stop()
  }
  const state = await store.read()
  assert.equal(opened.length, 1)
  assert.equal(texts, 1, '只读了作品列表页，不认首页的数')
  assert.equal(state.metricSamples.length, 1)
  assert.deepEqual([state.metricSamples[0].platform, state.metricSamples[0].views], ['小红书', 120])
  assert.equal(state.metricSamples.some(row => row.platform === '视频号'), false)
  assert.equal(state.autoRead.results.length, 0, '采样不往大屏的运行结果里写')
}))

test('设置：自动读取默认每天 6:30 开着、18:30 第二轮，时间要是 HH:MM', () => withStore(async (_store, dir) => {
  const settings = new Settings(dir)
  assert.deepEqual((await settings.read()).autoRead, { enabled: true, time: '06:30', evening: '18:30' })
  await settings.update({ autoRead: { enabled: false, time: '21:05', evening: '' } })
  assert.deepEqual((await settings.read()).autoRead, { enabled: false, time: '21:05', evening: '' })
  await assert.rejects(settings.update({ autoRead: { evening: '7pm' } }), /06:30/)
  await assert.rejects(settings.update({ autoRead: { time: '25:00' } }), /06:30/)
  await assert.rejects(settings.update({ autoRead: { enabled: 'yes' } }), /开关/)
}))

test('runAccountRead：只读刚填地址的平台，不算今天的整轮，别的平台的结果照旧', () => withStore(async (store) => {
  await store.mutate('', draft => (applyOps(draft, [
    { op: 'add_account', platform: 'B站', url: 'https://space.bilibili.com/2' },
    { op: 'add_account', platform: 'GitHub', url: 'https://github.com/u' },
  ]), draft))
  await store.mutate('', (draft) => { draft.autoRead = { day: '2026-11-12', at: '2026-11-12T22:30:00.000Z', trigger: 'schedule', results: [{ platform: 'GitHub', ok: false, error: '旧原因' }] } }, { undoable: false })
  const calls = []
  const fetchImpl = async (url) => { calls.push(String(url)); return json({ code: 0, data: { follower: 7 } }) }
  const { state } = await runAccountRead(store, { trigger: 'manual', platforms: ['B站'], fetchImpl })
  assert.deepEqual(calls, ['https://api.bilibili.com/x/web-interface/card?mid=2'])
  assert.deepEqual([state.autoRead.day, state.autoRead.trigger], ['2026-11-12', 'schedule'])
  assert.deepEqual(state.autoRead.results.map(row => [row.platform, row.ok]), [['GitHub', false], ['B站', true]])
}))

test('撤销手动读取只撤数据，运行记录不会退回「正在读」', () => withStore(async (store) => {
  await store.mutate('', draft => (applyOps(draft, [{ op: 'add_account', platform: 'B站', url: 'https://space.bilibili.com/2' }]), draft))
  await runAccountRead(store, { trigger: 'manual', fetchImpl: async () => json({ code: 0, data: { follower: 7 } }) })
  assert.equal(store.undo.at(-1).label, '自动读取账号数据')
  await store.undoLast()
  const state = await store.read()
  assert.equal(state.followerLog.length, 0)
  assert.equal(state.autoRead.running, false)
  assert.equal(state.autoRead.results.length, 1)
}))

test('大屏：读不到的原因换了语言也能翻出来', async () => {
  const { withLang } = await import('../src/i18n.js')
  const state = migrateState({ items: [], metrics: [], accounts: [{ id: 'a', platform: '小红书', url: 'https://www.xiaohongshu.com/user/profile/1' }] })
  state.autoRead = { day: '2026-11-13', at: new Date().toISOString(), trigger: 'schedule', results: [{ platform: '小红书', ok: false, error: '小红书主页不登录会跳到登录页，读不到' }] }
  const card = withLang('en', () => computeBoard(state)).platforms.find(row => row.platform === '小红书')
  assert.match(card.readError, /Xiaohongshu profiles redirect to sign-in/)
})

/* ───────────── 读不到时：自动重读、要作者处理的平台、页面截图 ───────────── */

test('flaky：这次没读到、过会儿可能就好的才算；要登录的、待确认的、读到一部分的、本来就读不了的不算', () => {
  assert.equal(flaky({ platform: 'B站', ok: false, error: '超时' }), true)
  assert.equal(flaky({ platform: '小红书', ok: false, source: 'backstage', error: '后台页面是空的' }), true)
  assert.equal(flaky({ platform: 'B站', ok: true }), false)
  assert.equal(flaky({ platform: '公众号', ok: false, source: 'backstage', needLogin: true }), false)
  assert.equal(flaky({ platform: '抖音', ok: false, source: 'backstage', pending: { followers: 1 } }), false)
  assert.equal(flaky({ platform: 'YouTube', ok: false, got: ['latest'] }), false)
  // 小红书主页不登录读不了，公开接口那条读不到不重读
  assert.equal(flaky({ platform: '小红书', ok: false, error: '跳到登录页' }), false)
})

test('retryPlan：没读到的 20 分钟后重读一次、再过 40 分钟第二次，两次后不再排；只重读没读到的那几个', () => {
  const end = at(14, 6, 32)
  const results = [
    { platform: 'B站', ok: false, error: '超时' },
    { platform: 'GitHub', ok: true },
    { platform: '公众号', ok: false, source: 'backstage', needLogin: true },
  ]
  const autoRead = count => ({ results, retries: { day: localDay(end), count, at: (count ? at(14, 6, 52 + (count - 1) * 40) : end).toISOString() } })
  const first = retryPlan({ now: at(14, 6, 51), autoRead: autoRead(0) })
  assert.deepEqual([first.due, first.platforms, first.nextAt], [false, ['B站'], at(14, 6, 52).toISOString()])
  assert.equal(retryPlan({ now: at(14, 6, 52), autoRead: autoRead(0) }).due, true)
  // 第一次重读结束在 6:52：第二次要等到 7:32
  assert.equal(retryPlan({ now: at(14, 7, 31), autoRead: autoRead(1) }).due, false)
  assert.equal(retryPlan({ now: at(14, 7, 32), autoRead: autoRead(1) }).due, true)
  const done = retryPlan({ now: at(14, 12, 0), autoRead: autoRead(2) })
  assert.deepEqual([done.due, done.exhausted], [false, true])
  // 都读到了、只差要登录的：不重读
  assert.equal(retryPlan({ now: at(14, 9, 0), autoRead: { ...autoRead(0), results: results.slice(1) } }).due, false)
  // 隔天的记录、关了自动读取：不重读
  assert.equal(retryPlan({ now: at(15, 7, 0), autoRead: autoRead(0) }).due, false)
  assert.equal(retryPlan({ now: at(14, 9, 0), autoRead: autoRead(0), settings: { enabled: false } }).due, false)
  assert.equal(retryPlan({ now: at(14, 9, 0), autoRead: { results } }).due, false)
})

test('collectAttention：要登录的马上收；连着两轮没读到才收，单次失败不收；读到了就清掉；没读的平台照旧', () => {
  const now = '2026-11-14T07:00:00.000Z'
  const fail = { platform: 'B站', ok: false, error: '超时' }
  // 第一次没读到：会自动重读，先不打扰
  assert.deepEqual(collectAttention({ before: [{ platform: 'B站', ok: true }], after: [fail], read: ['B站'], at: now }), [])
  // 连着两轮没读到
  assert.deepEqual(collectAttention({ before: [fail], after: [{ ...fail, shot: 'backstage-x.jpg' }], read: ['B站'], at: now }), [{ platform: 'B站', reason: '超时', needLogin: false, at: now, shot: 'backstage-x.jpg' }])
  // 要重新登录：一次就收，原因用创作后台那边的
  const login = collectAttention({ after: [{ platform: '小红书', ok: true, source: 'backstage', needLogin: true, backstageError: '小红书后台需要重新登录' }], read: ['小红书'], opened: ['小红书'], at: now })
  assert.deepEqual(login.map(entry => [entry.platform, entry.needLogin, entry.reason]), [['小红书', true, '小红书后台需要重新登录']])
  const attention = [{ platform: 'B站', reason: '超时', needLogin: false, at: now }, { platform: '小红书', reason: '要登录', needLogin: true, at: now }]
  // 读到了就清掉；这一轮没读的平台留着
  assert.deepEqual(collectAttention({ before: [fail], after: [{ platform: 'B站', ok: true }], read: ['B站'], attention, at: now }).map(entry => entry.platform), ['小红书'])
  // 只读了公开接口（没打开小红书后台）：还不知道登好了没有，要登录那条留着
  assert.deepEqual(collectAttention({ after: [{ platform: '小红书', ok: false, error: '跳到登录页' }], read: ['小红书'], opened: [], attention, at: now }).map(entry => entry.platform), ['B站', '小红书'])
  // 打开了后台、读到了：清掉
  assert.deepEqual(collectAttention({ after: [{ platform: '小红书', ok: true, source: 'backstage' }], read: ['小红书'], opened: ['小红书'], attention, at: now }).map(entry => entry.platform), ['B站'])
})

test('runAccountRead：没读到的平台按 20/40 分钟重读两次，次数落盘、重启不重复；连着两轮没读到进 attention，读到了自动清掉', () => withStore(async (store) => {
  await store.mutate('', draft => (applyOps(draft, [
    { op: 'add_account', platform: 'B站', url: 'https://space.bilibili.com/2' },
    { op: 'add_account', platform: 'GitHub', url: 'https://github.com/u' },
  ]), draft))
  let clock = at(14, 6, 30)
  const now = () => clock
  let biliUp = false
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('bilibili')) {
      if (!biliUp) throw new Error('socket hang up')
      return json({ code: 0, data: { follower: 7 } })
    }
    return json(String(url).endsWith('/users/u') ? { login: 'u', followers: 3 } : [])
  }
  const first = await runAccountRead(store, { trigger: 'schedule', fetchImpl, now })
  assert.deepEqual(first.state.autoRead.retries, { day: localDay(clock), count: 0, at: clock.toISOString() })
  // 只没读到一次：不进 attention
  assert.deepEqual(first.state.autoRead.attention, [])
  const plan = retryPlan({ now: at(14, 6, 50), autoRead: first.state.autoRead })
  assert.deepEqual([plan.due, plan.platforms], [true, ['B站']])
  // 还没到时间（比如另一个进程刚重读过）：不读
  clock = at(14, 6, 40)
  calls.length = 0
  assert.match((await runAccountRead(store, { trigger: 'retry', platforms: ['B站'], fetchImpl, now })).skipped, /重读已经做过/)
  assert.equal(calls.length, 0)
  // 第一次重读：只读没读到的 B 站，次数加 1，不算今天的整轮
  clock = at(14, 6, 50)
  const retry1 = await runAccountRead(store, { trigger: 'retry', platforms: ['B站'], fetchImpl, now })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes('bilibili'))
  assert.deepEqual([retry1.state.autoRead.retries.count, retry1.state.autoRead.trigger, retry1.state.autoRead.day], [1, 'retry', localDay(clock)])
  // 重读结束再记一次时间：下一次（40 分钟后）从这里算起
  assert.deepEqual(retry1.state.autoRead.retries.at, clock.toISOString())
  assert.equal(retry1.state.autoRead.at, clock.toISOString())
  // 连着两轮没读到：进 attention
  assert.deepEqual(retry1.state.autoRead.attention.map(entry => [entry.platform, entry.needLogin]), [['B站', false]])
  // 「重启」后再看：次数在数据里，40 分钟没到不会再排
  assert.equal(retryPlan({ now: at(14, 7, 20), autoRead: (await store.read()).autoRead }).due, false)
  assert.equal(retryPlan({ now: at(14, 7, 30), autoRead: (await store.read()).autoRead }).due, true)
  // 第二次重读读到了：attention 清掉，结果换成读到的
  biliUp = true
  clock = at(14, 7, 30)
  const retry2 = await runAccountRead(store, { trigger: 'retry', platforms: ['B站'], fetchImpl, now })
  assert.deepEqual(retry2.state.autoRead.attention, [])
  assert.equal(retry2.state.autoRead.retries.count, 2)
  assert.deepEqual(retry2.state.autoRead.results.map(row => [row.platform, row.ok]).sort(), [['B站', true], ['GitHub', true]])
  // 两次用完：再没读到也不排第三次
  assert.equal(retryPlan({ now: at(14, 12, 0), autoRead: { ...retry2.state.autoRead, results: [{ platform: 'B站', ok: false }] } }).exhausted, true)
}))

test('页面截图：文件名只用 ASCII；每轮最多存 3 张，每个平台只留最近 3 张；存不下不影响结果', () => withStore(async (store) => {
  const dir = store.filesDir
  assert.equal(shotName('小红书', at(14, 6, 5)), 'backstage-xiaohongshu-20261114-060500.jpg')
  assert.deepEqual(staleShots(['backstage-douyin-20261110-060000.jpg', 'backstage-douyin-20261112-060000.jpg', 'backstage-douyin-20261111-060000.jpg', 'backstage-douyin-20261113-060000.jpg', 'f_cover.png', 'backstage-bilibili-20261101-060000.jpg']), ['backstage-douyin-20261110-060000.jpg'])
  await store.read()
  for (const day of [10, 11, 12]) await writeFile(join(dir, `backstage-xiaohongshu-202611${day}-060000.jpg`), 'old')
  const jpeg = Buffer.from('fake-jpeg').toString('base64')
  const rows = ['小红书', '抖音', '公众号', '视频号', 'B站'].map(platform => ({ platform, error: '后台页面是空的', shot: jpeg }))
  const saved = await saveShots(dir, rows, at(14, 6, 5))
  assert.equal(saved.filter(row => row.shot).length, MAX_SHOTS_PER_RUN)
  assert.deepEqual(saved.slice(3).map(row => 'shot' in row), [false, false])
  const files = (await readdir(dir)).filter(name => name.startsWith('backstage-')).sort()
  assert.deepEqual(files.filter(name => name.includes('xiaohongshu')), ['backstage-xiaohongshu-20261111-060000.jpg', 'backstage-xiaohongshu-20261112-060000.jpg', 'backstage-xiaohongshu-20261114-060500.jpg'])
  assert.equal(files.length, 5)
  // 目录写不进去：结果照常，原因记在 shotError
  const broken = await saveShots(join(dir, 'missing', 'deeper'), rows.slice(0, 1), at(14, 6, 6))
  assert.deepEqual([broken[0].error, broken[0].shot], ['后台页面是空的', undefined])
  assert.match(broken[0].shotError, /截图没存下/)
}))

test('边读边落盘与强制刷新：不等最后一个平台结束先写进 store；force 绕过 10 分钟冷却；scope=public 不污染后台卡片', () => withStore(async (store) => {
  await store.mutate('', draft => (applyOps(draft, [
    { op: 'add_account', platform: 'B站', url: 'https://space.bilibili.com/2' },
    { op: 'add_account', platform: '小红书', url: 'https://www.xiaohongshu.com/user/profile/1' },
  ]), draft))
  let midFollowers = null
  let midProgress = null
  const fetchImpl = async () => json({ code: 0, data: { follower: 888, like_num: 10, archive_count: 2 } })
  const backstage = {
    open: async () => ({
      readPage: async (url) => {
        // 浏览器刚打开第一个平台时，公开接口读到的 B 站粉丝数应该已经落盘了
        if (midFollowers === null) {
          const mid = await store.read()
          midFollowers = mid.followerLog.find(r => r.platform === 'B站')?.followers ?? null
          midProgress = mid.autoRead?.progress ?? null
        }
        return { url, text: url.includes('xiaohongshu') ? '粉丝 22036' : '' }
      },
      close: async () => {},
    }),
    callText: async () => ({ text: JSON.stringify({ followers: '22036' }) }),
    wait: async () => {},
  }
  const clock = at(14, 10, 0)
  await runAccountRead(store, { trigger: 'manual', force: true, fetchImpl, backstage, now: () => clock })
  assert.equal(midFollowers, 888, '公开接口读完立刻落盘，不等后台全部跑完')
  assert.equal(midProgress?.current, '小红书')
  // 紧接着 1 分钟后再次带 force 手动刷新：不被 10 分钟冷却拦住
  const forceAgain = await runAccountRead(store, { trigger: 'manual', force: true, platforms: ['小红书'], fetchImpl, backstage, now: () => at(14, 10, 1) })
  assert.equal(forceAgain.results.find(r => r.platform === '小红书')?.skipped, undefined)
  assert.equal(forceAgain.results.find(r => r.platform === '小红书')?.followers, 22036)
  // 打开大屏触发 scope=public 时，跳过免登录读不了的小红书主页，不把报错盖在已有后台数据的卡片上
  await runAccountRead(store, { trigger: 'refresh', scope: 'public', fetchImpl, now: () => at(14, 10, 2) })
  const card = computeBoard(await store.read(), at(14, 10, 2)).platforms.find(r => r.platform === '小红书')
  assert.equal(card.readError, null)
}))
