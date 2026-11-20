// 信息源：订阅公开的 RSS / Atom 地址，把最新条目拉回来，挑中的记成灵感。只读公开内容，不登录。
import { readPage } from './harvest.js'
import { safeFetch } from './net.js'
import { cleanSummary } from './hot.js'

const PER_FEED = 20
const MAX_TOTAL = 120
const MAX_SUMMARY = 200

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function entities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => NAMED[name.toLowerCase()])
}

/** 订阅源里的正文常是转义过的 HTML：先还原一层，去掉标签，再还原正文自己的转义。只留纯文字。 */
function decode(text) {
  return entities(entities(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function field(block, tags) {
  for (const tag of tags) {
    const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
    if (match?.[1]?.trim()) return decode(match[1])
  }
  return ''
}

function linkOf(block, base) {
  // Atom 把地址放在 href 里，优先取 rel="alternate" 或没写 rel 的那条
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map(match => match[1])
  const href = (links.find(attrs => /rel=["']alternate["']/i.test(attrs)) ?? links.find(attrs => /href=/i.test(attrs) && !/rel=/i.test(attrs)))?.match(/href=["']([^"']+)["']/i)?.[1]
  const raw = href ?? field(block, ['link', 'guid'])
  if (!raw) return null
  try {
    const url = new URL(decode(raw), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function dateOf(block) {
  const time = new Date(field(block, ['pubDate', 'published', 'updated', 'dc:date'])).getTime()
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * 解析一份 RSS 或 Atom。
 * @param {string} xml - 订阅源的原文。
 * @param {string} [base] - 相对链接的基准地址。
 * @returns {{title: string, entries: Array<{title: string, url: string, date: string|null, summary: string}>}} 源的名字和条目。
 */
export function parseFeed(xml, base) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? []
  const head = blocks.length ? xml.slice(0, xml.indexOf(blocks[0])) : xml
  const entries = []
  for (const block of blocks.slice(0, PER_FEED)) {
    const title = field(block, ['title'])
    const url = linkOf(block, base)
    if (!title || !url) continue
    const summary = cleanSummary(field(block, ['description', 'summary', 'content:encoded', 'content']))
    entries.push({ title: title.slice(0, 200), url, date: dateOf(block), summary: summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}…` : summary })
  }
  return { title: field(head, ['title']).slice(0, 80), entries }
}

/**
 * 拉取所有订阅源。单个源失败不影响其余，失败原因原样带回。
 * @param {Array<{id: string, url: string, title?: string}>} feeds - 订阅源。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{entries: Array<object>, errors: Array<{url: string, error: string}>, fetchedAt: string}>} 按时间倒序的条目。
 */
export async function fetchFeeds(feeds, fetchImpl = safeFetch) {
  const errors = []
  const lists = await Promise.all(feeds.map(async (feed) => {
    try {
      const { html, url } = await readPage(feed.url, fetchImpl)
      const parsed = parseFeed(html, url.toString())
      if (!parsed.entries.length) throw new Error('没有读到条目，这个地址可能不是 RSS / Atom')
      const source = feed.title || parsed.title || url.hostname
      return parsed.entries.map(entry => ({ ...entry, feedId: feed.id, source }))
    } catch (err) {
      errors.push({ url: feed.url, error: err.message || String(err) })
      return []
    }
  }))
  const entries = lists.flat().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, MAX_TOTAL)
  return { entries, errors, fetchedAt: new Date().toISOString() }
}
