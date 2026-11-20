import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { test } from 'node:test'
import { ExtensionBridge, acceptableUpgrade, readFrames } from '../src/wechatsync.js'
import { checkSync, syncContent, syncDrafts, syncErrorMessage } from '../src/sync-drafts.js'

const TOKEN = 'tok-0123456789'
const SETTINGS = { wechatsync: { token: TOKEN } }
const EXT_ORIGIN = `chrome-extension://${'a'.repeat(32)}`

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

function maskedFrame(text) {
  const payload = Buffer.from(text)
  const mask = randomBytes(4)
  const head = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255])
  const body = Buffer.from(payload)
  for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i & 3]
  return Buffer.concat([head, mask, body])
}

/** 测试里的假扩展：按协议握手，收到请求后交给 reply 处理。 */
function fakeExtension(port, { origin = EXT_ORIGIN, host = `localhost:${port}`, reply } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    const key = randomBytes(16).toString('base64')
    const seen = []
    let buffer = Buffer.alloc(0)
    let open = false
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!open) {
        const end = buffer.indexOf('\r\n\r\n')
        if (end < 0) return
        const head = buffer.subarray(0, end).toString()
        buffer = buffer.subarray(end + 4)
        if (!head.startsWith('HTTP/1.1 101')) { resolve({ status: head.split(' ')[1], socket }); socket.destroy(); return }
        const expected = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC11B85`).digest('base64')
        assert.match(head, new RegExp(`Sec-WebSocket-Accept: ${expected.replace(/[+/=]/g, ch => `\\${ch}`)}`))
        open = true
        resolve({ status: '101', socket, seen })
      }
      // 服务端发来的帧不带掩码
      while (buffer.length >= 2) {
        let length = buffer[1] & 0x7f
        let offset = 2
        if (length === 126) { length = buffer.readUInt16BE(2); offset = 4 } else if (length === 127) { length = Number(buffer.readBigUInt64BE(2)); offset = 10 }
        if (buffer.length < offset + length) break
        const message = JSON.parse(buffer.subarray(offset, offset + length).toString())
        buffer = buffer.subarray(offset + length)
        seen.push(message)
        const response = message.token !== TOKEN ? { id: message.id, error: { code: 403, message: 'Invalid or missing token' } } : { id: message.id, ...reply(message) }
        socket.write(maskedFrame(JSON.stringify(response)))
      }
    })
    socket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${origin ? `Origin: ${origin}\r\n` : ''}\r\n`)
  })
}

const PLATFORMS = [
  { id: 'zhihu', name: '知乎', isAuthenticated: true, username: '示例作者' },
  { id: 'bilibili', name: 'B站', isAuthenticated: false },
  { id: 'juejin', name: '掘金', isAuthenticated: true, username: 'x' },
]

function extensionReply(message) {
  if (message.method === 'listPlatforms') return { result: PLATFORMS }
  if (message.method === 'syncArticle') {
    const [platform] = message.params.platforms
    if (platform === 'bilibili') return { result: { results: [{ platform, success: false, error: '未登录' }] } }
    return { result: { results: [{ platform, success: true, postUrl: 'https://zhuanlan.zhihu.com/p/1/edit', draftOnly: true }] } }
  }
  return { error: { code: -1, message: 'Unknown method' } }
}

const item = {
  id: 'i1',
  title: '灵感',
  production: {
    status: 'done', title: '母稿标题', article: '母稿正文\n\n![图](media-desk/files/a.png)',
    versions: { 知乎: { status: 'done', title: '知乎版标题', body: '知乎版正文\n![配图](media-desk/files/b.png)', tags: [] } },
  },
}

