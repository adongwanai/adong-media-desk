// 提词 + 录制：摄像头口播（提词浮在画面上，但只录摄像头那一路，提词不会进视频）和录屏（提词放在单独的小窗里）。
import React from 'react'
import { dispatchOps, hostRequest, report, setDesk, toast, uploadFile } from '../desk.js'
import { t } from '../i18n.js'
import { Icon, Segmented } from '../ui.jsx'
import { fmtClock, scriptTiming } from './captions.js'
import { bubbleRect, cameraAspect, canCompositeFaces, clampFace, containRect, FACE_DEFAULT_SIZE, faceWorkerSource, hitFace, hitHandle, resetFace, resizeFace, resizeHandle } from './face.js'
import { createPrompter, downloadBlob, openPrompterWindow, readPref, safeName, writePref } from './prompter.js'

const MAX_UPLOAD = 250_000_000
const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']

/** 挑一个这个浏览器能录的格式：Chrome 是 webm，Safari 是 mp4。 */
export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

/** 这个环境能做什么。桌面版是 Electron，录屏要宿主开放，只能试了才知道。 */
export function captureSupport() {
  const md = typeof navigator === 'undefined' ? null : navigator.mediaDevices
  return {
    secure: typeof window !== 'undefined' && window.isSecureContext,
    camera: Boolean(md?.getUserMedia),
    screen: Boolean(md?.getDisplayMedia),
    recorder: typeof MediaRecorder !== 'undefined',
    desktop: typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent),
  }
}

/** 把浏览器的报错翻成能照着做的话。 */
export function mediaError(err, kind) {
  const name = err?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return kind === 'screen'
      ? t('没有拿到录屏权限：可能是在选择窗口时点了取消，或者系统没允许。macOS 要在「系统设置 → 隐私与安全性 → 屏幕与系统录音」里给这个浏览器打勾，然后重开浏览器。')
      : t('没有拿到摄像头或麦克风权限。点地址栏左边的权限图标改成允许，再点一次。桌面版里一直被拒绝的话，用网页模式在 Chrome 里打开工作台。')
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('没有找到摄像头或麦克风。插好设备后再试。')
  if (name === 'NotReadableError' || name === 'AbortError') return t('设备被别的程序占着（比如会议软件），关掉它再试。')
  if (name === 'NotSupportedError' || name === 'TypeError' || name === 'InvalidStateError') {
    return kind === 'screen'
      ? t('这个窗口里不能录屏：DeepSeek Harness 桌面版没有开放屏幕共享。用网页模式在 Chrome 里打开工作台再录，或者用系统录屏（macOS 按 Shift+Command+5）录好后在下面上传。')
      : t('这个窗口里不能用摄像头。用网页模式在 Chrome 里打开工作台再试。')
  }
  return err?.message || String(err)
}

export function stopStream(stream) {
  stream?.getTracks().forEach(track => track.stop())
}

/** 把录好的视频存进工作台，登记成这篇的一条录像。存不进去时把文件交给用户，不让录好的东西丢掉。 */
export async function saveTake(blob, { itemId, kind, seconds, title, log }) {
  // 只录声音时浏览器给的是 audio/webm 或 audio/mp4，容器一样，按视频文件存
  const type = /mp4/.test(blob.type) ? 'video/mp4' : 'video/webm'
  const file = new Blob([blob], { type })
  const fallback = () => downloadBlob(file, `${safeName(title)}-${kind}.${type === 'video/mp4' ? 'mp4' : 'webm'}`)
  if (file.size > MAX_UPLOAD) {
    fallback()
    toast(t('这条录像有 {mb} MB，超过工作台单个文件 250 MB 的上限，已经下载到这台电脑。', { mb: Math.round(file.size / 1e6) }), { error: true })
    return false
  }
  try {
    const { src } = await uploadFile(file)
    const result = await dispatchOps([{ op: 'add_take', id: itemId, src, kind, seconds: Math.round(seconds * 10) / 10, ...(log?.length ? { log } : {}) }], { label: t('存好一条录像'), undoable: false, silent: true })
    if (!result || result.errors?.length) throw new Error(result?.errors?.[0] ?? t('上传失败'))
    toast(t('录像已保存（{time}）', { time: fmtClock(seconds) }))
    return result.receipts?.[0]?.take ?? true
  } catch (err) {
    fallback()
    toast(t('录像没存进工作台（{error}），已经下载到这台电脑。', { error: err.message }), { error: true })
    return false
  }
}

