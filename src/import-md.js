// 导入文件夹：把用户自己写在 Markdown 里的稿子（Obsidian 风格，带 YAML 头）读进工作台。
// 只读不写；文件里写了什么就导入什么，没写的数据一概不补。同一篇的几个文件（公众号稿、小红书正文和图片版）合成一篇，规则见 import-group.js。
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { choicesOf, fileTitleOf, groupFiles, kindOf, looksLikeLabel, MATCH_SCORE, stemOf, stripDate, titleScore, variantOf } from './import-group.js'
import { newId, PLATFORMS } from './ops.js'
import { tr } from './i18n.js'

export const MAX_FILES = 500
export const MAX_FILE_BYTES = 1_000_000
export const MIN_BODY_CHARS = 200
const EXCERPT = 400
const MAX_FOLDERS = 6
// 「这个文件夹里的稿子发过了吗？」：都发过了 / 按文件里的标记来 / 都还没发
export const PUBLISH_MODES = ['all', 'file', 'none']
const MAX_ARTICLE = 200000

// 状态和阶段在实际文件里的各种写法
const STATUS_WORDS = {
  idea: ['idea', '想法', '选题', '灵感', '待深化'],
  outline: ['outline', '大纲'],
  draft: ['writing', '写作中', 'draft', '草稿', 'review', '审核', '审稿', '待变形'],
  ready: ['ready', '待发布'],
  published: ['published', '已发布', '待复盘'],
}
const STATUS_OF = new Map(Object.entries(STATUS_WORDS).flatMap(([status, words]) => words.map(word => [word, status])))

// 文件夹名就是平台名时才拿来当平台
const PLATFORM_ALIASES = { 微信公众号: '公众号', 今日头条: '头条', b站: 'B站', bilibili: 'B站', 哔哩哔哩: 'B站', twitter: 'X', 推特: 'X', tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' }

const INDEX_NAMES = new Set(['readme', 'index', '_index', 'toc', 'moc', '索引', '目录'])

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * 检查用户贴进来的文件夹路径：必须是绝对路径、真实存在的文件夹，并且在用户主目录下（按真实路径算，链接绕不出去）。
 * @param {string} value - 用户贴的路径，允许两边带引号（Windows「复制为路径」会带）和 ~/ 开头。
 * @param {{home?: string}} [options] - 测试时可以换掉主目录。
 * @returns {Promise<string>} 文件夹的真实路径。
 */
export async function resolveImportDir(value, { home = homedir() } = {}) {
  let dir = String(value ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim()
  if (!dir) throw fail(tr('先贴上文件夹路径'))
  if (dir === '~' || dir.startsWith('~/')) dir = join(home, dir.slice(1))
  if (!isAbsolute(dir)) throw fail(tr('要贴完整路径，从根目录开始，比如 /Users/你的名字/Documents/稿子'))
  let real
  try {
    real = await realpath(dir)
  } catch {
    throw fail(tr('找不到这个文件夹：{dir}', { dir }))
  }
  const realHome = await realpath(home).catch(() => home)
  if (!inside(realHome, real)) throw fail(tr('只能导入你自己主目录下的文件夹'), 403)
  if (real === realHome) throw fail(tr('不能把整个主目录导进来，选里面放稿子的那个文件夹'), 403)
  const info = await stat(real)
  if (!info.isDirectory()) throw fail(tr('这不是文件夹：{dir}', { dir }))
  return real
}

function unquote(text) {
  const value = text.trim()
  if (value.length >= 2 && value[0] === '"' && value.at(-1) === '"') return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  if (value.length >= 2 && value[0] === "'" && value.at(-1) === "'") return value.slice(1, -1).replace(/''/g, "'")
  return value
}

function inlineList(text) {
  return text.slice(1, -1).split(',').map(unquote).filter(Boolean)
}

/**
 * 只认最常见的几种写法：标量、带引号的字符串、[a, b] 和「- 项」列表。别的（嵌套、多行文本）一律跳过。
 * @param {string} text - 已经去掉 BOM、换行统一成 \n 的全文。
 * @returns {{data: object, body: string, hasFront: boolean}} 头里的字段（键名小写）和剩下的正文。
 */
export function parseFrontMatter(text) {
  const lines = text.split('\n')
  if (lines[0].trim() !== '---') return { data: {}, body: text, hasFront: false }
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...'))
  if (end < 0) return { data: {}, body: text, hasFront: false }
  const entries = []
  let listKey = null
  for (const line of lines.slice(1, end)) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && listKey) {
      entries.at(-1)[1].push(unquote(item[1]))
      continue
    }
    const pair = /^([A-Za-z0-9_一-鿿][\w一-鿿.-]*)\s*:(?:\s+(.*))?$/.exec(line)
    listKey = null
    if (!pair) continue
    const key = pair[1].toLowerCase()
    const raw = (pair[2] ?? '').trim()
    if (!raw) {
      // 值是空的：下面可能跟着「- 项」列表，没有的话就是没填
      listKey = key
      entries.push([key, []])
    } else if (raw.startsWith('[') && raw.endsWith(']')) entries.push([key, inlineList(raw)])
    else if (raw === '|' || raw === '>' || raw.startsWith('{')) continue
    else entries.push([key, unquote(raw)])
  }
  // 空值又没跟列表的字段当作没写
  const data = Object.fromEntries(entries.filter(([, value]) => !(Array.isArray(value) && !value.length)).map(([key, value]) => [key, value]))
  return { data, body: lines.slice(end + 1).join('\n'), hasFront: true }
}

