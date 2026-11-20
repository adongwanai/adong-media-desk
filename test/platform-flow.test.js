import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyOps, PLATFORMS } from '../src/ops.js'
import { Store } from '../src/store.js'
import { buildSeed, migrateState } from '../src/seed.js'
import { DEFAULT_STYLE_ID, seedPresets } from '../src/style-presets.js'
import { styleToVoice } from '../src/style.js'
import { cleanPlatformRules, effectiveSpec, specBriefFor } from '../src/platform-rules.js'
import { classifyHowI, howIBlock } from '../src/howi.js'
import { CARD_SIMILAR_LIMIT, selfCheck, splitCards } from '../src/selfcheck.js'
import { findMaterials } from '../src/materials.js'
import { diffSummary, normalizeVersion, revisionProblem, versionPrompts, Versioner } from '../src/versions.js'
import { insertImage, Illustrator, normalizeProposals, sectionsOf } from '../src/illustrate.js'
import { checkDraft } from '../client/checks.js'

function customStyle() {
  return { id: 'custom-test', name: '测试自定义规则', platforms: {
    小红书: { rules: '【定位】测试文风规则：概括主题，再解释依据。', review: ['检查事实来自素材'], banned: ['说白了'], boldMin: 3, boldMax: 8, highlightMin: 1, highlightMax: 3, adviceMax: 3 },
    X: { lang: 'en', rules: 'Testing custom rules in English.', review: ['Check references'], banned: ['leverage'], adviceMax: 3 },
  } }
}

const NOW = new Date('2026-11-13T10:00:00+08:00')
const reply = obj => ({ text: JSON.stringify(obj), model: 'fake' })
const STUDIED = '## 发生了什么\n\n我读完了 Anthropic 的原文，他们把 review 交给机器，人工评论从 16% 涨到 54%。\n\n## 我的判断\n\n先把回滚做好，再谈放权。我还没试过这套流程，打算下周在 3 个仓库验证。'
const DID = '## 过程\n\n我用 Claude Code 跑了两周，一天 3 篇，API 费用 2000 元。\n\n## 结果\n\n质量波动大，每篇还要改 15 分钟。'

// 一组合规的小红书（按通用平台规则：正文 200–300、图片版 8 页合计 800–1100、页标题 10–16、加粗 3–8、高亮 1–3）
const PAIR = {"body": "**先把回滚做好再谈放权**，这是我读完原文最想提醒团队的事。人工评论从 16% 涨到 54%，让我注意到：==机器先筛问题，人的判断仍然重要==。\n\n**第二个判断**：按风险分级，比要求每行都有人看更有用。文档改动和计费逻辑不该排同一条队，否则真正危险的变化会被琐碎意见淹没。\n\n如果准备引入自动审查，我会先看失败后能否快速退回，再看哪些改动可以放行。这个顺序会直接影响团队敢不敢用。\n\n**我还没在自己的仓库里试过**，打算先挑小仓库验证，记录误报和漏报，再决定开放范围。你们会把哪类改动留给人审？", "cards": "## 先回滚再放权\n\n读完原文，最想说的就这一句：机器可以审代码，但前提是你能随时退回来。\n\n## 人工评论反而翻了三倍多\n\n有实质评论的合并请求，从 16% 涨到 54%。\n\n机器先把明显的问题挑出来，人工评论反而更有内容了，不再是“这里少个空格”这种话。人的注意力终于花在了值得花的地方，这是我读到最意外的一点。\n\n这一页讲的是人和机器各自该看什么，分工清楚之后谁都不累。\n\n## 机器先审一遍再交给人\n\n提交之前，模型自己跑测试、构建和检查，再换一个新上下文的审查者看一遍改动。\n\n**人看到的已经是改过一轮的版本**，省下的是来回沟通的时间。我观察到这一步最容易被跳过，因为它看起来像重复劳动。\n\n把自检放在提交之前，后面每个环节的压力都会小很多。\n\n## 风险分级决定几个人来看\n\n低风险不用人看，中风险一个人，高风险两个人，由分类器判断。\n\n等级跟着改动走，不跟着作者走；机器的批准不能顶替人的名额。驱动模型干活的那个人，本身就算一个必需的审查者，出了事要有人负责。\n\n分级的好处是把有限的人力集中到真正会出事的地方。\n\n## 回滚其实比审查更加重要\n\n合并队列、功能开关、先内部再灰度，出问题一键退回。\n\n==审得再严也会有漏网的==，真正让人敢放手的，是犯错之后能多快退回来。没有开关和回滚，低风险自动合并就是在赌运气，这一条我会排在所有改动前面。\n\n回滚链路平时看不出价值，出事那天才知道它值多少。\n\n## 每次事故都变成每天的评测\n\n每次出事都整理成评测集：出事的改动、修复和回滚放在一起，审查器每天对着它跑一遍。\n\n这样审查器自己也在变好，而不是靠人记住上次踩过的坑。审查轮数也要设上限，免得机器之间无限互审，越审越乱。\n\n评测集越攒越厚，审查器的判断就越来越接近老同事。\n\n## 审查轮数一定要设上限\n\n机器之间互相审，很容易一轮接一轮停不下来，同一段老代码被反复标记。\n\n定几条规矩：轮数有上限、只审新增的改动、同类问题一次改完、意见不重复提。\n\n这条规矩看着琐碎，却是让整套流程能收敛的关键，没有它前面的分级和回滚都会被拖垮。\n\n## 你们敢让它直接合并吗\n\n我的判断是：**先把回滚做好，再谈放权**。\n\n这套流程我还没在自己的仓库里跑过，打算先挑三个小仓库验证，看回滚率会不会涨。你们团队现在会怎么选？\n\n欢迎在评论区聊聊你们的做法，尤其是回滚怎么做的，我会挑几个认真回复。"}
function goodPair(signature = '') {
  const sign = text => (signature ? `${text}\n\n${signature}` : text)
  return { title: '他们不逐行看代码了', body: sign(PAIR.body), cards: sign(PAIR.cards), tags: ['AI编程', 'CodeReview', '大模型', 'Agent', '程序员'], firstComment: '' }
}

