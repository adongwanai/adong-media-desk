// 左边的 Markdown 编辑器：普通 textarea（原生撤销照常可用），软换行，Tab 缩进，可选行号，打字机模式（光标行保持在中间）。
// 文本框自己不滚动，高度跟着内容长；外面一层负责滚动。光标位置用一个看不见的「镜像」排版量出来：
// 镜像和文本框同宽同字体，每一行原文是一个块，量块的位置就知道第几行在哪、光标在哪。
import React from 'react'
import { t } from '../i18n.js'
import { lineAt, offsetOfLine } from './markdown.js'

const MIRROR_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'wordBreak', 'overflowWrap']

/** 按镜像量出每一行原文的顶部位置和高度。 */
function measureLines(mirror, textarea, value) {
  const style = getComputedStyle(textarea)
  for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop]
  mirror.style.width = `${textarea.clientWidth}px`
  const lines = value.split('\n')
  // 只在行数变了时重建节点，其余就地改文字
  while (mirror.childElementCount > lines.length) mirror.lastElementChild.remove()
  while (mirror.childElementCount < lines.length) mirror.appendChild(document.createElement('div'))
  lines.forEach((line, i) => {
    const node = mirror.children[i]
    const text = line || '​'
    if (node.textContent !== text) node.textContent = text
  })
  const top = parseFloat(style.paddingTop) || 0
  return Array.from(mirror.children, node => ({ top: node.offsetTop - top, height: node.offsetHeight }))
}

/**
 * Markdown 编辑器。
 * @param {object} props - value, onChange(text), onCaret(line) 光标换行时（已防抖），lineNumbers, typewriter, label, apiRef。
 *   apiRef.current = { goto(line) 跳到某行并闪一下, focus() }。
 */