function first(value) {
  return Array.isArray(value) ? value[0] : value
}

function asText(value) {
  const one = first(value)
  return typeof one === 'string' ? one.trim() : ''
}

/** 状态或阶段的原文对应到工作台的五个状态；认不出就是 null。 */
export function statusOf(value) {
  const word = asText(value).toLowerCase()
  return STATUS_OF.get(word) ?? null
}

/** 先看 status，再看 stage，都认不出算草稿。status 写 draft、stage 写待发布是「平台稿已备好」，算待发布。 */
export function resolveStatus(data) {
  const fromStatus = statusOf(data.status)
  const fromStage = statusOf(data.stage)
  const raw = asText(data.status).toLowerCase()
  if (fromStatus === 'draft' && ['draft', '草稿'].includes(raw) && fromStage === 'ready') return { status: 'ready', from: `status: ${asText(data.status)} + stage: ${asText(data.stage)}` }
  if (fromStatus) return { status: fromStatus, from: `status: ${asText(data.status)}` }
  if (fromStage) return { status: fromStage, from: `stage: ${asText(data.stage)}` }
  return { status: 'draft', from: null }
}

/** 只认能确定是哪一天的写法：2026-05-27、2026/5/27、带时间的 ISO。别的不猜。 */
export function parseDate(value) {
  const text = asText(value)
  const day = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (day) {
    const [y, m, d, h = 0, min = 0, s = 0] = day.slice(1).map(v => Number(v ?? 0))
    const date = new Date(y, m - 1, d, h, min, s)
    // 2 月 31 日这种日期 Date 会悄悄进位，对不上就不要
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
    return date.toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) && !Number.isNaN(Date.parse(text))) return new Date(text).toISOString()
  return null
}

function platformName(value) {
  const text = asText(value)
  if (!text) return null
  if (PLATFORMS.includes(text)) return text
  return PLATFORM_ALIASES[text.toLowerCase()] ?? PLATFORM_ALIASES[text] ?? PLATFORMS.find(p => p.toLowerCase() === text.toLowerCase()) ?? null
}

function resolvePlatform(data, folders) {
  const own = platformName(data.platform)
  if (own) return { platform: own, from: 'platform' }
  const listed = (Array.isArray(data.platforms) ? data.platforms : [data.platforms]).map(platformName).filter(Boolean)
  if (new Set(listed).size === 1) return { platform: listed[0], from: 'platforms' }
  for (const folder of folders) {
    const byFolder = platformName(folder)
    if (byFolder) return { platform: byFolder, from: 'folder' }
  }
  return { platform: null, from: null }
}

