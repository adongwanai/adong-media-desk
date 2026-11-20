// 提醒推送：只在开启后发、每个平台每天最多一条、失败不重试、发出去的内容里不带稿子正文和账号数据。
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildNotice, cleanWebhook, pendingNotices, pushAttention } from '../src/notify.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'

const NOW = new Date('2026-11-17T02:00:00.000Z')

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'md-notify-'))
  const root = join(dir, 'media-desk')
  const store = new Store(root)
  await store.read()
  return fn(store, dir)
}

/** 一轮读取后记进 autoRead.attention 的内容。 */
function attention(platform, extra = {}) {
  return { platform, reason: '页面上的数字没认出来 https://www.xiaohongshu.com/user/profile/abc', needLogin: false, at: NOW.toISOString(), ...extra }
}

test('cleanWebhook：只收 http(s)，带账号密码段的不要', () => {
  assert.equal(cleanWebhook('https://example.com/hook'), 'https://example.com/hook')
  assert.equal(cleanWebhook('  http://10.0.0.2:8080/hook  '), 'http://10.0.0.2:8080/hook')
  assert.equal(cleanWebhook('https://user:pass@example.com/hook'), null)
  assert.equal(cleanWebhook('ftp://example.com/hook'), null)
  assert.equal(cleanWebhook('example.com/hook'), null)
  assert.equal(cleanWebhook(''), null)
})

test('buildNotice：只有平台、原因和时间，不转发读取时的报错原文（里面可能带主页地址）', () => {
  const notice = buildNotice(attention('小红书'))
  assert.deepEqual(Object.keys(notice).sort(), ['at', 'text', 'title'])
  assert.match(notice.title, /小红书/)
  assert.match(notice.text, /连着几次自动读取都没读到数据/)
  assert.doesNotMatch(JSON.stringify(notice), /xiaohongshu\.com|abc/)
  const login = buildNotice(attention('抖音', { needLogin: true }))
  assert.match(login.text, /需要重新登录/)
})

test('pushAttention：关着、或者没填地址时一条都不发', async () => {
  await withStore(async (store) => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      return { ok: true }
    }
    await store.mutate('', draft => (draft.autoRead = { attention: [attention('小红书')] }, draft), { undoable: false })
    assert.deepEqual(await pushAttention({ store, settings: { notify: { enabled: false, webhook: 'https://example.com/hook' } }, fetchImpl, now: () => NOW }), { sent: 0, failed: 0 })
    assert.deepEqual(await pushAttention({ store, settings: { notify: { enabled: true, webhook: '' } }, fetchImpl, now: () => NOW }), { sent: 0, failed: 0 })
    assert.equal(calls, 0)
  })
})

test('pushAttention：一天一条——同一天再跑不再发，第二天可以再发', async () => {
  await withStore(async (store) => {
    const sent = []
    const fetchImpl = async (url, init) => {
      sent.push(JSON.parse(init.body))
      return { ok: true }
    }
    const settings = { notify: { enabled: true, webhook: 'https://example.com/hook' } }
    await store.mutate('', draft => (draft.autoRead = { attention: [attention('小红书')] }, draft), { undoable: false })
    assert.deepEqual(await pushAttention({ store, settings, fetchImpl, now: () => NOW }), { sent: 1, failed: 0 })
    // 同一天又读了一轮，attention 还在：不再发
    assert.deepEqual(await pushAttention({ store, settings, fetchImpl, now: () => NOW }), { sent: 0, failed: 0 })
    // 同一个平台的另一条（比如早上要登录、傍晚又没读到）：同一天也不发
    await store.mutate('', draft => (draft.autoRead = { attention: [attention('小红书'), attention('小红书')] }, draft), { undoable: false })
    assert.deepEqual(await pushAttention({ store, settings, fetchImpl, now: () => NOW }), { sent: 0, failed: 0 })
    assert.equal(sent.length, 1)
    // 第二天：重新可以发
    const tomorrow = new Date('2026-11-18T02:00:00.000Z')
    await store.mutate('', draft => (draft.autoRead = { attention: [attention('小红书', { at: tomorrow.toISOString() })] }, draft), { undoable: false })
    assert.deepEqual(await pushAttention({ store, settings, fetchImpl, now: () => tomorrow }), { sent: 1, failed: 0 })
    assert.equal(sent.length, 2)
  })
})

test('pushAttention：多个平台各发一条；前几天的旧提醒不再发', async () => {
  await withStore(async (store) => {
    const sent = []
    const fetchImpl = async (url, init) => {
      sent.push(JSON.parse(init.body))
      return { ok: true }
    }
    const old = { ...attention('B站'), at: '2026-11-15T02:00:00.000Z' }
    await store.mutate('', draft => (draft.autoRead = { attention: [attention('小红书'), attention('抖音', { needLogin: true }), old] }, draft), { undoable: false })
    assert.deepEqual(await pushAttention({ store, settings: { notify: { enabled: true, webhook: 'https://example.com/hook' } }, fetchImpl, now: () => NOW }), { sent: 2, failed: 0 })
    assert.deepEqual(sent.map(row => row.text.split('：')[0]), ['小红书', '抖音'])
  })
})

test('pushAttention：发失败不重试，也不会把地址和报错写进状态', async () => {
  await withStore(async (store) => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      throw new Error('connect ECONNREFUSED https://example.com/hook')
    }
    const settings = { notify: { enabled: true, webhook: 'https://example.com/hook' } }
    await store.mutate('', draft => (draft.autoRead = { attention: [attention('小红书')] }, draft), { undoable: false })
    assert.deepEqual(await pushAttention({ store, settings, fetchImpl, now: () => NOW }), { sent: 0, failed: 1 })
    // 失败也不重试：同一天再跑不发；第二天那次是新一轮，不是重试
    assert.deepEqual(await pushAttention({ store, settings, fetchImpl, now: () => NOW }), { sent: 0, failed: 0 })
    assert.equal(calls, 1)
    const state = await store.read()
    // 状态里只记「今天哪个平台推过了」：没有地址，也没有读取时的报错（示例内容里的 example.com 不算）
    assert.deepEqual(state.notified, { day: '2026-11-17', platforms: ['小红书'] })
    assert.deepEqual(Object.keys(state.notified).sort(), ['day', 'platforms'])
    assert.doesNotMatch(JSON.stringify(state.notified), /example\.com|ECONNREFUSED|hook/)
  })
})

test('pendingNotices：没发布时间的不推，同一个平台只留一条', () => {
  const list = pendingNotices({ attention: [{ platform: '小红书', needLogin: true, at: NOW.toISOString() }, { platform: '小红书', at: NOW.toISOString() }, { platform: '抖音', at: '' }], now: NOW })
  assert.deepEqual(list.map(row => row.platform), ['小红书'])
})

test('设置：Webhook 地址不出现在发给浏览器的设置里；删掉地址时一起关掉推送', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md-notify-settings-'))
  const settings = new Settings(dir)
  await settings.read()
  await settings.update({ notify: { webhook: 'https://example.com/hook', enabled: true } })
  const { publicSettings } = await import('../src/settings.js')
  const shown = publicSettings(await settings.read())
  assert.equal(shown.notify.webhook, undefined)
  assert.deepEqual(shown.notify, { enabled: true, hasWebhook: true })
  assert.doesNotMatch(JSON.stringify(shown), /example\.com/)
  await assert.rejects(settings.update({ notify: { webhook: 'nope' } }))
  await settings.update({ notify: { clearWebhook: true } })
  assert.deepEqual((await settings.read()).notify, { enabled: false, webhook: '' })
})
