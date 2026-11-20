import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fetchFeeds } from './feeds.js'
import { fetchBuiltin } from './builtin.js'
import { fetchHot, HOT_SOURCE_IDS, hotSourceInfo } from './hot.js'

const day = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(time))
const unique = rows => {
  const seen = new Set()
  return rows.filter(row => {
    const key = row.url || row.id || row.title
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Persist each source separately: cached results return immediately while stale
 * sources refresh in the background. Failed refreshes retain last good entries. */
export class SourceCache {
  constructor(root, { feeds = fetchFeeds, builtin = fetchBuiltin, hot = fetchHot, now = () => Date.now() } = {}) {
    Object.assign(this, { root, feeds, builtin, hot, now })
    this.rows = {}; this.pending = new Map(); this.writes = Promise.resolve()
    this.loaded = readFile(join(root, 'sources-cache.json'), 'utf8').then(text => { this.rows = JSON.parse(text) }).catch(() => {})
  }
  async persist() {
    const text = JSON.stringify(this.rows)
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.root, { recursive: true })
      const file = join(this.root, 'sources-cache.json')
      await writeFile(file + '.tmp', text, { mode: 0o600 }); await rename(file + '.tmp', file)
    })
    return this.writes
  }
  async get(key, fetcher, { force = false, cachedOnly = false, language = 'zh', merge = true } = {}) {
    await this.loaded
    key = `${language}:${key}`
    const prior = this.rows[key]
    const refresh = () => {
      if (this.pending.has(key)) return this.pending.get(key)
      const work = (async () => {
        try {
          const next = await fetcher()
          const entries = next.error ? (prior?.entries ?? []) : unique([...(next.entries ?? []), ...(merge ? prior?.entries ?? [] : [])]).slice(0, 300)
          this.rows[key] = { ...prior, ...next, error: next.error, entries, checkedAt: this.now(), fetchedAt: next.error ? prior?.fetchedAt ?? next.fetchedAt : next.fetchedAt }
        } catch (error) {
          this.rows[key] = { ...prior, entries: prior?.entries ?? [], error: error.message, checkedAt: this.now() }
        }
        await this.persist()
        return this.rows[key]
      })().finally(() => this.pending.delete(key))
      this.pending.set(key, work)
      return work
    }
    if (force) return refresh()
    if (!prior || day(prior.checkedAt) !== day(this.now())) {
      const work = refresh()
      if (!prior && !cachedOnly) return work
      work.catch(() => {})
    }
    return prior ? { ...prior, refreshing: this.pending.has(key) } : { entries: [], refreshing: true }
  }
  async readFeeds(feeds, options) {
    const rows = await Promise.all(feeds.map(feed => this.get(`feed:${createHash('sha256').update(feed.url).digest('hex')}`, async () => {
      const result = await this.feeds([feed])
      return { entries: result.entries, fetchedAt: result.fetchedAt, error: result.errors[0]?.error }
    }, options)))
    return { entries: rows.flatMap((row, i) => row.entries.map(entry => ({ ...entry, feedId: feeds[i].id, source: feeds[i].title || entry.source }))).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')), errors: rows.flatMap((row, i) => row.error ? [{ url: feeds[i].url, error: row.error }] : []), refreshing: rows.some(row => row.refreshing), fetchedAt: rows.map(row => row.fetchedAt).filter(Boolean).sort().at(-1) }
  }
  async readHot(ids = HOT_SOURCE_IDS, options) {
    const sources = await Promise.all(HOT_SOURCE_IDS.filter(id => ids.includes(id)).map(id => this.get(`hot:${id}`, async () => (await this.hot([id])).sources[0], { ...options, merge: false }).then(row => ({ ...hotSourceInfo(id), ...row, id }))))
    return { sources, refreshing: sources.some(row => row.refreshing) }
  }
  async readBuiltin(ids, options) {
    const groups = await Promise.all(ids.map(async id => {
      // Group fetches already run the individual readers concurrently.
      const row = await this.get(`builtin:${id}`, async () => {
        const group = (await this.builtin([id])).groups[0]
        const prior = this.rows[`${options?.language ?? 'zh'}:builtin:${id}`]
        return { ...group, sources: group.sources.map(source => source.error ? { ...source, entries: prior?.sources?.find(row => row.id === source.id)?.entries ?? [], fetchedAt: prior?.sources?.find(row => row.id === source.id)?.fetchedAt ?? source.fetchedAt } : { ...source, entries: unique([...source.entries, ...(prior?.sources?.find(row => row.id === source.id)?.entries ?? [])]).slice(0, 300) }), entries: [] }
      }, options)
      return { ...row, id, sources: row.sources ?? [] }
    }))
    return { groups, refreshing: groups.some(row => row.refreshing) }
  }
}
