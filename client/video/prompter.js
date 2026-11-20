// 提词器：按每句的估算时长滚动，当前句停在阅读线上并高亮。
// 同一套滚动逻辑既用在摄像头画面上的浮层，也用在录屏时单独弹出的小窗里。
import { t } from '../i18n.js'

/** 每台电脑自己的偏好（语速、字号、镜像…）。存不了就用默认值，不影响使用。 */
export function readPref(key, fallback) {
  try {
    const raw = window.localStorage.getItem(`md-video:${key}`)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writePref(key, value) {
  try {
    window.localStorage.setItem(`md-video:${key}`, JSON.stringify(value))
  } catch {
    // 隐私模式或存储被禁用时只是记不住，不报错
  }
}

export function safeName(title, fallback = 'video') {
  return String(title ?? '').replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 40) || fallback
}

/** 下载一段内容；临时地址用完就收回。 */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadText(text, name, type = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), name)
}

/**
 * @param {{win?: Window, track: HTMLElement, lines: HTMLElement[], durations: number[], speed?: number, anchor?: number, onState?: (playing: boolean) => void, onLine?: (index: number) => void}} options
 *   track 是装着所有句子、会被上下移动的那一层；anchor 是阅读线在可视区里的高度比例。
 */
export function createPrompter({ win = window, track, lines, durations, speed = 1, anchor = 0.3, onState, onLine }) {
  const starts = []
  let sum = 0
  for (const d of durations) {
    starts.push(sum)
    sum += d
  }
  const total = sum
  let elapsed = 0
  let playing = false
  let last = 0
  let raf = 0
  let current = -1
  let rate = speed

  const indexAt = (time) => {
    let i = 0
    while (i + 1 < starts.length && starts[i + 1] <= time) i += 1
    return i
  }
  const render = () => {
    if (!lines.length) return
    const i = indexAt(elapsed)
    const frac = durations[i] ? Math.min(1, Math.max(0, (elapsed - starts[i]) / durations[i])) : 0
    const top = lines[i].offsetTop
    const next = i + 1 < lines.length ? lines[i + 1].offsetTop : top + lines[i].offsetHeight
    const y = top + (next - top) * frac
    const height = track.parentElement?.clientHeight ?? 0
    track.style.transform = `translate3d(0, ${Math.round(height * anchor - y)}px, 0)`
    if (i !== current) {
      lines[current]?.classList.remove('is-now')
      lines[i]?.classList.add('is-now')
      current = i
      onLine?.(i)
    }
  }
  const setPlaying = (value) => {
    if (playing === value) return
    playing = value
    onState?.(value)
  }
  const frame = (ts) => {
    if (!playing) return
    if (last) elapsed += ((ts - last) / 1000) * rate
    last = ts
    if (elapsed >= total) {
      elapsed = total
      render()
      setPlaying(false)
      return
    }
    render()
    raf = win.requestAnimationFrame(frame)
  }
  const controller = {
    play() {
      if (playing || !lines.length) return
      if (elapsed >= total) elapsed = 0
      last = 0
      setPlaying(true)
      raf = win.requestAnimationFrame(frame)
    },
    pause() {
      win.cancelAnimationFrame(raf)
      setPlaying(false)
    },
    toggle() {
      if (playing) controller.pause()
      else controller.play()
    },
    /** 往前或往后跳几句，停在那句开头。 */
    jump(delta) {
      const i = Math.max(0, Math.min(lines.length - 1, (current < 0 ? 0 : current) + delta))
      elapsed = starts[i] ?? 0
      last = 0
      render()
    },
    reset() {
      controller.pause()
      elapsed = 0
      render()
    },
    setSpeed(value) {
      rate = value
    },
    refresh: render,
    isPlaying: () => playing,
    index: () => Math.max(0, current),
    destroy() {
      win.cancelAnimationFrame(raf)
      playing = false
    },
  }
  render()
  return controller
}

