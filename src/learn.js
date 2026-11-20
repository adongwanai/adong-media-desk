// 自我强化：从真实数据和你对草稿的修改里提炼规则，确认后才生效，并可导出成 DeepSeek Harness Skill。
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activeStyle, styleToVoice } from './style.js'
import { platformName, tr } from './i18n.js'
import { ageLinesByItem, viewWord } from './age-compare.js'
import { collectPieces, diagnosePieces, metricPieceKey } from './diagnose.js'

/** 按这台电脑的时区算日期，北京时间早上发的内容不会算到前一天。 */
function localDay(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const COUNTS = ['views', 'likes', 'comments', 'shares', 'saves']

/** 只加记了的数：一项在所有记录里都没记就是 null，不当 0。 */
function addKnown(total, value) {
  return Number.isFinite(value) ? (total ?? 0) + value : total
}

/** 每篇内容的累计数据。 */
function itemTotals(state) {
  const totals = new Map()
  for (const metric of state.metrics) {
    if (!metric.itemId) continue
    const entry = totals.get(metric.itemId) ?? Object.fromEntries(COUNTS.map(key => [key, null]))
    totals.set(metric.itemId, Object.fromEntries(COUNTS.map(key => [key, addKnown(entry[key], metric[key])])))
  }
  return totals
}

/** 有了真实数据后，示例数据就不再参与统计。 */
function realMetrics(state) {
  const real = state.metrics.filter(metric => !metric.sample)
  return real.length ? real : state.metrics
}

/** 赞评藏转（公众号还有在看）里记了的那几项之和；一项都没记就是 null。 */
function engagement(row) {
  const parts = [row.likes, row.comments, row.shares, row.saves, row.recommends].filter(Number.isFinite)
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null
}

/** 互动率：只用播放大于 0、互动也记了的记录，分子分母对得上；没有这样的记录就是 null。 */
function engagementRate(rows) {
  const paired = rows.filter(row => row.views > 0 && engagement(row) !== null)
  const views = paired.reduce((total, row) => total + row.views, 0)
  return views ? paired.reduce((total, row) => total + engagement(row), 0) / views : null
}

function bestGroup(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!row.key) continue
    const list = groups.get(row.key) ?? []
    list.push(row.value)
    groups.set(row.key, list)
  }
  const ranked = [...groups.entries()]
    .map(([key, values]) => ({ key, n: values.length, avg: values.reduce((a, b) => a + b, 0) / values.length }))
    .sort((a, b) => b.avg - a.avg)
  return ranked
}

/** 对比 AI 原稿和你改完的版本，粗略判断修改方向。 */
function editSignals(state) {
  const signals = []
  for (const item of state.items) {
    const production = item.production
    if (production?.aiArticle && production.article && production.article !== production.aiArticle) {
      const before = production.aiArticle.replace(/\s/g, '').length
      const after = production.article.replace(/\s/g, '').length
      signals.push({ title: item.title, ratio: before ? after / before : 1 })
    }
    for (const format of ['article', 'script']) {
      const draft = item.drafts?.[format]
      if (!draft?.aiText || draft.by !== 'user' || draft.text === draft.aiText) continue
      const before = draft.aiText.replace(/\s/g, '').length
      const after = draft.text.replace(/\s/g, '').length
      signals.push({ title: item.title, ratio: before ? after / before : 1 })
    }
  }
  return signals
}

/**
 * 基于现有数据计算规则提案。只有样本足够才提案，不凑数。
 * @param {object} state - 当前状态。
 * @returns {Array<{name: string, rule: string, evidence: string, confidence: number, source: string}>} 提案。
 */
