// Existing DSH sessions run the Agent; this adapter only forwards messages,
// presents native events, and synchronizes explicitly marked document output.
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionService, draftMaterials } from './dsh-chat.js'
import { cleanCreation, CREATION_GOALS, formatCreationBrief } from './creation.js'
import { auditDraftQuality, autoAnnotateHighlights, normalizeDraftStructure, visibleChars } from './draft-quality.js'
import { activeStyle } from './style.js'
import { ensureWorkspace, workspacePath } from './workspace.js'
import { newId } from './ops.js'
import { nativeReferences, contextHash } from './native-workflow.js'

import { ensureSessionModel, nativeReady } from './native-task.js'
export { nativeReady } from './native-task.js'

const PATCH_HUNK_RE = /<{5,9}[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n={5,9}[ \t]*(?:\r?\n([\s\S]*?))?\r?\n>{5,9}(?:[ \t]*REPLACE)?[ \t]*/g

function stripPartialEnd(body, end) {
  for (let size = Math.min(end.length - 1, body.length); size > 0; size--) {
    if (body.endsWith(end.slice(0, size))) return body.slice(0, -size)
  }
  return body
}

function matchPatchSpan(haystack, needle) {
  if (!needle) return null
  const exact = haystack.indexOf(needle)
  if (exact >= 0) return { start: exact, end: exact + needle.length }

  const hLines = []
  let offset = 0
  for (const rawLine of haystack.split('\n')) {
    hLines.push({ norm: rawLine.replace(/[ \t]+$/g, ''), start: offset, end: offset + rawLine.length })
    offset += rawLine.length + 1
  }
  const nLines = needle.split('\n').map(l => l.replace(/[ \t]+$/g, ''))
  while (nLines.length && !nLines[0]) nLines.shift()
  while (nLines.length && !nLines.at(-1)) nLines.pop()
  if (!nLines.length) return null

  for (let i = 0; i <= hLines.length - nLines.length; i++) {
    let ok = true
    for (let k = 0; k < nLines.length; k++) {
      if (hLines[i + k].norm !== nLines[k]) { ok = false; break }
    }
    if (ok) return { start: hLines[i].start, end: hLines[i + nLines.length - 1].end }
  }

  // Fallback: match non-empty lines in order allowing minor blank-line differences (\n vs \n\n)
  const nNonEmpty = nLines.filter(l => l.trim().length > 0)
  if (!nNonEmpty.length) return null
  for (let i = 0; i < hLines.length; i++) {
    if (hLines[i].norm !== nNonEmpty[0]) continue
    let hi = i
    let ni = 0
    let blanks = 0
    while (hi < hLines.length && ni < nNonEmpty.length) {
      if (hLines[hi].norm === nNonEmpty[ni]) {
        ni++
        blanks = 0
      } else if (!hLines[hi].norm.trim() && blanks < 3) {
        blanks++
      } else {
        break
      }
      if (ni < nNonEmpty.length) hi++
    }
    if (ni === nNonEmpty.length) {
      return { start: hLines[i].start, end: hLines[hi].end }
    }
  }
  return null
}

/**
 * 将 SEARCH/REPLACE 手术刀补丁块精准应用到原稿上，未出现在 SEARCH 里的文字 100% 逐字原样保留。
 */
export function applySurgicalPatches(baseText, patchBody) {
  let current = String(baseText ?? '').replace(/\r\n/g, '\n')
  const rawPatch = String(patchBody ?? '')
  let appliedCount = 0
  let totalHunks = 0
  let patchedTitle = null
  const failedHunks = []

  for (const m of rawPatch.matchAll(PATCH_HUNK_RE)) {
    totalHunks += 1
    const search = (m[1] ?? '').replace(/\r\n/g, '\n')
    const replace = (m[2] ?? '').replace(/\r\n/g, '\n')
    let span = matchPatchSpan(current, search)
    let actualReplace = replace

    if (!span && /^#\s+[^\n]+(?:\n+|$)/.test(search)) {
      const strippedSearch = search.replace(/^#\s+[^\n]+\n*/, '')
      const repTitle = /^#\s+([^\n]+)(?:\n+|$)/.exec(replace)
      if (repTitle) {
        patchedTitle = repTitle[1].trim()
        actualReplace = replace.slice(repTitle[0].length)
      }
      if (!strippedSearch.trim() && patchedTitle) {
        appliedCount += 1
        continue
      }
      span = matchPatchSpan(current, strippedSearch)
    }

    if (span) {
      let next = current.slice(0, span.start) + actualReplace + current.slice(span.end)
      if (!actualReplace.trim()) next = next.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
      current = next
      appliedCount += 1
    } else {
      failedHunks.push(search.trim().slice(0, 160))
    }
  }

  return { text: current, appliedCount, totalHunks, failedHunks, patchedTitle }
}

export function splitDraftMarkdownFile(raw) {
  const clean = String(raw ?? '').replace(/\r\n/g, '\n')
  const m = /^#\s+([^\n]+)(?:\n+|$)/.exec(clean)
  if (m) return { title: m[1].trim(), body: clean.slice(m[0].length).replace(/^\n+/, '').trimEnd() }
  return { title: '', body: clean.trimEnd() }
}

export function documentOutput(text, token) {
  const drafts = {}
  let reply = String(text ?? '')
  for (const [tag, key] of [['patch', 'patch'], ['spoken-patch', 'spokenPatch']]) {
    const start = `<media-desk-${tag} id="${token}">`
    const end = `</media-desk-${tag}>`
    const bodies = []
    let allComplete = true
    let searchFrom = 0
    while (true) {
      const at = reply.indexOf(start, searchFrom)
      if (at < 0) break
      const tail = reply.slice(at + start.length)
      const finish = tail.indexOf(end)
      if (finish < 0) {
        allComplete = false
        bodies.push(stripPartialEnd(tail, end).replace(/^\n/, '').trimEnd())
        reply = reply.slice(0, at)
        break
      }
      bodies.push(tail.slice(0, finish).replace(/^\n/, '').trimEnd())
      reply = reply.slice(0, at) + tail.slice(finish + end.length)
      searchFrom = at
    }
    if (bodies.length) drafts[key] = { text: bodies.join('\n\n'), complete: allComplete }
  }
  for (const kind of ['article', 'title', 'spoken']) {
    const start = `<media-desk-${kind} id="${token}">`
    const end = `</media-desk-${kind}>`
    const at = reply.lastIndexOf(start)
    if (at < 0) continue
    const tail = reply.slice(at + start.length)
    const finish = tail.indexOf(end)
    let body = finish < 0 ? stripPartialEnd(tail, end) : tail.slice(0, finish)
    drafts[kind] = { text: body.replace(/^\n/, '').trimEnd(), complete: finish >= 0 }
    reply = reply.slice(0, at) + (finish < 0 ? '' : tail.slice(finish + end.length))
  }
  // Hide incomplete protocol openings while preserving ordinary prose.
  reply = reply.replace(/<media-desk-(?:article|patch|title|spoken|spoken-patch)[^>]*$/, '').trim()
  return { reply, drafts }
}

const TRANSIENT_TRANSPORT_RE = /transport failed|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|stream.*terminated/i

function compactChatHistory(list) {
  const rows = Array.isArray(list) ? list.slice(-300) : []
  const cutoff = Math.max(0, rows.length - 20)
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') return row
    if (index < cutoff && (row.reasoning || row.activity)) {
      const { reasoning: _r, activity: _a, ...rest } = row
      return rest
    }
    if (Array.isArray(row.activity)) {
      return {
        ...row,
        ...(typeof row.reasoning === 'string' && row.reasoning.length > 1500 ? { reasoning: `${row.reasoning.slice(0, 1500)}…` } : {}),
        activity: row.activity.slice(-30).map(act => (act && typeof act.detail === 'string' && act.detail.length > 260 ? { ...act, detail: `${act.detail.slice(0, 260)}…` } : act)),
      }
    }
    return row
  })
}

