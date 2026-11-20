import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import plugin from '../src/host.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'
import { clearTokenCache, draftFromItem, pollPublish, publishDraft, publishStatus, submitPublish } from '../src/wechat.js'
import { publishFromItem, publishStatusOfItem } from '../src/wechat-publish.js'

const APP_ID = 'wx0123456789abcdef'
const SECRET = 'fakesecret0123456789abcdef012345'
const TOKEN = 'FAKE_TOKEN_abc'
const CREDS = { appId: APP_ID, appSecret: SECRET }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const noSleep = async () => {}

function fakeFetch(responses) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const body = responses.shift()
    if (!body) throw new Error('unexpected request')
    return { status: 200, json: async () => body }
  }
  return { impl, calls }
}

const path = call => { const url = new URL(call.url); return `${url.origin}${url.pathname}` }

test('publishDraft：换 token → 提交发布 → 轮询到成功，带回文章链接', async () => {
  clearTokenCache()
  const { impl, calls } = fakeFetch([
    { access_token: TOKEN, expires_in: 7200 },
    { errcode: 0, errmsg: 'ok', publish_id: 2247503051, msg_data_id: 1 },
    { publish_id: '2247503051', publish_status: 1, fail_idx: [] },
    { publish_id: '2247503051', publish_status: 0, article_id: 'ART', article_detail: { count: 1, item: [{ idx: 1, article_url: 'https://mp.weixin.qq.com/s/abc' }] }, fail_idx: [] },
  ])
  const submitted = []
  const sleeps = []
  const result = await publishDraft(CREDS, 'MEDIA_1', { fetchImpl: impl, sleep: async (ms) => { sleeps.push(ms) }, interval: 2000, onSubmitted: id => submitted.push(id) })
  assert.deepEqual(result, { publishId: '2247503051', done: true, url: 'https://mp.weixin.qq.com/s/abc', articleId: 'ART' })
  assert.deepEqual(submitted, ['2247503051'])
  assert.deepEqual(sleeps, [2000, 2000])
  assert.equal(calls.length, 4)
  assert.equal(path(calls[1]), 'https://api.weixin.qq.com/cgi-bin/freepublish/submit')
  assert.equal(new URL(calls[1].url).searchParams.get('access_token'), TOKEN)
  assert.equal(calls[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].init.body), { media_id: 'MEDIA_1' })
  assert.equal(path(calls[2]), 'https://api.weixin.qq.com/cgi-bin/freepublish/get')
  assert.deepEqual(JSON.parse(calls[2].init.body), { publish_id: '2247503051' })
  // 整个流程里只提交了一次
  assert.equal(calls.filter(call => call.url.includes('freepublish/submit')).length, 1)
})

test('pollPublish：次数有上限，可以中途停止，停止后不再请求', async () => {
  clearTokenCache()
  const pending = () => ({ publish_id: 'P', publish_status: 1 })
  const { impl, calls } = fakeFetch([{ access_token: TOKEN, expires_in: 7200 }, pending(), pending(), pending()])
  assert.deepEqual(await pollPublish(CREDS, 'P', { fetchImpl: impl, attempts: 3, sleep: noSleep }), { done: false })
  assert.equal(calls.filter(call => call.url.includes('freepublish/get')).length, 3)

  const controller = new AbortController()
  const { impl: impl2, calls: calls2 } = fakeFetch([pending(), pending()])
  let n = 0
  const result = await pollPublish(CREDS, 'P', { fetchImpl: impl2, attempts: 10, sleep: async () => { n += 1; if (n === 2) controller.abort() }, signal: controller.signal })
  assert.deepEqual(result, { done: false, cancelled: true })
  assert.equal(calls2.length, 1)
})

