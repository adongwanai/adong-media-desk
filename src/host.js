// dsh-media-desk host 半片：/media-desk/* 接口、文件服务和模型调用。
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assistantModelOverride, callModel, defaultSelection, extractJson, modelInfo, modelStatus, setAssistantModel } from './ai.js'
import { defaultExportDir, resolveExportDir, saveProduction } from './export.js'
import { harvest, harvestText, readTweet, tweetId } from './harvest.js'
import { readNoteFile } from './note-file.js'
import { generateNativeImage } from './native-image.js'
import { configureNativeTasks } from './native-task.js'
import { imageTool } from './image-tool.js'
import { computeInsights, exportSkill, proposeRules } from './learn.js'
import { computeBoard } from './board.js'
import { applyOps, newId } from './ops.js'
import { Producer } from './produce.js'
import { updateVersion, Versioner } from './versions.js'
import { Illustrator } from './illustrate.js'
import { findMaterials } from './materials.js'
import { attachMaterials, removeMaterial } from './item-materials.js'
import { detectFlow, readFlow } from './writing-flow.js'
import { generateTitles } from './titles.js'
import { publicSettings, Settings, imageReady } from './settings.js'
import { fetchRemoteImage, hostArticleImages, ImageHostCache, uploadMany } from './image-host.js'
import { SourceCache } from './source-cache.js'
import { readSupport } from './collect.js'
import { isRunning, publicStale, runAccountRead, startDailyRead } from './daily-read.js'
import { BACKSTAGE, BACKSTAGE_PLATFORMS, browserSession } from './backstage.js'
import { launchVisible } from './cdp.js'
import { anglePrompts, parseAngle } from './idea-score.js'
import { focusOf } from './rank.js'
import { pickRivals, readRivals } from './rivals.js'
import { normalizeStyle, referenceExcerpt, stylePrompts } from './style.js'
import { dshHome, Store } from './store.js'
import { currentLang, platformName, tr, withLang } from './i18n.js'
import { localizeSamples, samplesNeedLocale } from './seed.js'
import { draftFromItem } from './wechat.js'
import { publishFromItem, publishStatusOfItem, stopWaiting } from './wechat-publish.js'
import { ExtensionBridge } from './wechatsync.js'
import { checkSync, syncDrafts } from './sync-drafts.js'
import { videoRoute } from './video.js'
import { fillRoute } from './draft-fill.js'
import { importScans, previewImport, removeImported, scanFolders, allowedImportedImage } from './import-md.js'
import { dshChatRoute } from './dsh-chat.js'
import { ensureWorkspace, workspacePath } from './workspace.js'
import { NativeAgent, nativeReady } from './native-agent.js'

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const MAX_JSON = 4_000_000
const MAX_UPLOAD = 250_000_000
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }
const UPLOAD_EXT = Object.fromEntries(Object.entries(MIME).filter(([ext]) => ext !== '.jpeg').map(([ext, type]) => [type, ext]))

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBuffer(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error(tr('内容太大')), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const raw = await readBuffer(req, MAX_JSON)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw Object.assign(new Error(tr('请求不是有效的 JSON')), { status: 400 })
  }
}

/** 把文件流接给响应。读不到（权限、被删、磁盘错误）时只关掉这一条响应，绝不让错误冒到进程上把整个工作台打死。 */
function pipeFile(file, options, res) {
  const stream = createReadStream(file, options)
  let ended = false
  const stop = () => {
    if (ended) return
    ended = true
    stream.destroy()
    if (!res.writableEnded) res.destroy()
  }
  stream.on('error', stop)
  // 浏览器取消加载（关闭预览、换页）也会触发 close，一样收掉这条流
  res.on('close', stop)
  stream.pipe(res)
  return null
}

