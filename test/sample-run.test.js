// 发布后 72 小时内的加密采样：哪些作品该采、读到的数怎么记成采样点、不采没有列表页的平台、不编数据。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BACKSTAGE } from '../src/backstage.js'
import { applyOps } from '../src/ops.js'
import { SAMPLEABLE, runSample, sampleOps, samplingPlan } from '../src/sample-run.js'
import { Store } from '../src/store.js'

const at = iso => new Date(iso).toISOString()
const NOW = new Date('2026-11-13T12:00:00Z')
const published = at('2026-11-13T02:00:00Z')

function stateWith(rows) {
  return { items: [], metrics: rows, metricSamples: [], accounts: [], followerLog: [] }
}

test('samplingPlan：只采发布 72 小时内、离上次采样满 6 小时的作品；没有列表页的平台不采', () => {
  assert.deepEqual(SAMPLEABLE.sort(), ['B站', '公众号', '小红书', '抖音'].sort())
  assert.equal(SAMPLEABLE.includes('视频号'), false)
  const state = stateWith([
    { id: 'a', platform: '小红书', workId: 'n1', title: '刚发的', date: published, views: 10 },
    { id: 'b', platform: '抖音', workId: 'd1', title: '太久了', date: at('2026-11-01T00:00:00Z'), views: 10 },
    { id: 'c', platform: '视频号', workId: 'v1', title: '没列表页', date: published, views: 10 },
  ])
  const plan = samplingPlan({ state, now: NOW })
  assert.deepEqual(plan.works.map(work => [work.platform, work.workId]), [['小红书', 'n1']])
  assert.deepEqual(plan.platforms, ['小红书'])
  // 5 小时前采过：还不到
  const sampled = { ...state, metricSamples: [{ id: 's1', platform: '小红书', workId: 'n1', date: published, ts: at('2026-11-13T07:00:00Z'), views: 20 }] }
  assert.deepEqual(samplingPlan({ state: sampled, now: NOW }).works, [])
  // 6 小时前采过：可以再采
  const again = { ...state, metricSamples: [{ id: 's1', platform: '小红书', workId: 'n1', date: published, ts: at('2026-11-13T06:00:00Z'), views: 20 }] }
  assert.deepEqual(samplingPlan({ state: again, now: NOW }).works.map(work => work.workId), ['n1'])
  // 刚刚打开过后台（10 分钟内）：这次先不开
  assert.deepEqual(samplingPlan({ state, now: NOW, lastAt: { 小红书: at('2026-11-13T11:55:00Z') }, minGapMs: 10 * 60_000 }).works, [])
  // 10 分钟以前：可以开
  assert.deepEqual(samplingPlan({ state, now: NOW, lastAt: { 小红书: at('2026-11-13T11:40:00Z') }, minGapMs: 10 * 60_000 }).works.map(work => work.workId), ['n1'])
  // 上次读要重新登录：6 小时内不再试
  assert.deepEqual(samplingPlan({ state, now: NOW, hold: { 小红书: at('2026-11-13T08:00:00Z') } }).works, [])
  assert.deepEqual(samplingPlan({ state, now: NOW, hold: { 小红书: at('2026-11-13T05:00:00Z') } }).works.map(work => work.workId), ['n1'])
})

test('sampleOps：只给要采的那条记采样点，带 ts、作品 ID 和那一刻的累计数；页面上的别的作品不记', () => {
  const works = [{ platform: '小红书', workId: 'n1', itemId: null, title: '刚发的', date: published }]
  const rows = [{
    platform: '小红书',
    posts: [
      { title: '刚发的', workId: 'n1', at: published, views: 120, likes: 8, saves: 3, comments: 1, shares: 2 },
      { title: '别的作品', workId: 'n2', at: published, views: 999, likes: 99 },
    ],
  }]
  const ops = sampleOps(rows, works, at('2026-11-13T12:00:00Z'))
  assert.equal(ops.length, 1)
  assert.deepEqual(ops[0], { op: 'add_metric', platform: '小红书', ts: at('2026-11-13T12:00:00Z'), date: published, workId: 'n1', title: '刚发的', views: 120, likes: 8, saves: 3, comments: 1, shares: 2 })
  // 页面上没给 ID、标题对上时也认：用作品记录里的 ID
  const noId = sampleOps([{ platform: '小红书', posts: [{ title: '刚发的', views: 50 }] }], works, at('2026-11-13T12:00:00Z'))
  assert.deepEqual([noId[0].workId, noId[0].views], ['n1', 50])
  // 一个数都没有的作品不记
  assert.deepEqual(sampleOps([{ platform: '小红书', posts: [{ title: '刚发的', workId: 'n1' }] }], works, at('2026-11-13T12:00:00Z')), [])
})