test('发布接口的错误码翻成人话，错误里没有密钥和令牌', async () => {
  const cases = [
    [48001, /未认证/],
    [53503, /发布检查/],
    [53504, /后台网页上处理/],
    [53505, /手动保存/],
    [40002, /参数不对/],
  ]
  for (const [errcode, pattern] of cases) {
    const { impl } = fakeFetch([{ errcode, errmsg: `bad ${SECRET} ${TOKEN}` }])
    await assert.rejects(submitPublish(TOKEN, 'M', impl), (err) => {
      assert.match(err.message, pattern)
      assert.ok(!err.message.includes(SECRET) && !err.message.includes(TOKEN))
      return true
    })
  }
  const { impl: unknown } = fakeFetch([{ errcode: 61234, errmsg: `token ${TOKEN} leaked` }])
  await assert.rejects(submitPublish(TOKEN, 'M', unknown), (err) => {
    assert.match(err.message, /61234/)
    assert.ok(!err.message.includes(TOKEN))
    return true
  })
  for (const [status, pattern] of [[2, /原创/], [3, /发表记录/], [4, /审核/], [5, /删除/], [6, /封禁/], [9, /状态 9/]]) {
    const { impl } = fakeFetch([{ publish_id: 'P', publish_status: status, fail_idx: [1] }])
    await assert.rejects(publishStatus(TOKEN, 'P', impl), (err) => {
      assert.match(err.message, pattern)
      assert.equal(err.publishStatus, status)
      return true
    })
  }
  // 网络错误里带出的令牌也打码
  const failing = async () => { throw new Error(`connect failed ${TOKEN}`) }
  await assert.rejects(submitPublish(TOKEN, 'M', failing), err => !err.message.includes(TOKEN))
  // 只返回 http(s) 链接
  const { impl: odd } = fakeFetch([{ publish_id: 'P', publish_status: 0, article_detail: { item: [{ article_url: 'javascript:alert(1)' }] } }])
  assert.equal((await publishStatus(TOKEN, 'P', odd)).url, null)
})

