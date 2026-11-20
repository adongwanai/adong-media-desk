// 大屏：粉丝合计、每日净增、各平台卡片、最新发布和按规则算出的数据分析。只读状态，不调模型。
import { ACCOUNT_PLATFORMS } from './ops.js'
import { platformName, tr } from './i18n.js'
import { computeIncome } from './income.js'

const DAYS = 30
const MIN_VIEWS = 100

function dayKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDay(now, offset) {
  const d = new Date(now)
  d.setDate(d.getDate() + offset)
  return dayKey(d)
}

/** 赞评藏转里记了的那几项之和；一项都没记就是 null，不当 0。 */
function engagement(row) {
  const parts = [row.likes, row.comments, row.shares, row.saves, row.recommends].filter(Number.isFinite)
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null
}

/** 只加记了的数：所有记录里都没记就是 null。 */
function sumOf(rows, read) {
  const values = rows.map(read).filter(Number.isFinite)
  return values.length ? values.reduce((a, b) => a + b, 0) : null
}

/** 比例只用分子分母都记了的记录算，播放是 0 的不进分母；一条这样的记录都没有就是 null。 */
function ratioOf(rows, read) {
  const paired = rows.filter(row => row.views > 0 && Number.isFinite(read(row)))
  return paired.length ? sumOf(paired, read) / sumOf(paired, row => row.views) : null
}

function addUp(rows) {
  return {
    views: sumOf(rows, row => row.views),
    engaged: sumOf(rows, engagement),
    saves: sumOf(rows, row => row.saves),
    rate: ratioOf(rows, engagement),
    saveRate: ratioOf(rows, row => row.saves),
  }
}

function sumKnown(values) {
  const known = values.filter(value => value !== null && value !== undefined)
  return known.length ? known.reduce((a, b) => a + b, 0) : null
}

const pct = ratio => `${Math.round(ratio * 100)}%`
const rate = ratio => `${(ratio * 100).toFixed(1)}%`
const signed = n => `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US')}`

/** 每个平台按日期排好的粉丝记录。 */
function seriesByPlatform(logs) {
  const series = new Map()
  for (const row of logs) {
    const list = series.get(row.platform) ?? []
    list.push({ date: row.date, followers: row.followers, ...(row.fetchedAt ? { fetchedAt: row.fetchedAt } : {}), ...(row.source ? { source: row.source } : {}), ...(row.approx ? { approx: true } : {}) })
    series.set(row.platform, list)
  }
  for (const list of series.values()) list.sort((a, b) => a.date.localeCompare(b.date))
  return series
}

/** 某一天当天记下的数字；那天没记就是 null，不拿别的日子的数顶替。 */
function followersOn(list, date) {
  return list.find(row => row.date === date)?.followers ?? null
}

/** 到某一天为止最近的一条记录。 */
function lastRecord(list, date) {
  let found = null
  for (const row of list) {
    if (row.date > date) break
    found = row
  }
  return found
}

/** 这个平台到今天为止最近一天自动读到的账号数据。 */
function snapshotOf(rows, platform, today) {
  return rows.filter(row => row.platform === platform && row.date <= today).reduce((a, b) => (!a || b.date > a.date ? b : a), null)
}

/**
 * 卡片上自动读取的部分：读到的其他项、最新一条、读于何时，以及上一轮没读到时的原因。
 * 读到的数和原因都是哪一天的要分清：过期的快照照样显示，界面写明日期。
 */
function autoPart(platform, account, last, snapshot, autoRead) {
  const run = (autoRead?.results ?? []).find(row => row.platform === platform)
  return {
    url: account?.url ?? null,
    fetchedAt: last?.fetchedAt ?? null,
    stats: snapshot?.stats ?? {},
    statsAt: snapshot?.fetchedAt ?? null,
    latestPost: snapshot?.latest ?? null,
    topPost: snapshot?.top ?? null,
    // 原因按读的那一刻的语言记下；换了语言后，认得的原因再翻一次
    readError: run && !run.ok && run.error ? tr(run.error) : null,
    readAt: run ? autoRead.at ?? null : null,
    // 这一轮从哪读的：backstage 是创作后台（卡片上「读于…」处标明）
    readVia: run?.source ?? null,
    // 主数字是哪来的、是不是约数（后台只给了「1.13万」）
    fetchedVia: last?.fetchedAt ? last.source ?? null : null,
    followersApprox: Boolean(last?.fetchedAt && last.approx),
    statsVia: snapshot?.source ?? null,
    statsApprox: snapshot?.approx ?? [],
    period: snapshot?.period ?? null,
    needLogin: Boolean(run?.needLogin),
    pending: run?.pending ?? null,
  }
}

