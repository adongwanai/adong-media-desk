// 填到草稿：用专用浏览器（用户自己登录的那个）打开平台发布页，把这篇的平台版本填进去、存成草稿，然后停下，标签页留在前台给用户检查。
// 永远不点发布类按钮：每次点击都过 fill-guard.js 的黑白名单，按下前再核对落点；只去平台白名单里的主机；遇到登录页、验证码立即停。
// 填之前先只读查重（草稿箱、笔记管理），填完回读核对；点「暂存离开」前给填好的页面拍张 jpg 存档，点完去草稿箱确认一次。
// 图片由界面导出成 PNG 先交到数据目录的临时文件夹，再经 DevTools 交给页面的文件框；填完删掉。
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectBrowser, DEFAULT_PORTS, openPage } from './cdp-fill.js'
import { readTab } from './cdp.js'
import { allowedUrl } from './fill-guard.js'
import { createPage, FillError } from './fill-page.js'
import { shotName, shotsToDrop } from './fill-check.js'
import { fillAdapter } from './fill-platforms/index.js'
import { platformName, tr } from './i18n.js'
import { applyOps } from './ops.js'

// 同一篇同一平台 60 秒内不重复填
export const REPEAT_MS = 60_000
const MAX_IMAGE = 32 * 1024 * 1024
const MAX_JSON = 64 * 1024
const KEEP_JOB_MS = 30 * 60_000
const STALE_FILE_MS = 60 * 60_000
const NAME = /^fill-[a-f0-9]{16}\.png$/
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const refuse = (message, status = 400) => Object.assign(new Error(message), { status })

/** 一个错误交给界面：code 由界面翻成人话；不认识的错误带原话。 */
export function describeError(err) {
  if (err instanceof FillError || typeof err?.code === 'string') return { code: err.code, vars: err.vars ?? {} }
  return { code: 'other', vars: { message: String(err?.message ?? err).slice(0, 300) } }
}

export class DraftFiller {
  /**
   * @param {{root: string, store?: object, connect?: Function, open?: Function, adapterOf?: Function, pause?: Function, delay?: Function, now?: () => number, shotsDir?: string}} options
   * connect / open / adapterOf / pause 测试里换成假的；store 用来记「已推到草稿」和找截图目录。
   */
  constructor({ root, store = null, connect = connectBrowser, open = openPage, adapterOf = fillAdapter, pause, delay, now = Date.now, shotsDir = null }) {
    this.root = root
    this.tmpDir = join(root, 'fill-tmp')
    // 填好时的页面截图存在 store 的 files 目录，界面可以从 /media-desk/files/ 打开
    this.shotsDir = shotsDir ?? (store?.filesDir ? store.filesDir : join(root, 'files'))
    // 和读后台同一个专用浏览器：默认是数据目录下的 browser-profile；两个环境变量只给开发测试用
    this.profileDir = process.env.MEDIA_DESK_BROWSER_PROFILE || join(root, 'browser-profile')
    this.ports = [Number(process.env.MEDIA_DESK_BROWSER_PORT) || null, ...DEFAULT_PORTS].filter(Boolean)
    this.store = store
    this.connect = connect
    this.open = open
    this.adapterOf = adapterOf
    this.pause = pause
    this.delay = delay
    this.now = now
    this.jobs = new Map()
    this.recent = new Map()
    this.running = null
  }

