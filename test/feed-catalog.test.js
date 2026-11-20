// 一键源包和内置信息源：目录本身的约束，以及读取器的解析。样本是 2026-11-13 从这台电脑真实请求到的响应（删减后）；网络一律走注入的 fetchImpl。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chinaDay, fetchBuiltin, parseAinav, parseBuildersPodcasts, parseBuildersX } from '../src/builtin.js'
import { BUILTIN_GROUP_IDS, BUILTIN_GROUPS, FEED_CATALOG, FEED_CATALOG_VERIFIED, FEED_GROUPS, GITHUB_RELEASES_PATTERN } from '../src/feed-catalog.js'
import { applyOps, MAX_FEEDS } from '../src/ops.js'

// https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json 里的一位
const FEED_X = { generatedAt: '2026-11-12T06:28:54.625Z', lookbackHours: 24, x: [{ name: 'Josh Woodward', handle: 'joshwoodward', bio: 'VP, @Google @GoogleLabs @GeminiApp @GoogleAIStudio', tweets: [{ id: '2120622974277734716', text: 'We love this and build with it regularly ♥️\n\nIt makes our apps faster and smarter https://t.co/79qcg9KloV', createdAt: '2026-11-11T21:01:30.000Z', url: 'https://x.com/joshwoodward/status/2120622974277734716', likes: 240, retweets: 2, replies: 16 }, { id: 'bad', text: '没有链接的不要', url: 'javascript:alert(1)' }] }], stats: { xBuilders: 16, totalTweets: 32 } }
// feed-podcasts.json
const FEED_PODCASTS = { generatedAt: '2026-11-12T06:28:59.593Z', podcasts: [{ source: 'podcast', name: 'AI & I by Every', title: 'A New Vision for Human Work After Automation', url: 'https://www.youtube.com/playlist?list=PLuMcoKK9mKgHtW_o9h5sGO2vXrffKHwJL', publishedAt: '2026-11-11T15:30:00.000Z', transcript: "Hey, welcome back to the Every Podcast, where we talk about the future of work.\n\nI'm Natalia Quintero" }] }
// https://www.ainav.cn/news/json/liangziwei_2026-11-13.json
const AINAV = { channel: { title: '量子位', link: '', description: '追踪人工智能新趋势，报道科技行业新突破' }, items: [{ title: '多模态“源神”！MiniMax开源SOTA生图模型，原生4K，一张两毛', link: 'https://www.qbitai.com/2026/11/509440.html', pubDate: 'Thu, 12 Nov 2026 19:36:20 +0800' }, { title: '从通用大模型到学习过程智能，AI如何真正进入课堂？', link: 'https://www.qbitai.com/2026/11/509404.html', pubDate: 'Thu, 12 Nov 2026 18:45:33 +0800' }] }

test('一键源包：地址都是 https、不重复，分组都在 FEED_GROUPS 里，能直接用 add_feed 加进去', () => {
  assert.match(FEED_CATALOG_VERIFIED, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(FEED_CATALOG.length > 0 && FEED_CATALOG.length <= MAX_FEEDS)
  assert.equal(new Set(FEED_CATALOG.map(row => row.url)).size, FEED_CATALOG.length)
  for (const row of FEED_CATALOG) {
    assert.equal(new URL(row.url).protocol, 'https:', row.url)
    assert.ok(FEED_GROUPS.includes(row.group), row.group)
    assert.ok(row.title && row.title.length <= 40, row.title)
  }
  // GitHub 发布记录只给格式，不内置具体项目
  assert.ok(!FEED_CATALOG.some(row => /github\.com\/[^/]+\/[^/]+\/releases/.test(row.url)))
  assert.match(GITHUB_RELEASES_PATTERN, /OWNER\/REPO\/releases\.atom$/)
  const state = { feeds: [] }
  const { errors } = applyOps(state, FEED_CATALOG.map(row => ({ op: 'add_feed', url: row.url, title: row.title })))
  assert.deepEqual(errors, [])
  assert.deepEqual(state.feeds.map(row => row.title), FEED_CATALOG.map(row => row.title))
})

test('内置信息源：分组 id 唯一，每组写明数据从哪来', () => {
  assert.equal(new Set(BUILTIN_GROUP_IDS).size, BUILTIN_GROUPS.length)
  for (const group of BUILTIN_GROUPS) assert.ok(group.name && group.note && group.via, group.id)
})

test('follow-builders 的 X 帖子：标题取第一行，热度是点赞，作者和身份都带上；不安全的链接丢掉', () => {
  const rows = parseBuildersX(FEED_X)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    title: 'We love this and build with it regularly ♥️', url: 'https://x.com/joshwoodward/status/2120622974277734716', date: '2026-11-11T21:01:30.000Z',
    summary: 'We love this and build with it regularly ♥️ It makes our apps faster and smarter https://t.co/79qcg9KloV', heat: 240, author: 'Josh Woodward', role: 'VP, @Google @GoogleLabs @GeminiApp @GoogleAIStudio',
  })
  assert.throws(() => parseBuildersX({}))
})

test('follow-builders 的播客、ainav.cn 的每日汇总', () => {
  const [episode] = parseBuildersPodcasts(FEED_PODCASTS)
  assert.equal(episode.author, 'AI & I by Every')
  assert.equal(episode.date, '2026-11-11T15:30:00.000Z')
  assert.match(episode.summary, /^Hey, welcome back/)
  const rows = parseAinav(AINAV)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].date, '2026-11-12T11:36:20.000Z')
  assert.equal(rows[0].url, 'https://www.qbitai.com/2026/11/509440.html')
  assert.throws(() => parseAinav({ channel: {} }))
})

test('chinaDay：按北京时间取日期', () => {
  assert.equal(chinaDay(new Date('2026-11-12T17:30:00Z')), '2026-11-13')
  assert.equal(chinaDay(new Date('2026-11-12T15:30:00Z')), '2026-11-12')
})

function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    const hit = Object.entries(routes).find(([key]) => String(url).includes(key))
    if (!hit) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { impl, calls }
}

test('fetchBuiltin：只读要的分组，每个来源请求一次，单个失败不影响其余', async () => {
  const { impl, calls } = fakeFetch({ 'feed-x.json': FEED_X, 'liangziwei_2026-11-13.json': AINAV })
  const now = new Date('2026-11-13T04:00:00Z')
  const { groups } = await fetchBuiltin(['builders-x', 'cn-ai'], impl, now)
  assert.deepEqual(groups.map(group => group.id), ['builders-x', 'cn-ai'])
  assert.equal(groups[0].sources[0].entries[0].source, 'X · 建设者')
  assert.equal(groups[0].sources[0].entries[0].groupId, 'builders-x')
  const cn = groups[1].sources
  assert.equal(cn.length, 9)
  assert.equal(cn.find(row => row.id === 'ainav-liangziwei').entries.length, 2)
  // 其余八家这里是 404：写明是还没有当天的数据
  assert.match(cn.find(row => row.id === 'ainav-36kr').error, /还没有 2026-11-13 的数据/)
  // 每个来源只请求一次；没打开的播客分组一次都没请求
  assert.equal(calls.length, 10)
  assert.ok(!calls.some(url => url.includes('feed-podcasts')))
  assert.deepEqual(await fetchBuiltin([], impl, now), { groups: [] })
})
