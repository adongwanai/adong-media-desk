// 持久化：$DSH_HOME/ip-workbench/state.json。桌面端和 Web 端读同一份数据。
// 两个 Host 进程可能同时运行，所以每次写入前都按 mtime 判断是否需要重读。
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { applyOps } from './ops.js'
import { buildSeed, migrateState } from './seed.js'
import { DEFAULT_STYLE_ID } from './style-presets.js'

const MAX_UNDO = 30
const packSnap = raw => deflateSync(Buffer.from(raw, 'utf8'), { level: 1 })
const unpackSnap = buf => (Buffer.isBuffer(buf) ? inflateSync(buf).toString('utf8') : String(buf))

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keyed = list => list.every(row => isObject(row) && typeof row.id === 'string')

function revertList(before, after, current) {
  const was = new Map(before.map(row => [row.id, row]))
  const now = new Map(after.map(row => [row.id, row]))
  // 这一步新增的行撤掉，两边都有的行逐字段撤回，其余（之后才加的）原样保留
  const result = current
    .filter(row => !(now.has(row.id) && !was.has(row.id)))
    .map(row => (was.has(row.id) && now.has(row.id) ? revertChange(was.get(row.id), now.get(row.id), row) : row))
  // 这一步删掉的行放回原来的位置
  const present = new Set(result.map(row => row.id))
  before.forEach((row, index) => {
    if (now.has(row.id) || present.has(row.id)) return
    result.splice(Math.min(index, result.length), 0, structuredClone(row))
    present.add(row.id)
  })
  return result
}

/**
 * 三方合并式撤销：只撤回这一步改过、之后又没被别的操作改动的部分。
 * 撤销「切换风格」不会抹掉之后生成的成稿；撤销「对话改标题」不会把之后画好的图退回去。
 * @param {*} before - 这一步之前的值。
 * @param {*} after - 这一步之后的值。
 * @param {*} current - 现在的值。
 * @returns {*} 撤销后的值。
 */
export function revertChange(before, after, current) {
  if (same(before, after)) return current
  if (same(current, after)) return before === undefined ? undefined : structuredClone(before)
  if (isObject(before) && isObject(after) && isObject(current)) {
    const result = { ...current }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = revertChange(before[key], after[key], current[key])
      if (value === undefined) delete result[key]
      else result[key] = value
    }
    return result
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    if (keyed(before) && keyed(after) && keyed(current) && (before.length || after.length)) return revertList(before, after, current)
    if (before.length === after.length && after.length === current.length) return current.map((row, index) => revertChange(before[index], after[index], row))
  }
  // 之后又被改过且无法逐项合并时，保留现在的值
  return current
}

export function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), '.dsh')
}

export class Store {
  /**
   * @param {string} [root] - 数据目录。
   * @param {{samples?: boolean}} [options] - samples 为 false 时，第一次打开不放示例内容，只保留内置的风格预设。
   */
  constructor(root = join(dshHome(), 'ip-workbench'), { samples = true } = {}) {
    this.root = root
    this.samples = samples
    this.file = join(root, 'state.json')
    this.filesDir = join(root, 'files')
    this.state = null
    this.mtimeMs = 0
    this.undo = []
    this.queue = Promise.resolve()
  }

  async refresh() {
    await mkdir(this.filesDir, { recursive: true })
    let info = null
    try {
      info = await stat(this.file)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    if (!info) {
      // 新建的状态也过一遍迁移：默认订阅、内置信息源这些预置是在迁移里补的，不然第一次打开看不到
      this.state = migrateState(buildSeed(new Date()))
      // 新用户默认写文章；老用户没选过的仍按原来的口播脚本，不替他改
      this.state.draftFormat = 'article'
      if (!this.samples) {
        applyOps(this.state, [{ op: 'clear_samples' }])
        // 真实使用时开箱就有一张默认风格，不用先去挑
        this.state.activeStyleId = DEFAULT_STYLE_ID
      }
      await this.persist()
      return
    }
    if (this.state && info.mtimeMs === this.mtimeMs) return
    this.state = migrateState(JSON.parse(await readFile(this.file, 'utf8')))
    this.mtimeMs = info.mtimeMs
  }

  async persist() {
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(this.state))
    await rename(tmp, this.file)
    this.mtimeMs = (await stat(this.file)).mtimeMs
  }

  /** 串行执行，避免同一进程内的并发写互相覆盖。 */
  run(task) {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }

  read() {
    return this.run(async () => {
      await this.refresh()
      return this.state
    })
  }

  /**
   * @param {string} label - 显示在撤销入口上的说明。
   * @param {(state: object) => any} mutate - 就地修改状态。
   * @param {{undoable?: boolean}} [options]
   * @returns {Promise<any>} mutate 的返回值。
   */
  mutate(label, mutate, { undoable = true } = {}) {
    return this.run(async () => {
      await this.refresh()
      const before = undoable ? JSON.stringify(this.state) : null
      const result = await mutate(this.state)
      if (undoable) {
        const after = JSON.stringify(this.state)
        // 什么都没改的操作不占撤销位，免得用户点撤销却没反应；压缩存放避免大状态撑爆内存
        if (after !== before) {
          this.undo.push({ label, before: packSnap(before), after: packSnap(after) })
          if (this.undo.length > MAX_UNDO) this.undo.shift()
        }
      }
      await this.persist()
      return result
    })
  }

  /**
   * 文件已经从磁盘删掉之后，把撤销记录里还指着它的内容一并改掉，免得撤销别的操作时把找不到文件的记录带回来。
   * @param {(state: object) => object} scrub - 接收一份历史状态，返回改好的状态。
   */
  scrubUndo(scrub) {
    return this.run(async () => {
      this.undo = this.undo.map(entry => ({
        ...entry,
        before: packSnap(JSON.stringify(scrub(JSON.parse(unpackSnap(entry.before))))),
        after: packSnap(JSON.stringify(scrub(JSON.parse(unpackSnap(entry.after))))),
      }))
    })
  }

  undoLast() {
    return this.run(async () => {
      const entry = this.undo.pop()
      if (!entry) return null
      await this.refresh()
      this.state = revertChange(JSON.parse(unpackSnap(entry.before)), JSON.parse(unpackSnap(entry.after)), this.state)
      await this.persist()
      return entry.label
    })
  }
}