/**
 * 后台首页只给了最新一条的标题：作品列表里读到了同一条（标题开头对得上）时，补上发布时间和播放、点赞这些数。
 * 首页上的标题可能是正文开头的一大段，列表里的是截短的，所以按谁是谁的开头来认。
 */
function withPostNumbers(post, metrics) {
  if (!post?.title) return post ?? null
  const same = metrics.filter(metric => metric.title && (post.title.startsWith(metric.title) || metric.title.startsWith(post.title)))
  const hit = same.reduce((a, b) => (!a || (b.fetchedAt ?? '') > (a.fetchedAt ?? '') ? b : a), null)
  if (!hit) return post
  const extra = Object.fromEntries(['views', 'likes', 'comments'].filter(key => !Number.isFinite(post[key]) && Number.isFinite(hit[key])).map(key => [key, hit[key]]))
  return { ...post, ...(post.at ? {} : { at: hit.date }), ...extra }
}

function platformCard(platform, list, account, now) {
  const today = shiftDay(now, 0)
  const yesterday = shiftDay(now, -1)
  const last = lastRecord(list, today)
  const current = last ? last.followers : account?.followers ?? null
  // 涨跌只在两头都有记录时才算：最新一条得是今天或昨天记的，对比的那天（或它前一天）也得记过
  const fresh = last && last.date >= yesterday
  const delta = (offset) => {
    const before = followersOn(list, shiftDay(now, offset)) ?? followersOn(list, shiftDay(now, offset - 1))
    return !fresh || before === null ? null : current - before
  }
  const todayCount = followersOn(list, today)
  const yesterdayCount = followersOn(list, yesterday)
  const spark = list.filter(row => row.date >= shiftDay(now, -(DAYS - 1)) && row.date <= today)
  return {
    platform,
    handle: account?.handle || '',
    followers: current,
    today: todayCount === null || yesterdayCount === null ? null : todayCount - yesterdayCount,
    d7: delta(-7),
    d30: delta(-DAYS),
    since: list[0]?.date ?? null,
    loggedAt: last?.date ?? null,
    spark,
  }
}

function dailyNet(series, now) {
  const rows = []
  for (let offset = -(DAYS - 1); offset <= 0; offset += 1) {
    const date = shiftDay(now, offset)
    const before = shiftDay(now, offset - 1)
    const net = {}
    for (const [platform, list] of series) {
      const a = followersOn(list, before)
      const b = followersOn(list, date)
      if (a !== null && b !== null) net[platform] = b - a
    }
    rows.push({ date, net, total: Object.values(net).reduce((a, b) => a + b, 0) })
  }
  return rows
}

function publishTime(item) {
  return item.publishedAt || item.scheduledAt || Object.values(item.publish ?? {}).find(row => row?.state === 'published')?.at || null
}

/** 和界面的 isPublished 同一个口径：状态是已发布，或者任何一个平台记了已发布。 */
function isPublished(item) {
  return item.status === 'published' || Object.values(item.publish ?? {}).some(row => row?.state === 'published')
}

/** 最近一条已发布；一条都没发过时，取最近的一条排期。 */
function pickLatest(items, now) {
  const tops = items.filter(item => !item.parentId)
  const published = tops.filter(item => isPublished(item) && publishTime(item)).sort((a, b) => publishTime(b).localeCompare(publishTime(a)))
  if (published.length) return { item: published[0], previous: published[1] ?? null, scheduled: false }
  const upcoming = tops.filter(item => item.scheduledAt && new Date(item.scheduledAt) >= now).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  return upcoming.length ? { item: upcoming[0], previous: null, scheduled: true } : null
}

function titleOf(item) {
  const production = item.production
  return production?.title && production.status !== 'running' ? production.title : item.title
}

function coverOf(item) {
  const cover = item.production?.status === 'running' ? null : item.production?.cover?.src
  if (cover) return cover
  if (!item.media) return null
  return item.media.poster || (item.kind === 'video' ? null : item.media.src)
}

