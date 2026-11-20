// 浏览器侧的状态：Host 状态的本地镜像，加上只属于界面的选中、视图等。
import React from 'react'
import { coverDataUrl } from './cover.js'
import { lang, plural, setLanguagePreference, t } from './i18n.js'
import { MAX_FILES_PER_ADD, MAX_TOTAL_CHARS } from '../src/material-limits.js'

const BASE = 'media-desk/'

/** 地址后面带 #board、#pipeline 这类片段时直接打开那一页，方便把大屏固定在一块屏幕上。 */
function initialView() {
  const wanted = typeof location === 'undefined' ? '' : location.hash.slice(1)
  return ['board', 'sources', 'home', 'content', 'schedule', 'publish', 'video', 'insights', 'rivals', 'style'].includes(wanted) ? wanted : 'board'
}

// 助手栏默认收起；用户在这次会话里打开过，才记住「开着」，下次进来还开着
const DOCK_KEY = 'media-desk:dock-open'
function sessionDock() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DOCK_KEY) === '1'
  } catch {
    return false
  }
}
function rememberDock(open) {
  try {
    if (open) sessionStorage.setItem(DOCK_KEY, '1')
    else sessionStorage.removeItem(DOCK_KEY)
  } catch { /* 隐私模式下读写不了，就只在这一页里生效 */ }
}

let snapshot = {
  state: null, model: null, modelOk: null, modelError: null, canUndo: false, error: null,
  view: initialView(), mode: 'scatter', focusId: null, sheetOrigin: null, dockOpen: sessionDock(), studioDock: false, chatQuote: null, query: '', kindFilter: 'all', tagFilter: null, related: null,
  live: {}, settings: null, settingsOpen: false, modelPickOpen: false, thinking: false, chatLive: null, toast: null, capture: null, dialog: null,
  // 命令面板、快捷键表；reload 加一会让当前页重新挂载（重新抓取信息源用）
  palette: false, shortcutSheet: false, reload: 0,
}
const listeners = new Set()

export function getDesk() {
  return snapshot
}