test('风格卡：platforms 只留认识的平台和键，数字取整限范围，文字截断；导入导出走同一套', () => {
  const raw = {
    小红书: { rules: '规'.repeat(7000), bodyMin: '300.6', bodyMax: 450, cardsMin: -3, evil: 1, banned: ['说白了', '说白了', 3, ''], checks: ['cards-count', 'post-length', 'nope'], review: ['一条', ''], lang: 'xx' },
    X: { postMax: 280, lang: 'en', cardsMin: 6 },
    微博: { rules: 'x' },
    __proto__: { polluted: true },
  }
  const out = cleanPlatformRules(raw, PLATFORMS)
  assert.deepEqual(Object.keys(out).sort(), ['X', '小红书'])
  assert.equal(out.小红书.rules.length, 6000)
  assert.equal(out.小红书.bodyMin, 301)
  assert.equal(out.小红书.cardsMin, 0)
  assert.equal(out.小红书.evil, undefined)
  assert.deepEqual(out.小红书.banned, ['说白了'])
  assert.deepEqual(out.小红书.checks, ['cards-count'])
  assert.equal(out.小红书.lang, undefined)
  assert.deepEqual(out.X, { postMax: 280, lang: 'en' })
  assert.equal(cleanPlatformRules('x', PLATFORMS), undefined)
  // 走 ops：add_style / update_style 都清洗；导出再导入原样回来
  const state = { styles: [] }
  applyOps(state, [{ op: 'add_style', name: '我的', platforms: raw, visual: '蓝色'.repeat(4000) }])
  const style = state.styles[0]
  assert.deepEqual(style.platforms, out)
  assert.equal(style.visual.length, 6000)
  const exported = JSON.parse(JSON.stringify({ name: style.name, platforms: style.platforms, visual: style.visual }))
  applyOps(state, [{ op: 'add_style', ...exported }])
  assert.deepEqual(state.styles[0].platforms, out)
  applyOps(state, [{ op: 'update_style', id: style.id, platforms: { 公众号: { boldMin: 5 } } }])
  assert.deepEqual(state.styles.find(row => row.id === style.id).platforms, { 公众号: { boldMin: 5 } })
  // 导出成文件时把各平台写法也写进去
  assert.match(styleToVoice({ name: 'a', platforms: { 小红书: { rules: '首页只让人停下来', review: ['像发微信'] } }, visual: '深青' }, { platforms: true }), /小红书的写法：\n首页只让人停下来[\s\S]*像发微信[\s\S]*配图：深青/)
  assert.doesNotMatch(styleToVoice({ name: 'a', platforms: { 小红书: { rules: '首页只让人停下来' } } }), /首页/)
})

test('通用预设不带个人身份、平台文风和品牌配色', () => {
  const general = seedPresets('zh').find(row => row.id === DEFAULT_STYLE_ID)
  assert.equal(general.name, '清晰实用')
  assert.equal(general.platforms, undefined)
  assert.equal(general.visual, undefined)
  assert.equal(seedPresets('en').find(row => row.id === DEFAULT_STYLE_ID).name, 'Clear and practical')
  assert.ok(!seedPresets('zh').some(row => row.id === 'preset_adong'))
})

