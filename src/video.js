// 视频页的 Host 半片：改写口播稿、出开头建议、删录像文件、用本机 ffmpeg 粗剪。
// ffmpeg 只用参数数组调用，从不经过 shell；输入只能是这条录像自己的文件。
import { execFile } from 'node:child_process'
import { stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { callModel, extractJson, voiceBlock } from './ai.js'
import { tr } from './i18n.js'
import { applyOps, newId } from './ops.js'
import { activeStyle } from './style.js'
import { flowBlock, loadFlow } from './writing-flow.js'

// 录像只认插件自己存的 webm/mp4
export const TAKE_SRC = /^media-desk\/files\/([\w-]+\.(?:webm|mp4))$/
export const MAX_RANGES = 400
export const MAX_SECONDS = 2 * 3600

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

/** 录像地址对应的文件名；不是插件自己的录像文件时返回 null。 */
export function takeFile(src) {
  return TAKE_SRC.exec(String(src ?? ''))?.[1] ?? null
}

/**
 * 校验要保留的时间段：数字、递增、不重叠、落在录像时长里。
 * @param {unknown} keep - [[start, end], …]
 * @param {number} duration - 录像时长（秒）。
 * @returns {Array<[number, number]>} 精确到毫秒的时间段。
 */
export function cleanKeep(keep, duration) {
  if (!Array.isArray(keep) || !keep.length) throw fail(tr('没有要保留的片段'))
  if (keep.length > MAX_RANGES) throw fail(tr('片段太多了，最多 {n} 段', { n: MAX_RANGES }))
  const limit = Number.isFinite(duration) && duration > 0 ? Math.min(duration, MAX_SECONDS) : MAX_SECONDS
  let last = 0
  const out = keep.map((range) => {
    if (!Array.isArray(range) || range.length !== 2) throw fail(tr('片段格式不对'))
    const [s, e] = range.map(v => Math.round(Number(v) * 1000) / 1000)
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) throw fail(tr('片段时间不对'))
    if (s < last) throw fail(tr('片段要按时间先后排好，不能重叠'))
    if (e > limit + 0.5) throw fail(tr('片段超出了录像的长度'))
    last = e
    return [s, Math.min(e, limit)]
  }).filter(([s, e]) => e - s >= 0.04)
  if (!out.length) throw fail(tr('没有要保留的片段'))
  return out
}

const sec = n => n.toFixed(3)

// 每段声音在接缝处各淡入、淡出一点点：剪在静音边上也会有一点点残余噪声，硬拼会「啪」一声。
export const MICRO_FADE = 0.012

/**
 * ffmpeg 的参数：逐段 trim 再 concat，输出 H.264 + AAC 的 mp4。
 * 段与段之间是硬切（口播剪停顿本来就该是硬切，交叉淡化会让人脸糊一下）；只在每段声音的两头做十几毫秒的淡入淡出，接缝不出爆音。
 * @param {{input: string, output: string, keep: Array<[number, number]>, audio?: boolean, encoder?: string, micro?: number}} options
 *   micro 是每段声音两头的淡化秒数，0 表示不加。
 * @returns {string[]} 交给 execFile 的参数数组。
 */
