// 对标账号：B 站 card 接口样本来自 2026-11-13 这台电脑对 mid=2 的真实请求（删减后）；网络一律走注入的 fetchImpl。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { myFollowers, rivalTrend, shiftDate } from '../client/rival-stats.js'
import { applyOps, MAX_RIVALS } from '../src/ops.js'
import { parseBilibiliAccount } from '../src/collect.js'
import { bilibiliUid, readRival, readRivals } from '../src/rivals.js'
import { migrateState } from '../src/seed.js'

// https://api.bilibili.com/x/web-interface/card?mid=2
const CARD = { code: 0, message: 'OK', ttl: 1, data: { card: { mid: '2', name: '碧诗', fans: 1437920, attention: 430, sign: 'https://kami.im 直男过气网红 #  We Are Star Dust' }, archive_count: 44, follower: 1437920 } }

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const html = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })

test('parseBilibiliAccount：昵称、粉丝数、投稿数；接口报错时带上原因', () => {
  assert.deepEqual(parseBilibiliAccount(CARD), { name: '碧诗', followers: 1437920, stats: { works: 44 } })
  assert.throws(() => parseBilibiliAccount({ code: -404, message: '啥都木有' }), /啥都木有/)
  assert.equal(bilibiliUid('https://space.bilibili.com/2?spm_id_from=333'), '2')
  assert.equal(bilibiliUid('https://www.bilibili.com/video/BV1'), null)
})

test('readRival：B 站一次请求读全；其他平台读公开页面，读不到粉丝数就说读不到', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    const href = String(url)
    calls.push(href)
    if (href === 'https://api.bilibili.com/x/web-interface/card?mid=2') return json(CARD)
    if (href.startsWith('https://1.1.1.1/')) return html('<html><head><title>某个作者</title></head><body>2.3万 粉丝</body></html>')
    return html('<html><head><title>小红书 - 你的生活兴趣社区</title></head><body>登录后查看更多</body></html>')
  }
  assert.deepEqual(await readRival({ id: 'a', platform: 'B站', url: 'https://space.bilibili.com/2' }, fetchImpl), { id: 'a', name: '碧诗', followers: 1437920, works: 44, error: null })
  assert.equal(calls.length, 1)
  const page = await readRival({ id: 'b', platform: '知乎', url: 'https://1.1.1.1/people/x' }, fetchImpl)
  // 页面上写着「2.3万 粉丝」也不记：分不清它是粉丝数、关注数还是推荐语
  assert.deepEqual([page.name, page.followers, page.error], ['某个作者', null, '这个平台不登录读不到粉丝数'])
  const walled = await readRival({ id: 'c', platform: '小红书', url: 'https://8.8.8.8/user/profile/1' }, fetchImpl)
  assert.deepEqual([walled.followers, walled.error], [null, '这个平台不登录读不到粉丝数'])
  const bad = await readRival({ id: 'd', platform: 'B站', url: 'https://www.bilibili.com/video/BV1' }, fetchImpl)
  assert.match(bad.error, /space\.bilibili\.com/)
  const internal = await readRival({ id: 'e', platform: '知乎', url: 'http://127.0.0.1/me' }, fetchImpl)
  assert.match(internal.error, /本机|内网/)
})

test('readRivals：按输入顺序返回，失败的只影响自己', async () => {
  const fetchImpl = async url => (String(url).includes('mid=2') ? json(CARD) : json({ code: -412, message: '请求被拦截' }, 412))
  const results = await readRivals([{ id: 'a', platform: 'B站', url: 'https://space.bilibili.com/2' }, { id: 'b', platform: 'B站', url: 'https://space.bilibili.com/3' }], fetchImpl)
  assert.deepEqual(results.map(row => [row.id, row.followers]), [['a', 1437920], ['b', null]])
  assert.match(results[1].error, /412/)
})