test('effectiveSpec：风格卡里的数叠在平台规矩上，没定的用默认；提示词里写清楚', () => {
  const style = { platforms: { 小红书: { bodyMin: 280, cardsMax: 8, cardsTotalMin: 900, boldMin: 3, highlightMax: 3, adviceMax: 3 }, X: { lang: 'en', threadMax: 5 } } }
  const xhs = effectiveSpec('小红书', style)
  assert.deepEqual([xhs.body.min, xhs.body.max, xhs.cards.min, xhs.cards.max, xhs.cards.total.min, xhs.cards.total.max], [280, 300, 1, 8, 900, 1100])
  assert.deepEqual(xhs.budgets, { boldMin: 3, highlightMax: 3, adviceMax: 3 })
  assert.deepEqual(effectiveSpec('小红书', null).budgets, {})
  const brief = specBriefFor('小红书', style)
  assert.match(brief, /图片版：1 到 8 节/)
  assert.match(brief, /合计 900 到 1100/)
  assert.match(brief, /加粗（\*\*…\*\*）：3 到/)
  assert.match(specBriefFor('X', style), /用英文写/)
  assert.equal(effectiveSpec('X', style).post.threadMax, 5)
  // 不改共享的平台规矩
  assert.equal(effectiveSpec('小红书', null).body.min, 200)
})

test('How I：做过 / 只研究过 / 都看不出来；「还没试过」「打算」不算做过', () => {
  const did = classifyHowI({ production: { article: DID } })
  assert.equal(did.level, 'did')
  assert.ok(did.evidence[0].includes('跑了两周'))
  const studied = classifyHowI({ production: { article: STUDIED } })
  assert.equal(studied.level, 'studied')
  assert.equal(studied.voice, '我观察到')
  assert.ok(studied.evidence[0].includes('读完了'))
  const none = classifyHowI({ production: { article: '## 新闻\n\n某公司发布了一个模型，参数 70B。我打算下周试一下。' } })
  assert.equal(none.level, 'none')
  assert.match(none.note, /补上真实经历/)
  assert.match(howIBlock(studied), /不能写「我试了」/)
  assert.match(howIBlock(none), /不写任何第一人称经历/)
  assert.match(howIBlock(did), /只能讲 <draft> 里写到的那些经历/)
})

test('自检：合规的小红书一对全部通过；页数、每页字数、合计、页标题、占位图、正文格式各自查得出来', () => {
  const style = customStyle()
  const production = { title: 'x', article: STUDIED }
  const howI = classifyHowI({ production })
  const good = goodPair('小明，工程师。')
  const checks = selfCheck(good, '小红书', { style, production, howI, signature: '小明，工程师。' })
  const bad = checks.filter(row => !row.ok)
  assert.deepEqual(bad.map(row => `${row.id}:${row.detail}`), [])
  const pages = splitCards(good.cards)
  assert.equal(pages.length, 8)
  assert.ok(pages[0].cover)

  const failing = id => selfCheck(id, '小红书', { style, production, howI }).filter(row => !row.ok).map(row => row.id)
  // 页数太少、页太满
  assert.ok(failing({ ...good, cards: '' }).includes('cards-count'))
  assert.ok(failing({ ...good, cards: good.cards.replace('这一页讲的是', `${'很长的一页'.repeat(80)}这一页讲的是`) }).includes('card-chars'))
  // 页标题太长
  assert.ok(failing({ ...good, cards: good.cards.replace('人工评论反而翻了三倍多', '这是一个非常非常非常非常长的页标题超过十六个字') }).includes('card-title'))
  // 占位图、一页两张图
  assert.ok(failing({ ...good, cards: good.cards.replace('分级的好处', '此处放截图\n\n分级的好处') }).includes('card-images'))
  assert.ok(failing({ ...good, cards: good.cards.replace('分级的好处', '![a](media-desk/files/a.png)\n\n![b](media-desk/files/b.png)\n\n分级的好处') }).includes('card-images'))
  // 正文里有分页标题或标签行
  assert.ok(failing({ ...good, body: `## 标题\n\n${good.body}` }).includes('caption-format'))
  assert.ok(failing({ ...good, body: `${good.body}\n\n#AI #大模型` }).includes('caption-format'))
  // 正文太长、标签太少、禁用词、没做过写成做过、母稿里没有的数字
  assert.ok(failing({ ...good, body: good.body.repeat(3) }).includes('body-length'))
  assert.ok(failing({ ...good, tags: ['a'] }).includes('tags'))
  assert.ok(failing({ ...good, body: `说白了，${good.body}` }).includes('banned'))
  assert.ok(failing({ ...good, body: `我试了一下，${good.body}` }).includes('experience'))
  assert.ok(!selfCheck({ ...good, body: `我试了一下，${good.body}` }, '小红书', { style, production: { article: DID }, howI: classifyHowI({ production: { article: DID } }) }).some(row => row.id === 'experience' && !row.ok))
  assert.ok(failing({ ...good, cards: `${good.cards}\n\n涨到 99%` }).includes('numbers'))
  // 「你应该」超过 3 次；加粗不够；高亮太多
  assert.ok(failing({ ...good, body: `${good.body}你应该。你应该。建议你。你要。` }).includes('advice'))
  assert.ok(failing({ ...good, body: good.body.replace(/\*\*/g, ''), cards: good.cards.replace(/\*\*/g, '') }).includes('bold'))
  assert.ok(failing({ ...good, body: `${good.body}==a== ==b== ==c==` }).includes('highlight'))
})

