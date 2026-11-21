import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { cardContext, checkCover, estimateFits, packPages, paginate, planSections, renderCard, sectionHeadings } from '../client/layouts/cards.js'
import { YANQI_THEMES } from '../client/layouts/yanqi.js'
import { auditDraftQuality, normalizeDraftStructure } from '../src/draft-quality.js'
import { NativeAgent } from '../src/native-agent.js'

const GOOD_XHS = [
  '港大这篇 NeurIPS 2026，把原因算出来了',
  '',
  '## 刷到这篇港大论文，我改了习惯',
  '',
  '刷到机器之心写的一篇港大论文，顺手把 arXiv 原文和开源代码翻了一遍。它没提新模型，只盯着 GRPO 里最不起眼那一步：把优势减均值、再除标准差。',
  '',
  '> 📄 论文：Unveiling Implicit Advantage Symmetry ｜ 机构：香港大学 ｜ arXiv：2602.05548',
  '',
  '看完我的第一反应是：**「训完 Pass@1 涨了」这句话，只说了半件事。**',
  '',
  '## 账是平的，代价在没采到的地方',
  '',
  '组相对优势就是把同一道题采出来的几条回答，减去组内均值再除以标准差。论文发现答对和答错的轨迹权重绝对值加起来严格相等。',
  '',
  '![论文图 1](/media-desk/files/fig1.png)',
  '',
  '但 ==没被采样到的轨迹，更新量正好是零==。**模型只会把已经找到的那条路压得更实。**',
  '',
  '## 我的选择：先不急着换算法',
  '',
  '我不会急着把新方法接进线上。系数得按数据集重调，早训压正确优势也会拖慢收敛，这两笔代价在我手上的任务里值不值，我还没数。**我打算先把批次平均奖励和 Pass@256 一起打进训练日志。**',
  '',
  '阿东，大模型算法工程师，OPC创业者。',
].join('\n')

