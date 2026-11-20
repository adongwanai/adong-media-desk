// 发布前检查：不调模型，只按规则扫一遍要发出去的标题、正文和标签。
// 不引用 React 和 DOM，Node 里也能直接跑测试。规则是工作台自己的，措辞尽量说清为什么要改。
// 机器腔句式和平台流程的自检项（图片版页数、加粗高亮预算等）和 Host 的自检共用 src/selfcheck.js。
import { ABSOLUTE_WORDS, COUNTING, EXPERIENCE_WORDS, measure, splitThread } from '../src/platform-specs.js'
import { effectiveSpec } from '../src/platform-rules.js'
import { matches, selfCheck, sentenceAt, toneFindings } from '../src/selfcheck.js'
import { toneRuleFindings } from './tone-rules.js'

const MAX_PER_RULE = 5
// 这些自检项发布前检查里没有，从流程自检里拿过来
const FLOW_ITEMS = new Set(['caption-format', 'cards-count', 'card-chars', 'cards-total', 'card-title', 'card-images', 'similar-cards', 'banned', 'advice', 'bold', 'highlight', 'emoji'])

// 内容规则：level 可以是函数，按平台定轻重
const CONTENT_RULES = [
  {
    rule: 'phone', level: 'block', message: () => '有电话号码，公开发出去会被限流，也会暴露隐私',
    pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)|(?<!\d)0\d{2,3}-\d{7,8}(?!\d)|(?<!\d)400-?\d{3}-?\d{4}(?!\d)/,
  },
  {
    rule: 'wechat', level: 'block', message: () => '有微信号或 QQ 号，平台会当成导流处理',
    pattern: /(?<![A-Za-z])(?:微信|威信|薇信|vx|VX|wx|WX|v信|V信|weixin)号?\s*[:：]?\s*[A-Za-z][-_A-Za-z0-9]{5,19}|(?<![A-Za-z])(?:QQ|qq|扣扣)[号群]?\s*[:：]?\s*[1-9]\d{4,10}/,
  },
  {
    rule: 'email', level: 'block', message: () => '有邮箱地址，公开发出去会暴露隐私',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
  },
  {
    rule: 'link',
    level: spec => ({ block: 'block', warn: 'warn' })[spec?.links] ?? null,
    message: (platform, spec) => (spec?.links === 'block' ? `${platform}正文里不能放外部链接，发出去会被限流或删掉` : `${platform}正文里的链接点不开，读者只能手动复制`),
    pattern: /(?:https?:\/\/|www\.)[^\s<>()（）"'，。、]+|(?<![@\w.-])[A-Za-z0-9-]+\.(?:com|cn|net|org|io|ai|dev|me|co|app)(?:\/[^\s<>()（）"'，。、]*)?(?![\w.])/i,
  },
  {
    rule: 'lead', level: spec => (spec?.links === 'block' ? 'block' : 'warn'), message: () => '在引导私下联系或领取资料，平台容易判成导流',
    pattern: /(?:扫|识别|长按)[^。！？!?\n]{0,6}二维码|二维码[^。！？!?\n]{0,6}(?:加我|领取|进群|关注|咨询)|扫码(?:加|关注|进群|领|添加|咨询)|加(?:我)?微信|加[vV](?![A-Za-z])|私信(?:我|领取|获取|发你)|评论区?(?:领取|扣\d)|(?:拉你)?进群|免费领取|主页(?:领取|联系)/,
  },
  { rule: 'absolute', level: 'warn', message: () => '绝对化用词，可能违反广告法，也容易被读者挑刺', pattern: ABSOLUTE_WORDS },
  {
    rule: 'medical', level: 'block', message: () => '像在承诺医疗或保健效果，没有资质不能这样写',
    pattern: /根治|治愈(?!系)|药到病除|包治|疗效|无副作用|抗癌|防癌|降血压|降血糖|降血脂|(?:减肥|瘦了?|掉秤)\s*\d+\s*(?:斤|公斤|kg)|祛斑|生发|增高|排毒|替代药物/,
  },
  {
    rule: 'finance', level: 'block', message: () => '像在承诺收益，涉及投资理财时不能这样写',
    pattern: /稳赚|保本|保底收益|保证收益|零风险|无风险|躺赚|包赚|日赚\s*\d|月入\s*\d+\s*[万千wWkK]|年化\s*\d+(?:\.\d+)?\s*%|收益翻倍|翻倍收益|一夜暴富/,
  },
  {
    rule: 'placeholder', level: 'block', message: () => '还有没替换的占位符',
    pattern: /\bTODO\b|\bTBD\b|\bFIXME\b|XXX|xxx|【待[补定填写][^】]{0,20}】|\[待[补定]\]|（待补[^）]{0,20}）|\{\{[^{}\n]{0,40}\}\}|\{[^{}\n"':,;=()]{1,30}\}|此处(?:插入|补充|填写)/,
  },
  {
    rule: 'obsidian', level: 'warn', message: platform => `Obsidian 的写法，${platform}不认，会原样显示出来`,
    pattern: /==[^=\n]+==|!?\[\[[^\]\n]+\]\]/,
  },
  { rule: 'experience', level: 'warn', message: () => '第一人称的经历：请确认这是你真实做过的', pattern: EXPERIENCE_WORDS },
]

/** 文风：作者风格里写着不要的词，几种一眼就看得出是机器写的句式，再加上 tone-rules.js 里移植来的 AI 腔规则（统计项只作参考）。 */
function styleFindings(body, style, title) {
  return [...toneFindings(body, style?.avoid), ...toneRuleFindings(body, title)]
}

/** 风格卡里平台流程的自检项：只拿发布前检查里没有的几项，没过的才列出来。 */
function flowFindings(draft, platform, style) {
  // 风格「绝不要」里的词上面已经查过，这里只查平台禁用词
  const checks = selfCheck({ ...draft, body: draft.markdown ?? draft.body }, platform, { style: style ? { ...style, avoid: [] } : null })
  // 没有图片版的旧版本不查图片版那几项
  const skip = String(draft.cards ?? '').trim() ? new Set() : new Set(['caption-format', 'cards-count', 'card-chars', 'cards-total', 'card-title', 'card-images', 'similar-cards'])
  return checks.filter(row => !row.ok && FLOW_ITEMS.has(row.id) && !skip.has(row.id)).map(row => ({ level: row.level, rule: row.id, message: `${row.label}：${row.detail}`, excerpt: row.excerpt ?? '' }))
}

/** 平台的长度和数量规矩。 */
function specFindings({ title, body, tags }, platform, spec) {
  const out = []
  if (spec.title) {
    const n = measure(title, spec.title.count)
    if (!title.trim()) out.push({ level: 'warn', rule: 'title-empty', message: '还没有标题', excerpt: '' })
    else if (n > spec.title.max) out.push({ level: 'block', rule: 'title-length', message: `标题超出${platform}的 ${spec.title.max}（现在 ${n}，${COUNTING[spec.title.count]}）`, excerpt: title })
  }
  if (spec.thread) {
    const posts = splitThread(body)
    posts.forEach((post, index) => {
      const n = measure(post, spec.post.count)
      if (n > spec.post.max) out.push({ level: 'block', rule: 'post-length', message: `第 ${index + 1} 条超出 ${spec.post.max}（现在 ${n}，${COUNTING[spec.post.count]}）`, excerpt: post.slice(0, 60) })
    })
    if (posts.length > 1 && (posts.length < spec.post.threadMin || posts.length > spec.post.threadMax)) out.push({ level: 'warn', rule: 'thread-count', message: `串要 ${spec.post.threadMin} 到 ${spec.post.threadMax} 条（现在 ${posts.length} 条）`, excerpt: '' })
    const last = posts[posts.length - 1] ?? ''
    if (posts.length > 1 && !/[?？]\s*$/.test(last)) out.push({ level: 'warn', rule: 'thread-question', message: '串的最后一条要以一个问题结尾', excerpt: last.slice(-60) })
  } else if (spec.body) {
    const n = measure(body, spec.body.count)
    if (n > spec.body.max) out.push({ level: spec.body.hard ? 'block' : 'warn', rule: 'body-length', message: `正文 ${n}，超出${platform}的 ${spec.body.max}`, excerpt: '' })
    else if (n < spec.body.min) out.push({ level: 'warn', rule: 'body-length', message: `正文 ${n}，${platform}建议至少 ${spec.body.min}`, excerpt: '' })
  }
  const count = tags.length
  if (spec.tags.max === 0 && count) out.push({ level: 'warn', rule: 'tag-count', message: `${platform}不用标签`, excerpt: '' })
  else if (spec.tags.max && (count < spec.tags.min || count > spec.tags.max)) out.push({ level: 'warn', rule: 'tag-count', message: `标签要 ${spec.tags.min} 到 ${spec.tags.max} 个（现在 ${count} 个）`, excerpt: tags.join(' ') })
  return out
}

/**
 * 发布前检查。
 * @param {{title?: string, body?: string, markdown?: string, cards?: string, tags?: string[], firstComment?: string}} draft - 要发出去的内容；markdown 是没去掉记号的正文（数加粗高亮用），cards 是小红书图片版。
 * @param {string} platform - 平台。
 * @param {object} [style] - 当前风格卡（用里面的 avoid 和各平台的数）。
 * @returns {Array<{level: 'block'|'warn'|'info', rule: string, message: string, excerpt: string}>} 发现的问题，硬伤在前，参考在最后。
 */
export function checkDraft(draft, platform, style = null) {
  const title = String(draft?.title ?? '')
  const body = String(draft?.body ?? '')
  const tags = (Array.isArray(draft?.tags) ? draft.tags : []).filter(tag => typeof tag === 'string')
  const comment = String(draft?.firstComment ?? '')
  const spec = effectiveSpec(platform, style)
  const legacy = Boolean(spec?.cards) && !String(draft?.cards ?? '').trim()
  // 以前的小红书版本只有一段正文、没有图片版：还按一整篇的长度查
  if (legacy) spec.body = { ...spec.body, min: spec.cards.total.min, max: spec.cards.total.max }
  const findings = []
  const seen = new Set()
  const add = (finding) => {
    const key = `${finding.rule}|${finding.excerpt}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push(finding)
  }
  const fields = [title, body, comment, tags.join(' ')].filter(Boolean)
  for (const { rule, level, message, pattern } of CONTENT_RULES) {
    const grade = typeof level === 'function' ? level(spec) : level
    if (!grade) continue
    let n = 0
    for (const text of fields) {
      for (const m of matches(text, pattern)) {
        if (n >= MAX_PER_RULE) break
        add({ level: grade, rule, message: message(platform, spec), excerpt: sentenceAt(text, m.index, m[0].length) })
        n += 1
      }
    }
  }
  for (const finding of styleFindings(body, style, title)) add(finding)
  if (spec) for (const finding of specFindings({ title, body, tags }, platform, spec)) add(finding)
  if (spec) for (const finding of flowFindings({ title, body, markdown: draft?.markdown, cards: draft?.cards, tags, firstComment: comment }, platform, style)) add(finding)
  // info 只是参考（句长、连词密度这类统计），排在最后，不算进要改和提醒
  return [...findings.filter(row => row.level === 'block'), ...findings.filter(row => row.level === 'warn'), ...findings.filter(row => row.level === 'info')]
}

/** 数一下硬伤和提醒各几条。 */
export function countFindings(findings) {
  return { block: findings.filter(row => row.level === 'block').length, warn: findings.filter(row => row.level === 'warn').length }
}
