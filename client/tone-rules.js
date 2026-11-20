// 发布前检查里的 AI 腔规则：能用正则和计数查出来的那部分。纯函数，不引用 React 和 DOM，Node 里也能跑测试。
// 只放 checks.js / selfcheck.js 里还没有的规则（不是…而是、首先其次最后、破折号、加粗那几条已经有了）。
//
// 规则来源，按原项目移植，阈值和词表照搬，没有自己加：
//
// 1. 名词化、借喻场、句长变异系数、显性连词密度
//    MrGeDiao/shuorenhua，automation/eval/hard_metrics.py（commit 39809cea2d8c006ff590ae7168ba0e9ed4565143）
//    原项目的标定结论：名词化和借喻场在「不该改」的语料上零误报；句长变异系数和连词密度标不出阈值，只报数。
//    所以前两项在这里是提醒（warn），后两项只作参考（info），不拦发布。
//
//    MIT License
//
//    Copyright (c) 2026 MrGeDiao
//
//    Permission is hereby granted, free of charge, to any person obtaining a copy
//    of this software and associated documentation files (the "Software"), to deal
//    in the Software without restriction, including without limitation the rights
//    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//    copies of the Software, and to permit persons to whom the Software is
//    furnished to do so, subject to the following conditions:
//
//    The above copyright notice and this permission notice shall be included in all
//    copies or substantial portions of the Software.
//
//    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//    SOFTWARE.
//
// 2. 客服腔、首句复读标题、层叠的「的」、被字句堆叠
//    op7418/Humanizer-zh，仓库根目录那份编辑说明的第 22、24、26、28 条（commit f4518a8eab97b8bfebc66a89d34320a89bef6930）
//    原文是给人看的编辑说明，没有正则；这里只取能机械判断的部分，判据按原文的改写前 / 保留示例来定。
//
//    MIT License
//
//    Copyright (c) 2026 歸藏
//
//    Permission is hereby granted, free of charge, to any person obtaining a copy
//    of this software and associated documentation files (the "Software"), to deal
//    in the Software without restriction, including without limitation the rights
//    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//    copies of the Software, and to permit persons to whom the Software is
//    furnished to do so, subject to the following conditions:
//
//    The above copyright notice and this permission notice shall be included in all
//    copies or substantial portions of the Software.
//
//    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//    SOFTWARE.
import { sentenceAt } from '../src/selfcheck.js'

const MAX_PER_RULE = 5
const HAN = /[一-鿿]/g

// ---- shuorenhua：hard_metrics.py ----

// 显性连词（CONJUNCTIONS_ZH）。单字「则」原项目不收：规则、准则、原则误伤太大
const CONJUNCTIONS = ['因为', '所以', '但是', '然而', '同时', '此外', '而且', '并且', '因此', '不仅', '于是', '另外', '总之', '首先', '其次', '如果', '否则']

// 动词名词化（NOMINALIZATION_PATTERNS）：进行 / 实现 / 完成 / 开展 / 起到 带一个动名词，句子变长信息没变
const NOMINALIZATION = [
  /进行(?:了|一次|一场|着)?[^。，！？\n]{0,10}(?:调整|优化|升级|分析|讨论|沟通|梳理|复盘|迭代|探索|尝试|思考|规划|布局|评估|排查|验证)/g,
  /实现了?[^。，！？\n]{0,14}的?[^。，！？\n]{0,6}(?:提升|增长|突破|转变|跃升|落地|改善)/g,
  /完成了?对[^。，！？\n]{0,16}的/g,
  /起到了?[^。，！？\n]{0,12}的?作用/g,
  /具有[^。，！？\n]{0,10}(?:意义|价值)/g,
  /开展[^。，！？\n]{0,10}(?:工作|建设|研究|合作)/g,
]

