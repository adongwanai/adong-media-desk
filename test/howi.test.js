// How I 检查：一句话算不算亲手做过；只认作者自己写的文字，模型一键成稿写的不算。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyHowI, editedSentences, isDidSentence, isStudySentence, userText } from '../src/howi.js'

// [句子, 期望]：did 做过 / studied 研究过 / none 都不算
const CASES = [
  // 做过
  ['我用 Claude Code 跑了两周，一天写 3 篇', 'did'],
  ['上周我自己搭了一套 RAG，召回率从 60% 提到 78%', 'did'],
  ['我们在内部把这个模型部署了三台机器，上线了一个月', 'did'],
  ['我在 3 个仓库里试过这个流程，回滚了两次', 'did'],
  ['亲测有效，装完重启一下就好', 'did'],
  ['我用了半年 Cursor，后来换回 VS Code', 'did'],
  ['我踩过一个坑：缓存没清掉，结果全错', 'did'],
  // 习惯说法也是在说亲手做过
  ['对我这种天天跑 Agent 的人来说，最要紧的是价格不变', 'did'],
  ['我平时都在用 Cursor 写前端', 'did'],
  // 研究过
  ['我读完了 Anthropic 的原文，人工评论从 16% 涨到 54%', 'studied'],
  ['我把这篇论文看完了，作者的实验只有两个数据集', 'studied'],
  ['原文里写着，这套流程只在内部用过', 'studied'],
  ['我仔细对比了三家的价格表', 'studied'],
  ['我花了一晚上读他们的技术报告', 'studied'],
  // 否定：否定词和动词之间隔了几个字
  ['我没有认真试过别的方案', 'none'],
  ['这个功能我还没真正跑起来', 'none'],
  ['我从来没在生产环境用过它', 'none'],
  ['我未曾亲手部署过这类服务', 'none'],
  // 假设
  ['如果我用它来写周报，大概能省一半时间', 'none'],
  ['要是我自己搭一套，成本会高很多', 'none'],
  // 转述别人
  ['他说他试了三次都失败了', 'none'],
  ['网友实测，续航掉了两成', 'none'],
  ['我同事跑了一周压测，结论是够用', 'none'],
  ['我听朋友说他们团队已经用了半年', 'none'],
  // 打算、计划
  ['我打算下周试一下这个模型', 'none'],
  ['下周再去跑一遍完整的评测', 'none'],
  ['我想试试把它接进飞书', 'none'],
  ['如果我每天跑一遍，成本会翻倍', 'none'],
  // 比方，不是动手
  ['我做了一个判断：先把回滚做好', 'none'],
  ['我用了一个比喻来解释上下文窗口', 'none'],
  // 什么都没有
  ['某公司发布了一个 70B 的模型', 'none'],
  ['没想到我用了三天就离不开了', 'did'],
]

test('How I：一句话算做过 / 研究过 / 都不算（表驱动）', () => {
  assert.ok(CASES.length >= 20)
  for (const [sentence, expected] of CASES) {
    const got = isDidSentence(sentence) ? 'did' : isStudySentence(sentence) ? 'studied' : 'none'
    assert.equal(got, expected, sentence)
  }
})

test('How I：一键成稿的正文不算作者的经历，只看灵感本身', () => {
  const article = '## 过程\n\n我没有认真试过别的方案，但我用 Claude Code 跑了两周，效果很稳。'
  const generated = { title: 'Claude Code 写稿', body: '看到一条新闻：某团队用 Agent 写稿', production: { article, aiArticle: article, engine: 'deepseek-chat' } }
  assert.equal(classifyHowI(generated).level, 'none')
  // 只有 engine 也算模型写的（老数据没有 aiArticle）
  assert.equal(classifyHowI({ ...generated, production: { article, engine: 'deepseek-chat' } }).level, 'none')
  // 灵感里自己写了做过，就算
  assert.equal(classifyHowI({ ...generated, body: '我用 Claude Code 跑了两周' }).level, 'did')
})

test('How I：导入的原稿、没经过模型的成稿就是作者自己写的', () => {
  const article = '我在 3 个仓库里试过这个流程。'
  assert.equal(classifyHowI({ imported: true, production: { article, importedFrom: '/notes/a.md' } }).level, 'did')
  assert.equal(classifyHowI({ production: { article } }).level, 'did')
  // 导入的稿子 body 只留开头的摘录，经历写在后面也认得出来
  const long = `${'这是开头的铺垫。'.repeat(60)}\n\n后来我在 3 个仓库里试过这个流程。`
  const imported = { imported: true, importPath: '/notes/b.md', body: long.slice(0, 400), production: { article: long, importedFrom: '/notes/b.md' } }
  assert.equal(classifyHowI(imported).level, 'did')
})

test('How I：模型稿上手动改过、加上的句子算作者的，原样留着的不算', () => {
  const ai = '这个模型很快。\n\n我觉得值得关注。'
  const edited = `${ai}\n\n我上周在公司的数据上跑了一遍，比原来快了一倍。`
  const item = { title: 't', production: { article: edited, aiArticle: ai, engine: 'deepseek-chat' } }
  assert.equal(editedSentences(edited, [ai]), '我上周在公司的数据上跑了一遍，比原来快了一倍')
  // 只剩记号的碎片（「**」）不算作者写的句子
  assert.equal(editedSentences('**加粗的一句。**', ['**加粗的一句。**']), '')
  const result = classifyHowI(item)
  assert.equal(result.level, 'did')
  assert.match(result.evidence[0], /跑了一遍/)
  // humanize 前的初稿也算模型写的
  const first = '我用 Claude Code 跑了两周。'
  assert.equal(classifyHowI({ production: { article: `${ai}\n${first}`, aiArticle: ai, engine: 'x', flow: { firstDraft: first } } }).level, 'none')
})

test('How I：手动保存的草稿算作者的；模型写的草稿不算', () => {
  assert.equal(classifyHowI({ drafts: { article: { text: '我搭了一套 RAG。', by: 'user' } } }).level, 'did')
  assert.equal(classifyHowI({ drafts: { article: { text: '我搭了一套 RAG。', by: 'ai', aiText: '我搭了一套 RAG。' } } }).level, 'none')
  assert.match(userText({ title: '标题', body: '正文' }), /标题\n正文/)
})
