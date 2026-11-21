import test, { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { NativeAgent, documentOutput, syncWorkspaceImages } from '../src/native-agent.js'
import { scriptOf } from '../client/video/captions.js'

function setup({ error, conflict, plain, partial, spoken, reasoning, waiting, extraArticle } = {}) {
  let state = { items: [{ id: 'topic', title: '测试选题', status: 'draft', production: { status: 'done', format: 'article', article: '原稿', title: '原标题' } }], chat: [], skills: [], styles: [] }
  const root = mkdtempSync(join(tmpdir(), 'native-agent-test-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  const store = { root, filesDir: join(root, 'files'), read: async () => state, mutate: async (_label, fn) => { const draft = structuredClone(state); const result = fn(draft); state = draft; return result } }
  const calls = []
  let prompted
  const promptReady = new Promise(resolve => { prompted = resolve })
  const settings = { writingFlow: { selected: [] } }
  let text, token
  const service = {
    create: async args => { calls.push(['create', args]); return { sessionId: 'session-topic' } },
    state: async () => ({ running: null, queue: [], pendingInput: [] }),
    cancel: args => { calls.push(['cancel', args]) },
    prompt: async args => { calls.push(['prompt', args]); prompted(); token = args.content[0].text.match(/<media-desk-(?:article|patch|spoken) id="([^"]+)"/)?.[1]; text = spoken ? `改好了。<media-desk-spoken id="${token}">口播第一句。\n口播第二句。</media-desk-spoken>${extraArticle ? `<media-desk-article id="${token}">模型误改的正文</media-desk-article>` : ''}` : plain ? '我可以帮你查资料。' : `修改好了。\n<media-desk-article id="${token}">\n# 新标题\n\n第一段。\n\n第二段。${partial ? '' : '\n</media-desk-article>'}` },
    async *follow(_args, signal) {
      yield { type: 'snapshot', cursor: 10, records: [{ type: 'assistant/message', seq: 8, data: { message: { content: [{ type: 'text', text: '旧回复' }] } } }] }
      if (waiting) await new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      yield { type: 'event', event: { seq: 11, type: 'tool/call', data: { callId: 'call', name: 'read_file', arguments: '{"path":"CLAUDE.md"}' } } }
      yield { type: 'assistant-stream', frame: { type: 'start' } }
      if (reasoning) yield { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '先读原稿，保留事实。' } } }
      yield { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text } } }
      if (conflict) await store.mutate('manual', draft => { draft.items[0].production.article = '用户刚刚手改' })
      yield { type: 'event', event: { seq: 12, type: 'tool/result', data: { message: { source: { callId: 'call' } } } } }
      yield { type: 'event', event: { seq: 13, type: 'assistant/message', data: { message: { content: [...(reasoning ? [{ type: 'reasoning', text: '先读原稿，保留事实。' }] : []), { type: 'text', text }] } } } }
      yield { type: 'event', event: { seq: 14, type: 'turn/end', data: { reason: error ? { kind: 'error', error: { message: '测试失败' } } : { kind: 'completed' } } } }
    },
  }
  const agent = new NativeAgent({ ctx: { get: name => name === 'sessionController' ? service : null }, store, settings: { read: async () => settings }, cwd: '/workspace' })
  return { agent, store, calls, settings, promptReady }
}

test('原生 Agent 复用会话，流式预览和工具事件直接来自 DSH，成功后写回', async () => {
  const { agent, store, calls } = setup()
  const updates = []
  const result = await agent.run({ focusId: 'topic', message: '完整重写全文' }, update => updates.push(structuredClone(update)))
  assert.ok(updates.some(row => row.text.includes('第一段')))
  assert.equal(result.answer.activity[0].status, 'done')
  assert.equal(result.state.items[0].production.article, '第一段。\n\n第二段。')
  assert.equal(result.state.items[0].production.title, '新标题')
  assert.ok(!result.answer.text.includes('media-desk-'))
  assert.equal(agent.active('topic'), false)
  await agent.run({ focusId: 'topic', message: '再次完整重写全文' })
  assert.equal(calls.filter(row => row[0] === 'create').length, 1)
  assert.deepEqual(calls[0][1], { cwd: '/workspace' })
  assert.equal((await store.read()).chat.length, 4)
})

