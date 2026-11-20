// 粗剪用的声音分析：按 20 毫秒算音量，找出停顿，换算成要保留的时间段。
// 前半部分是纯函数（测试直接用）；decodeTakeAudio 只在浏览器里跑。

export const FRAME_SEC = 0.02
export const DEFAULT_THRESHOLD = -40
export const DEFAULT_MIN_GAP = 0.6
// 停顿判断照搬 auto-editor 的做法：先按音量分出「有声/没声」，有声的两头各扩出 margin（留气口），
// 再反复做两件事直到稳定——短于 minClip 的有声段算没声（咳嗽、碰麦），短于 minCut 的没声段算有声（句中换气）。
// 移植自 auto-editor（https://github.com/WyattBlue/auto-editor ，Unlicense）src/lib/editutil.nim 的 mutMargin 和 smoothing，用 JS 重写。
export const DEFAULT_PAD = 0.15
export const DEFAULT_MIN_CLIP = 0.3
const FLOOR_DB = -100

/**
 * 每一帧的音量（dBFS）。多声道先取平均。
 * @param {Float32Array[]} channels - 各声道的采样。
 * @param {number} sampleRate - 采样率。
 * @param {number} [frameSec] - 帧长，默认 20 毫秒。
 * @returns {Float32Array} 每帧的分贝值，静音为 -100。
 */
export function rmsFrames(channels, sampleRate, frameSec = 0.02) {
  // 不引用外面的常量：这个函数会原样放进后台线程里跑
  const floor = -100
  const length = channels[0]?.length ?? 0
  const size = Math.max(1, Math.round(sampleRate * frameSec))
  const count = Math.ceil(length / size)
  const out = new Float32Array(count)
  for (let f = 0; f < count; f += 1) {
    const from = f * size
    const to = Math.min(length, from + size)
    let sum = 0
    for (let i = from; i < to; i += 1) {
      let v = 0
      for (const channel of channels) v += channel[i]
      v /= channels.length
      sum += v * v
    }
    const rms = Math.sqrt(sum / Math.max(1, to - from))
    out[f] = rms > 0 ? Math.max(floor, 20 * Math.log10(rms)) : floor
  }
  return out
}

/** auto-editor mutMargin：有声段的开头往前、结尾往后各扩 start / end 帧。 */
export function applyMargin(active, start, end) {
  const out = active.slice()
  const starts = []
  const ends = []
  for (let j = 1; j < active.length; j += 1) {
    if (active[j] !== active[j - 1]) (active[j] ? starts : ends).push(j)
  }
  if (start > 0) for (const i of starts) for (let k = Math.max(i - start, 0); k < i; k += 1) out[k] = true
  if (end > 0) for (const i of ends) for (let k = i; k < Math.min(i + end, active.length); k += 1) out[k] = true
  return out
}

/** auto-editor smoothing：反复去掉太短的有声段和太短的没声段，直到不再变化（或在两种状态间来回时停下）。 */
export function smoothActive(active, minCut, minClip) {
  let val = active.slice()
  let prev = null
  let prev2 = null
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => v === b[i])
  while (!same(prev, val) && !same(prev2, val)) {
    prev2 = prev
    prev = val
    const next = prev.slice()
    for (const [flag, min] of [[true, minClip], [false, minCut]]) {
      let start = 0
      let open = false
      for (let j = 0; j < prev.length; j += 1) {
        if (prev[j] === flag) {
          if (!open) { start = j; open = true }
          if (j === prev.length - 1 && j - start + 1 < min) for (let i = start; i < prev.length; i += 1) next[i] = !flag
        } else if (open) {
          if (j - start < min) for (let i = start; i < j; i += 1) next[i] = !flag
          open = false
        }
      }
    }
    val = next
  }
  return val
}

/**
 * 找停顿：低于阈值算没声；有声段两头扩 pad（留气口）；再按 auto-editor 的规则抹掉短于 minClip 的有声段、短于 minGap 的没声段。
 * 剩下的没声段就是要剪掉的停顿。
 * @param {ArrayLike<number>} db - 每帧分贝。
 * @param {{frameSec?: number, threshold?: number, minGap?: number, pad?: number, minClip?: number}} [options]
 * @returns {Array<[number, number]>} 停顿的起止秒数。
 */
