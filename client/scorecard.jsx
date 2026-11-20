// 选题评分卡：放在灵感的工作区里、成稿之前。热度、相关度来自看得见的数据，切入价值只能用户自己打；
// 模型可以给个参考分，但只是参考，不会自动填进去。
import React from 'react'
import { SCORE_WEIGHTS, partValue, scoreIdea, scoreTotal } from '../src/idea-score.js'
import { closeItem, dispatchOps, fetchAngleScore, openItem, report, setDesk, useDesk } from './desk.js'
import { t } from './i18n.js'
import { useFocus } from './focus.jsx'

const NAMES = { heat: '热度', relevance: '相关度', angle: '切入价值' }
const fmt = value => (Number.isInteger(value) ? String(value) : value.toFixed(1))

/** 不够打总分时，把知道的几项照实写出来：「热度 9.6 · 相关度、切入价值未评」。一项都不知道时是空字符串。 */
export function knownPartsText(parts) {
  const { known, missing } = scoreTotal(parts ?? {})
  if (!known.length) return ''
  const shown = known.map(key => `${t(NAMES[key])} ${fmt(partValue(parts, key))}`).join(' · ')
  return missing.length ? `${shown} · ${t('{names}未评', { names: missing.map(key => t(NAMES[key])).join(t('、')) })}` : shown
}

// 两次评分是不是同一个结果：各项的分和扣分都一样
const signature = parts => [...Object.keys(SCORE_WEIGHTS).map(key => partValue(parts, key)), parts?.penalty?.value ?? 0].join('|')

function Part({ name, value, children }) {
  return (
    <li className={`md-score-part ${value === null ? 'is-unknown' : ''}`}>
      <span className="md-score-name">{t(NAMES[name])}<small>{Math.round(SCORE_WEIGHTS[name] * 100)}%</small></span>
      <b>{value === null ? '—' : `${fmt(value)}/10`}</b>
      <div className="md-score-why">{children}</div>
    </li>
  )
}

/** 挂载时请带 key={item.id}，换一条灵感就是一张新卡。 */
export function Scorecard({ item }) {
  const items = useDesk(s => s.state.items)
  const { topics } = useFocus()
  const [angle, setAngle] = React.useState(item.scoreParts?.angle?.value ?? null)
  const [hint, setHint] = React.useState(null)
  const [asking, setAsking] = React.useState(false)
  const result = React.useMemo(() => scoreIdea(item, { items, topics, angle, now: Date.now() }), [item, items, topics, angle])
  const save = React.useCallback((next) => {
    dispatchOps([{ op: 'update_item', id: item.id, score: next.total, scoreParts: { ...next.parts, at: new Date().toISOString() } }], { label: t('记下选题评分'), silent: true })
  }, [item.id])
  // 拖动切入价值停下来再存，不是每动一格存一次
  const pending = React.useRef(null)
  React.useEffect(() => {
    if ((item.scoreParts?.angle?.value ?? null) === angle) return undefined
    pending.current = setTimeout(() => save(result), 500)
    return () => clearTimeout(pending.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle])
  const ask = async () => {
    setAsking(true)
    try {
      setHint(await fetchAngleScore(item.id))
    } catch (err) {
      report(err)
    } finally {
      setAsking(false)
    }
  }
  if (['running', 'done'].includes(item.production?.status)) return null
  const { heat, relevance, penalty } = result.parts
  const old = Number.isFinite(item.score) ? item.score : null
  const recorded = Boolean(item.scoreParts) || old !== null
  const same = recorded && old === result.total && signature(item.scoreParts) === signature(result.parts)
  const missing = result.missing.map(key => t(NAMES[key]))
  // 知道的不到两项：不打总分；之前记过的总分要能清掉
  const saveLabel = result.total !== null
    ? (old !== null ? t('更新为 {n} 分（上次记的是 {old}）', { n: result.total, old }) : t('记下这个分'))
    : old !== null ? t('不够两项，清掉上次记的 {old} 分', { old }) : result.known.length ? t('记下已知的几项') : null
  return (
    <section className="md-score" aria-label={t('选题评分')}>
      <header className="md-score-head">
        <span>{t('选题评分')}</span>
        {result.total !== null ? <><b>{result.total}</b><small>/100</small></> : <span className="md-score-partial">{knownPartsText(result.parts) || t('三项都还不知道')}</span>}
        <span className="md-grow" />
        {same
          ? <small className="md-muted">{t('已记下')}</small>
          : saveLabel ? <button type="button" className="md-link-btn" onClick={() => save(result)}>{saveLabel}</button> : null}
      </header>
      <ul className="md-score-parts">
        <Part name="heat" value={heat.value}>
          {heat.evergreen ? t('不是从热榜记下的，热度不知道，不算进总分') : t('记下时在{list}排第 {rank}', { list: heat.sourceList || t('热榜'), rank: heat.rank })}
        </Part>
        <Part name="relevance" value={relevance.value}>
          {relevance.noTopics
            ? <>{t('还没设置方向')} <button type="button" className="md-inline-link" onClick={() => { closeItem(); setDesk({ view: 'sources' }) }}>{t('去设置')}</button></>
            : relevance.hits.length ? t('命中：{hits}', { hits: relevance.hits.join('、') }) : t('没有命中我的方向')}
        </Part>
        <Part name="angle" value={result.parts.angle.value}>
          <div className="md-score-angle">
            <input type="range" min={1} max={10} step={1} value={angle ?? 5} className={angle === null ? 'is-unset' : ''} aria-label={t('切入价值，1 到 10')}
              onChange={e => setAngle(Number(e.target.value))} onClick={e => { if (angle === null) setAngle(Number(e.currentTarget.value)) }} />
            {angle === null ? null : <button type="button" className="md-inline-link" onClick={() => setAngle(null)}>{t('清除')}</button>}
          </div>
          {angle === null ? <span>{t('这个角度值不值得写，只有你能判断。拖一下打分；不打就不算进总分。')}</span> : null}
          {hint ? (
            <span className="md-score-hint">
              {t('模型的参考：{n} 分。{reason}', { n: hint.score, reason: hint.reason })}<em>{t('仅供参考，不会自动填入')}</em>
              <button type="button" className="md-inline-link" onClick={() => setAngle(hint.score)}>{t('用这个分')}</button>
            </span>
          ) : <button type="button" className="md-inline-link" disabled={asking} onClick={ask}>{asking ? t('正在问模型…') : t('让模型给个参考分')}</button>}
        </Part>
      </ul>
      {penalty ? (
        <p className="md-score-penalty">
          {t('{days} 天前写过相近的', { days: penalty.days })}
          <button type="button" className="md-inline-link" onClick={() => openItem(penalty.id)}>《{penalty.title}》</button>
          {t('，扣 {n} 分（10 分制）', { n: -penalty.value })}
        </p>
      ) : null}
      <p className="md-score-note">
        {result.total === null ? t('至少知道两项才打总分：{missing}还不知道，不当 0 分。', { missing: missing.join(t('、')) }) : missing.length ? t('{missing}还不知道，没有算 0 分：总分只按已知的项算，权重按比例重新分配。', { missing: missing.join('、') }) : t('三项都已知，按 30% / 40% / 30% 加权。')}
      </p>
    </section>
  )
}