test('normalizeDraftStructure：自动拆解开头的重复封面短节并抽离卡片内标签墙', () => {
  const raw = [
    '# GRPO 越训越窄，问题出在这一步',
    '',
    '## GRPO 训完，模型更不敢想',
    '',
    '港大这篇 NeurIPS 2026，把原因算出来了',
    '',
    '## 刷到这篇港大论文，我改了习惯',
    '',
    '刷到机器之心写的一篇港大论文，顺手把 arXiv 原文和开源代码翻了一遍。看完我的第一反应是：**只看 Pass@1 会把模型训窄。**',
    '',
    '#GRPO #大模型训练 #强化学习 #论文解读',
    '',
    '阿东，大模型算法工程师，OPC创业者。',
  ].join('\n')

  const norm = normalizeDraftStructure(raw, { goal: 'xhs' })
  assert.equal(norm.changed, true)
  assert.equal(norm.title, 'GRPO 越训越窄，问题出在这一步')
  assert.equal(norm.coverTitle, 'GRPO 训完，模型更不敢想')
  assert.equal(norm.kicker, '港大这篇 NeurIPS 2026，把原因算出来了')
  assert.ok(norm.body.startsWith('港大这篇 NeurIPS 2026，把原因算出来了\n\n## 刷到这篇港大论文，我改了习惯'))
  assert.doesNotMatch(norm.body, /## GRPO 训完/)
  assert.doesNotMatch(norm.body, /#GRPO/)
  assert.deepEqual(norm.extractedTags, ['GRPO', '大模型训练', '强化学习', '论文解读'])
  assert.match(norm.body, /阿东，大模型算法工程师/)
})

test('auditDraftQuality：合格的小红书图文 5 项通用规则全绿通过', () => {
  const report = auditDraftQuality(GOOD_XHS, { title: 'GRPO 越训越窄，问题出在这一步', goal: 'xhs' })
  assert.equal(report.ok, true, JSON.stringify(report.checks))
  assert.equal(report.passCount, 5)
  assert.equal(report.hardFailures.length, 0)
  assert.equal(report.fixPrompt, '')
})

test('auditDraftQuality：精准检出空洞短卡、漏加粗、假图占位、AI 套话、营销词与裸公式', () => {
  const bad = [
    '## 重复封面标题',
    '',
    '只有十几个字的空卡。',
    '',
    '## 第二节内容',
    '',
    '值得注意的是，本文对强化学习进行了深入的梳理。这不是退步，而是升级；这不是妥协，而是重构。说白了，底层逻辑就是公式 $\\pi_\\theta(y|x) = \\frac{A}{B}$ 的更新，花3分钟帮你省两周，建议反复收藏！',
    '',
    '[此处放截图]',
  ].join('\n')

  const report = auditDraftQuality(bad, { title: '测试标题', goal: 'xhs' })
  assert.equal(report.ok, false)
  const byId = Object.fromEntries(report.checks.map(c => [c.id, c]))
  assert.equal(byId['card-density'].state, 'bad')
  assert.equal(byId.emphasis.state, 'bad')
  assert.equal(byId.visuals.state, 'bad')
  assert.equal(byId['anti-ai'].state, 'bad')
  assert.equal(byId['human-voice'].state, 'bad')
  assert.ok(report.hardFailures.length >= 4)
  assert.match(report.fixPrompt, /首页与卡片饱满度/)
  assert.match(report.fixPrompt, /重点加粗与高亮/)
  assert.match(report.fixPrompt, /去 AI 味规则检查/)
  assert.match(report.fixPrompt, /活人感与去营销检查/)
})

test('renderCard 首页与正文自然连排：无多余「本期核心看点」占位，30 套主题下首页直接排进正文与图片且行内样式安全', () => {
  const raw = planSections(GOOD_XHS, { title: 'GRPO 越训越窄，问题出在这一步', resolveImage: () => ({ src: 'data:image/png;base64,AAAA', width: 400, height: 240 }) })
  const headings = sectionHeadings(raw)
  assert.equal(headings.length, 3)
  for (const theme of YANQI_THEMES) {
    const ctx = cardContext({ theme: theme.id, cover: 'cover-bold' }, {}, { headings, article: GOOD_XHS })
    const fits = estimateFits(ctx)
    const pages = packPages(paginate(raw, fits), fits, { includeCover: true })
    const html = renderCard(pages[0], ctx)
    assert.ok(!html.includes('本期核心看点'), theme.id)
    assert.ok(html.includes('刷到这篇港大论文，我改了习惯'), theme.id)
    assert.doesNotMatch(html, /\sclass=/, theme.id)
    const coverCheck = checkCover(pages[0], ctx)
    assert.equal(coverCheck.find(c => c.id === 'area')?.state, 'ok', theme.id)
  }
})

test('NativeAgent 成稿门禁：硬性规则未达标时自动触发 1 轮同会话自检返修并保存 quality 报告', async () => {
  let state = { items: [{ id: 't1', title: '论文解读测试', status: 'idea' }], chat: [], skills: [], styles: [] }
  const root = mkdtempSync(join(tmpdir(), 'native-qgate-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  const store = {
    root,
    filesDir: join(root, 'files'),
    read: async () => state,
    mutate: async (_label, fn) => {
      const draft = structuredClone(state)
      const res = fn(draft)
      state = draft
      return res
    },
  }
  const prompts = []
  let token = ''
  const service = {
    create: async () => ({ sessionId: 'session-qgate' }),
    state: async () => ({ running: null, queue: [], pendingInput: [] }),
    cancel: () => {},
    prompt: async (args) => {
      prompts.push(args.content[0].text)
      if (!token) token = args.content[0].text.match(/<media-desk-article id="([^"]+)"/)?.[1] || ''
    },
    async *follow() {
      yield { type: 'snapshot', cursor: 1, records: [] }
      const draft1 = [
        '初稿说明',
        `<media-desk-article id="${token}">`,
        '# 初稿标题',
        '',
        '## 空封面重复节',
        '',
        '只有几个字。',
        '',
        '## 正文节',
        '',
        '值得注意的是，这篇文章没有任何加粗标记，而且用了建议反复收藏、干货满满这类营销号套话，同时对强化学习算法进行了非常笼统的梳理，没有给出任何个人真实判断和取舍边界，用来验证工作台的自动通用规则检查门禁能自动打回返修一轮。',
        '</media-desk-article>',
      ].join('\n')
      yield { type: 'event', event: { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: draft1 }] } } } }
      yield { type: 'event', event: { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } } }

      const draft2 = `已按质检规则修整。\n<media-desk-article id="${token}">\n# GRPO 越训越窄，问题出在这一步\n\n${GOOD_XHS}\n</media-desk-article>`
      yield { type: 'event', event: { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: draft2 }] } } } }
      yield { type: 'event', event: { seq: 5, type: 'turn/end', data: { reason: { kind: 'completed' } } } }
    },
  }

  const agent = new NativeAgent({
    ctx: { get: name => (name === 'sessionController' ? service : null) },
    store,
    settings: { read: async () => ({ writingFlow: { selected: [] } }) },
    cwd: '/workspace',
  })
  const res = await agent.run({ focusId: 't1', message: '写小红书图文', generate: true, goal: 'xhs' })
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /通用规则检查/)
  const prod = res.state.items[0].production
  assert.equal(prod.status, 'done')
  assert.equal(prod.quality.ok, true)
  assert.equal(prod.quality.passCount, 5)
})

