// 大屏用的图：每日净增的堆叠柱（按平台分色）、平台卡片里的粉丝走势，和还没数据时的淡影示意。
import React from 'react'
import { t } from './i18n.js'
import { PLATFORM_ICON } from './platform-icons.js'

// 颜色跟着平台走，不跟着排名走；X 和 Instagram 用中性灰
export const PLATFORM_COLOR = {
  知乎: '#2a78d6', 头条: '#b0592b', 视频号: '#eb6834', 公众号: '#1baf7a', TikTok: '#eda100', B站: '#e87ba4',
  YouTube: '#008300', 抖音: '#6250d6', 小红书: '#e34948', X: '#5f5e58', Instagram: '#a3a29a', GitHub: '#3d4753', 谷歌学术: '#4285f4',
}
export const colorOf = platform => PLATFORM_COLOR[platform] ?? '#a3a29a'

export function PlatformMark({ platform, size = 22 }) {
  const icon = PLATFORM_ICON[platform]
  if (!icon) return <i className="md-b-mark" style={{ background: colorOf(platform), width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">{platform.slice(0, 1)}</i>
  return <i className="md-b-mark" style={{ background: icon.color, width: size, height: size }} aria-hidden="true"><svg viewBox="0 0 24 24"><path d={icon.path} /></svg></i>
}

function useSize(fallback) {
  const box = React.useRef(null)
  const [size, setSize] = React.useState(fallback)
  React.useLayoutEffect(() => {
    const el = box.current
    if (!el) return undefined
    const measure = rect => setSize({ width: Math.max(rect.width, 80), height: Math.max(rect.height, 40) })
    // 先量一次，不等观察器的第一次回调，免得先按默认尺寸画一帧
    measure(el.getBoundingClientRect())
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [box, size]
}

function niceMax(value) {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find(n => n * pow >= value) ?? 10
  return step * pow
}

const short = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
const signed = n => `${n > 0 ? '+' : ''}${n.toLocaleString()}`

/** 一天里各平台的净增叠成一根柱：涨的往上叠，掉的往下叠。 */
function stack(row, platforms) {
  let up = 0
  let down = 0
  const parts = []
  for (const platform of platforms) {
    const value = row.net[platform]
    if (!value) continue
    if (value > 0) { parts.push({ platform, value, from: up, to: up + value }); up += value }
    else { parts.push({ platform, value, from: down + value, to: down }); down += value }
  }
  return { parts, up, down }
}

export function NetBars({ daily, platforms, label }) {
  const [box, { width, height }] = useSize({ width: 420, height: 220 })
  const [hover, setHover] = React.useState(null)
  const pad = { l: 38, r: 6, t: 8, b: 22 }
  const stacks = daily.map(row => stack(row, platforms))
  const top = niceMax(Math.max(1, ...stacks.map(s => s.up)))
  const bottom = Math.min(0, ...stacks.map(s => s.down))
  const low = bottom < 0 ? -niceMax(-bottom) : 0
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const band = innerW / daily.length
  const barW = Math.max(2, Math.min(band - 2, 18))
  const y = v => pad.t + ((top - v) / (top - low)) * innerH
  const x = i => pad.l + i * band + (band - barW) / 2
  // 离 0 太近的刻度会和 0 叠在一起，不画
  const ticks = [...new Set([low, 0, top / 2, top])].filter(tick => tick === 0 || Math.abs(y(tick) - y(0)) >= 14)
  const labelEvery = Math.ceil(daily.length / Math.max(Math.floor(innerW / 56), 2))
  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const index = Math.floor((event.clientX - rect.left - pad.l) / band)
    setHover(index >= 0 && index < daily.length ? index : null)
  }
  const point = hover === null ? null : daily[hover]
  return (
    <div className="md-chart md-b-bars" ref={box}>
      <svg width={width} height={height} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'md-b-zero' : 'md-chart-grid'} />
            <text x={pad.l - 6} y={y(tick) + 4} textAnchor="end" className="md-chart-axis">{tick > 0 ? `+${tick}` : tick}</text>
          </g>
        ))}
        {hover === null ? null : <rect x={pad.l + hover * band} y={pad.t} width={band} height={innerH} className="md-b-band" />}
        {stacks.map((s, i) => s.parts.map((part) => {
          // 相邻色块之间留 2px 的底色缝
          const h = Math.max(Math.abs(y(part.from) - y(part.to)) - 2, 1)
          return <rect key={`${daily[i].date}-${part.platform}`} x={x(i)} y={Math.min(y(part.to), y(part.from)) + 1} width={barW} height={h} rx={Math.min(2, h / 2)} fill={colorOf(part.platform)} />
        }))}
        {daily.map((row, i) => (i % labelEvery === 0 ? <text key={row.date} x={pad.l + i * band + band / 2} y={height - 5} textAnchor="middle" className="md-chart-axis">{short(row.date)}</text> : null))}
      </svg>
      {point ? (
        <div className="md-chart-tip" style={{ left: Math.max(0, Math.min(pad.l + hover * band + band + 6, width - 150)), top: 4 }}>
          <small>{short(point.date)}</small>
          {Object.keys(point.net).length ? (
            <>
              <b>{t('净增 {n}', { n: signed(point.total) })}</b>
              {platforms.filter(p => point.net[p] !== undefined).map(p => <span key={p} className="md-b-tip-row"><i style={{ background: colorOf(p) }} />{t(p)}<em>{signed(point.net[p])}</em></span>)}
            </>
          ) : <b>{t('这天没有记录')}</b>}
        </div>
      ) : null}
    </div>
  )
}

/** 单个平台的粉丝走势：只看形状，不带坐标轴，悬停看具体数字。下面一层从平台色渐隐到透明。 */
export function Spark({ points, color, label }) {
  const [box, { width, height }] = useSize({ width: 180, height: 80 })
  const [hover, setHover] = React.useState(null)
  const fill = `md-b-spark-${React.useId().replace(/:/g, '')}`
  if (points.length < 2) return <div className="md-b-spark is-empty" ref={box} />
  const values = points.map(p => p.followers)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = i => (i / (points.length - 1)) * width
  const y = v => 8 + (1 - (v - min) / span) * (height - 16)
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.followers).toFixed(1)}`).join(' ')
  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - rect.left) / rect.width) * (points.length - 1)))))
  }
  const point = hover === null ? null : points[hover]
  return (
    <div className="md-b-spark" ref={box}>
      <svg width={width} height={height} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".24" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${fill})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {point ? <circle cx={x(hover)} cy={y(point.followers)} r="4" fill={color} className="md-b-dot" /> : null}
      </svg>
      {point ? <div className="md-chart-tip" style={{ left: Math.max(0, Math.min(x(hover) - 50, width - 110)), top: -30, minWidth: 0 }}><small>{short(point.date)} · <b>{point.followers.toLocaleString()}</b></small></div> : null}
    </div>
  )
}

// 淡影柱子的高度：固定的一组起伏，只示意形状，不代表任何数
const GHOST = Array.from({ length: 30 }, (_, i) => 0.22 + 0.62 * (0.5 + 0.5 * Math.sin(i * 0.83 + 1.1)) * (0.55 + 0.45 * Math.cos(i * 0.31)))

/** 还没有每日净增时的示意：一排很淡的柱子，不带刻度和数字，一看就知道不是数据。 */
export function GhostBars() {
  return (
    <svg className="md-b-ghost-bars" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {GHOST.map((h, i) => <rect key={i} x={i * 10 + 2} y={100 - h * 92} width="6" height={h * 92} />)}
      <line x1="0" x2="300" y1="99.5" y2="99.5" />
    </svg>
  )
}