/**
 * 将正文里引用的工作区内本地图片（如 01-内容生产/raw/assets/foo.png）同步到工作台 filesDir，
 * 并统一改写为 /media-desk/files/文件名，避免原生会话写工作区外部目录触发权限挂起。
 */
const SAFE_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export async function syncWorkspaceImages(markdown, cwd, filesDir) {
  if (!markdown || !cwd || !filesDir) return markdown
  const root = resolve(cwd)
  const matches = [...String(markdown).matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
  if (!matches.length) return markdown
  let next = String(markdown)
  let ensured = false
  for (const [full, alt, rawSrc] of matches) {
    if (/^(?:https?:|data:|\/?media-desk\/)/i.test(rawSrc)) continue
    const cleaned = rawSrc.replace(/^file:\/\//i, '')
    const abs = resolve(root, cleaned)
    if (abs !== root && !abs.startsWith(root + sep)) continue
    const ext = extname(abs).toLowerCase()
    if (!SAFE_IMAGE_EXT.has(ext)) continue
    const info = await stat(abs).catch(() => null)
    if (!info?.isFile()) continue
    if (!ensured) {
      await mkdir(filesDir, { recursive: true })
      ensured = true
    }
    const base = basename(abs, ext).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || newId('img')
    const fileName = `${base}${ext}`
    await copyFile(abs, join(filesDir, fileName))
    next = next.split(full).join(`![${alt}](/media-desk/files/${fileName})`)
  }
  return next
}

const messageText = event => (event.data?.message?.content ?? [])
  .filter(part => part.type === 'text').map(part => part.text).join('\n')
const failure = (message, status = 409) => Object.assign(new Error(message), { status })
const draftContext = (item, materials, filesDir) => {
  if (!item) return '当前没有打开选题。可以正常对话；如需在右侧写稿，请用户打开或新建一个选题。'
  const brief = formatCreationBrief(item.creation)
  const nativeFiles = []
  for (const att of item.attachments ?? []) {
    if (att?.file && filesDir) {
      nativeFiles.push(`- 附件「${att.name}」（${att.mime || 'file'}，${att.bytes ?? 0} bytes）→ 本机完整路径：${join(filesDir, att.file)}`)
    }
  }
  for (const mat of item.materials ?? []) {
    if (mat?.file && filesDir) {
      nativeFiles.push(`- 长文素材「${mat.name}」（${mat.chars ?? 0} 字）→ 本机完整原文路径：${join(filesDir, mat.file)}`)
    } else if (mat?.path) {
      nativeFiles.push(`- 引用素材「${mat.name}」→ 本机路径：${mat.path}`)
    }
  }
  return [
    `当前选题：${item.title}\n灵感与要求：${item.body ?? ''}${item.url ? `\n参考链接：${item.url}` : ''}`,
    brief ? `创作补充要求：\n${brief}` : '',
    nativeFiles.length ? `已挂载本机附件与完整资料（请直接调用原生文件/PDF/文档解析/视觉看图工具读取完整内容，勿仅凭摘要猜测）：\n${nativeFiles.join('\n')}` : '',
    `当前标题：${item.production?.title || item.title}\n当前正文（局部改稿时请从 <current-article> 内一字不差复制 SEARCH 原文片段）：\n<current-article>\n${item.production?.article ?? ''}\n</current-article>\n当前口播：\n${typeof item.production?.spoken === 'string' ? item.production.spoken : item.production?.spoken?.text ?? ''}`,
    `内联素材摘要：${JSON.stringify(materials)}`,
  ].filter(Boolean).join('\n\n')
}

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
    this.workspacePromise ??= (async () => {
      const saved = await this.settings?.read().catch(() => null)
      const paths = Array.isArray(saved?.writingFlow?.paths) ? saved.writingFlow.paths : []
      const claudeMd = paths.find(p => typeof p === 'string' && /(?:^|\/)CLAUDE\.md$/.test(p.trim()))
      if (claudeMd) {
        const candidate = dirname(claudeMd.trim())
        if ((await stat(candidate).catch(() => null))?.isDirectory()) return candidate
      }
      return ensureWorkspace(workspacePath(this.store.root))
    })()
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
  async start(id, { goal = 'xhs', prompt, mode, audience, thesis, creation } = {}) {
    if (this.active(id)) return false
    const hasExtraBrief = mode !== undefined || audience !== undefined || thesis !== undefined || Boolean(creation && typeof creation === 'object')
    if (hasExtraBrief) {
      await this.store.mutate('保存创作定调', draft => {
        const target = draft.items.find(row => row.id === id)
        if (!target || target.production?.status === 'running') return
        target.creation = cleanCreation({
          ...(creation && typeof creation === 'object' ? creation : {}),
          ...(CREATION_GOALS.includes(goal) ? { goal } : {}),
          ...(mode !== undefined ? { mode } : {}),
          ...(audience !== undefined ? { audience } : {}),
          ...(thesis !== undefined ? { thesis } : {}),
        }, target.creation)
      }, { undoable: false })
    }
    const state = await this.store.read()
    const item = state.items.find(row => row.id === id)
    if (!item) throw failure('找不到这个选题', 404)
    if (item.production?.status === 'running') return false
    const goalBase = goal === 'script'
      ? '根据这个选题与全部参考资料，直接生成可录制的完整口播稿。'
      : goal === 'both'
        ? '根据这个选题与全部参考资料，同时交付完整长文（article 标记）和配套口播稿（spoken 标记）。'
        : goal === 'article'
          ? '根据这个选题与全部参考资料，直接生成完整深度长文。'
          : '根据这个选题与全部参考资料，直接生成小红书图文稿，正文自然分段，适合排成图文卡片。'
    const custom = typeof prompt === 'string' && prompt.trim() ? prompt.trim() : ''
    const message = custom || (formatCreationBrief(item.creation) ? `${goalBase}\n请严格按 <author-brief> 里的模式定调、目标读者与核心判断展开，写出鲜明的个人判断与活人感。` : goalBase)
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
    let previous, initial, savedUser = false, surgicalMode = false, fileMirrorUpdated = null, iterator
    const timer = setTimeout(() => controller.abort(new Error('DSH 会话等待超时，请在原生会话中查看状态后重试')), 15 * 60_000)
    timer.unref?.()
    const publish = (text) => {
      const parsed = documentOutput(text, token)
      if (outputKind === 'spoken') {
        delete parsed.drafts.article
        delete parsed.drafts.patch
        delete parsed.drafts.title
      }
      if (surgicalMode) delete parsed.drafts.article
      if (fileMirrorUpdated && outputKind !== 'spoken') {
        parsed.drafts.article = { text: fileMirrorUpdated.body, complete: true, patched: true }
      } else if (!parsed.drafts.article && parsed.drafts.patch?.text && previous?.article) {
        const applied = applySurgicalPatches(previous.article, parsed.drafts.patch.text)
        if (applied.appliedCount > 0) {
          parsed.drafts.article = {
            text: applied.text,
            complete: parsed.drafts.patch.complete && applied.failedHunks.length === 0,
            patched: true,
          }
        }
      }
      const prevSpokenText = typeof previous?.spoken === 'string' ? previous.spoken : previous?.spoken?.text ?? ''
      if (!parsed.drafts.spoken && parsed.drafts.spokenPatch?.text && prevSpokenText) {
        const appliedSpoken = applySurgicalPatches(prevSpokenText, parsed.drafts.spokenPatch.text)
        if (appliedSpoken.appliedCount > 0) {
          parsed.drafts.spoken = {
            text: appliedSpoken.text,
            complete: parsed.drafts.spokenPatch.complete && appliedSpoken.failedHunks.length === 0,
            patched: true,
          }
        }
      }
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
      await ensureSessionModel(this.ctx, service, sessionId)
      const control = await service.state({ sessionId }, AbortSignal.timeout(15_000))
      if (control.running || control.queue?.length || control.pendingInput?.length) throw failure('DSH 会话正在运行或等待确认，请先在原生会话中完成当前操作')
      iterator = service.follow({ address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 2 }, controller.signal)[Symbol.asyncIterator]()
      const opening = await iterator.next()
      if (opening.done || opening.value?.type !== 'snapshot') throw new Error('DSH 会话流没有返回初始状态')
      const baseline = opening.value.cursor
      const materials = initial ? await draftMaterials(initial, this.store.filesDir) : []
      const settings = await this.settings?.read()
      const image = settings?.image
      const flowTarget = generate ? (goal === 'xhs' ? 'xhs' : goal === 'script' ? 'script' : 'article') : undefined
      const references = await nativeReferences({ state, settings, cwd, root: this.store.root ?? this.store.filesDir, target: flowTarget })
      const hasLegacyAssetDir = cwd ? Boolean((await stat(join(cwd, '01-内容生产', 'raw', 'assets')).catch(() => null))?.isDirectory()) : false
      const assetDir = cwd ? (hasLegacyAssetDir ? '01-内容生产/raw/assets' : 'assets') : this.store.filesDir
      const userWantsAction = /(?:截图|配图|补图|加图|原图|抓图|链接|网址|地址|仓库|查一下|搜一下|核实)/.test(message)
      const referenceText = [
        '你在阿东 IP 工作台内，通过同一个 DSH 原生会话与用户交互。请充分使用你的原生能力：附件与长文档读取（PDF、Office、图片视觉、表格、代码等）、联网搜索与网页抓取、终端与原生 Skills，保持原生权限流程。',
        references,
        '当选题带有本机附件路径或外部链接，或涉及论文、榜单、开源项目、行业新动态时，先用原生读取/搜索/网页/终端工具查清一手来源（若是论文优先查 arXiv 原文及 https://arxiv.org/html/<id>）。',
        `配图与真实截图铁律（尤其小红书图文）：解读论文、开源项目、新模型、工具盘点或榜单时，绝不交纯白板文字墙！单篇论文/单一主题优先下载 1～3 张核心原图（机制架构图、实验结果图）；**多项目/多工具盘点（如 N 个开源插件/仓库/案例）必须按条目逐一从原仓库 README（含 docs/、assets/ 图片）或官网拉取真实产品界面截图/演示图（若个别纯底层/无界面仓库确实没有截图，可用 GitHub 官方社交预览卡 https://opengraph.githubassets.com/1/<owner>/<repo> 兜底）**，用 curl 保存到当前工作区内的 ${JSON.stringify(assetDir)} 目录（纯英文连字符文件名，严禁写到工作区外的 /tmp 或 ~/.dsh 目录以免触发沙箱挂起！），并在正文中对应条目下写 ![图注](${assetDir}/文件名.png)，工作台会自动同步展示到卡片上（每张卡片最多放 1 张图）。`,
        '链接保真铁律（链接就是价值）：只要选题、母稿或检索资料里包含开源仓库、论文、官网或工具地址，正文中**每一个被盘点到的项目/工具都必须原样附上清晰完整的直达链接**（如 `🔗 链接：https://github.com/owner/repo`），严禁为了省字数删掉链接、合并吞掉部分链接或漏写 https://！',
        '母稿保真与反降智压缩铁律：当用户的「灵感与要求」或参考文稿已经给出了清晰的条目编号（如 1～8 号项目）、鲜活案例细节、生动比喻（如“毛坯房变积木”“二极管体验”）或关键判断时，**必须在原稿骨架与鲜活细节之上做增强（优化个人 IP 第一人称开头、核实细节、补齐全部链接与真实截图），严禁把原本生动的描述砍成干瘪碎句或装深沉的伪金句，也严禁擅自打乱顺序把多个独立项目硬揉成笼统大节**！',
        image?.source === 'http' && image.model ? `生图模型 ${image.model} 已配置。需要时把描述写入工作区内 UTF-8 文件，通过原生终端执行 node ${JSON.stringify(fileURLToPath(new URL('./native-image-cli.js', import.meta.url)))} ${JSON.stringify(this.store.root)} 图片描述文件路径，使用返回的真实 src。不要读取或展示 settings.json 的凭证；调用失败如实说明。` : '',
        '小红书图文成稿铁律（仅生成或重写小红书图文时适用）：① 个人 IP 第一人称黄金三段式首页（第 1 个 `##` 之前必须写满 145～190 字，绝不只写一句 80 字报幕词导致首页空半截！）：第一行写一级标题 `# 大标题`；紧接 3 个短自然段铺满首页——第 1 段用自然的第一人称「我…」（仅使用当前用户填写的身份与已核实经历，不借用他人身份或编造经历，**严禁写成自称名字的第三人称旁白腔**！）交代事件/关键数字并用 `**…**` 蓝底加粗点出核心反差；第 2 段点破现有习惯做法的真实痛点或工程摩擦；第 3 段亮出第一反应或核心追问并用 `==…==` 黄底高亮收尾勾人左滑（卡片页眉页脚已自带头像与座右铭，正文末尾无需再重复署名）。② 完整展开不卡页数、不降智压缩：按选题真实体量用有序条目或 `## 小标题` 完整铺开——**绝不限制 6 张卡或固定章节数，也绝不强压每张卡 100 字**（小红书最多支持 18 张图，切页由工作台排版器自动连排，绝不为凑页数删减内容，也严禁每节末尾硬憋一句同构伪金句！）。③ 重点标记必做：用 `**…**` 加粗条目主标题与核心判断句（信息流主题自动渲染为蓝底蓝字视觉锚点），并用 `==…==` 点缀 2～3 处核心洞察；`#标签` 只放在左侧外层短文案里，不塞进右侧卡片正文。④ 去 AI 味与去营销腔：严禁「不是…而是」堆叠、「首先其次最后」、虚动词官话以及“花2分钟帮你省两周”“建议反复收藏”“颠覆认知”这类卖课腔；卡片上不堆裸数学公式符号。⑤ 右侧 article 标记内放完整图文正文；左侧标记外另给带标题、标签的 200～280 字外层短总结。',
        `工作台执行与落盘规则：稿件由工作台直接接收并持久化，不要额外去写 小红书/*.md、公众号/*.md、对话历史.md，也不要跑 Python 字数统计脚本；但只要涉及外部仓库/论文或用户要求加截图/补配图/核实细节，**必须先真正调用原生终端 curl / 网页抓取 / 文件读取工具把缺的真实截图下载到工作区 ${JSON.stringify(assetDir)} 并写入正文**，绝不允许零工具调用就口头敷衍说“保留原图”！`,
      ].filter(Boolean).join('\n\n')
      const documentText = draftContext(initial, materials, this.store.filesDir)
      const context = { sessionId, references: contextHash(referenceText), draft: contextHash(documentText) }
      const cached = (focusId ? initial?.dshContext : state.dshGeneralContext)
      const sameSession = cached?.sessionId === sessionId
      const followUpVoiceGuard = sameSession && cached.references === context.references && initial
        ? `【续轮改稿风格护栏】改稿时必须继续保持当前创作者自然的第一人称（「我…」，严禁写成第三人称旁白腔！）与真实判断、断句呼吸感（${state.author?.bio || '作者未填写身份，不推测职业或经历'}）：保留完整仓库/论文直达链接与鲜活比喻细节，严禁砍成干瘪碎句或连续多节同构短格言收尾；若是小红书图文，首页（第一个 ## 之前）务必写满 145～190 字黄金三段式（事件反差 **加蓝** + 现状痛点 + 核心追问 ==加黄==），绝不只留几十字空首页。`
        : ''
      const wantsFullRewrite = generate || /(?:全文重写|重写全文|完整重写|整篇重写|推翻重写|全部重写|重新写一篇|重新生成整篇|对当前全文逐段)/.test(message)
      surgicalMode = Boolean(initial && !wantsFullRewrite && outputKind !== 'spoken' && String(previous?.article ?? '').trim())
      let draftFilePath = null
      let beforeMirrorRaw = null
      if (initial && focusId && outputKind !== 'spoken') {
        const cwdIsDir = cwd ? Boolean((await stat(cwd).catch(() => null))?.isDirectory()) : false
        const mirrorDir = cwdIsDir ? join(cwd, '.media-desk-drafts') : (this.store.filesDir ? join(this.store.filesDir, 'drafts') : null)
        if (mirrorDir) {
          const safeId = String(focusId).replace(/[^\w.-]+/g, '_')
          const candidatePath = join(mirrorDir, `${safeId}.md`)
          const initialTitle = previous?.title || initial.title || '未命名稿件'
          const initialBody = previous?.article ?? ''
          const initialRaw = `# ${initialTitle}\n\n${initialBody}\n`
          const wrote = await mkdir(mirrorDir, { recursive: true })
            .then(() => writeFile(candidatePath, initialRaw, 'utf8'))
            .then(() => true)
            .catch(() => false)
          if (wrote) {
            draftFilePath = candidatePath
            beforeMirrorRaw = initialRaw
          }
        }
      }
      const checkDraftMirror = async () => {
        if (!draftFilePath || beforeMirrorRaw === null) return null
        const diskRaw = await readFile(draftFilePath, 'utf8').catch(() => null)
        if (!diskRaw || !diskRaw.trim() || diskRaw === beforeMirrorRaw) return null
        const parsedFile = splitDraftMarkdownFile(diskRaw)
        if (!parsedFile.body && !parsedFile.title) return null
        fileMirrorUpdated = parsedFile
        return parsedFile
      }
      const protocolInstruction = !initial
        ? ''
        : surgicalMode
          ? [
              draftFilePath
                ? `【原生文件局部编辑模式（与 DSH CLI / Claude Code 完全一致，最高优先级）】当前稿件已映射为工作区内的真实 Markdown 文件：${draftFilePath}（第 1 行 "# 标题" 为稿件标题，下方为完整正文）。\n如果只是普通讨论，不要改文件；如果需要按用户要求修改稿件（改开头、改措辞、调顺序、补链接截图、或在指定处增加章节/段落），请**直接调用你的原生文件编辑工具（如 edit / str_replace）**精准定位并只编辑 ${draftFilePath} 里需要改动的那几行——就像在 DSH CLI / Claude Code 里改代码文档一样！**绝对严禁重写整个文件，绝对严禁改动用户未提及的任何其他段落、句式与标点！**\n用原生 edit 工具改好 ${draftFilePath} 后，工作台会自动从磁盘读取并实时刷新右侧图文卡片，你在聊天回复里只需简短说明改了哪处即可，无需把整篇稿子贴进聊天框！`
                : `【局部手术式改稿铁律（最高优先级）】当前已有写好的正文！用户这次只是局部修改，**严禁重新生成整篇稿子，严禁顺手改写、润色、缩减或调换用户未要求修改的任何段落、用词、标点、链接与配图**！`,
              `（兜底协议：仅在无法调用文件编辑工具时，才使用 <media-desk-patch id="${token}">\n<<<<<<< SEARCH\n（从 <current-article> 一字不差复制要改的 1～4 行原文）\n=======\n（替换后的新内容）\n>>>>>>> REPLACE\n</media-desk-patch> 输出局部补丁；改标题可用 <media-desk-title id="${token}">新标题</media-desk-title>；局部改口播用 <media-desk-spoken-patch id="${token}">。**任何情况下严禁输出 <media-desk-article> 覆盖全文！** 本地配图统一存放在 ${assetDir} 下并引用 ${assetDir}/文件名.png，不要直接编辑 state.json。）`,
            ].join('\n\n')
          : `只有需要更新稿件时才输出完整修改后的内容，正文包在 <media-desk-article id="${token}"> 与 </media-desk-article> 中${draftFilePath ? `（或直接用原生 write 工具写入完整 Markdown 到 ${draftFilePath}）` : ''}，口播包在 <media-desk-spoken id="${token}"> 与 </media-desk-spoken> 中。正文使用 Markdown 自然段，一级标题为稿件标题。工作台自动实时预览并保存，用户不需要复制或确认写回。解释和普通回答在标记之外；只是讨论或检索时不要输出标记。本地配图统一存放在当前工作区的 ${assetDir} 下并引用 ${assetDir}/文件名.png（不要写工作区外部路径，不要直接编辑 state.json）。`
      const instruction = [
        !sameSession || cached.references !== context.references ? referenceText : followUpVoiceGuard,
        firstTurn ? `工作台已有对话（只作历史上下文，以当前稿件为准）：${JSON.stringify(state.chat.filter(row => (row.itemId ?? null) === (focusId ?? null)).slice(-20).map(row => ({ role: row.role, text: String(row.text ?? '').slice(0, 2000) })))}` : '',
        !sameSession || cached.draft !== context.draft || surgicalMode ? documentText : '当前稿件和素材未变化，沿用本会话最近保存的版本。',
        protocolInstruction,
        initial && userWantsAction ? `【本轮强制动作检查】用户明确提到了截图/配图/链接或信息核实：1) 请先逐一核对正文中每个项目是否都已附上真实截图与完整 https:// 链接；凡是缺图的项目，立即调用原生工具从对应 GitHub 仓库（README / docs / assets，或兜底 https://opengraph.githubassets.com/1/owner/repo）下载图片到 ${assetDir} 并插入正文，严禁不调工具只改文字！2) 尊重并保留用户原始参考稿（灵感与要求）里的条目完整性与鲜活细节，不要砍成干瘪短句；3) 按当前作者的文风与真实经历用自然第一人称（「我…」）写开头，严禁第三人称旁白腔，作者身份未填写时不代编身份。` : '',
        generate ? `本轮是直接成稿：${goal === 'script' ? '请使用口播标记交付完整口播稿' : goal === 'xhs' ? '请交付小红书图文长稿及对话短总结' : '请使用正文标记交付完整长文'}，不要先问目标、观点或大纲。` : '',
        outputKind === 'spoken' ? '本轮由口播按钮触发，只使用 spoken 标记写入口播，不要输出 article；正文保持原样。' : '',
        `用户本次请求：\n${message}`,
      ].filter(Boolean).join('\n\n')
      await this.store.mutate('DSH 对话', draft => {
        draft.chat.push({ id: newId('c'), role: 'user', text: message, itemId: focusId, at: new Date().toISOString() })
        if (generate) {
          const item = draft.items.find(row => row.id === focusId)
          if (!item) throw failure('选题已删除', 404)
          item.creation = cleanCreation({ goal }, item.creation)
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
      const currentStyle = activeStyle(state)
      let committed = '', streaming = '', reasoning = '', reasoningStream = '', ended = false, retriedTransport = false, retriedQuality = false, retriedPatch = false, fallbackCommitted = ''
      let cursor = baseline
      while (true) {
        const { value, done } = await iterator.next()
        if (done) {
          if (fallbackCommitted && !committed.trim()) {
            committed = fallbackCommitted
            ended = true
          }
          break
        }
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
        if (!event || event.seq <= cursor) continue
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
          job.live.activity.push({ id: event.data.callId, name: event.data.name, status: 'running', detail: String(event.data.arguments ?? '').slice(0, 1200) })
          job.live.activity = job.live.activity.slice(-40)
        }
        if (event.type === 'tool/result') {
          const call = job.live.activity.find(row => row.id === event.data.message?.source?.callId)
          if (call) { call.status = event.data.message?.isError || event.data.error ? 'failed' : 'done' }
          job.live.phase = job.live.activity.some(row => row.status === 'running') ? 'tool' : 'waiting'
          await checkDraftMirror()
        }
        publish([committed, streaming].filter(Boolean).join('\n\n'))
        if (event.type === 'turn/end') {
          await checkDraftMirror()
          const reason = event.data.reason
          if (reason?.kind !== 'completed') {
            const errMsg = reason?.error?.message || ''
            if (!retriedTransport && !controller.signal.aborted && TRANSIENT_TRANSPORT_RE.test(errMsg)) {
              retriedTransport = true
              cursor = event.seq
              streaming = ''
              reasoningStream = ''
              job.live.phase = 'waiting'
              await ensureSessionModel(this.ctx, service, sessionId, { avoidAccount: true })
              await service.prompt({
                sessionId,
                mode: 'queue',
                requestId: `media-desk-${token}-resume`,
                content: [{ type: 'text', text: `刚才模型传输连接闪断（${errMsg}），前面已完成的检索与图片无需重做，请直接接着完成回复${initial ? `，稿件更新请包在 <media-desk-${surgicalMode ? 'patch' : 'article'} id="${token}"> 标记中` : ''}。` }],
              }, AbortSignal.timeout(30_000))
              continue
            }
            if (fallbackCommitted) {
              committed = fallbackCommitted
              ended = true
              break
            }
            throw new Error(errMsg || `DSH 本轮已停止：${reason?.kind ?? '未知原因'}，原稿已保留；可在 DSH 会话中继续。`)
          }
          // 局部手术刀硬拦截与补丁自愈：
          // 1) 若历史长会话惯性吐出了全文 <media-desk-article>，直接拦截打回，强制改用 <media-desk-patch> 只替换目标行；
          // 2) 若 SEARCH 块未能精确匹配原稿，自动把原稿对照发回让模型精确对齐一次。
          if (!fileMirrorUpdated && !retriedPatch && !controller.signal.aborted && previous?.article) {
            const patchProbe = documentOutput(committed, token)
            if (surgicalMode && patchProbe.drafts.article?.complete && !patchProbe.drafts.patch?.complete) {
              retriedPatch = true
              committed = ''
              streaming = ''
              reasoningStream = ''
              cursor = event.seq
              job.live.phase = 'waiting'
              await service.prompt({
                sessionId,
                mode: 'queue',
                requestId: `media-desk-${token}-force-patch`,
                content: [{
                  type: 'text',
                  text: `【系统拦截】本轮是局部修改，严禁输出 <media-desk-article> 覆盖整篇正文（会冲掉用户自己调好的句式和标点）！请严格只把需要修改的那几行写成 <media-desk-patch id="${token}">（使用 <<<<<<< SEARCH / ======= / >>>>>>> REPLACE，SEARCH 必须从下方 <current-article> 一字不差复制），其余未改段落一律不要输出：\n\n<current-article>\n${previous.article}\n</current-article>`,
                }],
              }, AbortSignal.timeout(30_000))
              continue
            }
            if (patchProbe.drafts.patch?.complete && (surgicalMode || !patchProbe.drafts.article?.complete)) {
              const checkPatch = applySurgicalPatches(previous.article, patchProbe.drafts.patch.text)
              if (checkPatch.totalHunks === 0 || checkPatch.failedHunks.length > 0) {
                retriedPatch = true
                fallbackCommitted = committed
                committed = ''
                streaming = ''
                reasoningStream = ''
                cursor = event.seq
                job.live.phase = 'waiting'
                const badSnippet = checkPatch.failedHunks[0] ?? patchProbe.drafts.patch.text.slice(0, 140)
                await service.prompt({
                  sessionId,
                  mode: 'queue',
                  requestId: `media-desk-${token}-pfix`,
                  content: [{
                    type: 'text',
                    text: `刚才 <media-desk-patch> 中的 SEARCH 片段未能与当前正文精确匹配（未匹配内容：${JSON.stringify(badSnippet)}）。请从下方 <current-article> 原文中**一字不差复制**要修改的那 1～4 行作为 SEARCH，重新输出 <media-desk-patch id="${token}">（其余未改部分切勿触碰）：\n\n<current-article>\n${previous.article}\n</current-article>`,
                  }],
                }, AbortSignal.timeout(30_000))
                continue
              }
            }
          }
          // 成稿完成时自动执行通用规则门禁：先规整空卡结构，若仍有硬性未达标项（无加粗、空洞短卡、AI套话/营销词/裸公式），自动发起 1 轮快速自检返修
          if (generate && !retriedQuality && !controller.signal.aborted && outputKind !== 'spoken' && (goal === 'xhs' || goal === 'article')) {
            const draftProbe = documentOutput(committed, token)
            const rawArticle = draftProbe.drafts.article?.complete ? draftProbe.drafts.article.text : ''
            if (rawArticle && visibleChars(rawArticle) >= 80) {
              const syncedProbe = await syncWorkspaceImages(rawArticle, cwd, this.store.filesDir)
              const normProbe = normalizeDraftStructure(syncedProbe, { fallbackTitle: initial?.title ?? '', goal })
              const annotatedProbe = autoAnnotateHighlights(normProbe.body, { goal })
              const auditProbe = auditDraftQuality(annotatedProbe.text, { title: normProbe.title || initial?.title || '', goal, style: currentStyle })
              if (auditProbe.hardFailures.length > 0 && auditProbe.fixPrompt) {
                retriedQuality = true
                fallbackCommitted = committed
                committed = ''
                streaming = ''
                reasoningStream = ''
                cursor = event.seq
                job.live.phase = 'waiting'
                await service.prompt({
                  sessionId,
                  mode: 'queue',
                  requestId: `media-desk-${token}-qfix`,
                  content: [{
                    type: 'text',
                    text: `${auditProbe.fixPrompt}\n\n请无需重新检索网页或重新下载图片，直接修整后将完整正文包在 <media-desk-article id="${token}"> 与 </media-desk-article> 中输出（外层短总结一并保留）。`,
                  }],
                }, AbortSignal.timeout(30_000))
                continue
              }
            }
          }
          ended = true
          break
        }
      }
      if (!ended) throw new Error('DSH 会话连接中断，原稿已保留')
      await checkDraftMirror()
      let output = documentOutput(committed, token)
      if (surgicalMode) delete output.drafts.article
      if (!fileMirrorUpdated && !output.drafts.article?.complete && !output.drafts.patch?.complete && fallbackCommitted) {
        const fb = documentOutput(fallbackCommitted, token)
        if (surgicalMode) delete fb.drafts.article
        if (fb.drafts.article?.complete || fb.drafts.patch?.complete) output = fb
      }
      let patchedTitle = output.drafts.title?.complete ? output.drafts.title.text.replace(/^#\s+/, '').trim() : ''
      let isSurgicalArticle = false
      if (fileMirrorUpdated && outputKind !== 'spoken') {
        output.drafts.article = { text: fileMirrorUpdated.body, complete: true, patched: Boolean(surgicalMode) }
        isSurgicalArticle = Boolean(surgicalMode)
        const origTitle = previous?.title || initial?.title || ''
        if (!patchedTitle && fileMirrorUpdated.title && fileMirrorUpdated.title !== origTitle) {
          patchedTitle = fileMirrorUpdated.title
        }
      } else if (!output.drafts.article?.complete && output.drafts.patch?.complete && previous?.article) {
        const applied = applySurgicalPatches(previous.article, output.drafts.patch.text)
        if (applied.appliedCount > 0) {
          output.drafts.article = { text: applied.text, complete: true, patched: true }
          isSurgicalArticle = true
          if (!patchedTitle && applied.patchedTitle) patchedTitle = applied.patchedTitle
        }
      }
      const prevSpokenText = typeof previous?.spoken === 'string' ? previous.spoken : previous?.spoken?.text ?? ''
      if (!output.drafts.spoken?.complete && output.drafts.spokenPatch?.complete && prevSpokenText) {
        const appliedSpoken = applySurgicalPatches(prevSpokenText, output.drafts.spokenPatch.text)
        if (appliedSpoken.appliedCount > 0) {
          output.drafts.spoken = { text: appliedSpoken.text, complete: true, patched: true }
        }
      }
      delete output.drafts.patch
      delete output.drafts.spokenPatch
      let normalizedArticle = null
      let qualityReport = null
      if (output.drafts.article?.text) {
        const syncedText = await syncWorkspaceImages(output.drafts.article.text, cwd, this.store.filesDir)
        if (isSurgicalArticle) {
          // 局部手术修改：严格保护用户未改段落，绝不跑全文结构重排或自动补高亮，只同步新增图片并静默更新质检状态
          output.drafts.article.text = syncedText
          if (visibleChars(syncedText) >= 80) {
            qualityReport = auditDraftQuality(syncedText, { title: patchedTitle || previous?.title || initial?.title || '', goal, style: currentStyle })
          }
        } else if (visibleChars(syncedText) >= 80 && (goal === 'xhs' || /^##\s+/m.test(syncedText))) {
          normalizedArticle = normalizeDraftStructure(syncedText, { fallbackTitle: initial?.production?.title || initial?.title || '', goal })
          if (generate) {
            const annotated = autoAnnotateHighlights(normalizedArticle.body, { goal })
            if (annotated.changed) normalizedArticle.body = annotated.text
          }
          qualityReport = auditDraftQuality(normalizedArticle.body, { title: normalizedArticle.title, goal, style: currentStyle })
        } else {
          let nextSynced = syncedText
          if (generate && visibleChars(nextSynced) >= 80) {
            nextSynced = autoAnnotateHighlights(nextSynced, { goal }).text
          }
          output.drafts.article.text = nextSynced
          if (visibleChars(nextSynced) >= 80) {
            const h1 = /^#\s+(.+)\n/.exec(nextSynced)?.[1]?.trim()
            const plainBody = h1 ? nextSynced.replace(/^#\s+.+\n+/, '') : nextSynced
            qualityReport = auditDraftQuality(plainBody, { title: h1 || initial?.title || '', goal, style: currentStyle })
          }
        }
      }
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
          const extractedH1 = !isSurgicalArticle && article ? /^#\s+(.+)\n/.exec(article)?.[1] : null
          const title = patchedTitle || (normalizedArticle ? normalizedArticle.title : extractedH1)
          const nextBody = isSurgicalArticle
            ? (article ?? null)
            : (normalizedArticle ? normalizedArticle.body : (article ? (extractedH1 ? article.replace(/^#\s+.+\n+/, '') : article) : null))
          const prevBody = previous?.article ?? ''
          const prevTitle = previous?.title || target.title
          const revisions = [...(target.production?.revisions ?? [])]
          if ((nextBody && prevBody && prevBody !== nextBody) || (title && title !== prevTitle && prevBody)) {
            revisions.push({ id: newId('hs'), at: now, label: generate ? '重新成稿前' : (isSurgicalArticle ? '局部修改前' : '助手改稿前'), title: prevTitle, article: prevBody })
          }
          target.production = {
            ...target.production,
            status: 'done',
            stage: 'done',
            format: article || target.production?.article ? 'article' : target.production?.format ?? 'script',
            title: title || target.production?.title || target.title,
            ...(normalizedArticle?.coverTitle && goal === 'xhs' ? { coverText: normalizedArticle.coverTitle.slice(0, 24) } : {}),
            ...(qualityReport ? { quality: { ok: qualityReport.ok, passCount: qualityReport.passCount, totalChecks: qualityReport.totalChecks, checks: qualityReport.checks, checkedAt: now } } : {}),
            ...(revisions.length ? { revisions: revisions.slice(-15) } : {}),
            updatedAt: now,
            finishedAt: now,
            error: null,
          }
          if (nextBody !== null) target.production.article = nextBody
          if (normalizedArticle?.extractedTags?.length && (!target.tags || !target.tags.length)) {
            target.tags = normalizedArticle.extractedTags.slice(0, 8)
          }
          if (documents.spoken) target.production.spoken = documents.spoken.text
          if (generate && goal === 'script' && !previous?.article) target.production.article = documents.spoken?.text ?? ''
          if (['idea', 'outline'].includes(target.status)) target.status = 'draft'
        }
        if (target) target.dshContext = { ...context, draft: contextHash(draftContext({ ...initial, production: target.production }, materials, this.store.filesDir)) }
        const answer = { id: newId('c'), role: 'assistant', text: output.reply || (changed ? '稿件已更新，可以在右侧查看。' : 'DSH 已完成本轮。'), itemId: focusId, at: new Date().toISOString(), engine: 'DSH 原生 Agent', reasoning: job.live.reasoning, activity: job.live.activity, sessionId, undoable: changed }
        draft.chat.push(answer)
        draft.chat = compactChatHistory(draft.chat)
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
        draft.chat = compactChatHistory(draft.chat)
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
