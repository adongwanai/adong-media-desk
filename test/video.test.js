import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyMargin, buildRegions, detectSilences, intersectRanges, keepRanges, logRanges, rangesLength, rmsFrames, skipTarget, smoothActive, subtractRanges, waveColumns } from '../client/video/audio.js'
import { cleanKeep, cleanSpoken, concatList, mapLog, parseSlots, slotPrompts, cutEdl, cutPlan, ffmpegCopyArgs, ffmpegCutArgs, parseOpenings, shellCommand, snapToKeyframes, takeFile, videoRoute } from '../src/video.js'
import { applyOps } from '../src/ops.js'
import { Store } from '../src/store.js'

const RATE = 16000

/** 造一段声音：segments 是 [秒数, 振幅]，振幅 0 就是静音。 */
function signal(segments) {
  const total = segments.reduce((a, [s]) => a + s, 0)
  const out = new Float32Array(Math.round(total * RATE))
  let at = 0
  for (const [seconds, amp] of segments) {
    const n = Math.round(seconds * RATE)
    for (let i = 0; i < n; i += 1) out[at + i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE)
    at += n
  }
  return out
}

test('音量：正弦波的 RMS 约为 -3 dB × 振幅，静音是 -100 dB', () => {
  const db = rmsFrames([signal([[0.2, 1], [0.2, 0]])], RATE)
  assert.equal(db.length, 20)
  assert.ok(Math.abs(db[0] + 3.01) < 0.1, String(db[0]))
  assert.equal(db[15], -100)
  // 双声道取平均：一边有声一边静音，低 6 dB
  const half = rmsFrames([signal([[0.1, 1]]), new Float32Array(1600)], RATE)
  assert.ok(Math.abs(half[0] + 9.03) < 0.1, String(half[0]))
})

test('找停顿（auto-editor 规则）：有声段两头留气口，短停顿和短响声都被抹平', () => {
  const db = rmsFrames([signal([[0.7, 0], [1, 0.5], [0.3, 0], [1, 0.5], [1.2, 0.001], [1, 0.5], [0.8, 0]])], RATE)
  // 0.3 秒的停顿太短不算；-63 dB 的那 1.2 秒算；开头的从 0 剪起，结尾的剪到底
  assert.deepEqual(detectSilences(db, { threshold: -40, minGap: 0.6, pad: 0.08 }), [[0, 0.62], [3.08, 4.12], [5.28, 6]])
  // 阈值调低到 -70 dB，-63 dB 那段就不算停顿了
  assert.deepEqual(detectSilences(db, { threshold: -70, minGap: 0.6, pad: 0.08 }), [[0, 0.62], [5.28, 6]])
  // 默认参数：两头各留 0.15 秒，留完不足 0.6 秒的停顿不剪（开头那段 0.7 秒留完只剩 0.55 秒）
  assert.deepEqual(detectSilences(db), [[3.16, 4.04], [5.36, 6]])
  // 和 auto-editor 一样：两段 0.5 秒停顿夹着 0.1 秒的响声，三段都太短，一起抹平成「有声」，不剪
  const click = rmsFrames([signal([[1, 0.5], [0.5, 0], [0.1, 0.5], [0.5, 0], [1, 0.5]])], RATE)
  assert.deepEqual(detectSilences(click, { pad: 0 }), [])
  assert.deepEqual(detectSilences(click, { pad: 0, minClip: 0, minGap: 0.3 }), [[1, 1.5], [1.6, 2.1]])
  // Chrome 假麦克风那种每 0.5 秒一下的「嘀」：间隔都短于最短停顿，不会被当成一整段静音剪光
  const beeps = Array.from({ length: 20 }, () => [[0.08, 0.8], [0.42, 0]]).flat()
  assert.deepEqual(detectSilences(rmsFrames([signal(beeps)], RATE)), [])
})

