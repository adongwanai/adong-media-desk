import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCues, CAPTION_WIDTH, clampRate, displayWidth, fmtClock, lineSeconds, refineBreaks, replaceOpening, retimeCues, scriptTiming, splitCaption, spokenUnits, spreadSeconds, toPlainText, toSrt, toVtt } from '../client/video/captions.js'

// 行尾不该出现的虚词（和实现里的规则一致，测试里单写一份，免得改实现时测试跟着一起变）
const BAD_END_TAIL = /[的地得着了过和与及或而但就都也还又很更最不没把被让给对向从在是介]$/

const SCRIPT = [
  'DSH 桌面版右边这个浏览器，登录态是留住的。',
  '我把公众号、小红书、抖音三个创作后台都放这儿开，这一步确实省事，不用每次重新登录、重新扫码。',
  '',
  '## 第二段',
  '但有个前提：它不提供读取页面内容的接口！',
  '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七',
  'Agent 拿不到 GPT-4o 的数据，supercalifragilisticexpialidociousword 也拆得开。',
].join('\n')

test('念的量：汉字算 1，西文单词和数字串算 1.5，标点空格不算', () => {
  assert.equal(spokenUnits('你好，世界。'), 4)
  assert.equal(spokenUnits('Agent 很好'), 3.5)
  assert.equal(spokenUnits('GPT-4o 和 2026'), 4)
  assert.equal(spokenUnits('……！'), 0)
})

test('语速：限制在 3 到 6 字每秒，非数字回到默认值', () => {
  assert.equal(clampRate(10), 6)
  assert.equal(clampRate(1), 3)
  assert.equal(clampRate('abc'), 4.5)
  assert.equal(clampRate(4.56), 4.6)
})

test('逐行时长：小标题和空行不念，总时长是各行之和，起点连续', () => {
  const timing = scriptTiming(SCRIPT, 4.5)
  assert.equal(timing.spokenCount, 5)
  assert.equal(timing.lines[2].seconds, 0)
  assert.equal(timing.lines[3].spoken, false)
  const sum = timing.lines.reduce((a, row) => a + row.seconds, 0)
  assert.ok(Math.abs(sum - timing.total) < 1e-9)
  for (let i = 1; i < timing.lines.length; i += 1) assert.ok(Math.abs(timing.lines[i].start - (timing.lines[i - 1].start + timing.lines[i - 1].seconds)) < 1e-9)
  // 语速快一倍，时长少一半
  assert.ok(Math.abs(scriptTiming(SCRIPT, 3).total - 2 * scriptTiming(SCRIPT, 6).total) < 1e-9)
  assert.equal(lineSeconds('好。', 4.5), 0.6)
})

