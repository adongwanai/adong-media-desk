// 粘贴数据表：按表头认列、数字和日期的写法、出错的行要列出来、按标题挂到已有内容。
// 这些表是照着常见后台导出格式手写的，不是从真实后台抓的（后台要登录）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildImportOps, detectColumns, parseDate, parseNumber, parseRatio, parseTable, splitTable } from '../client/import-table.js'

const NOW = new Date(2026, 10, 13, 12)

test('detectColumns：中英文表头都认，比率、时长、编号这类列不认（完播率、制作时长例外）', () => {
  const { fields, columns } = detectColumns(['发布时间', '作品名称', '作品ID', '播放量', '完播率', '平均播放时长', '点赞', '评论数', '分享', '收藏量', '新增粉丝'])
  assert.deepEqual(fields, { date: 0, title: 1, views: 3, completion: 4, likes: 6, comments: 7, shares: 8, saves: 9, newFollowers: 10 })
  assert.deepEqual(columns.filter(column => !column.field).map(column => column.header), ['作品ID', '平均播放时长'])
  // 曝光是曝光，不再当成播放
  assert.deepEqual(detectColumns(['Date', 'Title', 'Impressions', 'Likes', 'Comments', 'Shares', 'Bookmarks']).fields, { date: 0, title: 1, impressions: 2, likes: 3, comments: 4, shares: 5, saves: 6 })
  assert.deepEqual(detectColumns(['日期', '展现量', '涨粉', '制作时长（分钟）', '完播人数', 'Completion rate']).fields, { date: 0, impressions: 1, newFollowers: 2, minutes: 3, completion: 5 })
  assert.equal(detectColumns(['Date', 'New followers']).fields.newFollowers, 1)
  assert.equal(detectColumns(['日期', '新增关注', '分钟']).fields.newFollowers, 1)
  assert.equal(detectColumns(['日期', '新增关注', '分钟']).fields.minutes, 2)
  // 「作品播放量」里既有「作品」也有「播放量」，算播放
  assert.deepEqual(detectColumns(['日期', '笔记标题', '作品播放量', '赞（个）']).fields, { date: 0, title: 1, views: 2, likes: 3 })
  // 两列都像播放时只取第一列；曝光单独算
  assert.deepEqual(detectColumns(['日期', '阅读', '播放', '曝光']).fields, { date: 0, views: 1, impressions: 3 })
})

test('parseNumber：万、逗号、k 都能读；空格和横线是没填；其余是看不懂', () => {
  assert.equal(parseNumber('1.2万'), 12000)
  assert.equal(parseNumber('3,456'), 3456)
  assert.equal(parseNumber('12.5k'), 12500)
  assert.equal(parseNumber('1.5W'), 15000)
  assert.equal(parseNumber('2亿'), 200000000)
  assert.equal(parseNumber(' 88 次'), 88)
  assert.equal(parseNumber(''), null)
  assert.equal(parseNumber('-'), null)
  assert.ok(Number.isNaN(parseNumber('12%')))
  assert.ok(Number.isNaN(parseNumber('很多')))
})

test('parseDate：常见写法；只写月日用当年；不存在的日子不收', () => {
  assert.equal(parseDate('2026-11-12', NOW), '2026-11-12')
  assert.equal(parseDate('2026/11/2 18:30', NOW), '2026-11-02')
  assert.equal(parseDate('2026年11月12日', NOW), '2026-11-12')
  assert.equal(parseDate('11月12日', NOW), '2026-11-12')
  assert.equal(parseDate('2026-11-12T08:00:00', NOW), '2026-11-12')
  assert.equal(parseDate('2026-02-30', NOW), null)
  assert.equal(parseDate('合计', NOW), null)
})

test('splitTable：制表符优先；CSV 引号里的逗号不切', () => {
  assert.deepEqual(splitTable('日期\t标题\n2026-11-12\t一, 二\n'), [['日期', '标题'], ['2026-11-12', '一, 二']])
  assert.deepEqual(splitTable('date,title,views\r\n2026-11-12,"Hello, ""world""","3,456"'), [['date', 'title', 'views'], ['2026-11-12', 'Hello, "world"', '3,456']])
})

