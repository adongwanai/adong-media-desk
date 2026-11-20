// 对标作品的相对表现：拿这位作者自己的其他作品当尺子，不和别的账号、行业数字比，不调模型。
// 纯函数，界面和测试都直接用；没有导出的项不当 0。

/**
 * 互动值的权重。一个点赞成本最低，所以记 1；
 * 评论要花时间打字、收藏说明读者打算回来再看，都比点赞更能说明内容有用，记 3；
 * 转发是读者拿自己的名义推给别人，最难得，记 5。
 * 小红书上收藏是主要的「有用」信号，收藏加到 4；B 站的分享多是站内一键转发，降到 4，仍然最高之一。
 * 某个平台的导出里没有某一项时，只用有的项算，并标成「部分数据」。
 */
export const WEIGHTS = {
  default: { likes: 1, comments: 3, saves: 3, shares: 5 },
  小红书: { likes: 1, comments: 3, saves: 4, shares: 5 },
  B站: { likes: 1, comments: 3, saves: 3, shares: 4 },
}

export const MIN_OTHERS = 5
export const MAX_OTHERS = 20
export const FLOOR = 20

const FIELDS = ['likes', 'comments', 'saves', 'shares']

/**
 * 一条作品的互动值。
 * @param {object} work - 作品，likes/comments/saves/shares 可以缺。
 * @param {string} [platform] - 平台，决定权重。
 * @returns {{value: number|null, partial: boolean}} 一项都没有时 value 是 null。
 */
export function engagementValue(work, platform) {
  const weights = WEIGHTS[platform] ?? WEIGHTS.default
  const present = FIELDS.filter(key => Number.isFinite(work[key]))
  if (!present.length) return { value: null, partial: true }
  return { value: present.reduce((total, key) => total + work[key] * weights[key], 0), partial: present.length < FIELDS.length }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 按相对表现评级。
 * R = 这条的互动值 ÷ 同一作者其他作品（最近的至多 20 条、至少 5 条）互动值的中位数。
 * 门槛 max(20, 2×中位数)：小账号几个赞的波动不算爆。
 * 现象级 R≥8，爆款 R≥4，潜力 R≥2；R≥2 但没过门槛是「虚高」；可比的其他作品不到 5 条是「样本不足」；其余没有评级。
 * @param {Array<object>} works - 同一个对标账号的作品。
 * @param {string} [platform] - 这个账号的平台。
 * @returns {Array<object>} 每条加上 value、partial、ratio、median、compared、floor、grade，按 R 从高到低，没有 R 的排在后面。
 */
export function scoreWorks(works, platform) {
  const valued = works.map(work => ({ ...work, ...engagementValue(work, platform) }))
  const scored = valued.map((work) => {
    const others = valued
      .filter(other => other.id !== work.id && other.value !== null)
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
      .slice(0, MAX_OTHERS)
    if (work.value === null) return { ...work, ratio: null, median: null, compared: others.length, floor: null, grade: null }
    if (others.length < MIN_OTHERS) return { ...work, ratio: null, median: null, compared: others.length, floor: null, grade: '样本不足' }
    const mid = median(others.map(other => other.value))
    const ratio = mid > 0 ? work.value / mid : work.value > 0 ? Infinity : null
    const floor = Math.max(FLOOR, 2 * mid)
    const grade = ratio === null || ratio < 2 ? null
      : work.value < floor ? '虚高'
        : ratio >= 8 ? '现象级' : ratio >= 4 ? '爆款' : '潜力'
    return { ...work, ratio, median: mid, compared: others.length, floor, grade }
  })
  const rank = work => work.ratio ?? -1
  return scored.sort((a, b) => (rank(a) === rank(b) ? String(b.date ?? '').localeCompare(String(a.date ?? '')) : rank(b) > rank(a) ? 1 : -1))
}
