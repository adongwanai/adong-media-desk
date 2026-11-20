import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkDraft, countFindings } from '../client/checks.js'
import { conjunctionDensity, maskNonProse, metaphorFields, nominalizationHits, restatesTitle, sentenceLengthCv, toneRuleFindings } from '../client/tone-rules.js'

// 正反例都取自两个原项目自己的样本：
// MrGeDiao/shuorenhua 的 evals/benchmark.md（SF 是该改的，SNF 是不该改的）
// op7418/Humanizer-zh 仓库根目录那份编辑说明（改写前 / 改写后 / 保留）
const SF48 = '本周对部署流程进行了梳理，实现了发布耗时的下降。同时完成了对灰度策略的调整，起到了降低回滚频率的作用。下周计划开展监控告警的优化工作。'
const SNF40 = '增量编译只在源文件的 mtime 变化时触发。执行计划生成阶段会读取上一次的依赖图，对未变更的模块直接复用产物。首次构建不适用，需要完整走一遍全量编译。'
const SF52 = '这条赛道的护城河正在快速坍塌。过去三年积累的技术壁垒，被开源方案一夜之间冲垮，整个行业都被卷进了这波浪潮。团队得重新点燃斗志，在下一个十字路口找到自己的位置。'
const SNF41 = '我们把构建产物推到私有代码仓库，CI 从那里拉取。搜索引擎的索引更新有延迟，所以刚发布的文档要等十几分钟才能搜到。这家公司真正的护城河是十年积累的专利池，不是产品本身。'
const SF50 = '因为公司搬到了新园区，所以我的通勤一下子多了四十分钟。同时地铁还多换乘一次，因此我认真考虑过搬家。但是新园区附近的房租比原来贵一千二，而且户型普遍偏小。所以我最后没搬，并且开始试着错峰上班，早走一小时，路上能省二十分钟。'
const SNF39 = '如果目标库启用了 GTID，则必须先关闭 `sql_log_bin` 再导入，否则从库会重复应用同一批事务。因为导入过程不走 binlog，所以主从延迟指标在这段时间会失真。此外，如果表上有外键约束，需要先执行 `SET FOREIGN_KEY_CHECKS=0`，导入完成后再打开。如果中途失败，不要直接重跑，因为部分表可能已经写入，否则会撞上主键冲突。'
const rulesOf = (body, title = '') => toneRuleFindings(body, title).map(row => row.rule)

test('名词化：SF-48 四处，和原项目标定的 max 4 一致；SNF-40 的稳定术语零命中', () => {
  assert.equal(nominalizationHits(SF48).length, 4)
  assert.deepEqual(nominalizationHits(SNF40), [])
  const found = toneRuleFindings(SF48).filter(row => row.rule === 'nominalization')
  assert.deepEqual(found.map(row => row.excerpt), ['进行了梳理', '完成了对灰度策略的', '起到了降低回滚频率的作用', '开展监控告警的优化工作'])
  assert.ok(found.every(row => row.level === 'warn'))
  // benchmark 预期里的改法
  assert.deepEqual(nominalizationHits('本周梳理了部署流程，发布变快了。调了灰度策略，回滚少了。下周计划优化监控告警。'), [])
})

test('借喻场：SF-52 五套，和原项目标定的 max 5 一致；SNF-41 的字面用法排除后只剩一套', () => {
  assert.equal(metaphorFields(SF52).fields, 5)
  assert.equal(metaphorFields(SNF41).fields, 1)
  const hit = toneRuleFindings(SF52).find(row => row.rule === 'mixed-metaphor')
  assert.equal(hit.level, 'warn')
  assert.match(hit.message, /5 套比喻/)
  assert.ok(!rulesOf(SNF41).includes('mixed-metaphor'))
})

test('借喻场按 800 字窗口算：三套比喻隔得很远不算混用', () => {
  const far = `这条赛道很挤。${'正文'.repeat(420)}我们的护城河在哪。${'正文'.repeat(420)}价格开始降温。`
  assert.equal(metaphorFields(far).fields, 1)
  assert.ok(!rulesOf(far).includes('mixed-metaphor'))
})

