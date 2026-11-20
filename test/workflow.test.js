import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store } from '../src/store.js'
import { articlePrompts } from '../src/ai.js'
import { applyOps } from '../src/ops.js'
import { Producer } from '../src/produce.js'
import { buildSeed, migrateState } from '../src/seed.js'
import { activeStyle, styleToVoice } from '../src/style.js'
import { DEFAULT_STYLE_ID } from '../src/style-presets.js'
import { acceptableRewrite, articleIncomplete, continuePrompts, humanizePrompts, relatedPast, rewriteProblem } from '../src/workflow.js'

const NOW = new Date('2026-11-13T10:00:00+08:00')
const done = (id, title, article, extra = {}) => ({ id, title, body: '', tags: [], status: 'published', production: { status: 'done', title, article }, ...extra })

test('relatedPast：只找自己成过稿的相关内容，示例、没成稿的和不相关的都不算', () => {
  const state = { items: [
    done('a', 'Agent 记忆怎么分层', '短期记忆和长期记忆的分层方式，Agent 记忆的写入时机。'),
    done('b', '周末打篮球', '今天投篮手感不错。'),
    done('c', 'Agent 记忆示例', 'Agent 记忆的示例内容。', { sample: true }),
    { id: 'd', title: 'Agent 记忆草稿', body: 'Agent 记忆', tags: [], status: 'idea' },
  ] }
  const item = { id: 'new', title: 'Agent 记忆该不该用向量库', body: '', tags: ['Agent'] }
  assert.deepEqual(relatedPast(state, item).map(row => row.id), ['a'])
  assert.deepEqual(relatedPast(state, { id: 'x', title: '', body: '' }), [])
  const prompts = articlePrompts({ ...buildSeed(NOW, 'zh'), items: state.items }, item, '', null, relatedPast(state, item))
  assert.match(prompts.system, /<past>.*Agent 记忆怎么分层/s)
})

test('acceptableRewrite：丢小标题或篇幅差太多的改写不采用', () => {
  const before = '## 一\n第一段内容写了不少字，讲清楚一件事。\n## 二\n第二段内容也写了不少字。'
  assert.equal(acceptableRewrite(before, '## 一\n第一段内容写了一些字，讲清楚一件事。\n## 二\n第二段内容也写了一些字。'), true)
  assert.equal(acceptableRewrite(before, '## 一\n第一段内容写了不少字，讲清楚一件事。第二段内容也写了不少字。'), false)
  assert.equal(acceptableRewrite(before, '## 一\n短。\n## 二\n短。'), false)
  assert.equal(acceptableRewrite(before, ''), false)
  assert.match(humanizePrompts(before, '语气：直接').system, /语气：直接/)
})

test('默认风格是通用的「清晰实用」，带可修改的写作起点；旧数据迁移后补上且不覆盖已选风格', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md-style-'))
  const state = await new Store(dir, { samples: false }).read()
  await rm(dir, { recursive: true, force: true })
  assert.equal(state.activeStyleId, DEFAULT_STYLE_ID)
  const voice = styleToVoice(activeStyle(state))
  assert.match(voice, /完整写作规则/)
  assert.match(voice, /通用写作起点/)
  const old = buildSeed(NOW, 'zh')
  old.presetVersion = 1
  old.styles = old.styles.filter(row => row.id !== DEFAULT_STYLE_ID)
  old.activeStyleId = 'preset_travel'
  migrateState(old)
  assert.ok(old.styles.some(row => row.id === DEFAULT_STYLE_ID))
  assert.equal(old.activeStyleId, 'preset_travel')
})

test('风格可以带完整写作规则导入，超长会截断', () => {
  const state = { styles: [] }
  applyOps(state, [{ op: 'add_style', name: '我的', guide: '规'.repeat(9000), evil: 1 }])
  assert.equal(state.styles[0].guide.length, 6000)
  assert.equal(state.styles[0].evil, undefined)
})

function memoryStore(state) {
  return { filesDir: '/tmp', read: async () => state, mutate: async (_label, fn) => fn(state) }
}

