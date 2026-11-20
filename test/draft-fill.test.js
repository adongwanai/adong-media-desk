import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DENY_WORDS, allowedUrl, blockedPage, canClick, extractTags, humanDelay, isDenied, plainText } from '../src/fill-guard.js'
import { FILL_STEPS, compareReadback, createFillRun, findDuplicate, shotName, shotsToDrop, titleSimilar } from '../src/fill-check.js'
import { createPage, FillError } from '../src/fill-page.js'
import { FILL_PLATFORMS, fillAdapter } from '../src/fill-platforms/index.js'
import { draftCount, xiaohongshu } from '../src/fill-platforms/xiaohongshu.js'
import { DraftFiller, REPEAT_MS, describeError } from '../src/draft-fill.js'

const xhsItem = (version = {}) => ({
  id: 'i1',
  production: { status: 'done', title: '母稿', versions: { 小红书: { status: 'done', title: '我用 Agent 写周报', body: '**第一句**判断。\n\n第二段。', tags: ['#AI工具', 'Agent', 'AI工具', ' 效率 提升 '], cards: '## 封面\n\n一句\n\n## 第二页\n\n内容', ...version } } },
})

/* ───────────── 安全闸 ───────────── */

test('黑名单：发布类按钮一律不点，哪怕平台白名单里写了', () => {
  for (const text of ['发布', '立即发布', '定时发布', '发表', '群发', '提交审核', '投稿', ' 发布 ', '发布笔记']) assert.equal(isDenied(text), true, text)
  assert.equal(isDenied('暂存离开'), false)
  const loose = { clicks: ['发布', '暂存离开'] }
  assert.deepEqual(canClick(loose, '发布'), { ok: false, reason: 'denied' })
  assert.deepEqual(canClick(loose, '暂存离开'), { ok: true })
  assert.ok(DENY_WORDS.includes('发布'))
})

test('白名单：只点文字完全相同的按钮', () => {
  assert.deepEqual(canClick(xiaohongshu, '暂存离开'), { ok: true })
  assert.deepEqual(canClick(xiaohongshu, '上传图文'), { ok: true })
  assert.deepEqual(canClick(xiaohongshu, '暂存'), { ok: false, reason: 'unlisted' })
  assert.deepEqual(canClick(xiaohongshu, '笔记预览'), { ok: false, reason: 'denied' })
  assert.deepEqual(canClick(xiaohongshu, ''), { ok: false, reason: 'denied' })
  // 平台白名单里不能混进发布类按钮
  for (const text of xiaohongshu.clicks) assert.equal(isDenied(text, xiaohongshu.deny), false, text)
})

test('地址白名单：只去平台主机，而且必须 https', () => {
  assert.equal(allowedUrl(xiaohongshu, xiaohongshu.url), true)
  assert.equal(allowedUrl(xiaohongshu, 'http://creator.xiaohongshu.com/publish/publish'), false)
  assert.equal(allowedUrl(xiaohongshu, 'https://evil.example.com/'), false)
  assert.equal(allowedUrl(xiaohongshu, 'https://creator.xiaohongshu.com.evil.com/'), false)
  assert.equal(allowedUrl(xiaohongshu, 'not a url'), false)
})

test('页面状态：登录页、验证码、跳出白名单都要停', () => {
  const ok = { href: 'https://creator.xiaohongshu.com/publish/publish?source=official', text: '上传图文 草稿箱(0)' }
  assert.equal(blockedPage(xiaohongshu, ok), null)
  assert.equal(blockedPage(xiaohongshu, { href: 'about:blank' }), null)
  assert.equal(blockedPage(xiaohongshu, { href: 'https://creator.xiaohongshu.com/login?redirectReason=401' }), 'login')
  assert.equal(blockedPage(xiaohongshu, { href: 'https://www.xiaohongshu.com/login' }), 'login')
  assert.equal(blockedPage(xiaohongshu, { href: 'https://example.com/' }), 'offsite')
  assert.equal(blockedPage(xiaohongshu, { ...ok, text: '请完成安全验证' }), 'captcha')
  assert.equal(blockedPage(xiaohongshu, { ...ok, captcha: true }), 'captcha')
})

test('标签：去掉 #、空白和[话题]，去重，正文里已有的不再加', () => {
  assert.deepEqual(extractTags(['#AI工具', 'Agent', 'AI工具', ' 效率 提升 ', '', '大模型[话题]'], ''), ['AI工具', 'Agent', '效率提升', '大模型'])
  assert.deepEqual(extractTags(['AI', 'AI工具'], '结尾 #AI工具'), ['AI'])
  assert.deepEqual(extractTags(Array.from({ length: 12 }, (_, i) => `t${i}`), '', 10).length, 10)
  assert.deepEqual(extractTags(null, ''), [])
})

test('正文转纯文本、停顿时间', () => {
  assert.equal(plainText('## 小标题\n**重点**和==高亮==\n![图](a.png)\n> 引用'), '小标题\n重点和高亮\n引用')
  assert.equal(humanDelay(() => 0), 500)
  assert.equal(humanDelay(() => 1), 1500)
})

