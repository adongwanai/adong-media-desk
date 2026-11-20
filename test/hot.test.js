// 热榜解析器：用 2026-11-13 从这台电脑真实请求到的响应（删减后）当样本；网络一律走注入的 fetchImpl。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanSummary, fetchHot, hotFailure, parseBaidu, parseBilibiliPopular, parseGithubTrending, parseHackerNews, parseWeibo } from '../src/hot.js'

// https://github.com/trending 的前两个仓库
const GITHUB = `<main>
<article class="Box-row">
<div class="float-right d-flex">
<div class="BtnGroup d-flex">
<a href="/login?return_to=%2FGoogleChrome%2Fmodern-web-guidance-src" rel="nofollow" aria-label="You must be signed in to star a repository" class="tooltipped tooltipped-sw btn-sm btn">
<span class="d-none d-md-inline">
Star
</span>
</a></div>
</div>
<h2 class="h3 lh-condensed">
<a href="/GoogleChrome/modern-web-guidance-src" class="Link">
<span class="text-normal">
GoogleChrome /
</span>
modern-web-guidance-src</a>  </h2>
<div class="f6 color-fg-muted mt-2">
<span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0">
<span class="repo-language-color" style="background-color: #3178c6"></span>
<span itemprop="programmingLanguage">TypeScript</span>
</span>
<a href="/GoogleChrome/modern-web-guidance-src/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block">
2,464</a>
<a href="/GoogleChrome/modern-web-guidance-src/forks" class="tmp-mr-3 Link Link--muted d-inline-block">
176</a>
<span class="tmp-mr-3 d-inline-block">
</span>
<span class="d-inline-block float-sm-right">
799 stars today
</span>  </div>
</article>
<article class="Box-row">
<div class="float-right d-flex">
<div class="BtnGroup d-flex">
<a href="/login?return_to=%2Fopenai%2Fcodex-security" rel="nofollow" aria-label="You must be signed in to star a repository" class="tooltipped tooltipped-sw btn-sm btn">
<span class="d-none d-md-inline">
Star
</span>
</a></div>
</div>
<h2 class="h3 lh-condensed">
<a href="/openai/codex-security" class="Link">
<span class="text-normal">
openai /
</span>
codex-security</a>  </h2>
<p class="col-9 color-fg-muted my-1 tmp-pr-4">
OpenAI's Codex Security CLI and TypeScript SDK for finding, validating, and fixing security vulnerabilities. npm: <a href="https://www.npmjs.com/package/@openai/codex-security" class="Link--inTextBlock" rel="nofollow">https://www.npmjs.com/package/@openai/codex-security</a>
</p>
<div class="f6 color-fg-muted mt-2">
<span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0">
<span class="repo-language-color" style="background-color: #3178c6"></span>
<span itemprop="programmingLanguage">TypeScript</span>
</span>
<a href="/openai/codex-security/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block">
12,196</a>
<a href="/openai/codex-security/forks" class="tmp-mr-3 Link Link--muted d-inline-block">
968</a>
<span class="tmp-mr-3 d-inline-block">
</span>
<span class="d-inline-block float-sm-right">
663 stars today
</span>  </div>
</article>
</main>`

// https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30（第二条去掉外链，模拟 Ask HN）
const HN = { hits: [{ title: 'Tim Peters has died', url: 'https://discuss.python.org/t/in-memoriam-tim-peters-1952-2026/110028', points: 1345, num_comments: 163, objectID: '50450488', created_at: '2026-11-11T07:03:17Z' }, { title: 'NVIDIA Announces CEO Transition', url: null, points: 1118, num_comments: 962, objectID: '50467087', created_at: '2026-11-12T13:52:29Z' }] }

// https://weibo.com/ajax/side/hotSearch（第三条是广告位）
const WEIBO = { ok: 1, data: { hotgov: { word: '#共襄中华民族伟大复兴盛举#', url: 'http://weibo.com/2656274875/Rr4dGwO6I', is_gov: 1 }, realtime: [{ word: '刘欢妻子长文', word_scheme: '#刘欢妻子长文#', note: '刘欢妻子长文', num: 2257561, realpos: 1, rank: 0, label_name: '新', flag: 1 }, { word: '普通人用AI和会用AI的人', word_scheme: '#普通人用AI和会用AI的人#', note: '普通人用AI和会用AI的人', num: 1369057, realpos: 2, rank: 1, label_name: '', flag: 0 }, { word: '问界新M8正式上市', note: '问界新M8正式上市', num: 1054224, rank: 2, is_ad: 1 }] } }

