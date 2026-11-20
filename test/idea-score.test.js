// 选题评分卡：全部已知、缺项、扣分、没设方向，以及模型参考分的读取。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anglePrompts, cleanScoreParts, heatFromRank, historyPenalty, parseAngle, partValue, scoreIdea, scoreTotal } from '../src/idea-score.js'
import { applyOps } from '../src/ops.js'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const DAY = 86_400_000
const ago = days => new Date(NOW - days * DAY).toISOString()

test('heatFromRank：前 10 名 10→8，11–30 名 7→5，再往后 4→1', () => {
  assert.equal(heatFromRank(1), 10)
  assert.equal(heatFromRank(10), 8)
  assert.equal(heatFromRank(11), 7)
  assert.equal(heatFromRank(30), 5)
  assert.equal(heatFromRank(31), 4)
  assert.equal(heatFromRank(60), 1)
  assert.equal(heatFromRank(500), 1)
})

test('三项都知道：按 30/40/30 加权', () => {
  const item = { id: 'a', title: 'Agent 评测怎么做', body: '', rank: 1, sourceList: '微博热搜', scoreParts: { angle: { value: 6 } } }
  const result = scoreIdea(item, { items: [item], topics: ['Agent 评测'], now: NOW })
  assert.deepEqual(result.known, ['heat', 'relevance', 'angle'])
  assert.deepEqual(result.missing, [])
  assert.equal(result.parts.heat.value, 10)
  assert.equal(result.parts.heat.sourceList, '微博热搜')
  assert.equal(result.parts.relevance.value, 10)
  assert.deepEqual(result.parts.relevance.hits, ['Agent 评测'])
  assert.equal(result.total, Math.round((0.3 * 10 + 0.4 * 10 + 0.3 * 6) * 10))
})

test('缺项不算 0：手记的灵感热度不知道（不按 5 分算）；知道两项才按已知的项重新分配权重', () => {
  const item = { id: 'a', title: '大模型推理成本', body: '' }
  const result = scoreIdea(item, { items: [item], topics: ['大模型'], now: NOW })
  assert.deepEqual(result.missing, ['heat', 'angle'])
  assert.equal(result.parts.heat.value, null)
  assert.equal(result.parts.heat.evergreen, true)
  assert.equal(result.parts.angle.value, null)
  // 只知道相关度：不给总分
  assert.equal(result.total, null)
  // 打了切入价值就是两项：(0.4·10 + 0.3·6) / 0.7
  assert.equal(scoreIdea(item, { items: [item], topics: ['大模型'], angle: 6, now: NOW }).total, Math.round(((0.4 * 10 + 0.3 * 6) / 0.7) * 10))
  // 手记的灵感不会都停在同一个分上
  const other = { id: 'b', title: '咖啡店选址', body: '' }
  assert.notEqual(scoreIdea(other, { items: [other], topics: ['大模型'], angle: 6, now: NOW }).total, scoreIdea(item, { items: [item], topics: ['大模型'], angle: 6, now: NOW }).total)
})

test('只知道热度时不给总分（以前热榜第 3 名单项就显示 96/100）；旧数据里按常青题记的热度也算不知道', () => {
  const item = { id: 'a', title: '某个热搜', rank: 3, sourceList: '微博热搜' }
  const result = scoreIdea(item, { items: [], topics: [], now: NOW })
  assert.equal(result.parts.heat.value, 9.6)
  assert.deepEqual([result.total, result.known, result.missing], [null, ['heat'], ['relevance', 'angle']])
  assert.deepEqual(scoreTotal({ heat: { value: 9.6 } }), { total: null, known: ['heat'], missing: ['relevance', 'angle'] })
  assert.equal(scoreTotal({ heat: { value: 5, evergreen: true }, relevance: { value: 8 } }).total, null)
  assert.equal(scoreTotal({ heat: { value: 9.6 }, relevance: { value: 8 } }).total, Math.round(((0.3 * 9.6 + 0.4 * 8) / 0.7) * 10))
  assert.equal(partValue({ heat: { value: 5, evergreen: true } }, 'heat'), null)
  assert.equal(partValue(undefined, 'angle'), null)
  // 保存时 score 可以清成 null
  const state = { items: [{ id: 'a', title: 't', score: 96 }] }
  applyOps(state, [{ op: 'update_item', id: 'a', score: null }])
  assert.equal(state.items[0].score, null)
})

