import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyCoverMode, cardContext, estimateFits, pageCharCount, paginate, planSections, renderCard } from '../client/layouts/cards.js'
import { parseBlocks } from '../client/layouts/markdown.js'
import { renderWechat, wechatParts } from '../client/layouts/wechat.js'
import { renderMarkdown } from '../client/md-render.js'
import { formatSpokenBreathLines } from '../client/video/captions.js'
import { articlePrompts } from '../src/ai.js'
import { cleanCreation, formatCreationBrief } from '../src/creation.js'
import plugin from '../src/host.js'
import { NativeAgent } from '../src/native-agent.js'
import { applyOps } from '../src/ops.js'
import { sanitizeArticleHtml } from '../src/sanitize.js'
import { buildSeed } from '../src/seed.js'

test('GFM 提示块与代码块语言标：公众号、卡片、清洗白名单和成稿预览全部兼容', () => {
  const md = [
    '> [!TIP] 避坑指南',
    '> 这里放一句**关键结论**。',
    '',
    '```python',
    'print("ok")',
    '```',
  ].join('\n')

  const blocks = parseBlocks(md)
  assert.deepEqual(blocks[0].callout, { kind: 'tip', title: '避坑指南' })
  assert.equal(blocks[1].lang, 'python')

  const wechat = renderWechat(md, 'tech-blue')
  assert.ok(wechat.includes('避坑指南'))
  assert.ok(wechat.includes('>关键结论</strong>'))
  assert.ok(wechat.includes('>python</span>'))

  // 进公众号草稿箱清洗后样式与文字都保留
  const sanitized = sanitizeArticleHtml(wechat)
  assert.ok(sanitized.includes('避坑指南'))
  assert.ok(sanitized.includes('border-left:'))
  assert.ok(sanitized.includes('python'))

  // 图文卡片渲染与成稿预览同样支持
  const ctx = cardContext({})
  const pages = paginate(planSections(`## 第一节\n${md}`, { title: '测试' }), estimateFits(ctx))
  const cardHtml = renderCard(pages[1], ctx)
  assert.ok(cardHtml.includes('避坑指南'))
  assert.ok(cardHtml.includes('python'))

  const previewHtml = renderMarkdown(md)
  assert.match(previewHtml, /<blockquote class="md-callout is-tip">/)
  assert.ok(previewHtml.includes('避坑指南'))
})

test('公众号外链转文末脚注：公网链接合并编号，微信自家链接保留原样', () => {
  const md = [
    '先看 [Folo](https://github.com/RSSNext/Folo) 和 [Postiz](https://github.com/gitroomhq/postiz-app)，',
    '再提一次 [Folo 仓库](https://github.com/RSSNext/Folo)，以及 [往期公众号](https://mp.weixin.qq.com/s/abc123)。',
  ].join('\n')

  const normal = wechatParts(md, 'default')
  assert.equal(normal.externalLinks, 2)
  assert.ok(normal.blocks[0].html.includes('（https://github.com/RSSNext/Folo）'))

  const footnoted = wechatParts(md, 'default', { linkFootnotes: true })
  assert.equal(footnoted.externalLinks, 2)
  const bodyHtml = footnoted.blocks[0].html
  assert.ok(bodyHtml.includes('>[1]</sup>'))
  assert.ok(bodyHtml.includes('>[2]</sup>'))
  assert.ok(!bodyHtml.includes('（https://github.com/RSSNext/Folo）'))
  // 微信自家链接不转脚注
  assert.ok(bodyHtml.includes('（https://mp.weixin.qq.com/s/abc123）'))
  const lastBlock = footnoted.blocks.at(-1).html
  assert.ok(lastBlock.includes('参考链接'))
  assert.ok(lastBlock.includes('Folo：https://github.com/RSSNext/Folo'))
  assert.ok(lastBlock.includes('Postiz：https://github.com/gitroomhq/postiz-app'))
})

test('小红书卡片 coverOnly 与孤页字数统计：封面只放标题，正文挪到第 2 页', () => {
  const md = '这是开头引子第一段。\n\n## 第一节\n正文内容足够长的一段话，用来测试正常卡片字数。'
  const raw = planSections(md, { title: '封面大标题' })
  assert.equal(raw[0].blocks.length, 1)

  const separated = applyCoverMode(raw, 'cover-bold', true)
  assert.equal(separated[0].kind, 'cover')
  assert.equal(separated[0].blocks.length, 0)
  assert.equal(separated[1].kind, 'content')
  assert.equal(pageCharCount(separated[0]), Infinity)
  assert.equal(pageCharCount(separated[1]), '这是开头引子第一段。'.length)
})

