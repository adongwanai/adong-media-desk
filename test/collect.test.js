// 各平台账号读取器：样本都是 2026-11-13 在这台电脑上对公开大号的真实响应（删减后，不含 cookie、token），网络一律走注入的 fetchImpl。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseBilibiliAccount, parseFxLatest, parseFxProfile, parseScholar, parseYoutubeChannel, parseYoutubeVideo, readAccount, readAccounts, readSupport, xHandle, youtubeChannel } from '../src/collect.js'
import { ACCOUNT_PLATFORMS } from '../src/ops.js'

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const fixtureJson = name => JSON.parse(fixture(name))
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
const redirect = location => new Response(null, { status: 302, headers: { location } })

/** 按地址回放样本，并记下发了哪些请求。 */
function replay(routes) {
  const calls = []
  const fetchImpl = async (url) => {
    const href = String(url)
    calls.push(href)
    const hit = Object.entries(routes).find(([prefix]) => href.startsWith(prefix))
    if (!hit) throw new Error(`没有准备这个地址的样本：${href}`)
    return hit[1](href)
  }
  return { calls, fetchImpl }
}

test('B 站：card 接口给粉丝、获赞、投稿；接口报错带上原因', () => {
  assert.deepEqual(parseBilibiliAccount(fixtureJson('bilibili-card.json')), { name: '老番茄', followers: 20882729, stats: { likes: 196938127, works: 684 } })
  assert.throws(() => parseBilibiliAccount({ code: -352, message: '风控校验失败' }), /风控校验失败/)
  // 字段对不上就是没读到，不补 0
  assert.deepEqual(parseBilibiliAccount({ code: 0, data: { card: { name: 'x' } } }), { name: 'x', followers: null, stats: {} })
})

test('GitHub：Star 总数是主数字，另有关注者、仓库数、最新仓库和 star 最多的仓库；fork 不算；最多三个请求', async () => {
  const { calls, fetchImpl } = replay({
    'https://api.github.com/users/karpathy/repos': () => json(fixture('github-repos.json')),
    'https://api.github.com/users/karpathy': () => json(fixture('github-user.json')),
  })
  const got = await readAccount({ platform: 'GitHub', url: 'https://github.com/karpathy' }, fetchImpl)
  assert.equal(got.error, null)
  assert.equal(got.followers, 2044 + 99953 + 528 + 691)
  assert.deepEqual(got.stats, { fans: 232044, works: 4 })
  assert.deepEqual(got.latest, { title: 'jobs', url: 'https://github.com/karpathy/jobs', at: '2026-03-14T20:45:40Z', stars: 2044 })
  assert.equal(got.top.title, 'autoresearch')
  assert.equal(calls.length, 2)
})

test('GitHub：仓库超过两页就不报不完整的 Star 总数；限流时说清楚', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ name: `r${i}`, html_url: `https://github.com/u/r${i}`, stargazers_count: 1, created_at: '2026-01-01T00:00:00Z' }))
  const { calls, fetchImpl } = replay({
    'https://api.github.com/users/u/repos': () => json(page),
    'https://api.github.com/users/u': () => json({ login: 'u', followers: 3 }),
  })
  const many = await readAccount({ platform: 'GitHub', url: 'https://github.com/u' }, fetchImpl)
  assert.equal(many.followers, null)
  assert.match(many.error, /200/)
  assert.equal(calls.length, 3)
  const limited = await readAccount({ platform: 'GitHub', url: 'https://github.com/u' }, async () => json({ message: 'API rate limit exceeded' }, 403))
  assert.match(limited.error, /403/)
})

test('X：FxTwitter 的 profile 给粉丝和帖子数；最新一条只算本人发的，转帖不算', async () => {
  assert.deepEqual(parseFxProfile(fixtureJson('fxtwitter-profile.json')), { name: 'Andrej Karpathy', followers: 4447780, stats: { works: 10173 } })
  const statuses = fixtureJson('fxtwitter-statuses.json')
  const latest = parseFxLatest(statuses, 'Karpathy')
  assert.equal(latest.url, 'https://x.com/karpathy/status/2119114537442189652')
  assert.equal(latest.at, '2026-11-07T17:07:31.000Z')
  assert.deepEqual([latest.views, latest.likes, latest.comments, latest.shares, latest.saves], [989020, 9269, 675, 781, 10362])
  // 把本人的帖子都去掉，只剩别人的转帖：没有最新一条，不拿别人的顶替
  assert.equal(parseFxLatest({ results: statuses.results.filter(row => row.reposted_by) }, 'karpathy'), null)
  assert.equal(xHandle('https://x.com/karpathy'), 'karpathy')
  assert.equal(xHandle('https://twitter.com/karpathy/'), 'karpathy')
  assert.equal(xHandle('https://x.com/karpathy/status/1'), null)
  assert.equal(xHandle('https://x.com/home'), null)
})

