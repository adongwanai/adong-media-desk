// 点开灵感后的工作区：左边对话，右边是一张稿面。稿面的格子一开始就排好，同时开工，一点点长满。
import React from 'react'
import { creationFormat } from '../src/creation.js'
import { SpokenContent } from './spoken.jsx'
import { ArticleTile } from './article.jsx'
import { IdeaCard } from './brief.jsx'
import { ChatPanel } from './chat.jsx'
import { downloadCover } from './cover.js'
import { closeItem, dispatchOps, getDesk, regenAsset, revealSaved, runProduce, saveProduced, setDesk, toast, useDesk, watchProduction } from './desk.js'
import { ClaimsBar } from './claims.jsx'
import { plural, t } from './i18n.js'
import { markdownPlain } from './md-render.js'
import { AutoText, Plate, askAbout, isBusy, unescapeJson } from './studio-kit.jsx'
import { Icon, IconButton, Segmented, Swap } from './ui.jsx'
import { LayoutPreview } from './layouts/preview.jsx'
import { clampRate, DEFAULT_RATE, scriptOf } from './video/captions.js'
import { CutTab } from './video/cut.jsx'
import { FinishTab } from './video/finish.jsx'
import { readPref } from './video/prompter.js'
import { RecordTab } from './video/record.jsx'
import { TitleButton, TitlePickerLayer, VersionsView } from './versions.jsx'
import { SPRING_SNAP, SPRING_SOFT, fmtDate, fmtWhen, reducedMotion, textLength, toLocalInput } from './util.js'

/** 视频封面：画面叠大字。没有画面时是一张渐变的纯文字封面。 */
function Poster({ production, item, onOpen, onRetry }) {
  const src = production?.cover?.src ?? (!production ? item.media?.poster ?? (item.media?.src && item.kind !== 'video' ? item.media.src : null) : null)
  const text = production?.stage === 'brief' ? '' : production?.coverText || production?.title || ''
  const status = production?.cover?.status ?? 'idle'
  return (
    <div className={`md-poster ${src ? '' : 'is-type'}`} data-status={status} onClick={production?.cover?.src ? onOpen : undefined} role={production?.cover?.src ? 'button' : undefined}>
      {src ? <img key={src} src={src} alt={t('视频封面')} draggable={false} /> : null}
      {text ? <b>{text}</b> : null}
      {onRetry && ['failed', 'skipped'].includes(status) ? <button type="button" className="md-plate-failed" title={production?.cover?.error} onClick={(event) => { event.stopPropagation(); onRetry() }}><Icon name="refresh" size={12} />{status === 'failed' ? t('封面没画成，重画') : t('画封面')}</button> : null}
    </div>
  )
}

function Stat({ icon, value, unit }) {
  return <span className="md-hero-stat"><Icon name={icon} size={13} /><b>{value}</b>{unit}</span>
}

/** 这篇是文章还是脚本：写过的看它自己的体裁，没写的看当前选的。文章不出分镜。 */
function useIsArticle(production, item) {
  return (production?.format ?? creationFormat(item, 'article')) === 'article'
}

/** 没接生图模型时，封面和配图的位置只放一行平静的说明，不摆空图框。 */
function NoImageLine() {
  return (
    <p className="md-hero-noimg">
      <Icon name="image" size={13} />
      <span>{t('还没接生图模型')}</span>
      <span aria-hidden="true">·</span>
      <button type="button" className="md-inline-link" onClick={() => setDesk({ settingsOpen: true })}>{t('去接入')}</button>
    </p>
  )
}

function baseName(path) {
  return String(path ?? '').split(/[\\/]/).filter(Boolean).slice(-2).join('/')
}

/** 标题上方的一行小字：这篇从哪来、什么时候成的稿。 */
function heroKicker(item, production) {
  if (!production) return { icon: 'spark', text: t('还没成稿') }
  if (production.status === 'running') return { icon: 'spark', text: t('正在成稿') }
  if (production.importedFrom) return { icon: 'fileText', text: t('导入自 {file}', { file: baseName(production.importedFrom) }), title: production.importedFrom }
  const name = production.format === 'article' ? t('文章') : t('脚本')
  const at = production.finishedAt ?? production.startedAt
  return { icon: 'pen', text: at ? `${name} · ${fmtDate(at)}` : name }
}