test('成稿三步：翻旧稿、按风格写、去 AI 味；改写不合格时保留初稿', async () => {
  const run = async (rewrite) => {
    const state = buildSeed(NOW, 'zh')
    applyOps(state, [{ op: 'clear_samples' }, { op: 'add_item', title: 'Agent 记忆该不该用向量库', body: 'Agent 记忆' }])
    state.items.push(done('old', 'Agent 记忆怎么分层', 'Agent 记忆的分层方式和写入时机。'))
    const id = state.items[0].id
    const calls = []
    const producer = new Producer({
      store: memoryStore(state), settings: { read: async () => ({ voice: '', imageCount: 0, shotCount: 0, generateImages: false, humanize: true, image: {} }) }, ready: () => false, generate: async () => { throw new Error('no') },
      callText: async ({ system }) => {
        calls.push(system)
        if (system.includes('内容主编')) return { text: JSON.stringify({ title: '定好的标题', coverText: '封面', facts: [], outline: ['开头'], cover: '', characters: '', images: [], shots: [] }), model: 'm' }
        if (system.includes('文字编辑')) return { text: rewrite, model: 'm' }
        return { text: '## 开头\n值得注意的是，这是一段初稿内容，写得比较长一些。', model: 'm' }
      },
    })
    await producer.start(id)
    for (let i = 0; i < 200 && producer.jobs.has(id); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    return { production: state.items.find(row => row.id === id).production, calls }
  }
  const good = await run('## 开头\n这是一段初稿内容，写得比较长一些，改过了。')
  assert.equal(good.production.status, 'done')
  assert.equal(good.production.flow.humanized, true)
  assert.match(good.production.article, /改过了/)
  assert.match(good.production.flow.firstDraft, /值得注意的是/)
  assert.deepEqual(good.production.flow.past.map(row => row.id), ['old'])
  assert.equal(good.calls.length, 3)
  const bad = await run('全删了')
  assert.equal(bad.production.flow.humanized, false)
  assert.match(bad.production.article, /值得注意的是/)
})

test('作者信息：署名和介绍跟着用户走，不写在内置风格里；没填就明确要求不署名', () => {
  const state = buildSeed(NOW, 'zh')
  migrateState(state)
  state.activeStyleId = DEFAULT_STYLE_ID
  const item = { id: 'x', title: '题目', body: '', tags: [] }
  const guide = state.styles.find(row => row.id === DEFAULT_STYLE_ID).guide
  assert.ok(!/OPC ?创业者|算法工程师|技术专家/.test(guide))
  assert.match(articlePrompts(state, item, '', null).system, /不要在结尾署名/)
  applyOps(state, [{ op: 'set_author', bio: '做 Agent 的工程师', signature: '小明，工程师。', evil: 1 }])
  assert.deepEqual(state.author, { bio: '做 Agent 的工程师', signature: '小明，工程师。' })
  const system = articlePrompts(state, item, '', null).system
  assert.match(system, /最后单独一行写「小明，工程师。」/)
  assert.match(system, /做 Agent 的工程师/)
})

test('旧用户选的「不用特定风格」升级后原样保留', () => {
  const old = buildSeed(NOW, 'zh')
  old.presetVersion = 1
  old.activeStyleId = null
  migrateState(old)
  assert.equal(old.activeStyleId, null)
})

test('口播脚本去 AI 味：并成自然段就退回初稿，一句一行的排版保不住时不算改了', () => {
  const script = Array.from({ length: 30 }, (_, i) => `这是第 ${i} 句口播，讲一件事。`).join('\n\n')
  const kept = script.replace('这是第 3 句口播，讲一件事。', '这是第三句口播，讲一件事。')
  assert.equal(rewriteProblem(script, kept, { format: 'script' }), null)
  const merged = script.split('\n').filter(Boolean).join('')
  assert.equal(rewriteProblem(script, merged, { format: 'script' }), 'lines')
  // 旧调用方不传 format 时，行为不变
  assert.equal(rewriteProblem(script, merged), null)
})

test('articleIncomplete：规划里的小节没写完、最后一个小节是空的都算截断，完整的稿子不算', () => {
  const full = `## 一\n${'内容'.repeat(160)}。\n\n## 二\n${'内容'.repeat(160)}。`
  assert.equal(articleIncomplete(full, ['一', '二']), null)
  assert.equal(articleIncomplete(full, ['一', '二', '三']), 'headings')
  assert.equal(articleIncomplete(`${full}\n\n## 三\n\n`, ['一', '二', '三']), 'section')
  assert.equal(articleIncomplete(`## 一\n${'内容'.repeat(160)}`, ['一']), 'sentence')
  assert.equal(articleIncomplete(''), 'empty')
})

test('continuePrompts：接着写，不重复、不加素材里没有的事实', () => {
  const { system } = continuePrompts('## 一\n写了一半', ['一', '二'])
  assert.match(system, /「一」、「二」/)
  assert.match(system, /不要重复已经写过的内容/)
})
