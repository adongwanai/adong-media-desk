// 信息源：订阅公开的 RSS / Atom，拉回最新条目，挑中的一键记成灵感。条目都来自订阅源本身，工作台不改写也不补内容。
import React from 'react'
import { BuiltinGroups, FeedCatalog, useBuiltin } from './catalog.jsx'
import { dispatchOps, fetchFeeds, sourceSnapshots, useDesk } from './desk.js'
import { FocusBar, RankBar, useFocusRank, Why } from './focus.jsx'
import { HotView } from './hot.jsx'
import { plural, t, useLang } from './i18n.js'
import { Empty, Icon, IconButton, Segmented, Swap } from './ui.jsx'
import { fmtWhen } from './util.js'

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// 订阅和内置来源混排时，热度只在同一个来源里比
const bySource = entry => entry.source
const PAGE = 60

export function SourcesView() {
  useLang()
  const feeds = useDesk(s => s.state.feeds ?? [])
  const items = useDesk(s => s.state.items)
  const [url, setUrl] = React.useState('')
  const [data, setData] = React.useState(sourceSnapshots.feeds)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const builtin = useBuiltin()
  // 还没有订阅源、也没打开内置来源时先看热榜
  const [tab, setTab] = React.useState(() => (feeds.length || builtin.enabled.length ? 'feeds' : 'hot'))
  const merged = React.useMemo(() => [...(data?.entries ?? []), ...builtin.entries].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')), [data, builtin.entries])
  const rank = useFocusRank(merged, bySource)
  // 订阅加内置来源可能有几百条，先列前面的，按需再往下展开
  const [shown, setShown] = React.useState(PAGE)
  // 来源管理默认收起；一个来源都没有时展开，免得页面空着不知道从哪开始
  const [managing, setManaging] = React.useState(() => !feeds.length && !builtin.enabled.length)
  const key = feeds.map(feed => feed.id).join(',')
  const load = React.useCallback(async (force = false) => {
    if (!key) { setData(null); return }
    setBusy(true)
    setError(null)
    try {
      setData(await fetchFeeds(force, !force))
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [key])
  React.useEffect(() => { load() }, [load])
  React.useEffect(() => {
    if (!data?.refreshing) return undefined
    const timer = setTimeout(() => load(), 1500)
    return () => clearTimeout(timer)
  }, [data, load])
  const add = async (event) => {
    event.preventDefault()
    const value = url.trim()
    if (!value) return
    const result = await dispatchOps([{ op: 'add_feed', url: value }], { label: t('添加订阅源') })
    if (result && !result.errors?.length) setUrl('')
  }
  const saved = new Set(items.map(item => item.url).filter(Boolean))
  const keep = entry => dispatchOps([{ op: 'add_item', kind: 'web', title: entry.title, body: entry.summary, url: entry.url, source: entry.author ? `${entry.source} · ${entry.author}` : entry.source }], { label: t('记下灵感') })
  const tabs = <Segmented label={t('信息源')} value={tab} onChange={setTab} options={[{ value: 'feeds', label: t('订阅') }, { value: 'hot', label: t('热榜') }]} />
  if (tab === 'hot') {
    return (
      <div className="md-page md-s-page">
        <div className="md-page-head">
          <div>
            <h1>{t('信息源')}</h1>
            <p className="md-page-sub">{t('订阅的 RSS / Atom 和几个不用登录的公开热榜都列在这里。看中的点「记为灵感」，之后就能一键成稿。')}</p>
          </div>
          <span className="md-grow" />
          {tabs}
        </div>
        <FocusBar />
        <HotView />
      </div>
    )
  }
  const fetching = busy || data?.refreshing || builtin.busy.length > 0 || builtin.enabled.some(id => builtin.groups[id]?.refreshing)
  const hasSources = feeds.length > 0 || builtin.enabled.length > 0
  return (
    <div className="md-page md-s-page">
      <div className="md-page-head">
        <div>
          <h1>{t('信息源')}</h1>
          <p className="md-page-sub">{t('订阅的 RSS / Atom 和几个不用登录的公开热榜都列在这里。看中的点「记为灵感」，之后就能一键成稿。')}</p>
        </div>
        <span className="md-grow" />
        {tabs}
      </div>
      <FocusBar />
      {/* 来源管理收成一行摘要，条目尽量靠上；还没有任何来源时直接展开 */}
      <div className="md-s-bar">
        <button type="button" className="md-s-manage" aria-expanded={managing} aria-controls="md-s-sources" onClick={() => setManaging(value => !value)}>
          <Icon name="list" size={14} />
          <span>{hasSources ? t('{feeds} 个订阅 · {groups} 组内置来源', { feeds: feeds.length, groups: builtin.enabled.length }) : t('还没有来源')}</span>
          <span className="md-s-manage-act">{managing ? t('收起') : t('管理来源')}</span>
          <span className={`md-s-chev ${managing ? 'is-open' : ''}`}><Icon name="chevD" size={13} /></span>
        </button>
        {merged.length ? <RankBar rank={rank} /> : null}
        <span className="md-grow" />
        {merged.length ? <span className="md-tile-meta">{t(plural(rank.rows.length, '共 1 条', '共 {n} 条'), { n: rank.rows.length })}</span> : null}
        {hasSources ? <button type="button" className="md-btn" disabled={fetching} onClick={() => { load(true); builtin.load(builtin.enabled, true) }}><Icon name="refresh" size={14} /><Swap labels={[t('重新抓取'), t('正在抓取…')]} at={fetching ? 1 : 0} /></button> : null}
      </div>
      {managing ? (
        <div className="md-s-sources" id="md-s-sources">
          <form className="md-s-add" onSubmit={add}>
            <input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder={t('粘贴一个 RSS / Atom 地址，以 https:// 开头')} aria-label={t('订阅地址')} />
            <button type="submit" className="md-btn is-primary"><Icon name="plus" size={14} />{t('添加订阅')}</button>
          </form>
          {feeds.length ? (
            <ul className="md-s-feeds">
              {feeds.map(feed => <li key={feed.id} className="md-s-feed" title={feed.url}><span>{feed.title || hostOf(feed.url)}</span><IconButton icon="close" size={12} label={t('删除这个订阅源')} onClick={() => dispatchOps([{ op: 'delete_feed', id: feed.id }], { label: t('删除订阅源') })} /></li>)}
            </ul>
          ) : (
            <div className="md-s-none">
              <p className="md-muted">{t('还没有订阅源。很多博客、GitHub 发布页和资讯站都提供 RSS 地址，贴到上面的框里就行；也可以从下面的推荐里挑，或者先看热榜。')}</p>
              <button type="button" className="md-btn is-small" onClick={() => setTab('hot')}>{t('先看热榜')}</button>
            </div>
          )}
          <FeedCatalog />
          <BuiltinGroups builtin={builtin} />
        </div>
      ) : null}
      {error ? <p className="md-s-errors">{t('抓取失败：{error}', { error })}</p> : null}
      {data?.errors.length ? (
        <details className="md-s-errbox">
          <summary>{t('{n} 个订阅源没读到', { n: data.errors.length })}</summary>
          <div className="md-s-errors">{data.errors.map(row => <p key={row.url}>{hostOf(row.url)}：{row.error}</p>)}</div>
        </details>
      ) : null}
      {rank.rows.length ? (
        <ul className="md-s-list">
          {rank.rows.slice(0, shown).map(({ entry, why }) => (
            <li key={`${entry.feedId ?? entry.groupId}:${entry.url}`}>
              <div className="md-s-entry">
                <a href={entry.url} target="_blank" rel="noreferrer noopener">{entry.title}</a>
                {entry.summary ? <p>{entry.summary}</p> : null}
                <small>{entry.source}{entry.author ? ` · ${entry.author}` : ''}{entry.role ? `（${entry.role}）` : ''}{entry.date ? ` · ${fmtWhen(entry.date)}` : ''}<Why why={why} /></small>
              </div>
              {saved.has(entry.url) ? <span className="md-s-kept"><Icon name="check" size={12} />{t('已记下')}</span> : <button type="button" className="md-pill is-small" onClick={() => keep(entry)}><Icon name="plus" size={13} />{t('记为灵感')}</button>}
            </li>
          ))}
        </ul>
      ) : fetching ? (
        <ul className="md-s-list is-loading" aria-label={t('正在抓取…')}>
          {[0, 1, 2, 3].map(n => <li key={n}><div className="md-skeleton"><i /><i /></div></li>)}
        </ul>
      ) : hasSources ? (
        <Empty title={t('这次没有读到条目')} hint={t('可能是订阅源暂时打不开，或者都被「不想看」隐藏了。')} action={<div className="md-empty-actions"><button type="button" className="md-btn" onClick={() => { load(true); builtin.load(builtin.enabled, true) }}><Icon name="refresh" size={14} />{t('重新抓取')}</button></div>} />
      ) : null}
      {rank.rows.length > shown ? <button type="button" className="md-btn md-s-more" onClick={() => setShown(value => value + PAGE)}>{t('再显示 {n} 条（还有 {left} 条）', { n: Math.min(PAGE, rank.rows.length - shown), left: rank.rows.length - shown })}</button> : null}
    </div>
  )
}
