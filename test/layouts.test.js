import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { CARD_COVERS, CARD_TEMPLATES, cardContext, estimateFits, isTemplateCover, paginate, planSections, renderCard } from '../client/layouts/cards.js'
import { parseBlocks, parseInline } from '../client/layouts/markdown.js'
import { renderWechat } from '../client/layouts/wechat.js'
import { DEFAULT_THEME, THEME_ALIASES, YANQI_FONTS, YANQI_GROUPS, YANQI_THEMES, readableColor, resolveThemeId, themeSwatch, yanqiTheme } from '../client/layouts/yanqi.js'

const SAMPLE = [
  '# 重复的标题',
  '开头一段，**重点**和*语气*，还有 `npm test`。',
  '',
  '## 第一节',
  '- 第一条',
  '- 第二条',
  '',
  '1. 先做',
  '2. 再做',
  '',
  '> 一句引用',
  '',
  '| 平台 | 字数 |',
  '| --- | --- |',
  '| 公众号 | 3000 |',
  '',
  '### 小标题',
  '---',
  '```',
  'const a = 1',
  '```',
].join('\n')

const HOSTILE = [
  '<script>alert(1)</script>',
  '"onerror=alert(1) <img src=x onerror="alert(1)">',
  '## <b onclick="x">标题</b>',
  '- **<svg onload=alert(1)>**',
  '> `</code><script>`',
  '| <i>a</i> | b |',
  '| --- | --- |',
  '| "c" | d |',
  '[点我](javascript:alert(1))',
  '![x](javascript:alert(1))',
  '![y](https://example.com/track.png)',
  '==<iframe src=x>== ~~<style>~~',
].join('\n')

// 所有开始标签都带 style，没有 class（表格的结构标签和换行除外）
function assertInlineStyled(html) {
  for (const tag of html.match(/<(?!\/)(?!(?:br|thead|tbody|tr)>)[a-z0-9]+[^>]*>/g)) {
    assert.match(tag, /\sstyle="[^"]+"/, tag)
    assert.doesNotMatch(tag, /\sclass=/, tag)
  }
}