test('成稿版本历史快照：AI 改稿与显式快照自动留档，45 秒内连续手改不刷屏', () => {
  const state = buildSeed(new Date('2026-11-20T10:00:00Z'), 'zh')
  const item = state.items[0]
  item.production = { status: 'done', title: '初稿标题', article: '第一版正文内容' }

  applyOps(state, [{ op: 'update_production', id: item.id, article: '第二版正文内容', by: 'ai', snapshot: true, reason: '局部去 AI 味' }])
  assert.equal(item.production.revisions.length, 1)
  assert.equal(item.production.revisions[0].label, '局部去 AI 味')
  assert.equal(item.production.revisions[0].article, '第一版正文内容')

  // 紧接着普通手动打字保存，45 秒内不重复塞满历史栈；显式 snapshot 仍记录
  applyOps(state, [{ op: 'update_production', id: item.id, article: '第二版微调一字' }])
  assert.equal(item.production.revisions.length, 1)

  applyOps(state, [{ op: 'update_production', id: item.id, article: '第三版大改', snapshot: true, reason: '局部精简' }])
  assert.equal(item.production.revisions.length, 2)
  assert.equal(item.production.revisions[1].article, '第二版微调一字')
})

test('Host 新增接口：sources/brief 无模型兜底可用，produce/rewrite-selection 校验与返回正常', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-opt-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  process.env.MEDIA_DESK_SAMPLES = '1'
  const disposers = []
  try {
    let handler = null
    const ctx = {
      get: name => (name === 'connection' ? { requestRejection: () => undefined } : undefined),
      effect: (fn) => { const stop = fn(); if (typeof stop === 'function') disposers.push(stop) },
      webServer: { register: (options) => { handler = options.handler } },
    }
    plugin.apply(ctx)
    const call = (path, method = 'GET', payload = null) => new Promise((resolve) => {
      const chunks = payload ? [Buffer.from(JSON.stringify(payload))] : []
      const req = {
        url: `/media-desk/${path}`,
        method,
        headers: { 'x-media-desk-lang': 'zh', 'sec-fetch-site': 'same-origin' },
        async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
      }
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end: body => resolve({ status: res.statusCode, body: JSON.parse(body) }) }
      handler(req, res)
    })

    const stateRes = await call('state')
    assert.equal(stateRes.status, 200)

    const briefRes = await call('sources/brief', 'POST', {})
    assert.equal(briefRes.status, 200)
    assert.ok(Array.isArray(briefRes.body.picks))

    const badRewrite = await call('produce/rewrite-selection', 'POST', { id: 'missing', selection: '' })
    assert.equal(badRewrite.status, 400)

    // 一站式创作 Brief（上传多格式参考资料 + 硬性要求 + 切换风格 + 保存本机 PDF 参考路径）
    const styleId = stateRes.body.state.styles[0]?.id
    const launched = await call('brief/launch', 'POST', {
      title: '实测三个开源 Agent 工作台',
      styleId,
      creation: {
        goal: 'article',
        thesis: '真正决定体验的不是功能堆砌，而是 Brief 投喂顺不顺手。',
        requirements: '1. 开头直接给结论\n2. 必须引用 benchmark.json 里的耗时对比',
        audience: 'AI 创作者与开发者',
        lengthHint: '标准篇幅（1100–1600 字）',
      },
      files: [
        { name: 'benchmark.json', text: '{"toolA_ms": 420, "toolB_ms": 1350}' },
        { name: 'notes.md', text: '# 实测手记\n\n连续跑了 5 组用例，无一次崩溃。' },
      ],
      paths: ['~/Documents/spec.pdf'],
      startNow: false,
    })
    assert.equal(launched.status, 200)
    assert.ok(launched.body.id)
    assert.equal(launched.body.addedCount, 2)
    const created = launched.body.state.items.find(i => i.id === launched.body.id)
    assert.equal(created.creation.goal, 'article')
    assert.match(created.creation.requirements, /benchmark\.json/)
    assert.deepEqual(created.creation.refPaths, ['~/Documents/spec.pdf'])
    assert.equal(created.materials.length, 2)

    // 成稿提示词正确注入 <author-brief>
    const briefTag = formatCreationBrief(cleanCreation(created.creation))
    assert.match(briefTag, /<author-brief>/)
    assert.match(briefTag, /spec\.pdf/)
    const prompts = articlePrompts(launched.body.state, created, '', null, [])
    assert.match(prompts.user, /<author-brief>[\s\S]*benchmark\.json[\s\S]*<\/author-brief>/)
    assert.match(prompts.system, /优先严格落实/)

    // 原生附件上传（PDF / 二进制 / 图片）与灵感胶囊直接开写
    const uploadRaw = (query, mime, buf) => new Promise((resolve) => {
      const req = {
        url: `/media-desk/attach?${query}`,
        method: 'POST',
        headers: { 'content-type': mime, 'x-media-desk-lang': 'zh', 'sec-fetch-site': 'same-origin' },
        async *[Symbol.asyncIterator]() { yield buf },
      }
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end: body => resolve({ status: res.statusCode, body: JSON.parse(body) }) }
      handler(req, res)
    })
    const pdfRes = await uploadRaw('name=%E7%99%BD%E7%9A%AE%E4%B9%A62026.pdf', 'application/pdf', Buffer.from('%PDF-1.7 mock content'))
    assert.equal(pdfRes.status, 200)
    assert.equal(pdfRes.body.attachment.name, '白皮书2026.pdf')
    assert.match(pdfRes.body.attachment.file, /^att_[\w-]+\.pdf$/)

    const ideaRes = await call('idea/launch', 'POST', {
      title: '拆解这份 PDF 白皮书',
      body: '重点分析第三章架构演进',
      attachments: [pdfRes.body.attachment],
      goal: 'xhs',
      startNow: false,
    })
    assert.equal(ideaRes.status, 200)
    const ideaItem = ideaRes.body.state.items.find(i => i.id === ideaRes.body.id)
    assert.equal(ideaItem.attachments.length, 1)
    assert.equal(ideaItem.attachments[0].name, '白皮书2026.pdf')

    const rmRes = await call('ops', 'POST', {
      ops: [{ op: 'remove_attachment', id: ideaItem.id, attachmentId: pdfRes.body.attachment.id }],
    })
    assert.equal(rmRes.status, 200)
    assert.equal(rmRes.body.state.items.find(i => i.id === ideaItem.id).attachments.length, 0)
  } finally {
    for (const stop of disposers) stop()
    delete process.env.MEDIA_DESK_SAMPLES
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
})

