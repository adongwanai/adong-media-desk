// 收入记录：商单、分成、咨询这些到手的钱，用户自己一笔一笔记。只加总用户记下的数，不估算、不预测。
import { tr } from './i18n.js'

export const INCOME_SOURCES = ['商单', '平台分成', '付费咨询', '课程与社群', '打赏', '其他']
const MAX_AMOUNT = 100_000_000
const MAX_NOTE = 200

const pad = n => String(n).padStart(2, '0')
/** 本地时区的 YYYY-MM-DD。 */
export function localDay(value) {
  const d = new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 真实存在、不在未来的 YYYY-MM-DD；没给就是今天。 */
function incomeDate(raw, now) {
  const today = localDay(now)
  if (raw === undefined || raw === null || raw === '') return today
  const text = String(raw)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  if (!date || localDay(date) !== text) throw new Error(tr('收入日期要写成 2026-01-31 这样'))
  if (text > today) throw new Error(tr('收入日期不能在未来'))
  return text
}

/** 金额按分存成整数再换回元，免得 0.1 + 0.2 这种小数误差进合计。 */
function cleanAmount(raw) {
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(tr('金额要填大于 0 的数字'))
  if (amount > MAX_AMOUNT) throw new Error(tr('金额太大了，检查一下是不是多打了几位'))
  return Math.round(amount * 100) / 100
}

/** 给 ops.js 用的操作：记一笔、删一笔。 */
export function incomeHandlers(newId) {
  return {
    add_income(state, op, now) {
      const amount = cleanAmount(op.amount)
      const date = incomeDate(op.date, now)
      const source = INCOME_SOURCES.includes(op.source) ? op.source : '其他'
      const item = typeof op.itemId === 'string' ? (state.items ?? []).find(row => row.id === op.itemId) : null
      const note = typeof op.note === 'string' ? op.note.trim().slice(0, MAX_NOTE) : ''
      const row = { id: newId('in'), date, amount, source, ...(item ? { itemId: item.id } : {}), ...(note ? { note } : {}), createdAt: now }
      state.income = [...(state.income ?? []), row]
      return { text: tr('记一笔收入 ¥{amount}（{source}）', { amount: amount.toLocaleString('en-US'), source: tr(source) }), target: row.id, kind: 'income' }
    },
    delete_income(state, op) {
      const list = state.income ?? []
      const row = list.find(entry => entry.id === op.id)
      if (!row) throw new Error(tr('找不到这笔收入'))
      state.income = list.filter(entry => entry.id !== op.id)
      return { text: tr('删除一笔收入 ¥{amount}', { amount: row.amount.toLocaleString('en-US') }) }
    },
  }
}

const sum = rows => Math.round(rows.reduce((total, row) => total + Math.round(row.amount * 100), 0)) / 100

/**
 * 大屏上的收入小结：今天、本月、累计，各是多少笔记录加出来的。一笔都没记时返回 null，界面不显示 ¥0 冒充数据。
 * @param {{income?: Array<object>, items?: Array<object>}} state - 工作台数据。
 * @param {Date} [now] - 现在。
 * @returns {null | {today: number, month: number, total: number, count: number, monthCount: number, bySource: Array<{source: string, amount: number}>, recent: Array<object>}}
 */
export function computeIncome(state, now = new Date()) {
  const rows = (state.income ?? []).filter(row => Number.isFinite(row?.amount) && typeof row.date === 'string')
  if (!rows.length) return null
  const today = localDay(now)
  const month = today.slice(0, 7)
  const inMonth = rows.filter(row => row.date.startsWith(month))
  const titles = new Map((state.items ?? []).map(item => [item.id, item.title]))
  const bySource = INCOME_SOURCES
    .map(source => ({ source, amount: sum(inMonth.filter(row => row.source === source)) }))
    .filter(row => row.amount > 0)
  const recent = [...rows]
    .sort((a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : b.date.localeCompare(a.date)))
    .slice(0, 8)
    .map(row => ({ ...row, title: row.itemId ? titles.get(row.itemId) ?? null : null }))
  return { today: sum(rows.filter(row => row.date === today)), month: sum(inMonth), total: sum(rows), count: rows.length, monthCount: inMonth.length, bySource, recent }
}
