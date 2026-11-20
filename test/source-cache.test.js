import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceCache } from '../src/source-cache.js'

test('信息源按天缓存、去重并发，新增来源只拉新增，重启仍可用', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-cache-'))
  let calls = 0, time = Date.parse('2026-11-18T01:00:00Z')
  const feeds = async rows => { calls++; return { entries: rows.map(row => ({ url: row.url + '/1', title: '旧条目' })), errors: [], fetchedAt: new Date(time).toISOString() } }
  const cache = new SourceCache(root, { feeds, now: () => time })
  const a = { id: 'a', url: 'https://a.test/feed' }, b = { id: 'b', url: 'https://b.test/feed' }
  try {
    await Promise.all([cache.readFeeds([a]), cache.readFeeds([a])])
    assert.equal(calls, 1)
    await cache.readFeeds([a, b]); assert.equal(calls, 2)
    const next = new SourceCache(root, { feeds, now: () => time })
    assert.equal((await next.readFeeds([a])).entries.length, 1)
    assert.equal(calls, 2)
    time += 86_400_000
    const stale = await next.readFeeds([a], { cachedOnly: true })
    assert.equal(stale.entries.length, 1)
    await Promise.all([...next.pending.values()]); assert.equal(calls, 3)
    await next.readFeeds([a], { force: true }); assert.equal(calls, 4)
  } finally { await cache.writes; await rm(root, { recursive: true, force: true }) }
})

test('当天刷新无新增不重复，失败保留旧数据和真实旧读取时间', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-cache-'))
  const cache = new SourceCache(root)
  try {
    await cache.get('x', async () => ({ entries: [{ url: 'https://x/1' }], fetchedAt: '2026-11-17' }))
    const merged = await cache.get('x', async () => ({ entries: [{ url: 'https://x/1', title: '修订后的标题' }, { url: 'https://x/2' }], fetchedAt: '2026-11-18' }), { force: true })
    assert.equal(merged.entries.length, 2)
    assert.equal(merged.entries[0].title, '修订后的标题')
    const failed = await cache.get('x', async () => ({ entries: [], error: 'network', fetchedAt: '2026-11-19' }), { force: true })
    assert.equal(failed.entries.length, 2)
    assert.equal(failed.fetchedAt, '2026-11-18')
  } finally { await cache.writes; await rm(root, { recursive: true, force: true }) }
})

test('热榜刷新替换过时排名，失败保留上次成功快照', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-cache-'))
  let revision = 0
  const cache = new SourceCache(root, { hot: async ids => ({ sources: ids.map(id => revision === 2 ? { id, error: 'offline' } : { id, name: '微博', entries: [{ url: `https://hot/${revision}`, rank: 1 }], fetchedAt: String(revision) }) }) })
  try {
    await cache.readHot(['weibo'])
    revision = 1
    const fresh = await cache.readHot(['weibo'], { force: true })
    assert.deepEqual(fresh.sources[0].entries.map(row => row.url), ['https://hot/1'])
    revision = 2
    const failed = await cache.readHot(['weibo'], { force: true })
    assert.equal(failed.sources[0].entries[0].url, 'https://hot/1')
    assert.equal(failed.sources[0].fetchedAt, '1')
  } finally { await cache.writes; await rm(root, { recursive: true, force: true }) }
})
