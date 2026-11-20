// Wechatsync 浏览器扩展的本地桥（Wechatsync：https://github.com/wechatsync/Wechatsync ，GPL-3.0；这里只按它公开的本地协议通信，不含它的代码）。
// 协议见它仓库里的 packages/mcp-server/src/ws-bridge.ts 和 packages/extension/src/mcp/client.ts：
// 扩展是 WebSocket 客户端，开启「MCP 连接」后主动去连 ws://localhost:9527；本地程序在 9527 上等它，
// 每条请求是 {id, method, token, params}，扩展核对 token 后回 {id, result} 或 {id, error: {code, message}}。
// 9527 已经被 Wechatsync 自己的命令行或 MCP 服务占着时，那边在 9528 上开了 HTTP 转发口（GET /status、POST /request），这时改走转发口。
// 这是工作台里唯一一处故意碰本机地址的代码：只在 127.0.0.1 的这两个固定端口上监听或连接，不接受任何外部传来的地址，不跟随跳转。
import { createHash } from 'node:crypto'
import http from 'node:http'

export const BRIDGE_HOST = '127.0.0.1'
export const WS_PORT = 9527
export const RELAY_PORT = 9528
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC11B85'
const MAX_MESSAGE = 8 * 1024 * 1024
const MAX_RELAY_BODY = 8 * 1024 * 1024
// 一段时间不用就把端口让出来，免得占着 Wechatsync 自己命令行要用的 9527
const IDLE_MS = 10 * 60_000

function bridgeError(message, code) {
  return Object.assign(new Error(message), { code })
}

/** 服务端发给浏览器扩展的帧：不加掩码。 */
function frame(opcode, payload) {
  const length = payload.length
  let header
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length])
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return Buffer.concat([header, payload])
}

/**
 * 从缓冲区里切出完整的帧。客户端发来的帧必须带掩码；单帧或拼起来的消息超过上限就断开。
 * @returns {{frames: Array<{fin: boolean, opcode: number, payload: Buffer}>, rest: Buffer, error?: string}}
 */
export function readFrames(buffer) {
  const frames = []
  let offset = 0
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset]
    const b1 = buffer[offset + 1]
    let length = b1 & 0x7f
    let head = 2
    if (length === 126) {
      if (buffer.length - offset < 4) break
      length = buffer.readUInt16BE(offset + 2)
      head = 4
    } else if (length === 127) {
      if (buffer.length - offset < 10) break
      const big = buffer.readBigUInt64BE(offset + 2)
      if (big > BigInt(MAX_MESSAGE)) return { frames, rest: Buffer.alloc(0), error: 'too-large' }
      length = Number(big)
      head = 10
    }
    if (!(b1 & 0x80)) return { frames, rest: Buffer.alloc(0), error: 'unmasked' }
    if (length > MAX_MESSAGE) return { frames, rest: Buffer.alloc(0), error: 'too-large' }
    if (buffer.length - offset < head + 4 + length) break
    const mask = buffer.subarray(offset + head, offset + head + 4)
    const payload = Buffer.from(buffer.subarray(offset + head + 4, offset + head + 4 + length))
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3]
    frames.push({ fin: Boolean(b0 & 0x80), opcode: b0 & 0x0f, payload })
    offset += head + 4 + length
  }
  return { frames, rest: buffer.subarray(offset) }
}

/** 只认浏览器扩展发起的连接：网页不能伪造 Origin，网页里的脚本因此连不上这里拿 Token。 */
export function acceptableUpgrade(headers, port) {
  const origin = String(headers.origin ?? '')
  const host = String(headers.host ?? '').toLowerCase()
  const key = String(headers['sec-websocket-key'] ?? '')
  return String(headers.upgrade ?? '').toLowerCase() === 'websocket'
    && String(headers['sec-websocket-version'] ?? '') === '13'
    && /^[A-Za-z0-9+/]{22}==$/.test(key)
    && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    && (host === `localhost:${port}` || host === `${BRIDGE_HOST}:${port}`)
}

/**
 * 只连 127.0.0.1 固定端口的 HTTP 请求，用于 Wechatsync 自己占着 9527 时走它的 9528 转发口。
 * 地址和端口都由本文件决定；3xx 一律当失败，不跟随。
 */
function relayCall(port, method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      host: BRIDGE_HOST,
      port,
      path,
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
      timeout: timeoutMs,
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_RELAY_BODY) { req.destroy(); reject(bridgeError('relay response too large', 'relay')) } else chunks.push(chunk)
      })
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400) return reject(bridgeError('relay redirect refused', 'relay'))
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch {
          reject(bridgeError('relay returned non-JSON', 'relay'))
        }
      })
    })
    req.on('timeout', () => req.destroy(bridgeError('relay timeout', 'timeout')))
    req.on('error', err => reject(err?.code === 'timeout' ? err : bridgeError(err?.message ?? 'relay error', err?.code === 'ECONNREFUSED' ? 'relay-down' : 'relay')))
    req.end(payload ?? undefined)
  })
}

/**
 * 和扩展之间的连接。用到时才在 127.0.0.1:9527 上监听，闲置一段时间后自动让出端口。
 * 端口参数只给测试用；工作台里始终用默认的 9527 / 9528。
 */
