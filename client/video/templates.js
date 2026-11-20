// 剪辑模板：一个模板 = 剪辑规则 + 字幕样式 + 字卡/叠加 + 转场 + 画幅 + 节奏。
// 模板的组织方式是自己定的；剪辑规则沿用 auto-editor 的停顿参数，「按文稿剪」「字幕内容和样式分开」的思路参考了 ScriptCut 和 capwise 的公开说明（只借思路，代码自己写）。

/** 每个模板要模型帮忙填的文字。都能在界面里改。 */
export const SLOT_KEYS = ['hook', 'chapters', 'keywords', 'endLine', 'quote', 'leftLabel', 'rightLabel']

export const TEMPLATES = [
  {
    id: 'talk-tight',
    name: '口播精剪',
    desc: '去静音，字幕贴底，开头 3 秒大字钩子，结尾一张关注卡。',
    source: 'take',
    aspect: 'portrait',
    cut: { threshold: -40, minGap: 0.5, margin: 0.12, minClip: 0.3 },
    caption: { position: 'bottom', scale: 1, lines: 2, style: 'box', keywords: true },
    hook: true, endCard: 'follow', motion: 'none', transition: 'cut', progress: false, fill: 'cover',
    slots: ['hook', 'keywords', 'endLine'],
  },
  {
    id: 'explain',
    name: '知识讲解',
    desc: '章节标题卡分段，重点词在字幕里高亮，顶部一条进度条。',
    source: 'any',
    aspect: 'landscape',
    cut: { threshold: -40, minGap: 0.7, margin: 0.2, minClip: 0.3 },
    caption: { position: 'bottom', scale: 0.9, lines: 2, style: 'box', keywords: true },
    chapters: true, endCard: 'title', motion: 'kenburns', transition: 'fade', progress: true,
    slots: ['chapters', 'keywords', 'endLine'],
  },
  {
    id: 'picture-talk',
    name: '图文解说',
    desc: '配图慢慢推拉，大号字幕压在画面中下方。',
    source: 'images',
    aspect: 'portrait',
    caption: { position: 'lower', scale: 1.25, lines: 2, style: 'stroke', keywords: false },
    endCard: 'title', motion: 'kenburns', transition: 'fade', progress: false, backdrop: true,
    slots: ['endLine'],
  },
  {
    id: 'screen-steps',
    name: '录屏教程',
    desc: '左上角步骤编号，画面中心慢慢放大，字幕留白不挡操作区。',
    source: 'take',
    aspect: 'landscape',
    cut: { threshold: -42, minGap: 0.8, margin: 0.25, minClip: 0.3 },
    caption: { position: 'bottom', scale: 0.8, lines: 1, style: 'box', keywords: false },
    steps: true, endCard: 'title', motion: 'zoom', transition: 'cut', progress: false,
    slots: ['chapters', 'endLine'],
  },
  {
    id: 'quote',
    name: '金句短片',
    desc: '一句一屏的大字报，节奏快切，适合剪一条 15 秒的金句。',
    source: 'images',
    aspect: 'portrait',
    caption: { position: 'none', scale: 1, lines: 2, style: 'box', keywords: true },
    poster: true, endCard: 'title', motion: 'punch', transition: 'cut', progress: false, pace: 0.7,
    slots: ['quote', 'keywords', 'endLine'],
  },
  {
    id: 'compare',
    name: '对比评测',
    desc: '左右分屏卡，一屏两句对照着看，标签写在两边顶上。',
    source: 'images',
    aspect: 'landscape',
    caption: { position: 'none', scale: 1, lines: 2, style: 'box', keywords: false },
    split: true, endCard: 'title', motion: 'none', transition: 'fade', progress: false,
    slots: ['leftLabel', 'rightLabel', 'endLine'],
  },
]

export function templateById(id) {
  return TEMPLATES.find(row => row.id === id) ?? TEMPLATES[0]
}

/** 模型或用户给的文字槽，清成固定形状；缺的给空值。 */
export function cleanSlots(value) {
  const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const list = (v, n, max) => (Array.isArray(v) ? v.map(row => text(row, max)).filter(Boolean).slice(0, n) : [])
  return {
    hook: text(value?.hook, 30),
    chapters: list(value?.chapters, 6, 16),
    keywords: list(value?.keywords, 8, 10),
    endLine: text(value?.endLine, 24),
    quote: text(value?.quote, 40),
    leftLabel: text(value?.leftLabel, 10),
    rightLabel: text(value?.rightLabel, 10),
  }
}

/** 没让模型填时的默认文字：都从稿子里直接取，不编。 */
export function defaultSlots({ title = '', lines = [] }) {
  const first = (lines[0] ?? title).replace(/[，。！？、；：,.!?;:]+$/u, '')
  return cleanSlots({
    hook: first.length > 30 ? title : first,
    chapters: [],
    keywords: [],
    endLine: title,
    quote: lines.find(line => line.length >= 8 && line.length <= 40) ?? title,
    leftLabel: '',
    rightLabel: '',
  })
}
