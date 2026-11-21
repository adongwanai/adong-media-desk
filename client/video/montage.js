// 成片引擎：把一篇成稿（配图/分镜，或者一条录像）按模板排成一条视频——片头或钩子字卡、正文、章节卡、字幕、片尾。
// 在浏览器里画到 canvas 上，用 MediaRecorder 实时录下来；旁白是用户自己的声音，或者录像本身的声音。
// planMontage、themeColors、wrapText、captionRuns 不碰 DOM，测试直接用。
import { buildCues, cuesFromLog, retimeCues, scriptTiming } from './captions.js'

export const TITLE_SEC = 2.5
export const END_SEC = 2.5
// 片尾卡最多展示几秒：字读得完就够，不靠一段静止画面硬拖
const END_MAX_SEC = 2.5
export const HOOK_SEC = 3
const CHAPTER_SEC = 1.6
export const SIZES = { portrait: [1080, 1920], landscape: [1920, 1080] }
const FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif'
const PLAIN = { caption: { position: 'bottom', scale: 1, lines: 2, style: 'box', keywords: false }, motion: 'kenburns', transition: 'fade' }

function firstColor(css, prop = 'color') {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\))`).exec(String(css ?? ''))
  return m?.[1] ?? null
}

/**
 * 从言起排版主题里取三种颜色：底色、正文色、强调色。
 * @param {{styles?: object}} theme - YANQI_THEMES 里的一项。
 * @returns {{bg: string, ink: string, accent: string}}
 */
export function themeColors(theme) {
  const styles = theme?.styles ?? {}
  const bg = firstColor(styles.imagePreview, 'background-color') ?? firstColor(styles.imagePreview, 'background') ?? '#ffffff'
  const ink = firstColor(styles.title?.h2?.content) ?? firstColor(styles.paragraph) ?? '#1f2937'
  const accent = firstColor(styles.emphasis?.strong) ?? /#[0-9a-fA-F]{3,8}/.exec(String(styles.quote ?? ''))?.[0] ?? firstColor(styles.link) ?? ink
  return { bg, ink, accent }
}

/** 正文按画面分成几段：有分镜按分镜，没有就把口播稿两句一段。 */
function bodyParts({ title, shots, pictures, spoken, cover }) {
  let body = shots.length
    ? shots.map((shot, i) => ({ text: String(shot.voice || shot.visual || '').trim(), seconds: Number(shot.seconds) > 0 ? Number(shot.seconds) : 5, image: shot.src || pictures[i % Math.max(1, pictures.length)] || null }))
    : []
  if (!body.length) {
    for (let i = 0; i < spoken.length; i += 2) {
      const pair = spoken.slice(i, i + 2)
      body.push({ text: pair.map(row => row.text).join(''), seconds: pair.reduce((sum, row) => sum + row.seconds, 0), image: pictures.length ? pictures[(i / 2) % pictures.length] : null })
    }
  }
  if (!body.length) body = [{ text: title, seconds: 5, image: cover?.src ?? null }]
  return body
}

/**
 * 排好每一幕。
 * - 图文：片头（模板带钩子时显示钩子）→ 章节卡 + 分镜画面 → 片尾；有旁白时正文按旁白长度等比拉伸。
 * - 录像：整条录像是一幕，前 3 秒叠钩子字卡，之后接片尾；字幕优先用提词记录的真实时间。
 * @returns {{scenes: Array<object>, cues: Array<{start: number, end: number, text: string}>, total: number, body: number, narrationStart: number, look: object, hook: object|null, steps: Array<{start: number, label: string}>}}
 */
export function planMontage({ title, shots = [], images = [], cover = null, script = '', rate = 4.5, narration = 0, signature = '', template = null, slots = {}, video = null }) {
  const look = { ...PLAIN, ...(template ?? {}), caption: { ...PLAIN.caption, ...(template?.caption ?? {}) } }
  const keywords = look.caption.keywords ? (slots.keywords ?? []) : []
  const endText = slots.endLine || title
  const endScene = start => ({ kind: 'end', start, end: start + END_SEC, text: endText, title, image: null, signature, follow: look.endCard === 'follow' })
  const spoken = scriptTiming(script, rate).lines.filter(row => row.spoken)
  const given = (slots.chapters ?? []).filter(Boolean)
  // 没填章节/步骤时，从稿子里每句话的第一小句取（最多 4 个），不编新词
  // 第一小句太长（超过 16 个字）就不拿来当标题，宁可少一个也不截半句
  const clause = (text) => { const first = String(text).split(/[，。！？、；：,.!?;:]/u)[0].trim(); return first.length <= 16 ? first : '' }
  const pickEven = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]))
  const chapters = look.chapters || look.steps ? (given.length ? given : pickEven(spoken.map(row => clause(row.text)).filter(Boolean), 4)) : []

  if (video) {
    const length = Math.max(0.5, Number(video.duration) || 0.5)
    // 开头和结尾的空场：说话段从哪儿开始，画面就从哪儿进；最后一句说完就接片尾卡，不干等。
    // 留一点余量（0.2 秒），不要把第一个字削掉。
    const speechIn = (Array.isArray(video.speech) ? video.speech : []).filter(([a, b]) => b > a)
    const lead = speechIn.length ? Math.max(0, Math.min(0.6, speechIn[0][0] - 0.2)) : 0
    const from = Math.min(lead, Math.max(0, length - 0.5))
    const tail = speechIn.length ? Math.max(0, length - speechIn.at(-1)[1] - 0.35) : 0
    const body = Math.max(0.5, length - tail)
    const shown = Math.max(0.5, body - from)
    const shift = c => ({ ...c, start: Math.max(0, c.start - from), end: Math.max(0.001, c.end - from) })
    const fromLog = cuesFromLog(video.log, length).map(shift).filter(c => c.end > c.start)
    let cues = fromLog
    let captionSource = 'log'
    if (!cues.length) {
      const raw = buildCues(script, { rate })
      // 有声音分析结果时铺到真实说话段上；没有就按总长等比拉一下
      const speech = Array.isArray(video.speech) ? video.speech : []
      if (speechIn.length) {
        // 先按真实说话段排，再整体左移、卡进真正会播的那一段
        cues = retimeCues(raw, speechIn, { rate }).map(shift).filter(c => c.start < shown)
        captionSource = 'speech'
      } else {
        const k = raw.length ? shown / raw.at(-1).end : 1
        cues = raw.map(cue => ({ start: cue.start * k, end: cue.end * k, text: cue.text }))
      }
    }
    // 录像有提词记录时，步骤跟着换句的真实时间走；时间要落在剪完的那一段里（减去开头剪掉的 from）
    const logged = (Array.isArray(video.log) ? video.log : []).filter(row => row.t < length && row.t >= from)
    const at = t => Math.max(0, Math.min(shown, t - from))
    const steps = !(look.chapters || look.steps) ? []
      : given.length ? given.map((label, i) => ({ start: (i * shown) / given.length, label }))
        : logged.length ? pickEven(logged, 4).map(row => ({ start: at(row.t), label: clause(row.text) })).filter(row => row.label)
          : chapters.map((label, i) => ({ start: (i * shown) / chapters.length, label }))
    return {
      scenes: [{ kind: 'video', start: 0, end: shown, text: '', image: null, offset: from }, endScene(shown)],
      cues, total: shown + END_SEC, body: shown, narrationStart: 0, look, keywords,
      hook: look.hook && slots.hook ? { start: 0.2, end: Math.min(shown, HOOK_SEC), text: slots.hook } : null,
      steps, captionSource, sourceFrom: from, sourceTo: body,
    }
  }

  const pictures = images.map(row => row?.src).filter(Boolean)
  const parts = bodyParts({ title, shots, pictures, spoken, cover })
  const pace = look.pace ?? 1
  const designed = parts.reduce((sum, row) => sum + row.seconds, 0) * pace
  const length = narration > 0 ? narration : designed
  const scale = (length / designed) * pace
  const opening = look.hook && slots.hook ? slots.hook : title
  const scenes = [{ kind: 'title', start: 0, end: TITLE_SEC, text: opening, image: cover?.src ?? pictures[0] ?? null, hook: Boolean(look.hook && slots.hook) }]
  let at = TITLE_SEC
  // 章节卡平均插在正文前面几段之前
  const chapterAt = new Map(chapters.map((label, i) => [Math.floor((i * parts.length) / chapters.length), { label, no: i + 1 }]))
  // 图文解说没有配图时也走「画面 + 大字幕」，画面换成主题色的渐变底
  const kindOf = row => (look.poster ? 'poster' : row.image || look.backdrop ? 'image' : 'text')
  for (let i = 0; i < parts.length; i += 1) {
    const chapter = chapterAt.get(i)
    if (chapter && look.chapters) {
      scenes.push({ kind: 'chapter', start: at, end: at + CHAPTER_SEC, text: chapter.label, no: chapter.no, image: null })
      at += CHAPTER_SEC
    }
    if (look.split && i + 1 < parts.length) {
      const end = at + (parts[i].seconds + parts[i + 1].seconds) * scale
      scenes.push({ kind: 'split', start: at, end, text: parts[i].text, right: parts[i + 1].text, left: slots.leftLabel || '', rightLabel: slots.rightLabel || '', image: null, no: i + 1 })
      at = end
      i += 1
      continue
    }
    const end = at + parts[i].seconds * scale
    scenes.push({ kind: kindOf(parts[i]), start: at, end, text: look.poster && i === 0 && slots.quote ? slots.quote : parts[i].text, image: parts[i].image, no: i + 1 })
    at = end
  }
  const bodyStart = TITLE_SEC
  const bodyEnd = at
  scenes.push(endScene(at))
  // 字幕：口播稿按语速排好的时间整体缩放到正文这一段；没有口播稿就用每段的文字
  const source = spoken.length ? script : parts.map(row => row.text).join('\n')
  const raw = buildCues(source, { rate })
  const k = raw.length ? (bodyEnd - bodyStart) / raw.at(-1).end : 1
  const cues = raw.map(cue => ({ start: bodyStart + cue.start * k, end: bodyStart + cue.end * k, text: cue.text }))
  return { scenes, cues, total: at + END_SEC, body: length, narrationStart: TITLE_SEC, look, keywords, hook: null, steps: [], captionSource: 'script' }
}

/** 按宽度断行：汉字一个一个断，西文单词不拆。measure 是量宽度的函数。 */
export function wrapText(text, maxWidth, measure, maxLines = 6) {
  const tokens = String(text ?? '').match(/[A-Za-z0-9][A-Za-z0-9'’.%+_-]*\s*|\s+|./gsu) ?? []
  const lines = []
  let line = ''
  for (const token of tokens) {
    // 句号逗号这类标点不放到行首，跟着上一行走
    if (line && measure((line + token).trimEnd()) > maxWidth && !/^[，。！？、；：,.!?;:”’）》」』…]$/.test(token)) {
      lines.push(line.trimEnd())
      line = token.trimStart()
    } else {
      line += token
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, -1)}…`
    return kept
  }
  return lines
}

