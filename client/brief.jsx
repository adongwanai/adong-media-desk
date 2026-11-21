// 对话栏顶部的灵感卡：这条灵感本身，加一张属性表（体裁、风格、素材、成稿过程），以及唯一的入口「一键成稿」。
import React from 'react'
import { addMaterials, cancelProduce, dispatchOps, removeMaterial, runProduce, scanWritingFlow, setDesk, toast, uploadAttachment, useDesk } from './desk.js'
import { plural, t } from './i18n.js'
import { Scorecard } from './scorecard.jsx'
import { StylePicker } from './style-picker.jsx'
import { AutoText, isBusy } from './studio-kit.jsx'
import { Icon } from './ui.jsx'
import { fmtDate, textLength } from './util.js'
import { MAX_MATERIALS } from '../src/material-limits.js'

function fmtElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${r}s`
}

function shortToolName(name) {
  const n = String(name ?? '')
  if (/search|web|fetch|browse|tavily|curl/i.test(n)) return t('联网检索')
  if (/read|file|pdf|doc|view|cat|glob|grep/i.test(n)) return t('读取资料')
  if (/bash|exec|run|shell|terminal|node|python/i.test(n)) return t('运行工具')
  return n || t('调用能力')
}

function NativeDraftingPanel({ production, live, goal, mode, activeStyleName, fileCount }) {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const startedMs = live?.startedAt ?? (production.startedAt ? Date.parse(production.startedAt) : now)
  const elapsed = fmtElapsed((now - (Number.isFinite(startedMs) ? startedMs : now)) / 1000)
  const phase = live?.phase || (production.stage === 'connecting' ? 'connecting' : 'waiting')
  const activity = live?.activity ?? []
  const busyTool = [...activity].reverse().find(row => row.status === 'running')
  const words = textLength(live?.text || '')
  const cardEst = goal === 'xhs' && words > 0 ? Math.max(1, (String(live?.text || '').match(/^##\s+/gm)?.length ?? 0) + 1) : 0
  const connected = phase !== 'connecting'
  const researchDone = words > 0 || (phase === 'writing' && activity.length === 0 && Boolean(live?.reply))
  const researchActive = connected && !researchDone && (phase === 'tool' || phase === 'waiting' || activity.length > 0)
  const writingActive = words > 0 || phase === 'reasoning' || phase === 'writing'

  const title = goal === 'xhs' ? t('正在生成小红书图文') : goal === 'script' ? t('正在生成口播稿') : t('正在撰写长文')
  const goalChip = goal === 'xhs' ? t('小红书图文') : goal === 'script' ? t('口播稿') : t('公众号长文')
  const modeLabel = mode && mode !== 'auto' ? TONE_MODES.find(m => m.value === mode)?.label : null

  const steps = [
    {
      label: connected ? t('已连接会话并加载写作风格') : t('正在连接会话与加载个人风格…'),
      done: connected,
      active: !connected,
    },
    {
      label: busyTool
        ? `${shortToolName(busyTool.name)}${activity.length > 1 ? ` · ${t('第 {n} 项', { n: activity.length })}` : '…'}`
        : activity.length > 0
          ? t('已读取与检索 {n} 项参考信源', { n: activity.length })
          : t('解析选题要求与参考资料'),
      done: researchDone,
      active: researchActive && !writingActive,
    },
    {
      label: words > 0
        ? (cardEst > 0 ? t('正在流式撰写 · 已写 {n} 字（第 {c} 张卡）', { n: words, c: cardEst }) : t('正在流式撰写 · 已写 {n} 字', { n: words }))
        : phase === 'reasoning'
          ? t('正在构思切入点与段落结构…')
          : t('撰写正文与分段排版'),
      done: false,
      active: writingActive,
    },
    {
      label: goal === 'xhs' ? t('成稿后自动切分卡片与质检') : t('成稿后自动规整版式与自检'),
      done: false,
      active: false,
    },
  ]

  return (
    <div className="md-drafting-panel" role="status" aria-live="polite">
      <div className="md-drafting-head">
        <span className="md-live-dot" aria-hidden="true" />
        <b className="md-shimmer">{title}</b>
        <span className="md-drafting-time">{elapsed}</span>
        <button type="button" className="md-drafting-cancel" onClick={() => cancelProduce(production.id)}>{t('取消')}</button>
      </div>
      <div className="md-drafting-tags">
        <span>{activeStyleName}</span>
        <span>{goalChip}</span>
        {modeLabel ? <span>{t(modeLabel)}</span> : null}
        {fileCount > 0 ? <span>{t('{n} 份资料', { n: fileCount })}</span> : null}
      </div>
      <div className="md-progress-card is-native">
        {steps.map((step, idx) => (
          <div key={idx} className={`md-progress-step ${step.done ? 'is-done' : step.active ? 'is-active' : ''}`}>
            <i>{step.done ? <Icon name="check" size={10} stroke={2.6} /> : null}</i>
            <span>{step.active ? <span className="md-shimmer">{step.label}</span> : step.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 进度：放在对话栏里，像助手在汇报。 */
function ProgressCard({ production, live, settings, goal = 'xhs', mode = 'auto', activeStyleName = '', fileCount = 0 }) {
  const running = production.status === 'running'
  if (production.engine === 'dsh-native') {
    return (
      <NativeDraftingPanel
        production={production}
        live={live}
        goal={goal}
        mode={mode}
        activeStyleName={activeStyleName}
        fileCount={fileCount}
      />
    )
  }
  const ready = settings?.imageReady && production.withImages !== false
  const words = textLength(production.article || live?.text || '')
  const visuals = [production.cover, ...(production.images ?? [])].filter(Boolean)
  const shots = production.shots ?? []
  const count = list => list.filter(a => a.src).length
  const planned = production.stage !== 'brief'
  // 分镜只属于脚本，文章不画
  const isArticle = production.format === 'article'
  const kind = isArticle ? t('正文') : t('脚本')
  const steps = [
    { label: t('标题和封面字'), done: planned, active: !planned },
    { label: t('翻旧稿'), done: planned && live?.step !== 'recall', active: planned && live?.step === 'recall' },
    { label: production.article ? t('{kind} {n} 字', { kind, n: words, s: plural(words, '', 's') }) : words ? t('正在写 {n} 字', { n: words, s: plural(words, '', 's') }) : t('按风格写'), done: Boolean(production.article) || live?.step === 'humanize', active: planned && live?.step === 'write' },
    ...(settings?.humanize === false || production.direct ? [] : [{ label: t('去 AI 味'), done: Boolean(production.article), active: live?.step === 'humanize' }]),
    ...(ready ? [
      { label: t('封面和配图 {done}/{total}', { done: count(visuals), total: visuals.length || 1 + (settings?.imageCount ?? 2) }), done: planned && visuals.length > 0 && !visuals.some(isBusy), active: visuals.some(isBusy) },
      ...(isArticle ? [] : [{ label: t('分镜 {done}/{total}', { done: count(shots), total: shots.length || settings?.shotCount || 6 }), done: planned && shots.length > 0 && !shots.some(isBusy), active: shots.some(isBusy) }]),
    ] : []),
  ]
  return (
    <div className="md-progress-card">
      {steps.map((step, index) => (
        <div key={index} className={`md-progress-step ${step.done ? 'is-done' : step.active && running ? 'is-active' : ''}`}>
          <i>{step.done ? <Icon name="check" size={10} stroke={2.6} /> : null}</i>
          <span>{step.active && running ? <span className="md-shimmer">{step.label}</span> : step.label}</span>
        </div>
      ))}
      {running ? <button type="button" className="md-link-btn" onClick={() => cancelProduce(production.id)}>{t('取消')}</button> : null}
    </div>
  )
}

/** 灵感的正文：墙上卡片里看得见的那段，进了工作区也要在。长的先收起几行。 */
function IdeaBody({ item, disabled }) {
  const body = item.body ?? ''
  const long = body.length > 90 || body.split('\n').length > 4
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => setOpen(false), [item.id])
  // 导入的成稿，正文就是文章开头那一段，右边已经有全文，这里不再重复
  const article = item.production?.article ?? ''
  // 导入的文件只在 body 里留一段摘录，全文在 production.article，右边已经有，不再摆一个能改的框
  if (!body || (item.imported && item.importPath) || (article && article.startsWith(body.slice(0, 200)))) return null
  return (
    <div className="md-idea-body-wrap">
      <div className={`md-idea-body-clip ${long && !open ? 'is-clipped' : ''}`} onFocus={() => setOpen(true)}>
        <AutoText className="md-idea-body" label={t('灵感正文')} value={body} disabled={disabled} onCommit={next => dispatchOps([{ op: 'update_item', id: item.id, body: next }], { label: t('修改正文'), silent: true })} />
      </div>
      {long ? <button type="button" className="md-link-btn" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? t('收起') : t('展开全文')}</button> : null}
    </div>
  )
}

const SKIPPED = { headings: '去 AI 味时小标题被改动，保留了初稿', facts: '去 AI 味时出现了初稿里没有的数字，保留了初稿', length: '去 AI 味后篇幅变化太大，保留了初稿', lines: '去 AI 味时口播被并成了自然段，保留了初稿', empty: '去 AI 味没有返回内容，保留了初稿', error: '去 AI 味时模型出错，保留了初稿' }

/** 属性表里的一行：左边标签，右边内容，所有行共用同一条对齐线。 */
function Prop({ label, id, children }) {
  return (
    <div className="md-prop">
      <dt id={id}>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** 成稿过程：参考了哪些旧稿、这次实际用了哪些素材和工作流、去 AI 味做没做。 */
function FlowProps({ flow }) {
  const past = flow.past ?? []
  const sources = flow.sources ?? null
  const polish = flow.humanized ? t('已完成') : flow.skipped ? t(SKIPPED[flow.skipped] ?? '没有做去 AI 味') : t('没有做')
  return (
    <>
      <Prop label={t('参考')}>
        <span className="md-prop-text">{past.length ? t('{n} 篇旧稿', { n: past.length, s: plural(past.length, '', 's') }) : t('没有找到相关的旧稿')}</span>
        {past.length ? <ul className="md-prop-list">{past.map((row, i) => <li key={i} title={row.title}>《{row.title}》</li>)}</ul> : null}
      </Prop>
      {sources ? (
        <Prop label={t('用了什么')}>
          <details className="md-sources">
            <summary>{t('灵感 1 条 · 素材 {n} 份（{chars} 字）· 工作流 {k} 份', { n: (sources.materials ?? []).length, chars: (sources.materials ?? []).reduce((sum, row) => sum + (row.chars || 0), 0), k: (sources.workflow ?? []).length })}</summary>
            {(sources.materials ?? []).length ? <ul className="md-prop-list">{sources.materials.map((row, i) => <li key={i} title={row.name}>{row.name} · {t('{n} 字', { n: row.chars })}{row.truncated ? t('（已截断）') : ''}</li>)}</ul> : <p className="md-prop-note">{t('这次没有用素材文件。')}</p>}
            {(sources.dropped ?? []).length ? <p className="md-prop-note">{t('超过字数上限，没用上：{names}', { names: sources.dropped.map(row => row.name).join('、') })}</p> : null}
            {(sources.workflow ?? []).length ? <ul className="md-prop-list">{sources.workflow.map((row, i) => <li key={i} title={row.name}>{row.name} · {t('{n} 字', { n: row.chars })}{row.truncated ? t('（已截断）') : ''}</li>)}</ul> : <p className="md-prop-note">{t('这次没有加载写作工作流。')}</p>}
            {(sources.flowDropped ?? []).length ? <p className="md-prop-note">{t('工作流里超预算的：{names}', { names: sources.flowDropped.map(row => row.name).join('、') })}</p> : null}
            {(sources.flowErrors ?? []).length ? <p className="md-prop-note is-error">{(sources.flowErrors ?? []).join('；')}</p> : null}
          </details>
        </Prop>
      ) : null}
      <Prop label={t('去 AI 味')}>
        <span className={`md-prop-text ${flow.humanized ? 'is-ok' : ''}`}>{flow.humanized ? <Icon name="check" size={13} /> : null}{polish}</span>
      </Prop>
    </>
  )
}

/** 这条灵感带的附件与素材文件：支持任意原生格式（PDF、图片、Office、文本、代码等）。 */
function MaterialsProp({ item, disabled }) {
  const rows = item.materials ?? []
  const attachments = item.attachments ?? []
  const [busy, setBusy] = React.useState(false)
  const [paths, setPaths] = React.useState('')
  const [paste, setPaste] = React.useState(false)
  const [note, setNote] = React.useState(null)
  const input = React.useRef(null)
  React.useEffect(() => { setPaths(''); setPaste(false); setNote(null) }, [item.id])
  const total = rows.reduce((sum, row) => sum + (row.chars || 0), 0)
  const attNames = new Set(attachments.map(a => a.name))
  const extraMaterials = rows.filter(r => !attNames.has(r.name))
  const addLines = async (lines) => {
    setBusy(true)
    const result = await addMaterials(item.id, { files: [], paths: lines })
    setBusy(false)
    if (!result) return
    if (result.errors?.length) setNote(result.errors.map(row => `${row.name}：${row.reason}`).join('；'))
    else setNote(null)
    if (result.added?.length) toast(t('加了 {n} 份素材', { n: result.added.length }), { undo: true })
    setPaths('')
  }
  const uploadFiles = async (fileList) => {
    const picked = [...(fileList ?? [])].slice(0, 15)
    if (!picked.length) return
    setBusy(true)
    setNote(null)
    try {
      for (const file of picked) {
        await uploadAttachment(file, item.id)
      }
      toast(t('已添加 {n} 个附件', { n: picked.length }))
    } catch (err) {
      setNote(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Prop label={t('附件')}>
      <div className="md-materials">
        {attachments.length || extraMaterials.length ? (
          <ul className="md-materials-list">
            {attachments.map(att => (
              <li key={att.id} title={att.name}>
                <Icon name={att.mime?.startsWith('image/') ? 'image' : 'fileText'} size={12} />
                <span className="md-materials-name">{att.name}</span>
                <span className="md-materials-chars">{att.bytes ? `${Math.max(1, Math.round(att.bytes / 1024))} KB` : ''}</span>
                <button type="button" className="md-inline-link" aria-label={t('移除附件')} disabled={disabled || busy} onClick={() => dispatchOps([{ op: 'remove_attachment', id: item.id, attachmentId: att.id }], { label: t('移除附件'), silent: true })}><Icon name="close" size={12} /></button>
              </li>
            ))}
            {extraMaterials.map(row => (
              <li key={row.id} className={row.error ? 'is-error' : ''} title={[row.path || row.name, row.file ? t('超过 2 万字的部分存在工作台的文件目录里，成稿时读全文') : ''].filter(Boolean).join('\n')}>
                <Icon name="fileText" size={12} />
                <span className="md-materials-name">{row.name}</span>
                <span className="md-materials-chars">{row.error ? row.error : t('{n} 字', { n: row.chars })}</span>
                <button type="button" className="md-inline-link" aria-label={t('删掉这份素材')} disabled={disabled || busy} onClick={() => removeMaterial(item.id, row.id)}><Icon name="close" size={12} /></button>
              </li>
            ))}
          </ul>
        ) : <span className="md-prop-note">{t('支持直接拖入 PDF、图片、文档或代码，由原生会话解析。')}</span>}
        {rows.length && total ? <span className="md-prop-note">{t('文本合计约 {chars} 字', { chars: total })}</span> : null}
        <div className="md-materials-acts">
          <button type="button" className="md-link-btn" disabled={disabled || busy || attachments.length + extraMaterials.length >= MAX_MATERIALS} onClick={() => input.current?.click()}>{busy ? t('正在上传…') : t('加附件')}</button>
          <button type="button" className="md-link-btn" aria-expanded={paste} onClick={() => setPaste(value => !value)}>{paste ? t('收起路径') : t('贴本机路径')}</button>
          <input ref={input} type="file" hidden multiple onChange={(e) => {
            const list = e.target.files
            e.target.value = ''
            uploadFiles(list)
          }} />
        </div>
        {paste ? (
          <div className="md-materials-paste">
            <textarea rows={3} value={paths} onChange={e => setPaths(e.target.value)} placeholder={t('一行一个文件路径，比如 /Users/你/Documents/笔记.md')} aria-label={t('素材文件路径')} />
            <button type="button" className="md-btn is-small" disabled={busy || !paths.trim()} onClick={() => addLines(paths.split(/\n+/).map(row => row.trim()).filter(Boolean))}>{t('读进来')}</button>
          </div>
        ) : null}
        {note ? <span className="md-prop-note is-error">{note}</span> : null}
      </div>
    </Prop>
  )
}

// 工作流探测的结果按路径、勾选和目标平台缓存一份：一次会话里同一份设置不重复扫盘
const flowCache = new Map()
function useFlowPreview(paths, selected, target) {
  const key = JSON.stringify([paths ?? [], selected ?? null, target ?? null])
  const [rows, setRows] = React.useState(() => flowCache.get(key) ?? null)
  React.useEffect(() => {
    const cached = flowCache.get(key)
    if (cached) {
      setRows(cached)
      return undefined
    }
    let live = true
    scanWritingFlow({ paths, selected: selected ?? null, target }).then((found) => {
      if (!found.error) flowCache.set(key, found)
      if (live) setRows(found)
    })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return rows
}

/** 成稿前一行说清楚这次会用到什么：灵感本身、几份素材多少字、几份工作流。 */
function SourcesPreview({ item, goal }) {
  const settings = useDesk(s => s.settings)
  const paths = settings?.writingFlow?.paths ?? []
  const target = goal === 'xhs' ? 'xhs' : goal === 'script' ? 'script' : 'article'
  const found = useFlowPreview(paths, settings?.writingFlow?.selected ?? null, target)
  const rows = (item.materials ?? []).filter(row => !row.error)
  const chars = rows.reduce((sum, row) => sum + (row.chars || 0), 0)
  // 工作流按勾选算份数；还没探测完就先不写数字，免得写下 0 又跳
  const on = found?.docs ? found.docs.filter(row => row.on).length : null
  return (
    <p className="md-idea-hint md-sources-preview">
      {t('这次会用到：灵感 1 条 · 素材 {n} 份（共 {chars} 字）{flow}', { n: rows.length, chars, flow: on === null ? '' : t(' · 工作流 {k} 份', { k: on }) })}
      {!paths.length && found?.docs && !on ? <button type="button" onClick={() => setDesk({ settingsOpen: true })}>{t('去设置写作工作流')}</button> : null}
    </p>
  )
}

/** 成稿后的章节大纲：填补左栏留白，点击直达右侧正文或长文预览的对应章节。 */
function ArticleOutline({ article }) {
  const headings = React.useMemo(() => {
    const lines = String(article ?? '').replace(/\r\n?/g, '\n').split('\n')
    const out = []
    let inFence = false
    lines.forEach((line, index) => {
      if (/^\s*(`{3,}|~{3,})/.test(line)) { inFence = !inFence; return }
      if (inFence) return
      const m = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line)
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`~=]/g, '').trim(), line: index })
    })
    return out
  }, [article])
  if (headings.length < 2) return null
  const jumpTo = (row) => {
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    // 先找正文格或长文预览里的标题节点
    const scroller = document.querySelector('.md-studio .md-article-scroll, .md-studio .md-layout-scroll')
    if (scroller) {
      const nodes = [...scroller.querySelectorAll('h2, h3')]
      const target = nodes.find(el => el.textContent.replace(/\s+/g, '') === row.text.replace(/\s+/g, ''))
      if (target) {
        const box = scroller.getBoundingClientRect()
        const rect = target.getBoundingClientRect()
        scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + rect.top - box.top - 24), behavior })
        return
      }
    }
    // 如果当前在图文卡片全览或分栏源码里，滚到带对应行号的块
    const block = document.querySelector(`.md-studio [data-line="${row.line}"]`)
    block?.scrollIntoView({ block: 'center', behavior })
  }
  return (
    <details className="md-idea-more md-outline-box" open>
      <summary>{t('章节大纲')}<span>{headings.length}</span></summary>
      <ol className="md-outline-list">
        {headings.map((h, i) => (
          <li key={`${h.line}:${i}`} className={`is-h${h.level}`}>
            <button type="button" onClick={() => jumpTo(h)} title={h.text}>{h.text}</button>
          </li>
        ))}
      </ol>
    </details>
  )
}

const TONE_MODES = [
  { value: 'auto', label: '自动判断' },
  { value: 'A', label: 'A · 争议判断' },
  { value: 'B', label: 'B · 故事吐槽' },
  { value: 'C', label: 'C · 教程路径' },
  { value: 'D', label: 'D · 真诚分享' },
]

const TONE_AUDIENCES = [
  { value: 'auto', label: '自动匹配' },
  { value: 'user', label: '普通 AI 用户' },
  { value: 'builder', label: 'OPC 与 Builder' },
  { value: 'dev', label: '技术开发者' },
]

export function IdeaCard({ item, live, settings }) {
  const production = item.production
  const running = production?.status === 'running'
  const done = production?.status === 'done'
  const styles = useDesk(s => s.state.styles ?? [])
  const activeId = useDesk(s => s.state.activeStyleId)
  const hasChat = useDesk(s => s.state.chat.some(m => m.itemId === item.id))
  const [draw, setDraw] = React.useState(null)
  const [goal, setGoal] = React.useState(item.creation?.goal ?? 'xhs')
  const [mode, setMode] = React.useState(item.creation?.mode ?? 'auto')
  const [audience, setAudience] = React.useState(item.creation?.audience ?? 'auto')
  const [thesis, setThesis] = React.useState(item.creation?.thesis ?? '')
  const [starting, setStarting] = React.useState(false)
  React.useEffect(() => {
    setDraw(null)
    setGoal(item.creation?.goal ?? 'xhs')
    setMode(item.creation?.mode ?? 'auto')
    setAudience(item.creation?.audience ?? 'auto')
    setThesis(item.creation?.thesis ?? '')
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveBrief = (patch) => {
    if (running) return
    dispatchOps([{ op: 'set_creation', id: item.id, goal, mode, audience, thesis, ...patch }], { label: t('已保存创作进度'), silent: true })
  }

  const start = async () => {
    setStarting(true)
    try {
      await runProduce(item.id, { withImages: goal === 'xhs' ? false : withImages, goal, mode, audience, thesis })
    } finally { setStarting(false) }
  }
  // 单次选择优先，其次沿用这条上次的选择，最后取设置里的默认值；没接生图模型时默认不勾
  const imageReady = Boolean(settings?.imageReady)
  const withImages = draw ?? (!imageReady ? false : production?.withImages !== undefined ? production.withImages : settings?.generateImages !== false)
  const canStart = !production || !['running', 'done'].includes(production.status)
  const activeStyleName = styles.find(s => s.id === activeId)?.name ?? t('默认风格')
  const fileCount = new Set([...(item.attachments ?? []).map(a => a.name), ...(item.materials ?? []).map(m => m.name)]).size

  return (
    <section className={`md-idea-card ${running ? 'is-running' : ''} ${done || hasChat ? 'is-compact' : ''}`} aria-label={t('灵感')}>
      <span className="md-idea-label">
        {t('灵感')}<i aria-hidden="true" />{fmtDate(item.createdAt)}
        <span className={`md-idea-state ${running ? 'is-running' : done ? 'is-done' : ''}`}>
          {running ? t('正在成稿') : done ? t('已成稿') : t('待成稿')}
        </span>
      </span>
      <AutoText className="md-idea-text" label={t('灵感')} value={item.title} disabled={running} onCommit={title => dispatchOps([{ op: 'update_item', id: item.id, title }], { label: t('修改灵感'), silent: true })} />
      {!done ? <IdeaBody item={item} disabled={running} /> : null}

      {(item.attachments ?? []).length > 0 ? (
        <div className="md-idea-att-chips">
          {item.attachments.map(att => (
            <span key={att.id} className="md-att-chip" title={att.name}>
              <Icon name={att.mime?.startsWith('image/') ? 'image' : 'fileText'} size={11} />
              <span>{att.name}</span>
              {!running ? (
                <button type="button" aria-label={t('移除附件')} onClick={() => dispatchOps([{ op: 'remove_attachment', id: item.id, attachmentId: att.id }], { label: t('移除附件'), silent: true })}>
                  <Icon name="close" size={10} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {running ? (
        <ProgressCard
          production={{ ...production, id: item.id }}
          live={live}
          settings={settings}
          goal={goal}
          mode={mode}
          activeStyleName={activeStyleName}
          fileCount={fileCount}
        />
      ) : null}

      {canStart ? (
        <>
          <div className="md-go-row">
            <button type="button" className="md-go" disabled={starting} onClick={start}><Icon name="spark" size={15} />{t(starting ? '正在开始…' : goal === 'xhs' ? '生成小红书图文' : goal === 'script' ? '生成口播稿' : '一键成稿')}</button>
            {goal !== 'xhs' ? <label className="md-go-option">
              <input type="checkbox" checked={withImages} onChange={e => setDraw(e.target.checked)} />
              {t('生成图片')}
            </label> : null}
          </div>
          <div className="md-tone-bar" aria-label={t('写作定调')}>
            <div className="md-tone-selects">
              <label className="md-output-choice">
                <span>{t('生成内容')}</span>
                <select aria-label={t('生成内容')} value={goal} disabled={starting || running} onChange={(e) => { const next = e.target.value; setGoal(next); saveBrief({ goal: next }) }}>
                  <option value="xhs">{t('小红书图文卡片')}</option>
                  <option value="article">{t('文章')}</option>
                  <option value="script">{t('口播稿')}</option>
                </select>
              </label>
              <label className="md-output-choice">
                <span>{t('内容模式')}</span>
                <select aria-label={t('内容模式')} value={mode} disabled={starting || running} onChange={(e) => { const next = e.target.value; setMode(next); saveBrief({ mode: next }) }}>
                  {TONE_MODES.map(opt => <option key={opt.value} value={opt.value}>{t(opt.label)}</option>)}
                </select>
              </label>
              <label className="md-output-choice">
                <span>{t('面向谁')}</span>
                <select aria-label={t('面向谁')} value={TONE_AUDIENCES.some(o => o.value === audience) ? audience : 'auto'} disabled={starting || running} onChange={(e) => { const next = e.target.value; setAudience(next); saveBrief({ audience: next }) }}>
                  {TONE_AUDIENCES.map(opt => <option key={opt.value} value={opt.value}>{t(opt.label)}</option>)}
                </select>
              </label>
            </div>
            <input
              type="text"
              className="md-thesis-input"
              value={thesis}
              disabled={starting || running}
              onChange={e => setThesis(e.target.value)}
              onBlur={() => { if (thesis !== (item.creation?.thesis ?? '')) saveBrief({ thesis }) }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !starting) { e.preventDefault(); start() } }}
              placeholder={t('选填：甩一句你最真实的判断、槽点或踩坑结论，整篇顺着这个劲写')}
              aria-label={t('一句话核心判断')}
            />
          </div>
        </>
      ) : null}

      <details className="md-idea-more" open={canStart && !hasChat ? true : undefined}>
        <summary>{t('风格与附件')}{` · ${activeStyleName}${fileCount ? ` · ${t('{n} 份资料', { n: fileCount })}` : ''}`}</summary>
        <dl className="md-props">
          <Prop label={t('风格')}>
            <StylePicker styles={styles} value={activeId ?? null} label={t('风格')} onChange={id => !running && dispatchOps([{ op: 'set_style', id }], { label: t('切换风格'), silent: true })} />
          </Prop>
          <MaterialsProp item={item} disabled={running} />
          {done && production.flow ? <FlowProps flow={production.flow} /> : null}
        </dl>
        {!running ? <details className="md-idea-more"><summary>{t('选题评分（可选）')}</summary><Scorecard key={item.id} item={item} /></details> : null}
      </details>

      {done && !running ? <ArticleOutline article={production?.article} /> : null}
      {production?.status === 'failed' ? <p className="md-idea-hint is-error">{production.error}</p> : null}
      {canStart && !withImages && imageReady ? <p className="md-idea-hint">{t('这次只出文字版，之后仍可以单张补画。')}</p> : null}
      {canStart && !imageReady && withImages ? <p className="md-idea-hint">{t('还没接生图模型，这次画不了图，只出文字。')}<button type="button" onClick={() => setDesk({ settingsOpen: true })}>{t('去接入')}</button></p> : null}
      {canStart && !hasChat ? <SourcesPreview item={item} goal={goal} /> : null}
      {production?.notice ? <p className="md-idea-hint">{production.notice}</p> : null}
    </section>
  )
}