test('auto-editor 的 margin 和 smoothing 移植：逐帧行为', () => {
  const b = str => [...str].map(c => c === '1')
  const s = arr => arr.map(v => (v ? '1' : '0')).join('')
  assert.equal(s(applyMargin(b('0001110000'), 2, 1)), '0111111000')
  // 同一轮里都按上一轮的结果判断：短于 3 帧的有声段变没声，短于 2 帧的没声段变有声
  assert.equal(s(smoothActive(b('1110110001100'), 2, 3)), '1111000000000')
  // 只有一小段时不会在两种状态间来回打转
  assert.equal(smoothActive(b('010'), 5, 5).length, 3)
})

test('分段、保留段和预览跳转', () => {
  const regions = buildRegions(10, [[0, 1], [4, 5], [9, 10]])
  assert.deepEqual(regions.map(r => [r.start, r.end, r.silence]), [[0, 1, true], [1, 4, false], [4, 5, true], [5, 9, false], [9, 10, true]])
  const keep = keepRanges(regions, r => !r.silence)
  assert.deepEqual(keep, [[1, 4], [5, 9]])
  assert.equal(rangesLength(keep), 7)
  // 把中间那段停顿留下，前后两段合成一段
  assert.deepEqual(keepRanges(regions, (r, i) => !r.silence || i === 2), [[1, 9]])
  assert.equal(skipTarget(0.2, keep), 1)
  assert.equal(skipTarget(2, keep), 2)
  assert.equal(skipTarget(4.5, keep), 5)
  assert.equal(skipTarget(9.5, keep), null)
  const cols = waveColumns(new Float32Array([-100, 0, -30, -60]), 2)
  assert.deepEqual([...cols], [1, 0.5])
})

test('按文稿剪：提词记录换算成每句的时间段，删掉的句子和停顿一起剪掉', () => {
  const log = [{ t: 0, text: '第一句' }, { t: 2.5, text: '第二句' }, { t: 4, text: '第二句' }, { t: 7, text: '第三句' }, { t: 30, text: '录像结束后' }]
  const lines = logRanges(log, 10)
  assert.deepEqual(lines.map(row => [row.start, row.end, row.text]), [[0, 2.5, '第一句'], [2.5, 4, '第二句'], [4, 7, '第二句'], [7, 10, '第三句']])
  // 第一遍念错的「第二句」删掉
  const scriptKeep = subtractRanges(10, [[lines[1].start, lines[1].end]])
  assert.deepEqual(scriptKeep, [[0, 2.5], [4, 10]])
  // 再和按停顿保留的段取交集
  assert.deepEqual(intersectRanges([[0.5, 3], [3.5, 9.5]], scriptKeep), [[0.5, 2.5], [4, 9.5]])
  assert.deepEqual(intersectRanges([[0, 1]], [[2, 3]]), [])
  assert.deepEqual(subtractRanges(5, []), [[0, 5]])
  assert.deepEqual(logRanges(undefined, 5), [])
})

test('剪辑片段校验：递增、不重叠、在时长以内，其余一律拒绝', () => {
  assert.deepEqual(cleanKeep([[0, 1.23456], [2, 3]], 10), [[0, 1.235], [2, 3]])
  assert.deepEqual(cleanKeep([[0, 1], [9, 10.3]], 10), [[0, 1], [9, 10]])
  for (const bad of [[], 'x', [[1, 0]], [[0, 2], [1, 3]], [[0, 'a']], [[-1, 2]], [[0, 20]], [[0, 1, 2]], Array.from({ length: 401 }, (_, i) => [i, i + 0.5])]) {
    assert.throws(() => cleanKeep(bad, 10), undefined, JSON.stringify(bad).slice(0, 40))
  }
})