test('自检：正文和图片版太像（从图片版里剪出来）会被查出来；和母稿太像也会', () => {
  const style = customStyle()
  const good = goodPair()
  const cut = splitCards(good.cards).slice(1, 4).map(page => page.text).join('\n\n')
  const pair = { ...good, body: cut }
  const row = selfCheck(pair, '小红书', { style }).find(entry => entry.id === 'similar-cards')
  assert.equal(row.ok, false)
  assert.match(row.detail, /整句照搬 (\d+)%/)
  assert.ok(Number(/整句照搬 (\d+)%/.exec(row.detail)[1]) > 50)
  assert.match(row.fix, /正文重写/)
  assert.equal(selfCheck(good, '小红书', { style }).find(entry => entry.id === 'similar-cards').ok, true)
  const copy = selfCheck({ ...good, body: STUDIED }, '小红书', { style, production: { article: STUDIED } }).find(entry => entry.id === 'similar-mother')
  assert.equal(copy.ok, false)
})

test('自检：X 每条长度、串的条数、问题收尾；英文的 I built 也算写成做过；风格关掉的项不查', () => {
  const style = customStyle()
  const howI = { level: 'studied' }
  const thread = posts => ({ body: posts.join('\n\n---\n\n'), tags: [] })
  const ok = selfCheck(thread(['Hook line here.', 'Second point.', 'What would you do?']), 'X', { style, howI })
  assert.deepEqual(ok.filter(row => !row.ok).map(row => row.id), [])
  const bad = selfCheck(thread(['I built this in a week.', 'x'.repeat(300), 'Done.']), 'X', { style, howI }).filter(row => !row.ok).map(row => row.id)
  assert.ok(bad.includes('post-length') && bad.includes('question-end') && bad.includes('experience'))
  assert.ok(selfCheck(thread(['We leverage it.', 'b', 'c?']), 'X', { style }).some(row => row.id === 'banned' && !row.ok))
  const off = { platforms: { X: { checks: ['post-length'] } } }
  assert.deepEqual(selfCheck(thread(['a', 'b']), 'X', { style: off }).map(row => row.id), ['post-length'])
})

test('发布前检查：小红书新版本按正文 200–300 和图片版查，旧版本（没有 cards）还按一整篇 800–1100 查', () => {
  const style = customStyle()
  const good = goodPair()
  const findings = checkDraft({ ...good, markdown: good.body, body: good.body.replace(/\*\*|==/g, '') }, '小红书', style)
  assert.deepEqual(findings.filter(row => ['body-length', 'cards-count', 'card-chars', 'cards-total', 'bold', 'highlight'].includes(row.rule)), [])
  const legacy = { title: '旧版本', body: '旧版本的正文写了很多。'.repeat(80), tags: good.tags }
  const legacyFindings = checkDraft(legacy, '小红书', style)
  assert.ok(!legacyFindings.some(row => row.rule === 'body-length'), '900 字左右的旧版本不报长度')
  assert.ok(!legacyFindings.some(row => row.rule.startsWith('card')), '旧版本不查图片版')
  assert.ok(checkDraft({ ...good, cards: '## 首页\n\n一句' }, '小红书', style).some(row => row.rule === 'cards-total'))
})

function fixture(article, { signature = '' } = {}) {
  const state = buildSeed(NOW, 'zh')
  applyOps(state, [{ op: 'clear_samples' }, { op: 'add_item', title: 'Anthropic 不逐行看代码了', body: '' }])
  state.styles.push(customStyle())
  state.activeStyleId = 'custom-test'
  if (signature) state.author = { bio: '', signature }
  const id = state.items[0].id
  state.items[0].production = { status: 'done', title: '母稿', article, facts: [] }
  return { state, id, store: { read: async () => state, mutate: async (_label, fn) => fn(state) } }
}

async function settled(versioner, id) {
  for (let i = 0; i < 400 && versioner.isRunning(id); i += 1) await new Promise(r => setTimeout(r, 5))
}

