// 「How I」检查：作者自己写的文字里，是亲手做过、只研究过，还是两样都看不出来。
// 结果决定平台版本能用哪种口吻：我做了 / 我观察到 / 只能转述（并提醒补材料）。
// 纯函数，Host 和浏览器共用。只看文字里的说法，判断不了真假，所以界面上要把依据摆出来让作者确认。
// 只认作者自己写的：灵感标题和正文、导入的原稿、手动改过的句子；一键成稿时模型写的正文不算依据。
import { EXPERIENCE_WORDS } from './platform-specs.js'

// 「我」和动词之间隔着这些词时，做事的不是作者本人，或者只是转述、假设、打算
const NOT_SELF = '他|她|它|说|称|听|读到|看到|认为|觉得|以为|猜|大家|别人|有人|网友|作者|同事|朋友|老板|领导|客户|学员|团队|博主|如果|假如|要是|假设|打算|计划|准备|想'
const GAP = `(?:(?!${NOT_SELF})[^。！？!?；;\\n，,]){0,16}?`

// 「我用 Claude Code 跑了两周」这种中间隔着工具名的说法、「我这种天天跑 Agent 的人」这种习惯说法，平台通用的经历词抓不到，这里补上
export const DID_WORDS = new RegExp(`我们?(?:亲自|自己)?${GAP}(?:跑了|跑过|测了|测过|试了|试过|搭了|搭过|部署了|上线了|接入了|用了|用过|花了|踩过|复现了|训了|训练了|做成了|做了一个|做了一套)|我们?[^。！？!?；;\\n，,]{0,4}?(?:天天|每天|经常|一直|平时|常年|长期)(?:都)?(?:在)?(?:跑|用|写|搭|测|调|折腾)|亲测|实测`, 'g')

// 读过、看过、查过：研究过，但不等于做过
const STUDY_WORDS = new RegExp(`我(?:仔细|认真|反复)?(?:读了|读过|读完|看了|看过|看完|翻了|翻过|研究了|研究过|查了|查过|对比了|拆了|拆过|梳理了|整理了|调研了|追了)|我${GAP}(?:读|看|翻|研究|拆)(?:完|过)|我花了[^。！？\\n，,]{0,8}?(?:读|看|翻|研究)|(?:读|看|翻)完(?:了)?(?:原文|论文|文档|报告|代码)|(?:原文|论文|文档|报告|文章|博客|官方博客|发布会|白皮书|技术报告|采访|播客)(?:里|中|上)?(?:写|说|讲|提到|给出|有一句)|发了(?:一)?篇(?:文章|博客|论文|报告)|据[^。！？\\n]{0,12}(?:报道|披露|介绍|统计)|按(?:文档|原文|论文|官方)的?说法`, 'g')

// 明确说没做过、还只是打算：这些句子不算做过。否定词和动词之间允许隔几个字（「我没有认真试过」）
export const NOT_DONE = /(?:还没|没有|没(?!想到|错|关系|什么)|未(?!来|必|知)|从没|从未|不曾)[^。，,；;\n]{0,6}?(?:试|跑|测|做|用|写|搭|部署|上线|接入|复现|训|读|看|研究)|打算|计划|准备|待验证|还没验证|没有验证|想(?:去)?(?:试|跑|测|用|搭)|(?:下周|下个月|下次|回头|改天|之后|以后|有空)(?:再|会|要)?(?:去)?(?:试|跑|测|用|搭)/

// 假设：「如果我用…」「要是我跑一遍」
const HYPOTHETICAL = /如果|假如|(?<![主只还就总不])要是|假设|倘若|万一|若是/
// 转述别人：「网友实测」「他说他试了」
const OTHERS = /他|她|网友|作者|官方|对方|别人|有人|博主|媒体|同事|朋友|用户|厂商|开发者|评测/

const STOPS = /[。！？!?；;\n]/

function sentences(text) {
  return String(text ?? '').split(STOPS).map(row => row.trim()).filter(Boolean)
}

