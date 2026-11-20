// 单条作品的时间序列：采样点的容量、6 小时一次的判断、按作品取某一刻的数（有采样用采样，没有用日表）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_SAMPLES, MAX_SAMPLES_PER_WORK, metricAt, pushSample, sampleDue, workKeyOf, youngWorks, lastSampleAt } from '../src/metric-samples.js'

const HOUR = 3600_000
const at = iso => new Date(iso).toISOString()
const point = (ts, views, extra = {}) => ({ id: `s_${ts}_${views}`, platform: '小红书', workId: 'n1', title: '一条', date: '2026-11-10T00:00:00.000Z', ts, views, ...extra })

test('workKeyOf：作品 ID 优先，其次挂的内容，再其次标题+平台', () => {
  assert.equal(workKeyOf({ platform: '小红书', workId: 'n1', itemId: 'i1', title: 't' }), 'w:小红书|n1')
  assert.equal(workKeyOf({ platform: '小红书', itemId: 'i1', title: 't' }), 'i:小红书|i1')
  assert.equal(workKeyOf({ platform: '小红书', title: 't' }), 't:小红书|t')
  assert.equal(workKeyOf({ platform: '小红书' }), null)
  assert.equal(workKeyOf(null), null)
})

test('sampleDue：发布后 72 小时内每 6 小时一次；之后不再加密采样；看不懂时间、还没发布、时钟偏了都不采', () => {
  const publishedAt = at('2026-11-10T00:00:00Z')
  // 刚发布：立刻采一次
  assert.deepEqual(sampleDue({ now: new Date('2026-11-10T00:05:00Z'), publishedAt }), { due: true, intervalMs: 6 * HOUR })
  // 5 小时后：还不到
  assert.deepEqual(sampleDue({ now: new Date('2026-11-10T05:00:00Z'), lastSampleAt: at('2026-11-10T00:05:00Z'), publishedAt }), { due: false, intervalMs: 6 * HOUR })
  // 正好 6 小时：该采
  assert.equal(sampleDue({ now: new Date('2026-11-10T06:05:00Z'), lastSampleAt: at('2026-11-10T00:05:00Z'), publishedAt }).due, true)
  // 70 小时：还在窗口里
  assert.equal(sampleDue({ now: new Date('2026-11-13T00:00:00Z'), lastSampleAt: at('2026-11-12T12:00:00Z'), publishedAt }).due, true)
  // 73 小时：出了窗口，回到每天两轮的常规读取
  assert.deepEqual(sampleDue({ now: new Date('2026-11-13T01:00:00Z'), lastSampleAt: at('2026-11-12T12:00:00Z'), publishedAt }), { due: false, intervalMs: null })
  // 发布时间还没到（时钟偏了）、看不懂：不采
  assert.equal(sampleDue({ now: new Date('2026-11-09T00:00:00Z'), publishedAt }).due, false)
  assert.equal(sampleDue({ now: new Date('2026-11-10T06:00:00Z'), publishedAt: '前天' }).due, false)
  assert.equal(sampleDue({ now: new Date('2026-11-10T06:00:00Z') }).due, false)
  // 上次采样时间看不懂：当作没采过
  assert.equal(sampleDue({ now: new Date('2026-11-10T06:00:00Z'), lastSampleAt: '刚', publishedAt }).due, true)
})

test('pushSample：同一作品同一小时里重复采是更新，不同小时各存一条', () => {
  let list = []
  list = pushSample(list, point('2026-11-10T00:05:00.000Z', 100))
  list = pushSample(list, point('2026-11-10T06:10:00.000Z', 160))
  assert.deepEqual(list.map(row => row.views), [100, 160])
  // 同一个小时里再采一次：换成新的数，不新增
  list = pushSample(list, point('2026-11-10T06:50:00.000Z', 175))
  assert.deepEqual(list.map(row => [row.ts, row.views]), [['2026-11-10T00:05:00.000Z', 100], ['2026-11-10T06:50:00.000Z', 175]])
  // 认不出是哪条作品、没有 ts 的都不收
  assert.equal(pushSample(list, { platform: '小红书', ts: '2026-11-10T12:00:00.000Z', views: 1 }).length, 2)
  assert.equal(pushSample(list, { platform: '小红书', workId: 'n1', views: 1 }).length, 2)
})

test('pushSample：每条作品最多 60 个点，超了丢最旧的；全部最多 5000 个点，按时间淘汰', () => {
  let list = []
  for (let i = 0; i < 65; i += 1) list = pushSample(list, point(at(new Date(Date.UTC(2026, 10, 1, i, 0, 0))), i))
  assert.equal(list.length, MAX_SAMPLES_PER_WORK)
  assert.deepEqual([list[0].views, list.at(-1).views], [5, 64])
  // 两个作品各自限量
  let two = []
  for (let i = 0; i < 40; i += 1) {
    const ts = at(new Date(Date.UTC(2026, 10, 2, i, 0, 0)))
    two = pushSample(two, point(ts, i, { workId: 'a' }))
    two = pushSample(two, point(ts, i, { workId: 'b' }))
  }
  assert.equal(two.filter(row => row.workId === 'a').length, 40)
  // 总量：把上限调小来试（真的上限是 5000 条）；每条作品 1 个点时，只留最近的
  let many = []
  for (let i = 0; i < 700; i += 1) many = pushSample(many, { platform: 'X', workId: `w${i}`, ts: at(new Date(Date.UTC(2026, 0, 1, i, 0, 0))), views: i }, { total: 500 })
  assert.equal(many.length, 500)
  assert.deepEqual([many.at(-1).views, many.at(-1).workId], [699, 'w699'])
  assert.equal(many[0].ts < many.at(-1).ts, true)
  assert.ok(MAX_SAMPLES >= 5000 && MAX_SAMPLES_PER_WORK === 60, '真的上限：每条作品 60 个点、全部 5000 个点')
})

