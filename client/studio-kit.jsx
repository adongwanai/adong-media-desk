// 工作区里几块共用的小零件：自动长高的输入框、一张图、把一段话交给助手。
import React from 'react'
import { setDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'

export const isBusy = asset => ['pending', 'running'].includes(asset?.status)

export function unescapeJson(text) {
  try {
    return JSON.parse(`"${text}"`)
  } catch {
    return text
  }
}

/** 随内容长高的输入框，失焦时提交。 */
export function AutoText({ value, onCommit, className, label, disabled }) {
  const [draft, setDraft] = React.useState(value ?? '')
  const ref = React.useRef(null)
  React.useEffect(() => setDraft(value ?? ''), [value])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // Hidden tabs have scrollHeight=0. Measure again when their width returns.
      if (!el.getClientRects().length || !el.clientWidth) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    measure()
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      measure()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [draft])
  return (
    <textarea ref={ref} rows={1} aria-label={label} className={className} value={draft} disabled={disabled}
      onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim() && draft !== (value ?? '')) onCommit(draft) }} />
  )
}

export function askAbout(label, text = '') {
  setDesk({ chatQuote: { label, text }, studioDock: true })
}

/** 一张图。空的时候只有底色和淡淡的记号，不放文字。 */
export function Plate({ asset, paper = false, mark = null, alt = '', onOpen, onRetry }) {
  const status = asset?.status ?? 'idle'
  const clickable = Boolean(asset?.src && onOpen)
  const retry = onRetry && ['failed', 'skipped', 'idle'].includes(status) && !asset?.src
  return (
    <div className={`md-plate ${paper ? 'is-paper' : 'is-wash'} ${clickable ? 'is-clickable' : ''}`} data-status={status} onClick={clickable ? onOpen : undefined} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined} onKeyDown={clickable ? (event) => { if (event.key === 'Enter') onOpen(event) } : undefined} aria-label={clickable ? t('查看 {name}', { name: alt }).trim() : undefined}>
      {asset?.src ? <img key={asset.src} src={asset.src} alt={alt} draggable={false} /> : mark ? <span className="md-plate-mark" aria-hidden="true">{mark}</span> : null}
      {retry ? <button type="button" className="md-plate-failed" title={asset?.error} onClick={(event) => { event.stopPropagation(); onRetry() }}><Icon name="refresh" size={12} />{status === 'failed' ? t('没画成，重画') : t('画这张')}</button>
        : status === 'failed' ? <span className="md-plate-failed" title={asset.error}><Icon name="refresh" size={12} />{t('没画成')}</span> : null}
    </div>
  )
}