/** 录一路流，停下时自动保存。组件卸载时如果还在录，也会停下并保存。mark 记下提词换句的时刻。 */
export function useRecorder({ itemId, kind, title, onSaved }) {
  const ref = React.useRef(null)
  const [phase, setPhase] = React.useState('idle')
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    if (phase !== 'recording') return undefined
    const timer = setInterval(() => setElapsed((performance.now() - ref.current.started) / 1000), 250)
    return () => clearInterval(timer)
  }, [phase])
  /** @param {MediaStream} stream @param {{audioOnly?: boolean, beforeStop?: () => Promise<void>|void}} [options] */
  const start = (stream, { audioOnly = false, beforeStop } = {}) => {
    // 只录旁白时用音频格式；webm 和 mp4 容器一样能存成录像
    const mimeType = audioOnly ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported?.(type)) ?? '' : pickMime()
    // 每秒一个关键帧（浏览器不认这个选项就忽略），粗剪时「无损导出」的切点才能贴得近
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), ...(audioOnly ? {} : { videoKeyFrameIntervalDuration: 1000 }) })
    const chunks = []
    const session = { recorder, started: performance.now(), done: null, log: [], beforeStop }
    session.done = new Promise((resolve) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = async () => {
        const seconds = (performance.now() - session.started) / 1000
        setPhase('saving')
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' })
        const saved = blob.size ? await saveTake(blob, { itemId, kind, seconds, title, log: session.log }) : false
        if (saved && typeof saved === 'object') onSaved?.(saved)
        ref.current = null
        setPhase('idle')
        resolve()
      }
    })
    recorder.start(1000)
    ref.current = session
    setElapsed(0)
    setPhase('recording')
  }
  const stop = async () => {
    const session = ref.current
    if (session?.recorder.state !== 'recording') return session?.done ?? Promise.resolve()
    // 收尾动作（比如人脸淡出）在这一秒里做完再真正停，免得最后几帧是突然消失的
    if (session.beforeStop) {
      const then = session.beforeStop
      session.beforeStop = null
      try { await then() } catch { /* 收尾失败也照样保存 */ }
    }
    if (session.recorder.state === 'recording') session.recorder.stop()
    return session.done
  }
  React.useEffect(() => () => { if (ref.current?.recorder.state === 'recording') ref.current.recorder.stop() }, [])
  const mark = (text) => {
    const session = ref.current
    if (session?.recorder.state === 'recording' && text) session.log.push({ t: (performance.now() - session.started) / 1000, text })
  }
  return { phase, elapsed, start, stop, mark }
}

function usePrompterPrefs() {
  const [fontSize, setFontSize] = React.useState(() => readPref('fontSize', 34))
  const [speed, setSpeed] = React.useState(() => readPref('speed', 1))
  const [mirror, setMirror] = React.useState(() => readPref('mirror', false))
  const [countdown, setCountdown] = React.useState(() => readPref('countdown', 3))
  React.useEffect(() => writePref('fontSize', fontSize), [fontSize])
  React.useEffect(() => writePref('speed', speed), [speed])
  React.useEffect(() => writePref('mirror', mirror), [mirror])
  React.useEffect(() => writePref('countdown', countdown), [countdown])
  return { fontSize, setFontSize, speed, setSpeed, mirror, setMirror, countdown, setCountdown }
}

function PrompterControls({ prefs }) {
  return (
    <div className="md-vd-controls">
      <label className="md-vd-range"><span>{t('字号')}</span><input type="range" min="18" max="72" step="2" value={prefs.fontSize} onChange={e => prefs.setFontSize(Number(e.target.value))} /><b>{prefs.fontSize}</b></label>
      <label className="md-vd-range"><span>{t('速度')}</span><input type="range" min="0.5" max="2" step="0.1" value={prefs.speed} onChange={e => prefs.setSpeed(Number(e.target.value))} /><b>{prefs.speed.toFixed(1)}×</b></label>
      <label className="md-vd-check"><input type="checkbox" checked={prefs.mirror} onChange={e => prefs.setMirror(e.target.checked)} />{t('镜像（配提词玻璃用）')}</label>
      <label className="md-vd-check">{t('倒数')}<select value={prefs.countdown} onChange={e => prefs.setCountdown(Number(e.target.value))}>{[0, 3, 5].map(n => <option key={n} value={n}>{n ? t('{n} 秒', { n }) : t('不倒数')}</option>)}</select></label>
    </div>
  )
}

