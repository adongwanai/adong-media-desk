// 对标作品的相对表现评级：只和这位作者自己的其他作品比。数据都是手写的小样本。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FLOOR, engagementValue, scoreWorks } from '../src/rival-score.js'

const day = n => `2026-10-${String(n).padStart(2, '0')}`
const work = (id, n, likes, extra = {}) => ({ id, title: `作品${id}`, date: day(n), likes, comments: 0, saves: 0, shares: 0, ...extra })

test('engagementValue：收藏、评论比点赞重，转发最重；缺的项不当 0，标成部分数据', () => {
  assert.deepEqual(engagementValue({ likes: 10, comments: 2, saves: 3, shares: 1 }, 'B站'), { value: 10 + 6 + 9 + 4, partial: false })
  assert.deepEqual(engagementValue({ likes: 10, comments: 2, saves: 3, shares: 1 }, '小红书'), { value: 10 + 6 + 12 + 5, partial: false })
  assert.deepEqual(engagementValue({ likes: 10, saves: 3 }, '抖音'), { value: 19, partial: true })
  assert.deepEqual(engagementValue({ views: 100 }, '抖音'), { value: null, partial: true })
  const one = { likes: 1, comments: 1, saves: 1, shares: 1 }
  for (const platform of ['小红书', 'B站', '抖音']) {
    const v = key => engagementValue({ [key]: 1 }, platform).value
    assert.ok(v('saves') > v('likes') && v('comments') > v('likes'), platform)
    assert.ok(v('shares') >= Math.max(v('saves'), v('comments')), platform)
    assert.equal(engagementValue(one, platform).partial, false)
  }
})

test('评级：现象级 ≥8、爆款 ≥4、潜力 ≥2，其余没有评级；按 R 从高到低排', () => {
  const others = [1, 2, 3, 4, 5].map(n => work(`o${n}`, n, 100))
  const rows = scoreWorks([...others, work('a', 10, 800), work('b', 11, 400), work('c', 12, 200), work('d', 13, 199)], '抖音')
  const byId = Object.fromEntries(rows.map(row => [row.id, row]))
  assert.equal(byId.a.grade, '现象级')
  assert.equal(byId.b.grade, '爆款')
  assert.equal(byId.c.grade, '潜力')
  assert.equal(byId.d.grade, null)
  assert.equal(byId.o1.grade, null)
  assert.equal(rows[0].id, 'a')
  // 对比的中位数不含这条自己
  assert.equal(byId.a.median, 100)
})

test('样本不足：其他有数的作品不到 5 条；没有互动数的作品不进对比', () => {
  const rows = scoreWorks([work('a', 1, 10), work('b', 2, 10), work('c', 3, 10), work('d', 4, 10), work('e', 5, 500), { id: 'f', title: '只有播放', date: day(6), views: 9999 }], '抖音')
  const e = rows.find(row => row.id === 'e')
  assert.equal(e.grade, '样本不足')
  assert.equal(e.compared, 4)
  assert.equal(e.ratio, null)
  const f = rows.find(row => row.id === 'f')
  assert.deepEqual([f.value, f.grade, f.ratio], [null, null, null])
})

test('门槛：R ≥ 2 但互动值不到 max(20, 2×中位数) 是虚高', () => {
  const small = [1, 2, 3, 4, 5].map(n => work(`o${n}`, n, 2))
  const rows = scoreWorks([...small, work('x', 9, 18)], '抖音')
  const x = rows.find(row => row.id === 'x')
  assert.equal(x.ratio, 9)
  assert.equal(x.floor, FLOOR)
  assert.equal(x.grade, '虚高')
  const ok = scoreWorks([...small, work('y', 9, 20)], '抖音').find(row => row.id === 'y')
  assert.equal(ok.grade, '现象级')
})

test('只和最近的 20 条其他作品比', () => {
  // 早年的 10 条互动很高，最近的 20 条很低；目标只该和最近的 20 条比
  const old = Array.from({ length: 10 }, (_, i) => ({ ...work(`old${i}`, 1, 1000), date: `2025-01-${String(i + 1).padStart(2, '0')}` }))
  const recent = Array.from({ length: 20 }, (_, i) => work(`r${i}`, i + 2, 10))
  const target = scoreWorks([...old, ...recent, work('t', 28, 100)], '抖音').find(row => row.id === 't')
  assert.equal(target.compared, 20)
  assert.equal(target.median, 10)
  assert.equal(target.grade, '现象级')
})

test('中位数是 0：有互动的那条倍数是无穷大，过了门槛才评级，排在最前', () => {
  const zeros = [1, 2, 3, 4, 5].map(n => work(`z${n}`, n, 0))
  const rows = scoreWorks([...zeros, work('p', 9, 25), work('q', 10, 5)], '抖音')
  assert.equal(rows[0].ratio, Infinity)
  assert.equal(rows.find(row => row.id === 'p').grade, '现象级')
  assert.equal(rows.find(row => row.id === 'q').grade, '虚高')
})