export function proposeRules(state) {
  const proposals = []
  const totals = itemTotals({ metrics: realMetrics(state) })
  const published = state.items.filter(item => totals.has(item.id))
  const rows = published.map(item => ({ item, views: totals.get(item.id).views }))

  // 有些平台公开接口读不到播放量，这些内容不参与跨平台比较
  const byPlatform = bestGroup(rows.filter(row => row.views > 0).map(row => ({ key: row.item.platform, value: row.views })))
  if (byPlatform.length >= 2 && byPlatform[0].avg > byPlatform[1].avg * 1.3) {
    const best = byPlatform[0]
    const platform = platformName(best.key)
    proposals.push({
      name: tr('首发放在{platform}', { platform }), rule: tr('同一选题优先在{platform}首发，再改写分发到其他平台。', { platform }),
      evidence: tr('{platform}平均 {avg} 阅读，高于第二名{second}的 {secondAvg}', { platform, avg: Math.round(best.avg).toLocaleString('en-US'), second: platformName(byPlatform[1].key), secondAvg: Math.round(byPlatform[1].avg).toLocaleString('en-US') }), confidence: Math.min(0.85, 0.4 + best.n * 0.12), source: tr('数据复盘'),
    })
  }

  const hasViews = rows.some(row => row.views > 0)
  const hours = bestGroup(published.filter(item => item.publishedAt).map(item => ({ key: String(new Date(item.publishedAt).getHours()), value: hasViews ? totals.get(item.id).views : engagement(totals.get(item.id)) })).filter(row => row.value !== null))
  if (hours.length >= 2 && hours[0].n >= 2) {
    proposals.push({
      name: tr('{hour} 点前后发布', { hour: hours[0].key }), rule: tr('默认把内容排在 {hour}:00 前后发布。', { hour: hours[0].key }),
      evidence: tr(hasViews ? '这个时段 {n} 篇平均 {avg} 阅读' : '这个时段 {n} 篇平均 {avg} 互动', { n: hours[0].n, avg: Math.round(hours[0].avg).toLocaleString('en-US') }), confidence: 0.5, source: tr('数据复盘'),
    })
  }

  const edits = editSignals(state)
  if (edits.length >= 2) {
    const avg = edits.reduce((a, b) => a + b.ratio, 0) / edits.length
    if (avg < 0.85) {
      proposals.push({ name: tr('初稿写短一些'), rule: tr('你通常把 AI 初稿删到原来的 {pct}%，以后初稿控制得更紧凑。', { pct: Math.round(avg * 100) }), evidence: tr('来自 {n} 次草稿修改', { n: edits.length }), confidence: Math.min(0.9, 0.5 + edits.length * 0.08), source: tr('草稿修改') })
    } else if (avg > 1.15) {
      proposals.push({ name: tr('初稿多给细节'), rule: tr('你通常把 AI 初稿扩写到原来的 {pct}%，以后初稿多给具体细节和例子。', { pct: Math.round(avg * 100) }), evidence: tr('来自 {n} 次草稿修改', { n: edits.length }), confidence: Math.min(0.9, 0.5 + edits.length * 0.08), source: tr('草稿修改') })
    }
  }

  const known = new Set(state.skills.map(skill => skill.name))
  return proposals.filter(row => !known.has(row.name))
}

// 「views」在这批数据里叫什么（阅读还是播放）：和同龄对比用同一套规则
export { viewWord }

/**
 * 面向复盘页的汇总。
 * @param {object} state - 当前状态。
 * @returns {object} 概览、趋势、平台分布、排行与角度×人物覆盖。
 */
