import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import plugin from '../src/host.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { publicSettings, Settings } from '../src/settings.js'
import { Store } from '../src/store.js'
import { articleDigest, articleHtml, pushDraft, wechatError, clearTokenCache } from '../src/wechat.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')
const APP_ID = 'wx0123456789abcdef'
const SECRET = 'fakesecret0123456789abcdef012345'
const TOKEN = 'FAKE_TOKEN_abc'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function seedItem() {
  const state = buildSeed(NOW)
  const { receipts } = applyOps(state, [{ op: 'add_item', title: '我的稿子' }])
  return { state, id: receipts[0].target }
}

test('set_publish 记录平台状态、时间和链接，只放行白名单字段', () => {
  const { state, id } = seedItem()
  const { receipts, errors } = applyOps(state, [{ op: 'set_publish', id, platform: '小红书', state: 'published', url: 'https://www.xiaohongshu.com/explore/1', evil: 1 }])
  assert.deepEqual(errors, [])
  assert.equal(receipts.length, 1)
  const row = state.items.find(item => item.id === id).publish.小红书
  assert.deepEqual(Object.keys(row).sort(), ['at', 'state', 'url'])
  assert.equal(row.state, 'published')
  assert.equal(row.url, 'https://www.xiaohongshu.com/explore/1')
  assert.ok(!Number.isNaN(Date.parse(row.at)))

  applyOps(state, [{ op: 'set_publish', id, platform: '知乎', state: 'copied' }])
  assert.equal(state.items.find(item => item.id === id).publish.知乎.url, null)
  applyOps(state, [{ op: 'set_publish', id, platform: '知乎', state: null }])
  assert.deepEqual(Object.keys(state.items.find(item => item.id === id).publish), ['小红书'])
})

test('set_publish 拒绝未知平台、状态和非 http 链接', () => {
  const { state, id } = seedItem()
  const { receipts, errors } = applyOps(state, [
    { op: 'set_publish', id, platform: '微博', state: 'copied' },
    { op: 'set_publish', id, platform: '公众号', state: 'live' },
    { op: 'set_publish', id, platform: '公众号', state: 'published', url: 'javascript:alert(1)' },
    { op: 'set_publish', id, platform: '__proto__', state: 'copied' },
    { op: 'set_publish', id: 'nope', platform: '公众号', state: 'copied' },
  ])
  assert.equal(receipts.length, 0)
  assert.equal(errors.length, 5)
  assert.equal(state.items.find(item => item.id === id).publish, undefined)
})

test('set_publish 可以撤销', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-'))
  try {
    const store = new Store(dir, { samples: false })
    const id = await store.mutate('add', s => applyOps(s, [{ op: 'add_item', title: '稿子' }]).receipts[0].target)
    await store.mutate('publish', s => applyOps(s, [{ op: 'set_publish', id, platform: '公众号', state: 'copied' }, { op: 'set_status', id, status: 'published' }]))
    let item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.publish.公众号.state, 'copied')
    assert.equal(item.status, 'published')
    assert.equal(await store.undoLast(), 'publish')
    item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.publish, undefined)
    assert.equal(item.status, 'idea')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

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