function latestPublish(picked, metrics) {
  if (!picked) return null
  const { item, previous, scheduled } = picked
  const own = metrics.filter(metric => metric.itemId === item.id)
  const byPlatform = new Map()
  for (const metric of own) byPlatform.set(metric.platform, [...(byPlatform.get(metric.platform) ?? []), metric])
  const platforms = [...byPlatform.entries()]
    .map(([platform, rows]) => ({ platform, ...addUp(rows) }))
    .sort((a, b) => ((b.views ?? -1) - (a.views ?? -1)) || ((b.engaged ?? -1) - (a.engaged ?? -1)))
  const total = addUp(own)
  return {
    id: item.id,
    title: titleOf(item),
    summary: String(item.body ?? '').slice(0, 80),
    cover: coverOf(item),
    platform: item.platform ?? null,
    at: publishTime(item),
    scheduled,
    views: total.views,
    engaged: total.engaged,
    engagementRate: total.rate,
    platforms,
    previous: previous ? { id: previous.id, title: titleOf(previous), views: addUp(metrics.filter(metric => metric.itemId === previous.id)).views } : null,
  }
}

/** 按规则算出的几句话。每条都要求数据够用，不够就不出。 */
function analyze({ cards, daily, stats, items, now }) {
  const out = []
  const name = platformName
  const gains = cards.filter(card => card.d7 > 0).sort((a, b) => b.d7 - a.d7)
  if (gains.length) {
    const sum = gains.reduce((total, card) => total + card.d7, 0)
    const top = gains[0]
    out.push({
      tag: '涨粉',
      text: gains.length > 1
        ? tr('近 7 天涨粉最多的是{platform} {gain}，占各平台合计 {sum} 的 {share}。', { platform: name(top.platform), gain: signed(top.d7), sum: signed(sum), share: pct(top.d7 / sum) })
        : tr('近 7 天{platform}涨粉 {gain}。', { platform: name(top.platform), gain: signed(top.d7) }),
    })
  }

  const since = shiftDay(now, -(DAYS - 1))
  const publishDays = new Set(items.filter(item => isPublished(item) && item.publishedAt).map(item => dayKey(item.publishedAt)).filter(date => date >= since))
  const known = daily.filter(row => Object.keys(row.net).length)
  const onDays = known.filter(row => publishDays.has(row.date))
  const offDays = known.filter(row => !publishDays.has(row.date))
  if (onDays.length && offDays.length >= 7) {
    const avg = rows => rows.reduce((total, row) => total + row.total, 0) / rows.length
    const on = avg(onDays)
    const off = avg(offDays)
    if (off > 0 && Math.abs(on - off) / off >= 0.1) {
      out.push({ tag: '发布日', text: tr(on > off ? '近 30 天发布当天平均净增 {on}，比不发布的日子（{off}）多 {diff}。' : '近 30 天发布当天平均净增 {on}，比不发布的日子（{off}）少 {diff}，发布当天没有带来额外涨粉。', { on: Math.round(on), off: Math.round(off), diff: pct(Math.abs(on - off) / off) }) })
    }
  }

  const viewed = stats.filter(row => row.views >= MIN_VIEWS).sort((a, b) => b.views - a.views)
  const allViews = viewed.reduce((total, row) => total + row.views, 0)
  // 有平台的记录缺播放时，「全部播放」这个分母不完整，占比不出
  if (viewed.length > 1 && stats.every(row => row.viewsComplete)) {
    out.push({ tag: '播放', text: tr('近 30 天 {share} 的播放来自{platform}（{views} / {total}）。', { share: pct(viewed[0].views / allViews), platform: name(viewed[0].platform), views: viewed[0].views.toLocaleString('en-US'), total: allViews.toLocaleString('en-US') }) })
  }
  // 互动率只用同时记了播放和互动的记录算；互动一项都没记的平台不参与比较
  const byRate = viewed.filter(row => row.rate !== null).sort((a, b) => b.rate - a.rate)
  if (byRate.length > 1 && byRate[0].rate > byRate.at(-1).rate) {
    const [high, low] = [byRate[0], byRate.at(-1)]
    const [highRate, lowRate] = [high.rate, low.rate]
    out.push({ tag: '互动', text: tr('互动率最高的是{high} {highRate}，最低的是{low} {lowRate}{times}。', { high: name(high.platform), highRate: rate(highRate), low: name(low.platform), lowRate: rate(lowRate), times: lowRate > 0 && highRate / lowRate >= 1.5 ? tr('，相差 {n} 倍', { n: Math.round(highRate / lowRate) }) : '' }) })
  }
  const savers = viewed.filter(row => row.saveRate > 0).sort((a, b) => b.saveRate - a.saveRate)
  if (savers.length) {
    out.push({ tag: '收藏', text: tr('{platform}每 100 次播放有 {n} 个收藏{tail}。', { platform: name(savers[0].platform), n: (savers[0].saveRate * 100).toFixed(1), tail: savers.length > 1 ? tr('，是各平台里最把内容当干货存的') : '' }) })
  }
  return out
}