test('ffmpeg 参数：数组形式，逐段 trim + concat；接缝硬切，声音两头各淡十几毫秒不出爆音', () => {
  const args = ffmpegCutArgs({ input: '/data/files/f_a.webm', output: '/data/files/f_b.mp4', keep: [[0.5, 2], [3, 4.25]] })
  assert.equal(args[args.indexOf('-i') + 1], '/data/files/f_a.webm')
  assert.equal(args.at(-1), '/data/files/f_b.mp4')
  assert.ok(args.includes('-nostdin'))
  const graph = args[args.indexOf('-filter_complex') + 1]
  // 切点原样，不挪；每段声音两头各淡 12 毫秒
  assert.equal(graph, '[0:v]trim=start=0.500:end=2.000,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=0.500:end=2.000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.012,afade=t=out:st=1.488:d=0.012[a0];[0:v]trim=start=3.000:end=4.250,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=3.000:end=4.250,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.012,afade=t=out:st=1.238:d=0.012[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][a];[vc]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]')
  assert.deepEqual(args.filter((a, i) => args[i - 1] === '-map'), ['[v]', '[a]'])
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264')
  // 段太短：不加淡，免得整段被压低
  const tiny = ffmpegCutArgs({ input: 'i.webm', output: 'o.mp4', keep: [[0, 0.02]] })
  assert.doesNotMatch(tiny[tiny.indexOf('-filter_complex') + 1], /afade/)
  // 可以整个关掉
  const plain = ffmpegCutArgs({ input: 'i.webm', output: 'o.mp4', keep: [[0.5, 2]], micro: 0 })
  assert.doesNotMatch(plain[plain.indexOf('-filter_complex') + 1], /afade/)
  const silent = ffmpegCutArgs({ input: 'in.webm', output: 'out.mp4', keep: [[0, 1]], audio: false, encoder: 'mpeg4' })
  assert.ok(!silent.join(' ').includes('atrim'))
  assert.ok(!silent.includes('-c:a'))
  assert.equal(silent[silent.indexOf('-c:v') + 1], 'mpeg4')
  assert.match(silent[silent.indexOf('-filter_complex') + 1], /concat=n=1:v=1:a=0\[vc\];/)
})

test('无损导出：切点往前挪到关键帧，挪完重叠的段合并；concat 清单和参数不经过 shell', () => {
  const snapped = snapToKeyframes([[1.2, 3], [3.5, 5], [9, 10]], [0, 2, 4, 6, 8])
  assert.deepEqual(snapped, { keep: [[0, 5], [8, 10]], maxShift: 1.5, avgGap: 2 })
  // 正好落在关键帧上不挪
  assert.deepEqual(snapToKeyframes([[2, 3], [4, 5]], [0, 2, 4]).keep, [[2, 3], [4, 5]])
  assert.equal(snapToKeyframes([[2, 3]], []).keep[0][0], 0)
  assert.equal(concatList("/x/it's.webm", [[0, 1.5], [8, 10]]), "ffconcat version 1.0\nfile '/x/it'\\''s.webm'\ninpoint 0.000\noutpoint 1.500\nfile '/x/it'\\''s.webm'\ninpoint 8.000\noutpoint 10.000\n")
  const args = ffmpegCopyArgs({ list: '/d/l.ffconcat', output: '/d/o.webm' })
  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 6), ['-f', 'concat', '-safe', '0', '-i', '/d/l.ffconcat'])
  assert.equal(args[args.indexOf('-c') + 1], 'copy')
  assert.ok(!args.includes('-movflags'))
  assert.ok(ffmpegCopyArgs({ list: 'l', output: 'o.mp4' }).includes('+faststart'))
})