// 真正的标签里没有事件属性、链接和外部图片，标签名也只有排版用的那几种
const SAFE_TAGS = new Set(['section', 'div', 'span', 'sup', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'mark', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'img', 'svg', 'path', 'circle', 'polyline', 'line'])
function assertNoActiveHtml(html, where) {
  for (const tag of html.match(/<[a-z][^>]*>/gi)) {
    assert.ok(SAFE_TAGS.has(/^<([a-z0-9]+)/i.exec(tag)[1].toLowerCase()), `${where} ${tag}`)
    assert.doesNotMatch(tag, /\son[a-z]+\s*=|\shref\s*=|javascript:/i, `${where} ${tag}`)
    if (tag.startsWith('<img')) assert.match(tag, /\ssrc="data:image\//, `${where} ${tag}`)
  }
}

const runsText = runs => runs.map(run => run.text).join('')

test('parseBlocks / parseInline：块和行内片段', () => {
  assert.deepEqual(parseBlocks(SAMPLE).map(b => b.type), ['heading', 'paragraph', 'heading', 'list', 'list', 'quote', 'table', 'heading', 'rule', 'code'])
  assert.deepEqual(parseInline('a **b** *c* `d` [e](https://x.y)'), [
    { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' }, { text: 'd', code: true }, { text: ' ' }, { text: 'e', href: 'https://x.y' },
  ])
  assert.deepEqual(parseInline('~~删~~ ==亮== ![图](a.png)'), [{ text: '删', del: true }, { text: ' ' }, { text: '亮', mark: true }, { text: ' ' }, { text: '图' }])
  const blocks = parseBlocks('![配图](media-desk/files/a.png)\n- [ ] 未做\n- [x] 已做\n\n3. 三\n4. 四')
  assert.deepEqual(blocks[0], { type: 'image', alt: '配图', src: 'media-desk/files/a.png', line: 0, end: 0 })
  assert.deepEqual(blocks[1], { type: 'list', ordered: false, items: ['未做', '已做'], lines: [1, 2], line: 1, end: 2, tasks: [false, true] })
  assert.equal(blocks[2].start, 3)
})

test('言起主题：30 套全部带上，id 和名字不重复，默认是阿东信息流主题', async () => {
  assert.equal(YANQI_THEMES.length, 30)
  assert.equal(new Set(YANQI_THEMES.map(theme => theme.id)).size, 30)
  assert.equal(new Set(YANQI_THEMES.map(theme => theme.name)).size, 30)
  assert.equal(DEFAULT_THEME, 'adong-xhs-dense')
  assert.equal(YANQI_FONTS.length, 14)
  assert.deepEqual(YANQI_GROUPS, ['通用 / 极简', '信息流 / 社媒', '暗色 / 科技', '杂志 / 文艺', '东方 / 自然'])
  for (const theme of YANQI_THEMES) {
    assert.ok(YANQI_GROUPS.includes(theme.group), theme.id)
    assert.ok(theme.description, theme.id)
    const sw = themeSwatch(theme)
    assert.match(sw.bg, /^#|^rgb/, theme.id)
  }
  // 样式只能是普通 CSS：没有外链、没有标签、没有双引号（会打断 style="..."）
  const source = JSON.stringify(YANQI_THEMES) + JSON.stringify(YANQI_FONTS)
  assert.doesNotMatch(source, /url\(|<|>|\\"|@import|javascript:/i)
  // 只搬主题，不搬作者的个人资料
  const file = await readFile(new URL('../client/layouts/yanqi-themes.js', import.meta.url), 'utf8')
  assert.doesNotMatch(file, /userAvatar|donate|footerLeftText|footerRightText|notesTitle|data:image|阿东的大模型实验室|多搜索、多动手|Vibe Anything/)
  assert.match(file, /言起 YANQI/)
  assert.match(file, /Note to RED/)
})

test('主题 id：旧版三套的 id 是别名，不认识的退回默认', () => {
  for (const [alias, id] of Object.entries(THEME_ALIASES)) {
    assert.ok(YANQI_THEMES.some(theme => theme.id === id), alias)
    assert.equal(resolveThemeId(alias), id)
    assert.equal(renderWechat(SAMPLE, alias), renderWechat(SAMPLE, id))
  }
  assert.equal(yanqiTheme('nope').id, DEFAULT_THEME)
  assert.equal(renderWechat(SAMPLE, 'nope'), renderWechat(SAMPLE))
  assert.equal(renderWechat(SAMPLE), renderWechat(SAMPLE, 'adong-xhs-dense'))
})

test('renderWechat：30 套主题都输出带行内样式的标签，样式取自主题', () => {
  for (const theme of YANQI_THEMES) {
    const html = renderWechat(SAMPLE, theme.id)
    assertInlineStyled(html)
    assert.ok(html.startsWith('<section style="'), theme.id)
    assert.doesNotMatch(html, /重复的标题/)
    for (const tag of ['<p ', '<h2 ', '<h3 ', '<strong ', '<em ', '<code ', '<ul ', '<ol ', '<li ', '<blockquote ', '<table ', '<th ', '<td ', '<pre ', '<hr ']) assert.ok(html.includes(tag), `${theme.id} ${tag}`)
    assert.ok(html.includes('>重点</strong>'))
    assert.ok(html.includes('>npm test</code>'))
    assert.ok(html.includes('>3000</td>'))
    const s = theme.styles
    assert.ok(html.includes(`<strong style="${s.emphasis.strong}`), `${theme.id} strong`)
    assert.ok(html.includes(`<blockquote style="${s.quote}`), `${theme.id} quote`)
    assert.ok(html.includes(s.title.h3.content), `${theme.id} h3`)
    assert.ok(html.includes(s.table.header), `${theme.id} th`)
  }
})

test('renderWechat：暗色主题的底色放在外层 section 上，字号和字体可调', () => {
  for (const id of ['studio-volt', 'terminal-dark', 'vellum', 'default']) {
    const bg = /background-color:\s*([^;]+)/.exec(yanqiTheme(id).styles.imagePreview)[1]
    const root = /^<section style="([^"]+)"/.exec(renderWechat(SAMPLE, id))[1]
    assert.ok(root.includes(`background-color: ${bg}`), id)
    assert.match(root, /color: #/)
  }
  const html = renderWechat(SAMPLE, 'tech-blue', { fontSize: 18, font: '宋体' })
  assert.match(html, /<p style="[^"]*font-size: 18px;"/)
  assert.ok(html.includes("font-family: SimSun, '宋体', serif"))
  // 字号夹在范围里
  assert.match(renderWechat(SAMPLE, 'tech-blue', { fontSize: 99 }), /<p style="[^"]*font-size: 24px;"/)
})

test('代码块字色：和底色对比度不够时换成黑或白', () => {
  assert.equal(readableColor('#111827', '#f9fafb'), '#f9fafb')
  assert.equal(readableColor('#111827', '#1f2937'), '#f8fafc')
  assert.equal(readableColor('#f5f5f5', '#eeeeee'), '#111827')
  assert.equal(readableColor('rgba(0,0,0,0)', '#123456'), '#123456')
})

test('转义：模型输出里的 HTML、事件属性、javascript: 链接和外链图片都不会变成可执行的东西', () => {
  for (const theme of YANQI_THEMES) {
    const html = renderWechat(HOSTILE, theme.id)
    assertNoActiveHtml(html, theme.id)
    assertInlineStyled(html)
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.ok(html.includes('&quot;onerror=alert(1)'))
    assert.ok(html.includes('&lt;svg onload=alert(1)&gt;'))
  }
  for (const template of CARD_TEMPLATES) {
    const ctx = cardContext({ template: template.id, theme: 'terminal-dark' }, { name: '<img src=x onerror=alert(1)>', id: '"><script>', avatar: 'javascript:alert(1)', left: '<b>', right: '</div>' }, { date: '<i>', labels: { like: '<script>' } })
    assert.equal(ctx.signature.avatar, '')
    const pages = paginate(planSections(HOSTILE, { title: '<script>标题</script>', resolveImage: src => ({ src, width: 10, height: 10 }) }), estimateFits(ctx))
    for (const page of pages) assertNoActiveHtml(renderCard(page, ctx), template.id)
  }
})

test('图文卡片：30 套主题 × 12 套骨架 × 全部封面都能渲染', () => {
  const sections = planSections(SAMPLE, { title: '成稿标题' })
  for (const theme of YANQI_THEMES) {
    for (const template of CARD_TEMPLATES) {
      for (const cover of CARD_COVERS) {
        const ctx = cardContext({ theme: theme.id, template: template.id, cover: cover.id }, { name: '署名', id: '@id', left: '左', right: '右' }, { date: '2026/11/13' })
        const pages = paginate(sections, estimateFits(ctx))
        const html = renderCard(pages[0], ctx)
        assert.ok(html.startsWith('<div style="'), `${theme.id} ${template.id} ${cover.id}`)
        assert.ok(html.includes('data-part="body"'))
        assert.ok(html.includes(isTemplateCover(cover.id) ? '>成稿标题</div>' : '>成稿标题</span>'), `${theme.id} ${template.id} ${cover.id}`)
        if (!isTemplateCover(cover.id)) assert.ok(html.includes(theme.styles.title.h2.content))
      }
    }
  }
})

test('图文卡片：骨架、封面、署名各自生效，署名默认是空的', () => {
  const page = paginate(planSections('开头。\n\n## 一节\n正文', { title: '标题' }), () => true)[0]
  const render = (prefs, signature = {}) => renderCard(page, cardContext(prefs, signature, { date: '2026/11/13' }))

  const blank = cardContext({})
  assert.deepEqual(blank.signature, { name: '', id: '', avatar: '', left: '', right: '', showDate: true })
  assert.equal(blank.template, 'default')
  assert.equal(blank.cover, 'cover-bold')
  assert.equal(blank.size, 17)
  // 没填署名：不画名字、认证标和页脚文字
  const empty = render({})
  assert.doesNotMatch(empty, /<svg viewBox="0 0 22 22"/)
  assert.ok(empty.includes('2026/11/13'))

  const signed = render({}, { name: '小王', id: '@xw', left: '左边', right: '右边', avatar: 'data:image/png;base64,AAAA' })
  for (const text of ['>小王<', '>@xw<', '>左边<', '>|<', '>右边<', 'src="data:image/png;base64,AAAA"']) assert.ok(signed.includes(text), text)
  assert.doesNotMatch(render({}, { showDate: false }), /2026\/11\/13/)

  assert.ok(render({ template: 'xhs' }).includes('>点赞<'))
  assert.ok(render({ template: 'weibo' }).includes('>转发<'))
  assert.ok(render({ template: 'wechat' }).includes('>阅读原文<'))
  assert.ok(render({ template: 'notes' }).includes('>备忘录<'))
  assert.ok(render({ template: 'quote' }).includes('❝'))
  assert.ok(render({ template: 'terminal' }).includes('█'))
  assert.ok(render({ template: 'github' }).includes('View on GitHub'))
  assert.ok(render({ template: 'newspaper' }, { name: '小王' }).includes('—— 小王 ——'))
  assert.ok(render({ template: 'signature' }, { name: '小王' }).includes('—— '))
  // 极简无头和纯署名没有页眉：第一个子元素就是正文区
  for (const template of ['minimal-cover', 'signature']) assert.match(render({ template }, { name: '小王' }), /^<div style="[^"]+"><div style="flex: 1 1 auto;/)

  assert.match(render({ cover: 'cover-classic' }), /<h2 style="[^"]*font-size: 2.05em; text-align: center;"/)
  assert.match(render({ cover: 'cover-bold' }), /<h2 style="[^"]*font-size: 2.5em; text-align: left;"/)
  assert.ok(render({ cover: 'cover-number' }).includes('>01</div>'))
  assert.ok(render({ cover: 'cover-mag' }, { name: 'abc' }).includes('ABC · 2026/11/13'))
  assert.match(render({ cover: 'cover-min' }), /font-size: 1.85em/)
  // 封面样式只在第一页
  const second = paginate(planSections('开头。\n\n## 一节\n正文', { title: '标题' }), () => true)[1]
  assert.doesNotMatch(renderCard(second, cardContext({ cover: 'cover-number' })), />01</)
  assert.match(render({ font: '楷体', fontSize: 15 }), /font-family: KaiTi, '楷体', serif; font-size: 15px;/)
})

test('planSections：按「## 」拆节，「---」手动分页，配图回到对应小节，读不到的图跳过', () => {
  const article = '# 重复标题\n开头。\n\n## 为什么\n原因。\n\n---\n\n分页后。\n\n## 怎么做\n- 一\n\n![正文图](media-desk/files/b.png)\n\n![坏图](https://example.com/x.png)'
  const figures = [{ src: 'media-desk/files/a.png', caption: '配图', anchor: '为什么' }]
  const resolveImage = src => (src.startsWith('media-desk/') ? { src: `data:image/png;base64,${src.length}`, width: 100, height: 50 } : null)
  const sections = planSections(article, { title: '标题', figures, resolveImage })
  assert.deepEqual(sections.map(s => [s.kind, runsText(s.heading), s.blocks.map(b => b.type).join(',')]), [
    ['cover', '标题', 'paragraph'],
    ['content', '为什么', 'paragraph'],
    ['content', '为什么', 'paragraph,image'],
    ['content', '怎么做', 'list,image'],
  ])
  assert.equal(sections[2].blocks[1].alt, '配图')
  assert.equal(sections[3].blocks[1].width, 100)

  // 空正文只有封面
  for (const empty of ['', '  \n\n', '# 只有标题']) {
    const pages = paginate(planSections(empty, { title: '一篇空稿' }), () => true)
    assert.deepEqual(pages.map(p => [p.kind, runsText(p.heading), p.blocks.length, p.total]), [['cover', '一篇空稿', 0, 1]])
  }
})

test('paginate：放不下就拆，每页都放得下，不丢字，后续页重复小标题', () => {
  const sentence = '这是一句用来把版面撑满的中文句子，里面夹着 English words 和数字 2026。'
  const paragraphs = Array.from({ length: 12 }, (_, i) => `第${i + 1}段：${sentence.repeat(3)}`)
  const items = Array.from({ length: 18 }, (_, i) => `第 ${i + 1} 步，${sentence}`)
  const article = `开头。\n\n## 很长的一节\n${paragraphs.join('\n\n')}\n\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n### 结尾小标题\n最后一段。`
  for (const theme of YANQI_THEMES) {
    const ctx = cardContext({ theme: theme.id })
    const fits = estimateFits(ctx)
    const pages = paginate(planSections(article, { title: '长文' }), fits)
    const content = pages.filter(p => p.kind === 'content')
    assert.ok(content.length >= 4, `${theme.id} ${content.length}`)
    assert.ok(content.every(p => runsText(p.heading) === '很长的一节'))
    assert.deepEqual(content.map(p => p.continued), content.map((_, i) => i > 0))
    assert.deepEqual(pages.map(p => [p.number, p.total]), pages.map((_, i) => [i + 1, pages.length]))
    for (const page of pages) {
      assert.ok(page.blocks.length > 0 || page.kind === 'cover')
      assert.ok(fits(page) || page.blocks.length === 1, `${theme.id} 第 ${page.number} 页溢出`)
      assert.notEqual(page.blocks[page.blocks.length - 1]?.type === 'heading' && page.number < pages.length, true, `${theme.id} 小标题留在页尾`)
    }
    const blocks = content.flatMap(p => p.blocks)
    const text = blocks.filter(b => b.type === 'paragraph').map(b => runsText(b.runs)).join('').replace(/\s/g, '')
    assert.equal(text, [...paragraphs, '最后一段。'].join('').replace(/\s/g, ''))
    // 有序列表跨页时编号接着往下数
    const lists = blocks.filter(b => b.type === 'list')
    assert.equal(lists.reduce((sum, b) => sum + b.items.filter(item => !item.cont).length, 0), items.length)
    // 拆开的那一项在下一页接着写，不占新编号
    let next = 1
    for (const list of lists) {
      assert.equal(list.start, list.items[0].cont ? next - 1 : next, theme.id)
      next = list.start + list.items.length
    }
    assert.equal(lists.map(b => b.items.map(item => runsText(item.runs)).join('')).join('').replace(/\s/g, ''), items.join('').replace(/\s/g, ''))
  }
})

test('paginate：用传进来的 fits 判断，单个块放不下时按字拆在标点后', () => {
  // 每页最多 20 个字（标题不算）
  const fits = page => page.blocks.reduce((sum, b) => sum + runsText(b.runs ?? []).length, 0) <= 20
  const pages = paginate(planSections('## 一节\n一二三四五，六七八九十。一二三四五六七八九十一二三四五六七八九十', { title: 'T' }), fits)
  const texts = pages.filter(p => p.kind === 'content').map(p => runsText(p.blocks[0].runs))
  assert.deepEqual(texts, ['一二三四五，六七八九十。', '一二三四五六七八九十一二三四五六七八九十'])
  assert.ok(texts.every(text => text.length <= 20))
})

// ---------- 左边写、右边看：行号贯穿解析和切页 ----------

test('行号：每个块记下原文起止行，切页后的每页、预览里的块都带 data-line', async () => {
  const { lineAt, offsetOfLine } = await import('../client/layouts/markdown.js')
  const { pageAtLine } = await import('../client/layouts/cards.js')
  const text = '# 标题\n\n开头一段\n第二行\n\n## 第一节\n- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n```\ncode\n```\n\n## 第二节\n> 引用\n\n---\n\n分页后'
  const blocks = parseBlocks(text)
  assert.deepEqual(blocks.map(b => [b.type, b.line, b.end]), [['heading', 0, 0], ['paragraph', 2, 3], ['heading', 5, 5], ['list', 6, 7], ['table', 9, 11], ['code', 13, 15], ['heading', 17, 17], ['quote', 18, 18], ['rule', 20, 20], ['paragraph', 22, 22]])
  // 光标位置 ↔ 行号来回换
  for (let line = 0; line < text.split('\n').length; line += 1) assert.equal(lineAt(text, offsetOfLine(text, line)), line)
  assert.equal(lineAt(text, text.indexOf('第二行') + 1), 3)
  const pages = paginate(planSections(text, { title: '标题' }), () => true)
  assert.deepEqual(pages.map(p => [p.kind, runsText(p.heading), p.line]), [['cover', '标题', 0], ['content', '第一节', 5], ['content', '第二节', 17], ['content', '第二节', 22]])
  // 光标落在哪一行 → 哪一页
  assert.deepEqual([0, 3, 6, 12, 17, 19, 22, 99].map(line => pageAtLine(pages, line)), [0, 0, 1, 1, 2, 2, 3, 3])
  const ctx = cardContext({}, {}, { lines: true })
  const html = renderCard(pages[1], ctx)
  for (const line of [5, 6, 7, 9, 13]) assert.ok(html.includes(`data-line="${line}"`), `line ${line}`)
  // 导出和复制用的 HTML 不带行号
  assert.doesNotMatch(renderCard(pages[1], cardContext({})), /data-line|data-table|data-img/)
  assert.doesNotMatch(renderWechat(text), /data-line/)
})

test('行号：长段落、长列表跨页拆开时，后半页从拆开的那一行起算', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `第${i + 1}行，这是一句足够长的中文句子，用来把卡片撑满。`)
  const text = `## 一节\n${lines.join('\n')}\n\n${lines.map((line, i) => `- ${line}${i}`).join('\n')}`
  const ctx = cardContext({})
  const pages = paginate(planSections(text, { title: 'T' }), estimateFits(ctx))
  const content = pages.filter(p => p.kind === 'content')
  assert.ok(content.length >= 4)
  // 每页起始行单调不减，而且都在原文范围里
  const starts = content.map(p => p.line)
  assert.deepEqual([...starts].sort((a, b) => a - b), starts)
  assert.ok(starts.every(line => line >= 0 && line < text.split('\n').length))
  assert.ok(new Set(starts).size >= 3, starts.join(','))
})

test('嵌套列表和脚注：层级、编号、脚注按引用顺序编号并放在最后，全部转义', () => {
  const text = '- 一\n  - 一.1 <b>\n    1. 一.1.a\n  - 一.2\n- 二\n\n正文[^b]和[^a]，还有[^b]，没定义的[^x]。\n\n[^a]: 甲的说明 <script>\n[^b]: 乙的说明'
  const html = renderWechat(text)
  assert.match(html, /<ul[^>]*><li[^>]*>一<ul style="list-style-type: circle[^"]*"><li[^>]*>一\.1 &lt;b&gt;<ol style="list-style-type: lower-roman[^"]*"><li[^>]*>一\.1\.a<\/li><\/ol><\/li><li[^>]*>一\.2<\/li><\/ul><\/li><li[^>]*>二<\/li><\/ul>/)
  // b 先被引用，是 [1]；a 是 [2]；没定义的原样留着
  assert.match(html, /正文<sup[^>]*>\[1\]<\/sup>和<sup[^>]*>\[2\]<\/sup>，还有<sup[^>]*>\[1\]<\/sup>，没定义的\[\^x\]/)
  assert.ok(html.indexOf('乙的说明') > html.indexOf('没定义的'))
  assert.ok(html.indexOf('乙的说明') < html.indexOf('甲的说明'))
  assert.ok(html.includes('甲的说明 &lt;script&gt;'))
  assertNoActiveHtml(html, 'footnotes')
  // 卡片里也能切页、渲染
  const ctx = cardContext({})
  for (const page of paginate(planSections(text, { title: 'T' }), estimateFits(ctx))) assertNoActiveHtml(renderCard(page, ctx), 'card')
})

test('分页标题级别：一级 / 二级 / 三级都能切', () => {
  const text = '# 一\n甲\n## 二\n乙\n### 三\n丙\n## 四\n丁'
  const heads = level => paginate(planSections(text, { title: '成稿', headingLevel: level }), () => true).map(p => runsText(p.heading))
  assert.deepEqual(heads(1), ['成稿', '一'])
  assert.deepEqual(heads(2), ['成稿', '二', '四'])
  assert.deepEqual(heads(3), ['成稿', '三'])
  assert.deepEqual(heads(9), heads(2))
})

// ---------- 尺寸、日期、图片和表格调整 ----------

test('卡片尺寸：3:4 / 1:1 / 4:3 / 9:16 × 1080 / 1242 / 1350，排版尺寸和导出比例一致', async () => {
  const { CARD_RATIOS, EXPORT_TIERS, cardSize } = await import('../client/layouts/cards.js')
  assert.deepEqual(cardSize('3:4', 1080), { ratio: '3:4', tier: 1080, width: 450, height: 600, exportWidth: 1080, exportHeight: 1440 })
  assert.deepEqual([cardSize('3:4', 1242).exportWidth, cardSize('3:4', 1242).exportHeight], [1242, 1660])
  assert.deepEqual([cardSize('3:4', 1350).exportWidth, cardSize('3:4', 1350).exportHeight], [1350, 1800])
  for (const ratio of CARD_RATIOS) {
    for (const tier of EXPORT_TIERS) {
      const size = cardSize(ratio.id, tier)
      assert.ok(Math.abs(size.width / size.height - size.exportWidth / size.exportHeight) < 0.003, `${ratio.id} ${tier}`)
    }
  }
  assert.equal(cardSize('nope').ratio, '3:4')
})

test('日期格式：地区写法同言起，也认 YYYY / MM / DD 模板', async () => {
  const { formatDate } = await import('../client/layouts/cards.js')
  const d = new Date(2026, 10, 3)
  assert.equal(formatDate(d, 'YYYY.MM.DD'), '2026.11.03')
  assert.equal(formatDate(d, 'YYYY年M月D日'), '2026年11月3日')
  assert.equal(formatDate(d, 'zh-CN'), d.toLocaleDateString('zh-CN'))
  assert.equal(formatDate(d, '<script>'), d.toLocaleDateString('zh-CN'))
  const html = renderCard(paginate(planSections('a', { title: 'T' }), () => true)[0], cardContext({}, { showFooter: false, left: '左' }, { date: formatDate(d, 'YYYY-MM-DD') }))
  assert.ok(html.includes('2026-11-03'))
  assert.doesNotMatch(html, />左</)
})

test('图片调整：按图记忆平移、缩放、宽高，宽高不超过正文区，导出时照样画', async () => {
  const { bodyBox, cleanImageState, cleanTableScale, imageFrame } = await import('../client/layouts/cards.js')
  const { imageKey, tableKey } = await import('../client/layouts/yanqi.js')
  assert.deepEqual(cleanImageState({ s: 9, x: 1e9, y: -5, w: 10, h: 'x' }), { s: 3, x: 2000, y: -5, w: 60 })
  assert.deepEqual(cleanImageState(null), { s: 1, x: 0, y: 0 })
  assert.equal(cleanTableScale(0.1), 0.5)
  assert.equal(cleanTableScale(1.234), 1.23)
  assert.equal(imageKey('media-desk/files/a.png'), imageKey('media-desk/files/a.png'))
  assert.notEqual(imageKey('a'), imageKey('b'))
  assert.equal(tableKey(['a', 'b'], [['1', '2']]), tableKey(['a', 'b'], [['1', '2']]))
  const src = 'data:image/png;base64,AAAA'
  const sections = planSections('## 节\n![图](media-desk/files/a.png)', { title: 'T', resolveImage: () => ({ src, width: 1600, height: 900 }) })
  const block = sections[1].blocks[0]
  assert.equal(block.key, imageKey('media-desk/files/a.png'))
  for (const ratio of ['3:4', '1:1', '4:3', '9:16']) {
    const huge = cardContext({ ratio }, {}, { images: { [block.key]: { s: 1.5, x: 12, y: -8, w: 5000, h: 5000 } } })
    const frame = imageFrame(block, huge)
    assert.ok(frame.width <= bodyBox(huge).width && frame.height <= bodyBox(huge).height, ratio)
    const html = renderCard(paginate(sections, estimateFits(huge))[1], huge)
    assert.match(html, /transform: translate\(12px, -8px\) scale\(1\.5\)/)
  }
  // 表格缩放按表记忆，字号跟着变
  const tsec = planSections('## 节\n| a | b |\n| - | - |\n| 1 | 2 |', { title: 'T' })
  const key = tsec[1].blocks[0].key
  const big = renderCard(paginate(tsec, () => true)[1], cardContext({ fontSize: 16 }, {}, { tables: { [key]: 1.5 } }))
  assert.match(big, /<td style="[^"]*font-size: 24px;"/)
})

test('宽表格：列数多时按正文宽缩字号，整张表留在卡里，不把每列压成竖排', () => {
  const head = ['商品', 'SKU', '官网价', '教育优惠', '国补', '以旧换新', '到手价', '备注']
  const row = ['MacBook Pro M6', '100439776992', '15999', '-800', '-1500', '-1000', '12699', '16G 1T']
  const md = `## 八列表\n| ${head.join(' | ')} |\n| ${head.map(() => '-').join(' | ')} |\n| ${row.join(' | ')} |`
  const sections = planSections(md, { title: 'T' })
  const ctx = cardContext({})
  const html = renderCard(paginate(sections, estimateFits(ctx))[1], ctx)
  const sizes = [...html.matchAll(/font-size: ([\d.]+)px/g)].map(m => Number(m[1]))
  // 8 列在 450px 的卡里排不下：字号一定被缩小，而且不小于下限
  const cellSizes = [...html.matchAll(/<t[dh] style="[^"]*font-size: ([\d.]+)px/g)].map(m => Number(m[1]))
  assert.ok(cellSizes.length >= 8)
  assert.ok(cellSizes.every(size => size < 16 && size >= 8), `cell sizes ${cellSizes.join(',')}`)
  // 不落到横向滚动（导出成图片时会出现一条滚不动的滚动条、正文被切掉）
  assert.doesNotMatch(html, /overflow-x: auto/)
  assert.ok(sizes.length > 0)
})