async function withDesk(run) {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-'))
  try {
    const store = new Store(join(dir, 'ip-workbench'), { samples: false })
    const id = await store.mutate('add', state => applyOps(state, [{ op: 'add_item', title: '稿子' }]).receipts[0].target)
    await store.mutate('成稿', (state) => {
      state.items.find(row => row.id === id).production = { status: 'done', title: '成稿标题', article: '## 小标题\n\n正文 **重点**', cover: { src: 'media-desk/files/cover_test.png' } }
    })
    await writeFile(join(store.filesDir, 'cover_test.png'), PNG)
    const settings = new Settings(join(dir, 'ip-workbench'))
    await run({ dir, store, settings, id })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const setDraft = (store, id, extra = {}) => store.mutate('draft', state => applyOps(state, [{ op: 'set_publish', id, platform: '公众号', state: 'drafted', mediaId: 'M1', ...extra }]))
const row = async (store, id) => (await store.read()).items.find(item => item.id === id)

test('draftFromItem：浏览器排好的 HTML 先清洗再推；没传时用朴素排版；有公众号版本时推版本', async () => {
  await withDesk(async ({ store, settings, id }) => {
    const saved = await settings.update({ wechat: { appId: APP_ID, appSecret: SECRET } })
    clearTokenCache()
    let { impl, calls } = fakeFetch([{ access_token: TOKEN, expires_in: 7200 }, { media_id: 'THUMB' }, { media_id: 'DRAFT_1' }])
    const hostile = '<section style="color:#333;position:fixed"><p onclick="x()">排好的<script>alert(1)</script></p><img src=x onerror=alert(1)><a href="javascript:alert(1)">链</a></section>'
    assert.deepEqual(await draftFromItem({ store, settings: saved, id, html: hostile, fetchImpl: impl }), { mediaId: 'DRAFT_1' })
    const content = JSON.parse(calls[2].init.body).articles[0].content
    assert.equal(content, '<section style="color: #333"><p>排好的</p>链</section>')

    ;({ impl, calls } = fakeFetch([{ media_id: 'THUMB' }, { media_id: 'DRAFT_2' }]))
    await draftFromItem({ store, settings: saved, id, fetchImpl: impl })
    assert.match(JSON.parse(calls[1].init.body).articles[0].content, /<h2 style="[^"]+">小标题<\/h2>/)

    await store.mutate('版本', (state) => { state.items.find(item => item.id === id).production.versions = { 公众号: { status: 'done', title: '公众号版标题', body: '公众号版正文', tags: [] } } })
    ;({ impl, calls } = fakeFetch([{ media_id: 'THUMB' }, { media_id: 'DRAFT_3' }]))
    await draftFromItem({ store, settings: saved, id, fetchImpl: impl })
    const article = JSON.parse(calls[1].init.body).articles[0]
    assert.equal(article.title, '公众号版标题')
    assert.match(article.content, /公众号版正文/)

    await assert.rejects(draftFromItem({ store, settings: saved, id, html: '<script>x</script><p> </p>', fetchImpl: impl }), /正文是空的/)
    await assert.rejects(draftFromItem({ store, settings: saved, id, html: { evil: 1 }, fetchImpl: impl }), /格式不对/)
  })
})

test('publishFromItem：确认后发布成功，记下链接、已发布状态，任务 ID 清掉', async () => {
  await withDesk(async ({ store, settings, id }) => {
    const saved = await settings.update({ wechat: { appId: APP_ID, appSecret: SECRET } })
    await setDraft(store, id)
    clearTokenCache()
    const { impl } = fakeFetch([
      { access_token: TOKEN, expires_in: 7200 },
      { errcode: 0, publish_id: '100' },
      { publish_id: '100', publish_status: 0, article_detail: { item: [{ idx: 1, article_url: 'https://mp.weixin.qq.com/s/ok' }] } },
    ])
    const result = await publishFromItem({ store, settings: saved, body: { id, mediaId: 'M1', confirm: true }, fetchImpl: impl, poll: { sleep: noSleep } })
    assert.equal(result.published, true)
    assert.equal(result.url, 'https://mp.weixin.qq.com/s/ok')
    const item = await row(store, id)
    assert.equal(item.publish.公众号.state, 'published')
    assert.equal(item.publish.公众号.url, 'https://mp.weixin.qq.com/s/ok')
    assert.equal(item.publish.公众号.publishId, undefined)
    assert.equal(item.status, 'published')
    // 发过的不再发第二次
    await assert.rejects(publishFromItem({ store, settings: saved, body: { id, mediaId: 'M1', confirm: true }, fetchImpl: impl }), /已经发布/)
  })
})

test('publishFromItem：等不到结果时记下任务 ID，之后只能查询不能重发；查到失败时清掉任务 ID', async () => {
  await withDesk(async ({ store, settings, id }) => {
    const saved = await settings.update({ wechat: { appId: APP_ID, appSecret: SECRET } })
    await setDraft(store, id)
    clearTokenCache()
    const { impl, calls } = fakeFetch([{ access_token: TOKEN, expires_in: 7200 }, { publish_id: '200' }, { publish_status: 1 }, { publish_status: 1 }])
    const result = await publishFromItem({ store, settings: saved, body: { id, mediaId: 'M1', confirm: true }, fetchImpl: impl, poll: { sleep: noSleep, attempts: 2 } })
    assert.equal(result.pending, true)
    assert.equal((await row(store, id)).publish.公众号.publishId, '200')
    // 有任务在等结果时，再点发布会被拒绝，也不发请求
    const before = calls.length
    await assert.rejects(publishFromItem({ store, settings: saved, body: { id, mediaId: 'M1', confirm: true }, fetchImpl: impl }), /查询发布结果/)
    assert.equal(calls.length, before)

    const { impl: status } = fakeFetch([{ publish_status: 4, fail_idx: [1] }])
    await assert.rejects(publishStatusOfItem({ store, settings: saved, body: { id }, fetchImpl: status }), /审核/)
    const item = await row(store, id)
    assert.equal(item.publish.公众号.state, 'drafted')
    assert.equal(item.publish.公众号.mediaId, 'M1')
    assert.equal(item.publish.公众号.publishId, undefined)

    // 再确认一次，这回查询拿到成功
    const { impl: again } = fakeFetch([{ publish_id: '201' }, { publish_status: 1 }])
    assert.equal((await publishFromItem({ store, settings: saved, body: { id, mediaId: 'M1', confirm: true }, fetchImpl: again, poll: { sleep: noSleep, attempts: 1 } })).pending, true)
    const { impl: ok } = fakeFetch([{ publish_status: 0, article_detail: { item: [{ article_url: 'https://mp.weixin.qq.com/s/late' }] } }])
    const done = await publishStatusOfItem({ store, settings: saved, body: { id }, fetchImpl: ok })
    assert.equal(done.published, true)
    assert.equal((await row(store, id)).publish.公众号.url, 'https://mp.weixin.qq.com/s/late')
  })
})

test('POST publish/wechat-publish：没确认、草稿对不上、没有草稿、已发布、没凭证时都拒绝，不发任何请求', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-'))
  const previous = process.env.DSH_HOME
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = async () => { fetched += 1; throw new Error('must not fetch') }
  process.env.DSH_HOME = dir
  try {
    let handler = null
    plugin.apply({
      get: name => (name === 'connection' ? { requestRejection: () => undefined } : undefined),
      effect: fn => fn(),
      webServer: { register: (options) => { handler = options.handler } },
    })
    const request = (route, body = {}, site = 'same-origin') => new Promise((resolve) => {
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end(raw) { resolve({ status: this.statusCode, body: JSON.parse(raw) }) } }
      handler({ method: 'POST', url: `/media-desk/${route}`, headers: { 'sec-fetch-site': site }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } }, res)
    })
    assert.equal((await request('publish/wechat-publish', { id: 'x', mediaId: 'M1', confirm: true }, 'cross-site')).status, 403)
    let response = await request('ops', { ops: [{ op: 'add_item', title: '稿子' }] })
    const id = response.body.receipts[0].target
    const store = new Store(join(dir, 'ip-workbench'))
    await store.mutate('成稿', (draft) => { draft.items.find(row => row.id === id).production = { status: 'done', title: '成稿', article: '正文' } })

    response = await request('publish/wechat-publish', { id, mediaId: 'M1', confirm: true })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /先推草稿/)

    await setDraft(store, id)
    for (const confirm of [undefined, false, 'true', 1, {}]) {
      response = await request('publish/wechat-publish', { id, mediaId: 'M1', confirm })
      assert.equal(response.status, 400)
      assert.match(response.body.error, /确认公开发布/)
    }
    for (const mediaId of [undefined, '', 'M2', ['M1']]) {
      response = await request('publish/wechat-publish', { id, mediaId, confirm: true })
      assert.equal(response.status, 409)
      assert.match(response.body.error, /不是当前这份草稿/)
    }
    // 没有凭证
    response = await request('publish/wechat-publish', { id, mediaId: 'M1', confirm: true })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /AppID 和 AppSecret/)

    await setDraft(store, id, { publishId: '300' })
    response = await request('publish/wechat-publish', { id, mediaId: 'M1', confirm: true })
    assert.equal(response.status, 409)
    response = await request('publish/wechat-draft', { id })
    assert.equal(response.status, 409)

    await store.mutate('发布', draft => applyOps(draft, [{ op: 'set_publish', id, platform: '公众号', state: 'published', url: 'https://mp.weixin.qq.com/s/x', mediaId: 'M1' }]))
    response = await request('publish/wechat-publish', { id, mediaId: 'M1', confirm: true })
    assert.equal(response.status, 409)
    assert.match(response.body.error, /已经发布/)

    response = await request('publish/wechat-status', { id })
    assert.equal(response.status, 400)
    assert.equal((await request('publish/wechat-cancel', { id })).body.stopped, false)
    assert.equal(fetched, 0)
  } finally {
    globalThis.fetch = realFetch
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('set_publish：公众号草稿 ID 和发布任务 ID 只在给了的时候记，格式不对拒绝', () => {
  const state = buildSeed(new Date())
  const id = applyOps(state, [{ op: 'add_item', title: '稿子' }]).receipts[0].target
  const item = () => state.items.find(row => row.id === id)
  assert.deepEqual(applyOps(state, [{ op: 'set_publish', id, platform: '公众号', state: 'drafted', mediaId: 'bad id!' }]).errors.length, 1)
  applyOps(state, [{ op: 'set_publish', id, platform: '公众号', state: 'drafted', mediaId: 'Abc_-1' }])
  assert.equal(item().publish.公众号.mediaId, 'Abc_-1')
  applyOps(state, [{ op: 'set_publish', id, platform: '公众号', state: 'published', url: 'https://a.com' }])
  assert.deepEqual(Object.keys(item().publish.公众号).sort(), ['at', 'state', 'url'])
})
