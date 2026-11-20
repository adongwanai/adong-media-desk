// 风格的图标块和选择器：成稿工作区的「风格」一栏和风格页共用同一套样子。
import React from 'react'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { styleLook } from './style-look.js'
import { STYLE_CATEGORIES } from './util.js'

/** 风格的图标块。size 是方块边长。 */
export function StyleGlyph({ style, size = 28 }) {
  const look = styleLook(style)
  return (
    <span className={`md-glyph tint-${look.tint}`} style={{ '--glyph': `${size}px` }} aria-hidden="true">
      {look.glyph ? <Icon name={look.glyph} size={Math.round(size * 0.54)} /> : look.emoji ? <i>{look.emoji}</i> : <b>{look.mono}</b>}
    </span>
  )
}

/** 选择器里的分组：默认、我的风格、预设按板块。 */
function groupStyles(styles, query) {
  const q = query.trim().toLowerCase()
  const hit = style => !q || [style.name, style.summary, t(style.category ?? '')].some(text => String(text ?? '').toLowerCase().includes(q))
  const groups = []
  const defaultRow = { id: '', name: t('默认'), summary: t('不套用风格，按通用写法写') }
  if (!q || hit(defaultRow)) groups.push({ label: null, rows: [defaultRow] })
  const mine = styles.filter(style => !style.preset && hit(style))
  if (mine.length) groups.push({ label: t('我的风格'), rows: mine })
  for (const name of STYLE_CATEGORIES) {
    const rows = styles.filter(style => style.preset && style.category === name && hit(style))
    if (rows.length) groups.push({ label: t(name), rows })
  }
  return groups
}

/** 弹层用 fixed 定位；宿主里有些祖先会成为 fixed 的参照，先量出偏移再摆，位置才准。 */
function usePopoverPosition(open, anchorRef, popRef) {
  const [box, setBox] = React.useState(null)
  React.useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const anchor = anchorRef.current
      const pop = popRef.current
      if (!anchor || !pop) return
      // 弹层现在的位置减去已经设上的 left/top，就是 fixed 参照物的原点
      const now = pop.getBoundingClientRect()
      const origin = { left: now.left - (Number.parseFloat(pop.style.left) || 0), top: (pop.classList.contains('is-up') ? now.bottom : now.top) - (Number.parseFloat(pop.style.top) || 0) }
      const rect = anchor.getBoundingClientRect()
      const width = Math.max(rect.width, 288)
      const viewW = document.documentElement.clientWidth
      const viewH = document.documentElement.clientHeight
      // 右边和按钮对齐，左边不越过参照物（工作台）的边
      const left = Math.max(origin.left + 8, 8, Math.min(rect.right - width, viewW - width - 8))
      const below = viewH - rect.bottom - 12
      const above = rect.top - 12
      const up = below < 260 && above > below
      const maxHeight = Math.max(160, Math.min(440, up ? above : below))
      const next = { left: left - origin.left, top: (up ? rect.top - 6 : rect.bottom + 6) - origin.top, width, maxHeight, up }
      setBox(previous => previous && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next)
    }
    let frame = null
    const schedule = (event) => {
      // 列表自己的滚动不改变弹层位置，也不能触发选项回滚。
      if (event.type === 'scroll' && popRef.current?.contains(event.target)) return
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; place() })
    }
    place()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [open, anchorRef, popRef])
  return box
}

/**
 * 风格选择器：按钮 + 弹层列表。弹层是 listbox（不用 menu：宿主把 menu 当成打开的模态框，会吞掉全局快捷键）。
 * 方向键移动、回车选中、Esc 关闭，点外面也关闭。
 */
