// 写作工作流：成稿时把用户自己写的文风说明、方法论文档和平台写作 skill 一起给模型看，只当写法参考。
// 只读，不改用户的文件。默认只索引独立工作区；用户在设置里填了路径就只用那些。没有这些文件时什么都不注入，成稿照常。
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { tr } from './i18n.js'
import { truncateByParagraph } from './item-materials.js'

/** 一份文档默认最多注入多少字；超了按段落截断并注明。 */
export const FLOW_DOC_CHARS = 8_000
/** 一次成稿默认所有工作流文档合计最多多少字。 */
export const FLOW_BUDGET = 30_000
/** 真实成稿加载完整 Skill（含正反例对照）、文风说明书与原声切片时的放宽上限。 */
export const PRODUCTION_DOC_CHARS = 25_000
export const PRODUCTION_FLOW_BUDGET = 60_000
/** 最多列几份。 */
export const MAX_FLOW_DOCS = 40
const MAX_FILE_BYTES = 1_000_000
const TEXTS = /\.(md|markdown|txt)$/i
const STYLE_FILE = 'style.md'
export const FLOW_LAYOUT = { style: STYLE_FILE, voice: 'voice', exemplar: 'examples', method: 'methods' }
const DEFAULT_ON = new Set(['rules', 'style', 'voice', 'custom'])

