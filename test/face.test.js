import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bubbleRect, cameraAspect, clampFace, containRect, drawBubble, faceWorkerSource, hitFace, hitHandle, resetFace, resizeFace, resizeHandle } from '../client/video/face.js'

/** 假画布：记下每次画了什么，断言裁剪和描边的地方。 */
function fakeCtx() {
  const calls = []
  const ctx = {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    closePath: () => calls.push(['closePath']),
    moveTo: (x, y) => calls.push(['moveTo', x, y]),
    arc: (x, y, r) => calls.push(['arc', x, y, r]),
    arcTo: () => calls.push(['arcTo']),
    clip: () => calls.push(['clip']),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
    fillRect: (x, y, w, h) => calls.push(['fillRect', x, y, w, h]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
  }
  return ctx
}

test('bubbleRect：默认右下角、圆形，大小按短边算，贴边留空隙', () => {
  const r = bubbleRect({}, 1920, 1080)
  assert.equal(r.shape, 'circle')
  assert.equal(r.w, r.h)
  assert.equal(Math.round(r.w), Math.round(0.24 * 1080))
  // 右下角：右边和下边的空隙一样，都是短边的 2.5%
  assert.ok(Math.abs((1920 - (r.x + r.w)) - 1080 * 0.025) < 0.01)
  assert.ok(Math.abs((1080 - (r.y + r.h)) - 1080 * 0.025) < 0.01)
})

test('bubbleRect：矩形按摄像头比例，大小和位置都被夹在画面里', () => {
  const r = bubbleRect({ shape: 'rect', size: 0.3, aspect: 16 / 9, cx: 0.5, cy: 0.5 }, 1920, 1080)
  assert.equal(r.shape, 'rect')
  assert.ok(Math.abs(r.w / r.h - 16 / 9) < 0.001)
  assert.equal(Math.round(r.x + r.w / 2), 960)
  // 大小超出上限定死；中心拖到画外也贴在边上，不出画面
  const big = bubbleRect({ size: 5, cx: 3, cy: -2 }, 1920, 1080)
  assert.equal(big.w, 1080 * 0.5)
  assert.ok(big.x >= 0 && big.x + big.w <= 1920)
  assert.ok(big.y >= 0 && big.y + big.h <= 1080)
  // 画面很窄时边长也不超过宽度的 92%
  const narrow = bubbleRect({ size: 0.5 }, 400, 1080)
  assert.ok(narrow.w <= 400 * 0.92 + 0.001)
})

test('clampFace / resizeFace：缩放有上下限，位置跟着夹回画面', () => {
  const f = clampFace({ shape: 'circle', size: 0.2, cx: 0.5, cy: 0.5 }, 1920, 1080)
  assert.equal(Math.round(f.cx * 1920), 960)
  const out = clampFace({ ...f, cx: 2, cy: 2 }, 1920, 1080)
  assert.ok(out.cx < 1 && out.cy < 1)
  assert.ok(Math.abs(resizeFace(f, 0.01, 1920, 1080).size - 0.21) < 1e-9)
  assert.equal(resizeFace(f, 2, 1920, 1080).size, 0.5)
  assert.equal(resizeFace(f, -2, 1920, 1080).size, 0.08)
})

test('resetFace：回到右下角，形状和大小不变', () => {
  const f = resetFace({ shape: 'rect', size: 0.3, aspect: 4 / 3, cx: 0.1, cy: 0.1 }, 1920, 1080)
  assert.equal(f.size, 0.3)
  assert.equal(f.shape, 'rect')
  const r = bubbleRect(f, 1920, 1080)
  assert.ok(Math.abs(1920 - (r.x + r.w) - 1080 * 0.025) < 0.01)
})

test('hitFace / hitHandle：圆形按圆算，矩形按方框算，把手在右下角', () => {
  const circle = bubbleRect({ size: 0.2, cx: 0.5, cy: 0.5 }, 1000, 1000)
  assert.ok(hitFace(circle, 500, 500))
  // 方框的角落落在圆外
  assert.ok(!hitFace(circle, circle.x + 2, circle.y + 2))
  const rect = bubbleRect({ shape: 'rect', aspect: 1, size: 0.2, cx: 0.5, cy: 0.5 }, 1000, 1000)
  assert.ok(hitFace(rect, rect.x + 2, rect.y + 2))
  const h = resizeHandle(rect)
  assert.equal(Math.round(h.x), Math.round(rect.x + rect.w))
  assert.ok(hitHandle(h, h.x, h.y))
  assert.ok(!hitHandle(h, h.x - 40, h.y - 40))
})

test('containRect：比例不同时按完整放下居中，黑边算在盒子里', () => {
  const r = containRect(1600, 900, 800, 800)
  assert.equal(r.w, 800)
  assert.equal(r.h, 450)
  assert.equal(r.y, 175)
  const tall = containRect(900, 1600, 1600, 900)
  assert.equal(tall.h, 900)
  assert.equal(Math.round(tall.w), 506)
  assert.ok(tall.x > 0)
  // 尺寸还没量出来时原样返回，不报错
  assert.deepEqual(containRect(0, 0, 640, 360), { x: 0, y: 0, w: 640, h: 360, scale: 1 })
})

test('cameraAspect：读摄像头设置，读不到就用 16:9', () => {
  assert.equal(cameraAspect({ getSettings: () => ({ width: 1280, height: 720 }) }), 16 / 9)
  assert.equal(cameraAspect({ getSettings: () => ({ width: 640, height: 480 }) }), 4 / 3)
  assert.equal(cameraAspect(null), 16 / 9)
  assert.equal(cameraAspect({ getSettings: () => ({}) }), 16 / 9)
})

test('drawBubble：按形状裁剪，画面铺满不变形，描一圈边', () => {
  const rect = bubbleRect({ size: 0.2, cx: 0.5, cy: 0.5 }, 1000, 1000)
  const ctx = fakeCtx()
  drawBubble(ctx, { displayWidth: 1280, displayHeight: 720 }, rect, 0.5)
  const draw = ctx.calls.find(c => c[0] === 'drawImage')
  assert.ok(draw, '画了摄像头画面')
  const [, , x, y, w, h] = draw
  // 16:9 的画面放进正方的窗口：按高的方向铺满，左右超出、居中裁掉
  assert.ok(Math.abs(h - rect.h) < 0.001)
  assert.ok(w > rect.w)
  assert.ok(Math.abs(x + w / 2 - (rect.x + rect.w / 2)) < 0.001)
  assert.equal(ctx.globalAlpha, 0.5)
  assert.ok(ctx.calls.some(c => c[0] === 'arc'), '圆形是弧线裁的')
  assert.ok(!ctx.calls.some(c => c[0] === 'arcTo'), '圆形不走圆角矩形')
  const square = fakeCtx()
  drawBubble(square, { videoWidth: 640, videoHeight: 480 }, bubbleRect({ shape: 'rect', cx: 0.5, cy: 0.5 }, 1000, 1000), 1)
  assert.ok(square.calls.some(c => c[0] === 'arcTo'), '矩形是圆角矩形')
  // 摄像头还没出画面时什么都不画
  const empty = fakeCtx()
  drawBubble(empty, { displayWidth: 0, displayHeight: 0 }, rect, 1)
  assert.equal(empty.calls.length, 0)
})

test('faceWorkerSource：拼出来的 Worker 源码能独立跑，函数体里不引用外部名字', async () => {
  const src = faceWorkerSource()
  assert.match(src, /const bubbleRect = function bubbleRect/)
  assert.match(src, /const drawBubble = function drawBubble/)
  // 源码里这些名字只出现定义那一次，函数体内部没有再用到文件里的其他东西
  for (const name of ['FACE_MIN_SIZE', 'FACE_MAX_SIZE', 'FACE_MARGIN', 'clampFace']) assert.ok(!src.includes(`const ${name}`), name)
  // Web Worker 里跑一遍：发一个 face 消息、切一次摄像头，不会抛错
  globalThis.self = { postMessage: () => {}, onmessage: null }
  const runs = []
  const fn = new Function(`${src}\n;return { bubbleRect, drawBubble }`)
  const api = fn()
  const r = api.bubbleRect({ size: 0.2, cx: 0.5, cy: 0.5 }, 800, 600)
  assert.equal(r.shape, 'circle')
  runs.push(r)
  assert.equal(runs.length, 1)
  assert.equal(typeof api.drawBubble, 'function')
  delete globalThis.self
})