test('字幕断行：每条不超过 16 个汉字宽，优先在标点处断，文字不丢', () => {
  for (const line of SCRIPT.split('\n')) {
    const parts = splitCaption(line)
    for (const part of parts) assert.ok(displayWidth(part) <= CAPTION_WIDTH, `${part} ${displayWidth(part)}`)
    // 去掉标点和空格后，拼回来和原句一样
    const strip = s => s.replace(/[\s，。、；：,.;:！？!?#]/g, '')
    if (parts.length) assert.equal(strip(parts.join('')), strip(line.replace(/^#+\s.*$/, '')))
  }
  assert.deepEqual(splitCaption('DSH 桌面版右边这个浏览器，登录态是留住的。'), ['DSH 桌面版右边这个浏览器', '登录态是留住的'])
  // 一长串没有标点：均匀切开，不剩一个字的尾巴
  const long = splitCaption('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四')
  assert.equal(long.length, 3)
  assert.ok(Math.min(...long.map(displayWidth)) >= 10)
  // 问号叹号保留，句中逗号换成空格
  assert.deepEqual(splitCaption('真的吗，我不信！'), ['真的吗 我不信！'])
})

test('字幕时间：单调递增、互不重叠，最后一条正好在总时长结束', () => {
  const cues = buildCues(SCRIPT, { rate: 4.5 })
  assert.ok(cues.length >= 8)
  for (const [i, cue] of cues.entries()) {
    assert.ok(cue.end > cue.start, `${i}`)
    if (i) assert.ok(cue.start >= cues[i - 1].end, `${i}`)
    assert.ok(displayWidth(cue.text) <= CAPTION_WIDTH)
  }
  assert.equal(cues[0].start, 0)
  assert.ok(Math.abs(cues.at(-1).end - scriptTiming(SCRIPT, 4.5).total) < 0.002)
  // 整体后移
  const shifted = buildCues(SCRIPT, { rate: 4.5, offset: 2 })
  assert.equal(shifted[0].start, 2)
  assert.equal(buildCues('', { rate: 4.5 }).length, 0)
})

test('SRT、WebVTT 和纯文字格式', () => {
  const cues = [{ start: 0, end: 1.5, text: '第一条' }, { start: 1.5, end: 3723.042, text: '第二条' }]
  assert.equal(toSrt(cues), '1\n00:00:00,000 --> 00:00:01,500\n第一条\n\n2\n00:00:01,500 --> 01:02:03,042\n第二条\n')
  assert.equal(toVtt(cues), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n第一条\n\n00:00:01.500 --> 01:02:03.042\n第二条\n')
  assert.equal(toPlainText(cues), '第一条\n第二条\n')
  assert.equal(fmtClock(65.4), '1:05')
  assert.equal(fmtClock(65.44, { tenths: true }), '1:05.4')
})

test('换开头：只换前几句要念的话，空行和小标题留在原处', () => {
  const text = '# 标题\n第一句\n第二句\n\n第三句'
  assert.equal(replaceOpening(text, ['新一', '新二', '新三'], 2), '# 标题\n新一\n新二\n新三\n\n第三句')
  assert.equal(replaceOpening(text, ['新一'], 3), '# 标题\n新一\n')
  assert.equal(replaceOpening('', ['新一'], 2), '新一\n')
})

test('分镜秒数按口播估算分配：整数、每镜至少 1 秒、合计等于总时长', () => {
  assert.deepEqual(spreadSeconds([3, 5, 1, 1], 30), [9, 15, 3, 3])
  const out = spreadSeconds([100, 1, 1], 10)
  assert.equal(out.reduce((a, b) => a + b, 0), 10)
  assert.ok(out.every(v => v >= 1))
  assert.deepEqual(spreadSeconds([1, 1, 1], 1), [1, 1, 1])
  assert.deepEqual(spreadSeconds([], 10), [])
})

test('数字、版本号、网址不会被断开：3.5、github.com、Seedance2.5、1,200 都算一个整体', () => {
  const cases = [
    ['我把 3.5 秒的生成过程录屏发在 github.com 上，1200 个样本都能复现。', ['3.5', 'github.com', '1200']],
    ['Seedance2.5 和 GPT-4o 的对比，放在 1,200 个样本上跑，命中率 80%。', ['Seedance2.5', 'GPT-4o', '1,200', '80%']],
  ]
  for (const [line, atoms] of cases) {
    const parts = splitCaption(line)
    for (const atom of atoms) {
      // 每个整体必须完整地出现在某一条里，不能被断成两半
      assert.ok(parts.some(part => part.includes(atom)), `${atom} 被拆开了：${JSON.stringify(parts)}`)
    }
    for (const part of parts) assert.ok(displayWidth(part) <= CAPTION_WIDTH + 0.01, part)
  }
})

test('断行不把「的、了、在」这类字留在行尾，也不让下一行只剩一两个字', () => {
  const rows = splitCaption('我们把公众号、小红书、抖音三个创作后台都放这儿开，早上不用重新登录。')
  for (const row of rows.slice(0, -1)) assert.doesNotMatch(row, BAD_END_TAIL, row)
  for (const row of rows) assert.ok([...row].length >= 3, row)
  // 一行放不下的一长串英文：切开也不会超出上限
  const long = splitCaption('Agent 拿不到 GPT-4o 的数据，supercalifragilisticexpialidociousword 也拆得开。')
  for (const row of long) assert.ok(displayWidth(row) <= CAPTION_WIDTH + 0.01, row)
})

test('字幕时长：同一句里太短的借一点，总时长不变', () => {
  const script = '这一句会被拆成好几条很短的字幕，短到根本看不清。'
  const cues = buildCues(script, { rate: 4.5 })
  for (const cue of cues) assert.ok(cue.end - cue.start >= 0.05, JSON.stringify(cue))
  // 每条都在这句的时长以内，最后一条正好结束
  const total = lineSeconds(script, 4.5)
  assert.ok(Math.abs(cues.at(-1).end - total) < 0.002)
  for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i].start >= cues[i - 1].end - 1e-9)
})

test('字幕铺到真实说话段：没人说话的地方不挂字幕，起点跟着第一段声音', () => {
  const script = '第一句话在这里，第二句话也在。'
  const cues = buildCues(script, { rate: 4.5 })
  const speech = [[1.5, 3.0], [4.0, 6.0]]
  const out = retimeCues(cues, speech)
  assert.ok(out[0].start >= 1.5)
  assert.ok(out.at(-1).end <= 6.0)
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i].start >= out[i - 1].end - 1e-9)
  // 每条都不能整个落在停顿里
  for (const cue of out) assert.ok(speech.some(([s, e]) => cue.start >= s - 0.01 && cue.start < e), JSON.stringify(cue))
  // 没有说话段时原样返回
  assert.deepEqual(retimeCues(cues, []), cues)
})
