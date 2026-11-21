// 视频页：左边是有口播稿的成稿，右边按步骤走——口播稿、提词录制、字幕、粗剪、发布包。
import React from 'react'
import { coverDataUrl, downloadCover } from '../cover.js'
import { openItem, setDesk, toast, useDesk } from '../desk.js'
import { plural, t, useLang } from '../i18n.js'
import { Empty, Icon, Swap } from '../ui.jsx'
import { buildCues, clampRate, DEFAULT_RATE, fmtClock, retimeCues, scriptOf, scriptTiming, toPlainText, toSrt, toVtt } from './captions.js'
import { buildRegions, decodeTakeAudio, detectSilences, keepRanges } from './audio.js'
import { CutTab } from './cut.jsx'
import { FinishTab } from './finish.jsx'
import { LIcon } from './icons.jsx'
import { downloadText, readPref, safeName, writePref } from './prompter.js'
import { RecordTab, TakeVideo, takeLabel } from './record.jsx'
import { RateControl, ScriptTab, TARGETS } from './script.jsx'

// 引导轨：稿子 → 录制 → 粗剪 → 字幕 → 成片 → 发布包
const TABS = [
  { id: 'script', label: '稿子', icon: 'file-text' },
  { id: 'record', label: '录制', icon: 'video' },
  { id: 'cut', label: '粗剪', icon: 'scissors' },
  { id: 'captions', label: '字幕', icon: 'captions' },
  { id: 'finish', label: '成片', icon: 'clapperboard' },
  { id: 'pack', label: '发布包', icon: 'package' },
]

const finishedAt = item => Date.parse(item.production?.finishedAt ?? item.production?.startedAt ?? item.createdAt) || 0

/** 最适合拿去发的那条：最新的粗剪，没有就最新的一条。 */
/** 叠字幕用的录像：原始录像或粗剪，不用已经烧了字幕的成片，也不用只有声音的旁白。 */
function bestTake(takes = []) {
  const raw = takes.filter(row => row.kind !== 'render' && row.kind !== 'voice')
  return raw.filter(row => row.from).at(-1) ?? raw.at(-1) ?? null
}

/** 要发出去的那条：最新的成片，没有就最新的粗剪或录像。 */
function finalTake(takes = []) {
  return takes.filter(row => row.kind === 'render').at(-1) ?? bestTake(takes)
}

/** 浏览器里临时生成的字幕文件地址；内容变了或页面离开时收回。 */
function useObjectUrl(text, type) {
  const url = React.useMemo(() => (text ? URL.createObjectURL(new Blob([text], { type })) : null), [text, type])
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url
}

function NeedScript({ onGo }) {
  return <Empty title={t('这篇还没有口播稿')} hint={t('字幕、提词和发布包都从口播稿来。先到第 1 步写好或改写口播稿。')} action={<button type="button" className="md-btn is-primary" style={{ marginTop: 14 }} onClick={onGo}>{t('去写口播稿')}</button>} />
}

