// 热榜优先显示当日缓存；后台更新失败时保留上次榜单，并显示真实读取时间和失败原因。
import React from 'react'
import { crossLists } from '../src/rank.js'
import { dispatchOps, fetchHot, report, sourceSnapshots, useDesk } from './desk.js'
import { RankBar, useFocusRank, Why } from './focus.jsx'
import { t, useLang } from './i18n.js'
import { Icon, Swap } from './ui.jsx'
import { compact, fmtTime } from './util.js'

const NONE = []

/** 打开时默认看哪个榜：第一个读到的；都没读到就看第一个。 */
export function firstLoaded(sources) {
  return (sources.find(row => !row.error) ?? sources[0])?.id ?? null
}

/** 这次没读到的榜：一行一句，后面跟「再读一次」。 */
function Failures({ rows, retrying, onRetry }) {
  if (!rows.length) return null
  return (
    <ul className="md-hot-failed" aria-label={t('没读到的榜单')}>
      {rows.map(row => (
        <li key={row.id}>
          <span>{t('{name}这次没读到：{reason}', { name: row.name, reason: row.error })}</span>
          <button type="button" className="md-inline-link" disabled={retrying === row.id} onClick={() => onRetry(row.id)}>{retrying === row.id ? t('正在读…') : t('再读一次')}</button>
        </li>
      ))}
    </ul>
  )
}
// 「同时上多个榜的」放在榜单最前面，当成一个特殊的榜
const CROSS = 'cross'

/** 同时上多个榜的：每件事一行，写明它在哪几个榜、各排第几。 */
function CrossView({ groups, saved, keep, onBrowse }) {
  if (!groups.length) return <div className="md-s-none"><p className="md-muted">{t('这次读到的榜单里，没有同时上两个榜的事。')}</p>{onBrowse ? <button type="button" className="md-btn is-small" onClick={onBrowse}>{t('看单个榜单')}</button> : null}</div>
  return (
    <ol className="md-s-list md-hot-list">
      {groups.map((group) => {
        const best = group.entries[0]
        return (
          <li key={`${best.sourceId}|${best.url}`}>
            <span className="md-hot-rank is-top">{group.names.length}</span>
            <div className="md-s-entry">
              <a href={best.url} target="_blank" rel="noreferrer noopener">{best.title}</a>
              <small>{group.entries.map(row => t('{name}第 {rank}', { name: row.source, rank: row.rank })).join(' · ')}</small>
            </div>
            {saved.has(best.url) ? <span className="md-tile-meta">{t('已记下')}</span> : <button type="button" className="md-pill is-small" onClick={() => keep(best)}><Icon name="plus" size={13} />{t('记为灵感')}</button>}
          </li>
        )
      })}
    </ol>
  )
}

