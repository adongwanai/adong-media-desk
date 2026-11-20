// 对话栏顶部的灵感卡：这条灵感本身，加一张属性表（体裁、风格、素材、成稿过程），以及唯一的入口「一键成稿」。
import React from 'react'
import { addMaterials, cancelProduce, dispatchOps, readPickedMaterials, removeMaterial, runProduce, scanWritingFlow, setDesk, toast, useDesk } from './desk.js'
import { plural, t } from './i18n.js'
import { Scorecard } from './scorecard.jsx'
import { StylePicker } from './style-picker.jsx'
import { AutoText, isBusy } from './studio-kit.jsx'
import { Icon } from './ui.jsx'
import { fmtDate, textLength } from './util.js'
import { MAX_MATERIALS } from '../src/material-limits.js'

/** 进度：放在对话栏里，像助手在汇报。 */
function ProgressCard({ production, live, settings }) {
  const running = production.status === 'running'
  if (production.engine === 'dsh-native') return <div className="md-progress"><p>DSH 原生 Agent · {live?.text ? `正在写 ${textLength(live.text)} 字` : '正在处理选题'}</p><button type="button" className="md-inline-link" onClick={() => cancelProduce(production.id)}>{t('取消')}</button></div>
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

/** 这条灵感带的素材文件：只显示名字和字数，点开才铺开；一次加不了全部内容，正文不进这一栏。 */
function MaterialsProp({ item, disabled }) {
  const rows = item.materials ?? []
  const [busy, setBusy] = React.useState(false)
  const [paths, setPaths] = React.useState('')
  const [paste, setPaste] = React.useState(false)
  const [note, setNote] = React.useState(null)
  const input = React.useRef(null)
  React.useEffect(() => { setPaths(''); setPaste(false); setNote(null) }, [item.id])
  const total = rows.reduce((sum, row) => sum + (row.chars || 0), 0)
  const add = async ({ files = [], lines = [] }) => {
    setBusy(true)
    const result = await addMaterials(item.id, { files, paths: lines })
    setBusy(false)
    if (!result) return
    if (result.errors?.length) setNote(result.errors.map(row => `${row.name}：${row.reason}`).join('；'))
    else setNote(null)
    if (result.added?.length) toast(t('加了 {n} 份素材', { n: result.added.length }), { undo: true })
    setPaths('')
  }
  return (
    <Prop label={t('素材')}>
      <div className="md-materials">
        {rows.length ? (
          <ul className="md-materials-list">
            {rows.map(row => (
              <li key={row.id} className={row.error ? 'is-error' : ''} title={[row.path || row.name, row.file ? t('超过 2 万字的部分存在工作台的文件目录里，成稿时读全文') : ''].filter(Boolean).join('\n')}>
                <Icon name="fileText" size={12} />
                <span className="md-materials-name">{row.name}</span>
                <span className="md-materials-chars">{row.error ? row.error : t('{n} 字', { n: row.chars })}</span>
                <button type="button" className="md-inline-link" aria-label={t('删掉这份素材')} disabled={disabled || busy} onClick={() => removeMaterial(item.id, row.id)}><Icon name="close" size={12} /></button>
              </li>
            ))}
          </ul>
        ) : <span className="md-prop-note">{t('还没有素材。加几份自己的文件，成稿时当成事实来源。')}</span>}
        {rows.length ? <span className="md-prop-note">{t('共 {n} 份，{chars} 字；成稿时按字数上限挑相关的用。', { n: rows.length, chars: total })}</span> : null}
        <div className="md-materials-acts">
          <button type="button" className="md-link-btn" disabled={disabled || busy || rows.length >= MAX_MATERIALS} onClick={() => input.current?.click()}>{busy ? t('正在读…') : t('加素材文件')}</button>
          <button type="button" className="md-link-btn" aria-expanded={paste} onClick={() => setPaste(value => !value)}>{paste ? t('收起路径') : t('贴路径')}</button>
          <input ref={input} type="file" hidden multiple accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={async (e) => {
            const list = e.target.files
            e.target.value = ''
            const picked = await readPickedMaterials(list, total)
            if (picked.errors.length) setNote(picked.errors.map(row => `${row.name}：${row.reason}`).join('；'))
            if (picked.files.length) await add({ files: picked.files })
          }} />
        </div>
        {paste ? (
          <div className="md-materials-paste">
            <textarea rows={3} value={paths} onChange={e => setPaths(e.target.value)} placeholder={t('一行一个文件路径，比如 /Users/你/Documents/笔记.md')} aria-label={t('素材文件路径')} />
            <button type="button" className="md-btn is-small" disabled={busy || !paths.trim()} onClick={() => add({ lines: paths.split(/\n+/).map(row => row.trim()).filter(Boolean) })}>{t('读进来')}</button>
          </div>
        ) : null}
        {note ? <span className="md-prop-note is-error">{note}</span> : null}
      </div>
    </Prop>
  )
}

// 工作流探测的结果按路径和勾选缓存一份：一次会话里同一份设置不重复扫盘
const flowCache = new Map()
function useFlowPreview(paths, selected) {
  const key = JSON.stringify([paths ?? [], selected ?? null])
  const [rows, setRows] = React.useState(() => flowCache.get(key) ?? null)
  React.useEffect(() => {
    const cached = flowCache.get(key)
    if (cached) {
      setRows(cached)
      return undefined
    }
    let live = true
    scanWritingFlow({ paths, selected: selected ?? null }).then((found) => {
      if (!found.error) flowCache.set(key, found)
      if (live) setRows(found)
    })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return rows
}

/** 成稿前一行说清楚这次会用到什么：灵感本身、几份素材多少字、几份工作流。 */
function SourcesPreview({ item }) {
  const settings = useDesk(s => s.settings)
  const paths = settings?.writingFlow?.paths ?? []
  const found = useFlowPreview(paths, settings?.writingFlow?.selected ?? null)
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

export function IdeaCard({ item, live, settings }) {
  const production = item.production
  const running = production?.status === 'running'
  const done = production?.status === 'done'
  const styles = useDesk(s => s.state.styles ?? [])
  const activeId = useDesk(s => s.state.activeStyleId)
  const [draw, setDraw] = React.useState(null)
  const [goal, setGoal] = React.useState(item.creation?.goal ?? 'xhs')
  const [starting, setStarting] = React.useState(false)
  const start = async () => {
    setStarting(true)
    try { await runProduce(item.id, { withImages: goal === 'xhs' ? false : withImages, goal }) } finally { setStarting(false) }
  }
  React.useEffect(() => setDraw(null), [item.id])
  // 单次选择优先，其次沿用这条上次的选择，最后取设置里的默认值；没接生图模型时默认不勾
  const imageReady = Boolean(settings?.imageReady)
  const withImages = draw ?? (!imageReady ? false : production?.withImages !== undefined ? production.withImages : settings?.generateImages !== false)
  const canStart = !production || !['running', 'done'].includes(production.status)
  return (
    <section className="md-idea-card" aria-label={t('灵感')}>
      <span className="md-idea-label">{t('灵感')}<i aria-hidden="true" />{fmtDate(item.createdAt)}</span>
      <AutoText className="md-idea-text" label={t('灵感')} value={item.title} disabled={running} onCommit={title => dispatchOps([{ op: 'update_item', id: item.id, title }], { label: t('修改灵感'), silent: true })} />
      <IdeaBody item={item} disabled={running} />

      {canStart ? (
        <div className="md-go-row">
          <button type="button" className="md-go" disabled={starting} onClick={start}><Icon name="spark" size={15} />{t(starting ? '正在开始…' : goal === 'xhs' ? '生成小红书图文' : goal === 'script' ? '生成口播稿' : '一键成稿')}</button>
          {goal !== 'xhs' ? <label className="md-go-option">
            <input type="checkbox" checked={withImages} onChange={e => setDraw(e.target.checked)} />
            {t('生成图片')}
          </label> : null}
        </div>
      ) : null}
      {canStart ? <label className="md-output-choice">{t('生成内容')}<select aria-label={t('生成内容')} value={goal} disabled={starting || running} onChange={event => setGoal(event.target.value)}><option value="xhs">{t('小红书图文卡片')}</option><option value="article">{t('文章')}</option><option value="script">{t('口播稿')}</option></select></label> : null}

      <details className="md-idea-more"><summary>{t('选题评分（可选）')}</summary><Scorecard key={item.id} item={item} /></details>
      {!running ? (
        <dl className="md-props">
          <Prop label={t('风格')}>
            <StylePicker styles={styles} value={activeId ?? null} label={t('风格')} onChange={id => dispatchOps([{ op: 'set_style', id }], { label: t('切换风格'), silent: true })} />
          </Prop>
          <MaterialsProp item={item} disabled={running} />
          {done && production.flow ? <FlowProps flow={production.flow} /> : null}
        </dl>
      ) : null}
      {running ? <ProgressCard production={{ ...production, id: item.id }} live={live} settings={settings} /> : null}
      {production?.status === 'failed' ? <p className="md-idea-hint is-error">{production.error}</p> : null}
      {canStart && !withImages && imageReady ? <p className="md-idea-hint">{t('这次只出文字版，之后仍可以单张补画。')}</p> : null}
      {/* 没接生图模型时右边已经有一行说明；这里只在勾了「生成图片」时再说清楚这次画不了，不悄悄跳过 */}
      {canStart && !imageReady && withImages ? <p className="md-idea-hint">{t('还没接生图模型，这次画不了图，只出文字。')}<button type="button" onClick={() => setDesk({ settingsOpen: true })}>{t('去接入')}</button></p> : null}
      {canStart ? <SourcesPreview item={item} /> : null}
      {production?.notice ? <p className="md-idea-hint">{production.notice}</p> : null}
    </section>
  )
}
