// 对外请求的安全底座：只连公网地址。地址在真正建立连接的那一刻再校验一次，
// 域名先解析成公网、连接时又指向内网（DNS rebinding）的做法过不去。
import { lookup as dnsLookup } from 'node:dns'
import { execFile } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

const blocked = new BlockList()
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [['::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['64:ff9b::', 96], ['2002::', 16], ['ff00::', 8]]) blocked.addSubnet(net, bits, 'ipv6')

/** 这个地址是不是本机、内网或其他不该由粘贴的链接访问到的网段。 */
export function isPrivateAddress(address) {
  const value = String(address).replace(/^\[|\]$/g, '').toLowerCase()
  const family = isIP(value)
  if (!family) return true
  if (family === 4) return blocked.check(value, 'ipv4')
  // ::ffff:a.b.c.d 这类写法里藏着的 IPv4 地址单独拿出来查
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([\da-f]{1,4}):([\da-f]{1,4}))$/.exec(value)
  if (mapped) {
    const v4 = mapped[1] ?? `${parseInt(mapped[2], 16) >> 8}.${parseInt(mapped[2], 16) & 255}.${parseInt(mapped[3], 16) >> 8}.${parseInt(mapped[3], 16) & 255}`
    return blocked.check(v4, 'ipv4')
  }
  return blocked.check(value, 'ipv6')
}

/** 建连接时用的域名解析：解析结果里只要有一个不是公网地址就拒绝。 */
function guardedLookup(hostname, options, callback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }]
    if (!list.length || list.some(row => isPrivateAddress(row.address))) return callback(Object.assign(new Error('blocked private address'), { code: 'EPRIVATE' }))
    return options.all ? callback(null, list) : callback(null, list[0].address, list[0].family)
  })
}

/**
 * 用户机器上配的代理（HTTPS_PROXY / HTTP_PROXY，或 MEDIA_DESK_PROXY）。很多人在国内靠它才连得上海外的源。
 * 只认 http://主机:端口 这种写法；读不懂就当没有。
 */
export function proxyFromEnv(env = process.env) {
  const raw = env.MEDIA_DESK_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && url.hostname && !url.username ? { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 80 } : null
  } catch {
    return null
  }
}

/** 走代理时由代理去解析域名，这边查不到它最后连到哪，所以明显指向本机和内网的名字直接不让走。 */
function looksInternal(host) {
  return host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/i.test(host) || !host.includes('.')
}

/** 让代理帮忙连到目标主机，拿回一条原始连接。 */
function tunnel(proxy, host, port, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: proxy.host, port: proxy.port, method: 'CONNECT', path: `${host}:${port}`, headers: { host: `${host}:${port}` }, agent: false, signal })
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) return resolve(socket)
      socket.destroy()
      return reject(new Error(`proxy refused the connection (${res.statusCode})`))
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * 和 fetch 用法相近的请求函数，但连接阶段会拦内网地址，也从不自动跟随跳转。
 * 配了代理就经代理出去，没配就直连。
 * @param {string|URL} input - http(s) 地址。
 * @param {{method?: string, headers?: Record<string, string>, signal?: AbortSignal, body?: string|Buffer}} [init]
 * @returns {Promise<Response>} 标准 Response；3xx 原样返回，由调用方决定跟不跟。
 */
/** 本机解析一个域名的全部地址；解析失败返回空。 */
function lookupAll(host) {
  return new Promise(resolve => dnsLookup(host, { all: true }, (err, list) => resolve(err || !Array.isArray(list) ? [] : list)))
}

let systemProxy
/** 从程序坞启动的桌面应用拿不到终端里的代理环境变量：macOS 上再看一眼系统网络设置。只查一次。 */
async function detectProxy() {
  const fromEnv = proxyFromEnv()
  if (fromEnv || process.platform !== 'darwin') return fromEnv
  if (systemProxy === undefined) {
    systemProxy = await new Promise((resolve) => {
      execFile('/usr/sbin/scutil', ['--proxy'], { timeout: 2000 }, (err, out) => {
        if (err) return resolve(null)
        const field = name => new RegExp(`${name} : (\\S+)`).exec(out)?.[1]
        const host = field('HTTPSEnable') === '1' ? field('HTTPSProxy') : null
        const port = Number(field('HTTPSPort'))
        return resolve(host && port ? { host, port } : null)
      })
    })
  }
  return systemProxy
}

export async function safeFetch(input, init = {}) {
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
  // 末尾带点的写法（localhost.）和不带点是同一个主机
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isIP(host) && isPrivateAddress(host)) throw Object.assign(new Error('blocked private address'), { code: 'EPRIVATE' })
  const secure = url.protocol === 'https:'
  const proxy = await detectProxy()
  const options = { method: init.method ?? 'GET', headers: { 'accept-encoding': 'identity', ...init.headers }, signal: init.signal }
  if (proxy && !isIP(host)) {
    if (looksInternal(host)) throw Object.assign(new Error('blocked private address'), { code: 'EPRIVATE' })
    // 走代理时最终连到哪由代理决定，这边先自己解析一遍：像 127.0.0.1.nip.io 这种指向本机或内网的域名在这里拦下。
    // 本机解析不出来（只有代理能解析的域名）就放行；代理和本机解析结果不一致的情况防不住，这是已知的残余风险。
    const resolved = await lookupAll(host)
    if (resolved.some(row => isPrivateAddress(row.address))) throw Object.assign(new Error('blocked private address'), { code: 'EPRIVATE' })
    const socket = await tunnel(proxy, host, Number(url.port) || (secure ? 443 : 80), init.signal)
    // 连接已经由代理建好：把这条连接交给请求用，不再经过本机解析
    options.socket = socket
    options.servername = host
    options.agent = false
    if (!secure) options.createConnection = () => socket
  } else {
    options.lookup = guardedLookup
  }
  const client = secure ? https : http
  return new Promise((resolve, reject) => {
    const req = client.request(url, options, (res) => {
      const headers = new Headers()
      for (const [key, value] of Object.entries(res.headers)) for (const item of [].concat(value ?? [])) headers.append(key, item)
      const empty = res.statusCode === 204 || res.statusCode === 304 || init.method === 'HEAD'
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage, headers }))
      if (empty) res.resume()
    })
    req.on('error', reject)
    req.end(init.body)
  })
}