test('X：最新一条读不到不影响粉丝数；账号不存在说清楚', async () => {
  const { calls, fetchImpl } = replay({
    'https://api.fxtwitter.com/2/profile/karpathy/statuses': () => json({ code: 500 }, 500),
    'https://api.fxtwitter.com/2/profile/karpathy': () => json(fixture('fxtwitter-profile.json')),
    'https://api.fxtwitter.com/2/profile/nobody': () => json({ code: 404, message: 'User not found' }, 404),
  })
  const got = await readAccount({ platform: 'X', url: 'https://x.com/karpathy' }, fetchImpl)
  assert.deepEqual([got.followers, got.latest, got.via, got.error], [4447780, null, 'FxTwitter', null])
  assert.equal(calls.length, 2)
  const missing = await readAccount({ platform: 'X', url: 'https://x.com/nobody' }, fetchImpl)
  assert.match(missing.error, /找不到这个账号/)
})

test('谷歌学术：引用统计表按行名取总被引、h 指数、i10 指数；最新论文带年份和被引', async () => {
  const parsed = parseScholar(fixture('scholar-citations.html'))
  assert.deepEqual([parsed.name, parsed.followers, parsed.stats], ['Geoffrey Hinton', 1110312, { hIndex: 196, i10Index: 554 }])
  assert.equal(parsed.latest.year, 2026)
  assert.equal(parsed.latest.citations, 19)
  assert.match(parsed.latest.url, /^https:\/\/scholar\.google\.com\/citations\?view_op=view_citation&hl=en&user=JicYPdAAAAAJ/)
  assert.throws(() => parseScholar('<html><body>Please show you are not a robot</body></html>'), /人机验证/)
  const { calls, fetchImpl } = replay({ 'https://scholar.google.com/citations?user=JicYPdAAAAAJ&hl=en&sortby=pubdate': () => html(fixture('scholar-citations.html')) })
  const got = await readAccount({ platform: '谷歌学术', url: 'https://scholar.google.com/citations?user=JicYPdAAAAAJ&hl=zh-CN' }, fetchImpl)
  assert.equal(got.followers, 1110312)
  assert.equal(calls.length, 1)
})

test('谷歌学术：被跳到人机验证页时不打开那一页，直接报原因', async () => {
  const { calls, fetchImpl } = replay({ 'https://scholar.google.com/citations': () => redirect('https://www.google.com/sorry/index?continue=x') })
  const got = await readAccount({ platform: '谷歌学术', url: 'https://scholar.google.com/citations?user=JicYPdAAAAAJ' }, fetchImpl)
  assert.equal(got.followers, null)
  assert.match(got.error, /登录或人机验证页/)
  assert.equal(calls.length, 1)
})

test('YouTube：频道页给最新一条长视频，视频页给精确播放和点赞；订阅数只有四舍五入的文字，不记', async () => {
  assert.deepEqual(parseYoutubeChannel(fixture('youtube-videos.html')), { name: 'Andrej Karpathy', videoId: 'EWvNQjAaOHw' })
  assert.deepEqual(parseYoutubeVideo(fixture('youtube-watch.html'), 'EWvNQjAaOHw'), { title: 'How I use LLMs', url: 'https://www.youtube.com/watch?v=EWvNQjAaOHw', at: '2025-02-27T22:29:56.000Z', views: 2916538, likes: 70208 })
  assert.throws(() => parseYoutubeVideo(fixture('youtube-watch.html'), 'aaaaaaaaaaa'), /没有这条视频/)
  assert.equal(youtubeChannel('https://www.youtube.com/@AndrejKarpathy/featured'), 'https://www.youtube.com/@AndrejKarpathy')
  assert.equal(youtubeChannel('https://youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ'), 'https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ')
  assert.equal(youtubeChannel('https://www.youtube.com/watch?v=EWvNQjAaOHw'), null)
  const { calls, fetchImpl } = replay({
    'https://www.youtube.com/@AndrejKarpathy/videos': () => html(fixture('youtube-videos.html')),
    'https://www.youtube.com/watch?v=EWvNQjAaOHw': () => html(fixture('youtube-watch.html')),
  })
  const got = await readAccount({ platform: 'YouTube', url: 'https://www.youtube.com/@AndrejKarpathy' }, fetchImpl)
  assert.deepEqual([got.followers, got.latest.views, calls.length], [null, 2916538, 2])
  assert.match(got.error, /四舍五入/)
})

test('readSupport：每个账号平台都有说法，读不到的给出原因；读不到的平台不发请求', async () => {
  const support = readSupport()
  assert.deepEqual(Object.keys(support).sort(), [...ACCOUNT_PLATFORMS].sort())
  assert.deepEqual(ACCOUNT_PLATFORMS.filter(platform => support[platform].readable).sort(), ['B站', 'GitHub', 'X', 'YouTube', '谷歌学术'].sort())
  for (const platform of ACCOUNT_PLATFORMS.filter(name => !support[name].readable)) assert.ok(support[platform].reason, platform)
  const { calls, fetchImpl } = replay({})
  const results = await readAccounts(['公众号', '小红书', '抖音', '视频号', '知乎', '头条'].map(platform => ({ platform, url: 'https://example.com/u' })), fetchImpl)
  assert.equal(calls.length, 0)
  assert.ok(results.every(row => row.followers === null && row.error))
})

test('readAccounts：同一平台只读一个账号，网络错误换成人话', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }) }
  const results = await readAccounts([
    { platform: 'B站', url: 'https://space.bilibili.com/1' },
    { platform: 'B站', url: 'https://space.bilibili.com/2' },
  ], fetchImpl)
  assert.equal(results.length, 1)
  assert.match(results[0].error, /ECONNRESET/)
})