test('口播按气口断句：清理 Markdown 符号、拆分超长句，不拆小数与域名', () => {
  const input = [
    '# 开场钩子',
    '',
    '- 很多人觉得 **GPT-4.5** 只是小更新，但我在 [github.com](https://github.com) 实测了整整三天之后发现它的长上下文稳定性提升了非常多，尤其是写复杂代码的时候几乎不会漏掉边界条件。',
  ].join('\n')
  const out = formatSpokenBreathLines(input, { maxUnits: 24 })
  const lines = out.split('\n')
  assert.equal(lines[0], '# 开场钩子')
  assert.equal(lines[1], '')
  assert.ok(lines.length >= 4)
  assert.ok(out.includes('GPT-4.5'))
  assert.ok(out.includes('github.com'))
  assert.ok(!out.includes('**'))
  assert.ok(!out.includes('https://'))
})

test('NativeAgent 向 DSH 原生会话传递真实附件完整路径与用户自定义开写指令', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-att-'))
  try {
    let state = {
      items: [{
        id: 'it_1',
        title: '评测报告拆解',
        body: '重点讲成本下降 60%',
        status: 'idea',
        attachments: [{ id: 'a1', name: 'report.pdf', file: 'att_demo.pdf', mime: 'application/pdf', bytes: 4096 }],
      }],
      chat: [],
      skills: [],
      styles: [],
    }
    const store = {
      root: dir,
      filesDir: join(dir, 'files'),
      read: async () => state,
      mutate: async (_l, fn) => { const d = structuredClone(state); const r = fn(d); state = d; return r },
    }
    let capturedPrompt = ''
    let token = ''
    const service = {
      create: async () => ({ sessionId: 'ses_att' }),
      state: async () => ({ running: null, queue: [], pendingInput: [] }),
      prompt: async (args) => {
        capturedPrompt = args.content[0].text
        token = capturedPrompt.match(/<media-desk-article id="([^"]+)"/)?.[1] ?? 'tok'
      },
      async *follow() {
        yield { type: 'snapshot', cursor: 1, records: [] }
        const text = `已解析附件成稿。\n<media-desk-article id="${token}">\n# 实测标题\n\n第一段正文。\n</media-desk-article>`
        yield { type: 'event', event: { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } } }
        yield { type: 'event', event: { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } } }
      },
    }
    const agent = new NativeAgent({
      ctx: { get: name => (name === 'sessionController' ? service : null) },
      store,
      settings: { read: async () => ({ writingFlow: { selected: [] } }) },
      cwd: '/workspace',
    })
    await agent.start('it_1', { goal: 'xhs', prompt: '请读取 report.pdf 并联网核实最新价格，写一篇小红书图文' })
    while (agent.active('it_1')) await new Promise(r => setTimeout(r, 10))
    assert.match(capturedPrompt, /att_demo\.pdf/)
    assert.match(capturedPrompt, /请读取 report\.pdf 并联网核实最新价格/)
    assert.equal(state.items[0].production.status, 'done')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('灵感异步启动成稿（asyncStart）：不等慢连接即刻返回，轮询桥接 connecting 状态且取消可干净复位', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-async-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const disposers = []
  try {
    let handler = null
    let releaseCreate = null
    const createGate = new Promise(r => { releaseCreate = r })
    let token = 'tok'
    const service = {
      create: async () => {
        await createGate
        return { sessionId: 'ses_slow' }
      },
      state: async () => ({ running: null, queue: [], pendingInput: [] }),
      cancel: () => {},
      prompt: async (args) => {
        token = args.content[0].text.match(/<media-desk-article id="([^"]+)"/)?.[1] ?? 'tok'
      },
      async *follow() {
        yield { type: 'snapshot', cursor: 1, records: [] }
        const text = `写好了。\n<media-desk-article id="${token}">\n# 秒开测试标题\n\n## 第一节\n\n第一段测试正文足够扎实，**重点判断**清晰明确，用来验证从灵感到正在成稿与最终成稿的无缝衔接。\n</media-desk-article>`
        yield { type: 'event', event: { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } } }
        yield { type: 'event', event: { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } } }
      },
    }
    plugin.apply({
      get: (name) => {
        if (name === 'sessionController') return service
        if (name === 'connection') return { requestRejection: () => undefined }
        return null
      },
      effect: fn => { const stop = fn(); if (typeof stop === 'function') disposers.push(stop) },
      webServer: { register: ({ handler: h }) => { handler = h } },
    })
    const call = (path, method = 'GET', payload = null) => new Promise((resolve) => {
      const raw = payload ? JSON.stringify(payload) : ''
      const req = {
        method,
        url: `/media-desk/${path}`,
        headers: payload ? { 'content-type': 'application/json' } : {},
        async *[Symbol.asyncIterator]() { if (raw) yield Buffer.from(raw) },
      }
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end: body => resolve({ status: res.statusCode, body: JSON.parse(body) }) }
      handler(req, res)
    })

    // 1. asyncStart: true 在 createGate 阻塞期间仍立即返回 started: true & launching: true
    const launched = await call('idea/launch', 'POST', {
      title: '测试笔记秒开不消失',
      body: '验证连接阶段轮询',
      goal: 'xhs',
      startNow: true,
      asyncStart: true,
    })
    assert.equal(launched.status, 200)
    assert.equal(launched.body.started, true)
    assert.equal(launched.body.launching, true)
    const itemId = launched.body.id

    // 2. 会话尚未建好时轮询 production，依然稳定返回 running + connecting，不会闪烁回空
    const pollConnecting = await call(`production?id=${encodeURIComponent(itemId)}`)
    assert.equal(pollConnecting.status, 200)
    assert.equal(pollConnecting.body.production.status, 'running')
    assert.equal(pollConnecting.body.live.phase, 'connecting')

    // 3. 放行会话创建，等待后台成稿完成
    releaseCreate()
    for (let i = 0; i < 40; i += 1) {
      const pollDone = await call(`production?id=${encodeURIComponent(itemId)}`)
      if (pollDone.body.production?.status === 'done') break
      await new Promise(r => setTimeout(r, 20))
    }
    const finalPoll = await call(`production?id=${encodeURIComponent(itemId)}`)
    assert.equal(finalPoll.body.production?.status, 'done')
  } finally {
    for (const stop of disposers) stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
})