test('宽表格：空列先去掉；缩到 8px 还放不下就等分列宽折行，不滚动也不裁切', () => {
  const head = ['商品', '', 'SKU', '', '官网价', '', '教育优惠', '', '国补', '', '以旧换新', '', '到手价', '', '备注', '', '额外说明', '']
  const row = ['MacBook Pro M6', '', '100439776992', '', '15999', '', '-800', '', '-1500', '', '-1000', '', '12699', '', '16G 1T', '', '国补要看地区', '']
  const md = `## 宽表\n| ${head.join(' | ')} |\n| ${head.map(() => '-').join(' | ')} |\n| ${row.join(' | ')} |`
  const ctx = cardContext({})
  const html = renderCard(paginate(planSections(md, { title: 'T' }), estimateFits(ctx))[1], ctx)
  // 仍然是表格；空列被去掉；满宽、固定列宽、按字折行，不出现横向滚动
  assert.match(html, /<table/)
  assert.match(html, /table-layout: fixed/)
  assert.doesNotMatch(html, /overflow-x: auto/)
  assert.ok(html.includes('MacBook Pro M6') && html.includes('100439776992') && html.includes('国补要看地区'))
  // 4 个空列对应的 <th> 不该出现：9 个有内容的列
  assert.equal([...html.matchAll(/<th /g)].length, 9)
})