/* ───────────── 小红书内容 ───────────── */

test('小红书内容：取平台版本的标题、正文和话题', () => {
  const content = xiaohongshu.content(xhsItem())
  assert.equal(content.title, '我用 Agent 写周报')
  assert.equal(content.body, '第一句判断。\n\n第二段。')
  assert.deepEqual(content.tags, ['AI工具', 'Agent', '效率提升'])
  assert.deepEqual(content.problems, [])
})

test('小红书内容：标题超 20 字不截断，停下报告', () => {
  const content = xiaohongshu.content(xhsItem({ title: '这是一个特别特别特别特别特别长的小红书标题啊' }))
  assert.equal(content.title, '这是一个特别特别特别特别特别长的小红书标题啊')
  assert.equal(content.problems[0].code, 'title-long')
  assert.equal(content.problems[0].vars.max, 20)
  // 英文按半个字算：40 个字母刚好 20
  assert.deepEqual(xiaohongshu.content(xhsItem({ title: 'a'.repeat(40) })).problems, [])
  assert.equal(xiaohongshu.content(xhsItem({ title: 'a'.repeat(41) })).problems[0].code, 'title-long')
})

test('小红书内容：没有版本、没有图片版、正文太长', () => {
  assert.equal(xiaohongshu.content({ id: 'x', production: { status: 'done', versions: {} } }).problems[0].code, 'no-version')
  assert.equal(xiaohongshu.content(xhsItem({ status: 'running' })).problems[0].code, 'no-version')
  assert.ok(xiaohongshu.content(xhsItem({ cards: '' })).problems.some(row => row.code === 'no-cards'))
  assert.ok(xiaohongshu.content(xhsItem({ body: '字'.repeat(1001) })).problems.some(row => row.code === 'body-long'))
  assert.equal(xiaohongshu.content(xhsItem({ title: '' })).problems[0].code, 'no-title')
})

test('适配器表：第一期只有小红书，结构齐全', () => {
  assert.deepEqual(FILL_PLATFORMS, ['小红书'])
  assert.equal(fillAdapter('公众号'), null)
  assert.equal(fillAdapter('toString'), null)
  for (const platform of FILL_PLATFORMS) {
    const adapter = fillAdapter(platform)
    assert.ok(allowedUrl(adapter, adapter.url), platform)
    assert.ok(adapter.clicks.includes(adapter.draftButton))
    assert.equal(typeof adapter.fill, 'function')
    assert.equal(typeof adapter.content, 'function')
  }
  assert.equal(draftCount('上传图文 草稿箱(3) 上传图片'), 3)
  assert.equal(draftCount('草稿箱（12）'), 12)
  assert.equal(draftCount('没有'), null)
})

/* ───────────── 页面驱动（假 CDP） ───────────── */

const SNAP = (overrides = {}) => ({ href: 'https://creator.xiaohongshu.com/publish/publish', ready: 'complete', visible: 'visible', text: '草稿箱(0)', captcha: false, ...overrides })

/**
 * 假标签页：buttons 是 [{id, text, box: [left, top, width, height]}]；hitAt(x, y) 决定落点上是哪个节点。
 * 按钮放在一个封闭影子树里（和小红书的 <xhs-publish-btn> 一样）。
 */
function fakeTab({ buttons = [], snap = SNAP(), hitAt, fileInputs = [1] } = {}) {
  const calls = []
  const text = id => ({ nodeType: 3, nodeName: '#text', backendNodeId: id * 100, nodeValue: buttons.find(b => b.id === id).text })
  const root = {
    nodeType: 9, nodeName: '#document', backendNodeId: 1,
    children: [{ nodeType: 1, nodeName: 'XHS-PUBLISH-BTN', backendNodeId: 2, children: [], shadowRoots: [{ nodeType: 11, nodeName: '#document-fragment', backendNodeId: 3, children: buttons.map(b => ({ nodeType: 1, nodeName: 'BUTTON', backendNodeId: b.id, children: [text(b.id)] })) }] }],
  }
  const defaultHit = (x, y) => buttons.find(b => x >= b.box[0] && x <= b.box[0] + b.box[2] && y >= b.box[1] && y <= b.box[1] + b.box[3])?.id * 100 || 2
  const tab = {
    calls,
    activate: async () => { calls.push(['activate']) },
    async send(method, params = {}) {
      calls.push([method, params])
      switch (method) {
        case 'Runtime.evaluate': return { result: { value: typeof snap === 'function' ? snap(params.expression) : (params.expression.includes('visibilityState') && !params.expression.includes('editors') ? snap.visible : snap) } }
        case 'DOM.getDocument': return { root: params.pierce ? root : { nodeId: 1 } }
        case 'Page.getLayoutMetrics': return { cssLayoutViewport: { clientWidth: 1200, clientHeight: 900 } }
        case 'DOM.getBoxModel': {
          const b = buttons.find(row => row.id === params.backendNodeId)
          if (!b) throw new Error('no box')
          const [l, t, w, h] = b.box
          return { model: { border: [l, t, l + w, t, l + w, t + h, l, t + h] } }
        }
        case 'DOM.getNodeForLocation': return { backendNodeId: (hitAt ?? defaultHit)(params.x, params.y) }
        case 'DOM.querySelectorAll': return { nodeIds: fileInputs }
        default: return {}
      }
    },
  }
  return tab
}