// 借喻场（METAPHOR_FIELDS）：同一段里从多套不相干的比喻系统借词。单套用得准没问题，多套混用才算
const METAPHOR_FIELDS = {
  道路竞赛: ['赛道', '跑道', '岔路', '十字路口', '终点线', '起跑线', '弯道超车'],
  战争攻防: ['护城河', '壁垒', '厮杀', '血战', '阵地', '弹药', '突围', '打法'],
  建筑灾害: ['坍塌', '崩塌', '地基', '支柱', '废墟', '基石'],
  温度: ['降温', '升温', '冷却', '余温', '白热化', '点燃'],
  仓储: ['仓库', '库存', '抽屉', '货架', '囤积'],
  海洋航行: ['蓝海', '红海', '浪潮', '潮水', '灯塔', '彼岸', '风口'],
  机器器官: ['齿轮', '引擎', '发动机', '血管', '骨架', '神经末梢'],
}

// 字面用法排除（METAPHOR_LITERAL_PREFIX）：前面是这些字时，这个词是技术术语或本义，不算借喻
const METAPHOR_LITERAL_PREFIX = {
  引擎: ['搜索', '渲染', '游戏', '物理', '推荐', '规则', '模板', '查询', '存储'],
  发动机: ['汽车', '飞机', '柴油', '航空'],
  仓库: ['代码', 'git', 'Git', '远程', '本地', '私有', '镜像'],
  库存: ['商品', '实际', '系统', '剩余'],
  阵地: ['前沿'],
  风口: ['出', '通', '进'],
  打法: ['战术'],
}
// 借喻场的判据「800 字内 3 套」（原项目 structures.md 第 25 条，hard_metrics.py 的 window=800）
const METAPHOR_WINDOW = 800
const METAPHOR_FIELDS_MAX = 3
// 句长变异系数至少要 12 句才算（sentence_length_cv 的 min_sentences）
const CV_MIN_SENTENCES = 12

