// 模板卡片上的示意图：每个模板画一张 16:10 的小样，只画它最有代表性的那一下（钩子字卡、章节卡、大字幕、步骤号、大字报、分屏）。
// 字只放几个，字号按小样的尺寸定，保证看得清。颜色用当前选的言起主题。
const FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif'

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function text(ctx, value, x, y, { size, color, weight = 700, align = 'left', max = Infinity }) {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  let s = String(value)
  while (s.length > 1 && ctx.measureText(s).width > max) s = s.slice(0, -1)
  if (s !== String(value)) s = `${s.slice(0, -1)}…`
  ctx.fillText(s, x, y)
}

/** 竖屏小样：在卡片中间放一个 9:16 的画框，返回画框位置。 */
function portraitFrame(ctx, W, H, fill) {
  const h = H - 16
  const w = Math.round((h * 9) / 16)
  const x = Math.round((W - w) / 2)
  rr(ctx, x, 8, w, h, 8)
  ctx.fillStyle = fill
  ctx.fill()
  return { x, y: 8, w, h }
}

function photo(ctx, f, colors) {
  const g = ctx.createLinearGradient(f.x, f.y, f.x + f.w, f.y + f.h)
  g.addColorStop(0, '#3a4a6b')
  g.addColorStop(0.6, '#6b5a7a')
  g.addColorStop(1, colors.accent)
  ctx.save()
  rr(ctx, f.x, f.y, f.w, f.h, 8)
  ctx.clip()
  ctx.fillStyle = g
  ctx.fillRect(f.x, f.y, f.w, f.h)
  // 一座山和太阳，示意「这里是配图」
  ctx.fillStyle = 'rgba(255,255,255,.18)'
  ctx.beginPath()
  ctx.moveTo(f.x, f.y + f.h * 0.7)
  ctx.lineTo(f.x + f.w * 0.45, f.y + f.h * 0.42)
  ctx.lineTo(f.x + f.w, f.y + f.h * 0.66)
  ctx.lineTo(f.x + f.w, f.y + f.h)
  ctx.lineTo(f.x, f.y + f.h)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(f.x + f.w * 0.72, f.y + f.h * 0.24, f.w * 0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const DRAW = {
  'talk-tight'(ctx, W, H, c, title) {
    const f = portraitFrame(ctx, W, H, '#1d1f24')
    // 人像
    ctx.fillStyle = '#3b3f48'
    ctx.beginPath()
    ctx.arc(f.x + f.w / 2, f.y + f.h * 0.5, f.w * 0.17, 0, Math.PI * 2)
    ctx.fill()
    rr(ctx, f.x + f.w * 0.22, f.y + f.h * 0.62, f.w * 0.56, f.h * 0.4, 18)
    ctx.fill()
    // 钩子字卡
    rr(ctx, f.x + 4, f.y + f.h * 0.14, f.w - 8, 24, 4)
    ctx.fillStyle = c.accent
    ctx.fill()
    text(ctx, '3秒钩子', f.x + f.w / 2, f.y + f.h * 0.14 + 12, { size: 11, color: '#fff', align: 'center', weight: 800 })
    // 底部字幕
    rr(ctx, f.x + 8, f.y + f.h * 0.84, f.w - 16, 18, 3)
    ctx.fillStyle = 'rgba(0,0,0,.7)'
    ctx.fill()
    text(ctx, '字幕贴底', f.x + f.w / 2, f.y + f.h * 0.84 + 9, { size: 9, color: '#fff', align: 'center' })
  },
  explain(ctx, W, H, c, title) {
    rr(ctx, 8, 8, W - 16, H - 16, 8)
    ctx.fillStyle = c.bg
    ctx.fill()
    ctx.fillStyle = c.accent
    ctx.fillRect(8, 8, (W - 16) * 0.42, 5)
    text(ctx, '01', 22, H * 0.36, { size: 30, color: c.accent, weight: 800 })
    ctx.fillRect(22, H * 0.52, 30, 4)
    text(ctx, '章节标题', 22, H * 0.7, { size: 16, color: c.ink, weight: 800 })
  },
  'picture-talk'(ctx, W, H, c) {
    const f = portraitFrame(ctx, W, H, '#222')
    photo(ctx, f, c)
    ctx.font = `800 13px ${FONT}`
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,.85)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [i, line] of ['大号', '字幕'].entries()) {
      ctx.strokeText(line, f.x + f.w / 2, f.y + f.h * 0.66 + i * 17)
      ctx.fillStyle = '#fff'
      ctx.fillText(line, f.x + f.w / 2, f.y + f.h * 0.66 + i * 17)
    }
  },
  'screen-steps'(ctx, W, H, c) {
    rr(ctx, 8, 8, W - 16, H - 16, 8)
    ctx.fillStyle = '#e9ebef'
    ctx.fill()
    // 一个软件窗口
    ctx.fillStyle = '#fff'
    rr(ctx, 26, 28, W - 52, H - 56, 5)
    ctx.fill()
    ctx.fillStyle = '#d5d9e0'
    for (let i = 0; i < 3; i += 1) ctx.fillRect(36, 44 + i * 12, (W - 72) * (0.8 - i * 0.18), 6)
    ctx.strokeStyle = c.accent
    ctx.lineWidth = 2
    rr(ctx, W * 0.52, H * 0.52, W * 0.3, H * 0.2, 4)
    ctx.stroke()
    // 步骤号
    rr(ctx, 14, 14, 58, 22, 4)
    ctx.fillStyle = c.accent
    ctx.fill()
    text(ctx, '1  步骤', 22, 25, { size: 11, color: '#fff', weight: 800 })
  },
  quote(ctx, W, H, c, title) {
    const f = portraitFrame(ctx, W, H, c.accent)
    text(ctx, '“', f.x + 8, f.y + 20, { size: 30, color: c.bg, weight: 800 })
    const lines = ['一句', '一屏']
    lines.forEach((line, i) => text(ctx, line, f.x + f.w / 2, f.y + f.h * 0.46 + i * 22, { size: 18, color: c.bg, weight: 800, align: 'center' }))
  },
  compare(ctx, W, H, c) {
    const half = W / 2
    ctx.save()
    rr(ctx, 8, 8, W - 16, H - 16, 8)
    ctx.clip()
    ctx.fillStyle = c.bg
    ctx.fillRect(8, 8, half - 8, H - 16)
    ctx.fillStyle = c.ink
    ctx.fillRect(half, 8, half - 8, H - 16)
    ctx.restore()
    text(ctx, '之前', 20, 26, { size: 12, color: c.accent, weight: 800 })
    text(ctx, '之后', half + 12, 26, { size: 12, color: c.accent, weight: 800 })
    ctx.fillStyle = c.ink
    for (let i = 0; i < 3; i += 1) ctx.fillRect(20, 48 + i * 12, (half - 40) * (0.9 - i * 0.2), 6)
    ctx.fillStyle = c.bg
    for (let i = 0; i < 3; i += 1) ctx.fillRect(half + 12, 48 + i * 12, (half - 40) * (0.9 - i * 0.2), 6)
    ctx.fillStyle = c.accent
    ctx.beginPath()
    ctx.arc(half, H / 2 + 4, 15, 0, Math.PI * 2)
    ctx.fill()
    text(ctx, 'VS', half, H / 2 + 4, { size: 11, color: '#fff', weight: 800, align: 'center' })
  },
}

/**
 * 画一张模板小样。
 * @param {HTMLCanvasElement} canvas
 * @param {string} id - 模板 id。
 * @param {{bg: string, ink: string, accent: string}} colors
 * @param {string} title - 这篇的标题，取前几个字放进小样。
 */
export function drawThumb(canvas, id, colors, title) {
  const W = 200
  const H = 125
  const ratio = Math.max(2, window.devicePixelRatio || 1)
  canvas.width = W * ratio
  canvas.height = H * ratio
  const ctx = canvas.getContext('2d')
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#f2f3f5'
  ctx.fillRect(0, 0, W, H)
  DRAW[id]?.(ctx, W, H, colors, String(title || ''))
}