const plain = text => String(text ?? '').replace(/\*\*|==|\s|[“”"'「」#>*-]/g, '')

/** text 里有、bases 里都没有的句子：作者手动加上或改过的那些。 */
export function editedSentences(text, bases) {
  const known = new Set(bases.flatMap(base => sentences(base).map(plain)).filter(Boolean))
  return sentences(text).filter(row => plain(row) && !known.has(plain(row))).join('\n')
}

/**
 * 作者自己写的文字：标题、正文、素材文件的正文、导入的原稿、手动保存的草稿、手动改过的句子和确认过是真的经历句。
 * 一键成稿（production.engine / aiArticle）和对话里模型改写的正文不算。
 * @param {object} item - 灵感。
 * @param {string} [extraSources] - 不在 state 里的作者材料（比如从 files 读回来的长素材正文）。
 * @returns {string} 拼好的文字，每段一行。
 */
export function userText(item, extraSources = '') {
  const parts = [item?.title, item?.body]
  // 素材文件是作者自己的材料：里面写过的经历，成稿照样可以用；没读回来的那些由调用方从 files 读进来传 extraSources
  for (const row of Array.isArray(item?.materials) ? item.materials : []) {
    if (row && typeof row.text === 'string' && row.text.trim()) parts.push(row.text)
  }
  if (extraSources) parts.push(String(extraSources))
  const production = item?.production
  const article = String(production?.article ?? '')
  if (article) {
    const generated = Boolean(production.engine || production.aiArticle)
    // 导入的稿子就是作者自己写的；没经过模型的成稿也是作者手写的
    if (!generated) parts.push(article)
    else parts.push(editedSentences(article, [production.aiArticle, production.flow?.firstDraft].filter(Boolean)))
  }
  // 作者在提醒条上点了「这是真的，保留」的句子：作者亲口确认的经历
  if (Array.isArray(production?.flow?.kept)) parts.push(...production.flow.kept.filter(row => typeof row === 'string'))
  for (const format of ['article', 'script']) {
    const draft = item?.drafts?.[format]
    if (!draft?.text) continue
    if (draft.by === 'user' && !draft.aiText) parts.push(draft.text)
    else if (draft.by === 'user') parts.push(editedSentences(draft.text, [draft.aiText]))
  }
  return parts.filter(Boolean).join('\n')
}

// 「我做了一个判断」「我用了一个比喻」「我花了一晚上读论文」：动词是比方或者在读，不是动手
const FIGURATIVE = /^(?:一个|个|了)?(?:判断|决定|选择|总结|比喻|例子|类比|假设|猜测|推测|梦)/
const READING = /读|看|翻|研究|查/

/** 命中的说法能不能算作者自己的：假设、转述别人的、比方都不算。 */
function ownClaim(sentence, match) {
  const before = sentence.slice(0, match.index)
  const after = sentence.slice(match.index + match[0].length)
  if (HYPOTHETICAL.test(before)) return false
  if (FIGURATIVE.test(after)) return false
  if (match[0].endsWith('花了') && READING.test(after)) return false
  // 不以「我」开头的（亲测、实测、用了两周），前面出现了别人就是在转述
  if (!match[0].startsWith('我') && OTHERS.test(before)) return false
  return true
}

const hits = (sentence, pattern) => [...sentence.matchAll(new RegExp(pattern.source, 'g'))].some(match => ownClaim(sentence, match))

/** 这一句是不是在说作者亲手做过（不看上下文）。 */
export function isDidSentence(sentence) {
  if (NOT_DONE.test(sentence)) return false
  return hits(sentence, EXPERIENCE_WORDS) || hits(sentence, DID_WORDS)
}

/** 这一句是不是在说作者读过、研究过。 */
export function isStudySentence(sentence) {
  if (NOT_DONE.test(sentence)) return false
  return hits(sentence, STUDY_WORDS)
}

/**
 * 判断作者自己写的文字里有没有第一手做过的事。
 * @param {{production?: object, title?: string, body?: string, imported?: boolean, drafts?: object}} item - 灵感，带成稿。
 * @returns {{level: 'did'|'studied'|'none', voice: string, evidence: string[], note: string}}
 *   level：did 做过 / studied 研究过 / none 都看不出来；evidence 是依据的原句，最多 3 句。
 */
export function classifyHowI(item) {
  const did = []
  const studied = []
  for (const sentence of sentences(userText(item))) {
    if (isDidSentence(sentence)) did.push(sentence)
    else if (isStudySentence(sentence)) studied.push(sentence)
  }
  const clip = rows => [...new Set(rows)].slice(0, 3).map(row => (row.length > 60 ? `${row.slice(0, 60)}…` : row))
  if (did.length) return { level: 'did', voice: '我做了', evidence: clip(did), note: '母稿里有亲手做过的事，可以用「我做了…」的口吻，但只能写母稿里写到的那些。' }
  if (studied.length) return { level: 'studied', voice: '我观察到', evidence: clip(studied), note: '母稿里是读过、研究过的内容，没有亲手做过的说法：用「我观察到 / 我读到」，不写成做过。' }
  return { level: 'none', voice: '只能转述', evidence: [], note: '母稿里看不出亲手做过或研究过：这一版按「我观察到」的口吻转述，不写任何经历。想写成经验分享，先在母稿里补上真实经历再重新生成。' }
}

/** 拼进提示词的一段：这次能用什么口吻。 */
export function howIBlock(howI) {
  const evidence = howI.evidence.length ? `\n依据（母稿原句）：${howI.evidence.map(row => `「${row}」`).join('')}` : ''
  if (howI.level === 'did') return `口吻：可以用「我做了…」讲经历，但只能讲 <draft> 里写到的那些经历，不扩写、不加时长和次数。${evidence}`
  if (howI.level === 'studied') return `口吻：用「我观察到 / 我读到 / 我的判断是」。母稿里没有亲手做过的说法，不能写「我试了」「我用了」「亲测」「实测」这类话，也不能用英文的 I built / I tried / I tested。${evidence}`
  return '口吻：母稿里看不出作者亲手做过或研究过，只能按「我观察到」转述来源里的内容并给出判断依据。不写任何第一人称经历（我试了、我用了、亲测、实测、I built、I tried），不写成教程或经验分享。'
}
