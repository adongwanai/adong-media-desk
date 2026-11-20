// Existing DSH sessions run the Agent; this adapter only forwards messages,
// presents native events, and synchronizes explicitly marked document output.
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sessionService, draftMaterials } from './dsh-chat.js'
import { ensureWorkspace, workspacePath } from './workspace.js'
import { newId } from './ops.js'
import { nativeReferences, contextHash } from './native-workflow.js'

import { nativeReady } from './native-task.js'
export { nativeReady } from './native-task.js'

export function documentOutput(text, token) {
  const drafts = {}
  let reply = String(text ?? '')
  for (const kind of ['article', 'spoken']) {
    const start = `<media-desk-${kind} id="${token}">`
    const end = `</media-desk-${kind}>`
    const at = reply.lastIndexOf(start)
    if (at < 0) continue
    const tail = reply.slice(at + start.length)
    const finish = tail.indexOf(end)
    let body = finish < 0 ? tail : tail.slice(0, finish)
    // Don't display a partially received closing marker as document text.
    if (finish < 0) {
      for (let size = Math.min(end.length - 1, body.length); size > 0; size--) {
        if (body.endsWith(end.slice(0, size))) { body = body.slice(0, -size); break }
      }
    }
    drafts[kind] = { text: body.replace(/^\n/, '').trimEnd(), complete: finish >= 0 }
    reply = reply.slice(0, at) + (finish < 0 ? '' : tail.slice(finish + end.length))
  }
  // Hide incomplete protocol openings while preserving ordinary prose.
  reply = reply.replace(/<media-desk-(?:article|spoken)[^>]*$/, '').trim()
  return { reply, drafts }
}

const messageText = event => (event.data?.message?.content ?? [])
  .filter(part => part.type === 'text').map(part => part.text).join('\n')
const failure = (message, status = 409) => Object.assign(new Error(message), { status })
const draftContext = (item, materials) => item ? `当前选题：${item.title}\n灵感：${item.body ?? ''}\n当前正文：\n${item.production?.article ?? ''}\n当前口播：\n${typeof item.production?.spoken === 'string' ? item.production.spoken : item.production?.spoken?.text ?? ''}\n素材：${JSON.stringify(materials)}` : '当前没有打开选题。可以正常对话；如需在右侧写稿，请用户打开或新建一个选题。'

