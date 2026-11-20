// 全站共用的一套计数：同一批内容在各页数出来的数要一样。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPublished, navBadges, pieceCounts, pieceStatus } from '../client/util.js'

const ITEMS = [
  { id: 'a', status: 'idea' },
  { id: 'b', status: 'idea', imported: true, production: { status: 'done' } },
  { id: 'c', status: 'outline' },
  { id: 'd', status: 'draft', production: { status: 'done' } },
  { id: 'e', status: 'ready', drafts: { article: { text: 'x' } } },
  { id: 'f', status: 'published' },
  // 状态还是草稿，但小红书已经发出去了
  { id: 'g', status: 'draft', publish: { 小红书: { state: 'published' }, 公众号: { state: 'drafted' } } },
  // 只推了草稿，不算发布
  { id: 'h', status: 'ready', publish: { 公众号: { state: 'drafted' } } },
  // 停在灵感状态的分支不算一篇；分支往前推了就算
  { id: 'i', status: 'idea', parentId: 'a' },
  { id: 'j', status: 'draft', parentId: 'a' },
]

test('isPublished / pieceStatus：任何一个平台记了已发布就算发布', () => {
  assert.equal(isPublished(ITEMS[5]), true)
  assert.equal(isPublished(ITEMS[6]), true)
  assert.equal(isPublished(ITEMS[7]), false)
  assert.equal(isPublished({}), false)
  assert.equal(pieceStatus(ITEMS[6]), 'published')
  assert.equal(pieceStatus(ITEMS[3]), 'draft')
})

test('pieceCounts：每篇只落一格，四格加起来等于总数；导入的灵感也算灵感', () => {
  const counts = pieceCounts(ITEMS)
  assert.deepEqual(counts, { total: 9, ideas: 2, importedIdeas: 1, drafting: 3, ready: 2, published: 2, finished: 3 })
  assert.equal(counts.ideas + counts.drafting + counts.ready + counts.published, counts.total)
  assert.deepEqual(pieceCounts([]), { total: 0, ideas: 0, importedIdeas: 0, drafting: 0, ready: 0, published: 0, finished: 0 })
  assert.equal(pieceCounts(undefined).total, 0)
})

test('navBadges：灵感角标只数自己记的（灵感墙上那些），和内容页同一套数', () => {
  assert.deepEqual(navBadges(ITEMS), { home: 1, content: 3, publish: 2 })
})

test('isDense：每天都有数才连线；差一个月的两点、只有一天都画成柱子', async () => {
  const { isDense } = await import('../client/util.js')
  assert.equal(isDense(['2026-11-01', '2026-11-02', '2026-11-03']), true)
  assert.equal(isDense(['2026-10-03', '2026-11-03']), false)
  assert.equal(isDense(['2026-11-01', '2026-11-03']), false)
  assert.equal(isDense(['2026-11-01']), false)
  assert.equal(isDense([]), false)
  // 跨月末、跨夏令时也算连着
  assert.equal(isDense(['2026-10-31', '2026-11-01']), true)
})
