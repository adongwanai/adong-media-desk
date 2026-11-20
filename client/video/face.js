// 录屏上的人脸小窗（画中画）：位置和大小都按画面的比例存，预览和录制共用同一套几何。
// 画面合成放在 Web Worker 里做（MediaStreamTrackProcessor → OffscreenCanvas → MediaStreamTrackGenerator），
// 页面切到后台时主线程的 canvas 会被浏览器暂停，Worker 不受影响。
//
// 注意：bubbleRect 和 drawBubble 会被 toString() 拼进 Worker 源码，函数里只能引用自己的参数和 Math，
// 不能引用这个文件里的常量或其他函数（构建压缩后名字会变，拼出来的源码就对不上了）。

/** 人脸小窗的大小范围：短边的比例。 */
export const FACE_MIN_SIZE = 0.08
export const FACE_MAX_SIZE = 0.5
export const FACE_DEFAULT_SIZE = 0.24

/** 这个浏览器能不能把人脸合成进录屏。 */
export function canCompositeFaces() {
  return typeof MediaStreamTrackProcessor === 'function'
    && typeof MediaStreamTrackGenerator === 'function'
    && typeof OffscreenCanvas === 'function'
    && typeof Worker === 'function'
}

/**
 * 人脸小窗在画布上的位置（像素）。位置按中心存成 0–1 的比例，贴边时夹在画面里。
 * @param {{shape?: 'circle'|'rect', size?: number, cx?: number, cy?: number, aspect?: number}} face
 * @param {number} W - 画面宽（像素）。
 * @param {number} H - 画面高（像素）。
 * @returns {{x: number, y: number, w: number, h: number, shape: 'circle'|'rect', radius: number}}
 */
export function bubbleRect(face, W, H) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const min = Math.max(1, Math.min(W, H))
  const size = clamp(Number(face?.size) || 0.24, 0.08, 0.5)
  const shape = face?.shape === 'rect' ? 'rect' : 'circle'
  let w
  let h
  if (shape === 'rect') {
    // 矩形沿用摄像头自己的比例，画面不变形
    const aspect = clamp(Number(face?.aspect) || 16 / 9, 0.5, 2.6)
    w = size * min
    h = w / aspect
    if (h > H * 0.92) { h = H * 0.92; w = h * aspect }
  } else {
    w = size * min
    h = w
  }
  if (w > W * 0.92) {
    const k = (W * 0.92) / w
    w *= k
    h *= k
  }
  const margin = 0.025 * min
  const cx = clamp(Number.isFinite(face?.cx) ? face.cx : 1 - (w / 2 + margin) / W, 0, 1)
  const cy = clamp(Number.isFinite(face?.cy) ? face.cy : 1 - (h / 2 + margin) / H, 0, 1)
  return {
    x: clamp(cx * W - w / 2, 0, Math.max(0, W - w)),
    y: clamp(cy * H - h / 2, 0, Math.max(0, H - h)),
    w,
    h,
    shape,
    radius: shape === 'circle' ? Math.min(w, h) / 2 : Math.min(w, h) * 0.08,
  }
}

/**
 * 把人脸小窗画到 2D 画布上：先裁出形状，再把摄像头画面按「铺满」比例居中画进去，最后描一圈细边。
 * 摄像头画面和窗口比例不一样时，多出来的部分裁掉，人脸居中，不会变形也不会留黑边。
 * @param {CanvasRenderingContext2D} ctx
 * @param {{displayWidth?: number, videoWidth?: number, displayHeight?: number, videoHeight?: number}} source - VideoFrame 或 video 元素。
 * @param {{x: number, y: number, w: number, h: number, shape: string, radius: number}} rect
 * @param {number} alpha - 0–1，淡入淡出用。
 */
export function drawBubble(ctx, source, rect, alpha) {
  const sw = source?.displayWidth || source?.videoWidth || 0
  const sh = source?.displayHeight || source?.videoHeight || 0
  const path = () => {
    ctx.beginPath()
    if (rect.shape === 'circle') {
      ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(rect.w, rect.h) / 2, 0, Math.PI * 2)
      return
    }
    const r = Math.min(rect.radius || 0, rect.w / 2, rect.h / 2)
    ctx.moveTo(rect.x + r, rect.y)
    ctx.arcTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, r)
    ctx.arcTo(rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h, r)
    ctx.arcTo(rect.x, rect.y + rect.h, rect.x, rect.y, r)
    ctx.arcTo(rect.x, rect.y, rect.x + rect.w, rect.y, r)
    ctx.closePath()
  }
  if (!sw || !sh) return
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(alpha) || 0))
  path()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#0d0d0f'
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  const scale = Math.max(rect.w / sw, rect.h / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(source, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh)
  ctx.restore()
  path()
  ctx.lineWidth = Math.max(1, Math.min(rect.w, rect.h) * 0.012)
  ctx.strokeStyle = 'rgba(255,255,255,.9)'
  ctx.stroke()
  ctx.restore()
}

