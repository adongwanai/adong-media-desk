// 粗剪：找出录像里的停顿，在浏览器里跳着预览；本机有 ffmpeg 就直接导出，没有就给一份剪辑清单。
import React from 'react'
import { hostRequest, report, setDesk, toast } from '../desk.js'
import { t } from '../i18n.js'
import { Icon } from '../ui.jsx'
import { buildRegions, DEFAULT_MIN_CLIP, DEFAULT_MIN_GAP, DEFAULT_PAD, DEFAULT_THRESHOLD, decodeTakeAudio, detectSilences, intersectRanges, keepRanges, logRanges, rangesLength, skipTarget, subtractRanges } from './audio.js'
import { fmtClock } from './captions.js'
import { LIcon } from './icons.jsx'
import { Timeline } from './timeline.jsx'
import { downloadText, readPref, safeName, writePref } from './prompter.js'
import { TakeVideo, takeLabel, UploadTake } from './record.jsx'

function CutList({ item, take, keep, duration }) {
  const [plan, setPlan] = React.useState(null)
  const clip = take.src.slice(take.src.lastIndexOf('/') + 1)
  const title = item.production.title || item.title
  React.useEffect(() => { setPlan(null) }, [keep])
  const load = async () => {
    try {
      const data = await hostRequest('video/cut-plan', { keep, clip, title, duration })
      setPlan(data)
      return data
    } catch (err) {
      report(err)
      return null
    }
  }
  const base = `${safeName(title)}-${t('剪辑清单')}`
  const json = () => downloadText(JSON.stringify({ source: clip, duration, keep, removed: Math.round((duration - rangesLength(keep)) * 1000) / 1000 }, null, 2), `${base}.json`, 'application/json')
  const edl = async () => { const data = plan ?? await load(); if (data) downloadText(data.edl, `${base}.edl`) }
  const copy = async () => {
    const data = plan ?? await load()
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.command)
      toast(t('ffmpeg 命令已复制'))
    } catch {
      downloadText(data.command, `${base}.sh`)
    }
  }
  return (
    <div className="md-vd-cutlist">
      <div className="md-vd-row">
        <button type="button" className="md-btn is-small" onClick={json}><Icon name="save" size={13} />{t('下载剪辑清单 JSON')}</button>
        <button type="button" className="md-btn is-small" onClick={edl}><Icon name="save" size={13} />{t('下载 EDL（Premiere / DaVinci）')}</button>
        <button type="button" className="md-btn is-small" onClick={copy}><Icon name="copy" size={13} />{t('复制 ffmpeg 命令')}</button>
        {plan ? null : <button type="button" className="md-link-btn" onClick={load}>{t('预览命令')}</button>}
      </div>
      {plan ? <pre className="md-vd-pre" aria-label={t('ffmpeg 命令')}>{plan.command}</pre> : null}
      {plan ? <p className="md-vd-meta">{t('把录像下载下来、改名成 {clip}，和命令放在同一个文件夹里，在终端运行。', { clip })}</p> : null}
    </div>
  )
}

/** 无损导出前看一眼：切点要挪多少。keep 一变就重新算（稍等一下再算，拖滑块时不会连发）。 */
function useKeyframes(enabled, item, take, keep) {
  const [info, setInfo] = React.useState(null)
  React.useEffect(() => {
    if (!enabled || !keep.length) { setInfo(null); return undefined }
    let live = true
    const timer = setTimeout(() => {
      hostRequest('video/keyframes', { id: item.id, takeId: take.id, keep })
        .then(data => live && setInfo(data))
        .catch(err => live && setInfo({ available: false, error: err.message }))
    }, 400)
    return () => { live = false; clearTimeout(timer) }
  }, [enabled, item.id, take.id, keep])
  return info
}

