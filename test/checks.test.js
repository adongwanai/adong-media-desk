import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkDraft, countFindings } from '../client/checks.js'

const FILL = '这是一段正常的正文内容，讲清楚一件具体的事情。'
const long = n => FILL.repeat(Math.ceil(n / FILL.length)).slice(0, n)
const TAGS = ['AI', '工具', '效率', '写作', '标题']
/** 一份在小红书上什么都不会被标的稿子，用来叠加单条规则。 */
const clean = (extra = '', platform = '小红书') => ({ title: '一个普通的标题', body: `${extra}${long(880)}`, tags: platform === '小红书' ? TAGS : [] })
const rules = (draft, platform = '小红书', style = null) => checkDraft(draft, platform, style).map(row => row.rule)
const find = (draft, rule, platform = '小红书', style = null) => checkDraft(draft, platform, style).find(row => row.rule === rule)

test('干净的稿子没有任何发现', () => {
  // 只剩参考项（info）：同一句重复几十遍，句长完全一样，句长变异系数是 0；参考不算问题
  const findings = checkDraft(clean(), '小红书')
  assert.deepEqual(findings.filter(row => row.level !== 'info'), [])
  assert.deepEqual(findings.map(row => row.rule), ['sentence-cv'])
  assert.deepEqual(countFindings([]), { block: 0, warn: 0 })
})

test('手机号、座机和 400 电话', () => {
  for (const text of ['电话 13812345678。', '打 138-1234-5678。', '+86 13912345678。', '座机 010-12345678。', '热线 400-123-4567。']) {
    const hit = find(clean(text), 'phone')
    assert.equal(hit?.level, 'block', text)
    assert.ok(hit.excerpt.length > 0)
  }
  for (const text of ['订单号 213812345678901。', '版本 1.38.12。', '一共 12345 字。']) assert.ok(!rules(clean(text)).includes('phone'), text)
})

test('微信号和 QQ 号', () => {
  for (const text of ['加微信：creator_2026。', 'vx: abc12345。', 'QQ 123456789。', 'qq群：87654321。']) assert.equal(find(clean(text), 'wechat')?.level, 'block', text)
  for (const text of ['微信公众号的排版。', '用 QQ 音乐听歌。', 'vxlan 网络。']) assert.ok(!rules(clean(text)).includes('wechat'), text)
})

test('邮箱', () => {
  assert.equal(find(clean('写信到 me@example.com 吧。'), 'email')?.level, 'block')
  assert.ok(!rules(clean('在 @某某 的评论里。')).includes('email'))
})

test('链接：小红书、抖音、视频号一律拦，公众号提醒点不开，知乎和 X 不管', () => {
  const draft = text => ({ title: '标题', body: `${text}${long(900)}`, tags: [] })
  for (const platform of ['小红书', '抖音', '视频号']) assert.equal(find(draft('看 https://github.com/a/b 这里。'), 'link', platform)?.level, 'block', platform)
  assert.equal(find(draft('地址 github.com/a/b 。'), 'link', '小红书')?.level, 'block')
  assert.equal(find(draft('地址 www.example.cn 。'), 'link', '公众号')?.level, 'warn')
  for (const platform of ['知乎', 'X', 'B站']) assert.equal(find(draft('看 https://example.com 。'), 'link', platform), undefined, platform)
  assert.ok(!rules(clean('用 Node.js 写的，版本 v1.2。')).includes('link'))
})

test('导流说法：限链接的平台拦，其他平台提醒', () => {
  assert.equal(find(clean('想要资料的私信领取。'), 'lead')?.level, 'block')
  assert.equal(find(clean('扫码进群一起聊。'), 'lead')?.level, 'block')
  assert.equal(find({ title: 't', body: '评论区领取模板。', tags: [] }, 'lead', '知乎')?.level, 'warn')
  assert.equal(find(clean('长按识别下方二维码。'), 'lead')?.level, 'block')
  assert.ok(!rules(clean('这条码的含义我后面再讲。')).includes('lead'))
  // 登录时扫码不是导流
  assert.ok(!rules(clean('登录态保留，不用每次重新扫码。')).includes('lead'))
  assert.ok(!rules(clean('打开登录二维码就行。')).includes('lead'))
})

test('绝对化用词，标题里也查', () => {
  assert.equal(find(clean('这是全网最强的方法。'), 'absolute')?.level, 'warn')
  const inTitle = find({ ...clean(), title: '必看的一个方法' }, 'absolute')
  assert.equal(inTitle?.excerpt, '必看的一个方法')
  assert.ok(!rules(clean('我第一次用的时候卡住了。最后还是跑通了。')).includes('absolute'))
})

test('医疗功效和收益承诺', () => {
  for (const text of ['这个方法能根治失眠。', '一个月减肥 10 斤。', '喝了能降血糖。']) assert.equal(find(clean(text), 'medical')?.level, 'block', text)
  assert.ok(!rules(clean('看了一部治愈系电影。')).includes('medical'))
  for (const text of ['这个策略稳赚不赔。', '轻松月入 3 万。', '年化 20% 的收益。', '保本还能翻倍。']) assert.equal(find(clean(text), 'finance')?.level, 'block', text)
  assert.ok(!rules(clean('这次投入了三周时间。')).includes('finance'))
})

