import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyOps } from '../src/ops.js'
import { Producer } from '../src/produce.js'
import { buildSeed } from '../src/seed.js'
import { loadFlow } from '../src/writing-flow.js'
import { advanceStream } from '../client/stream-text.js'
import { scriptOf } from '../client/video/captions.js'

const fixture = () => {
  const state = buildSeed(new Date(), 'zh')
  state.items = [{ id: 'topic', title: '新选题', body: '已核对的素材', tags: [], status: 'idea' }]
  state.draftFormat = 'script'
  return state
}
const harness = (state, callText, flow = async () => ({ parts: [], dropped: [], errors: [] })) => new Producer({
  store: { filesDir: '/tmp', read: async () => state, mutate: async (_label, fn) => fn(state) },
  settings: { read: async () => ({ voice: '', imageCount: 2, shotCount: 6, generateImages: true, humanize: true, image: {} }) },
  ready: () => true, generate: async () => { throw new Error('must not generate images for cards') }, callText, flow,
})
const finish = async producer => {
  for (let i = 0; i < 400 && producer.jobs.has('topic'); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(producer.jobs.size, 0)
}


test('一句选题直接生成图文：不填结构，不等策划、生图和第二轮改写；流式进度可见', async () => {
  const state = fixture(), calls = []
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const writing = new Promise(resolve => { started = resolve })
  const producer = harness(state, async options => {
    calls.push(options)
    options.onText('# 自动标题\n\n第一段完整的意思。第二句延续解释。')
    started()
    await gate
    options.onText('\n\n第二段给出行动建议。')
    return { text: '# 自动标题\n\n第一段完整的意思。第二句延续解释。\n\n第二段给出行动建议。', model: 'test' }
  })
  await producer.start('topic', { goal: 'xhs' })
  await writing
  assert.match(producer.status('topic').text, /第一段/)
  assert.equal(state.items[0].production.status, 'running')
  release()
  await finish(producer)
  const item = state.items[0]
  assert.equal(calls.length, 1)
  assert.equal(item.production.status, 'done')
  assert.equal(item.production.format, 'article')
  assert.equal(item.production.title, '自动标题')
  assert.match(item.production.article, /解释。\n\n第二段/)
  assert.equal(item.production.withImages, false)
  assert.deepEqual(item.production.shots, [])
  assert.match(calls[0].system, /小红书图文卡片/)
  assert.match(calls[0].system, /自然段/)
})


test('图文模型失败显式失败，不把占位大纲冒充成稿', async () => {
  const state = fixture()
  const producer = harness(state, async () => { throw new Error('模型连接失败') })
  await producer.start('topic', { goal: 'xhs', withImages: false })
  await finish(producer)
  assert.equal(state.items[0].production.status, 'failed')
  assert.equal(state.items[0].production.article, '')
  assert.match(state.items[0].production.error, /模型连接失败/)
})


test('只从显式工作区加载文风，不提前展开原生技能全文', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-context-'))
  try {
    const root = join(home, 'independent')
    const docs = [
      [join(root, 'CLAUDE.md'), '工作区写作规则'],
      [join(root, 'style.md'), '文风要求'],
      [join(home, '.claude', 'skills', 'private-style', 'SKILL.md'), '不应自动读取的个人技能'],
    ]
    for (const [path, text] of docs) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text) }
    const flow = await loadFlow({}, { home, workspace: root, target: 'xhs' })
    assert.deepEqual(flow.parts.map(p => p.name), ['CLAUDE.md', 'style.md'])
    const calls = [], state = fixture()
    const producer = harness(state, async options => { calls.push(options); return { text: '完整正文。', model: 'test' } }, async () => flow)
    await producer.start('topic', { goal: 'xhs' })
    await finish(producer)
    for (const expected of ['工作区写作规则', '文风要求']) assert.ok(calls[0].system.includes(expected))
    assert.ok(!calls[0].system.includes('不应自动读取的个人技能'))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('口播导入使用独立稿件，原文章和选题身份保持不变', () => {
  const state = fixture(), item = state.items[0]
  item.production = { status: 'done', format: 'article', title: '标题', article: '原文章。' }
  const result = applyOps(state, [{ op: 'update_video', id: item.id, spoken: '可录制的口播稿。' }])
  assert.equal(result.errors.length, 0)
  assert.equal(item.production.article, '原文章。')
  assert.equal(scriptOf(item.production), '可录制的口播稿。')
})


test('逐字显示只展开已收到的文本，保留段落和完整 Unicode，改写不留下旧内容', () => {
  const target = '第一段🙂。\n\n第二段。'
  let current = ''
  for (let i = 0; i < 50 && current !== target; i++) {
    current = advanceStream(current, target, true)
    assert.ok(target.startsWith(current))
    assert.ok(!/[\uD800-\uDBFF]$/.test(current))
  }
  assert.equal(current, target)
  assert.equal(advanceStream(current, '修改后的正文。', true), '修改后的正文。')
  assert.equal(advanceStream('', target, false), target)
})


test('用户明确选择的长 Skill 完整读取，目标平台不会覆盖用户的勾选', async () => {
  const home = await mkdtemp(join(tmpdir(), 'community-long-skill-'))
  try {
    const path = join(home, 'SKILL.md')
    const text = `${'规则段落。\n\n'.repeat(1600)}结尾正反例对照`
    await writeFile(path, text)
    const flow = await loadFlow({ writingFlow: { paths: [path], selected: [path] } }, { home, target: 'xhs' })
    assert.equal(flow.parts.length, 1)
    assert.ok(flow.parts[0].chars > 10000)
    assert.equal(flow.parts[0].truncated, false)
    assert.match(flow.parts[0].text, /结尾正反例对照/)
    const empty = await loadFlow({ writingFlow: { paths: [path], selected: [] } }, { home, target: 'xhs' })
    assert.equal(empty.parts.length, 0)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('写作定调（模式 A-D、面向谁、一句话核心判断）在成稿启动时完整保留并注入 author-brief', async () => {
  const state = fixture(), calls = []
  state.items[0].creation = { requirements: '必须写清失败边界' }
  const producer = harness(state, async options => {
    calls.push(options)
    return { text: '# 标题\n\n正文内容。', model: 'test' }
  })
  await producer.start('topic', { goal: 'xhs', mode: 'A', audience: 'builder', thesis: '真正拉开差距的不是模型跑分，是责任域谁来兜底' })
  await finish(producer)
  assert.deepEqual(state.items[0].creation, {
    goal: 'xhs',
    mode: 'A',
    audience: 'builder',
    thesis: '真正拉开差距的不是模型跑分，是责任域谁来兜底',
    requirements: '必须写清失败边界',
  })
  assert.match(calls[0].user, /<author-brief>/)
  assert.match(calls[0].user, /A 争议判断型/)
  assert.match(calls[0].user, /OPC 与产品 Builder/)
  assert.match(calls[0].user, /责任域谁来兜底/)
  assert.match(calls[0].user, /必须写清失败边界/)
})
