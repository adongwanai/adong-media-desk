// dsh-media-desk host 半片：/media-desk/* 接口、文件服务和模型调用。
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { assistantModelOverride, callLightModel, callModel, defaultSelection, extractJson, modelInfo, modelStatus, setAssistantModel } from './ai.js'
import { defaultExportDir, resolveExportDir, saveProduction } from './export.js'
import { harvest, harvestText, readTweet, tweetId } from './harvest.js'
import { looksLikePath, readNoteFile } from './note-file.js'
import { cleanCreation } from './creation.js'
import { generateNativeImage } from './native-image.js'
import { configureNativeTasks } from './native-task.js'
import { imageTool } from './image-tool.js'
import { computeInsights, exportSkill, proposeRules } from './learn.js'
import { readObsidianNoteToRed } from './obsidian-yanqi.js'
import { computeBoard } from './board.js'
import { applyOps, newId } from './ops.js'
import { Producer } from './produce.js'
import { updateVersion, Versioner } from './versions.js'
import { Illustrator } from './illustrate.js'
import { findMaterials } from './materials.js'
import { attachMaterials, removeMaterial } from './item-materials.js'
import { detectFlow, PRODUCTION_DOC_CHARS, PRODUCTION_FLOW_BUDGET, readFlow } from './writing-flow.js'
import { generateTitles } from './titles.js'
import { publicSettings, Settings, imageReady } from './settings.js'
import { fetchRemoteImage, hostArticleImages, ImageHostCache, uploadMany } from './image-host.js'
import { SourceCache } from './source-cache.js'
import { readSupport } from './collect.js'
import { isRunning, publicStale, runAccountRead, startDailyRead } from './daily-read.js'
import { BACKSTAGE, BACKSTAGE_PLATFORMS, browserSession } from './backstage.js'
import { launchVisible } from './cdp.js'
import { anglePrompts, parseAngle } from './idea-score.js'
import { focusOf, topicHits } from './rank.js'
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
import { NativeAgent, nativeReady } from './native-agent.js'

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const MAX_JSON = 4_000_000
const MAX_UPLOAD = 250_000_000
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.json': 'application/json; charset=utf-8' }
const UPLOAD_EXT = Object.fromEntries(Object.entries(MIME).filter(([ext, type]) => ext !== '.jpeg' && (type.startsWith('image/') || type.startsWith('video/'))).map(([ext, type]) => [type, ext]))

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  const raw = JSON.stringify(body)
  if (res._acceptGzip && raw.length >= 1024) {
    const gz = gzipSync(Buffer.from(raw, 'utf8'), { level: 1 })
    res.setHeader('content-encoding', 'gzip')
    res.setHeader('vary', 'accept-encoding')
    res.setHeader('content-length', gz.length)
    res.end(gz)
    return
  }
  res.end(raw)
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

/** 异步拉起原生会话（创建 session / 读取参考 / 抓取链接）期间的轻量预热状态，让前端零延迟进入成稿界面。 */
const LAUNCHING = new Map()
const LAUNCHING_MS = 3 * 60_000
const launchKey = (store, id) => `${store.root ?? ''}::${id}`
function getLaunching(store, id) {
  const key = launchKey(store, id)
  const row = LAUNCHING.get(key)
  if (!row) return null
  if (Date.now() - row.startedAt > LAUNCHING_MS) { LAUNCHING.delete(key); return null }
  return row
}
async function recordLaunchFailure(store, id, previous, err) {
  const msg = err?.message || String(err)
  await store.mutate('记录启动异常', (draft) => {
    const target = draft.items.find(row => row.id === id)
    if (!target) return
    if (target.production?.status === 'running' || target.production?.status === 'done') return
    if (previous) target.production = { ...previous, error: msg }
    else target.production = { status: 'failed', stage: 'done', engine: 'dsh-native', error: msg }
  }, { undoable: false }).catch(() => {})
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
  // Karakeep 式正文快照：顺手把网页可读正文存进素材，防止日后原链接 404 或成稿时只有一句简介
  const fullPage = await harvestText(url).catch(() => null)
  const op = {
    op: 'add_item', kind: 'web', title: body.title || info.title || url, body: body.note || info.description || (fullPage?.text ? fullPage.text.slice(0, 280) : ''), url: info.url, source: info.siteName, tags: Array.isArray(body.tags) ? body.tags : [],
    media: info.image ? { src: info.image } : null,
  }
  const saved = await store.mutate(tr('收藏《{title}》', { title: op.title.slice(0, 12) }), (draft) => {
    const { receipts, errors } = applyOps(draft, [op])
    return { receipts, errors, id: receipts[0]?.target, state: draft }
  })
  if (saved.id && fullPage?.text && fullPage.text.length >= 160) {
    const safeName = String(op.title || info.siteName || '网页').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 28) || '网页'
    const snapshotMd = `# ${fullPage.title || op.title}\n\n来源：${info.url}\n\n${fullPage.text.slice(0, 80000)}`
    const attached = await attachMaterials({ store, itemId: saved.id, paths: [], files: [{ name: `${safeName}-网页快照.md`, text: snapshotMd }] }).catch(() => null)
    if (attached?.state) return { ...saved, state: attached.state, snapshotSaved: true }
  }
  return saved
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

