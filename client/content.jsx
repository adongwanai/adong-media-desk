// 内容管理：看板和表格是同一份数据的两种看法。
import React from 'react'
import { dispatchOps, openItem, setDesk, useDesk } from './desk.js'
import { Empty, Icon, Segmented } from './ui.jsx'
import { plural, t, useLang } from './i18n.js'
import { openQuickCapture } from './quick-capture.js'
import { ImportFolderDialog, ImportedBadge } from './import-folder.jsx'
import { Poster, initialOf, useProgressive } from './lazy.jsx'
import { markdownPlain } from './md-render.js'
import { ScheduleWorkspace } from './schedule.jsx'
import { KIND_LABEL, STATUSES, STATUS_LABEL, displayItem, fmtWhen, isPiece, pieceCounts, pieceStatus, posterOf, relativeDay, textLength } from './util.js'

function useContentItems() {
  const items = useDesk(s => s.state.items)
  const query = useDesk(s => s.query).trim().toLowerCase()
  return React.useMemo(() => items.filter((item) => {
    if (!query) return true
    // 导入的稿子 body 只是摘录，全文在 production.article：正文里的字也要搜得到
    return [item.title, item.body, item.production?.title, item.production?.article, item.source, item.platform, item.platform && t(item.platform), ...(item.tags ?? [])].some(v => String(v ?? '').toLowerCase().includes(query))
  }), [items, query])
}

// 看板每列、表格一次先画这么多，往下滚再画后面的，几百条也不卡
const COLUMN_PAGE = 30
const TABLE_PAGE = 80

const BoardCard = React.memo(function BoardCard({ item: raw }) {
  // 有成稿时显示成稿的标题和封面
  const item = displayItem(raw)
  const poster = posterOf(item)
  const words = React.useMemo(() => {
    const src = raw.production?.article || item.drafts?.article?.text || ''
    return src ? textLength(markdownPlain(src)) : 0
  }, [raw.production?.article, item.drafts?.article?.text])
  const publishedCount = raw.publish ? Object.values(raw.publish).filter(v => v?.state === 'published').length : 0
  return (
    <button
      type="button"
      className="md-board-card"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/media-desk-item', item.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        openItem(item.id, { x: rect.left, y: rect.top, w: rect.width, h: rect.height })
      }}
    >
      {poster ? <span className="md-board-cover"><Poster src={poster} /></span> : null}
      <strong title={item.title}>{item.title}</strong>
      <span className="md-board-meta">
        {item.platform ? <span>{t(item.platform)}</span> : null}
        {words > 0 ? <span>{t('{n} 字', { n: words.toLocaleString() })}</span> : null}
        {publishedCount > 0 ? <span className="is-pub-badge">{t('已发 {n}', { n: publishedCount })}</span> : null}
        {item.scheduledAt && item.status !== 'published' ? <span className="is-time">{relativeDay(item.scheduledAt)}</span> : null}
        {raw.production?.status === 'done' || item.drafts?.article ? <Icon name="pen" size={12} /> : null}
        {item.drafts?.script ? <Icon name="film" size={12} /> : null}
        <ImportedBadge item={raw} />
      </span>
    </button>
  )
})

function BoardColumn({ status, rows, over, setOver, collapsed, onToggleCollapse }) {
  const { limit, sentinel, more } = useProgressive(rows.length, COLUMN_PAGE)
  const left = rows.length - limit
  return (
    <section
      className={`md-board-col ${over === status ? 'is-over' : ''} ${collapsed ? 'is-collapsed' : ''}`}
      aria-label={t(STATUS_LABEL[status])}
      onDragOver={(event) => {
        event.preventDefault()
        if (over !== status) setOver(status)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOver(null)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(null)
        const id = event.dataTransfer.getData('text/media-desk-item')
        if (id) dispatchOps([{ op: 'set_status', id, status }], { label: t('修改状态') })
      }}
    >
      <header onClick={rows.length === 0 ? onToggleCollapse : undefined} style={rows.length === 0 ? { cursor: 'pointer' } : undefined} title={rows.length === 0 ? t('点击展开或收起空列') : undefined}>
        <span className={`md-dot status-${status}`} />
        <h3>{t(STATUS_LABEL[status])}</h3>
        <span className="md-board-count">{rows.length}</span>
      </header>
      {collapsed ? null : (
        <div className="md-board-list">
          {rows.slice(0, limit).map(item => <BoardCard key={item.id} item={item} />)}
          {rows.length === 0 ? <p className="md-board-empty">{t('拖到这里')}</p> : null}
          {left > 0 ? <button type="button" ref={sentinel} className="md-board-more" onClick={more}>{t('再显示 {n} 条', { n: Math.min(left, COLUMN_PAGE) })}</button> : null}
        </div>
      )}
    </section>
  )
}