const noPause = async () => {}
const pressed = tab => tab.calls.filter(([method, params]) => method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed')

test('点击：「发布」被安全闸挡住，一个鼠标事件都不发', async () => {
  const tab = fakeTab({ buttons: [{ id: 11, text: '暂存离开', box: [600, 850, 120, 40] }, { id: 12, text: '发布', box: [750, 850, 120, 40] }] })
  const page = createPage(tab, xiaohongshu, { pause: noPause, delay: () => 0 })
  await assert.rejects(page.click('发布'), err => err instanceof FillError && err.code === 'denied')
  await assert.rejects(page.click('立即发布'), err => err.code === 'denied')
  assert.equal(tab.calls.filter(([method]) => method.startsWith('Input.')).length, 0)
})

test('点击：「暂存离开」按文字找到、核对落点后才按下，点的是它的中心', async () => {
  const tab = fakeTab({ buttons: [{ id: 11, text: '暂存离开', box: [600, 850, 120, 40] }, { id: 12, text: '发布', box: [750, 850, 120, 40] }] })
  const page = createPage(tab, xiaohongshu, { pause: noPause, delay: () => 0 })
  await page.click('暂存离开')
  const press = pressed(tab)
  assert.equal(press.length, 1)
  assert.deepEqual([press[0][1].x, press[0][1].y], [660, 870])
})

test('点击：落点被别的东西挡住（比如压着「发布」）就不点', async () => {
  const tab = fakeTab({ buttons: [{ id: 11, text: '暂存离开', box: [600, 850, 120, 40] }, { id: 12, text: '发布', box: [600, 850, 120, 40] }], hitAt: () => 1200 })
  const page = createPage(tab, xiaohongshu, { pause: noPause, delay: () => 0 })
  await assert.rejects(page.click('暂存离开'), err => err.code === 'changed')
  assert.equal(pressed(tab).length, 0)
})

test('点击：按下前落点变了（页面挪动）也不点', async () => {
  let checks = 0
  const tab = fakeTab({ buttons: [{ id: 11, text: '暂存离开', box: [600, 850, 120, 40] }], hitAt: () => { checks += 1; return checks === 1 ? 1100 : 2 } })
  const page = createPage(tab, xiaohongshu, { pause: noPause, delay: () => 0 })
  await assert.rejects(page.click('暂存离开'), err => err.code === 'changed')
  assert.equal(pressed(tab).length, 0)
})

test('点击：藏在视口外的假按钮不算，找不到就报「页面可能改版了」', async () => {
  const tab = fakeTab({ buttons: [{ id: 11, text: '上传图文', box: [-9999, -9999, 96, 40] }] })
  const page = createPage(tab, xiaohongshu, { pause: noPause, delay: () => 0 })
  assert.equal(await page.has('上传图文'), false)
  await assert.rejects(page.click('上传图文'), err => err.code === 'changed' && err.vars.what === '上传图文')
  assert.equal(pressed(tab).length, 0)
})

test('页面停在登录页或验证码上：立即停，不点不填', async () => {
  for (const [snap, code] of [[SNAP({ href: 'https://creator.xiaohongshu.com/login' }), 'login'], [SNAP({ captcha: true }), 'captcha'], [SNAP({ href: 'https://example.com/' }), 'offsite']]) {
    const tab = fakeTab({ buttons: [{ id: 11, text: '暂存离开', box: [600, 850, 120, 40] }], snap })
    const page = createPage(tab, xiaohongshu, { pause: noPause, delay: () => 0 })
    await assert.rejects(page.click('暂存离开'), err => err.code === code)
    await assert.rejects(page.type('input', 'x'), err => err.code === code)
    assert.equal(tab.calls.filter(([method]) => method.startsWith('Input.')).length, 0)
  }
})

test('交文件：只交临时文件夹里的图片', async () => {
  const tab = fakeTab()
  const page = createPage(tab, xiaohongshu, { pause: noPause, delay: () => 0, fileRoot: '/data/fill-tmp' })
  await assert.rejects(page.upload('input', ['/etc/passwd']), err => err.code === 'files')
  await assert.rejects(page.upload('input', ['/data/fill-tmp/../secret.png']), err => err.code === 'files')
  await assert.rejects(page.upload('input', []), err => err.code === 'files')
  await page.upload('input', ['/data/fill-tmp/fill-0123456789abcdef.png'])
  assert.deepEqual(tab.calls.find(([method]) => method === 'DOM.setFileInputFiles')[1].files, ['/data/fill-tmp/fill-0123456789abcdef.png'])
  const none = createPage(fakeTab(), xiaohongshu, { pause: noPause, delay: () => 0 })
  await assert.rejects(none.upload('input', ['/data/fill-tmp/a.png']), err => err.code === 'files')
})

/* ───────────── 小红书流程（假页面） ───────────── */

function fakeXhsPage({ draftButton = true, hasTab = true, uploadedLag = 1, lists = {}, shot = { name: 'fill-xiaohongshu-20261117-101010.jpg' }, confirmDraft = true } = {}) {
  const log = []
  let state = 'start'
  let polls = 0
  let drafts = 0
  let uploaded = 0
  const values = {}
  const visits = []
  const body = () => values['.ProseMirror[contenteditable="true"]'] ?? ''
  return {
    log,
    visits,
    async rest() {},
    async waitFor(check, { what }) {
      for (let i = 0; i < 10; i += 1) { const v = await check(); if (v) return v }
      throw new FillError('timeout', { what })
    },
    // 只读列表页：查重看草稿箱和笔记管理，确认看草稿箱
    async visit(url) {
      visits.push(url)
      log.push(['visit', url])
      const custom = typeof lists === 'function' ? lists(url, { drafts }) : lists[url]
      if (custom instanceof Error) throw custom
      if (custom !== undefined) return { url, text: custom, href: url }
      if (url.includes('draft-manage')) {
        const title = values['input[placeholder*="标题"]'] ?? ''
        return { url, text: drafts > 0 && confirmDraft && title ? `草稿箱(${drafts})\n${title}\n刚刚\n编辑\n删除` : '草稿箱\n暂无草稿', href: url }
      }
      return { url, text: '笔记管理\n暂无笔记', href: url }
    },
    async snapshot() { log.push(['snapshot']); return shot },
    async count(selector) {
      if (selector.includes('type="file"')) return state === 'image' ? 1 : 0
      if (selector.includes('标题')) return state === 'editor' ? 1 : 0
      return 0
    },
    async has(text) {
      if (text === '上传图文') return hasTab
      if (text === '暂存离开') return state === 'editor' && draftButton
      return false
    },
    async click(text) {
      if (isDenied(text)) throw new Error(`clicked ${text}`)
      log.push(['click', text])
      if (text === '上传图文') state = 'image'
      if (text === '暂存离开') { state = 'image'; drafts += 1 }
    },
    async upload(selector, files) { log.push(['upload', files.length]); uploaded = files.length; state = 'uploading' },
    async text() {
      if (state === 'uploading') { polls += 1; if (polls > uploadedLag) state = 'editor'; return `${Math.min(polls, uploaded)}/${uploaded || 18} 上传中` }
      return `草稿箱(${drafts}) ${state === 'editor' ? `${uploaded}/18` : ''}`
    },
    async type(selector, text) { log.push(['type', selector, text]); values[selector] = text },
    async read(selector) { return values[selector] ?? '' },
    async insert(text) { log.push(['insert', text]); values['.ProseMirror[contenteditable="true"]'] = body() + text },
    async enter() { log.push(['enter']); values['.ProseMirror[contenteditable="true"]'] = body() + '\n' },
    async evaluate(expression) {
      // 打「#话题」后联想里选中的第一项：正好是刚打的那个，就返回「#该话题」
      if (String(expression).includes('is-selected')) {
        const last = body().trimEnd().split('\n').at(-1) ?? ''
        return last.startsWith('#') ? last : null
      }
      // 已识别成真话题的节点：列出正文里的 #话题
      if (String(expression).includes('topic')) return [...new Set((body().match(/[#＃]([^\s#＃]+)/g) ?? []).map(tag => tag.replace(/^[#＃]/, '')))]
      return null
    },
  }
}

test('小红书流程：查重 → 切图文 → 交图片 → 标题 → 正文和话题 → 回读核对 → 暂存离开 → 草稿箱确认，绝不点发布', async () => {
  const page = fakeXhsPage()
  const steps = []
  const content = xiaohongshu.content(xhsItem())
  const result = await xiaohongshu.fill(page, content, ['/t/a.png', '/t/b.png', '/t/c.png'], key => steps.push(key))
  assert.equal(result, 'saved')
  // 只点这两个按钮；「发布」「笔记预览」一次都没点
  assert.deepEqual(page.log.filter(row => row[0] === 'click').map(row => row[1]), ['上传图文', '暂存离开'])
  assert.deepEqual(page.log.find(row => row[0] === 'upload'), ['upload', 3])
  assert.equal(page.log.find(row => row[0] === 'type' && row[1].includes('标题'))[2], '我用 Agent 写周报')
  // 联想第一项正好是这个话题就按回车；不是的话补空格留成文字（这里的假页面都认）
  const inserts = page.log.filter(row => row[0] === 'insert').map(row => row[1])
  assert.deepEqual(inserts, ['#AI工具', '#Agent', '#效率提升'])
  // 查重只读两个列表页，确认再看一次草稿箱
  assert.equal(page.visits.filter(url => url.includes('draft-manage')).length, 2)
  assert.equal(page.visits.filter(url => url.includes('note-manager')).length, 1)
  assert.deepEqual([...new Set(steps)], ['check', 'tab', 'upload', 'title', 'body', 'tags', 'readback', 'shot', 'save', 'confirm'])
})

test('小红书流程：页面上没有暂存按钮时只填好，不点别的', async () => {
  const page = fakeXhsPage({ draftButton: false })
  const result = await xiaohongshu.fill(page, xiaohongshu.content(xhsItem()), ['/t/a.png'], () => {})
  assert.equal(result, 'filled')
  assert.deepEqual(page.log.filter(row => row[0] === 'click').map(row => row[1]), ['上传图文'])
})

test('小红书流程：草稿箱或笔记管理里已有同一篇（24 小时内）就停，不打开填写页、不点任何按钮', async () => {
  const page = fakeXhsPage({ lists: { 'https://creator.xiaohongshu.com/new/draft-manage': '草稿箱(1)\n我用 Agent 写周报\n今天 09:10\n编辑\n删除' } })
  const content = xiaohongshu.content(xhsItem())
  await assert.rejects(xiaohongshu.fill(page, content, ['/t/a.png'], () => {}), err => err.code === 'duplicate' && err.vars.title === '我用 Agent 写周报')
  // 两个列表页都只读看过，之后什么也没做（没开填写页、没点按钮、没交图片）
  assert.deepEqual(page.log.filter(row => row[0] === 'visit').map(row => row[1]).sort(), [
    'https://creator.xiaohongshu.com/new/draft-manage',
    'https://creator.xiaohongshu.com/new/note-manager',
  ])
  assert.equal(page.log.some(row => row[0] === 'click' || row[0] === 'upload' || row[0] === 'type'), false)
  // 超过 24 小时的不算重复：草稿箱里那篇是上周的，可以继续填；填完草稿箱多出今天这篇
  const old = fakeXhsPage({ lists: (url, { drafts }) => {
    if (!url.includes('draft-manage')) return undefined
    return drafts === 0 ? '草稿箱(1)\n我用 Agent 写周报\n2026-11-10 09:10\n编辑' : '草稿箱(2)\n我用 Agent 写周报\n刚刚\n编辑'
  } })
  const result = await xiaohongshu.fill(old, content, ['/t/a.png'], () => {})
  assert.equal(result, 'saved')
})

test('小红书流程：回读标题或正文对不上就停，绝不点「暂存离开」', async () => {
  for (const breakPage of [
    page => { page.read = async selector => (selector.includes('标题') ? '别的标题' : '') },
  ]) {
    const page = fakeXhsPage()
    breakPage(page)
    await assert.rejects(xiaohongshu.fill(page, xiaohongshu.content(xhsItem()), ['/t/a.png'], () => {}), err => err.code === 'readback' && err.vars.what === '标题')
    assert.equal(page.log.filter(row => row[0] === 'click').some(row => row[1] === '暂存离开'), false)
  }
  // 正文少了字，也对不上
  const page = fakeXhsPage()
  const original = page.type
  page.type = async (selector, text, options) => { await original(selector, selector.includes('ProseMirror') ? '只剩一句' : text, options) }
  await assert.rejects(xiaohongshu.fill(page, xiaohongshu.content(xhsItem()), ['/t/a.png'], () => {}), err => err.code === 'readback' && err.vars.what === '正文')
  assert.equal(page.log.filter(row => row[0] === 'click').some(row => row[1] === '暂存离开'), false)
  // 图片张数对不上：传完 3 张，回读时页面上只数到 1 张
  const few = fakeXhsPage()
  const realText = few.text
  let uploadSettled = false
  few.text = async () => {
    if (!uploadSettled) { const value = await realText(); if (value.includes('3/18') && !value.includes('上传中')) uploadSettled = true; return value }
    return '草稿箱(0) 1/18'
  }
  await assert.rejects(xiaohongshu.fill(few, xiaohongshu.content(xhsItem()), ['/t/a.png', '/t/b.png', '/t/c.png'], () => {}), err => err.code === 'readback' && err.vars.what === '图片张数')
  assert.equal(few.log.filter(row => row[0] === 'click').some(row => row[1] === '暂存离开'), false)
})

test('小红书流程：点了「暂存离开」但草稿箱里没确认到，就停，不再点第二次', async () => {
  const page = fakeXhsPage({ confirmDraft: false })
  await assert.rejects(xiaohongshu.fill(page, xiaohongshu.content(xhsItem()), ['/t/a.png'], () => {}), err => err.code === 'save-unconfirmed')
  assert.equal(page.log.filter(row => row[0] === 'click' && row[1] === '暂存离开').length, 1)
  // 点完还去草稿箱看过一次
  assert.equal(page.visits.filter(url => url.includes('draft-manage')).length, 2)
})

/* ───────────── 任务（假浏览器） ───────────── */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])

function fakeStore(item, filesDir) {
  const state = { items: [item] }
  return { state, filesDir, mutate: async (_label, fn) => fn(state), read: async () => state }
}

async function setup({ fill = async () => 'saved', item = xhsItem(), now } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'fill-'))
  const filesDir = join(root, 'files')
  await mkdir(filesDir, { recursive: true })
  const store = fakeStore(item, filesDir)
  const tab = { targetId: 'T1', activated: 0, send: async () => ({}), activate: async () => { tab.activated += 1 } }
  const opened = []
  // 用假流程替掉真实页面操作，测任务本身
  let current = fill
  const adapter = { ...xiaohongshu, fill: (...args) => current(...args) }
  const filler = new DraftFiller({
    root, store, pause: noPause, delay: () => 0, now,
    adapterOf: platform => (platform === '小红书' ? adapter : null),
    connect: async () => ({ close: async () => {} }),
    open: async (_browser, url) => { opened.push(url); return tab },
  })
  return { root, store, filler, tab, opened, useFill: (fn) => { current = fn } }
}

async function waitDone(filler, id) {
  for (let i = 0; i < 100 && filler.status(id).status === 'running'; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  return filler.status(id)
}

test('任务：存好草稿后记「已推到草稿」，临时图片删掉，标签页放到前台', async (t) => {
  const { root, store, filler, tab, opened, useFill } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  const name = await filler.saveImage(PNG)
  assert.match(name, /^fill-[a-f0-9]{16}\.png$/)
  useFill(async (page, content, files, step) => { step('upload', { n: files.length, total: files.length }); return 'saved' })
  const job = await filler.start({ item: store.state.items[0], platform: '小红书', images: [name] })
  const done = await waitDone(filler, job.id)
  assert.equal(done.status, 'done')
  assert.equal(done.result, 'saved')
  assert.deepEqual(opened, [xiaohongshu.url])
  assert.equal(tab.activated, 1)
  assert.equal(store.state.items[0].publish.小红书.state, 'drafted')
  assert.deepEqual((await readdir(join(root, 'fill-tmp'))), [])
  assert.deepEqual(done.steps.map(row => row.key), ['browser', 'open', 'upload', 'saved'])
})

test('任务：已发布的不退回草稿；只填好没存的记「已复制去发布」', async (t) => {
  const published = xhsItem()
  published.publish = { 小红书: { state: 'published' } }
  const first = await setup({ item: published })
  t.after(() => rm(first.root, { recursive: true, force: true }))
  first.useFill(async () => 'saved')
  const a = await first.filler.start({ item: published, platform: '小红书', images: [await first.filler.saveImage(PNG)] })
  await waitDone(first.filler, a.id)
  assert.equal(published.publish.小红书.state, 'published')

  const second = await setup()
  t.after(() => rm(second.root, { recursive: true, force: true }))
  second.useFill(async () => 'filled')
  const b = await second.filler.start({ item: second.store.state.items[0], platform: '小红书', images: [await second.filler.saveImage(PNG)] })
  await waitDone(second.filler, b.id)
  assert.equal(second.store.state.items[0].publish.小红书.state, 'copied')
})

test('任务：同一篇 60 秒内不重复填；正在填时不接第二篇', async (t) => {
  let clock = 1_000_000
  let release
  const { root, store, filler, useFill } = await setup({ now: () => clock })
  t.after(() => rm(root, { recursive: true, force: true }))
  useFill(() => new Promise((resolve) => { release = () => resolve('saved') }))
  const item = store.state.items[0]
  const job = await filler.start({ item, platform: '小红书', images: [await filler.saveImage(PNG)] })
  await assert.rejects(filler.start({ item: { ...item, id: 'i2' }, platform: '小红书', images: [await filler.saveImage(PNG)] }), err => err.status === 409)
  await new Promise(resolve => setTimeout(resolve, 10))
  release()
  await waitDone(filler, job.id)
  clock += REPEAT_MS - 1000
  await assert.rejects(filler.start({ item, platform: '小红书', images: [await filler.saveImage(PNG)] }), err => err.status === 429)
  clock += 2000
  release = null
  const again = await filler.start({ item, platform: '小红书', images: [await filler.saveImage(PNG)] })
  for (let i = 0; i < 100 && !release; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  release()
  assert.equal((await waitDone(filler, again.id)).status, 'done')
})

test('任务：内容不够、图片不对时不开浏览器', async (t) => {
  const { root, filler, opened } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  const long = xhsItem({ title: '这是一个特别特别特别特别特别长的小红书标题啊' })
  const job = await filler.start({ item: long, platform: '小红书', images: [await filler.saveImage(PNG)] })
  assert.equal(job.status, 'failed')
  assert.equal(job.error.code, 'title-long')
  await assert.rejects(filler.start({ item: xhsItem(), platform: '公众号', images: [] }), err => err.status === 400)
  await assert.rejects(filler.start({ item: xhsItem(), platform: '小红书', images: [] }), err => err.status === 400)
  await assert.rejects(filler.start({ item: xhsItem(), platform: '小红书', images: ['../state.json'] }), err => err.status === 400)
  await assert.rejects(filler.start({ item: xhsItem(), platform: '小红书', images: ['fill-0000000000000000.png'] }), err => err.status === 410)
  await assert.rejects(filler.start({ item: xhsItem(), platform: '小红书', images: Array.from({ length: 19 }, () => 'fill-0000000000000000.png') }), err => err.status === 400)
  await assert.rejects(filler.saveImage(Buffer.from('not a png')), err => err.status === 400)
  assert.deepEqual(opened, [])
})

test('任务：页面上出错时说清停在哪一步，标签页留着', async (t) => {
  const { root, store, filler, useFill } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  useFill(async (page, content, files, step) => { step('title'); throw new FillError('captcha') })
  const job = await filler.start({ item: store.state.items[0], platform: '小红书', images: [await filler.saveImage(PNG)] })
  const done = await waitDone(filler, job.id)
  assert.equal(done.status, 'failed')
  assert.deepEqual(done.error, { code: 'captcha', vars: {} })
  assert.equal(done.steps.at(-1).key, 'title')
  assert.equal(store.state.items[0].publish, undefined)
  assert.deepEqual(describeError(new Error('boom')), { code: 'other', vars: { message: 'boom' } })
  // 还没点到存草稿就停了：可以马上重试；点过存草稿再出错的，60 秒内不重复
  useFill(async (page, content, files, step) => { step('save'); throw new FillError('timeout', { what: '暂存结果' }) })
  const retry = await filler.start({ item: store.state.items[0], platform: '小红书', images: [await filler.saveImage(PNG)] })
  assert.equal((await waitDone(filler, retry.id)).error.code, 'timeout')
  await assert.rejects(filler.start({ item: store.state.items[0], platform: '小红书', images: [await filler.saveImage(PNG)] }), err => err.status === 429)
})

/* ───────────── 查重、回读、状态机（纯函数） ───────────── */

test('查重：标题一致或高度相似、24 小时内才算同一篇', () => {
  const now = Date.parse('2026-11-17T12:00:00+08:00')
  const seen = [
    { title: '我用 Agent 写周报', at: new Date(now - 3600e3).toISOString() },
    { title: '完全无关的另一篇', at: null },
  ]
  // 完全一致
  assert.equal(findDuplicate('我用 Agent 写周报', seen, { now }).item.title, '我用 Agent 写周报')
  // 加了标点、空格、后缀：折叠后一样，算同一篇
  assert.equal(findDuplicate('我用 Agent 写周报！', seen, { now }).score, 1)
  // 加了两个字的结尾：相似度还在 0.8 以上
  assert.ok(findDuplicate('我用 Agent 写周报啦好', seen, { now }))
  // 不同标题：不算
  assert.equal(findDuplicate('GPT-5 发布之后我换了什么', seen, { now }), null)
  // 时间超过 24 小时：不算重复
  const old = [{ title: '我用 Agent 写周报', at: new Date(now - 25 * 3600e3).toISOString() }]
  assert.equal(findDuplicate('我用 Agent 写周报', old, { now }), null)
  // 读不到时间的：当成在窗口里，停下来问一句
  assert.ok(findDuplicate('完全无关的另一篇', [{ title: '完全无关的另一篇', at: null }], { now }))
  // 空标题不命中
  assert.equal(titleSimilar('', '有标题'), 0)
  assert.equal(titleSimilar('短', '短'), 1)
})

test('回读比对：逐项核对标题、正文、话题数量、图片张数', () => {
  const want = { title: '我用 Agent 写周报', body: '第一句判断。\n\n第二段。', tags: ['AI工具', 'Agent'], images: 3 }
  assert.deepEqual(compareReadback(want, {
    title: '我用 Agent 写周报',
    // 页面把换行和空格压得不一样，去掉空白后一样就算对
    bodyText: '第一句判断。 第二段。 #AI工具 #Agent ',
    tags: ['AI工具', 'Agent'],
    images: 3,
  }), { ok: true, problems: [], skipped: [] })
  // 标题对不上
  let verdict = compareReadback(want, { title: '别的标题', bodyText: want.body, tags: want.tags, images: 3 })
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.problems.map(row => row.field), ['title'])
  // 正文少了一段
  verdict = compareReadback(want, { title: want.title, bodyText: '第一句判断。', tags: want.tags, images: 3 })
  assert.deepEqual(verdict.problems.map(row => row.field), ['body'])
  // 话题少了：正文里只打上一个、单独读回来也只一个，比要填的两个少
  verdict = compareReadback(want, { title: want.title, bodyText: `${want.body} #AI工具`, tags: ['AI工具'], images: 3 })
  assert.deepEqual(verdict.problems.map(row => row.field), ['tags'])
  // 图片张数对不上
  verdict = compareReadback(want, { title: want.title, bodyText: `${want.body} #AI工具 #Agent`, tags: want.tags, images: 2 })
  assert.deepEqual(verdict.problems.map(row => row.field), ['images'])
  // 读不到图片数：不比这一项，记下没验证
  verdict = compareReadback(want, { title: want.title, bodyText: `${want.body} #AI工具 #Agent`, tags: want.tags, images: null })
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.skipped, ['images'])
})

test('状态机：只能依次往下走，失败停在那一步，不回头', () => {
  const run = createFillRun()
  assert.deepEqual(run.state(), { step: null, status: 'running', error: null, done: [] })
  for (const key of FILL_STEPS) run.next(key)
  assert.equal(run.state().status, 'running')
  assert.deepEqual(run.state().done, FILL_STEPS.slice(0, -1))
  assert.throws(() => run.next('save'), /out of order/)
  assert.throws(() => run.next('不是一步'), /unknown fill step/)
  const bad = createFillRun()
  bad.next('check')
  bad.next('upload')
  bad.fail({ code: 'duplicate', vars: { title: 'x' } })
  assert.equal(bad.state().status, 'failed')
  assert.equal(bad.state().step, 'upload')
  assert.throws(() => bad.next('title'), /fill run is failed/)
})

test('截图：文件名带平台英文和时间；每个平台只留最近 5 张', () => {
  assert.equal(shotName('xiaohongshu', new Date(2026, 10, 17, 9, 5, 7)), 'fill-xiaohongshu-20261117-090507.jpg')
  const names = [
    ...Array.from({ length: 7 }, (_, i) => `fill-xiaohongshu-2026111${8}-01010${i}.jpg`),
    'fill-douyin-20261117-010101.jpg',
    'fill-xiaohongshu-not-a-date.jpg',
    'state.json',
  ]
  const drop = shotsToDrop(names, 'xiaohongshu')
  assert.equal(drop.length, 2)
  assert.deepEqual(drop, names.slice(0, 2))
  assert.deepEqual(shotsToDrop(names.slice(0, 3), 'xiaohongshu'), [])
  assert.deepEqual(shotsToDrop([], 'xiaohongshu'), [])
})

/* ───────────── 任务：截图存档与确认 ───────────── */

test('任务：点存草稿前给页面截图，存进 files 目录，每个平台最多留 5 张', async (t) => {
  const { root, store, filler, useFill, tab } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  const filesDir = store.filesDir
  // 先塞 6 张旧截图（比新拍的都早），传完应该只剩最近 5 张
  for (const name of Array.from({ length: 6 }, (_, i) => shotName('xiaohongshu', new Date(2026, 0, 1, 0, 0, i)))) {
    await writeFile(join(filesDir, name), Buffer.from('old'))
  }
  // 假标签页：Page.captureScreenshot 回一张 jpg
  tab.send = async (method) => (method === 'Page.captureScreenshot' ? { data: Buffer.from('jpg-bytes').toString('base64') } : {})
  useFill(async (page, content, files, step) => {
    const shot = await page.snapshot()
    step('shot', { name: shot.name })
    return 'saved'
  })
  const job = await filler.start({ item: store.state.items[0], platform: '小红书', images: [await filler.saveImage(PNG)] })
  const done = await waitDone(filler, job.id)
  assert.equal(done.status, 'done')
  const saved = await readdir(filesDir)
  const shots = saved.filter(name => name.startsWith('fill-xiaohongshu-'))
  assert.equal(shots.length, 5)
  assert.match(shots.sort().at(-1), /^fill-xiaohongshu-\d{8}-\d{6}\.jpg$/)
  assert.ok(Buffer.from(await readFile(join(filesDir, shots.sort().at(-1)))).equals(Buffer.from('jpg-bytes')))
})

test('任务：截图失败不影响流程，结果里注明', async (t) => {
  const { root, store, filler, useFill, tab } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  tab.send = async (method) => { if (method === 'Page.captureScreenshot') throw new Error('no shot'); return {} }
  useFill(async (page, content, files, step) => {
    const shot = await page.snapshot()
    step('shot', { error: shot.error })
    return 'saved'
  })
  const job = await filler.start({ item: store.state.items[0], platform: '小红书', images: [await filler.saveImage(PNG)] })
  const done = await waitDone(filler, job.id)
  assert.equal(done.status, 'done')
  assert.equal(done.result, 'saved')
  assert.equal(done.steps.find(row => row.key === 'shot').vars.error, 'no shot')
})

test('任务：点了存草稿没确认到，状态记需要人工确认，不再重试这一次', async (t) => {
  const { root, store, filler, useFill } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  useFill(async (page, content, files, step) => { step('save'); throw Object.assign(new Error('unconfirmed'), { code: 'save-unconfirmed', vars: {} }) })
  const item = store.state.items[0]
  const job = await filler.start({ item, platform: '小红书', images: [await filler.saveImage(PNG)] })
  const done = await waitDone(filler, job.id)
  assert.equal(done.status, 'failed')
  assert.equal(done.error.code, 'save-unconfirmed')
  assert.equal(done.confirmNeeded, true)
  // 已经点过一次：60 秒内不允许再点
  await assert.rejects(filler.start({ item, platform: '小红书', images: [await filler.saveImage(PNG)] }), err => err.status === 429)
})
