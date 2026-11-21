import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeBoard } from '../src/board.js'
import { applyOps } from '../src/ops.js'
import { buildSeed, migrateState } from '../src/seed.js'

const NOW = new Date('2026-11-12T16:20:00+08:00')

function day(offset) {
  const d = new Date(NOW)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function empty() {
  return { items: [], metrics: [], accounts: [], followerLog: [], skills: [] }
}

function log(state, platform, offset, followers) {
  state.followerLog.push({ id: `${platform}_${offset}`, platform, date: day(offset), followers })
}

test('粉丝合计取每个平台最近一次记录，今日、7 天、30 天按当天之前的最后一次记录算', () => {
  const state = empty()
  log(state, '小红书', -30, 1000)
  log(state, '小红书', -7, 1500)
  log(state, '小红书', -1, 1900)
  log(state, '小红书', 0, 2000)
  log(state, 'X', -3, 500)
  log(state, 'X', 0, 520)
  const board = computeBoard(state, NOW)
  assert.equal(board.total.followers, 2520)
  // X 昨天没记，今日涨跌算不出来，不拿 3 天前的数顶替
  assert.equal(board.total.today, 100)
  // X 在 7 天前还没有记录，不参与 7 天和 30 天的涨跌
  assert.equal(board.total.d7, 500)
  assert.equal(board.total.d30, 1000)
  const x = board.platforms.find(row => row.platform === 'X')
  assert.equal(x.followers, 520)
  assert.equal(x.today, null)
  assert.equal(x.d7, null)
  assert.equal(x.since, day(-3))
})

test('每日净增只统计前后两天都有数的平台，共 30 天', () => {
  const state = empty()
  log(state, '小红书', -2, 100)
  log(state, '小红书', -1, 130)
  log(state, '小红书', 0, 125)
  const board = computeBoard(state, NOW)
  assert.equal(board.daily.length, 30)
  assert.equal(board.daily.at(-1).date, day(0))
  assert.equal(board.daily.at(-1).net['小红书'], -5)
  assert.equal(board.daily.at(-2).net['小红书'], 30)
  // 第一天之前没有记录，算不出净增
  assert.equal(board.daily.at(-3).net['小红书'], undefined)
})

test('记录有间隔：没记的日子不出数字，隔了很久的增量不算成今日或近 7 天', () => {
  const gap = empty()
  log(gap, '小红书', -11, 100)
  log(gap, '小红书', -7, 140)
  const stale = computeBoard(gap, NOW)
  const card = stale.platforms[0]
  assert.equal(card.followers, 140)
  assert.equal(card.today, null)
  assert.equal(card.d7, null)
  assert.equal(card.loggedAt, day(-7))
  assert.ok(stale.daily.every(row => Object.keys(row.net).length === 0))
  assert.deepEqual(stale.analysis, [])

  const jump = empty()
  log(jump, '小红书', -42, 100)
  log(jump, '小红书', 0, 200)
  const far = computeBoard(jump, NOW).platforms[0]
  assert.equal(far.today, null)
  assert.equal(far.d7, null)
  assert.equal(far.d30, null)
})

test('自己的内容已经有了，粉丝和播放还是示例时，最新发布不拿示例顶替', () => {
  const state = buildSeed(NOW, 'zh')
  applyOps(state, [{ op: 'add_item', title: '我自己的第一条' }])
  const mine = state.items.find(item => !item.sample)
  mine.status = 'published'
  mine.publishedAt = `${day(-1)}T12:00:00.000Z`
  const board = computeBoard(state, NOW)
  assert.equal(board.latest.title, '我自己的第一条')
  assert.equal(board.hasSample, true)
})

test('没有任何粉丝记录时退回账号档案里的粉丝数，涨跌为空', () => {
  const state = empty()
  state.accounts.push({ id: 'a', platform: '公众号', handle: '示例作者', followers: 800 })
  const board = computeBoard(state, NOW)
  assert.equal(board.total.followers, 800)
  assert.equal(board.total.today, null)
  assert.equal(board.platforms[0].d7, null)
  assert.equal(board.updatedAt, null)
})

test('最新发布：优先最近一条已发布，带上各平台数据和上一条的对比', () => {
  const state = empty()
  state.items.push(
    { id: 'old', title: '上一期', status: 'published', publishedAt: `${day(-8)}T12:00:00.000Z`, platform: '小红书' },
    { id: 'new', title: '这一期', status: 'published', publishedAt: `${day(-1)}T12:00:00.000Z`, platform: '小红书' },
  )
  state.metrics.push(
    { id: 'm1', itemId: 'old', platform: '小红书', date: `${day(-8)}T12:00:00.000Z`, views: 1000, likes: 50, comments: 0, shares: 0, saves: 50 },
    { id: 'm2', itemId: 'new', platform: '小红书', date: `${day(-1)}T12:00:00.000Z`, views: 400, likes: 30, comments: 2, shares: 0, saves: 8 },
    { id: 'm3', itemId: 'new', platform: 'X', date: `${day(0)}T04:00:00.000Z`, views: 600, likes: 10, comments: 0, shares: 0, saves: 0 },
  )
  const board = computeBoard(state, NOW)
  assert.equal(board.latest.id, 'new')
  assert.equal(board.latest.views, 1000)
  assert.equal(board.latest.engaged, 50)
  assert.deepEqual(board.latest.platforms.map(row => [row.platform, row.views]), [['X', 600], ['小红书', 400]])
  assert.equal(board.latest.previous.title, '上一期')
  assert.equal(board.latest.previous.views, 1000)
  const xhs = board.platforms.find(row => row.platform === '小红书')
  assert.equal(xhs.latestViews, 400)
  assert.equal(xhs.previousViews, 1000)
  assert.equal(xhs.engagementRate, 140 / 1400)
})

test('最新发布：还没发过内容时显示最近一条排期', () => {
  const state = empty()
  state.items.push({ id: 'next', title: '定时的', status: 'ready', scheduledAt: `${day(1)}T09:30:00.000Z`, platform: '公众号' })
  const board = computeBoard(state, NOW)
  assert.equal(board.latest.id, 'next')
  assert.equal(board.latest.scheduled, true)
  // 还没有任何数据：播放是未知，不是 0
  assert.equal(board.latest.views, null)
  assert.equal(board.latest.engagementRate, null)
})

test('数据分析只在数据够的时候才出结论', () => {
  assert.deepEqual(computeBoard(empty(), NOW).analysis, [])
  const state = empty()
  log(state, '小红书', -7, 1000)
  log(state, '小红书', 0, 1300)
  log(state, 'X', -7, 500)
  log(state, 'X', 0, 600)
  state.metrics.push(
    { id: 'a', platform: '小红书', date: `${day(-2)}T04:00:00.000Z`, views: 1000, likes: 100, comments: 0, shares: 0, saves: 60 },
    { id: 'b', platform: 'X', date: `${day(-2)}T04:00:00.000Z`, views: 3000, likes: 30, comments: 0, shares: 0, saves: 3 },
  )
  const analysis = computeBoard(state, NOW).analysis
  const byTag = Object.fromEntries(analysis.map(row => [row.tag, row.text]))
  assert.match(byTag['涨粉'], /小红书 \+300.*75%/)
  assert.match(byTag['播放'], /75%.*X/)
  assert.match(byTag['互动'], /小红书 16\.0%.*X 1\.1%/)
  assert.match(byTag['收藏'], /小红书每 100 次播放有 6\.0 个收藏/)
})

test('有真实数据后，示例的粉丝记录和账号不再参与', () => {
  const state = buildSeed(NOW, 'zh')
  const sample = computeBoard(state, NOW)
  assert.equal(sample.hasSample, true)
  assert.ok(sample.total.followers > 0)
  assert.ok(sample.daily.some(row => Object.keys(row.net).length > 0))
  applyOps(state, [{ op: 'log_followers', platform: '知乎', followers: 321, date: day(0) }])
  const real = computeBoard(state, NOW)
  assert.equal(real.hasSample, false)
  assert.equal(real.total.followers, 321)
  assert.deepEqual(real.platforms.map(row => row.platform), ['知乎'])
})

test('log_followers：同一平台同一天只留一条，并同步到账号档案', () => {
  const state = empty()
  const first = applyOps(state, [{ op: 'log_followers', platform: '小红书', followers: 100, date: day(0) }])
  assert.equal(first.errors.length, 0)
  applyOps(state, [{ op: 'log_followers', platform: '小红书', followers: 120, date: day(0) }])
  assert.equal(state.followerLog.length, 1)
  assert.equal(state.followerLog[0].followers, 120)
  assert.equal(state.accounts.length, 1)
  assert.equal(state.accounts[0].followers, 120)
  // 补记更早的一天，不能把账号上的最新数字盖掉
  applyOps(state, [{ op: 'log_followers', platform: '小红书', followers: 90, date: day(-3) }])
  assert.equal(state.accounts[0].followers, 120)
  assert.equal(state.followerLog.length, 2)
})

test('log_followers 拒绝不认识的平台、负数和坏日期', () => {
  const state = empty()
  const { errors } = applyOps(state, [
    { op: 'log_followers', platform: '不存在', followers: 1 },
    { op: 'log_followers', platform: 'X', followers: -5 },
    { op: 'log_followers', platform: 'X', followers: 5, date: 'nope' },
    { op: 'log_followers', platform: 'X', followers: 5, date: '2026-02-31' },
    { op: 'log_followers', platform: 'X', followers: 5, date: '2099-01-01' },
  ])
  assert.equal(errors.length, 5)
  assert.equal(state.followerLog.length, 0)
})

test('旧数据没有 followerLog 时迁移补上；清空示例会清掉示例粉丝记录', () => {
  const state = buildSeed(NOW, 'zh')
  assert.ok(state.followerLog.length > 0)
  assert.ok(state.followerLog.every(row => row.sample))
  applyOps(state, [{ op: 'clear_samples' }])
  assert.equal(state.followerLog.length, 0)
  const old = buildSeed(NOW, 'zh')
  delete old.followerLog
  assert.deepEqual(migrateState(old).followerLog, [])
})

test('导入的后台数据：同一条作品再导一次是更新，不会翻倍；手动录入照旧累加', () => {
  const state = empty()
  const row = { op: 'add_metric', replace: true, platform: '小红书', title: '同一条笔记', date: `${day(-1)}T04:00:00.000Z`, views: 100, likes: 5 }
  applyOps(state, [row, { ...row, views: 180, likes: 9 }, { ...row, title: '另一条', views: 50 }])
  assert.deepEqual(state.metrics.map(m => [m.title, m.views, m.likes]), [['同一条笔记', 180, 9], ['另一条', 50, 5]])
  applyOps(state, [{ op: 'add_metric', platform: '小红书', views: 10 }, { op: 'add_metric', platform: '小红书', views: 10 }])
  assert.equal(state.metrics.length, 4)
})

test('没给的数不补 0：add_metric 只存给了的项，新字段校验，一个数都没有时拒绝', () => {
  const state = empty()
  const { errors } = applyOps(state, [
    { op: 'add_metric', platform: '小红书', date: `${day(-1)}T04:00:00.000Z`, likes: 0, impressions: 900, completion: 0.35, newFollowers: 3, minutes: 40 },
    { op: 'add_metric', platform: '小红书', completion: 35 },
    { op: 'add_metric', platform: '小红书' },
  ])
  assert.equal(errors.length, 2, '完播率超出 0–1 被丢掉后就没有数了；空的一条也不收')
  const [row] = state.metrics
  assert.equal(row.likes, 0, '记下的 0 还是 0')
  assert.equal('views' in row, false)
  assert.equal('saves' in row, false)
  assert.deepEqual([row.impressions, row.completion, row.newFollowers, row.minutes], [900, 0.35, 3, 40])
})

test('导入更新：这次表里没有的列不沿用上次的；先按标题导入后来建了同名内容，再导时挂上去而不是多一份', () => {
  const state = empty()
  const first = { op: 'add_metric', replace: true, platform: '小红书', itemId: null, title: '同名', date: `${day(-2)}T04:00:00.000Z`, views: 100, saves: 7 }
  applyOps(state, [first])
  const { saves: _saves, ...withoutSaves } = first
  applyOps(state, [{ ...withoutSaves, itemId: 'it_1', views: 150 }])
  assert.equal(state.metrics.length, 1)
  assert.deepEqual([state.metrics[0].itemId, state.metrics[0].views, 'saves' in state.metrics[0]], ['it_1', 150, false])
  // 反过来：已经挂上的，再导时没对上内容，也认作同一条，挂的内容不丢
  applyOps(state, [{ ...first, views: 160 }])
  assert.deepEqual(state.metrics.map(m => [m.itemId, m.views]), [['it_1', 160]])
})

test('作品 ID 认同一条的顺序：作品 ID > 挂的内容 > 标题+平台+日期；标题在平台上改过也认得出是同一条', () => {
  const state = empty()
  const base = { op: 'add_metric', replace: true, platform: '小红书', workId: 'note_1', itemId: 'it_1', title: '原标题', date: `${day(-1)}T04:00:00.000Z`, views: 100 }
  applyOps(state, [base])
  // 1. 作品 ID：标题、挂的内容、日期都变了，ID 一样就是同一条（平台上改了标题）
  applyOps(state, [{ ...base, title: '改过的标题', itemId: null, date: `${day(-1)}T20:00:00.000Z`, views: 180, likes: 9 }])
  assert.equal(state.metrics.length, 1)
  assert.deepEqual([state.metrics[0].title, state.metrics[0].views, state.metrics[0].likes], ['改过的标题', 180, 9])
  // 挂了的内容认过一次就留着
  assert.equal(state.metrics[0].itemId, 'it_1')
  // 2. 标题一样、ID 也一样的还是更新
  applyOps(state, [{ ...base, views: 200 }])
  assert.deepEqual(state.metrics.map(m => [m.title, m.views]), [['原标题', 200]])
  // 3. 两条不同的作品 ID 即使标题一样也各记各的
  applyOps(state, [{ ...base, workId: 'note_2', views: 12, title: '同一天同名' }, { ...base, workId: 'note_2', views: 30, title: '同一天同名' }])
  assert.equal(state.metrics.length, 2)
  assert.deepEqual(state.metrics.map(m => [m.workId, m.views]), [['note_1', 200], ['note_2', 30]])
})

test('作品 ID 认不出来的旧数据：退回按挂的内容认，再退回按标题+平台+日期认', () => {
  const state = empty()
  // 没有 ID 的表里导进来的：同一天同一条更新
  const legacy = { op: 'add_metric', replace: true, platform: 'B站', title: '一条', date: `${day(-2)}T04:00:00.000Z`, views: 10 }
  applyOps(state, [legacy, { ...legacy, views: 20, likes: 1 }])
  assert.deepEqual(state.metrics.map(m => [m.views, m.likes]), [[20, 1]])
  // 只按标题：换了日期也认作同一条（后台导出的表日期可能跟着数据日期走）
  applyOps(state, [{ ...legacy, date: `${day(-2)}T20:00:00.000Z`, views: 30 }])
  assert.deepEqual(state.metrics.map(m => [m.views]), [[30]])
  // 同标题但挂的内容不同：按内容认，各存一条；之前那条没挂内容，正好挂到 a 上
  applyOps(state, [{ ...legacy, itemId: 'a', views: 1 }, { ...legacy, itemId: 'b', views: 2 }])
  assert.deepEqual(state.metrics.map(m => [m.itemId, m.views]), [['a', 1], ['b', 2]])
  // 都没有时按 平台 + 日期 认
  applyOps(state, [{ op: 'add_metric', replace: true, platform: 'X', date: `${day(-3)}T04:00:00.000Z`, views: 5 }])
  applyOps(state, [{ op: 'add_metric', replace: true, platform: 'X', date: `${day(-3)}T09:00:00.000Z`, views: 6 }])
  assert.deepEqual(state.metrics.filter(m => m.platform === 'X').map(m => m.views), [6])
})

test('迁移：老数据没有作品的 ID、采样序列也能读；缺字段不报错', () => {
  const state = buildSeed(NOW, 'zh')
  delete state.metricSamples
  for (const row of state.metrics) {
    delete row.workId
    delete row.ts
  }
  const migrated = migrateState(state)
  assert.deepEqual(migrated.metricSamples, [])
  assert.ok(migrated.metrics.length > 0)
  assert.ok(migrated.metrics.every(row => row.workId === undefined && row.ts === undefined))
  // 最老的样子：连 metrics 都没有也不报错，清空示例时也不会因为采样表不存在而出错
  const old = { items: [], followerLog: [] }
  const done = migrateState(old)
  assert.deepEqual(done.metricSamples, [])
  applyOps(done, [{ op: 'clear_samples' }])
  assert.deepEqual(done.metricSamples, [])
})

test('缺数据时：合计只加记了的，比例只用分子分母都有的记录，没有就是 null', () => {
  const state = empty()
  state.items.push({ id: 'p', title: '一条', status: 'published', publishedAt: `${day(-1)}T12:00:00.000Z`, platform: '小红书' })
  state.metrics.push(
    // 只有互动没有播放：算互动合计，不进互动率
    { id: 'a', itemId: 'p', platform: '小红书', date: `${day(-1)}T12:00:00.000Z`, likes: 30, saves: 10 },
    // 只有播放：算播放合计，不进互动率的分子分母
    { id: 'b', itemId: 'p', platform: 'X', date: `${day(-1)}T12:00:00.000Z`, views: 500 },
  )
  const board = computeBoard(state, NOW)
  assert.equal(board.latest.views, 500)
  assert.equal(board.latest.engaged, 40)
  assert.equal(board.latest.engagementRate, null)
  const x = board.platforms.find(row => row.platform === 'X')
  assert.equal(x.engagementRate, null)
  assert.equal(board.platforms.find(row => row.platform === '小红书').views30, null)
  assert.deepEqual(board.analysis, [])
})

test('数据分析：互动没记的平台不进互动率对比；有平台缺播放时不出播放占比', () => {
  const state = empty()
  state.metrics.push(
    { id: 'a', platform: '小红书', date: `${day(-2)}T04:00:00.000Z`, views: 1000, likes: 100, saves: 60 },
    { id: 'b', platform: 'X', date: `${day(-2)}T04:00:00.000Z`, views: 3000 },
    { id: 'c', platform: '知乎', date: `${day(-2)}T04:00:00.000Z`, likes: 5 },
  )
  const tags = computeBoard(state, NOW).analysis.map(row => row.tag)
  assert.equal(tags.includes('互动'), false, 'X 没记互动，只剩一个平台可比')
  assert.equal(tags.includes('播放'), false, '知乎没记播放，全部播放的分母不完整')
  assert.ok(tags.includes('收藏'))
})

test('粉丝合计：一个平台都没数时是 null；只有部分平台有数时标成部分合计', () => {
  const none = computeBoard({ ...empty(), accounts: [{ id: 'a', platform: '公众号', followers: null }] }, NOW)
  assert.equal(none.total.followers, null)
  assert.equal(none.total.partial.followers, false)
  const state = empty()
  state.accounts.push({ id: 'a', platform: '公众号', followers: null })
  log(state, '小红书', -1, 100)
  log(state, '小红书', 0, 110)
  const some = computeBoard(state, NOW)
  assert.equal(some.total.followers, 110)
  assert.equal(some.total.platforms, 2)
  assert.deepEqual([some.total.known.followers, some.total.partial.followers], [1, true])
  assert.deepEqual([some.total.today, some.total.partial.today], [10, true])
  assert.equal(some.total.approx, false)

  // 有平台粉丝数是后台约数时，合计标上 approx
  const approxState = empty()
  approxState.followerLog.push({ id: 'dy_0', platform: '抖音', date: day(0), followers: 11300, fetchedAt: NOW.toISOString(), approx: true })
  assert.equal(computeBoard(approxState, NOW).total.approx, true)
})

test('GitHub 和谷歌学术能记数、能上大屏；GitHub 读名下仓库的 star 总数，fork 来的不算', async () => {
  const { githubLogin, githubUser } = await import('../src/harvest.js')
  const state = empty()
  const { errors } = applyOps(state, [
    { op: 'log_followers', platform: 'GitHub', followers: 1200, date: day(0) },
    { op: 'log_followers', platform: '谷歌学术', followers: 35, date: day(0) },
    { op: 'set_board_platforms', platforms: ['GitHub', '谷歌学术', '小红书'] },
  ])
  assert.deepEqual(errors, [])
  assert.deepEqual(computeBoard(state, NOW).platforms.map(row => [row.platform, row.followers]), [['GitHub', 1200], ['谷歌学术', 35]])
  // Star 进合计，被引不进
  assert.equal(computeBoard(state, NOW).total.followers, 1200)
  assert.equal(githubLogin('https://github.com/some-user/'), 'some-user')
  assert.equal(githubLogin('https://github.com/some-user/repo'), null)
  assert.equal(githubLogin('https://evil.example/github.com/x'), null)
  const fake = async () => new Response(JSON.stringify([{ stargazers_count: 40 }, { stargazers_count: 2 }, { stargazers_count: 900, fork: true }]), { headers: { 'content-type': 'application/json' } })
  assert.deepEqual(await githubUser('https://github.com/some-user', fake), { name: 'some-user', followers: 42, works: 2, latest: null, top: null })
})
