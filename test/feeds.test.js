import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readAccounts } from '../src/collect.js'
import { fetchFeeds, parseFeed } from '../src/feeds.js'
import { applyOps } from '../src/ops.js'
import { Store } from '../src/store.js'

const RSS = `<?xml version="1.0"?><rss><channel><title>示例博客</title><link>https://blog.example.com/</link>
<item><title><![CDATA[第一篇 & 开始]]></title><link>https://blog.example.com/a</link><pubDate>Wed, 11 Nov 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;正文 &amp;amp; 摘要&lt;/p&gt;</description></item>
<item><title>没有链接</title></item>
<item><title>坏链接</title><link>javascript:alert(1)</link></item>
</channel></rss>`
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 源</title>
<entry><title>相对链接</title><link rel="self" href="/self"/><link rel="alternate" href="/posts/1"/><updated>2026-11-12T01:00:00Z</updated><summary>摘要</summary></entry></feed>`

const reply = (body, type = 'application/rss+xml') => new Response(body, { status: 200, headers: { 'content-type': type } })

test('parseFeed：RSS 和 Atom 都能读，去掉 CDATA 和标签，丢掉没有链接或链接不安全的条目', () => {
  const rss = parseFeed(RSS, 'https://blog.example.com/feed')
  assert.equal(rss.title, '示例博客')
  assert.deepEqual(rss.entries, [{ title: '第一篇 & 开始', url: 'https://blog.example.com/a', date: '2026-11-11T08:00:00.000Z', summary: '正文 & 摘要' }])
  const atom = parseFeed(ATOM, 'https://atom.example.com/feed.xml')
  assert.equal(atom.entries[0].url, 'https://atom.example.com/posts/1')
  assert.equal(atom.entries[0].date, '2026-11-12T01:00:00.000Z')
  assert.deepEqual(parseFeed('<html>不是订阅源</html>').entries, [])
})

test('fetchFeeds：按时间倒序合并，单个源失败只记原因，不影响其余', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('1.1.1.1')) return reply(RSS)
    if (String(url).includes('8.8.8.8')) return reply(ATOM, 'application/atom+xml')
    return reply('<html></html>', 'text/html')
  }
  const result = await fetchFeeds([{ id: 'a', url: 'https://1.1.1.1/feed' }, { id: 'b', url: 'https://8.8.8.8/feed', title: '我起的名字' }, { id: 'c', url: 'https://9.9.9.9/x' }, { id: 'd', url: 'http://127.0.0.1/feed' }], fetchImpl)
  assert.deepEqual(result.entries.map(row => [row.title, row.source]), [['相对链接', '我起的名字'], ['第一篇 & 开始', '示例博客']])
  assert.deepEqual(result.errors.map(row => row.url).sort(), ['http://127.0.0.1/feed', 'https://9.9.9.9/x'])
})

test('add_feed / delete_feed：只收 http(s)，不重复', () => {
  const state = { feeds: [] }
  const { errors } = applyOps(state, [{ op: 'add_feed', url: 'https://a.example.com/rss' }, { op: 'add_feed', url: 'https://a.example.com/rss' }, { op: 'add_feed', url: 'file:///etc/passwd' }])
  assert.equal(errors.length, 2)
  assert.equal(state.feeds.length, 1)
  applyOps(state, [{ op: 'delete_feed', id: state.feeds[0].id }])
  assert.equal(state.feeds.length, 0)
})

test('readAccounts：B 站走公开接口；读不到的平台不发请求、不从页面文字里猜，明确说原因', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('api.bilibili.com')) return new Response(JSON.stringify({ code: 0, data: { follower: 15972, like_num: 300, archive_count: 12 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return reply('<html><head><title>x</title></head><body>关注 12 粉丝 3456</body></html>', 'text/html')
  }
  const results = await readAccounts([
    { platform: 'B站', url: 'https://space.bilibili.com/123' },
    { platform: '抖音', url: 'https://1.1.1.1/u' },
    { platform: 'X', url: null },
    { platform: '知乎', url: 'https://1.1.1.1/u', sample: true },
  ], fetchImpl)
  assert.deepEqual(results.map(row => [row.platform, row.followers]), [['B站', 15972], ['抖音', null]])
  assert.deepEqual(results[0].stats, { likes: 300, works: 12 })
  assert.match(results[1].error, /人机校验/)
  assert.deepEqual(calls, ['https://api.bilibili.com/x/web-interface/card?mid=123'])
  const [bad] = await readAccounts([{ platform: 'B站', url: 'https://www.bilibili.com/' }], fetchImpl)
  assert.match(bad.error, /space\.bilibili\.com/)
})

test('Store 关掉示例后，第一次打开没有任何示例内容', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md-real-'))
  try {
    const state = await new Store(dir, { samples: false }).read()
    assert.equal(state.items.length, 0)
    assert.equal(state.metrics.length, 0)
    assert.equal(state.followerLog.length, 0)
    assert.equal(state.accounts.length, 0)
    assert.ok(state.styles.length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
