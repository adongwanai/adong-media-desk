// 成稿与图文卡片通用规则检查与结构规整（纯函数，无 DOM 依赖，Node 后端与浏览器前端共用）。
// 覆盖 5 项核心通用规则：
// 1. 卡片饱满度（消除首页大白板、次页重复封面空卡、超长断页孤尾卡）
// 2. 重点标记执行度（**加粗** 与 ==高亮== 是否真正落地且不过度）
// 3. 配图与信源视觉锚点（真实配图、信源引用框、无坏图/占位符/重复贴图）
// 4. 去 AI 味执行度（无「不是…而是」堆叠、无首先其次最后、无虚动词名词化与 AI 套话）
// 5. 活人感与去营销腔（有第一人称真实判断、无卖课营销词、小红书卡片无裸公式墙）
import { sentenceAt, toneFindings } from './selfcheck.js'

const IMAGE_LINE_RE = /^\s*(?:!\[[^\]]*\]\(([^)\n]+)\)|!\[\[([^\]\n]+)\]\])\s*$/
const FAKE_IMAGE_RE = /此处(?:放|插|补)(?:图|截图|配图)|\[(?:截图|配图|图片|此处放图)\]|\bTODO\s*[:：]?\s*(?:图片|配图|截图)?/i
const TAG_WALL_RE = /^\s*((?:#[^\s#]{1,24}\s*){3,})\s*$/

const NOMINALIZATION_PATTERNS = [
  /进行(?:了|一次|一场|着)?[^。，！？\n]{0,10}(?:调整|优化|升级|分析|讨论|沟通|梳理|复盘|迭代|探索|尝试|思考|规划|布局|评估|排查|验证)/g,
  /实现了?[^。，！？\n]{0,14}的?[^。，！？\n]{0,6}(?:提升|增长|突破|转变|跃升|落地|改善)/g,
  /完成了?对[^。，！？\n]{0,16}的/g,
  /起到了?[^。，！？\n]{0,12}的?作用/g,
  /具有[^。，！？\n]{0,10}(?:意义|价值)/g,
]

const SERVICE_TONE_RE = /希望(?:以上|这些|这篇|这)?(?:内容|回答|信息|说明)?(?:能)?(?:对您|对你|对大家)?有所?帮助|(?:请|欢迎)随时(?:告诉|联系|提问|交流)/g

const AI_CLICHE_WORDS = [
  '说白了', '本质上', '某种程度上', '不难发现', '众所周知', '值得注意的是',
  '总而言之', '综上所述', '归根结底', '毋庸置疑', '赋能', '抓手', '闭环', '底层逻辑', '降维打击',
]

const MARKETING_SLIME_RE = /建议(?:大家)?(?:反复)?收藏|赶紧(?:点赞)?收藏|99%\s*的人(?:都)?不知道|花\s*\d+\s*分钟(?:帮你)?省|干货满满|颠覆(?:了?(?:我的)?)?认知|史诗级|王炸|封神之作|看完这篇就够了|手把手教你白嫖/g

const XHS_RAW_MATH_RE = /\$\$[\s\S]+?\$\$|\\(?:frac|sum|prod|int|theta|pi|alpha|beta|gamma|delta|nabla|mathbb|mathcal|operatorname|sqrt|approx|leq|geq)\b|\$[^$\n]{1,60}[_^\\][^$\n]{1,60}\$|[∑∏∫]{1,}|Δ\s*[a-zA-Z]\s*=/g

const HUMAN_STANCE_RE = /我是[^，。！？\n]{1,12}|我自己|我平时|我这阵子|我这几个月|我每天|我用下来|我挑了|我筛了|我翻了|我(?:觉得|认为|判断|观察|打算|选择|决定|试了|试过|测了|看了|刷到|顺手|发现|猜|怀疑|好奇|建议|习惯|改了|先不|不会急着|还没)|我的(?:判断|反应|选择|结论|看法|习惯|做法|感觉|顺序)|第一反应|说实话|老实说|先说结论|换句话说/

/** 一键调用原生 Humanizer Skills（中文 22 特征 humanizer-zh + humanizer 3.1）的标准化改写指令。 */
export const HUMANIZE_SKILL_PROMPT = '请先实际读取并严格执行 humanizer-zh（中文 22 特征去 AI 味）与 humanizer Skill 的快流程，对当前全文逐段做去 AI 味与活人感精修：去掉「不是…而是」排比、匀速三连排比、提前堵死所有反驳、概念命名仪式、虚动词翻译腔、段尾漂亮总结金句与卖课营销词，遵循当前作者的文风与原文样本，保留自然表达与事实边界。铁律：原样保留全部真实事实、实验数字、章节骨架、重点加粗高亮以及所有 ![...](...) 配图链接，将精修后的完整正文包在标记中更新。'

/** 屏蔽代码块与行内代码、图片地址，避免误报公式或套话。 */
function maskCodeAndLinks(raw) {
  const blank = m => m.replace(/[^\n]/g, ' ')
  return String(raw ?? '')
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]+`/g, blank)
    .replace(/!\[[^\]]*\]\([^)\n]*\)/g, blank)
    .replace(/\]\([^)\n]*\)/g, m => `](${' '.repeat(Math.max(0, m.length - 3))})`)
}

/** 去掉 Markdown 标记后的可见文字。 */
export function visibleChars(text) {
  const clean = String(text ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*!\[[^\]]*\]\([^)\n]+\)\s*$/gm, '')
    .replace(/^\s*!\[\[[^\]\n]+\]\]\s*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)\n]+\)/g, '$1')
    .replace(/(\*\*|__|==|~~|`)/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\s+/g, '')
  return Array.from(clean).length
}