export function computeInsights(state) {
  const metrics = realMetrics(state)
  const onlyReal = metrics.length !== state.metrics.length || !metrics.some(metric => metric.sample)
  const pieces = collectPieces(metrics, state.items)
  // 某天、某平台一项都没记时是 null（界面显示「—」），不当 0
  const daily = new Map()
  for (const metric of metrics) {
    const day = localDay(metric.date)
    const entry = daily.get(day) ?? { date: day, views: null, engaged: null }
    daily.set(day, { ...entry, views: addKnown(entry.views, metric.views), engaged: addKnown(entry.engaged, engagement(metric)) })
  }
  const platforms = new Map()
  for (const metric of metrics) {
    const entry = platforms.get(metric.platform) ?? { platform: metric.platform, views: null, engaged: null, likes: null, comments: null, shares: null, saves: null, rows: [] }
    platforms.set(metric.platform, { ...entry, ...Object.fromEntries(COUNTS.map(key => [key, addKnown(entry[key], metric[key])])), engaged: addKnown(entry.engaged, engagement(metric)), rows: [...entry.rows, metric] })
  }
  const rank = value => value ?? -1
  const top = pieces.map(piece => ({ ...piece, id: piece.itemId,
    ...Object.fromEntries(COUNTS.map(key => [key, piece[key] ?? null])), engaged: engagement(piece) }))
    .sort((a, b) => (rank(b.views) - rank(a.views)) || (rank(b.engaged) - rank(a.engaged)))
  const views = metrics.reduce((total, metric) => addKnown(total, metric.views), null)
  const engaged = metrics.reduce((total, metric) => addKnown(total, engagement(metric)), null)
  const accounts = state.accounts.filter(account => (onlyReal ? !account.sample : true))
  // 「N 条内容带来了 X」：N 就是下面列出来的那几条，X 只加这几条的数；没对上内容的记录另外说
  const loose = metrics.filter(metric => !metricPieceKey(metric, state.items))
  return {
    views, engaged, engagementRate: engagementRate(metrics),
    published: top.length,
    pieceViews: top.reduce((total, row) => addKnown(total, row.views), null),
    pieceEngaged: top.reduce((total, row) => addKnown(total, row.engaged), null),
    unlinked: { count: loose.length, views: loose.reduce((total, metric) => addKnown(total, metric.views), null), engaged: loose.reduce((total, metric) => addKnown(total, engagement(metric)), null) },
    viewWord: viewWord(metrics.filter(metric => Number.isFinite(metric.views)).map(metric => metric.platform)),
    followers: accounts.reduce((total, account) => addKnown(total, account.followers), null), daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)), platforms: [...platforms.values()].map(({ rows, ...entry }) => ({ ...entry, engagementRate: engagementRate(rows) })).sort((a, b) => (rank(b.views) - rank(a.views)) || (rank(b.engaged) - rank(a.engaged))), top,
    hasSample: metrics.some(metric => metric.sample),
    // 单篇诊断：和自己同平台的作品比，样本不够就说不够；再带上和上一篇的同龄对比
    pieces: segmentsAge(diagnosePieces(state), ageLinesByItem(state, tr)),
  }
}

/**
 * 给每一篇诊断挂上和上一篇的同龄对比（只挂算得出来的那些）。
 * 同一篇在几个平台各有一行诊断时，对比句是整篇的合计，只挂在第一行上，免得同一个意思重复几遍。
 */
function segmentsAge(pieces, lines) {
  if (!lines.size) return pieces
  const used = new Set()
  return pieces.map((piece) => {
    if (!piece.itemId || !lines.has(piece.itemId) || used.has(piece.itemId)) return piece
    used.add(piece.itemId)
    return { ...piece, age: lines.get(piece.itemId) }
  })
}

function slug(text, fallback) {
  const ascii = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ascii || fallback
}

/**
 * 把生效中的规则写成一个 DeepSeek Harness 用户级 Skill（<home>/skills/<name>/SKILL.md）。
 * 内容由用户在界面确认后点击导出才写入。
 * @param {object} state - 当前状态。
 * @param {string} home - DSH_HOME。
 * @returns {Promise<{name: string, path: string, rules: number}>} 写入结果。
 */
export async function exportSkill(state, home) {
  // 示例规则不是作者的风格，不能写进真实 Skill
  const rules = state.skills.filter(skill => !skill.sample && (skill.status === 'active' || skill.status === 'exported'))
  const picked = activeStyle(state)
  const style = picked && !picked.preset ? picked : null
  const name = 'media-desk-voice'
  const dir = join(home, 'skills', name)
  if (!rules.length && !style) {
    // 之前导出过的旧 Skill 不再代表现在的设置，撤掉它
    await rm(dir, { recursive: true, force: true })
    throw Object.assign(new Error(tr('还没有你自己的风格或规则。示例规则和模板不会被导出')), { status: 400 })
  }
  await mkdir(dir, { recursive: true })
  const description = tr('作者的自媒体写作风格和规则。写选题、脚本、标题或封面文案时使用。')
  const styleBlock = style ? `## ${tr('风格：{name}', { name: style.name })}\n\n${styleToVoice(style, { platforms: true })}\n\n` : ''
  const ruleBlock = rules.length ? `## ${tr('必须遵守的规则')}\n\n${rules.map(r => `- **${r.name}**${tr('：')}${r.rule}${r.evidence ? tr('（依据：{evidence}）', { evidence: r.evidence }) : ''}`).join('\n')}\n` : ''
  const body = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${tr('自媒体写作风格')}\n\n${tr('由「阿东IP工作台」沉淀，更新于 {date}。', { date: new Date().toISOString().slice(0, 10) })}\n\n${styleBlock}${ruleBlock}`
  await writeFile(join(dir, 'SKILL.md'), body)
  return { name, path: join(dir, 'SKILL.md'), rules: rules.length, slug: slug(name, 'media-desk') }
}
