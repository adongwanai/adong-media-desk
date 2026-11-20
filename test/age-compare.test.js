// 同龄对比：按发布后第 1/3/7 天取那一时刻的数据，和上一篇同一个龄期比；没有数据就是 null，不硬比、不拿 0 当分母。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ageLine, ageLinesByItem, compareAges, compareAtAge, previousPublished, ratioOf, snapshotAt, viewWord } from '../src/age-compare.js'
import { computeInsights } from '../src/learn.js'

const PREV = { id: 'prev', title: '上一篇', status: 'published', publishedAt: '2026-11-01T02:00:00.000Z', platform: '小红书' }
const CUR = { id: 'cur', title: '这一篇', status: 'published', publishedAt: '2026-11-10T02:00:00.000Z', platform: '小红书' }

/** 一条数据：publishedAt 之后第 days 天（本地日历日）记的累计数。 */
function at(item, platform, days, values) {
  const d = new Date(item.publishedAt)
  d.setDate(d.getDate() + days)
  return { id: `${item.id}-${platform}-${days}`, itemId: item.id, platform, date: d.toISOString(), ...values }
}

test('snapshotAt：取发布后第 N 天当天或之后最近的一条，超过 N+2 天算没有', () => {
  const snap1 = snapshotAt([at(CUR, '小红书', 1, { views: 1000 })], CUR, 1)
  assert.equal(snap1.views, 1000)
  assert.equal(snap1.rows[0].platform, '小红书')
  // 第 3 天没记：窗口里没有数据，是 null，不拿第 1 天的数顶替
  assert.equal(snapshotAt([at(CUR, '小红书', 1, { views: 1000 })], CUR, 3), null)
  // 第 3 天 0 时没记、第 4 天记了：在 N+2 天内，算第 3 天
  assert.equal(snapshotAt([at(CUR, '小红书', 4, { views: 500 })], CUR, 3).views, 500)
  // 第 6 天才记：超出 N+2 天窗口，算没有
  assert.equal(snapshotAt([at(CUR, '小红书', 6, { views: 500 })], CUR, 3), null)
  // 发布前的数不算
  assert.equal(snapshotAt([at(CUR, '小红书', 0, { views: 500 })], CUR, 1), null)
  // 没有发布时间就没得算
  assert.equal(snapshotAt([at(CUR, '小红书', 1, { views: 1 })], { id: 'cur' }, 1), null)
})

test('snapshotAt：多平台分开取，合计只加记了播放的平台；同一平台同一天几条以最后记的为准', () => {
  const metrics = [
    at(CUR, '小红书', 1, { views: 800, likes: 10 }),
    at(CUR, '小红书', 1, { views: 900, likes: 12 }),
    at(CUR, '抖音', 1, { views: 300, likes: 3 }),
    at(CUR, '抖音', 2, { views: 450, likes: 4 }),
    at(CUR, 'B站', 1, { likes: 5 }),
  ]
  const snap = snapshotAt(metrics, CUR, 1)
  assert.deepEqual(snap.rows.map(row => [row.platform, row.views]), [['小红书', 900], ['抖音', 300], ['B站', null]])
  assert.equal(snap.views, 1200)
  assert.equal(snap.word, '阅读/播放')
})

test('snapshotAt：导入的作品行按抓取时间算观察时间，手动记的按记录日期', () => {
  // 以后才导入的一条：date 是发布时间，fetchedAt 是那天抓的数
  const late = { id: 'm', itemId: 'cur', platform: '小红书', date: '2026-11-11T02:00:00.000Z', fetchedAt: '2026-11-20T02:00:00.000Z', views: 1234 }
  // 观察时间是 11-20：发布后第 1 天是 11-11、到 11-13 为止，11-20 已经太晚
  assert.equal(snapshotAt([late], CUR, 1), null)
  const near = { ...late, fetchedAt: '2026-11-12T02:00:00.000Z' }
  assert.equal(snapshotAt([near], CUR, 1).views, 1234)
})

test('ratioOf：上一篇是 0 或没记播放就算不出来，不拿 0 当分母', () => {
  assert.deepEqual(ratioOf(3120, 1560), { ratio: 2, percent: 200 })
  assert.equal(ratioOf(100, 0), null)
  assert.equal(ratioOf(100, null), null)
  assert.equal(ratioOf(null, 100), null)
})

