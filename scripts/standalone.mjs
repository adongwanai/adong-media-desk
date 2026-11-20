#!/usr/bin/env node
// 不装 DeepSeek Harness 也能打开工作台：本机起一个小服务，页面和 /media-desk 接口都由它提供。
// 没有原生 Agent，AI 操作会提示未连接；内容管理和排版可用。
// 用法：node scripts/standalone.mjs [端口]   数据在 $IP_WORKBENCH_HOME/ip-workbench（默认 ~/.dsh-ip-workbench/ip-workbench）
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import plugin from '../src/host.js'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

process.env.DSH_HOME = resolve(process.env.IP_WORKBENCH_HOME || join(homedir(), '.dsh-ip-workbench'))
for (const key of ['MEDIA_DESK_BROWSER_PROFILE', 'MEDIA_DESK_BROWSER_PORT', 'MEDIA_DESK_SAMPLES']) delete process.env[key]

const HOST = '127.0.0.1'
const PORT = Number(process.argv[2] || process.env.PORT || 4372)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`端口不对：${process.argv[2]}`)
  process.exit(1)
}

const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`])
const PAGES = {
  '/': ['../scripts/standalone.html', 'text/html; charset=utf-8'],
  '/standalone.js': ['../dist/standalone.js', 'text/javascript; charset=utf-8'],
}

/** 只认本机地址发来的请求：挡掉别的网站借浏览器来读写这份数据。 */
function requestRejection({ headers }) {
  if (!ALLOWED_HOSTS.has(headers.host)) return 403
  if (headers.origin && !ALLOWED_HOSTS.has(headers.origin.replace(/^https?:\/\//, ''))) return 403
  return undefined
}

let api = null
// 宿主的最小替身：只提供接口注册和鉴权；模型、生图工具都没有
const ctx = {
  get: name => (name === 'connection' ? { requestRejection } : null),
  effect: fn => fn(),
  webServer: { register: ({ handler }) => { api = handler; return () => { api = null } } },
}
plugin.apply(ctx)

const server = createServer(async (req, res) => {
  try {
    // 不让别的网站把工作台嵌进自己的页面里骗点击
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('x-frame-options', 'DENY')
    res.setHeader('content-security-policy', "frame-ancestors 'none'")
    const path = new URL(req.url || '/', 'http://local').pathname
    if (path.startsWith('/media-desk')) {
      // 浏览器发写请求一定带 Origin；不带的一律不收
      if (req.method !== 'GET' && req.method !== 'HEAD' && !req.headers.origin) {
        res.statusCode = 403
        return res.end()
      }
      return await api(req, res)
    }
    const page = req.method === 'GET' ? PAGES[path] : null
    if (!page || requestRejection(req)) {
      res.statusCode = page ? 403 : 404
      return res.end()
    }
    const body = await readFile(new URL(page[0], import.meta.url))
    res.setHeader('content-type', page[1])
    res.setHeader('cache-control', 'no-store')
    return res.end(body)
  } catch (error) {
    console.error('请求出错：', error)
    if (!res.headersSent) res.statusCode = 500
    return res.end()
  }
})

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${PORT} 被占用，换一个：npm start -- 4311` : `启动失败：${error.message}`)
  process.exit(1)
})
server.listen(PORT, HOST, () => console.log(`阿东IP工作台：http://${HOST}:${PORT}/`))