const MAX_ATTACH_BYTES = 80 * 1024 * 1024

/** 通用原生附件上传：原样落盘到 filesDir（支持 PDF、Office、图片、数据表、长文档、代码等），供 DSH 原生会话直接按路径读取解析。 */
async function handleAttach(req, url, store, res) {
  const rawName = (url.searchParams.get('name') || 'attachment').trim()
  const itemId = (url.searchParams.get('itemId') || '').trim()
  const mime = ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream').slice(0, 100)
  const buffer = await readBuffer(req, MAX_ATTACH_BYTES)
  await store.read()
  const extMatch = /\.[a-z0-9]{1,10}$/i.exec(rawName)
  const ext = extMatch ? extMatch[0].toLowerCase() : (UPLOAD_EXT[mime] ?? '')
  const file = `${newId('att')}${ext}`
  await writeFile(join(store.filesDir, file), buffer)
  const attachment = {
    id: newId('att'),
    name: rawName.slice(0, 160) || file,
    file,
    mime,
    bytes: buffer.length,
    at: new Date().toISOString(),
  }
  // 轻量纯文本文件顺带同步一份进 materials 方便属性表展示字数，二进制/PDF/图片等直接交由 DSH 原生工具按真实磁盘路径解析
  let state = null
  if (itemId) {
    const mutated = await store.mutate(tr('挂载附件'), (draft) => {
      const { errors } = applyOps(draft, [{ op: 'add_attachment', id: itemId, attachment }])
      if (errors.length) throw Object.assign(new Error(errors[0]), { status: 400 })
      return { state: draft }
    })
    state = mutated.state
    if (looksLikePath(rawName) && buffer.length <= 400_000) {
      const text = buffer.toString('utf8')
      if (!text.includes('\u0000') && text.trim()) {
        const synced = await attachMaterials({ store, itemId, files: [{ name: attachment.name, text }], paths: [] }).catch(() => null)
        if (synced?.state) state = synced.state
      }
    }
  }
  return json(res, 200, { attachment, src: `media-desk/files/${file}`, ...(state ? { state } : {}) })
}