/** 主视觉：渐变底、大标题、数字，右边是视频封面和配图的拼贴。没有画出来的封面和配图时收成一条紧凑的标题栏。 */
function HeroTile({ item, live, onView, compact }) {
  const settings = useDesk(s => s.settings)
  const production = item.production
  const isArticle = useIsArticle(production, item)
  const running = production?.status === 'running'
  const liveTitle = production?.stage === 'brief' && live?.title ? unescapeJson(live.title) : null
  const title = liveTitle ?? production?.title ?? item.title
  const source = production?.article || live?.text || ''
  const words = React.useMemo(() => textLength(markdownPlain(source)), [source])
  // 分镜只属于脚本：文章不显示镜数和秒数
  const shots = isArticle ? [] : production?.shots ?? []
  const seconds = shots.reduce((sum, shot) => sum + (shot.seconds ?? 0), 0)
  const images = production?.images ?? []
  const done = production?.status === 'done'
  const pictures = [production?.cover, ...images].filter(a => a?.src).length
  const showFigures = pictures > 0 || (production?.engine !== 'dsh-native' && settings?.imageReady && production?.withImages !== false)
  // 没接生图模型、也还没有任何画好的图：用一行说明代替空图框，不悄悄跳过
  const noImages = !settings?.imageReady && !pictures
  const [saving, setSaving] = React.useState(false)
  const kicker = heroKicker(item, production)
  const copy = async () => {
    await navigator.clipboard.writeText(`# ${production.title}\n\n${production.article}`)
    toast(production.format === 'article' ? t('正文已复制') : t('脚本已复制'))
  }
  const save = async () => {
    setSaving(true)
    await saveProduced(item.id)
    setSaving(false)
  }
  const again = () => setDesk({
    dialog: {
      title: t('重新成稿'),
      submitLabel: t('重新生成'),
      initial: { withImages: Boolean(settings?.imageReady) && production?.withImages !== false },
      fields: [
        { name: 'note', label: isArticle ? t('现在的正文、封面和配图会被替换，也会再消耗一次模型额度。') : t('现在的脚本、封面和分镜会被替换，也会再消耗一次模型额度。'), type: 'hidden' },
        ...(settings?.imageReady ? [{ name: 'withImages', label: isArticle ? t('同时生成封面和配图') : t('同时生成封面、配图和分镜图'), type: 'checkbox' }] : []),
      ],
      onSubmit: values => runProduce(item.id, { withImages: Boolean(settings?.imageReady) && values.withImages !== false }),
    },
  })
  const figures = images.length ? images : [null, null].slice(0, settings?.imageCount ?? 2)
  // 有封面字或封面计划时，才能下载一张纯文字封面
  const canCover = Boolean(production?.cover?.src || production?.coverText)
  const canDrawCover = compact && settings?.imageReady && production?.cover && !isBusy(production.cover)
  return (
    <section className={`md-tile md-tile-hero ${running ? 'is-running' : ''} ${compact || noImages ? 'is-compact' : ''}`}>
      {/* 顶行横跨整格：左边是来源，右边是操作图标，不压在封面拼贴上 */}
      <div className="md-hero-top">
        <span className="md-hero-kicker" title={kicker.title}><Icon name={kicker.icon} size={13} /><span>{kicker.text}</span></span>
        <span className="md-grow" />
        <div className="md-hero-corner">
          {production?.savedAt ? <IconButton icon="folder" label={t('打开保存的文件夹')} onClick={() => revealSaved(item.id)} /> : null}
          {done ? <IconButton icon="refresh" label={t('重新成稿')} onClick={again} /> : null}
          <IconButton icon="gear" label={t('设置')} onClick={() => setDesk({ settingsOpen: true })} />
          <IconButton icon="trash" label={t('删除这条灵感')} onClick={() => {
            dispatchOps([{ op: 'delete_item', id: item.id }], { label: t('删除《{title}》', { title: item.title.slice(0, 10) }) })
            closeItem()
          }} />
        </div>
      </div>
      <div className="md-hero-body">
        <div className="md-hero-copy">
          <AutoText className={`md-hero-title ${production ? '' : 'is-idle'}`} label={t('标题')} value={title} disabled={!done} onCommit={next => dispatchOps([{ op: 'update_production', id: item.id, title: next }], { label: t('修改标题'), silent: true })} />
          <div className="md-hero-stats">
            {words ? <Stat icon="pen" value={words.toLocaleString()} unit={t('字', { s: plural(words, '', 's') })} /> : null}
            {shots.length ? <Stat icon="film" value={shots.length} unit={t('镜', { s: plural(shots.length, '', 's') })} /> : null}
            {seconds ? <Stat icon="clock" value={seconds} unit={t('秒')} /> : null}
            {pictures ? <Stat icon="image" value={pictures} unit={t('张图', { s: plural(pictures, '', 's') })} /> : null}
          </div>
          {noImages ? <NoImageLine /> : null}
          {done ? (
            <div className="md-hero-actions">
              <button type="button" className="md-pill is-primary" onClick={copy}><Icon name="copy" size={14} />{production?.format === 'article' ? t('复制正文') : t('复制脚本')}</button>
              <button type="button" className="md-pill" onClick={save} disabled={saving}><Icon name="save" size={14} /><Swap labels={[t('保存'), t('保存中…')]} at={saving ? 1 : 0} /></button>
              {canCover ? <button type="button" className="md-pill" onClick={() => downloadCover({ src: production.cover?.src, text: production.coverText || production.title }, production.title).catch(err => toast(err.message, { error: true }))}><Icon name="image" size={14} />{t('下载封面')}</button> : null}
              {canDrawCover ? <button type="button" className="md-pill" onClick={() => regenAsset(item.id, 'cover')}><Icon name="spark" size={14} />{t('画封面')}</button> : null}
              <TitleButton item={item} />
              <label className="md-pill md-date-pill">
                <Icon name="calendar" size={14} />{item.scheduledAt ? fmtWhen(item.scheduledAt) : t('排期')}
                <input type="datetime-local" aria-label={t('排期')} value={toLocalInput(item.scheduledAt)} onClick={(event) => { try { event.currentTarget.showPicker() } catch { /* 不支持时用原生交互 */ } }} onChange={(event) => {
                  const when = event.target.value ? new Date(event.target.value).toISOString() : null
                  dispatchOps([{ op: 'schedule_item', id: item.id, scheduledAt: when }], { label: t('修改排期'), silent: true })
                }} />
              </label>
            </div>
          ) : null}
        </div>
        {compact || noImages ? null : (
          <div className="md-collage">
            <div className="md-collage-main"><Poster production={production} item={item} onOpen={() => onView('cover')} onRetry={settings?.imageReady && production?.status === 'done' && production.cover ? () => regenAsset(item.id, 'cover') : undefined} /></div>
            {showFigures ? figures.map((image, i) => <div key={i} className={`md-collage-side is-${i}`}><Plate asset={image} alt={image?.caption ?? t('配图 {n}', { n: i + 1 })} onOpen={image?.src ? () => onView(`image:${i}`) : undefined} onRetry={image && settings?.imageReady && production?.status === 'done' ? () => regenAsset(item.id, `image:${i}`) : undefined} /></div>) : null}
          </div>
        )}
      </div>
    </section>
  )
}

