// 各平台的写法和长度规矩。纯数据加几个小函数，Host 和浏览器共用这一份（浏览器端由 esbuild 直接打包进去）。
// 这里不能引用 node 模块，也不能引用 React。

/**
 * 长度怎么数：
 * - chars：一个字符算 1（中文、英文、标点、空格都算）
 * - weighted：中文算 1，英文字母、数字和半角符号算 0.5（小红书标题按这个算）
 * - x：X 的算法，中日韩文字算 2，其余算 1，上限 280
 * - words：正文按字算，不算空白（和稿面上显示的字数一致）
 */
export const COUNTING = {
  chars: '每个字符算 1',
  weighted: '中文算 1，英文和数字算 0.5',
  x: '中文算 2，英文算 1（X 的计数方式）',
  words: '不算空白的字数',
}

// 带「定」的数值是工作台负责人给的；其余是按平台现行规则取的默认值，可以按需要改
export const PLATFORM_SPECS = {
  小红书: {
    title: { max: 20, count: 'weighted' }, // 定
    // 定：小红书是一对。body 是发在正文框里的短文案；细节放在图片版 cards 里，按语义分节，渲染时自动分页
    body: { min: 200, max: 300, count: 'words' },
    cards: { min: 1, max: 18, perCard: 300, perImageCard: 180, minCard: 40, total: { min: 800, max: 1100 }, heading: { min: 1, max: 16, count: 'weighted' } }, // 定：图片版合计 800–1100；节数不是实际页数
    tags: { min: 5, max: 8 }, // 定
    links: 'block',
    firstComment: true,
    structure: '正文前三行就要让人停下来：直接给出核心判断，再给至少一个独立判断和继续往下翻图的理由。正文是能直接粘进正文框的短文，不放分页标题，不写「见图」。',
    tone: '像跟朋友讲自己的发现，口语、具体，不端着。',
  },
  公众号: {
    title: { max: 64, count: 'chars' }, // 定
    body: { min: 800, max: 20000, count: 'words' },
    tags: { min: 0, max: 0 },
    digest: { max: 120 }, // 定
    links: 'warn',
    carry: true, // 定：母稿就是公众号版，直接沿用，不调模型
    structure: '完整的论证长文：开头交代问题，中间分节推进，结尾回到问题。',
    tone: '和母稿一致。',
  },
  抖音: {
    title: { max: 30, count: 'chars' }, // 定
    body: { min: 300, max: 900, count: 'words' },
    tags: { min: 3, max: 5 },
    links: 'block',
    script: true,
    structure: '口播脚本：口播和【画面】交替，一行口播一行【画面】。前 3 秒的第一句就要给出钩子，不铺垫。',
    tone: '说话的口气，短句，有停顿。',
  },
  B站: {
    title: { max: 80, count: 'chars' }, // 定
    body: { min: 800, max: 3000, count: 'words' },
    tags: { min: 3, max: 10 },
    links: 'ok',
    structure: '视频脚本或专栏文章都可以，允许讲得更深：交代背景、拆机制、讲取舍。',
    tone: '懂行的人在认真聊，可以带点梗，但信息密度要高。',
  },
  视频号: {
    title: { max: 30, count: 'chars' }, // 定
    body: { min: 300, max: 900, count: 'words' },
    tags: { min: 2, max: 5 },
    links: 'block',
    script: true,
    structure: '默认不出镜：用图解或录屏配旁白。按段落写旁白，每段前用【画面】说明这一段配什么图解或录屏。',
    tone: '平实的旁白，像在给同事讲清楚一件事。',
  },
  知乎: {
    title: { max: 50, count: 'chars' },
    body: { min: 600, max: 1500, count: 'words' }, // 定
    tags: { min: 0, max: 5 },
    links: 'ok',
    structure: '标题写成一个读者会搜的问题。正文第一段先给答案，再分点讲理由和适用条件，最后说清边界。',
    tone: '专业、克制，有判断也交代依据。',
  },
  头条: {
    title: { max: 30, count: 'chars' }, // 定
    body: { min: 600, max: 1200, count: 'words' }, // 定
    tags: { min: 0, max: 5 },
    links: 'warn',
    structure: '新闻式导语：第一段讲清发生了什么、跟谁有关、为什么现在值得看，后面再展开细节。',
    tone: '直白、信息先行。',
  },
  X: {
    title: null, // X 没有标题
    body: { min: 1, max: 280 * 7, count: 'x' },
    post: { max: 280, count: 'x', threadMin: 3, threadMax: 7 }, // 定
    tags: { min: 0, max: 2 },
    links: 'ok',
    thread: true,
    structure: '要么一条自成一体的判断（不超过 280），要么 3 到 7 条的串，每条不超过 280，条与条之间单独一行写 ---。串的最后一条以一个问题结尾。',
    tone: '一句话一个判断，不寒暄。',
  },
  YouTube: {
    title: { max: 100, count: 'chars' }, // 定
    body: { min: 100, max: 5000, count: 'chars', hard: true }, // 定：说明栏上限
    tags: { min: 3, max: 15 },
    links: 'ok',
    structure: '正文是视频说明：前两行说清这期讲什么、谁该看，接着列出内容要点，可以带时间轴占位（不要编时间）。',
    tone: '清楚、友好。',
  },
  TikTok: {
    title: { max: 30, count: 'chars' }, // 定
    body: { min: 150, max: 600, count: 'words' },
    tags: { min: 3, max: 5 },
    links: 'warn',
    script: true,
    structure: '短口播脚本：第一句就是钩子，口播和【画面】交替，30 到 60 秒讲完一件事。',
    tone: '快、口语。',
  },
  Instagram: {
    title: null,
    body: { min: 100, max: 2200, count: 'chars', hard: true }, // 定
    tags: { min: 5, max: 10 }, // 定
    links: 'warn',
    structure: '图文配文：第一行是钩子，接着几段短文，每段一两句。',
    tone: '轻松、具体。',
  },
}

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