function CaptionsTab({ item, script, rate, setRate }) {
  const takes = item.production.takes ?? []
  const [takeId, setTakeId] = React.useState(() => bestTake(takes)?.id ?? '')
  const [offset, setOffset] = React.useState(() => readPref('captionOffset', 0))
  React.useEffect(() => writePref('captionOffset', offset), [offset])
  const take = takes.find(row => row.id === takeId) ?? bestTake(takes)
  // 对齐真实录音：分析这条录像的声音，把字幕铺到真正出声的段落上（没人说话的地方不挂字幕）
  const [speech, setSpeech] = React.useState(null)
  const [analyzing, setAnalyzing] = React.useState(false)
  React.useEffect(() => {
    setSpeech(null)
    if (!take) return undefined
    const controller = new AbortController()
    setAnalyzing(true)
    decodeTakeAudio(take.src, controller.signal)
      .then((analysis) => {
        if (controller.signal.aborted) return
        const silences = detectSilences(analysis.db, { threshold: -40, minGap: 0.45, pad: 0.1, minClip: 0.25 })
        setSpeech(keepRanges(buildRegions(analysis.duration, silences), region => !region.silence))
      })
      .catch(() => { if (!controller.signal.aborted) setSpeech(null) })
      .finally(() => { if (!controller.signal.aborted) setAnalyzing(false) })
    return () => controller.abort()
  }, [take?.id, take?.src])
  const estimated = React.useMemo(() => buildCues(script, { rate, offset }), [script, rate, offset])
  const cues = React.useMemo(() => (speech?.length ? retimeCues(estimated.map(row => ({ ...row, start: row.start + offset, end: row.end + offset })), speech) : estimated), [estimated, speech, offset])
  const vttUrl = useObjectUrl(cues.length ? toVtt(cues) : '', 'text/vtt')
  const base = safeName(item.production.title || item.title)
  const analyzeText = analyzing
    ? t('正在听这条录像的声音，听完字幕会自动对齐到说话的地方…')
    : t('没从这条录像里听出说话段（可能没声音，或者浏览器解不开）。字幕还是按口播稿和语速估算，把「开口前的空白」调到大致对上。')
  return (
    <div className="md-vd-stack">
      <p className="md-vd-alert"><Icon name="clock" size={14} />{take
        ? (speech?.length
          ? t('字幕已经对齐到这条录像里真正出声的段落：停顿的地方不挂字幕。要逐字对齐，再用剪映的「识别字幕」这类按声音识别的工具。')
          : analyzeText)
        : t('还没有录像。字幕先按口播稿和语速估算；录好一条之后会自动对齐到真实的声音。')}</p>
      <section className="md-vd-card">
        <div className="md-vd-toolbar">
          <RateControl rate={rate} setRate={setRate} />
          <label className="md-vd-range is-wide"><span>{t('开口前的空白')}</span><input type="range" min="0" max="10" step="0.1" value={offset} onChange={e => setOffset(Number(e.target.value))} /><b>{offset.toFixed(1)} s</b></label>
        </div>
      </section>
      <div className="md-vd-split">
        <section className="md-vd-card">
          <header className="md-vd-card-head">
            <h3>{t('叠在录像上预览')}</h3>
            {takes.length > 1 ? (
              <select className="md-vd-select" value={take?.id} onChange={e => setTakeId(e.target.value)} aria-label={t('选一条录像')}>
                {[...takes].reverse().filter(row => row.kind !== 'render' && row.kind !== 'voice').map(row => <option key={row.id} value={row.id}>{takeLabel(row, takes)} · {fmtClock(row.seconds)}</option>)}
              </select>
            ) : null}
          </header>
          {take ? (
            <TakeVideo key={`${take.id}-${vttUrl}`} src={take.src} className="has-captions">
              {vttUrl ? <track kind="subtitles" srcLang="zh" label={t('估算字幕')} src={vttUrl} default /> : null}
            </TakeVideo>
          ) : (
            <div className="md-vd-frame">
              <span className="md-vd-frame-cap">{cues[0]?.text ?? ''}</span>
              <p>{t('还没有录像。录好一条之后，字幕会叠在录像上播放。')}</p>
            </div>
          )}
          <div className="md-vd-row">
            <button type="button" className="md-btn is-primary" disabled={!cues.length} onClick={() => downloadText(toSrt(cues), `${base}.srt`, 'application/x-subrip')}><Icon name="save" size={14} />{t('下载 SRT 字幕')}</button>
            <button type="button" className="md-btn" disabled={!cues.length} onClick={() => downloadText(toPlainText(cues), `${base}-${t('字幕')}.txt`)}><Icon name="save" size={14} />{t('下载纯文字')}</button>
          </div>
        </section>
        <section className="md-vd-card md-vd-lines">
          <header className="md-vd-card-head">
            <h3>{t('字幕条')}</h3>
            <span className="md-vd-meta">{t('{n} 条 · 每条不超过 16 个字', { n: cues.length })}</span>
          </header>
          <ol className="md-vd-cues">
            {cues.map(cue => <li key={cue.index}><small>{fmtClock(cue.start, { tenths: true })}–{fmtClock(cue.end, { tenths: true })}</small><span>{cue.text}</span></li>)}
          </ol>
        </section>
      </div>
    </div>
  )
}