const POPUP_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0d0d0f; color: #f4f4f5; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }
  .view { position: absolute; inset: 0 0 52px; overflow: hidden; }
  .view.is-mirror { transform: scaleX(-1); }
  .track { padding: 0 28px; will-change: transform; }
  .line { margin: 0 0 .5em; line-height: 1.45; color: rgba(244,244,245,.38); transition: color .2s; }
  .line.is-now { color: #fff; }
  .mark { position: absolute; left: 0; right: 0; top: 30%; height: 0; border-top: 1px dashed rgba(255,255,255,.18); pointer-events: none; }
  .mark::before { content: ""; position: absolute; left: 8px; top: -6px; border: 6px solid transparent; border-left-color: #f5a524; }
  .count { position: absolute; inset: 0 0 52px; display: none; align-items: center; justify-content: center; font-size: 120px; font-weight: 600; background: rgba(13,13,15,.7); }
  .count.is-on { display: flex; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 52px; display: flex; align-items: center; gap: 6px; padding: 0 10px; background: #18181b; border-top: 1px solid #27272a; font-size: 12px; }
  .bar button { height: 32px; min-width: 32px; padding: 0 10px; border: 1px solid #3f3f46; border-radius: 8px; background: #27272a; color: #f4f4f5; font: inherit; cursor: pointer; }
  .bar button.is-main { background: #f4f4f5; color: #0d0d0f; border-color: transparent; font-weight: 600; }
  .bar span { color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grow { flex: 1; }
`

/**
 * 录屏用的提词小窗。浏览器挡掉弹窗，或者桌面版不让开新窗口时返回 null。
 * @param {{title: string, lines: string[], durations: number[], fontSize: number, speed: number, mirror: boolean, onClosed?: () => void}} options
 * @returns {null | {play: Function, pause: Function, toggle: Function, countdown: (seconds: number, then: Function) => void, update: (patch: object) => void, focus: Function, close: Function, isOpen: () => boolean, index: () => number}}
 */
export function openPrompterWindow({ title, lines, durations, fontSize, speed, mirror, onClosed, onLine }) {
  let win = null
  try {
    win = window.open('', 'md-prompter', 'popup=yes,width=560,height=400')
  } catch {
    return null
  }
  if (!win) return null
  let doc
  try {
    doc = win.document
    doc.open()
    doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
    doc.close()
  } catch {
    // 新窗口不是同源页面（比如被桌面版转去了系统浏览器），没法往里写字
    try { win.close() } catch { /* 关不掉就算了 */ }
    return null
  }
  const el = (tag, className, text) => {
    const node = doc.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  doc.title = t('提词器 · {title}', { title })
  doc.head.append(el('style', '', POPUP_CSS))
  const view = el('div', 'view')
  const track = el('div', 'track')
  const nodes = lines.map(text => el('p', 'line', text))
  track.append(...nodes)
  view.append(track, el('div', 'mark'))
  const count = el('div', 'count')
  const bar = el('div', 'bar')
  const playBtn = el('button', 'is-main', t('开始'))
  const back = el('button', '', '↑')
  const fwd = el('button', '', '↓')
  const smaller = el('button', '', 'A-')
  const bigger = el('button', '', 'A+')
  const slower = el('button', '', t('慢'))
  const faster = el('button', '', t('快'))
  const flip = el('button', '', t('镜像'))
  const info = el('span', '')
  back.title = t('上一句')
  fwd.title = t('下一句')
  bar.append(playBtn, back, fwd, smaller, bigger, slower, faster, flip, el('span', 'grow'), info)
  doc.body.append(view, count, bar)

  const state = { fontSize, speed, mirror }
  const prompter = createPrompter({
    win, track, lines: nodes, durations, speed, onLine,
    onState: (playing) => { playBtn.textContent = playing ? t('暂停') : t('继续') },
  })
  const apply = () => {
    track.style.fontSize = `${state.fontSize}px`
    view.classList.toggle('is-mirror', state.mirror)
    prompter.setSpeed(state.speed)
    info.textContent = t('{size}px · {speed}× · 空格暂停', { size: state.fontSize, speed: state.speed.toFixed(1) })
    prompter.refresh()
  }
  apply()
  let timer = 0
  const countdown = (seconds, then) => {
    win.clearInterval(timer)
    prompter.pause()
    let left = seconds
    count.textContent = String(left)
    count.classList.toggle('is-on', left > 0)
    if (left <= 0) { prompter.reset(); prompter.play(); then?.(); return }
    timer = win.setInterval(() => {
      left -= 1
      count.textContent = String(left)
      if (left > 0) return
      win.clearInterval(timer)
      count.classList.remove('is-on')
      prompter.reset()
      prompter.play()
      then?.()
    }, 1000)
  }
  const step = (key, delta, min, max) => {
    state[key] = Math.round(Math.min(max, Math.max(min, state[key] + delta)) * 10) / 10
    apply()
  }
  playBtn.addEventListener('click', () => prompter.toggle())
  back.addEventListener('click', () => prompter.jump(-1))
  fwd.addEventListener('click', () => prompter.jump(1))
  smaller.addEventListener('click', () => step('fontSize', -4, 18, 96))
  bigger.addEventListener('click', () => step('fontSize', 4, 18, 96))
  slower.addEventListener('click', () => step('speed', -0.1, 0.5, 2))
  faster.addEventListener('click', () => step('speed', 0.1, 0.5, 2))
  flip.addEventListener('click', () => { state.mirror = !state.mirror; apply() })
  win.addEventListener('keydown', (event) => {
    if (event.code === 'Space') { event.preventDefault(); prompter.toggle() }
    if (event.key === 'ArrowUp') { event.preventDefault(); prompter.jump(-1) }
    if (event.key === 'ArrowDown') { event.preventDefault(); prompter.jump(1) }
  })
  win.addEventListener('resize', () => prompter.refresh())
  // 小窗被用户关掉时告诉页面
  const watch = window.setInterval(() => {
    if (!win.closed) return
    window.clearInterval(watch)
    prompter.destroy()
    onClosed?.()
  }, 500)
  return {
    play: () => prompter.play(),
    pause: () => prompter.pause(),
    toggle: () => prompter.toggle(),
    countdown,
    update(patch) {
      Object.assign(state, patch)
      apply()
    },
    focus: () => { try { win.focus() } catch { /* 有的环境不让抢焦点 */ } },
    isOpen: () => !win.closed,
    index: () => prompter.index(),
    close() {
      window.clearInterval(watch)
      win.clearInterval(timer)
      prompter.destroy()
      try { win.close() } catch { /* 已经关了 */ }
    },
  }
}
