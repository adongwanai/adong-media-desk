// 一份灵感带多份素材文件，成稿时再加载作者自己的写作工作流。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { articlePrompts } from '../src/ai.js'
import { userText } from '../src/howi.js'
import { attachMaterials, materialRowsOf, materialsBlock, packMaterials, removeMaterial, truncateByParagraph } from '../src/item-materials.js'
import { cleanMaterials, INLINE_MAX } from '../src/material-limits.js'
import { applyOps } from '../src/ops.js'
import { Producer } from '../src/produce.js'
import { buildSeed, migrateState } from '../src/seed.js'
import { unsupportedClaims } from '../src/selfcheck.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'
import { detectFlow, flowBlock, loadFlow, readFlow } from '../src/writing-flow.js'

const NOW = new Date('2026-11-14T10:00:00+08:00')
const row = (id, name, text) => ({ id, name, chars: text.length, text })

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

test('素材预算：放不下的整份删掉并记下名字；整份都放不下时，把最相关的一份按段落截断', () => {
  const rows = [row('a', 'a.md', 'x'.repeat(60)), row('b', 'b.md', 'y'.repeat(50)), row('c', 'c.md', 'z'.repeat(30))]
  const packed = packMaterials(rows, 100)
  assert.deepEqual(packed.parts.map(part => part.id), ['a', 'c'])
  assert.deepEqual(packed.dropped.map(part => part.name), ['b.md'])
  assert.equal(packed.usedChars, 90)
  assert.ok(packed.parts.every(part => !part.truncated))
  // 只有一份、而且比预算长：不丢，按段落截断，注明原文多少字
  const long = `${'第一段。'.repeat(10)}\n\n${'第二段。'.repeat(10)}\n\n${'第三段。'.repeat(10)}`
  const one = packMaterials([row('l', 'long.md', long)], 90)
  assert.equal(one.parts.length, 1)
  assert.equal(one.dropped.length, 0)
  assert.equal(one.parts[0].truncated, true)
  assert.equal(one.parts[0].chars, long.length)
  assert.match(one.parts[0].text, /^第一段。/)
  assert.match(one.parts[0].text, new RegExp(`原文 ${long.length} 字`))
  assert.ok(!one.parts[0].text.includes('第三段'))
  // 空的素材不算
  assert.deepEqual(packMaterials([row('e', 'e.md', '  ')]).parts, [])
})

test('正文超长按段落截断：不切半段，截了就注明；不超就原样', () => {
  const text = 'aaaa\n\nbbbb\n\ncccc'
  assert.deepEqual(truncateByParagraph(text, 100), { text, truncated: false, original: text.length })
  const cut = truncateByParagraph(text, 11)
  assert.equal(cut.truncated, true)
  assert.match(cut.text, /^aaaa\n\nbbbb\n\n（原文 16 字，这里取前 10 字）$/)
  // 整篇没有空行：退到句子边界
  const plain = truncateByParagraph('一句话。二句话。三句话。', 9)
  assert.match(plain.text, /^一句话。二句话。\n\n（原文 12 字/)
})

test('素材正文算作有出处的依据：素材里写过的经历不再标成无依据；长素材从 files 读回来的部分也算', () => {
  const article = '## 开头\n\n我用 Claude Code 跑了两周，每天写 3 篇。\n\n我在公司内部部署了一套，效果稳定。'
  const item = { title: '写稿工具', body: '', materials: [{ id: 'm1', name: 'log.md', text: '我用 Claude Code 跑了两周，每天写 3 篇，记了日志。', chars: 30 }] }
  assert.deepEqual(unsupportedClaims(article, userText(item)).map(claim => claim.sentence), ['我在公司内部部署了一套，效果稳定'])
  // 不在 state 里的那部分（超过 20k 字落盘的）由调用方读回来传进去
  assert.deepEqual(unsupportedClaims(article, userText(item, '我在公司内部部署了一套')).map(claim => claim.sentence), [])
  // 没有素材时照旧全部标出
  assert.equal(unsupportedClaims(article, userText({ title: '写稿工具', body: '' })).length, 2)
})

