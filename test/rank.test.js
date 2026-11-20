// 按「我的方向」排序、多榜同现、set_focus 校验。全部是纯函数，不碰网络。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import { blockedBy, crossLists, freshness, heatNorms, rankEntries, relevance, sameStory, titleSimilarity, topicHits } from '../src/rank.js'
import { migrateState } from '../src/seed.js'
import { tokens } from '../src/workflow.js'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const DAY = 86_400_000

test('tokens 仍从 workflow.js 导出，和以前一样按两字和整词切', () => {
  assert.deepEqual([...tokens('Agent 评测框架')], ['agent', '评测', '测框', '框架'])
})

test('relevance：取命中最完整的方向，它的词出现了几成；不到一半不算命中', () => {
  assert.equal(relevance('一个新的 Agent 评测基准', ['Agent 评测']), 1)
  assert.equal(relevance('Agent 框架更新', ['Agent 评测']), 0.5)
  assert.equal(relevance('今天天气不错', ['Agent 评测', '大模型']), 0)
  // 英文允许词形变化，短词只认完全一样
  assert.equal(relevance('Building agents that last', ['agent']), 1)
  assert.equal(relevance('aim high', ['ai']), 0)
  // 切不出词的方向（单个字）按原文包含判断
  assert.deepEqual(topicHits('一只猫的一天', ['猫']), [{ topic: '猫', share: 1 }])
  assert.deepEqual(topicHits('大模型 和 Agent', ['Agent', '大模型', '机器人']).map(hit => hit.topic), ['Agent', '大模型'])
})

test('freshness：今天 1，15 天 0.5，30 天以上 0，没时间 0.5，未来的按 1', () => {
  assert.equal(freshness(new Date(NOW).toISOString(), NOW), 1)
  assert.equal(freshness(new Date(NOW - 15 * DAY).toISOString(), NOW), 0.5)
  assert.equal(freshness(new Date(NOW - 45 * DAY).toISOString(), NOW), 0)
  assert.equal(freshness(null, NOW), 0.5)
  assert.equal(freshness('not a date', NOW), 0.5)
  assert.equal(freshness(new Date(NOW + DAY).toISOString(), NOW), 1)
})

test('heatNorms：log1p 后榜内拉伸，没有热度是 0，全一样也是 0', () => {
  const norms = heatNorms([1000, 10, null, 0])
  assert.equal(norms[0], 1)
  assert.equal(norms[2], 0)
  assert.equal(norms[3], 0)
  assert.ok(Math.abs(norms[1] - Math.log1p(10) / Math.log1p(1000)) < 1e-9)
  assert.deepEqual(heatNorms([null, null]), [0, 0])
  assert.deepEqual(heatNorms([5, 5]), [0, 0])
})

test('rankEntries：score = 0.65·相关 + 0.25·新鲜 + 0.10·热度，并写明命中了哪些方向', () => {
  const entries = [
    { title: '天气预报', summary: '', date: new Date(NOW).toISOString(), heat: 100 },
    { title: 'Agent 评测新基准', summary: '', date: new Date(NOW - 15 * DAY).toISOString(), heat: 1 },
    { title: '某明星八卦', summary: '和 Agent 无关', date: new Date(NOW).toISOString(), heat: 1 },
  ]
  const ranked = rankEntries(entries, { topics: ['Agent 评测'], blocked: ['八卦'] }, { now: NOW })
  assert.equal(ranked.hidden, 1)
  assert.equal(ranked.hasTopics, true)
  assert.deepEqual(ranked.original.map(row => row.index), [0, 1])
  assert.deepEqual(ranked.byFocus.map(row => row.index), [1, 0])
  const top = ranked.byFocus[0].why
  assert.deepEqual(top.hits, ['Agent 评测'])
  assert.deepEqual(top.partial, [])
  assert.deepEqual(rankEntries([{ title: 'Agent 框架' }], { topics: ['Agent 评测'] }, { now: NOW }).original[0].why.partial, ['Agent 评测'])
  // 被隐藏的那条不参与热度拉伸：剩下两条里 heat=1 的是最低
  assert.ok(Math.abs(top.score - (0.65 * 1 + 0.25 * 0.5 + 0.1 * 0)) < 1e-9)
  assert.ok(Math.abs(ranked.byFocus[1].why.score - (0.25 * 1 + 0.1 * 1)) < 1e-9)
  assert.deepEqual(ranked.byFocus[1].why.hits, [])
})

test('rankEntries：没设方向时保持原顺序、不给分，但「不想看」照样生效', () => {
  const entries = [{ title: 'b' }, { title: 'a 广告' }, { title: 'c' }]
  const ranked = rankEntries(entries, { topics: [], blocked: ['广告'] }, { now: NOW })
  assert.equal(ranked.hasTopics, false)
  assert.equal(ranked.hidden, 1)
  assert.deepEqual(ranked.byFocus.map(row => row.entry.title), ['b', 'c'])
  assert.ok(ranked.byFocus.every(row => row.why === null))
  assert.equal(blockedBy('Some AD here', ['ad']), 'ad')
  assert.equal(blockedBy('Some text', ['  ']), null)
})