test('信息流主题与用户自定义署名完整生效，且超 6 张图文卡片不限页完整展示并通过质检', async () => {
  const { TEST_SIGNATURE } = await import('./fixtures/signature.js')
  const { auditDraftQuality } = await import('../src/draft-quality.js')
  assert.equal(TEST_SIGNATURE.name, '示例创作者')
  assert.equal(TEST_SIGNATURE.id, '@demo-creator')
  assert.equal(TEST_SIGNATURE.left, '清楚表达')
  assert.equal(TEST_SIGNATURE.right, 'Keep creating')
  assert.match(TEST_SIGNATURE.avatar, /^data:image\/png;base64,/)

  const ctx = cardContext({ theme: 'adong-xhs-dense', template: 'default', cover: 'cover-bold' }, TEST_SIGNATURE, { date: '2026/11/21' })
  const chapters = Array.from({ length: 10 }, (_, idx) => (
    `## ${idx + 1}. 真实案例拆解第 ${idx + 1} 项\n我觉得第 ${idx + 1} 个开源工具最实在的价值是**把冷启动配置压缩到了 10 分钟以内**，我在本地对比了 3 组真实工程负载，==内存开销反而下降了 28%==，不过复杂多模态场景我还没来得及测完。`
  )).join('\n\n')
  const fullMd = `今天正好是 DeepSeek Harness 发布满 100 天，社区第三方插件早破 3.5 万，顺手挑 10 个最有意思的实战案例完整拆一遍：\n\n${chapters}`
  const pages = paginate(planSections(fullMd, { title: '大家真的把 DSH 玩出花了。。' }), estimateFits(ctx))
  assert.ok(pages.length >= 10, `expected >= 10 cards, got ${pages.length}`)

  const firstCardHtml = renderCard(pages[0], ctx)
  assert.ok(firstCardHtml.includes('示例创作者'))
  assert.ok(firstCardHtml.includes('@demo-creator'))
  assert.ok(firstCardHtml.includes('清楚表达'))
  assert.ok(firstCardHtml.includes('Keep creating'))
  assert.ok(firstCardHtml.includes('#0066FF'))
  assert.ok(firstCardHtml.includes(TEST_SIGNATURE.avatar.slice(0, 48)))

  const quality = auditDraftQuality(fullMd, { title: '大家真的把 DSH 玩出花了。。', goal: 'xhs' })
  const densityCheck = quality.checks.find(c => c.id === 'card-density')
  assert.equal(densityCheck.state, 'ok')
})

