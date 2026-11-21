// 成片：选一个剪辑模板，套在一条录像或这篇的图文上，看预览、改文字，再实时渲染成一条视频。
import React from 'react'
import { hostRequest, report, setDesk, toast, useDesk } from '../desk.js'
import { t } from '../i18n.js'
import { YANQI_DEFAULTS, YANQI_THEMES } from '../layouts/yanqi-themes.js'
import { Segmented } from '../ui.jsx'
import { decodeTakeAudio, detectSilences, buildRegions, keepRanges } from './audio.js'
import { fmtClock, scriptTiming } from './captions.js'
import { LIcon } from './icons.jsx'
import { drawFrame, HOOK_SEC, loadImages, planMontage, renderMontage, SIZES, themeColors } from './montage.js'
import { readPref, safeName, writePref } from './prompter.js'
import { captureSupport, mediaError, saveTake, stopStream, TakeVideo, takeLabel, useRecorder } from './record.jsx'
import { defaultSlots, SLOT_KEYS, TEMPLATES, templateById } from './templates.js'
import { drawThumb } from './thumbs.js'

const SLOT_LABEL = { hook: '开头钩子', chapters: '章节 / 步骤标题', keywords: '字幕高亮词', endLine: '片尾一句', quote: '金句', leftLabel: '左边标签', rightLabel: '右边标签' }
const LIST_SLOTS = new Set(['chapters', 'keywords'])

/** 默认用图文卡片里选过的言起主题（只读，不改那边的设置）。 */
function chosenTheme() {
  try {
    const saved = JSON.parse(window.localStorage.getItem('media-desk:yanqi:card') ?? 'null')
    if (saved?.theme && YANQI_THEMES.some(row => row.id === saved.theme)) return saved.theme
  } catch {
    // 读不到就用言起的默认主题
  }
  return YANQI_DEFAULTS.themeId
}

/** 预览清晰度：核数少、内存小的电脑默认「流畅」（半分辨率）。成片永远按全分辨率渲染。 */
function defaultQuality() {
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = navigator.deviceMemory ?? 8
  return cores <= 4 || memory <= 4 ? 'smooth' : 'sharp'
}