test('add_rival / update_rival / delete_rival：校验平台和地址，最多 50 个，删掉时连记录一起删', () => {
  const state = migrateState({ items: [], metrics: [] })
  assert.deepEqual([state.rivals, state.rivalLog], [[], []])
  const { errors } = applyOps(state, [
    { op: 'add_rival', platform: 'B站', url: 'https://space.bilibili.com/2', note: '学他的选题' },
    { op: 'add_rival', platform: 'B站', url: 'https://space.bilibili.com/2' },
    { op: 'add_rival', platform: '微博', url: 'https://weibo.com/u/1' },
    { op: 'add_rival', platform: '知乎', url: 'javascript:alert(1)' },
  ])
  assert.equal(errors.length, 3)
  const [rival] = state.rivals
  assert.deepEqual([rival.platform, rival.note, rival.name], ['B站', '学他的选题', ''])
  applyOps(state, [{ op: 'update_rival', id: rival.id, name: '站长', note: '' }])
  assert.deepEqual([state.rivals[0].name, state.rivals[0].note], ['站长', ''])
  applyOps(state, [{ op: 'update_rival', id: rival.id, fetchError: '页面返回 403', fetchedAt: '2026-11-13T08:00:00.000Z' }])
  assert.deepEqual([state.rivals[0].fetchError, state.rivals[0].fetchedAt, state.rivals[0].name], ['页面返回 403', '2026-11-13T08:00:00.000Z', '站长'])

  applyOps(state, [{ op: 'log_rival', rivalId: rival.id, followers: 100, works: 3, name: '碧诗' }, { op: 'log_rival', rivalId: rival.id, followers: 120 }])
  assert.equal(state.rivalLog.length, 1, '同一天只留一条')
  assert.equal(state.rivalLog[0].followers, 120)
  assert.equal(state.rivals[0].name, '站长', '起过名字的不被读到的名字覆盖')
  assert.ok(applyOps(state, [{ op: 'log_rival', rivalId: rival.id, followers: -1 }]).errors.length)

  applyOps(state, [{ op: 'delete_rival', id: rival.id }])
  assert.deepEqual([state.rivals, state.rivalLog], [[], []])

  const full = { rivals: Array.from({ length: MAX_RIVALS }, (_, i) => ({ id: `r${i}`, platform: 'B站', url: `https://space.bilibili.com/${i}` })) }
  assert.match(applyOps(full, [{ op: 'add_rival', platform: 'B站', url: 'https://space.bilibili.com/999' }]).errors[0], /50/)
})

test('log_rival：没起名字的账号用读到的名字', () => {
  const state = { rivals: [], rivalLog: [] }
  applyOps(state, [{ op: 'add_rival', platform: 'B站', url: 'https://space.bilibili.com/2' }])
  applyOps(state, [{ op: 'log_rival', rivalId: state.rivals[0].id, followers: 1437920, works: 44, name: '碧诗' }])
  assert.equal(state.rivals[0].name, '碧诗')
  assert.equal(state.rivalLog[0].works, 44)
})

test('rivalTrend：涨跌只在两头都真的记过时才算，没记的日子不拿前后的数顶替', () => {
  const now = new Date(2026, 10, 13, 15)
  const log = [
    { rivalId: 'a', date: '2026-11-05', followers: 900 },
    { rivalId: 'a', date: '2026-11-06', followers: 1000 },
    { rivalId: 'a', date: '2026-11-12', followers: 1080 },
    { rivalId: 'a', date: '2026-11-13', followers: 1100 },
    { rivalId: 'b', date: '2026-11-13', followers: 5 },
  ]
  const a = rivalTrend(log, 'a', now)
  assert.deepEqual([a.followers, a.loggedAt, a.d1, a.d7], [1100, '2026-11-13', 20, 100])
  assert.equal(a.spark.length, 4)
  // 7 天前（11-06）和 8 天前（11-05）都没记时，近 7 天就是空
  assert.equal(rivalTrend(log.filter(row => row.date > '2026-11-06'), 'a', now).d7, null)
  // 前一天没记，不拿更早的数凑
  assert.equal(rivalTrend(log.filter(row => row.date !== '2026-11-12'), 'a', now).d1, null)
  // 最新一条太旧，不算「现在」的涨跌，但数字和日期照实给出
  const stale = rivalTrend(log, 'a', new Date(2026, 10, 20, 12))
  assert.deepEqual([stale.followers, stale.loggedAt, stale.d1, stale.d7], [1100, '2026-11-13', null, null])
  assert.deepEqual(rivalTrend(log, 'none', now), { followers: null, works: null, loggedAt: null, d1: null, d7: null, spark: [] })
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28')
})

test('myFollowers：取自己在这个平台最近一次的记录，示例不算', () => {
  const log = [{ platform: 'B站', date: '2026-11-12', followers: 10 }, { platform: 'B站', date: '2026-11-13', followers: 12 }, { platform: 'B站', date: '2026-11-14', followers: 99, sample: true }]
  assert.deepEqual(myFollowers(log, 'B站'), { followers: 12, date: '2026-11-13' })
  assert.equal(myFollowers(log, '知乎'), null)
})