/** 空格暂停/继续提词；正在输入时不抢。 */
function useSpaceToggle(active, onToggle, onJump) {
  const toggle = React.useRef(onToggle)
  toggle.current = onToggle
  const jump = React.useRef(onJump)
  jump.current = onJump
  React.useEffect(() => {
    if (!active) return undefined
    const typing = target => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName) || target?.isContentEditable
    const onKey = (event) => {
      if (typing(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (event.type === 'keydown' && !event.repeat) toggle.current()
      }
      if (event.type === 'keydown' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        jump.current?.(event.key === 'ArrowUp' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [active])
}

function useCountdown() {
  const [left, setLeft] = React.useState(0)
  const timer = React.useRef(0)
  React.useEffect(() => () => clearInterval(timer.current), [])
  const run = (seconds, then) => {
    clearInterval(timer.current)
    if (!seconds) { setLeft(0); then(); return }
    setLeft(seconds)
    let n = seconds
    timer.current = setInterval(() => {
      n -= 1
      setLeft(n)
      if (n <= 0) {
        clearInterval(timer.current)
        then()
      }
    }, 1000)
  }
  const cancel = () => { clearInterval(timer.current); setLeft(0) }
  return { left, run, cancel }
}

function Problem({ text }) {
  return text ? <p className="md-vd-alert is-error" role="alert"><Icon name="close" size={14} />{text}</p> : null
}

function CameraRecorder({ item, lines, durations, prefs, onBusy }) {
  const support = captureSupport()
  const video = React.useRef(null)
  const track = React.useRef(null)
  const nodes = React.useRef([])
  const prompter = React.useRef(null)
  const [stream, setStream] = React.useState(null)
  const [asking, setAsking] = React.useState(false)
  const [error, setError] = React.useState('')
  const [playing, setPlaying] = React.useState(false)
  const title = item.production.title || item.title
  const recorder = useRecorder({ itemId: item.id, kind: 'camera', title })
  const countdown = useCountdown()
  const busy = recorder.phase !== 'idle' || countdown.left > 0
  // 提词换到哪一句、什么时候换的，跟着录像存下来，粗剪时按文稿剪用
  const mark = React.useRef(recorder.mark)
  mark.current = recorder.mark

  React.useEffect(() => { onBusy(busy) }, [busy, onBusy])
  // 关摄像头、切走或离开页面时把设备还回去
  React.useEffect(() => () => stopStream(stream), [stream])
  React.useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])
  React.useEffect(() => {
    if (!track.current) return undefined
    const controller = createPrompter({ track: track.current, lines: nodes.current.filter(Boolean), durations, speed: prefs.speed, anchor: 0.2, onState: setPlaying, onLine: i => mark.current(lines[i]) })
    prompter.current = controller
    return () => { controller.destroy(); prompter.current = null }
    // 提词浮层在摄像头打开后才出现，所以也跟着 stream 重建
  }, [lines, durations, Boolean(stream)]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { prompter.current?.setSpeed(prefs.speed) }, [prefs.speed])
  React.useEffect(() => { prompter.current?.refresh() }, [prefs.fontSize, stream])
  useSpaceToggle(Boolean(stream), () => prompter.current?.toggle(), delta => prompter.current?.jump(delta))

  const open = async () => {
    setError('')
    if (!support.camera) {
      setError(support.secure ? mediaError({ name: 'NotSupportedError' }, 'camera') : t('摄像头只能在 https 或本机地址（127.0.0.1 / localhost）下使用。换成本机地址打开工作台再试。'))
      return
    }
    setAsking(true)
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } }))
    } catch (err) {
      setError(mediaError(err, 'camera'))
    } finally {
      setAsking(false)
    }
  }
  const close = () => {
    prompter.current?.reset()
    setStream(null)
  }
  const record = () => {
    if (!support.recorder) { setError(t('这个浏览器不支持录制视频。请换新版 Chrome、Edge 或 Safari。')); return }
    prompter.current?.reset()
    countdown.run(prefs.countdown, () => {
      try {
        recorder.start(stream)
        mark.current(lines[prompter.current?.index() ?? 0])
        prompter.current?.play()
      } catch (err) {
        setError(mediaError(err, 'camera'))
      }
    })
  }
  const stop = async () => {
    countdown.cancel()
    prompter.current?.pause()
    await recorder.stop()
  }

  return (
    <div className="md-vd-recorder">
      <div className={`md-vd-stage ${stream ? 'is-live' : ''}`}>
        <video ref={video} className="md-vd-camera" autoPlay muted playsInline aria-label={t('摄像头画面')} />
        {stream ? (
          <div className={`md-vd-overlay ${prefs.mirror ? 'is-mirror' : ''}`} style={{ fontSize: prefs.fontSize }} aria-label={t('提词')}>
            <div className="md-vd-overlay-track" ref={track}>
              {lines.map((text, i) => <p key={i} ref={(el) => { nodes.current[i] = el }}>{text}</p>)}
            </div>
            <i className="md-vd-overlay-mark" aria-hidden="true" />
          </div>
        ) : (
          <div className="md-vd-stage-empty">
            <Icon name="user" size={30} />
            <p>{t('打开摄像头后，提词会浮在画面上方、靠近镜头的位置')}</p>
          </div>
        )}
        {countdown.left > 0 ? <div className="md-vd-count" aria-live="assertive">{countdown.left}</div> : null}
        {recorder.phase === 'recording' ? <span className="md-vd-rec"><i />{fmtClock(recorder.elapsed)}</span> : null}
        {recorder.phase === 'saving' ? <span className="md-vd-rec is-saving">{t('正在保存…')}</span> : null}
      </div>
      <Problem text={error} />
      <div className="md-vd-actions">
        {!stream ? (
          <button type="button" className="md-btn is-primary is-big" disabled={asking} onClick={open}><Icon name="user" size={16} />{asking ? t('等待授权…') : t('打开摄像头')}</button>
        ) : recorder.phase === 'recording' || countdown.left > 0 ? (
          <button type="button" className="md-btn is-danger-solid is-big" onClick={stop}><span className="md-vd-stop" />{t('停止并保存')}</button>
        ) : (
          <button type="button" className="md-btn is-primary is-big" disabled={recorder.phase === 'saving'} onClick={record}><span className="md-vd-dot" />{prefs.countdown ? t('开始录制（倒数 {n} 秒）', { n: prefs.countdown }) : t('开始录制')}</button>
        )}
        {stream && recorder.phase === 'idle' && countdown.left === 0 ? (
          <>
            <button type="button" className="md-btn" onClick={() => prompter.current?.toggle()}>{playing ? t('暂停提词') : t('试读提词')}</button>
            <button type="button" className="md-btn" onClick={() => prompter.current?.reset()}>{t('回到开头')}</button>
            <button type="button" className="md-btn" onClick={close}>{t('关闭摄像头')}</button>
          </>
        ) : null}
        {stream ? <span className="md-vd-hint">{t('空格暂停/继续提词，↑↓ 换句')}</span> : null}
      </div>
      <PrompterControls prefs={prefs} />
      <p className="md-vd-note"><Icon name="check" size={14} />{t('只录摄像头这一路画面和麦克风，提词是叠在页面上的文字，不会出现在录像里。预览是镜像的，录下来是正常方向。')}</p>
    </div>
  )
}

/** 人脸小窗的默认样子和存下来的偏好。 */
const FACE_DEFAULTS = { shape: 'circle', size: FACE_DEFAULT_SIZE, cx: 0.82, cy: 0.78 }
function readFacePrefs() {
  const saved = readPref('face', null)
  if (!saved || typeof saved !== 'object') return { ...FACE_DEFAULTS }
  return {
    shape: saved.shape === 'rect' ? 'rect' : 'circle',
    size: Math.min(0.5, Math.max(0.08, Number(saved.size) || FACE_DEFAULTS.size)),
    cx: Number.isFinite(saved.cx) ? saved.cx : FACE_DEFAULTS.cx,
    cy: Number.isFinite(saved.cy) ? saved.cy : FACE_DEFAULTS.cy,
  }
}