test('parseTable：能读的行带上字段，读不了的行写明第几行、为什么', () => {
  const text = [
    '发布时间\t标题\t播放量\t点赞\t评论\t转发\t收藏',
    '2026-11-12 20:00\t我把 Agent 接进了日报\t1.2万\t356\t48\t-\t120',
    '11月10日\t第二条\t3,456\t12\t\t\t',
    '合计\t\t1.5万\t368\t48\t\t120',
    '2026-11-09\t第三条\t很多\t1\t1\t1\t1',
    '2026-11-08\t空的\t\t\t\t\t',
  ].join('\n')
  const result = parseTable(text, NOW)
  assert.equal(result.problem, null)
  assert.deepEqual(result.rows, [
    { line: 2, date: '2026-11-12', title: '我把 Agent 接进了日报', views: 12000, likes: 356, comments: 48, saves: 120 },
    { line: 3, date: '2026-11-10', title: '第二条', views: 3456, likes: 12 },
  ])
  assert.deepEqual(result.errors, [
    { line: 4, code: 'date', value: '合计' },
    { line: 5, code: 'number', header: '播放量', value: '很多' },
    { line: 6, code: 'empty' },
  ])
  assert.equal(parseTable('标题,播放\n一,1', NOW).problem, 'no-date')
  assert.equal(parseTable('日期,标题\n2026-11-12,一', NOW).problem, 'no-metric')
})

test('buildImportOps：标题完全一样且只对上一条时挂上去，否则不挂；只带表里有的数', () => {
  const items = [
    { id: 'i1', title: ' 我把 Agent 接进了日报 ' },
    { id: 'i2', title: '灵感原题', production: { title: '第二条' } },
    { id: 'i3', title: '重名' },
    { id: 'i4', title: '重名' },
  ]
  const rows = [
    { line: 2, date: '2026-11-12', title: '我把 Agent 接进了日报', views: 12000, likes: 356 },
    { line: 3, date: '2026-11-10', title: '第二条', views: 3456 },
    { line: 4, date: '2026-11-09', title: '重名', views: 1 },
    { line: 5, date: '2026-11-08', title: '', views: 2 },
  ]
  const { ops, attached } = buildImportOps(rows, { platform: 'B站', items })
  assert.equal(attached, 2)
  assert.deepEqual(ops.map(op => op.itemId), ['i1', 'i2', null, null])
  assert.deepEqual(ops[0], { op: 'add_metric', replace: true, platform: 'B站', itemId: 'i1', title: '我把 Agent 接进了日报', date: new Date('2026-11-12T12:00:00').toISOString(), views: 12000, likes: 356 })
  assert.equal('title' in ops[3], false)
})

test('parseRatio：完播率写成 35%、0.35、35 都是 0.35；超过 100% 和看不懂的不收', () => {
  assert.equal(parseRatio('35%'), 0.35)
  assert.equal(parseRatio('0.35'), 0.35)
  assert.equal(parseRatio('35.2'), 0.352)
  assert.equal(parseRatio('1'), 1)
  assert.equal(parseRatio(''), null)
  assert.equal(parseRatio('-'), null)
  assert.ok(Number.isNaN(parseRatio('150%')))
  assert.ok(Number.isNaN(parseRatio('高')))
})