function expand(value, home) {
  const text = String(value ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim()
  if (text === '~') return home
  if (text.startsWith('~/')) return join(home, text.slice(2))
  return text
}

async function listDir(dir, depth = 1) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0) out.push(...await listDir(full, depth - 1))
    } else if (TEXTS.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** 读一份文档的正文：去掉 YAML 头（SKILL.md 的规则在正文里）。不是文本、太大或读不了时返回原因。 */
async function readDoc(path) {
  if (!TEXTS.test(path)) return { error: tr('只能读 .md、.markdown 或 .txt 文件') }
  const info = await stat(path).catch(() => null)
  if (!info) return { error: tr('找不到这个文件或文件夹') }
  if (!info.isFile()) return { error: tr('这是一个文件夹，不是文件') }
  if (info.size > MAX_FILE_BYTES) return { error: tr('文件超过 1 MB') }
  try {
    const raw = await readFile(path, 'utf8')
    return { text: raw.replace(/^﻿/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/\r\n?/g, '\n').trim() }
  } catch (err) {
    return { error: tr('读不了这个文件：{reason}', { reason: err.message }) }
  }
}

/**
 * 这份文档默认勾不勾：用户勾过（selected 是数组）就照勾的来；没勾过按分组默认。
 * @param {{id: string, group: string}} doc
 * @param {string[]|null} selected - 设置里的 writingFlow.selected。
 */
export function isFlowOn(doc, selected, target) {
  if (Array.isArray(selected)) return selected.includes(doc.id)
  if (target) {
    if (['rules', 'style', 'voice', 'exemplar', 'skill'].includes(doc.group)) return true
    if (doc.group === 'method') {
      if (target === 'xhs' && doc.name === '封面标题风格推荐系统.md') return true
      if (target === 'script' && doc.name === '短视频开头优化方法论.md') return true
    }
  }
  return Array.isArray(selected) ? selected.includes(doc.id) : DEFAULT_ON.has(doc.group)
}

/**
 * 探测可用的写作工作流文档。有自定义路径时只看它们；没有时探测指定工作区。每份都真读一遍，字数是真实的。
 * @param {{paths?: string[], selected?: string[]|null, home?: string}} [options] - paths 是设置里的自定义路径（目录或文件）；home 只给测试用。
 * @returns {Promise<{docs: Array<{id: string, name: string, path: string, group: string, chars: number, on: boolean, error?: string}>, custom: boolean}>}
 */
export async function detectFlow({ paths = [], selected = null, home = homedir(), target, workspace, metadataOnly = false } = {}) {
  const custom = (Array.isArray(paths) ? paths : []).map(row => expand(row, home)).filter(Boolean)
  const found = []
  const seen = new Set()
  const push = async (path, group, name, { quiet = false } = {}) => {
    if (seen.has(path) || found.length >= MAX_FLOW_DOCS) return
    const info = metadataOnly ? await stat(path).catch(() => null) : null
    const doc = metadataOnly ? (info?.isFile() ? {} : { error: tr('找不到这个文件或文件夹') }) : await readDoc(path)
    // 自动探测时，不存在的位置不算错，直接跳过；用户自己填的路径读不到要说原因
    if (doc.error && quiet) return
    if (!metadataOnly && !doc.error && !doc.text) return
    seen.add(path)
    const row = { id: path, name, path, group, chars: doc.text?.length ?? 0, ...(metadataOnly ? { modified: info?.mtimeMs, bytes: info?.size } : {}) }
    found.push(doc.error ? { ...row, error: doc.error } : row)
  }
  if (custom.length) {
    for (const targetPath of custom.slice(0, 20)) {
      const info = await stat(targetPath).catch(() => null)
      if (info?.isDirectory()) {
        for (const file of await listDir(targetPath)) await push(file, 'custom', relative(targetPath, file), { quiet: true })
      } else {
        const base = basename(targetPath)
        const label = base === 'SKILL.md' ? `${basename(dirname(targetPath))}/SKILL.md` : base
        await push(targetPath, 'custom', label)
      }
    }
  } else {
    const roots = workspace ? [workspace] : []
    for (const root of roots) await push(join(root, 'CLAUDE.md'), 'rules', 'CLAUDE.md', { quiet: true })
    for (const root of roots) await push(join(root, FLOW_LAYOUT.style), 'style', STYLE_FILE, { quiet: true })
    for (const root of roots) {
      for (const file of (await listDir(join(root, FLOW_LAYOUT.voice))).filter(file => !/^(readme|index)\.md$/i.test(basename(file)))) await push(file, 'voice', basename(file), { quiet: true })
      for (const file of (await listDir(join(root, FLOW_LAYOUT.exemplar))).filter(file => !/^(readme|index)\.md$/i.test(basename(file)))) await push(file, 'exemplar', basename(file), { quiet: true })
    }
    for (const root of roots) {
      // 目录索引不算方法文档
      for (const file of (await listDir(join(root, FLOW_LAYOUT.method))).filter(file => !/^(readme|index)\.md$/i.test(basename(file)))) await push(file, 'method', basename(file), { quiet: true })
    }
  }
  return { docs: found.map(row => ({ ...row, on: !row.error && isFlowOn(row, selected, target) })), custom: custom.length > 0 }
}

/**
 * 读选中的工作流文档。一份超长按段落截断并注明；合计超预算的整份不放。都如实返回，不静默丢。
 * @param {Array<{id: string, name?: string, path: string, group: string}>} docs - detectFlow 给的行（已经按勾选过滤）。
 * @param {number} [budget] - 合计字数上限。
 * @returns {Promise<{parts: Array<{id: string, name: string, group: string, chars: number, text: string, truncated: boolean}>, dropped: Array<{name: string, chars: number}>, usedChars: number, errors: string[]}>}
 */
export async function readFlow(docs, budget = FLOW_BUDGET, docLimit = FLOW_DOC_CHARS) {
  const parts = []
  const dropped = []
  const errors = []
  let used = 0
  for (const doc of docs.slice(0, MAX_FLOW_DOCS)) {
    const name = doc.name || basename(doc.path)
    const { text, error } = await readDoc(doc.path)
    if (error) {
      errors.push(tr('读不了「{name}」：{reason}', { name, reason: error }))
      continue
    }
    if (!text) continue
    // 剩下的预算连一小段都放不下，就整份不放，而不是塞进一个没头没尾的开头
    const room = Math.min(docLimit, budget - used)
    if (room < Math.min(1_000, text.length)) {
      dropped.push({ name, chars: text.length })
      continue
    }
    const cut = truncateByParagraph(text, room)
    parts.push({ id: doc.id, name, group: doc.group, chars: text.length, text: cut.text, truncated: cut.truncated })
    used += cut.text.length
  }
  return { parts, dropped, usedChars: used, errors }
}

/** 按设置读这次成稿要用的工作流：探测 → 按勾选过滤 → 读（完整载入文风与正反例，避免 8k 字腰斩）。 */
export async function loadFlow(settings, options = {}) {
  const flow = settings?.writingFlow ?? {}
  const found = await detectFlow({ paths: flow.paths ?? [], selected: flow.selected ?? null, ...options })
  return readFlow(found.docs.filter(row => row.on), options.budget ?? PRODUCTION_FLOW_BUDGET, options.docLimit ?? PRODUCTION_DOC_CHARS)
}

/** 拼进成稿提示词的一段：只学写法与语感，不当事实。 */
export function flowBlock(parts) {
  if (!parts.length) return ''
  const body = parts.map(row => `=== ${row.name} ===\n${row.text}`).join('\n\n')
  return `\n<workflow>\n${body}\n</workflow>\n<workflow> 是这位创作者本人写的写作规则、原声语感切片与平台方法（共 ${parts.length} 份）：必须严格按它的起手切入、断句气口、工程判断密度和边界交代来写。
若有原声切片或代表作结构样本，写之前先默读一遍，让新稿的每一段都能混进那些原文里而不显违和（拒绝“好学生汇报腔”与均速说明书口吻）。
它只提供写法，不提供这篇的事实：里面的示例、论文、数字、金额、链接、人名和第一人称经历都只是举例，不能当成作者做过的事写进正文，也不能写成引用或出处。这篇的事实只来自 <material> 和 <attachments>。
落笔输出前，在内部静默执行一次 humanizer 去 AI 味检查与「遮名换名检查」（若遮住名字只剩通稿复述与泛泛建议，立即补上具体的取舍代价、失败边界与个人判断），只输出改定后的正文，不输出自检清单或工具调用提示。写法要求和其他通用规则冲突时以这份工作流为准；碰到事实，仍以事实规矩为准。`
}