export function ffmpegCutArgs({ input, output, keep, audio = true, encoder = 'libx264', micro = MICRO_FADE, fps = 0 }) {
  const fade = Number(micro) > 0 ? Math.min(Number(micro), 0.05) : 0
  const parts = []
  const pads = []
  keep.forEach(([s, e], i) => {
    const len = e - s
    parts.push(`[0:v]trim=start=${sec(s)}:end=${sec(e)},setpts=PTS-STARTPTS[v${i}]`)
    if (audio) {
      // 两头各淡一下；段太短就不淡，避免两头淡叠加把整段压低
      const ramp = fade && len > fade * 4
        ? `,afade=t=in:st=0:d=${fade.toFixed(3)},afade=t=out:st=${sec(len - fade)}:d=${fade.toFixed(3)}`
        : ''
      parts.push(`[0:a]atrim=start=${sec(s)}:end=${sec(e)},asetpts=PTS-STARTPTS${ramp}[a${i}]`)
    }
    pads.push(audio ? `[v${i}][a${i}]` : `[v${i}]`)
  })
  // H.264 要求宽高是偶数
  parts.push(`${pads.join('')}concat=n=${keep.length}:v=1:a=${audio ? 1 : 0}[vc]${audio ? '[a]' : ''}`)
  parts.push('[vc]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]')
  const video = encoder === 'libx264' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'] : ['-c:v', 'mpeg4', '-q:v', '3']
  // 画布录出来的视频是可变帧率（时间戳忽密忽疏），有些平台不认。给了 fps 就补成恒定帧率。
  const cfr = Number(fps) > 0 ? ['-r', String(Math.round(Number(fps)))] : []
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-i', input,
    '-filter_complex', parts.join(';'),
    '-map', '[v]', ...(audio ? ['-map', '[a]'] : []),
    ...video, ...cfr, ...(audio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-movflags', '+faststart',
    output,
  ]
}

/**
 * 无损导出时切点只能落在关键帧上：每段的开头往前挪到最近的关键帧，挪完重叠的段合并。
 * 思路来自 LosslessCut（github.com/mifi/lossless-cut）的「无损剪切」，代码是自己写的。
 * @param {Array<[number, number]>} keep - 要保留的段。
 * @param {number[]} keyframes - 关键帧时间，升序。
 * @returns {{keep: Array<[number, number]>, maxShift: number, avgGap: number|null}}
 */
export function snapToKeyframes(keep, keyframes) {
  const frames = keyframes.length ? keyframes : [0]
  const out = []
  let maxShift = 0
  for (const [s, e] of keep) {
    let k = 0
    for (const time of frames) if (time <= s + 0.001) k = time
    maxShift = Math.max(maxShift, s - k)
    const last = out[out.length - 1]
    if (last && k <= last[1] + 0.001) last[1] = Math.max(last[1], e)
    else out.push([k, e])
  }
  const gaps = frames.slice(1).map((time, i) => time - frames[i])
  return {
    keep: out.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]),
    maxShift: Math.round(maxShift * 1000) / 1000,
    avgGap: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100) / 100 : null,
  }
}

/** 无损导出用的 concat 清单：同一个文件按 inpoint/outpoint 取几段。 */
export function concatList(file, keep) {
  const quoted = `'${String(file).replace(/'/g, `'\\''`)}'`
  return `ffconcat version 1.0\n${keep.map(([s, e]) => `file ${quoted}\ninpoint ${sec(s)}\noutpoint ${sec(e)}\n`).join('')}`
}

/** 无损导出：不重新编码，直接拷贝音视频数据，几秒就好。 */
export function ffmpegCopyArgs({ list, output }) {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-c', 'copy', ...(output.endsWith('.mp4') ? ['-movflags', '+faststart'] : []),
    output,
  ]
}

/**
 * 剪完以后提词记录跟着挪：每句的时刻换算到剪后的时间线上；开头被剪掉的句子挪到它后面第一段保留的开头。
 * 这样粗剪出来的录像也能按文稿剪、能用真实时间排字幕。
 * @param {Array<{t: number, text: string}>} log
 * @param {Array<[number, number]>} keep
 * @returns {Array<{t: number, text: string}>}
 */
export function mapLog(log, keep) {
  const out = []
  for (const row of Array.isArray(log) ? log : []) {
    let offset = 0
    let mapped = null
    for (const [s, e] of keep) {
      if (row.t < e) { mapped = offset + Math.max(0, row.t - s); break }
      offset += e - s
    }
    if (mapped === null) continue
    const t = Math.round(mapped * 1000) / 1000
    if (out.length && out.at(-1).t === t) out[out.length - 1] = { t, text: row.text }
    else out.push({ t, text: row.text })
  }
  return out
}

/** 给用户自己在终端里跑的命令：每个参数都用单引号包好。 */
export function shellCommand(args) {
  const quote = value => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${String(value).replace(/'/g, `'\\''`)}'`)
  return ['ffmpeg', ...args].map(quote).join(' ')
}

function timecode(seconds, fps) {
  const frames = Math.round(seconds * fps)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(Math.floor(frames / (3600 * fps)))}:${pad(Math.floor(frames / (60 * fps)) % 60)}:${pad(Math.floor(frames / fps) % 60)}:${pad(frames % fps)}`
}