test('长文预览与图片上传：兼容带前导斜杠的 /media-desk/files/ 图片链接，不再退化成占位文字', async () => {
  const { localImages, wechatParts } = await import('../client/layouts/wechat.js')
  const md = '## 第一节\n\n![论文图 1](/media-desk/files/grae-motivationv6.png)'
  const out = wechatParts(md, 'adong-xhs-dense', { images: 'preview' })
  const joined = out.blocks.map(b => b.html).join('')
  assert.match(joined, /<img src="\/media-desk\/files\/grae-motivationv6\.png"/)
  assert.doesNotMatch(joined, /〔论文图 1〕/)
  assert.deepEqual(localImages(md), ['/media-desk/files/grae-motivationv6.png'])
})

test('工作流不会自动扫描用户主目录里的 Skills，显式路径可以按需读取', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { detectFlow } = await import('../src/writing-flow.js')
  const home = mkdtempSync(join(tmpdir(), 'flow-humanizer-'))
  after(() => rmSync(home, { recursive: true, force: true }))
  const path = join(home, '.dsh', 'skills', 'humanizer', 'SKILL.md')
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '# Humanizer\n用户自行安装的技能。')
  assert.deepEqual((await detectFlow({ home })).docs, [])
  const chosen = await detectFlow({ home, paths: [path] })
  assert.equal(chosen.docs.length, 1)
  assert.equal(chosen.docs[0].path, path)
  assert.equal(chosen.docs[0].on, true)
})

test('社区版升级保留用户自己配置的平台规则，默认风格不含开发者身份', async () => {
  const { migratePresets, seedPresets, DEFAULT_STYLE_ID } = await import('../src/style-presets.js')
  const state = { presetVersion: 0, sampleLang: 'zh', styles: seedPresets('zh') }
  state.styles.find(row => row.id === DEFAULT_STYLE_ID).platforms = { 小红书: { rules: '用户自定义规则' } }
  migratePresets(state)
  assert.equal(state.styles.find(row => row.id === DEFAULT_STYLE_ID).platforms.小红书.rules, '用户自定义规则')
  assert.ok(!state.styles.some(row => row.id === 'preset_adong'))
})