test('新字段导入：曝光、完播率、涨粉、制作时长照表导入；表里没有的列不出现，更不会是 0', () => {
  const text = ['日期\t标题\t曝光\t播放\t完播率\t涨粉\t制作时长', '2026-11-12\t一\t1.2万\t800\t35%\t12\t90', '2026-11-11\t二\t\t300\t0.2\t\t'].join('\n')
  const { rows, errors } = parseTable(text, NOW)
  assert.deepEqual(errors, [])
  assert.deepEqual(rows, [
    { line: 2, date: '2026-11-12', title: '一', impressions: 12000, views: 800, completion: 0.35, newFollowers: 12, minutes: 90 },
    { line: 3, date: '2026-11-11', title: '二', views: 300, completion: 0.2 },
  ])
  const { ops } = buildImportOps(rows, { platform: '抖音', items: [] })
  for (const key of ['likes', 'comments', 'shares', 'saves']) assert.equal(key in ops[0], false, key)
  assert.equal('impressions' in ops[1], false)
  assert.equal(ops[0].completion, 0.35)
  const bad = parseTable('日期,完播率\n2026-11-12,120%', NOW)
  assert.deepEqual(bad.errors, [{ line: 2, code: 'number', header: '完播率', value: '120%' }])
})

test('公众号表头：「在看」单独记成 recommends（不并进点赞），「留言」认成评论；互动里算上在看', async () => {
  const text = '发表时间\t标题\t阅读次数\t点赞\t在看\t留言\t分享\n2026-11-10\t一篇文章\t1,234\t20\t7\t3\t15'
  const parsed = parseTable(text, NOW)
  assert.deepEqual(parsed.fields, { date: 0, title: 1, views: 2, likes: 3, recommends: 4, comments: 5, shares: 6 })
  assert.deepEqual(parsed.rows[0], { line: 2, date: '2026-11-10', title: '一篇文章', views: 1234, likes: 20, recommends: 7, comments: 3, shares: 15 })
  const { ops: [op] } = buildImportOps(parsed.rows, { platform: '公众号', items: [] })
  assert.equal(op.recommends, 7)
  const { applyOps } = await import('../src/ops.js')
  const { computeInsights } = await import('../src/learn.js')
  const state = { items: [], metrics: [], accounts: [], skills: [] }
  applyOps(state, [op])
  assert.equal(state.metrics[0].recommends, 7)
  assert.equal(state.metrics[0].likes, 20)
  // 互动 = 赞 20 + 评 3 + 转 15 + 在看 7
  assert.equal(computeInsights(state).engaged, 45)
  // 只有在看这一列也能导入
  assert.equal(parseTable('日期,在看\n2026-11-10,5', NOW).rows[0].recommends, 5)
})

test('表里有「链接」列：从地址里取作品 ID 一起导入；列本身不算数据，取不到就是没有', () => {
  const { fields } = detectColumns(['发布日期', '标题', '作品链接', '播放量'])
  assert.deepEqual([fields.date, fields.title, fields.link, fields.views], [0, 1, 2, 3])
  for (const header of ['链接', '网址', '地址', 'URL', 'Link', '笔记链接', '视频地址']) assert.equal(detectColumns(['日期', header]).fields.link, 1, header)
  // 带「链接」但不是链接列的（简介链接、链接数）不认
  assert.equal(detectColumns(['日期', '简介链接数']).fields.link, undefined)
  const text = [
    '日期\t标题\t链接\t播放量',
    '2026-11-12\t一\t"https://www.bilibili.com/video/BV1GJ411x7h7/?spm=1"\t1200',
    '2026-11-11\t二\tBV1GJ411x7h8\t900',
    '2026-11-10\t三\t-\t800',
  ].join('\n')
  const { rows, errors } = parseTable(text, NOW)
  assert.deepEqual(errors, [])
  assert.deepEqual(rows.map(row => [row.title, row.workId, row.views]), [['一', 'BV1GJ411x7h7', 1200], ['二', 'BV1GJ411x7h8', 900], ['三', undefined, 800]])
  const { ops } = buildImportOps(rows, { platform: 'B站', items: [] })
  assert.deepEqual([ops[0].workId, ops[1].workId, 'workId' in ops[2]], ['BV1GJ411x7h7', 'BV1GJ411x7h8', false])
  // 链接和别的列一样：表里没有就不带
  assert.equal('link' in parseTable('日期,播放\n2026-11-12,1', NOW).fields, false)
})