/**
 * CMX3600 剪辑表，剪映以外的剪辑软件（Premiere、DaVinci Resolve、Final Cut 转换后）能直接导入。
 * @param {Array<[number, number]>} keep - 保留段。
 * @param {{title?: string, clip?: string, fps?: number}} [options]
 * @returns {string}
 */
export function cutEdl(keep, { title = 'rough cut', clip = 'take.webm', fps = 30 } = {}) {
  let rec = 0
  const events = keep.map(([s, e], i) => {
    const line = `${String(i + 1).padStart(3, '0')}  AX       AA/V  C        ${timecode(s, fps)} ${timecode(e, fps)} ${timecode(rec, fps)} ${timecode(rec + (e - s), fps)}\n* FROM CLIP NAME: ${clip}\n`
    rec += e - s
    return line
  })
  return `TITLE: ${String(title).replace(/[\r\n]+/g, ' ').slice(0, 60)}\nFCM: NON-DROP FRAME\n\n${events.join('\n')}`
}

/**
 * 没装 ffmpeg 时给用户带走的剪辑清单。
 * @param {{keep: unknown, clip?: string, title?: string, duration?: number}} input
 * @returns {{keep: Array<[number, number]>, command: string, edl: string}}
 */
export function cutPlan({ keep, clip = 'take.webm', title = '', duration }) {
  const ranges = cleanKeep(keep, duration)
  const safeClip = /^[\w.-]+$/.test(clip) ? clip : 'take.webm'
  return {
    keep: ranges,
    command: shellCommand(ffmpegCutArgs({ input: safeClip, output: 'rough-cut.mp4', keep: ranges })),
    edl: cutEdl(ranges, { title: title || 'rough cut', clip: safeClip }),
  }
}

/** 文章改写成口播稿。事实只能来自原稿；写法跟作者选的风格卡和工作流走，不写死在代码里。 */
export function spokenPrompts(production, { voice = '', flow = [] } = {}) {
  const system = [
    '你把一篇已经写好的文章改写成口播稿，给作者本人对着镜头念。',
    '硬性要求：',
    '1. 事实锁定：只能用原文里已有的事实、数字、人名、产品名和判断，不新增事实、例子、数据或引用，不改变结论和立场。',
    '2. 按段落分组：一层意思是一段，段与段之间空一行。段内一句话一行，在换气的地方断，一行一般不超过 30 个字。同一段里的几行要接得上，是在说同一件事；不要把所有句子拉平成一行一行的清单。',
    '3. 不写任何舞台提示、动作说明、镜头或画面描述，不写（停顿）[画面] 【音乐】这类括号说明。',
    '4. 数字写成念出来的样子：2026 年写成二〇二六年，3.5 写成三点五，50% 写成百分之五十，1200 写成一千二百；英文产品名和缩写保留原样。',
    '5. 不要标题、小标题、列表符号和 Markdown；开头直接进入问题或结论。',
    '6. 说人话：用作者本人口播时会用的词、口头禅和语气词，长短句交错，不是念课文。',
    '只输出口播稿正文，不要任何解释。',
    voice ? `\n下面这段是作者本人的写法，口播稿必须像出自同一个人之口：\n${voice}` : '',
    flowBlock(flow),
  ].filter(Boolean).join('\n')
  const user = `标题：${production.title ?? ''}\n\n原文：\n${String(production.article ?? '').slice(0, 30000)}`
  return { system, user }
}

const STAGE = /(停顿|画面|镜头|音乐|BGM|字幕|动作|转场|切到|特写|音效|笑)/

