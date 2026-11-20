import test from 'node:test'
import assert from 'node:assert/strict'
import { packPages, paginate, planSections, cardContext, estimateFits } from '../client/layouts/cards.js'

const textOf = pages => pages.flatMap(page => [page.heading, ...page.blocks.map(block => block.runs ?? [])]).flat().map(run => run.text).join('')

test('短小节按可用高度合并，标题正文不丢，显式分页保留', () => {
  const markdown = '开场。\n\n## 观察\n真实问题。\n\n## 判断\n具体判断。\n\n---\n\n必须另起一页。'
  const pages = paginate(planSections(markdown, { title: '标题' }), () => true)
  const packed = packPages(pages, () => true)
  assert.equal(packed.length, 3)
  assert.equal(textOf(packed), textOf(pages))
  assert.equal(packed[2].hardBreak, true)
})

test('整节放不下时移动完整段落填补上一页，不把图片与解释拆散', () => {
  const paragraph = text => ({ type: 'paragraph', runs: [{ text }] })
  const pages = [
    { kind: 'content', heading: [], blocks: [paragraph('一'), paragraph('二')] },
    { kind: 'content', heading: [{ text: '小节' }], blocks: [paragraph('三'), paragraph('四'), paragraph('五')] },
    { kind: 'content', heading: [{ text: '图解' }], blocks: [paragraph('图片解释'), { type: 'image', src: 'diagram.png' }] },
  ]
  const fits = page => page.blocks.length <= 4
  const packed = packPages(pages, fits)
  assert.deepEqual(packed[0].blocks.map(b => b.runs[0].text), ['一', '二', '小节', '三'])
  assert.deepEqual(packed[1].blocks.map(b => b.runs[0].text), ['四', '五'])
  assert.equal(packed[2].blocks[0].runs[0].text, '图片解释')
  assert.ok(packed.every(fits))
})

test('合并后的图文不超高，封面独立且正文顺序保持', () => {
  const fits = estimateFits(cardContext())
  const pages = paginate(planSections(Array.from({ length: 8 }, (_, i) => `## 判断${i}\n${'具体论证与可操作的建议。'.repeat(8)}`).join('\n\n'), { title: '标题' }), fits)
  const packed = packPages(pages, fits)
  assert.equal(packed[0].kind, 'cover')
  assert.equal(textOf(packed), textOf(pages))
  assert.ok(packed.every(fits))
  assert.ok(packed.length <= pages.length)
})