/** 支持 Range，视频才能正常拖动和循环。 */
async function sendFile(req, res, file) {
  const type = MIME[extname(file).toLowerCase()]
  if (!type) return json(res, 404, { error: tr('不支持的文件类型') })
  let info
  try {
    info = await stat(file)
  } catch {
    return json(res, 404, { error: tr('文件不存在') })
  }
  res.setHeader('content-type', type)
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', 'private, max-age=3600')
  res.setHeader('x-content-type-options', 'nosniff')
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    if (start >= info.size || start > end) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${info.size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`)
    res.setHeader('content-length', end - start + 1)
    return pipeFile(file, { start, end }, res)
  }
  res.statusCode = 200
  res.setHeader('content-length', info.size)
  if (req.method === 'HEAD') return res.end()
  return pipeFile(file, undefined, res)
}

function engineLabel(ctx) {
  if (nativeReady(ctx)) return 'DSH 原生 Agent'
  const info = modelInfo(ctx)
  return info ? info.label : null
}

const CHAT_LIVE = new Map()
const CHAT_LIVE_MS = 5 * 60_000
function sweepChatLive() {
  const now = Date.now()
  for (const [id, row] of CHAT_LIVE) if (now - row.at > CHAT_LIVE_MS) CHAT_LIVE.delete(id)
}

/** 模型按 JSON 输出，回复写在 reply 字段里。从已经流出来的半截 JSON 里尽力取出 reply 已写的部分，用来边写边显示。 */
export function visibleReply(partial) {
  const text = String(partial ?? '')
  const at = text.search(/"reply"\s*:\s*"/)
  if (at < 0) return ''
  let out = ''
  for (let i = text.indexOf('"', at + 7) + 1; i > 0 && i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === undefined) break
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next
      i += 1
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

async function extractStyle(ctx, store, body) {
  const urls = (Array.isArray(body.urls) ? body.urls : []).map(row => String(row).trim()).filter(Boolean).slice(0, 5)
  const parts = [String(body.text ?? '').trim()].filter(Boolean)
  const failures = []
  for (const url of urls) {
    try {
      const page = await harvestText(url)
      if (page.text.length >= 80) parts.push(`${page.title ?? ''}\n${page.text}`)
      else failures.push(tr('{url}：页面上几乎没有文字，可能需要登录', { url }))
    } catch (err) {
      failures.push(tr('{url}：{error}', { url, error: err.message }))
    }
  }
  const material = parts.join('\n\n---\n\n')
  if (material.length < 80) {
    throw Object.assign(new Error(failures.length ? tr('抓不到内容。{reason}。可以把内容直接贴进来。', { reason: failures[0] }) : tr('内容太少了，至少贴一段完整的文字')), { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 20) : ''
  const source = urls.length && parts.length === urls.length ? tr('链接') : urls.length ? tr('内容和链接') : tr('内容')
  return styleFromMaterial(ctx, store, { material, name, source, sourceUrls: urls, failures })
}

/** 提炼一张风格卡并设为当前风格。同一个账号再抓一次时更新原来那张。 */
async function styleFromMaterial(ctx, store, { material, name, source, sourceUrls = [], failures = [], accountKey = null }) {
  let style
  try {
    const { system, user } = stylePrompts(material, name)
    const { text } = await callModel(ctx, { system, user, maxTokens: 1500, light: true, signal: AbortSignal.timeout(120_000) })
    style = normalizeStyle(extractJson(text), name)
  } catch (err) {
    throw Object.assign(new Error(tr('提炼风格需要文字模型：{error}', { error: err.message })), { status: 502 })
  }
  return store.mutate(tr('提炼风格「{name}」', { name: style.name }), (draft) => {
    const existing = accountKey ? (draft.styles ?? []).find(row => row.accountKey === accountKey) : null
    const id = existing?.id ?? newId('st')
    const row = { id, ...style, reference: referenceExcerpt(material), source, sourceUrls, ...(accountKey ? { accountKey } : {}), createdAt: existing?.createdAt ?? new Date().toISOString() }
    draft.styles = existing ? draft.styles.map(entry => (entry.id === id ? row : entry)) : [row, ...(draft.styles ?? [])]
    draft.activeStyleId = id
    return { id, failures, state: draft }
  })
}

async function addFromNoteFile(store, body) {
  const note = await readNoteFile(String(body.path ?? body.value ?? ''))
  const op = { op: 'add_item', kind: 'note', title: body.title || note.title || tr('未命名素材'), body: note.body, tags: note.tags, source: tr('本地文件') }
  return store.mutate(tr('从文件记下《{title}》', { title: op.title.slice(0, 12) }), (draft) => {
    const { receipts, errors } = applyOps(draft, [op])
    return { receipts, errors, id: receipts[0]?.target, state: draft }
  })
}

async function addFromUrl(ctx, store, body) {
  const url = String(body.url || '').trim()
  // 推文页面只给一句被截断的简介（og:description 约 300 字）：能用 FxTwitter 时把完整正文写成
  // 灵感正文，成稿才有依据；FxTwitter 读不到再退回读页面
  const tweet = tweetId(url) ? await readTweet(url).catch(() => null) : null
  if (tweet) {
    const op = { op: 'add_item', kind: 'web', title: body.title || tweet.title, body: body.note || tweet.body, url: tweet.url, source: tweet.siteName, tags: Array.isArray(body.tags) ? body.tags : [] }
    return store.mutate(tr('收藏《{title}》', { title: op.title.slice(0, 12) }), (draft) => {
      const { receipts, errors } = applyOps(draft, [op])
      return { receipts, errors, id: receipts[0]?.target, state: draft }
    })
  }
  const info = await harvest(url)
  const op = {
    op: 'add_item', kind: 'web', title: body.title || info.title || url, body: body.note || info.description || '', url: info.url, source: info.siteName, tags: Array.isArray(body.tags) ? body.tags : [],
    media: info.image ? { src: info.image } : null,
  }
  return store.mutate(tr('收藏《{title}》', { title: op.title.slice(0, 12) }), (draft) => {
    const { receipts, errors } = applyOps(draft, [op])
    return { receipts, errors, id: receipts[0]?.target, state: draft }
  })
}

async function refreshAccount(store, body) {
  const url = String(body.url || '').trim()
  const now = new Date().toISOString()
  let patch
  try {
    const info = await harvest(url)
    patch = { url: info.url, title: info.title ?? undefined, description: info.description ?? undefined, avatar: info.image ?? undefined, fetchedAt: now, fetchError: '' }
  } catch (err) {
    patch = { url, fetchedAt: now, fetchError: err.message }
  }
  return store.mutate(tr('更新账号档案'), (draft) => {
    const op = body.id ? { op: 'update_account', id: body.id, ...patch } : { op: 'add_account', platform: body.platform ?? '', handle: body.handle ?? '', ...patch }
    const { errors } = applyOps(draft, [op])
    return { state: draft, errors, fetchError: patch.fetchError || null }
  })
}

async function handleUpload(req, store, res) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const ext = UPLOAD_EXT[type]
  if (!ext) return json(res, 415, { error: tr('不支持这种文件：{type}', { type: type || tr('未知') }) })
  const buffer = await readBuffer(req, MAX_UPLOAD)
  await store.read()
  const name = `${newId('f')}${ext}`
  await writeFile(join(store.filesDir, name), buffer)
  return json(res, 200, { src: `media-desk/files/${name}`, kind: type.startsWith('video/') ? 'video' : 'image' })
}

async function route(ctx, store, desk, req, res) {
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/^\/media-desk\/?/, '')
  const method = req.method || 'GET'
  // 别的网站发来的请求一律不收，读也不行：不然它能用图片地址探测本机有没有某个文件
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return json(res, 403, { error: tr('拒绝跨站请求') })

  if ((method === 'GET' || method === 'HEAD') && path.startsWith('assets/')) {
    const name = path.slice('assets/'.length)
    if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: tr('路径无效') })
    return sendFile(req, res, join(ASSETS_DIR, name))
  }
  if ((method === 'GET' || method === 'HEAD') && path.startsWith('imported/')) {
    // 导入的稿子里引用的本地图片：只读已导入文件夹里面的图片文件
    const file = await allowedImportedImage(await store.read(), path.slice('imported/'.length))
    if (!file) return json(res, 404, { error: tr('文件不存在') })
    return sendFile(req, res, file)
  }
  if ((method === 'GET' || method === 'HEAD') && path.startsWith('files/')) {
    const name = path.slice('files/'.length)
    if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: tr('路径无效') })
    await store.read()
    return sendFile(req, res, join(store.filesDir, name))
  }
  // 填到草稿：专用浏览器里把平台版本填进发布页、存草稿，不点发布（draft-fill.js）
  if (path.startsWith('fill/')) return json(res, 200, await fillRoute({ store, desk, req, method, path, url }))
  if (method === 'GET') {
    if (path === 'state') {
      if (!desk.settled) { desk.settled = true; for (const item of (await store.read()).items) if (!desk.native.active(item.id)) await desk.producer.settle(item.id).catch(() => {}) }
      let state = await store.read()
      if (nativeReady(ctx) && !desk.sourcesPreloaded) {
        desk.sourcesPreloaded = true
        Promise.allSettled([desk.sources.readFeeds(state.feeds ?? [], { cachedOnly: true, language: currentLang() }), desk.sources.readBuiltin(state.builtin ?? [], { cachedOnly: true, language: currentLang() }), desk.sources.readHot(undefined, { cachedOnly: true, language: currentLang() })]).catch(() => {})
      }
      // 示例数据跟着界面语言走；用户自己的内容不动
      if (samplesNeedLocale(state, currentLang())) state = await store.mutate('', draft => (localizeSamples(draft, currentLang()), draft), { undoable: false })
      return json(res, 200, { state, nativeAgent: nativeReady(ctx), model: engineLabel(ctx), modelOk: modelStatus.ok, modelError: modelStatus.error, canUndo: store.undo.length > 0 })
    }
    if (path === 'production') {
      const id = url.searchParams.get('id') ?? ''
      if (!desk.native.active(id)) await desk.producer.settle(id)
      await desk.versioner.settle(id)
      const state = await store.read()
      const item = state.items.find(row => row.id === id)
      return json(res, 200, { production: item?.production ?? null, status: item?.status, chat: state.chat, live: desk.native.status(id) ?? desk.producer.status(id) })
    }
    if (path === 'settings') return json(res, 200, { ...publicSettings(await desk.settings.read(), Boolean(imageTool(ctx))), defaultExportDir: defaultExportDir() })
    if (path === 'models') {
      // 列出 Harness 里已接的提供方和它们公布的模型，给工作台的助手模型选择器用
      const llm = ctx.get('llm')
      const providers = llm ? await llm.listProviders() : []
      const settled = await Promise.allSettled(providers.map(async p => ({
        provider: p.id, name: p.name,
        models: (await llm.listModels(p.id)).map(m => ({ id: m.id, name: m.name || m.id })),
      })))
      return json(res, 200, {
        providers: settled.filter(r => r.status === 'fulfilled').map(r => r.value).filter(p => p.models.length),
        default: defaultSelection(ctx),
        current: assistantModelOverride(),
      })
    }
    if (path === 'insights') return json(res, 200, computeInsights(await store.read()))
    if (path === 'board') {
      const state = await store.read()
      const saved = await desk.settings.read()
      const { autoRead } = saved
      const backstagePlatforms = saved.backstage?.enabled === true ? BACKSTAGE_PLATFORMS : []
      // 自动读取：每个平台能不能读、每天几点读、上一轮的结果；大屏顶栏和平台卡片用
      // 原因是读的那一刻按当时的语言记的；换了语言后，认得的原因再翻一次
      const last = state.autoRead ? { ...state.autoRead, running: isRunning(state.autoRead) || Boolean(desk.readingAccounts), results: (state.autoRead.results ?? []).map(row => (row.error ? { ...row, error: tr(row.error) } : row)) } : null
      // stale：公开接口超过 6 小时没读到，大屏打开时在后台补读一次
      const stale = !desk.readingAccounts && publicStale({ now: new Date(), last: state.autoRead, settings: autoRead, hasLinks: (state.accounts ?? []).some(account => !account.sample && account.url) })
      return json(res, 200, { ...computeBoard(state), autoRead: { schedule: autoRead, last, stale, support: readSupport(backstagePlatforms), error: desk.autoReadError ?? null } })
    }
    if (path.startsWith('video/')) { const out = await videoRoute(ctx, store, method, path, {}); if (out) return json(res, 200, out) }
    const chat = await dshChatRoute(ctx, store, method, path, {}); if (chat) return json(res, 200, chat)
    return json(res, 404, { error: tr('接口不存在') })
  }
  if (method !== 'POST') return json(res, 405, { error: tr('不支持的方法') })

  // 所有写操作都拒绝跨站请求
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return json(res, 403, { error: tr('拒绝跨站请求') })

  if (path === 'upload') return handleUpload(req, store, res)
  const body = await readJson(req)
  // 视频页：口播稿改写、开头建议、删录像、粗剪
  if (path.startsWith('video/')) { const out = await videoRoute(ctx, store, method, path, body); if (out) return json(res, 200, out) }
  { const chat = await dshChatRoute(ctx, store, method, path, body); if (chat) return json(res, 200, chat) }
  switch (path) {
    case 'ops': {
      const label = typeof body.label === 'string' ? body.label : tr('操作')
      const result = await store.mutate(label, (draft) => {
        const applied = applyOps(draft, body.ops)
        return { ...applied, state: draft }
      }, { undoable: body.undoable !== false })
      return json(res, 200, result)
    }
    case 'undo': {
      const label = await store.undoLast()
      return json(res, 200, { label, state: await store.read(), canUndo: store.undo.length > 0 })
    }
    case 'chat': {
      if (!desk.native.ready()) return json(res, 503, { error: '未连接 DSH 原生 Agent。请在本地 DSH 中打开阿东IP工作台；独立预览不支持对话。' })
      // 真的边写边显示：先回一个 liveId，模型在后台写；界面同时轮询 chat/live 取已经写出来的字
      sweepChatLive()
      const liveId = newId('live')
      CHAT_LIVE.set(liveId, { text: '', at: Date.now(), done: false })
      const run = desk.native.run(body, update => {
        const row = CHAT_LIVE.get(liveId)
        if (row) Object.assign(row, update, { text: update.reply, at: Date.now() })
      }).then((result) => {
        const row = CHAT_LIVE.get(liveId)
        if (row) { row.done = true; row.text = result.answer?.text ?? row.text; row.at = Date.now() }
        CHAT_LIVE.set(liveId, { ...(CHAT_LIVE.get(liveId) ?? {}), result, at: Date.now() })
        return result
      }).catch((err) => {
        const row = CHAT_LIVE.get(liveId)
        if (row) { row.done = true; row.error = err.message; row.at = Date.now() }
        throw err
      })
      // 不 await：先把 id 交给界面，结果由 chat/live 取
      run.catch(() => {})
      return json(res, 200, { liveId })
    }
    case 'chat/live': {
      sweepChatLive()
      const row = CHAT_LIVE.get(String(body.id ?? ''))
      if (!row) return json(res, 404, { error: tr('这条回复已经结束') })
      return json(res, 200, { text: row.text, reasoning: row.reasoning, phase: row.phase, startedAt: row.startedAt, updatedAt: row.updatedAt, activity: row.activity, drafts: row.drafts, sessionId: row.sessionId, done: row.done, error: row.error ?? null, result: row.done ? row.result ?? null : null })
    }
    case 'chat/cancel': {
      await desk.native.cancel(typeof body.focusId === 'string' ? body.focusId : undefined)
      return json(res, 200, { ok: true })
    }
    case 'chat/clear': {
      const focusId = typeof body.focusId === 'string' ? body.focusId : undefined
      if (desk.native.active(focusId)) return json(res, 409, { error: '请先等待当前对话结束' })
      const state = await store.mutate('清空对话', (draft) => {
        draft.chat = draft.chat.filter(row => (row.itemId ?? null) !== (focusId ?? null))
        if (focusId) { const item = draft.items.find(row => row.id === focusId); if (item) delete item.dshSessionId }
        else delete draft.dshGeneralSessionId
        return draft
      }, { undoable: false })
      desk.native.sessions.delete(focusId ?? '_general')
      return json(res, 200, { state })
    }
    case 'produce': {
      if (!desk.native.ready()) return json(res, 503, { error: '未连接 DSH 原生 Agent，请在本地 DSH 中生成内容。' })
      const started = await desk.native.start(String(body.id), { goal: body.goal })
      // 重新成稿会换掉母稿，还在写的平台版本没有意义了
      if (started) desk.versioner.cancel(String(body.id))
      return json(res, 200, { started, state: await store.read() })
    }
    // 平台版本：后台按平台各写一版，进度跟着 production 一起读
    case 'versions/generate': {
      const { started } = await desk.versioner.start(String(body.id), body.platforms)
      return json(res, 200, { started, state: await store.read() })
    }
    case 'versions/cancel':
      desk.versioner.cancel(String(body.id), typeof body.platform === 'string' ? body.platform : undefined)
      return json(res, 200, { ok: true })
    case 'versions/update': {
      const result = await updateVersion(store, body)
      if (result.errors.length) return json(res, 400, { error: result.errors[0] })
      return json(res, 200, result)
    }
    // 公众号「按规范整理」和退回沿用母稿
    case 'versions/format-wechat': return json(res, 200, { ...(await desk.versioner.formatWechat(String(body.id))), state: await store.read() })
    // 只为一个平台版本的几项自检（比如字数）再定向改一次
    case 'versions/revise': return json(res, 200, { ...(await desk.versioner.revise(String(body.id), String(body.platform ?? ''), body.checks)), state: await store.read() })
    case 'versions/carry-wechat':
      await desk.versioner.carryWechat(String(body.id))
      return json(res, 200, { state: await store.read() })
    // 配图：先逐页提议，用户勾选后才生图
    case 'versions/illustrations/propose':
      await desk.illustrator.propose(String(body.id), String(body.platform ?? ''))
      return json(res, 200, { state: await store.read() })
    case 'versions/illustrations/generate': return json(res, 200, { ...(await desk.illustrator.start(String(body.id), String(body.platform ?? ''), body.pages)), state: await store.read() })
    // 素材库：试读一下设置里的文件夹
    case 'materials/check': {
      const saved = await desk.settings.read()
      const found = await findMaterials(typeof body.dir === 'string' ? body.dir : saved.materialDir, String(body.query ?? '素材'), { max: 0, exclude: Array.isArray(body.exclude) ? body.exclude : saved.materialExclude })
      return json(res, 200, found)
    }
    // 这条灵感的素材文件：从路径或浏览器选的文件读进来，正文落盘，state 里只留引用
    case 'item-materials/add': return json(res, 200, await attachMaterials({ store, itemId: String(body.id ?? ''), paths: Array.isArray(body.paths) ? body.paths : [], files: Array.isArray(body.files) ? body.files : [] }))
    case 'item-materials/remove': return json(res, 200, await removeMaterial({ store, itemId: String(body.id ?? ''), materialId: String(body.materialId ?? '') }))
    // 写作工作流：列出这个设置下能读到的文档（字数是真读出来的）和勾选状态，给设置页和成稿前那行字用
    case 'writing-flow/scan': {
      const saved = await desk.settings.read()
      const paths = Array.isArray(body.paths) ? body.paths : saved.writingFlow?.paths ?? []
      const selected = body.selected === null || Array.isArray(body.selected) ? body.selected : saved.writingFlow?.selected ?? null
      return json(res, 200, await detectFlow({ paths, selected, workspace: await ensureWorkspace(desk.native.cwd) }))
    }
    // 按勾选真读一遍：界面上的「已加载 N 份，共 M 字」是会注入的字数（含截断说明），超预算的整份列出来
    case 'writing-flow/preview': {
      const saved = await desk.settings.read()
      const paths = Array.isArray(body.paths) ? body.paths : saved.writingFlow?.paths ?? []
      const selected = body.selected === null || Array.isArray(body.selected) ? body.selected : saved.writingFlow?.selected ?? null
      const found = await detectFlow({ paths, selected, workspace: await ensureWorkspace(desk.native.cwd) })
      return json(res, 200, await readFlow(found.docs.filter(row => row.on)))
    }
    case 'titles/generate': return json(res, 200, await generateTitles({ store, callText: options => callModel(ctx, { ...options, task: '标题候选' }) }, body))
    case 'produce/cancel':
      if (desk.native.active(String(body.id))) await desk.native.cancel(String(body.id))
      await desk.producer.cancel(String(body.id))
      return json(res, 200, { ok: true })
    case 'produce/regen':
      await desk.producer.regenerate(String(body.id), body.target)
      return json(res, 200, { state: await store.read() })
    // 无依据的经历句改成观察口吻：index 是一句，不传（或 all: true）就是全部
    case 'produce/observe':
    case 'claims/rewrite': {
      const result = await desk.producer.observe(String(body.id), { index: Number.isInteger(body.index) ? body.index : undefined })
      return json(res, 200, { ...result, state: await store.read() })
    }
    // 作者确认是真的经历：保留，以后不再标
    case 'claims/keep': {
      const result = await desk.producer.keepClaims(String(body.id), { index: Number.isInteger(body.index) ? body.index : undefined })
      return json(res, 200, { ...result, state: await store.read() })
    }
    case 'produce/save': {
      const settings = await desk.settings.read()
      const state = await store.read()
      const item = state.items.find(row => row.id === body.id)
      if (!item?.production?.article) return json(res, 400, { error: tr('还没有可以保存的成稿') })
      await store.read()
      // 视频封面由浏览器合成（画面叠大字），这里只接受 JPEG
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.videoCover ?? '')
      const videoCover = match ? Buffer.from(match[1], 'base64') : null
      if (videoCover && !(videoCover[0] === 0xff && videoCover[1] === 0xd8)) return json(res, 400, { error: tr('封面不是有效的图片') })
      const saved = await saveProduction(item.production, { filesDir: store.filesDir, exportDir: resolveExportDir(settings.exportDir), videoCover })
      const next = await store.mutate('保存成稿', (draft) => {
        const target = draft.items.find(row => row.id === body.id)
        if (target?.production) {
          target.production.savedPath = saved.path
          target.production.savedAt = new Date().toISOString()
        }
        return draft
      }, { undoable: false })
      return json(res, 200, { ...saved, state: next })
    }
    case 'produce/reveal': {
      // 路径只取自保存记录，不接受请求里传来的路径
      const state = await store.read()
      const path = state.items.find(row => row.id === body.id)?.production?.savedPath
      if (!path) return json(res, 400, { error: tr('还没有保存过') })
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(command, [path], () => {})
      return json(res, 200, { path })
    }
    case 'style/extract': return json(res, 200, await extractStyle(ctx, store, body))
    // 导入文件夹里的 Markdown 稿子：先预览，确认后整批导入（一步撤销）；只读文件，不写回去
    // 可以一次读几个文件夹（folders: [{dir, depth, published}]），同一篇的公众号稿和小红书正文、图片版合成一篇；split / keep 是用户拆开的组和重复文件留哪份
    case 'import/scan': {
      const scans = await scanFolders(body)
      return json(res, 200, previewImport(await store.read(), scans, { split: body.split, keep: body.keep }))
    }
    case 'import/run': {
      const scans = await scanFolders(body)
      const name = scans.map(scan => scan.name).join('、')
      const report = await store.mutate(tr('导入文件夹「{name}」', { name }), draft => importScans(draft, scans, { paths: body.paths, split: body.split, keep: body.keep }))
      return json(res, 200, { ...report, dir: scans[0]?.dir, name, state: await store.read() })
    }
    case 'import/remove': {
      const dir = String(body.dir ?? '')
      const result = await store.mutate(tr('移除从「{name}」导入的内容', { name: dir.split(/[\\/]/).pop() }), draft => removeImported(draft, dir))
      return json(res, 200, { ...result, state: await store.read() })
    }
    case 'settings': {
      const before = modelInfo(ctx)
      const updated = await desk.settings.update(body)
      setAssistantModel(updated.assistant)
      const after = modelInfo(ctx)
      // 换了模型，上一个模型的失败状态不再算数
      if (before?.provider !== after?.provider || before?.model !== after?.model) Object.assign(modelStatus, { ok: null, error: null })
      return json(res, 200, { ...publicSettings(updated, Boolean(imageTool(ctx))), defaultExportDir: defaultExportDir(), assistantEffective: modelInfo(ctx)?.label ?? null })
    }
    case 'settings/test': {
      if (!nativeReady(ctx)) return json(res, 503, { error: '请在本地 DSH 中测试生图，当前没有原生 Agent 会话服务' })
      const settings = await desk.settings.read()
      if (!desk.producer.ready(settings)) return json(res, 400, { error: tr(settings.image.source === 'tool' ? '未找到订阅生图工具，或默认执行器不支持直接调用；请检查插件和执行器后刷新工作台' : '先填好接口地址、模型和密钥') })
      await store.read()
      const { buffer, ext } = await desk.producer.generate(settings.image, 'A single paper boat on calm water, black and white pencil line art sketch, plain white paper background, no text.')
      const name = `${newId('t')}${ext}`
      await writeFile(join(store.filesDir, name), buffer)
      return json(res, 200, { src: `media-desk/files/${name}` })
    }
    case 'feeds/fetch': return json(res, 200, await desk.sources.readFeeds((await store.read()).feeds ?? [], { force: body.force === true, cachedOnly: body.cachedOnly === true, language: currentLang() }))
    case 'hot/fetch': return json(res, 200, await desk.sources.readHot(Array.isArray(body.sources) ? body.sources.filter(id => typeof id === 'string') : undefined, { force: body.force === true, cachedOnly: body.cachedOnly === true, language: currentLang() }))
    case 'builtin/fetch': {
      // 只读用户打开了的分组
      const enabled = (await store.read()).builtin ?? []
      return json(res, 200, await desk.sources.readBuiltin(Array.isArray(body.ids) ? body.ids.filter(id => enabled.includes(id)) : enabled, { force: body.force === true, cachedOnly: body.cachedOnly === true, language: currentLang() }))
    }
    case 'ideas/angle-score': {
      // 只是给用户参考的分，不写进评分卡
      const state = await store.read()
      const item = state.items.find(row => row.id === body.id)
      if (!item) return json(res, 404, { error: tr('找不到这条灵感') })
      const { system, user } = anglePrompts(item, focusOf(state).topics)
      try {
        const { text, model } = await callModel(ctx, { system, user, maxTokens: 300, light: true, signal: AbortSignal.timeout(60_000) })
        return json(res, 200, { ...parseAngle(extractJson(text)), model: model ?? null })
      } catch (err) {
        throw Object.assign(new Error(tr('参考分需要文字模型：{error}', { error: err.message })), { status: 502 })
      }
    }
    case 'rivals/refresh': {
      // 一次只跑一轮，免得连点几下把同一批主页读好几遍
      if (desk.readingRivals) throw Object.assign(new Error(tr('上一轮还在读，等它结束再试')), { status: 409 })
      desk.readingRivals = true
      try {
        // ids：只读这几个（刚加的账号加完就读一次）；不传就全读
        const results = await readRivals(pickRivals((await store.read()).rivals, body.ids))
        const fetchedAt = new Date().toISOString()
        const ops = [
          ...results.filter(row => row.followers !== null).map(row => ({ op: 'log_rival', rivalId: row.id, followers: row.followers, works: row.works ?? undefined, name: row.name ?? undefined })),
          ...results.map(row => ({ op: 'update_rival', id: row.id, fetchError: row.error ?? '', fetchedAt })),
        ]
        const state = ops.length ? await store.mutate(tr('读取对标账号'), draft => (applyOps(draft, ops), draft)) : await store.read()
        return json(res, 200, { results, state, fetchedAt })
      } finally {
        desk.readingRivals = false
      }
    }
    case 'followers/refresh': {
      // 手动点「立即读取」：和每天的定时读同一套，读粉丝和其他账号数据；一次只跑一轮
      // scope 是 public 的是打开大屏时的后台补读：只读公开接口，不碰创作后台；不再过期了就不读
      if (body.scope === 'public') {
        const state = await store.read()
        const saved = await desk.settings.read()
        if (desk.readingAccounts || !publicStale({ now: new Date(), last: state.autoRead, settings: saved.autoRead, hasLinks: (state.accounts ?? []).some(account => !account.sample && account.url) })) return json(res, 200, { results: [], state, skipped: true })
        desk.readingAccounts = true
        try {
          const run = await runAccountRead(store, { trigger: 'refresh', scope: 'public' })
          return json(res, 200, { results: run.results, state: run.state, skipped: Boolean(run.skipped) })
        } finally {
          desk.readingAccounts = false
        }
      }
      if (desk.readingAccounts) throw Object.assign(new Error(tr('上一轮还在读，等它结束再试')), { status: 409 })
      desk.readingAccounts = true
      try {
        const saved = await desk.settings.read()
        const run = await runAccountRead(store, { trigger: 'manual', platforms: Array.isArray(body.platforms) ? body.platforms.filter(name => typeof name === 'string') : undefined, backstage: desk.backstage(saved) ?? undefined })
        if (run.skipped) throw Object.assign(new Error(run.skipped), { status: 409 })
        return json(res, 200, { results: run.results, state: run.state })
      } finally {
        desk.readingAccounts = false
      }
    }
    case 'backstage/login': {
      // 有界面地打开专用浏览器和各后台的登录页，登录由用户自己在里面做；第一次点过之后默认打开「登录后的创作后台」
      const names = Array.isArray(body.platforms) ? BACKSTAGE_PLATFORMS.filter(name => body.platforms.includes(name)) : BACKSTAGE_PLATFORMS
      await launchVisible({ ...desk.browserTarget, urls: (names.length ? names : BACKSTAGE_PLATFORMS).map(name => BACKSTAGE[name].login) })
      const saved = await desk.settings.read()
      if (saved.backstage?.enabled === null) await desk.settings.update({ backstage: { enabled: true } })
      return json(res, 200, { ok: true })
    }
    case 'capture-url': return json(res, 200, await addFromUrl(ctx, store, body))
    // 记灵感时贴的本地 Markdown 路径：读文件当素材，不再把路径当成标题
    case 'capture-file': return json(res, 200, await addFromNoteFile(store, body))
    case 'publish/wechat-draft': {
      // 只建草稿，不发布；草稿已经在公众号后台了，这一步不进撤销
      // 浏览器会带上按用户选的长文主题排好的 html，Host 清洗后再用；没带就用朴素排版
      const pending = (await store.read()).items.find(row => row.id === body.id)?.publish?.公众号?.publishId
      if (pending) return json(res, 409, { error: tr('上一次的发布已经提交，结果还没查到。先点「查询发布结果」') })
      const saved = await desk.settings.read()
      desk.imageCache ??= new ImageHostCache(store.root)
      // 正文里的工作台图片先传到公众号素材库（uploadimg），换成公众号能显示的地址
      const { mediaId, imageErrors } = await draftFromItem({ store, settings: saved, id: body.id, html: body.html, hostImages: async html => hostArticleImages({ html, settings: saved, filesDir: store.filesDir, cache: desk.imageCache, importedPath: name => store.read().then(state => allowedImportedImage(state, name)) }) })
      const state = await store.mutate(tr('推到公众号草稿箱'), (draft) => {
        // 已经标成已发布的不退回草稿
        const published = draft.items.find(row => row.id === body.id)?.publish?.公众号?.state === 'published'
        // 记下草稿的 media_id：公开发布时要核对用户确认的就是这一份
        if (!published) applyOps(draft, [{ op: 'set_publish', id: body.id, platform: '公众号', state: 'drafted', mediaId }])
        return draft
      }, { undoable: false })
      return json(res, 200, { mediaId, state, imageErrors })
    }
    // 图文卡片导出要把正文里的公网图片画进卡片：浏览器跨域取不到时由这里代取（只连公网），返回 data URL
    case 'layouts/fetch-image': {
      const { buffer, type } = await fetchRemoteImage(body.url)
      return json(res, 200, { src: `data:${type};base64,${buffer.toString('base64')}` })
    }
    // 长文里的工作台图片上传到设置里的图床，返回 原地址 → 公网地址
    case 'layouts/host-images': {
      desk.imageCache ??= new ImageHostCache(store.root)
      return json(res, 200, await uploadMany({ settings: await desk.settings.read(), srcs: body.srcs, filesDir: store.filesDir, cache: desk.imageCache, importedPath: name => store.read().then(state => allowedImportedImage(state, name)) }))
    }
    // 公开发布：必须带 confirm: true，且 mediaId 和这篇当前的草稿一致；细节见 wechat-publish.js
    case 'publish/wechat-publish': return json(res, 200, await publishFromItem({ store, settings: await desk.settings.read(), body }))
    case 'publish/wechat-status': return json(res, 200, await publishStatusOfItem({ store, settings: await desk.settings.read(), body }))
    case 'publish/wechat-cancel': return json(res, 200, { stopped: stopWaiting(String(body.id ?? '')) })
    // 多平台草稿：经 Wechatsync 浏览器扩展，只存草稿
    case 'sync/check': return json(res, 200, await checkSync({ bridge: desk.bridge, settings: await desk.settings.read() }))
    case 'sync/drafts': {
      const item = (await store.read()).items.find(row => row.id === body.id)
      if (!item) return json(res, 404, { error: tr('找不到这条内容') })
      const results = await syncDrafts({ bridge: desk.bridge, settings: await desk.settings.read(), item, platforms: body.platforms })
      const ops = results.filter(row => row.ok && item.publish?.[row.platform]?.state !== 'published').map(row => ({ op: 'set_publish', id: item.id, platform: row.platform, state: 'drafted', url: row.url }))
      const state = ops.length ? await store.mutate(tr('同步到平台草稿'), draft => (applyOps(draft, ops), draft), { undoable: false }) : await store.read()
      return json(res, 200, { results, state })
    }
    case 'account/refresh': return json(res, 200, await refreshAccount(store, body))
    case 'skills/learn': {
      const proposals = proposeRules(await store.read())
      if (!proposals.length) return json(res, 200, { added: 0, state: await store.read() })
      const state = await store.mutate(tr('从数据中学习'), (draft) => {
        // 只用示例数据算出来的建议也算示例，清空示例时一起清掉，也不会被导出
        const fromSamples = !draft.metrics.some(metric => !metric.sample)
        const { receipts } = applyOps(draft, proposals.map(row => ({ op: 'add_skill', ...row, status: 'proposed' })))
        if (fromSamples) for (const receipt of receipts) { const skill = draft.skills.find(row => row.id === receipt?.target); if (skill) skill.sample = true }
        return draft
      })
      return json(res, 200, { added: proposals.length, state })
    }
    case 'skills/export': {
      const state = await store.read()
      const result = await exportSkill(state, dshHome())
      const next = await store.mutate('导出写作规则', (draft) => {
        applyOps(draft, draft.skills.filter(s => !s.sample && s.status === 'active').map(s => ({ op: 'update_skill', id: s.id, status: 'exported' })))
        return draft
      }, { undoable: false })
      return json(res, 200, { ...result, state: next })
    }
    default: return json(res, 404, { error: tr('接口不存在') })
  }
}

/**
 * Web 服务不会替插件路由鉴权，所以每个请求都要自己走一遍 Host/Origin 和登录凭证检查。
 * 拿不到鉴权服务时一律拒绝。
 * @param {object} ctx - Cordis 上下文。
 * @param {{headers: object}} req - HTTP 请求。
 * @returns {number|undefined} 拒绝时的状态码；可以继续时为 undefined。
 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

export const name = 'dsh-ip-workbench'

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    // 不放示例内容：工作台里出现的都是用户自己的真实数据
    // 演示或截图时想看示例，启动前设 MEDIA_DESK_SAMPLES=1
    const store = new Store(undefined, { samples: process.env.MEDIA_DESK_SAMPLES === '1' })
    const settings = new Settings(store.root)
    const cwd = workspacePath(store.root)
    let workspaceReady
    configureNativeTasks(ctx, {
      cwd,
      record: row => store.mutate('DSH 任务状态', state => {
        const previous = (state.aiTasks ?? []).find(task => task.id === row.id)
        state.aiTasks = [{ ...previous, ...row }, ...(state.aiTasks ?? []).filter(task => task.id !== row.id)].slice(0, 30)
      }, { undoable: false }),
    })
    const producer = new Producer({
      store, settings, callText: options => callModel(ctx, options),
      ready: saved => nativeReady(ctx) && imageReady(saved, Boolean(imageTool(ctx))),
      generate: (image, prompt, options) => generateNativeImage(ctx, store.root, image, prompt, options),
    })
    const versioner = new Versioner({ store, settings, callText: options => callModel(ctx, { ...options, task: '平台版本' }) })
    const illustrator = new Illustrator({ store, settings, callText: options => callModel(ctx, { ...options, task: '文章配图规划' }), generate: producer.generate, ready: saved => producer.ready(saved) })
    // Wechatsync 扩展的本地桥：用到时才监听 127.0.0.1:9527，插件卸载时关掉
    const bridge = new ExtensionBridge()
    ctx.effect(() => () => bridge.close(), 'dsh-media-desk: wechatsync bridge')
    // 专用浏览器：默认是数据目录下的 browser-profile。两个环境变量只给开发测试用，把读取指到一个已经开着调试端口的浏览器上
    const browserTarget = { profileDir: process.env.MEDIA_DESK_BROWSER_PROFILE || join(store.root, 'browser-profile'), port: Number(process.env.MEDIA_DESK_BROWSER_PORT) || null }
    // 设置里开了「登录后的创作后台」才给：一轮里打开浏览器、调模型认数
    const backstage = saved => (saved.backstage?.enabled === true ? { open: () => browserSession(browserTarget), callText: options => callModel(ctx, options) } : null)
    const native = new NativeAgent({ ctx, store, settings, cwd })
    const desk = { native, settings, producer, versioner, illustrator, bridge, browserTarget, backstage, sources: new SourceCache(store.root) }
    // 每天到设定时间自动读一遍各平台账号数据；插件卸载、热重载时停掉定时器
    ctx.effect(() => startDailyRead({ store, settings, desk, backstage, lang: () => desk.lang, onError: (err) => { desk.autoReadError = err.message || String(err) } }), 'dsh-media-desk: daily account read')
    // 启动时恢复用户在工作台里选过的助手模型
    settings.read().then(saved => setAssistantModel(saved.assistant)).catch(() => {})
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/media-desk',
      handler: async (req, res) => {
        try {
          const rejection = requestRejection(ctx, req)
          if (rejection) {
            json(res, rejection, { error: tr('未授权') })
            return
          }
          // 记下界面语言，后台定时读取写原因时用
          if (req.headers['x-media-desk-lang']) desk.lang = req.headers['x-media-desk-lang']
          await (workspaceReady ??= ensureWorkspace(cwd).catch(error => { workspaceReady = null; throw error }))
          await withLang(req.headers['x-media-desk-lang'], () => route(ctx, store, desk, req, res))
        } catch (err) {
          if (res.headersSent) {
            res.end()
            return
          }
          json(res, err.status || 500, { error: err.message })
        }
      },
    }), 'dsh-media-desk: /media-desk routes')
  },
}