/** 一行字幕里哪些字是重点词：返回 [文字, 是否重点] 的片段。 */
export function captionRuns(text, keywords = []) {
  const words = keywords.filter(Boolean).sort((a, b) => b.length - a.length)
  if (!words.length) return [[text, false]]
  const out = []
  let rest = String(text)
  while (rest) {
    let best = null
    for (const word of words) {
      const at = rest.indexOf(word)
      if (at >= 0 && (best === null || at < best.at)) best = { at, word }
    }
    if (!best) { out.push([rest, false]); break }
    if (best.at) out.push([rest.slice(0, best.at), false])
    out.push([best.word, true])
    rest = rest.slice(best.at + best.word.length)
  }
  return out
}

function sceneAt(scenes, t) {
  let i = 0
  while (i + 1 < scenes.length && scenes[i + 1].start <= t) i += 1
  return i
}

// 铺满画面（多出来的裁掉），按模板的动效推拉
function drawCover(ctx, source, sw, sh, W, H, p, index, motion) {
  let zoom = 1
  let shift = 0
  if (motion === 'kenburns') { zoom = 1.04 + 0.08 * p; shift = (index % 2 ? 1 : -1) * 0.35 * (p - 0.5) }
  if (motion === 'zoom') zoom = 1 + 0.15 * p
  if (motion === 'punch') zoom = 1 + 0.12 * Math.max(0, 1 - p * 6)
  const scale = Math.max(W / sw, H / sh) * zoom
  const w = sw * scale
  const h = sh * scale
  ctx.drawImage(source, (W - w) / 2 + shift * (w - W), (H - h) / 2, w, h)
}