function ShotsTile({ item, live, count, open, onToggle, onView }) {
  const imageReady = useDesk(s => s.settings?.imageReady)
  const shots = item.production?.shots ?? []
  const visuals = live?.visuals ?? []
  // 策划案还在写的时候，分镜说明已经一格一格出现了
  const cells = shots.length ? shots : Array.from({ length: count }, (_, i) => ({ no: i + 1, visual: visuals[i] ? unescapeJson(visuals[i]) : '', status: item.production?.status === 'running' ? 'pending' : 'idle' }))
  const copy = async () => {
    const table = shots.map((s, i) => t('{no}. {shot}｜{sec} 秒\n画面：{visual}\n口播：{voice}', { no: i + 1, shot: t(s.shot), sec: s.seconds, visual: s.visual, voice: s.voice })).join('\n\n')
    await navigator.clipboard.writeText(table)
    toast(t('分镜脚本已复制'))
  }
  const total = shots.reduce((sum, shot) => sum + (shot.seconds ?? 0), 0)
  return (
    <>
      <header className="md-tile-head">
        <h2>{t('分镜头脚本')}</h2>
        {total ? <span className="md-tile-meta">{t('约 {n} 秒', { n: total })}</span> : null}
        <span className="md-grow" />
        {shots.length ? (
          <>
            <IconButton icon="copy" label={t('复制分镜脚本')} onClick={copy} />
            <IconButton icon={open ? 'shrink' : 'expand'} label={open ? t('收起') : t('放大')} onClick={onToggle} />
          </>
        ) : null}
      </header>
      <div className="md-shots" style={{ '--rows2': Math.ceil(cells.length / 2), '--rows3': Math.ceil(cells.length / 3) }}>
        {cells.map((shot, index) => (
          <figure key={index} className="md-shot">
            <Plate asset={shot} paper alt={shot.visual} mark={String(shot.no ?? index + 1).padStart(2, '0')} onOpen={shot.src ? () => onView(`shot:${index}`) : undefined} onRetry={imageReady && item.production?.status === 'done' && shot.prompt !== undefined ? () => regenAsset(item.id, `shot:${index}`) : undefined} />
            {shot.shot || shot.voice || shot.visual ? (
              <figcaption>
                <span className="md-shot-meta"><b>{String(shot.no ?? index + 1).padStart(2, '0')}</b>{shot.shot ? ` ${t(shot.shot)} · ${t('{n} 秒', { n: shot.seconds })}` : ''}</span>
                <p>{shot.voice || shot.visual}</p>
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </>
  )
}

function assetList(production) {
  return [
    ...(production?.cover?.src || production?.cover ? [{ target: 'cover', asset: production.cover, label: t('视频封面') }] : []),
    ...(production?.images ?? []).map((asset, i) => ({ target: `image:${i}`, asset, label: t('配图 {n}', { n: i + 1 }), note: asset.caption })),
    ...(production?.shots ?? []).map((asset, i) => ({ target: `shot:${i}`, asset, label: t('第 {n} 镜', { n: i + 1 }), note: [asset.visual, asset.voice].filter(Boolean).join(' · '), paper: true })),
  ]
}

/** 查看大图：左右键切换，可以重画、下载，或者让助手改。 */
function Viewer({ item, target, onChange, onClose }) {
  const imageReady = useDesk(s => s.settings?.imageReady)
  const list = assetList(item.production).filter(row => row.asset?.src || isBusy(row.asset))
  const index = Math.max(0, list.findIndex(row => row.target === target))
  const current = list[index]
  const ref = React.useRef(null)
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'ArrowRight' && list[index + 1]) onChange(list[index + 1].target)
      if (event.key === 'ArrowLeft' && list[index - 1]) onChange(list[index - 1].target)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, list, onChange, onClose])
  React.useLayoutEffect(() => {
    if (reducedMotion()) return
    ref.current?.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: SPRING_SNAP.duration, easing: SPRING_SNAP.easing })
  }, [])
  if (!current) return null
  return (
    <div className="md-viewer" role="dialog" aria-label={current.label} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="md-viewer-card" ref={ref}>
        <div className={`md-viewer-image ${current.paper ? 'is-paper' : ''}`}>
          {current.asset.src ? <img key={current.asset.src} src={current.asset.src} alt={current.label} /> : null}
          {isBusy(current.asset) ? <span className="md-viewer-busy"><span className="md-shimmer">{t('正在重画…')}</span></span> : null}
        </div>
        <footer>
          <div className="md-viewer-text"><b>{current.label}</b>{current.note ? <span>{current.note}</span> : null}</div>
          <IconButton icon="chevL" label={t('上一张')} disabled={!list[index - 1]} onClick={() => list[index - 1] && onChange(list[index - 1].target)} />
          <IconButton icon="chevR" label={t('下一张')} disabled={!list[index + 1]} onClick={() => list[index + 1] && onChange(list[index + 1].target)} />
          <button type="button" className="md-pill" onClick={() => { askAbout(current.label); onClose() }}><Icon name="chat" size={13} />{t('让助手改')}</button>
          {imageReady ? <button type="button" className="md-pill" disabled={isBusy(current.asset)} onClick={() => regenAsset(item.id, current.target)}><Icon name="refresh" size={13} />{t('重画')}</button> : null}
          {current.asset.src ? <a className="md-pill" href={current.asset.src} download><Icon name="save" size={13} />{t('下载')}</a> : null}
          <IconButton icon="close" label={t('关闭')} onClick={onClose} />
        </footer>
      </div>
    </div>
  )
}

