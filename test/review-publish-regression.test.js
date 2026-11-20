import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeInsights } from '../src/learn.js'
import { applyOps } from '../src/ops.js'
import { isPublishable, navBadges, publishPhase } from '../client/util.js'

const fixture = () => ({ items: [{ id: 'draft', title: '稿件', status: 'draft' }], accounts: [], skills: [], metrics: [
  { id: 'a', platform: '小红书', title: '平台标题', workId: 'work-a', views: 100, date: '2026-11-01' },
  { id: 'b', platform: '小红书', title: '同名', workId: 'work-b', views: 50, date: '2026-11-02' },
  { id: 'c', platform: '小红书', title: '同名', workId: 'work-c', views: 25, date: '2026-11-03' },
  { id: 'd', platform: '公众号', views: 10, date: '2026-11-03' },
] })

test('导入记录在头句、排行、诊断中一致；同名不同作品不混在一起', () => {
  const data = computeInsights(fixture())
  assert.equal(data.published, 3)
  assert.deepEqual(new Set(data.top.map(p => p.key)), new Set(data.pieces.map(p => p.key)))
  assert.equal(data.pieceViews, 175)
  assert.equal(data.unlinked.count, 1)
  assert.equal(data.pieceViews + data.unlinked.views, data.views)
})

test('作品可手动关联、改关联、解除关联，数值和导入身份保留', () => {
  const state = fixture()
  const before = computeInsights(state)
  assert.deepEqual(applyOps(state, [{ op: 'link_metrics', ids: ['a'], itemId: 'draft' }]).errors, [])
  const after = computeInsights(state)
  assert.equal(after.top[0].id, 'draft')
  assert.equal(after.top[0].title, '稿件')
  assert.equal(after.pieces[0].key !== undefined, true)
  assert.equal(after.pieceViews, before.pieceViews)
  assert.equal(state.metrics[0].workId, 'work-a')
  assert.deepEqual(applyOps(state, [{ op: 'link_metrics', ids: ['a'], itemId: null }]).errors, [])
  assert.equal(computeInsights(state).top[0].title, '平台标题')
})

test('关联失败不能只改一半，不能关联不存在的稿件', () => {
  const state = fixture()
  const before = structuredClone(state)
  assert.equal(applyOps(state, [{ op: 'link_metrics', ids: ['a', 'missing'], itemId: 'draft' }]).errors.length, 1)
  assert.deepEqual(state, before)
  assert.equal(applyOps(state, [{ op: 'link_metrics', ids: ['a'], itemId: 'missing' }]).errors.length, 1)
  assert.deepEqual(state, before)
})

test('发布导航角标等于默认待发布筛选；样例、未成稿、已发、已推草稿不混入', () => {
  const done = { status: 'done' }
  const items = [
    { id: 'todo', status: 'draft', production: done },
    { id: 'sample', sample: true, production: done },
    { id: 'unfinished', status: 'ready' },
    { id: 'drafted', production: done, publish: { 公众号: { state: 'drafted' } } },
    { id: 'published', status: 'published', production: done },
    { id: 'multi', production: done, publish: { 小红书: { state: 'published' }, 公众号: { state: 'copied' } } },
  ]
  const pieces = items.filter(isPublishable)
  assert.equal(navBadges(items).publish, 1)
  assert.equal(navBadges(items).publish, pieces.filter(i => publishPhase(i) === 'todo').length)
  assert.deepEqual(pieces.map(i => publishPhase(i)), ['todo', 'doing', 'done', 'done'])
  assert.equal(publishPhase(items[5], '公众号'), 'doing')
  assert.equal(publishPhase(items[5], '小红书'), 'done')
})
