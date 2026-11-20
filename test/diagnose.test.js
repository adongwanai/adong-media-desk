// 单篇诊断：只和作者自己同平台的作品比，样本不够不下结论，没记的数不当 0。
// 数据全是手写的小样本，覆盖缺字段、不满 10 篇、漏斗每一环和并列。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MIN_SAMPLE, diagnosePieces, quantile } from '../src/diagnose.js'

/** 第 i 篇：各项都有一点差别，中位数和 25 分位落在可预期的位置。 */
function base(i, extra = {}) {
  return { id: `m${i}`, platform: '小红书', title: `第${i}篇`, date: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`, impressions: 1000 + i * 10, views: 100 + i, completion: 0.3 + i * 0.01, likes: 10, comments: 5, saves: 5, shares: 5, newFollowers: 2, ...extra }
}

function stateWith(target, count = 11) {
  return { items: [], metrics: [...Array.from({ length: count }, (_, i) => base(i)), { ...base(5), title: '目标', date: '2026-11-01T12:00:00.000Z', ...target }] }
}

const pieceOf = (state, title = '目标') => diagnosePieces(state).find(row => row.title === title)

test('quantile：线性插值，空数组是 null', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3)
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75)
  assert.equal(quantile([], 0.5), null)
})

test('漏斗每一环：只报最靠上游的那个明显偏低的环节，并给对应动作和篇数', () => {
  const impressions = pieceOf(stateWith({ impressions: 200 }))
  assert.equal(impressions.verdict, 'low')
  assert.equal(impressions.stage, 'impressions')
  assert.equal(impressions.sample, 12)
  assert.match(impressions.line, /曝光 200，低于你在小红书的 25 分位.*依据 12 篇/)

  // 播放少了：点击率最先掉下去，后面的深度互动、涨粉虽然被抬高也不影响
  const ctr = pieceOf(stateWith({ views: 20 }))
  assert.equal(ctr.stage, 'ctr')
  assert.equal(ctr.action, '换标题和封面')

  const completion = pieceOf(stateWith({ completion: 0.05 }))
  assert.equal(completion.stage, 'completion')
  assert.match(completion.action, /前三秒.*第一屏/)

  const deep = pieceOf(stateWith({ comments: 0, saves: 0, shares: 0 }))
  assert.equal(deep.stage, 'deep')
  assert.match(deep.action, /清单/)

  const follows = pieceOf(stateWith({ newFollowers: 0 }))
  assert.equal(follows.stage, 'follows')
  assert.match(follows.action, /结尾.*主页/)

  // 两环都低时报上游那个
  assert.equal(pieceOf(stateWith({ completion: 0.01, newFollowers: 0 })).stage, 'completion')
})

test('没有短板时说出相对最强的一项', () => {
  const strong = pieceOf(stateWith({ saves: 40 }))
  assert.equal(strong.verdict, 'strong')
  assert.equal(strong.stage, 'saveLike')
  assert.match(strong.line, /没有明显偏低的环节；相对最强的是收藏\/点赞比/)
  assert.match(strong.line, /依据 12 篇/)
  assert.match(strong.action, /干货/)
})

test('并列：等于 25 分位不算偏低；倍数一样时按漏斗顺序取靠前的', () => {
  const same = { items: [], metrics: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, platform: 'B站', title: `同${i}`, date: '2026-10-01T00:00:00.000Z', impressions: 500, views: 50, completion: 0.4, comments: 1, saves: 1, shares: 1, likes: 3, newFollowers: 1 })) }
  const rows = diagnosePieces(same)
  assert.equal(rows.length, 12)
  for (const row of rows) {
    assert.equal(row.verdict, 'strong')
    assert.equal(row.stage, 'impressions')
    assert.match(row.line, /1\.0 倍/)
    assert.equal(row.action, '照现在的做法继续发，没有哪一项明显领先')
  }
})

test('样本不足：同平台有这项数的不到 10 篇时先不下结论，并写出篇数', () => {
  const state = stateWith({ impressions: 1 }, MIN_SAMPLE - 2)
  const piece = pieceOf(state)
  assert.equal(piece.verdict, 'insufficient')
  assert.equal(piece.sample, 9)
  assert.equal(piece.line, '样本不足（9 篇），先不下结论')
  assert.match(piece.action, /再录 1 篇/)
  assert.ok(piece.notes.includes('曝光：样本不足（9 篇），先不下结论'))

  // 别的平台的作品不算进来，也不拿行业数字顶替
  const mixed = stateWith({}, 11)
  mixed.metrics.push({ id: 'b', platform: 'B站', title: 'B站那篇', date: '2026-11-02T00:00:00.000Z', impressions: 1, views: 1 })
  const bili = pieceOf(mixed, 'B站那篇')
  assert.equal(bili.verdict, 'insufficient')
  assert.equal(bili.sample, 1)
})

test('缺字段：没记的数不当 0，不进分母也不进样本', () => {
  const state = stateWith({}, 11)
  // 只有点赞：算不出任何环节
  state.metrics.push({ id: 'x', platform: '小红书', title: '只有点赞', date: '2026-11-03T00:00:00.000Z', likes: 9 })
  // 没有曝光：不参与曝光和点击率，有播放和收藏还能算深度互动（只用记了的项）
  state.metrics.push({ id: 'y', platform: '小红书', title: '没有曝光', date: '2026-11-04T00:00:00.000Z', views: 100, saves: 2 })
  const rows = diagnosePieces(state)
  const none = rows.find(row => row.title === '只有点赞')
  assert.equal(none.verdict, 'none')
  assert.equal(none.sample, 0)
  const partial = rows.find(row => row.title === '没有曝光')
  assert.deepEqual(partial.metrics.map(row => row.key), ['deep'])
  assert.equal(partial.metrics[0].value, 0.02)
  // 曝光的样本只有 12 篇记了曝光的，没记的两篇不算
  assert.equal(rows.find(row => row.title === '目标').metrics.find(row => row.key === 'impressions').n, 12)
  // 播放是 0 时比例没有分母，不出深度互动
  const zero = diagnosePieces({ metrics: [{ platform: '知乎', title: '零播放', date: '2026-11-01', views: 0, comments: 3 }] })[0]
  assert.equal(zero.verdict, 'none')
})

test('同一篇多条记录：计数相加，完播率取最近一条；挂了内容的用内容标题；有真实数据后示例不参与', () => {
  const state = {
    items: [{ id: 'it1', title: '灵感原题', production: { title: '成稿标题' } }],
    metrics: [
      { id: 'a', itemId: 'it1', platform: '抖音', date: '2026-11-01T00:00:00.000Z', views: 100, impressions: 1000, completion: 0.2 },
      { id: 'b', itemId: 'it1', platform: '抖音', date: '2026-11-02T00:00:00.000Z', views: 50, completion: 0.3 },
      { id: 'c', platform: '抖音', title: '示例', date: '2026-11-02T00:00:00.000Z', views: 5, sample: true },
      { id: 'd', platform: '抖音', date: '2026-11-02T00:00:00.000Z', views: 5 },
    ],
  }
  const rows = diagnosePieces(state)
  assert.equal(rows.length, 1, '示例和既没挂内容也没标题的记录都不算一篇')
  assert.equal(rows[0].title, '成稿标题')
  const byKey = Object.fromEntries(rows[0].metrics.map(row => [row.key, row.value]))
  assert.equal(byKey.impressions, 1000)
  assert.equal(byKey.ctr, 0.15)
  assert.equal(byKey.completion, 0.3)
})