/** 点了人脸小窗没有（圆形按圆算，矩形按方框算）。 */
export function hitFace(rect, x, y) {
  if (rect.shape === 'circle') {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    return (x - cx) ** 2 + (y - cy) ** 2 <= (Math.min(rect.w, rect.h) / 2) ** 2
  }
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

/** 右下角缩放把手的中心和半径。 */
export function resizeHandle(rect) {
  return { x: rect.x + rect.w, y: rect.y + rect.h, r: Math.max(9, Math.min(rect.w, rect.h) * 0.1) }
}

/** 点了缩放把手没有。 */
export function hitHandle(handle, x, y) {
  return (x - handle.x) ** 2 + (y - handle.y) ** 2 <= handle.r ** 2
}

/** 把中心点夹回画面里，大小不变。 */
export function clampFace(face, W, H) {
  if (!(W > 0) || !(H > 0)) return face
  const box = bubbleRect({ ...face, cx: 0, cy: 0 }, W, H)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const cx = box.w >= W ? 0.5 : clamp(Number.isFinite(face?.cx) ? face.cx : 0.5, box.w / (2 * W), 1 - box.w / (2 * W))
  const cy = box.h >= H ? 0.5 : clamp(Number.isFinite(face?.cy) ? face.cy : 0.5, box.h / (2 * H), 1 - box.h / (2 * H))
  return { ...face, cx, cy }
}

/** 滚轮或拖角缩放：加一个比例增量，夹在范围内，位置再夹回画面。 */
export function resizeFace(face, delta, W, H) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const size = clamp((Number(face?.size) || 0.24) + delta, FACE_MIN_SIZE, FACE_MAX_SIZE)
  return clampFace({ ...face, size }, W, H)
}

/** 位置回到右下角（按当前大小算）。 */
export function resetFace(face, W, H) {
  const box = bubbleRect({ ...face, cx: 1, cy: 1 }, W, H)
  return clampFace({ ...face, cx: 1 - (box.w / 2 + 0.025 * Math.min(W, H)) / W, cy: 1 - (box.h / 2 + 0.025 * Math.min(W, H)) / H }, W, H)
}

/**
 * 合成 Worker 的源码。主线程把屏幕画面和摄像头画面的 ReadableStream、生成视频的 WritableStream 传进来，
 * Worker 逐帧画好再写出去。消息：
 *   run   { screen, cam, out, face }  开始；cam 可以为空（没有人脸时只转一道手）
 *   face  { face }                    拖动、换形状、缩放时更新位置
   cam   { cam }                     换一路摄像头画面，null 是关掉
 *   fade  { from, to, ms }            开录和收尾时淡入淡出
 *   stop                             结束循环
 */
export function faceWorkerSource() {
  return `
'use strict'
const bubbleRect = ${bubbleRect.toString()}
const drawBubble = ${drawBubble.toString()}

let face = null
let running = true
let cam = null
let camToken = 0
let canvas = null
let ctx = null
let fade = { from: 1, to: 1, at: 0, ms: 0 }

function alphaAt(now) {
  if (!fade.ms) return fade.to
  const k = Math.min(1, Math.max(0, (now - fade.at) / fade.ms))
  return fade.from + (fade.to - fade.from) * k
}

async function pumpCam(readable, token) {
  const reader = readable.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    // 换了摄像头或关了摄像头，旧画面丢掉，别再盖回来
    if (token !== camToken) { value?.close(); return }
    if (done) return
    if (cam) cam.close()
    cam = value
  }
}

function swapCam(readable) {
  camToken += 1
  if (cam) { cam.close(); cam = null }
  if (readable) pumpCam(readable, camToken).catch(() => {})
}

async function run(msg) {
  face = msg.face ?? face
  const reader = msg.screen.getReader()
  const writer = msg.out.getWriter()
  if (msg.cam) swapCam(msg.cam)
  let stamp = 0
  while (running) {
    const { value: frame, done } = await reader.read()
    if (done) break
    const W = frame.displayWidth || frame.codedWidth
    const H = frame.displayHeight || frame.codedHeight
    if (!canvas) {
      canvas = new OffscreenCanvas(W, H)
      ctx = canvas.getContext('2d')
      self.postMessage({ type: 'size', width: W, height: H })
    } else if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
      self.postMessage({ type: 'size', width: W, height: H })
    }
    ctx.drawImage(frame, 0, 0, W, H)
    frame.close()
    if (cam && face) drawBubble(ctx, cam, bubbleRect(face, W, H), alphaAt(performance.now()))
    // 时间戳必须一直涨，MediaRecorder 用它们排帧
    stamp = Math.max(stamp + 1, Math.round(performance.now() * 1000))
    await writer.write(new VideoFrame(canvas, { timestamp: stamp }))
  }
  try { reader.cancel?.() } catch (err) { /* 屏幕共享已经停了 */ }
}

self.onmessage = (event) => {
  const msg = event.data
  if (msg.type === 'face') face = msg.face
  else if (msg.type === 'cam') swapCam(msg.cam ?? null)
  else if (msg.type === 'fade') fade = { from: msg.from, to: msg.to, at: performance.now(), ms: msg.ms }
  else if (msg.type === 'stop') running = false
  else if (msg.type === 'run') run(msg).catch(err => self.postMessage({ type: 'error', error: String(err && err.stack || err) }))
}
`
}

/**
 * 视频按「完整放下」摆在盒子中央时占的那块地方。录屏画面和舞台比例不一样时上下或左右会有黑边，
 * 叠加层要贴着真正的画面走，不能贴着舞台走。
 * @returns {{x: number, y: number, w: number, h: number, scale: number}}
 */
export function containRect(srcW, srcH, boxW, boxH) {
  if (!(srcW > 0) || !(srcH > 0) || !(boxW > 0) || !(boxH > 0)) return { x: 0, y: 0, w: boxW || 0, h: boxH || 0, scale: 1 }
  const scale = Math.min(boxW / srcW, boxH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, scale }
}

/** 摄像机画面的比例，拿不到设置时按 16:9。 */
export function cameraAspect(track) {
  const s = track?.getSettings?.() ?? {}
  const w = Number(s.width)
  const h = Number(s.height)
  return w > 0 && h > 0 ? w / h : 16 / 9
}