// https://api.bilibili.com/x/web-interface/popular?ps=20
const BILIBILI = { code: 0, message: 'OK', ttl: 1, data: { list: [{ aid: 117602311476853, bvid: 'BV1kZWX62ENY', title: '为什么是最后一期？影视飓风1800万粉丝Q&A！', owner: { mid: 946974, name: '影视飓风' }, stat: { view: 1253185, like: 169102, reply: 9588 } }, { aid: 117591389702977, bvid: 'BV1nEWu6xEyq', title: '《崩坏：星穹铁道》EP：「无中生有」', owner: { mid: 1340190821, name: '崩坏星穹铁道' }, stat: { view: 1078873, like: 120564, reply: 8037 } }], no_more: false } }

// https://top.baidu.com/board?tab=realtime 页面里嵌的 s-data（第一条是置顶）
const BAIDU_DATA = { data: { cards: [{ component: 'hotList', content: [
  { desc: '在纪念孙中山先生诞辰160周年大会上', hotScore: '7904715', index: 0, isTop: true, query: '凝心聚力铸伟业 接续奋斗谱华章', rawUrl: 'https://www.baidu.com/s?wd=%E5%87%9D%E5%BF%83%E8%81%9A%E5%8A%9B%E9%93%B8%E4%BC%9F%E4%B8%9A', word: '凝心聚力铸伟业 接续奋斗谱华章' },
  { desc: '歌手刘欢于11月12日安葬在北京，长眠长城脚下。', hotScore: '7808211', index: 0, query: '刘欢安葬于北京 曾与膀胱癌斗争多年', rawUrl: 'https://www.baidu.com/s?wd=%E5%88%98%E6%AC%A2%E5%AE%89%E8%91%AC%E4%BA%8E%E5%8C%97%E4%BA%AC', word: '刘欢安葬于北京 曾与膀胱癌斗争多年' },
  { desc: '近日，南京“零元面馆”引发周边商户叫苦。', hotScore: '7712673', index: 1, query: '零元面馆周边商户：我们房贷都还不起', rawUrl: 'https://www.baidu.com/s?wd=%E9%9B%B6%E5%85%83%E9%9D%A2%E9%A6%86', word: '零元面馆周边商户：我们房贷都还不起' },
], updateTime: '1794500133' }], curBoardName: '热搜榜' } }
const BAIDU = `<html><body><div><div id="sanRoot" theme="realtime" class="wrapper c-font-normal rel"><!--s-data:${JSON.stringify(BAIDU_DATA)}--></div></div></body></html>`

const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
const html = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })

test('parseGithubTrending：仓库名、链接、今日 star 和简介', () => {
  const rows = parseGithubTrending(GITHUB)
  assert.deepEqual(rows.map(row => [row.title, row.url, row.heat]), [
    ['GoogleChrome / modern-web-guidance-src', 'https://github.com/GoogleChrome/modern-web-guidance-src', 799],
    ['openai / codex-security', 'https://github.com/openai/codex-security', 663],
  ])
  assert.equal(rows[0].summary, '')
  assert.match(rows[1].summary, /^OpenAI's Codex Security CLI/)
})

test('parseHackerNews：热度是得分，没有外链的指向讨论页', () => {
  assert.deepEqual(parseHackerNews(HN).map(row => [row.title, row.url, row.heat]), [
    ['Tim Peters has died', 'https://discuss.python.org/t/in-memoriam-tim-peters-1952-2026/110028', 1345],
    ['NVIDIA Announces CEO Transition', 'https://news.ycombinator.com/item?id=50467087', 1118],
  ])
})

test('parseWeibo：去掉广告位，链接指向微博搜索', () => {
  const rows = parseWeibo(WEIBO)
  assert.deepEqual(rows.map(row => [row.title, row.heat]), [['刘欢妻子长文', 2257561], ['普通人用AI和会用AI的人', 1369057]])
  assert.equal(rows[0].url, `https://s.weibo.com/weibo?q=${encodeURIComponent('#刘欢妻子长文#')}`)
  assert.throws(() => parseWeibo({ error: 'Forbidden' }), /微博没有返回榜单/)
})

test('parseBilibiliPopular：热度是播放数，接口报错原样抛出', () => {
  assert.deepEqual(parseBilibiliPopular(BILIBILI).map(row => [row.title, row.url, row.heat, row.summary]), [
    ['为什么是最后一期？影视飓风1800万粉丝Q&A！', 'https://www.bilibili.com/video/BV1kZWX62ENY', 1253185, 'UP：影视飓风'],
    ['《崩坏：星穹铁道》EP：「无中生有」', 'https://www.bilibili.com/video/BV1nEWu6xEyq', 1078873, 'UP：崩坏星穹铁道'],
  ])
  assert.throws(() => parseBilibiliPopular({ code: -352, message: '风控校验失败' }), /风控校验失败/)
})

test('parseBaidu：读嵌在页面里的 JSON，置顶不算排名，热度从字符串转成数字', () => {
  const rows = parseBaidu(BAIDU)
  assert.deepEqual(rows.map(row => [row.title, row.heat]), [['刘欢安葬于北京 曾与膀胱癌斗争多年', 7808211], ['零元面馆周边商户：我们房贷都还不起', 7712673]])
  assert.match(rows[0].url, /^https:\/\/www\.baidu\.com\/s\?wd=/)
  assert.throws(() => parseBaidu('<html>改版了</html>'), /没有找到榜单数据/)
})

test('fetchHot：每个榜只请求一次，排名从 1 开始，失败的榜写明原因，不影响其余', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    const href = String(url)
    calls.push({ href, referer: init.headers.referer })
    if (href.startsWith('https://github.com/trending')) return html(GITHUB)
    if (href.startsWith('https://hn.algolia.com/')) return json(HN)
    if (href.startsWith('https://weibo.com/')) return init.headers.referer ? json(WEIBO) : new Response('{"error":"Forbidden"}', { status: 403 })
    if (href.startsWith('https://api.bilibili.com/')) return new Response('{"code":-412}', { status: 412, headers: { 'content-type': 'application/json' } })
    if (href.startsWith('https://top.baidu.com/')) return html(BAIDU)
    throw new Error(`unexpected ${href}`)
  }
  const { sources } = await fetchHot(['github', 'hackernews', 'weibo', 'bilibili', 'baidu'], fetchImpl)
  assert.equal(calls.length, 5)
  assert.equal(calls.find(call => call.href.includes('weibo')).referer, 'https://weibo.com/')
  const byId = Object.fromEntries(sources.map(row => [row.id, row]))
  assert.deepEqual(Object.keys(byId), ['github', 'hackernews', 'weibo', 'bilibili', 'baidu'])
  assert.deepEqual(byId.weibo.entries.map(row => [row.rank, row.source]), [[1, '微博热搜'], [2, '微博热搜']])
  assert.equal(byId.bilibili.entries.length, 0)
  // 412 是被风控：写成人话，代码另外给
  assert.equal(byId.bilibili.errorCode, 'blocked')
  assert.match(byId.bilibili.error, /当成了机器访问/)
  assert.equal(byId.weibo.errorCode, null)
  for (const row of sources) assert.ok(!Number.isNaN(Date.parse(row.fetchedAt)))

  const one = await fetchHot(['baidu', 'nope'], fetchImpl)
  assert.deepEqual(one.sources.map(row => row.id), ['baidu'])
})

test('fetchHot：超时换成人话', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) }
  const { sources } = await fetchHot(['github'], fetchImpl)
  assert.equal(sources[0].errorCode, 'timeout')
  assert.match(sources[0].error, /没有回应/)
})

test('hotFailure：aborted、超时、403、412、429、空榜、5xx、连不上各自翻成人话', () => {
  const cases = [
    [Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }), 'timeout'],
    [new Error('aborted'), 'timeout'],
    [Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), 'timeout'],
    [Object.assign(new Error('接口返回 403，可能需要登录或被平台拦截'), { httpStatus: 403 }), 'forbidden'],
    [new Error('页面返回 403，可能需要登录或被平台拦截'), 'forbidden'],
    [Object.assign(new Error('接口返回 412，可能需要登录或被平台拦截'), { httpStatus: 412 }), 'blocked'],
    [Object.assign(new Error('x'), { httpStatus: 429 }), 'limited'],
    [Object.assign(new Error('榜单是空的'), { empty: true }), 'empty'],
    [Object.assign(new Error('x'), { httpStatus: 502 }), 'server'],
    [Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'network'],
    [new Error('百度榜单数据解析不了'), 'other'],
  ]
  for (const [err, code] of cases) {
    const got = hotFailure(err)
    assert.equal(got.code, code, err.message)
    assert.ok(!/aborted|fetch failed|\d{3}/.test(got.reason), got.reason)
  }
  assert.equal(hotFailure(new Error('百度榜单数据解析不了')).reason, '百度榜单数据解析不了')
})

