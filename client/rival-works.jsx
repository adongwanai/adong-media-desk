// 对标卡片里的作品：用户贴进来的作品表，按这位作者自己的水平评级（算法在 src/rival-score.js），可以记为灵感、标跟进状态。
import React from 'react'
import { openInBrowser } from './browser.js'
import { dispatchOps } from './desk.js'
import { plural, t } from './i18n.js'
import { parseWorksTable } from './rival-works.js'
import { Dialog, Icon, IconButton } from './ui.jsx'
import { compact } from './util.js'
import { MAX_OTHERS, MIN_OTHERS, scoreWorks } from '../src/rival-score.js'

const STATUS = [['follow', '值得跟进'], ['watch', '继续观察'], ['irrelevant', '不相关'], ['adopted', '已采用']]
const FIELD_LABEL = { title: '标题', date: '日期', likes: '点赞', saves: '收藏', comments: '评论', shares: '转发', views: '播放', url: '链接' }
const GRADE_CLASS = { 现象级: 'is-top', 爆款: 'is-hit', 潜力: 'is-up', 虚高: 'is-thin', 样本不足: 'is-thin' }
const PREVIEW_ROWS = 6

const PROBLEM = {
  'no-title': '没有认出标题列。表头里要有「标题」「作品」或 title。',
  'no-date': '没有认出日期列。表头里要有「日期」「发布时间」或 date。',
  'no-metric': '没有认出数据列。表头里要有点赞、收藏、评论、转发或播放。',
}

function errorText(error) {
  if (error.code === 'no-title') return t('没有标题')
  if (error.code === 'date') return t('日期「{value}」看不懂', { value: error.value })
  if (error.code === 'no-date') return t('没有日期')
  if (error.code === 'number') return t('「{header}」这一格「{value}」不是数字', { header: error.header, value: error.value })
  return t('这一行没有数字')
}