test('NativeAgent 续聊要求补截图/加链接时注入强制工具执行提醒，且 8 图合集连排无孤尾页', async () => {
  const { packPages, pageCharCount } = await import('../client/layouts/cards.js')
  const { TEST_SIGNATURE } = await import('./fixtures/signature.js')
  const { auditDraftQuality } = await import('../src/draft-quality.js')
  const dir = await mkdtemp(join(tmpdir(), 'native-followup-'))
  try {
    let state = {
      items: [{
        id: 'it_dsh8',
        title: '大家真的把 DSH 玩出花了',
        body: '1. OpenMotion https://github.com/nexu-io/openmotion',
        status: 'draft',
        dshSessionId: 'ses_existing',
        dshContext: { sessionId: 'ses_existing', references: 'same', draft: 'same' },
        production: { status: 'done', stage: 'done', format: 'article', title: '大家真的把 DSH 玩出花了', article: '初稿正文。' },
      }],
      chat: [],
      skills: [],
      styles: [],
    }
    const store = {
      root: dir,
      filesDir: join(dir, 'files'),
      read: async () => state,
      mutate: async (_l, fn) => { const d = structuredClone(state); const r = fn(d); state = d; return r },
    }
    const prompts = []
    let token = ''
    const service = {
      create: async () => ({ sessionId: 'ses_existing' }),
      state: async () => ({ running: null, queue: [], pendingInput: [] }),
      prompt: async (args) => {
        prompts.push(args.content[0].text)
        token = args.content[0].text.match(/<media-desk-(?:patch|article) id="([^"]+)"/)?.[1] ?? 'tok'
      },
      async *follow() {
        yield { type: 'snapshot', cursor: 1, records: [] }
        const text = `已补全截图和链接。\n<media-desk-patch id="${token}">\n<<<<<<< SEARCH\n初稿正文。\n=======\n我是阿东。今天正好满 100 天。\n>>>>>>> REPLACE\n</media-desk-patch>`
        yield { type: 'event', event: { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } } }
        yield { type: 'event', event: { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } } }
      },
    }
    const agent = new NativeAgent({
      ctx: { get: name => (name === 'sessionController' ? service : null) },
      store,
      settings: { read: async () => ({ writingFlow: { selected: [] } }) },
      cwd: '/workspace',
    })
    // 第一轮建立真实缓存哈希，第二轮模拟同会话追问补截图与链接
    await agent.run({ focusId: 'it_dsh8', message: '先看一下当前稿子' })
    await agent.run({ focusId: 'it_dsh8', message: '8个都得附加链接 因为链接就是价值，还有截图 开头记得优化下 阿东个人ip这种' })
    assert.match(prompts[0], /链接保真铁律/)
    assert.match(prompts[0], /母稿保真与反降智压缩铁律/)
    assert.match(prompts[1], /【本轮强制动作检查】/)
    assert.match(prompts[1], /严禁不调工具只改文字/)

    // 验证 8 个项目（每个带长介绍 + 独立链接 + 截图）经过 packPages 连排后无半空孤尾页
    const itemsMd = Array.from({ length: 8 }, (_, idx) => [
      `## ${idx + 1}. 项目案例 ${idx + 1}（实战工具）`,
      '',
      `这个开源工具可以直接在 DSH 侧栏里运行，内置完整模板与多端同步支持，**最省心的是 Agent 会自己先试玩排错**，做完一键导出部署。`,
      '',
      `🔗 链接：[https://github.com/demo/project-${idx + 1}](https://github.com/demo/project-${idx + 1})`,
      '',
      `![项目 ${idx + 1} 截图](/media-desk/files/p${idx + 1}.png)`,
    ].join('\n')).join('\n\n')
    const full = `我是阿东。今天正好是 DSH 发布满 100 天，我自己日常工作流都在里面跑，==社区把二极管体验补成了随便搭的积木房==：\n\n${itemsMd}`
    const ctx = cardContext({ theme: 'adong-xhs-dense', template: 'default', cover: 'cover-bold' }, TEST_SIGNATURE, { date: '2026/11/21', article: full })
    const fits = estimateFits(ctx)
    const rawSections = planSections(full, { title: '大家真的把 DSH 玩出花了。。', resolveImage: () => ({ src: 'data:image/png;base64,AAAA', width: 1400, height: 860 }) })
    const packed = packPages(paginate(rawSections, fits), fits, { includeCover: true })
    const renderedPages = packed.map(p => ({
      kind: p.kind,
      number: p.number,
      line: p.line,
      continued: p.continued,
      blocks: p.blocks,
      chars: pageCharCount(p),
      hasMedia: p.blocks.some(b => b.type === 'image'),
    }))
    const report = auditDraftQuality(full, { title: '大家真的把 DSH 玩出花了。。', goal: 'xhs', renderedPages })
    assert.equal(report.ok, true, JSON.stringify(report.checks))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('局部手术式改稿（<media-desk-patch>）与跨页续接绝不重复幽灵小标题', async () => {
  const { applySurgicalPatches } = await import('../src/native-agent.js')
  const { packPages } = await import('../client/layouts/cards.js')
  const { TEST_SIGNATURE } = await import('./fixtures/signature.js')

  // 1. 验证 applySurgicalPatches 仅替换目标片段，未改段落（含特殊标点、链接、用词）100% 逐字锁定不动
  const originalArticle = [
    '我是阿东，这段开头是我自己手改定稿的，标点。。和语气一字不许动！',
    '',
    '## 3. dsh-game-studio（一句话做小游戏）',
    '',
    '用大白话描述玩法，侧栏就能实时预览可玩的 2D/3D 体素小游戏。',
    '',
    '🔗 链接：https://github.com/ZSeven-W/dsh-game-studio',
    '',
    '![dsh-game-studio](/media-desk/files/dsh-game-studio.png)',
    '',
    '左边是对话，右边侧栏直接开玩；6 张 AI 美术换皮花了不到一毛钱。',
    '',
    '## 4. dsh-our-free-model（免费前沿模型）',
    '',
    '装上就能直接调 DeepSeek V4.1 Flash、Kimi K3 等前沿模型，无需登录、注册或填 API Key，**纯挂载零依赖（8.2 万星）。**注意额度按出口 IP 算，撞一次 429 锁 6 小时，敏感代码别往里喂。',
  ].join('\n')

  const patchRes = applySurgicalPatches(originalArticle, [
    '<<<<<<< SEARCH',
    '🔗 链接：https://github.com/ZSeven-W/dsh-game-studio',
    '=======',
    '🔗 链接：github.com/ZSeven-W/dsh-game-studio',
    '>>>>>>> REPLACE',
  ].join('\n'))
  assert.equal(patchRes.appliedCount, 1)
  assert.equal(patchRes.failedHunks.length, 0)
  assert.ok(patchRes.text.startsWith('我是阿东，这段开头是我自己手改定稿的，标点。。和语气一字不许动！\n\n## 3. dsh-game-studio'))
  assert.ok(patchRes.text.includes('🔗 链接：github.com/ZSeven-W/dsh-game-studio'))
  assert.ok(patchRes.text.endsWith('注意额度按出口 IP 算，撞一次 429 锁 6 小时，敏感代码别往里喂。'))

  // 2. 复现用户截图 Bug：当第 3 节末尾图注溢到下一页且紧接第 4 节时，绝不允许在下一页顶部凭空重复印一次「3. dsh-game-studio」标题
  const ctx = cardContext({ theme: 'adong-xhs-dense', template: 'default', cover: 'cover-bold', font: '冬青黑体', fontSize: 17 }, TEST_SIGNATURE, { date: '2026/11/21', article: patchRes.text })
  const fits = estimateFits(ctx)
  const sections = planSections(patchRes.text, {
    title: '大家真的把 DSH 玩出花了',
    resolveImage: () => ({ src: 'data:image/png;base64,AAAA', width: 1600, height: 1054 }),
  })
  const packed = packPages(paginate(sections, fits), fits, { includeCover: true })
  const allCardsHtml = packed.map(p => renderCard(p, ctx)).join('\n')
  const gameHeadingCount = (allCardsHtml.match(/3\. dsh-game-studio（一句话做小游戏）/g) ?? []).length
  const freeHeadingCount = (allCardsHtml.match(/4\. dsh-our-free-model（免费前沿模型）/g) ?? []).length
  assert.equal(gameHeadingCount, 1, `第 3 节标题在所有卡片中只能出现 1 次，实际出现 ${gameHeadingCount} 次`)
  assert.equal(freeHeadingCount, 1, `第 4 节标题在所有卡片中只能出现 1 次，实际出现 ${freeHeadingCount} 次`)
})