test('Versioner：小红书交一对；自检没过的项只让模型定向改一次，改好的采用，flow 记下每一步', async () => {
  const { state, id, store } = fixture(STUDIED)
  const good = goodPair()
  const calls = []
  const callText = async ({ system, user }) => {
    calls.push({ system, user })
    // 第一稿：图片版只有 2 页、带了母稿里没有的数字；改过之后合规
    if (calls.length === 1) return reply({ ...good, cards: '## 首页\n\n一句\n\n## 第二页的标题够长了\n\n内容，涨到 99%。', titleOptions: ['A', 'B', 'C'] })
    return reply(good)
  }
  const versioner = new Versioner({ store, callText, settings: { read: async () => ({ voice: '', materialDir: '' }) }, materials: async () => ({ status: 'none', scanned: 0, picks: [] }) })
  await versioner.start(id, ['小红书'])
  await settled(versioner, id)
  const version = state.items[0].production.versions.小红书
  assert.equal(version.status, 'done', version.error)
  assert.equal(calls.length, 2)
  // 第一次的提示词：两段分工、How I 口吻、风格卡里的小红书写法和自检清单
  assert.match(calls[0].system, /小红书要交两段不同的文字/)
  assert.match(calls[0].system, /不能写「我试了」/)
  assert.match(calls[0].system, /<rules>【定位】/)
  assert.match(calls[0].system, /交稿前按这几条自己过一遍/)
  // 第二次只列没过的项
  assert.match(calls[1].system, /自检没过的只有这几项/)
  assert.match(calls[1].system, /图片版合计扩到 800 字以上/)
  assert.match(calls[1].system, /99/)
  assert.ok(calls[1].user.includes('<version>'))
  assert.equal(version.cards, good.cards)
  assert.deepEqual(version.titleOptions, ['A', 'B', 'C'])
  assert.ok(version.cardSimilarity <= CARD_SIMILAR_LIMIT)
  assert.equal(version.flow.howI.level, 'studied')
  assert.equal(version.flow.refs.materialStatus, 'none')
  assert.equal(version.flow.revision.accepted, true)
  assert.ok(version.flow.revision.fixed.includes('cards-total'))
  assert.ok(version.flow.revision.fixed.includes('numbers'))
  assert.ok(version.flow.checks.every(row => row.ok), JSON.stringify(version.flow.checks.filter(row => !row.ok)))
})

test('Versioner：定向修改加了新数字或写成做过就退回，原稿留着，没过的项如实给用户看', async () => {
  const { state, id, store } = fixture(STUDIED)
  const good = goodPair()
  let n = 0
  const callText = async () => {
    n += 1
    if (n === 1) return reply({ ...good, tags: ['只有一个'] })
    return reply({ ...good, body: `${good.body}\n\n我试了一下，效率提升了 300%。` })
  }
  const versioner = new Versioner({ store, callText, settings: { read: async () => ({}) }, materials: async () => ({ status: 'none', scanned: 0, picks: [] }) })
  await versioner.start(id, ['小红书'])
  await settled(versioner, id)
  const version = state.items[0].production.versions.小红书
  assert.equal(n, 2)
  assert.equal(version.flow.revision.accepted, false)
  assert.equal(version.flow.revision.reason, 'facts')
  assert.deepEqual(version.tags, ['只有一个'])
  assert.ok(version.flow.checks.some(row => row.id === 'tags' && !row.ok))
  assert.ok(!version.body.includes('300%'))
  // 守卫本身：多写做过、丢小标题、清空图片版
  const production = { article: STUDIED }
  assert.equal(revisionProblem({ body: '我观察到。', cards: '## a' }, { body: '我试了一下。', cards: '## a' }, { production, howI: { level: 'studied' } }), 'experience')
  assert.equal(revisionProblem({ body: 'x', cards: '## 甲\n\n## 乙' }, { body: 'x', cards: '## 甲' }, { production, problems: [{ id: 'banned' }] }), 'headings')
  assert.equal(revisionProblem({ body: 'x', cards: '## 甲\n\n## 乙' }, { body: 'x', cards: '## 甲' }, { production, problems: [{ id: 'cards-count' }] }), null)
  assert.equal(revisionProblem({ body: 'x', cards: '## 甲' }, { body: 'x', cards: '' }, { production }), 'empty')
})