/** 按平台的算法数长度。 */
export function measure(text, count = 'chars') {
  const source = String(text ?? '')
  if (count === 'words') return source.replace(/\s/g, '').length
  let n = 0
  for (const ch of source) {
    const wide = CJK.test(ch)
    if (count === 'weighted') n += wide ? 1 : 0.5
    else if (count === 'x') n += wide ? 2 : 1
    else n += 1
  }
  return Math.ceil(n)
}

export function specOf(platform) {
  return Object.hasOwn(PLATFORM_SPECS, platform) ? PLATFORM_SPECS[platform] : null
}

/** X 的串：单独一行 --- 隔开每一条。 */
export function splitThread(body) {
  return String(body ?? '').split(/\n\s*-{3,}\s*\n/).map(post => post.trim()).filter(Boolean)
}

/** 标签：去掉 #、空白和重复，单个不超过 20 字。 */
export function cleanTags(list, max = 15) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    if (out.length >= max) break
    if (typeof raw !== 'string') continue
    const tag = raw.replace(/^[#＃\s]+|[#＃\s]+$/g, '').replace(/\s+/g, '').slice(0, 20)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** 绝对化、夸大的说法。标题台和发布前检查共用这一份。 */
export const ABSOLUTE_WORDS = /最强|最好|最佳|最牛|最全|最快|最便宜|最低价|最权威|最先进|全网第一|行业第一|排名第一|销量第一|全国第一|世界第一|第一品牌|唯一|全网|必看|必读|必买|必备|震惊|史上|顶级|绝对|万能|百分之百|100%|永久|无敌|天花板|吊打|秒杀|国家级/g

/** 第一人称的经历说法。工具没法知道是不是真做过，只能提醒作者确认。 */
export const EXPERIENCE_WORDS = /我(?:亲自|自己)?(?:试了|试过|测了|测过|用了|用过|跑了|跑过|做了|做过|花了|踩过|一直在用)|亲测|实测|用了\s*(?:\d+|[一二三四五六七八九十两半几]+)\s*(?:个)?(?:月|周|天|年|星期)/g

/** 千分位逗号去掉再找：「2,500」和「2500」是同一个数。 */
const withoutThousands = text => String(text ?? '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1')

/** 一段文字里的阿拉伯数字（含小数和百分号前的数字）。 */
export function numbersIn(text) {
  return [...new Set(withoutThousands(text).match(/\d+(?:\.\d+)?/g) ?? [])]
}

// 「35 万」「420M」「350k」：带单位的数换算成同一个值再比，中英文换算式写法不算新数字
const MULTIPLIER = /^\s*(万|亿|千|[kKM])/
const SCALE = { 万: 1e4, 亿: 1e8, 千: 1e3, k: 1e3, K: 1e3, M: 1e6 }

/** 一段文字里每个数字出现的位置和换算后的值：万/亿/k/M 会乘上去。 */
function numberValues(text) {
  const source = withoutThousands(text)
  const out = []
  for (const match of source.matchAll(/\d+(?:\.\d+)?/g)) {
    const unit = MULTIPLIER.exec(source.slice(match.index + match[0].length))
    const raw = match[0]
    // 带单位时只认紧挨着的（350k、420M），中间隔空格只认中文单位：「35 万」算，不把「3 M」当兆
    const scale = unit && (!/\s/.test(source.slice(match.index + raw.length, match.index + raw.length + 1)) || /万|亿|千/.test(unit[1])) ? SCALE[unit[1]] : 1
    out.push({ raw, at: match.index, value: Number(raw) * scale })
  }
  return out
}

const near = (a, b) => (a === b ? true : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) < 0.02)

// 正文里写「2 周」、母稿里写「两周」是同一个数：把母稿里的中文数字也当成数收进来比
const CN_DIGIT = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 }

