import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeIncome, incomeHandlers, localDay } from '../src/income.js'

const NOW = new Date('2026-11-13T10:00:00+08:00')
let seq = 0
const handlers = incomeHandlers(prefix => `${prefix}_${++seq}`)
const day = (offset) => { const d = new Date(NOW); d.setDate(d.getDate() + offset); return localDay(d) }

test('一笔都没记时不出数字', () => {
  assert.equal(computeIncome({}, NOW), null)
  assert.equal(computeIncome({ income: [] }, NOW), null)
})

test('今天、本月、累计各算各的；小数不出误差；最近的排前面并带上稿子标题', () => {
  const state = { items: [{ id: 'it_1', title: '一篇推广笔记' }], income: [] }
  handlers.add_income(state, { amount: 0.1, source: '打赏' }, NOW.toISOString())
  handlers.add_income(state, { amount: 0.2, source: '打赏' }, NOW.toISOString())
  handlers.add_income(state, { amount: 3000, source: '商单', itemId: 'it_1', note: '  首款  ', date: day(-2) }, NOW.toISOString())
  handlers.add_income(state, { amount: 500, source: '不认识的来源', date: '2026-09-30' }, NOW.toISOString())
  const income = computeIncome(state, NOW)
  assert.equal(income.today, 0.3)
  assert.equal(income.month, 3000.3)
  assert.equal(income.total, 3500.3)
  assert.deepEqual([income.count, income.monthCount], [4, 3])
  assert.deepEqual(income.bySource, [{ source: '商单', amount: 3000 }, { source: '打赏', amount: 0.3 }])
  assert.equal(income.recent.at(-1).source, '其他')
  const deal = income.recent.find(row => row.source === '商单')
  assert.deepEqual([deal.title, deal.note], ['一篇推广笔记', '首款'])
})

test('金额和日期不对就拒绝，不会记进去', () => {
  const state = { income: [] }
  const at = NOW.toISOString()
  assert.throws(() => handlers.add_income(state, { amount: 0 }, at), /大于 0/)
  assert.throws(() => handlers.add_income(state, { amount: '很多' }, at), /大于 0/)
  assert.throws(() => handlers.add_income(state, { amount: 1e12 }, at), /太大/)
  assert.throws(() => handlers.add_income(state, { amount: 10, date: '2026-02-31' }, at), /日期/)
  assert.throws(() => handlers.add_income(state, { amount: 10, date: '2099-01-01' }, at), /未来/)
  assert.equal(state.income.length, 0)
})

test('删一笔：合计跟着变；删不存在的报错', () => {
  const state = { income: [] }
  const { target } = handlers.add_income(state, { amount: 800, source: '商单' }, NOW.toISOString())
  handlers.add_income(state, { amount: 200, source: '平台分成' }, NOW.toISOString())
  handlers.delete_income(state, { id: target })
  assert.equal(computeIncome(state, NOW).total, 200)
  assert.throws(() => handlers.delete_income(state, { id: 'nope' }), /找不到/)
})