// 稿面的并列同级视图：正文、长文、图文卡片、口播内容、视频录剪、平台版本
const SHEET_VIEWS = [
  { value: 'draft', label: '正文', icon: 'fileText' },
  { value: 'wechat', label: '长文', icon: 'book' },
  { value: 'xhs', label: '图文卡片', icon: 'wall' },
  { value: 'spoken', label: '口播内容', icon: 'chat' },
  { value: 'video', label: '视频录剪', icon: 'film' },
  { value: 'versions', label: '平台版本', icon: 'branch' },
]

function defaultSheetLayout(item) {
  const goal = item?.creation?.goal
  if (goal === 'article' || goal === 'both') return 'wechat'
  if (goal === 'script') return 'spoken'
  return 'xhs'
}

/** 原地视频录制、粗剪与成片面板：在单篇工作区内与其他产出平级切换，也可一键进全屏视频台。 */
function StudioVideoPane({ item, onGoSpoken }) {
  const takes = item.production?.takes ?? []
  const rawTakes = takes.filter(row => row.kind !== 'render')
  const [sub, setSub] = React.useState(() => (rawTakes.length ? 'cut' : 'record'))
  const [busy, setBusy] = React.useState(false)
  const [cutTakeId, setCutTakeId] = React.useState(null)
  const rate = React.useMemo(() => clampRate(readPref('rate', DEFAULT_RATE)), [])
  const script = scriptOf(item.production)

  return (
    <section className="md-layout-card md-studio-video" aria-label={t('视频录剪')}>
      <header className="md-tile-head md-layout-head">
        <Segmented
          label={t('视频环节')}
          value={sub}
          onChange={val => !busy && setSub(val)}
          options={[
            { value: 'record', label: t('提词录制'), icon: 'user' },
            { value: 'cut', label: rawTakes.length ? `${t('自动粗剪')} (${rawTakes.length})` : t('自动粗剪'), icon: 'film' },
            { value: 'finish', label: t('合成成片'), icon: 'spark' },
          ]}
        />
        {!script ? (
          <button type="button" className="md-inline-link" onClick={onGoSpoken}>
            {t('先去口播内容生成提词稿 →')}
          </button>
        ) : null}
        <span className="md-grow" />
        <button
          type="button"
          className="md-pill is-small"
          disabled={busy}
          onClick={() => setDesk({ focusId: null, view: 'video', videoFocusId: item.id, videoStep: sub })}
          title={t('在独立视频工作台中全屏打开（含字幕轴微调与发布包）')}
        >
          <Icon name="upRight" size={13} />{t('全屏视频台')}
        </button>
      </header>
      <div className={`md-studio-video-body md-vd-panel is-${sub}`}>
        {sub === 'record' ? (
          <RecordTab
            key={item.id}
            item={item}
            script={script}
            rate={rate}
            onBusy={setBusy}
            onCut={(takeId) => { setCutTakeId(takeId); setSub('cut') }}
          />
        ) : null}
        {sub === 'cut' ? (
          <CutTab
            key={item.id}
            item={item}
            takeId={cutTakeId}
            setTakeId={setCutTakeId}
            onRecord={() => setSub('record')}
            onFinish={() => setSub('finish')}
          />
        ) : null}
        {sub === 'finish' ? (
          <FinishTab
            key={item.id}
            item={item}
            script={script}
            rate={rate}
            onBusy={setBusy}
            onRecord={() => setSub('record')}
          />
        ) : null}
      </div>
    </section>
  )
}