/** 位置转 0-based 行号。 */
function lineAtOffset(text, offset) {
  if (!Number.isFinite(offset) || offset <= 0) return 0
  let line = 0
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

/** 解析 Markdown 的小节结构，供结构规整与无 DOM 卡片饱满度检查共用。 */
export function parseCardSections(markdown) {
  const lines = String(markdown ?? '').split('\n')
  let startLine = 0
  let h1Title = ''
  while (startLine < lines.length && !lines[startLine].trim()) startLine += 1
  const h1Match = /^#\s+(.+)$/.exec(lines[startLine] ?? '')
  if (h1Match) {
    h1Title = h1Match[1].trim()
    startLine += 1
    while (startLine < lines.length && !lines[startLine].trim()) startLine += 1
  }

  const sections = [{ kind: 'cover', heading: '', line: startLine, lines: [] }]
  let inCode = false
  for (let i = startLine; i < lines.length; i += 1) {
    const raw = lines[i]
    if (/^\s*```/.test(raw)) inCode = !inCode
    const h2 = !inCode && /^##\s+(.+)$/.exec(raw)
    if (h2) {
      sections.push({ kind: 'content', heading: h2[1].trim(), line: i, lines: [] })
    } else {
      sections[sections.length - 1].lines.push({ text: raw, line: i })
    }
  }

  return {
    h1Title,
    sections: sections.map((sec, index) => {
      const bodyText = sec.lines.map(row => row.text).join('\n').trim()
      const images = []
      let hasCallout = false
      let hasTable = false
      let hasList = false
      let hasCode = false
      let hasFakeImage = FAKE_IMAGE_RE.test(bodyText)
      let codeFence = false
      for (const { text } of sec.lines) {
        if (/^\s*```/.test(text)) { codeFence = !codeFence; hasCode = true; continue }
        if (codeFence) continue
        const img = IMAGE_LINE_RE.exec(text)
        if (img) images.push((img[1] || img[2] || '').trim())
        if (/^\s*>\s*\S/.test(text)) hasCallout = true
        if (/^\s*\|.+\|\s*$/.test(text)) hasTable = true
        if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(text)) hasList = true
      }
      const proseChars = visibleChars(bodyText)
      const totalChars = visibleChars(sec.heading) + proseChars
      return {
        ...sec,
        index,
        bodyText,
        proseChars,
        totalChars,
        images,
        hasCallout,
        hasTable,
        hasList,
        hasCode,
        hasFakeImage,
      }
    }),
  }
}

/**
 * 规整卡片稿结构缺陷（纯确定性、不改作者观点和措辞）：
 * 1. 若正文开头没有导语，且第 1 个 `##` 只是「封面大标题 + 一句话副标题」（<= 55 字，无图/引用框/列表/表格/代码），
 *    并且后面还有真正的 `##` 内容章节，自动把这节拆回封面导语/副标题，彻底消除「第 2 页只有一句话、85% 留白」的重复封面卡！
 * 2. 若 goal === 'xhs' 且卡片稿里混入了独立的 `#标签1 #标签2 #标签3` 标签墙行，自动抽离标签，避免把签名挤出半空尾页。
 * 3. 清理纯占位符废行（如 `[此处放图]`）。
 */