function cleanHeading(text) {
  return text.replace(/\*\*|__/g, '').replace(/\s+#+\s*$/, '').replace(/\s+/g, ' ').trim()
}

export { fileTitleOf, looksLikeLabel, variantOf } from './import-group.js'

const NAME_DATE = /^(\d{4})([-_.]?)(\d{2})\2(\d{2})(?!\d)/

/** 文件名开头的日期：2026-11-12_…、2026-11-12-…、20261112…；不是真实日子的不认。 */
export function nameDate(fileBase) {
  const match = NAME_DATE.exec(fileBase)
  return match ? parseDate(`${match[1]}-${match[3]}-${match[4]}`) : null
}

/**
 * 标题：头里的 title，其次是开头那行标题，其次是正文里第一个一级标题，最后用文件名。
 * 开头那行像小节名（「一句话定位」「⭕️项目背景」），或者不是一级标题、又和文件名说的不是一件事，而文件名里有像样的标题时，用文件名。
 * 用作标题的开头那行不再留在正文里；没用上的留着。
 */
function splitTitle(data, body, fileBase) {
  const lines = body.split('\n')
  // 开头的封面图不算正文第一行
  const at = lines.findIndex(line => line.trim() && !/^!\[\[[^\]]*\]\]$|^!\[[^\]]*\]\([^)]*\)$/.test(line.trim()))
  const lead = at >= 0 ? /^(#{1,3})\s+(.+)$/.exec(lines[at].trim()) : null
  const drop = () => lines.filter((_, i) => i !== at).join('\n').replace(/^\s*\n/, '')
  const fileTitle = fileTitleOf(fileBase)
  const leadText = lead ? cleanHeading(lead[2]) : ''
  const h1 = lines.map(line => /^#\s+(.+)$/.exec(line.trim())).find(Boolean)
  const heading = leadText || (h1 ? cleanHeading(h1[1]) : '') || null
  const own = asText(data.title)
  if (own) return { title: own, from: 'title', heading, fileTitle, body: lead?.[1] === '#' ? drop() : body }
  if (leadText) {
    // 二级标题和文件名说的是同一件事时，用带标点的这行；对不上或者像小节名，用文件名
    const label = looksLikeLabel(leadText) || (lead[1].length > 1 && titleScore(leadText, fileTitle) < MATCH_SCORE)
    if (label && fileTitle) return { title: fileTitle, from: 'file', heading, fileTitle, body }
    return { title: leadText, from: 'heading', heading, fileTitle, body: drop() }
  }
  if (heading) return { title: heading, from: 'heading', heading, fileTitle, body }
  // 文件名开头的日期只是排序用的，不放进标题
  return { title: fileTitle ?? (stripDate(fileBase) || fileBase), from: 'file', heading, fileTitle, body }
}

function tagsOf(data) {
  const raw = data.tags ?? data.tag
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,，\s]+/) : []
  return [...new Set(list.map(tag => String(tag).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 24)
}

function skipReason(name, data, body) {
  const lower = name.toLowerCase()
  if (data['excalidraw-plugin'] !== undefined || /\.(excalidraw|flowchart)\.md$/i.test(name)) return tr('Excalidraw 画板，不是稿子')
  if (INDEX_NAMES.has(lower.replace(/\.md$/, '')) || /^readme[._-]/i.test(name)) return tr('索引或说明文件')
  if (body.trim().length < MIN_BODY_CHARS) return tr('正文不到 {n} 字', { n: MIN_BODY_CHARS })
  return null
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i
const EMBED_DIRS = ['imgs', 'assets', 'attachments']

/** 导入文件夹里的图片在工作台里的地址：把绝对路径编进文件名里，由 Host 核对后再读。 */
export function importedImageSrc(file) {
  const ext = IMAGE_EXT.exec(file)?.[0].toLowerCase()
  return ext ? `media-desk/imported/${Buffer.from(file).toString('base64url')}${ext}` : null
}

/** 把地址还原成文件路径；格式不对返回 null。 */
export function importedImagePath(name) {
  const match = /^([\w-]+)\.(png|jpe?g|gif|webp)$/i.exec(name)
  if (!match) return null
  const file = Buffer.from(match[1], 'base64url').toString('utf8')
  return isAbsolute(file) && IMAGE_EXT.test(file) && !file.includes('\0') ? file : null
}

/** Obsidian 的 ![[图.png]]：在稿子旁边，或导入文件夹（没给就是稿子所在文件夹）的 imgs/、assets/、attachments/ 里找；必须是文件夹里面真实存在的图片。 */
function findEmbed(name, filePath, root) {
  if (!IMAGE_EXT.test(name) || name.includes('\0')) return null
  const here = dirname(filePath)
  const top = root ?? here
  const bases = [...new Set([here, top, ...EMBED_DIRS.map(sub => join(top, sub)), ...EMBED_DIRS.map(sub => join(here, sub))])]
  for (const base of bases) {
    const file = resolve(base, name)
    if (inside(top, file) && file !== top && statSync(file, { throwIfNoEntry: false })?.isFile()) return file
  }
  return null
}

/**
 * 稿子里的本地图片换成工作台能读的地址，这样预览、排版和卡片里都看得到：
 * 相对路径的 ![说明](imgs/a.png)，和 Obsidian 的 ![[a.png]]（找得到文件才换）。网络图片、已经是工作台地址的、不是图片的都不动。
 */
export function linkLocalImages(body, filePath, root) {
  const linked = body.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (all, alt, target) => {
    if (/^(https?:|data:|media-desk\/|\/)/i.test(target)) return all
    let relative
    try {
      relative = decodeURIComponent(target)
    } catch {
      return all
    }
    const src = importedImageSrc(resolve(dirname(filePath), relative))
    return src ? `![${alt}](${src})` : all
  })
  return linked.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (all, target, alias) => {
    const file = findEmbed(target.trim(), filePath, root)
    const src = file ? importedImageSrc(file) : null
    const alt = alias && !/^\d+(x\d+)?$/.test(alias.trim()) ? alias.trim() : ''
    return src ? `![${alt}](${src})` : all
  })
}

/** 一条内容里存着的、可能引用导入图片的文字：成稿和各平台版本。 */
function textsOf(item) {
  const versions = Object.values(item.production?.versions ?? {})
  return [item.production?.article, item.body, ...versions.flatMap(version => [version?.body, version?.cards])].map(text => String(text ?? ''))
}

/**
 * 核对一张导入图片能不能读：真实路径必须落在某个已导入的文件夹里面，不跟着链接跑出去。
 * @returns {Promise<string|null>} 可以读的真实路径。
 */
export async function allowedImportedImage(state, name) {
  const file = importedImagePath(name)
  if (!file) return null
  const real = await realpath(file).catch(() => null)
  if (!real || !IMAGE_EXT.test(real)) return null
  let inside = false
  for (const row of state.importDirs ?? []) {
    const root = await realpath(row.dir).catch(() => null)
    if (root && real.startsWith(root + sep)) inside = true
  }
  if (!inside) return null
  // 只给导入的稿子里真正引用过的图片：文件夹里别的图片（哪怕在范围内）不读也不上传
  const src = `media-desk/imported/${name}`
  return (state.items ?? []).some(item => item.imported && textsOf(item).some(text => text.includes(src))) ? real : null
}