/** 清掉模型可能夹带的 Markdown 和舞台提示，一句一行。 */
export function cleanSpoken(text) {
  const lines = String(text ?? '')
    .replace(/^```[\w-]*\n?|```$/gm, '')
    .split('\n')
    .map(line => line
      .replace(/^\s*#{1,6}\s.*$/, '')
      .replace(/^\s*(?:[-*+>]|\d+[.)、])\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/[【[][^】\]]{0,30}[】\]]/g, '')
      .replace(/[（(]([^）)]{0,12})[）)]/g, (match, inner) => (STAGE.test(inner) ? '' : match))
      .trim())
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000)
}

/** 三个备选开头。只给建议，不改稿子。 */
export function openingPrompts(script, title, count) {
  const system = [
    '你帮口播作者想开头。给出 3 个不同思路的开头，用来替换口播稿的前几句。',
    '要求：只能用稿子里已有的事实和数字，不新增事实；每个开头 1 到 3 句，一句一项；口语，能直接念；不写舞台提示和括号说明；数字写成念出来的样子。',
    '三个开头的思路要明显不同，比如：直接抛结论、从一个具体场景切入、先提一个问题。',
    '只输出 JSON：{"openings":[{"angle":"一句话说明思路","lines":["第一句","第二句"]}]}',
  ].join('\n')
  const user = `标题：${title ?? ''}\n这 ${count} 句会被替换。\n\n口播稿：\n${String(script ?? '').slice(0, 12000)}`
  return { system, user }
}

export function parseOpenings(value) {
  const list = Array.isArray(value?.openings) ? value.openings : []
  return list.slice(0, 3).map((row) => {
    const lines = (Array.isArray(row?.lines) ? row.lines : []).map(line => cleanSpoken(String(line ?? '')).replace(/\n+/g, ' ').slice(0, 80)).filter(Boolean).slice(0, 4)
    return { angle: typeof row?.angle === 'string' ? row.angle.trim().slice(0, 60) : '', lines }
  }).filter(row => row.lines.length)
}

function run(command, args, { timeout = 15_000, maxBuffer = 2_000_000 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer, windowsHide: true }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }))
  })
}

let probe = null

/** 本机有没有 ffmpeg、能不能出 H.264。结果缓存；没装的话一分钟后再查一次，装好不用重启。 */
export function ffmpegInfo() {
  if (probe && (probe.available || Date.now() - probe.at < 60_000)) return Promise.resolve(probe)
  return run('ffmpeg', ['-hide_banner', '-version']).then(async ({ error, stdout }) => {
    if (error) {
      probe = { available: false, at: Date.now() }
      return probe
    }
    const encoders = await run('ffmpeg', ['-hide_banner', '-encoders'])
    // 无损导出要用 ffprobe 找关键帧；它一般和 ffmpeg 装在一起
    const ffprobe = !(await run('ffprobe', ['-hide_banner', '-version'])).error
    probe = { available: true, ffprobe, version: /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? '', encoder: /\blibx264\b/.test(encoders.stdout) ? 'libx264' : 'mpeg4', at: Date.now() }
    return probe
  })
}

/** 读录像有哪些流、多长。ffmpeg -i 不给输出文件时会以错误退出，信息在 stderr 里。 */
async function probeMedia(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', file])
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  // 帧率：60 fps、29.97 fps 这种写法都按「每秒多少帧」读
  const fps = /(\d+(?:\.\d+)?)\s*fps/.exec(stderr)
  return {
    video: /Stream #\S+.*Video:/.test(stderr),
    audio: /Stream #\S+.*Audio:/.test(stderr),
    duration: m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null,
    fps: fps ? Number(fps[1]) : 0,
  }
}

const keyframeCache = new Map()

/** 录像里每个关键帧的时间。文件存下来就不会再变，按文件名缓存。 */
async function keyframeTimes(file) {
  if (keyframeCache.has(file)) return keyframeCache.get(file)
  const { error, stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file], { timeout: 120_000, maxBuffer: 16_000_000 })
  if (error) throw fail(tr('读不出这条录像的关键帧'), 502)
  const times = [...new Set(stdout.split('\n').map(line => Number(line.split(',')[0])).filter(Number.isFinite))].sort((a, b) => a - b)
  if (keyframeCache.size > 50) keyframeCache.clear()
  keyframeCache.set(file, times)
  return times
}

