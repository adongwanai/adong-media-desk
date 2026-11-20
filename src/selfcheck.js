// 不调模型的自检：平台版本写出来之后先按规则逐项查一遍，查出来的项才拿去让模型改一次，改完还不过的如实给用户看。
// 纯函数，Host 和浏览器共用（发布前检查也用这里的机器腔句式规则）。不能引用 node 模块。
import { EXPERIENCE_WORDS, measure, missingNumbers, splitThread } from './platform-specs.js'
import { CHECKS, checksFor, effectiveSpec, rulesOf } from './platform-rules.js'
import { tokens } from './tokens.js'
import { DID_WORDS, NOT_DONE, isDidSentence } from './howi.js'

/** 正文和母稿的相似度上限（和平台版本的重写线一致）。 */
export const SIMILAR_LIMIT = 0.5
/** 小红书正文和图片版的用词重合度上限。作者过去 28 组成对稿的中位数约 0.3。 */
export const CARD_SIMILAR_LIMIT = 0.4
/**
 * 正文里有多少（按字数）是图片版里原样出现过的整句。正文比图片版短得多，只看用词重合度量不出「剪出来」，所以另算这一项。
 * 作者过去 28 组成对稿的中位数约 0.1，最高 0.6；从图片版剪出来的正文接近 1。
 */
export const CARD_COPY_LIMIT = 0.5

const MAX_PER_RULE = 5
const STOPS = /[。！？!?；;\n]/
const EN_EXPERIENCE = /\bI(?:'ve| have)? (?:built|tried|tested|ran|shipped|spent|used|benchmarked|measured)\b/gi
const ADVICE = /你应该|建议你|你要/g
const EMOJI = /\p{Extended_Pictographic}/gu
const BOLD = /\*\*[^*\n]+\*\*/g
const HIGHLIGHT = /==[^=\n]+==/g
const IMAGE_LINE = /^\s*!(?:\[[^\]]*\]\([^)]*\)|\[\[[^\]]+\]\])\s*$/
const PLACEHOLDER = /此处(?:放|插入|配)[图截]|这里放(?:图|截图)|\[(?:截图|图片|配图)\]|TODO\s*图|（(?:配图|截图|图片)）|【(?:配图|截图|图片)】/

/** 两段文字有多像：中文相邻两字、英文整词切成集合，算 Jaccard。0 到 1。 */
export function similarity(a, b) {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size || !right.size) return 0
  let both = 0
  for (const token of left) if (right.has(token)) both += 1
  return both / (left.size + right.size - both)
}

const plainSentence = text => text.replace(/\*\*|==|\s|[“”"'「」]/g, '')

/** a 里（按字数）有多少是 b 里原样出现过的整句（8 字以上的句子才算）。0 到 1。 */
export function copiedShare(a, b) {
  const target = plainSentence(String(b ?? ''))
  const rows = String(a ?? '').split(/[。！？!?\n；;]/).map(plainSentence).filter(row => row.length >= 8)
  const total = rows.reduce((sum, row) => sum + row.length, 0)
  if (!total || !target) return 0
  return rows.filter(row => target.includes(row)).reduce((sum, row) => sum + row.length, 0) / total
}

/** 把命中的那一句摘出来，太长的两头截掉。 */
export function sentenceAt(text, index, length) {
  let start = index
  while (start > 0 && !STOPS.test(text[start - 1]) && index - start < 40) start -= 1
  let end = index + length
  while (end < text.length && !STOPS.test(text[end]) && end - index < 60) end += 1
  const head = start > 0 && !STOPS.test(text[start - 1]) ? '…' : ''
  const tail = end < text.length && !STOPS.test(text[end]) ? '…' : ''
  return `${head}${text.slice(start, end).trim()}${tail}`
}

export function matches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...String(text ?? '').matchAll(new RegExp(pattern.source, flags))]
}

