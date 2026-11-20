// 复盘头句：「N 条内容带来了 X」里的 N 就是下面列出来的条数，X 只加这几条；阅读还是播放按平台说。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeInsights, viewWord } from '../src/learn.js'

const state = (metrics, items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C', status: 'published' }]) => ({ items, metrics, accounts: [], skills: [] })

test('头句的条数等于列出来的条数，播放只加这几条；没对上内容的记录另算', () => {
  const data = computeInsights(state([
    { id: 'm1', itemId: 'a', platform: '公众号', date: '2026-11-01T04:00:00Z', views: 100, likes: 2 },
    { id: 'm2', itemId: 'b', platform: '公众号', date: '2026-11-02T04:00:00Z', views: 50 },
    { id: 'm3', itemId: null, platform: '公众号', date: '2026-11-03T04:00:00Z', views: 900 },
    // 内容已经删了的记录也算没对上
    { id: 'm4', itemId: 'gone', platform: '公众号', date: '2026-11-03T04:00:00Z', views: 7 },
  ]))
  assert.equal(data.published, data.top.length)
  assert.equal(data.published, 2)
  assert.equal(data.pieceViews, 150)
  assert.deepEqual(data.unlinked, { count: 2, views: 907, engaged: null })
  assert.equal(data.views, 1057)
  assert.equal(data.viewWord, '阅读')
})

test('一条都没对上内容时不拿「已发布」的条数顶替', () => {
  const data = computeInsights(state([{ id: 'm', itemId: null, platform: '抖音', date: '2026-11-01T04:00:00Z', views: 10 }]))
  assert.equal(data.published, 0)
  assert.equal(data.unlinked.count, 1)
  assert.equal(data.viewWord, '播放')
})

test('viewWord：图文平台叫阅读，视频平台叫播放，混着叫阅读/播放', () => {
  assert.equal(viewWord(['公众号', '知乎', '头条']), '阅读')
  assert.equal(viewWord(['抖音', 'B站', '视频号']), '播放')
  assert.equal(viewWord(['公众号', '抖音']), '阅读/播放')
  assert.equal(viewWord(['小红书']), '阅读/播放')
  assert.equal(viewWord([]), '阅读/播放')
})