test('compareAtAge / compareAges：这一篇和上一篇各自第 1 天对比，按平台分开并给合计', () => {
  const metrics = [
    at(PREV, '小红书', 1, { views: 1000 }),
    at(PREV, '抖音', 1, { views: 1000 }),
    at(CUR, '小红书', 1, { views: 2400 }),
    at(CUR, '抖音', 1, { views: 700 }),
  ]
  const one = compareAtAge({ metrics, current: CUR, previous: PREV, age: 1 })
  assert.equal(one.reason, null)
  assert.equal(one.overall.views.ratio, 1.55)
  assert.deepEqual(one.platforms.map(row => [row.platform, row.current, row.previous, row.views.ratio]), [['小红书', 2400, 1000, 2.4], ['抖音', 700, 1000, 0.7]])
  const all = compareAges({ metrics, current: CUR, previous: PREV })
  assert.equal(all.latest.age, 1)
  assert.equal(all.ages.length, 3)
  // 第 3、7 天这一篇没有数据：不硬比
  assert.equal(all.ages[1].reason, 'no-current')
})

test('compareAges：上一篇那个龄期没数据、没记播放、没有上一篇，各自说清楚比不了', () => {
  const onlyCur = [at(CUR, '小红书', 1, { views: 2400 })]
  // 没有上一篇：这一篇自己有数据，但写不出对比句
  assert.equal(ageLine(compareAges({ metrics: onlyCur, current: CUR, previous: null })), null)
  assert.equal(compareAtAge({ metrics: onlyCur, current: CUR, previous: null, age: 1 }).reason, 'no-previous')
  assert.equal(compareAtAge({ metrics: onlyCur, current: CUR, previous: PREV, age: 1 }).reason, 'no-previous-data')
  const zero = [at(PREV, '小红书', 1, { views: 0 }), at(CUR, '小红书', 1, { views: 2400 })]
  assert.equal(compareAtAge({ metrics: zero, current: CUR, previous: PREV, age: 1 }).reason, 'no-previous-views')
  const noViews = [at(PREV, '小红书', 1, { likes: 3 }), at(CUR, '小红书', 1, { views: 2400 })]
  assert.equal(compareAtAge({ metrics: noViews, current: CUR, previous: PREV, age: 1 }).reason, 'no-previous-views')
})

test('ageLine：写清全平台倍数和分平台倍数，注明是哪两条、各自哪天发布', () => {
  const metrics = [
    at(PREV, '小红书', 1, { views: 1300 }),
    at(CUR, '小红书', 1, { views: 3120 }),
  ]
  const line = ageLine(compareAges({ metrics, current: CUR, previous: PREV }))
  assert.match(line.text, /^发帖后第 1 天：全平台 3,120 次阅读\/播放，是上一篇同时点的 2\.4 倍/)
  assert.match(line.text, /其中小红书 2\.4 倍/)
  assert.match(line.note, /这一篇《这一篇》11月10日发布/)
  assert.match(line.note, /上一篇《上一篇》11月1日发布/)
  assert.match(line.note, /数据取于 11月11日/)
  // 分平台也按倍数写：超过 10 倍的取整，不到上一篇的写 0.x 倍
  const mixed = ageLine(compareAges({ metrics: [at(PREV, '小红书', 1, { views: 1000 }), at(PREV, '抖音', 1, { views: 1000 }), at(CUR, '小红书', 1, { views: 24000 }), at(CUR, '抖音', 1, { views: 700 })], current: CUR, previous: PREV }))
  assert.match(mixed.text, /其中小红书 24 倍、抖音 0\.7 倍/)
  // 不到上一篇：写百分比
  const low = ageLine(compareAges({ metrics: [at(PREV, '小红书', 1, { views: 4000 }), at(CUR, '小红书', 1, { views: 1720 })], current: CUR, previous: PREV }))
  assert.match(low.text, /只有上一篇同时点的 43%/)
})

test('ageLine：上一篇那天没有数据时写明没法对比', () => {
  const line = ageLine(compareAges({ metrics: [at(CUR, '小红书', 1, { views: 2400 })], current: CUR, previous: PREV }))
  assert.equal(line.text, '发帖后第 1 天：上一篇第 1 天没有数据，无法对比')
  assert.equal(line.reason, 'no-previous-data')
  // 没有上一篇：不出这一句
  assert.equal(ageLine(compareAges({ metrics: [], current: CUR, previous: null })), null)
})