export class ExtensionBridge {
  constructor({ wsPort = WS_PORT, relayPort = RELAY_PORT, idleMs = IDLE_MS } = {}) {
    this.wsPort = wsPort
    this.relayPort = relayPort
    this.idleMs = idleMs
    this.server = null
    this.socket = null
    this.mode = null
    this.pending = new Map()
    this.waiters = new Set()
    this.idleTimer = null
    this.seq = 0
  }

  /** 开始监听；端口被 Wechatsync 自己的程序占着时改走它的转发口。返回 'own' 或 'relay'。 */
  async start() {
    this.touch()
    if (this.server) return this.mode
    const server = http.createServer((req, res) => {
      res.statusCode = 426
      res.end()
    })
    server.on('upgrade', (req, socket) => this.accept(req, socket))
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(this.wsPort, BRIDGE_HOST, () => { server.off('error', reject); resolve() })
      })
    } catch (err) {
      if (err?.code !== 'EADDRINUSE') throw err
      this.mode = 'relay'
      return this.mode
    }
    server.on('error', () => {})
    this.server = server
    this.mode = 'own'
    return this.mode
  }

  touch() {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.close(), this.idleMs)
    this.idleTimer.unref?.()
  }

  close() {
    clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.dropSocket()
    this.server?.close()
    this.server = null
    this.mode = null
  }

  connected() {
    return Boolean(this.socket && !this.socket.destroyed)
  }

  accept(req, socket) {
    if (!acceptableUpgrade(req.headers, this.wsPort)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']) + GUID).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    // 同一时间只连一个扩展，新连接顶掉旧的
    this.dropSocket()
    this.socket = socket
    socket.setNoDelay(true)
    let buffer = Buffer.alloc(0)
    let parts = []
    let size = 0
    socket.on('data', (chunk) => {
      const parsed = readFrames(Buffer.concat([buffer, chunk]))
      buffer = parsed.rest
      for (const { fin, opcode, payload } of parsed.frames) {
        if (opcode === 0x8) { socket.end(frame(0x8, Buffer.alloc(0))); return }
        if (opcode === 0x9) { socket.write(frame(0xa, payload)); continue }
        if (opcode === 0xa) continue
        if (opcode === 0x1 || opcode === 0x2) { parts = []; size = 0 }
        if (opcode > 0x2) continue
        parts.push(payload)
        size += payload.length
        if (size > MAX_MESSAGE) { socket.destroy(); return }
        if (fin) {
          const text = Buffer.concat(parts).toString('utf8')
          parts = []
          size = 0
          this.receive(text)
        }
      }
      if (parsed.error) socket.destroy()
    })
    socket.on('close', () => { if (this.socket === socket) this.dropSocket() })
    socket.on('error', () => socket.destroy())
    for (const resolve of this.waiters) resolve(true)
    this.waiters.clear()
  }

  dropSocket() {
    const socket = this.socket
    this.socket = null
    if (socket && !socket.destroyed) socket.destroy()
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(bridgeError('extension disconnected', 'disconnected'))
      this.pending.delete(id)
    }
  }

  receive(text) {
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    const entry = this.pending.get(message?.id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(message.id)
    if (message.error) entry.reject(bridgeError(String(message.error.message ?? 'extension error').slice(0, 300), Number(message.error.code) || 'extension'))
    else entry.resolve(message.result)
  }

  /** 等扩展连上来；扩展闲着时最慢一分钟重连一次。 */
  waitForExtension(ms) {
    if (this.connected()) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (value) => { clearTimeout(timer); this.waiters.delete(done); resolve(value) }
      const timer = setTimeout(() => done(false), ms)
      this.waiters.add(done)
    })
  }

  /** 转发口在不在、背后有没有连着扩展。 */
  async relayStatus() {
    try {
      const { status, data } = await relayCall(this.relayPort, 'GET', '/status', undefined, 3000)
      if (status !== 200 || data?.mode !== 'primary' || typeof data?.connected !== 'boolean') return { reachable: false }
      return { reachable: true, connected: data.connected }
    } catch {
      return { reachable: false }
    }
  }

  /**
   * 发一条请求给扩展。
   * @param {string} method - listPlatforms / checkAuth / syncArticle。
   * @param {object} params - 参数。
   * @param {{token: string, timeoutMs?: number}} options - token 只在自己监听时放进消息里；走转发口时由对方带上它自己的。
   */
  async request(method, params, { token, timeoutMs = 60_000 }) {
    this.touch()
    if (this.mode === 'relay') {
      const { status, data } = await relayCall(this.relayPort, 'POST', '/request', { method, params }, timeoutMs)
      if (status !== 200) throw bridgeError(String(data?.error ?? 'relay error').slice(0, 300), 'extension')
      return data?.result
    }
    if (!this.connected()) throw bridgeError('extension not connected', 'disconnected')
    this.seq += 1
    const id = `md-${Date.now()}-${this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(bridgeError('extension timeout', 'timeout'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.write(frame(0x1, Buffer.from(JSON.stringify({ id, method, token, params }))))
    })
  }
}