test('背景图：只收 data:image，缩放和位置写进卡片根节点', () => {
  const page = paginate(planSections('a', { title: 'T' }), () => true)[0]
  const ok = renderCard(page, cardContext({}, {}, { background: { src: 'data:image/jpeg;base64,AAAA', scale: 1.2, x: 10, y: -4 } }))
  assert.match(ok, /^<div style="[^"]*background-image: url\(data:image\/jpeg;base64,AAAA\); background-size: 120%; background-position: 10px -4px; background-repeat: no-repeat/)
  for (const src of ['https://evil.example/x.png', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'data:image/png;base64,AA)A;color:red']) {
    assert.doesNotMatch(renderCard(page, cardContext({}, {}, { background: { src, scale: 1, x: 0, y: 0 } })), /background-image: url/, src)
  }
})

// ---------- ZIP ----------

test('ZIP：只存不压，中文文件名，CRC 对得上，来回读出来一样', async () => {
  const { crc32, makeZip, readZip } = await import('../client/layouts/zip.js')
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const files = [
    { name: '图文卡片-01.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: '../../etc/passwd', data: new TextEncoder().encode('x') },
    { name: '图文卡片-01.png', data: new Uint8Array(70000).map((_, i) => i % 251) },
  ]
  const zip = makeZip(files, { date: new Date(2026, 10, 13, 9, 30) })
  const back = readZip(zip)
  assert.deepEqual(back.map(file => file.name), ['图文卡片-01.png', 'etc/passwd', '图文卡片-01-2.png'])
  back.forEach((file, i) => assert.deepEqual([...file.data], [...files[i].data]))
  // 系统自带的 unzip 也认（有的话）
  const { execFileSync } = await import('node:child_process')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'yq-zip-'))
  try {
    await writeFile(join(dir, 'a.zip'), zip)
    let out = ''
    try {
      out = execFileSync('unzip', ['-t', join(dir, 'a.zip')], { encoding: 'utf8' })
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    if (out) assert.match(out, /No errors detected/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------- 我的主题 ----------

test('我的主题：30 套内置主题都能当底稿保存；危险写法一律拒收', async () => {
  const { validateLayoutTheme, cleanThemeCss } = await import('../src/layout-theme.js')
  for (const theme of YANQI_THEMES) {
    const saved = validateLayoutTheme({ ...theme, id: `my-${theme.id}`, name: theme.name })
    assert.equal(saved.styles.paragraph, cleanThemeCss(theme.styles.paragraph))
    // 洗过的主题拿去排版也正常
    assertInlineStyled(renderWechat(SAMPLE, saved.id, { themes: [saved] }))
  }
  const base = YANQI_THEMES[0]
  const withStyle = (path, value) => {
    const styles = structuredClone(base.styles)
    const keys = path.split('.')
    keys.slice(0, -1).reduce((node, key) => node[key], styles)[keys[keys.length - 1]] = value
    return { id: 'my-test', name: '测试', styles }
  }
  const hostile = [
    ['paragraph', 'color: red; background: url(https://evil.example/x.png)'],
    ['paragraph', 'background-image: url(data:image/png;base64,AAAA)'],
    ['imagePreview', 'background-image: url(data:text/html;base64,PHNjcmlwdD4=)'],
    ['imagePreview', 'background-image: url(javascript:alert(1))'],
    ['quote', 'width: expression(alert(1))'],
    ['quote', '@import "x.css"; color: red'],
    ['quote', 'color: red</style><script>alert(1)</script>'],
    ['quote', 'color: red; /* x */'],
    ['quote', 'color: \\72 ed'],
    ['quote', 'behavior: url(x.htc)'],
    ['quote', '-moz-binding: url(x)'],
    ['quote', 'color: &#114;ed'],
    ['link', 'color: red; background: image-set("x.png" 1x)'],
  ]
  for (const [path, value] of hostile) assert.throws(() => validateLayoutTheme(withStyle(path, value)), /不允许|data:image/, `${path}: ${value}`)
  // 不认识的属性、带花括号的残片、未知函数：丢掉那一条，别的留着
  const cleaned = validateLayoutTheme(withStyle('paragraph', 'color: #123456; position: fixed; top: 0; foo: bar; &:hover { color: red }; color: var(--x); font-size: attr(x)'))
  assert.equal(cleaned.styles.paragraph, 'color: #123456; position: fixed;')
  // 底图可以是 data:image
  const bg = validateLayoutTheme(withStyle('imagePreview', 'background-color: #fff; background-image: url(data:image/png;base64,AAAA)'))
  assert.match(bg.styles.imagePreview, /url\(data:image\/png;base64,AAAA\)/)
  // id、名字、结构
  assert.throws(() => validateLayoutTheme({ ...withStyle('paragraph', 'color: red'), id: 'default' }), /my-/)
  assert.throws(() => validateLayoutTheme({ ...withStyle('paragraph', 'color: red'), name: '  ' }), /名称/)
  assert.throws(() => validateLayoutTheme({ id: 'my-x', name: 'x', styles: { paragraph: 'color: red' } }), /缺少/)
  assert.throws(() => validateLayoutTheme({ ...withStyle('paragraph', 'color: red'), styles: { ...base.styles, title: 'x' } }), /缺少|格式/)
  assert.equal(validateLayoutTheme({ ...withStyle('paragraph', 'color: red'), name: '<b>我的</b>' }).name, 'b我的/b')
})

test('我的主题：save_layout_theme / delete_layout_theme 走统一写入口，有上限', async () => {
  const { applyOps } = await import('../src/ops.js')
  const state = { items: [] }
  const theme = { ...structuredClone(YANQI_THEMES[3]), id: 'my-warm', name: '暖色' }
  let out = applyOps(state, [{ op: 'save_layout_theme', theme }])
  assert.deepEqual(out.errors, [])
  assert.equal(state.layoutThemes.length, 1)
  // 同 id 是更新，不是新增
  applyOps(state, [{ op: 'save_layout_theme', theme: { ...theme, name: '暖色 2' } }])
  assert.deepEqual(state.layoutThemes.map(row => row.name), ['暖色 2'])
  out = applyOps(state, [{ op: 'save_layout_theme', theme: { ...theme, id: 'my-bad', styles: { ...theme.styles, quote: 'color: red; background: url(https://x.y/z.png)' } } }])
  assert.equal(out.errors.length, 1)
  assert.equal(state.layoutThemes.length, 1)
  for (let i = 0; i < 40; i += 1) applyOps(state, [{ op: 'save_layout_theme', theme: { ...theme, id: `my-t${i}` } }])
  assert.equal(state.layoutThemes.length, 30)
  out = applyOps(state, [{ op: 'delete_layout_theme', id: 'my-warm' }, { op: 'delete_layout_theme', id: 'my-nope' }])
  assert.equal(out.errors.length, 1)
  assert.ok(!state.layoutThemes.some(row => row.id === 'my-warm'))
})

test('主题编辑器：旋钮改的是对应的 CSS，改完能通过校验', async () => {
  const { THEME_KNOBS, applyKnob, knobValue, setDecl, toHex } = await import('../client/layouts/theme-edit.js')
  const { validateLayoutTheme } = await import('../src/layout-theme.js')
  assert.equal(setDecl('color: red; margin: 0', 'color', '#123456'), 'color: #123456; margin: 0;')
  assert.equal(setDecl('margin: 0', 'color', '#123456'), 'margin: 0; color: #123456;')
  assert.equal(toHex('rgba(255, 0, 16, 0.9)'), '#ff0010')
  for (const theme of YANQI_THEMES) {
    let styles = theme.styles
    for (const knob of THEME_KNOBS) {
      const value = knob.kind === 'color' ? '#3366cc' : knob.max
      styles = applyKnob(styles, knob, value)
      assert.equal(knobValue(styles, knob), knob.kind === 'color' ? '#3366cc' : knob.max, `${theme.id} ${knob.id}`)
    }
    // 原主题没被改
    assert.notEqual(styles, theme.styles)
    validateLayoutTheme({ id: 'my-x', name: 'x', styles })
  }
  // 不是颜色的值不改
  assert.equal(applyKnob(YANQI_THEMES[0].styles, THEME_KNOBS[0], 'red;background:url(x)'), YANQI_THEMES[0].styles)
})

// ---------- 图床 ----------

function fakeResponse(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body : JSON.stringify(body)
  return new Response(text, { status, headers })
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d40000000049454e44ae426082', 'hex')

test('图床设置：校验、令牌不发给浏览器', async () => {
  const { cleanImageHost, publicImageHost, IMAGE_HOST_DEFAULTS } = await import('../src/image-host.js')
  const { publicSettings } = await import('../src/settings.js')
  const next = cleanImageHost(IMAGE_HOST_DEFAULTS, { mode: 'custom', endpoint: 'https://img.example.com/api/v1/upload', field: 'file', header: 'Authorization', token: 'Bearer abc123', urlPath: 'data.links.url' })
  assert.equal(next.token, 'Bearer abc123')
  assert.deepEqual(publicImageHost(next), { mode: 'custom', endpoint: 'https://img.example.com/api/v1/upload', field: 'file', header: 'Authorization', urlPath: 'data.links.url', allowPrivate: false, hasToken: true })
  // 空令牌不改，clearToken 才删
  assert.equal(cleanImageHost(next, { token: '' }).token, 'Bearer abc123')
  assert.equal(cleanImageHost(next, { clearToken: true }).token, '')
  for (const bad of [{ mode: 'ftp' }, { endpoint: 'ftp://x' }, { endpoint: 'https://u:p@x.example' }, { field: 'a b' }, { header: 'Cookie' }, { header: 'x y' }, { urlPath: 'a;b' }, { token: '中文' }]) {
    assert.throws(() => cleanImageHost(next, bad), undefined, JSON.stringify(bad))
  }
  const pub = publicSettings({ image: { apiKey: '' }, wechat: {}, wechatsync: {}, imageHost: next })
  assert.doesNotMatch(JSON.stringify(pub), /abc123/)
  assert.equal(pub.imageHost.hasToken, true)
})

test('图床上传：自定义图床发 multipart，按路径取地址，同一张图只传一次', async () => {
  const { ImageHostCache, pickPath, uploadImage } = await import('../src/image-host.js')
  assert.equal(pickPath({ data: { links: [{ url: 'u' }] } }, 'data.links[0].url'), 'u')
  assert.equal(pickPath({ data: null }, 'data.url'), undefined)
  assert.equal(pickPath({ ['__proto__']: 1 }, 'constructor'), undefined)
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return fakeResponse(200, { status: true, data: { links: { url: 'https://img.example.com/i/abc.png' } } })
  }
  const settings = { imageHost: { mode: 'custom', endpoint: 'https://img.example.com/api/v1/upload', field: 'image', header: 'Authorization', token: 'Bearer t0k', urlPath: 'data.links.url' } }
  const cache = new ImageHostCache(null)
  const first = await uploadImage({ settings, buffer: PNG, cache, fetchImpl })
  assert.deepEqual(first, { url: 'https://img.example.com/i/abc.png', cached: false })
  const { init } = calls[0]
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, 'Bearer t0k')
  const boundary = /boundary=(.+)$/.exec(init.headers['content-type'])[1]
  const body = init.body.toString('latin1')
  assert.ok(body.startsWith(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`))
  assert.ok(init.body.includes(PNG))
  assert.ok(body.endsWith(`--${boundary}--\r\n`))
  const again = await uploadImage({ settings, buffer: PNG, cache, fetchImpl })
  assert.deepEqual(again, { url: 'https://img.example.com/i/abc.png', cached: true })
  assert.equal(calls.length, 1)
  // 返回里找不到地址、不是 JSON、HTTP 出错：都给出能看懂的错，不带令牌
  for (const res of [fakeResponse(200, { data: {} }), fakeResponse(200, 'not json'), fakeResponse(500, 'oops Bearer t0k')]) {
    await assert.rejects(uploadImage({ settings, buffer: Buffer.concat([PNG, Buffer.from([calls.length])]), fetchImpl: async () => res }), (err) => {
      assert.doesNotMatch(err.message, /t0k/)
      return true
    })
  }
  await assert.rejects(uploadImage({ settings, buffer: Buffer.from('hello'), fetchImpl }), /格式/)
  await assert.rejects(uploadImage({ settings: { imageHost: { mode: 'none' } }, buffer: PNG, fetchImpl }), /图床/)
})

test('图床上传：没勾「本机/内网图床」时连不了内网地址；公众号素材接口走 uploadimg', async () => {
  const { uploadImage, hostArticleImages } = await import('../src/image-host.js')
  const { clearTokenCache } = await import('../src/wechat.js')
  // 不传 fetchImpl：走 safeFetch，内网 IP 在连接前就被拦下，不会真的发请求
  await assert.rejects(uploadImage({ settings: { imageHost: { mode: 'custom', endpoint: 'http://127.0.0.1:36677/upload' } }, buffer: PNG }), /本机或内网/)
  await assert.rejects(uploadImage({ settings: { imageHost: { mode: 'custom', endpoint: 'http://192.168.1.10/upload' } }, buffer: PNG }), /本机或内网/)
  clearTokenCache()
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(url)
    if (url.includes('stable_token')) return fakeResponse(200, { access_token: 'TOKEN123', expires_in: 7200 })
    if (url.includes('media/uploadimg')) {
      assert.ok(String(init.headers['content-type']).startsWith('multipart/form-data; boundary='))
      assert.match(init.body.toString('latin1'), /name="media"; filename="image\.png"/)
      return fakeResponse(200, { url: 'http://mmbiz.qpic.cn/mmbiz_png/abc/0?wx_fmt=png' })
    }
    return fakeResponse(404, {})
  }
  const settings = { wechat: { appId: 'wx0123456789abcdef', appSecret: 'secret0123456789' }, imageHost: { mode: 'none' } }
  const out = await uploadImage({ settings, buffer: PNG, fetchImpl, mode: 'wechat' })
  assert.equal(out.url, 'https://mmbiz.qpic.cn/mmbiz_png/abc/0?wx_fmt=png')
  assert.ok(calls.some(url => /cgi-bin\/media\/uploadimg\?access_token=TOKEN123$/.test(url)))
  await assert.rejects(uploadImage({ settings, buffer: Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]), fetchImpl, mode: 'wechat' }), /1MB/)
  // 推草稿前换地址：工作台图片和公网图片都换成公众号地址，读不到的去掉
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'yq-host-'))
  try {
    await writeFile(join(dir, 'f_a.png'), PNG)
    const html = '<p><img src="media-desk/files/f_a.png" alt=""></p><p><img src="media-desk/files/f_missing.png"></p><p><img src="https://raw.example.com/x.png?a=1&amp;b=2"></p><p><img src="https://mmbiz.qpic.cn/keep.png"></p>'
    const remoteFetch = async url => (url === 'https://raw.example.com/x.png?a=1&b=2' ? fakeResponse(200, Buffer.concat([PNG, Buffer.from([7])]), { 'content-type': 'image/png' }) : fakeResponse(404, ''))
    const result = await hostArticleImages({ html, settings, filesDir: dir, fetchImpl, remoteFetch })
    assert.equal((result.html.match(/src="https:\/\/mmbiz\.qpic\.cn\/mmbiz_png\/abc\/0\?wx_fmt=png"/g) ?? []).length, 2)
    assert.ok(result.html.includes('src="https://mmbiz.qpic.cn/keep.png"'))
    assert.doesNotMatch(result.html, /f_missing|raw\.example/)
    assert.deepEqual(Object.keys(result.errors), ['media-desk/files/f_missing.png'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('公众号正文清洗：只留公众号图片地址的 <img>，别的图片地址整个去掉', async () => {
  const { sanitizeArticleHtml } = await import('../src/sanitize.js')
  const out = sanitizeArticleHtml('<p><img src="https://mmbiz.qpic.cn/a.png" onerror="x" style="max-width: 100%; background: url(x)"><img src="https://evil.example/a.png"><img src="javascript:alert(1)"><img src="media-desk/files/a.png"></p><sup style="font-size: 0.75em">[1]</sup>')
  assert.equal(out, '<p><img src="https://mmbiz.qpic.cn/a.png"></p><sup style="font-size: 0.75em">[1]</sup>')
})

test('长文的图片：预览直接显示，复制时换成图床地址，没有图床的本地图列进 missing', async () => {
  const { localImages, wechatParts } = await import('../client/layouts/wechat.js')
  const text = '![本地](media-desk/files/a.png)\n\n![外链](https://raw.example.com/b.png)\n\n![相对](imgs/c.png)'
  assert.deepEqual(localImages(text, [{ src: 'media-desk/files/fig.png' }, { src: 'https://x.y/z.png' }]), ['media-desk/files/a.png', 'media-desk/files/fig.png'])
  const preview = wechatParts(text, undefined, { images: 'preview' })
  assert.equal(preview.blocks.filter(block => block.html.includes('<img')).length, 2)
  const copy = wechatParts(text, undefined, { images: { 'media-desk/files/a.png': 'https://img.example.com/a.png' } })
  const html = copy.blocks.map(block => block.html).join('')
  assert.ok(html.includes('src="https://img.example.com/a.png"'))
  assert.ok(html.includes('src="https://raw.example.com/b.png"'))
  assert.deepEqual(copy.missing, ['相对'])
  const none = wechatParts(text, undefined, { images: {} })
  assert.deepEqual(none.missing, ['本地', '相对'])
  const draft = wechatParts(text, undefined, { images: 'draft' }).blocks.map(block => block.html).join('')
  assert.ok(draft.includes('src="media-desk/files/a.png"') && draft.includes('src="https://raw.example.com/b.png"'))
})

// ---------- 封面 ----------

test('自动排字：均衡断行，不把标点、虚词放到行首，字号随框变，放不下时截断', async () => {
  const { balance, fitText, textWidth } = await import('../client/layouts/fit.js')
  const title = '我的 Agent 学习路线 5k star 了，聊聊 Agent 面试的深水区'
  for (let n = 2; n <= 4; n += 1) {
    const lines = balance(title, n)
    assert.ok(lines.length <= n)
    assert.equal(lines.join('').replace(/\s/g, ''), title.replace(/\s/g, ''))
    for (const line of lines.slice(1)) assert.doesNotMatch(line, /^[，。！？；：、,.!?;:了的吗呢吧]/, line)
    const widths = lines.map(line => textWidth(line))
    assert.ok(Math.max(...widths) / Math.min(...widths) < 2.2, JSON.stringify(lines))
  }
  const big = fitText('AI', 380, 300, { maxLines: 3, max: 120 })
  const small = fitText(title, 380, 300, { maxLines: 3, max: 120 })
  assert.ok(big.size > small.size)
  for (const fit of [big, small]) assert.ok(fit.fits && fit.width <= 380 && fit.height <= 300)
  const tag = fitText('一个特别特别特别特别长的标签文字', 60, 16, { maxLines: 1, max: 12, min: 9, ellipsis: true })
  assert.ok(tag.lines[0].endsWith('…') && tag.width <= 60)
})

test('新封面：11 种 × 4 种比例 × 30 套主题 × 长短标题，字都在框里、放得下、对比度够', async () => {
  const { COVER_TEMPLATES, coverLayout } = await import('../client/layouts/covers.js')
  const { CARD_RATIOS, bodyBox } = await import('../client/layouts/cards.js')
  const { contrastRatio } = await import('../client/layouts/yanqi.js')
  assert.ok(COVER_TEMPLATES.length >= 8)
  const titles = ['AI', '我的 Agent 学习路线 5k star 了，聊聊 Agent 面试的深水区', 'Claude Code vs Codex：到底该选哪个？', '3 个月从 0 到 1 万粉，我做对了什么', 'Why the 48,000-character article still scrolls smoothly in the editor preview pane']
  let boxes = 0
  for (const ratio of CARD_RATIOS) {
    for (const theme of YANQI_THEMES) {
      for (const template of COVER_TEMPLATES) {
        for (const title of titles) {
          const ctx = cardContext({ theme: theme.id, ratio: ratio.id, cover: template.id, template: 'xhs' })
          const body = bodyBox(ctx)
          const data = { title, kicker: '示例 AI 周刊', tag: '干货', number: '06', headings: ['先搞清楚问题', '再写一套非常非常长的评测集合', '最后上线监控', '复盘'], image: template.slots.includes('image') ? { src: 'data:image/png;base64,AAAA', key: 'i1' } : null }
          const out = coverLayout(template.id, body, data, { theme, font: 'sans-serif' })
          const where = `${ratio.id} ${theme.id} ${template.id} ${title.slice(0, 8)}`
          assert.ok(out.boxes.some(box => box.role === 'title' || box.role === 'side'), where)
          for (const box of out.boxes) {
            boxes += 1
            assert.ok(box.fits, `${where} ${box.role} 放不下`)
            assert.ok(box.x >= -0.5 && box.y >= -0.5 && box.x + box.w <= body.width + 0.5 && box.y + box.h <= body.height + 0.5, `${where} ${box.role} 出框`)
            if (!box.decorative) assert.ok(contrastRatio(box.fg, box.bg) >= (box.size >= 24 ? 3 : 4.5), `${where} ${box.role} 对比度 ${contrastRatio(box.fg, box.bg).toFixed(2)}`)
          }
          assertNoActiveHtml(out.html, where)
        }
      }
    }
  }
  assert.ok(boxes > 20000)
})

test('新封面：拆出对比两边、找出标题里的数字；封面检查按规则打勾', async () => {
  const { coverChecks, coverLayout, findNumber, splitVersus, titleLength } = await import('../client/layouts/covers.js')
  const { bodyBox, checkCover } = await import('../client/layouts/cards.js')
  assert.deepEqual(splitVersus('Claude Code vs Codex：到底该选哪个？'), ['Claude Code', 'Codex：到底该选哪个'])
  assert.deepEqual(splitVersus('自己写还是让 AI 写'), ['自己写', '让 AI 写'])
  assert.deepEqual(splitVersus('前 | 后'), ['前', '后'])
  assert.equal(splitVersus('没有对比'), null)
  assert.deepEqual(findNumber('3 个月从 0 到 1 万粉'), { value: '3 个', rest: '月从 0 到 1 万粉' })
  assert.equal(findNumber('涨了 90% 的流量').value, '90%')
  assert.equal(findNumber('5k star').value, '5k')
  assert.equal(findNumber('没有数字'), null)
  assert.equal(titleLength('Agent 面试'), 5)
  // 新封面那页只有封面，开头几段挪到第 2 页
  const sections = planSections('开头一段。\n\n## 一\n正文', { title: '我的 Agent 学习路线 5k star 了' })
  const { applyCoverMode } = await import('../client/layouts/cards.js')
  const moved = applyCoverMode(sections, 'cover-poster')
  assert.deepEqual(moved.map(s => [s.kind, s.blocks.length, runsText(s.heading)]), [['cover', 0, '我的 Agent 学习路线 5k star 了'], ['content', 1, ''], ['content', 1, '一']])
  assert.equal(applyCoverMode(sections, 'cover-bold'), sections)
  const ctx = cardContext({ cover: 'cover-poster', theme: 'adong-xhs-dense' }, {}, { article: '我的学习路线 5k star 了', cover: { tag: '干货' } })
  const page = paginate(moved, estimateFits(ctx))[0]
  const checks = checkCover(page, ctx)
  const by = Object.fromEntries(checks.map(row => [row.id, row]))
  assert.equal(by.length.state, 'warn')
  assert.equal(by.contrast.state, 'ok')
  assert.equal(by.fit.state, 'ok')
  assert.equal(by.claims.state, 'ok')
  // 旧的 5 种封面也有检查
  assert.ok(checkCover(paginate(sections, () => true)[0], cardContext({ cover: 'cover-bold' })).length >= 6)
  // 白底上浅色字：对比度不过
  const bad = coverChecks({ boxes: [{ role: 'title', x: 0, y: 0, w: 100, h: 40, size: 30, lines: ['a'], fg: '#ffd27a', bg: '#ffffff', fits: true }], image: null }, { cardWidth: 450, cardHeight: 600, offsetX: 36, offsetY: 60, title: '标题' })
  assert.equal(bad.find(row => row.id === 'contrast').state, 'bad')
  // 标题里的数字正文里没有：提醒
  const claim = checkCover(page, cardContext({ cover: 'cover-poster' }, {}, { article: '正文里没有那个数' }))
  assert.equal(claim.find(row => row.id === 'claims').state, 'warn')
  // 配图被字压住太多
  const layout = coverLayout('cover-frame', bodyBox(ctx), { title: 'T', image: { src: 'data:image/png;base64,AAAA', key: 'k' } }, { theme: YANQI_THEMES[0], font: 'x' })
  assert.ok(coverChecks(layout, { cardWidth: 450, cardHeight: 600, offsetX: 36, offsetY: 60, title: 'T' }).some(row => row.id === 'image'))
})

test('新封面：渲染出来的卡片里只有转义过的文字、只有 data:image 图片，所有骨架和比例都能画', async () => {
  const { COVER_TEMPLATES, CARD_RATIOS, applyCoverMode, sectionHeadings } = await import('../client/layouts/cards.js')
  const sections = planSections('开头\n\n## <b>一</b>\n正文\n\n## 二\n正文', { title: '<img src=x onerror=alert(1)> vs <script>' })
  for (const ratio of CARD_RATIOS) {
    for (const template of CARD_TEMPLATES) {
      for (const cover of COVER_TEMPLATES) {
        const ctx = cardContext({ cover: cover.id, template: template.id, ratio: ratio.id }, { name: '"><svg onload=1>' }, { headings: sectionHeadings(sections), cover: { kicker: '<i>', tag: '</div>', number: '"x', image: { src: 'javascript:alert(1)' } } })
        const pages = paginate(applyCoverMode(sections, cover.id), estimateFits(ctx))
        const html = renderCard(pages[0], ctx)
        assertNoActiveHtml(html, `${ratio.id} ${template.id} ${cover.id}`)
        assert.ok(html.includes(`height: ${ctx.height}px`))
      }
    }
  }
})

test('9:16 和 1:1 这类比例下切页照样不溢出（估算模型）', () => {
  const sentence = '这是一句用来把版面撑满的中文句子，里面夹着 English words 和数字 2026。'
  const article = `开头。\n\n## 一节\n${Array.from({ length: 10 }, (_, i) => `第${i}段：${sentence.repeat(3)}`).join('\n\n')}`
  for (const ratio of ['3:4', '1:1', '4:3', '9:16']) {
    const ctx = cardContext({ ratio })
    const fits = estimateFits(ctx)
    const pages = paginate(planSections(article, { title: '长文' }), fits)
    for (const page of pages) assert.ok(fits(page) || page.blocks.length === 1, `${ratio} 第 ${page.number} 页溢出`)
    assert.ok(pages.length >= (ratio === '9:16' ? 3 : 4), `${ratio} ${pages.length}`)
  }
})

test('导入稿的本地图片（media-desk/imported/…）：长文预览、复制、推草稿都和工作台图片一样处理', async () => {
  const { localImages, wechatParts } = await import('../client/layouts/wechat.js')
  const { uploadMany } = await import('../src/image-host.js')
  const src = `media-desk/imported/${Buffer.from('/tmp/x/imgs/a.png').toString('base64url')}.png`
  const text = `![导入图](${src})`
  assert.deepEqual(localImages(text), [src])
  assert.ok(wechatParts(text, undefined, { images: 'preview' }).blocks[0].html.includes(`src="${src}"`))
  assert.ok(wechatParts(text, undefined, { images: 'draft' }).blocks[0].html.includes(`src="${src}"`))
  assert.deepEqual(wechatParts(text, undefined, { images: {} }).missing, ['导入图'])
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'yq-imp-'))
  try {
    await writeFile(join(dir, 'a.png'), PNG)
    const fetchImpl = async () => fakeResponse(200, { url: 'https://img.example.com/a.png' })
    const settings = { imageHost: { mode: 'custom', endpoint: 'https://img.example.com/up', urlPath: 'url' } }
    const ok = await uploadMany({ settings, srcs: [src, 'media-desk/imported/bad.png', '../etc/passwd'], filesDir: dir, fetchImpl, importedPath: async name => (name.startsWith('bad') ? null : join(dir, 'a.png')) })
    assert.deepEqual(ok.urls, { [src]: 'https://img.example.com/a.png' })
    assert.deepEqual(Object.keys(ok.errors).sort(), ['../etc/passwd', 'media-desk/imported/bad.png'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