async function route(ctx, store, desk, req, res) {
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/^\/media-desk\/?/, '')
  const method = req.method || 'GET'
  res._acceptGzip = method !== 'HEAD' && /\bgzip\b/i.test(req.headers?.['accept-encoding'] ?? '')
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
      const prevSig = url.searchParams.get('sig')
      const prevChatSig = url.searchParams.get('chatSig')
      if (!desk.native.active(id)) await desk.producer.settle(id)
      await desk.versioner.settle(id)
      const state = await store.read()
      const item = state.items.find(row => row.id === id)
      const launching = getLaunching(store, id)
      const rawLive = desk.native.status(id) ?? desk.producer.status(id)
      const useLaunching = Boolean(launching && item && item.production?.status !== 'running')
      const production = useLaunching
        ? {
          ...(item.production ?? {}),
          status: 'running',
          stage: 'connecting',
          engine: 'dsh-native',
          format: launching.goal === 'script' ? 'script' : 'article',
          title: item.production?.title || item.title || '',
          article: '',
          images: item.production?.images ?? [],
          shots: item.production?.shots ?? [],
          startedAt: new Date(launching.startedAt).toISOString(),
        }
        : (item?.production ?? null)
      const live = rawLive ?? (useLaunching ? {
        native: true,
        running: true,
        phase: launching.phase || 'connecting',
        startedAt: launching.startedAt,
        updatedAt: launching.updatedAt || launching.startedAt,
        text: '',
        reply: '',
        reasoning: '',
        activity: launching.activity ?? [],
      } : null)
      const lastChat = state.chat.at(-1)
      const chatSig = `${state.chat.length}:${lastChat?.id ?? ''}:${(lastChat?.text ?? '').length}`
      const versionsKey = Object.entries(production?.versions ?? {}).map(([k, v]) => `${k}:${v?.status ?? ''}:${(v?.body ?? '').length}`).join(',')
      const assetsKey = [production?.cover, ...(production?.images ?? []), ...(production?.shots ?? [])].filter(Boolean).map(a => `${a.status}:${a.src ?? ''}`).join(',')
      const liveKey = live ? `${live.running ?? ''}:${live.phase ?? live.step ?? ''}:${(live.text ?? '').length}:${(live.reply ?? '').length}:${(live.reasoning ?? '').length}:${live.activity?.length ?? 0}:${live.updatedAt ?? ''}` : 'idle'
      const sig = `${item?.status ?? ''}|${production?.status ?? ''}|${production?.stage ?? ''}|${production?.updatedAt ?? production?.finishedAt ?? ''}|${(production?.article ?? '').length}|${versionsKey}|${assetsKey}|${liveKey}|${chatSig}`
      if (prevSig && prevSig === sig) {
        return json(res, 200, { unchanged: true, sig, chatSig })
      }
      return json(res, 200, {
        production,
        status: item?.status,
        ...(prevChatSig && prevChatSig === chatSig ? {} : { chat: state.chat }),
        live,
        sig,
        chatSig,
      })
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
  if (path === 'attach') return handleAttach(req, url, store, res)
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
      if (!desk.native.ready()) return json(res, 503, { error: '未连接 DSH 原生 Agent。请在本地 DSH 中打开阿东 IP 工作台；独立预览不支持对话。' })
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
      const targetId = String(body.id)
      const produceOpts = {
        goal: body.goal,
        mode: body.mode,
        audience: body.audience,
        thesis: body.thesis,
        creation: body.creation,
      }
      if (body.asyncStart === true) {
        const curState = await store.read()
        const targetItem = curState.items.find(row => row.id === targetId)
        if (!targetItem) return json(res, 404, { error: tr('找不到这个选题') })
        if (targetItem.production?.status === 'running' || desk.native.active(targetId) || getLaunching(store, targetId)) {
          return json(res, 200, { started: false, launching: true, state: curState })
        }
        const previous = targetItem.production ? structuredClone(targetItem.production) : null
        const resolvedGoal = body.goal || targetItem.creation?.goal || 'xhs'
        const key = launchKey(store, targetId)
        const entry = { startedAt: Date.now(), updatedAt: Date.now(), goal: resolvedGoal, phase: 'connecting', cancelled: false, activity: [] }
        LAUNCHING.set(key, entry)
        desk.versioner.cancel(targetId)
        Promise.resolve().then(async () => {
          if (entry.cancelled) return
          await desk.native.start(targetId, produceOpts)
        }).catch(async (err) => {
          if (!entry.cancelled) await recordLaunchFailure(store, targetId, previous, err)
        }).finally(() => {
          if (LAUNCHING.get(key) === entry) LAUNCHING.delete(key)
        })
        return json(res, 200, { started: true, launching: true, state: curState })
      }
      const started = await desk.native.start(targetId, produceOpts)
      // 重新成稿会换掉母稿，还在写的平台版本没有意义了
      if (started) desk.versioner.cancel(targetId)
      return json(res, 200, { started, state: await store.read() })
    }
    case 'idea/launch':
    case 'brief/launch': {
      // 从灵感胶囊直接开写（或仅保存带附件的灵感）：建/更新选题 + 挂原样附件与链接 + 切换风格 + 可选立即进入原生会话成稿
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
      const rawBody = typeof body.body === 'string' ? body.body.trim() : ''
      const files = Array.isArray(body.files) ? body.files.filter(f => f && typeof f === 'object' && typeof f.text === 'string' && f.text.trim()) : []
      const attachments = Array.isArray(body.attachments) ? body.attachments.filter(a => a && typeof a === 'object' && typeof a.file === 'string') : []
      const rawPaths = (Array.isArray(body.paths) ? body.paths : []).map(p => String(p ?? '').trim()).filter(Boolean).slice(0, 20)
      const textPaths = rawPaths.filter(looksLikePath)
      const agentRefPaths = rawPaths.filter(p => !looksLikePath(p))
      const urls = (Array.isArray(body.urls) ? body.urls : []).map(u => String(u ?? '').trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 8)
      const creation = cleanCreation({
        ...(body.creation && typeof body.creation === 'object' ? body.creation : {}),
        ...(body.goal ? { goal: body.goal } : {}),
        ...(agentRefPaths.length ? { refPaths: [...new Set([...(body.creation?.refPaths ?? []), ...agentRefPaths])] } : {}),
      })
      const goal = creation.goal || 'xhs'
      if (!rawTitle && !rawBody && !creation.thesis && !creation.requirements && !attachments.length && !files.length && !rawPaths.length && !urls.length) {
        return json(res, 400, { error: tr('请输入灵感内容，或添加参考附件') })
      }
      const harvestUrls = async () => {
        const urlFiles = []
        for (const u of urls) {
          try {
            const tweet = tweetId(u) ? await readTweet(u).catch(() => null) : null
            if (tweet?.body) {
              const safe = String(tweet.title || '推文').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 24) || '推文'
              urlFiles.push({ name: `${safe}.md`, text: `# ${tweet.title || 'X 推文'}\n\n来源：${tweet.url}\n\n${tweet.body}` })
              continue
            }
            const page = await harvestText(u)
            if (page?.text?.length >= 40) {
              const safe = String(page.title || new URL(u).hostname).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 26) || '参考网页'
              urlFiles.push({ name: `${safe}.md`, text: `# ${page.title || u}\n\n来源：${page.url}\n\n${page.text.slice(0, 80000)}` })
            }
          } catch {
            // 静态抓取受限时静默保留原始 URL，交由 DSH 原生会话的搜索与网页工具读取
          }
        }
        return urlFiles
      }
      const attachBatches = async (itemId, extraUrlFiles) => {
        const allFiles = [...files, ...extraUrlFiles]
        const attachErrors = []
        let added = attachments.length
        for (let i = 0; i < allFiles.length || (i === 0 && textPaths.length); i += 10) {
          const batchFiles = allFiles.slice(i, i + 10)
          const batchPaths = i === 0 ? textPaths.slice(0, Math.max(0, 10 - batchFiles.length)) : []
          if (!batchFiles.length && !batchPaths.length) break
          const attached = await attachMaterials({ store, itemId, files: batchFiles, paths: batchPaths }).catch(err => ({ added: [], errors: [{ name: '素材', reason: err.message }] }))
          added += attached.added?.length ?? 0
          for (const e of attached.errors ?? []) attachErrors.push(`${e.name}：${e.reason}`)
        }
        return { addedCount: added, attachErrors }
      }
      const asyncLaunch = body.asyncStart === true && body.startNow !== false
      const syncUrlFiles = asyncLaunch ? [] : await harvestUrls()
      const fallbackTitle = (creation.thesis || rawBody || attachments[0]?.name?.replace(/\.[^.]+$/, '') || files[0]?.name?.replace(/\.[^.]+$/, '') || syncUrlFiles[0]?.name?.replace(/\.[^.]+$/, '') || urls[0] || tr('未命名灵感'))
        .split(/[。！？\n]|[.!?](?=\s|$)/)[0].trim().slice(0, 60) || tr('未命名灵感')
      const finalTitle = rawTitle || fallbackTitle
      const existingId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null
      const mutated = await store.mutate(existingId ? tr('更新灵感') : tr('记下灵感《{title}》', { title: finalTitle.slice(0, 14) }), (draft) => {
        if (typeof body.styleId === 'string' && (draft.styles ?? []).some(s => s.id === body.styleId)) {
          draft.activeStyleId = body.styleId
        }
        if (existingId) {
          const ops = [
            { op: 'update_item', id: existingId, title: finalTitle, ...(body.body !== undefined ? { body: rawBody } : {}), ...(body.media ? { media: body.media } : {}) },
            { op: 'set_creation', id: existingId, ...creation, goal },
            ...attachments.map(attachment => ({ op: 'add_attachment', id: existingId, attachment })),
          ]
          const { errors } = applyOps(draft, ops)
          if (errors.length) throw Object.assign(new Error(errors[0]), { status: 400 })
          return { id: existingId }
        }
        const op = {
          op: 'add_item',
          kind: body.media ? 'image' : urls.length === 1 && !files.length && !attachments.length ? 'web' : 'note',
          title: finalTitle,
          body: rawBody,
          ...(urls[0] ? { url: urls[0] } : {}),
          ...(body.media ? { media: body.media } : {}),
          ...(attachments.length ? { attachments } : {}),
          creation: { ...creation, goal },
        }
        const { receipts, errors } = applyOps(draft, [op])
        if (errors.length) throw Object.assign(new Error(errors[0]), { status: 400 })
        return { id: receipts[0]?.target }
      })
      const itemId = mutated.id
      if (asyncLaunch) {
        const nativeMissing = !desk.native.ready()
        if (!nativeMissing) {
          const customPrompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : undefined
          const key = launchKey(store, itemId)
          const entry = {
            startedAt: Date.now(),
            updatedAt: Date.now(),
            goal,
            phase: urls.length ? 'tool' : 'connecting',
            cancelled: false,
            activity: urls.map((u, idx) => ({ id: `pre_${idx}`, name: 'web_fetch', status: 'running', detail: u })),
          }
          LAUNCHING.set(key, entry)
          desk.versioner.cancel(itemId)
          Promise.resolve().then(async () => {
            const urlFiles = urls.length ? await harvestUrls() : []
            if (entry.cancelled) return
            if (files.length || urlFiles.length || textPaths.length) {
              await attachBatches(itemId, urlFiles)
            }
            if (entry.cancelled) return
            entry.phase = 'connecting'
            entry.updatedAt = Date.now()
            await desk.native.start(itemId, { goal, prompt: customPrompt })
          }).catch(async (err) => {
            if (!entry.cancelled) await recordLaunchFailure(store, itemId, null, err)
          }).finally(() => {
            if (LAUNCHING.get(key) === entry) LAUNCHING.delete(key)
          })
        } else if (files.length || urls.length || textPaths.length) {
          harvestUrls().then(urlFiles => attachBatches(itemId, urlFiles)).catch(() => {})
        }
        return json(res, 200, { id: itemId, started: !nativeMissing, launching: !nativeMissing, nativeMissing, addedCount: attachments.length, errors: [], state: await store.read() })
      }
      const { addedCount, attachErrors } = await attachBatches(itemId, syncUrlFiles)
      let started = false
      let nativeMissing = false
      if (body.startNow !== false) {
        if (desk.native.ready()) {
          const customPrompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : undefined
          started = await desk.native.start(itemId, { goal, prompt: customPrompt })
          if (started) desk.versioner.cancel(itemId)
        } else {
          nativeMissing = true
        }
      }
      return json(res, 200, { id: itemId, started, nativeMissing, addedCount, errors: attachErrors, state: await store.read() })
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
      const target = typeof body.target === 'string' && body.target ? body.target : undefined
      return json(res, 200, await detectFlow({ paths, selected, target, workspace: await desk.native.workspace() }))
    }
    // 按勾选真读一遍：界面上的「已加载 N 份，共 M 字」是会注入的字数（含截断说明），超预算的整份列出来
    case 'writing-flow/preview': {
      const saved = await desk.settings.read()
      const paths = Array.isArray(body.paths) ? body.paths : saved.writingFlow?.paths ?? []
      const selected = body.selected === null || Array.isArray(body.selected) ? body.selected : saved.writingFlow?.selected ?? null
      const target = typeof body.target === 'string' && body.target ? body.target : undefined
      const found = await detectFlow({ paths, selected, target, workspace: await desk.native.workspace() })
      return json(res, 200, await readFlow(found.docs.filter(row => row.on), PRODUCTION_FLOW_BUDGET, PRODUCTION_DOC_CHARS))
    }
    case 'titles/generate': return json(res, 200, await generateTitles({ store, callText: options => callModel(ctx, { ...options, task: '标题候选' }) }, body))
    case 'produce/cancel': {
      const cancelId = String(body.id)
      const pending = getLaunching(store, cancelId)
      if (pending) {
        pending.cancelled = true
        LAUNCHING.delete(launchKey(store, cancelId))
      }
      if (desk.native.active(cancelId)) await desk.native.cancel(cancelId)
      await desk.producer.cancel(cancelId)
      const cancelledState = await store.mutate('取消成稿', (draft) => {
        const target = draft.items.find(row => row.id === cancelId)
        if (target?.production?.status === 'failed' && !target.production.article && /已停止/.test(target.production.error || '')) {
          delete target.production
        }
        return draft
      }, { undoable: false })
      return json(res, 200, { ok: true, state: cancelledState })
    }
    case 'produce/regen':
      await desk.producer.regenerate(String(body.id), body.target)
      return json(res, 200, { state: await store.read() })
    case 'produce/rewrite-selection': {
      const state = await store.read()
      const item = state.items.find(row => row.id === body.id)
      const article = item?.production?.article ?? ''
      const selection = String(body.selection ?? '').trim()
      if ((!article && typeof body.beforeContext !== 'string') || !selection) {
        return json(res, 400, { error: tr('请先选中要改写的片段') })
      }
      const idx = article ? article.indexOf(selection) : -1
      const beforeCtx = typeof body.beforeContext === 'string'
        ? body.beforeContext.slice(-700)
        : (idx >= 0 ? article.slice(Math.max(0, idx - 500), idx) : '')
      const afterCtx = typeof body.afterContext === 'string'
        ? body.afterContext.slice(0, 450)
        : (idx >= 0 ? article.slice(idx + selection.length, idx + selection.length + 350) : '')
      const activeStyle = (state.styles ?? []).find(row => row.id === state.activeStyleId)
      const presets = {
        humanize: '去掉 AI 腔、连接词套话（如“总而言之、值得注意的是、不仅…而且”）、生硬排比与客服腔，改成自然利落的真人表达。保留原有事实、专有名词与数字，绝不编造新数字或个人经历。',
        shorten: '精简到原长约 50%–65%，删掉重复铺垫和废话，保留核心判断、关键细节与数字。',
        punchy: '改写得更有力量和节奏感，第一句直接给判断，适合读者划线引用，严禁夸张标题党或编造数字。',
        clarify: '把绕口的抽象表述拆解得更直白好懂，逻辑更顺，不增加原文没有的事实或经历。',
      }
      const mode = String(body.mode ?? 'humanize')
      const customReq = String(body.instruction ?? '').trim().slice(0, 500)
      const goalText = mode === 'custom' && customReq ? customReq : (presets[mode] ?? presets.humanize)
      const isExpanding = mode === 'custom' && /(?:加|补|写|扩|续|新增|展开|插入|章节|段落)/.test(customReq)
      const styleHint = activeStyle ? `\n当前作者风格（${activeStyle.name}）：语气「${activeStyle.tone || ''}」，句式「${activeStyle.sentences || ''}」。` : ''
      const authorBio = state.author?.bio ? `\n作者真实背景：${state.author.bio}` : ''
      const topicRef = item?.body ? `\n本篇选题背景与素材摘要：\n${String(item.body).slice(0, 1200)}` : ''
      const system = isExpanding
        ? `你是中文非虚构与个人 IP 写作搭档。用户在编辑框选中了一处锚点/标题（如 "## 9." 或某几个字），要求在此处扩写、新增段落或补充章节。请严格对齐【上文衔接】里的标题层级、编号格式、段落长短、加粗高亮习惯与第一人称聊天语气，生成用来直接替换【待处理片段】的完整 Markdown 内容。铁律：只输出替换后的 Markdown 正文，绝不重复输出【上文衔接】或【下文衔接】，不要任何解释、代码块外壳或前言后语；不使用未证实的虚假数字。${authorBio}${styleHint}`
        : `你是中文非虚构与自媒体改稿编辑。只针对用户选中的片段做局部手术式改写，直接输出用来替换【待处理片段】的新片段正文（保留必要的 Markdown 行内格式），绝不重复输出上下文，不要输出任何解释、引号包裹或前言后语。严禁编造原文没有的数字、案例或第一人称亲身经历。${authorBio}${styleHint}`
      const user = `文章标题：${item?.production?.title || item?.title || ''}${topicRef}\n${beforeCtx ? `\n【上文衔接（仅供对齐格式与语境，切勿重复输出）】：\n${beforeCtx}\n` : ''}\n【待处理片段（只输出替换这一块的 Markdown）】：\n${selection}\n${afterCtx ? `\n【下文衔接（切勿重复输出）】：\n${afterCtx}\n` : ''}\n本次修改/扩写要求：${goalText}`
      try {
        const { text } = await callLightModel(ctx, { system, user, maxTokens: 2600, task: '局部改写', signal: AbortSignal.timeout(60_000) })
        const replacement = String(text ?? '').trim().replace(/^```(?:\w+)?\n([\s\S]*?)\n```$/, '$1').trim()
        if (!replacement) throw new Error(tr('模型没有返回可用的改写结果'))
        return json(res, 200, { original: selection, replacement })
      } catch (err) {
        throw Object.assign(new Error(tr('局部改写需要可用文字模型：{error}', { error: err.message })), { status: 502 })
      }
    }
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
      if (updated.assistant?.provider && updated.assistant?.model) {
        try { await ctx.get('agentDefaultModel')?.saveSelection?.({ provider: updated.assistant.provider, model: updated.assistant.model }) } catch {}
      }
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
    case 'sources/brief': {
      const state = await store.read()
      const focus = focusOf(state)
      const [feedsRes, builtinRes, hotRes] = await Promise.all([
        desk.sources.readFeeds(state.feeds ?? [], { cachedOnly: true, language: currentLang() }).catch(() => ({ entries: [] })),
        desk.sources.readBuiltin(state.builtin ?? [], { cachedOnly: true, language: currentLang() }).catch(() => ({ groups: {} })),
        desk.sources.readHot(undefined, { cachedOnly: true, language: currentLang() }).catch(() => ({ lists: [] })),
      ])
      const builtinEntries = Object.values(builtinRes?.groups ?? {}).flatMap(g => g?.entries ?? [])
      const hotEntries = (hotRes?.lists ?? []).flatMap(list => (list.items ?? []).slice(0, 8).map((it, idx) => ({
        title: it.title, summary: it.excerpt || it.metric || '', url: it.url, source: list.name, rank: idx + 1,
      })))
      const rawPool = [...(feedsRes?.entries ?? []), ...builtinEntries, ...hotEntries]
        .filter(e => e?.title && e?.url && !focus.blocked.some(w => `${e.title} ${e.summary ?? ''}`.toLowerCase().includes(w.toLowerCase())))
      if (!rawPool.length) return json(res, 200, { picks: [], mode: 'empty' })
      // 去重并按「我的方向」相关性优先挑选前 22 条给模型筛选
      const seen = new Set()
      const scored = []
      for (const entry of rawPool) {
        if (seen.has(entry.url)) continue
        seen.add(entry.url)
        const hits = topicHits(`${entry.title} ${entry.summary ?? ''}`, focus.topics)
        const score = (hits.reduce((m, h) => Math.max(m, h.share), 0) * 10) + (entry.rank ? Math.max(0, 4 - entry.rank * 0.3) : 1.5)
        scored.push({ entry, hits: hits.map(h => h.topic), score })
      }
      scored.sort((a, b) => b.score - a.score)
      const candidates = scored.slice(0, 22)
      const fallbackPicks = () => candidates.slice(0, 5).map(({ entry, hits }) => ({
        title: entry.title,
        angle: hits.length ? `命中你的关注方向「${hits.join('、')}」，适合结合自身实践拆解核心变化` : `来自 ${entry.source} 的高关注动态，可提炼核心信息差做快速解读`,
        source: entry.source,
        url: entry.url,
        summary: String(entry.summary ?? '').slice(0, 180),
      }))
      try {
        const activeStyle = (state.styles ?? []).find(row => row.id === state.activeStyleId)
        const listText = candidates.map((c, i) => `[${i}] 来源:${c.entry.source} | 标题:${c.entry.title} | 摘要:${String(c.entry.summary ?? '').slice(0, 120)}`).join('\n')
        const system = '你是资深科技与个人 IP 选题主编。从候选资讯中挑选最值得今天动笔写的 5 个高价值选题，给出差异化切入角度。严禁编造候选列表之外的新闻事实。只输出 JSON：{"picks":[{"index":0,"headline":"建议切入标题（22字内）","angle":"一句话说清怎么切入最有看点（50字内）"}]}'
        const user = `作者关注方向：${focus.topics.length ? focus.topics.join('、') : 'AI、效率工具、个人IP与技术趋势'}\n${activeStyle ? `写作风格：${activeStyle.name}（${activeStyle.summary || ''}）\n` : ''}\n今日候选池：\n${listText}`
        const { text } = await callModel(ctx, { system, user, maxTokens: 1000, light: true, task: '今日选题早报', signal: AbortSignal.timeout(45_000) })
        const parsed = extractJson(text)
        const picks = (Array.isArray(parsed?.picks) ? parsed.picks : [])
          .map((row) => {
            const hit = candidates[Number(row?.index)]
            if (!hit) return null
            return {
              title: String(row.headline || hit.entry.title).trim().slice(0, 80),
              rawTitle: hit.entry.title,
              angle: String(row.angle || '').trim().slice(0, 140),
              source: hit.entry.source,
              url: hit.entry.url,
              summary: String(hit.entry.summary ?? '').slice(0, 200),
            }
          })
          .filter(Boolean)
          .slice(0, 5)
        return json(res, 200, { picks: picks.length ? picks : fallbackPicks(), mode: picks.length ? 'ai' : 'local', generatedAt: new Date().toISOString() })
      } catch {
        return json(res, 200, { picks: fallbackPicks(), mode: 'local', generatedAt: new Date().toISOString() })
      }
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
      // scope 是 public 的是打开或刷新大屏时的后台补读：只读公开接口，不碰创作后台；不再过期了就不读
      if (body.scope === 'public') {
        const state = await store.read()
        const saved = await desk.settings.read()
        const maxAgeMs = Number.isFinite(body.maxAgeMs) && body.maxAgeMs >= 30_000 ? Number(body.maxAgeMs) : undefined
        if (desk.readingAccounts || !publicStale({ now: new Date(), last: state.autoRead, settings: saved.autoRead, hasLinks: (state.accounts ?? []).some(account => !account.sample && account.url), ...(maxAgeMs ? { maxAgeMs } : {}) })) return json(res, 200, { results: [], state, skipped: true })
        desk.readingAccounts = true
        const job = runAccountRead(store, { trigger: 'refresh', scope: 'public' })
        desk.readingPublic = job.catch(() => {})
        try {
          const run = await job
          return json(res, 200, { results: run.results, state: run.state, skipped: Boolean(run.skipped) })
        } finally {
          desk.readingPublic = null
          desk.readingAccounts = false
        }
      }
      // 打开大屏刚触发了 1–2 秒的轻量公开补读时，用户马上点「立即读取」不要直接报 409，等它收尾接着读整轮
      if (desk.readingPublic) await desk.readingPublic
      if (desk.readingAccounts) throw Object.assign(new Error(tr('上一轮还在读，等它结束再试')), { status: 409 })
      desk.readingAccounts = true
      try {
        const saved = await desk.settings.read()
        const run = await runAccountRead(store, {
          trigger: 'manual',
          force: body.force === true,
          platforms: Array.isArray(body.platforms) ? body.platforms.filter(name => typeof name === 'string') : undefined,
          backstage: desk.backstage(saved) ?? undefined,
        })
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
    case 'yanqi/sync-obsidian': {
      const saved = await desk.settings.read()
      const imported = await readObsidianNoteToRed({
        filePath: typeof body?.path === 'string' && body.path.trim() ? body.path.trim() : undefined,
        materialDir: saved?.materialDir ?? '',
        cwd: await desk.native.workspace(),
      })
      const ops = [
        { op: 'save_card_profile', signature: imported.signature, prefs: imported.cardPrefs },
        ...imported.customThemes.map(theme => ({ op: 'save_layout_theme', theme })),
      ]
      const state = await store.mutate(tr('从 Obsidian 言起同步署名与主题'), (draft) => {
        applyOps(draft, ops)
        return draft
      })
      return json(res, 200, { state, synced: true, path: imported.path, signature: imported.signature, cardPrefs: imported.cardPrefs })
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
    configureNativeTasks(ctx, {
      assistantOverride: assistantModelOverride,
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
    // 设置里开了「登录后的创作后台」才给：一轮里打开浏览器、用轻量直连模型认数（不开重量级 Agent 会话）
    const backstage = saved => (saved.backstage?.enabled === true ? { open: () => browserSession(browserTarget), callText: options => callLightModel(ctx, options) } : null)
    const native = new NativeAgent({ ctx, store, settings })
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