export function StylePicker({ styles, value, onChange, label }) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [cursor, setCursor] = React.useState(0)
  const [reveal, requestReveal] = React.useReducer(count => count + 1, 0)
  const revealed = React.useRef(0)
  const trigger = React.useRef(null)
  const pop = React.useRef(null)
  const listRef = React.useRef(null)
  const search = React.useRef(null)
  const uid = React.useId()
  const groups = React.useMemo(() => groupStyles(styles, query), [styles, query])
  const rows = React.useMemo(() => groups.flatMap(group => group.rows), [groups])
  const current = styles.find(style => style.id === value) ?? null
  const searchable = styles.length > 7
  const box = usePopoverPosition(open, trigger, pop)

  const close = React.useCallback((refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) trigger.current?.focus()
  }, [])
  const openList = () => {
    setCursor(Math.max(0, rows.findIndex(row => row.id === (value ?? ''))))
    requestReveal()
    setOpen(true)
  }
  const pick = (row) => {
    if ((row.id || null) !== (value ?? null)) onChange(row.id || null)
    close()
  }

  // 打开时把焦点放进搜索框（没有搜索框就放在列表上）。位置在绘制前就摆好了，不会闪一下
  React.useEffect(() => {
    if (open) (search.current ?? listRef.current)?.focus({ preventScroll: true })
  }, [open])
  React.useLayoutEffect(() => {
    if (!open || !box || revealed.current === reveal) return
    const list = listRef.current
    const option = list?.querySelector(`[data-index="${cursor}"]`)
    if (!option) return
    revealed.current = reveal
    const viewport = list.getBoundingClientRect()
    const rect = option.getBoundingClientRect()
    // 只在打开、搜索和键盘导航时显露选项；悬停和手动滑动不抢滚动条。
    if (rect.top < viewport.top) list.scrollTop -= viewport.top - rect.top
    else if (rect.bottom > viewport.bottom) list.scrollTop += rect.bottom - viewport.bottom
  }, [open, reveal, box, cursor])
  React.useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (pop.current?.contains(event.target) || trigger.current?.contains(event.target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, close])

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setCursor(index => (rows.length ? (index + step + rows.length) % rows.length : 0))
      requestReveal()
    } else if (event.key === 'Home' || event.key === 'End') {
      if (event.target === search.current) return
      event.preventDefault()
      setCursor(event.key === 'Home' ? 0 : rows.length - 1)
      requestReveal()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (rows[cursor]) pick(rows[cursor])
    } else if (event.key === 'Tab') close(false)
  }

  let index = -1
  return (
    <>
      <button type="button" ref={trigger} className={`md-picker-trigger ${open ? 'is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}：${current?.name ?? t('默认')}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => { if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); openList() } }}>
        {current ? <StyleGlyph style={current} size={20} /> : <span className="md-glyph tint-ink is-empty" style={{ '--glyph': '20px' }} aria-hidden="true"><Icon name="feather" size={11} /></span>}
        <span className="md-picker-value">{current?.name ?? t('默认')}</span>
        <Icon name="chevUD" size={14} />
      </button>
      {open ? (
        <div ref={pop} className={`md-picker-pop ${box?.up ? 'is-up' : ''}`} style={box ? { left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight } : { left: 0, top: 0 }} onKeyDown={onKey}>
          {searchable ? (
            <div className="md-picker-search">
              <Icon name="search" size={14} />
              <input ref={search} value={query} onChange={e => { setQuery(e.target.value); setCursor(0); requestReveal() }} placeholder={t('搜索风格')} aria-label={t('搜索风格')} role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-activedescendant={rows[cursor] ? `${uid}-${cursor}` : undefined} aria-autocomplete="list" />
            </div>
          ) : null}
          <div ref={listRef} id={`${uid}-list`} className="md-picker-list" role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={!searchable && rows[cursor] ? `${uid}-${cursor}` : undefined}>
            {groups.map((group, g) => (
              <div key={g} role="group" aria-label={group.label ?? t('默认')} className="md-picker-group">
                {group.label ? <div className="md-picker-label" aria-hidden="true">{group.label}</div> : null}
                {group.rows.map((row) => {
                  index += 1
                  const at = index
                  const selected = (row.id || null) === (value ?? null)
                  return (
                    <div key={row.id || 'default'} id={`${uid}-${at}`} data-index={at} role="option" aria-selected={selected} className={`md-picker-option ${at === cursor ? 'is-cursor' : ''} ${selected ? 'is-selected' : ''}`}
                      onPointerMove={() => { if (cursor !== at) setCursor(at) }} onClick={() => pick(row)}>
                      {row.id ? <StyleGlyph style={row} size={30} /> : <span className="md-glyph tint-ink is-empty" style={{ '--glyph': '30px' }} aria-hidden="true"><Icon name="feather" size={15} /></span>}
                      <span className="md-picker-text">
                        <b>{row.name}</b>
                        {row.summary ? <small>{row.summary}</small> : null}
                      </span>
                      <span className="md-picker-check">{selected ? <Icon name="check" size={15} /> : null}</span>
                    </div>
                  )
                })}
              </div>
            ))}
            {!rows.length ? <p className="md-picker-empty">{t('没有匹配的风格')}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