test('没设方向：相关度标成「还没设置方向」，不参与总分', () => {
  const item = { id: 'a', title: '随便一个题', rank: 20 }
  const result = scoreIdea(item, { items: [], topics: [], now: NOW })
  assert.equal(result.parts.relevance.value, null)
  assert.equal(result.parts.relevance.noTopics, true)
  assert.deepEqual(result.known, ['heat'])
  assert.equal(result.total, null)
  // 设了方向但完全没命中，是 0 分而不是缺项
  const miss = scoreIdea(item, { items: [], topics: ['Agent'], now: NOW })
  assert.equal(miss.parts.relevance.value, 0)
  assert.deepEqual(miss.known, ['heat', 'relevance'])
})

test('历史扣分：7 天内相近的成稿扣 3，7–30 天扣 1，更早或不相关不扣，示例不算', () => {
  const idea = { id: 'new', title: 'Agent 评测框架对比', body: '几个开源评测框架' }
  const done = (id, days, title, extra = {}, article = '正文聊开源评测框架') => ({ id, title, status: 'draft', createdAt: ago(days + 1), production: { status: 'done', title, article: `${title}，${article}`, finishedAt: ago(days) }, ...extra })
  const recent = done('p1', 3, 'Agent 评测框架怎么选')
  const older = done('p2', 12, 'Agent 评测框架回顾')
  const ancient = done('p3', 40, 'Agent 评测框架往事')
  const unrelated = done('p4', 1, '咖啡店选址', {}, '正文聊租金和人流')
  const sample = done('p5', 1, 'Agent 评测框架示例', { sample: true })
  const published = { id: 'p6', title: 'Agent 评测框架发布稿', body: '开源评测框架', status: 'published', publishedAt: ago(20), createdAt: ago(25) }

  assert.deepEqual(historyPenalty(idea, [idea, recent, older, ancient, unrelated, sample], NOW), { value: -3, id: 'p1', title: 'Agent 评测框架怎么选', days: 3 })
  assert.equal(historyPenalty(idea, [idea, older], NOW).value, -1)
  assert.equal(historyPenalty(idea, [idea, published], NOW).id, 'p6')
  assert.equal(historyPenalty(idea, [idea, ancient, unrelated, sample], NOW), null)

  const scored = scoreIdea({ ...idea, rank: 1 }, { items: [idea, recent], topics: ['Agent 评测'], now: NOW })
  assert.equal(scored.parts.penalty.value, -3)
  // (0.3·10 + 0.4·10)/0.7 = 10，扣 3 后 7
  assert.equal(scored.total, 70)
  // 总分不会低于 0
  assert.equal(scoreIdea({ id: 'z', title: 'Agent 评测框架', rank: 200 }, { items: [recent], topics: ['完全无关'], angle: 1, now: NOW }).total, 0)
})

test('cleanScoreParts：只留认识的字段，数字夹住，格式不对返回 undefined；ops 用它校验', () => {
  assert.equal(cleanScoreParts('x'), undefined)
  assert.equal(cleanScoreParts(null), null)
  const parts = cleanScoreParts({ heat: { value: 99, rank: 3, sourceList: '微博热搜', evil: '<script>' }, angle: { value: 0 }, penalty: { value: -9, id: 'p1', title: 't' }, other: 1, at: '2026-11-13T00:00:00Z' })
  assert.deepEqual(parts, { heat: { value: 10, rank: 3, sourceList: '微博热搜' }, angle: { value: 1 }, penalty: { value: -3, id: 'p1', title: 't' }, at: '2026-11-13T00:00:00.000Z' })

  const state = { items: [], people: [], angles: [], metrics: [], accounts: [], skills: [] }
  const { receipts } = applyOps(state, [{ op: 'add_item', title: '热榜来的', rank: 4, heat: 12345, sourceList: '百度热搜', score: 180, scoreParts: { relevance: { value: 7, hits: ['Agent'] } } }])
  const item = state.items.find(row => row.id === receipts[0].target)
  assert.equal(item.rank, 4)
  assert.equal(item.heat, 12345)
  assert.equal(item.sourceList, '百度热搜')
  assert.equal(item.score, 100)
  assert.deepEqual(item.scoreParts, { relevance: { value: 7, hits: ['Agent'] } })
  applyOps(state, [{ op: 'update_item', id: item.id, rank: 0, score: 42.6 }])
  assert.equal(item.rank, 4)
  assert.equal(item.score, 43)
})

test('模型参考分：提示词带上灵感和方向，回答只认 1–10', () => {
  const { system, user } = anglePrompts({ title: '标题', body: '正文' }, ['Agent'])
  assert.match(system, /1–10/)
  assert.match(user, /^<idea>.*标题.*Agent.*<\/idea>$/s)
  assert.deepEqual(parseAngle({ score: 7.4, reason: '  角度少见  ' }), { score: 7, reason: '角度少见' })
  assert.deepEqual(parseAngle({ score: '8' }), { score: 8, reason: '' })
  assert.throws(() => parseAngle({ score: 11 }))
  assert.throws(() => parseAngle({}))
})
