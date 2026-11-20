// 复盘页的「粘贴表格」：贴进从平台后台复制或导出的表，按表头认列，先看预览，确认后才导入。
import React from 'react'
import { dispatchOps } from './desk.js'
import { buildImportOps, parseTable } from './import-table.js'
import { plural, t } from './i18n.js'
import { Dialog } from './ui.jsx'
import { platformChoices } from './util.js'

const FIELD_LABEL = { date: '日期', title: '标题', views: '播放 / 阅读', impressions: '曝光', likes: '点赞', comments: '评论', shares: '转发', saves: '收藏', recommends: '在看', completion: '完播率', newFollowers: '涨粉', minutes: '制作分钟', link: '链接' }
const PREVIEW_ROWS = 6

function errorText(error) {
  if (error.code === 'date') return t('日期「{value}」看不懂', { value: error.value })
  if (error.code === 'no-date') return t('没有日期')
  if (error.code === 'number') return t('「{header}」这一格「{value}」不是数字', { header: error.header, value: error.value })
  return t('这一行没有数字')
}

const PROBLEM = {
  'no-date': '没有认出日期列。表头里要有「日期」「时间」「发布时间」或 date。',
  'no-metric': '没有认出数据列。表头里要有播放、阅读、曝光、点赞、评论、转发、收藏、完播率、涨粉之类的列。',
}

export function ImportDialog({ items, onClose }) {
  const [text, setText] = React.useState('')
  const [platform, setPlatform] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const parsed = React.useMemo(() => (text.trim() ? parseTable(text) : null), [text])
  const plan = React.useMemo(() => (parsed?.rows.length && platform ? buildImportOps(parsed.rows, { platform, items: items.filter(item => !item.parentId) }) : null), [parsed, platform, items])
  const shown = parsed ? parsed.columns.filter(column => column.header) : []
  const metricKeys = parsed ? Object.keys(FIELD_LABEL).filter(key => key !== 'date' && key !== 'title' && key !== 'link' && parsed.fields[key] !== undefined) : []
  const submit = async (event) => {
    event.preventDefault()
    if (!plan?.ops.length || busy) return
    const label = t(plural(plan.ops.length, '导入 1 条数据', '导入 {n} 条数据'), { n: plan.ops.length })
    // 导入还没回来时按钮不可点，连点两下不会导两遍
    setBusy(true)
    try {
      const result = await dispatchOps(plan.ops, { label })
      if (result) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={t('粘贴数据表')} onClose={onClose} width={680}>
      <form className="md-form" onSubmit={submit}>
        <label className="md-field">
          <span>{t('平台')}</span>
          <select required value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="" disabled>{t('这张表是哪个平台的')}</option>
            {platformChoices().map(value => <option key={value} value={value}>{t(value)}</option>)}
          </select>
        </label>
        <label className="md-field">
          <span>{t('表格')}</span>
          <textarea rows={6} required value={text} onChange={e => setText(e.target.value)} placeholder={t('从后台复制整张表（带表头）粘贴到这里，CSV 或直接从表格里复制都行')} />
          <small>{t('第一行要是表头。认得出：日期 / 发布时间、标题 / 作品、播放 / 阅读、曝光 / 展现、点赞、评论、转发 / 分享、收藏、完播率、涨粉 / 新增关注、制作时长。表里没有的列不会记成 0。')}</small>
        </label>
        {parsed ? (
          <div className="md-imp-preview">
            <div className="md-imp-cols" aria-label={t('认出的列')}>
              {shown.map(column => (
                <span key={column.index} className={`md-imp-col ${column.field ? 'is-on' : ''}`}>
                  {column.header}<em>{column.field ? `→ ${t(FIELD_LABEL[column.field])}` : t('不导入')}</em>
                </span>
              ))}
            </div>
            {parsed.problem ? <p className="md-s-errors md-imp-problem">{t(PROBLEM[parsed.problem])}</p> : (
              <>
                <p className="md-imp-summary">
                  {t(plural(parsed.rows.length, '可以导入 1 行', '可以导入 {n} 行'), { n: parsed.rows.length })}
                  {plan ? t('，其中 {n} 行按标题对上了已有内容', { n: plan.attached }) : null}
                  {parsed.errors.length ? t('；{n} 行没法导入，见下面', { n: parsed.errors.length }) : null}
                  {!platform && parsed.rows.length ? t('。先选平台再导入') : null}
                </p>
                {parsed.rows.length ? (
                  <div className="md-imp-table">
                    <table className="md-table is-plain">
                      <thead><tr><th>{t('日期')}</th>{parsed.fields.title !== undefined ? <th>{t('标题')}</th> : null}{metricKeys.map(key => <th key={key} className="is-num">{t(FIELD_LABEL[key])}</th>)}</tr></thead>
                      <tbody>
                        {parsed.rows.slice(0, PREVIEW_ROWS).map(row => (
                          <tr key={row.line}><td>{row.date}</td>{parsed.fields.title !== undefined ? <td className="md-imp-title">{row.title}</td> : null}{metricKeys.map(key => <td key={key} className="is-num">{row[key] === undefined ? '—' : key === 'completion' ? `${(row[key] * 100).toFixed(1)}%` : row[key].toLocaleString()}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                    {parsed.rows.length > PREVIEW_ROWS ? <small className="md-muted">{t('还有 {n} 行没列出', { n: parsed.rows.length - PREVIEW_ROWS })}</small> : null}
                  </div>
                ) : null}
                {parsed.errors.length ? (
                  <ul className="md-s-errors md-imp-errors">
                    {parsed.errors.slice(0, 20).map(error => <li key={error.line}>{t('第 {n} 行：{reason}', { n: error.line, reason: errorText(error) })}</li>)}
                    {parsed.errors.length > 20 ? <li>{t('……还有 {n} 行', { n: parsed.errors.length - 20 })}</li> : null}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary" disabled={!plan?.ops.length || busy}>{plan?.ops.length ? t(plural(plan.ops.length, '导入 1 条', '导入 {n} 条'), { n: plan.ops.length }) : t('导入')}</button>
        </div>
      </form>
    </Dialog>
  )
}