test('原生生成的口播能由视频工作台直接读取，后续对话携带已存口播', async () => {
  const { agent, store, calls } = setup({ spoken: true })
  await agent.run({ focusId: 'topic', message: '生成口播', outputKind: 'spoken' })
  const production = (await store.read()).items[0].production
  assert.equal(scriptOf(production), '口播第一句。\n口播第二句。')
  assert.equal(production.article, '原稿')
  await agent.run({ focusId: 'topic', message: '继续改口播', outputKind: 'spoken' })
  assert.ok(calls.filter(row => row[0] === 'prompt')[1][1].content[0].text.includes('当前稿件和素材未变化'))
  await store.mutate('manual', state => { state.items[0].production.spoken = '我手改过的口播' })
  await agent.run({ focusId: 'topic', message: '看一下我的修改' })
  assert.ok(calls.filter(row => row[0] === 'prompt')[2][1].content[0].text.includes('我手改过的口播'))
})

test('口播复用原生会话，思考、工具状态和稿件逐步呈现，思考不会写进正文', async () => {
  const { agent, calls } = setup({ spoken: true, reasoning: true })
  await agent.run({ focusId: 'topic', message: '讨论选题' })
  const updates = []
  const result = await agent.run({ focusId: 'topic', message: '把正文改成口播，保留原文' }, value => updates.push(structuredClone(value)))
  assert.equal(calls.filter(([name]) => name === 'create').length, 1)
  assert.ok(updates.some(row => row.phase === 'reasoning' && row.reasoning === '先读原稿，保留事实。'))
  assert.ok(updates.some(row => row.phase === 'tool' && row.activity[0]?.status === 'running'))
  assert.ok(updates.some(row => row.phase === 'writing' && row.drafts.spoken?.text.includes('口播第一句')))
  assert.equal(result.answer.reasoning, '先读原稿，保留事实。')
  assert.equal(result.state.items[0].production.article, '原稿')
  assert.equal(result.state.items[0].production.spoken, '口播第一句。\n口播第二句。')
  assert.ok(!result.answer.text.includes('先读原稿'))
})

test('停止等待中的原生对话会取消 DSH 并保留原稿，不留下运行状态', async () => {
  const { agent, store, calls, promptReady } = setup({ waiting: true })
  const running = agent.run({ focusId: 'topic', message: '生成口播' })
  const stopped = assert.rejects(running, /已停止 DSH/)
  await promptReady
  assert.ok(calls.some(([name]) => name === 'prompt'))
  await agent.cancel('topic')
  await stopped
  assert.deepEqual(calls.find(([name]) => name === 'cancel')[1], { sessionId: 'session-topic' })
  assert.equal(agent.active('topic'), false)
  assert.equal((await store.read()).items[0].production.article, '原稿')
})

test('原生普通对话不覆盖稿件，半截稿件也不提交', async () => {
  for (const config of [{ plain: true }, { partial: true }]) {
    const { agent, store } = setup(config)
    await agent.run({ focusId: 'topic', message: '聊一下' })
    assert.equal((await store.read()).items[0].production.article, '原稿')
  }
})

test('已有的原生口播对象在升级后仍能导入视频，不误用正文', () => {
  assert.equal(scriptOf({ format: 'article', article: '长文正文', spoken: { text: '已生成的口播。', updatedAt: '2026-11-18' } }), '已生成的口播。')
})

test('原生失败保留原稿；并发手改不会被写回覆盖', async () => {
  for (const config of [{ error: true }, { conflict: true }]) {
    const { agent, store } = setup(config)
    await assert.rejects(agent.run({ focusId: 'topic', message: '完整重写全文' }))
    assert.equal((await store.read()).items[0].production.article, config.conflict ? '用户刚刚手改' : '原稿')
    assert.equal(agent.active('topic'), false)
  }
})