const FACE_FADE_IN = 600
const FACE_FADE_OUT = 400

/**
 * 录屏的画中画：屏幕画面打底，摄像头人脸按位置、形状、大小叠上去，两路一起录。
 * 合成在 Worker 里做，页面被切到后台也不会停画；预览直接看合成结果，摆成什么样就录成什么样。
 */
function ScreenRecorder({ item, lines, durations, prefs, onBusy }) {
  const support = captureSupport()
  const preview = React.useRef(null)
  const camPreview = React.useRef(null)
  const stage = React.useRef(null)
  const popup = React.useRef(null)
  const capture = React.useRef(null)
  const camera = React.useRef(null)
  const faceRef = React.useRef(readFacePrefs())
  const [face, setFaceState] = React.useState(faceRef.current)
  const [camState, setCamState] = React.useState('off')
  const [camError, setCamError] = React.useState('')
  const [popupOpen, setPopupOpen] = React.useState(false)
  const [popupBlocked, setPopupBlocked] = React.useState(false)
  const [withMic, setWithMic] = React.useState(() => readPref('screenMic', true))
  const [error, setError] = React.useState('')
  const [warning, setWarning] = React.useState('')
  const [live, setLive] = React.useState(false)
  const [sourceSize, setSourceSize] = React.useState({ w: 0, h: 0 })
  const [starting, setStarting] = React.useState(false)
  const [stageSize, setStageSize] = React.useState({ w: 0, h: 0 })
  const title = item.production.title || item.title
  const recorder = useRecorder({ itemId: item.id, kind: 'screen', title })
  const countdown = useCountdown()
  const composable = canCompositeFaces()
  const busy = live || starting || recorder.phase !== 'idle'
  const mark = React.useRef(recorder.mark)
  mark.current = recorder.mark

  /** 改人脸：存偏好，同时悄悄推给正在跑的合成。 */
  const setFace = (next) => {
    faceRef.current = next
    setFaceState(next)
    writePref('face', next)
    capture.current?.worker?.postMessage({ type: 'face', face: next })
  }

  React.useEffect(() => { onBusy(busy) }, [busy, onBusy])
  // 脸框里的小视频：开着摄像头、还没开录时放摄像头原画面，方便先看清位置
  React.useEffect(() => {
    const el = camPreview.current
    if (!el) return
    el.srcObject = camState === 'on' && !live ? camera.current : null
  }, [camState, live])
  React.useEffect(() => writePref('screenMic', withMic), [withMic])
  React.useEffect(() => { popup.current?.update({ fontSize: prefs.fontSize, speed: prefs.speed, mirror: prefs.mirror }) }, [prefs.fontSize, prefs.speed, prefs.mirror])
  // 稿子变了，小窗里的旧稿子没用了
  React.useEffect(() => () => { popup.current?.close(); popup.current = null; setPopupOpen(false) }, [lines])

  // 舞台的像素尺寸：拖动和缩放按它换算，和合成画布里的比例完全一致
  React.useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const sync = () => setStageSize({ w: el.clientWidth, h: el.clientHeight })
    sync()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [])
  // 滚轮缩放要阻止页面滚动：React 的 onWheel 挂在 passive 监听上拦不住，自己挂原生事件
  const wheelRef = React.useRef(() => {})
  React.useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const listener = (event) => wheelRef.current(event)
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
  }, [])

  // 镜头画面的真实尺寸：叠加层贴着视频里真正有画面的那块，不贴舞台（比例不同时舞台有黑边）
  React.useEffect(() => {
    if (!live || !preview.current) return undefined
    const el = preview.current
    const sync = () => {
      if (el.videoWidth && el.videoHeight) setSourceSize(prev => (prev.w === el.videoWidth && prev.h === el.videoHeight ? prev : { w: el.videoWidth, h: el.videoHeight }))
    }
    sync()
    const timer = setInterval(sync, 500)
    el.addEventListener('resize', sync)
    el.addEventListener('loadedmetadata', sync)
    return () => { clearInterval(timer); el.removeEventListener('resize', sync); el.removeEventListener('loadedmetadata', sync) }
  }, [live])

  /** 释放这次录屏占用的东西；摄像头单独管，录完一条还能接着录。 */
  const release = () => {
    const c = capture.current
    capture.current = null
    if (!c) return
    c.worker?.terminate()
    stopStream(c.display)
    stopStream(c.mic)
    c.reader?.cancel?.().catch(() => {})
    c.context?.close().catch(() => {})
    if (preview.current) preview.current.srcObject = null
    setLive(false)
    setSourceSize({ w: 0, h: 0 })
  }
  React.useEffect(() => () => { release(); stopStream(camera.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useSpaceToggle(popupOpen, () => popup.current?.toggle())

  const openPopup = () => {
    setPopupBlocked(false)
    const controller = openPrompterWindow({
      title, lines, durations, fontSize: prefs.fontSize, speed: prefs.speed, mirror: prefs.mirror,
      onClosed: () => { popup.current = null; setPopupOpen(false) },
      onLine: i => mark.current(lines[i]),
    })
    if (!controller) {
      setPopupBlocked(true)
      return
    }
    popup.current = controller
    setPopupOpen(true)
    controller.focus()
  }

  /** 开摄像头。拿不到就提示，录制照常不带人脸。 */
  const openCamera = async () => {
    setCamError('')
    if (!support.camera) { setCamState('unavailable'); setCamError(mediaError({ name: 'NotSupportedError' }, 'camera')); return }
    setCamState('asking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } })
      camera.current = stream
      const track = stream.getVideoTracks()[0]
      const aspect = cameraAspect(track)
      // 录到一半才开摄像头：直接把新画面换进正在跑的合成里
      const c = capture.current
      if (c?.worker) {
        const camProc = new MediaStreamTrackProcessor({ track: track.clone() })
        c.worker.postMessage({ type: 'cam', cam: camProc.readable, face: faceRef.current }, [camProc.readable])
        c.worker.postMessage({ type: 'fade', from: 0, to: 1, ms: FACE_FADE_IN })
      }
      // 关掉共享时浏览器会停掉摄像头这场；用户自己点「停止共享」时也要把状态改回来
      track.addEventListener('ended', () => { camera.current = null; setCamState('off') })
      setFaceAspect(aspect)
      setCamState('on')
    } catch (err) {
      setCamState('denied')
      setCamError(mediaError(err, 'camera'))
    }
  }
  const setFaceAspect = (aspect) => {
    faceRef.current = { ...faceRef.current, aspect }
    setFaceState(faceRef.current)
    capture.current?.worker?.postMessage({ type: 'face', face: faceRef.current })
  }
  const closeCamera = () => {
    stopStream(camera.current)
    camera.current = null
    setCamState('off')
    const c = capture.current
    if (c?.worker) c.worker.postMessage({ type: 'cam', cam: null })
  }

  const stop = async () => {
    countdown.cancel()
    popup.current?.pause()
    await recorder.stop()
    release()
  }

  const start = async () => {
    setError('')
    setWarning('')
    if (!support.screen) {
      setError(support.secure ? mediaError({ name: 'NotSupportedError' }, 'screen') : t('录屏只能在 https 或本机地址（127.0.0.1 / localhost）下使用。'))
      return
    }
    if (!support.recorder) { setError(t('这个浏览器不支持录制视频。请换新版 Chrome、Edge 或 Safari。')); return }
    setStarting(true)
    let display = null
    let mic = null
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window', frameRate: { ideal: 30 } }, audio: true, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include' })
      if (withMic) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        } catch (err) {
          setWarning(t('麦克风没打开（{reason}），这次只录画面和共享的声音。', { reason: mediaError(err, 'camera') }))
        }
      }
      const [videoTrack] = display.getVideoTracks()
      if (videoTrack.getSettings?.().displaySurface === 'monitor') setWarning(t('你共享的是整个屏幕：提词小窗如果也在这块屏幕上，会被一起录进去。把小窗拖到另一块屏幕，或者停下来改成共享单个窗口。'))
      // 共享的声音和麦克风混成一路
      const sources = [display, mic].filter(stream => stream?.getAudioTracks().length)
      let context = null
      let audioTracks = []
      if (sources.length) {
        context = new AudioContext()
        const mix = context.createMediaStreamDestination()
        for (const stream of sources) context.createMediaStreamSource(stream).connect(mix)
        await context.resume().catch(() => {})
        audioTracks = mix.stream.getAudioTracks()
      }
      const camTrack = camera.current?.getVideoTracks()[0] ?? null
      let output = new MediaStream([videoTrack, ...audioTracks])
      let worker = null
      if (composable) {
        // 屏幕画面交给 Worker 出一路新视频：主线程只管预览，录的时候把工作台切到后面也不会冻帧
        worker = new Worker(URL.createObjectURL(new Blob([faceWorkerSource()], { type: 'text/javascript' })))
        const screenProc = new MediaStreamTrackProcessor({ track: videoTrack.clone() })
        const camProc = camTrack ? new MediaStreamTrackProcessor({ track: camTrack.clone() }) : null
        const generator = new MediaStreamTrackGenerator({ kind: 'video' })
        worker.onerror = () => setWarning(t('画中画合成出错了，这次的视频里没有人脸（屏幕画面还在）。'))
        worker.onmessage = (event) => { if (event.data?.type === 'error') setWarning(t('画中画合成出错了，这次的视频里没有人脸（屏幕画面还在）。')) }
        worker.postMessage({
          type: 'run',
          screen: screenProc.readable,
          cam: camProc?.readable ?? null,
          out: generator.writable,
          face: camTrack ? faceRef.current : null,
        }, [screenProc.readable, generator.writable, ...(camProc ? [camProc.readable] : [])])
        output = new MediaStream([generator, ...audioTracks])
        // 预览看的就是要录的那一路：摆成什么样就录成什么样
        if (preview.current) preview.current.srcObject = new MediaStream([generator.clone()])
      } else {
        if (preview.current) preview.current.srcObject = display
        if (camState === 'on') setWarning(t('这个浏览器不支持把摄像头合成进录屏（要用新版 Chrome 或 Edge）。这次只录屏幕画面。'))
      }
      capture.current = { display, mic, context, output, worker }
      setLive(true)
      // 用户在浏览器自带的「停止共享」上点了停止
      videoTrack.addEventListener('ended', () => { stop() })
      const go = () => {
        try {
          // 淡入跟着开录走（预览阶段先让人脸稳定显示，免得摆位置时看不清）
          if (worker && camTrack) worker.postMessage({ type: 'fade', from: 0, to: 1, ms: FACE_FADE_IN })
          // 收尾时人脸先淡出，多录这一小段再停
          recorder.start(output, {
            beforeStop: camTrack && composable
              ? () => new Promise((resolve) => { worker.postMessage({ type: 'fade', from: 1, to: 0, ms: FACE_FADE_OUT }); setTimeout(resolve, FACE_FADE_OUT + 50) })
              : null,
          })
          if (popup.current?.isOpen()) mark.current(lines[popup.current.index()])
        } catch (err) {
          setError(mediaError(err, 'screen'))
          release()
        }
      }
      if (popup.current?.isOpen()) {
        countdown.run(prefs.countdown, () => {})
        popup.current.countdown(prefs.countdown, go)
      } else {
        countdown.run(prefs.countdown, go)
      }
    } catch (err) {
      stopStream(display)
      stopStream(mic)
      setError(mediaError(err, 'screen'))
    } finally {
      setStarting(false)
    }
  }

  // 画面区域：预览里真正有画面的那块（比例不同时外圈是黑边）
  const frame = live && sourceSize.w
    ? containRect(sourceSize.w, sourceSize.h, stageSize.w, stageSize.h)
    : { x: 0, y: 0, w: stageSize.w, h: stageSize.h, scale: 1 }
  const box = frame.w ? bubbleRect(face, frame.w, frame.h) : null
  const at = box ? { x: frame.x + box.x, y: frame.y + box.y, w: box.w, h: box.h, shape: box.shape } : null
  const handle = at ? resizeHandle(at) : null
  const editing = camState === 'on' && composable && at

  const localPoint = (event) => {
    const el = stage.current
    const r = el.getBoundingClientRect()
    return { x: ((event.clientX - r.left) / Math.max(1, r.width)) * stageSize.w, y: ((event.clientY - r.top) / Math.max(1, r.height)) * stageSize.h }
  }
  // 拖动人脸：按下时记住指针到中心的偏移，移动时按画面比例换算回去
  const drag = React.useRef(null)
  const onPointerDown = (event) => {
    if (!editing) return
    const { x, y } = localPoint(event)
    if (hitHandle(handle, x, y)) drag.current = { mode: 'resize', startX: x, startY: y, size: faceRef.current.size }
    else if (hitFace(at, x, y)) drag.current = { mode: 'move', dx: x - (at.x + at.w / 2), dy: y - (at.y + at.h / 2) }
    else return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event) => {
    const d = drag.current
    if (!d) return
    const { x, y } = localPoint(event)
    if (d.mode === 'move') {
      setFace(clampFace({ ...faceRef.current, cx: (x - d.dx - frame.x) / frame.w, cy: (y - d.dy - frame.y) / frame.h }, frame.w, frame.h))
    } else {
      // 往右下拖变大，往左上拖变小：两个方向各占一半，斜着拖最顺手
      const delta = ((x - d.startX) + (y - d.startY)) / 2 / Math.min(frame.w, frame.h)
      setFace(resizeFace({ ...faceRef.current, size: d.size }, delta, frame.w, frame.h))
    }
  }
  const onPointerUp = (event) => {
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  wheelRef.current = (event) => {
    if (!editing) return
    const { x, y } = localPoint(event)
    if (!hitFace(at, x, y)) return
    event.preventDefault()
    setFace(resizeFace(faceRef.current, (event.deltaY > 0 ? -1 : 1) * 0.02, frame.w, frame.h))
  }
  const onKeyFace = (event) => {
    if (!frame.w) return
    const step = event.shiftKey ? 0.04 : 0.01
    const nudge = (patch) => setFace(clampFace({ ...faceRef.current, ...patch }, frame.w, frame.h))
    if (event.key === 'ArrowLeft') { event.preventDefault(); nudge({ cx: faceRef.current.cx - step }) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); nudge({ cx: faceRef.current.cx + step }) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); nudge({ cy: faceRef.current.cy - step }) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); nudge({ cy: faceRef.current.cy + step }) }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); setFace(resizeFace(faceRef.current, 0.03, frame.w, frame.h)) }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); setFace(resizeFace(faceRef.current, -0.03, frame.w, frame.h)) }
  }

  const resizeBySlider = (value) => setFace(resizeFace({ ...faceRef.current, size: Number(value) / 100 }, 0, frame.w || 1920, frame.h || 1080))
  const resetFaceBox = () => setFace(resetFace(faceRef.current, frame.w || 1920, frame.h || 1080))

  const recording = recorder.phase === 'recording' || countdown.left > 0
  const shapeLabel = face.shape === 'circle' ? t('圆形') : t('矩形')
  return (
    <div className="md-vd-recorder">
      <ol className="md-vd-steps">
        <li className={popupOpen ? 'is-done' : ''}>
          <b>{t('打开提词小窗')}</b>
          <span>{t('把它拖到摄像头旁边。浏览器不能把小窗固定在最上层，别让要录的窗口挡住它。')}</span>
          <div className="md-vd-row">
            {popupOpen ? <button type="button" className="md-btn" onClick={() => popup.current?.focus()}>{t('切到提词小窗')}</button> : <button type="button" className="md-btn" onClick={openPopup}>{t('打开提词小窗')}</button>}
            {popupOpen ? <button type="button" className="md-btn" onClick={() => popup.current?.close()}>{t('关掉小窗')}</button> : null}
          </div>
          {popupBlocked ? <p className="md-vd-alert">{support.desktop ? t('桌面版不允许插件弹出新窗口。可以用网页模式在 Chrome 里打开工作台；或者把口播稿打印出来、放在第二块屏幕上念。') : t('小窗被浏览器拦住了。点地址栏右边的「已拦截弹出式窗口」，选允许，再点一次。')}</p> : null}
        </li>
        <li className={camState === 'on' ? 'is-done' : ''}>
          <b>{t('摄像头人脸（可选）')}</b>
          <span>{t('开了之后，屏幕录到的画面右下角会叠上你的脸。可以拖动、换圆形/矩形、拖角或滚轮缩放，录下来的位置和预览一致。')}</span>
          <div className="md-vd-row">
            {camState === 'on'
              ? <button type="button" className="md-btn" onClick={closeCamera}>{t('关掉摄像头')}</button>
              : <button type="button" className="md-btn" disabled={camState === 'asking'} onClick={openCamera}>{camState === 'asking' ? t('等待授权…') : t('打开摄像头')}</button>}
            {camState === 'on' ? <Segmented label={t('人脸形状')} value={face.shape} onChange={shape => setFace({ ...faceRef.current, shape })} options={[{ value: 'circle', label: t('圆形') }, { value: 'rect', label: t('矩形') }]} /> : null}
            {camState === 'on' ? <button type="button" className="md-btn" onClick={resetFaceBox}>{t('回到右下角')}</button> : null}
          </div>
          {camState === 'on' ? (
            <label className="md-vd-range"><span>{t('大小')}</span><input type="range" min="8" max="50" step="1" value={Math.round(face.size * 100)} onChange={e => resizeBySlider(e.target.value)} /><b>{Math.round(face.size * 100)}%</b></label>
          ) : null}
          {camError ? <p className="md-vd-alert" role="alert"><Icon name="close" size={14} />{camError}{camState === 'denied' || camState === 'unavailable' ? t('不影响录屏：不放人脸也能照常录。') : ''}</p> : null}
        </li>
        <li>
          <b>{t('选择要录的窗口')}</b>
          <span>{t('推荐共享「窗口」：只录那一个窗口，提词小窗不会被录进去。共享「整个屏幕」时，小窗在这块屏幕上就会被录进去。')}</span>
          <label className="md-vd-check"><input type="checkbox" checked={withMic} disabled={busy} onChange={e => setWithMic(e.target.checked)} />{t('同时录麦克风（和共享的声音混在一起）')}</label>
        </li>
      </ol>
      <div
        ref={stage}
        className={`md-vd-stage is-screen ${live ? 'is-live' : ''} ${editing ? 'has-face' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video ref={preview} className="md-vd-screen" autoPlay muted playsInline aria-label={t('录屏画面')} />
        {editing ? (
          <>
            <div
              className={`md-vd-face is-${at.shape}`}
              role="slider"
              tabIndex={0}
              aria-label={t('人脸小窗：拖动移位置，滚轮或拖右下角缩放，方向键微调')}
              aria-valuetext={t('{shape}，大小 {n}%', { shape: shapeLabel, n: Math.round(face.size * 100) })}
              aria-valuemin={8}
              aria-valuemax={50}
              aria-valuenow={Math.round(face.size * 100)}
              style={{ left: at.x, top: at.y, width: at.w, height: at.h, borderRadius: at.shape === 'circle' ? '50%' : Math.min(at.w, at.h) * 0.08 }}
              onKeyDown={onKeyFace}
            >
              {/* 人脸窗口本身的画面：录起来之后这里由合成画面盖住，开录前放摄像头原画面方便对位置 */}
              <video ref={camPreview} className="md-vd-face-cam" autoPlay muted playsInline aria-hidden="true" />
              <i className="md-vd-face-handle" style={{ right: -handle.r, bottom: -handle.r, width: handle.r * 2, height: handle.r * 2 }} aria-hidden="true" />
            </div>
            <span className="md-vd-face-tip">{t('拖动人脸调整位置，右下角拖角或滚轮改大小')}</span>
          </>
        ) : null}
        {!live ? <div className="md-vd-stage-empty"><Icon name="expand" size={28} /><p>{camState === 'on' ? t('开始后这里显示合成好的画面，人脸的位置和大小可以在这里先摆好') : t('开始后这里显示正在录的画面')}</p></div> : null}
        {countdown.left > 0 ? <div className="md-vd-count" aria-live="assertive">{countdown.left}</div> : null}
        {recorder.phase === 'recording' ? <span className="md-vd-rec"><i />{fmtClock(recorder.elapsed)}</span> : null}
        {recorder.phase === 'saving' ? <span className="md-vd-rec is-saving">{t('正在保存…')}</span> : null}
      </div>
      <Problem text={error} />
      {warning ? <p className="md-vd-alert">{warning}</p> : null}
      <div className="md-vd-actions">
        {recording ? (
          <button type="button" className="md-btn is-danger-solid is-big" onClick={stop}><span className="md-vd-stop" />{t('停止并保存')}</button>
        ) : (
          <button type="button" className="md-btn is-primary is-big" disabled={starting || recorder.phase === 'saving'} onClick={start}><span className="md-vd-dot" />{starting ? t('等你选择窗口…') : t('选择窗口并开始录屏')}</button>
        )}
        {popupOpen ? <span className="md-vd-hint">{t('小窗里按空格暂停/继续')}</span> : null}
      </div>
      <PrompterControls prefs={prefs} />
      <p className="md-vd-note"><Icon name="check" size={14} />{t('屏幕画面和摄像头在浏览器里实时合成后再录：录出来就是预览里看到的样子，位置、形状、大小都对得上。合成在后台线程里做，录的时候把工作台切到后面也不会卡住。人脸默认右下角、圆形，开录淡入、停下前淡出。')}</p>
    </div>
  )
}

/** 上传已经录好的视频（手机拍的、系统录屏），一样登记成这篇的录像。 */
export function UploadTake({ item, kind }) {
  const input = React.useRef(null)
  const [busy, setBusy] = React.useState(false)
  const onFile = async (file) => {
    if (!file) return
    setBusy(true)
    const url = URL.createObjectURL(file)
    const seconds = await new Promise((resolve) => {
      const probe = document.createElement('video')
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : 0)
      probe.onerror = () => resolve(0)
      probe.src = url
    })
    URL.revokeObjectURL(url)
    await saveTake(file, { itemId: item.id, kind, seconds, title: item.production.title || item.title })
    setBusy(false)
  }
  return (
    <>
      <button type="button" className="md-btn" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={14} />{busy ? t('上传中…') : t('上传已有视频')}</button>
      <input ref={input} type="file" hidden accept="video/mp4,video/webm" onChange={(e) => { const [file] = e.target.files; e.target.value = ''; onFile(file) }} />
    </>
  )
}

const KIND_LABEL = { camera: '摄像头', screen: '录屏', voice: '旁白', render: '成片' }

/** 录像预览。MediaRecorder 录的 webm 不写总时长，先跳到末尾让浏览器算出来，进度条才能拖。 */
export function TakeVideo({ src, children, className = '', videoRef, ...rest }) {
  const local = React.useRef(null)
  const ref = videoRef ?? local
  const onMeta = (event) => {
    const el = event.currentTarget
    if (el.duration !== Infinity) return
    const back = () => { el.removeEventListener('timeupdate', back); el.currentTime = 0 }
    el.addEventListener('timeupdate', back)
    el.currentTime = 1e7
  }
  return <video ref={ref} className={`md-vd-video ${className}`} src={src} controls preload="metadata" playsInline onLoadedMetadata={onMeta} {...rest}>{children}</video>
}

export function takeLabel(take, takes) {
  const tail = take.log?.length ? ` · ${t('带提词记录')}` : ''
  if (take.from) {
    const source = takes.find(row => row.id === take.from)
    if (take.kind === 'render') return t('成片 · MP4')
    return source ? t('粗剪 · 来自{kind}', { kind: t(KIND_LABEL[source.kind] ?? '录像') }) : t('粗剪')
  }
  return t(KIND_LABEL[take.kind] ?? '录像') + tail
}

function fmtAt(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TakeList({ item, onCut }) {
  const takes = item.production.takes ?? []
  const remove = take => setDesk({
    dialog: {
      title: t('删除这条录像'),
      submitLabel: t('删除'),
      fields: [{ name: 'note', type: 'hidden', label: t('录像文件会一起删掉，不能撤销。') }],
      onSubmit: async () => {
        try {
          const data = await hostRequest('video/delete-take', { id: item.id, takeId: take.id })
          setDesk({ state: data.state })
          toast(t('已删除录像'))
        } catch (err) {
          report(err)
        }
      },
    },
  })
  return (
    <section className="md-vd-card">
      <header className="md-vd-card-head">
        <h3>{t('这篇的录像')}</h3>
        <span className="md-vd-meta">{takes.length ? t('{n} 条', { n: takes.length }) : ''}</span>
        <span style={{ flex: 1 }} />
        <UploadTake item={item} kind="camera" />
      </header>
      {takes.length ? (
        <div className="md-vd-takes">
          {[...takes].reverse().map(take => (
            <figure key={take.id} className="md-vd-take">
              <TakeVideo src={take.src} />
              <figcaption>
                <div><b>{takeLabel(take, takes)}</b><span>{fmtClock(take.seconds)} · {fmtAt(take.at)}</span></div>
                <div className="md-vd-row">
                  <a className="md-btn is-small" href={take.src} download={`${safeName(item.production.title)}-${take.kind}${take.src.slice(take.src.lastIndexOf('.'))}`}><Icon name="save" size={13} />{t('下载')}</a>
                  {onCut && take.kind !== 'render' ? <button type="button" className="md-btn is-small" onClick={() => onCut(take.id)}><Icon name="film" size={13} />{t('自动粗剪')}</button> : null}
                  <button type="button" className="md-btn is-small is-danger" onClick={() => remove(take)}><Icon name="trash" size={13} />{t('删除')}</button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : <p className="md-vd-empty-line">{t('还没有录像。在上面录一条，或者上传手机拍好的视频。')}</p>}
    </section>
  )
}

export function RecordTab({ item, script, rate, onBusy, onCut }) {
  const [mode, setMode] = React.useState(() => (readPref('mode', 'camera') === 'screen' ? 'screen' : 'camera'))
  const [busy, setBusy] = React.useState(false)
  const prefs = usePrompterPrefs()
  React.useEffect(() => writePref('mode', mode), [mode])
  const relay = React.useCallback((value) => { setBusy(value); onBusy(value) }, [onBusy])
  const { lines, durations } = React.useMemo(() => {
    const spoken = scriptTiming(script, rate).lines.filter(row => row.spoken)
    return { lines: spoken.map(row => row.text), durations: spoken.map(row => row.seconds) }
  }, [script, rate])
  const Recorder = mode === 'camera' ? CameraRecorder : ScreenRecorder
  return (
    <div className="md-vd-stack">
      <section className="md-vd-card">
        <header className="md-vd-card-head">
          <Segmented label={t('录制方式')} value={mode} onChange={(value) => { if (!busy) setMode(value) }} options={[{ value: 'camera', label: t('摄像头口播'), icon: 'user' }, { value: 'screen', label: t('录屏讲解'), icon: 'expand' }]} />
          <span style={{ flex: 1 }} />
          <span className="md-vd-meta">{t('提词按 {rate} 字/秒滚动，共 {n} 句', { rate, n: lines.length })}</span>
        </header>
        <Recorder key={mode} item={item} lines={lines} durations={durations} prefs={prefs} onBusy={relay} />
      </section>
      <TakeList item={item} onCut={onCut} />
    </div>
  )
}
