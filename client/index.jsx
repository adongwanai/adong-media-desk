// dsh-media-desk 浏览器半片：侧栏入口 + main 全局面板。
import React from 'react'
import { BoardView } from './board.jsx'
import { bindHost } from './browser.js'
import { openQuickCapture, registerQuickCapture } from './quick-capture.js'
import { Palette, ShortcutSheet, registerPalette } from './palette.jsx'
import paletteCss from './palette.css'
import startCardCss from './start-card.css'
import guideCss from './guide.css'
import { GuideLayer } from './guide.jsx'
import { CAPTURE_KEY, NAV, PAGES, PALETTE_HOST_KEY, PALETTE_KEY, keysText, pageLabel } from './shortcuts.js'
import boardCss from './board.css'
import boardIncomeCss from './board-income.css'
import { HomeView } from './canvas.jsx'
import { looksLikeNotePath } from './capture-text.js'
import { ChatDock } from './chat.jsx'
import { ContentView } from './content.jsx'
import { addMaterials, captureFile, captureFiles, captureUrl, dispatchOps, loadDesk, readPickedMaterials, setDesk, toast, undo, useDesk, MAX_MATERIALS_PER_ADD } from './desk.js'
import { InsightsView } from './insights.jsx'
import { StyleView } from './style.jsx'
import { ScheduleView } from './schedule.jsx'
import { PublishView } from './publish.jsx'
import publishCss from './publish.css'
import versionsCss from './versions.css'
import { SourcesView } from './sources.jsx'
import { RivalsView } from './rivals.jsx'
import dataCss from './data.css'
import focusCss from './focus.css'
import importFolderCss from './import-folder.css'
import integrationsCss from './integrations.css'
import { ModelButton, ModelPicker } from './modelpick.jsx'
import { SettingsDialog } from './settings.jsx'
import { Studio } from './studio.jsx'
import { VideoView } from './video/page.jsx'
import videoCss from './video/video.css'
import layoutsCss from './layouts/layouts.css'
import css from './styles.css'
import { subscribeLang, t, useLang } from './i18n.js'
import { Dialog, FormDialog, Icon, IconButton, Swap, Toast } from './ui.jsx'
import { navBadges } from './util.js'


const PANEL_ID = 'media-desk'
// 角标数字的意思，放在导航按钮的提示里
const NAV_BADGE_HINT = { home: '{n} 条灵感等着成稿', publish: '{n} 篇待发布，还没发出去' }

const VIEWS = { board: BoardView, sources: SourcesView, home: HomeView, content: ContentView, schedule: ScheduleView, publish: PublishView, video: VideoView, insights: InsightsView, rivals: RivalsView, style: StyleView }