export function detectSilences(db, { frameSec = FRAME_SEC, threshold = DEFAULT_THRESHOLD, minGap = DEFAULT_MIN_GAP, pad = DEFAULT_PAD, minClip = DEFAULT_MIN_CLIP } = {}) {
  const frames = n => Math.max(0, Math.round(n / frameSec))
  let active = Array.from(db, v => v >= threshold)
  active = applyMargin(active, frames(pad), frames(pad))
  active = smoothActive(active, frames(minGap), frames(minClip))
  const out = []
  let start = -1
  for (let i = 0; i <= active.length; i += 1) {
    const quiet = i < active.length && !active[i]
    if (quiet && start < 0) start = i
    if (!quiet && start >= 0) {
      out.push([round3(start * frameSec), round3(i * frameSec)])
      start = -1
    }
  }
  return out
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

/**
 * 把整条录像分成说话段和停顿段，停顿段默认剪掉。
 * @param {number} duration - 总时长。
 * @param {Array<[number, number]>} silences - 停顿。
 * @returns {Array<{start: number, end: number, silence: boolean}>}
 */
export function buildRegions(duration, silences) {
  const regions = []
  let at = 0
  for (const [s, e] of silences) {
    if (s > at) regions.push({ start: at, end: s, silence: false })
    regions.push({ start: s, end: Math.min(e, duration), silence: true })
    at = Math.min(e, duration)
  }
  if (duration - at > 0.001) regions.push({ start: at, end: round3(duration), silence: false })
  return regions
}

/**
 * 要保留的时间段：相邻的保留段合并成一段。
 * @param {Array<{start: number, end: number}>} regions - 段落。
 * @param {(region: object, index: number) => boolean} keep - 这一段留不留。
 * @returns {Array<[number, number]>}
 */
export function keepRanges(regions, keep) {
  const out = []
  regions.forEach((region, index) => {
    if (!keep(region, index)) return
    const last = out[out.length - 1]
    if (last && Math.abs(last[1] - region.start) < 0.001) last[1] = region.end
    else out.push([region.start, region.end])
  })
  return out.map(([s, e]) => [round3(s), round3(e)])
}

export function rangesLength(ranges) {
  return ranges.reduce((sum, [s, e]) => sum + (e - s), 0)
}

/**
 * 预览剪后效果时，播到剪掉的地方该跳到哪。
 * @param {number} t - 当前时间。
 * @param {Array<[number, number]>} keep - 保留段。
 * @returns {number|null} 不用跳时原样返回 t；后面已经没有保留段时返回 null。
 */
export function skipTarget(t, keep) {
  for (const [s, e] of keep) {
    if (t < s - 0.01) return s
    if (t < e - 0.01) return t
  }
  return null
}

/**
 * 画波形用：把每帧分贝压到 width 列，每列取最大值，换算成 0–1 的高度。
 * @param {ArrayLike<number>} db - 每帧分贝。
 * @param {number} width - 列数。
 * @returns {Float32Array}
 */
export function waveColumns(db, width) {
  const out = new Float32Array(Math.max(0, width))
  if (!db.length || !width) return out
  for (let x = 0; x < width; x += 1) {
    const from = Math.floor((x * db.length) / width)
    const to = Math.max(from + 1, Math.floor(((x + 1) * db.length) / width))
    let max = FLOOR_DB
    for (let i = from; i < to && i < db.length; i += 1) if (db[i] > max) max = db[i]
    out[x] = Math.min(1, Math.max(0, (max + 60) / 60))
  }
  return out
}

// 同一条录像分析一次就记住；最多记 4 条，免得长录像的数据一直占着内存
const analysed = new Map()

/** 在后台线程里算每帧音量，页面不卡；后台线程起不来时分段算，每段之间让出主线程。 */
function framesOffThread(channels, sampleRate) {
  return new Promise((resolve) => {
    let url = null
    let worker = null
    const fallback = async () => {
      const size = Math.round(sampleRate * FRAME_SEC)
      const chunk = size * 500
      const parts = []
      for (let at = 0; at < channels[0].length; at += chunk) {
        parts.push(rmsFrames(channels.map(c => c.subarray(at, at + chunk)), sampleRate))
        await new Promise(r => setTimeout(r, 0))
      }
      const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
      let o = 0
      for (const p of parts) { out.set(p, o); o += p.length }
      resolve(out)
    }
    try {
      url = URL.createObjectURL(new Blob([`const rmsFrames = ${rmsFrames.toString()}\nonmessage = (e) => { const db = rmsFrames(e.data.channels, e.data.sampleRate); postMessage(db, [db.buffer]) }`], { type: 'text/javascript' }))
      worker = new Worker(url)
    } catch {
      if (url) URL.revokeObjectURL(url)
      fallback()
      return
    }
    const done = () => { worker.terminate(); URL.revokeObjectURL(url) }
    worker.onmessage = (event) => { done(); resolve(event.data) }
    worker.onerror = () => { done(); fallback() }
    // 复制一份交给后台线程（原数据还要留给回退路径）
    const copies = channels.map(c => c.slice())
    worker.postMessage({ channels: copies, sampleRate }, copies.map(c => c.buffer))
  })
}

/**
 * 在浏览器里解出一条录像的声音并算好每帧音量。按 16 kHz 解码，十分钟的录像也只占几十 MB，算完就丢掉采样。
 * @param {string} src - 录像地址。
 * @param {AbortSignal} [signal]
 * @returns {Promise<{db: Float32Array, duration: number, channels: number, ms: number}>} ms 是这次分析花的毫秒数（读缓存时为 0）。
 */
export async function decodeTakeAudio(src, signal) {
  if (analysed.has(src)) return { ...analysed.get(src), ms: 0 }
  const began = performance.now()
  const res = await fetch(src, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.arrayBuffer()
  const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext
  if (!Offline) throw Object.assign(new Error('no-webaudio'), { code: 'no-webaudio' })
  let buffer
  try {
    buffer = await new Offline(1, 1, 16000).decodeAudioData(data)
  } catch {
    throw Object.assign(new Error('no-audio'), { code: 'no-audio' })
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  if (!channels.length || !buffer.length) throw Object.assign(new Error('no-audio'), { code: 'no-audio' })
  const db = await framesOffThread(channels, buffer.sampleRate)
  const result = { db, duration: buffer.duration, channels: channels.length }
  analysed.set(src, result)
  if (analysed.size > 4) analysed.delete(analysed.keys().next().value)
  return { ...result, ms: Math.round(performance.now() - began) }
}

/**
 * 提词记录换算成每句的时间段：一句从它出现在阅读线上开始，到下一句出现为止。
 * @param {Array<{t: number, text: string}>} log - 录制时提词换句的时刻（秒，从开录算起）。
 * @param {number} duration - 录像时长。
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function logRanges(log, duration) {
  const rows = (Array.isArray(log) ? log : []).filter(row => Number.isFinite(row?.t) && row.t < duration)
  return rows.map((row, i) => ({ start: round3(Math.max(0, row.t)), end: round3(i + 1 < rows.length ? Math.max(row.t, rows[i + 1].t) : duration), text: String(row.text ?? '') }))
    .filter(row => row.end - row.start > 0.001)
}

/** 去掉一些时间段后剩下的部分。 */
export function subtractRanges(duration, removed) {
  const out = []
  let at = 0
  for (const [s, e] of [...removed].sort((a, b) => a[0] - b[0])) {
    if (s > at) out.push([at, s])
    at = Math.max(at, e)
  }
  if (duration > at) out.push([at, duration])
  return out.map(([s, e]) => [round3(s), round3(e)]).filter(([s, e]) => e - s > 0.001)
}

/** 两组保留段的交集：停顿剪掉的和按文稿删掉的，都不要。 */
export function intersectRanges(a, b) {
  const out = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0])
    const e = Math.min(a[i][1], b[j][1])
    if (e - s > 0.001) out.push([round3(s), round3(e)])
    if (a[i][1] < b[j][1]) i += 1
    else j += 1
  }
  return out
}