function Exporter({ item, take, keep, duration, onFinish }) {
  const [status, setStatus] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [made, setMade] = React.useState(null)
  const [mode, setMode] = React.useState(() => (readPref('cutMode', 'encode') === 'copy' ? 'copy' : 'encode'))
  React.useEffect(() => writePref('cutMode', mode), [mode])
  React.useEffect(() => {
    let live = true
    hostRequest('video/status').then(data => live && setStatus(data)).catch(() => live && setStatus({ ffmpeg: false }))
    return () => { live = false }
  }, [])
  React.useEffect(() => setMade(null), [take.id])
  const lossless = mode === 'copy' && Boolean(status?.ffprobe)
  const frames = useKeyframes(lossless, item, take, keep)
  const run = async () => {
    setBusy(true)
    try {
      const data = await hostRequest('video/cut', { id: item.id, takeId: take.id, keep, mode: lossless ? 'copy' : 'encode' })
      setDesk({ state: data.state })
      setMade(data.take)
      toast(t('剪好了，存成了一条新录像'))
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }
  const length = lossless && frames?.keep ? rangesLength(frames.keep) : rangesLength(keep)
  const sparse = frames?.avgGap !== null && frames?.avgGap > 3
  return (
    <section className="md-vd-card">
      <header className="md-vd-card-head">
        <h3>{t('导出')}</h3>
        <span className="md-vd-meta">{status ? status.ffmpeg ? t('本机 ffmpeg {version} 可用', { version: status.version || '' }) : t('本机没有 ffmpeg') : t('正在检查本机有没有 ffmpeg…')}</span>
      </header>
      {status?.ffmpeg ? (
        <>
          <div className="md-vd-modes" role="radiogroup" aria-label={t('导出方式')}>
            <label className={mode === 'encode' ? 'is-on' : ''}>
              <input type="radio" name="md-vd-mode" checked={mode === 'encode'} onChange={() => setMode('encode')} />
              <span><b>{t('精确导出')}</b><small>{t('切点和预览一模一样；重新编码成 MP4（H.264 + AAC），要等一会儿。')}</small></span>
            </label>
            <label className={mode === 'copy' ? 'is-on' : ''}>
              <input type="radio" name="md-vd-mode" checked={mode === 'copy'} disabled={!status.ffprobe} onChange={() => setMode('copy')} />
              <span><b>{t('无损导出')}</b><small>{status.ffprobe ? t('不重新编码，几秒就好，画质不变；每段开头会往前挪到最近的关键帧，可能多留一点停顿。') : t('需要 ffprobe（一般和 ffmpeg 一起装），这台电脑上没有。')}</small></span>
            </label>
          </div>
          {lossless && frames?.available ? (
            <p className={`md-vd-alert ${sparse ? '' : 'is-info'}`}>{t('关键帧 {n} 个（平均 {gap} 秒一个）。按关键帧对齐后，切点最多往前挪 {shift} 秒，成片约 {time}。', { n: frames.count, gap: frames.avgGap ?? '—', shift: frames.maxShift.toFixed(1), time: fmtClock(length, { tenths: true }) })}{sparse ? t('关键帧太稀，无损导出会留下不少停顿，建议用精确导出。') : ''}</p>
          ) : null}
          {lossless && frames?.error ? <p className="md-vd-alert is-error">{frames.error}</p> : null}
          <div className="md-vd-row">
            <button type="button" className="md-btn is-primary is-big" disabled={busy || !keep.length} onClick={run}><Icon name="film" size={16} />{busy ? t('正在用 ffmpeg 导出…') : lossless ? t('无损导出（{time}）', { time: fmtClock(length) }) : t('导出剪好的视频（{time}）', { time: fmtClock(length) })}</button>
            <span className="md-vd-meta">{t('存成这篇的一条新录像，原录像不动。')}</span>
          </div>
        </>
      ) : status ? (
        <p className="md-vd-alert">{t('这台电脑没有装 ffmpeg，工作台没法直接导出视频。可以：下载 EDL 导进 Premiere 或 DaVinci Resolve；或者装好 ffmpeg（macOS 在终端运行 brew install ffmpeg）后回到这页；或者复制下面的命令自己运行。')}</p>
      ) : null}
      {made ? (
        <div className="md-vd-made">
          <TakeVideo src={made.src} />
          <div>
            <b>{t('剪好的视频')}</b>
            <span>{fmtClock(made.seconds)}</span>
            <div className="md-vd-row">
              {onFinish ? <button type="button" className="md-btn is-small is-primary" onClick={onFinish}><Icon name="spark" size={13} />{t('去叠字幕合成片')}</button> : null}
              <a className="md-btn is-small" href={made.src} download={`${safeName(item.production.title)}-cut${made.src.slice(made.src.lastIndexOf('.'))}`}><Icon name="save" size={13} />{t('下载')}</a>
            </div>
          </div>
        </div>
      ) : null}
      <h4 className="md-vd-sub">{t('剪辑清单')}</h4>
      <CutList item={item} take={take} keep={keep} duration={duration} />
    </section>
  )
}

/**
 * 按文稿剪：用录制时记下的提词换句时刻，把每句对应到录像里的一段，删掉哪句就剪掉哪段。
 * 「改文稿来剪视频」的思路来自 ScriptCut（github.com/FernandoAbishai/ScriptCut）；它靠语音识别逐字对齐，
 * 这里没有语音识别，时间来自提词器的记录，所以只有在本页跟着提词录的录像才有。
 */
function ScriptLines({ rows, removed, onToggle, onPlay, playing }) {
  return (
    <section className="md-vd-card">
      <header className="md-vd-card-head">
        <h3>{t('按文稿剪')}</h3>
        <span className="md-vd-meta">{t('{n} 句。念错重来的那一遍取消勾选，就会被剪掉。', { n: rows.length })}</span>
      </header>
      <p className="md-vd-alert is-info"><Icon name="clock" size={14} />{t('每句的时间来自录制时提词器的换句记录（提词滚到哪句、什么时候），不是语音识别。提词和嘴没对上时会差一点，以播放听到的为准。')}</p>
      <ol className="md-vd-segs">
        {rows.map((row, i) => (
          <li key={i} className={removed.has(i) ? 'is-cut' : ''}>
            <label className="md-vd-check"><input type="checkbox" checked={!removed.has(i)} onChange={() => onToggle(i)} aria-label={t('保留第 {n} 句', { n: i + 1 })} /></label>
            <button type="button" className="md-btn is-small" onClick={() => onPlay(row)} aria-label={t('播放第 {n} 句', { n: i + 1 })}><Icon name={playing === row.start ? 'close' : 'play'} size={12} fill={playing !== row.start} />{fmtClock(row.start, { tenths: true })}</button>
            <span className="md-vd-seg-len">{(row.end - row.start).toFixed(1)}s</span>
            <span className="md-vd-seg-text">{row.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

const AUTO = { threshold: DEFAULT_THRESHOLD, minGap: DEFAULT_MIN_GAP, margin: DEFAULT_PAD, minClip: DEFAULT_MIN_CLIP }
export const CUT_PRESETS = [
  { id: 'tight', label: '紧凑口播', params: { threshold: -38, minGap: 0.35, margin: 0.08, minClip: 0.25 } },
  { id: 'natural', label: '自然留气', params: { threshold: DEFAULT_THRESHOLD, minGap: DEFAULT_MIN_GAP, margin: DEFAULT_PAD, minClip: DEFAULT_MIN_CLIP } },
  { id: 'screen', label: '录屏演示', params: { threshold: -44, minGap: 0.9, margin: 0.2, minClip: 0.2 } },
]
const EMPTY_EDIT = { flipped: new Set(), lines: new Set(), manual: [] }
const FRAME = 1 / 30

const SHORTCUTS = [
  ['Space / K', '播放 / 暂停'], ['L', '播放，再按加速'], ['J', '后退 2 秒'], ['← →', '前后一帧'], ['Shift + ← →', '前后一秒'],
  ['I / O', '设入点 / 出点'], ['Delete', '剪掉入出点之间，或播放头所在的那段'], ['⌘Z', '撤销上一次剪辑'], ['+ / - / 0', '时间线放大 / 缩小 / 适合宽度'],
]

function toggled(set, i) {
  const next = new Set(set)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  return next
}

/** 右边检查器的宽度可以拖；记在这台电脑上。 */
function useInspectorWidth() {
  const [width, setWidth] = React.useState(() => readPref('inspW', 340))
  React.useEffect(() => writePref('inspW', width), [width])
  const onPointerDown = (event) => {
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const right = handle.parentElement.getBoundingClientRect().right
    const move = e => setWidth(Math.round(Math.min(520, Math.max(280, right - e.clientX))))
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up) }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft') setWidth(w => Math.min(520, w + 16))
    if (event.key === 'ArrowRight') setWidth(w => Math.max(280, w - 16))
  }
  return { width, onPointerDown, onKeyDown }
}

export function CutTab({ item, takeId, setTakeId, onRecord, onFinish }) {
  const takes = (item.production.takes ?? []).filter(row => row.kind !== 'render')
  const take = takes.find(row => row.id === takeId) ?? takes.filter(row => !row.from).at(-1) ?? takes.at(-1)
  const [analysis, setAnalysis] = React.useState({ status: 'idle' })
  const [params, setParams] = React.useState(() => ({ ...AUTO, ...readPref('cutParams', {}) }))
  const [edit, setEdit] = React.useState(EMPTY_EDIT)
  const [history, setHistory] = React.useState([])
  const [marks, setMarks] = React.useState({ in: null, out: null })
  const [segment, setSegment] = React.useState(null)
  const segmentEnd = React.useRef(null)
  const [skip, setSkip] = React.useState(true)
  const [time, setTime] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const video = React.useRef(null)
  const panel = useInspectorWidth()
  React.useEffect(() => writePref('cutParams', params), [params])
  const setParam = (key, value) => setParams(p => ({ ...p, [key]: value }))
  const commit = (next) => {
    setHistory(h => [...h.slice(-49), edit])
    setEdit(next)
  }
  const undoEdit = () => {
    if (!history.length) return false
    setEdit(history[history.length - 1])
    setHistory(h => h.slice(0, -1))
    return true
  }

  // 换一条录像就重新分析（分析过的直接用缓存）
  React.useEffect(() => {
    setEdit(EMPTY_EDIT)
    setHistory([])
    setMarks({ in: null, out: null })
    setTime(0)
    if (!take) {
      setAnalysis({ status: 'idle' })
      return undefined
    }
    const controller = new AbortController()
    setAnalysis({ status: 'loading' })
    decodeTakeAudio(take.src, controller.signal).then((result) => {
      if (!controller.signal.aborted) setAnalysis({ status: 'ready', ...result })
    }).catch((err) => {
      if (controller.signal.aborted) return
      setAnalysis({ status: 'error', error: err.code === 'no-audio' ? t('这条录像里没有声音（或者浏览器解不出来），没法按停顿剪。') : err.code === 'no-webaudio' ? t('这个浏览器不支持分析声音。') : t('读不出这条录像：{error}', { error: err.message }) })
    })
    return () => controller.abort()
  }, [take?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // 参数变了，停顿重新找，之前对停顿的手动切换作废
  React.useEffect(() => { setEdit(e => (e.flipped.size ? { ...e, flipped: new Set() } : e)) }, [params])

  const ready = analysis.status === 'ready'
  const duration = ready ? analysis.duration : take?.seconds ?? 0
  const regions = React.useMemo(() => (ready ? buildRegions(analysis.duration, detectSilences(analysis.db, { threshold: params.threshold, minGap: params.minGap, pad: params.margin, minClip: params.minClip })) : []), [ready, analysis, params])
  const kept = React.useMemo(() => regions.map((region, i) => (region.silence ? edit.flipped.has(i) : !edit.flipped.has(i))), [regions, edit.flipped])
  const lines = React.useMemo(() => (ready ? logRanges(take?.log, analysis.duration) : []), [ready, analysis, take])
  const keep = React.useMemo(() => {
    let out = keepRanges(regions, (_, i) => kept[i])
    const removed = [...lines.filter((_, i) => edit.lines.has(i)).map(row => [row.start, row.end]), ...edit.manual]
    if (removed.length) out = intersectRanges(out, subtractRanges(duration, removed))
    return out
  }, [regions, kept, lines, edit, duration])

  // 预览剪后效果：播到剪掉的地方直接跳到下一段
  React.useEffect(() => {
    const el = video.current
    if (!el || !ready) return undefined
    let raf = 0
    const check = () => {
      setTime(el.currentTime)
      if (segmentEnd.current !== null) {
        if (el.currentTime >= segmentEnd.current) { segmentEnd.current = null; setSegment(null); el.pause() }
        return
      }
      if (!skip || el.paused) return
      const next = skipTarget(el.currentTime, keep)
      if (next === null) { el.pause(); return }
      if (next !== el.currentTime) el.currentTime = next
    }
    const loop = () => { check(); raf = requestAnimationFrame(loop) }
    const onPlay = () => { setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) }
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf); check(); if (segmentEnd.current !== null) { segmentEnd.current = null; setSegment(null) } }
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('timeupdate', check)
    el.addEventListener('seeked', check)
    if (!el.paused) onPlay()
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('timeupdate', check)
      el.removeEventListener('seeked', check)
    }
  }, [ready, keep, skip, take?.id])

  const seek = (s) => {
    const el = video.current
    const at = Math.max(0, Math.min(duration, s))
    if (el) el.currentTime = at
    setTime(at)
  }
  const togglePlay = () => {
    const el = video.current
    if (!el) return
    if (el.paused) { el.playbackRate = 1; el.play().catch(() => {}) } else el.pause()
  }
  const cutHere = () => {
    if (marks.in !== null && marks.out !== null && marks.out > marks.in) {
      commit({ ...edit, manual: [...edit.manual, [marks.in, marks.out]] })
      setMarks({ in: null, out: null })
      return
    }
    const i = regions.findIndex(row => time >= row.start && time < row.end)
    if (i >= 0 && kept[i]) commit({ ...edit, flipped: toggled(edit.flipped, i) })
  }
  const keys = React.useRef(null)
  keys.current = { togglePlay, seek, time, cutHere, undoEdit, duration, setMarks, ready }
  // 键盘：只在这一步、而且没在输入框里时生效；处理过的键不再往下传（⌘Z 不会撤到别的地方去）
  React.useEffect(() => {
    const onKey = (event) => {
      const k = keys.current
      if (!k.ready || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return
      const el = video.current
      let handled = true
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) handled = k.undoEdit()
      else if (event.metaKey || event.ctrlKey || event.altKey) handled = false
      else if (event.code === 'Space' || event.key === 'k' || event.key === 'K') { if (event.code === 'Space' || !el?.paused) k.togglePlay() }
      else if (event.key === 'l' || event.key === 'L') { if (el) { el.playbackRate = el.paused ? 1 : Math.min(4, el.playbackRate * 2); el.play().catch(() => {}) } }
      else if (event.key === 'j' || event.key === 'J') k.seek(k.time - 2)
      else if (event.key === 'ArrowLeft') k.seek(k.time - (event.shiftKey ? 1 : FRAME))
      else if (event.key === 'ArrowRight') k.seek(k.time + (event.shiftKey ? 1 : FRAME))
      else if (event.key === 'i' || event.key === 'I') k.setMarks(m => ({ ...m, in: k.time }))
      else if (event.key === 'o' || event.key === 'O') k.setMarks(m => ({ ...m, out: k.time }))
      else if (event.key === 'Delete' || event.key === 'Backspace') k.cutHere()
      else if (event.key === 'Escape') k.setMarks({ in: null, out: null })
      else handled = false
      if (handled) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!take) {
    return (
      <section className="md-vd-card md-vd-hero">
        <LIcon name="scissors" size={28} />
        <h3>{t('还没有录像可以剪')}</h3>
        <p>{t('粗剪会找出录像里说话之间的停顿，一键去掉。先录一条口播，或者上传手机拍好的视频。')}</p>
        <div className="md-vd-row is-center">
          <button type="button" className="md-btn is-primary is-big" onClick={onRecord}>{t('去录一条')}</button>
          <UploadTake item={item} kind="camera" />
        </div>
      </section>
    )
  }
  const silences = regions.map((region, i) => ({ region, i })).filter(({ region }) => region.silence)
  const removed = ready ? analysis.duration - rangesLength(keep) : 0
  const playSegment = (row) => {
    const el = video.current
    if (!el) return
    if (segment === row.start) { el.pause(); return }
    segmentEnd.current = row.end
    setSegment(row.start)
    el.currentTime = row.start
    el.play().catch(() => { segmentEnd.current = null; setSegment(null) })
  }
  // 一键：按推荐参数重新找停顿，清掉手动的改动，从头播一遍剪后效果
  const auto = () => {
    setParams({ ...AUTO })
    commit(EMPTY_EDIT)
    setSkip(true)
    const el = video.current
    if (el) { el.currentTime = 0; el.play().catch(() => {}) }
  }
  const isAuto = Object.keys(AUTO).every(key => params[key] === AUTO[key]) && !edit.flipped.size && !edit.manual.length && !edit.lines.size
  const heavy = ready && removed / Math.max(0.1, analysis.duration) > 0.6
  return (
    <div className="md-ed" style={{ '--insp': `${panel.width}px` }}>
      <div className="md-ed-stage">
        <div className="md-ed-player">
          <TakeVideo key={take.id} src={take.src} videoRef={video} controls={false} onClick={togglePlay} />
          {analysis.status === 'loading' ? <span className="md-ed-badge"><span className="md-shimmer">{t('正在分析声音…')}</span></span> : null}
        </div>
        <div className="md-ed-transport">
          <button type="button" className="md-ed-play" onClick={togglePlay} title={playing ? t('暂停（空格）') : t('播放（空格）')} aria-label={playing ? t('暂停') : t('播放')}><LIcon name={playing ? 'pause' : 'play'} size={18} /></button>
          <span className="md-ed-time"><b>{fmtClock(time, { tenths: true })}</b> / {fmtClock(duration, { tenths: true })}</span>
          <span className="md-ed-sep" />
          <button type="button" className={`md-ed-tool ${marks.in !== null ? 'is-on' : ''}`} onClick={() => setMarks(m => ({ ...m, in: time }))} title={t('设入点（I）')}><LIcon name="flag-triangle-right" size={15} />{marks.in !== null ? fmtClock(marks.in, { tenths: true }) : t('入点')}</button>
          <button type="button" className={`md-ed-tool ${marks.out !== null ? 'is-on' : ''}`} onClick={() => setMarks(m => ({ ...m, out: time }))} title={t('设出点（O）')}><LIcon name="flag-triangle-left" size={15} />{marks.out !== null ? fmtClock(marks.out, { tenths: true }) : t('出点')}</button>
          <button type="button" className="md-ed-tool" onClick={cutHere} disabled={!ready} title={t('剪掉入出点之间，没有入出点时剪掉播放头所在的那段（Delete）')}><LIcon name="scissors" size={15} />{t('剪掉')}</button>
          <button type="button" className="md-ed-tool" onClick={undoEdit} disabled={!history.length} title={t('撤销上一次剪辑（⌘Z）')}><LIcon name="undo-2" size={15} />{t('撤销')}</button>
          <span style={{ flex: 1 }} />
          <label className="md-vd-check" title={t('播放时跳过要剪掉的部分')}><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} />{t('预览剪后效果')}</label>
          <details className="md-ed-keys">
            <summary title={t('快捷键')}><LIcon name="keyboard" size={16} /><span className="md-sr">{t('快捷键')}</span></summary>
            <dl>{SHORTCUTS.map(([key, what]) => <React.Fragment key={key}><dt>{key}</dt><dd>{t(what)}</dd></React.Fragment>)}</dl>
          </details>
        </div>
      </div>
      <div className="md-ed-handle" role="separator" aria-orientation="vertical" aria-label={t('拖动调整右侧面板宽度')} tabIndex={0} onPointerDown={panel.onPointerDown} onKeyDown={panel.onKeyDown} title={t('拖动调整宽度')} />
      <aside className="md-ed-insp">
        <section className="md-ed-sec">
          <label className="md-ed-field"><span>{t('录像')}</span>
            <select className="md-vd-select" value={take.id} onChange={e => setTakeId(e.target.value)}>
              {[...takes].reverse().map(row => <option key={row.id} value={row.id}>{takeLabel(row, takes)} · {fmtClock(row.seconds)}</option>)}
            </select>
          </label>
          {ready ? (
            <div className="md-vd-summary">
              <span><small>{t('原长')}</small><b>{fmtClock(analysis.duration, { tenths: true })}</b></span>
              <Icon name="chevR" size={16} />
              <span><small>{t('剪后')}</small><b>{fmtClock(rangesLength(keep), { tenths: true })}</b></span>
              <span className="md-vd-meta">{t('去掉 {cut} 秒（{pct}%），保留 {n} 段', { cut: removed.toFixed(1), pct: Math.round((removed / Math.max(0.1, analysis.duration)) * 100), n: keep.length })}</span>
              <span className="md-vd-meta" data-analysis-ms={analysis.ms}>{analysis.ms ? t('声音分析用了 {s} 秒', { s: (analysis.ms / 1000).toFixed(2) }) : t('声音分析读的缓存')}</span>
            </div>
          ) : null}
          <button type="button" className="md-btn is-primary is-wide" disabled={!ready} onClick={auto}><LIcon name="wand-sparkles" size={15} />{isAuto ? t('自动粗剪 · 从头预览') : t('一键自动粗剪')}</button>
          {analysis.status === 'error' ? <p className="md-vd-alert is-error">{analysis.error}</p> : null}
          {heavy ? <p className="md-vd-alert">{t('要剪掉一大半。可能是录音太小声，或者阈值太高：把「静音阈值」往左拉一点再看。')}</p> : null}
        </section>
        <section className="md-ed-sec">
          <h4 className="md-ed-h">{t('停顿规则')}</h4>
          <div className="md-cut-presets" role="group" aria-label={t('剪辑节奏预设')}>
            {CUT_PRESETS.map((preset) => {
              const active = Object.keys(preset.params).every(k => Math.abs((params[k] ?? 0) - preset.params[k]) < 0.01)
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`md-pill is-small ${active ? 'is-on' : ''}`}
                  onClick={() => { setParams({ ...preset.params }); setSkip(true) }}
                >
                  {t(preset.label)}
                </button>
              )
            })}
          </div>
          <label className="md-vd-range is-full"><span>{t('静音阈值')}</span><input type="range" min="-60" max="-20" step="1" value={params.threshold} onChange={e => setParam('threshold', Number(e.target.value))} /><b>{params.threshold} dB</b></label>
          <label className="md-vd-range is-full"><span>{t('最短停顿')}</span><input type="range" min="0.2" max="2" step="0.1" value={params.minGap} onChange={e => setParam('minGap', Number(e.target.value))} /><b>{params.minGap.toFixed(1)} s</b></label>
          <label className="md-vd-range is-full"><span>{t('留气口')}</span><input type="range" min="0" max="0.5" step="0.05" value={params.margin} onChange={e => setParam('margin', Number(e.target.value))} /><b>{params.margin.toFixed(2)} s</b></label>
          <label className="md-vd-range is-full"><span>{t('最短片段')}</span><input type="range" min="0" max="1" step="0.05" value={params.minClip} onChange={e => setParam('minClip', Number(e.target.value))} /><b>{params.minClip.toFixed(2)} s</b></label>
          <p className="md-vd-meta">{t('比阈值安静的地方算没声；说话段两头各留「留气口」；短于「最短片段」的一下响声（咳嗽、碰麦）不算说话；留完还长于「最短停顿」的没声段才剪。规则来自 auto-editor。')}</p>
        </section>
        {ready ? (
          <section className="md-ed-sec">
            <h4 className="md-ed-h">{t('剪掉的部分')}<span className="md-vd-meta">{t('点一下改成留下')}</span></h4>
            {silences.length || edit.manual.length ? (
              <div className="md-vd-chips" role="group" aria-label={t('找到的停顿')}>
                {silences.map(({ region, i }) => (
                  <button type="button" key={`s${i}`} className={kept[i] ? 'is-kept' : ''} aria-pressed={!kept[i]} onClick={() => { commit({ ...edit, flipped: toggled(edit.flipped, i) }); seek(Math.max(0, region.start - 1)) }} title={t('点一下切换剪掉/留下，并跳到这段前面')}>
                    {fmtClock(region.start, { tenths: true })} · {(region.end - region.start).toFixed(1)}s · {kept[i] ? t('留下') : t('剪掉')}
                  </button>
                ))}
                {edit.manual.map(([a, b], i) => (
                  <button type="button" key={`m${a}-${b}`} className="is-manual" onClick={() => commit({ ...edit, manual: edit.manual.filter((_, k) => k !== i) })} title={t('手动剪掉的，点一下恢复')}>
                    <LIcon name="scissors" size={11} />{fmtClock(a, { tenths: true })}–{fmtClock(b, { tenths: true })} · {t('恢复')}
                  </button>
                ))}
              </div>
            ) : <p className="md-vd-empty-line">{t('按现在的设置没找到停顿。把阈值往右拉一点试试。')}</p>}
            {!lines.length ? <p className="md-vd-note"><Icon name="pen" size={14} />{t('「按文稿剪」只对在这里跟着提词录的录像有效：录制时会记下提词换到每一句的时刻。这条录像没有这份记录，只能按停顿剪。')}</p> : null}
          </section>
        ) : null}
        {ready && lines.length ? <ScriptLines rows={lines} removed={edit.lines} onToggle={i => commit({ ...edit, lines: toggled(edit.lines, i) })} onPlay={playSegment} playing={segment} /> : null}
        {ready ? <Exporter item={item} take={take} keep={keep} duration={analysis.duration} onFinish={onFinish} /> : null}
      </aside>
      <div className="md-ed-timeline">
        {ready ? <Timeline db={analysis.db} duration={analysis.duration} keep={keep} regions={regions} time={time} inPoint={marks.in} outPoint={marks.out} onSeek={seek} onToggle={i => commit({ ...edit, flipped: toggled(edit.flipped, i) })} />
          : <div className="md-tl is-empty"><span className="md-vd-meta">{analysis.status === 'loading' ? t('正在分析声音，好了时间线会出现在这里…') : t('时间线要等声音分析完')}</span></div>}
      </div>
    </div>
  )
}