function textBlock(ctx, lines, { x, y, size, lineHeight, color, align = 'left', weight = 700 }) {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight))
}

function centeredText(ctx, text, { W, H, size, color, weight = 700, maxLines = 6, lineGap = 1.35, width = 0.82, top = null }) {
  ctx.font = `${weight} ${size}px ${FONT}`
  const lines = wrapText(text, W * width, s => ctx.measureText(s).width, maxLines)
  const y = top ?? H / 2 - (lines.length * size * lineGap) / 2
  textBlock(ctx, lines, { x: W / 2, y, size, lineHeight: size * lineGap, color, align: 'center', weight })
  return y + lines.length * size * lineGap
}

function drawScene(ctx, plan, scene, index, t, options) {
  const { W, H, colors, images, video } = options
  const p = Math.min(1, Math.max(0, (t - scene.start) / Math.max(0.01, scene.end - scene.start)))
  const unit = Math.min(W, H) / 1080
  const pad = 90 * unit
  const look = plan.look
  const img = scene.image ? images.get(scene.image) : null
  ctx.save()
  ctx.globalAlpha = 1
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, W, H)
  if (scene.kind === 'video') {
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, W, H)
    if (video?.videoWidth) {
      const windowed = options.frameStyle === 'window'
      if (windowed) {
        // Cap / Screen Studio 式桌面窗口画布：主题渐变衬底 + 圆角窗口 + 柔和投影 + 顶栏红黄绿圆点
        const bgGrad = ctx.createLinearGradient(0, 0, W, H)
        bgGrad.addColorStop(0, colors.ink)
        bgGrad.addColorStop(1, colors.accent)
        ctx.fillStyle = bgGrad
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = 'rgba(0,0,0,0.22)'
        ctx.fillRect(0, 0, W, H)
        const marginX = W * 0.055
        const marginY = H * 0.065
        const barH = Math.round(34 * unit)
        const availW = W - marginX * 2
        const availH = H - marginY * 2 - barH
        const fit = Math.min(availW / video.videoWidth, availH / video.videoHeight)
        const zoom = look.motion === 'zoom' ? 1 + 0.04 * Math.sin(Math.PI * p) : 1
        const w = video.videoWidth * fit * zoom
        const h = video.videoHeight * fit * zoom
        const x = (W - w) / 2
        const y = (H - (h + barH)) / 2 + barH
        const radius = Math.round(20 * unit)
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = 42 * unit
        ctx.shadowOffsetY = 18 * unit
        ctx.fillStyle = '#1e1f24'
        ctx.beginPath()
        ctx.roundRect(x, y - barH, w, h + barH, radius)
        ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x, y - barH, w, h + barH, radius)
        ctx.clip()
        ctx.fillStyle = '#25272e'
        ctx.fillRect(x, y - barH, w, barH)
        ;['#ff5f56', '#ffbd2e', '#27c93f'].forEach((dot, di) => {
          ctx.fillStyle = dot
          ctx.beginPath()
          ctx.arc(x + (20 + di * 18) * unit, y - barH / 2, 5.5 * unit, 0, Math.PI * 2)
          ctx.fill()
        })
        ctx.drawImage(video, x, y, w, h)
        ctx.restore()
        options.videoRect = { x, y, w, h }
      } else {
        // 录像按原比例放进画面；画幅不一样时上下或左右留边，录屏的内容不被裁掉
        // 口播（fill: cover）铺满画面，人脸居中；录屏等其余模板完整放下，不裁内容
        const cover = look.fill === 'cover'
        const fit = cover ? Math.max(W / video.videoWidth, H / video.videoHeight) : Math.min(W / video.videoWidth, H / video.videoHeight)
        const zoom = look.motion === 'zoom' ? 1 + 0.06 * Math.sin(Math.PI * p) : 1
        const w = video.videoWidth * fit * zoom
        const h = video.videoHeight * fit * zoom
        const x = (W - w) / 2
        const y = (H - h) / 2
        ctx.drawImage(video, x, y, w, h)
        // 留边不用纯黑：从画面边缘渐变到深灰，像一张柔和的海报底，字幕压在边上也不突兀
        if (h < H - 1) {
          const top = ctx.createLinearGradient(0, 0, 0, Math.max(1, y + 1))
          top.addColorStop(0, '#15161a')
          top.addColorStop(1, '#25262b')
          ctx.fillStyle = top
          ctx.fillRect(0, 0, W, y + 1)
          const bottomY = y + h
          const bottom = ctx.createLinearGradient(0, bottomY, 0, H)
          bottom.addColorStop(0, '#25262b')
          bottom.addColorStop(1, '#15161a')
          ctx.fillStyle = bottom
          ctx.fillRect(0, bottomY, W, H - bottomY)
        }
        if (w < W - 1) {
          const left = ctx.createLinearGradient(0, 0, Math.max(1, x + 1), 0)
          left.addColorStop(0, '#15161a')
          left.addColorStop(1, '#25262b')
          ctx.fillStyle = left
          ctx.fillRect(0, y, x + 1, h)
          const right = ctx.createLinearGradient(x + w, 0, W, 0)
          right.addColorStop(0, '#25262b')
          right.addColorStop(1, '#15161a')
          ctx.fillStyle = right
          ctx.fillRect(x + w, y, W - (x + w), h)
        }
        // 字幕贴在画面内容的下沿，不留进黑边里；画面铺满时等于贴屏幕底
        options.videoRect = { x, y, w, h }
      }
    }
  } else if (scene.kind === 'image') {
    if (img) drawCover(ctx, img, img.width, img.height, W, H, p, index, look.motion)
    else {
      // 没有图：主题色渐变慢慢移动，配几个淡的圆，像一张虚化的照片
      const shift = (index % 2 ? 1 : -1) * 0.15 * (p - 0.5)
      const g = ctx.createLinearGradient(W * (0.1 + shift), 0, W * (0.9 + shift), H)
      g.addColorStop(0, colors.ink)
      g.addColorStop(1, colors.accent)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(255,255,255,.08)'
      for (let k = 0; k < 3; k += 1) {
        ctx.beginPath()
        ctx.arc(W * (0.25 + 0.3 * k + shift), H * (0.3 + 0.18 * ((k + index) % 3)), Math.min(W, H) * (0.18 + 0.06 * k), 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const shade = ctx.createLinearGradient(0, H * 0.55, 0, H)
    shade.addColorStop(0, 'rgba(0,0,0,0)')
    shade.addColorStop(1, 'rgba(0,0,0,.6)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, W, H)
  } else if (scene.kind === 'title') {
    if (img) {
      drawCover(ctx, img, img.width, img.height, W, H, p, 0, 'kenburns')
      ctx.fillStyle = 'rgba(0,0,0,.52)'
      ctx.fillRect(0, 0, W, H)
    }
    const size = (scene.hook ? 104 : 96) * unit
    ctx.font = `800 ${size}px ${FONT}`
    const lines = wrapText(scene.text, W - pad * 2, s => ctx.measureText(s).width, 4)
    const top = H / 2 - (lines.length * size * 1.3) / 2
    ctx.fillStyle = img ? '#ffffff' : colors.accent
    ctx.fillRect(pad, top - 40 * unit, 90 * unit, 10 * unit)
    textBlock(ctx, lines, { x: pad, y: top, size, lineHeight: size * 1.3, color: img ? '#ffffff' : colors.ink, weight: 800 })
  } else if (scene.kind === 'chapter') {
    textBlock(ctx, [String(scene.no).padStart(2, '0')], { x: pad, y: H / 2 - 190 * unit, size: 120 * unit, lineHeight: 130 * unit, color: colors.accent, weight: 800 })
    ctx.fillStyle = colors.accent
    ctx.fillRect(pad, H / 2 - 40 * unit, 120 * unit, 8 * unit)
    ctx.font = `800 ${84 * unit}px ${FONT}`
    textBlock(ctx, wrapText(scene.text, W - pad * 2, s => ctx.measureText(s).width, 3), { x: pad, y: H / 2, size: 84 * unit, lineHeight: 84 * unit * 1.3, color: colors.ink, weight: 800 })
  } else if (scene.kind === 'poster') {
    // 大字报：强调色铺底，大字用底色反白
    ctx.fillStyle = colors.accent
    ctx.fillRect(0, 0, W, H)
    const zoom = look.motion === 'punch' ? 1 + 0.06 * Math.max(0, 1 - p * 5) : 1
    ctx.translate(W / 2, H / 2)
    ctx.scale(zoom, zoom)
    ctx.translate(-W / 2, -H / 2)
    textBlock(ctx, ['“'], { x: pad, y: H * 0.18, size: 220 * unit, lineHeight: 220 * unit, color: colors.bg, weight: 800 })
    centeredText(ctx, scene.text, { W, H, size: 110 * unit, color: colors.bg, weight: 800, maxLines: 6, lineGap: 1.28 })
  } else if (scene.kind === 'split') {
    const half = W / 2
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, half, H)
    ctx.fillStyle = colors.ink
    ctx.fillRect(half, 0, half, H)
    const size = (W > H ? 58 : 50) * unit
    const label = (text, x, color) => text && textBlock(ctx, [text], { x, y: pad, size: 44 * unit, lineHeight: 50 * unit, color, weight: 800 })
    label(scene.left, pad * 0.8, colors.accent)
    label(scene.rightLabel, half + pad * 0.8, colors.accent)
    ctx.font = `700 ${size}px ${FONT}`
    textBlock(ctx, wrapText(scene.text, half - pad * 1.6, s => ctx.measureText(s).width, 8), { x: pad * 0.8, y: H * 0.32, size, lineHeight: size * 1.45, color: colors.ink })
    textBlock(ctx, wrapText(scene.right, half - pad * 1.6, s => ctx.measureText(s).width, 8), { x: half + pad * 0.8, y: H * 0.32, size, lineHeight: size * 1.45, color: colors.bg })
    ctx.fillStyle = colors.accent
    ctx.beginPath()
    ctx.arc(half, H / 2, 64 * unit, 0, Math.PI * 2)
    ctx.fill()
    textBlock(ctx, ['VS'], { x: half, y: H / 2 - 30 * unit, size: 56 * unit, lineHeight: 60 * unit, color: '#ffffff', align: 'center', weight: 800 })
  } else if (scene.kind === 'text') {
    ctx.fillStyle = colors.accent
    ctx.fillRect(pad, pad * 1.6, 12 * unit, 120 * unit)
    textBlock(ctx, [String(scene.no ?? '').padStart(2, '0')], { x: pad + 36 * unit, y: pad * 1.6, size: 64 * unit, lineHeight: 70 * unit, color: colors.accent, weight: 800 })
    const size = 76 * unit
    ctx.font = `700 ${size}px ${FONT}`
    const lines = wrapText(scene.text, W - pad * 2, s => ctx.measureText(s).width, 8)
    textBlock(ctx, lines, { x: pad, y: H / 2 - (lines.length * size * 1.45) / 2, size, lineHeight: size * 1.45, color: colors.ink })
  } else if (scene.kind === 'end') {
    // 片尾卡：底色比正文深一档，中间一条强调色细线把大字和署名分开，收得住也不空
    ctx.fillStyle = colors.ink
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(255,255,255,.05)'
    ctx.beginPath()
    ctx.arc(W * 0.82, H * 0.18, Math.min(W, H) * 0.42, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(W * 0.12, H * 0.86, Math.min(W, H) * 0.3, 0, Math.PI * 2)
    ctx.fill()
    const size = (scene.follow ? 80 : 68) * unit
    ctx.font = `800 ${size}px ${FONT}`
    const lines = wrapText(scene.text, W * 0.8, s2 => ctx.measureText(s2).width, 3)
    const lineH = size * 1.3
    const blockH = lines.length * lineH
    const top = H / 2 - blockH / 2 - 20 * unit
    textBlock(ctx, lines, { x: W / 2, y: top, size, lineHeight: lineH, color: colors.bg, align: 'center', weight: 800 })
    const ruleY = top + blockH + 46 * unit
    ctx.fillStyle = colors.accent
    ctx.fillRect(W / 2 - 46 * unit, ruleY, 92 * unit, 7 * unit)
    // 片尾小字只放署名或引导，不重复上面那句大字；没有署名时整块省掉，不留一条空线
    const sub = scene.follow ? scene.title : scene.signature
    const distinct = sub && sub.trim() && sub.trim() !== String(scene.text ?? '').trim()
    if (distinct) {
      ctx.font = `500 ${38 * unit}px ${FONT}`
      const subLines = wrapText(sub, W * 0.8, s2 => ctx.measureText(s2).width, 2)
      textBlock(ctx, subLines, { x: W / 2, y: ruleY + 40 * unit, size: 38 * unit, lineHeight: 38 * unit * 1.4, color: 'rgba(255,255,255,.72)', align: 'center', weight: 500 })
    }
  }
  ctx.restore()
}

/**
 * 字幕最后一行文字的顶边位置。
 * 画面内容没铺满时（横屏录像放进竖屏画幅、上下有留边），字幕必须落在画面内容里面：
 * 压在灰色留边上，字幕就跑到视频画面之外了。只在内容放不下时才退到画面外。
 * @param {{H: number, W: number, videoRect: {y: number, h: number}|null}} options - 画布尺寸与录像铺放的位置。
 * @param {{position?: 'lower'|'bottom'|string, lineCount?: number, lineHeight?: number}} shape - 字幕位置和行数。
 * @returns {number} 最后一行文字的 top（像素）。
 */
export function captionBottomY({ W, H, videoRect }, { position = 'bottom', lineCount = 1, lineHeight = 0 } = {}) {
  const rect = videoRect
  const contentBottom = rect ? rect.y + rect.h : H
  const inset = rect ? Math.min(H * 0.045, (contentBottom - rect.y) * 0.08) : H * 0.05
  // 竖屏时底部要给平台的按钮和文案留出位置；横屏贴底一点
  const safeInset = H * (W < H ? 0.16 : 0.1)
  const lowerInset = H * 0.26
  const want = position === 'lower' ? contentBottom - lowerInset : contentBottom - inset
  // 平台的按钮区只在画面自己落到那儿时才让位；内容区本来就在上面时以内容下沿为准
  const limit = rect ? Math.max(rect.y + lineHeight * lineCount + lineHeight * 0.4, contentBottom - safeInset) : contentBottom - safeInset
  return Math.max(H * 0.12, Math.min(want, limit))
}

function drawCaption(ctx, text, options, look, keywords, alpha = 1) {
  const { W, H, colors } = options
  const style = look.caption
  if (style.position === 'none' || alpha <= 0.01) return
  const unit = Math.min(W, H) / 1080
  const size = 54 * unit * (style.scale ?? 1)
  ctx.save()
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.font = `700 ${size}px ${FONT}`
  const lines = wrapText(text, W * 0.86, s => ctx.measureText(s).width, style.lines ?? 2)
  const lineHeight = size * 1.35
  const bottom = captionBottomY({ W, H, videoRect: options.videoRect }, { position: style.position, lineCount: lines.length, lineHeight })
  lines.forEach((line, i) => {
    const y = bottom - (lines.length - i) * lineHeight
    const runs = captionRuns(line, keywords)
    const width = runs.reduce((sum, [part]) => sum + ctx.measureText(part).width, 0)
    let x = W / 2 - width / 2
    if (style.style === 'box') {
      // 圆角底，四周留出足够的内边距，长句也不会贴着字
      const padX = size * 0.42
      const padY = size * 0.2
      ctx.fillStyle = 'rgba(0,0,0,.66)'
      ctx.beginPath()
      ctx.roundRect(x - padX, y - padY, width + padX * 2, lineHeight + padY * 0.6, size * 0.18)
      ctx.fill()
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    for (const [part, hot] of runs) {
      if (style.style === 'stroke') {
        // 先描一层黑边再填白，深浅背景上都看得清
        ctx.lineWidth = size * (hot ? 0.2 : 0.16)
        ctx.strokeStyle = 'rgba(0,0,0,.88)'
        ctx.lineJoin = 'round'
        ctx.miterLimit = 2
        ctx.strokeText(part, x, y)
      }
      ctx.fillStyle = hot ? colors.accent : '#ffffff'
      if (hot && style.style === 'box') {
        ctx.fillStyle = colors.accent
        ctx.beginPath()
        ctx.roundRect(x - size * 0.06, y - size * 0.04, ctx.measureText(part).width + size * 0.12, lineHeight - size * 0.06, size * 0.06)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
      }
      ctx.fillText(part, x, y)
      x += ctx.measureText(part).width
    }
  })
  ctx.restore()
}

function drawOverlays(ctx, plan, t, { W, H, colors }) {
  const unit = Math.min(W, H) / 1080
  if (plan.look.progress) {
    ctx.fillStyle = 'rgba(0,0,0,.18)'
    ctx.fillRect(0, 0, W, 8 * unit)
    ctx.fillStyle = colors.accent
    ctx.fillRect(0, 0, W * Math.min(1, t / plan.total), 8 * unit)
  }
  const step = [...plan.steps].reverse().find(row => t >= row.start)
  if (step && t < plan.body) {
    const label = `${plan.steps.indexOf(step) + 1}  ${step.label}`
    ctx.font = `700 ${40 * unit}px ${FONT}`
    const w = ctx.measureText(label).width + 48 * unit
    ctx.fillStyle = colors.accent
    ctx.fillRect(40 * unit, 40 * unit, w, 72 * unit)
    textBlock(ctx, [label], { x: 64 * unit, y: 56 * unit, size: 40 * unit, lineHeight: 44 * unit, color: '#ffffff' })
  }
  const hook = plan.hook
  if (hook && t >= hook.start && t < hook.end) {
    const fade = Math.min(1, (t - hook.start) / 0.22, (hook.end - t) / 0.28)
    // 进场时往上抬一点点，不是硬贴上去
    const rise = (1 - Math.min(1, (t - hook.start) / 0.3)) * 28 * unit
    ctx.save()
    ctx.globalAlpha = Math.max(0, fade)
    const size = 92 * unit
    ctx.font = `800 ${size}px ${FONT}`
    const lines = wrapText(hook.text, W * 0.78, s => ctx.measureText(s).width, 3)
    const top = H * 0.2 + rise
    const textW = Math.max(...lines.map(line => ctx.measureText(line).width))
    const padX = size * 0.55
    const padY = size * 0.36
    const boxH = lines.length * size * 1.3 + padY * 1.1
    const boxW = textW + padX * 2
    // 先压一层暗色，钩子字卡在亮画面上也读得清
    const shade = ctx.createLinearGradient(0, 0, 0, H * 0.62)
    shade.addColorStop(0, 'rgba(0,0,0,.45)')
    shade.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, W, H * 0.62)
    ctx.fillStyle = colors.accent
    ctx.beginPath()
    ctx.roundRect(W / 2 - boxW / 2, top - padY, boxW, boxH, size * 0.16)
    ctx.fill()
    textBlock(ctx, lines, { x: W / 2, y: top + size * 0.06, size, lineHeight: size * 1.3, color: '#ffffff', align: 'center', weight: 800 })
    ctx.restore()
  }
}

/**
 * 画第 t 秒的一帧：切幕时按模板淡入或硬切，叠字幕（文字卡、章节卡、大字报本身就是字，不再叠）、进度条、步骤和钩子。
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof planMontage>} plan
 * @param {number} t
 * @param {{W: number, H: number, colors: object, images: Map<string, HTMLImageElement>, video?: HTMLVideoElement}} options
 */
export function drawFrame(ctx, plan, t, options) {
  const i = sceneAt(plan.scenes, t)
  const scene = plan.scenes[i]
  options.videoRect = null
  drawScene(ctx, plan, scene, i, t, options)
  const fade = t - scene.start
  // 淡入：前一幕压在上面、透明度往下走；录像切到片尾卡时也用它，避免画面硬跳
  const cross = scene.kind === 'end' || plan.scenes[i - 1]?.kind !== 'video'
  if (i > 0 && plan.look.transition === 'fade' && cross && fade < 0.4) {
    ctx.save()
    ctx.globalAlpha = 1 - fade / 0.4
    drawScene(ctx, plan, plan.scenes[i - 1], i - 1, t, options)
    ctx.restore()
  }
  if (scene.kind === 'image' || scene.kind === 'video') {
    const cue = plan.cues.find(row => t >= row.start && t < row.end)
    // 每条字幕淡入淡出一下，换行不闪
    if (cue) drawCaption(ctx, cue.text, options, plan.look, plan.keywords, Math.min(1, (t - cue.start) / 0.1, (cue.end - t) / 0.08))
  }
  drawOverlays(ctx, plan, t, options)
}

/** 把每一幕要用的图先载好；载不了的图那一幕退回文字卡。 */
export async function loadImages(plan) {
  const map = new Map()
  const srcs = [...new Set(plan.scenes.map(row => row.image).filter(Boolean))]
  await Promise.all(srcs.map(src => new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { map.set(src, img); resolve() }
    img.onerror = () => resolve()
    img.src = src
  })))
  return map
}

export function pickRenderMime() {
  if (typeof MediaRecorder === 'undefined') return null
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

/**
 * 实时渲染：画布 30 帧/秒录下来。图文的旁白从片头结束时开始放；录像模式下录像边播边画，声音直接取录像的。
 * 画不过来时跳帧（按时钟画当下那一帧），不会越录越慢。
 * @returns {Promise<{blob: Blob, seconds: number, frames: number, dropped: number}|null>} 取消时返回 null。
 */
export async function renderMontage({ plan, size, colors, images, narration = null, videoSrc = null, frameStyle = 'bleed', context, canvas, onProgress, signal }) {
  const [W, H] = size
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const audio = context ?? new AudioContext()
  await audio.resume().catch(() => {})
  const dest = audio.createMediaStreamDestination()
  let video = null
  let mediaSource = null
  if (videoSrc) {
    video = document.createElement('video')
    video.src = videoSrc
    video.playsInline = true
    video.preload = 'auto'
    await new Promise((resolve, reject) => { video.oncanplay = resolve; video.onerror = () => reject(new Error('video')) })
    mediaSource = audio.createMediaElementSource(video)
    mediaSource.connect(dest)
  }
  const stream = canvas.captureStream(30)
  const hasAudio = Boolean(narration || video)
  const tracks = [...stream.getVideoTracks(), ...(hasAudio ? dest.stream.getAudioTracks() : [])]
  const mimeType = pickRenderMime()
  const recorder = new MediaRecorder(new MediaStream(tracks), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000 })
  const chunks = []
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
  const stopped = new Promise(resolve => { recorder.onstop = resolve })
  const opts = { W, H, colors, images, video, frameStyle }
  drawFrame(ctx, plan, 0, opts)
  let source = null
  const t0 = audio.currentTime + 0.06
  if (narration) {
    source = audio.createBufferSource()
    source.buffer = narration
    source.connect(dest)
    source.start(t0 + plan.narrationStart)
  }
  // 开头那段空场不播：直接跳到该进画面的地方
  if (video && plan.sourceFrom > 0.01) {
    await new Promise((resolve) => { const on = () => { video.removeEventListener('seeked', on); resolve() }; video.addEventListener('seeked', on); video.currentTime = plan.sourceFrom })
  }
  // 先让录像真的开始走，再开录：否则开录到首帧之间会录进去一段定住的画面，成片开头凭空多出零点几秒。
  // 录像起不来（浏览器拦了自动播放、文件坏了）就明确报错，不能让渲染一直停在 0%。
  if (video) {
    const started = await video.play().then(() => true).catch(() => false)
    if (!started) {
      // 这时还没开录，只把设备和流收回来
      if (video) { video.removeAttribute('src'); video.load() }
      mediaSource?.disconnect()
      stream.getTracks().forEach(track => track.stop())
      dest.stream.getTracks().forEach(track => track.stop())
      if (!context) await audio.close().catch(() => {})
      throw Object.assign(new Error('video-blocked'), { code: 'video-blocked' })
    }
    await new Promise((resolve) => {
      if (video.currentTime > 0.001) { resolve(); return }
      const done = () => { video.removeEventListener('timeupdate', done); resolve() }
      video.addEventListener('timeupdate', done)
      setTimeout(done, 500)
    })
    await new Promise(resolve => requestAnimationFrame(resolve))
  }
  recorder.start(1000)
  const recordStart = performance.now()
  let endedAt = null
  let frames = 0
  let dropped = 0
  let last = 0
  let cancelled = false
  await new Promise((resolve) => {
    let raf = 0
    const from = plan.sourceFrom ?? 0
    const clock = () => {
      if (!video) return audio.currentTime - t0
      const at = video.currentTime - from
      if (!video.ended && at < plan.body) return at
      endedAt ??= audio.currentTime
      return plan.body + (audio.currentTime - endedAt)
    }
    const tick = (now) => {
      if (signal?.aborted) { cancelled = true; resolve(); return }
      const t = Math.max(0, clock())
      if (last && now - last > 50) dropped += Math.round((now - last) / 33.3) - 1
      last = now
      if (t >= plan.total) { drawFrame(ctx, plan, plan.total - 0.01, opts); resolve(); return }
      drawFrame(ctx, plan, t, opts)
      frames += 1
      onProgress?.(t / plan.total)
      raf = requestAnimationFrame(tick)
    }
    signal?.addEventListener('abort', () => { cancelAnimationFrame(raf); cancelled = true; resolve() }, { once: true })
    raf = requestAnimationFrame(tick)
  })
  try { source?.stop() } catch { /* 已经停了 */ }
  video?.pause()
  recorder.stop()
  await stopped
  // 文件的真实长度：从开录到停下（比计划长一点点，开头等录像起播的那一下也在里面）
  const recorded = (performance.now() - recordStart) / 1000
  stream.getTracks().forEach(track => track.stop())
  dest.stream.getTracks().forEach(track => track.stop())
  mediaSource?.disconnect()
  if (video) { video.removeAttribute('src'); video.load() }
  if (!context) await audio.close().catch(() => {})
  if (cancelled) return null
  onProgress?.(1)
  return { blob: new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }), seconds: Math.round(recorded * 10) / 10, frames, dropped }
}