export function SourceEditor({ value, onChange, onCaret, lineNumbers, typewriter, label, apiRef, onBlur }) {
  const scroller = React.useRef(null)
  const area = React.useRef(null)
  const mirror = React.useRef(null)
  const [rows, setRows] = React.useState([])
  const [flash, setFlash] = React.useState(null)
  const rowsRef = React.useRef(rows)
  rowsRef.current = rows
  const caretLine = React.useRef(-1)
  const caretTimer = React.useRef(null)

  const stale = React.useRef(true)
  const measureTimer = React.useRef(null)
  // 整篇量一遍：长稿（几万字）要几十毫秒，所以打字时只在停手 250ms 后量，用到行位置时（跳转、打字机）再按需补量
  const measure = React.useCallback(() => {
    clearTimeout(measureTimer.current)
    const el = area.current
    if (!el || !mirror.current) return rowsRef.current
    const next = measureLines(mirror.current, el, el.value)
    const height = next.length ? next[next.length - 1].top + next[next.length - 1].height : 0
    const style = getComputedStyle(el)
    el.style.height = `${Math.ceil(height + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) + 2)}px`
    stale.current = false
    rowsRef.current = next
    setRows(next)
    return next
  }, [])

  React.useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    stale.current = true
    // 先只长高不缩：内容变多时立刻跟上，外层滚动位置不跳
    if (el.scrollHeight > el.clientHeight) el.style.height = `${el.scrollHeight}px`
    clearTimeout(measureTimer.current)
    measureTimer.current = setTimeout(measure, rowsRef.current.length ? 250 : 0)
  }, [value, measure])
  React.useLayoutEffect(() => { measure() }, [lineNumbers, measure])
  React.useEffect(() => () => clearTimeout(measureTimer.current), [])
  React.useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  /** 第 line 行在滚动层里的位置。 */
  const lineTop = (line, exact = true) => {
    const rows = exact && stale.current ? measure() : rowsRef.current
    const row = rows[Math.max(0, Math.min(rows.length - 1, line))]
    const pad = area.current ? parseFloat(getComputedStyle(area.current).paddingTop) || 0 : 0
    return row ? { top: row.top + pad + (area.current?.offsetTop ?? 0), height: row.height } : null
  }

  const keepCentered = (line) => {
    // 打字时用上一次量的行位置：光标上面的行没变，够用；行数变了再补量
    const box = lineTop(line, rowsRef.current.length !== String(area.current?.value ?? '').split('\n').length)
    const el = scroller.current
    if (!box || !el) return
    el.scrollTop = Math.max(0, box.top - el.clientHeight / 2 + box.height / 2)
  }

  const reportCaret = () => {
    const el = area.current
    if (!el) return
    // 同言起：只有光标真的在编辑器里时才跟随
    if (document.activeElement !== el) return
    const line = lineAt(el.value, el.selectionStart)
    if (typewriter) keepCentered(line)
    if (line === caretLine.current) return
    caretLine.current = line
    clearTimeout(caretTimer.current)
    // 同言起：光标停下 180ms 后再去翻预览
    caretTimer.current = setTimeout(() => onCaret?.(line), 180)
  }
  React.useEffect(() => () => clearTimeout(caretTimer.current), [])

  React.useImperativeHandle(apiRef, () => ({
    goto(line) {
      const el = area.current
      if (!el) return
      const offset = offsetOfLine(el.value, line)
      el.focus({ preventScroll: true })
      el.setSelectionRange(offset, offset)
      caretLine.current = line
      const box = lineTop(line)
      if (box && scroller.current) {
        const s = scroller.current
        const target = Math.max(0, box.top - s.clientHeight * (typewriter ? 0.5 : 0.3))
        s.scrollTo({ top: target, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        setFlash({ top: box.top, height: box.height, n: Date.now() })
      }
    },
    focus() { area.current?.focus() },
  }))

  const onKeyDown = (event) => {
    const el = event.currentTarget
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const { selectionStart: start, selectionEnd: end, value: text } = el
      const lineStart = text.lastIndexOf('\n', start - 1) + 1
      if (start === end && !event.shiftKey) {
        // execCommand 插入的文字进原生撤销栈，Cmd+Z 能撤回
        if (!document.execCommand('insertText', false, '  ')) onChange(text.slice(0, start) + '  ' + text.slice(end))
        return
      }
      // 选中多行时整块缩进 / 反缩进
      const blockEnd = text.indexOf('\n', end - (end > start && text[end - 1] === '\n' ? 1 : 0))
      const stop = blockEnd < 0 ? text.length : blockEnd
      const chunk = text.slice(lineStart, stop)
      const next = event.shiftKey ? chunk.replace(/^( {1,2}|\t)/gm, '') : chunk.replace(/^/gm, '  ')
      el.setSelectionRange(lineStart, stop)
      if (!document.execCommand('insertText', false, next)) onChange(text.slice(0, lineStart) + next + text.slice(stop))
      el.setSelectionRange(lineStart, lineStart + next.length)
    }
  }

  return (
    <div ref={scroller} className={`md-ed-scroll ${lineNumbers ? 'has-gutter' : ''} ${typewriter ? 'is-typewriter' : ''}`}>
      <div className="md-ed-inner">
        {lineNumbers ? (
          <div className="md-ed-gutter" aria-hidden="true">
            {rows.map((row, i) => <span key={i} style={{ top: row.top, height: row.height }}>{i + 1}</span>)}
          </div>
        ) : null}
        {flash ? <span key={flash.n} className="md-ed-flash" aria-hidden="true" style={{ top: flash.top, height: flash.height }} /> : null}
        <textarea
          ref={area}
          className="md-ed-text"
          aria-label={label ?? t('Markdown 原文')}
          spellCheck={false}
          value={value}
          onChange={(event) => { onChange(event.target.value); requestAnimationFrame(reportCaret) }}
          onKeyDown={onKeyDown}
          onKeyUp={reportCaret}
          onClick={reportCaret}
          onSelect={reportCaret}
          onBlur={onBlur}
        />
        <div ref={mirror} className="md-ed-mirror" aria-hidden="true" />
      </div>
    </div>
  )
}
