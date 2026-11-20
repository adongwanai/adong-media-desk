// 单篇诊断：每篇有数据的作品给一句诊断和一个动作。纯函数，不调模型。
// 只拿作者自己在同一平台的作品当尺子，不拿行业数字顶替；没记的数是未知，不当 0。
// 漏斗从上游往下看：曝光 → 点击率 → 完播率 → 深度互动 → 涨粉，只报最靠上游的那个「明显偏低」的环节。
// 明显偏低 = 低于作者自己这个平台作品的 25 分位（等于不算）；某一项有数的作品不到 10 篇时，这一项先不下结论。
import { platformName, tr } from './i18n.js'

export const MIN_SAMPLE = 10
// 相对最强的一项至少是中位数的 1.2 倍，才建议照着复用
const CLEAR_LEAD = 1.2
const COUNT_KEYS = ['views', 'impressions', 'likes', 'comments', 'shares', 'saves', 'newFollowers', 'recommends']

const known = value => Number.isFinite(value)
const pct = value => `${(value * 100).toFixed(1)}%`

/** 漏斗各环节：怎么算、怎么显示、偏低时做什么、最强时怎么延续。 */
const STAGES = [
  {
    key: 'impressions', label: '曝光',
    value: p => (known(p.impressions) ? p.impressions : null),
    fmt: v => Math.round(v).toLocaleString('en-US'),
    action: '先看选题和标签：换一个更多人在找的题，标签写准，换个时间发',
    keep: '这个选题方向有人看，可以接着做成系列',
  },
  {
    key: 'ctr', label: '点击率',
    value: p => (p.impressions > 0 && known(p.views) ? p.views / p.impressions : null),
    fmt: pct,
    action: '换标题和封面',
    keep: '这套标题和封面的写法值得复用',
  },
  {
    key: 'completion', label: '完播率',
    value: p => (known(p.completion) ? p.completion : null),
    fmt: pct,
    action: '改开头：视频的前三秒、图文的第一屏直接给结论或冲突',
    keep: '这个开头的写法值得复用',
  },
  {
    key: 'deep', label: '深度互动率（评+藏+转）',
    value: (p) => {
      const parts = [p.comments, p.saves, p.shares].filter(known)
      return p.views > 0 && parts.length ? parts.reduce((a, b) => a + b, 0) / p.views : null
    },
    fmt: pct,
    action: '加一份能收藏的清单或明确的结论，结尾抛一个具体问题',
    keep: '这种能收藏、能讨论的结构值得复用',
  },
  {
    key: 'follows', label: '每千次播放涨粉',
    value: p => (p.views > 0 && known(p.newFollowers) ? (p.newFollowers / p.views) * 1000 : null),
    fmt: v => v.toFixed(1),
    action: '改结尾和主页承接：结尾说清关注你能持续得到什么，主页置顶同系列',
    keep: '这篇的结尾承接可以照着用到下一篇',
  },
]

// 不在漏斗里，只参与「相对最强」
const EXTRA = [
  {
    key: 'saveLike', label: '收藏/点赞比',
    value: p => (p.likes > 0 && known(p.saves) ? p.saves / p.likes : null),
    fmt: v => v.toFixed(2),
    keep: '读者把它当干货存，可以多做同类清单',
  },
]