function PackRow({ done, title, detail, children, preview }) {
  return (
    <li className={`md-vd-pack-row ${done ? 'is-done' : ''}`}>
      <i className="md-vd-pack-mark">{done ? <Icon name="check" size={12} stroke={2.6} /> : null}</i>
      <div className="md-vd-pack-body">
        <b>{title}</b>
        {detail ? <span>{detail}</span> : null}
        {preview}
      </div>
      <div className="md-vd-row">{children}</div>
    </li>
  )
}

function PackTab({ item, script, rate, goTab }) {
  const production = item.production
  const title = production.title || item.title
  const base = safeName(title)
  const timing = React.useMemo(() => scriptTiming(script, rate), [script, rate])
  const cues = React.useMemo(() => buildCues(script, { rate, offset: readPref('captionOffset', 0) }), [script, rate])
  const take = finalTake(production.takes)
  const coverText = production.coverText || title
  const [cover, setCover] = React.useState(null)
  React.useEffect(() => {
    let live = true
    coverDataUrl({ src: production.cover?.src, text: coverText }).then(url => live && setCover(url)).catch(() => live && setCover(null))
    return () => { live = false }
  }, [production.cover?.src, coverText])
  const copyTitle = async () => {
    try {
      await navigator.clipboard.writeText(title)
      toast(t('标题已复制'))
    } catch {
      toast(t('复制失败，手动选中标题复制'), { error: true })
    }
  }
  const ready = [Boolean(title), timing.spokenCount > 0, Boolean(cover), Boolean(take), cues.length > 0].filter(Boolean).length
  return (
    <div className="md-vd-stack">
      <section className="md-vd-card">
        <header className="md-vd-card-head">
          <h3>{t('发布前清单')}</h3>
          <span className="md-vd-meta">{t('{n}/5 项就绪', { n: ready })}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={() => setDesk({ view: 'publish', focusId: null })}>{t('去「发布」页')}<Icon name="chevR" size={14} /></button>
        </header>
        <ul className="md-vd-pack">
          <PackRow done={Boolean(title)} title={t('标题')} preview={<p className="md-vd-pack-title">{title}</p>}>
            <button type="button" className="md-btn is-small" onClick={copyTitle}><Icon name="copy" size={13} />{t('复制')}</button>
          </PackRow>
          <PackRow done={timing.spokenCount > 0} title={t('口播稿')} detail={timing.spokenCount ? t('{n} 句 · 约 {time}', { n: timing.spokenCount, time: fmtClock(timing.total) }) : t('还没有')} preview={timing.spokenCount ? <p className="md-vd-pack-quote">{timing.lines.filter(row => row.spoken).slice(0, 2).map(row => row.text).join(' / ')}</p> : null}>
            {timing.spokenCount ? <button type="button" className="md-btn is-small" onClick={() => downloadText(timing.lines.filter(row => row.spoken).map(row => row.text).join('\n'), `${base}-${t('口播稿')}.txt`)}><Icon name="save" size={13} />{t('下载')}</button> : <button type="button" className="md-btn is-small" onClick={() => goTab('script')}>{t('去写')}</button>}
          </PackRow>
          <PackRow done={Boolean(cover)} title={t('封面')} detail={production.cover?.src ? t('成稿封面叠大字，1920×1080') : t('没有封面图，用渐变底的纯文字封面')} preview={cover ? <img className="md-vd-pack-cover" src={cover} alt={t('视频封面')} /> : null}>
            <button type="button" className="md-btn is-small" onClick={() => downloadCover({ src: production.cover?.src, text: coverText }, title).catch(err => toast(err.message, { error: true }))}><Icon name="save" size={13} />{t('下载')}</button>
          </PackRow>
          <PackRow done={Boolean(take)} title={t('视频')} detail={take ? t('{label} · {time}', { label: takeLabel(take, production.takes), time: fmtClock(take.seconds) }) : t('还没有录像')} preview={take ? <TakeVideo src={take.src} className="is-small" /> : null}>
            {take ? <a className="md-btn is-small" href={take.src} download={`${base}${take.src.slice(take.src.lastIndexOf('.'))}`}><Icon name="save" size={13} />{t('下载')}</a> : <button type="button" className="md-btn is-small" onClick={() => goTab('record')}>{t('去录制')}</button>}
          </PackRow>
          <PackRow done={cues.length > 0} title={t('字幕 SRT')} detail={cues.length ? t('{n} 条，按语速估算的时间', { n: cues.length }) : t('有口播稿后自动生成')} preview={cues.length ? <pre className="md-vd-pre is-short">{toSrt(cues.slice(0, 2))}</pre> : null}>
            {cues.length ? <button type="button" className="md-btn is-small" onClick={() => downloadText(toSrt(cues), `${base}.srt`, 'application/x-subrip')}><Icon name="save" size={13} />{t('下载')}</button> : null}
          </PackRow>
        </ul>
      </section>
      <p className="md-vd-note"><Icon name="check" size={14} />{t('工作台只把文件准备好。抖音、视频号、B 站都要你自己在后台上传视频、贴字幕、点发布；发完到「发布」页记一下状态。')}</p>
    </div>
  )
}

