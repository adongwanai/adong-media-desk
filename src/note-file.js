// 记灵感时直接贴一个本地 Markdown 文件的路径：把文件内容读进来当素材。
// 只认文本稿（.md/.markdown/.txt），限制大小，不做任何写回；读不了就如实说，不当成标题存进去。
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, resolve } from 'node:path'
import { tr } from './i18n.js'

export const NOTE_EXTS = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonl', '.csv', '.tsv',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.srt', '.vtt', '.log',
  '.py', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.sh', '.sql',
])
export const MAX_NOTE_BYTES = 2_000_000

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

/** 这段文字像不像一个本地文本稿路径。整段就是路径、没有换行、扩展名对得上才算。 */
export function looksLikePath(text) {
  const value = String(text ?? '').trim()
  if (!value || value.includes('\n') || value.length > 400) return false
  if (!NOTE_EXTS.has(extname(value).toLowerCase())) return false
  return value.startsWith('/') || value.startsWith('~/') || value.startsWith('./') || /^[A-Za-z]:[\\/]/.test(value)
}

/** 把 ~ 展开成主目录，相对路径按当前目录解析。 */
export function expandPath(value) {
  const text = String(value ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return resolve(homedir(), text.slice(2))
  return isAbsolute(text) ? resolve(text) : resolve(process.cwd(), text)
}

/** 去掉开头的 YAML 头，返回头和正文。头只用来取标题和标签。 */
export function splitFrontMatter(text) {
  const source = String(text ?? '').replace(/^﻿/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return { head: '', body: source }
  return { head: match[1], body: source.slice(match[0].length) }
}

const cleanLine = line => String(line).trim().replace(/^#{1,6}\s+/, '').replace(/^>\s*/, '').replace(/\*\*|__|==|`/g, '').trim()

/** 标题的顺序：YAML 里的 title；正文最前面那行短文字；第一个小标题；第一段非空文字。都取不到就留空，交给用户自己写。 */
export function noteTitle(head, body) {
  const titled = /^title:\s*(.+)$/m.exec(head)
  if (titled) {
    const value = cleanLine(titled[1].replace(/^["']|["']$/g, ''))
    if (value) return value.slice(0, 80)
  }
  const lines = String(body ?? '').split(/\r?\n/)
  const firstText = lines.findIndex(line => cleanLine(line).length > 0)
  const firstHeading = lines.findIndex(line => /^#{1,3}\s+\S/.test(line))
  // 很多稿子把篇名写在正文最前面（加粗或纯文字），后面才是小标题：先看它，再看第一个小标题
  if (firstText !== -1 && (firstHeading === -1 || firstText < firstHeading)) {
    const line = cleanLine(lines[firstText])
    // 篇名短，而且不以句号收尾；以句号结尾的是一段正文
    if (line.length <= 60 && !/[。.；;]$/.test(line)) return line
  }
  if (firstHeading !== -1) return cleanLine(lines[firstHeading]).slice(0, 80)
  const first = lines.map(cleanLine).find(line => line.length > 0)
  return first ? first.slice(0, 80) : ''
}

/** YAML 头里的 tags / 标签，支持 [a, b] 和逗号分隔两种写法。 */
export function noteTags(head) {
  const line = /^(?:tags|标签):\s*(.+)$/m.exec(head)?.[1]
  if (!line) return []
  return line.replace(/^\[|\]$/g, '').split(/[,，]/).map(tag => tag.trim().replace(/^["']|["']$/g, '')).filter(Boolean).slice(0, 12)
}

/**
 * 读一个本地文本稿。只读，不写回。
 * @param {string} rawPath - 用户贴的路径。
 * @returns {Promise<{file: string, title: string, body: string, tags: string[], chars: number}>}
 */
export async function readNoteFile(rawPath) {
  if (!looksLikePath(rawPath)) throw fail(tr('这看起来不是 Markdown 或文本文件的路径'))
  const file = expandPath(rawPath)
  if (!NOTE_EXTS.has(extname(file).toLowerCase())) throw fail(tr('只能读 .md、.markdown 或 .txt 文件'))
  const info = await stat(file).catch(() => null)
  if (!info) throw fail(tr('找不到这个文件：{path}', { path: rawPath }), 404)
  if (!info.isFile()) throw fail(tr('这是一个文件夹，不是文件'))
  if (info.size > MAX_NOTE_BYTES) throw fail(tr('文件超过 2 MB，先删减一些再读'))
  const raw = await readFile(file, 'utf8').catch(err => { throw fail(tr('读不了这个文件：{reason}', { reason: err.message })) })
  const ext = extname(file).toLowerCase()
  const normalized = (ext === '.html' || ext === '.htm')
    ? raw.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ')
    : raw
  const { head, body } = splitFrontMatter(normalized)
  const content = body.trim()
  if (!content) throw fail(tr('这个文件里没有正文'))
  return { file, title: noteTitle(head, content), body: content, tags: noteTags(head), chars: content.length }
}
