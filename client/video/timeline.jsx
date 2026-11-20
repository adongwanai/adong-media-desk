// 剪辑时间线：波形、剪掉的段、入点出点和播放头。可以缩放（⌘/Ctrl + 滚轮、触控板捏合、按钮）、拖动定位。
// 波形只画看得见的那一段，用的是分析时算好的每 20 毫秒音量（已经比原始采样少了几百倍）。
import React from 'react'
import { t } from '../i18n.js'
import { FRAME_SEC } from './audio.js'
import { fmtClock } from './captions.js'
import { LIcon } from './icons.jsx'

const HEIGHT = 112
const RULER = 18
const MAX_PPS = 400

function cssColor(el, name, fallback) {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

function reduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 刻度间隔：大约每 90 像素一个刻度。 */
function tickStep(pps) {
  return [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(step => step * pps >= 90) ?? 600
}

export function Timeline({ db, duration, keep, regions, time, inPoint, outPoint, onSeek, onToggle }) {
  const scroller = React.useRef(null)
  const canvas = React.useRef(null)
  const [view, setView] = React.useState({ width: 800, left: 0 })
  const [pps, setPps] = React.useState(null)
  const anim = React.useRef(0)
  // 连点放大时以上一次要去的倍数为准，不等动画走完
  const goal = React.useRef(null)
  const fit = Math.max(1, (view.width - 2) / Math.max(0.1, duration))
  const scale = pps ?? fit
  const inner = Math.max(view.width, duration * scale)

  React.useEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const observer = new ResizeObserver(([entry]) => setView(v => ({ ...v, width: Math.floor(entry.contentRect.width) })))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // 换一条录像回到适合宽度
  React.useEffect(() => { setPps(null) }, [duration])

  /** 缩放到 next，让 anchor 秒停在屏幕上原来的位置；按钮缩放带一点缓动。 */
  const zoomTo = React.useCallback((next, anchor, smooth = true) => {
    const el = scroller.current
    if (!el) return
    const from = pps ?? fit
    const target = Math.min(MAX_PPS, Math.max(fit, next))
    goal.current = target
    const at = anchor ?? (el.scrollLeft + el.clientWidth / 2) / from
    const screenX = at * from - el.scrollLeft
    cancelAnimationFrame(anim.current)
    const apply = (value) => {
      setPps(value <= fit + 0.001 ? null : value)
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollLeft = at * value - screenX })
    }
    if (!smooth || reduced()) { apply(target); return }
    const began = performance.now()
    const step = (now) => {
      const k = Math.min(1, (now - began) / 180)
      const ease = 1 - (1 - k) ** 3
      apply(from * (target / from) ** ease)
      if (k < 1) anim.current = requestAnimationFrame(step)
      else goal.current = null
    }
    anim.current = requestAnimationFrame(step)
  }, [pps, fit])
  React.useEffect(() => () => cancelAnimationFrame(anim.current), [])
  // + / - / 0：放大、缩小、适合宽度（在输入框里不管）
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      const from = goal.current ?? pps ?? fit
      if (event.key === '+' || event.key === '=') zoomTo(from * 1.6)
      else if (event.key === '-' || event.key === '_') zoomTo(from / 1.6)
      else if (event.key === '0') zoomTo(fit)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pps, fit, zoomTo])

  // ⌘/Ctrl + 滚轮、触控板捏合：以指针位置为中心缩放
  React.useEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const box = el.getBoundingClientRect()
      const from = pps ?? fit
      const anchor = (el.scrollLeft + event.clientX - box.left) / from
      zoomTo(from * Math.exp(-event.deltaY * 0.01), anchor, false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pps, fit, zoomTo])

  // 播放时让播放头留在视野里
  React.useEffect(() => {
    const el = scroller.current
    if (!el || !pps) return
    const x = time * scale
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.3)
  }, [time, scale, pps])

  // 只画看得见的那一段
  React.useEffect(() => {
    const el = canvas.current
    if (!el) return
    const width = view.width
    const ratio = window.devicePixelRatio || 1
    el.width = width * ratio
    el.height = HEIGHT * ratio
    const ctx = el.getContext('2d')
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)
    const accent = cssColor(el, '--accent', '#3b6fd8')
    const muted = cssColor(el, '--ink4', '#9a9a9a')
    const ink3 = cssColor(el, '--ink3', '#777')
    const from = view.left / scale
    // 刻度
    const step = tickStep(scale)
    ctx.fillStyle = ink3
    ctx.font = '10px -apple-system, "PingFang SC", sans-serif'
    ctx.textBaseline = 'top'
    for (let s = Math.floor(from / step) * step; s <= from + width / scale; s += step) {
      const x = (s - from) * scale
      ctx.globalAlpha = 0.5
      ctx.fillRect(Math.round(x), 0, 1, 6)
      ctx.globalAlpha = 0.9
      ctx.fillText(fmtClock(s, { tenths: step < 1 }), Math.round(x) + 3, 2)
    }
    // 波形：每列取这一列时间段里最大的音量
    const mid = RULER + (HEIGHT - RULER) / 2
    let k = 0
    for (let col = 0; col < width; col += 1) {
      const a = from + col / scale
      const b = from + (col + 1) / scale
      if (a > duration) break
      const f0 = Math.floor(a / FRAME_SEC)
      const f1 = Math.max(f0 + 1, Math.floor(b / FRAME_SEC))
      let max = -100
      for (let i = f0; i < f1 && i < db.length; i += 1) if (db[i] > max) max = db[i]
      const level = Math.min(1, Math.max(0, (max + 60) / 60))
      const at = (a + b) / 2
      while (k < keep.length && keep[k][1] <= at) k += 1
      const on = k < keep.length && keep[k][0] <= at
      const h = Math.max(1, level * (HEIGHT - RULER - 10))
      ctx.globalAlpha = on ? 0.9 : 0.4
      ctx.fillStyle = on ? accent : muted
      ctx.fillRect(col, mid - h / 2, 1, h)
    }
    ctx.globalAlpha = 1
  }, [db, duration, keep, scale, view])

  // 剪掉的段：保留段之间的空隙
  const gaps = React.useMemo(() => {
    const out = []
    let from = 0
    for (const [a, b] of [...keep, [duration, duration]]) {
      if (a - from > 0.005) out.push([from, a])
      from = b
    }
    return out
  }, [keep, duration])

  const timeAt = (clientX) => {
    const el = scroller.current
    const box = el.getBoundingClientRect()
    return Math.max(0, Math.min(duration, (el.scrollLeft + clientX - box.left) / scale))
  }
  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    onSeek(timeAt(event.clientX))
  }
  const onPointerMove = (event) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(timeAt(event.clientX))
  }
  const onDoubleClick = (event) => {
    const s = timeAt(event.clientX)
    const i = regions.findIndex(row => s >= row.start && s < row.end)
    if (i >= 0) onToggle(i)
  }
  const zoomPct = Math.round((scale / fit) * 100)
  return (
    <div className="md-tl">
      <div className="md-tl-bar">
        <span className="md-tl-title">{t('时间线')}</span>
        <span className="md-vd-meta">{t('拖动定位 · 双击切换剪/留 · ⌘ + 滚轮缩放')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="md-tl-btn" onClick={() => zoomTo((goal.current ?? scale) / 1.6)} disabled={scale <= fit + 0.001} title={t('缩小（-）')} aria-label={t('缩小')}><LIcon name="zoom-out" size={15} /></button>
        <span className="md-tl-zoom">{zoomPct}%</span>
        <button type="button" className="md-tl-btn" onClick={() => zoomTo((goal.current ?? scale) * 1.6)} disabled={scale >= MAX_PPS} title={t('放大（+）')} aria-label={t('放大')}><LIcon name="zoom-in" size={15} /></button>
        <button type="button" className="md-tl-btn is-text" onClick={() => zoomTo(fit)} disabled={!pps} title={t('适合宽度（0）')}><LIcon name="move-horizontal" size={15} />{t('适合宽度')}</button>
      </div>
      <div className="md-tl-scroll" ref={scroller} onScroll={e => setView(v => ({ ...v, left: e.currentTarget.scrollLeft }))}>
        <div className="md-tl-inner" style={{ width: inner }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onDoubleClick={onDoubleClick} role="slider" aria-label={t('时间线')} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} aria-valuetext={fmtClock(time, { tenths: true })} tabIndex={-1}>
          <canvas ref={canvas} className="md-tl-wave" style={{ width: view.width, height: HEIGHT, left: view.left }} />
          {gaps.map(([a, b]) => <i key={`${a}-${b}`} className="md-tl-gap" style={{ left: a * scale, width: Math.max(2, (b - a) * scale) }} />)}
          {inPoint !== null ? <i className="md-tl-in" style={{ left: inPoint * scale }} title={t('入点 {time}', { time: fmtClock(inPoint, { tenths: true }) })} /> : null}
          {outPoint !== null ? <i className="md-tl-out" style={{ left: outPoint * scale }} title={t('出点 {time}', { time: fmtClock(outPoint, { tenths: true }) })} /> : null}
          {inPoint !== null && outPoint !== null && outPoint > inPoint ? <i className="md-tl-range" style={{ left: inPoint * scale, width: (outPoint - inPoint) * scale }} /> : null}
          <i className="md-tl-head" style={{ transform: `translateX(${time * scale}px)` }} />
        </div>
      </div>
    </div>
  )
}