test('提示词：素材进 <attachments>，工作流进 <workflow> 且写明只学写法、不能编经历和来源', () => {
  const state = { ...buildSeed(NOW, 'zh'), activeStyleId: null, skills: [] }
  const item = { id: 'x', title: '本地素材的标题', body: '', tags: [] }
  const prompts = articlePrompts(state, item, '', null, [], {
    materials: [{ id: 'm', name: 'notes.md', chars: 12, text: '素材里的独有事实 QX-42', truncated: false }],
    flow: [{ id: 'f', name: '文风说明书', group: 'style', chars: 10, text: '先给判断再讲理由', truncated: false }],
  })
  assert.match(prompts.user, /<attachments>[\s\S]*QX-42[\s\S]*<\/attachments>/)
  assert.match(prompts.system, /<workflow>[\s\S]*先给判断再讲理由[\s\S]*<\/workflow>/)
  assert.match(prompts.system, /只提供写法，不提供这篇的事实/)
  assert.match(prompts.system, /不能当成作者做过的事/)
  assert.match(prompts.system, /事实只来自 <material> 和 <attachments>/)
  // 没有素材和工作流时，提示词里也不出现这两个标签
  const bare = articlePrompts(state, item, '', null, [])
  assert.ok(!bare.user.includes('<attachments>'))
  assert.ok(!bare.system.includes('<workflow>\n'))
  assert.equal(materialsBlock([]), '')
  assert.equal(flowBlock([]), '')
})