test('没替换的占位符', () => {
  for (const text of ['TODO 补一个例子。', '这里写 XXX 的名字。', '【待补】数据。', '你好 {name}。', '你好 {{user}}。', '此处插入截图。']) assert.equal(find(clean(text), 'placeholder')?.level, 'block', text)
  for (const text of ['配置是 {"a": 1} 这样。', '函数 f(x) 的值。', 'todos 列表。']) assert.ok(!rules(clean(text)).includes('placeholder'), text)
})

test('Obsidian 的高亮和双链', () => {
  assert.equal(find(clean('这是==重点==内容。'), 'obsidian')?.level, 'warn')
  assert.equal(find(clean('参考 [[另一篇笔记]]。'), 'obsidian')?.level, 'warn')
  assert.ok(!rules(clean('a == b 的时候。')).includes('obsidian'))
})

test('标题、正文、标签的长度和数量按平台查', () => {
  // 小红书标题：中文 21 个超了，英文算半个
  assert.equal(find({ ...clean(), title: '一'.repeat(21) }, 'title-length')?.level, 'block')
  assert.ok(!rules({ ...clean(), title: `${'一'.repeat(16)}ABCDEFGH` }).includes('title-length'))
  assert.equal(find({ ...clean(), title: '' }, 'title-empty')?.level, 'warn')
  assert.match(find({ ...clean(), body: long(500) }, 'body-length').message, /至少 800/)
  assert.match(find({ ...clean(), body: long(1200) }, 'body-length').message, /超出/)
  assert.equal(find({ ...clean(), tags: ['一'] }, 'tag-count')?.level, 'warn')
  assert.equal(find({ ...clean(), tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }, 'tag-count')?.level, 'warn')
  // Instagram 的说明栏是硬上限
  assert.equal(find({ title: '', body: 'a'.repeat(2300), tags: TAGS.concat(['b']) }, 'body-length', 'Instagram')?.level, 'block')
  assert.equal(find({ title: '标题', body: long(900), tags: ['a'] }, 'tag-count', '公众号')?.message, '公众号不用标签')
})

test('X：每条不超过 280（中文算 2），串 3 到 7 条，最后一条以问题结尾', () => {
  assert.equal(find({ body: '一'.repeat(141) }, 'post-length', 'X')?.level, 'block')
  assert.deepEqual(rules({ body: '一'.repeat(140) }, 'X'), [])
  const thread = posts => ({ body: posts.join('\n\n---\n\n') })
  assert.deepEqual(rules(thread(['第一条', '第二条', '第三条，你怎么看？']), 'X'), [])
  assert.ok(rules(thread(['第一条', '第二条', '第三条。']), 'X').includes('thread-question'))
  assert.ok(rules(thread(['第一条', '第二条？']), 'X').includes('thread-count'))
  assert.match(find(thread(['短', '一'.repeat(200), '问？']), 'post-length', 'X').message, /第 2 条/)
})

test('文风：风格里不要的词、不是…而是、首先其次最后、破折号、加粗', () => {
  const style = { avoid: ['颠覆', '把计划写成结果'] }
  assert.match(find(clean('这次真的颠覆了。'), 'style-avoid', '小红书', style).message, /颠覆/)
  assert.equal(find(clean('这次真的颠覆了。'), 'style-avoid'), undefined)
  assert.equal(find(clean('这不是工具问题，而是流程问题。'), 'not-but'), undefined)
  assert.equal(checkDraft(clean('这不是工具问题，而是流程问题。那也不是钱的事，而是时间的事。'), '小红书').filter(row => row.rule === 'not-but').length, 2)
  assert.ok(rules(clean('首先打开。其次登录。最后发布。')).includes('sequence'))
  assert.ok(!rules(clean('首先打开。最后发布。')).includes('sequence'))
  assert.ok(rules(clean('a——b——c——d——e。')).includes('dash'))
  assert.ok(!rules(clean('a——b——c。')).includes('dash'))
  assert.ok(rules(clean(Array.from({ length: 9 }, (_, i) => `**重点${i}**`).join('，'))).includes('bold'))
  assert.ok(!rules(clean('**一个重点**。')).includes('bold'))
})

test('第一人称经历只提醒作者确认，不替作者判断', () => {
  for (const text of ['我试了一下，确实快。', '亲测有效。', '用了 3 个月之后。', '用了两周。', '我花了一晚上。']) {
    const hit = find(clean(text), 'experience')
    assert.equal(hit?.level, 'warn', text)
    assert.match(hit.message, /请确认这是你真实做过的/)
  }
  assert.ok(!rules(clean('我还没试过，打算下周验证。')).includes('experience'))
})

test('硬伤排在前面；同一句不重复报；恶意内容只当文字摘出来', () => {
  const findings = checkDraft(clean('全网最强。电话 13812345678。'), '小红书')
  assert.equal(findings[0].level, 'block')
  assert.deepEqual(countFindings(findings), { block: 1, warn: 1 })
  const hostile = checkDraft({ title: '<img src=x onerror=alert(1)>', body: '<script>alert("TODO")</script>', tags: [] }, '知乎')
  const placeholder = hostile.find(row => row.rule === 'placeholder')
  assert.equal(typeof placeholder.excerpt, 'string')
  assert.ok(placeholder.excerpt.includes('<script>'))
  // 奇怪的输入不会让检查崩掉
  assert.ok(Array.isArray(checkDraft(null, '微博')))
  assert.ok(Array.isArray(checkDraft({ title: 1, body: {}, tags: 'x' }, undefined, { avoid: 'x' })))
})