test('Versioner：自检全过就不再调模型；X 按英文写、带 X 的写法；素材库的参考进了提示词和 flow', async () => {
  const { state, id, store } = fixture(DID)
  const calls = []
  const callText = async ({ system, user }) => {
    calls.push({ system, user })
    return reply({ title: '', body: 'I ran Claude Code for 2 weeks.\n\n---\n\nAPI cost: 2000.\n\n---\n\nWhat would you do?', tags: [] })
  }
  const materials = async (dir, query) => ({ status: 'ok', scanned: 4, picks: [{ name: 'a.md', path: '概念/a.md', title: 'Harness 是什么', excerpt: '概念摘录', score: 0.3 }], dir, query })
  const versioner = new Versioner({ store, callText, settings: { read: async () => ({ materialDir: '/x' }) }, materials })
  await versioner.start(id, ['X'])
  await settled(versioner, id)
  const version = state.items[0].production.versions.X
  assert.equal(calls.length, 1, JSON.stringify(version.flow?.checks?.filter(row => !row.ok)))
  assert.match(calls[0].system, /用英文写/)
  assert.match(calls[0].system, /Testing custom rules in English/)
  assert.match(calls[0].system, /<refs>.*Harness 是什么/s)
  assert.equal(version.flow.howI.level, 'did')
  assert.deepEqual(version.flow.refs.materials.map(row => row.path), ['概念/a.md'])
  assert.equal(version.flow.revision, null)
})

test('迁移：没有 cards 的旧小红书版本照常显示、能改；normalizeVersion 只在小红书留 cards', async () => {
  const old = { title: '旧标题', body: '旧正文', tags: ['a'], status: 'done', similarity: 0.2 }
  const { state, id, store } = fixture(STUDIED)
  state.items[0].production.versions = { 小红书: old }
  const { updateVersion } = await import('../src/versions.js')
  const result = await updateVersion({ mutate: async (_label, fn) => fn(state) }, { id, platform: '小红书', cards: '## 首页\n\n一句' })
  assert.deepEqual(result.errors, [])
  assert.equal(state.items[0].production.versions.小红书.cards, '## 首页\n\n一句')
  assert.equal(state.items[0].production.versions.小红书.body, '旧正文')
  // 别的平台不收 cards
  state.items[0].production.versions.知乎 = { ...old }
  await updateVersion({ mutate: async (_label, fn) => fn(state) }, { id, platform: '知乎', cards: '## x' })
  assert.equal(state.items[0].production.versions.知乎.cards, undefined)
  assert.equal(normalizeVersion({ body: 'x', cards: '## a' }, '知乎').cards, undefined)
  assert.equal(normalizeVersion({ body: 'x', cards: '## a', titleOptions: ['一', '一', 2, '二'] }, '小红书').cards, '## a')
  assert.deepEqual(normalizeVersion({ body: 'x', titleOptions: ['一', '一', 2, '二'] }, '小红书').titleOptions, ['一', '二'])
  assert.ok(store)
})

test('versionPrompts：没有平台写法的风格也走同一套流程（两段分工、How I），只是没有 <rules>', () => {
  const state = buildSeed(NOW, 'zh')
  state.activeStyleId = 'preset_travel'
  const item = { id: 'a', title: 't', production: { title: 't', article: STUDIED } }
  const { system } = versionPrompts(state, item, '小红书')
  assert.match(system, /小红书要交两段不同的文字/)
  assert.match(system, /口吻：用「我观察到/)
  assert.doesNotMatch(system, /<rules>/)
})

test('公众号整理：diffSummary 说清改了什么', () => {
  const before = '开头一句。\n\n## 一\n\n第一段内容，讲清楚一件事。\n\n结尾。'
  const after = '开头换了一句，更具体。\n\n## 一节\n\n第一段内容，**讲清楚一件事**。\n\n==结尾==。'
  const diff = diffSummary(before, after)
  assert.equal(diff.opening, true)
  // 结尾只加了高亮，字没变，不算改了结尾
  assert.equal(diff.ending, false)
  assert.deepEqual(diff.headings, { added: ['一节'], removed: ['一'] })
  assert.deepEqual(diff.bold, [0, 1])
  assert.deepEqual(diff.highlight, [0, 1])
  assert.ok(diff.samples.length >= 1)
})

