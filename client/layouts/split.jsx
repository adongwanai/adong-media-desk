// 左边写、右边看的分栏外框，和正文草稿的保存。
// 分栏中间的竖条可以拖，宽度记下来；窄的时候（窗口不到 1100，或者这一块不到 720）两栏变成「原文 / 预览」两个标签。
// 样式面板在宽屏时一直是右边一栏；不够宽时用「样式」按钮打开：放得下就挤在预览旁边，
// 实在太窄就从底下升起半屏，预览让到上面，正在调的那张卡片始终看得见，不被盖住。
import React from 'react'
import { dispatchOps, rewriteSelection, toast, useDesk } from '../desk.js'
import { t } from '../i18n.js'
import { Icon, Segmented } from '../ui.jsx'
import { SourceEditor } from './editor.jsx'

const SAVE_DELAY = 800

/** 正文的保存方式：工作台原来的 update_production。成功返回 true。 */
export function articleSaver(itemId) {
  if (!itemId) return null
  return async text => Boolean(await dispatchOps([{ op: 'update_production', id: itemId, article: text }], { label: t('修改正文'), silent: true }))
}

/**
 * 正文草稿：打字时先改本地，停下 800ms 后交给 save 写回去，离开时立刻写。
 * save 是调用方给的保存函数（成功返回 true）；没有 save 时只能在这里看，不会保存，状态显示「不会保存」。
 * 外面（比如对话里让助手改了稿）改了正文时，没有未保存的改动就跟着换。
 * @param {string} article - 现在存着的正文。
 * @param {((text: string) => Promise<boolean>) | null} save - 保存函数。
 * @returns {{text: string, setText: (text: string) => void, status: 'saved'|'dirty'|'saving'|'error'|'local', flush: () => void}}
 */
export function useArticleDraft(article, save) {
  const [text, setTextState] = React.useState(article)
  const [status, setStatus] = React.useState(save ? 'saved' : 'local')
  const pending = React.useRef(null)
  const timer = React.useRef(null)
  const saved = React.useRef(article)
  const saveRef = React.useRef(save)
  const mounted = React.useRef(true)
  saveRef.current = save

  const flush = React.useCallback(async function flush() {
    clearTimeout(timer.current)
    const next = pending.current
    const write = saveRef.current
    if (next === null || !write) return
    pending.current = null
    if (next === saved.current) { setStatus('saved'); return }
    setStatus('saving')
    let ok = false
    try {
      ok = await write(next)
    } catch {
      ok = false
    }
    if (ok) saved.current = next
    else if (pending.current === null) pending.current = next
    // 保存失败时留着这份改动，下次停手或离开时再试
    setStatus(!ok ? 'error' : pending.current === null ? 'saved' : 'dirty')
    if (!ok && mounted.current) timer.current = setTimeout(flush, 3000)
  }, [])

  const setText = React.useCallback((next) => {
    setTextState(next)
    if (!saveRef.current) return
    pending.current = next
    setStatus('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY)
  }, [flush])

  // 外面改了正文：只有本地没有没存的改动时才跟着换，免得冲掉正在打的字
  React.useEffect(() => {
    if (article === saved.current) return
    if (pending.current === null) {
      saved.current = article
      setTextState(article)
    }
  }, [article])

  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; flush() }
  }, [flush])
  return { text, setText, status, flush }
}

/** 停下 ms 毫秒后才更新的值；locked 时不跟着变。 */
export function useSettled(value, ms, locked = false) {
  const [settled, setSettled] = React.useState(value)
  React.useEffect(() => {
    if (locked) return undefined
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms, locked])
  return settled
}