test('分页规则：默认按 ## 二级标题独立换页，且标题前后的 --- 在任何模式下均强制换页不失效', async () => {
  const { dedupeSectionHeadings, numberPages, packPages, paginateSection } = await import('../client/layouts/cards.js')
  const { TEST_SIGNATURE } = await import('./fixtures/signature.js')

  const mdWithRuleBeforeH2 = [
    '我是阿东，今天 DSH 满 100 天。',
    '',
    '我这几个月的工作流基本搬进了 DSH。==所以看这波生态，我先看它替我省了哪一步。==',
    '',
    '---',
    '',
    '## 1. OpenMotion（视频动效工作室）',
    '',
    '开源全栈 agentic 视频工具，内置 300+ 顶尖品牌视频模板。',
    '',
    '---',
    '',
    '补充一段手动 --- 换页后的说明。',
    '',
    '## 2. DS-Bot（长期 Bot 团队）',
    '',
    '把 DSH 变成常驻 AI 同事团队。',
  ].join('\n')

  const ctx = cardContext({ theme: 'adong-xhs-dense', template: 'default', cover: 'cover-bold', font: '冬青黑体', fontSize: 17 }, TEST_SIGNATURE, { date: '2026/11/21', article: mdWithRuleBeforeH2 })
  const fits = estimateFits(ctx)
  const rawSections = dedupeSectionHeadings(planSections(mdWithRuleBeforeH2, { title: '大家真的把 DSH 玩出花了。。', headingLevel: 2 }))
  const rawPages = rawSections.flatMap(sec => paginateSection(sec, fits, { repeatHeading: false }))

  // 1. 默认模式（按 ## 二级标题 + --- 分页）：封面、第1节前半、第1节 --- 后半、第2节严格分成 4 张独立卡片
  const normalPages = numberPages(rawPages)
  assert.equal(normalPages.length, 4)
  assert.doesNotMatch(renderCard(normalPages[0], ctx), /OpenMotion/)
  assert.match(renderCard(normalPages[1], ctx), /1\. OpenMotion/)
  assert.match(renderCard(normalPages[2], ctx), /补充一段手动 --- 换页后的说明/)
  assert.doesNotMatch(renderCard(normalPages[2], ctx), /1\. OpenMotion/)
  assert.match(renderCard(normalPages[3], ctx), /2\. DS-Bot/)

  // 2. 即使开启跨节紧凑连排（packPages），写在 ## 之前的 --- 依然传递 hardBreak 强制换页，绝不把 OpenMotion 吸回封面
  const compactPages = packPages(rawPages, fits, { includeCover: true })
  assert.doesNotMatch(renderCard(compactPages[0], ctx), /OpenMotion/, '写了 --- 后封面绝不能把下一节 ## 吸上来')
  assert.match(renderCard(compactPages[1], ctx), /1\. OpenMotion/)
})

