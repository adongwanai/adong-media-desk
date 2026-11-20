// 我的方向：信息源页顶部的一小条编辑器，以及订阅、热榜共用的「按我的方向排序」。
// 排序只用看得见的输入（标题、摘要、时间、榜内热度），每一行都写明命中了哪个方向。
import React from 'react'
import { focusOf, MAX_BLOCKED, MAX_TOPICS, MAX_WORD, rankEntries, WEIGHTS } from '../src/rank.js'
import { dispatchOps, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon, IconButton, Segmented } from './ui.jsx'

/** 当前的方向。状态里没有时是空的。 */
export function useFocus() {
  const raw = useDesk(s => s.state.focus)
  return React.useMemo(() => focusOf({ focus: raw }), [raw])
}

function WordRow({ label, words, max, placeholder, onSave, tone }) {
  const [draft, setDraft] = React.useState('')
  const add = async (event) => {
    event.preventDefault()
    // 一次可以贴好几个，用逗号、顿号或换行隔开
    const fresh = draft.split(/[,，、;；\n]/).map(word => word.trim()).filter(Boolean)
    if (!fresh.length) return
    const result = await onSave([...words, ...fresh])
    if (result && !result.errors?.length) setDraft('')
  }
  return (
    <div className={`md-focus-row ${tone ? `is-${tone}` : ''}`}>
      <span className="md-focus-label">{label}</span>
      <ul className="md-focus-chips">
        {words.map(word => (
          <li key={word} className="md-focus-chip">
            <span>{word}</span>
            <IconButton icon="close" size={11} label={t('去掉「{word}」', { word })} onClick={() => onSave(words.filter(row => row !== word))} />
          </li>
        ))}
      </ul>
      {words.length < max ? (
        <form className="md-focus-add" onSubmit={add}>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={placeholder} aria-label={t('添加到「{label}」', { label })} maxLength={MAX_WORD * 4} />
          <button type="submit" className="md-focus-plus" aria-label={t('添加')} disabled={!draft.trim()}><Icon name="plus" size={12} /></button>
        </form>
      ) : <small className="md-muted">{t('最多 {n} 个', { n: max })}</small>}
    </div>
  )
}

/** 信息源页顶部：我的方向、不想看。什么都不预填。 */
export function FocusBar() {
  const focus = useFocus()
  const save = patch => dispatchOps([{ op: 'set_focus', ...patch }], { label: t('修改我的方向'), silent: true })
  return (
    <section className="md-focus" aria-label={t('我的方向')}>
      <WordRow label={t('我的方向')} words={focus.topics} max={MAX_TOPICS} placeholder={focus.topics.length ? t('再加一个') : t('输入一个方向，回车添加')} onSave={topics => save({ topics })} />
      {focus.topics.length ? null : <p className="md-focus-hint">{t('先写下 3–8 个你在追的方向，比如常写的领域、在跟的技术或产品。订阅和热榜会按它排序，并写明每条命中了哪个方向。')}</p>}
      <WordRow label={t('不想看')} words={focus.blocked} max={MAX_BLOCKED} tone="blocked" placeholder={t('含这个词的条目会被隐藏')} onSave={blocked => save({ blocked })} />
    </section>
  )
}

/**
 * 一组条目按我的方向排好。默认：设了方向就按方向排，没设就是原始顺序。
 * @param {Array<object>} entries - 原始顺序的条目。
 * @param {(entry: object) => string} [groupOf] - 几个来源混排时，热度只在同一来源里比。要传稳定的函数。
 */
export function useFocusRank(entries, groupOf) {
  const focus = useFocus()
  const [order, setOrder] = React.useState(null)
  const ranked = React.useMemo(() => rankEntries(entries, focus, { now: Date.now(), groupOf }), [entries, focus, groupOf])
  const byFocus = ranked.hasTopics && (order ?? 'focus') === 'focus'
  return { rows: byFocus ? ranked.byFocus : ranked.original, byFocus, setOrder, hidden: ranked.hidden, hasTopics: ranked.hasTopics }
}

/** 列表上方：排序开关和隐藏了几条。 */
export function RankBar({ rank }) {
  if (!rank.hasTopics && !rank.hidden) return null
  return (
    <div className="md-rank-bar">
      {rank.hasTopics ? (
        <Segmented label={t('排序')} value={rank.byFocus ? 'focus' : 'original'} onChange={rank.setOrder}
          options={[{ value: 'focus', label: t('按我的方向排序') }, { value: 'original', label: t('原始顺序') }]} />
      ) : null}
      {rank.hidden ? <span className="md-tile-meta">{t('已隐藏 {n} 条', { n: rank.hidden })}</span> : null}
    </div>
  )
}

const pct = value => Math.round(value * 100)

/** 每行的理由：命中了哪些方向；悬停看分数是怎么算出来的。 */
export function Why({ why }) {
  if (!why) return null
  const formula = t('相关 {r}% × {wr} + 新鲜 {f}% × {wf} + 热度 {h}% × {wh} = {s}', {
    r: pct(why.relevance), f: pct(why.freshness), h: pct(why.heat), s: pct(why.score),
    wr: WEIGHTS.relevance, wf: WEIGHTS.freshness, wh: WEIGHTS.heat,
  })
  return why.hits.length
    ? <span className="md-why" title={formula}>{t('命中：{hits}', { hits: why.hits.map(hit => (why.partial.includes(hit) ? t('{topic}（部分）', { topic: hit }) : hit)).join('、') })}</span>
    : <span className="md-why is-miss" title={formula}>{t('没有命中我的方向')}</span>
}