export function HotView() {
  useLang()
  const items = useDesk(s => s.state.items)
  const [sources, setSources] = React.useState(sourceSnapshots.hot?.sources ?? null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [active, setActive] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [retrying, setRetrying] = React.useState(null)
  const load = React.useCallback(async (ids, force = true) => {
    setBusy(true)
    if (ids?.length === 1) setRetrying(ids[0])
    try {
      const data = await fetchHot(ids, force, !force)
      setRefreshing(data.refreshing)
      // 只换掉这次读的榜单，其余保持原样（各自带着自己的读取时间）
      setSources(prev => (ids && prev ? prev.map(row => data.sources.find(next => next.id === row.id) ?? row) : data.sources))
      // 默认停在第一个读到的榜上，不停在读失败的空白页
      setActive(prev => prev ?? firstLoaded(data.sources))
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
      setRetrying(null)
    }
  }, [])
  React.useEffect(() => { load(undefined, false) }, [load])
  React.useEffect(() => {
    if (!refreshing) return undefined
    const timer = setTimeout(() => load(undefined, false), 1500)
    return () => clearTimeout(timer)
  }, [refreshing, sources, load])
  const saved = new Set(items.map(item => item.url).filter(Boolean))
  // 名次、热度和榜单名跟着灵感一起记下，选题评分卡要用
  const keep = entry => dispatchOps([{ op: 'add_item', kind: 'web', title: entry.title, body: entry.summary ?? '', url: entry.url, source: entry.source, rank: entry.rank, heat: entry.heat ?? undefined, sourceList: entry.source }], { label: t('记下灵感') })
  const current = sources?.find(row => row.id === active) ?? null
  const cross = React.useMemo(() => crossLists(sources ?? NONE), [sources])
  const rank = useFocusRank(current?.entries ?? NONE)
  const failed = (sources ?? NONE).filter(row => row.error)
  if (!sources) return busy ? <p className="md-muted">{t('正在读取热榜…')}</p> : <div><p className="md-muted">{t('热榜没有读到。')}</p><button type="button" className="md-btn" onClick={() => load()}>{t('重试')}</button></div>
  return (
    <div className="md-hot">
      <div className="md-hot-bar">
        <div className="md-hot-chips" role="tablist" aria-label={t('热榜')}>
          <button type="button" role="tab" aria-selected={active === CROSS} className={`md-hot-chip ${active === CROSS ? 'is-on' : ''}`} onClick={() => setActive(CROSS)}>
            {t('同时上多个榜的')}<small>{cross.groups.length}</small>
          </button>
          {sources.map(row => (
            <button type="button" role="tab" key={row.id} aria-selected={row.id === active} className={`md-hot-chip ${row.id === active ? 'is-on' : ''} ${row.error ? 'is-failed' : ''}`} onClick={() => setActive(row.id)}>
              {row.name}<small>{row.error ? t('没读到') : row.entries.length}</small>
            </button>
          ))}
        </div>
        <span className="md-grow" />
        {current ? <span className="md-tile-meta">{t('读取于 {time}', { time: fmtTime(current.fetchedAt) })}</span> : null}
        <button type="button" className="md-btn" disabled={busy || !current} onClick={() => load([current.id])}><Icon name="refresh" size={14} /><Swap labels={[t('重新读取'), t('正在读取…')]} at={busy ? 1 : 0} /></button>
      </div>
      {/* 读失败的榜在这里各写一句；当前正看着的那个失败榜，下面只放它自己那句 */}
      <Failures rows={failed} retrying={retrying} onRetry={id => load([id])} />
      {active === CROSS ? <CrossView groups={cross.groups} saved={saved} keep={keep} onBrowse={firstLoaded(sources) ? () => setActive(firstLoaded(sources)) : null} /> : null}
      {current?.entries.length ? <RankBar rank={rank} /> : null}
      {current?.refreshing && !current.entries.length ? <p className="md-muted">{t('正在读取热榜…')}</p> : current ? (
        <ol className="md-s-list md-hot-list">
          {rank.rows.map(({ entry, why }) => (
            <li key={entry.url}>
              <span className={`md-hot-rank ${entry.rank <= 3 ? 'is-top' : ''}`}>{entry.rank}</span>
              <div className="md-s-entry">
                <a href={entry.url} target="_blank" rel="noreferrer noopener">{entry.title}</a>
                {entry.summary ? <p>{entry.summary}</p> : null}
                {why || cross.tags[`${current.id}|${entry.url}`] ? (
                  <small>
                    {cross.tags[`${current.id}|${entry.url}`] ? <span className="md-multi">{t('多榜同现 · {names}', { names: cross.tags[`${current.id}|${entry.url}`].join('/') })}</span> : null}
                    <Why why={why} />
                  </small>
                ) : null}
              </div>
              {entry.heat === null ? null : <span className="md-hot-heat" title={`${entry.heat.toLocaleString()} ${current.unit}`}><b>{compact(entry.heat)}</b><small>{current.unit}</small></span>}
              {saved.has(entry.url) ? <span className="md-tile-meta">{t('已记下')}</span> : <button type="button" className="md-pill is-small" onClick={() => keep(entry)}><Icon name="plus" size={13} />{t('记为灵感')}</button>}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