/** 这条录像里哪几段在说话（把停顿去掉）。用来把字幕铺到真实说话的地方，没有提词记录时也能贴住声音。 */
function useSpeechRanges(take) {
  const [speech, setSpeech] = React.useState(null)
  React.useEffect(() => {
    if (!take) { setSpeech(null); return undefined }
    const controller = new AbortController()
    decodeTakeAudio(take.src, controller.signal)
      .then((analysis) => {
        if (controller.signal.aborted) return
        const silences = detectSilences(analysis.db, { threshold: -40, minGap: 0.45, pad: 0.1, minClip: 0.25 })
        setSpeech(keepRanges(buildRegions(analysis.duration, silences), region => !region.silence))
      })
      .catch(() => { if (!controller.signal.aborted) setSpeech(null) })
    return () => controller.abort()
  }, [take?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return speech
}

function useNarration(take, context) {
  const [state, setState] = React.useState({ status: 'none' })
  React.useEffect(() => {
    if (!take) { setState({ status: 'none' }); return undefined }
    let live = true
    setState({ status: 'loading' })
    fetch(take.src)
      .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => context().decodeAudioData(data))
      .then((buffer) => { if (live) setState({ status: 'ready', buffer, duration: buffer.duration }) })
      .catch(() => { if (live) setState({ status: 'error', error: t('这条录像里解不出声音，换一条，或者现在录一段旁白。') }) })
    return () => { live = false }
  }, [take?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

/** 现场录旁白：只开麦克风。录好存成这篇的一条「旁白」，自动选上。 */
function NarrationRecorder({ item, script, onSaved, onBusy }) {
  const [stream, setStream] = React.useState(null)
  const [error, setError] = React.useState('')
  const recorder = useRecorder({ itemId: item.id, kind: 'voice', title: item.production.title || item.title, onSaved })
  React.useEffect(() => () => stopStream(stream), [stream])
  React.useEffect(() => { onBusy(recorder.phase !== 'idle') }, [recorder.phase, onBusy])
  const start = async () => {
    setError('')
    if (!captureSupport().camera) { setError(mediaError({ name: 'NotSupportedError' }, 'camera')); return }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      setStream(mic)
      recorder.start(mic, { audioOnly: true })
    } catch (err) {
      setError(mediaError(err, 'camera'))
    }
  }
  const stop = async () => {
    await recorder.stop()
    setStream(null)
  }
  const lines = scriptTiming(script, 4.5).lines.filter(row => row.spoken)
  return (
    <div className="md-vd-narrate">
      {recorder.phase === 'recording' ? (
        <button type="button" className="md-btn is-danger-solid is-wide" onClick={stop}><span className="md-vd-stop" />{t('停止并保存旁白（{time}）', { time: fmtClock(recorder.elapsed) })}</button>
      ) : (
        <button type="button" className="md-btn is-wide" disabled={recorder.phase === 'saving'} onClick={start}><LIcon name="mic" size={15} />{recorder.phase === 'saving' ? t('正在保存…') : t('现在录一段旁白')}</button>
      )}
      <span className="md-vd-meta">{t('只开麦克风。照着口播稿念，念完点停止。')}</span>
      {error ? <p className="md-vd-alert is-error">{error}</p> : null}
      {recorder.phase === 'recording' && lines.length ? <ol className="md-vd-read">{lines.map(row => <li key={row.index}>{row.text}</li>)}</ol> : null}
    </div>
  )
}

/** 模板卡片上的示意小样。 */
function Thumb({ id, colors, title }) {
  const ref = React.useRef(null)
  React.useEffect(() => { if (ref.current) drawThumb(ref.current, id, colors, title) }, [id, colors, title])
  return <canvas ref={ref} className="md-fin-thumb" aria-hidden="true" />
}

/** 画面按画幅放到舞台里能放下的最大尺寸，居中。 */
function useFit(stage, aspect) {
  const [box, setBox] = React.useState({ w: 0, h: 0 })
  React.useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const [W, H] = SIZES[aspect]
    const fit = () => {
      const pad = 24
      const aw = Math.max(0, el.clientWidth - pad * 2)
      const ah = Math.max(0, el.clientHeight - pad * 2)
      const k = Math.min(aw / W, ah / H)
      setBox({ w: Math.floor(W * k), h: Math.floor(H * k) })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [stage, aspect])
  return box
}

function SlotField({ name, value, onChange }) {
  const list = LIST_SLOTS.has(name)
  return (
    <label className="md-ed-field">
      <span>{t(SLOT_LABEL[name])}</span>
      <input type="text" value={list ? (value ?? []).join('、') : value ?? ''} placeholder={list ? t('用顿号隔开') : ''}
        onChange={e => onChange(list ? e.target.value.split(/[、,，]/).map(v => v.trim()).filter(Boolean) : e.target.value)} />
    </label>
  )
}

export function FinishTab({ item, script, rate, onBusy, onRecord }) {
  const production = item.production
  const takes = production.takes ?? []
  const signature = useDesk(s => s.state.author?.signature ?? '')
  const sources = takes.filter(row => row.kind !== 'render' && row.kind !== 'voice')
  const bestSource = () => (sources.filter(row => row.from).at(-1) ?? sources.at(-1))?.id ?? ''
  // 默认模板跟着素材走：没有录像时，从图文能做的模板里选
  const [templateId, setTemplateId] = React.useState(() => {
    const saved = templateById(readPref('template', ''))
    if (readPref('template', '') && (saved.source !== 'take' || sources.length)) return saved.id
    return sources.length ? 'talk-tight' : 'picture-talk'
  })
  const template = templateById(templateId)
  const [sourceId, setSourceId] = React.useState(() => (template.source === 'images' ? '' : bestSource()))
  // 只用图文的模板不接录像
  const source = template.source === 'images' ? null : sources.find(row => row.id === sourceId) ?? null
  const [aspect, setAspect] = React.useState(template.aspect)
  const [frameStyle, setFrameStyle] = React.useState(() => readPref('frameStyle', 'bleed'))
  const [themeId, setThemeId] = React.useState(chosenTheme)
  const [voiceId, setVoiceId] = React.useState(() => takes.filter(row => row.kind === 'voice').at(-1)?.id ?? '')
  const lines = React.useMemo(() => scriptTiming(script, rate).lines.filter(row => row.spoken).map(row => row.text), [script, rate])
  const [slots, setSlots] = React.useState(() => ({ ...defaultSlots({ title: production.title, lines }), ...readPref(`slots:${item.id}`, {}) }))
  const [filling, setFilling] = React.useState(false)
  const [quality, setQuality] = React.useState(() => readPref('previewQuality', defaultQuality()))
  const [preview, setPreview] = React.useState(1)
  const [playing, setPlaying] = React.useState(false)
  const [fps, setFps] = React.useState(null)
  const [images, setImages] = React.useState(null)
  const [render, setRender] = React.useState({ phase: 'idle', progress: 0, began: 0 })
  const [made, setMade] = React.useState(null)
  const [status, setStatus] = React.useState(null)
  const [busyVoice, setBusyVoice] = React.useState(false)
  const [cutting, setCutting] = React.useState(false)
  const canvas = React.useRef(null)
  const stage = React.useRef(null)
  const previewVideo = React.useRef(null)
  const abort = React.useRef(null)
  const audio = React.useRef(null)
  const context = () => { audio.current ??= new AudioContext(); return audio.current }
  React.useEffect(() => writePref('template', templateId), [templateId])
  React.useEffect(() => writePref('frameStyle', frameStyle), [frameStyle])
  React.useEffect(() => writePref(`slots:${item.id}`, slots), [item.id, slots])
  React.useEffect(() => writePref('previewQuality', quality), [quality])
  React.useEffect(() => () => { abort.current?.abort(); audio.current?.close().catch(() => {}) }, [])
  React.useEffect(() => { onBusy(render.phase !== 'idle' || busyVoice || cutting) }, [render.phase, busyVoice, cutting, onBusy])
  React.useEffect(() => {
    let live = true
    hostRequest('video/status').then(data => live && setStatus(data)).catch(() => live && setStatus({ ffmpeg: false }))
    return () => { live = false }
  }, [])

  const pick = (next) => {
    const tpl = templateById(next)
    setTemplateId(next)
    setAspect(tpl.aspect)
    if (tpl.source === 'images') setSourceId('')
    else if (tpl.source === 'take' && !source) setSourceId(bestSource())
  }

  const voiceTake = source ? null : takes.find(row => row.id === voiceId && row.kind !== 'render') ?? null
  const narration = useNarration(voiceTake, context)
  const speech = useSpeechRanges(source)
  const theme = YANQI_THEMES.find(row => row.id === themeId) ?? YANQI_THEMES[0]
  const colors = React.useMemo(() => themeColors(theme), [theme])
  const base = React.useMemo(() => ({
    title: production.title || item.title, shots: production.shots ?? [], images: production.images ?? [], cover: production.cover,
    script, rate, signature, slots, thumbLog: lines.slice(0, 3).map((text, i) => ({ t: i * 4, text })),
  }), [production, item.title, script, rate, signature, slots, lines])
  const plan = React.useMemo(() => planMontage({
    ...base, template, narration: narration.status === 'ready' ? narration.duration : 0,
    video: source ? { duration: source.seconds, log: source.log, speech: speech ?? [] } : null,
  }), [base, template, narration, source, speech])
  const size = SIZES[aspect]
  const scale = quality === 'smooth' ? 0.5 : 1
  React.useEffect(() => {
    let live = true
    loadImages(planMontage({ ...base, template: null })).then(map => live && setImages(map))
    return () => { live = false }
  }, [base])

  const draw = React.useCallback((at) => {
    const el = canvas.current
    if (!el || !images) return
    const w = Math.round(size[0] * scale)
    const h = Math.round(size[1] * scale)
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
    const ctx = el.getContext('2d')
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawFrame(ctx, plan, Math.min(at, plan.total - 0.01), { W: size[0], H: size[1], colors, images, video: previewVideo.current, frameStyle })
  }, [plan, images, size, scale, colors, frameStyle])
  // 拖动预览：录像模式先跳到那一帧，跳好再画
  React.useEffect(() => {
    if (render.phase !== 'idle' || playing) return
    const v = previewVideo.current
    if (source && v && preview < plan.body) {
      const onSeeked = () => draw(preview)
      v.addEventListener('seeked', onSeeked, { once: true })
      // 成片可能把开头那段空场剪掉了：预览要按同样的偏移去取源视频的那一帧
      v.currentTime = Math.min((plan.sourceFrom ?? 0) + preview, Math.max(0, (v.duration || source.seconds) - 0.05))
      draw(preview)
      return () => v.removeEventListener('seeked', onSeeked)
    }
    draw(preview)
    return undefined
  }, [draw, preview, render.phase, playing, source, plan.body])

  // 播放预览：按真实时间画，画不过来就跳帧；顺便量一下帧率
  React.useEffect(() => {
    if (!playing) return undefined
    const v = previewVideo.current
    let raf = 0
    let began = null
    const from = preview >= plan.total - 0.1 ? 0 : preview
    let frames = 0
    let window0 = performance.now()
    const shift = plan.sourceFrom ?? 0
    if (source && v) { v.currentTime = Math.min(shift + from, shift + plan.body); v.muted = true; v.play().catch(() => {}) }
    const tick = (now) => {
      began ??= now
      const elapsed = source && v && !v.ended ? v.currentTime - shift : Infinity
      const at = elapsed < plan.body ? elapsed : from + (now - began) / 1000
      if (at >= plan.total) { setPlaying(false); setPreview(plan.total); return }
      draw(at)
      frames += 1
      if (now - window0 > 1000) { setFps(Math.round((frames * 1000) / (now - window0))); frames = 0; window0 = now; setPreview(at) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); v?.pause() }
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  const fill = async () => {
    setFilling(true)
    try {
      const data = await hostRequest('video/template-slots', { id: item.id, script, keys: template.slots })
      setSlots(s => ({ ...s, ...data.slots }))
      toast(t('模板文字填好了，都可以改'))
    } catch (err) {
      report(err)
    } finally {
      setFilling(false)
    }
  }
  // 录像类模板：按模板的剪辑规则先粗剪成一条新录像，再用它做成片
  const autoCut = async () => {
    setCutting(true)
    try {
      const { db, duration } = await decodeTakeAudio(source.src)
      const rules = template.cut ?? {}
      const keep = keepRanges(buildRegions(duration, detectSilences(db, { threshold: rules.threshold, minGap: rules.minGap, pad: rules.margin, minClip: rules.minClip })), region => !region.silence)
      const data = await hostRequest('video/cut', { id: item.id, takeId: source.id, keep, mode: 'encode' })
      setDesk({ state: data.state })
      if (data.take) setSourceId(data.take.id)
      toast(t('按「{name}」的规则剪好了：{from} → {to}', { name: t(template.name), from: fmtClock(duration), to: fmtClock(data.take?.seconds ?? 0) }))
    } catch (err) {
      report(err.code === 'no-audio' ? new Error(t('这条录像里没有声音，没法按停顿剪。')) : err)
    } finally {
      setCutting(false)
    }
  }
  const start = async () => {
    setPlaying(false)
    const controller = new AbortController()
    abort.current = controller
    setMade(null)
    const began = performance.now()
    setRender({ phase: 'rendering', progress: 0, began })
    try {
      const result = await renderMontage({
        plan, size, colors, images: images ?? new Map(), canvas: canvas.current, context: context(),
        narration: !source && narration.status === 'ready' ? narration.buffer : null, videoSrc: source?.src ?? null,
        frameStyle,
        signal: controller.signal, onProgress: progress => setRender(r => ({ ...r, progress })),
      })
      if (!result) { toast(t('已取消渲染')); return }
      setRender(r => ({ ...r, phase: 'saving', progress: 1 }))
      const take = await saveTake(result.blob, { itemId: item.id, kind: 'render', seconds: result.seconds, title: production.title || item.title })
      if (take && typeof take === 'object') setMade({ ...take, stats: { frames: result.frames, dropped: result.dropped, ms: Math.round(performance.now() - began) } })
    } catch (err) {
      report(err.code === 'video-blocked'
        ? new Error(t('浏览器没让这条录像自动播放，渲染停住了。点一下画面里的播放按钮，再点一次生成视频。'))
        : err)
    } finally {
      abort.current = null
      setRender({ phase: 'idle', progress: 0, began: 0 })
    }
  }
  const latest = made ?? takes.filter(row => row.kind === 'render').at(-1) ?? null
  const toMp4 = async () => {
    setCutting(true)
    try {
      const data = await hostRequest('video/cut', { id: item.id, takeId: latest.id, keep: [[0, latest.seconds]], mode: 'encode' })
      setDesk({ state: data.state })
      setMade(data.take)
      toast(t('已转成 MP4，存成了一条新录像'))
    } catch (err) {
      report(err)
    } finally {
      setCutting(false)
    }
  }
  const rendering = render.phase !== 'idle'
  const elapsed = rendering && render.progress > 0.02 ? (performance.now() - render.began) / 1000 : 0
  const left = rendering ? (render.progress > 0.02 ? elapsed / render.progress - elapsed : plan.total) : 0
  const needsTake = template.source === 'take' && !source
  const fit = useFit(stage, aspect)
  // 主按钮不能点时，旁边说清楚为什么
  const blocker = needsTake ? t('这个模板要一条录像')
    : !images ? t('正在载入配图…')
      : narration.status === 'loading' ? t('正在读旁白的声音…')
        : busyVoice ? t('正在录旁白，录完再生成')
          : cutting ? t('正在粗剪或转换，等它结束')
            : null
  return (
    <div className="md-fin">
      <aside className="md-fin-gallery" aria-label={t('剪辑模板')}>
        <h4 className="md-ed-h">{t('剪辑模板')}</h4>
        {TEMPLATES.map(row => (
          <button type="button" key={row.id} className={`md-fin-card ${row.id === template.id ? 'is-on' : ''}`} aria-pressed={row.id === template.id} disabled={rendering} onClick={() => pick(row.id)}>
            <Thumb id={row.id} colors={colors} title={production.title || item.title} />
            <span className="md-fin-card-text">
              <b>{t(row.name)}<em>{row.aspect === 'portrait' ? '9:16' : '16:9'} · {row.source === 'take' ? t('用录像') : row.source === 'images' ? t('用图文') : t('录像或图文')}</em></b>
              <small>{t(row.desc)}</small>
            </span>
          </button>
        ))}
      </aside>
      <section className="md-fin-stage">
        <div className="md-fin-canvas" ref={stage}>
          {needsTake ? (
            <div className="md-fin-empty">
              <LIcon name="video" size={30} />
              <p>{t('「{name}」是拿录像来剪的，这篇还没有录像。', { name: t(template.name) })}</p>
              <div className="md-vd-row is-center">
                <button type="button" className="md-btn is-primary" onClick={onRecord}><LIcon name="video" size={15} />{t('去录一条')}</button>
                <button type="button" className="md-btn" onClick={() => pick('picture-talk')}><LIcon name="clapperboard" size={15} />{t('换成图文模板')}</button>
              </div>
            </div>
          ) : (
            <canvas key={`${template.id}-${aspect}`} ref={canvas} aria-label={t('成片画面预览')} style={{ width: fit.w, height: fit.h }} />
          )}
        </div>
        <video ref={previewVideo} src={source?.src} muted playsInline preload="auto" hidden />
        {needsTake ? null : (
          <>
        <div className="md-ed-transport">
          <button type="button" className="md-ed-play" disabled={rendering || !images} onClick={() => setPlaying(p => !p)} aria-label={playing ? t('暂停预览') : t('播放预览')} title={playing ? t('暂停预览') : t('播放预览（不出声）')}><LIcon name={playing ? 'pause' : 'play'} size={18} /></button>
          <input className="md-fin-scrub" type="range" min="0" max={plan.total} step="0.05" value={Math.min(preview, plan.total)} disabled={rendering} onChange={e => { setPlaying(false); setPreview(Number(e.target.value)) }} aria-label={t('预览时间')} />
          <span className="md-ed-time"><b>{fmtClock(preview, { tenths: true })}</b> / {fmtClock(plan.total, { tenths: true })}</span>
          <Segmented label={t('预览清晰度')} value={quality} onChange={setQuality} options={[{ value: 'smooth', label: t('流畅'), title: t('预览用一半分辨率，慢电脑更顺；成片不受影响') }, { value: 'sharp', label: t('清晰') }]} />
          {fps && playing ? <span className="md-vd-meta">{t('{n} 帧/秒', { n: fps })}</span> : null}
        </div>
        <ol className="md-fin-scenes">
          {plan.scenes.map((scene, i) => (
            <li key={i} style={{ flexGrow: Math.max(0.6, scene.end - scene.start) }}>
              <button type="button" className={preview >= scene.start && preview < scene.end ? 'is-on' : ''} onClick={() => { setPlaying(false); setPreview(scene.start + Math.min(1, (scene.end - scene.start) / 2)) }} title={`${fmtClock(scene.start, { tenths: true })} ${scene.text}`}>
                {scene.kind === 'title' ? t('片头') : scene.kind === 'end' ? t('片尾') : scene.kind === 'video' ? t('录像') : scene.kind === 'chapter' ? t('章节 {n}', { n: scene.no }) : `${scene.no}`}
              </button>
            </li>
          ))}
        </ol>
          </>
        )}
        {rendering ? (
          <div className="md-fin-render">
            <div className="md-vd-progress" role="progressbar" aria-valuenow={Math.round(render.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${render.progress * 100}%` }} /></div>
            <span className="md-vd-meta">{render.phase === 'saving' ? t('正在保存…') : t('{p}% · 还要约 {left}', { p: Math.round(render.progress * 100), left: fmtClock(left) })}</span>
            <button type="button" className="md-btn" onClick={() => abort.current?.abort()} disabled={render.phase === 'saving'}>{t('取消渲染')}</button>
          </div>
        ) : (
          <div className="md-fin-render">
            <button type="button" className="md-btn is-primary is-big" disabled={Boolean(blocker)} onClick={start} data-plan-total={plan.total.toFixed(2)}><LIcon name="clapperboard" size={16} />{t('生成视频（实时渲染约 {time}）', { time: fmtClock(plan.total) })}</button>
            {blocker ? <span className="md-vd-why"><LIcon name="flag-triangle-right" size={13} />{blocker}</span> : <span className="md-vd-meta">{t('{w}×{h} 全分辨率，存成这篇的一条录像。渲染时别切走这个页面，浏览器会暂停绘制。', { w: size[0], h: size[1] })}</span>}
          </div>
        )}
        {latest ? (
          <div className="md-fin-made">
            <TakeVideo src={latest.src} />
            <div>
              <b>{t('生成的视频')}</b>
              <span className="md-vd-meta">{takeLabel(latest, takes)} · {fmtClock(latest.seconds)}{made?.stats ? ` · ${t('渲染 {s} 秒，{f} 帧，跳过 {d} 帧', { s: (made.stats.ms / 1000).toFixed(1), f: made.stats.frames, d: made.stats.dropped })}` : ''}</span>
              <div className="md-vd-row">
                <a className="md-btn is-small" href={latest.src} download={`${safeName(production.title)}${latest.src.slice(latest.src.lastIndexOf('.'))}`}><LIcon name="package" size={13} />{t('下载')}</a>
                {status?.ffmpeg && latest.src.endsWith('.webm') ? <button type="button" className="md-btn is-small" disabled={cutting} onClick={toMp4}><LIcon name="clapperboard" size={13} />{cutting ? t('正在转换…') : t('转成 MP4（H.264）')}</button> : null}
              </div>
              {status && !status.ffmpeg ? <span className="md-vd-meta">{t('抖音、视频号一般要 MP4。这台电脑没有 ffmpeg，可以用剪映等工具导入 webm 再导出。')}</span> : null}
            </div>
          </div>
        ) : null}
      </section>
      <aside className="md-fin-insp">
        <section className="md-ed-sec">
          <h4 className="md-ed-h">{t(template.name)}</h4>
          <p className="md-vd-meta">{t(template.desc)}</p>
          <label className="md-ed-field"><span>{t('素材')}</span>
            <select className="md-vd-select" value={source?.id ?? ''} disabled={rendering || template.source === 'images'} onChange={e => setSourceId(e.target.value)}>
              {template.source === 'take' && sources.length ? null : <option value="">{t('这篇的图文（分镜、配图、文字卡）')}</option>}
              {template.source === 'images' ? null : [...sources].reverse().map(row => <option key={row.id} value={row.id}>{takeLabel(row, takes)} · {fmtClock(row.seconds)}</option>)}
            </select>
            {template.source === 'images' ? <small className="md-vd-meta">{t('这个模板只用这篇的图文，不接录像。')}</small> : null}
            {template.source === 'take' && !sources.length ? <small className="md-vd-meta">{t('这个模板要一条录像，这篇还没有。')}</small> : null}
          </label>
          {source && !source.from && template.cut && status?.ffmpeg ? <button type="button" className="md-btn is-wide" disabled={cutting || rendering} onClick={autoCut}><LIcon name="scissors" size={14} />{cutting ? t('正在按模板规则粗剪…') : t('先按模板规则粗剪这条录像')}</button> : null}
          {source ? <p className="md-vd-meta">{plan.captionSource === 'log' ? t('字幕用这条录像的提词记录排时间（录制时真实的换句时刻）。')
            : plan.captionSource === 'speech' ? t('字幕按这条录像里真正出声的段落排时间：没人说话的地方不挂字幕。')
              : t('这条录像没有提词记录，也还没分析出声音，字幕按口播稿和语速估时间，可能和嘴型对不齐。')}</p> : null}
          <div className="md-ed-field"><span>{t('画幅')}</span><Segmented label={t('画幅')} value={aspect} onChange={v => !rendering && setAspect(v)} options={[{ value: 'portrait', label: t('竖屏 9:16') }, { value: 'landscape', label: t('横屏 16:9') }]} /></div>
          {source ? (
            <div className="md-ed-field">
              <span>{t('录像边框风格')}</span>
              <Segmented label={t('录像边框风格')} value={frameStyle} onChange={v => !rendering && setFrameStyle(v)} options={[{ value: 'bleed', label: t('标准铺满') }, { value: 'window', label: t('圆角桌面窗') }]} />
            </div>
          ) : null}
          <label className="md-ed-field"><span>{t('配色（言起主题）')}</span>
            <select className="md-vd-select" value={theme.id} disabled={rendering} onChange={e => setThemeId(e.target.value)}>{YANQI_THEMES.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          </label>
        </section>
        <section className="md-ed-sec">
          <h4 className="md-ed-h">{t('模板里的文字')}</h4>
          {template.slots.filter(key => SLOT_KEYS.includes(key)).map(key => <SlotField key={key} name={key} value={slots[key]} onChange={value => setSlots(s => ({ ...s, [key]: value }))} />)}
          <button type="button" className="md-btn is-wide" disabled={filling || !script} onClick={fill}><LIcon name="wand-sparkles" size={14} />{filling ? t('正在填…') : t('用 AI 从稿子里填这些文字')}</button>
          <p className="md-vd-meta">{t('调用一次文字模型，只用稿子里的事实；填完都能改。钩子显示在开头 {n} 秒。', { n: HOOK_SEC })}</p>
        </section>
        {!source ? (
          <section className="md-ed-sec">
            <h4 className="md-ed-h">{t('旁白')}</h4>
            <p className="md-vd-alert">{t('没有内置配音：浏览器自带的朗读（语音合成）录不进视频，旁白要用你自己的声音。不选旁白就是一条无声视频，只有画面和字幕。')}</p>
            <select className="md-vd-select" value={voiceId} disabled={rendering} onChange={e => setVoiceId(e.target.value)}>
              <option value="">{t('不要旁白（无声，只有字幕）')}</option>
              {[...takes].filter(row => row.kind !== 'render').reverse().map(row => <option key={row.id} value={row.id}>{takeLabel(row, takes)} · {fmtClock(row.seconds)}</option>)}
            </select>
            {narration.status === 'loading' ? <p className="md-vd-meta"><span className="md-shimmer">{t('正在读旁白的声音…')}</span></p> : null}
            {narration.status === 'error' ? <p className="md-vd-alert is-error">{narration.error}</p> : null}
            {narration.status === 'ready' ? <p className="md-vd-meta">{t('旁白 {time}：正文按旁白长度等比调整，字幕跟着缩放。', { time: fmtClock(narration.duration, { tenths: true }) })}</p> : null}
            <NarrationRecorder item={item} script={script} onBusy={setBusyVoice} onSaved={take => setVoiceId(take.id)} />
          </section>
        ) : null}
      </aside>
    </div>
  )
}