  /** 界面导出的一张 PNG 存进临时文件夹，返回文件名。 */
  async saveImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < PNG.length || !buffer.subarray(0, PNG.length).equals(PNG)) throw refuse(tr('图片不是 PNG'))
    if (buffer.length > MAX_IMAGE) throw refuse(tr('图片太大了（超过 32MB）'), 413)
    await mkdir(this.tmpDir, { recursive: true })
    await this.sweep()
    const name = `fill-${randomBytes(8).toString('hex')}.png`
    await writeFile(join(this.tmpDir, name), buffer)
    return name
  }

  /** 删掉一小时前留下的临时图片（上次中途断掉的）。 */
  async sweep() {
    const names = await readdir(this.tmpDir).catch(() => [])
    await Promise.all(names.filter(name => NAME.test(name)).map(async (name) => {
      const file = join(this.tmpDir, name)
      const info = await stat(file).catch(() => null)
      if (info && this.now() - info.mtimeMs > STALE_FILE_MS) await rm(file, { force: true })
    }))
  }

  /**
   * 开始填一篇：先核对内容和图片，再在后台跑，立刻返回任务（界面按 id 轮询进度）。
   * @param {{item: object, platform: string, images: string[]}} request
   */
  async start({ item, platform, images }) {
    const adapter = this.adapterOf(platform)
    if (!adapter) throw refuse(tr('{platform}还不支持自动填草稿', { platform: platformName(String(platform).slice(0, 20)) }))
    if (!item) throw refuse(tr('找不到这条内容'), 404)
    if (this.running) throw refuse(tr('上一篇还在填，等它填完再试'), 409)
    const key = `${item.id}:${platform}`
    const last = this.recent.get(key)
    if (last && this.now() - last < REPEAT_MS) throw refuse(tr('这篇刚填过，{n} 秒后才能再填，免得重复', { n: Math.ceil((REPEAT_MS - (this.now() - last)) / 1000) }), 429)
    const content = adapter.content(item)
    if (content.problems.length) {
      const job = this.record({ itemId: item.id, platform, status: 'failed', error: content.problems[0] })
      return job
    }
    const names = Array.isArray(images) ? images.map(String) : []
    if (!names.length) throw refuse(tr('没有图片：先导出图片版再填'))
    if (names.length > adapter.limits.images) throw refuse(tr('图片有 {n} 张，{platform}最多 {max} 张', { n: names.length, max: adapter.limits.images, platform: platformName(platform) }))
    if (names.some(name => !NAME.test(name))) throw refuse(tr('图片文件名无效'))
    const files = names.map(name => join(this.tmpDir, name))
    for (const file of files) if (!(await stat(file).catch(() => null))?.isFile()) throw refuse(tr('图片已经过期了，请重新点一次'), 410)
    if (!allowedUrl(adapter, adapter.url)) throw refuse(tr('发布页地址不在白名单里'))
    this.recent.set(key, this.now())
    const job = this.record({ itemId: item.id, platform, status: 'running' })
    this.running = job.id
    // 后台跑；界面轮询 status
    this.run(job, adapter, content, files).catch(() => {})
    return job
  }

  record(fields) {
    // 过期的任务记录清掉
    for (const [id, job] of this.jobs) if (this.now() - job.startedAt > KEEP_JOB_MS) this.jobs.delete(id)
    const job = { id: `fj_${randomBytes(6).toString('hex')}`, steps: [], result: null, error: null, startedAt: this.now(), ...fields }
    this.jobs.set(job.id, job)
    return job
  }

  /** 进度：同一步（比如上传第几张）只更新，不重复加。 */
  step(job, key, vars = {}) {
    const last = job.steps.at(-1)
    if (last?.key === key) last.vars = vars
    else job.steps.push({ key, vars, at: this.now() })
  }

  async run(job, adapter, content, files) {
    let browser = null
    let page = null
    let status = 'failed'
    try {
      this.step(job, 'browser')
      browser = await this.connect({ profileDir: this.profileDir, ports: this.ports, headless: false })
      this.step(job, 'open')
      const tab = await this.open(browser, adapter.url)
      job.targetId = tab.targetId
      // 标签页放到前台：用户要看着它填
      await tab.activate()
      await tab.send('DOM.enable').catch(() => {})
      // 查重和确认要用只读的列表页：在同一个浏览器里另开标签页读文字，读完就关
      const probe = async (url) => readTab(browser, url, { allowed: candidate => allowedUrl(adapter, candidate), maxChars: 20_000 })
      const shotSaver = buffer => this.saveShot(adapter, buffer)
      page = createPage(tab, adapter, { pause: this.pause, delay: this.delay, fileRoot: this.tmpDir, probe, shotSaver })
      job.result = await adapter.fill(page, content, files, (key, vars) => this.step(job, key, vars))
      this.step(job, job.result === 'saved' ? 'saved' : 'filled')
      status = 'done'
      // 草稿已经在平台上了：记状态失败也不算这次没填成
      await this.remember(job).catch(() => {})
    } catch (err) {
      job.error = describeError(err)
      // 点了存草稿但没确认到：记成需要人工确认，不再重试这一次点击
      if (job.error.code === 'save-unconfirmed') job.confirmNeeded = true
      // 窗口被挡住时输入可能没进去：核对不上、等不到，多半是这个原因
      if (page?.wasHidden() && ['verify', 'timeout', 'readback'].includes(job.error.code)) job.error = { code: 'hidden', vars: job.error.vars }
      // 还没点到存草稿就停了：平台上不会多出草稿，允许马上重试（比如登录好了再点）
      if (!job.steps.some(row => row.key === 'save')) this.recent.delete(`${job.itemId}:${job.platform}`)
    } finally {
      // 只断开连接，标签页和浏览器都留给用户
      await browser?.close().catch(() => {})
      // 页面早就读完文件了；中途失败时文件也没用了
      await Promise.all(files.map(file => rm(file, { force: true }).catch(() => {})))
      job.finishedAt = this.now()
      this.running = null
      job.status = status
    }
  }

  /**
   * 点「暂存离开」之前给填好的页面拍一张 jpg，存在 store 的 files 目录：
   * fill-<平台英文>-<YYYYMMDD-HHMMSS>.jpg，每个平台只留最近 5 张。返回文件名和能打开的地址；失败抛错，由页面那边记一句不影响流程。
   */
  async saveShot(adapter, buffer) {
    const dir = this.shotsDir
    const slug = adapter.slug || adapter.platform || 'platform'
    await mkdir(dir, { recursive: true })
    const name = shotName(slug)
    await writeFile(join(dir, name), buffer)
    // 顺手清掉这个平台更早的截图
    const names = await readdir(dir).catch(() => [])
    await Promise.all(shotsToDrop(names, slug).map(old => rm(join(dir, old), { force: true }).catch(() => {})))
    return name
  }

  /** 存好草稿记「已推到草稿」；只填好没存的，没动过时记「已复制去发布」。已发布的不退回。 */
  async remember(job) {
    if (!this.store) return
    await this.store.mutate(tr('填到{platform}草稿', { platform: platformName(job.platform) }), (draft) => {
      const current = draft.items.find(row => row.id === job.itemId)?.publish?.[job.platform]?.state ?? 'none'
      const state = job.result === 'saved' ? (current === 'published' ? null : 'drafted') : (current === 'none' ? 'copied' : null)
      if (state) applyOps(draft, [{ op: 'set_publish', id: job.itemId, platform: job.platform, state }])
      return draft
    }, { undoable: false })
  }

  status(id) {
    return this.jobs.get(id) ?? null
  }
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw refuse(tr('内容太大'), 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const publicJob = job => (job ? { id: job.id, itemId: job.itemId, platform: job.platform, status: job.status, steps: job.steps, result: job.result, error: job.error, confirmNeeded: Boolean(job.confirmNeeded) } : null)

/**
 * /media-desk/fill/* 接口：
 * POST fill/image（body 是 PNG）→ { name }；POST fill/start { id, platform, images } → { job }；GET fill/status?job= → { job, state? }。
 */
export async function fillRoute({ store, desk, req, method, path, url }) {
  desk.filler ??= new DraftFiller({ root: store.root, store })
  const filler = desk.filler
  if (method === 'GET' && path === 'fill/status') {
    const job = filler.status(url.searchParams.get('job') ?? '')
    if (!job) throw refuse(tr('找不到这次填草稿的记录'), 404)
    return { job: publicJob(job), ...(job.status === 'running' ? {} : { state: await store.read() }) }
  }
  if (method !== 'POST') throw refuse(tr('不支持的方法'), 405)
  if (path === 'fill/image') {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'image/png') throw refuse(tr('图片不是 PNG'), 415)
    await store.read()
    return { name: await filler.saveImage(await readBody(req, MAX_IMAGE)) }
  }
  if (path === 'fill/start') {
    const raw = await readBody(req, MAX_JSON)
    let body
    try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {} } catch { throw refuse(tr('请求不是有效的 JSON')) }
    const item = (await store.read()).items.find(row => row.id === body.id)
    return { job: publicJob(await filler.start({ item, platform: String(body.platform ?? ''), images: body.images })) }
  }
  throw refuse(tr('接口不存在'), 404)
}