/** 盯着一个元素的宽度。 */
export function useWidth(ref) {
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function LockIcon({ locked }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d={locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.8-1.3'} />
    </svg>
  )
}

const STATUS = { saved: '已保存', dirty: '未保存', saving: '保存中…', error: '保存失败，会再试', local: '只预览，不会保存' }

/**
 * 分栏外框。
 * @param {object} props - label, title, meta, actions, panel（样式面板）, preview（右边）, draft（useArticleDraft 的结果）,
 *   editorPrefs / setEditorPrefs（分栏宽度、锁定、打字机、行号）, onCaret(line), editorApi, words,
 *   previewBar（预览上面常驻的一条：字体、字号、封面标题这些最常改的，同言起工具栏，不用打开样式面板去找）。
 */
export function SplitFrame({ label, title, meta, actions, panel, preview, draft, editorPrefs, setEditorPrefs, onCaret, editorApi, tab, setTab, notice = null, previewBar = null, editingTheme = false, onExitTheme = null }) {
  const [panelOpen, setPanelOpen] = React.useState(false)
  const body = React.useRef(null)
  const split = React.useRef(null)
  const width = useWidth(body)
  const [viewport, setViewport] = React.useState(() => window.innerWidth)
  React.useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // 面板放在右边要 300px；整块不到 1360 时平时收起，把地方让给两栏
  const docked = width >= 1360
  // 收起的面板打开时：整块有 760 就挤在预览旁边，不然从底下升起
  const room = width >= 760
  const beside = docked || (panelOpen && room)
  const sheet = panelOpen && !docked && !room
  const splitWidth = beside ? width - 300 : width
  const tabs = viewport < 1100 || splitWidth < 720
  // 调样式时要看着预览：两栏变成标签时自动切到预览
  React.useEffect(() => {
    if (panelOpen && tabs && tab !== 'preview') setTab('preview')
  }, [panelOpen, tabs]) // eslint-disable-line react-hooks/exhaustive-deps
  const studioChatOpen = useDesk(s => Boolean(s.focusId && s.studioDock))
  // 左栏对话开着时默认收起中间源码框，把整块宽度留给实时预览；点右上角「正文」仍可随时展开双栏源码对照
  const showEditor = tabs || (editorPrefs.showSource !== undefined ? Boolean(editorPrefs.showSource) : !studioChatOpen)
  const ratio = Math.min(0.7, Math.max(0.25, Number(editorPrefs.split) || 0.44))

  const startDrag = (event) => {
    const box = split.current?.getBoundingClientRect()
    if (!box) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    const move = e => setEditorPrefs({ split: Math.round(Math.min(0.7, Math.max(0.25, (e.clientX - box.left) / box.width)) * 1000) / 1000 })
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.classList.remove('is-dragging')
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  const onDividerKey = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setEditorPrefs({ split: Math.min(0.7, Math.max(0.25, ratio + (event.key === 'ArrowLeft' ? -0.02 : 0.02))) })
  }

  const locked = Boolean(editorPrefs.locked)
  const focusId = useDesk(s => s.focusId)
  const [selection, setSelection] = React.useState(null)
  const [selInstruction, setSelInstruction] = React.useState('')
  const [selBusy, setSelBusy] = React.useState(false)
  const [selElapsed, setSelElapsed] = React.useState(0)
  const [selDiff, setSelDiff] = React.useState(null)

  React.useEffect(() => {
    if (!selBusy) { setSelElapsed(0); return undefined }
    const t0 = Date.now()
    const id = setInterval(() => setSelElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(id)
  }, [selBusy])

  const runEditorRewrite = async (mode, customInstruction = '') => {
    if (!focusId || !selection?.text?.trim() || selBusy) return
    setSelBusy(true)
    const snapSel = { ...selection }
    const beforeContext = draft.text.slice(Math.max(0, snapSel.start - 700), snapSel.start)
    const afterContext = draft.text.slice(snapSel.end, Math.min(draft.text.length, snapSel.end + 450))
    const enrichedInstruction = mode === 'custom' && /(?:加|补|写|扩|续|新增|展开|插入|章节|段落)/.test(customInstruction)
      ? `${customInstruction}（请严格对齐上文的编号、标题格式与语气，把选中的「${snapSel.text.trim().slice(0, 30)}」扩写成完整的 Markdown 段落/章节，直接输出替换后的完整正文）`
      : customInstruction
    try {
      await draft.flush()
      const res = await rewriteSelection(focusId, {
        selection: snapSel.text,
        mode,
        instruction: enrichedInstruction,
        beforeContext,
        afterContext,
      })
      const cleanOrig = snapSel.text.trim()
      const cleanRep = String(res?.replacement ?? '').trim()
      if (cleanRep && cleanRep !== cleanOrig) {
        const leadNl = /^\n+/.exec(snapSel.text)?.[0] ?? ''
        const tailNl = /\n+$/.exec(snapSel.text)?.[0] ?? ''
        setSelDiff({
          start: snapSel.start,
          end: snapSel.end,
          original: snapSel.text,
          replacement: `${leadNl}${cleanRep}${tailNl}`,
          mode,
          instruction: customInstruction,
        })
      } else if (res && cleanRep === cleanOrig) {
        toast(t('改写结果与原文一致，可换个说法再试'))
      }
    } finally {
      setSelBusy(false)
    }
  }

  const acceptSelDiff = () => {
    if (!selDiff) return
    if (draft.text.slice(selDiff.start, selDiff.end) === selDiff.original && editorApi?.current?.replaceRange) {
      editorApi.current.replaceRange(selDiff.start, selDiff.end, selDiff.replacement)
    } else {
      const idx = draft.text.indexOf(selDiff.original)
      if (idx >= 0) {
        draft.setText(draft.text.slice(0, idx) + selDiff.replacement + draft.text.slice(idx + selDiff.original.length))
      } else {
        toast(t('正文里没找到这一句，可能已经改过了'), { error: true })
        setSelDiff(null)
        return
      }
    }
    setSelDiff(null)
    setSelInstruction('')
    toast(t('已局部替换选中内容，其余文字未动'))
  }

  const toggle = (key, value) => (
    <button type="button" className={`md-yq-tool ${editorPrefs[key] ? 'is-on' : ''}`} aria-pressed={Boolean(editorPrefs[key])} onClick={() => setEditorPrefs({ [key]: !editorPrefs[key] })}>{value}</button>
  )
  const source = (
    <div className="md-yq-pane is-source" aria-label={t('正文')}>
      <div className="md-yq-pane-bar">
        <span className="md-yq-pane-title">{t('正文')}</span>
        <span className={`md-yq-save is-${draft.status}`} aria-live="polite">{t(STATUS[draft.status])}</span>
        <span className="md-yq-paste-tip" title={t('支持直接在正文中按 ⌘V / Ctrl+V 粘贴截图，或拖入本地图片')}>{t('可 ⌘V 贴图')}</span>
        <span className="md-grow" />
        <button
          type="button"
          className="md-yq-tool"
          title={t('选择图片插入光标处（也可直接在编辑框按 ⌘V 粘贴截图或拖入图片）')}
          onClick={() => editorApi?.current?.pickImages?.()}
        >
          + {t('插图')}
        </button>
        {toggle('lineNumbers', t('行号'))}
        {toggle('typewriter', t('打字机'))}
      </div>
      {selDiff ? (
        <div className="md-ed-diff" role="region" aria-label={t('局部改写预览')}>
          <div className="md-ed-diff-head">
            <b><Icon name="spark" size={12} />{t('局部替换预览（其余段落 100% 不动）')}</b>
            <span className="md-grow" />
            <button type="button" className="md-yq-tool" disabled={selBusy} onClick={() => runEditorRewrite(selDiff.mode, selDiff.instruction)}>{selBusy ? t('重写中…') : t('换一版')}</button>
            <button type="button" className="md-yq-tool" onClick={() => setSelDiff(null)}>{t('放弃')}</button>
            <button type="button" className="md-yq-tool is-primary" onClick={acceptSelDiff}>{t('采纳替换')}</button>
          </div>
          <div className="md-ed-diff-body">
            <del>{selDiff.original}</del>
            <ins>{selDiff.replacement}</ins>
          </div>
        </div>
      ) : focusId && selection ? (
        <form
          className="md-ed-selbar"
          onSubmit={(e) => {
            e.preventDefault()
            if (selInstruction.trim()) runEditorRewrite('custom', selInstruction.trim())
          }}
        >
          <span className="md-ed-sel-badge">
            {selBusy
              ? t('生成中 {s}s…', { s: selElapsed })
              : t('已选 {n} 字', { n: Array.from(selection.text.trim()).length })}
          </span>
          <button type="button" className="md-yq-tool" disabled={selBusy} onClick={() => runEditorRewrite('humanize')}>{t('去AI味')}</button>
          <button type="button" className="md-yq-tool" disabled={selBusy} onClick={() => runEditorRewrite('shorten')}>{t('精简')}</button>
          <button type="button" className="md-yq-tool" disabled={selBusy} onClick={() => runEditorRewrite('punchy')}>{t('更抓人')}</button>
          <input
            type="text"
            value={selInstruction}
            disabled={selBusy}
            onChange={e => setSelInstruction(e.target.value)}
            placeholder={t('输入改法或扩写要求回车（如：加一个章节…）')}
          />
          <button
            type="submit"
            className="md-yq-tool is-primary"
            disabled={selBusy || !selInstruction.trim()}
          >
            {selBusy ? t('正在生成…') : t('只改这段')}
          </button>
          {!selBusy ? (
            <button type="button" className="md-yq-tool" title={t('关闭局部编辑条')} aria-label={t('关闭')} onClick={() => setSelection(null)}>×</button>
          ) : null}
        </form>
      ) : null}
      <SourceEditor value={draft.text} onChange={draft.setText} onCaret={onCaret} onSelection={setSelection} lineNumbers={editorPrefs.lineNumbers} typewriter={editorPrefs.typewriter} apiRef={editorApi} onBlur={draft.flush} />
    </div>
  )
  return (
    <section className={`md-layout-card md-yq-split-card ${tabs ? 'is-tabs' : ''} ${docked ? 'is-docked' : ''} ${width && width < 1000 ? 'is-compact' : ''}`} aria-label={label}>
      <header className="md-tile-head md-layout-head">
        <h2>{title}</h2>
        {meta ? <span className="md-tile-meta md-layout-note">{meta}</span> : null}
        <span className="md-grow" />
        {tabs && showEditor ? <Segmented label={t('正文或预览')} value={tab} onChange={setTab} options={[{ value: 'source', label: t('正文') }, { value: 'preview', label: t('预览') }]} /> : null}
        <button type="button" className={`md-pill md-yq-lock md-yq-act ${locked ? 'is-on' : ''}`} aria-label={locked ? t('预览已锁定') : t('锁定预览')} aria-pressed={locked} title={locked ? t('预览已锁定：改字、挪光标时右边不跟着翻页和重排，方便对照着看。点一下解锁') : t('锁定预览：改字、挪光标时右边不跟着翻页和重排，方便对照着看')} onClick={() => setEditorPrefs({ locked: !locked })}>
          <LockIcon locked={locked} /><span>{locked ? t('预览已锁定') : t('锁定预览')}</span>
        </button>
        {tabs ? null : <button type="button" className={`md-pill md-yq-act ${showEditor ? 'is-on' : ''}`} aria-pressed={showEditor} aria-label={t('正文')} title={t('显示或隐藏左边的正文')} onClick={() => setEditorPrefs({ showSource: !showEditor })}><Icon name="edit" size={14} /><span>{t('正文')}</span></button>}
        {!docked ? <button type="button" className={`md-pill md-yq-act ${panelOpen ? 'is-on' : ''}`} aria-expanded={panelOpen} aria-label={t('样式')} title={t('样式')} onClick={() => setPanelOpen((value) => { if (value && editingTheme) onExitTheme?.(); return !value })}><Icon name="palette" size={14} /><span>{t('样式')}</span></button> : null}
        {actions}
      </header>
      {notice}
      <div ref={body} className={`md-yq-body ${sheet ? 'is-sheet' : ''}`}>
        <div ref={split} className="md-yq-split" style={showEditor && !tabs ? { gridTemplateColumns: `minmax(240px, ${ratio}fr) 9px minmax(300px, ${1 - ratio}fr)` } : undefined}>
          {showEditor && (!tabs || tab === 'source') ? source : null}
          {showEditor && !tabs ? <div className="md-yq-divider" role="separator" aria-orientation="vertical" aria-label={t('拖动调整左右宽度')} tabIndex={0} onPointerDown={startDrag} onKeyDown={onDividerKey} onDoubleClick={() => setEditorPrefs({ split: 0.44 })}><i /></div> : null}
          {!showEditor || !tabs || tab === 'preview' ? <div className="md-yq-pane is-preview">{previewBar ? <div className="md-yq-quick" role="toolbar" aria-label={t('常用排版')}>{previewBar}</div> : null}{preview}</div> : null}
        </div>
        <aside className={`md-yq-panel ${beside ? 'is-docked' : sheet ? 'is-sheet' : 'is-drawer'} ${panelOpen ? 'is-open' : ''}`} aria-label={t('排版样式')}>
          {!docked ? (
            <button
              type="button"
              className="md-yq-panel-close"
              aria-label={editingTheme ? t('返回主题') : t('关闭')}
              title={editingTheme ? t('返回主题') : t('关闭')}
              onClick={() => {
                if (editingTheme && onExitTheme) onExitTheme()
                else setPanelOpen(false)
              }}
            >
              <Icon name={editingTheme ? 'chevL' : 'close'} size={14} />
            </button>
          ) : null}
          {panel}
        </aside>
      </div>
    </section>
  )
}