function CaptureDialog() {
  const capture = useDesk(s => s.capture)
  const [tab, setTab] = React.useState('text')
  const [text, setText] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // 这次记灵感时顺手带的素材文件：记完挂在同一条灵感上
  const [materials, setMaterials] = React.useState([])
  const [materialNote, setMaterialNote] = React.useState(null)
  const [materialPaths, setMaterialPaths] = React.useState('')
  const [pastePaths, setPastePaths] = React.useState(false)
  const fileInput = React.useRef(null)
  const materialInput = React.useRef(null)
  React.useEffect(() => {
    if (!capture) return
    setTab(capture.tab ?? 'text')
    setText('')
    setUrl('')
    setMaterials([])
    setMaterialNote(null)
    setMaterialPaths('')
    setPastePaths(false)
  }, [capture])
  if (!capture) return null
  const close = () => setDesk({ capture: null })
  const pastedPaths = () => materialPaths.split(/\n+/).map(row => row.trim()).filter(Boolean)
  const attach = async (id, extraPaths = []) => {
    const paths = [...extraPaths, ...pastedPaths()]
    if (!id || (!materials.length && !paths.length)) return
    const result = await addMaterials(id, { files: materials, paths })
    // 弹窗马上就关了，没加上的那几份用提示条说清楚
    if (result?.errors?.length) toast(t('有 {n} 份素材没加上：{reason}', { n: result.errors.length, reason: result.errors.map(row => `${row.name}：${row.reason}`).join('；') }), { error: true })
    else if (result) toast(t('已带上 {n} 份素材', { n: result.added.length }), { undo: true })
  }
  const pickMaterials = async (fileList) => {
    const room = MAX_MATERIALS_PER_ADD - materials.length
    const { files, errors } = await readPickedMaterials([...(fileList ?? [])].slice(0, Math.max(room, 0)), materials.reduce((sum, row) => sum + row.text.length, 0))
    const over = (fileList?.length ?? 0) - Math.max(room, 0)
    const notes = [...errors.map(row => `${row.name}：${row.reason}`), ...(over > 0 ? [t('一次最多加 {n} 份素材', { n: MAX_MATERIALS_PER_ADD })] : [])]
    setMaterials(rows => [...rows, ...files])
    setMaterialNote(notes.length ? notes.join('；') : null)
  }
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    if (tab === 'link' && url.trim()) {
      const id = await captureUrl(url.trim())
      if (id) {
        await attach(id)
        close()
      }
    } else if (tab === 'quote' || tab === 'text') {
      const value = text.trim()
      // 一次贴了好几行路径：第一份当这条灵感的正文，其余的都挂成素材
      const lines = value.split(/\n+/).map(row => row.trim()).filter(Boolean)
      const manyPaths = tab === 'text' && lines.length > 1 && lines.every(looksLikeNotePath)
      // 贴进来的是一个本地 Markdown 路径：读文件当素材，别把路径当成标题、正文留空
      if (tab === 'text' && (looksLikeNotePath(value) || manyPaths)) {
        try {
          const id = await captureFile(manyPaths ? lines[0] : value)
          if (id) {
            await attach(id, manyPaths ? lines.slice(1) : [])
            close()
          }
        } catch (err) {
          toast(err.message, { error: true })
        }
        setBusy(false)
        return
      }
      if (value) {
        const data = await dispatchOps([{ op: 'add_item', kind: tab === 'quote' ? 'quote' : 'note', title: tab === 'quote' ? value : value.split(/[。！？\n]|[.!?](?=\s|$)/)[0].slice(0, 40), body: tab === 'quote' ? '' : value }], { label: t('记下灵感') })
        await attach(data?.receipts?.[0]?.target)
        close()
      }
    }
    setBusy(false)
  }
  const tabs = [['text', t('笔记')], ['quote', t('金句')], ['link', t('链接')], ['file', t('图片/视频')]]
  return (
    <Dialog title={t('记下一个灵感')} onClose={close} width={480}>
      <div className="md-capture-tabs" role="tablist">
        {tabs.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <form className="md-form" onSubmit={save}>
        {tab === 'link' ? (
          <label className="md-field">
            <span>{t('链接')}</span>
            <input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" />
            <small>{t('会自动读取页面的标题、简介和封面。')}</small>
          </label>
        ) : tab === 'file' ? (
          <button type="button" className="md-dropzone" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={22} />
            <span>{t('选择图片或视频')}</span>
            <small>{t('也可以直接把文件拖到「灵感」页上')}</small>
            <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={async (e) => { const files = [...e.target.files]; close(); await captureFiles(files) }} />
          </button>
        ) : (
          <label className="md-field">
            <span>{tab === 'quote' ? t('这句话') : t('想法')}</span>
            <textarea rows={4} required value={text} onChange={e => setText(e.target.value)} placeholder={tab === 'quote' ? t('好的选题不是想出来的……') : t('想到什么就写什么，之后再让助手补全。')} />
          </label>
        )}
        {tab === 'file' ? null : (
          <div className="md-capture-materials">
            <div className="md-capture-materials-head">
              <span>{t('素材文件（可选）')}</span>
              <span className="md-grow" />
              <button type="button" className="md-link-btn" onClick={() => materialInput.current?.click()}>{t('加素材文件')}</button>
              <button type="button" className="md-link-btn" aria-expanded={pastePaths} onClick={() => setPastePaths(value => !value)}>{pastePaths ? t('收起路径') : t('贴路径')}</button>
              <input ref={materialInput} type="file" hidden multiple accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={async (e) => { await pickMaterials(e.target.files); e.target.value = '' }} />
            </div>
            {pastePaths ? <textarea className="md-capture-paths" rows={3} value={materialPaths} onChange={e => setMaterialPaths(e.target.value)} placeholder={t('一行一个文件路径，比如 /Users/你/Documents/笔记.md')} aria-label={t('素材文件路径')} /> : null}
            {pastePaths && pastedPaths().length + materials.length > MAX_MATERIALS_PER_ADD ? <small className="is-error">{t('一次最多加 {n} 份素材', { n: MAX_MATERIALS_PER_ADD })}</small> : null}
            {materials.length ? (
              <ul className="md-capture-materials-list">
                {materials.map((row, index) => (
                  <li key={`${row.name}:${index}`}>
                    <Icon name="fileText" size={12} />
                    <span className="md-ellipsis" title={row.name}>{row.name}</span>
                    <span className="md-muted">{t('{n} 字', { n: row.text.length })}</span>
                    <button type="button" className="md-inline-link" aria-label={t('删掉这份素材')} onClick={() => setMaterials(rows => rows.filter((_, i) => i !== index))}><Icon name="close" size={12} /></button>
                  </li>
                ))}
              </ul>
            ) : <small>{t('最多 {n} 份，每份不超过 2 MB。成稿时这些文件当成事实来源，和这条灵感一起用。', { n: MAX_MATERIALS_PER_ADD })}</small>}
            {materialNote ? <small className="is-error">{materialNote}</small> : null}
          </div>
        )}
        {tab === 'file' ? null : (
          <div className="md-form-foot">
            <span style={{ flex: 1 }} />
            <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
            <button type="submit" className="md-btn is-primary" disabled={busy}><Swap labels={[t('记到灵感'), t('保存中…')]} at={busy ? 1 : 0} /></button>
          </div>
        )}
      </form>
    </Dialog>
  )
}