test('NativeAgent 硬性局部拦截：即使旧会话模型惯性吐出全文 <media-desk-article>，也会被系统拦截并强制转为局部 <media-desk-patch>', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-hard-patch-'))
  try {
    const userLockedOpening = '我是阿东，这段开头和双句号。。是我手改定稿的，任何AI不准碰它半个字！'
    const userLockedEnding = '这是结尾段，也一字不许动。'
    let state = {
      items: [{
        id: 'it_lock',
        title: '测试硬拦截',
        status: 'draft',
        dshSessionId: 'ses_old',
        production: {
          status: 'done',
          stage: 'done',
          format: 'article',
          title: '测试硬拦截',
          article: `${userLockedOpening}\n\n## 中间节\n\n链接：https://github.com/nexu-io/openmotion\n\n${userLockedEnding}`,
        },
      }],
      chat: [],
      skills: [],
      styles: [],
    }
    const store = {
      root: dir,
      filesDir: join(dir, 'files'),
      read: async () => state,
      mutate: async (_l, fn) => { const d = structuredClone(state); const r = fn(d); state = d; return r },
    }
    const prompts = []
    let token = ''
    let turn = 0
    const service = {
      create: async () => ({ sessionId: 'ses_old' }),
      state: async () => ({ running: null, queue: [], pendingInput: [] }),
      prompt: async (args) => {
        prompts.push(args.content[0].text)
        token = args.content[0].text.match(/<media-desk-patch id="([^"]+)"/)?.[1] ?? token
      },
      async *follow() {
        yield { type: 'snapshot', cursor: 1, records: [] }
        // 第 1 轮：模拟顽固模型无视指令，擅自吐出改乱了开头的全文 <media-desk-article>
        const badFull = `我把整篇重写了。\n<media-desk-article id="${token}">\n# 测试硬拦截\n\n阿东把你的开头偷偷改掉了！\n\n## 中间节\n\n链接：github.com/nexu-io/openmotion\n</media-desk-article>`
        yield { type: 'event', event: { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: badFull }] } } } }
        yield { type: 'event', event: { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } } }

        // 第 2 轮（被系统拦截打回后）：模型乖乖只输出局部 <media-desk-patch>
        turn = 2
        const goodPatch = `已只替换链接。\n<media-desk-patch id="${token}">\n<<<<<<< SEARCH\n链接：https://github.com/nexu-io/openmotion\n=======\n链接：github.com/nexu-io/openmotion\n>>>>>>> REPLACE\n</media-desk-patch>`
        yield { type: 'event', event: { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: goodPatch }] } } } }
        yield { type: 'event', event: { seq: 5, type: 'turn/end', data: { reason: { kind: 'completed' } } } }
      },
    }
    const agent = new NativeAgent({
      ctx: { get: name => (name === 'sessionController' ? service : null) },
      store,
      settings: { read: async () => ({ writingFlow: { selected: [] } }) },
      cwd: '/workspace',
    })
    await agent.run({ focusId: 'it_lock', message: '把中间那个链接去掉 https://' })
    assert.equal(turn, 2)
    assert.equal(prompts.length, 2)
    assert.match(prompts[1], /【系统拦截】/)
    const finalArticle = state.items[0].production.article
    assert.ok(finalArticle.startsWith(userLockedOpening), '用户手改的开头必须 100% 逐字保留')
    assert.ok(finalArticle.endsWith(userLockedEnding), '用户手改的结尾必须 100% 逐字保留')
    assert.ok(finalArticle.includes('链接：github.com/nexu-io/openmotion'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('produce/rewrite-selection：选中短锚点（如 ## 9.）要求扩写新章节时，直连轻量模型秒级返回且带入实时上下文', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rewrite-expand-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const disposers = []
  try {
    let handler = null
    let capturedSystem = ''
    let capturedUser = ''
    let usedProvider = ''
    const ctx = {
      get: (name) => {
        if (name === 'connection') return { requestRejection: () => undefined }
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-v4-pro' }) }
        if (name === 'llm') {
          return {
            listProviders: async () => [{ id: 'deepseek-account' }, { id: 'deepseek-official' }],
            listModels: async (p) => (p === 'deepseek-official' ? [{ id: 'deepseek-v4-pro' }] : []),
            prepareCall: async (opts) => {
              usedProvider = opts.provider
              return {
                config: {},
                async *stream(req) {
                  capturedSystem = req.system
                  capturedUser = req.messages[0].content[0].text
                  yield { type: 'text-delta', text: '## 9. dsh-media-desk（阿东自媒体工作台）\n\n我自己搓在 DSH 里的全流程内容插件，选题、改稿、排小红书卡片一气呵成。' }
                  yield { type: 'finish', reason: { kind: 'stop' } }
                },
              }
            },
          }
        }
        return undefined
      },
      effect: (fn) => { const stop = fn(); if (typeof stop === 'function') disposers.push(stop) },
      webServer: { register: (options) => { handler = options.handler } },
    }
    plugin.apply(ctx)
    const call = (path, method = 'GET', payload = null) => new Promise((resolve) => {
      const chunks = payload ? [Buffer.from(JSON.stringify(payload))] : []
      const req = {
        url: `/media-desk/${path}`,
        method,
        headers: { 'x-media-desk-lang': 'zh', 'sec-fetch-site': 'same-origin' },
        async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
      }
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end: body => resolve({ status: res.statusCode, body: JSON.parse(body) }) }
      handler(req, res)
    })

    const created = await call('idea/launch', 'POST', { title: '大家真的把 DSH 玩出花了', body: '盘点 DSH 实用插件', startNow: false })
    const itemId = created.body.id
    const res = await call('produce/rewrite-selection', 'POST', {
      id: itemId,
      selection: '## 9.',
      mode: 'custom',
      instruction: '加一个章节：自媒体工作台',
      beforeContext: '## 8. OpenMotion（视频动效工作室）\n\n开源全栈视频工具。\n\n🔗 链接：github.com/nexu-io/openmotion',
      afterContext: '## 100 天看下来，我最大的感受',
    })
    assert.equal(res.status, 200)
    assert.equal(usedProvider, 'deepseek-official', '自动避开 deepseek-account 走可用的 deepseek-official 直连通道')
    assert.match(capturedSystem, /扩写、新增段落或补充章节/)
    assert.match(capturedUser, /OpenMotion/)
    assert.match(res.body.replacement, /## 9\. dsh-media-desk/)
  } finally {
    for (const stop of disposers) stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
})

test('NativeAgent 原生文件映射编辑（同 DSH CLI / Claude Code）：直接用 edit 工具改本地 .md 文件即可同步回稿件且零标签零重写', async () => {
  const { readFile, writeFile } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'native-md-file-'))
  try {
    const keepStart = '我是阿东，这段开头是我亲自写的，标点。。一字不准改！'
    const keepEnd = '这是结尾段，也一字不准改！'
    let state = {
      items: [{
        id: 'it_file',
        title: '大家真的把 DSH 玩出花了',
        status: 'draft',
        dshSessionId: 'ses_cli_style',
        production: {
          status: 'done',
          stage: 'done',
          format: 'article',
          title: '大家真的把 DSH 玩出花了',
          article: `${keepStart}\n\n## 8. dsh-market\n\n插件商店。\n\n${keepEnd}`,
        },
      }],
      chat: [],
      skills: [],
      styles: [],
    }
    const store = {
      root: dir,
      filesDir: join(dir, 'files'),
      read: async () => state,
      mutate: async (_l, fn) => { const d = structuredClone(state); const r = fn(d); state = d; return r },
    }
    let mirrorPath = ''
    const service = {
      create: async () => ({ sessionId: 'ses_cli_style' }),
      state: async () => ({ running: null, queue: [], pendingInput: [] }),
      prompt: async (args) => {
        const text = args.content[0].text
        mirrorPath = text.match(/真实 Markdown 文件：([^\s（]+\.md)/)?.[1] ?? ''
      },
      async *follow() {
        yield { type: 'snapshot', cursor: 1, records: [] }
        yield { type: 'event', event: { seq: 2, type: 'tool/call', data: { callId: 'c1', name: 'edit', arguments: mirrorPath } } }
        // 模拟 DSH 原生 edit 工具直接局部修改磁盘上的 .md 文件，不吐任何 XML 标签
        const before = await readFile(mirrorPath, 'utf8')
        const edited = before.replace('插件商店。', '插件商店。\n\n## 9. dsh-media-desk（自媒体工作台）\n\n我自己在 DSH 里搓的全流程内容工作台。')
        await writeFile(mirrorPath, edited, 'utf8')
        yield { type: 'event', event: { seq: 3, type: 'tool/result', data: { message: { source: { callId: 'c1' }, isError: false } } } }
        yield { type: 'event', event: { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已经在第 8 节后面用 edit 工具插入了第 9 节「自媒体工作台」，其余段落一字未动。' }] } } } }
        yield { type: 'event', event: { seq: 5, type: 'turn/end', data: { reason: { kind: 'completed' } } } }
      },
    }
    const agent = new NativeAgent({
      ctx: { get: name => (name === 'sessionController' ? service : null) },
      store,
      settings: { read: async () => ({ writingFlow: { selected: [] } }) },
      cwd: dir,
    })
    await agent.run({ focusId: 'it_file', message: '在第8节后面加第9节：自媒体工作台' })
    assert.ok(mirrorPath.endsWith('it_file.md'))
    const saved = state.items[0].production.article
    assert.ok(saved.startsWith(keepStart))
    assert.ok(saved.endsWith(keepEnd))
    assert.ok(saved.includes('## 9. dsh-media-desk（自媒体工作台）'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