test('rankEntries：混排时热度按 group 分开拉伸', () => {
  const entries = [{ title: 'x1', heat: 10, source: 'a' }, { title: 'x2', heat: 1, source: 'a' }, { title: 'y1', heat: 100000, source: 'b' }, { title: 'y2', heat: 50000, source: 'b' }]
  const ranked = rankEntries(entries, { topics: ['无关'] }, { now: NOW, groupOf: entry => entry.source })
  const heat = Object.fromEntries(ranked.original.map(row => [row.entry.title, row.why.heat]))
  assert.equal(heat.x1, 1)
  assert.equal(heat.y1, 1)
  assert.equal(heat.x2, 0)
  assert.equal(heat.y2, 0)
})

test('多榜同现：同一链接或标题 Jaccard ≥ 0.5 算同一件事，只跨榜合并', () => {
  assert.equal(sameStory({ url: 'https://a', title: 'x' }, { url: 'https://a', title: 'y' }), true)
  assert.ok(titleSimilarity('某地发布台风红色预警', '某地发布台风红色预警信号') >= 0.5)
  assert.ok(titleSimilarity('某地发布台风红色预警', '新手机发布会') < 0.5)
  const sources = [
    { id: 'weibo', name: '微博热搜', entries: [{ title: '某地发布台风红色预警', url: 'https://w/1', rank: 3 }, { title: '明星官宣', url: 'https://w/2', rank: 1 }, { title: '明星官宣恋情', url: 'https://w/3', rank: 2 }] },
    { id: 'baidu', name: '百度热搜', entries: [{ title: '某地发布台风红色预警信号', url: 'https://b/1', rank: 5 }] },
    { id: 'bilibili', name: 'B 站热门', entries: [{ title: '某地台风红色预警发布', url: 'https://v/1', rank: 9 }, { title: '游戏实况', url: 'https://v/2', rank: 1 }] },
    { id: 'github', name: 'GitHub Trending', entries: [], error: '没读到' },
  ]
  const { groups, tags } = crossLists(sources)
  // 同一个榜里两条相似的（明星官宣）不算多榜同现
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].names, ['微博热搜', '百度热搜', 'B 站热门'])
  assert.deepEqual(groups[0].entries.map(row => row.rank), [3, 5, 9])
  assert.deepEqual(tags['baidu|https://b/1'], ['微博热搜', '百度热搜', 'B 站热门'])
  assert.equal(tags['weibo|https://w/2'], undefined)
  assert.deepEqual(crossLists([]), { groups: [], tags: {} })
})

test('set_focus：去重去空白，超上限或太长报错，不悄悄截断；可撤销靠 store，这里只看校验', () => {
  const state = migrateState({ items: [], people: [], angles: [], metrics: [], accounts: [], skills: [] })
  assert.deepEqual(state.focus, { topics: [], blocked: [] })
  // 第一次打开：内置源全开，默认订阅订好；只做这一次
  assert.ok(state.builtin.includes('cn-ai') && state.builtin.includes('hf-papers'))
  assert.ok(state.feeds.length >= 5)
  state.feeds = []
  state.builtin = []
  migrateState(state)
  assert.deepEqual([state.feeds.length, state.builtin.length], [0, 0])
  const ok = applyOps(state, [{ op: 'set_focus', topics: [' Agent ', 'agent', '大模型', ''], blocked: ['八卦'] }])
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(state.focus, { topics: ['Agent', '大模型'], blocked: ['八卦'] })
  // 只传 blocked 时方向不动
  applyOps(state, [{ op: 'set_focus', blocked: [] }])
  assert.deepEqual(state.focus, { topics: ['Agent', '大模型'], blocked: [] })
  const tooMany = applyOps(state, [{ op: 'set_focus', topics: Array.from({ length: 13 }, (_, i) => `方向${i}`) }])
  assert.equal(tooMany.errors.length, 1)
  const tooLong = applyOps(state, [{ op: 'set_focus', topics: ['一'.repeat(21)] }])
  assert.equal(tooLong.errors.length, 1)
  const wrongType = applyOps(state, [{ op: 'set_focus', topics: 'Agent' }])
  assert.equal(wrongType.errors.length, 1)
  assert.deepEqual(state.focus.topics, ['Agent', '大模型'])
  assert.equal(applyOps(state, [{ op: 'set_focus', blocked: Array.from({ length: 31 }, (_, i) => `词${i}`) }]).errors.length, 1)
})

test('set_builtin：只认内置分组，开关记在状态里', () => {
  const state = migrateState({ items: [], people: [], angles: [], metrics: [], accounts: [], skills: [], sourcesSeeded: true })
  applyOps(state, [{ op: 'set_builtin', id: 'cn-ai', on: true }, { op: 'set_builtin', id: 'builders-x', on: true }, { op: 'set_builtin', id: 'cn-ai', on: true }])
  assert.deepEqual(state.builtin, ['builders-x', 'cn-ai'])
  applyOps(state, [{ op: 'set_builtin', id: 'builders-x', on: false }])
  assert.deepEqual(state.builtin, ['cn-ai'])
  assert.equal(applyOps(state, [{ op: 'set_builtin', id: 'nope', on: true }]).errors.length, 1)
  assert.equal(applyOps(state, [{ op: 'set_builtin', id: 'cn-ai', on: 'yes' }]).errors.length, 1)
})