/**
 * 机器腔：作者风格里写着不要的词，加上几种一眼就看得出是机器写的句式。发布前检查和自检共用。
 * @returns {Array<{level: 'warn', rule: string, message: string, excerpt: string}>}
 */
export function toneFindings(body, avoid = []) {
  const out = []
  for (const word of Array.isArray(avoid) ? avoid : []) {
    if (typeof word !== 'string' || word.trim().length < 2 || word.trim().length > 12) continue
    const needle = word.trim()
    let at = body.indexOf(needle)
    let n = 0
    while (at >= 0 && n < MAX_PER_RULE) {
      out.push({ level: 'warn', rule: 'style-avoid', message: `风格里写着不要用「${needle}」`, excerpt: sentenceAt(body, at, needle.length) })
      at = body.indexOf(needle, at + needle.length)
      n += 1
    }
  }
  const contrast = matches(body, /不是[^。！？!?\n]{1,30}?而是/)
  if (contrast.length >= 2) for (const m of contrast.slice(0, MAX_PER_RULE)) out.push({ level: 'warn', rule: 'not-but', message: `「不是…而是」用了 ${contrast.length} 次，读着像套路`, excerpt: sentenceAt(body, m.index, m[0].length) })
  const first = body.indexOf('首先')
  if (first >= 0 && body.indexOf('其次', first) > first && body.indexOf('最后', first) > first) out.push({ level: 'warn', rule: 'sequence', message: '「首先…其次…最后」的排比太像模板', excerpt: sentenceAt(body, first, 2) })
  const dashes = matches(body, /——/)
  if (dashes.length > 3) out.push({ level: 'warn', rule: 'dash', message: `破折号用了 ${dashes.length} 次，超过 3 次就显得刻意`, excerpt: sentenceAt(body, dashes[0].index, 2) })
  const bold = matches(body, BOLD)
  if (bold.length > 8) out.push({ level: 'warn', rule: 'bold', message: `加粗用了 ${bold.length} 处，超过 8 处就没有重点了`, excerpt: bold[0][0] })
  return out
}

/** 去掉 Markdown 记号，只留读者看得到的字。 */
function visible(text) {
  return String(text ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/==([^=]+)==/g, '$1').replace(/^\s*(?:[-*+]|\d+[.、)])\s+/gm, '').replace(/^>\s?/gm, '')
}

const nonSpace = text => visible(text).replace(/\s/g, '').length

/**
 * 小红书图片版切成页：每个「## 」是一页（第一页是首页），同一页里单独一行 --- 往下续页。
 * @returns {Array<{index: number, heading: string, text: string, chars: number, images: number, placeholder: boolean, cover: boolean, continued: boolean}>}
 */
export function splitCards(markdown) {
  const sections = []
  for (const line of String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const head = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (head) sections.push({ heading: head[1].trim(), lines: [] })
    else if (sections.length) sections[sections.length - 1].lines.push(line)
    else if (line.trim()) sections.push({ heading: '', lines: [line] })
  }
  const pages = []
  sections.forEach((section, at) => {
    const parts = [[]]
    for (const line of section.lines) {
      if (/^\s*-{3,}\s*$/.test(line)) parts.push([])
      else parts[parts.length - 1].push(line)
    }
    parts.forEach((part, i) => {
      if (i > 0 && !part.join('').trim()) return
      const textLines = part.filter(line => !IMAGE_LINE.test(line))
      const text = textLines.join('\n').trim()
      pages.push({
        index: pages.length, section: at, heading: i === 0 ? section.heading : '', text, chars: nonSpace(text),
        images: part.filter(line => IMAGE_LINE.test(line)).length, placeholder: PLACEHOLDER.test(part.join('\n')), cover: at === 0 && i === 0, continued: i > 0,
      })
    })
  })
  return pages
}

/** 母稿里出现过的所有文字：标题、正文和定好的事实。 */
export function motherText(production) {
  return [production?.title, production?.article, ...(production?.facts ?? [])].filter(Boolean).join('\n')
}