export function setDesk(patch) {
  const before = snapshot.dockOpen
  snapshot = { ...snapshot, ...(typeof patch === 'function' ? patch(snapshot) : patch) }
  if (snapshot.dockOpen !== before) rememberDock(snapshot.dockOpen)
  listeners.forEach(fn => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useDesk(selector) {
  return React.useSyncExternalStore(subscribe, () => selector(snapshot))
}

async function request(path, body) {
  const res = await fetch(BASE + path, body === undefined ? { headers: { 'x-media-desk-lang': lang() } } : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-media-desk-lang': lang() }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || t('请求失败（{status}）', { status: res.status }))
  return data
}

let toastTimer = null
export function toast(text, { undo = false, error = false } = {}) {
  clearTimeout(toastTimer)
  setDesk({ toast: { text, undo, error, key: Date.now() } })
  toastTimer = setTimeout(() => setDesk({ toast: null }), undo || text.length > 24 ? 6000 : 3200)
}

export function report(err) {
  toast(err.message || String(err), { error: true })
}

export async function loadDesk() {
  try {
    // 先读设置拿到语言偏好，示例数据按这个语言返回
    const settings = await request('settings')
    setLanguagePreference(settings.language)
    const data = await request('state')
    setDesk({ settings, state: data.state, nativeAgent: data.nativeAgent === true, model: data.model, modelOk: data.modelOk, modelError: data.modelError, canUndo: data.canUndo, error: null })
  } catch (err) {
    setDesk({ error: err.message })
  }
}

export async function dispatchOps(ops, { label = t('操作'), undoable = true, silent = false } = {}) {
  try {
    const data = await request('ops', { ops, label, undoable })
    setDesk({ state: data.state, canUndo: undoable || snapshot.canUndo })
    if (data.errors?.length) toast(data.errors[0], { error: true })
    else if (!silent && data.receipts?.[0]) toast(data.receipts[0].text, { undo: undoable })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

export async function undo() {
  try {
    const data = await request('undo', {})
    setDesk({ state: data.state, canUndo: data.canUndo, toast: null })
    if (data.label) toast(t('已撤销：{label}', { label: data.label }))
  } catch (err) {
    report(err)
  }
}

export function openItem(id, origin = null) {
  setDesk({ focusId: id, sheetOrigin: origin, studioDock: true })
}

export function closeItem() {
  setDesk({ focusId: null, sheetOrigin: null, studioDock: false, chatQuote: null })
}

/** 一键成稿。任务在 Host 里跑，这里只负责启动和看进度。 */
export async function runProduce(id, { withImages, goal } = {}) {
  try {
    const data = await request('produce', { id, ...(goal ? { goal } : {}), ...(typeof withImages === 'boolean' ? { withImages } : {}) })
    setDesk({ state: data.state })
  } catch (err) {
    report(err)
  }
}

export async function cancelProduce(id) {
  try {
    await request('produce/cancel', { id })
  } catch (err) {
    report(err)
  }
}

export async function regenAsset(id, target) {
  try {
    const data = await request('produce/regen', { id, target })
    setDesk({ state: data.state })
  } catch (err) {
    report(err)
  }
}

function mergeProduction(id, production, status) {
  setDesk(s => ({ state: { ...s.state, items: s.state.items.map(item => (item.id === id ? { ...item, production, ...(status ? { status } : {}) } : item)) } }))
}

/** 轮询进度，返回停止函数。 */
export function watchProduction(id) {
  let stopped = false
  const tick = async () => {
    while (!stopped) {
      try {
        const data = await request(`production?id=${encodeURIComponent(id)}`)
        if (stopped) return
        setDesk(s => ({ live: { ...s.live, [id]: data.live }, ...(data.chat ? { state: { ...s.state, chat: data.chat } } : {}) }))
        if (data.production) mergeProduction(id, data.production, data.status)
      } catch {
        // 连接抖动时下一轮再试
      }
      await new Promise(r => setTimeout(r, 200))
    }
  }
  tick()
  return () => { stopped = true }
}

export async function saveSettings(payload) {
  try {
    const settings = await request('settings', payload)
    setLanguagePreference(settings.language)
    setDesk({ settings })
    toast(t('设置已保存'))
    return true
  } catch (err) {
    report(err)
    return false
  }
}

export async function fetchModels() {
  return request('models')
}

/** 切换助手模型；两个字段都空表示跟随默认。 */
export async function saveAssistant(assistant) {
  try {
    const settings = await request('settings', { assistant })
    setDesk({ settings, model: settings.assistantEffective ?? snapshot.model })
    toast(t('助手模型已切换'))
    return true
  } catch (err) {
    report(err)
    return false
  }
}

export async function testImage(payload) {
  try {
    const settings = await request('settings', payload)
    setLanguagePreference(settings.language)
    setDesk({ settings })
    const { src } = await request('settings/test', {})
    return src
  } catch (err) {
    report(err)
    return null
  }
}

function runActions(actions) {
  for (const action of actions) {
    if (action.type === 'produce' && action.id) {
      openItem(action.id)
      runProduce(action.id)
    }
    if (action.type === 'open' && action.id) openItem(action.id)
    if (action.type === 'nav' && action.view) setDesk({ view: action.view })
  }
}

export async function sendChat(text, { itemId = null, outputKind } = {}) {
  if (snapshot.thinking) return
  const { chatQuote: quote } = snapshot
  const focusId = itemId
  // 选中的段落或某一镜，随消息一起交给模型
  const message = quote ? (quote.text ? t('关于{label}「{quote}」：{text}', { label: quote.label, quote: quote.text, text }) : t('关于{label}：{text}', { label: quote.label, text })) : text
  setDesk(s => ({
    thinking: true,
    chatItemId: focusId ?? null,
    chatActivity: [],
    chatReasoning: '',
    chatProgress: { phase: 'connecting', startedAt: Date.now() },
    chatLive: null,
    chatQuote: null,
    state: { ...s.state, chat: [...s.state.chat, { id: `tmp_${Date.now()}`, role: 'user', text: message, itemId: focusId ?? undefined }] },
  }))
  try {
    // 先拿到 liveId，模型在 Host 里写；同时轮询已经写出来的字
    const { liveId } = await request('chat', { message, focusId: focusId ?? undefined, outputKind })
    let done = null
    let failures = 0
    const started = Date.now()
    while (!done && Date.now() - started < 900_000) {
      await new Promise(r => setTimeout(r, 350))
      let live
      try { live = await request('chat/live', { id: liveId }); failures = 0 } catch (error) { if (++failures < 3) continue; throw new Error(`读取 DSH 运行进度失败：${error.message}`) }
      setDesk(s => ({ chatLive: live.text || null, chatReasoning: live.reasoning ?? '', chatProgress: { phase: live.phase, startedAt: live.startedAt ?? started, updatedAt: live.updatedAt }, chatActivity: live.activity ?? [], ...(focusId && live.drafts ? { live: { ...s.live, [focusId]: { ...live, native: true, drafts: live.drafts, text: live.drafts.article?.text ?? live.drafts.spoken?.text ?? '' } } } : {}) }))
      if (live.done) { done = live; break }
    }
    if (done?.result) {
      setDesk({ state: done.result.state, canUndo: true, modelOk: done.result.modelOk, modelError: done.result.modelError })
      runActions(done.result.actions || [])
      return done.result
    } else if (done?.error) {
      toast(done.error, { error: true })
      await loadDesk()
    } else {
      toast('等待 DSH 结果超时，请查看原生会话状态。', { error: true })
      await loadDesk()
    }
  } catch (err) {
    report(err)
    await loadDesk()
  } finally {
    setDesk(s => ({ thinking: false, chatLive: null, chatReasoning: '', chatProgress: null, chatActivity: [], live: { ...s.live, ...(focusId ? { [focusId]: null } : {}) } }))
  }
}

export async function cancelChat(itemId) {
  try { await request('chat/cancel', { focusId: itemId ?? undefined }) } catch (err) { report(err) }
}

export async function saveProduced(id) {
  try {
    const production = snapshot.state.items.find(row => row.id === id)?.production
    // 视频封面在浏览器里合成，一起存进文件夹
    const videoCover = await coverDataUrl({ src: production.cover?.src, text: production.coverText || production.title }).catch(() => undefined)
    const data = await request('produce/save', { id, videoCover })
    setDesk({ state: data.state })
    toast(t('已保存到 {path}', { path: data.path }))
  } catch (err) {
    report(err)
  }
}

export async function revealSaved(id) {
  try {
    await request('produce/reveal', { id })
  } catch (err) {
    report(err)
  }
}

export async function clearChat(focusId) {
  try {
    const data = await request('chat/clear', { focusId })
    setDesk({ state: data.state })
  } catch (err) {
    report(err)
  }
}

/** 记灵感时贴的是本地 Markdown 路径：让后台读文件当素材。 */
export async function captureFile(path) {
  const data = await request('capture-file', { path })
  setDesk({ state: data.state, canUndo: true })
  // add_item 的回执里没有字数：从刚记下的那条灵感上读，别显示成 0 字
  const chars = data.state?.items?.find(row => row.id === data.id)?.body?.length ?? 0
  toast(t('已从文件记下，正文 {n} 字', { n: chars }), { undo: true })
  return data.id
}

export async function captureUrl(url, extra = {}) {
  try {
    const data = await request('capture-url', { url, ...extra })
    setDesk({ state: data.state, canUndo: true })
    toast(t('已收藏到灵感'), { undo: true })
    return data.id
  } catch (err) {
    report(err)
    return null
  }
}

/** 视频页的接口（/media-desk/video/*）：不带 body 是 GET。出错时抛出，由调用方提示。 */
export function hostRequest(path, body) {
  return request(path, body)
}

// 素材的限制和 host 侧共用一份（src/material-limits.js）
export const MAX_MATERIALS_PER_ADD = MAX_FILES_PER_ADD
const MATERIAL_MAX_BYTES = 2_000_000

/**
 * 浏览器里读一遍选中的文本文件。超过 2 MB、超过 10 个、合计超过 20 万字的都不收，带回原因。
 * @param {FileList|File[]} fileList - 选中的文件。
 * @param {number} [usedChars] - 这条灵感已有素材的字数（合计上限要算上它们）。
 */
export async function readPickedMaterials(fileList, usedChars = 0) {
  const all = [...(fileList ?? [])]
  const picked = all.slice(0, MAX_MATERIALS_PER_ADD)
  const files = []
  const errors = all.length > picked.length ? [{ name: t('另外 {n} 个文件', { n: all.length - picked.length }), reason: t('一次最多加 {n} 份素材', { n: MAX_MATERIALS_PER_ADD }) }] : []
  let left = MAX_TOTAL_CHARS - usedChars
  for (const file of picked) {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      errors.push({ name: file.name, reason: t('只能加 .md、.markdown 或 .txt 文件') })
      continue
    }
    if (file.size > MATERIAL_MAX_BYTES) {
      errors.push({ name: file.name, reason: t('这份素材超过 2 MB，先删减一些再读') })
      continue
    }
    let text
    try {
      text = await file.text()
    } catch (err) {
      errors.push({ name: file.name, reason: err.message })
      continue
    }
    if (text.length > left) {
      errors.push({ name: file.name, reason: t('素材合计超过 {n} 万字，先删掉一些再加', { n: Math.round(MAX_TOTAL_CHARS / 10_000) }) })
      continue
    }
    left -= text.length
    files.push({ name: file.name, text })
  }
  return { files, errors }
}

/** 给一条灵感加素材：路径和浏览器里读到的正文一起交给后台。 */
export async function addMaterials(id, { paths = [], files = [] } = {}) {
  try {
    const data = await request('item-materials/add', { id, paths, files })
    setDesk({ state: data.state, canUndo: true })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

export async function removeMaterial(id, materialId) {
  try {
    const data = await request('item-materials/remove', { id, materialId })
    setDesk({ state: data.state, canUndo: true })
  } catch (err) {
    report(err)
  }
}

/** 设置里的写作工作流：探测能读到的文档，返回每份的字数和勾选状态。selected 为 undefined 时用已保存的勾选。 */
export async function scanWritingFlow({ paths, selected } = {}) {
  try {
    return await request('writing-flow/scan', { ...(Array.isArray(paths) ? { paths } : {}), ...(selected !== undefined ? { selected } : {}) })
  } catch (err) {
    return { docs: [], error: err.message }
  }
}

/** 按勾选真读一遍，返回会注入的每份文档和超预算没放进去的。 */
export async function previewWritingFlow({ paths, selected } = {}) {
  try {
    return await request('writing-flow/preview', { ...(Array.isArray(paths) ? { paths } : {}), ...(selected !== undefined ? { selected } : {}) })
  } catch (err) {
    return { parts: [], dropped: [], errors: [err.message] }
  }
}

export async function uploadFile(file) {
  const res = await fetch(`${BASE}upload`, { method: 'POST', headers: { 'content-type': file.type, 'x-media-desk-lang': lang() }, body: file })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || t('上传失败'))
  return data
}

/** 上传并收藏图片或视频；extra 会一起写进灵感（比如标签）。返回收藏成功的个数。 */
export async function captureFiles(files, extra = {}) {
  let saved = 0
  for (const file of files) {
    try {
      const { src, kind } = await uploadFile(file)
      const title = file.name.replace(/\.[^.]+$/, '')
      const result = await dispatchOps([{ op: 'add_item', kind, title, media: { src }, ...extra }], { label: t('收藏 {title}', { title }), silent: true })
      if (result && !result.errors?.length) {
        saved += 1
        toast(t('已放到灵感'), { undo: true })
      }
    } catch (err) {
      report(err)
    }
  }
  return saved
}

export async function refreshAccount(payload) {
  try {
    const data = await request('account/refresh', payload)
    setDesk({ state: data.state, canUndo: true })
    if (data.fetchError) toast(t('读取主页失败：{error}', { error: data.fetchError }), { error: true })
    else toast(t('已更新账号档案'))
    return data
  } catch (err) {
    report(err)
    return null
  }
}

export async function extractStyle(payload) {
  try {
    const data = await request('style/extract', payload)
    setDesk({ state: data.state, canUndo: true })
    const missed = data.failures?.length ?? 0
    toast(missed ? t(plural(missed, '风格提炼好了，有 1 个链接没抓到', '风格提炼好了，有 {n} 个链接没抓到'), { n: missed }) : t('风格提炼好了，之后就按它写'), { undo: true })
    return true
  } catch (err) {
    report(err)
    return false
  }
}

export async function learnSkills() {
  try {
    const data = await request('skills/learn', {})
    setDesk({ state: data.state, canUndo: true })
    toast(data.added ? t(plural(data.added, '从数据里提炼出 1 条新规则，等你确认', '从数据里提炼出 {n} 条新规则，等你确认'), { n: data.added }) : t('目前的数据还提炼不出新规则'))
  } catch (err) {
    report(err)
  }
}

export async function exportSkills() {
  try {
    const data = await request('skills/export', {})
    setDesk({ state: data.state })
    toast(t(plural(data.rules, '写作规则已交给 DeepSeek Harness（1 条），在别的对话里也会照着写', '写作规则已交给 DeepSeek Harness（{n} 条），在别的对话里也会照着写'), { n: data.rules }))
  } catch (err) {
    report(err)
  }
}

export function fetchBoard() {
  return request('board')
}

// Cache UI data between visits; the host persists per-source daily results.
export const sourceSnapshots = { feeds: null, hot: null, builtin: {} }
export async function fetchFeeds(force = false, cachedOnly = false) {
  const data = await request('feeds/fetch', { force, cachedOnly })
  sourceSnapshots.feeds = data
  return data
}
export async function fetchHot(sources, force = false, cachedOnly = false) {
  const data = await request('hot/fetch', { sources, force, cachedOnly })
  sourceSnapshots.hot = sources && sourceSnapshots.hot ? { ...data, sources: sourceSnapshots.hot.sources.map(row => data.sources.find(next => next.id === row.id) ?? row) } : data
  return data
}
export async function fetchBuiltin(ids, force = false, cachedOnly = false) {
  const data = await request('builtin/fetch', { ids, force, cachedOnly })
  Object.assign(sourceSnapshots.builtin, Object.fromEntries(data.groups.map(row => [row.id, row])))
  return data
}

/** 让模型给切入价值一个参考分。只是参考，不会写进评分卡。 */
export function fetchAngleScore(id) {
  return request('ideas/angle-score', { id })
}

// 「改成观察口吻」没改成的原因（中文原文，显示时再翻译）
export const OBSERVE_REASON = {
  none: '没有要改的句子',
  'no-model': '没有可用的模型，这次没改',
  empty: '模型没给出能用的改法，这次没改',
  facts: '改的时候加了原文没有的数字，没采用',
  headings: '改的时候丢了小标题，没采用',
  length: '篇幅变化太大，没采用',
  worse: '改完写成做过的句子没有变少，没采用',
  stale: '正文刚被改过，这次没覆盖',
}

/**
 * 把写成亲手做过、但灵感里没有依据的句子改成观察口吻。index 是 production.flow.unsupported 里那一句的 index，不传就改全部。
 * 只调一次模型、只改这几句；没改成时如实提示原因，正文不动。
 * @returns {Promise<{applied: number, before: number, after: number, reason: string|null, changes: Array<{sentence: string, replace: string}>}|null>}
 */
export async function observeClaims(id, index) {
  try {
    const data = await request('produce/observe', Number.isInteger(index) ? { id, index } : { id })
    setDesk({ state: data.state })
    if (data.reason) toast(t(OBSERVE_REASON[data.reason] ?? data.reason), { error: data.reason !== 'none' })
    else toast(t(data.applied === 1 ? '改了 1 句，改成观察口吻' : '改了 {n} 句，改成观察口吻', { n: data.applied }))
    const { state: _state, ...result } = data
    return result
  } catch (err) {
    report(err)
    return null
  }
}

/** 读一遍对标账号的公开数字，返回每个账号的结果。ids 只读这几个，不传就全读。 */
export async function refreshRivals(ids) {
  const data = await request('rivals/refresh', Array.isArray(ids) ? { ids } : {})
  setDesk({ state: data.state })
  return data
}

/** 按填好的主页地址读各平台账号数据；platforms 只读这几个（刚填好地址时）。 */
export async function refreshFollowers(platforms) {
  const data = await request('followers/refresh', platforms ? { platforms } : {})
  setDesk({ state: data.state })
  return data.results
}

/** 打开大屏时在后台补读公开接口（距上次读到超过 6 小时才会真的读）。 */
export async function refreshPublic() {
  const data = await request('followers/refresh', { scope: 'public' })
  if (!data.skipped) setDesk({ state: data.state })
  return data
}

/** 有界面地打开专用浏览器和这些平台的创作后台登录页；登录由用户自己在里面做。 */
export function openBackstageLogin(platforms) {
  return request('backstage/login', platforms ? { platforms } : {})
}

export function fetchInsights() {
  return request('insights')
}

/** 把成稿推到公众号草稿箱。只建草稿，发布要用户自己到后台点。 */
export async function pushWechatDraft(id, html) {
  try {
    const data = await request('publish/wechat-draft', typeof html === 'string' ? { id, html } : { id })
    setDesk({ state: data.state })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

/** 长文里的工作台图片传到设置里的图床，返回 { urls: 原地址 → 公网地址, errors }。失败时抛错。 */
export function hostImages(srcs) {
  return request('layouts/host-images', { srcs })
}

/** 浏览器跨域取不到的公网图片，由 Host 代取（只连公网地址），返回 data URL。 */
export function fetchImageViaHost(url) {
  return request('layouts/fetch-image', { url })
}

/** 公开发布到公众号。只在用户刚在确认框里点了确认时调用；mediaId 是确认框里那份草稿。 */
export async function publishWechat(id, mediaId, { retryUnknown = false } = {}) {
  try {
    // retryUnknown：上一次提交没有明确结果，用户确认公众号后台没发出去之后才重新提交
    const data = await request('publish/wechat-publish', { id, mediaId, confirm: true, ...(retryUnknown ? { retryUnknown: true } : {}) })
    setDesk({ state: data.state })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

/** 已提交的公众号发布再查一次结果，只查不发。 */
export async function checkWechatPublish(id) {
  try {
    const data = await request('publish/wechat-status', { id })
    setDesk({ state: data.state })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

/** 不再等公众号的发布结果；已提交的任务撤不回。 */
export function stopWechatWait(id) {
  return request('publish/wechat-cancel', { id }).catch(() => null)
}

/** 检测 Wechatsync 扩展连没连上、看得到哪些平台。失败时返回 { error }。 */
export async function checkSyncBridge() {
  try {
    return await request('sync/check', {})
  } catch (err) {
    return { reachable: false, message: err.message }
  }
}

/** 经 Wechatsync 扩展把成稿存成几个平台的草稿。 */
export async function syncPlatformDrafts(id, platforms) {
  try {
    const data = await request('sync/drafts', { id, platforms })
    setDesk({ state: data.state })
    return data
  } catch (err) {
    report(err)
    return null
  }
}


/** 给几个平台各写一个版本。任务在 Host 里跑，进度跟着成稿一起轮询。 */
export async function generateVersions(id, platforms) {
  try {
    const data = await request('versions/generate', { id, platforms })
    setDesk({ state: data.state })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

export async function cancelVersions(id, platform) {
  try {
    await request('versions/cancel', { id, ...(platform ? { platform } : {}) })
  } catch (err) {
    report(err)
  }
}

/** 手动改一个平台版本，可以撤销。 */
export async function updateVersion(payload) {
  try {
    const data = await request('versions/update', payload)
    setDesk({ state: data.state, canUndo: true })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

/** 只为一个平台版本的某几项自检（比如字数）再定向改一次，其余不动。 */
export async function reviseVersion(id, platform, checks) {
  try {
    const data = await request('versions/revise', { id, platform, checks })
    setDesk({ state: data.state })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

/**
 * 正文里没有依据的第一人称说法：改成观察口吻，或者确认是真的保留。
 * 接口还没上线（404）时不报错，返回 { missing: true }，由界面给一句说明。
 */
export async function claimAction(kind, payload) {
  try {
    const res = await fetch(`${BASE}claims/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-media-desk-lang': lang() }, body: JSON.stringify(payload) })
    if (res.status === 404) return { missing: true }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || t('请求失败（{status}）', { status: res.status }))
    if (data.state) setDesk({ state: data.state, canUndo: true })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

/** 标题台：出一批候选标题，结果不存，选中才写进去。 */
export async function generateTitles(id, platform) {
  try {
    return await request('titles/generate', { id, ...(platform ? { platform } : {}) })
  } catch (err) {
    report(err)
    return null
  }
}