/** 横向放不下时左右两边淡出，提示还能往旁边滚。 */
function useEdges(ref) {
  const [edges, setEdges] = React.useState({ left: false, right: false })
  React.useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const left = el.scrollLeft > 2
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure) }
  }, [ref])
  return edges
}

function Board({ items }) {
  const [over, setOver] = React.useState(null)
  const [expandedEmpty, setExpandedEmpty] = React.useState(() => new Set())
  const ref = React.useRef(null)
  const edges = useEdges(ref)
  // 一次分好五列，不在每列里各扫一遍
  const columns = React.useMemo(() => {
    const map = Object.fromEntries(STATUSES.map(status => [status, []]))
    // 和 pieceCounts 同一套分法：还停在灵感状态的分支不占位置；哪个平台发出去了就放进「已发布」
    for (const item of items) if (isPiece(item) && map[pieceStatus(item)]) map[pieceStatus(item)].push(item)
    return map
  }, [items])
  // 空列默认收成紧凑窄条，把横向空间让给有上百条草稿的列；拖拽经过或点击标题时展开
  const isCollapsed = status => columns[status].length === 0 && over !== status && !expandedEmpty.has(status)
  const template = STATUSES.map(status => (columns[status].length ? 'minmax(180px, 1fr)' : isCollapsed(status) ? '68px' : 'minmax(120px, .55fr)')).join(' ')
  const toggleEmpty = status => setExpandedEmpty((prev) => {
    const next = new Set(prev)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    return next
  })
  const scrollBy = dir => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <div className={`md-board-wrap ${edges.left ? 'can-left' : ''} ${edges.right ? 'can-right' : ''}`}>
      <div className="md-board" ref={ref} role="group" aria-label={t('看板')} style={{ gridTemplateColumns: template }}>
        {STATUSES.map(status => <BoardColumn key={status} status={status} rows={columns[status]} over={over} setOver={setOver} collapsed={isCollapsed(status)} onToggleCollapse={() => toggleEmpty(status)} />)}
      </div>
      {edges.left ? <button type="button" className="md-board-nudge is-left" aria-label={t('往左看')} title={t('往左看')} onClick={() => scrollBy(-1)}><Icon name="chevL" size={16} /></button> : null}
      {edges.right ? <button type="button" className="md-board-nudge is-right" aria-label={t('往右看更多列')} title={t('往右看更多列')} onClick={() => scrollBy(1)}><Icon name="chevR" size={16} /></button> : null}
    </div>
  )
}

// label 是中文原文，显示时再翻译
const COLUMNS = [
  { key: 'title', label: '内容', get: i => i.title },
  { key: 'status', label: '状态', get: i => STATUSES.indexOf(pieceStatus(i)) },
  { key: 'platform', label: '平台', get: i => i.platform ?? '' },
  { key: 'scheduledAt', label: '排期', get: i => i.scheduledAt ?? '' },
  { key: 'createdAt', label: '记录于', get: i => i.createdAt },
]