test('metricAt：有采样用不晚于目标时刻的最后一条；没有采样用日表；两样都有时用更新的那个', () => {
  const metrics = [
    { id: 'd1', platform: '小红书', workId: 'n1', date: at('2026-11-10T00:00:00Z'), views: 900 },
    { id: 'd2', platform: '小红书', workId: 'n1', date: at('2026-11-11T00:00:00Z'), views: 1200 },
    point('2026-11-11T06:00:00.000Z', 1300),
    point('2026-11-12T06:00:00.000Z', 1500),
  ]
  const row = (target) => metricAt(metrics, { workId: 'n1', platform: '小红书', at: target })
  // 发布当天早上：只有日表里 10 号那条
  assert.deepEqual([row('2026-11-10T08:00:00Z').views, row('2026-11-10T08:00:00Z').source], [900, 'daily'])
  // 11 号中午：采样（11 号 06:00 的 1300）比日表（11 号那条）新，用采样
  assert.deepEqual([row('2026-11-11T12:00:00Z').views, row('2026-11-11T12:00:00Z').source], [1300, 'sample'])
  // 12 号晚上：最后一条采样
  assert.deepEqual([row('2026-11-12T23:00:00Z').views, row('2026-11-12T23:00:00Z').source], [1500, 'sample'])
  // 11 号上午 10 点：11 号的日表已经记了，用日表
  assert.deepEqual([row('2026-11-11T02:00:00Z').views, row('2026-11-11T02:00:00Z').source], [1200, 'daily'])
  // 同一天的日表按天算：11 号凌晨也认 11 号那条日表
  assert.deepEqual([row('2026-11-10T20:00:00Z').views, row('2026-11-10T20:00:00Z').source], [1200, 'daily'])
  // 10 号之前：还没发，没有数
  assert.equal(row('2026-11-09T00:00:00Z'), null)
  // 不给 at：到现在为止的最后一条
  assert.equal(metricAt(metrics, { workId: 'n1', platform: '小红书' }).views, 1500)
  // 平台对不上：不算同一条
  assert.equal(metricAt(metrics, { workId: 'n1', platform: '抖音' }), null)
  // 按挂的内容、按标题也能取
  assert.equal(metricAt([{ platform: '小红书', itemId: 'i1', title: 't', ts: at('2026-11-10T00:05:00Z'), views: 70 }], { itemId: 'i1', platform: '小红书' }).views, 70)
  assert.equal(metricAt([{ platform: '小红书', title: 't', ts: at('2026-11-10T00:05:00Z'), views: 70 }], { title: 't', platform: '小红书' }).views, 70)
  // 给了作品 ID，旧数据只有标题：按标题退回去找
  assert.equal(metricAt([{ platform: '小红书', title: 't', date: at('2026-11-10T00:00:00Z'), views: 70 }], { workId: 'n1', title: 't', platform: '小红书' }).views, 70)
  assert.equal(metricAt([], { workId: 'n1' }), null)
  assert.equal(metricAt(metrics, { workId: 'n1', at: '看不懂' }), null)
})

test('youngWorks：发布 72 小时内的作品，编号或标题对上就合成一条，后来的 ID 补上', () => {
  const now = new Date('2026-11-13T00:00:00Z')
  const state = {
    metrics: [
      { id: 'a', platform: '小红书', title: '旧标题', date: at('2026-11-12T00:00:00Z'), views: 1 },
      { id: 'b', platform: '小红书', title: '旧标题', workId: 'n1', date: at('2026-11-12T00:00:00Z'), ts: at('2026-11-12T06:00:00Z'), views: 2 },
      { id: 'c', platform: '抖音', title: '太久了', date: at('2026-11-08T00:00:00Z'), views: 3 },
      { id: 'd', platform: '公众号', title: '老的', date: at('2026-11-11T00:00:00Z'), views: 4 },
    ],
    metricSamples: [],
  }
  const works = youngWorks(state, now)
  assert.deepEqual(works.map(work => [work.platform, work.workId, work.title]), [['小红书', 'n1', '旧标题'], ['公众号', null, '老的']])
})

test('lastSampleAt：取最近的采样时间，没有采样就是日表那次读取的时间', () => {
  const work = { platform: '小红书', workId: 'n1' }
  assert.equal(lastSampleAt({ metricSamples: [], metrics: [] }, work), null)
  assert.equal(lastSampleAt({ metrics: [{ platform: '小红书', workId: 'n1', date: at('2026-11-10T00:00:00Z'), fetchedAt: at('2026-11-10T06:00:00Z') }] }, work), at('2026-11-10T06:00:00Z'))
  assert.equal(lastSampleAt({ metricSamples: [point('2026-11-10T12:00:00.000Z', 1)], metrics: [] }, work), at('2026-11-10T12:00:00.000Z'))
})