/** 换一篇：收在标题旁边的下拉里，把整块地方留给剪辑区。 */
function PiecePicker({ pieces, item, onSelect, disabled }) {
  return (
    <label className="md-vd-picker" title={disabled ? t('正在录制或渲染，先停下再换') : t('换一篇')}>
      {/* 标题完整显示、可以换行；透明的下拉框盖在上面，点标题就能换一篇 */}
      <h1>{item.production.title || item.title}<Icon name="chevD" size={16} /></h1>
      <select value={item.id} disabled={disabled} onChange={e => onSelect(e.target.value)} aria-label={t('选一篇成稿')}>
        {pieces.map(row => {
          const ready = Boolean(scriptOf(row.production))
          const takes = row.production.takes?.length ?? 0
          return <option key={row.id} value={row.id}>{`${row.production.title || row.title}${ready ? '' : ` · ${t('文章 · 待改写')}`}${takes ? ` · ${t('{n} 条录像', { n: takes })}` : ''}`}</option>
        })}
      </select>
    </label>
  )
}

/** 专注模式：整块剪辑区真全屏，Esc 退出。 */
function useFullscreen(ref) {
  const [on, setOn] = React.useState(false)
  React.useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else ref.current?.requestFullscreen?.().catch(() => toast(t('这个窗口不能全屏'), { error: true }))
  }
  return [on, toggle]
}

