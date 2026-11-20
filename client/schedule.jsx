// 排期：发布排期和灵感日历是同一张日历。每天一张灵感邮票，发布的内容从右边拖上来。
import React from 'react'
import { PlatformMark } from './board.jsx'
import { typeCover } from './cover.js'
import { dispatchOps, openItem, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { openQuickCapture } from './quick-capture.js'
import { Stamp, useDayMap } from './stamps.jsx'
import { Icon, IconButton } from './ui.jsx'
import { STATUS_LABEL, computeStreak, dayKey, displayItem, fmtDate, fmtTime, posterOf, relativeDay, unit } from './util.js'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// 中文原文，显示时再翻译
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const TYPE = 'text/media-desk-item'
// 待排期一次先放 30 条，往下点「再显示」，一百多条稿子也不卡
const PAGE = 30
const CELL_CHIPS = 3

function startDrag(event, id) {
  event.dataTransfer.setData(TYPE, id)
  event.dataTransfer.effectAllowed = 'move'
}

function moveTo(items, id, date) {
  const item = items.find(i => i.id === id)
  if (!item) return
  const target = new Date(date)
  const previous = item.scheduledAt ? new Date(item.scheduledAt) : null
  target.setHours(previous?.getHours() ?? 20, previous?.getMinutes() ?? 0, 0, 0)
  dispatchOps([{ op: 'schedule_item', id, scheduledAt: target.toISOString() }], { label: t('修改排期') })
}

/** 小封面：有图用图，没图用和大屏同一套文字封面。 */
function Thumb({ item }) {
  const shown = displayItem(item)
  const poster = posterOf(shown)
  const src = React.useMemo(() => poster || typeCover({ id: item.id, title: shown.title, size: 'thumb' }), [poster, item.id, shown.title])
  return <span className="md-tray-thumb">{src ? <img src={src} alt="" draggable={false} loading="lazy" /> : null}</span>
}

function Chip({ item }) {
  const shown = displayItem(item)
  return (
    <button type="button" className={`md-cal-chip status-${item.status}`} draggable title={`${fmtTime(item.scheduledAt)} ${shown.title}`} onDragStart={event => startDrag(event, item.id)} onClick={() => openItem(item.id)}>
      {item.platform ? <PlatformMark platform={item.platform} size={16} /> : <i className="md-cal-chip-dot" aria-hidden="true" />}
      <time>{fmtTime(item.scheduledAt)}</time>
      <span>{shown.title}</span>
    </button>
  )
}

function Calendar({ items }) {
  const [cursor, setCursor] = React.useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [over, setOver] = React.useState(null)
  const days = useDayMap()
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const first = new Date(y, m, 1).getDay()
  const cells = []
  for (let i = 0; i < 42; i += 1) cells.push(new Date(y, m, i - first + 1))
  // 2 月 1 日正好是周日时只需要 4 行，多数月份 5 行，少数 6 行
  const rows = cells[28].getMonth() !== m ? cells.slice(0, 28) : cells[35].getMonth() === m ? cells : cells.slice(0, 35)
  const byDay = React.useMemo(() => {
    const map = new Map()
    for (const item of items) {
      if (!item.scheduledAt || item.parentId) continue
      const key = dayKey(item.scheduledAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    for (const list of map.values()) list.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    return map
  }, [items])
  const today = dayKey(new Date())
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`
  const monthIdeas = [...days.entries()].filter(([key]) => key.startsWith(prefix)).reduce((sum, [, list]) => sum + list.length, 0)
  const monthPosts = [...byDay.keys()].filter(key => key.startsWith(prefix)).reduce((sum, key) => sum + byDay.get(key).length, 0)
  const streak = computeStreak(items)
  return (
    <section className="md-tile md-cal-tile">
      <header className="md-cal-head">
        <div className="md-cal-num">{String(m + 1).padStart(2, '0')}</div>
        <div className="md-cal-month"><span>{y}</span><em>{MONTHS[m]}</em></div>
        <dl className="md-cal-stats">
          <div><dt>{t('连续记录')}</dt><dd>{streak}<small>{unit(streak, '天')}</small></dd></div>
          <div><dt>{t('本月灵感')}</dt><dd>{monthIdeas}<small>{t('条')}</small></dd></div>
          <div><dt>{t('本月排期')}</dt><dd>{monthPosts}<small>{t('条')}</small></dd></div>
        </dl>
        <span className="md-grow" />
        <IconButton icon="chevL" label={t('上个月')} onClick={() => setCursor(new Date(y, m - 1, 1))} />
        <button type="button" className="md-pill is-small" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>{t('今天')}</button>
        <IconButton icon="chevR" label={t('下个月')} onClick={() => setCursor(new Date(y, m + 1, 1))} />
      </header>
      <div className="md-cal-weeks">{WEEK.map((w, i) => <span key={w} className={i === 0 || i === 6 ? 'is-weekend' : ''}>{t(w)}</span>)}</div>
      <div className="md-cal-grid" role="grid" style={{ '--rows': rows.length / 7 }}>
        {rows.map((date) => {
          const key = dayKey(date)
          const posts = byDay.get(key) ?? []
          const ideas = days.get(key)
          const isToday = key === today
          return (
            <div
              key={key}
              role="gridcell"
              aria-current={isToday ? 'date' : undefined}
              className={`md-cal-cell ${date.getMonth() !== m ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${over === key ? 'is-over' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setOver(key) }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(o => (o === key ? null : o)) }}
              onDrop={(event) => {
                event.preventDefault()
                setOver(null)
                const id = event.dataTransfer.getData(TYPE)
                if (id) moveTo(items, id, date)
              }}
            >
              <div className="md-cal-cell-top">
                <span className="md-cal-date">{date.getDate()}</span>
                {isToday ? <span className="md-cal-today">{t('今天')}</span> : null}
                <span className="md-grow" />
                {/* 格子矮时只放两条，「+N」跟着换成对应的那一个 */}
                {posts.length > CELL_CHIPS - 1 ? <span className="md-cal-more is-short" title={t('这天一共排了 {n} 条', { n: posts.length })}>+{posts.length - CELL_CHIPS + 1}</span> : null}
                {posts.length > CELL_CHIPS ? <span className="md-cal-more is-tall" title={t('这天一共排了 {n} 条', { n: posts.length })}>+{posts.length - CELL_CHIPS}</span> : null}
                {ideas?.length || isToday ? <div className="md-cal-stamp"><Stamp list={ideas} today={isToday} label={t('{date}的灵感', { date: fmtDate(date) })} onOpen={() => openItem(ideas[0].id)} /></div> : null}
              </div>
              <div className="md-cal-posts">
                {posts.slice(0, CELL_CHIPS).map(item => <Chip key={item.id} item={item} />)}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// 待排期的顺序：待发布在前，然后是草稿、大纲、灵感；同一类里新的在前
const ORDER = { ready: 0, draft: 1, outline: 2, idea: 3 }
const NO_PLATFORM = '__none__'

function TrayRow({ item }) {
  const shown = displayItem(item)
  return (
    <li>
      <button type="button" draggable className="md-tray-row" title={shown.title} onDragStart={event => startDrag(event, item.id)} onClick={() => openItem(item.id)}>
        <Thumb item={item} />
        <span className="md-tray-copy">
          <span className="md-tray-title">{shown.title}</span>
          <span className="md-tray-meta">
            {item.platform ? <span className="md-tray-platform"><PlatformMark platform={item.platform} size={14} />{t(item.platform)}</span> : null}
            <span className={`md-tray-status is-${item.status}`}><i aria-hidden="true" />{t(STATUS_LABEL[item.status] ?? item.status)}</span>
            <time>{fmtDate(item.createdAt)}</time>
          </span>
        </span>
      </button>
    </li>
  )
}

function Rail({ items }) {
  const [over, setOver] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [platform, setPlatform] = React.useState('')
  const [limit, setLimit] = React.useState(PAGE)
  const upcoming = items.filter(i => i.scheduledAt && i.status !== 'published' && new Date(i.scheduledAt) >= new Date()).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
  const next = upcoming[0]
  const waiting = React.useMemo(() => items
    .filter(i => !i.scheduledAt && !i.parentId && i.status !== 'published')
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))), [items])
  const platforms = React.useMemo(() => {
    const counts = new Map()
    for (const item of waiting) counts.set(item.platform || NO_PLATFORM, (counts.get(item.platform || NO_PLATFORM) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => (a[0] === NO_PLATFORM) - (b[0] === NO_PLATFORM) || b[1] - a[1])
  }, [waiting])
  // 选中的平台被拖空以后按钮会消失，这时回到「全部」
  const active = platforms.some(([name]) => name === platform) ? platform : ''
  const needle = query.trim().toLowerCase()
  const matched = waiting.filter(item => (!active || (item.platform || NO_PLATFORM) === active)
    && (!needle || `${displayItem(item).title} ${item.title}`.toLowerCase().includes(needle)))
  const shown = matched.slice(0, limit)
  // 换了搜索词或平台就回到第一页
  React.useEffect(() => { setLimit(PAGE) }, [needle, active])
  return (
    <aside className="md-rail-col">
      {next ? (
        <button type="button" className="md-next" onClick={() => openItem(next.id)}>
          <span className="md-next-top"><span>{t('下一条')}</span><span>{relativeDay(next.scheduledAt)}</span></span>
          <b>{fmtTime(next.scheduledAt)}</b>
          <p>{displayItem(next).title}</p>
          <span className="md-next-foot">{next.platform ? `${t(next.platform)} · ` : ''}{t(STATUS_LABEL[next.status])} · {fmtDate(next.scheduledAt)}</span>
        </button>
      ) : null}
      <section
        className={`md-tile md-tray ${over ? 'is-over' : ''}`}
        aria-label={t('待排期')}
        onDragOver={(event) => { event.preventDefault(); setOver(true) }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          const id = event.dataTransfer.getData(TYPE)
          if (id && items.find(i => i.id === id)?.scheduledAt) dispatchOps([{ op: 'schedule_item', id, scheduledAt: null }], { label: t('取消排期') })
        }}
      >
        <header className="md-tray-head">
          <h2>{t('待排期')}</h2>
          <span className="md-tray-count">{waiting.length}</span>
          <span className="md-grow" />
          <span className="md-tray-hint"><Icon name="calendar" size={12} />{t('拖到日历上')}</span>
        </header>
        {waiting.length ? (
          <div className="md-tray-tools">
            <label className="md-tray-search">
              <Icon name="search" size={14} />
              <input type="search" value={query} placeholder={t('搜标题')} aria-label={t('搜待排期的标题')} onChange={event => setQuery(event.target.value)} />
              {query ? <button type="button" aria-label={t('清空搜索')} onClick={() => setQuery('')}><Icon name="close" size={12} /></button> : null}
            </label>
            {platforms.length > 1 ? (
              <div className="md-tray-filter" role="radiogroup" aria-label={t('按平台筛选')}>
                <button type="button" role="radio" aria-checked={!active} className={!active ? 'is-on' : ''} onClick={() => setPlatform('')}>{t('全部')}<span>{waiting.length}</span></button>
                {platforms.map(([name, count]) => (
                  <button type="button" role="radio" key={name} aria-checked={active === name} className={active === name ? 'is-on' : ''} onClick={() => setPlatform(active === name ? '' : name)}>
                    {name === NO_PLATFORM ? t('未定平台') : <><PlatformMark platform={name} size={14} />{t(name)}</>}
                    <span>{count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="md-tray-scroll">
          {!waiting.length ? (
            <div className="md-tray-empty">
              <p>{t('记下灵感或做好稿子后，从这里拖到日历上。')}</p>
              <button type="button" className="md-btn is-small" onClick={openQuickCapture}>{t('记一条灵感')}</button>
            </div>
          ) : !matched.length ? (
            <div className="md-tray-empty">
              <p>{needle ? t('没有标题里带「{q}」的稿子。', { q: query.trim() }) : t('这个平台没有待排期的稿子。')}</p>
              <button type="button" className="md-btn is-small" onClick={() => { setQuery(''); setPlatform('') }}>{t('看全部')}</button>
            </div>
          ) : (
            <ul className="md-tray-list">{shown.map(item => <TrayRow key={item.id} item={item} />)}</ul>
          )}
          {matched.length > shown.length ? (
            <button type="button" className="md-tray-more" onClick={() => setLimit(n => n + PAGE)}>
              {t('再显示 {n} 条', { n: Math.min(PAGE, matched.length - shown.length) })}<small>{t('还有 {n} 条', { n: matched.length - shown.length })}</small>
            </button>
          ) : null}
        </div>
      </section>
    </aside>
  )
}

export function ScheduleView() {
  useLang()
  const items = useDesk(s => s.state.items)
  return (
    <div className="md-board-page md-sched-page">
      <div className="md-schedule">
        <Calendar items={items} />
        <Rail items={items} />
      </div>
    </div>
  )
}