test('pushDraft：换 token → 传封面 → 建草稿，地址和内容都对', async () => {
  clearTokenCache()
  const { impl, calls } = fakeFetch([
    { access_token: TOKEN, expires_in: 7200 },
    { media_id: 'THUMB_1', url: 'http://mmbiz.qpic.cn/x' },
    { media_id: 'DRAFT_1' },
  ])
  const article = '## 小标题\n\n第一段 **重点** <script>alert(1)</script>\n\n- 一\n- 二\n\n> 引用\n\n![图](files/a.png)'
  const result = await pushDraft({ appId: APP_ID, appSecret: SECRET, author: '示例作者' }, { title: '标题', html: articleHtml(article), digest: articleDigest(article), cover: PNG }, impl)
  assert.deepEqual(result, { mediaId: 'DRAFT_1' })
  assert.equal(calls.length, 3)

  const token = new URL(calls[0].url)
  assert.equal(`${token.origin}${token.pathname}`, 'https://api.weixin.qq.com/cgi-bin/stable_token')
  // 密钥放在请求体里，不出现在地址上
  assert.equal(token.search, '')
  assert.deepEqual(JSON.parse(calls[0].init.body), { grant_type: 'client_credential', appid: APP_ID, secret: SECRET, force_refresh: false })
  assert.equal(calls[0].init.method, 'POST')

  const upload = new URL(calls[1].url)
  assert.equal(`${upload.origin}${upload.pathname}`, 'https://api.weixin.qq.com/cgi-bin/material/add_material')
  assert.equal(upload.searchParams.get('access_token'), TOKEN)
  assert.equal(upload.searchParams.get('type'), 'image')
  assert.equal(calls[1].init.method, 'POST')
  const media = calls[1].init.body.get('media')
  assert.equal(media.type, 'image/png')
  assert.equal(media.name, 'cover.png')
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), PNG)

  const draft = new URL(calls[2].url)
  assert.equal(`${draft.origin}${draft.pathname}`, 'https://api.weixin.qq.com/cgi-bin/draft/add')
  assert.equal(draft.searchParams.get('access_token'), TOKEN)
  const payload = JSON.parse(calls[2].init.body)
  assert.equal(payload.articles.length, 1)
  const [row] = payload.articles
  assert.equal(row.title, '标题')
  assert.equal(row.author, '示例作者')
  assert.equal(row.thumb_media_id, 'THUMB_1')
  assert.equal(row.digest, '第一段 重点 <script>alert(1)</script> 一 二 引用')
  assert.match(row.content, /<h2 style="[^"]+">小标题<\/h2>/)
  assert.match(row.content, /<strong style="[^"]+">重点<\/strong>/)
  assert.match(row.content, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(row.content, /<script>/)
  assert.match(row.content, /<ul style="[^"]+"><li style="[^"]+">一<\/li><li style="[^"]+">二<\/li><\/ul>/)
  assert.match(row.content, /<blockquote style="[^"]+">引用<\/blockquote>/)
  assert.doesNotMatch(row.content, /files\/a\.png/)
  assert.ok(!calls[2].init.body.includes(SECRET))
})

test('wechatError 把错误码翻成人话；40164 带上 IP 和白名单提示', () => {
  const ip = wechatError({ errcode: 40164, errmsg: 'invalid ip 203.0.113.7 ipv6 ::ffff:203.0.113.7, not in whitelist rid: 1' })
  assert.match(ip.message, /203\.0\.113\.7/)
  assert.match(ip.message, /IP 白名单/)
  assert.equal(ip.status, 502)
  assert.match(wechatError({ errcode: 40125, errmsg: 'invalid appsecret' }).message, /AppSecret/)
  assert.match(wechatError({ errcode: 40001, errmsg: 'x' }).message, /AppSecret/)
  assert.match(wechatError({ errcode: 48001, errmsg: 'api unauthorized' }).message, /权限/)
  const unknown = wechatError({ errcode: 99999, errmsg: `oops ${SECRET}` }, [SECRET])
  assert.match(unknown.message, /99999/)
  assert.ok(!unknown.message.includes(SECRET))
})

test('pushDraft 失败时错误里没有密钥和令牌', async () => {
  clearTokenCache()
  const { impl } = fakeFetch([{ errcode: 40164, errmsg: 'invalid ip 198.51.100.2 ipv6 ::ffff:198.51.100.2, not in whitelist' }])
  await assert.rejects(pushDraft({ appId: APP_ID, appSecret: SECRET }, { title: 't', html: '<p>x</p>', digest: '', cover: PNG }, impl), (err) => {
    assert.match(err.message, /198\.51\.100\.2/)
    assert.ok(!err.message.includes(SECRET))
    return true
  })
  clearTokenCache()
  const failing = async () => { throw new Error(`connect failed ${TOKEN}`) }
  const { impl: tokenOk } = fakeFetch([{ access_token: TOKEN }])
  let first = true
  await assert.rejects(pushDraft({ appId: APP_ID, appSecret: SECRET }, { title: 't', html: '', digest: '', cover: PNG }, async (url, init) => {
    if (first) { first = false; return tokenOk(url, init) }
    return failing()
  }), (err) => {
    assert.ok(!err.message.includes(TOKEN))
    return true
  })
  // webp 不上传
  const { impl: webp, calls } = fakeFetch([{ access_token: TOKEN }])
  await assert.rejects(pushDraft({ appId: APP_ID, appSecret: SECRET }, { title: 't', html: '', digest: '', cover: Buffer.from('RIFF0000WEBPVP8 ') }, webp), /JPG、PNG、GIF/)
  assert.equal(calls.length, 1)
})