test('握手只接受浏览器扩展：网页来源、缺来源、错的 Host 都拒绝', async () => {
  const port = await freePort()
  const bridge = new ExtensionBridge({ wsPort: port, relayPort: await freePort() })
  try {
    assert.equal(await bridge.start(), 'own')
    assert.equal(bridge.server.address().address, '127.0.0.1')
    for (const options of [{ origin: 'https://evil.example' }, { origin: '' }, { origin: 'chrome-extension://short' }, { host: `evil.example:${port}` }]) {
      const { status } = await fakeExtension(port, { ...options, reply: extensionReply })
      assert.equal(status, '403')
    }
    assert.equal(bridge.connected(), false)
    assert.equal(acceptableUpgrade({ upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', origin: EXT_ORIGIN, host: `127.0.0.1:${port}` }, port), true)
  } finally {
    bridge.close()
  }
})

test('readFrames：不带掩码的客户端帧和超大帧都拒绝', () => {
  assert.equal(readFrames(Buffer.from([0x81, 0x02, 0x68, 0x69])).error, 'unmasked')
  const huge = Buffer.alloc(10)
  huge[0] = 0x81
  huge[1] = 0x80 | 127
  huge.writeBigUInt64BE(BigInt(1) << BigInt(40), 2)
  assert.equal(readFrames(huge).error, 'too-large')
  const { frames, rest } = readFrames(maskedFrame('{"id":"1"}'))
  assert.equal(frames[0].payload.toString(), '{"id":"1"}')
  assert.equal(rest.length, 0)
})

test('检测连接和同步草稿：消息带 Token，按平台用版本或母稿，结果带草稿链接', async () => {
  const port = await freePort()
  const bridge = new ExtensionBridge({ wsPort: port, relayPort: await freePort() })
  try {
    await bridge.start()
    const ext = await fakeExtension(port, { reply: extensionReply })
    assert.equal(ext.status, '101')
    const status = await checkSync({ bridge, settings: SETTINGS, waitMs: 2000 })
    assert.equal(status.reachable, true)
    assert.equal(status.mode, 'own')
    assert.deepEqual(status.platforms.map(row => [row.id, row.loggedIn, row.workbench]), [['zhihu', true, '知乎'], ['bilibili', false, 'B站'], ['juejin', true, null]])

    const results = await syncDrafts({ bridge, settings: SETTINGS, item, platforms: ['知乎', 'B站'] })
    assert.deepEqual(results.map(row => [row.platform, row.ok, row.url, row.from]), [['知乎', true, 'https://zhuanlan.zhihu.com/p/1/edit', 'version'], ['B站', false, null, 'mother']])
    assert.equal(results[1].error, '未登录')
    const sync = ext.seen.filter(row => row.method === 'syncArticle')
    assert.equal(sync.length, 2)
    assert.deepEqual(sync[0].params, { platforms: ['zhihu'], article: { title: '知乎版标题', markdown: '知乎版正文' } })
    assert.deepEqual(sync[1].params, { platforms: ['bilibili'], article: { title: '母稿标题', markdown: '母稿正文' } })
    assert.ok(ext.seen.every(row => row.token === TOKEN))

    // Token 不对：扩展回 403，翻成人话，Token 不出现在错误里
    const wrong = await checkSync({ bridge, settings: { wechatsync: { token: 'other-token' } }, waitMs: 1000 })
    assert.equal(wrong.reachable, false)
    assert.match(wrong.message, /不一致/)
    assert.ok(!wrong.message.includes('other-token'))

    // 没核实过只存草稿的平台不放行，也不发请求
    const before = ext.seen.length
    await assert.rejects(syncDrafts({ bridge, settings: SETTINGS, item, platforms: ['头条'] }), /不支持同步草稿/)
    await assert.rejects(syncDrafts({ bridge, settings: SETTINGS, item, platforms: [] }), /至少选一个/)
    await assert.rejects(syncDrafts({ bridge, settings: {}, item, platforms: ['知乎'] }), /Token/)
    assert.equal(ext.seen.length, before)
    ext.socket.destroy()
  } finally {
    bridge.close()
  }
})

test('扩展没连上时检测连接说清楚原因；没填 Token 时直接拒绝', async () => {
  const port = await freePort()
  const bridge = new ExtensionBridge({ wsPort: port, relayPort: await freePort() })
  try {
    const status = await checkSync({ bridge, settings: SETTINGS, waitMs: 200 })
    assert.equal(status.reachable, false)
    assert.match(status.message, /MCP 连接/)
    await assert.rejects(checkSync({ bridge, settings: { wechatsync: { token: '' } } }), /Token/)
  } finally {
    bridge.close()
  }
})

test('9527 被 Wechatsync 自己占着时走 127.0.0.1 的转发口；转发口跳转不跟随', async () => {
  const wsPort = await freePort()
  const relayPort = await freePort()
  const squatter = net.createServer(socket => socket.destroy())
  await new Promise(resolve => squatter.listen(wsPort, '127.0.0.1', resolve))
  const requests = []
  let redirect = false
  const relay = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body })
      if (redirect) { res.writeHead(302, { location: 'http://127.0.0.1:1/evil' }); res.end('{}'); return }
      res.setHeader('content-type', 'application/json')
      if (req.url === '/status') { res.end(JSON.stringify({ connected: true, mode: 'primary' })); return }
      const { method } = JSON.parse(body)
      res.end(JSON.stringify({ result: method === 'listPlatforms' ? PLATFORMS : { results: [{ platform: 'zhihu', success: true, postUrl: 'https://zhuanlan.zhihu.com/p/2/edit' }] } }))
    })
  })
  await new Promise(resolve => relay.listen(relayPort, '127.0.0.1', resolve))
  const bridge = new ExtensionBridge({ wsPort, relayPort })
  try {
    const status = await checkSync({ bridge, settings: SETTINGS, waitMs: 200 })
    assert.equal(status.mode, 'relay')
    assert.equal(status.reachable, true)
    const results = await syncDrafts({ bridge, settings: SETTINGS, item, platforms: ['知乎'] })
    assert.equal(results[0].url, 'https://zhuanlan.zhihu.com/p/2/edit')
    const posted = requests.filter(row => row.url === '/request').map(row => JSON.parse(row.body))
    assert.deepEqual(posted.map(row => row.method), ['listPlatforms', 'syncArticle'])
    // 走转发口时不把自己的 Token 交给别的程序
    assert.ok(requests.every(row => !row.body.includes(TOKEN)))

    redirect = true
    const count = requests.length
    const blocked = await checkSync({ bridge, settings: SETTINGS, waitMs: 200 })
    assert.equal(blocked.reachable, false)
    assert.equal(requests.length, count + 1)
  } finally {
    bridge.close()
    squatter.close()
    relay.close()
  }
})

test('syncContent 和 syncErrorMessage', () => {
  assert.deepEqual(syncContent(item, 'B站'), { from: 'mother', title: '母稿标题', markdown: '母稿正文' })
  assert.match(syncErrorMessage({ code: 401, message: 'MCP token not configured' }), /MCP 连接/)
  assert.match(syncErrorMessage({ code: 'extension', message: 'Invalid or missing token' }), /不一致/)
  assert.ok(!syncErrorMessage({ code: -1, message: `boom ${TOKEN}` }, TOKEN).includes(TOKEN))
})