/** 线性插值的分位数，values 已从小到大排好。 */
export function quantile(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function titleOf(item) {
  const production = item?.production
  return production?.title && production.status !== 'running' ? production.title : item?.title
}

/** 同一作品同一平台的稳定身份；已删除的稿件 ID 不单独充当作品。 */
export function metricPieceKey(row, items) {
  const itemId = items.some(item => item.id === row.itemId) ? row.itemId : null
  if (!row.platform || (!itemId && !row.title && !row.workId)) return null
  return JSON.stringify([row.platform, row.workId ? 'work' : itemId ? 'item' : 'title', row.workId || itemId || row.title])
}

/**
 * 把记录归到「一篇作品在一个平台」：挂在内容下的按内容，没挂但有标题的（导入的后台表）按标题，两样都没有的不算一篇。
 * 计数类只加记了的项；完播率是比例不能相加，取最近一条记了的。
 */
export function collectPieces(metrics, items) {
  const byId = new Map(items.map(item => [item.id, item]))
  const pieces = new Map()
  const ordered = [...metrics].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  for (const row of ordered) {
    const itemId = byId.has(row.itemId) ? row.itemId : null
    const key = metricPieceKey(row, items)
    if (!key) continue
    const piece = pieces.get(key) ?? {
      key, itemId, platform: row.platform, date: row.date ?? null, metricIds: [],
      title: (itemId && titleOf(byId.get(itemId))) || row.title || row.workId || '',
    }
    if (row.id) piece.metricIds.push(row.id)
    for (const field of COUNT_KEYS) if (known(row[field])) piece[field] = (piece[field] ?? 0) + row[field]
    if (known(row.completion)) piece.completion = row.completion
    pieces.set(key, piece)
  }
  return [...pieces.values()]
}

function baselines(pieces) {
  const out = new Map()
  for (const stage of [...STAGES, ...EXTRA]) {
    const byPlatform = new Map()
    for (const piece of pieces) {
      const value = stage.value(piece)
      if (value === null) continue
      byPlatform.set(piece.platform, [...(byPlatform.get(piece.platform) ?? []), value])
    }
    for (const [platform, values] of byPlatform) {
      const sorted = [...values].sort((a, b) => a - b)
      out.set(`${stage.key}|${platform}`, { n: sorted.length, median: quantile(sorted, 0.5), p25: quantile(sorted, 0.25) })
    }
  }
  return out
}

function judge(piece, base) {
  const platform = platformName(piece.platform)
  const metrics = [...STAGES, ...EXTRA].flatMap((stage) => {
    const value = stage.value(piece)
    if (value === null) return []
    const { n, median, p25 } = base.get(`${stage.key}|${piece.platform}`)
    return [{ key: stage.key, label: tr(stage.label), value, text: stage.fmt(value), n, median, p25, medianText: stage.fmt(median), p25Text: stage.fmt(p25), enough: n >= MIN_SAMPLE, stage }]
  })
  const notes = metrics.filter(row => !row.enough).map(row => tr('{label}：样本不足（{n} 篇），先不下结论', { label: row.label, n: row.n }))
  const head = { key: piece.key, itemId: piece.itemId, metricIds: piece.metricIds, title: piece.title, platform: piece.platform, date: piece.date, notes }
  const shown = metrics.map(({ stage, ...row }) => row)
  if (!metrics.length) {
    return { ...head, metrics: shown, verdict: 'none', stage: null, sample: 0, line: tr('记下的数还算不出任何一个环节'), action: tr('下次导入时带上曝光、完播率、评论收藏转发或涨粉列') }
  }
  const judged = metrics.filter(row => row.enough)
  if (!judged.length) {
    const n = Math.max(...metrics.map(row => row.n))
    return { ...head, metrics: shown, verdict: 'insufficient', stage: null, sample: n, line: tr('样本不足（{n} 篇），先不下结论', { n }), action: tr('{platform}再录 {k} 篇带这些数的作品，就能和你自己的中位数比', { platform, k: MIN_SAMPLE - n }) }
  }
  // 漏斗顺序就是 STAGES 的顺序，第一个低于 25 分位的就是最上游的短板
  const low = judged.find(row => STAGES.includes(row.stage) && row.value < row.p25)
  if (low) {
    return {
      ...head, metrics: shown, verdict: 'low', stage: low.key, sample: low.n,
      line: tr('{label} {value}，低于你在{platform}的 25 分位 {p25}（中位数 {median}，依据 {n} 篇）', { label: low.label, value: low.text, platform, p25: low.stage.fmt(low.p25), median: low.stage.fmt(low.median), n: low.n }),
      action: tr(low.stage.action),
    }
  }
  // 没有短板：找相对自己中位数最强的一项；倍数一样时按漏斗顺序取靠前的
  const ranked = judged.filter(row => row.median > 0).map(row => ({ ...row, ratio: row.value / row.median }))
  const best = ranked.reduce((top, row) => (!top || row.ratio > top.ratio ? row : top), null)
  if (!best) {
    const n = Math.max(...judged.map(row => row.n))
    return { ...head, metrics: shown, verdict: 'strong', stage: null, sample: n, line: tr('没有明显偏低的环节（依据 {n} 篇）', { n }), action: tr('照现在的做法继续发') }
  }
  return {
    ...head, metrics: shown, verdict: 'strong', stage: best.key, sample: best.n,
    line: tr('没有明显偏低的环节；相对最强的是{label} {value}，是你在{platform}中位数 {median} 的 {ratio} 倍（依据 {n} 篇）', { label: best.label, value: best.text, platform, median: best.stage.fmt(best.median), ratio: best.ratio.toFixed(1), n: best.n }),
    // 最强的一项也只和中位数差不多时，不夸它
    action: best.ratio >= CLEAR_LEAD ? tr(best.stage.keep) : tr('照现在的做法继续发，没有哪一项明显领先'),
  }
}

/**
 * 给每篇有数据的作品一句诊断和一个动作。
 * @param {{items?: Array<object>, metrics?: Array<object>}} state - 当前状态；有了真实数据后示例不参与。
 * @returns {Array<object>} 按发布日期从新到旧；每条带 line、action、sample（判断依据的篇数）和各项指标的中位数、25 分位。
 */
export function diagnosePieces(state) {
  const all = state.metrics ?? []
  const real = all.filter(row => !row.sample)
  const pieces = collectPieces(real.length ? real : all, state.items ?? [])
  const base = baselines(pieces)
  return pieces.map(piece => judge(piece, base)).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
}