function Table({ items }) {
  const [sort, setSort] = React.useState({ key: 'createdAt', dir: -1 })
  const { limit, sentinel, more } = useProgressive(items.length, TABLE_PAGE, items.length)
  const sorted = React.useMemo(() => {
    const column = COLUMNS.find(c => c.key === sort.key)
    return [...items].sort((a, b) => {
      const x = column.get(a)
      const y = column.get(b)
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
    })
  }, [items, sort])
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {COLUMNS.map(column => (
              <th key={column.key} aria-sort={sort.key === column.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => setSort(s => ({ key: column.key, dir: s.key === column.key ? -s.dir : 1 }))}>
                  {t(column.label)}
                  {sort.key === column.key ? <Icon name={sort.dir > 0 ? 'send' : 'chevD'} size={11} /> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, limit).map((item) => {
            const poster = posterOf(item)
            return (
              <tr key={item.id} onClick={() => openItem(item.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') openItem(item.id) }}>
                <td className="md-table-title">
                  <span className="md-thumb"><Poster src={poster} fallback={<span>{initialOf(item.title)}</span>} /></span>
                  <span className="md-table-text"><strong title={item.title}>{item.title}</strong><small>{item.parentId ? `${t('分支')} · ` : ''}{t(KIND_LABEL[item.kind])}{item.source ? ` · ${item.source}` : ''} <ImportedBadge item={item} /></small></span>
                </td>
                <td><span className={`md-status status-${pieceStatus(item)}`}>{t(STATUS_LABEL[pieceStatus(item)])}</span></td>
                <td>{item.platform ? t(item.platform) : '—'}</td>
                <td className="md-nowrap">{item.scheduledAt ? fmtWhen(item.scheduledAt) : '—'}</td>
                <td className="md-nowrap">{relativeDay(item.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {items.length > limit ? <button type="button" ref={sentinel} className="md-board-more md-table-more" onClick={more}>{t('再显示 {n} 条', { n: Math.min(items.length - limit, TABLE_PAGE) })}</button> : null}
    </div>
  )
}

export function ContentView() {
  useLang()
  const [mode, setMode] = React.useState('board')
  const [importing, setImporting] = React.useState(false)
  const all = useContentItems()
  // 看板和表格都只放算作一篇的内容，和标题里的数一致
  const items = React.useMemo(() => all.filter(isPiece), [all])
  const query = useDesk(s => s.query)
  const counts = pieceCounts(items)
  return (
    <div className={`md-page md-content-page is-${mode}`}>
      <header className="md-page-head">
        <div>
          <h1>{t('内容')}</h1>
          <p className="md-page-sub">{[
            t(plural(counts.total, '共 1 条', '共 {n} 条'), { n: counts.total }),
            t(plural(counts.ideas, '1 个灵感待推进', '{n} 个灵感待推进'), { n: counts.ideas }),
            t('{n} 篇在写', { n: counts.drafting }),
            t('{n} 篇待发布', { n: counts.ready }),
            t('{n} 篇已发布', { n: counts.published }),
          ].join(' · ')}</p>
        </div>
        <span className="md-grow" />
        <div className="md-head-tools">
          <label className="md-search">
            <Icon name="search" size={15} />
            <input value={query} onChange={e => setDesk({ query: e.target.value })} placeholder={t('搜索标题、标签、平台')} aria-label={t('搜索内容')} />
          </label>
          <Segmented label={t('显示方式')} value={mode} onChange={setMode} options={[{ value: 'board', label: t('看板') }, { value: 'table', label: t('表格') }, { value: 'calendar', label: t('日历') }]} />
          <button type="button" className="md-btn" onClick={() => setImporting(true)}><Icon name="folder" size={14} />{t('导入文件夹')}</button>
        </div>
      </header>
      {items.length === 0 && mode !== 'calendar' ? (
        <Empty
          title={query ? t('没有匹配的内容') : t('还没有内容')}
          hint={query ? t('换个关键词试试。') : t('记下第一条灵感，它就会出现在这里，之后可以一键成稿。稿子已经写在 Markdown 文件里（比如 Obsidian）？点「导入文件夹」一次读进来。')}
          action={<div className="md-empty-actions">{query ? <button type="button" className="md-btn" onClick={() => setDesk({ query: '' })}>{t('清空搜索')}</button> : <><button type="button" className="md-btn is-primary" onClick={openQuickCapture}><Icon name="plus" size={14} />{t('记一条灵感')}</button><button type="button" className="md-btn" onClick={() => setImporting(true)}><Icon name="folder" size={14} />{t('导入文件夹')}</button></>}</div>}
        />
      ) : mode === 'calendar' ? <ScheduleWorkspace items={all} /> : mode === 'board' ? <Board items={items} /> : <Table items={items} />}
      {importing ? <ImportFolderDialog onClose={() => setImporting(false)} /> : null}
    </div>
  )
}