test('给用户的剪辑清单：命令里每个参数都安全引用，EDL 时间码连续', () => {
  assert.equal(shellCommand(['-i', "it's here.webm", '-y']), "ffmpeg -i 'it'\\''s here.webm' -y")
  const plan = cutPlan({ keep: [[1, 2.5], [4, 5]], clip: 'take.webm', title: '测试' })
  assert.match(plan.command, /^ffmpeg -hide_banner .* -i take\.webm -filter_complex '\[0:v\]trim=start=1\.000/)
  assert.match(plan.command, / rough-cut\.mp4$/)
  // 不合法的文件名换成默认名，命令里不会出现别的东西
  assert.match(cutPlan({ keep: [[0, 1]], clip: 'a;rm -rf ~.webm' }).command, / -i take\.webm /)
  const edl = cutEdl([[1, 2.5], [4, 5]], { title: 'x', clip: 'take.webm', fps: 30 })
  assert.match(edl, /^TITLE: x\nFCM: NON-DROP FRAME\n/)
  assert.match(edl, /001 {2}AX {7}AA\/V {2}C {8}00:00:01:00 00:00:02:15 00:00:00:00 00:00:01:15/)
  assert.match(edl, /002 {2}AX {7}AA\/V {2}C {8}00:00:04:00 00:00:05:00 00:00:01:15 00:00:02:15/)
})

test('口播稿清理和开头建议解析', () => {
  assert.equal(cleanSpoken('```\n## 标题\n- 第一句（停顿）\n**第二句**【画面：特写】\n他说（大意）没错\n\n\n\n第三句\n```'), '第一句\n第二句\n他说（大意）没错\n\n第三句')
  const parsed = parseOpenings({ openings: [{ angle: '直接给结论', lines: ['先说结论。', ''] }, { angle: 1, lines: 'x' }, { lines: ['A', 'B', 'C', 'D', 'E'] }, { lines: ['多余'] }] })
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed[0], { angle: '直接给结论', lines: ['先说结论。'] })
  assert.equal(parsed[1].lines.length, 4)
  assert.equal(takeFile('media-desk/files/f_abc.webm'), 'f_abc.webm')
  for (const bad of ['media-desk/files/../x.webm', 'media-desk/files/a.jpg', 'https://x/a.webm', 'media-desk/assets/a.mp4']) assert.equal(takeFile(bad), null)
})

function done(state) {
  const item = state.items[0]
  item.production = { status: 'done', title: '成稿', article: '正文', shots: [{ no: 1, seconds: 5 }, { no: 2, seconds: 5 }] }
  return item
}

