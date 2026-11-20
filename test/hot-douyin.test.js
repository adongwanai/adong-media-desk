import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fetchHot, parseDouyin } from '../src/hot.js'

// 夹具是 2026-11-13 在这台电脑上真实请求拿到的抖音热搜，只留了前 3 条和用得到的字段
const DOUYIN = JSON.parse(await readFile(new URL('./fixtures/douyin-hot.json', import.meta.url), 'utf8'))
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })

test('parseDouyin：标题、热度和话题页地址', () => {
  assert.deepEqual(parseDouyin(DOUYIN), [
    { title: '烟火美食夯吃挑战开赛了', url: 'https://www.douyin.com/hot/2742749', heat: 11101479, summary: '' },
    { title: '秋冬落地签是一杯warm drink', url: 'https://www.douyin.com/hot/2742579', heat: 11096760, summary: '' },
    { title: '亚太之问中国作答', url: 'https://www.douyin.com/hot/2743432', heat: 10916344, summary: '' },
  ])
  assert.throws(() => parseDouyin({ status_code: 8 }), /抖音没有返回榜单/)
})

test('抖音热搜：先打开登录页拿访客 cookie，再带着它读榜单；一次点击两次请求', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    const href = String(url)
    calls.push({ href, cookie: init.headers.cookie ?? null })
    if (href === 'https://login.douyin.com/') return new Response('<html></html>', { status: 200, headers: [['content-type', 'text/html'], ['set-cookie', 'passport_csrf_token=abc123; Path=/; Domain=douyin.com; Secure'], ['set-cookie', 'passport_csrf_token_default=abc123; Path=/']] })
    if (href.startsWith('https://www.douyin.com/aweme/v1/web/hot/search/list/')) return init.headers.cookie ? json(DOUYIN) : new Response('', { status: 200, headers: { 'content-type': 'text/plain' } })
    throw new Error(`unexpected ${href}`)
  }
  const { sources } = await fetchHot(['douyin'], fetchImpl)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].cookie, 'passport_csrf_token=abc123; passport_csrf_token_default=abc123')
  assert.equal(sources[0].error, null)
  assert.deepEqual(sources[0].entries.map(row => [row.rank, row.source]), [[1, '抖音热搜'], [2, '抖音热搜'], [3, '抖音热搜']])
})

test('抖音没给访客 cookie 时直接说明，不去读榜单', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
  }
  const { sources } = await fetchHot(['douyin'], fetchImpl)
  assert.equal(calls.length, 1)
  assert.match(sources[0].error, /访客 cookie/)
  assert.deepEqual(sources[0].entries, [])
})