test('工作流仅索引显式工作区和自定义路径，默认不扫描桌面或全局技能', async () => {
  const home = await tempDir('media-desk-flow-')
  try {
    const root = join(home, 'workspace')
    await mkdir(join(root, 'methods'), { recursive: true })
    await writeFile(join(root, 'style.md'), '# 文风\n\n清楚表达。')
    await writeFile(join(root, 'methods', '标题.md'), '标题要具体。')
    await mkdir(join(home, 'Desktop', 'private', '01-内容生产', '素材库'), { recursive: true })
    await writeFile(join(home, 'Desktop', 'private', '01-内容生产', '素材库', '私人文风.md'), '不该自动找到')
    assert.deepEqual((await detectFlow({ home })).docs, [])
    const found = await detectFlow({ home, workspace: root })
    assert.deepEqual(found.docs.map(doc => [doc.group, doc.name, doc.on]), [['style', 'style.md', true], ['method', '标题.md', false]])
    const read = await readFlow(found.docs.filter(doc => doc.on))
    assert.deepEqual(read.parts.map(part => part.name), ['style.md'])
    const picked = await detectFlow({ home, workspace: root, selected: [found.docs[1].id] })
    assert.deepEqual(picked.docs.filter(doc => doc.on).map(doc => doc.name), ['标题.md'])
    const custom = await detectFlow({ home, workspace: root, paths: [join(root, 'methods'), join(home, 'nope.md')] })
    assert.equal(custom.custom, true)
    assert.deepEqual(custom.docs.map(doc => [doc.group, doc.name, Boolean(doc.error)]), [['custom', '标题.md', false], ['custom', 'nope.md', true]])
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('工作流预算：一份超长按段落截断注明，合计超预算的整份不放并列出来', async () => {
  const dir = await tempDir('media-desk-flow-budget-')
  try {
    const big = Array.from({ length: 40 }, (_, i) => `第 ${i} 段，写作要求。`.repeat(30)).join('\n\n')
    await writeFile(join(dir, 'a.md'), big, 'utf8')
    await writeFile(join(dir, 'b.md'), '短的要求。'.repeat(400), 'utf8')
    await writeFile(join(dir, 'c.md'), '第三份。'.repeat(400), 'utf8')
    const docs = ['a.md', 'b.md', 'c.md'].map(name => ({ id: name, name, path: join(dir, name), group: 'custom' }))
    const read = await readFlow(docs, 10_500)
    assert.equal(read.parts[0].truncated, true)
    assert.match(read.parts[0].text, new RegExp(`原文 ${big.length} 字`))
    assert.ok(read.parts[0].text.length <= 8_000 + 40)
    assert.deepEqual(read.parts.map(part => part.name), ['a.md', 'b.md'])
    assert.deepEqual(read.dropped.map(part => part.name), ['c.md'])
    assert.ok(read.usedChars <= 10_500)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('状态迁移：老数据没有 materials 不加字段；坏掉的行丢掉；缺 id 的补一个每次都一样的；落盘文件名只认 material-*.txt', () => {
  const state = migrateState({ items: [
    { id: 'old', title: '老灵感' },
    { id: 'bad', title: '坏数据', materials: 'nope' },
    { id: 'mix', title: '混着的', materials: [null, { name: '' }, { name: 'a.md', text: '正文', file: '../../etc/passwd' }, { id: 'keep', name: 'b.md', text: 'x', chars: 50_000, file: 'material-keep.txt' }] },
  ] })
  assert.equal('materials' in state.items[0], false)
  assert.deepEqual(state.items[1].materials, [])
  const [a, b] = state.items[2].materials
  assert.equal(state.items[2].materials.length, 2)
  assert.equal(a.name, 'a.md')
  assert.equal(a.chars, 2)
  assert.equal(a.file, undefined)
  assert.equal(b.file, 'material-keep.txt')
  assert.equal(b.chars, 50_000)
  // 再迁移一次结果不变：id 稳定，撤销和界面才对得上
  assert.deepEqual(cleanMaterials(state.items[2].materials), state.items[2].materials)
  assert.equal(cleanMaterials([{ name: 'a.md' }])[0].id, cleanMaterials([{ name: 'a.md' }])[0].id)
})

test('加素材：超过 2 万字的正文落到 files，state 只存前 2 万字和引用；一次最多 10 份，合计 20 万字，超了说清楚；删了可以撤销', async () => {
  const dir = await tempDir('media-desk-materials-')
  try {
    const store = new Store(dir, { samples: false })
    const state = await store.mutate('add', draft => (applyOps(draft, [{ op: 'add_item', kind: 'note', title: '一条灵感' }]), draft))
    const id = state.items[0].id
    const notes = join(dir, 'notes')
    await mkdir(notes)
    await writeFile(join(notes, 'short.md'), '---\ntitle: 短\n---\n短素材的正文。', 'utf8')
    const longText = `${'长素材的一段话。\n\n'.repeat(3000)}结尾标记 ZZ-END`
    await writeFile(join(notes, 'long.md'), longText, 'utf8')
    const result = await attachMaterials({ store, itemId: id, paths: [join(notes, 'short.md'), join(notes, 'long.md'), join(notes, 'missing.md')] })
    assert.deepEqual(result.added.map(item => item.name), ['short.md', 'long.md'])
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0].reason, /找不到这个文件/)
    const saved = (await store.read()).items.find(item => item.id === id).materials
    assert.equal(saved[0].text, '短素材的正文。')
    assert.equal(saved[1].chars, longText.trim().length)
    assert.equal(saved[1].text.length, INLINE_MAX)
    assert.match(saved[1].file, /^material-mt_[\w]+\.txt$/)
    assert.equal(await readFile(join(store.filesDir, saved[1].file), 'utf8'), longText.trim())
    // 状态文件里没有完整长文：2 万字之后的部分只在 files 里
    assert.ok(!(await readFile(join(dir, 'state.json'), 'utf8')).includes('ZZ-END'))
    // 成稿读素材时，从 files 拿回全文
    const rows = await materialRowsOf(store.filesDir, (await store.read()).items.find(item => item.id === id))
    assert.equal(rows.find(item => item.name === 'long.md').text, longText.trim())

    await assert.rejects(attachMaterials({ store, itemId: id, files: Array.from({ length: 11 }, (_, i) => ({ name: `${i}.md`, text: 'x' })) }), /一次最多加 10 份/)
    const over = await attachMaterials({ store, itemId: id, files: [{ name: 'huge.md', text: '字'.repeat(175_000) }, { name: 'ok.md', text: '可以加' }] })
    assert.deepEqual(over.added.map(item => item.name), ['ok.md'])
    assert.match(over.errors[0].reason, /合计超过 20 万字/)
    await assert.rejects(attachMaterials({ store, itemId: 'nope', files: [{ name: 'a.md', text: 'x' }] }), /找不到这条灵感/)

    const { removed } = await removeMaterial({ store, itemId: id, materialId: saved[1].id })
    assert.equal(removed.name, 'long.md')
    assert.equal((await store.read()).items.find(item => item.id === id).materials.some(item => item.id === saved[1].id), false)
    // 长正文的文件留着，撤销回来全文还在
    await store.undoLast()
    const back = (await store.read()).items.find(item => item.id === id)
    assert.equal((await materialRowsOf(store.filesDir, back)).find(item => item.name === 'long.md').text, longText.trim())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('成稿：素材和工作流进提示词，production.flow.sources 记下实际用了哪些、删了哪份；素材里的经历不标无依据', async () => {
  const dir = await tempDir('media-desk-produce-materials-')
  try {
    const store = new Store(dir, { samples: false })
    const state = await store.mutate('add', draft => (applyOps(draft, [{ op: 'add_item', kind: 'note', title: '本地文件写稿' }]), draft))
    const id = state.items[0].id
    await attachMaterials({ store, itemId: id, files: [
      { name: '实验记录.md', text: '本地文件写稿的实验记录。我用 Claude Code 跑了两周，每天写 3 篇。独有代号 QX-42。' },
      { name: '太长的.md', text: '无关内容。'.repeat(6000) },
    ] })
    const calls = []
    const producer = new Producer({
      store,
      settings: { read: async () => ({ voice: '', imageCount: 0, shotCount: 0, generateImages: false, humanize: false, image: {} }) },
      ready: () => false,
      generate: async () => { throw new Error('no') },
      flow: async () => ({ parts: [{ id: 'f', name: '文风说明书', group: 'style', chars: 8, text: '先给判断再讲理由', truncated: false }], dropped: [{ name: '超预算.md', chars: 9000 }], usedChars: 8, errors: [] }),
      callText: async ({ system, user }) => {
        calls.push({ system, user })
        if (system.includes('内容主编')) return { text: JSON.stringify({ title: '定好的标题', coverText: '封面', facts: [], outline: ['开头'], images: [], shots: [] }), model: 'm' }
        return { text: '## 开头\n\n我用 Claude Code 跑了两周，每天写 3 篇。我在公司内部部署了一套，效果稳定。代号是 QX-42。', model: 'm' }
      },
    })
    await producer.start(id)
    for (let i = 0; i < 400 && producer.jobs.has(id); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    const production = (await store.read()).items.find(item => item.id === id).production
    assert.equal(production.status, 'done')
    const write = calls.find(call => !call.system.includes('内容主编'))
    assert.match(write.user, /QX-42/)
    assert.match(write.system, /<workflow>[\s\S]*先给判断再讲理由/)
    // 策划案也看得到素材，facts 才不会凭标题编
    assert.match(calls.find(call => call.system.includes('内容主编')).user, /QX-42/)
    const { sources } = production.flow
    assert.deepEqual(sources.materials.map(item => item.name), ['实验记录.md'])
    assert.deepEqual(sources.dropped.map(item => item.name), ['太长的.md'])
    assert.deepEqual(sources.workflow.map(item => item.name), ['文风说明书'])
    assert.deepEqual(sources.flowDropped.map(item => item.name), ['超预算.md'])
    assert.match(production.notice, /没用上 1 份素材.*太长的\.md/)
    // 只有素材里没有的那句被标出来
    assert.deepEqual(production.flow.unsupported.map(claim => claim.sentence), ['我在公司内部部署了一套，效果稳定'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('设置：写作工作流的路径和勾选能存能清；格式不对时报错', async () => {
  const dir = await tempDir('media-desk-flow-settings-')
  try {
    const settings = new Settings(dir)
    assert.deepEqual((await settings.read()).writingFlow, { paths: [], selected: null })
    const saved = await settings.update({ writingFlow: { paths: [' ~/flow ', ''], selected: ['/a.md'] } })
    assert.deepEqual(saved.writingFlow, { paths: ['~/flow'], selected: ['/a.md'] })
    assert.deepEqual((await settings.update({ writingFlow: { selected: null } })).writingFlow, { paths: ['~/flow'], selected: null })
    await assert.rejects(settings.update({ writingFlow: { paths: 'x' } }), /最多填 20 个路径/)
    await assert.rejects(settings.update({ writingFlow: { selected: 'x' } }), /勾选状态无效/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('files 目录里只出现素材文件，不碰用户自己的文件', async () => {
  const dir = await tempDir('media-desk-readonly-')
  try {
    const store = new Store(dir, { samples: false })
    const state = await store.mutate('add', draft => (applyOps(draft, [{ op: 'add_item', kind: 'note', title: '只读' }]), draft))
    const source = join(dir, 'mine.md')
    const text = '我的原文。\n\n'.repeat(5000)
    await writeFile(source, text, 'utf8')
    await attachMaterials({ store, itemId: state.items[0].id, paths: [source] })
    assert.equal(await readFile(source, 'utf8'), text)
    assert.deepEqual((await readdir(store.filesDir)).map(name => name.replace(/mt_\w+/, 'ID')), ['material-ID.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