function SampleBadge() {
  const hasSample = useDesk(s => s.state.items.some(i => i.sample))
  if (!hasSample) return null
  return (
    <button type="button" className="md-sample" title={t('现在看到的内容都是示例，可以一键清空')} onClick={() => setDesk({
      dialog: {
        title: t('清空示例数据'),
        submitLabel: t('清空'),
        fields: [],
        onSubmit: () => dispatchOps([{ op: 'clear_samples' }], { label: t('清空示例数据') }),
      },
    })}>{t('示例数据 · 清空')}</button>
  )
}

let lastCounts = { key: '', value: {} }
/**
 * 导航角标只挂「等着你动手」的：灵感（自己记的、等着成稿）和发布（待发布、还没发出去）。
 * 正在写的草稿不算待办，「内容」不挂数字。数和各页标题共用 util.js 的 navBadges，几处对得上。
 * 结果按内容缓存，数字没变就返回同一个对象，免得整页重画。
 */
function navCounts(state) {
  if (!state) return lastCounts.value
  const { home, publish } = navBadges(state.items)
  const value = { home, publish }
  const key = JSON.stringify(value)
  if (key !== lastCounts.key) lastCounts = { key, value }
  return lastCounts.value
}

export function Desk() {
  // 切换语言时整棵树重新渲染
  useLang()
  const ready = useDesk(s => Boolean(s.state))
  const error = useDesk(s => s.error)
  const view = useDesk(s => s.view)
  // 流程在导航上就看得见：哪一站有东西等着处理，数字就挂在哪一站
  const counts = useDesk(s => navCounts(s.state))
  const dockOpen = useDesk(s => s.dockOpen)
  const canUndo = useDesk(s => s.canUndo)
  const reload = useDesk(s => s.reload)
  const rootRef = React.useRef(null)
  const gAt = React.useRef(0)
  const [width, setWidth] = React.useState(1600)
  const narrow = width < 1020

  React.useEffect(() => { loadDesk() }, [])
  // 窗口窄的时候对话栏会盖住内容，默认收起，需要时再打开
  React.useEffect(() => {
    if (narrow) setDesk({ dockOpen: false })
  }, [narrow])
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    const go = (view) => setDesk({ view, focusId: null })
    // ⌘/Ctrl + K：宿主在冒泡阶段把它当「搜索会话」，这里在捕获阶段先接住，只限工作台里（含没有焦点时）
    const onCapture = (event) => {
      if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.code !== PALETTE_KEY.code) return
      const root = rootRef.current
      const target = event.target
      if (!root || !root.getClientRects().length) return
      if (!(target === document.body || target === document.documentElement || root.contains(target))) return
      const dialog = target.closest?.('[role="dialog"]')
      if (dialog && !dialog.classList.contains('md-palette')) return
      event.preventDefault()
      setDesk(s => ({ palette: !s.palette }))
    }
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing) return
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable
      const mod = event.metaKey || event.ctrlKey
      // 宿主没接住的时候（独立运行、Linux 网页版、登记被拒）在工作台里兜一个同样的键位；宿主接住了会先 preventDefault
      if (mod && event.shiftKey && !event.altKey && event.code === CAPTURE_KEY.code) {
        event.preventDefault()
        openQuickCapture()
        return
      }
      if (mod && event.shiftKey && !event.altKey && event.code === PALETTE_HOST_KEY.code) {
        event.preventDefault()
        setDesk({ palette: true })
        return
      }
      if (mod && event.key === 'z' && !event.shiftKey && !typing && canUndo) {
        event.preventDefault()
        undo()
        return
      }
      // 页面快捷键：光标在输入框或弹窗里时不抢
      if (typing || event.altKey || event.target.closest?.('[role="dialog"]')) return
      if (mod) {
        const page = /^Digit[1-9]$/.test(event.code) && !event.shiftKey ? NAV[Number(event.code.slice(5)) - 1] : null
        if (page) { event.preventDefault(); go(page.id) }
        return
      }
      if (event.key === '?' || event.key === '？') {
        event.preventDefault()
        setDesk({ shortcutSheet: true })
        return
      }
      if (gAt.current && Date.now() - gAt.current < 1500) {
        gAt.current = 0
        const page = PAGES.find(row => event.code === `Key${row.letter}`)
        if (page) { event.preventDefault(); go(page.id) }
        return
      }
      if (event.code === 'KeyG' && !event.shiftKey) gAt.current = Date.now()
    }
    window.addEventListener('keydown', onCapture, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onCapture, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [canUndo])

  // 工作区有自己的对话栏
  const focused = useDesk(s => Boolean(s.focusId))
  // 大屏要一屏看全，不让对话栏占地方
  const onBoard = view === 'board'
  // 视频页是整块剪辑工作区，也不放对话栏
  const onVideo = view === 'video'
  const showDock = dockOpen && !focused
  const Active = VIEWS[view] ?? HomeView
  return (
    <div className={`md-root ${narrow ? 'is-narrow' : ''} ${width < 780 ? 'is-compact' : ''} ${showDock ? 'has-dock' : ''} ${onVideo ? 'is-video' : ''}`} ref={rootRef}>
      <style>{css}{boardCss}{boardIncomeCss}{publishCss}{layoutsCss}{dataCss}{versionsCss}{focusCss}{paletteCss}{startCardCss}{guideCss}{videoCss}{importFolderCss}{integrationsCss}</style>
      <div className="md-ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="md-main">
        <header className="md-topbar" data-window-drag="">
          <nav className="md-nav" aria-label={t('工作台导航')}>
            {NAV.map((entry, index) => (
              <button type="button" key={entry.id} className={view === entry.id ? 'is-on' : ''} aria-current={view === entry.id ? 'page' : undefined} title={`${t('{page}（快捷键 G {letter} 或 {keys}）', { page: pageLabel(entry), letter: entry.letter, keys: keysText({ code: `Digit${index + 1}`, modifiers: ['primary'] }) })}${counts[entry.id] ? `\n${t(NAV_BADGE_HINT[entry.id], { n: counts[entry.id] })}` : ''}`} onClick={() => setDesk({ view: entry.id, focusId: null })}>{pageLabel(entry)}{counts[entry.id] ? <span className="md-nav-count">{counts[entry.id]}</span> : null}</button>
            ))}
          </nav>
          <span className="md-grow" />
          {ready ? <SampleBadge /> : null}
          {canUndo ? <IconButton icon="undo" label={t('撤销上一步')} onClick={undo} /> : null}
          {ready ? <span className="md-topbar-model"><ModelButton /></span> : null}
          {/* 风格不是每天都要进的页面，和设置一起收在右上角 */}
          <IconButton icon="pen" label={t('写作风格')} active={view === 'style'} onClick={() => setDesk({ view: 'style', focusId: null })} />
          <IconButton icon="help" className="md-topbar-help" label={t('怎么用')} onClick={() => setDesk({ guide: true })} />
          <IconButton icon="search" label={t('命令面板（{keys}）', { keys: keysText(PALETTE_KEY) })} onClick={() => setDesk({ palette: true })} />
          <IconButton icon="gear" label={t('设置')} onClick={() => setDesk({ settingsOpen: true })} />
          {/* 各页面共用原生 DSH 助手入口 */}
          {showDock ? null : <button type="button" className="md-open-dock" onClick={() => setDesk({ dockOpen: true })}><Icon name="chat" size={15} />{t('助手')}</button>}
        </header>
        <main className="md-content" key={`${view}:${reload}`}>
          {error ? (
            <div className="md-page"><p className="md-muted">{t('工作台加载失败：{error}', { error })}</p><button type="button" className="md-btn" onClick={loadDesk}>{t('重试')}</button></div>
          ) : ready ? <Active /> : <div className="md-loading"><span className="md-shimmer">{t('正在铺开灵感…')}</span></div>}
        </main>
        {ready ? <Studio /> : null}
      </div>
      {/* 窄窗口里助手栏是浮在内容上面的：垫一层遮罩，点一下空白处就收起，免得盖住右侧按钮又不知道怎么关 */}
      {ready && showDock && narrow ? <button type="button" className="md-dock-scrim" aria-label={t('收起助手')} onClick={() => setDesk({ dockOpen: false })} /> : null}
      {ready && showDock ? <ChatDock /> : null}
      {ready ? <CaptureDialog /> : null}
      <FormDialog />
      {ready ? <SettingsDialog /> : null}
      {ready ? <ModelPicker /> : null}
      {ready ? <Palette /> : null}
      <GuideLayer />
      <ShortcutSheet />
      <Toast />
    </div>
  )
}