/**
 * 面向大屏的汇总。
 * @param {object} state - 当前状态。
 * @param {Date} [now] - 基准时间，按这台电脑的时区切天。
 * @returns {object} 粉丝合计、每日净增、平台卡片、最新发布和数据分析。
 */
// 谷歌学术的被引不是粉丝，不进合计。GitHub 的 Star 按作者的要求算进合计
const NOT_FANS = new Set(['谷歌学术'])

export function computeBoard(state, now = new Date()) {
  // 有了真实数据后，示例不再参与
  const sources = [state.followerLog ?? [], state.metrics ?? [], (state.accounts ?? []).filter(account => ACCOUNT_PLATFORMS.includes(account.platform))]
  const hasReal = sources.some(rows => rows.some(row => !row.sample))
  const [logs, metrics, accounts] = sources.map(rows => (hasReal ? rows.filter(row => !row.sample) : rows))
  // 自己的内容一旦有了，「最新发布」就不再拿示例顶替
  const allItems = state.items ?? []
  const items = hasReal || allItems.some(item => !item.sample) ? allItems.filter(item => !item.sample) : allItems
  const series = seriesByPlatform(logs)
  const recent = metrics.filter(metric => dayKey(metric.date) >= shiftDay(now, -(DAYS - 1)))
  const picked = pickLatest(items, now)
  const latest = latestPublish(picked, metrics)

  const snapshots = state.accountDaily ?? []
  // 自动读取这一轮读过的平台也放出来：创作后台要重新登录的，卡片上才有「去登录」
  const runs = state.autoRead?.results ?? []
  const shown = ACCOUNT_PLATFORMS.filter(platform => series.has(platform) || accounts.some(account => account.platform === platform) || metrics.some(metric => metric.platform === platform) || snapshots.some(row => row.platform === platform) || runs.some(row => row.platform === platform))
  const stats = []
  const cards = shown.map((platform) => {
    const rows = recent.filter(metric => metric.platform === platform)
    const total = addUp(rows)
    stats.push({ platform, ...total, viewsComplete: rows.every(metric => Number.isFinite(metric.views)) })
    const viewsOf = item => (item ? addUp(metrics.filter(metric => metric.itemId === item.id && metric.platform === platform)).views : null)
    const account = accounts.find(row => row.platform === platform)
    const list = series.get(platform) ?? []
    const auto = autoPart(platform, account, lastRecord(list, shiftDay(now, 0)), snapshotOf(snapshots, platform, shiftDay(now, 0)), state.autoRead)
    return {
      ...platformCard(platform, list, account, now),
      ...auto,
      latestPost: withPostNumbers(auto.latestPost, metrics.filter(metric => metric.platform === platform)),
      views30: total.views,
      engagementRate: total.rate,
      latestViews: picked && !picked.scheduled ? viewsOf(picked.item) : null,
      previousViews: viewsOf(picked?.previous),
    }
  })
  const daily = dailyNet(new Map([...series].filter(([platform]) => !NOT_FANS.has(platform))), now)
  // 合计只加记了数的平台；有的平台没数时标成部分合计，界面写「N/M 个平台」，不冒充全部
  const totalKeys = ['followers', 'today', 'd7', 'd30']
  // GitHub 的 Star、谷歌学术的被引不是粉丝：各自的卡片照常显示，但不加进「粉丝合计」和每日净增
  const fanCards = cards.filter(card => !NOT_FANS.has(card.platform))
  const knownOf = key => fanCards.filter(card => card[key] !== null && card[key] !== undefined).length
  return {
    hasSample: !hasReal && sources.some(rows => rows.length > 0),
    updatedAt: logs.reduce((last, row) => (last && last > row.date ? last : row.date), null),
    total: {
      ...Object.fromEntries(totalKeys.map(key => [key, sumKnown(fanCards.map(card => card[key]))])),
      platforms: fanCards.length,
      known: Object.fromEntries(totalKeys.map(key => [key, knownOf(key)])),
      partial: Object.fromEntries(totalKeys.map(key => [key, knownOf(key) > 0 && knownOf(key) < fanCards.length])),
    },
    daily,
    platforms: cards,
    latest,
    analysis: analyze({ cards, daily, stats, items, now }),
    income: computeIncome(state, now),
  }
}
