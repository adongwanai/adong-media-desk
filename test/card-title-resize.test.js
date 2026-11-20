// 图文卡片的两处反馈：封面标题能自己填（空着回退到稿子标题），拖大图片 / 表格时不被挤到下一页。
import assert from 'node:assert/strict'
import test from 'node:test'
import { imageMaxHeight, largestFit } from '../client/layouts/card-interact.js'
import { COVER_TITLE_MAX, cardContext, cardTitle, estimateFits, pageOfKey, paginate, planSections, renderCard } from '../client/layouts/cards.js'

test('cardTitle：填了就用填的，空着或全是空白就回退到稿子标题', () => {
  assert.equal(cardTitle('卡片上的新标题', '稿子标题'), '卡片上的新标题')
  assert.equal(cardTitle('', '稿子标题'), '稿子标题')
  assert.equal(cardTitle('   \n ', '稿子标题'), '稿子标题')
  assert.equal(cardTitle(undefined, '稿子标题'), '稿子标题')
  assert.equal(cardTitle(null, null), '')
  // 换行、连续空白压成一个空格
  assert.equal(cardTitle('  第一行\n\n第二行  ', '稿子标题'), '第一行 第二行')
  // 太长的截到上限（按字算，不把汉字截半）
  assert.equal(Array.from(cardTitle('字'.repeat(COVER_TITLE_MAX + 20), '')).length, COVER_TITLE_MAX)
})

test('planSections：封面印填的标题，正文开头那个同名一级标题照样按稿子标题去掉', () => {
  const article = '# 稿子标题\n开头一段。\n\n## 一节\n正文。'
  const plain = runs => runs.map(run => run.text).join('')
  const custom = planSections(article, { title: '稿子标题', coverTitle: '封面上的标题' })
  assert.equal(plain(custom[0].heading), '封面上的标题')
  assert.equal(custom[0].kind, 'cover')
  // 开头的「# 稿子标题」仍然被认出来去掉，不会多出一段
  assert.ok(!custom.some(page => page.blocks.some(block => block.type === 'heading' && plain(block.runs) === '稿子标题')))
  const fallback = planSections(article, { title: '稿子标题', coverTitle: '  ' })
  assert.equal(plain(fallback[0].heading), '稿子标题')
  // 只换封面，其余页不受影响
  assert.deepEqual(custom.slice(1), fallback.slice(1))
})

test('renderCard：预览里封面标题带 data-slot="title"（点了去改），导出的卡片不带', () => {
  const sections = planSections('开头。\n\n## 一节\n正文', { title: '稿子标题', coverTitle: '新封面标题' })
  for (const cover of ['cover-bold', 'cover-classic', 'cover-poster']) {
    const preview = cardContext({ cover }, {}, { lines: true })
    const out = cardContext({ cover })
    const page = paginate(sections, estimateFits(preview))[0]
    // 固定版式封面会把标题折成几行（<br>），比文字时先去掉
    const shown = renderCard(page, preview).replace(/<br>/g, '')
    const exported = renderCard(page, out).replace(/<br>/g, '')
    assert.ok(shown.includes('新封面标题'), cover)
    assert.ok(exported.includes('新封面标题'), cover)
    assert.ok(!exported.includes('稿子标题'), cover)
    assert.match(shown, /data-slot="title"/, cover)
    if (cover !== 'cover-poster') assert.doesNotMatch(exported, /data-slot/, cover)
  }
})

test('pageOfKey：调过大小的图片、表格现在在第几页', () => {
  const pages = [
    { blocks: [{ type: 'paragraph' }] },
    { blocks: [{ type: 'image', key: 'img-a' }, { type: 'table', key: 'tb-1' }] },
    { blocks: [{ type: 'table', key: 'tb-1' }] },
  ]
  assert.equal(pageOfKey(pages, 'img-a'), 1)
  // 表格拆到两页时取第一页
  assert.equal(pageOfKey(pages, 'tb-1'), 1)
  assert.equal(pageOfKey(pages, 'nope'), -1)
  assert.equal(pageOfKey(pages, ''), -1)
})

test('imageMaxHeight：拖大图片最多拉到这一页放得下的高度', () => {
  // 图片顶边到正文区底边还有 300px，下边距 10px：最多 289px（留 1px 余量，免得量的时候四舍五入多出来）
  assert.equal(imageMaxHeight({ room: 300, margin: 10, limit: 500, current: 120 }), 289)
  // 原来的上限更小时用原来的
  assert.equal(imageMaxHeight({ room: 900, margin: 10, limit: 476, current: 120 }), 476)
  // 本来就比剩下的空间高（一页只放得下这张图）：不再往大拉，也不一按下就压小
  assert.equal(imageMaxHeight({ room: 200, margin: 10, limit: 476, current: 260 }), 260)
  // 再小也给到最小尺寸 60
  assert.equal(imageMaxHeight({ room: 20, margin: 10, limit: 476, current: 40 }), 60)
  // 量不到正文区时（room 无穷大）退回原来的上限
  assert.equal(imageMaxHeight({ room: Infinity, limit: 476 }), 476)
})

test('largestFit：二分找放得下的最大缩放', () => {
  // 1.37 以内放得下
  assert.equal(largestFit(1, 1.6, value => value <= 1.37), 1.37)
  // 想要的值本来就放得下：原样返回
  assert.equal(largestFit(1, 1.2, () => true), 1.2)
  // 连起点都放不下：停在起点，不往回缩
  assert.equal(largestFit(1.1, 1.6, () => false), 1.1)
  // 往小拖不用找
  assert.equal(largestFit(1.2, 1, () => false), 1)
})