/** 一段中文里 0 到 9999 的简单数字（「两」「十五」「三千五」这类），够比对换算式了。 */
export function chineseNumbers(text) {
  const out = []
  for (const match of String(text ?? '').matchAll(/[零一两二三四五六七八九十百千]+/g)) {
    const run = match[0]
    let total = 0
    let digit = null
    for (const ch of run) {
      if (ch in CN_DIGIT) digit = CN_DIGIT[ch]
      else {
        total += (digit ?? 1) * CN_UNIT[ch]
        digit = null
      }
    }
    const value = total + (digit ?? 0)
    if (value > 0 && !out.includes(value)) out.push(value)
  }
  return out
}

/** text 里有、source 里找不到的数字。按换算后的值比：「35 万」和「350k」是同一个数。 */
export function missingNumbers(text, source) {
  const have = [...numberValues(source).map(row => row.value), ...chineseNumbers(source)]
  return [...new Set(numberValues(text).filter(row => !have.some(other => near(row.value, other))).map(row => row.raw))]
}

/** 母稿的指纹：母稿改过之后，平台版本要提示重新生成。 */
export function fingerprint(text) {
  let h = 2166136261
  const source = String(text ?? '')
  for (let i = 0; i < source.length; i += 1) {
    h ^= source.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** 平台规矩写成一段给模型看的说明。 */
export function specBrief(platform) {
  const spec = specOf(platform)
  if (!spec) return ''
  const lines = [`平台：${platform}`]
  if (spec.title) lines.push(`标题：不超过 ${spec.title.max}（${COUNTING[spec.title.count]}）`)
  else lines.push('这个平台没有标题，title 留空字符串')
  if (spec.thread) lines.push(`正文：一条不超过 ${spec.post.max}（${COUNTING[spec.post.count]}），或 ${spec.post.threadMin} 到 ${spec.post.threadMax} 条的串，每条不超过 ${spec.post.max}`)
  else lines.push(`正文：${spec.body.min} 到 ${spec.body.max}（${COUNTING[spec.body.count]}）`)
  lines.push(spec.tags.max ? `标签：${spec.tags.min} 到 ${spec.tags.max} 个，不带 #` : '标签：不要')
  lines.push(`结构：${spec.structure}`)
  lines.push(`语气：${spec.tone}`)
  if (spec.links === 'block') lines.push('正文里不能出现任何外部链接、联系方式或引导私信、加微信的话')
  return lines.join('\n')
}