test('原生成稿启动时返回真实运行状态，完整生成后结束', async () => {
  const { agent, store } = setup()
  const result = await agent.start('topic')
  assert.equal(result, true)
  const deadline = Date.now() + 3000
  while (agent.active('topic') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(agent.active('topic'), false)
  assert.equal((await store.read()).items[0].production.status, 'done')
})

test('输出协议只识别本轮稿件，口播单独解析，隐藏半截结束标记', () => {
  assert.deepEqual(documentOutput('<media-desk-article id="old">旧</media-desk-article>', 'new').drafts, {})
  const parsed = documentOutput('说明\n<media-desk-spoken id="run">\n口播第一句\n第二句</media-desk-sp', 'run')
  assert.equal(parsed.drafts.spoken.text, '口播第一句\n第二句')
  assert.equal(parsed.drafts.spoken.complete, false)
  assert.equal(parsed.reply, '说明')
})


test('重新创建适配器后仍复用选题及全局原生 session', async () => {
  for (const focusId of ['topic', undefined]) {
    const { agent, store, calls } = setup({ plain: true })
    await agent.run({ focusId, message: '第一轮' })
    const restarted = new NativeAgent({ ctx: agent.ctx, store, settings: agent.settings, cwd: '/workspace' })
    await restarted.run({ focusId, message: '延续上一轮' })
    assert.equal(calls.filter(call => call[0] === 'create').length, 1)
    assert.equal(calls.filter(call => call[0] === 'prompt')[1][1].sessionId, 'session-topic')
  }
})

test('重新生成发生并发手改时不回滚用户稿件', async () => {
  const { agent, store } = setup({ conflict: true })
  await assert.rejects(agent.run({ focusId: 'topic', message: '重新生成', generate: true }))
  assert.equal((await store.read()).items[0].production.article, '用户刚刚手改')
  assert.notEqual((await store.read()).items[0].production.status, 'running')
})

test('个人风格和方法按需读取，跨平台正文不注入；同一会话只同步变更', async () => {
  const { agent, store, calls, settings } = setup({ plain: true })
  const method = join(store.root, '开头方法.md')
  await writeFile(method, '方法完整正文，不应预载进提示词')
  settings.writingFlow.selected = [method]
  await store.mutate('style', state => {
    state.activeStyleId = 'adong'
    state.styles = [{ id: 'adong', name: '阿东', opening: '阿东看到一个具体问题', structure: '先判断再论证', guide: '务必干货利他', platforms: { xhs: { rules: '仅小红书的旧平台模板' } } }]
  })
  const promptAt = index => calls.filter(call => call[0] === 'prompt')[index][1].content[0].text
  const stylePath = text => text.match(/当前个人风格[^\n]+：("[^"]+")/)[1]
  await agent.run({ focusId: 'topic', message: '改口播开头' })
  const first = promptAt(0)
  assert.ok(first.includes(method))
  assert.ok(!first.includes('方法完整正文'))
  assert.ok(!first.includes('仅小红书的旧平台模板'))
  assert.ok(!first.includes('务必干货利他'))
  const core = await readFile(JSON.parse(stylePath(first)), 'utf8')
  for (const text of ['阿东看到一个具体问题', '先判断再论证', '务必干货利他']) assert.ok(core.includes(text))
  assert.ok(!core.includes('仅小红书的旧平台模板'))
  await agent.run({ focusId: 'topic', message: '再短一点' })
  assert.ok(!promptAt(1).includes(method))
  assert.ok(!promptAt(1).includes('当前个人风格'))
  assert.ok(promptAt(1).length < first.length / 2)
  const restarted = new NativeAgent({ ctx: agent.ctx, store, settings: agent.settings, cwd: '/workspace' })
  await restarted.run({ focusId: 'topic', message: '继续' })
  assert.ok(!promptAt(2).includes(method))
  await store.mutate('style edit', state => { state.styles[0].opening = '已保存的新开头偏好' })
  await restarted.run({ focusId: 'topic', message: '按新风格来' })
  assert.notEqual(stylePath(promptAt(3)), stylePath(first))
  assert.ok((await readFile(JSON.parse(stylePath(promptAt(3))), 'utf8')).includes('已保存的新开头偏好'))
  const nextMethod = join(store.root, '共鸣方法.md')
  await writeFile(nextMethod, '新增共鸣方法正文')
  settings.writingFlow.selected = [nextMethod]
  await restarted.run({ focusId: 'topic', message: '继续' })
  assert.ok(promptAt(4).includes(nextMethod))
  assert.ok(!promptAt(4).includes(method))
  await writeFile(nextMethod, '共鸣方法有了新的内容和长度')
  await restarted.run({ focusId: 'topic', message: '继续' })
  assert.ok(promptAt(5).includes(nextMethod))
  assert.ok(!promptAt(5).includes('共鸣方法有了新的内容'))
  assert.equal(calls.filter(([name]) => name === 'create').length, 1)
})

test('口播按钮只写入口播，即使模型多输出正文也不预览或覆盖原文', async () => {
  const { agent, store } = setup({ spoken: true, extraArticle: true })
  const updates = []
  await agent.run({ focusId: 'topic', message: '改成口播', outputKind: 'spoken' }, row => updates.push(structuredClone(row)))
  assert.ok(updates.every(row => !row.drafts.article))
  assert.equal((await store.read()).items[0].production.article, '原稿')
  assert.equal((await store.read()).items[0].production.spoken, '口播第一句。\n口播第二句。')
})

test('工作区内配图自动同步到 filesDir 并改写为 /media-desk/files 链接，越界路径忽略', async () => {
  const { mkdir } = await import('node:fs/promises')
  const root = mkdtempSync(join(tmpdir(), 'native-img-sync-'))
  try {
    const cwd = join(root, 'workspace')
    const filesDir = join(root, 'files')
    await mkdir(join(cwd, '01-内容生产', 'raw', 'assets'), { recursive: true })
    await writeFile(join(cwd, '01-内容生产', 'raw', 'assets', 'paper-fig1.png'), 'pngdata')
    await writeFile(join(root, 'outside.png'), 'secret')
    const md = '## 机制\n\n![方法原图](01-内容生产/raw/assets/paper-fig1.png)\n\n![越界](../outside.png)'
    const synced = await syncWorkspaceImages(md, cwd, filesDir)
    assert.match(synced, /!\[方法原图\]\(\/media-desk\/files\/paper-fig1\.png\)/)
    assert.match(synced, /!\[越界\]\(\.\.\/outside\.png\)/)
    assert.equal(await readFile(join(filesDir, 'paper-fig1.png'), 'utf8'), 'pngdata')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('遇到 DeepSeek Messages transport failed 闪断时自动在同一会话无感续跑完成稿件', async () => {
  let state = { items: [{ id: 'topic', title: '测试选题', status: 'idea' }], chat: [], skills: [], styles: [] }
  const root = mkdtempSync(join(tmpdir(), 'native-agent-resume-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  const store = { root, filesDir: join(root, 'files'), read: async () => state, mutate: async (_label, fn) => { const draft = structuredClone(state); const result = fn(draft); state = draft; return result } }
  const prompts = []
  let token = ''
  const service = {
    create: async () => ({ sessionId: 'session-resume' }),
    state: async () => ({ running: null, queue: [], pendingInput: [] }),
    cancel: () => {},
    prompt: async (args) => {
      prompts.push(args.content[0].text)
      if (!token) token = args.content[0].text.match(/<media-desk-(?:article|patch|spoken) id="([^"]+)"/)?.[1] || ''
    },
    async *follow() {
      yield { type: 'snapshot', cursor: 1, records: [] }
      yield { type: 'event', event: { seq: 2, type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'DeepSeek Messages transport failed' } } } } }
      const full = `已完成续写。\n<media-desk-article id="${token}">\n# 续写标题\n\n续写完成的正文。\n</media-desk-article>`
      yield { type: 'event', event: { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: full }] } } } }
      yield { type: 'event', event: { seq: 4, type: 'turn/end', data: { reason: { kind: 'completed' } } } }
    },
  }
  const agent = new NativeAgent({ ctx: { get: name => name === 'sessionController' ? service : null }, store, settings: { read: async () => ({ writingFlow: { selected: [] } }) }, cwd: '/workspace' })
  const res = await agent.run({ focusId: 'topic', message: '直接成稿', generate: true, goal: 'xhs' })
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /连接闪断/)
  assert.equal(res.state.items[0].production.status, 'done')
  assert.equal(res.state.items[0].production.title, '续写标题')
  assert.equal(res.state.items[0].production.article, '续写完成的正文。')
})