export class NativeAgent {
  constructor({ ctx, store, settings, cwd }) {
    Object.assign(this, { ctx, store, settings, cwd })
    this.jobs = new Map()
    this.sessions = new Map()
  }
  ready() { return nativeReady(this.ctx) }
  active(id) { return this.jobs.has(id ?? '_general') }
  status(id) { return this.jobs.get(id ?? '_general')?.live ?? null }
  async workspace() {
    if (this.cwd) return this.cwd
    this.workspacePromise ??= ensureWorkspace(workspacePath(this.store.root))
    return this.workspacePromise
  }
  async cancel(id) {
    const job = this.jobs.get(id ?? '_general')
    if (!job) return
    job.cancelled = true
    try {
      if (job.sessionId) await sessionService(this.ctx).cancel({ sessionId: job.sessionId }, AbortSignal.timeout(10_000))
    } finally { job.controller.abort(new Error('已停止 DSH 会话')) }
  }
  async start(id, { goal = 'xhs' } = {}) {
    if (this.active(id)) return false
    const state = await this.store.read()
    const item = state.items.find(row => row.id === id)
    if (!item) throw failure('找不到这个选题', 404)
    if (item.production?.status === 'running') return false
    const message = goal === 'script' ? '根据这个选题直接生成可录制的完整口播稿。' : goal === 'article' ? '根据这个选题直接生成完整长文。' : '根据这个选题直接生成小红书图文稿，正文自然分段，适合排成图文卡片。'
    // run reserves the topic synchronously, before the first await.
    await new Promise((resolve, reject) => {
      this.run({ message, focusId: id, generate: true, goal }, () => resolve()).catch(reject)
    })
    return true
  }
  async run({ message, focusId, generate = false, goal = 'xhs', outputKind }, onUpdate = () => {}) {
    const key = focusId ?? '_general'
    if (!String(message ?? '').trim()) throw failure('消息为空', 400)
    if (!this.ready()) throw failure('当前 DSH 版本未提供原生会话接口', 503)
    if (this.jobs.has(key)) throw failure('这个会话还在运行，请等它完成或停止')
    const controller = new AbortController()
    const job = { controller, live: { text: '', reply: '', reasoning: '', phase: 'connecting', startedAt: Date.now(), activity: [], drafts: {}, native: true }, sessionId: null }
    this.jobs.set(key, job)
    const service = sessionService(this.ctx)
    const token = randomUUID()
    let previous, initial, savedUser = false, iterator
    const timer = setTimeout(() => controller.abort(new Error('DSH 会话等待超时，请在原生会话中查看状态后重试')), 15 * 60_000)
    timer.unref?.()
    const publish = (text) => {
      const parsed = documentOutput(text, token)
      if (outputKind === 'spoken') delete parsed.drafts.article
      job.live.reply = parsed.reply
      job.live.drafts = parsed.drafts
      job.live.text = parsed.drafts.article?.text ?? parsed.drafts.spoken?.text ?? ''
      job.live.updatedAt = Date.now()
      onUpdate({ ...job.live, sessionId: job.sessionId })
    }
    try {
      const state = await this.store.read()
      initial = focusId ? structuredClone(state.items.find(row => row.id === focusId)) : null
      if (focusId && !initial) throw failure('找不到这个选题', 404)
      if (initial?.production?.status === 'running') throw failure('这篇内容正在生成')
      previous = initial?.production ? structuredClone(initial.production) : null
      const cwd = await this.workspace()
      let sessionId = this.sessions.get(key) ?? (focusId ? initial?.dshSessionId : state.dshGeneralSessionId)
      const firstTurn = !sessionId
      if (!sessionId) {
        sessionId = (await service.create(cwd ? { cwd } : {}, AbortSignal.timeout(30_000))).sessionId
        if (!sessionId) throw new Error('DSH 没有返回会话 ID')
        this.sessions.set(key, sessionId)
        if (focusId) await this.store.mutate('关联 DSH 会话', draft => {
          const item = draft.items.find(row => row.id === focusId)
          if (item) item.dshSessionId = sessionId
        }, { undoable: false })
        else await this.store.mutate('关联 DSH 会话', draft => { draft.dshGeneralSessionId = sessionId }, { undoable: false })
      }
      job.sessionId = sessionId
      const control = await service.state({ sessionId }, AbortSignal.timeout(15_000))
      if (control.running || control.queue?.length || control.pendingInput?.length) throw failure('DSH 会话正在运行或等待确认，请先在原生会话中完成当前操作')
      iterator = service.follow({ address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 2 }, controller.signal)[Symbol.asyncIterator]()
      const opening = await iterator.next()
      if (opening.done || opening.value?.type !== 'snapshot') throw new Error('DSH 会话流没有返回初始状态')
      const baseline = opening.value.cursor
      const materials = initial ? await draftMaterials(initial, this.store.filesDir) : []
      const settings = await this.settings?.read()
      const image = settings?.image
      const references = await nativeReferences({ state, settings, cwd, root: this.store.root ?? this.store.filesDir })
      const referenceText = [
        '你在阿东IP工作台内，通过同一个 DSH 原生会话与用户交互。按需使用原生工具与 Skills，保持原生权限流程。',
        references,
        '文章配图按需使用 baoyu-article-illustrator；机制、流程、对比可用 Excalidraw Skill，保留可编辑源文件并导出可预览图片。优先真实素材和解释信息的图解。图文按语义和实际篇幅分页，充实可读，不用装饰图或废话凑满。',
        image?.source === 'http' && image.model ? `生图模型 ${image.model} 已配置。需要时把描述写入 UTF-8 文件，通过原生终端执行 node ${JSON.stringify(fileURLToPath(new URL('./native-image-cli.js', import.meta.url)))} ${JSON.stringify(this.store.root)} 图片描述文件路径，使用返回的真实 src。不要读取或展示 settings.json 的凭证；调用失败如实说明。` : '',
        '仅在生成或完整重写小红书图文时，右侧 article 标记内交付 800～1100 字长稿；左侧标记外另给带标题、标签的 200～300 字短总结，不塞入卡片长稿。口播、其他平台、普通聊天和局部修改不套这个格式。',
      ].filter(Boolean).join('\n\n')
      const documentText = draftContext(initial, materials)
      const context = { sessionId, references: contextHash(referenceText), draft: contextHash(documentText) }
      const cached = (focusId ? initial?.dshContext : state.dshGeneralContext)
      const sameSession = cached?.sessionId === sessionId
      const instruction = [
        !sameSession || cached.references !== context.references ? referenceText : '',
        firstTurn ? `工作台已有对话（只作历史上下文，以当前稿件为准）：${JSON.stringify(state.chat.filter(row => (row.itemId ?? null) === (focusId ?? null)).slice(-20).map(row => ({ role: row.role, text: String(row.text ?? '').slice(0, 2000) })))}` : '',
        !sameSession || cached.draft !== context.draft ? documentText : '当前稿件和素材未变化，沿用本会话最近保存的版本。',
        initial ? `只有需要更新稿件时才输出完整修改后的内容，正文包在 <media-desk-article id="${token}"> 与 </media-desk-article> 中，口播包在 <media-desk-spoken id="${token}"> 与 </media-desk-spoken> 中。正文使用 Markdown 自然段，一级标题为稿件标题。工作台自动实时预览并保存，用户不需要复制或确认写回。解释和普通回答在标记之外；只是讨论或检索时不要输出标记。本地配图存放 ${this.store.filesDir} 并引用 /media-desk/files/文件名。不要直接编辑 state.json。` : '',
        generate ? `本轮是直接成稿：${goal === 'script' ? '请使用口播标记交付完整口播稿' : goal === 'xhs' ? '请交付小红书图文长稿及对话短总结' : '请使用正文标记交付完整长文'}，不要先问目标、观点或大纲。` : '',
        outputKind === 'spoken' ? '本轮由口播按钮触发，只使用 spoken 标记写入口播，不要输出 article；正文保持原样。' : '',
        `用户本次请求：\n${message}`,
      ].filter(Boolean).join('\n\n')
      await this.store.mutate('DSH 对话', draft => {
        draft.chat.push({ id: newId('c'), role: 'user', text: message, itemId: focusId, at: new Date().toISOString() })
        if (generate) {
          const item = draft.items.find(row => row.id === focusId)
          if (!item) throw failure('选题已删除', 404)
          item.creation = { ...item.creation, goal }
          item.production = { ...previous, status: 'running', stage: 'text', engine: 'dsh-native', format: goal === 'script' ? 'script' : 'article', article: previous?.article ?? '', title: previous?.title ?? item.title, images: previous?.images ?? [], shots: previous?.shots ?? [], startedAt: new Date().toISOString() }
        }
      }, { undoable: false })
      savedUser = true
      job.live.phase = 'waiting'
      publish('')
      await service.prompt({ sessionId, mode: 'queue', requestId: `media-desk-${token}`, content: [{ type: 'text', text: instruction }] }, AbortSignal.timeout(30_000))
      // Only mark references delivered after DSH has accepted this prompt.
      await this.store.mutate('同步 DSH 上下文', draft => {
        if (focusId) {
          const item = draft.items.find(row => row.id === focusId)
          if (item) item.dshContext = context
        } else draft.dshGeneralContext = context
      }, { undoable: false })
      let committed = '', streaming = '', reasoning = '', reasoningStream = '', ended = false
      while (true) {
        const { value, done } = await iterator.next()
        if (done) break
        if (value.type === 'assistant-stream') {
          const frame = value.frame
          if (frame.type === 'start') { streaming = ''; reasoningStream = ''; job.live.phase = 'waiting' }
          if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') { streaming += frame.chunk.text; job.live.phase = 'writing' }
          if (frame.type === 'chunk' && frame.chunk?.type === 'reasoning-delta') { reasoningStream += frame.chunk.text; job.live.phase = 'reasoning' }
          if (frame.type === 'end' && frame.outcome.kind === 'abandoned') { streaming = ''; reasoningStream = '' }
          job.live.reasoning = [reasoning, reasoningStream].filter(Boolean).join('\n\n')
          publish([committed, streaming].filter(Boolean).join('\n\n'))
          continue
        }
        const event = value.event
        if (!event || event.seq <= baseline) continue
        if (event.type === 'assistant/message') {
          const text = messageText(event)
          if (text) committed += `${committed ? '\n\n' : ''}${text}`
          const thought = (event.data.message?.content ?? []).filter(part => part.type === 'reasoning').map(part => part.text).join('\n') || reasoningStream
          if (thought) reasoning += `${reasoning ? '\n\n' : ''}${thought}`
          streaming = ''
          reasoningStream = ''
          job.live.reasoning = reasoning
        }
        if (event.type === 'tool/call') {
          job.live.phase = 'tool'
          job.live.activity.push({ id: event.data.callId, name: event.data.name, status: 'running', detail: String(event.data.arguments ?? '').slice(0, 4000) })
          job.live.activity = job.live.activity.slice(-40)
        }
        if (event.type === 'tool/result') {
          const call = job.live.activity.find(row => row.id === event.data.message?.source?.callId)
          if (call) { call.status = event.data.message?.isError || event.data.error ? 'failed' : 'done' }
          job.live.phase = job.live.activity.some(row => row.status === 'running') ? 'tool' : 'waiting'
        }
        publish([committed, streaming].filter(Boolean).join('\n\n'))
        if (event.type === 'turn/end') {
          const reason = event.data.reason
          if (reason?.kind !== 'completed') throw new Error(reason?.error?.message || `DSH 本轮已停止：${reason?.kind ?? '未知原因'}，原稿已保留；可在 DSH 会话中继续。`)
          ended = true
          break
        }
      }
      if (!ended) throw new Error('DSH 会话连接中断，原稿已保留')
      const output = documentOutput(committed, token)
      const documents = Object.fromEntries(Object.entries(output.drafts).filter(([kind, value]) => (outputKind !== 'spoken' || kind === 'spoken') && value.complete && value.text.trim()))
      if (generate && !Object.keys(documents).length) throw new Error('DSH 已回复，但没有返回完整稿件。请继续对话让它完成稿件。')
      const result = await this.store.mutate('DSH 更新内容', draft => {
        const target = focusId ? draft.items.find(row => row.id === focusId) : null
        const changed = Object.keys(documents).length > 0
        if (changed) {
          if (!target) throw failure('选题已删除，未写回稿件')
          if ((target.production?.article ?? '') !== (previous?.article ?? '') || JSON.stringify(target.production?.spoken) !== JSON.stringify(previous?.spoken)) throw failure('原稿在生成期间被修改，已保留你的修改；完整回复在 DSH 会话中')
          const now = new Date().toISOString()
          const article = documents.article?.text
          const title = article && /^#\s+(.+)\n/.exec(article)?.[1]
          target.production = { ...target.production, status: 'done', stage: 'done', format: article ? 'article' : target.production?.format ?? 'script', title: title || target.production?.title || target.title, updatedAt: now, finishedAt: now, error: null }
          if (article) target.production.article = title ? article.replace(/^#\s+.+\n+/, '') : article
          if (documents.spoken) target.production.spoken = documents.spoken.text
          if (generate && goal === 'script' && !previous?.article) target.production.article = documents.spoken?.text ?? ''
          if (['idea', 'outline'].includes(target.status)) target.status = 'draft'
        }
        if (target) target.dshContext = { ...context, draft: contextHash(draftContext({ ...initial, production: target.production }, materials)) }
        const answer = { id: newId('c'), role: 'assistant', text: output.reply || (changed ? '稿件已更新，可以在右侧查看。' : 'DSH 已完成本轮。'), itemId: focusId, at: new Date().toISOString(), engine: 'DSH 原生 Agent', reasoning: job.live.reasoning, activity: job.live.activity, sessionId, undoable: changed }
        draft.chat.push(answer)
        draft.chat = draft.chat.slice(-300)
        return { answer, actions: [], state: draft, modelOk: true, modelError: null }
      })
      return result
    } catch (error) {
      if (savedUser) await this.store.mutate('DSH 运行状态', draft => {
        const target = draft.items.find(row => row.id === focusId)
        if (target?.dshContext) target.dshContext.draft = null
        if (generate && target?.production?.engine === 'dsh-native' && target.production.status === 'running') {
          if (previous) Object.assign(target.production, { status: previous.status, stage: previous.stage, error: error.message })
          else Object.assign(target.production, { status: 'failed', stage: 'done', error: error.message })
        }
        draft.chat.push({ id: newId('c'), role: 'assistant', text: error.message, itemId: focusId, at: new Date().toISOString(), engine: 'DSH 原生 Agent', sessionId: job.sessionId, reasoning: job.live.reasoning, activity: job.live.activity })
      }, { undoable: false })
      throw error
    } finally {
      clearTimeout(timer)
      controller.abort()
      // The iterator observes abort; don't block completion on a remote close.
      Promise.resolve(iterator?.return?.()).catch(() => {})
      this.jobs.delete(key)
    }
  }
}
