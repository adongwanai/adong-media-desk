// 对标作品表：用户从对方主页或数据工具里复制的作品列表。按表头认列（和复盘页的粘贴表格同一套），纯函数。
// 工作台不去抓对方的作品；表里没有的列就是没有，不当 0。
import { detectColumns, parseDate, parseNumber, splitTable } from './import-table.js'

export const WORK_NUMBERS = ['likes', 'saves', 'comments', 'shares', 'views']
const URL_HEADER = /链接|网址|地址|url|link/i

/**
 * 解析整张作品表。第一行是表头，标题和日期两列必须有，赞藏评转播至少一列。
 * @param {string} text - 粘贴进来的原文。
 * @param {Date} [now] - 只写月日的日期按它的年份。
 * @returns {{columns: Array<{index: number, header: string, field: string|null}>, rows: Array<object>, errors: Array<{line: number, code: string, header?: string, value?: string}>, problem: 'no-title'|'no-date'|'no-metric'|null}} problem 不为空时整张表都导不了。
 */
export function parseWorksTable(text, now = new Date()) {
  const [header = [], ...body] = splitTable(text)
  const detected = detectColumns(header)
  const fields = Object.fromEntries(Object.entries(detected.fields).filter(([field]) => field === 'title' || field === 'date' || WORK_NUMBERS.includes(field)))
  const taken = new Set(Object.values(fields))
  const urlIndex = header.findIndex((cell, index) => !taken.has(index) && URL_HEADER.test(String(cell ?? '')))
  const byIndex = Object.fromEntries(Object.entries(fields).map(([field, index]) => [index, field]))
  const columns = detected.columns.map(column => ({ ...column, field: byIndex[column.index] ?? (column.index === urlIndex ? 'url' : null) }))
  const numbers = WORK_NUMBERS.filter(key => fields[key] !== undefined)
  const result = { columns, rows: [], errors: [], problem: null }
  if (fields.title === undefined) return { ...result, problem: 'no-title' }
  if (fields.date === undefined) return { ...result, problem: 'no-date' }
  if (!numbers.length) return { ...result, problem: 'no-metric' }
  body.forEach((cells, offset) => {
    const line = offset + 2
    const title = String(cells[fields.title] ?? '').trim()
    if (!title) {
      result.errors.push({ line, code: 'no-title' })
      return
    }
    const rawDate = cells[fields.date] ?? ''
    const date = parseDate(rawDate, now)
    if (!date) {
      result.errors.push(rawDate ? { line, code: 'date', value: rawDate } : { line, code: 'no-date' })
      return
    }
    const values = {}
    for (const key of numbers) {
      const raw = cells[fields[key]] ?? ''
      const value = parseNumber(raw)
      if (Number.isNaN(value)) {
        result.errors.push({ line, code: 'number', header: columns[fields[key]].header, value: raw })
        return
      }
      if (value !== null) values[key] = value
    }
    if (!Object.keys(values).length) {
      result.errors.push({ line, code: 'empty' })
      return
    }
    // 链接格子不是 http(s) 地址时不要它，其余照收
    const url = urlIndex >= 0 ? String(cells[urlIndex] ?? '').trim() : ''
    result.rows.push({ line, title, date, ...(/^https?:\/\/\S+$/i.test(url) ? { url } : {}), ...values })
  })
  return result
}