test('Versioner：公众号按规范整理是一个真正的版本；整理稿加了数字就不采用，还是沿用母稿', async () => {
  const article = `开头。\n\n## 一\n\n${'这是母稿的一段内容，讲了一个判断和理由。'.repeat(30)}\n\n## 二\n\n${'第二段，讲适用条件和代价。'.repeat(30)}`
  const run = async (body) => {
    const { state, id, store } = fixture(article)
    const versioner = new Versioner({ store, callText: async () => reply({ title: '整理后的标题', body }), settings: { read: async () => ({}) }, materials: async () => ({ status: 'none', scanned: 0, picks: [] }) })
    await versioner.start(id, ['公众号'])
    assert.equal(state.items[0].production.versions.公众号.carried, true)
    await versioner.formatWechat(id)
    await settled(versioner, id)
    return state.items[0].production.versions.公众号
  }
  const good = await run(article.replace('开头。', '我先说结论：**开头换了**。').replace('## 二', '## 第二节'))
  assert.equal(good.status, 'done')
  assert.equal(good.formatted, true)
  assert.equal(good.carried, false)
  assert.equal(good.title, '整理后的标题')
  assert.equal(good.changes.opening, true)
  assert.deepEqual(good.changes.headings.added, ['第二节'])
  assert.ok(good.flow.checks.length)
  const bad = await run(`${article}\n\n提升了 87%。`)
  assert.equal(bad.status, 'done')
  assert.equal(bad.carried, true)
  assert.match(bad.error, /数字/)
})