test('autoAnnotateHighlights + 阿东信息流主题：自动补齐加蓝加粗与加黄高亮，并完整渲染头像、蓝V、账号与底部座右铭', async () => {
  const { autoAnnotateHighlights } = await import('../src/draft-quality.js')
  const { parseObsidianNoteToRed } = await import('../src/obsidian-yanqi.js')
  const { TEST_SIGNATURE } = await import('./fixtures/signature.js')

  const plainDraft = [
    '阿东刷到 MemTensor 和 NVIDIA 发布 MemT 1.0 Pro 的消息，554B 总参、59B 激活，底座是 NVIDIA Nemotron。他们还在坚持把记忆做成模型内部状态。',
    '',
    '给 Agent 加记忆，大家习惯的是外部那一套：向量库、RAG、把聊天记录塞进上下文。用是能用，但上下文越堆越长，token 越来越贵，模型该忘的还是忘，该用错还是用错。',
    '',
    '看到 MemT 这条路线，我第一反应是：它到底是在补模型短板，还是在绕开更根本的能力缺失？',
    '',
    '## 外部检索解决不了内部权重惯性',
    '',
    '很多团队以为挂上向量库就万事大吉，但真正卡住长程任务的是模型不会主动更新内部工作状态。一旦上下文超过阈值，注意力就会迅速稀释。',
  ].join('\n')

  const annotated = autoAnnotateHighlights(plainDraft, { goal: 'xhs' })
  assert.equal(annotated.changed, true)
  assert.ok(annotated.addedBold >= 2)
  assert.ok(annotated.addedMark >= 2)
  assert.match(annotated.text, /\*\*[^*\n]+\*\*/)
  assert.match(annotated.text, /==它到底是在补模型短板，还是在绕开更根本的能力缺失？==/)

  const parsedObs = parseObsidianNoteToRed({
    themeId: 'adong-xhs-dense',
    templateId: 'default',
    coverStyle: 'cover-bold',
    fontFamily: '"Hiragino Sans GB","冬青黑体",sans-serif',
    fontSize: 17,
    userName: TEST_SIGNATURE.name,
    userId: TEST_SIGNATURE.id,
    userAvatar: TEST_SIGNATURE.avatar,
    footerLeftText: TEST_SIGNATURE.left,
    footerRightText: TEST_SIGNATURE.right,
    showTime: true,
    showFooter: true,
    timeFormat: 'zh-CN',
  })
  assert.equal(parsedObs.cardPrefs.theme, 'adong-xhs-dense')
  assert.equal(parsedObs.cardPrefs.font, '冬青黑体')
  assert.equal(parsedObs.signature.name, '示例创作者')
  assert.equal(parsedObs.signature.id, '@demo-creator')
  assert.equal(parsedObs.signature.left, '清楚表达')
  assert.equal(parsedObs.signature.right, 'Keep creating')

  const ctx = cardContext(parsedObs.cardPrefs, parsedObs.signature, { date: '2026/11/21', article: annotated.text })
  const fits = estimateFits(ctx)
  const pages = packPages(paginate(planSections(annotated.text, { title: '记忆该不该长在模型身上？聊聊 MemT 1.0 Pro' }), fits), fits, { includeCover: true })
  const allHtml = pages.map(p => renderCard(p, ctx)).join('\n')
  assert.match(allHtml, /示例创作者/)
  assert.match(allHtml, /@demo-creator/)
  assert.match(allHtml, /fill:\s*#0066FF/i)
  assert.match(allHtml, /清楚表达/)
  assert.match(allHtml, /Keep creating/)
  assert.match(allHtml, /color:\s*#0066FF/i)
  assert.match(allHtml, /<mark style="/i)
})

test('ensureSessionModel：遇到 DeepSeek Messages transport failed 自动切换至 deepseek-official API 通道重试', async () => {
  const { ensureSessionModel } = await import('../src/native-task.js')
  const selected = []
  let savedDefault = null
  const service = {
    selectModel: async (req) => { selected.push(req) },
  }
  const ctx = {
    get(key) {
      if (key === 'agentDefaultModel') {
        return {
          currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-v4-pro' }),
          saveSelection: async (next) => { savedDefault = next },
        }
      }
      if (key === 'llm') {
        return {
          listProviders: async () => [{ id: 'deepseek-account' }, { id: 'deepseek-official' }],
          listModels: async (p) => (p === 'deepseek-official' ? [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] : []),
        }
      }
      return null
    },
  }
  const route = await ensureSessionModel(ctx, service, 'sess-1', { avoidAccount: true })
  assert.deepEqual(route, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.deepEqual(selected, [{ sessionId: 'sess-1', provider: 'deepseek-official', model: 'deepseek-v4-pro' }])
  assert.deepEqual(savedDefault, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
})



