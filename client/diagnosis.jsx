// 复盘页的单篇诊断：每篇一句诊断、一个动作，判断依据的篇数始终写出来。算法在 src/diagnose.js。
import React from 'react'
import { dispatchOps, openItem, setDesk, useDesk } from './desk.js'
import { t } from './i18n.js'
import { displayItem, fmtDate } from './util.js'

const SHOWN = 8
const BADGE = { low: '有短板', strong: '没有短板', insufficient: '样本不足', none: '数据不够' }

function MetricChip({ metric }) {
  const why = metric.enough
    ? t('你在这个平台的中位数 {median}，25 分位 {p25}，依据 {n} 篇', { median: metric.medianText, p25: metric.p25Text, n: metric.n })
    : t('样本不足（{n} 篇），先不下结论', { n: metric.n })
  return <span className={`md-dg-chip ${metric.enough ? '' : 'is-thin'}`} title={why}>{metric.label} <b>{metric.text}</b></span>
}

export function linkPiece(piece, items) {
  setDesk({ dialog: {
    title: t('关联稿件'),
    initial: { itemId: piece.itemId || '' },
    fields: [{ name: 'itemId', label: t('对应内容'), type: 'select', options: [
      { value: '', label: t('不关联内容') },
      ...items.filter(item => !item.parentId).map(item => ({ value: item.id, label: displayItem(item).title })),
    ] }],
    onSubmit: values => dispatchOps([{ op: 'link_metrics', ids: piece.metricIds, itemId: values.itemId || null }], { label: t('关联稿件') }),
  } })
}

export function DiagnosisTile({ pieces }) {
  const items = useDesk(s => s.state.items)
  const [all, setAll] = React.useState(false)
  const shown = all ? pieces : pieces.slice(0, SHOWN)
  return (
    <section className="md-tile md-i-diag">
      <header className="md-tile-head">
        <h2>{t('单篇诊断')}</h2>
        <span className="md-tile-meta">{t('只和你自己同平台的作品比；某项有数的作品不到 10 篇时不下结论')}</span>
      </header>
      <ul className="md-dg-list">
        {shown.map(piece => (
          <li key={piece.key} className={`md-dg is-${piece.verdict}`}>
            {/* 标题单独一行，最多两行；平台、日期和结论放在下面一行，标题不再被挤成几个字 */}
            {piece.itemId ? <button type="button" className="md-dg-title" title={piece.title} onClick={() => openItem(piece.itemId)}>{piece.title}</button> : <strong className="md-dg-title" title={piece.title}>{piece.title}</strong>}
            <div className="md-dg-head">
              <small>{[piece.platform ? t(piece.platform) : null, piece.date ? fmtDate(piece.date) : null].filter(Boolean).join(' · ')}</small>
              <span className="md-grow" />
              {piece.metricIds?.length ? <button type="button" className="md-pill is-small" onClick={() => linkPiece(piece, items)}>{t(piece.itemId ? '更改关联' : '关联稿件')}</button> : null}
              <span className="md-dg-badge">{t(BADGE[piece.verdict])}</span>
            </div>
            <p className="md-dg-line">{piece.line}</p>
            {/* 和上一篇同时点（发布后第 1/3/7 天）的对比：数据不够时直接写没法比 */}
            {piece.age ? <p className={`md-dg-age ${piece.age.reason ? 'is-thin' : ''}`}>{piece.age.text}{piece.age.note ? <small>{piece.age.note}</small> : null}</p> : null}
            <p className="md-dg-action">{t('建议：{action}', { action: piece.action })}</p>
            {piece.metrics.length ? <div className="md-dg-chips">{piece.metrics.map(metric => <MetricChip key={metric.key} metric={metric} />)}</div> : null}
          </li>
        ))}
      </ul>
      {pieces.length > SHOWN ? <button type="button" className="md-pill is-small md-dg-more" onClick={() => setAll(v => !v)}>{all ? t('收起') : t('还有 {n} 篇', { n: pieces.length - SHOWN })}</button> : null}
    </section>
  )
}