test('runSample：读到的数写进采样序列，日表不动；读过的平台记下时间，下次 10 分钟内不再开', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md-sample-'))
  try {
    const store = new Store(dir, { samples: false })
    await store.mutate('', (draft) => {
      applyOps(draft, [{ op: 'add_metric', replace: true, platform: '小红书', workId: 'n1', title: '刚发的', date: published, views: 100 }])
      return draft
    })
    const works = [{ platform: '小红书', workId: 'n1', itemId: null, title: '刚发的', date: published }]
    const browser = {
      // 小红书列表页的数没有文字标注，按列顺序：观看、评论、点赞、收藏、分享
      readPage: async (url) => (url === BACKSTAGE.小红书.home ? { url, text: '粉丝 21844', links: [] } : { url, text: '刚发的\n120\n0\n8\n3\n2', links: [{ href: 'https://www.xiaohongshu.com/explore/65f0c1a2000000000b00a1b2', text: '刚发的' }] }),
    }
    let opens = 0
    const backstage = {
      open: async () => { opens += 1; return browser },
      callText: async () => ({ text: JSON.stringify({ items: [{ title: '刚发的', views: '120', comments: '0', likes: '8', saves: '3', shares: '2' }] }) }),
      wait: async () => {},
    }
    const clock = () => NOW
    const first = await runSample(store, { works, platforms: ['小红书'], backstage, now: clock })
    assert.deepEqual(first, { applied: 1 })
    const { state } = { state: await store.read() }
    assert.equal(state.metrics.length, 1, '日表还是那一条')
    assert.equal(state.metricSamples.length, 1)
    const sample = state.metricSamples[0]
    assert.deepEqual([sample.platform, sample.workId, sample.views, sample.likes, sample.saves, sample.ts, sample.date], ['小红书', '65f0c1a2000000000b00a1b2', 120, 8, 3, at('2026-11-13T12:00:00Z'), published])
    assert.equal(state.autoRead.backstageAt.小红书, at('2026-11-13T12:00:00Z'))
    // 同一个小时里再采一次：更新那一条，不新增（每次读取仍会打开后台，限量由调用方按 10 分钟判断）
    const second = await runSample(store, { works, platforms: ['小红书'], backstage, now: () => new Date('2026-11-13T12:30:00Z') })
    assert.equal(second.applied, 1)
    assert.equal((await store.read()).metricSamples.length, 1)
    assert.equal(opens, 2)
    // 读不到（浏览器打不开）：不抛错，原因带回来，采样序列不变
    const broken = await runSample(store, { works, platforms: ['小红书'], backstage: { open: async () => { throw new Error('连不上专用浏览器') }, callText: async () => ({ text: '{}' }) }, now: () => new Date('2026-11-13T13:00:00Z') })
    assert.deepEqual(broken, { applied: 0, error: '连不上专用浏览器' })
    assert.equal((await store.read()).metricSamples.length, 1)
    // 要重新登录的平台：记下来，6 小时内不再试
    const expired = {
      readPage: async (url) => ({ url: 'https://creator.xiaohongshu.com/login', text: null }),
    }
    const relogin = await runSample(store, { works, platforms: ['小红书'], backstage: { open: async () => expired, callText: async () => ({ text: '{}' }), wait: async () => {} }, now: () => new Date('2026-11-13T14:00:00Z') })
    assert.equal(relogin.applied, 0)
    const saved = await store.read()
    assert.equal(saved.autoRead.sampleHold.小红书, at('2026-11-13T14:00:00Z'))
    assert.deepEqual(samplingPlan({ state: saved, now: new Date('2026-11-13T15:00:00Z'), lastAt: saved.autoRead.backstageAt, hold: saved.autoRead.sampleHold }).works, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
