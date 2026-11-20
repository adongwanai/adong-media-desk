// 订阅页的两块：一键源包（点一下才加成订阅）和内置信息源（默认全关，打开哪组才读哪组）。
import React from 'react'
import { BUILTIN_GROUPS, FEED_CATALOG, FEED_CATALOG_VERIFIED, FEED_GROUPS, GITHUB_RELEASES_PATTERN } from '../src/feed-catalog.js'
import { dispatchOps, fetchBuiltin, report, sourceSnapshots, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { fmtTime } from './util.js'

const NONE = []

/** 常用的公开订阅源，按语言和类型分组。已经加过的显示「已添加」。 */
export function FeedCatalog() {
  const feeds = useDesk(s => s.state.feeds ?? NONE)
  const [open, setOpen] = React.useState(() => !feeds.length)
  const have = new Set(feeds.map(feed => feed.url))
  return (
    <section className="md-cat">
      <button type="button" className="md-link-btn" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? t('收起常用订阅源') : t('从常用订阅源里挑')}
      </button>
      {open ? (
        <>
          {FEED_GROUPS.map(group => (
            <div key={group} className="md-cat-group">
              <span className="md-cat-name">{t(group)}</span>
              <div className="md-cat-row">
                {FEED_CATALOG.filter(row => row.group === group).map(row => (have.has(row.url)
                  ? <span key={row.url} className="md-cat-item is-added" title={t(row.note)}><Icon name="check" size={12} />{row.title}</span>
                  : <button type="button" key={row.url} className="md-cat-item" title={t(row.note)} onClick={() => dispatchOps([{ op: 'add_feed', url: row.url, title: row.title }], { label: t('添加订阅源') })}><Icon name="plus" size={12} />{row.title}</button>))}
              </div>
            </div>
          ))}
          <p className="md-cat-hint">{t('GitHub 项目的发布记录也能订阅：{pattern}，把 OWNER/REPO 换成项目名贴到上面。', { pattern: GITHUB_RELEASES_PATTERN })}</p>
          <p className="md-cat-hint">{t('这些地址都在 {date} 实际读过一遍，之后网站改版也可能读不到，读不到时会写明原因。', { date: FEED_CATALOG_VERIFIED })}</p>
        </>
      ) : null}
    </section>
  )
}

/** 打开了的内置分组：页面打开时读一遍，之后新打开哪组读哪组。 */
export function useBuiltin() {
  const enabled = useDesk(s => s.state.builtin ?? NONE)
  const [groups, setGroups] = React.useState(sourceSnapshots.builtin)
  const [busy, setBusy] = React.useState(NONE)
  const load = React.useCallback(async (ids, force = false) => {
    if (!ids.length) return
    setBusy(prev => [...prev, ...ids])
    try {
      const data = await fetchBuiltin(ids, force, !force)
      setGroups(prev => ({ ...prev, ...Object.fromEntries(data.groups.map(group => [group.id, group])) }))
    } catch (err) {
      report(err)
    } finally {
      setBusy(prev => prev.filter(id => !ids.includes(id)))
    }
  }, [])
  const seen = React.useRef(null)
  const key = enabled.join(',')
  React.useEffect(() => {
    const fresh = seen.current === null ? enabled : enabled.filter(id => !seen.current.includes(id))
    seen.current = enabled
    load(fresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load])
  React.useEffect(() => {
    const pending = enabled.filter(id => groups[id]?.refreshing)
    if (!pending.length) return undefined
    const timer = setTimeout(() => load(pending), 1500)
    return () => clearTimeout(timer)
  }, [groups, key, load])
  const entries = React.useMemo(() => enabled.flatMap(id => (groups[id]?.sources ?? []).flatMap(source => source.entries)), [enabled, groups])
  return { enabled, groups, busy, load, entries }
}

/** 内置信息源的开关和每个来源的读取结果。 */
export function BuiltinGroups({ builtin }) {
  const toggle = (id, on) => dispatchOps([{ op: 'set_builtin', id, on }], { label: t(on ? '打开内置信息源' : '关闭内置信息源'), undoable: false, silent: true })
  return (
    <section className="md-builtin" aria-label={t('内置信息源')}>
      <div className="md-builtin-head">
        <span className="md-cat-name">{t('内置信息源')}</span>
        <small className="md-muted">{t('第一次使用时全部打开，可以一组一组关；读到的条目和订阅排在一起。')}</small>
      </div>
      {BUILTIN_GROUPS.map((group) => {
        const on = builtin.enabled.includes(group.id)
        const result = builtin.groups[group.id]
        return (
          <div key={group.id} className={`md-builtin-group ${on ? 'is-on' : ''}`}>
            <label className="md-builtin-switch">
              <input type="checkbox" checked={on} onChange={e => toggle(group.id, e.target.checked)} />
              <b>{t(group.name)}</b>
              <small>{t(group.note)} · {t('来自 {via}', { via: group.via })}</small>
            </label>
            {on ? (
              <div className="md-builtin-status">
                {builtin.busy.includes(group.id) ? <span>{t('正在读取…')}</span> : (result?.sources ?? NONE).map(source => (
                  <span key={source.id} className={source.error ? 'is-failed' : ''} title={source.error ?? ''}>
                    {source.error ? t('{name}没读到：{error}', { name: source.name, error: source.error }) : t('{name} {n} 条 · 读取于 {time}', { name: source.name, n: source.entries.length, time: fmtTime(source.fetchedAt) })}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