/** 屏蔽代码块、行内代码、链接目标、网址和 HTML 标签（mask_non_prose）。等长换成空格，位置不变。 */
export function maskNonProse(text) {
  const blank = match => match.replace(/[^\n]/g, ' ')
  return [
    /^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/,
    /```[\s\S]*?```/g,
    /`[^`\n]*`/g,
    /\]\([^\n)]*\)/g,
    /https?:\/\/[^\s)>]+/g,
    /<[^>\n]+>/g,
  ].reduce((out, pattern) => out.replace(pattern, blank), String(text ?? ''))
}

const hanCount = text => (String(text).match(HAN) ?? []).length

/** 长词优先、互不重叠地数词（_non_overlapping），免得一个位置被数两次。 */
function nonOverlapping(text, terms) {
  const taken = []
  const hits = []
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    let at = text.indexOf(term)
    while (at >= 0) {
      const end = at + term.length
      if (!taken.some(([s, e]) => at < e && end > s)) {
        hits.push([at, term])
        taken.push([at, end])
      }
      at = text.indexOf(term, at + term.length)
    }
  }
  return hits.sort((a, b) => a[0] - b[0])
}

/** 句长变异系数（sentence_length_cv）：4 个汉字以上的句子才算，不到 12 句时 cv 是 null。 */
export function sentenceLengthCv(text, minSentences = CV_MIN_SENTENCES) {
  const lengths = [...String(text).matchAll(/[^。！？!?\n]+[。！？!?]/g)].map(m => hanCount(m[0])).filter(n => n >= 4)
  if (lengths.length < minSentences) return { cv: null, sentences: lengths.length }
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
  if (!mean) return { cv: null, sentences: lengths.length }
  const variance = lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lengths.length
  return { cv: Math.sqrt(variance) / mean, sentences: lengths.length }
}

/** 显性连词密度（conjunction_density）：每千个汉字几个。 */
export function conjunctionDensity(text) {
  const han = hanCount(text)
  if (!han) return { density: null, hits: 0, han: 0 }
  const hits = nonOverlapping(String(text), CONJUNCTIONS).length
  return { density: (hits * 1000) / han, hits, han }
}

/** 名词化命中（nominalization_hits）：[位置, 片段]，按位置排好。 */
export function nominalizationHits(text) {
  return NOMINALIZATION.flatMap(pattern => [...String(text).matchAll(pattern)].map(m => [m.index, m[0]])).sort((a, b) => a[0] - b[0])
}

/** 借喻场（metaphor_fields_hit）：同一个 800 字窗口里最多有几套比喻，和每个命中 [位置, 场, 词]。 */
export function metaphorFields(text, window = METAPHOR_WINDOW) {
  const source = String(text)
  const hits = []
  for (const [field, words] of Object.entries(METAPHOR_FIELDS)) {
    for (const word of words) {
      let at = source.indexOf(word)
      while (at >= 0) {
        const head = source.slice(Math.max(0, at - 4), at)
        if (!(METAPHOR_LITERAL_PREFIX[word] ?? []).some(prefix => head.endsWith(prefix))) hits.push([at, field, word])
        at = source.indexOf(word, at + word.length)
      }
    }
  }
  hits.sort((a, b) => a[0] - b[0])
  let best = 0
  let bestAt = -1
  hits.forEach(([start], i) => {
    const fields = new Set(hits.slice(i).filter(([at]) => at - start <= window).map(([, field]) => field))
    if (fields.size > best) {
      best = fields.size
      bestAt = i
    }
  })
  const span = bestAt < 0 ? [] : hits.slice(bestAt).filter(([at]) => at - hits[bestAt][0] <= window)
  return { fields: best, hits, span }
}

// ---- Humanizer-zh：编辑说明第 22、24、26、28 条 ----

// 第 22 条客服腔：文章里无内容的问候、夸奖和提议
const SERVICE = /好问题[！!，,。]?|(?:这是一个|真是个|真是一个)(?:很|非常)?好的问题|希望(?:以上|这些|这篇|这)?(?:内容|回答|信息|说明)?(?:能)?(?:对您|对你|对大家)?有所?帮助|如(?:果|有)(?:您|你)?(?:还有|有)(?:任何|其他)?(?:问题|疑问)[^。！？\n]{0,12}(?:随时|欢迎)|(?:请|欢迎)随时(?:告诉|联系|提问|交流|问)|很高兴(?:为您|为你|能)?(?:解答|回答|帮助|帮到)/g
// 第 24 条首句复读标题：去掉标题和这些铺垫字以后什么都不剩，就是「没有独立含义的复述句」
const RESTATE_FILLER = /本文|本节|本篇|这篇文章|这篇|这一节|下面|接下来|今天|我们|给大家|和大家|跟大家|主要|简单|详细|一起|将|会|来|要|就|再|介绍|说明|讲讲|讲|聊聊|聊|谈谈|谈|分享|看看|说说|一下|关于|的|了|吧/g
const PUNCT = /[\s\p{P}\p{S}]/gu
// 第 28 条被字句：被子、被窝这些不是被动句
const PASSIVE = /被(?!子|窝|褥|单|面|套|告)/g

/** 一个分句里「的」的个数（第 26 条层叠的「的」）。目的、的确、的士不算。 */
const deCount = clause => (clause.replace(/目的/g, '').match(/的(?![确士])/g) ?? []).length

/** 去掉句末的句号、问号、感叹号，摘句时不跨到下一句。 */
const bare = sentence => sentence.replace(/[。！？!?]$/, '')

/** 正文第一句（到第一个句号、问号、感叹号或换行）。 */
function firstSentence(text) {
  const body = String(text).replace(/^\s*#{1,6}\s+[^\n]*\n/, '').trimStart()
  return /^[^。！？!?\n]*[。！？!?]?/.exec(body)?.[0] ?? ''
}

/**
 * 第 24 条：正文第一句只是把标题又说了一遍。
 * @returns {boolean}
 */
export function restatesTitle(title, body) {
  const plainTitle = String(title ?? '').replace(PUNCT, '')
  if ([...plainTitle].length < 2) return false
  const first = firstSentence(body).replace(PUNCT, '')
  if (!first.includes(plainTitle)) return false
  return !first.replace(plainTitle, '').replace(RESTATE_FILLER, '')
}

/** 一句一句切开（句号、问号、感叹号、换行），带上在原文里的位置。 */
function sentences(text) {
  return [...String(text).matchAll(/[^。！？!?\n]+[。！？!?]?/g)].map(m => ({ text: m[0], index: m.index }))
}

/**
 * 发布前检查用的 AI 腔规则。
 * @param {string} body - 要发出去的正文（纯文本或 Markdown 都行，代码和链接会先屏蔽掉）。
 * @param {string} [title] - 标题，查「首句复读标题」用。
 * @returns {Array<{level: 'warn'|'info', rule: string, message: string, excerpt: string}>}
 */
export function toneRuleFindings(body, title = '') {
  const raw = String(body ?? '')
  const text = maskNonProse(raw)
  const out = []
  const push = (level, rule, message, index, length) => out.push({ level, rule, message, excerpt: index >= 0 ? sentenceAt(raw, index, length) : '' })

  for (const [index, hit] of nominalizationHits(text).slice(0, MAX_PER_RULE)) {
    // 摘的是命中的那一段：同一句里可能有两处，摘整句会被当成重复去掉
    out.push({ level: 'warn', rule: 'nominalization', message: '名词化：把一个动作拆成虚动词加名词，句子变长、信息没变，换成直接的动词', excerpt: raw.slice(index, index + hit.length) })
  }

  const metaphor = metaphorFields(text)
  if (metaphor.fields >= METAPHOR_FIELDS_MAX) {
    const fields = [...new Set(metaphor.span.map(([, field]) => field))]
    const words = [...new Set(metaphor.span.map(([, , word]) => word))]
    push('warn', 'mixed-metaphor', `800 字内混用了 ${fields.length} 套比喻（${fields.join('、')}）：拿比喻代替了说明，还原成本义`, metaphor.span[0][0], 0)
    out[out.length - 1].excerpt = words.join('、')
  }

  for (const m of [...text.matchAll(SERVICE)].slice(0, MAX_PER_RULE)) {
    out.push({ level: 'warn', rule: 'service-tone', message: '客服腔：对话里的客套话，放在文章里没有内容', excerpt: raw.slice(m.index, m.index + m[0].length).replace(/[！!，,。]$/, '') })
  }

  if (restatesTitle(title, text)) push('warn', 'title-restate', '第一句只是把标题又说了一遍，没有新信息', 0, bare(firstSentence(raw)).length)

  let stacked = 0
  for (const { text: sentence, index } of sentences(text)) {
    for (const clause of sentence.split(/[，,；;：:]/)) {
      const n = deCount(clause)
      if (n >= 3 && stacked < MAX_PER_RULE) {
        push('warn', 'stacked-de', `一个分句里连用 ${n} 个「的」，定语太长不好读，拆开或调换顺序`, index + sentence.indexOf(clause), clause.length)
        stacked += 1
      }
    }
  }

  let passives = 0
  for (const { text: sentence, index } of sentences(text)) {
    const n = (sentence.match(PASSIVE) ?? []).length
    if (n >= 2 && passives < MAX_PER_RULE) {
      push('warn', 'stacked-passive', `一句里有 ${n} 个「被」字句，知道是谁做的就改成主动句`, index, bare(sentence).length)
      passives += 1
    }
  }

  const { cv, sentences: count } = sentenceLengthCv(text)
  if (cv !== null) push('info', 'sentence-cv', `参考：句长变异系数 ${cv.toFixed(2)}（${count} 句）。数越小，句子长短越接近，读着越像一个模子；这一项没有及格线`, -1, 0)
  // 连词密度按原项目的算法算；短稿上这个数没有意义，和句长一样到 12 句才给
  const density = conjunctionDensity(text)
  if (density.hits && count >= CV_MIN_SENTENCES) push('info', 'connective-density', `参考：显性连词每千字 ${density.density.toFixed(1)} 个（${density.hits} 处）。叙述可以删掉一些、靠语序接上；说明步骤时的条件和因果连词要留`, -1, 0)
  return out
}