/** 无损导出前先告诉用户：切点会挪多少。 */
async function keyframeInfo(store, body) {
  const info = await ffmpegInfo()
  if (!info.available || !info.ffprobe) return { available: false }
  const state = await store.read()
  const take = findTake(findPiece(state, String(body.id)), String(body.takeId))
  const name = takeFile(take.src)
  if (!name) throw fail(tr('这条录像不是工作台录的，不能在这里剪'))
  const times = await keyframeTimes(join(store.filesDir, name))
  const snapped = snapToKeyframes(cleanKeep(body.keep, (Number(take.seconds) || 0) + 2), times)
  return { available: true, count: times.length, ...snapped }
}

function findPiece(state, id) {
  const item = state.items.find(row => row.id === id)
  if (!item?.production || item.production.status !== 'done') throw fail(tr('这条还没有成稿'), 404)
  return item
}

function findTake(item, takeId) {
  const take = (item.production.takes ?? []).find(row => row.id === takeId)
  if (!take) throw fail(tr('找不到这条录像'), 404)
  return take
}

let cutting = false

async function cutTake(store, body) {
  const info = await ffmpegInfo()
  if (!info.available) throw fail(tr('这台电脑没有装 ffmpeg，可以下载剪辑清单自己剪'))
  if (cutting) throw fail(tr('上一条还在导出，等它结束再试'), 409)
  cutting = true
  const lossless = body.mode === 'copy'
  const stem = newId('f')
  let output = `${stem}.mp4`
  let outFile = join(store.filesDir, output)
  const listFile = join(store.filesDir, `${stem}.ffconcat`)
  try {
    const state = await store.read()
    const item = findPiece(state, String(body.id))
    const take = findTake(item, String(body.takeId))
    const name = takeFile(take.src)
    if (!name) throw fail(tr('这条录像不是工作台录的，不能在这里剪'))
    const input = join(store.filesDir, name)
    // 无损导出不换封装：webm 还是 webm，mp4 还是 mp4
    if (lossless) {
      output = `${stem}${extname(name)}`
      outFile = join(store.filesDir, output)
    }
    await stat(input).catch(() => { throw fail(tr('录像文件不见了'), 404) })
    const media = await probeMedia(input)
    if (!media.video) throw fail(tr('读不出这条录像的画面'))
    let keep = cleanKeep(body.keep, media.duration ?? (Number(take.seconds) || 0) + 1)
    let args
    if (lossless) {
      if (!info.ffprobe) throw fail(tr('无损导出要用 ffprobe 找关键帧，这台电脑上没有'))
      keep = snapToKeyframes(keep, await keyframeTimes(input)).keep
      await writeFile(listFile, concatList(input, keep))
      args = ffmpegCopyArgs({ list: listFile, output: outFile })
    } else {
      // 画面是可变帧率（画布录屏转出来的）时，补成 30 fps 的恒定帧率，抖音、视频号才收
      args = ffmpegCutArgs({ input, output: outFile, keep, audio: media.audio, encoder: info.encoder, fps: media.fps > 0 ? media.fps : 30 })
    }
    const length = keep.reduce((sum, [s, e]) => sum + e - s, 0)
    // 重新编码一般几倍速就能转完；给足余量，但不让它无限跑下去
    const timeout = Math.min(30 * 60_000, 60_000 + Math.ceil(length) * 6_000)
    const { error, stderr } = await run('ffmpeg', args, { timeout, maxBuffer: 4_000_000 })
    if (error) {
      await unlink(outFile).catch(() => {})
      const reason = error.killed ? tr('超时了') : stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300) || error.message
      throw fail(tr('ffmpeg 没剪成：{reason}', { reason }), 502)
    }
    const src = `media-desk/files/${output}`
    const seconds = Math.round(length * 10) / 10
    return await store.mutate(tr('粗剪录像'), (draft) => {
      const log = mapLog(take.log, keep)
      const { receipts, errors } = applyOps(draft, [{ op: 'add_take', id: item.id, src, kind: take.kind === 'voice' ? 'voice' : take.kind === 'render' ? 'render' : take.kind, seconds, from: take.id, ...(log.length ? { log } : {}) }])
      if (errors.length) throw fail(errors[0])
      return { take: receipts[0]?.take, state: draft }
    }, { undoable: false })
  } catch (err) {
    await unlink(outFile).catch(() => {})
    throw err
  } finally {
    await unlink(listFile).catch(() => {})
    cutting = false
  }
}

