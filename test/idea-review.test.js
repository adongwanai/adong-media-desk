import assert from 'node:assert/strict'
import { test } from 'node:test'
import { idleDays, lastTouched, pickReview, reviewable } from '../client/idea-review.js'
import { applyOps } from '../src/ops.js'

const NOW = new Date(2026, 10, 13, 9, 0, 0)
const daysAgo = n => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const idea = (id, age, extra = {}) => ({ id, title: id, status: 'idea', createdAt: daysAgo(age), ...extra })

test('能回顾的：自己记的灵感、7 天以上没动、没设先不提醒', () => {
  assert.equal(reviewable(idea('a', 8), NOW.getTime()), true)
  assert.equal(reviewable(idea('a', 6), NOW.getTime()), false)
  assert.equal(reviewable(idea('a', 30, { imported: true }), NOW.getTime()), false)
  assert.equal(reviewable(idea('a', 30, { sample: true }), NOW.getTime()), false)
  assert.equal(reviewable(idea('a', 30, { parentId: 'p' }), NOW.getTime()), false)
  assert.equal(reviewable(idea('a', 30, { status: 'draft' }), NOW.getTime()), false)
  assert.equal(reviewable(idea('a', 30, { reviewSnoozedUntil: daysAgo(-5) }), NOW.getTime()), false)
  assert.equal(reviewable(idea('a', 30, { reviewSnoozedUntil: daysAgo(1) }), NOW.getTime()), true)
  // 写过草稿就算动过
  assert.equal(reviewable(idea('a', 30, { drafts: { article: { at: daysAgo(2) } } }), NOW.getTime()), false)
  assert.equal(lastTouched(idea('a', 30, { drafts: { article: { at: daysAgo(9) } } })), Date.parse(daysAgo(9)))
})

test('不到 3 条不显示', () => {
  assert.deepEqual(pickReview([idea('a', 10), idea('b', 20), idea('c', 3)], NOW), [])
})

test('挑 3 条：同一天怎么调都一样，最久没动的排前面；只从最久没动的 9 条里轮换', () => {
  const items = Array.from({ length: 20 }, (_, i) => idea(`it_${i}`, 8 + i))
  const first = pickReview(items, NOW).map(row => row.id)
  assert.equal(first.length, 3)
  assert.deepEqual(pickReview([...items].reverse(), new Date(2026, 10, 13, 23, 30)).map(row => row.id), first)
  const ages = first.map(id => Number(id.slice(3)))
  assert.deepEqual(ages, [...ages].sort((a, b) => b - a))
  // 最久没动的 9 条是 it_11 … it_19
  assert.ok(ages.every(n => n >= 11))
  // 换几天总会换出不一样的一批
  const later = new Set([1, 2, 3, 4, 5].map(d => pickReview(items, new Date(NOW.getTime() + d * 86_400_000)).map(row => row.id).join()))
  assert.ok(later.size > 1)
  assert.equal(idleDays(items[0], NOW), 8)
})

test('snooze_idea：记下不再提醒到哪天；天数要是 1 到 3650 的整数', () => {
  const state = { items: [idea('a', 30)], metrics: [] }
  const { receipts, errors } = applyOps(state, [{ op: 'snooze_idea', id: 'a', days: 3650 }, { op: 'snooze_idea', id: 'a', days: 0 }, { op: 'snooze_idea', id: 'a', days: 1.5 }, { op: 'snooze_idea', id: 'nope', days: 3 }])
  assert.equal(receipts.length, 1)
  assert.equal(errors.length, 3)
  const until = Date.parse(state.items[0].reviewSnoozedUntil)
  assert.ok(until - Date.now() > 3649 * 86_400_000)
  assert.equal(reviewable(state.items[0]), false)
})