function IdleSheet({ item }) {
  const [starting, setStarting] = React.useState(false)
  const styles = useDesk(s => s.state?.styles ?? [])
  const activeId = useDesk(s => s.state?.activeStyleId)
  const styleName = styles.find(s => s.id === activeId)?.name ?? t('默认风格')
  const goal = item.creation?.goal ?? 'xhs'
  const goalLabel = goal === 'xhs' ? t('小红书图文卡片') : goal === 'script' ? t('口播稿') : t('公众号长文')
  const btnLabel = goal === 'xhs' ? t('立即生成小红书图文') : goal === 'script' ? t('立即生成口播稿') : t('按当前风格直接成稿')
  const start = async () => {
    setStarting(true)
    try { await runProduce(item.id, { withImages: false, goal }) } finally { setStarting(false) }
  }
  return (
    <section className="md-tile md-idle-sheet">
      <div className="md-idle-sheet-inner">
        <span className="md-idle-kicker"><Icon name="spark" size={13} /><span>{goalLabel} · {styleName}</span></span>
        <h3>{t('点左侧「生成小红书图文」或在下方对话开聊，这里实时长出成稿')}</h3>
        <div className="md-idle-steps" aria-hidden="true">
          <span><b>1</b>{t('读取选题与附件')}</span>
          <i>→</i>
          <span><b>2</b>{t('检索信源与配图')}</span>
          <i>→</i>
          <span><b>3</b>{goal === 'xhs' ? t('自动排成图文卡片') : goal === 'script' ? t('生成提词口播稿') : t('自动排版长文')}</span>
        </div>
        <button type="button" className="md-pill is-primary" disabled={starting} onClick={start}>
          <Icon name="spark" size={14} />{starting ? t('正在开始…') : btnLabel}
        </button>
      </div>
    </section>
  )
}