test('ageLine：翻译函数传进来时整句走调用方的词典，占位符照常填', () => {
  const dict = { '发帖后第 {n} 天：全平台 {views}，{compare}；其中{list}。': 'Day {n}: {views} across platforms, {compare}; {list}.', '是上一篇同时点的 {n}': '{n} the previous at the same age', '{views} 次阅读/播放': '{views} reads/plays', 小红书: 'RedNote', '{n} 倍': '{n}x', '、': ', ' }
  const line = ageLine(compareAges({ metrics: [at(PREV, '小红书', 1, { views: 1300 }), at(CUR, '小红书', 1, { views: 3120 })], current: CUR, previous: PREV }), (zh, vars) => (dict[zh] ?? zh).replace(/\{(\w+)\}/g, (match, key) => (vars?.[key] === undefined ? match : String(vars[key]))))
  assert.equal(line.text, 'Day 1: 3,120 reads/plays across platforms, 2.4x the previous at the same age; RedNote 2.4x.')
})

test('viewWord：图文叫阅读，视频叫播放，混着叫阅读/播放', () => {
  assert.equal(viewWord(['公众号', '知乎']), '阅读')
  assert.equal(viewWord(['抖音', 'B站']), '播放')
  assert.equal(viewWord(['公众号', '抖音']), '阅读/播放')
})

test('previousPublished：按发布时间取上一篇，优先有数据的那条', () => {
  const items = [
    { id: 'a', title: 'A', publishedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'b', title: 'B', publishedAt: '2026-11-05T00:00:00.000Z' },
    { id: 'c', title: 'C', publishedAt: '2026-11-10T00:00:00.000Z' },
    { id: 'x', title: 'X', publishedAt: '2026-11-09T00:00:00.000Z' },
  ]
  assert.equal(previousPublished(items, items[2]).id, 'x')
  // X 一条数都没记：跳到有数据的 B
  const metrics = [{ itemId: 'a', platform: '小红书', date: '2026-11-02T00:00:00.000Z', views: 1 }, { itemId: 'b', platform: '小红书', date: '2026-11-06T00:00:00.000Z', views: 2 }]
  assert.equal(previousPublished(items, items[2], { metrics }).id, 'b')
  // 之后发布的、示例内容都不算上一篇
  const later = { id: 'z', title: 'Z', publishedAt: '2026-11-20T00:00:00.000Z' }
  assert.notEqual(previousPublished([...items, later], later).id, 'z')
  assert.equal(previousPublished([{ id: 's', title: 'S', sample: true, publishedAt: '2026-11-01T00:00:00.000Z' }], items[2]), null)
})

test('computeInsights：单篇诊断带上同龄对比，算不出来的不硬塞', () => {
  const items = [PREV, CUR, { id: 'lonely', title: '没上一篇', status: 'published', publishedAt: '2026-10-01T00:00:00.000Z', platform: '小红书' }]
  const metrics = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, itemId: PREV.id, platform: '小红书', date: `2026-10-${String(i + 1).padStart(2, '0')}T02:00:00.000Z`, views: 100 + i, impressions: 1000, likes: 10, comments: 5, saves: 5, shares: 5, newFollowers: 2 })),
    at(PREV, '小红书', 1, { views: 1000 }),
    at(CUR, '小红书', 1, { views: 2400 }),
    { id: 'lp', itemId: 'lonely', platform: '小红书', date: '2026-10-02T00:00:00.000Z', views: 3 },
  ]
  const data = computeInsights({ items, metrics, accounts: [], skills: [] })
  const cur = data.pieces.find(piece => piece.itemId === 'cur')
  assert.match(cur.age.text, /发帖后第 1 天/)
  const lonely = data.pieces.find(piece => piece.itemId === 'lonely')
  // 没上一篇：不生成，不留一句空话
  assert.equal(lonely.age, undefined)
})

test('ageLinesByItem：只给有发布时间、有上一篇的内容生成', () => {
  const lines = ageLinesByItem({
    items: [PREV, CUR, { id: 'draft', title: '草稿' }],
    metrics: [at(PREV, '小红书', 1, { views: 10 }), at(CUR, '小红书', 1, { views: 30 })],
  })
  assert.deepEqual([...lines.keys()], ['cur'])
  assert.match(lines.get('cur').text, /3\.0 倍/)
})
