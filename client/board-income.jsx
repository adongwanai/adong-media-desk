// 大屏上的收入小方块：今天、本月、累计，和最近几笔。数字全部来自用户自己记的记录。
import React from 'react'
import { dispatchOps, setDesk, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { dayKey, isPiece } from './util.js'

export const INCOME_SOURCES = ['商单', '平台分成', '付费咨询', '课程与社群', '打赏', '其他']
// 关联稿子的下拉里最多放这么多篇，按最近更新排
const MAX_ITEM_CHOICES = 40

/** ¥1,234.5：整数不带小数，有零头最多两位。 */
export const yuan = amount => `¥${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const short = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

/** 记一笔收入。itemId 给了就默认挂在那篇稿子上。 */
export function logIncome(items, itemId = '') {
  const choices = (items ?? []).filter(isPiece)
    .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')))
    .slice(0, MAX_ITEM_CHOICES)
  setDesk({
    dialog: {
      title: t('记一笔收入'),
      initial: { amount: '', date: dayKey(new Date()), source: '商单', itemId, note: '' },
      fields: [
        { name: 'amount', label: t('金额（元）'), type: 'number', placeholder: t('到手的金额，比如 3000'), required: true },
        { name: 'date', label: t('哪天到账'), type: 'date' },
        { name: 'source', label: t('来源'), type: 'select', options: INCOME_SOURCES.map(value => ({ value, label: t(value) })) },
        { name: 'itemId', label: t('是哪篇内容带来的'), type: 'select', options: [{ value: '', label: t('不关联内容') }, ...choices.map(item => ({ value: item.id, label: item.title }))] },
        { name: 'note', label: t('备注'), type: 'text', placeholder: t('品牌、首款或尾款，可不填') },
      ],
      onSubmit: (values) => {
        dispatchOps([{ op: 'add_income', amount: Number(values.amount), date: values.date, source: values.source, itemId: values.itemId || undefined, note: values.note }], { label: t('记一笔收入') })
      },
    },
  })
}

function Row({ row }) {
  const what = row.title || row.note || t(row.source)
  return (
    <li>
      <time>{short(row.date)}</time>
      <span className="md-b-inc-src">{t(row.source)}</span>
      <span className="md-b-inc-what" title={what}>{row.title || row.note || ''}</span>
      <b>{yuan(row.amount)}</b>
      <button type="button" className="md-b-inc-del" aria-label={t('删除这笔收入')} title={t('删除这笔收入（可撤销）')} onClick={() => dispatchOps([{ op: 'delete_income', id: row.id }], { label: t('删除一笔收入') })}><Icon name="close" size={12} /></button>
    </li>
  )
}

/**
 * @param {{income: null | {today: number, month: number, total: number, monthCount: number, recent: Array<object>}}} props - board.income；一笔都没记时是 null。
 */
export function IncomeTile({ income }) {
  const items = useDesk(s => s.state.items)
  const add = () => logIncome(items)
  if (!income) {
    return (
      <section className="md-tile md-b-income is-empty">
        <header className="md-tile-head"><h2>{t('收入')}</h2></header>
        <div className="md-b-inc-blank">
          <p>{t('接了商单、收到分成，在这里记一笔，就能看到今天和这个月赚了多少。')}</p>
          <button type="button" className="md-btn is-small" onClick={add}><Icon name="plus" size={13} />{t('记一笔收入')}</button>
        </div>
      </section>
    )
  }
  return (
    <section className="md-tile md-b-income">
      <header className="md-tile-head">
        <h2>{t('收入')}</h2>
        <span className="md-tile-meta">{t('本月 {n} 笔', { n: income.monthCount })}</span>
        <span className="md-grow" />
        <button type="button" className="md-pill is-small" onClick={add}><Icon name="plus" size={13} />{t('记一笔')}</button>
      </header>
      <dl className="md-b-inc-nums">
        <div className="is-main"><dt>{t('今天')}</dt><dd>{yuan(income.today)}</dd></div>
        <div><dt>{t('本月')}</dt><dd>{yuan(income.month)}</dd></div>
        <div><dt>{t('累计')}</dt><dd>{yuan(income.total)}</dd></div>
      </dl>
      <ul className="md-b-inc-list">{income.recent.map(row => <Row key={row.id} row={row} />)}</ul>
    </section>
  )
}