/** 去掉 Markdown 记号后的开头一段，给卡片和列表看；导入的内容只在 item.body 里存这一段，全文在成稿里。 */
export function excerptOf(markdown, max = EXCERPT) {
  const plain = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|==|~~|`/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

/**
 * 这篇内容里用户自己写的全文：导入的稿子是成稿全文（item.body 只存了开头一段），别的就是 item.body。
 * 给「素材判断（How-I）」这类要读用户原话的地方用。
 */
export function userText(item) {
  if (item?.imported && item.importPath) return String(item.production?.article || item.body || '')
  return String(item?.body ?? '')
}

function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 把一个 Markdown 文件的全文映射成一条待导入的内容。
 * @param {string} raw - 文件原文。
 * @param {{path: string, name: string, folders: string[], mtimeMs: number, root?: string}} file - 路径、文件名、所在文件夹名（由近到远）、修改时间和导入的文件夹。
 * @returns {{skip: string}|object} 跳过时给原因，否则是导入用的字段。
 */
export function mapMarkdown(raw, { path, name, folders, mtimeMs, root }) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const { data, body: rest } = parseFrontMatter(text)
  const reason = skipReason(name, data, rest)
  if (reason) return { skip: reason }
  const fileBase = name.replace(/\.md$/i, '')
  const split = splitTitle(data, rest, fileBase)
  const variant = variantOf(fileBase)
  const kind = kindOf(variant)
  const baseTitle = split.title.replace(/[（(]图片版[）)]\s*$/, '').trim().slice(0, 200) || split.title.slice(0, 200)
  const title = variant && !baseTitle.includes(variant) ? `${baseTitle}（${variant}）` : baseTitle
  const { status, from: statusFrom } = resolveStatus(data)
  const { platform, from: platformFrom } = resolvePlatform(data, folders)
  const front = parseDate(data.created) ?? parseDate(data.date)
  const byName = nameDate(fileBase)
  const created = front ?? byName ?? new Date(mtimeMs).toISOString()
  const frontPublished = parseDate(data.publishedat) ?? parseDate(data.publish_date) ?? parseDate(data.published) ?? parseDate(data.date)
  const explicit = byName ?? front
  return {
    path, name, root: root ?? dirname(path), title, baseTitle, titleFrom: split.from, heading: split.heading, fileTitle: split.fileTitle, ownTitle: asText(data.title) || null,
    variant, kind, dupFamily: kind === 'alt' ? variant.replace(/[_-]v\d+$/i, '') : kind, stemKey: stemOf(fileBase).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''),
    body: linkLocalImages(split.body.trim(), path, root), ...(kind === 'cards' ? { cards: linkLocalImages(rest.trim(), path, root) } : {}),
    tags: tagsOf(data), status, statusFrom, platform, platformFrom,
    createdAt: created, dateFrom: front ? 'front' : byName ? 'name' : 'mtime', createdDay: dayKey(created), day: explicit ? dayKey(explicit) : null,
    publishedAt: status === 'published' ? frontPublished : null,
    publishAll: frontPublished ? { at: frontPublished, from: 'front' } : byName ? { at: byName, from: 'name' } : { at: new Date(mtimeMs).toISOString(), from: 'mtime' },
    mtimeMs,
  }
}

/** 列出文件夹里的 Markdown 文件：跳过隐藏文件，链接只在指回这个文件夹里面时才跟。素材库也用它。 */
export async function listMarkdown(root, depth) {
  const found = []
  const skipped = []
  const walk = async (dir, level, folders) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      skipped.push({ path: dir, name: basename(dir), reason: tr('读不出这个文件夹') })
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      const isMd = /\.md$/i.test(entry.name)
      if (!isMd && !(entry.isDirectory() || entry.isSymbolicLink())) continue
      // 链接只在指回这个文件夹里面时才跟
      let real = full
      if (entry.isSymbolicLink()) {
        real = await realpath(full).catch(() => null)
        if (!real || !inside(root, real)) {
          if (isMd) skipped.push({ path: full, name: entry.name, reason: tr('链接指向文件夹外面') })
          continue
        }
      }
      const info = await stat(real).catch(() => null)
      if (!info) continue
      if (info.isDirectory()) {
        if (level < depth && !isMd) await walk(real, level + 1, [entry.name, ...folders])
        continue
      }
      if (isMd && info.isFile()) found.push({ path: full, real, name: entry.name, folders, size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  await walk(root, 0, [basename(root)])
  return { found, skipped }
}

/**
 * 读一个文件夹里的 Markdown 稿子。默认只看这一层，depth 为 1 时再看下一层子文件夹。
 * @param {string} dir - 用户贴的路径。
 * @param {{max?: number, depth?: number, home?: string}} [options]
 * @returns {Promise<{dir: string, name: string, files: object[], skipped: object[]}>}
 */
export async function scanFolder(dir, { max = MAX_FILES, depth = 0, home } = {}) {
  const root = await resolveImportDir(dir, { home })
  const { found, skipped } = await listMarkdown(root, depth === 1 ? 1 : 0)
  const files = []
  for (const [index, file] of found.entries()) {
    const row = { path: file.path, name: file.name }
    if (index >= max) { skipped.push({ ...row, reason: tr('超过一次 {n} 个文件的上限', { n: max }) }); continue }
    if (file.size > MAX_FILE_BYTES) { skipped.push({ ...row, reason: tr('文件超过 1 MB') }); continue }
    let raw
    try {
      raw = await readFile(file.real, 'utf8')
    } catch {
      skipped.push({ ...row, reason: tr('读不出这个文件') })
      continue
    }
    const mapped = mapMarkdown(raw, { path: file.path, name: file.name, folders: file.folders, mtimeMs: file.mtimeMs, root })
    if (mapped.skip) skipped.push({ ...row, reason: mapped.skip })
    else files.push(mapped)
  }
  return { dir: root, name: basename(root), files, skipped }
}

/**
 * 一次读几个文件夹（比如公众号和小红书一起），合篇时互相参照。同一个文件夹贴两次只读一次。
 * @param {{folders?: Array<{dir: string, depth?: number, published?: string}>, dir?: string, depth?: number, published?: string}} body - 请求体；只有 dir 时就是一个文件夹。
 * @returns {Promise<object[]>} 每个文件夹的 scanFolder 结果，带上 depth 和「发过了吗」的回答（没答是 null）。
 */
export async function scanFolders(body, options = {}) {
  const list = Array.isArray(body?.folders) ? body.folders : [{ dir: body?.dir, depth: body?.depth, published: body?.published }]
  if (!list.length) throw fail(tr('先贴上文件夹路径'))
  if (list.length > MAX_FOLDERS) throw fail(tr('一次最多导入 {n} 个文件夹', { n: MAX_FOLDERS }))
  const scans = []
  for (const row of list) {
    const depth = row?.depth === 1 ? 1 : 0
    const scan = await scanFolder(row?.dir, { ...options, depth })
    if (scans.some(other => other.dir === scan.dir)) continue
    const seen = new Set(scans.flatMap(other => other.files.map(file => file.path)))
    scans.push({ ...scan, files: scan.files.filter(file => !seen.has(file.path)), depth, published: PUBLISH_MODES.includes(row?.published) ? row.published : null })
  }
  return scans
}

const XHS = '小红书'
const WECHAT = '公众号'
const XHS_ROLES = new Set(['xhs-body', 'xhs-cards'])

/** 导入时记下的指纹：标题、正文、状态、标签、平台、成稿和导入的小红书版本任何一处在工作台里被改过，都算用户改过。 */
export function contentHash(item) {
  const fields = [item.title, item.body, item.status, item.tags ?? [], item.platform ?? null, item.production?.title ?? null, item.production?.article ?? null]
  // 按组导入的内容（有 importParts）还要看小红书版本；以前导入的没有这个字段，指纹照旧
  if (item.importParts) {
    const xhs = item.production?.versions?.[XHS]
    fields.push(xhs ? [xhs.title ?? '', xhs.body ?? '', xhs.cards ?? null, xhs.tags ?? []] : null)
  }
  return createHash('sha1').update(JSON.stringify(fields)).digest('hex')
}

export function isEdited(item) {
  return Boolean(item.importHash) && contentHash(item) !== item.importHash
}

const isFileItem = row => Boolean(row?.imported && row.importPath)

/** 一条导入内容由哪些文件组成；以前导入的只有一个文件。 */
function partsOf(item) {
  return item.importParts ?? [{ path: item.importPath, root: item.importDir, role: 'article', mtime: item.importMtime }]
}

const sigOf = part => [part.path, part.mtime, part.role, part.mode ?? null].join('\n')
const mainOf = unit => unit.mother ?? unit.body ?? unit.cards
const filesOf = unit => [unit.mother, unit.body, unit.cards].filter(Boolean)

function unitParts(unit, mode) {
  const roles = [['article', unit.mother], ['xhs-body', unit.body], ['xhs-cards', unit.cards]]
  return roles.filter(([, file]) => file).map(([role, file]) => ({ path: file.path, root: file.root, role, mtime: file.mtimeMs, mode: mode(file.root) }))
}

/** 按「发过了吗」的回答算这个文件的状态和发布时间：都发过了 / 按文件里的标记（默认）/ 都还没发。 */
function publishOf(file, mode) {
  if (mode === 'all') return { status: 'published', at: file.publishAll.at, from: file.publishAll.from }
  if (mode === 'none') return { status: file.status === 'published' ? 'ready' : file.status, at: null, from: null }
  return { status: file.status, at: file.publishedAt, from: file.publishedAt ? 'front' : null }
}

const publishRecord = (pub, platform) => (pub.status === 'published' && pub.at && platform ? { state: 'published', at: pub.at, url: null, from: 'import' } : null)

/** 这一篇导入后的内容：主文件给标题、成稿、状态；挂着小红书文件的，小红书的正文和图片版放进小红书版本。 */
function contentOf(unit, ctx, attach) {
  const main = mainOf(unit)
  const paired = !unit.mother && Boolean(unit.body && unit.cards)
  const pub = publishOf(main, ctx.mode(main.root))
  const publish = {}
  const own = publishRecord(pub, main.platform)
  if (own) publish[main.platform] = own
  const xhs = unit.body ?? unit.cards
  const withVersion = Boolean(xhs && (unit.mother || paired || attach))
  const version = withVersion
    ? { title: xhs.baseTitle, body: unit.body?.body ?? '', ...(unit.cards ? { cards: unit.cards.cards ?? unit.cards.body } : {}), tags: xhs.tags, status: 'done', at: ctx.now, edited: true, imported: true }
    : null
  const xhsPub = withVersion && (unit.mother || attach) ? publishOf(xhs, ctx.mode(xhs.root)) : null
  const xhsRecord = xhsPub ? publishRecord(xhsPub, XHS) : null
  if (xhsRecord) publish[XHS] = xhsRecord
  // 公众号那篇没发、小红书发过了：这一篇也算发过，发布时间用小红书的
  const bump = xhsPub?.status === 'published' && pub.status !== 'published'
  return {
    main, title: paired ? main.baseTitle : main.title, article: main.body, version, publish,
    status: bump ? 'published' : pub.status, publishedAt: bump ? xhsPub.at : pub.at, publishedFrom: bump ? xhsPub.from : pub.from,
  }
}

/** 这一篇对应的工作台内容：主文件那条（或要挂上去的那条），以及以前分开导入、这次合进来的几条。 */
function existingOf(state, unit, ctx) {
  const paths = filesOf(unit).map(file => file.path)
  const items = state.items.filter(isFileItem)
  const own = items.filter(row => paths.includes(row.importPath))
  let primary = unit.targetId ? items.find(row => row.id === unit.targetId) ?? null : null
  if (!primary) primary = own.find(row => row.importPath === mainOf(unit).path) ?? own[0] ?? null
  if (!primary && !unit.mother) {
    // 小红书文件以前挂在别的文件夹的公众号稿子下面、那个文件夹这次没读：照旧挂着
    primary = items.find(row => !ctx.roots.has(row.importDir) && partsOf(row).some(part => XHS_ROLES.has(part.role) && paths.includes(part.path))) ?? null
  }
  const attach = Boolean(primary && !paths.includes(primary.importPath))
  return { primary, attach, merge: own.filter(row => row !== primary) }
}

function relationOf(found, unit, ctx) {
  const { primary, attach, merge } = found
  if (!primary) return 'new'
  if ([primary, ...merge].some(isEdited)) return 'edited'
  const parts = partsOf(primary)
  const have = new Set(parts.map(sigOf))
  const want = unitParts(unit, ctx.mode)
  const covered = attach || parts.filter(part => ctx.roots.has(part.root)).every(part => want.some(row => row.path === part.path))
  if (!merge.length && covered && want.every(part => have.has(sigOf(part)))) return 'same'
  return attach ? 'attach' : 'update'
}

function withoutXhsVersion(production) {
  const { [XHS]: old, ...rest } = production?.versions ?? {}
  return old?.imported ? { ...production, versions: rest } : production
}

/** 发布记录：导入写的那几个平台换成这次的；用户自己记的不动。 */
function mergePublish(old, fresh, platforms) {
  const kept = Object.fromEntries(Object.entries(old ?? {}).filter(([platform, row]) => !(row?.from === 'import' && platforms.includes(platform))))
  const next = { ...fresh, ...kept }
  return Object.keys(next).length || old ? next : undefined
}

function bumpPublished(item, content) {
  if (item.status === 'published' || content.status !== 'published' || !content.publishedAt) return item
  return { ...item, status: 'published', publishedAt: content.publishedAt }
}

/** 已有的一条挂上小红书版本，原来的标题、成稿、状态不动。 */
function attachXhs(primary, unit, content, ctx) {
  const parts = [...partsOf(primary).filter(part => !XHS_ROLES.has(part.role)), ...unitParts(unit, ctx.mode)]
  const production = { ...primary.production, versions: { ...primary.production?.versions, [XHS]: content.version } }
  const publish = mergePublish(primary.publish, content.publish[XHS] ? { [XHS]: content.publish[XHS] } : {}, [XHS])
  return bumpPublished({ ...primary, production, importParts: parts, ...(publish ? { publish } : {}) }, content)
}

/** 新建或按文件重写一条：标题、开头一段、成稿、状态、日期和小红书版本。 */
function rebuild(base, unit, content, ctx) {
  const { main } = content
  const hasXhs = Boolean(unit.body || unit.cards)
  const oldParts = base ? partsOf(base) : []
  // 小红书文件来自这次没读的文件夹：留着它们和小红书版本
  const keptXhs = hasXhs ? [] : oldParts.filter(part => XHS_ROLES.has(part.role) && !ctx.roots.has(part.root))
  const { publishedAt: _published, platform: _platform, ...rest } = base ?? {}
  let production = { ...(base?.production ?? { status: 'done', stage: 'done', format: 'article', cover: null, images: [], shots: [] }), title: content.title, article: content.article.slice(0, MAX_ARTICLE), importedFrom: main.path }
  if (content.version) production = { ...production, versions: { ...production.versions, [XHS]: content.version } }
  else if (!keptXhs.length) production = withoutXhsVersion(production)
  const platforms = [main.platform, ...(keptXhs.length ? [] : [XHS])].filter(Boolean)
  const publish = mergePublish(base?.publish, content.publish, platforms)
  return {
    ...(base ? rest : { id: newId('it'), kind: 'note', personaIds: [], drafts: {} }),
    title: content.title, body: excerptOf(content.article), status: content.status, tags: main.tags,
    ...(main.platform ? { platform: main.platform } : {}), ...(content.publishedAt ? { publishedAt: content.publishedAt } : {}),
    createdAt: main.dateFrom === 'mtime' && base?.createdAt ? base.createdAt : main.createdAt,
    source: basename(main.root), imported: true, importDir: main.root, importPath: main.path, importMtime: main.mtimeMs, importDay: main.day, importedAt: ctx.now,
    importParts: [...unitParts(unit, ctx.mode), ...keptXhs], production, ...(publish ? { publish } : {}),
  }
}

/** 这次读到的文件按规则分成一篇篇，并算好每个文件夹「发过了吗」的回答。 */
function planOf(state, scans, rawChoices, now) {
  const { split, keep, paths } = choicesOf(state, scans, rawChoices)
  const files = scans.flatMap(scan => scan.files).filter(file => !paths || paths.has(file.path))
  const roots = new Set(scans.map(scan => scan.dir))
  const modes = new Map(scans.map(scan => [scan.dir, scan.published ?? (state.importDirs ?? []).find(row => row.dir === scan.dir)?.published ?? 'file']))
  const ctx = { roots, mode: root => modes.get(root) ?? 'file', now }
  // 以前导入、这次没重读的公众号稿子：小红书的稿子也可以挂上去
  const existing = state.items
    .filter(row => isFileItem(row) && row.platform === WECHAT && row.importDay && !roots.has(row.importDir) && !row.production?.versions?.[XHS] && !isEdited(row))
    .map(row => ({ id: row.id, day: row.importDay, titles: [row.title, row.production?.title, fileTitleOf(basename(row.importPath).replace(/\.md$/i, ''))].filter(Boolean), plain: true }))
  const held = new Set(state.items.filter(row => isFileItem(row) && !roots.has(row.importDir)).flatMap(row => partsOf(row).filter(part => XHS_ROLES.has(part.role)).map(part => part.path)))
  return { ...groupFiles(files, { split, keep, existing, held }), files, ctx, modes, split, keep }
}

/**
 * 导入一个或几个文件夹：按组新增或更新；在工作台里改过的不碰。就地修改 state，由调用方放进一步撤销。
 * @param {object} state - 工作台状态。
 * @param {object[]} scans - scanFolders 的结果（每个带 depth、published）。
 * @param {{split?: string[], keep?: object, paths?: string[], now?: string}} [options] - 拆开的组、重复文件留哪份（路径或 'all'）、只导入哪些文件。
 * @returns {{added: number, updated: number, attached: number, merged: number, unchanged: number, grouped: number, edited: object[], dropped: object[], skipped: object[]}}
 */
export function importScans(state, scans, { now = new Date().toISOString(), ...choices } = {}) {
  const plan = planOf(state, scans, choices, now)
  const report = { added: 0, updated: 0, attached: 0, merged: 0, unchanged: 0, grouped: 0, edited: [], dropped: [], skipped: scans.flatMap(scan => scan.skipped) }
  for (const dup of plan.duplicates) {
    for (const path of dup.paths) if (dup.keep !== 'all' && path !== dup.keep) report.dropped.push({ path, name: basename(path), keep: basename(dup.keep), reason: tr('可能重复，留了「{name}」', { name: basename(dup.keep) }) })
  }
  for (const unit of plan.units) {
    const found = existingOf(state, unit, plan.ctx)
    const relation = relationOf(found, unit, plan.ctx)
    if (relation === 'same') { report.unchanged += 1; continue }
    if (relation === 'edited') {
      // 文件改了，工作台里也改了：以工作台为准，不覆盖
      const main = mainOf(unit)
      report.edited.push({ path: main.path, name: main.name, title: found.primary.production?.title || found.primary.title, reason: tr('已在工作台改过，跳过') })
      continue
    }
    const content = contentOf(unit, plan.ctx, found.attach)
    const built = found.attach ? attachXhs(found.primary, unit, content, plan.ctx) : rebuild(found.primary, unit, content, plan.ctx)
    const next = { ...built, importHash: contentHash(built) }
    const gone = new Set(found.merge.map(row => row.id))
    state.items = found.primary
      ? state.items.filter(row => !gone.has(row.id)).map(row => (row.id === next.id ? next : row))
      : [...state.items.filter(row => !gone.has(row.id)), next]
    if (gone.size) {
      // 以前分开导入的几条合进来：挂在下面的分支和数据跟过来
      state.items = state.items.map(row => (row.parentId && gone.has(row.parentId) ? { ...row, parentId: next.id } : row))
      state.metrics = (state.metrics ?? []).map(row => (gone.has(row.itemId) ? { ...row, itemId: next.id } : row))
      report.merged += gone.size
    }
    if (filesOf(unit).length > 1 || found.attach) report.grouped += 1
    if (relation === 'new') report.added += 1
    else if (relation === 'attach') report.attached += 1
    else report.updated += 1
  }
  const others = (state.importDirs ?? []).filter(row => !plan.ctx.roots.has(row.dir))
  // 记下用户拆开的组和重复文件的选择，「重新导入」时照旧
  const under = (key, dir) => key.includes(`${dir}${sep}`)
  const rows = scans.map(scan => ({
    dir: scan.dir, name: basename(scan.dir), depth: scan.depth === 1 ? 1 : 0, published: plan.modes.get(scan.dir), importedAt: now,
    count: state.items.filter(row => isFileItem(row) && partsOf(row).some(part => part.root === scan.dir)).length,
    split: [...plan.split].filter(key => under(key, scan.dir)), keep: Object.fromEntries(Object.entries(plan.keep).filter(([key]) => under(key, scan.dir))),
  }))
  state.importDirs = [...others, ...rows]
  return report
}

/** 只导入一个文件夹（旧接口）。 */
export function importScan(state, scan, { depth = scan.depth ?? 0, ...options } = {}) {
  return importScans(state, [{ ...scan, depth, published: scan.published ?? null }], options)
}

function countBy(rows, key) {
  const counts = {}
  for (const row of rows) {
    const value = row[key] ?? ''
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

const ROLE_LABEL = { article: '正文', 'xhs-body': '小红书正文', 'xhs-cards': '小红书图片版' }

/**
 * 给界面看的预览（不带正文）：每篇导入后的样子、会合成一篇的组（可以拆开）、可能重复的文件（选留哪份）、跳过的文件。
 * @param {object} state - 工作台状态。
 * @param {object[]|object} scans - scanFolders 的结果；也可以是单个 scanFolder 的结果。
 * @param {{split?: string[], keep?: object}} [choices]
 */
export function previewImport(state, scans, choices = {}) {
  const list = Array.isArray(scans) ? scans : [scans]
  const plan = planOf(state, list, choices, new Date().toISOString())
  const byPath = new Map(plan.files.map(file => [file.path, file]))
  const pieces = plan.units.map((unit) => {
    const found = existingOf(state, unit, plan.ctx)
    const content = contentOf(unit, plan.ctx, found.attach)
    const main = content.main
    const target = found.attach ? found.primary : null
    return {
      key: main.path, title: target ? target.production?.title || target.title : content.title, platform: target ? target.platform ?? null : main.platform,
      files: unitParts(unit, plan.ctx.mode).map(part => ({ path: part.path, name: basename(part.path), role: part.role, label: ROLE_LABEL[part.role] })),
      status: content.status, statusFrom: main.statusFrom, createdAt: main.createdAt, dateFrom: main.dateFrom,
      publishedAt: content.publishedAt, publishedFrom: content.publishedFrom, versions: content.version ? [XHS] : [], chars: main.body.length, relation: relationOf(found, unit, plan.ctx),
      ...(target ? { target: { id: target.id, title: target.production?.title || target.title } } : {}),
    }
  })
  const nameOf = path => byPath.get(path)?.name ?? basename(path)
  const groups = plan.groups.map(group => {
    const target = group.targetId ? state.items.find(row => row.id === group.targetId) : null
    const paths = group.paths.filter(path => byPath.has(path))
    const lead = byPath.get(group.paths[0])
    return { ...group, paths, names: paths.map(nameOf), title: target ? target.production?.title || target.title : lead?.baseTitle ?? '', count: paths.length + (target ? 1 : 0), ...(target ? { target: { id: target.id, title: target.production?.title || target.title } } : {}) }
  })
  return {
    dir: list[0]?.dir, name: list[0]?.name,
    folders: list.map(scan => ({ dir: scan.dir, name: scan.name, depth: scan.depth ?? 0, published: plan.modes.get(scan.dir), files: scan.files.length, skipped: scan.skipped.length })),
    byStatus: countBy(plan.files, 'status'), byPlatform: countBy(plan.files, 'platform'),
    files: plan.files.map(file => ({
      path: file.path, name: file.name, root: file.root, title: file.title, titleFrom: file.titleFrom, variant: file.variant, status: file.status, statusFrom: file.statusFrom, platform: file.platform, platformFrom: file.platformFrom,
      createdAt: file.createdAt, dateFrom: file.dateFrom, publishedAt: file.publishedAt, publishAll: file.publishAll, chars: file.body.length, dropped: plan.dropped.has(file.path),
      relation: pieces.find(piece => piece.files.some(row => row.path === file.path))?.relation ?? 'dropped',
    })),
    pieces, groups,
    duplicates: plan.duplicates.map(dup => ({ ...dup, files: dup.paths.map(path => { const file = byPath.get(path); return { path, name: file.name, title: file.title, mtimeMs: file.mtimeMs, chars: file.body.length } }) })),
    skipped: list.flatMap(scan => scan.skipped),
  }
}

/** 单个文件夹的预览（旧接口）。 */
export function previewScan(state, scan, choices) {
  return previewImport(state, [scan], choices)
}

/** 一条内容去掉某个文件夹的小红书文件：小红书版本和导入记的小红书发布一起去掉。 */
function dropXhs(row, rest) {
  const production = withoutXhsVersion(row.production)
  const { [XHS]: record, ...others } = row.publish ?? {}
  const publish = record?.from === 'import' ? others : row.publish
  const next = { ...row, production, importParts: rest, ...(publish ? { publish } : {}) }
  return { ...next, importHash: contentHash(next) }
}

/** 公众号那篇所在的文件夹被移除、小红书文件还在：这条变回只有小红书的一篇。 */
function toXhsOnly(row, rest) {
  const version = row.production?.versions?.[XHS] ?? {}
  const main = rest.find(part => part.role === 'xhs-body') ?? rest[0]
  const article = version.body || version.cards || ''
  const { [row.platform]: mother, ...others } = row.publish ?? {}
  const publish = mother?.from === 'import' ? others : row.publish
  const published = publish?.[XHS]?.state === 'published'
  const { publishedAt: _published, ...base } = row
  const next = {
    ...base, title: version.title || row.title, body: excerptOf(article), platform: XHS, status: published ? 'published' : row.status === 'published' ? 'ready' : row.status,
    ...(published && publish[XHS].at ? { publishedAt: publish[XHS].at } : {}), source: basename(main.root), importDir: main.root, importPath: main.path, importMtime: main.mtime,
    importParts: rest, production: { ...row.production, title: version.title || row.title, article, importedFrom: main.path }, ...(publish ? { publish } : {}),
  }
  return { ...next, importHash: contentHash(next) }
}

/**
 * 移除从某个文件夹导入的内容；在工作台里改过的留下。文件夹本身不动。
 * 一篇由两个文件夹的文件合成的：只去掉这个文件夹的那部分（小红书版本，或者公众号成稿——剩下小红书那篇）。
 * @returns {{removed: number, kept: number, detached?: number}}
 */
export function removeImported(state, dir) {
  const target = String(dir ?? '')
  const known = (state.importDirs ?? []).some(row => row.dir === target) || state.items.some(row => row.imported && row.importDir === target)
  if (!known) throw fail(tr('没有从这个文件夹导入过'))
  const touches = row => isFileItem(row) && (row.importDir === target || partsOf(row).some(part => part.root === target))
  const removing = new Set()
  const changed = new Map()
  let kept = 0
  for (const row of state.items.filter(touches)) {
    const rest = partsOf(row).filter(part => part.root !== target && !(part.role === 'article' && row.importDir === target))
    if (isEdited(row)) kept += 1
    else if (!rest.length) removing.add(row.id)
    else changed.set(row.id, row.importDir === target ? toXhsOnly(row, rest) : dropXhs(row, rest))
  }
  // 挂在被移除内容下面的分支接到上一级，相关数据一起删掉
  state.items = state.items.filter(row => !removing.has(row.id)).map(row => changed.get(row.id) ?? (row.parentId && removing.has(row.parentId) ? { ...row, parentId: null } : row))
  state.metrics = (state.metrics ?? []).filter(row => !removing.has(row.itemId))
  state.importDirs = (state.importDirs ?? []).filter(row => row.dir !== target)
  return { removed: removing.size, kept, ...(changed.size ? { detached: changed.size } : {}) }
}
