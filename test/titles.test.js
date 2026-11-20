import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import { Store } from '../src/store.js'
import { generateTitles, scoreTitles, titlePrompts } from '../src/titles.js'

const BODY = '我还没试过这个工具。按文档的说法，它能把 3 个步骤合成 1 个，我打算用 12 篇旧稿验证。'
const STATE = { items: [], skills: [], styles: [], angles: [], people: [] }
const flagsOf = (result, title) => result.candidates.find(row => row.title === title).flags.map(flag => flag.rule)

test('scoreTitles：超长、绝对化用词、正文里没有的数字、编出来的经历都会被标出来', () => {
  const result = scoreTitles({
    candidates: [
      { title: '3 个步骤合成 1 个', method: '具体结果' },
      { title: '全网最强的标题工具', method: '反直觉判断' },
      { title: '用了 30 天，效率翻了 5 倍', method: '数字清单' },
      { title: '我亲测了这个工具', method: '第一人称经历' },
      { title: '这个标题非常非常非常非常非常非常非常长一直写下去', method: '提问' },
      { title: 'AI tools 让写标题更快', method: '对比' },
    ],
  }, { body: BODY, facts: [], platform: '小红书' })
  assert.deepEqual(flagsOf(result, '3 个步骤合成 1 个'), [])
  assert.deepEqual(flagsOf(result, '全网最强的标题工具'), ['absolute'])
  assert.deepEqual(flagsOf(result, '用了 30 天，效率翻了 5 倍'), ['number', 'experience'])
  assert.match(result.candidates[2].flags[0].message, /数字在正文里找不到：30、5/)
  assert.deepEqual(flagsOf(result, '我亲测了这个工具'), ['experience'])
  assert.deepEqual(flagsOf(result, '这个标题非常非常非常非常非常非常非常长一直写下去'), ['length'])
  // 小红书标题英文算半个字：「AI tools 」9 个半角字符只算 4.5，加 6 个中文向上取整是 11
  const mixed = result.candidates.find(row => row.title === 'AI tools 让写标题更快')
  assert.equal(mixed.length, 11)
  assert.deepEqual(mixed.flags, [])
})

test('scoreTitles：去掉重复，最多 12 个；推荐三个方法不同、没有硬伤的', () => {
  const rows = [
    { title: '3 个步骤合成 1 个', method: '具体结果' },
    { title: '3个步骤，合成1个！', method: '具体结果' },
    { title: '写标题这件事可以更省事', method: '具体结果' },
    { title: '标题为什么总是写不好？', method: '提问' },
    { title: '全网第一的写法', method: '对比' },
    { title: '旧方法和新方法差在哪', method: '对比' },
    ...Array.from({ length: 12 }, (_, i) => ({ title: `候选标题第${'一二三四五六七八九十'[i % 10]}种${i}`, method: '场景' })),
  ]
  const result = scoreTitles({ candidates: rows }, { body: `${BODY}0123456789`, platform: '公众号' })
  assert.equal(result.candidates.length, 12)
  assert.equal(result.candidates.filter(row => row.title.startsWith('3')).length, 1)
  assert.equal(result.picks.length, 3)
  const methods = result.picks.map(index => result.candidates[index].method)
  assert.equal(new Set(methods).size, 3)
  for (const index of result.picks) assert.ok(!result.candidates[index].flags.some(flag => flag.level === 'block'))
  assert.ok(!result.picks.map(index => result.candidates[index].title).includes('全网第一的写法'))
  // 模型给的不是数组也不会报错
  assert.deepEqual(scoreTitles({ candidates: 'x' }, { body: '' }), { candidates: [], picks: [] })
  assert.deepEqual(scoreTitles(null, { body: '' }), { candidates: [], picks: [] })
})

test('titlePrompts：正文没有亲身经历时不给「第一人称经历」这个方法；数字只能用正文里的', () => {
  const item = { id: 'a', title: 'x', production: { title: '母稿', article: BODY, facts: ['事实一'] } }
  const plain = titlePrompts(STATE, item, '小红书')
  assert.doesNotMatch(plain.system, /尽量分散：[^\n]*第一人称经历/)
  assert.match(plain.system, /不要用「第一人称经历」/)
  assert.match(plain.system, /不超过 20/)
  assert.match(plain.system, /数字必须是/)
  assert.ok(plain.user.includes('事实一'))
  const lived = titlePrompts(STATE, { ...item, production: { ...item.production, article: '我试了三天，结果不错。' } }, null)
  assert.match(lived.system, /尽量分散：[^\n]*第一人称经历/)
  assert.match(lived.system, /不超过 64/)
  // 有这个平台的版本时，标题配的是版本正文
  const versioned = titlePrompts(STATE, { ...item, production: { ...item.production, versions: { 小红书: { status: 'done', title: '版本标题', body: '版本正文内容' } } } }, '小红书')
  assert.ok(versioned.user.includes('版本正文内容'))
  assert.ok(versioned.user.includes('版本标题'))
})

test('generateTitles：调一次模型，本地打分；X 不用标题，没成稿不能换', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-titles-'))
  try {
    const store = new Store(dir, { samples: false })
    const id = await store.mutate('add', (state) => {
      const target = applyOps(state, [{ op: 'add_item', title: '灵感' }]).receipts[0].target
      state.items.find(row => row.id === target).production = { status: 'done', title: '母稿', article: BODY, facts: [] }
      return target
    }, { undoable: false })
    let calls = 0
    const callText = async () => { calls += 1; return { text: '```json\n{"candidates":[{"title":"3 个步骤合成 1 个","method":"具体结果"},{"title":"必看！99 个技巧","method":"数字清单"}]}\n```', model: 'fake' } }
    const result = await generateTitles({ store, callText }, { id, platform: '抖音' })
    assert.equal(calls, 1)
    assert.equal(result.platform, '抖音')
    assert.equal(result.current, '')
    assert.equal(result.candidates.length, 2)
    assert.deepEqual(result.candidates[1].flags.map(flag => flag.rule), ['absolute', 'number'])
    assert.deepEqual(result.picks, [0])
    await assert.rejects(generateTitles({ store, callText }, { id, platform: 'X' }), err => err.status === 400)
    await assert.rejects(generateTitles({ store, callText }, { id, platform: '微博' }), err => err.status === 400)
    await assert.rejects(generateTitles({ store, callText }, { id: 'nope' }), err => err.status === 404)
    await assert.rejects(generateTitles({ store, callText: async () => ({ text: '没有 JSON' }) }, { id }), err => err.status === 502)
    // 选中的标题走撤销得了的操作写回母稿
    await store.mutate('换标题', state => applyOps(state, [{ op: 'update_production', id, title: result.candidates[0].title }]))
    assert.equal((await store.read()).items.find(row => row.id === id).production.title, '3 个步骤合成 1 个')
    await store.undoLast()
    assert.equal((await store.read()).items.find(row => row.id === id).production.title, '母稿')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