export function normalizeDraftStructure(markdown, { fallbackTitle = '', goal = 'article' } = {}) {
  const raw = String(markdown ?? '').replace(/\r\n/g, '\n')
  const fixes = []
  const extractedTags = []

  const parsed = parseCardSections(raw)
  let effectiveTitle = parsed.h1Title || String(fallbackTitle ?? '').trim()
  let coverTitle = ''
  let kicker = ''

  const contentSections = parsed.sections.filter(s => s.kind === 'content')
  const coverSec = parsed.sections[0]

  let rebuiltLines = null
  // 检测「第 1 个 ## 是重复封面短桩」：封面自身无正文、总共有 >=2 个 ## 节、第 1 个 ## 正文 <= 55 字且没有任何结构块
  if (
    coverSec.proseChars === 0
    && coverSec.images.length === 0
    && contentSections.length >= 2
  ) {
    const first = contentSections[0]
    const isCoverEchoStub = first.proseChars <= 55
      && first.images.length === 0
      && !first.hasCallout
      && !first.hasTable
      && !first.hasList
      && !first.hasCode
    if (isCoverEchoStub) {
      coverTitle = first.heading
      kicker = first.bodyText.replace(/\s+/g, ' ').trim()
      if (!effectiveTitle) effectiveTitle = coverTitle
      const restStart = contentSections[1].line
      const allLines = raw.split('\n')
      const tail = allLines.slice(restStart).join('\n').trim()
      rebuiltLines = [kicker, tail].filter(Boolean).join('\n\n')
      fixes.push('已合并开头的重复封面短节，消除第 2 页大面积留白')
    }
  }

  let body = rebuiltLines !== null
    ? rebuiltLines
    : (parsed.h1Title ? raw.replace(/^\s*#\s+.+\n+/, '') : raw)

  // 清理小红书卡片内的独立标签墙行 & 假图片占位行
  const cleanedLines = []
  let inCode = false
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode
    if (!inCode && goal === 'xhs') {
      const tagWall = TAG_WALL_RE.exec(line)
      if (tagWall) {
        for (const m of tagWall[1].matchAll(/#([^\s#]{1,24})/g)) extractedTags.push(m[1])
        fixes.push('已将卡片末尾的 #标签墙 移出图片卡面，避免挤压尾页留白')
        continue
      }
    }
    if (!inCode && /^\s*(?:\[(?:截图|配图|图片|此处放图)\]|（此处(?:放|插)(?:图|截图)）)\s*$/i.test(line)) {
      fixes.push('已移除无效的图片文字占位符')
      continue
    }
    cleanedLines.push(line)
  }

  body = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const dedupFixes = [...new Set(fixes)]
  return {
    title: effectiveTitle,
    coverTitle,
    kicker,
    body,
    extractedTags: [...new Set(extractedTags)],
    changed: dedupFixes.length > 0,
    fixes: dedupFixes,
  }
}

const JUDGMENT_MARKERS_RE = /真正|核心|关键|其实|反而|还在坚持|直接把|直接让|最难|最贵|最值钱|死穴|差距|决定|意味着|变成了|不只是|恰恰是|更重要|代价|瓶颈|分水岭|护城河|硬伤/
const QUESTION_LEAD_RE = /(?:第一反应是|最核心的问题是|真正的问题是|更值得问的是|最关键的一问是|问题在于|我更关心的是|一句话总结|我的判断是|我的选择是|换句话说)[：:]\s*(.+)$/

function pickClauseForEmphasis(lineText, { preferQuestion = false } = {}) {
  const raw = String(lineText ?? '').trim()
  if (!raw || raw.length < 10) return null
  if (/^\s*(?:#{1,6}\s+|!\[|!\[\[|\||```|>|[-*+]\s*\[[ xX]\])/.test(raw)) return null
  // 把自然段拆成独立句子（兼容句号紧贴在 ** 或 == 之前的情况），只挑还没带 ** / == / ` / 链接的干净句子
  const sentences = raw.match(/[^。！？!?\n]+(?:[。！？!?](?:\*\*|==)?|(?:(?:\*\*|==)[。！？!?]))?/g) ?? [raw]
  let best = null
  for (let idx = 0; idx < sentences.length; idx += 1) {
    const sent = sentences[idx].trim()
    if (!sent || sent.length < 9 || /\*\*|==|`|\]\(|https?:\/\//i.test(sent)) continue
    const cleanSent = sent.replace(/^\s*(?:>\s*|[-*+]\s+|\d+[.)、]\s+)/, '').trim()
    if (cleanSent.length < 9) continue

    // 优先看带冒号引出的核心追问或结论（如「我第一反应是：它到底是在补模型短板，还是在绕开更根本的能力缺失？」）
    const leadHit = QUESTION_LEAD_RE.exec(cleanSent)
    if (leadHit && leadHit[1].length >= 8 && leadHit[1].length <= 42) {
      const target = leadHit[1].trim()
      const isQ = /[？?]$/.test(target)
      const score = 28 + (preferQuestion && isQ ? 18 : 0) + (JUDGMENT_MARKERS_RE.test(target) ? 8 : 0)
      if (!best || score > best.score) best = { target, score }
      continue
    }

    const isQuestion = /[？?]$/.test(cleanSent)
    // 若整句适中（9–34 字），可直接整句标注；若整句较长，取后半句结论子句（不切开千分位 12,395）
    let candidate = cleanSent
    if (cleanSent.length > 34) {
      const clauses = cleanSent.split(/(?<=[，；;——：:]|,(?!\d))/).map(s => s.trim()).filter(Boolean)
      const tail2 = clauses.slice(-2).join('')
      const tail1 = clauses.at(-1) ?? ''
      if (tail1.length >= 9 && tail1.length <= 32) candidate = tail1
      else if (tail2.length >= 10 && tail2.length <= 36) candidate = tail2
      else continue
    }
    if (candidate.length < 8 || candidate.length > 38) continue
    // 排除纯数字罗列或纯过渡短语
    if (/^(?:不过|另外|此外|比如|例如|后来|接着|然后|同时)[，,。]?$/.test(candidate)) continue

    let score = 10
    if (preferQuestion && isQuestion) score += 20
    if (!preferQuestion && !isQuestion && /[。！!]$/.test(candidate)) score += 4
    if (JUDGMENT_MARKERS_RE.test(candidate)) score += 12
    if (/但|却|然而|而是|只|才|更|不靠|不是/.test(candidate)) score += 5
    if (idx === sentences.length - 1) score += 4
    if (candidate.length >= 11 && candidate.length <= 26) score += 4

    if (!best || score > best.score) best = { target: candidate, score }
  }
  return best?.target ?? null
}

/**
 * 自动为文稿补齐「加蓝加粗（**…**）」与「加黄高亮（==…==）」重点标注：
 * - 在阿东信息流主题（adong-xhs-dense）下，`**文字**` 自动渲染为 #0066FF 蓝底蓝字视觉锚点，`==文字==` 自动渲染为暖黄荧光笔底色；
 * - 仅在章节缺少加粗或全篇缺少高亮时按语义挑出高信息量判断句/追问句补标，绝不破坏已有标记、配图、代码块与原文事实。
 * @param {string} markdown
 * @param {{goal?: 'xhs'|'article'|'script', force?: boolean}} [options]
 * @returns {{text: string, addedBold: number, addedMark: number, changed: boolean}}
 */
export function autoAnnotateHighlights(markdown, { goal = 'xhs', force = false } = {}) {
  const raw = String(markdown ?? '')
  if (!raw.trim() || goal === 'script') return { text: raw, addedBold: 0, addedMark: 0, changed: false }
  const totalChars = visibleChars(raw)
  if (totalChars < 70) return { text: raw, addedBold: 0, addedMark: 0, changed: false }

  const lines = raw.split('\n')
  const masked = maskCodeAndLinks(raw).replace(/^\s*#{1,6}\s+.*$/gm, '')
  const existingBold = [...masked.matchAll(/\*\*([^*\n]{2,80})\*\*/g)].length
  const existingMark = [...masked.matchAll(/==([^=\n]{2,80})==/g)].length
  const maxBold = goal === 'xhs' ? 8 : 12
  const targetMinMark = goal === 'xhs' ? (totalChars >= 180 ? 2 : 1) : (force ? 2 : 1)

  if (!force && existingBold >= 3 && existingMark >= targetMinMark) {
    return { text: raw, addedBold: 0, addedMark: 0, changed: false }
  }

  // 划分章节区间（0 为开头导语区，后续为各 ## 节）
  const sections = [{ start: 0, end: lines.length - 1 }]
  let fence = false
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) fence = !fence
    if (!fence && /^##\s+/.test(lines[i])) {
      sections[sections.length - 1].end = i - 1
      sections.push({ start: i, end: lines.length - 1 })
    }
  }

  let addedBold = 0
  let addedMark = 0

  const sectionStats = (sec) => {
    let inCode = false
    let bolds = 0
    let marks = 0
    const candidateLines = []
    for (let i = sec.start; i <= sec.end; i += 1) {
      const line = lines[i]
      if (/^\s*```/.test(line)) { inCode = !inCode; continue }
      if (inCode) continue
      if (/^\s*#{1,6}\s+/.test(line) || IMAGE_LINE_RE.test(line) || /^\s*\|/.test(line)) continue
      bolds += (line.match(/\*\*[^*\n]{2,80}\*\*/g) ?? []).length
      marks += (line.match(/==[^=\n]{2,80}==/g) ?? []).length
      if (visibleChars(line) >= 12) candidateLines.push(i)
    }
    const secText = candidateLines.map(idx => lines[idx]).join('\n')
    return { bolds, marks, chars: visibleChars(secText), candidateLines }
  }

  // 第一步：为还没有 **加蓝加粗** 的重点段落补齐 **…**（优先每节第 1–2 段的核心判断句）
  for (let sIdx = 0; sIdx < sections.length; sIdx += 1) {
    if (existingBold + addedBold >= maxBold) break
    const stats = sectionStats(sections[sIdx])
    if (stats.chars < 55 || stats.bolds > 0) continue
    let bestPick = null
    for (const lineIdx of stats.candidateLines) {
      // 若是首页导语最后一段且带问号，留给下面的 ==加黄高亮==，先加粗前面的判断句
      const isLastOpeningQuestion = sIdx <= 1 && lineIdx === stats.candidateLines.at(-1) && /[？?]\s*$/.test(lines[lineIdx]) && stats.candidateLines.length >= 2
      if (isLastOpeningQuestion) continue
      const target = pickClauseForEmphasis(lines[lineIdx], { preferQuestion: false })
      if (target) {
        bestPick = { lineIdx, target }
        break
      }
    }
    if (!bestPick) {
      for (const lineIdx of stats.candidateLines) {
        const target = pickClauseForEmphasis(lines[lineIdx], { preferQuestion: false })
        if (target) { bestPick = { lineIdx, target }; break }
      }
    }
    if (bestPick) {
      lines[bestPick.lineIdx] = lines[bestPick.lineIdx].replace(bestPick.target, () => `**${bestPick.target}**`)
      addedBold += 1
    }
  }

  // 第二步：补齐 ==加黄高亮==（首页核心追问/第一反应 + 篇中或结尾点睛洞察，控制在 2–3 处）
  const openingIdx = sectionStats(sections[0]).chars >= 45 ? 0 : (sections.length > 1 ? 1 : 0)
  const markOrder = [
    openingIdx,
    sections.length - 1,
    ...sections.map((_, idx) => idx).filter(idx => idx !== openingIdx && idx !== sections.length - 1),
  ].filter((idx, pos, arr) => idx >= 0 && idx < sections.length && arr.indexOf(idx) === pos)

  for (const sIdx of markOrder) {
    if (existingMark + addedMark >= Math.max(targetMinMark, force && existingMark === 0 ? 2 : targetMinMark)) break
    const stats = sectionStats(sections[sIdx])
    if (stats.chars < 45 || stats.marks > 0) continue
    // 从该节后半段往前找追问句或核心洞察句，避免和刚标的 **…** 挤在同一句
    let bestMark = null
    for (const lineIdx of [...stats.candidateLines].reverse()) {
      const target = pickClauseForEmphasis(lines[lineIdx], { preferQuestion: true })
      if (target) {
        bestMark = { lineIdx, target }
        break
      }
    }
    if (bestMark) {
      lines[bestMark.lineIdx] = lines[bestMark.lineIdx].replace(bestMark.target, () => `==${bestMark.target}==`)
      addedMark += 1
    }
  }

  const changed = addedBold > 0 || addedMark > 0
  return {
    text: changed ? lines.join('\n') : raw,
    addedBold,
    addedMark,
    changed,
  }
}

/**
 * 通用 5 维成稿与卡片质检。
 * @param {string} markdown - 正文或卡片 Markdown。
 * @param {object} [options]
 * @param {string} [options.title] - 稿件标题 / 封面标题。
 * @param {'xhs'|'article'|'script'} [options.goal] - 目标形态。
 * @param {object|null} [options.style] - 当前风格对象（读取 avoid 禁用词）。
 * @param {Array<object>|null} [options.renderedPages] - 前端真实排版后的卡片页（含 kind, number, line, continued, blocks, chars, hasMedia）。
 * @param {string[]} [options.skippedImages] - 前端读不到或失效的图片名。
 * @returns {{
 *   ok: boolean,
 *   passCount: number,
 *   totalChecks: number,
 *   checks: Array<{id: string, label: string, shortLabel: string, state: 'ok'|'warn'|'bad', value: string, detail: string, line?: number, cardIndex?: number, excerpt?: string, fix?: string}>,
 *   hardFailures: Array<object>,
 *   fixPrompt: string,
 *   canNormalize: boolean
 * }}
 */
export function auditDraftQuality(markdown, { title = '', goal = 'xhs', style = null, renderedPages = null, skippedImages = [] } = {}) {
  const raw = String(markdown ?? '')
  const masked = maskCodeAndLinks(raw)
  const parsed = parseCardSections(raw)
  const contentSecs = parsed.sections.filter(s => s.kind === 'content')
  const isXhs = goal === 'xhs'
  const totalChars = visibleChars(raw)
  const checks = []

  // 检查是否存在可一键规整的结构问题（如开头重复封面短节、小红书卡片内标签墙）
  const normPreview = normalizeDraftStructure(raw, { fallbackTitle: title, goal })
  const canNormalize = normPreview.changed

  // ---------------- 1. 首页与每张卡片饱满度 ----------------
  if (isXhs || renderedPages) {
    const sparseCards = []
    const orphanTails = []
    const overlongSecs = []
    let coverBlank = false
    let coverThinChars = 0

    if (Array.isArray(renderedPages) && renderedPages.length > 0) {
      const cover = renderedPages[0]
      const coverHasBlocks = (cover?.blocks?.length ?? 0) > 0
      if (cover?.kind === 'cover' && !coverHasBlocks && contentSecs.length < 2 && !cover?.hasCoverVisual) {
        coverBlank = true
      } else if (isXhs && cover?.kind === 'cover' && renderedPages.length >= 2 && !cover?.hasMedia && totalChars >= 360) {
        const cChars = parsed.sections[0]?.proseChars ?? 0
        const coverOnlyHasIntro = (cover?.blocks ?? []).every(b => b.type !== 'heading' && b.type !== 'image' && b.type !== 'table')
        if (coverOnlyHasIntro && cChars > 0 && cChars < 115) coverThinChars = cChars
      }
      renderedPages.forEach((page, idx) => {
        if (page.kind === 'cover' || page.hasMedia) return
        const c = Number.isFinite(page.chars) ? page.chars : 999
        if (page.continued && c < 68) {
          orphanTails.push({ cardIndex: idx, number: idx + 1, chars: c, line: page.line ?? 0 })
        } else if (!page.continued && c < 58) {
          sparseCards.push({ cardIndex: idx, number: idx + 1, chars: c, line: page.line ?? 0 })
        }
      })
    } else {
      if (parsed.sections[0].proseChars === 0 && contentSecs.length < 2) coverBlank = true
      contentSecs.forEach((sec, idx) => {
        const cardNum = idx + 2
        const hasRichBlock = sec.images.length > 0 || sec.hasTable || sec.hasCode
        if (!hasRichBlock && sec.totalChars < 58) {
          sparseCards.push({ cardIndex: idx + 1, number: cardNum, chars: sec.totalChars, line: sec.line, heading: sec.heading })
        }
      })
    }

    const badCount = (coverBlank ? 1 : 0) + sparseCards.length + orphanTails.length
    const warnCount = overlongSecs.length + (coverThinChars ? 1 : 0)
    const state = badCount > 0 ? 'bad' : warnCount > 0 ? 'warn' : 'ok'
    const parts = []
    if (coverBlank) parts.push('首页缺少开头正文或章节导览，留白过多')
    if (coverThinChars) parts.push(`首页导语偏短（仅 ${coverThinChars} 字，下半截易留白），建议补足到 145–185 字三段式钩子`)
    if (sparseCards.length) parts.push(`${sparseCards.map(c => `第 ${c.number} 页仅 ${c.chars} 字`).join('、')}（留白过大）`)
    if (orphanTails.length) parts.push(`${orphanTails.map(c => `第 ${c.number} 页跨页尾巴仅 ${c.chars} 字`).join('、')}（被上一节挤出的半空页）`)

    const firstIssue = sparseCards[0] ?? orphanTails[0] ?? overlongSecs[0]
    checks.push({
      id: 'card-density',
      shortLabel: '饱满度',
      label: '首页与卡片饱满度',
      state,
      value: state === 'ok' ? `${renderedPages ? renderedPages.length : contentSecs.length + 1} 页完整饱满` : `${badCount || warnCount || 1} 处留白风险`,
      detail: parts.join('；') || '全部卡片按内容完整展开，无大面积空白页或跨页孤尾',
      line: firstIssue?.line ?? 0,
      cardIndex: firstIssue?.cardIndex ?? 0,
      fix: [
        coverThinChars ? `把首页（第一个 ## 之前）扩充为 145–185 字第一人称黄金三段式钩子（事件与关键数字 **加蓝加粗反差** → 现有做法痛点 → 第一反应或核心追问 ==加黄高亮收尾==），不要只写一句报幕词导致首页下半截留白` : '',
        sparseCards.length ? `把${sparseCards.map(c => `第 ${c.number} 页`).join('、')}这类字数过少的空白短节合并进相邻章节，或补足具体事实与判断（严禁把第一个 ## 写成只有一句话的重复封面）` : '',
        orphanTails.length ? '微调跨页段落篇幅，避免只溢出一两句话到下一页造成大片空白' : '',
      ].filter(Boolean).join('；'),
    })
  } else {
    const ok = totalChars >= 450
    checks.push({
      id: 'card-density',
      shortLabel: '结构篇幅',
      label: '段落与篇幅饱满度',
      state: ok ? 'ok' : 'warn',
      value: `${totalChars} 字 · ${contentSecs.length} 节`,
      detail: ok ? '正文章节结构完整' : '正文篇幅偏短，建议补充具体论证细节',
      fix: ok ? undefined : '用已有素材里的事实、细节与边界条件把单薄段落写扎实，不编造新事实',
    })
  }

  // ---------------- 2. 重点加粗与高亮执行度 ----------------
  const proseWithoutHeadings = masked.replace(/^\s*#{1,6}\s+.*$/gm, '')
  const boldHits = [...proseWithoutHeadings.matchAll(/\*\*([^*\n]{2,80})\*\*/g)]
  const markHits = [...proseWithoutHeadings.matchAll(/==([^=\n]{2,80})==/g)]
  const boldCount = boldHits.length
  const markCount = markHits.length
  const minBold = totalChars >= 300 ? 3 : 1
  const maxBold = isXhs ? Math.max(14, Math.ceil(totalChars / 75)) : Math.max(20, Math.ceil(totalChars / 95))
  const maxMark = Math.max(6, Math.ceil(totalChars / 420))
  let emphasisState = 'ok'
  if (boldCount === 0 && totalChars >= 120) emphasisState = 'bad'
  else if (boldCount < minBold || boldCount > maxBold || (isXhs && markCount === 0 && totalChars >= 300) || markCount > maxMark) emphasisState = 'warn'

  const emphasisNotes = []
  if (boldCount === 0) emphasisNotes.push('全文未执行 **加粗**，读者扫读抓不到核心结论')
  else if (boldCount < minBold) emphasisNotes.push(`**加粗** 仅 ${boldCount} 处（建议 ${minBold}–8 处核心判断）`)
  else if (boldCount > maxBold) emphasisNotes.push(`**加粗** 过多（${boldCount} 处），重点反而糊成一片`)
  if (isXhs && markCount === 0 && totalChars >= 300) emphasisNotes.push('未执行 ==高亮==，建议标 1–3 处最关键洞察')
  else if (markCount > maxMark) emphasisNotes.push(`==高亮== 偏多（${markCount} 处，建议留 1–3 处）`)

  checks.push({
    id: 'emphasis',
    shortLabel: '加粗高亮',
    label: '重点加粗与高亮',
    state: emphasisState,
    value: `${boldCount} 粗 · ${markCount} 亮`,
    detail: emphasisNotes.join('；') || `已标出 ${boldCount} 处加粗判断${markCount ? `、${markCount} 处高亮金句` : ''}，扫读层次清晰`,
    fix: emphasisState === 'ok'
      ? undefined
      : [
          boldCount < minBold ? `在正文中用 **…** 加粗 ${minBold} 到 6 处最核心的判断句或反常识结论（平均每 1–2 节 1 处，不要整段全黑）` : '',
          boldCount > maxBold ? `删减多余的 **加粗**，全篇只保留不超过 ${maxBold} 处核心结论` : '',
          isXhs && markCount === 0 ? '用 ==…== 高亮 1 到 3 处最值得读者记住的短洞察' : '',
          markCount > 6 ? '把 ==高亮== 收敛到 1 到 3 处最核心的短句' : '',
        ].filter(Boolean).join('；'),
  })

  // ---------------- 3. 配图与信源视觉锚点 ----------------
  const allImages = parsed.sections.flatMap(s => s.images.map(src => ({ src, line: s.line, sectionIndex: s.index })))
  const fakeSecs = parsed.sections.filter(s => s.hasFakeImage)
  const crowdedSecs = contentSecs.filter(s => s.images.length > 1)
  const seenSrc = new Set()
  const dupSrcs = []
  for (const img of allImages) {
    if (seenSrc.has(img.src)) dupSrcs.push(img)
    seenSrc.add(img.src)
  }
  const calloutCount = parsed.sections.filter(s => s.hasCallout).length
  const tableCount = parsed.sections.filter(s => s.hasTable).length

  let visualState = 'ok'
  const visualNotes = []
  if (skippedImages.length > 0) {
    visualState = 'bad'
    visualNotes.push(`${skippedImages.length} 张图片路径失效或读不到（${skippedImages.slice(0, 3).join('、')}）`)
  }
  if (fakeSecs.length > 0) {
    visualState = 'bad'
    visualNotes.push('正文中含有「此处放图 / [截图]」文字占位符')
  }
  if (dupSrcs.length > 0) {
    if (visualState === 'ok') visualState = 'warn'
    visualNotes.push('多张卡片重复引用了同一张图，每页应提供独立信息')
  }
  if (crowdedSecs.length > 0) {
    if (visualState === 'ok') visualState = 'warn'
    visualNotes.push(`${crowdedSecs.map(s => `「${s.heading}」`).join('、')}塞了多张图，单张卡最多放 1 张图`)
  }
  if (isXhs && contentSecs.length >= 3 && allImages.length === 0) {
    if (visualState === 'ok') visualState = 'warn'
    visualNotes.push(calloutCount || tableCount ? '已有速览框/表格，但还没有原图或截图配图' : '纯文字墙：既无原图/截图，也无 `> ` 信源速览框或对比表')
  }

  checks.push({
    id: 'visuals',
    shortLabel: '配图信源',
    label: '配图与信源呈现',
    state: visualState,
    value: `${allImages.length} 图${calloutCount ? ` · ${calloutCount} 框` : ''}${tableCount ? ` · ${tableCount} 表` : ''}`,
    detail: visualNotes.join('；') || (allImages.length ? `共 ${allImages.length} 张有效配图${calloutCount ? `与 ${calloutCount} 处引用速览框` : ''}，图文排布合理` : '引用框与结构元素正常'),
    line: dupSrcs[0]?.line ?? crowdedSecs[0]?.line ?? fakeSecs[0]?.line ?? 0,
    fix: visualState === 'ok'
      ? undefined
      : [
          skippedImages.length || fakeSecs.length ? '清理失效图片路径与「此处放图」占位文字，确保引用的图片文件真实存在' : '',
          dupSrcs.length ? '去掉重复引用的同一张图片，保证每张图片卡片承载独立的新内容' : '',
          crowdedSecs.length ? '每张卡片最多保留 1 张关键配图，多余图片拆到独立章节或精简' : '',
          isXhs && allImages.length === 0 ? '在开篇补上紧凑的 `> 📄 信源速览框`，若是论文/开源项目优先提取 1–2 张核心原图放进对应章节' : '',
        ].filter(Boolean).join('；'),
  })

  // ---------------- 4. 去 AI 味执行度 ----------------
  const aiIssues = []
  for (const row of toneFindings(masked, style?.avoid).filter(r => r.rule !== 'bold')) {
    const idx = row.excerpt ? raw.indexOf(row.excerpt.slice(0, 16)) : -1
    aiIssues.push({ rule: row.rule, message: row.message, excerpt: row.excerpt, line: lineAtOffset(raw, idx), severe: row.rule === 'not-but' || row.rule === 'first-then' })
  }
  for (const pattern of NOMINALIZATION_PATTERNS) {
    for (const m of masked.matchAll(pattern)) {
      aiIssues.push({ rule: 'nominalization', message: `虚动词名词化「${m[0]}」`, excerpt: sentenceAt(raw, m.index, m[0].length), line: lineAtOffset(raw, m.index), severe: false })
      if (aiIssues.length >= 6) break
    }
  }
  for (const m of masked.matchAll(SERVICE_TONE_RE)) {
    aiIssues.push({ rule: 'service', message: `客服腔「${m[0]}」`, excerpt: sentenceAt(raw, m.index, m[0].length), line: lineAtOffset(raw, m.index), severe: true })
  }
  const hitCliches = []
  let firstClichePos = -1
  for (const word of AI_CLICHE_WORDS) {
    const idx = masked.indexOf(word)
    if (idx >= 0) {
      hitCliches.push(word)
      if (firstClichePos < 0) firstClichePos = idx
    }
  }
  if (hitCliches.length) {
    aiIssues.push({
      rule: 'ai-cliche',
      message: `AI 高频套话：${hitCliches.map(w => `「${w}」`).join('、')}`,
      excerpt: sentenceAt(raw, firstClichePos, hitCliches[0].length),
      line: lineAtOffset(raw, firstClichePos),
      severe: hitCliches.length >= 2,
    })
  }

  const aiSevere = aiIssues.some(x => x.severe) || aiIssues.length >= 2
  const aiState = aiIssues.length === 0 ? 'ok' : aiSevere ? 'bad' : 'warn'
  checks.push({
    id: 'anti-ai',
    shortLabel: '去AI味',
    label: '去 AI 味规则检查',
    state: aiState,
    value: aiIssues.length === 0 ? '通过' : `${aiIssues.length} 处痕迹`,
    detail: aiIssues.length === 0 ? '未检出「不是…而是」排比、首先其次最后、虚动词官话或高频 AI 套话' : aiIssues.slice(0, 3).map(x => x.message).join('；'),
    excerpt: aiIssues[0]?.excerpt,
    line: aiIssues[0]?.line ?? 0,
    fix: aiIssues.length === 0
      ? undefined
      : `彻底改掉这些 AI 腔痕迹（${aiIssues.slice(0, 4).map(x => x.message).join('；')}）：删掉套话过渡词，把虚动词名词化改成大白话真动词，直接下判断`,
  })

  // ---------------- 5. 活人感与去营销腔 ----------------
  const voiceIssues = []
  const marketingHits = [...masked.matchAll(MARKETING_SLIME_RE)]
  if (marketingHits.length) {
    voiceIssues.push({
      severe: true,
      message: `含营销号油腻词：${[...new Set(marketingHits.map(m => `「${m[0]}」`))].slice(0, 4).join('、')}`,
      excerpt: sentenceAt(raw, marketingHits[0].index, marketingHits[0][0].length),
      line: lineAtOffset(raw, marketingHits[0].index),
    })
  }
  if (isXhs) {
    const mathHits = [...masked.matchAll(XHS_RAW_MATH_RE)]
    if (mathHits.length) {
      voiceIssues.push({
        severe: true,
        message: `卡片含裸数学公式符号（如 ${mathHits[0][0].slice(0, 18)}），手机小屏难读`,
        excerpt: sentenceAt(raw, mathHits[0].index, mathHits[0][0].length),
        line: lineAtOffset(raw, mathHits[0].index),
      })
    }
  }
  const hasHumanStance = totalChars < 200 || HUMAN_STANCE_RE.test(masked)
  if (!hasHumanStance) {
    voiceIssues.push({
      severe: false,
      message: '缺少第一人称观察或真实取舍判断，读起来像客观说明书',
      line: contentSecs[0]?.line ?? 0,
    })
  }

  const voiceState = voiceIssues.length === 0 ? 'ok' : voiceIssues.some(x => x.severe) ? 'bad' : 'warn'
  checks.push({
    id: 'human-voice',
    shortLabel: '活人感',
    label: '活人感与去营销检查',
    state: voiceState,
    value: voiceState === 'ok' ? '通过' : `${voiceIssues.length} 处待改`,
    detail: voiceIssues.length === 0 ? '有第一人称真实判断，无卖课营销腔与裸公式堆砌' : voiceIssues.map(x => x.message).join('；'),
    excerpt: voiceIssues[0]?.excerpt,
    line: voiceIssues[0]?.line ?? 0,
    fix: voiceIssues.length === 0
      ? undefined
      : [
          marketingHits.length ? `删掉${[...new Set(marketingHits.map(m => `「${m[0]}」`))].join('、')}这类营销号口吻，换成工程师跟朋友聊天的平实语气` : '',
          isXhs && voiceIssues.some(x => x.message.includes('公式')) ? '把卡片里的裸数学公式符号全部改写成大白话直觉解释，不在图卡上堆公式' : '',
          !hasHumanStance ? '补上第一人称真实视角与明确取舍判断（如「我看完第一反应是…」「我的选择是…」「这一步代价是…」），不编造没做过的经历' : '',
        ].filter(Boolean).join('；'),
  })

  const passCount = checks.filter(c => c.state === 'ok').length
  const hardFailures = checks.filter(c => c.state === 'bad')
  const actionable = checks.filter(c => c.state !== 'ok' && c.fix)
  const fixPrompt = actionable.length
    ? [
        '请对照工作台「通用规则检查」发现的问题，直接在当前稿件基础上修整并输出完整新稿（保持已有真实事实与有效配图路径不变）：',
        ...actionable.map((c, i) => `${i + 1}. 【${c.label}】${c.detail} —— 修改要求：${c.fix}`),
      ].join('\n')
    : ''

  return {
    ok: passCount === checks.length,
    passCount,
    totalChecks: checks.length,
    checks,
    hardFailures,
    fixPrompt,
    canNormalize,
    canAnnotate: totalChars >= 80 && (boldCount < minBold || (isXhs && markCount === 0)),
  }
}