function PasteWorks({ rival, name, onClose }) {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const parsed = React.useMemo(() => (text.trim() ? parseWorksTable(text) : null), [text])
  const rows = parsed?.problem ? [] : parsed?.rows ?? []
  const submit = async (event) => {
    event.preventDefault()
    if (!rows.length || busy) return
    setBusy(true)
    try {
      const works = rows.map(({ line, ...work }) => work)
      const result = await dispatchOps([{ op: 'add_rival_works', rivalId: rival.id, works }], { label: t('导入「{name}」的作品', { name }) })
      if (result && !result.errors?.length) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={t('粘贴「{name}」的作品表', { name })} onClose={onClose} width={680}>
      <form className="md-form" onSubmit={submit}>
        <label className="md-field">
          <span>{t('表格')}</span>
          <textarea rows={6} required value={text} onChange={e => setText(e.target.value)} placeholder={t('从对方主页或数据工具复制作品列表（带表头）粘贴到这里')} />
          <small>{t('第一行要是表头。必须有标题和发布日期，再加点赞、收藏、评论、转发里的几列；有播放和链接也认。同名作品再贴一次是更新。')}</small>
        </label>
        {parsed ? (
          <div className="md-imp-preview">
            <div className="md-imp-cols" aria-label={t('认出的列')}>
              {parsed.columns.filter(column => column.header).map(column => (
                <span key={column.index} className={`md-imp-col ${column.field ? 'is-on' : ''}`}>{column.header}<em>{column.field ? `→ ${t(FIELD_LABEL[column.field])}` : t('不导入')}</em></span>
              ))}
            </div>
            {parsed.problem ? <p className="md-s-errors md-imp-problem">{t(PROBLEM[parsed.problem])}</p> : (
              <>
                <p className="md-imp-summary">
                  {t(plural(rows.length, '可以导入 1 条作品', '可以导入 {n} 条作品'), { n: rows.length })}
                  {parsed.errors.length ? t('；{n} 行没法导入，见下面', { n: parsed.errors.length }) : null}
                </p>
                {rows.length ? (
                  <div className="md-imp-table">
                    <table className="md-table is-plain">
                      <thead><tr><th>{t('日期')}</th><th>{t('标题')}</th><th className="is-num">{t('赞 / 藏 / 评 / 转')}</th></tr></thead>
                      <tbody>
                        {rows.slice(0, PREVIEW_ROWS).map(row => (
                          <tr key={row.line}><td>{row.date}</td><td className="md-imp-title">{row.title}</td><td className="is-num">{['likes', 'saves', 'comments', 'shares'].map(key => (row[key] === undefined ? '—' : compact(row[key]))).join(' / ')}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > PREVIEW_ROWS ? <small className="md-muted">{t('还有 {n} 行没列出', { n: rows.length - PREVIEW_ROWS })}</small> : null}
                  </div>
                ) : null}
                {parsed.errors.length ? (
                  <ul className="md-s-errors md-imp-errors">
                    {parsed.errors.slice(0, 20).map(error => <li key={error.line}>{t('第 {n} 行：{reason}', { n: error.line, reason: errorText(error) })}</li>)}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary" disabled={!rows.length || busy}>{rows.length ? t(plural(rows.length, '导入 1 条', '导入 {n} 条'), { n: rows.length }) : t('导入')}</button>
        </div>
      </form>
    </Dialog>
  )
}

function ratioText(work) {
  if (work.ratio === null) return '—'
  return work.ratio === Infinity ? '∞' : `${work.ratio.toFixed(1)}×`
}

function ratioWhy(work) {
  if (work.value === null) return t('这条一个互动数都没有')
  if (work.grade === '样本不足') return t('这位作者别的作品只有 {n} 条有数，至少 {min} 条才比', { n: work.compared, min: MIN_OTHERS })
  const base = t('这条的互动值 {value} ÷ 他最近 {n} 条其他作品的中位数 {median}', { value: compact(work.value), n: work.compared, median: compact(work.median) })
  return work.grade === '虚高' ? `${base}${t('；互动值没过门槛 {floor}，不算爆', { floor: compact(work.floor) })}` : base
}

function WorkRow({ work, name }) {
  const keep = () => dispatchOps([{ op: 'add_item', kind: 'web', title: work.title, source: name, ...(work.url ? { url: work.url } : {}) }], { label: t('记为灵感') })
  return (
    <tr>
      <td>{work.grade ? <span className={`md-rw-grade ${GRADE_CLASS[work.grade] ?? ''}`}>{t(work.grade)}</span> : null}</td>
      <td className="md-rw-title">
        {work.url ? <button type="button" title={work.url} onClick={() => openInBrowser(work.url)}>{work.title}<Icon name="upRight" size={11} /></button> : <span title={work.title}>{work.title}</span>}
        <small>{work.date}</small>
      </td>
      <td className="is-num" title={work.partial ? t('导出里少了几项，只用有的项算') : undefined}>{work.value === null ? '—' : compact(work.value)}{work.partial && work.value !== null ? <small className="md-rw-partial">{t('部分数据')}</small> : null}</td>
      <td className="is-num" title={ratioWhy(work)}>{ratioText(work)}</td>
      <td>
        <select className="md-rw-status" value={work.status ?? ''} aria-label={t('跟进状态')} onChange={e => dispatchOps([{ op: 'set_rival_work', id: work.id, status: e.target.value || null }], { label: t('标记作品') })}>
          <option value="">{t('未标记')}</option>
          {STATUS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </td>
      <td className="md-rw-acts">
        <button type="button" className="md-pill is-small" onClick={keep}><Icon name="spark" size={12} />{t('记为灵感')}</button>
        <IconButton icon="trash" size={13} label={t('删除这条作品')} onClick={() => dispatchOps([{ op: 'delete_rival_work', id: work.id }], { label: t('删除作品') })} />
      </td>
    </tr>
  )
}

/** 卡片里的作品区：收起时只是一个按钮，展开后是按 R 排好的表。 */
export function RivalWorks({ rival, name, works, open, onToggle }) {
  const [pasting, setPasting] = React.useState(false)
  const scored = React.useMemo(() => (open ? scoreWorks(works, rival.platform) : []), [open, works, rival.platform])
  return (
    <div className="md-rw">
      <div className="md-rw-bar">
        <button type="button" className="md-pill is-small" aria-expanded={open} onClick={onToggle}><Icon name="list" size={13} />{works.length ? t('作品 {n}', { n: works.length }) : t('作品')}</button>
        {open ? <button type="button" className="md-pill is-small" onClick={() => setPasting(true)}><Icon name="upload" size={13} />{t('粘贴作品表')}</button> : null}
      </div>
      {open ? (works.length ? (
        <>
          <div className="md-rw-table">
            <table className="md-table is-plain">
              <thead><tr><th>{t('评级')}</th><th>{t('作品')}</th><th className="is-num" title={t('点赞×1、评论×3、收藏×3、转发×5，小红书收藏×4、B 站转发×4；导出里没有的项不算')}>{t('互动值')}</th><th className="is-num" title={t('和他自己最近 {max} 条其他作品的中位数比', { max: MAX_OTHERS })}>R</th><th>{t('状态')}</th><th /></tr></thead>
              <tbody>{scored.map(work => <WorkRow key={work.id} work={work} name={name} />)}</tbody>
            </table>
          </div>
          <p className="md-rw-legend">{t('R 是这条的互动值除以这位作者最近 20 条其他作品的中位数：≥8 现象级，≥4 爆款，≥2 潜力；互动值不到 max(20, 2×中位数) 的标「虚高」；其他作品不到 5 条的标「样本不足」。')}</p>
        </>
      ) : (
        <div className="md-rw-empty">
          <p>{t('还没有他的作品。工作台不会去抓对方的作品列表。')}</p>
          <p className="md-muted">{t('在对方主页或数据工具里把最近的作品复制成表格，第一行是表头：标题、发布日期，再加点赞、收藏、评论、转发（有播放和链接更好），点「粘贴作品表」贴进来。至少 6 条才能开始评级。')}</p>
        </div>
      )) : null}
      {pasting ? <PasteWorks rival={rival} name={name} onClose={() => setPasting(false)} /> : null}
    </div>
  )
}