/** 稿面顶上的一行：成稿过程与完成后高度保持一致（消除完稿瞬间跳动）；左栏收起时放返回和「灵感和对话」，右边是并列视图切换。 */
function SheetBar({ layout, onLayout, done, running, collapsed, goal, liveWords, liveCards, streamView, onStreamView }) {
  if (!done && !running && !collapsed) return null
  const streamLabel = goal === 'xhs'
    ? (liveWords > 0 ? t('正在生成小红书图文 · 已写 {n} 字（第 {c} 张卡）', { n: liveWords, c: liveCards }) : t('正在生成小红书图文…'))
    : goal === 'script'
      ? (liveWords > 0 ? t('正在生成口播稿 · 已写 {n} 字', { n: liveWords }) : t('正在生成口播稿…'))
      : (liveWords > 0 ? t('正在流式成稿 · 已写 {n} 字', { n: liveWords }) : t('正在流式成稿…'))
  return (
    <div className="md-sheet-bar">
      {collapsed ? (
        <span className="md-sheet-side">
          <IconButton icon="chevL" label={t('返回灵感')} onClick={closeItem} />
          <button type="button" className="md-pill is-small md-sheet-brief" aria-expanded={false} title={t('把左边的灵感卡和对话放回来')} onClick={() => setDesk({ studioDock: true })}><Icon name="chat" size={13} />{t('灵感和对话')}</button>
        </span>
      ) : null}
      {done ? (
        <Segmented label={t('视图')} value={layout} onChange={onLayout} options={SHEET_VIEWS.map(view => ({ value: view.value, label: t(view.label), icon: view.icon }))} />
      ) : running ? (
        <div className="md-sheet-live-bar">
          <span className="md-sheet-streaming"><span className="md-live-dot" aria-hidden="true" /><span className="md-shimmer">{streamLabel}</span></span>
          {goal === 'xhs' && liveWords >= 30 ? (
            <Segmented
              label={t('流式预览方式')}
              value={streamView}
              onChange={onStreamView}
              options={[
                { value: 'text', label: t('流式正文'), icon: 'fileText' },
                { value: 'xhs', label: t('实时卡片'), icon: 'wall' },
              ]}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Sheet({ item, live, layout, onLayout, collapsed }) {
  const settings = useDesk(s => s.settings)
  const [open, setOpen] = React.useState(null)
  const [viewing, setViewing] = React.useState(null)
  const [streamView, setStreamView] = React.useState('text')
  React.useEffect(() => { setStreamView('text') }, [item.id])
  // 写好之后可以切到排版和平台版本；格子区只是藏起来，切回来时滚动位置和编辑都还在
  const done = item.production?.status === 'done'
  const updating = live?.native && (live.drafts?.article || live.drafts?.spoken)
  const production = item.production
  const goal = item.creation?.goal ?? 'xhs'
  const isStreaming = Boolean(production?.status === 'running' || updating)
  const rawStreamText = String(live?.text ?? '')
  const liveWords = isStreaming && rawStreamText ? textLength(markdownPlain(rawStreamText)) : 0
  const liveCards = goal === 'xhs' && liveWords > 0 ? Math.max(1, (rawStreamText.match(/^##\s+/gm)?.length ?? 0) + 1) : 0
  const liveXhsPreview = !done && isStreaming && goal === 'xhs' && streamView === 'xhs' && liveWords >= 30
  const platform = liveXhsPreview ? 'xhs' : (done && (!updating || layout === 'spoken' || layout === 'video') && layout !== 'draft' ? layout : undefined)
  const streamTitle = React.useMemo(() => {
    if (!liveXhsPreview) return ''
    const h1 = /^#\s+(.+)\n/.exec(rawStreamText)?.[1]?.trim()
    return h1 || production?.title || item.title || ''
  }, [liveXhsPreview, rawStreamText, production?.title, item.title])
  const streamProd = React.useMemo(() => {
    if (!liveXhsPreview) return null
    const body = /^#\s+.+\n+/.test(rawStreamText) ? rawStreamText.replace(/^#\s+.+\n+/, '') : rawStreamText
    return { ...(production ?? {}), status: 'running', title: streamTitle, article: body }
  }, [liveXhsPreview, rawStreamText, production, streamTitle])
  const isArticle = useIsArticle(production, item)
  // 分镜只属于脚本；脚本写好了却没有分镜（导入的稿子）也不留一格空分镜，正文占满
  const withShots = !isArticle && (!done || (production.shots ?? []).length > 0)
  // 没有画出来的封面和配图，主视觉收成紧凑的标题栏
  const compact = (done || isArticle) && !production?.cover?.src && !(production?.images ?? []).some(image => image?.src) && !(isArticle && settings?.imageReady && production?.withImages !== false && production?.status === 'running')
  const bento = React.useRef(null)
  const tiles = React.useRef({})
  const articleRef = React.useRef(null)
  const origin = React.useRef(null)
  const closing = React.useRef(false)

  const expand = (name) => {
    const box = bento.current.getBoundingClientRect()
    const rect = tiles.current[name].getBoundingClientRect()
    origin.current = { left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }
    setOpen(name)
  }
  const collapse = React.useCallback(() => {
    setOpen((name) => {
      if (!name || closing.current) return name
      const el = tiles.current[name]
      if (reducedMotion() || !el || !origin.current) return null
      closing.current = true
      const box = bento.current.getBoundingClientRect()
      const animation = el.animate([{ left: '0px', top: '0px', width: `${box.width}px`, height: `${box.height}px` }, origin.current], { duration: SPRING_SNAP.duration, easing: SPRING_SNAP.easing, fill: 'forwards' })
      animation.onfinish = () => {
        closing.current = false
        animation.cancel()
        setOpen(null)
      }
      return name
    })
  }, [])
  const toggle = name => (open === name ? collapse() : expand(name))

  // 格子从原位放大到铺满
  React.useLayoutEffect(() => {
    if (!open || reducedMotion()) return
    const box = bento.current.getBoundingClientRect()
    tiles.current[open]?.animate([origin.current, { left: '0px', top: '0px', width: `${box.width}px`, height: `${box.height}px` }], { duration: SPRING_SOFT.duration, easing: SPRING_SOFT.easing })
  }, [open])

  React.useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape' && !viewing) {
        event.preventDefault()
        collapse()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, viewing, collapse])

  const tile = name => ({
    ref: (el) => {
      tiles.current[name] = el
      if (name === 'article') articleRef.current = el
    },
    className: `md-tile md-tile-${name} ${open === name ? 'is-open' : ''}`,
  })
  // 「定位」要在正文视图里找那一句：不在正文视图就先切回来
  const locate = (sentence) => {
    if (layout !== 'draft') onLayout('draft')
    requestAnimationFrame(() => requestAnimationFrame(() => locateSentence(articleRef.current, sentence)))
  }
  const hasStartedOrDone = Boolean(production) || Boolean(updating)
  return (
    <div className={`md-sheet ${done || isStreaming || collapsed ? 'has-layouts' : ''}`} data-layout={platform}>
      <SheetBar
        layout={layout}
        onLayout={onLayout}
        done={done}
        running={isStreaming}
        collapsed={collapsed}
        goal={goal}
        liveWords={liveWords}
        liveCards={liveCards}
        streamView={streamView}
        onStreamView={setStreamView}
      />
      {done ? <ClaimsBar item={item} onLocate={locate} /> : null}
      {hasStartedOrDone ? (
        <div className={`md-bento ${open ? 'has-open' : ''} ${withShots ? '' : 'is-solo'}`} ref={bento}>
          <HeroTile item={item} live={live} onView={setViewing} compact={compact} />
          <section {...tile('article')}>
            <ArticleTile item={item} live={live} open={open === 'article'} onToggle={() => toggle('article')} onView={setViewing} tileRef={articleRef} />
          </section>
          {withShots ? (
            <section {...tile('shots')}>
              <ShotsTile item={item} live={live} count={settings?.shotCount ?? 6} open={open === 'shots'} onToggle={() => toggle('shots')} onView={setViewing} />
            </section>
          ) : null}
        </div>
      ) : (
        <div className="md-bento is-solo is-idle-mode" ref={bento}>
          <IdleSheet item={item} />
        </div>
      )}
      {liveXhsPreview && streamProd ? <LayoutPreview mode="xhs" production={streamProd} title={streamTitle} /> : null}
      {!liveXhsPreview && platform && !['versions', 'spoken', 'video'].includes(platform) ? <LayoutPreview mode={platform} production={item.production} title={item.production.title || item.title} itemId={item.id} onOpenVersions={() => onLayout('versions')} /> : null}
      {platform === 'spoken' ? <SpokenContent key={item.id} item={item} /> : null}
      {platform === 'video' ? <StudioVideoPane key={item.id} item={item} onGoSpoken={() => onLayout('spoken')} /> : null}
      {platform === 'versions' ? <VersionsView item={item} /> : null}
      {done ? <TitlePickerLayer item={item} /> : null}
      {viewing ? <Viewer item={item} target={viewing} onChange={setViewing} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}

/**
 * 在正文格里找到这一句，滚过去并选中它。预览里按渲染后的文字找（去掉 Markdown 记号），编辑框里按原文找。
 * 只滚正文自己的滚动区，不连带外面的容器。
 */
function locateSentence(tile, sentence) {
  const plain = String(sentence ?? '').replace(/[*_=`#>]/g, '').replace(/\s+/g, ' ').trim()
  if (!tile || !plain) return
  const area = tile.querySelector('textarea.md-article-edit')
  if (area) {
    const at = area.value.indexOf(String(sentence).trim())
    if (at >= 0) {
      area.focus()
      area.setSelectionRange(at, at + String(sentence).trim().length)
    }
    return
  }
  const scroller = tile.querySelector('.md-article-scroll')
  if (!scroller) return
  const probe = plain.slice(0, 14)
  const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.indexOf(probe)
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, Math.min(node.textContent.length, at + plain.length))
    const place = (behavior) => {
      const box = scroller.getBoundingClientRect()
      const rect = range.getBoundingClientRect()
      if (rect.top >= box.top + 8 && rect.bottom <= box.bottom - 8) return
      scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + rect.top - box.top - box.height / 3), behavior })
    }
    place(reducedMotion() ? 'auto' : 'smooth')
    // 上面的图片晚一点才加载出来，会把这一句往下推：等一下再对一次
    setTimeout(() => place('auto'), 700)
    setTimeout(() => place('auto'), 1600)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return
  }
  toast(t('正文里没找到这一句，可能已经改过了'))
}

const DONE_SUGGESTIONS = ['标题再短一点', '语气轻松一点', '开场再抓人一点', '封面大字更有冲击力']
const CHAT_W_KEY = 'media-desk:studio-chat-w'

function useStudioChatWidth() {
  const [width, setWidth] = React.useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(CHAT_W_KEY))
      return Number.isFinite(saved) && saved >= 280 && saved <= 560 ? saved : 340
    } catch {
      return 340
    }
  })
  const persist = (val) => {
    const clamped = Math.round(Math.min(560, Math.max(280, val)))
    setWidth(clamped)
    try { window.localStorage.setItem(CHAT_W_KEY, String(clamped)) } catch { /* ignore */ }
  }
  const onPointerDown = (event) => {
    event.preventDefault()
    const handle = event.currentTarget
    const box = handle.parentElement?.getBoundingClientRect()
    if (!box) return
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    const move = e => persist(e.clientX - box.left)
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.classList.remove('is-dragging')
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); persist(width - 16) }
    if (event.key === 'ArrowRight') { event.preventDefault(); persist(width + 16) }
  }
  const reset = () => persist(340)
  return { width, onPointerDown, onKeyDown, reset }
}

/** 左栏标题行的快速换篇器：下拉选任意选题/成稿，或点上下篇直接切，不用反复退回灵感墙。 */
function PieceSwitcher({ currentId }) {
  const items = useDesk(s => s.state?.items ?? [])
  const list = React.useMemo(() => {
    const roots = items.filter(i => !i.parentId && i.title)
    const real = roots.filter(i => !i.sample)
    return (real.length ? real : roots).slice(0, 40)
  }, [items])
  const idx = list.findIndex(i => i.id === currentId)
  if (list.length <= 1) return <h2>{t('成稿')}</h2>
  const switchTo = (nextId) => {
    if (nextId && nextId !== currentId) setDesk({ focusId: nextId, sheetOrigin: null, chatQuote: null })
  }
  return (
    <div className="md-studio-switcher">
      <label className="md-studio-pick" title={t('快速切换稿件')}>
        <span>{t('成稿')}</span>
        <Icon name="chevUD" size={12} />
        <select value={currentId} onChange={e => switchTo(e.target.value)} aria-label={t('快速切换稿件')}>
          {list.map(row => (
            <option key={row.id} value={row.id}>
              {(row.production?.title || row.title).slice(0, 28)}{row.production?.status === 'done' ? ` · ${t('已成稿')}` : ''}
            </option>
          ))}
        </select>
      </label>
      <span className="md-studio-step">
        <button type="button" disabled={idx <= 0} onClick={() => idx > 0 && switchTo(list[idx - 1].id)} title={t('上一篇')} aria-label={t('上一篇')}>
          <Icon name="chevL" size={12} />
        </button>
        <button type="button" disabled={idx < 0 || idx >= list.length - 1} onClick={() => idx >= 0 && idx < list.length - 1 && switchTo(list[idx + 1].id)} title={t('下一篇')} aria-label={t('下一篇')}>
          <Icon name="chevR" size={12} />
        </button>
      </span>
    </div>
  )
}

export function Studio() {
  const id = useDesk(s => s.focusId)
  const item = useDesk(s => s.state?.items.find(i => i.id === s.focusId))
  const origin = useDesk(s => s.sheetOrigin)
  const live = useDesk(s => s.live[s.focusId])
  const settings = useDesk(s => s.settings)
  const chatOpen = useDesk(s => s.studioDock)
  const chatSizer = useStudioChatWidth()
  const ref = React.useRef(null)
  const production = item?.production
  const running = production?.status === 'running'
  const watching = running || [production?.cover, ...(production?.images ?? []), ...(production?.shots ?? [])].some(isBusy)
  // 视图放在这一层：排版和平台版本要整块宽度，左边的灵感卡和对话默认收起，点「灵感和对话」再放回来
  const [layout, setLayout] = React.useState(() => defaultSheetLayout(item))
  // 「怎么用」里的「带我去」可以指定打开后停在哪个视图（sheetLayout），用一次就清掉
  const wanted = useDesk(s => s.sheetLayout)
  React.useEffect(() => {
    if (!getDesk().sheetLayout) setLayout(defaultSheetLayout(getDesk().state?.items.find(i => i.id === id)))
  }, [id])
  React.useEffect(() => {
    if (!wanted) return
    if (SHEET_VIEWS.some(view => view.value === wanted)) setLayout(wanted)
    setDesk({ sheetLayout: null })
  }, [wanted])
  const done = production?.status === 'done'
  const itemGoal = item?.creation?.goal
  React.useEffect(() => {
    if (!done && !getDesk().sheetLayout) setLayout(defaultSheetLayout(item))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, itemGoal])
  const collapsed = done && layout !== 'draft' && !chatOpen

  React.useEffect(() => {
    if (id && watching) return watchProduction(id)
    return undefined
  }, [id, watching])

  // 从卡片的位置展开成整个工作区
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!id || !el || reducedMotion()) return
    if (origin) {
      const box = el.getBoundingClientRect()
      const inset = `inset(${origin.y - box.top}px ${box.right - origin.x - origin.w}px ${box.bottom - origin.y - origin.h}px ${origin.x - box.left}px round 20px)`
      el.animate([{ clipPath: inset }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], { duration: SPRING_SOFT.duration, easing: SPRING_SOFT.easing })
    } else {
      el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' })
    }
    // 只在切换灵感时播放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  React.useEffect(() => {
    if (!id) return undefined
    const onKey = (event) => {
      // 有格子放大或大图打开时，Esc 只收回它们
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('.md-tile.is-open,.md-viewer') && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) closeItem()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])

  // 打开的这条被删掉或撤销掉时，退回灵感，不留空白页
  React.useEffect(() => { if (id && !item) closeItem() }, [id, item])
  if (!item) return null
  return (
    <div className={`md-studio ${chatOpen ? 'chat-open' : ''} ${collapsed ? 'is-wide' : ''}`} style={{ '--chat-w': `${chatSizer.width}px` }} ref={ref} role="dialog" aria-label={t('灵感')}>
      <div className="md-studio-chat" hidden={collapsed}>
        <ChatPanel
          itemId={item.id}
          head={(
            <>
              <IconButton icon="chevL" label={t('返回灵感')} onClick={closeItem} />
              <PieceSwitcher currentId={item.id} />
              <span className="md-grow" />
              {done && layout !== 'draft' ? <IconButton icon="shrink" label={t('收起左栏，把地方让给排版')} onClick={() => setDesk({ studioDock: false })} /> : null}
            </>
          )}
          top={<IdeaCard item={item} live={live} settings={settings} />}
          suggestions={done ? DONE_SUGGESTIONS.filter(row => !row.includes('封面') || production.cover?.src || (production.cover && production.format !== 'article')).map(row => t(row)) : []}
          placeholder={running ? t('正在成稿，马上就好') : done ? t('想怎么改，直接说') : t('补充点想法，或者直接说要什么')}
          disabled={running}
          intro={false}
        />
      </div>
      {collapsed ? null : (
        <div
          className="md-studio-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('拖动调整左栏对话宽度')}
          title={t('拖动调整左栏宽度（双击恢复默认）')}
          tabIndex={0}
          onPointerDown={chatSizer.onPointerDown}
          onKeyDown={chatSizer.onKeyDown}
          onDoubleClick={chatSizer.reset}
        >
          <i />
        </div>
      )}
      {collapsed ? null : <button type="button" className="md-chat-toggle" aria-label={t('打开对话')} onClick={() => setDesk(s => ({ studioDock: !s.studioDock }))}><Icon name="chat" size={16} /></button>}
      <Sheet key={item.id} item={item} live={live} layout={layout} onLayout={setLayout} collapsed={collapsed} />
    </div>
  )
}