function PanelIcon({ size }) {
  return <Icon name="scatter" size={size} />
}

export const inject = ['slots']

export function apply(ctx) {
  bindHost(ctx)
  registerQuickCapture(ctx)
  registerPalette(ctx, PANEL_ID)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Desk))
  // 侧栏的名字只在注册时读一次，换语言时重新注册
  ctx.effect(() => {
    let release = null
    const mount = () => {
      release?.()
      release = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 5,
        label: () => t('阿东IP工作台'),
      }, PanelIcon))
    }
    mount()
    const off = subscribeLang(mount)
    return () => { off(); release?.() }
  }, 'dsh-media-desk: sidebar entry')
  mountBetterSidebar(ctx)
}

/**
 * 装了 dsh-better-sidebar 就再挂一个右侧栏的页面（#10）：左侧栏被别的插件整个接管时，
 * 这是唯一还点得到的入口。没装就什么都不做——它是软依赖，不进顶层的 inject。
 */
function mountBetterSidebar(ctx) {
  const register = inner => {
    const sidebar = inner.betterSidebar ?? inner.get?.('betterSidebar')
    if (typeof sidebar?.registerTab !== 'function') return
    inner.effect(() => sidebar.registerTab({
      id: `${PANEL_ID}:workbench`,
      title: () => t('阿东IP工作台'),
      description: () => t('灵感、内容、排期、复盘、风格'),
      icon: size => <PanelIcon size={size} />,
      order: 60,
      single: true,
      component: Desk,
    }), 'dsh-media-desk: better-sidebar tab')
  }
  try {
    // 服务晚于我们就绪、或者中途被卸掉再装回，子作用域都会跟着重来
    if (typeof ctx.inject === 'function') ctx.inject(['betterSidebar'], register)
    else register(ctx)
  } catch (error) {
    console.warn('[dsh-media-desk] better-sidebar tab skipped:', error)
  }
}