export function VideoView() {
  useLang()
  const items = useDesk(s => s.state.items)
  const pieces = React.useMemo(() => items.filter(item => !item.sample && item.production?.status === 'done').sort((a, b) => finishedAt(b) - finishedAt(a)), [items])
  const [selectedId, setSelectedId] = React.useState(() => readPref('piece', null))
  const [tab, setTab] = React.useState(() => (TABS.some(row => row.id === readPref('tab', 'script')) ? readPref('tab', 'script') : 'script'))
  const wantedId = useDesk(s => s.videoFocusId)
  const wantedStep = useDesk(s => s.videoStep)
  React.useEffect(() => {
    if (!wantedId) return
    setSelectedId(wantedId)
    setTab(TABS.some(row => row.id === wantedStep) ? wantedStep : 'script')
    setDesk({ videoFocusId: null, videoStep: null })
  }, [wantedId, wantedStep])
  const [rate, setRateState] = React.useState(() => clampRate(readPref('rate', DEFAULT_RATE)))
  const [target, setTarget] = React.useState(() => (TARGETS.includes(readPref('target', 60)) ? readPref('target', 60) : 60))
  const [busy, setBusy] = React.useState(false)
  const [cutTakeId, setCutTakeId] = React.useState(null)
  const wrap = React.useRef(null)
  const [focus, toggleFocus] = useFullscreen(wrap)
  const setRate = value => setRateState(clampRate(value))
  React.useEffect(() => writePref('rate', rate), [rate])
  React.useEffect(() => writePref('target', target), [target])
  React.useEffect(() => writePref('tab', tab), [tab])
  const item = pieces.find(row => row.id === selectedId) ?? pieces[0]
  React.useEffect(() => {
    setDesk({ videoChatItemId: item?.id ?? null })
    return () => setDesk({ videoChatItemId: null })
  }, [item?.id])
  React.useEffect(() => { if (item) writePref('piece', item.id) }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => setCutTakeId(null), [item?.id])

  if (!pieces.length) {
    return (
      <div className="md-page">
        <header className="md-page-head"><div><h1>{t('视频')}</h1><p className="md-page-sub">{t('口播稿、提词录制、字幕、粗剪，一篇一篇做')}</p></div></header>
        <Empty title={t('还没有成稿')} hint={t('打开成稿的「口播内容」，改写或粘贴口播稿，点「导入视频工作台」。原正文会保留。')} action={<button type="button" className="md-btn is-primary" style={{ marginTop: 14 }} onClick={() => setDesk({ view: 'home', focusId: null })}>{t('去灵感')}</button>} />
      </div>
    )
  }
  const script = scriptOf(item.production)
  const timing = scriptTiming(script, rate)
  const goTab = (id) => { if (!busy) setTab(id) }
  // 录制和粗剪没有稿子也能做；字幕只能从稿子来
  const needsScript = !script && tab === 'captions'
  const tabs = {
    script: <ScriptTab key={item.id} item={item} script={script} rate={rate} setRate={setRate} target={target} setTarget={setTarget} onNext={() => goTab('record')} />,
    record: <RecordTab key={item.id} item={item} script={script} rate={rate} onBusy={setBusy} onCut={(id) => { setCutTakeId(id); goTab('cut') }} />,
    captions: <CaptionsTab key={item.id} item={item} script={script} rate={rate} setRate={setRate} />,
    cut: <CutTab key={item.id} item={item} takeId={cutTakeId} setTakeId={setCutTakeId} onRecord={() => goTab('record')} onFinish={() => goTab('finish')} />,
    finish: <FinishTab key={item.id} item={item} script={script} rate={rate} onBusy={setBusy} onRecord={() => goTab('record')} />,
    pack: <PackTab key={item.id} item={item} script={script} rate={rate} goTab={goTab} />,
  }
  return (
    <div className={`md-vd-wrap ${focus ? 'is-focus' : ''}`} ref={wrap}>
      <header className="md-vd-bar">
        <div className="md-vd-title">
          <PiecePicker pieces={pieces} item={item} disabled={busy} onSelect={id => !busy && setSelectedId(id)} />
          <p className="md-vd-sub-line">
            {script ? t('{n} 句 · 按 {rate} 字/秒约 {time}', { n: timing.spokenCount, rate: rate.toFixed(1), time: fmtClock(timing.total) }) : t('还没有口播稿')}
            {item.production.takes?.length ? ` · ${t('{n} 条录像', { n: item.production.takes.length })}` : ''}
            {/* 正在录制或渲染的提示放在这一行，不挤右边，切步骤的那排不会被推着左移 */}
            {busy ? <span className="md-vd-busy"><i />{t('正在录制或渲染')}</span> : null}
          </p>
        </div>
        <nav className="md-vd-rail" role="tablist" aria-label={t('视频步骤')}>
          {TABS.map((entry, i) => (
            <button type="button" role="tab" key={entry.id} aria-selected={tab === entry.id} className={tab === entry.id ? 'is-on' : ''} disabled={busy && tab !== entry.id} onClick={() => goTab(entry.id)} title={t('第 {n} 步：{name}', { n: i + 1, name: t(entry.label) })}>
              <LIcon name={entry.icon} size={15} /><span className="md-keepw" data-label={t(entry.label)}>{t(entry.label)}</span>
            </button>
          ))}
        </nav>
        <div className="md-vd-bar-end">
          <button type="button" className="md-ed-tool" onClick={() => openItem(item.id)} title={t('打开成稿')}><Icon name="upRight" size={14} /><span>{t('成稿')}</span></button>
          <button type="button" className={`md-ed-tool ${focus ? 'is-on' : ''}`} onClick={toggleFocus} title={focus ? t('退出专注模式（Esc）') : t('专注模式：剪辑区全屏')}><LIcon name={focus ? 'minimize' : 'maximize'} size={15} /><Swap labels={[t('专注模式'), t('退出专注')]} at={focus ? 1 : 0} /></button>
        </div>
      </header>
      <div className={`md-vd-panel is-${tab}`} role="tabpanel" key={`${item.id}-${tab}`}>
        {needsScript ? <NeedScript onGo={() => goTab('script')} /> : tabs[tab] ?? tabs.script}
      </div>
    </div>
  )
}