test('连词密度：SF-50 和 SNF-39 的数和原项目实测一致（80.00、81.08 每千字）', () => {
  assert.equal(conjunctionDensity(SF50).density.toFixed(2), '80.00')
  assert.equal(conjunctionDensity(maskNonProse(SNF39)).density.toFixed(2), '81.08')
})

test('句长变异系数：不到 12 句不算；够了只作参考，不拦发布', () => {
  assert.equal(sentenceLengthCv(SF50).cv, null)
  const long = Array.from({ length: 12 }, (_, i) => `这是第${i}句话${'很'.repeat(i)}长。`).join('')
  const { cv, sentences } = sentenceLengthCv(long)
  assert.equal(sentences, 12)
  assert.ok(cv > 0)
  const hints = toneRuleFindings(long).filter(row => row.level === 'info')
  assert.deepEqual(hints.map(row => row.rule), ['sentence-cv'])
  assert.deepEqual(countFindings(hints), { block: 0, warn: 0 })
})

test('客服腔：改写前命中，改写后不命中', () => {
  const before = toneRuleFindings('好问题！这是导出功能的说明。它支持 CSV。希望这对您有帮助！').filter(row => row.rule === 'service-tone')
  assert.deepEqual(before.map(row => row.excerpt), ['好问题', '希望这对您有帮助'])
  assert.deepEqual(rulesOf('导出功能支持 CSV。'), [])
})

test('首句复读标题：第一句只是复述标题时提醒；标题下面的条件和数据不算', () => {
  assert.equal(restatesTitle('导出限制', '本节介绍导出限制。下面说明导出限制。单个文件最大为 10 MB。'), true)
  assert.equal(restatesTitle('导出限制', '下面说明导出限制。单个文件最大为 10 MB。'), true)
  assert.equal(restatesTitle('导出限制', '仅支持导出当前页面。'), false)
  assert.equal(restatesTitle('导出限制', '导出限制是单个文件最大 10 MB。'), false)
  const hit = toneRuleFindings('本节介绍导出限制。单个文件最大为 10 MB。', '导出限制').find(row => row.rule === 'title-restate')
  assert.equal(hit.excerpt, '本节介绍导出限制')
})

test('层叠的「的」：改写前命中，改写后和保留示例不命中', () => {
  assert.ok(rulesOf('这是一个十亿参数的开源小模型的微调的完整方案。').includes('stacked-de'))
  assert.ok(!rulesOf('这是一套完整的微调方案，适用于一个十亿参数的开源小模型。').includes('stacked-de'))
  assert.ok(!rulesOf('我的同事看过你的稿子，也读过他的回复。').includes('stacked-de'))
})

test('被字句堆叠：改写前命中，改写后和保留示例不命中', () => {
  assert.ok(rulesOf('该问题被社区多次报告，被认为可能与内存泄漏有关，但原因尚未确认。').includes('stacked-passive'))
  assert.ok(!rulesOf('社区多次报告这个问题。它被认为可能与内存泄漏有关，但原因尚未确认。').includes('stacked-passive'))
  assert.ok(!rulesOf('样本已被污染，原因尚未确认。').includes('stacked-passive'))
  assert.ok(!rulesOf('他把被子叠好，被单也换了。').includes('stacked-passive'))
})

test('代码、链接和网址里的字不算', () => {
  assert.deepEqual(nominalizationHits(maskNonProse('看 `进行了优化` 和 [链接](https://x.com/进行了优化)。')), [])
})

test('接进发布前检查：提醒算进提醒数，参考排在最后、不算问题', () => {
  const body = `${SF48}${SF52}`
  const findings = checkDraft({ title: '周报', body, tags: [] }, '知乎')
  const rules = findings.map(row => row.rule)
  assert.ok(rules.includes('nominalization'))
  assert.ok(rules.includes('mixed-metaphor'))
  assert.equal(countFindings(findings).block, 0)
  const levels = findings.map(row => row.level)
  assert.deepEqual(levels, [...levels].sort((a, b) => ['block', 'warn', 'info'].indexOf(a) - ['block', 'warn', 'info'].indexOf(b)))
})
