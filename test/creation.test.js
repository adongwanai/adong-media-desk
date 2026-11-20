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