/** 版本里所有要发出去的文字。 */
export function versionText(version) {
  return [version?.title, version?.body, version?.cards, version?.firstComment].filter(Boolean).join('\n')
}

/** 数字检查前去掉列表序号，「1. xxx」的 1 不算事实。 */
export function factNumbers(text, source) {
  // 千分位逗号去掉再比：「2,500」和「2500」是同一个数
  const plain = value => String(value ?? '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
  return missingNumbers(plain(text).replace(/^\s*\d+[.、)]\s+/gm, ''), plain(source))
}

function wordHits(text, word) {
  if (/^[\x20-\x7e]+$/.test(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return matches(text, new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'i'))
  }
  return matches(text, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

/**
 * 跑一遍自检。
 * @param {{title?: string, body?: string, cards?: string, tags?: string[], firstComment?: string}} version - 平台版本。
 * @param {string} platform - 平台。
 * @param {{style?: object, production?: object, howI?: {level: string}, signature?: string, carry?: boolean}} [context]
 *   style 是当前风格卡；production 是母稿（算数字和相似度）；howI 决定能不能写成做过；signature 是作者署名。
 * @returns {Array<{id: string, label: string, ok: boolean, level: 'block'|'warn', detail: string, excerpt?: string, fix?: string}>} 每项一行，没过的带 fix（让模型改时说的话）。
 */
export function selfCheck(version, platform, { style = null, production = null, howI = null, signature = '', carry = false } = {}) {
  const spec = effectiveSpec(platform, style)
  if (!spec) return []
  const rules = rulesOf(style, platform)
  const enabled = new Set(Array.isArray(rules.checks) && rules.checks.length ? rules.checks : checksFor(platform))
  const title = String(version?.title ?? '')
  const body = String(version?.body ?? '')
  const cards = String(version?.cards ?? '')
  const tags = Array.isArray(version?.tags) ? version.tags : []
  const xhs = Boolean(spec.cards)
  const all = [body, cards, version?.firstComment ?? ''].filter(Boolean).join('\n')
  const out = []
  const add = (id, ok, detail, extra = {}) => {
    if (!enabled.has(id)) return
    out.push({ id, label: CHECKS[id]?.label ?? id, ok, level: extra.level ?? 'warn', detail, ...(extra.excerpt ? { excerpt: extra.excerpt } : {}), ...(!ok && extra.fix ? { fix: extra.fix } : {}) })
  }

  if (spec.title) {
    const n = measure(title, spec.title.count)
    add('title-length', Boolean(title.trim()) && n <= spec.title.max, title.trim() ? `${n} / ${spec.title.max}` : '没有标题', { level: 'block', fix: `标题改到 ${spec.title.max} 字以内（${spec.title.count === 'weighted' ? '英文和数字算半个' : '每个字符算 1'}），保留原意` })
  }
  if (spec.thread) {
    const posts = splitThread(body)
    const long = posts.map((post, i) => [i + 1, measure(post, spec.post.count)]).filter(([, n]) => n > spec.post.max)
    add('post-length', !long.length, long.length ? long.map(([i, n]) => `第 ${i} 条 ${n}`).join('，') + ` / ${spec.post.max}` : `每条都在 ${spec.post.max} 以内`, { level: 'block', fix: `${long.map(([i, n]) => `第 ${i} 条（现在 ${n}）`).join('、')}压到 ${spec.post.max} 以内（中文算 2，英文算 1）` })
    const count = posts.length
    add('thread-count', count === 1 || (count >= spec.post.threadMin && count <= spec.post.threadMax), `${count} 条`, { fix: `要么写成 1 条，要么写成 ${spec.post.threadMin} 到 ${spec.post.threadMax} 条的串（现在 ${count} 条）` })
    const last = posts[posts.length - 1] ?? ''
    // 问题后面允许跟一句很短的落款：风格里要求末行写「Building in public.」，检查时先把它去掉再找问题
    const spoken = last.replace(/\n\s*(?:Building in public\.?|发表于|首发于)[\s\S]*$/i, '').trim()
    add('question-end', count <= 1 || /[?？][^?？]{0,40}$/.test(spoken), count <= 1 ? '单条不要求' : '最后一条', { excerpt: last.slice(-60), fix: '串的最后一条以一个能引发回复的问题结尾（问题之后最多再跟一行落款）' })
  } else {
    // 按读者看得到的字数算，加粗和高亮的记号不算
    const n = measure(spec.body.count === 'words' ? visible(body) : body, spec.body.count)
    const short = n < spec.body.min
    const ok = !short && n <= spec.body.max
    // 公众号整理不能为了凑字数加内容：太短只提示，不让模型补
    const fixable = !(short && carry)
    add('body-length', ok, `${n} / ${spec.body.min}–${spec.body.max}`, { fix: fixable ? (short ? `${xhs ? '正文' : '全文'}扩到 ${spec.body.min} 字以上（现在 ${n}），只能展开 <draft> 里已有的事实和判断，不加新事实` : `${xhs ? '正文' : '全文'}压到 ${spec.body.max} 字以内（现在 ${n}），删重复和铺垫，判断和数字保留`) : undefined })
  }
  if (spec.tags.max) {
    add('tags', tags.length >= spec.tags.min && tags.length <= spec.tags.max, `${tags.length} 个 / ${spec.tags.min}–${spec.tags.max}`, { fix: `标签给 ${spec.tags.min} 到 ${spec.tags.max} 个（现在 ${tags.length} 个），不带 #` })
  }

  if (xhs) {
    const lines = body.split('\n')
    const bad = lines.find(line => /^\s*#{1,6}\s/.test(line) || IMAGE_LINE.test(line) || /^\s*(?:#[^\s#]+\s*){2,}$/.test(line)) ?? (body.includes('见图') ? '见图' : null)
    add('caption-format', !bad, bad ? '正文里有分页标题、图片、标签行或「见图」' : '可以直接粘贴', { level: 'block', excerpt: bad ?? undefined, fix: '正文里不放「## 」分页标题、不放图片、不写「见图」；标签只放在 tags 字段里，不写进正文' })
    const pages = splitCards(cards)
    const c = spec.cards
    add('cards-count', pages.length >= c.min && pages.length <= c.max, `${pages.length} 节 / ${c.min}–${c.max}`, { level: pages.length ? 'warn' : 'block', fix: pages.length ? `图片版改成 ${c.min} 到 ${c.max} 节（现在 ${pages.length} 节）：太多就合并信息少的节，太少就把塞得太满的节拆开` : `写出图片版：${c.min} 到 ${c.max} 节，每节一行「## 节标题」开头` })
    const over = pages.filter(page => page.chars > (page.images ? c.perImageCard : c.perCard))
    const thin = pages.filter(page => !page.cover && page.chars < c.minCard)
    const pageName = page => `第 ${page.index + 1} 节${page.heading ? `「${page.heading}」` : '（续节）'}`
    add('card-chars', !over.length && !thin.length, [...over.map(page => `${pageName(page)} ${page.chars} 字`), ...thin.map(page => `${pageName(page)} 只有 ${page.chars} 字`)].join('；') || `每节都在 ${c.perCard} 字以内`, {
      fix: [over.length ? `${over.map(page => `${pageName(page)}（${page.chars} 字）`).join('、')}超过每节上限（无图 ${c.perCard}、有图 ${c.perImageCard}），删减或分节` : '', thin.length ? `${thin.map(pageName).join('、')}太单薄（少于 ${c.minCard} 字），并到上一节或补上 <draft> 里的细节` : ''].filter(Boolean).join('；'),
    })
    const total = pages.reduce((sum, page) => sum + page.chars, 0)
    add('cards-total', total >= c.total.min && total <= c.total.max, `${total} / ${c.total.min}–${c.total.max}`, { fix: total < c.total.min ? `图片版合计扩到 ${c.total.min} 字以上（现在 ${total}），用 <draft> 里已有的数据、步骤和对比补充，不加新事实` : `图片版合计压到 ${c.total.max} 字以内（现在 ${total}）` })
    const titled = pages.filter(page => !page.cover && page.heading)
    const offTitle = titled.filter((page) => {
      const n = measure(page.heading, c.heading.count)
      return n < c.heading.min || n > c.heading.max
    })
    // 太长会在卡片上折成三行，要改；偏短只提示（「10 到 16 字最好」是建议，作者自己的小节标题也常有更短的）
    const tooLong = offTitle.filter(page => measure(page.heading, c.heading.count) > c.heading.max)
    add('card-title', !offTitle.length, offTitle.length ? offTitle.map(page => `「${page.heading}」${measure(page.heading, c.heading.count)} 字`).join('、') : `小节标题都在 ${c.heading.min}–${c.heading.max} 字`, { level: 'warn', fix: tooLong.length ? `这些小节标题压到 ${c.heading.max} 字以内：${tooLong.map(page => `「${page.heading}」`).join('、')}；标题负责钩子，不和正文说同一句话` : undefined })
    const crowded = pages.filter(page => page.images > 1)
    const fake = pages.filter(page => page.placeholder)
    add('card-images', !crowded.length && !fake.length, crowded.length || fake.length ? [...crowded.map(page => `${pageName(page)} 有 ${page.images} 张图`), ...fake.map(page => `${pageName(page)} 有占位图`)].join('；') : '没问题', { level: 'block', fix: '每节最多一张图；删掉「此处放图」这类占位文字，没有真实图片就不写图片' })
    const sim = similarity(body, cards)
    const copied = copiedShare(body, cards)
    add('similar-cards', !cards.trim() || (sim <= CARD_SIMILAR_LIMIT && copied <= CARD_COPY_LIMIT), `用词重合 ${sim.toFixed(2)} / ${CARD_SIMILAR_LIMIT}，整句照搬 ${Math.round(copied * 100)}% / ${Math.round(CARD_COPY_LIMIT * 100)}%`, { fix: `正文和图片版太像了（用词重合 ${sim.toFixed(2)}，正文有 ${Math.round(copied * 100)}% 是图片版里的原句），正文像是从图片版里剪出来的。正文重写：只留最核心的判断和往下翻图的理由，换一套句子，不照搬图片版的整句` })
  }

  // 风格卡里写的禁用词 + 风格的「绝不要」里的短词
  const banned = [...new Set([...(rules.banned ?? []), ...(Array.isArray(style?.avoid) ? style.avoid : []).filter(word => typeof word === 'string' && word.trim().length >= 2 && word.trim().length <= 12)])]
  const hitWords = []
  let bannedExcerpt = ''
  const scan = [title, all].join('\n')
  for (const word of banned) {
    const hits = wordHits(scan, word)
    if (!hits.length) continue
    hitWords.push(word)
    if (!bannedExcerpt) bannedExcerpt = sentenceAt(scan, hits[0].index, hits[0][0].length)
  }
  add('banned', !hitWords.length, hitWords.length ? `用了：${hitWords.join('、')}` : '没有', { excerpt: bannedExcerpt || undefined, fix: `删掉或换掉这些词：${hitWords.map(word => `「${word}」`).join('')}，直接说意思，不换成另一套口头禅` })

  const tone = toneFindings(all).filter(row => row.rule !== 'bold' || !Number.isFinite(spec.budgets.boldMax))
  add('tone', !tone.length, tone.length ? tone.map(row => row.message).join('；') : '没有', { excerpt: tone[0]?.excerpt, fix: tone.map(row => row.message).join('；') + '：改成直接陈述' })

  const b = spec.budgets
  if (Number.isFinite(b.adviceMax)) {
    const n = matches(all, ADVICE).length
    add('advice', n <= b.adviceMax, `${n} / ${b.adviceMax}`, { fix: `「你应该 / 建议你 / 你要」用了 ${n} 次，最多 ${b.adviceMax} 次：改成「我观察到」「我的判断是」「我会这样选」` })
  }
  const counted = xhs ? [body, cards].join('\n') : body
  if (Number.isFinite(b.boldMin) || Number.isFinite(b.boldMax)) {
    const n = matches(counted, BOLD).length
    const min = b.boldMin ?? 0
    const max = b.boldMax ?? Infinity
    add('bold', n >= min && n <= max, `${n} / ${min}–${Number.isFinite(max) ? max : '不限'}`, { fix: n < min ? `加粗（**…**）补到至少 ${min} 处，只标核心判断和关键结论` : `加粗减到 ${max} 处以内，只留核心判断` })
  }
  if (Number.isFinite(b.highlightMin) || Number.isFinite(b.highlightMax)) {
    const n = matches(counted, HIGHLIGHT).length
    const min = b.highlightMin ?? 0
    const max = b.highlightMax ?? Infinity
    add('highlight', n >= min && n <= max, `${n} / ${min}–${Number.isFinite(max) ? max : '不限'}`, { fix: n < min ? `用 ==…== 高亮 ${min} 到 ${Number.isFinite(max) ? max : min} 处最值得记住的洞察` : `高亮减到 ${max} 处以内` })
  }
  if (Number.isFinite(b.emojiMax)) {
    const n = matches(counted, EMOJI).length
    add('emoji', n <= b.emojiMax, `${n} / ${b.emojiMax}`, { fix: `emoji 减到 ${b.emojiMax} 个以内，不要一段一个` })
  }

  const sign = String(signature ?? '').trim()
  if (sign && (xhs || carry)) {
    const where = []
    if (!body.includes(sign)) where.push(xhs ? '正文' : '全文')
    if (xhs && cards.trim()) {
      const pages = splitCards(cards)
      if (!pages.length || !pages[pages.length - 1].text.includes(sign)) where.push('图片版最后一页')
    }
    add('signature', !where.length, where.length ? `${where.join('、')}缺署名` : '有署名', { fix: `在${where.join('和')}最后单独一行写「${sign}」` })
  }

  if (howI && howI.level !== 'did') {
    // 「我还没试过」「打算」这类句子不算
    const hits = [...matches(all, EXPERIENCE_WORDS), ...matches(all, DID_WORDS), ...matches(all, EN_EXPERIENCE)].filter(m => !NOT_DONE.test(sentenceAt(all, m.index, m[0].length)))
    add('experience', !hits.length, hits.length ? `母稿里没有亲手做过的说法，这里写了 ${hits.length} 处` : '没有写成做过', { level: 'block', excerpt: hits[0] ? sentenceAt(all, hits[0].index, hits[0][0].length) : undefined, fix: `母稿里没有亲手做过的说法：把「${[...new Set(hits.map(m => m[0]))].slice(0, 4).join('」「')}」这类写成做过的句子改成「我观察到 / 我读到 / 按原文的说法」` })
  }
  if (production) {
    const source = motherText(production)
    const fresh = factNumbers([title, all].join('\n'), source)
    add('numbers', !fresh.length, fresh.length ? `母稿里找不到：${fresh.join('、')}` : '数字都来自母稿', { level: 'block', fix: `这些数字在母稿里找不到，删掉或改回母稿里的说法：${fresh.join('、')}` })
    if (!carry) {
      const sim = similarity(body, production.article)
      add('similar-mother', sim <= SIMILAR_LIMIT, `${sim.toFixed(2)} / ${SIMILAR_LIMIT}`, { fix: `上一版和母稿太像了（相似度 ${sim.toFixed(2)}），读者在两个平台会读到几乎一样的东西。开头、标题、例子的顺序和句子都要换，不许沿用母稿的整句` })
    }
  }
  return out
}

/** 一次最多标出的无依据经历句。 */
export const MAX_UNSUPPORTED = 20
/** 来源里的一句经历，有这么多用词出现在稿子的这句里（或反过来），就算稿子这句有依据。 */
const SUPPORT_SHARE = 0.6

/** 按句切开并记下每句在原文里的起点。句子是原文里的原样片段，可以直接拿去替换。 */
function spans(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(/[^。！？!?；;\n]+/g)) {
    const lead = m[0].length - m[0].trimStart().length
    const sentence = m[0].trim()
    if (sentence) out.push({ sentence, index: m.index + lead })
  }
  return out
}

/**
 * 只在「有没有依据」这一步用的经历说法：模型常写「我用的是 XX」「我拿一次会话算过」「我把三个 Agent 接进了流水线」，
 * 这些不在通用的经历词里，但同样是把自己写成了亲手做过。不放进 howI 分类，免得把作者读过的说法误判成做过。
 */
const CLAIM_WORDS = /我(?:现在|平时|一直|之前|上周)?(?:用的|选的是|买的是)[^。！？!?；;\n]{0,12}|我(?:拿|按)[^。！？!?；;，,\n]{0,12}(?:算过|折算过|比过|试过)|我把[^。！？!?；;\n]{0,12}(?:接进|接上|跑了|部署了|换了)/g

/**
 * 文字里写成「作者亲手做过」的句子（我试了、我用了、亲测、I built…）。「还没试过」「如果我用」「他说他试了」不算。
 * @param {string} text - 稿子。
 * @returns {Array<{sentence: string, index: number}>} index 是句子在原文里的起点。
 */
export function experienceClaims(text) {
  return spans(text).filter(({ sentence }) => isDidSentence(sentence) || (!NOT_DONE.test(sentence) && matches(sentence, EN_EXPERIENCE).length > 0) || (!NOT_DONE.test(sentence) && matches(sentence, CLAIM_WORDS).length > 0))
}

function shareOf(small, big) {
  if (!small.size) return 0
  let n = 0
  for (const token of small) if (big.has(token)) n += 1
  return n / small.size
}

/**
 * 稿子里写成亲手做过、但作者自己写的文字里找不到对应经历的句子。纯函数，工作室的提示条和 Host 共用。
 * @param {string} article - 模型写的稿子。
 * @param {string} sourceText - 作者自己写的文字（灵感标题、正文、导入原稿、手动改过的句子）。
 * @returns {Array<{sentence: string, index: number}>} 最多 20 条，按出现顺序。
 */
export function unsupportedClaims(article, sourceText) {
  const own = experienceClaims(sourceText).map(row => tokens(row.sentence)).filter(set => set.size)
  return experienceClaims(article)
    .filter(({ sentence }) => {
      const words = tokens(sentence)
      return !own.some(src => shareOf(src, words) >= SUPPORT_SHARE || shareOf(words, src) >= SUPPORT_SHARE)
    })
    .slice(0, MAX_UNSUPPORTED)
}

/**
 * 把几句换成改好的说法。找不到原句的跳过；同一句只换第一次出现的位置。
 * @param {string} article - 稿子。
 * @param {Array<{sentence: string, replace: string}>} edits - 原句和改好的句子。
 * @returns {{text: string, applied: number}} 换好的稿子和实际换了几句。
 */
export function replaceSentences(article, edits) {
  let text = String(article ?? '')
  let applied = 0
  for (const edit of edits) {
    // 原句不带句末标点（切句时去掉了），改好的句子也不带，免得出现「。。」
    const replace = String(edit?.replace ?? '').trim().replace(/[。！？!?；;]+$/, '').trim()
    if (!edit?.sentence || !replace || replace === edit.sentence || !text.includes(edit.sentence)) continue
    text = text.replace(edit.sentence, () => replace)
    applied += 1
  }
  return { text, applied }
}

/** 没过、而且能让模型改的项。 */
export function fixable(checks) {
  return checks.filter(row => !row.ok && row.fix)
}

/** 没过的项（不管能不能改）。 */
export function failed(checks) {
  return checks.filter(row => !row.ok)
}