test('公众号凭证：AppSecret 存在 600 的文件里，从不出现在 publicSettings 里', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-'))
  try {
    const settings = new Settings(dir)
    const before = publicSettings(await settings.read())
    assert.deepEqual(before.wechat, { appId: '', author: '', hasSecret: false })
    const saved = await settings.update({ wechat: { appId: ` ${APP_ID} `, appSecret: SECRET, author: '示例作者' } })
    assert.equal(saved.wechat.appSecret, SECRET)
    assert.equal((await stat(settings.file)).mode & 0o777, 0o600)
    const shown = publicSettings(saved)
    assert.deepEqual(shown.wechat, { appId: APP_ID, author: '示例作者', hasSecret: true })
    assert.ok(!JSON.stringify(shown).includes(SECRET))
    // 空密钥表示不修改
    assert.equal((await settings.update({ wechat: { appSecret: '' } })).wechat.appSecret, SECRET)
    await assert.rejects(settings.update({ wechat: { appId: 'not-an-app-id' } }), /AppID/)
    await assert.rejects(settings.update({ wechat: { appSecret: 'has spaces and <tags>' } }), /AppSecret/)
    assert.equal((await settings.update({ wechat: { clearSecret: true } })).wechat.appSecret, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('POST publish/wechat-draft：没有成稿、没有凭证、没有封面时都拒绝，不发任何请求', async () => {
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
    const request = (method, route, body = {}) => new Promise((resolve) => {
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end(raw) { resolve({ status: this.statusCode, body: JSON.parse(raw) }) } }
      handler({ method, url: `/media-desk/${route}`, headers: { 'sec-fetch-site': 'same-origin' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } }, res)
    })
    // 跨站请求直接拒绝
    const cross = await new Promise((resolve) => {
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end(raw) { resolve({ status: this.statusCode, body: JSON.parse(raw) }) } }
      handler({ method: 'POST', url: '/media-desk/publish/wechat-draft', headers: { 'sec-fetch-site': 'cross-site' }, async *[Symbol.asyncIterator]() { yield Buffer.from('{}') } }, res)
    })
    assert.equal(cross.status, 403)

    let response = await request('POST', 'publish/wechat-draft', {})
    assert.equal(response.status, 400)
    response = await request('POST', 'ops', { ops: [{ op: 'add_item', title: '没成稿的灵感' }] })
    const id = response.body.receipts[0].target
    response = await request('POST', 'publish/wechat-draft', { id })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /还没有成稿/)

    // 另一个进程写入一篇成稿（和桌面版、Web 版共用数据的方式一样）
    const store = new Store(join(dir, 'ip-workbench'))
    await store.mutate('成稿', (draft) => {
      draft.items.find(row => row.id === id).production = { status: 'done', title: '成稿标题', article: '正文', cover: { src: 'media-desk/files/cover_test.png' } }
    })
    response = await request('POST', 'publish/wechat-draft', { id })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /AppID 和 AppSecret/)

    response = await request('POST', 'settings', { wechat: { appId: APP_ID, appSecret: SECRET } })
    assert.equal(response.status, 200)
    assert.equal(response.body.wechat.hasSecret, true)
    assert.ok(!JSON.stringify(response.body).includes(SECRET))
    response = await request('GET', 'settings')
    assert.ok(!JSON.stringify(response.body).includes(SECRET))

    // 封面文件不在磁盘上
    response = await request('POST', 'publish/wechat-draft', { id })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /封面文件找不到/)
    // 封面是 webp
    await writeFile(join(dir, 'ip-workbench', 'files', 'cover_test.png'), Buffer.from('RIFF0000WEBPVP8 '))
    response = await request('POST', 'publish/wechat-draft', { id })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /JPG、PNG、GIF/)
    assert.equal(fetched, 0)
  } finally {
    globalThis.fetch = realFetch
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
