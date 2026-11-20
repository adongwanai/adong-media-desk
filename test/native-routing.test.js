import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import plugin from '../src/host.js'

test('没有原生宿主时所有对话与成稿请求明确拒绝，不降级也不写假回复', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-routing-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const cleanup = []
  let handler
  try {
    plugin.apply({
      get: name => name === 'connection' ? { requestRejection: () => undefined } : null,
      effect: fn => { const stop = fn(); if (typeof stop === 'function') cleanup.push(stop) },
      webServer: { register: options => { handler = options.handler } },
    })
    const request = (path, body) => new Promise((resolve, reject) => {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
      Object.assign(req, { method: body ? 'POST' : 'GET', url: `/media-desk/${path}`, headers: {} })
      const res = { headersSent: false, statusCode: 0, setHeader() {}, end: data => resolve({ status: res.statusCode, data: JSON.parse(data) }) }
      handler(req, res).catch(reject)
    })
    const before = await request('state')
    assert.equal(before.data.nativeAgent, false)
    for (const body of [{ message: '你好' }, { message: '改稿', focusId: 'topic' }]) {
      const result = await request('chat', body)
      assert.equal(result.status, 503)
      assert.match(result.data.error, /未连接 DSH 原生 Agent/)
    }
    assert.equal((await request('produce', { id: 'topic' })).status, 503)
    assert.deepEqual((await request('state')).data.state.chat, before.data.state.chat)
  } finally {
    for (const stop of cleanup) stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})