/** 删一条录像，同时删掉文件；文件还被别处用着（灵感墙或另一条录像）时只删记录。 */
async function deleteTake(store, body) {
  const state = await store.read()
  const item = findPiece(state, String(body.id))
  const take = findTake(item, String(body.takeId))
  const next = await store.mutate(tr('删除录像'), (draft) => {
    const { errors } = applyOps(draft, [{ op: 'delete_take', id: item.id, takeId: take.id }])
    if (errors.length) throw fail(errors[0])
    return draft
  }, { undoable: false })
  const name = takeFile(take.src)
  const used = next.items.some(row => row.media?.src === take.src || row.media?.poster === take.src || (row.production?.takes ?? []).some(other => other.src === take.src))
  if (name && !used) {
    await unlink(join(store.filesDir, name)).catch(() => {})
    // 文件没了：撤销记录里的这条录像也去掉，之后撤销别的操作不会把它带回来
    await store.scrubUndo(past => ({
      ...past,
      items: (past.items ?? []).map(row => (row.production?.takes?.some(other => other.src === take.src)
        ? { ...row, production: { ...row.production, takes: row.production.takes.filter(other => other.src !== take.src) } }
        : row)),
    }))
  }
  return { state: next, removedFile: Boolean(name && !used) }
}

async function convertToSpoken(ctx, store, body) {
  const state = await store.read()
  const item = findPiece(state, String(body.id))
  if (!item.production.article?.trim()) throw fail(tr('这篇成稿没有正文'))
  // 写法跟作者自己的设置走：风格卡 + 选过的写作工作流文件，不写死在代码里
  const settings = typeof body.settings === 'object' && body.settings ? body.settings : null
  const flow = settings ? await loadFlow(settings).catch(() => ({ parts: [] })) : { parts: [] }
  const voice = voiceBlock(state, settings?.voice ?? '')
  let text
  let model
  try {
    const result = await callModel(ctx, { task: '口播改写', ...spokenPrompts(item.production, { voice, flow: flow.parts }), maxTokens: 8000, light: true, signal: AbortSignal.timeout(240_000) })
    text = cleanSpoken(result.text)
    model = result.model
  } catch (err) {
    throw fail(tr('改写口播稿需要文字模型：{error}', { error: err.message }), 502)
  }
  if (!text) throw fail(tr('模型没有返回口播稿，再试一次'), 502)
  return store.mutate(tr('改写成口播稿'), (draft) => {
    const { errors } = applyOps(draft, [{ op: 'update_video', id: item.id, spoken: text }])
    if (errors.length) throw fail(errors[0])
    return { state: draft, model }
  })
}

async function suggestOpenings(ctx, store, body) {
  const item = findPiece(await store.read(), String(body.id))
  const script = typeof body.script === 'string' ? body.script.slice(0, 20000) : ''
  if (!script.trim()) throw fail(tr('先写好口播稿'))
  const count = Math.max(1, Math.min(3, Math.round(Number(body.count) || 2)))
  try {
    const { text, model } = await callModel(ctx, { task: '口播开头', ...openingPrompts(script, item.production.title, count), maxTokens: 1500, light: true, signal: AbortSignal.timeout(120_000) })
    const openings = parseOpenings(extractJson(text))
    if (!openings.length) throw new Error(tr('模型没有给出可用的开头'))
    return { openings, count, model }
  } catch (err) {
    throw fail(tr('生成开头需要文字模型：{error}', { error: err.message }), 502)
  }
}