test('add_rival_works：校验后按账号+标题更新，保留跟进状态，每个账号最多 200 条；删账号时作品一起删', async () => {
  const { MAX_RIVAL_WORKS } = await import('../src/ops.js')
  const state = migrateState({ items: [], metrics: [] })
  assert.deepEqual(state.rivalWorks, [])
  applyOps(state, [{ op: 'add_rival', platform: '小红书', url: 'https://www.xiaohongshu.com/user/profile/1', name: '某博主' }])
  const rivalId = state.rivals[0].id
  const first = applyOps(state, [{ op: 'add_rival_works', rivalId, works: [
    { title: '第一条', date: '2026-11-01', likes: 10, saves: 4, url: 'https://www.xiaohongshu.com/explore/1' },
    { title: '第二条', date: '2026-11-02', likes: 3 },
    { title: '', date: '2026-11-03', likes: 1 },
    { title: '坏日期', date: '2026-02-31', likes: 1 },
    { title: '坏数字', date: '2026-11-03', likes: -1 },
    { title: '坏链接', date: '2026-11-03', likes: 1, url: 'javascript:alert(1)' },
  ] }])
  assert.deepEqual(first.errors, [])
  assert.match(first.receipts[0].text, /新增 2 条，更新 0 条；4 条/)
  assert.deepEqual(state.rivalWorks.map(row => [row.title, row.likes, row.saves, 'comments' in row]), [['第一条', 10, 4, false], ['第二条', 3, undefined, false]])
  const id = state.rivalWorks[0].id
  applyOps(state, [{ op: 'set_rival_work', id, status: 'follow' }])
  assert.ok(applyOps(state, [{ op: 'set_rival_work', id, status: '随便' }]).errors.length)
  // 同名再贴是更新：整条换成这次的数（这次没有收藏就是没有），状态和 id 不变
  applyOps(state, [{ op: 'add_rival_works', rivalId, works: [{ title: '第一条', date: '2026-11-01', likes: 50 }] }])
  assert.equal(state.rivalWorks.length, 2)
  assert.deepEqual([state.rivalWorks[0].id, state.rivalWorks[0].likes, 'saves' in state.rivalWorks[0], state.rivalWorks[0].status], [id, 50, false, 'follow'])
  applyOps(state, [{ op: 'set_rival_work', id, status: null }])
  assert.equal('status' in state.rivalWorks[0], false)
  assert.ok(applyOps(state, [{ op: 'add_rival_works', rivalId, works: [{ title: '没日期', likes: 1 }] }]).errors.length)
  assert.ok(applyOps(state, [{ op: 'add_rival_works', rivalId: 'nope', works: [{ title: 'x', date: '2026-11-01', likes: 1 }] }]).errors.length)

  const many = Array.from({ length: MAX_RIVAL_WORKS + 5 }, (_, i) => ({ title: `批量${i}`, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), likes: i }))
  applyOps(state, [{ op: 'add_rival_works', rivalId, works: many }])
  const mine = state.rivalWorks.filter(row => row.rivalId === rivalId)
  assert.equal(mine.length, MAX_RIVAL_WORKS)
  assert.equal(mine.some(row => row.title === '批量0'), false, '超出时去掉最早的')

  applyOps(state, [{ op: 'delete_rival_work', id: mine[0].id }])
  assert.equal(state.rivalWorks.length, MAX_RIVAL_WORKS - 1)
  applyOps(state, [{ op: 'delete_rival', id: rivalId }])
  assert.deepEqual(state.rivalWorks, [])
})

test('parseWorksTable：复用表头识别，标题和日期必须有，链接列单独认，缺的列不当 0', async () => {
  const { parseWorksTable } = await import('../client/rival-works.js')
  const now = new Date(2026, 10, 13, 12)
  const text = [
    '作品标题\t发布时间\t点赞\t收藏\t评论\t作品链接\t曝光',
    '我的 Agent 日报\t2026-11-10\t1.2万\t3,400\t88\thttps://www.xiaohongshu.com/explore/1\t9万',
    '第二条\t11月9日\t120\t\t\tnot a url\t',
    '\t2026-11-08\t1\t1\t1\t\t',
    '坏数\t2026-11-07\t很多\t1\t1\t\t',
  ].join('\n')
  const result = parseWorksTable(text, now)
  assert.equal(result.problem, null)
  assert.deepEqual(result.columns.map(column => column.field), ['title', 'date', 'likes', 'saves', 'comments', 'url', null])
  assert.deepEqual(result.rows, [
    { line: 2, title: '我的 Agent 日报', date: '2026-11-10', url: 'https://www.xiaohongshu.com/explore/1', likes: 12000, saves: 3400, comments: 88 },
    { line: 3, title: '第二条', date: '2026-11-09', likes: 120 },
  ])
  assert.deepEqual(result.errors.map(error => error.code), ['no-title', 'number'])
  assert.equal(parseWorksTable('日期,点赞\n2026-11-01,1', now).problem, 'no-title')
  assert.equal(parseWorksTable('标题,点赞\n一,1', now).problem, 'no-date')
  assert.equal(parseWorksTable('标题,日期\n一,2026-11-01', now).problem, 'no-metric')
})

test('pickRivals：给了 ids 只读这几个（加完自动读一次），没给就全读', async () => {
  const { pickRivals } = await import('../src/rivals.js')
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(pickRivals(all, ['b']).map(row => row.id), ['b'])
  assert.deepEqual(pickRivals(all, undefined).map(row => row.id), ['a', 'b', 'c'])
  assert.deepEqual(pickRivals(all, ['x', 1, null]), [])
  assert.deepEqual(pickRivals(undefined, ['a']), [])
})