test('fetchHot：空榜单算失败；摘要去掉「点击查看原文>」这类按钮文字', async () => {
  const empty = await fetchHot(['hackernews'], async () => json({ hits: [] }))
  assert.equal(empty.sources[0].errorCode, 'empty')
  const withLeftover = await fetchHot(['sspai'], async () => json({ data: [{ id: 1, title: '派评', like_count: 1, summary: '本周值得一看的应用。点击查看原文>' }] }))
  assert.equal(withLeftover.sources[0].entries[0].summary, '本周值得一看的应用。')
})

test('cleanSummary：按钮文字去掉，正文里的「原文」「详情」不动', () => {
  assert.equal(cleanSummary('今天发布了新模型。点击查看原文>'), '今天发布了新模型。')
  assert.equal(cleanSummary('新版本上线 阅读全文'), '新版本上线')
  assert.equal(cleanSummary('一句话摘要 [查看原文]>>'), '一句话摘要')
  assert.equal(cleanSummary('模型更新（点击查看详情）'), '模型更新')
  assert.equal(cleanSummary('Big news here. Read more »'), 'Big news here.')
  assert.equal(cleanSummary('summary [...]'), 'summary')
  assert.equal(cleanSummary('这篇讲原文作者的观点'), '这篇讲原文作者的观点')
  assert.equal(cleanSummary('了解详情'), '了解详情')
  assert.equal(cleanSummary(undefined), '')
})

test('国内四个榜的解析：知乎热度文字换成数字、头条去掉统计参数、掘金和少数派拼出文章地址', async () => {
  const { parseZhihu, parseToutiao, parseJuejin, parseSspai } = await import('../src/hot.js')
  assert.deepEqual(parseZhihu({ data: [{ card_id: 'Q_2104132164308530649', target: { title_area: { text: '网传某公司裁员，实际什么情况？' }, excerpt_area: { text: '摘要' }, metrics_area: { text: '2686 万热度' } } }] }), [{ title: '网传某公司裁员，实际什么情况？', url: 'https://www.zhihu.com/question/2104132164308530649', heat: 26860000, summary: '摘要' }])
  assert.deepEqual(parseToutiao({ data: [{ Title: '某事件', ClusterIdStr: '7707264804913679898', Url: 'https://www.toutiao.com/trending/7707264804913679898/?log_pb=x', HotValue: '13643870' }] }), [{ title: '某事件', url: 'https://www.toutiao.com/trending/7707264804913679898/', heat: 13643870, summary: '' }])
  assert.deepEqual(parseJuejin({ data: [{ content: { content_id: '7706534471420461098', title: '你们公司有 35 岁以上的前端吗？', brief: '' }, content_counter: { hot_rank: 2736 } }] })[0].url, 'https://juejin.cn/post/7706534471420461098')
  assert.deepEqual(parseSspai({ data: [{ id: 118833, title: '派评', like_count: 10, summary: '>下载客户端' }] }), [{ title: '派评', url: 'https://sspai.com/post/118833', heat: 10, summary: '下载客户端' }])
  for (const parse of [parseZhihu, parseToutiao, parseJuejin, parseSspai]) assert.throws(() => parse({ error: 'x' }))
})

test('订阅源的摘要也去掉按钮文字', async () => {
  const { parseFeed } = await import('../src/feeds.js')
  const xml = '<rss><channel><title>源</title><item><title>标题</title><link>https://example.com/a</link><description><![CDATA[<p>一段摘要。</p><a href="https://example.com/a">点击查看原文&gt;</a>]]></description></item></channel></rss>'
  assert.equal(parseFeed(xml).entries[0].summary, '一段摘要。')
})