test('素材库：只读主目录下的文件夹，链接绕不出去，按相关程度挑；没配就跳过', async () => {
  const home = await mkdtemp(join(tmpdir(), 'md-home-'))
  const outside = await mkdtemp(join(tmpdir(), 'md-out-'))
  try {
    const lib = join(home, '素材库')
    await mkdir(join(lib, '核心概念库'), { recursive: true })
    await writeFile(join(lib, '核心概念库', 'harness.md'), '---\ntitle: Harness Engineering\n---\n\nAgent 的 Harness 工程：工具、记忆、评测和回滚，Claude Code 的 review 流程。')
    await writeFile(join(lib, '篮球.md'), '# 周末打球\n\n投篮手感不错。')
    await writeFile(join(outside, 'secret.md'), 'Agent Harness Claude Code review 回滚 评测 机密')
    await symlink(join(outside, 'secret.md'), join(lib, 'link.md'))
    await symlink(outside, join(lib, '外面'))
    assert.deepEqual(await findMaterials('', 'x', { home }), { status: 'none', scanned: 0, picks: [] })
    const found = await findMaterials(lib, 'Claude Code 的 review 流程和 Agent Harness 回滚', { home })
    assert.equal(found.status, 'ok')
    assert.deepEqual(found.picks.map(row => row.title), ['Harness Engineering'])
    assert.equal(found.picks[0].path, join('核心概念库', 'harness.md'))
    assert.ok(!JSON.stringify(found).includes('机密'))
    const denied = await findMaterials(outside, 'Agent', { home })
    assert.equal(denied.status, 'error')
    assert.match(denied.error, /主目录/)
    assert.equal((await findMaterials('相对/路径', 'Agent', { home })).status, 'error')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('配图：按页提议，只留存在的页；插图放在那一页第一段后面，一页最多一张；没接生图不调模型', async () => {
  const cards = '## 首页\n\n一句\n\n## 机制\n\n先给结论。\n\n再补解释。\n\n## 结尾\n\n问题？'
  const sections = sectionsOf(cards)
  assert.deepEqual(sections.map(row => row.heading), ['首页', '机制', '结尾'])
  const proposals = normalizeProposals({ pages: [{ page: 1, need: true, kind: '流程', prompt: 'boxes and arrows' }, { page: 9, need: true, prompt: 'x' }, { page: 2, need: true, kind: '怪', prompt: '' }] }, sections)
  assert.deepEqual(proposals.map(row => [row.page, row.need, row.kind]), [[1, true, '流程'], [2, false, '示意']])
  const once = insertImage(cards, '小红书', 1, 'media-desk/files/a.png', '机制')
  assert.match(once, /## 机制\n\n先给结论。\n\n!\[机制\]\(media-desk\/files\/a.png\)\n\n再补解释。/)
  const twice = insertImage(once, '小红书', 1, 'media-desk/files/b.png', '机制')
  assert.equal((twice.match(/!\[/g) ?? []).length, 1)
  assert.match(twice, /b\.png/)
  assert.equal(splitCards(twice).find(page => page.heading === '机制').images, 1)
  // 公众号：开头那段也是一节
  const wechat = insertImage('开头一段。\n\n## 一\n\n内容。', '公众号', 0, 'media-desk/files/c.png')
  assert.match(wechat, /^开头一段。\n\n!\[\]\(media-desk\/files\/c.png\)\n\n## 一/)

  let called = 0
  const { state, id, store } = fixture(STUDIED)
  state.items[0].production.versions = { 小红书: { ...goodPair(), status: 'done' } }
  const off = new Illustrator({ store, settings: { read: async () => ({ image: {} }) }, callText: async () => { called += 1; return reply({}) }, generate: async () => ({}), ready: () => false })
  await assert.rejects(off.propose(id, '小红书'), /还没有接入生图模型/)
  assert.equal(called, 0)
  const dir = await mkdtemp(join(tmpdir(), 'md-illus-'))
  try {
    store.filesDir = dir
    const on = new Illustrator({
      store, settings: { read: async () => ({ image: {} }) }, ready: () => true,
      callText: async () => { called += 1; return reply({ pages: [{ page: 2, need: true, kind: '对照', prompt: 'two columns' }] }) },
      generate: async () => ({ buffer: Buffer.from('png'), ext: '.png' }),
    })
    await on.propose(id, '小红书')
    assert.equal(called, 1)
    await assert.rejects(on.start(id, '小红书', []), /先勾选/)
    await on.start(id, '小红书', [2])
    for (let i = 0; i < 100 && on.running.size; i += 1) await new Promise(r => setTimeout(r, 5))
    const version = state.items[0].production.versions.小红书
    assert.equal(version.illustrations.find(row => row.page === 2).status, 'done')
    assert.equal(splitCards(version.cards)[2].images, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('新 Store 使用通用风格，平台篇幅规则仍有效', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md-plat-'))
  try {
    const state = await new Store(dir, { samples: false }).read()
    const style = state.styles.find(row => row.id === state.activeStyleId)
    assert.equal(style.id, DEFAULT_STYLE_ID)
    assert.equal(style.platforms, undefined)
    assert.deepEqual([effectiveSpec('小红书', style).body.min, effectiveSpec('小红书', style).body.max], [200, 300])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('定向修改一项都没改好就不采用；千分位不算新数字；短标题无需凑字数、太长才让模型改', async () => {
  const { state, id, store } = fixture(STUDIED)
  const good = goodPair()
  let n = 0
  const callText = async () => { n += 1; return reply({ ...good, tags: ['只有一个'], body: n === 1 ? good.body : `${good.body}\n\n补一句。` }) }
  const versioner = new Versioner({ store, callText, settings: { read: async () => ({}) }, materials: async () => ({ status: 'none', scanned: 0, picks: [] }) })
  await versioner.start(id, ['小红书'])
  await settled(versioner, id)
  const version = state.items[0].production.versions.小红书
  assert.equal(n, 2)
  assert.equal(version.flow.revision.reason, 'unfixed')
  assert.ok(!version.body.includes('补一句'))

  const { factNumbers } = await import('../src/selfcheck.js')
  // 3 万和 30,000 是同一个数：带单位的写法换算后再比，不把中英文换算式当成新数字
  assert.deepEqual(factNumbers('from ~2,500 to 30,000', '约 2500 个，3 万多个'), [])
  assert.deepEqual(factNumbers('from ~2,500 to 40,000', '约 2500 个，3 万多个'), ['40000'])
  const style = customStyle()
  const short = selfCheck({ ...good, cards: good.cards.replace('人工评论反而翻了三倍多', '评论翻倍') }, '小红书', { style }).find(row => row.id === 'card-title')
  assert.equal(short.ok, true)
  assert.equal(short.fix, undefined)
  const long = selfCheck({ ...good, cards: good.cards.replace('人工评论反而翻了三倍多', '这是一个非常非常非常非常长的页标题超过十六个字') }, '小红书', { style }).find(row => row.id === 'card-title')
  assert.match(long.fix, /压到 16 字以内/)
})

test('模型偶发返回空内容时重试一次，第二次拿到就正常存下版本', async () => {
  const { state, id, store } = fixture(DID)
  let n = 0
  const callText = async () => {
    n += 1
    if (n === 1) return { text: '', model: 'fake' }
    return reply({ title: '', body: 'I ran Claude Code for 2 weeks.\n\n---\n\nAPI cost: 2000.\n\n---\n\nWhat would you do?', tags: [] })
  }
  const versioner = new Versioner({ store, callText, settings: { read: async () => ({}) }, materials: async () => ({ status: 'none', scanned: 0, picks: [] }) })
  await versioner.start(id, ['X'])
  await settled(versioner, id)
  const version = state.items[0].production.versions.X
  assert.equal(n, 2)
  assert.equal(version.status, 'done')
  assert.match(version.body, /Claude Code/)
})


test('社区版迁移保留用户自定义平台规则，重复迁移不改变内容', () => {
  const state = structuredClone(buildSeed(NOW, 'zh'))
  state.presetVersion = 3
  const mine = customStyle()
  state.styles.push(mine)
  state.activeStyleId = mine.id
  mine.platforms.小红书.bodyMin = 280
  const expected = structuredClone(mine)
  migrateState(state)
  assert.deepEqual(state.styles.find(row => row.id === mine.id), expected)
  assert.equal(state.activeStyleId, mine.id)
  const migrated = structuredClone(state)
  migrateState(state)
  assert.deepEqual(state, migrated)
})