const SLOT_HINTS = {
  hook: '"hook": "开头 3 秒的钩子，一句话，15 个字以内，用稿子里最抓人的那个事实或判断"',
  chapters: '"chapters": ["3 到 5 个章节标题，每个 8 个字以内，按稿子的顺序"]',
  keywords: '"keywords": ["字幕里要高亮的 3 到 6 个重点词，必须是稿子里原样出现的词，每个 2 到 6 个字"]',
  endLine: '"endLine": "片尾一句话，20 个字以内，可以是总结，也可以请观众关注，但不许编造稿子里没有的承诺"',
  quote: '"quote": "稿子里最值得单独做成大字报的一句，原句或轻微缩短，40 个字以内"',
  leftLabel: '"leftLabel": "对比左边的标签，6 个字以内"',
  rightLabel: '"rightLabel": "对比右边的标签，6 个字以内"',
}

/** 模板的文字槽：只能用稿子里的事实。 */
export function slotPrompts(script, title, keys) {
  const wanted = keys.filter(key => SLOT_HINTS[key])
  const system = [
    '你帮短视频作者把一篇口播稿套进剪辑模板，填模板里的几处文字。',
    '硬性要求：只用稿子里已有的事实、数字和说法，不新增事实，不夸大；口语，能直接上屏；不要表情符号和井号标签。',
    `只输出 JSON：{${wanted.map(key => SLOT_HINTS[key]).join(', ')}}`,
  ].join('\n')
  return { system, user: `标题：${title ?? ''}\n\n口播稿：\n${String(script ?? '').slice(0, 12000)}` }
}

/** 清理模型填的文字槽；重点词只留稿子里真有的。 */
export function parseSlots(value, script, keys) {
  const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const list = (v, n, max) => (Array.isArray(v) ? v.map(row => text(row, max)).filter(Boolean).slice(0, n) : [])
  const all = {
    hook: text(value?.hook, 30), chapters: list(value?.chapters, 6, 16), keywords: list(value?.keywords, 8, 10).filter(word => String(script).includes(word)),
    endLine: text(value?.endLine, 24), quote: text(value?.quote, 40), leftLabel: text(value?.leftLabel, 10), rightLabel: text(value?.rightLabel, 10),
  }
  return Object.fromEntries(keys.filter(key => key in all).map(key => [key, all[key]]))
}

async function fillSlots(ctx, store, body) {
  const item = findPiece(await store.read(), String(body.id))
  const script = typeof body.script === 'string' ? body.script.slice(0, 20000) : ''
  if (!script.trim()) throw fail(tr('先写好口播稿'))
  const keys = (Array.isArray(body.keys) ? body.keys : []).filter(key => typeof key === 'string' && SLOT_HINTS[key]).slice(0, 7)
  if (!keys.length) throw fail(tr('这个模板没有要填的文字'))
  try {
    const { text, model } = await callModel(ctx, { task: '视频内容填充', ...slotPrompts(script, item.production.title, keys), maxTokens: 1200, light: true, signal: AbortSignal.timeout(120_000) })
    return { slots: parseSlots(extractJson(text), script, keys), model }
  } catch (err) {
    throw fail(tr('填模板文字需要文字模型：{error}', { error: err.message }), 502)
  }
}

/**
 * /media-desk/video/* 接口。
 * @returns {Promise<object|null>} 不是视频接口时返回 null。
 */
export async function videoRoute(ctx, store, method, path, body) {
  if (method === 'GET' && path === 'video/status') {
    const info = await ffmpegInfo()
    return { ffmpeg: info.available, ffprobe: Boolean(info.ffprobe), encoder: info.encoder ?? null, version: info.version ?? null }
  }
  if (method !== 'POST') return null
  switch (path) {
    case 'video/spoken': return convertToSpoken(ctx, store, body)
    case 'video/openings': return suggestOpenings(ctx, store, body)
    case 'video/delete-take': return deleteTake(store, body)
    case 'video/cut': return cutTake(store, body)
    case 'video/keyframes': return keyframeInfo(store, body)
    case 'video/template-slots': return fillSlots(ctx, store, body)
    case 'video/cut-plan': return cutPlan({ keep: body.keep, clip: typeof body.clip === 'string' ? body.clip : undefined, title: typeof body.title === 'string' ? body.title : '', duration: Number(body.duration) || undefined })
    default: return null
  }
}