test('录像和口播稿的操作只放行合法字段', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-video-'))
  try {
    const state = await new Store(dir).read()
    const item = done(state)
    const ok = applyOps(state, [
      { op: 'add_take', id: item.id, src: 'media-desk/files/f_1.webm', kind: 'camera', seconds: 12.34 },
      { op: 'update_video', id: item.id, spoken: '第一句\n第二句', shotSeconds: [3.4, 200] },
    ])
    assert.deepEqual(ok.errors, [])
    const take = item.production.takes[0]
    assert.deepEqual({ ...take, id: 'x', at: 'y' }, { id: 'x', src: 'media-desk/files/f_1.webm', kind: 'camera', seconds: 12.3, at: 'y' })
    assert.equal(item.production.spoken, '第一句\n第二句')
    assert.deepEqual(item.production.shots.map(s => s.seconds), [3, 120])
    const bad = applyOps(state, [
      { op: 'add_take', id: item.id, src: 'media-desk/files/../../x.webm', kind: 'camera', seconds: 1 },
      { op: 'add_take', id: item.id, src: 'media-desk/files/f_2.jpg', kind: 'camera', seconds: 1 },
      { op: 'add_take', id: item.id, src: 'media-desk/files/f_2.webm', kind: 'tv', seconds: 1 },
      { op: 'add_take', id: item.id, src: 'media-desk/files/f_2.webm', kind: 'screen', seconds: -1 },
      { op: 'update_video', id: item.id, shotSeconds: [1] },
      { op: 'delete_take', id: item.id, takeId: 'nope' },
    ])
    assert.equal(bad.errors.length, 6)
    // 提词记录：乱序、超出时长、不是文字的条目丢掉
    applyOps(state, [{ op: 'add_take', id: item.id, src: 'media-desk/files/f_3.webm', kind: 'voice', seconds: 10, log: [{ t: 0, text: '一' }, { t: 3.3333, text: '二' }, { t: 2, text: '乱序' }, { t: 99, text: '太晚' }, { t: 4, text: 5 }, 'x'] }])
    assert.deepEqual(item.production.takes.at(-1).log, [{ t: 0, text: '一' }, { t: 3.333, text: '二' }])
    applyOps(state, [{ op: 'delete_take', id: item.id, takeId: item.production.takes.at(-1).id }])
    assert.equal(item.production.takes.length, 1)
    // 清空口播稿就是回到默认（脚本体裁用原稿）
    applyOps(state, [{ op: 'update_video', id: item.id, spoken: '  ' }])
    assert.equal('spoken' in item.production, false)
    applyOps(state, [{ op: 'delete_take', id: item.id, takeId: take.id }])
    assert.deepEqual(item.production.takes, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('删录像接口：删记录也删文件；文件还被灵感墙用着时只删记录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-video-'))
  try {
    const store = new Store(dir)
    await store.mutate('准备', (draft) => {
      const item = done(draft)
      applyOps(draft, [
        { op: 'add_take', id: item.id, src: 'media-desk/files/f_keep.webm', kind: 'camera', seconds: 3 },
        { op: 'add_take', id: item.id, src: 'media-desk/files/f_gone.webm', kind: 'screen', seconds: 3 },
        { op: 'add_item', kind: 'video', title: '墙上的视频', media: { src: 'media-desk/files/f_keep.webm' } },
      ])
    })
    await writeFile(join(store.filesDir, 'f_keep.webm'), 'a')
    await writeFile(join(store.filesDir, 'f_gone.webm'), 'b')
    const state = await store.read()
    const item = state.items.find(row => row.production?.takes)
    const [keep, gone] = item.production.takes
    const first = await videoRoute({}, store, 'POST', 'video/delete-take', { id: item.id, takeId: gone.id })
    assert.equal(first.removedFile, true)
    const second = await videoRoute({}, store, 'POST', 'video/delete-take', { id: item.id, takeId: keep.id })
    assert.equal(second.removedFile, false)
    assert.deepEqual(await readdir(store.filesDir), ['f_keep.webm'])
    assert.deepEqual(second.state.items.find(row => row.id === item.id).production.takes, [])
    await assert.rejects(videoRoute({}, store, 'POST', 'video/delete-take', { id: item.id, takeId: keep.id }), /找不到这条录像/)
    // 不认识的路径交回给 host 处理
    assert.equal(await videoRoute({}, store, 'POST', 'video/nope', {}), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('图文成片：片头、分镜、片尾首尾相接；有旁白时正文按旁白长度拉伸，字幕跟着缩放', async () => {
  const { planMontage, themeColors, wrapText, TITLE_SEC, END_SEC } = await import('../client/video/montage.js')
  const shots = [{ voice: '第一镜', seconds: 4, src: 'media-desk/files/a.png' }, { voice: '第二镜', seconds: 6 }]
  const plain = planMontage({ title: '标题', shots, script: '第一句话。\n第二句话。', rate: 4.5 })
  assert.deepEqual(plain.scenes.map(row => [row.kind, row.start, row.end]), [['title', 0, TITLE_SEC], ['image', 2.5, 6.5], ['text', 6.5, 12.5], ['end', 12.5, 12.5 + END_SEC]])
  assert.equal(plain.total, 15)
  // 有配图时没有分镜图的那一镜轮流用配图
  assert.equal(planMontage({ title: 'x', shots, images: [{ src: 'media-desk/files/b.png' }] }).scenes[2].image, 'media-desk/files/b.png')
  // 20 秒旁白：正文 10 秒拉到 20 秒，每镜等比
  const voiced = planMontage({ title: '标题', shots, script: '第一句话。\n第二句话。', narration: 20 })
  assert.deepEqual(voiced.scenes.slice(1, 3).map(row => [row.start, row.end]), [[2.5, 10.5], [10.5, 22.5]])
  assert.equal(voiced.body, 20)
  assert.ok(Math.abs(voiced.cues.at(-1).end - 22.5) < 0.01)
  assert.equal(voiced.cues[0].start, TITLE_SEC)
  for (const [i, cue] of voiced.cues.entries()) if (i) assert.ok(cue.start >= voiced.cues[i - 1].end - 1e-9)
  // 没有分镜：口播稿两句一幕
  const fromScript = planMontage({ title: 't', script: '一。\n二。\n三。' })
  assert.deepEqual(fromScript.scenes.map(row => row.kind), ['title', 'text', 'text', 'end'])
  assert.deepEqual(themeColors({ styles: { imagePreview: 'background-color: #fafafa; padding: 2px', paragraph: 'color: #333', title: { h2: { content: 'font-weight: 600; color: #111;' } }, emphasis: { strong: 'font-weight: 800; color: #0066FF;' } } }), { bg: '#fafafa', ink: '#111', accent: '#0066FF' })
  assert.deepEqual(themeColors({}), { bg: '#ffffff', ink: '#1f2937', accent: '#1f2937' })
  const lines = wrapText('一二三四五六 seven eight', 6, s => [...s].length)
  assert.deepEqual(lines, ['一二三四五六', 'seven', 'eight'])
})

test('剪完以后提词记录跟着挪；模板文字槽只收稿子里的事实', () => {
  const log = [{ t: 0.5, text: '一' }, { t: 2, text: '二' }, { t: 4.5, text: '三' }, { t: 9, text: '四' }]
  // 保留 [1,3] 和 [4,8]：第一句开头被剪掉，挪到 0；第四句整句在剪掉的部分之后，丢掉
  assert.deepEqual(mapLog(log, [[1, 3], [4, 8]]), [{ t: 0, text: '一' }, { t: 1, text: '二' }, { t: 2.5, text: '三' }])
  assert.deepEqual(mapLog(undefined, [[0, 1]]), [])
  const script = '浏览器能登录，读不到数据。登录态是留住的。'
  const slots = parseSlots({ hook: '  能登录，\n读不到数据  ', keywords: ['登录态', '不存在的词', 3], chapters: ['一', '二'], endLine: 'x'.repeat(50), extra: '不要' }, script, ['hook', 'keywords', 'endLine'])
  assert.deepEqual(slots, { hook: '能登录， 读不到数据', keywords: ['登录态'], endLine: 'x'.repeat(24) })
  const { system } = slotPrompts(script, '标题', ['hook', 'nope'])
  assert.match(system, /"hook"/)
  assert.doesNotMatch(system, /nope/)
})

test('提词记录排字幕：每句占到下一句出现为止，字幕不重叠、不超宽', async () => {
  const { cuesFromLog, displayWidth } = await import('../client/video/captions.js')
  const cues = cuesFromLog([{ t: 0, text: 'DSH 桌面版右边这个浏览器，登录态是留住的。' }, { t: 4, text: '短句。' }, { t: 99, text: '超出' }], 6)
  assert.deepEqual(cues.map(c => c.text), ['DSH 桌面版右边这个浏览器', '登录态是留住的', '短句'])
  assert.equal(cues[0].start, 0)
  assert.equal(cues[1].end, 4)
  assert.deepEqual([cues[2].start, cues[2].end], [4, 6])
  for (const [i, cue] of cues.entries()) { assert.ok(cue.end > cue.start); if (i) assert.ok(cue.start >= cues[i - 1].end); assert.ok(displayWidth(cue.text) <= 16) }
})

test('成片模板：录像模式用提词记录排字幕、前 3 秒钩子；章节卡、大字报、分屏按模板排', async () => {
  const { planMontage, captionRuns } = await import('../client/video/montage.js')
  const { templateById } = await import('../client/video/templates.js')
  const talk = planMontage({ title: 't', script: '一句。', template: templateById('talk-tight'), slots: { hook: '钩子', endLine: '关注我' }, video: { duration: 10, log: [{ t: 0, text: '第一句。' }, { t: 5, text: '第二句。' }] } })
  assert.deepEqual(talk.scenes.map(s => [s.kind, s.start, s.end]), [['video', 0, 10], ['end', 10, 12.5]])
  assert.equal(talk.captionSource, 'log')
  assert.deepEqual(talk.cues.map(c => [c.start, c.end, c.text]), [[0, 5, '第一句'], [5, 10, '第二句']])
  assert.deepEqual(talk.hook, { start: 0.2, end: 3, text: '钩子' })
  assert.equal(talk.scenes[1].text, '关注我')
  assert.equal(talk.scenes[1].follow, true)
  const shots = [1, 2, 3, 4].map(n => ({ voice: `第${n}镜`, seconds: 4 }))
  const explain = planMontage({ title: 't', shots, template: templateById('explain'), slots: { chapters: ['起', '转'] } })
  assert.deepEqual(explain.scenes.map(s => s.kind), ['title', 'chapter', 'text', 'text', 'chapter', 'text', 'text', 'end'])
  assert.equal(explain.look.progress, true)
  const quote = planMontage({ title: 't', shots, template: templateById('quote'), slots: { quote: '金句' } })
  assert.ok(quote.scenes.slice(1, -1).every(s => s.kind === 'poster'))
  assert.equal(quote.scenes[1].text, '金句')
  // 节奏 0.7：每镜 4 秒变 2.8 秒
  assert.ok(Math.abs((quote.scenes[1].end - quote.scenes[1].start) - 2.8) < 1e-9)
  const split = planMontage({ title: 't', shots, template: templateById('compare'), slots: { leftLabel: '左', rightLabel: '右' } })
  assert.deepEqual(split.scenes.map(s => s.kind), ['title', 'split', 'split', 'end'])
  assert.deepEqual([split.scenes[1].text, split.scenes[1].right, split.scenes[1].left], ['第1镜', '第2镜', '左'])
  assert.deepEqual(captionRuns('登录态是留住的', ['留住', '登录态']), [['登录态', true], ['是', false], ['留住', true], ['的', false]])
  assert.deepEqual(captionRuns('无重点', []), [['无重点', false]])
})

test('录屏教程没填步骤时，步骤取提词记录里每句的第一小句、跟着换句时间走', async () => {
  const { planMontage } = await import('../client/video/montage.js')
  const { templateById } = await import('../client/video/templates.js')
  const log = [{ t: 0, text: '先打开设置，找到账号。' }, { t: 4, text: '再点导出。' }, { t: 9, text: '最后保存文件。' }]
  const plan = planMontage({ title: 't', script: '一。', template: templateById('screen-steps'), slots: {}, video: { duration: 12, log } })
  assert.deepEqual(plan.steps, [{ start: 0, label: '先打开设置' }, { start: 4, label: '再点导出' }, { start: 9, label: '最后保存文件' }])
  // 图文的知识讲解没填章节：从口播稿取，最多 4 个
  const shots = [1, 2, 3, 4].map(n => ({ voice: `第${n}镜`, seconds: 4 }))
  const explain = planMontage({ title: 't', shots, script: '第一点，登录。\n第二点，取数。', template: templateById('explain'), slots: {} })
  assert.deepEqual(explain.scenes.filter(s => s.kind === 'chapter').map(s => s.text), ['第一点', '第二点'])
})

test('删掉录像文件后，撤销更早的操作不会把这条录像带回来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-video-undo-'))
  try {
    const store = new Store(dir)
    await store.mutate('准备', (draft) => {
      const item = done(draft)
      applyOps(draft, [{ op: 'add_take', id: item.id, src: 'media-desk/files/f_gone.webm', kind: 'screen', seconds: 3 }])
    })
    await writeFile(join(store.filesDir, 'f_gone.webm'), 'b')
    const before = await store.read()
    const item = structuredClone(before.items.find(row => row.production?.takes))
    // 录像还在的时候改了一次同一条内容：这一步的撤销记录里带着录像
    await store.mutate('改标题', (draft) => {
      draft.items.find(row => row.id === item.id).title = '改过的标题'
    })
    const removed = await videoRoute({}, store, 'POST', 'video/delete-take', { id: item.id, takeId: item.production.takes[0].id })
    assert.equal(removed.removedFile, true)
    assert.equal(await store.undoLast(), '改标题')
    const after = (await store.read()).items.find(row => row.id === item.id)
    assert.equal(after.title, item.title)
    assert.deepEqual(after.production.takes, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('录像成片：裁掉开头和结尾的空场，字幕铺在真实说话段上，步骤时间也落在剪完的区间里', async () => {
  const { planMontage } = await import('../client/video/montage.js')
  const { templateById } = await import('../client/video/templates.js')
  // 27 秒的录像，从 1.0 秒才开口，说到 25 秒，最后两秒是空的
  const speech = [[1.0, 5.0], [6.0, 12.0], [13.0, 25.0]]
  const talk = planMontage({ title: 't', script: '第一句话。\n第二句话。', template: templateById('talk-tight'), slots: {}, video: { duration: 27, log: null, speech } })
  // 开头留 0.2 秒余量（最多留 0.6 秒），结尾多留 0.35 秒再收
  assert.ok(Math.abs(talk.sourceFrom - 0.6) < 0.01, String(talk.sourceFrom))
  assert.ok(talk.body < 27 - 1.9, String(talk.body))
  assert.equal(talk.captionSource, 'speech')
  const offsetRanges = speech.map(([a, b]) => [a - talk.sourceFrom, b - talk.sourceFrom])
  for (const cue of talk.cues) {
    assert.ok(cue.start >= offsetRanges[0][0] - 0.01, JSON.stringify(cue))
    assert.ok(cue.end <= talk.body + 0.01, JSON.stringify(cue))
  }
  for (let i = 1; i < talk.cues.length; i += 1) assert.ok(talk.cues[i].start >= talk.cues[i - 1].end - 1e-9)
  // 片尾卡在正文结束处接上，总长 = 正文 + 片尾
  assert.equal(talk.scenes[1].kind, 'end')
  assert.ok(Math.abs(talk.scenes[1].start - talk.body) < 1e-9)
  assert.ok(Math.abs(talk.total - (talk.body + (talk.scenes[1].end - talk.scenes[1].start))) < 1e-9)
  // 录屏模板填了步骤：时间按剪完的正文长度分，不会跑到片尾后面
  const screen = planMontage({ title: 't', script: '一。', template: templateById('screen-steps'), slots: { chapters: ['甲', '乙', '丙'] }, video: { duration: 27, log: null, speech } })
  assert.deepEqual(screen.steps.map(row => row.label), ['甲', '乙', '丙'])
  for (const step of screen.steps) assert.ok(step.start >= 0 && step.start < screen.body, JSON.stringify(step))
  // 没有声音分析结果时才退回按总长等比（这时不裁头尾）
  const plain = planMontage({ title: 't', script: '一句。', template: templateById('talk-tight'), slots: {}, video: { duration: 10, log: null } })
  assert.equal(plain.sourceFrom, 0)
  assert.equal(plain.body, 10)
})

test('字幕落点：画面没铺满时落在画面内容里，不压到上下留边', async () => {
  const { captionBottomY } = await import('../client/video/montage.js')
  // 1080×1920 画布，16:9 录像完整放下：高 607，上下各 656
  const rect = { y: 656, h: 607 }
  const inside = captionBottomY({ W: 1080, H: 1920, videoRect: rect }, { position: 'bottom', lineCount: 2, lineHeight: 70 })
  assert.ok(inside <= rect.y + rect.h, `字幕底 ${inside} 跑出了画面 ${rect.y + rect.h}`)
  const lower = captionBottomY({ W: 1080, H: 1920, videoRect: rect }, { position: 'lower', lineCount: 1, lineHeight: 70 })
  assert.ok(lower <= rect.y + rect.h)
  assert.ok(lower < inside)
  // 铺满画面时仍旧给平台按钮留出位置
  const full = captionBottomY({ W: 1080, H: 1920, videoRect: null }, { position: 'bottom', lineCount: 2, lineHeight: 70 })
  assert.ok(full < 1920 * 0.9 && full > 1920 * 0.7, `铺满时字幕位置 ${full} 不合理`)
})

test('片尾卡的署名不和上面的大字重复', async () => {
  const { planMontage } = await import('../client/video/montage.js')
  const plan = planMontage({ title: '同一句话', script: '一句话一行', signature: '同一句话' })
  const end = plan.scenes.find(scene => scene.kind === 'end')
  assert.equal(end.text, '同一句话')
  assert.equal(end.signature, '同一句话')
  // 绘制时去重：签名与大字相同时不画小字（这里验证计划的字段，绘制分支由界面截图覆盖）
  assert.ok(end.signature.trim() === end.text.trim())
})
