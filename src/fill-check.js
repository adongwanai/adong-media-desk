// 填草稿前后的判断，都是纯函数：标题相似、平台查重、回读比对、流程顺序、截图命名与保留。
// 不碰浏览器、不读文件；Host 侧和单元测试都从这里取规则，平台适配器只负责在浏览器里读页面。

// 平台上已经有同一篇的时间窗口：最近 24 小时
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000
// 标题相似度到多少算同一篇：按两字一组算重叠率，0.8 能认出加了标点、空格、后缀的同一句
export const SIMILAR_TITLE = 0.8
// 每个平台最多留几张「填好时的页面」
export const KEEP_SHOTS = 5

/** 折叠标题：全角转半角、小写、去掉空白和标点，用来比「是不是同一句」。 */
export function foldTitle(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

/**
 * 两个标题的相似度（0–1）：折叠后一样是 1，否则按两字一组的重叠比例算（Dice 系数）。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function titleSimilar(a, b) {
  const left = foldTitle(a)
  const right = foldTitle(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const grams = new Map()
  for (let i = 0; i < left.length - 1; i += 1) {
    const gram = left.slice(i, i + 2)
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }
  let common = 0
  for (let i = 0; i < right.length - 1; i += 1) {
    const gram = right.slice(i, i + 2)
    const count = grams.get(gram) ?? 0
    if (count > 0) { common += 1; grams.set(gram, count - 1) }
  }
  return (2 * common) / (left.length - 1 + right.length - 1)
}

/**
 * 页面上列出的一条作品：标题、能读出来的时间（ISO 或 null）、整段原文（报错时给用户看）。
 * @typedef {{title: string, at?: string|null, text?: string}} SeenItem
 */

/** 时间在不在窗口里；读不到时间的当作在窗口里（宁可多问一句，不当成没重复）。 */
function withinWindow(at, now, windowMs) {
  if (!at) return true
  const time = Date.parse(at)
  if (!Number.isFinite(time)) return true
  return Math.abs(now - time) <= windowMs
}

/**
 * 平台上是不是已经有同一篇：标题一致或高度相似、而且时间在最近 24 小时内。
 * @param {string} title - 要填的标题。
 * @param {SeenItem[]} seen - 页面上读到的作品。
 * @param {{now?: number, windowMs?: number, threshold?: number}} [options]
 * @returns {{duplicate: true, item: SeenItem, score: number}|null} 有重复就是命中的那条和相似度。
 */
export function findDuplicate(title, seen, { now = Date.now(), windowMs = DUPLICATE_WINDOW_MS, threshold = SIMILAR_TITLE } = {}) {
  for (const item of Array.isArray(seen) ? seen : []) {
    const score = titleSimilar(title, item?.title)
    if (score >= threshold && withinWindow(item.at, now, windowMs)) return { duplicate: true, item, score }
  }
  return null
}

/** 正文比较前去掉所有空白。 */
export function squash(text) {
  return String(text ?? '').replace(/\s+/g, '')
}

/**
 * 把一条正文里的话题拆出来：`#标签[话题]`、`#标签`。返回去掉话题后的正文和话题列表。
 * 页面上的真话题带「[话题]」尾巴，纯文字话题没有；两种都认。
 * @param {string} text
 * @returns {{body: string, tags: string[]}}
 */
export function splitTopics(text) {
  const tags = []
  const body = String(text ?? '').replace(/[#＃]([^#＃\n\t]{1,40}?)(?:\[话题\])?(?=[\s#＃]|$)/g, (match, tag) => {
    const name = String(tag).replace(/\[话题\]/g, '').trim()
    if (!name) return match
    if (!tags.includes(name)) tags.push(name)
    return ' '
  })
  return { body: body.replace(/[ \t]{2,}/g, ' ').trim(), tags }
}

const FIELD_LABEL = { title: '标题', body: '正文', tags: '话题数量', images: '图片张数' }

/**
 * 填写后回读核对：标题、正文（去掉空白差异）、话题数量、图片张数逐项比。
 * 标题、正文、话题一定要读得到、对得上；图片张数读不到（null）就不比这一项，用 skipped 记下「没验证」。
 * @param {{title: string, body: string, tags: string[], images?: number}} want - 要填的内容；images 是要传的图片张数。
 * @param {{title?: string|null, bodyText?: string|null, tags?: string[]|null, images?: number|null}} got - 从页面读回来的。
 * @returns {{ok: boolean, problems: Array<{field: 'title'|'body'|'tags'|'images', what: string, want: string|number, got: string|number|null}>, skipped: string[]}}
 */
export function compareReadback(want, got) {
  const problems = []
  const skipped = []
  // 标题：页面上的标题框可能把连续空格压成一个，按空白归一后比
  const wantTitle = String(want?.title ?? '').replace(/\s+/g, ' ').trim()
  const gotTitle = String(got?.title ?? '').replace(/\s+/g, ' ').trim()
  if (wantTitle !== gotTitle) problems.push({ field: 'title', what: FIELD_LABEL.title, want: wantTitle, got: gotTitle })
  // 正文：两边都先剥掉话题再比（稿子正文里可能写了「#标签」的原句；页面上是编辑区文字）
  const wantText = splitTopics(want?.body)
  const readText = splitTopics(got?.bodyText)
  const wantBody = squash(wantText.body)
  const gotBody = squash(readText.body)
  if (wantBody !== gotBody) {
    problems.push({ field: 'body', what: FIELD_LABEL.body, want: Array.from(wantBody).length, got: Array.from(gotBody).length })
  }
  // 话题：稿子里的 + 正文原句里的 + 单独读回来的，去重后比个数的差（页面上只认编辑区里的，单独读的只作补充）
  const wanted = new Set([...(want?.tags ?? []).map(tag => String(tag ?? '').replace(/^[#＃]+/, '').replace(/\[话题\]/g, '').trim()).filter(Boolean), ...wantText.tags])
  const seenTags = new Set([...readText.tags, ...(Array.isArray(got?.tags) ? got.tags : []).map(tag => String(tag ?? '').replace(/^[#＃]+/, '').replace(/\[话题\]/g, '').trim()).filter(Boolean)])
  if (got?.bodyText === null || got?.bodyText === undefined) problems.push({ field: 'tags', what: FIELD_LABEL.tags, want: wanted.size, got: null })
  else if (seenTags.size !== wanted.size) problems.push({ field: 'tags', what: FIELD_LABEL.tags, want: wanted.size, got: seenTags.size })
  // 图片张数：读不到数字就不比，记下没验证；读到了就对
  if (typeof got?.images === 'number' && Number.isFinite(got.images)) {
    if (got.images !== want?.images) problems.push({ field: 'images', what: FIELD_LABEL.images, want: want?.images, got: got.images })
  } else skipped.push('images')
  return { ok: problems.length === 0, problems, skipped }
}

// 填草稿的步骤顺序：查重 → 上传图片 → 填标题 → 填正文 → 回读核对 → 存草稿 → 确认
export const FILL_STEPS = Object.freeze(['check', 'upload', 'title', 'body', 'readback', 'save', 'confirm'])

/**
 * 流程顺序：依次往下走，任何一步失败就停在那一步，不能回头也不能跳步。
 * @returns {{next: (key: string) => string, fail: (err?: object) => string, skip: () => string, state: () => {step: string|null, status: string, error: object|null, done: string[]}}}
 */
export function createFillRun() {
  let index = -1
  let status = 'running'
  let failure = null
  const next = (key) => {
    if (status !== 'running') throw new Error(`fill run is ${status}`)
    const at = FILL_STEPS.indexOf(key)
    if (at < 0) throw new Error(`unknown fill step: ${key}`)
    if (at <= index) throw new Error(`fill step out of order: ${key}`)
    index = at
    return key
  }
  const fail = (err) => {
    if (status === 'running') { status = 'failed'; failure = err ?? { code: 'other', vars: {} } }
    return status
  }
  // 存草稿之前就没有这一步（比如页面上没有暂存按钮），跳过不算失败
  const skip = () => (status === 'running' ? 'skipped' : status)
  const state = () => ({ step: index < 0 ? null : FILL_STEPS[index], status, error: failure, done: index >= 0 ? FILL_STEPS.slice(0, index) : [] })
  return { next, fail, skip, state }
}

/** 截图文件名：fill-<平台英文>-<YYYYMMDD-HHMMSS>.jpg，日期按本地时间。 */
export function shotName(slug, date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `fill-${String(slug ?? '').replace(/[^\w-]/g, '')}-${stamp}.jpg`
}

const SHOT = /^fill-([\w-]+)-(\d{8}-\d{6})\.jpg$/

/**
 * 每个平台最多留最近几张：传进来的文件名列一下，返回要删的那些（超过上限、最旧的）。
 * @param {string[]} names - files 目录里已有的文件名。
 * @param {string} slug - 平台英文名。
 * @param {{keep?: number}} [options]
 * @returns {string[]} 要删掉的文件名。
 */
export function shotsToDrop(names, slug, { keep = KEEP_SHOTS } = {}) {
  const mine = []
  for (const name of Array.isArray(names) ? names : []) {
    const match = SHOT.exec(String(name))
    if (match && match[1] === slug) mine.push({ name, stamp: match[2] })
  }
  mine.sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0))
  return mine.slice(0, Math.max(0, mine.length - keep)).map(row => row.name)
}
