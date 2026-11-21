// 从本机 Obsidian 的 note-to-red（言起 YANQI）插件 data.json 读取卡片署名、头像、名言页脚、默认主题与自定义主题。
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { YANQI_FONTS, YANQI_THEMES } from '../client/layouts/yanqi-themes.js'
import { tr } from './i18n.js'
import { validateLayoutTheme } from './layout-theme.js'

const AVATAR_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i
const MAX_AVATAR_CHARS = 300_000
const BUILTIN_IDS = new Set(YANQI_THEMES.map(t => t.id))

export function cleanCardSignature(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const avatarRaw = String(s.avatar ?? '').trim()
  return {
    name: String(s.name ?? '').trim().slice(0, 40),
    id: String(s.id ?? '').trim().slice(0, 40),
    avatar: avatarRaw.length <= MAX_AVATAR_CHARS && AVATAR_RE.test(avatarRaw) ? avatarRaw : '',
    left: String(s.left ?? '').trim().slice(0, 40),
    right: String(s.right ?? '').trim().slice(0, 40),
    showDate: s.showDate !== false,
    showFooter: s.showFooter !== false,
    timeFormat: String(s.timeFormat ?? 'zh-CN').trim().slice(0, 24) || 'zh-CN',
  }
}

export function cleanCardPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  if (typeof p.theme === 'string' && p.theme.trim()) out.theme = p.theme.trim().slice(0, 60)
  if (typeof p.template === 'string' && p.template.trim()) out.template = p.template.trim().slice(0, 40)
  if (typeof p.cover === 'string' && p.cover.trim()) out.cover = p.cover.trim().slice(0, 40)
  if (typeof p.font === 'string' && p.font.trim()) out.font = p.font.trim().slice(0, 40)
  if (Number.isFinite(Number(p.fontSize))) out.fontSize = Math.min(24, Math.max(12, Math.round(Number(p.fontSize))))
  return out
}

function matchFontName(fontFamily, customFonts = []) {
  const raw = String(fontFamily ?? '').trim()
  if (!raw) return '雅黑'
  const norm = s => String(s ?? '').replace(/["'\s]/g, '').toLowerCase()
  const target = norm(raw)
  const sorted = [...YANQI_FONTS].sort((a, b) => b.name.length - a.name.length)
  const hitBuiltin = sorted.find(f => f.id === raw || f.name === raw || norm(f.family) === target || target.includes(norm(f.name)))
  if (hitBuiltin) return hitBuiltin.id
  const hitCustom = (Array.isArray(customFonts) ? customFonts : []).find(f => norm(f?.value) === target && f?.label)
  if (hitCustom && YANQI_FONTS.some(f => f.id === hitCustom.label)) return hitCustom.label
  return '雅黑'
}

/** 探测本机包含 .obsidian/plugins/note-to-red/data.json 的路径。 */
export async function findObsidianNoteToRed({ cwd = process.cwd(), home = homedir(), materialDir = '' } = {}) {
  const roots = []
  const pushAncestors = (start) => {
    if (!start) return
    let cur = start
    for (let i = 0; i < 4; i += 1) {
      if (!roots.includes(cur)) roots.push(cur)
      const parent = dirname(cur)
      if (!parent || parent === cur) break
      cur = parent
    }
  }
  pushAncestors(materialDir)
  pushAncestors(cwd)
  for (const root of roots) {
    const candidate = join(root, '.obsidian', 'plugins', 'note-to-red', 'data.json')
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile()) return candidate
  }
  return null
}

/** 解析 note-to-red 的 data.json 为工作台可直接落盘的 cardSignature、cardPrefs 和自定义主题。 */
export function parseObsidianNoteToRed(data) {
  if (!data || typeof data !== 'object') throw new Error(tr('note-to-red 配置文件格式无效'))
  const signature = cleanCardSignature({
    name: data.userName ?? '',
    id: data.userId ?? '',
    avatar: data.userAvatar ?? '',
    left: data.footerLeftText ?? '',
    right: data.footerRightText ?? '',
    showDate: data.showTime !== false,
    showFooter: data.showFooter !== false,
    timeFormat: data.timeFormat ?? 'zh-CN',
  })
  const cardPrefs = cleanCardPrefs({
    theme: data.themeId || 'adong-xhs-dense',
    template: data.templateId || 'default',
    cover: data.coverStyle || 'cover-bold',
    font: matchFontName(data.fontFamily, data.customFonts),
    fontSize: Number(data.fontSize) || 17,
  })
  const rawThemes = [
    ...(Array.isArray(data.themes) ? data.themes.filter(t => t?.id && !BUILTIN_IDS.has(t.id)) : []),
    ...(Array.isArray(data.customThemes) ? data.customThemes : []),
  ]
  const customThemes = []
  for (const item of rawThemes.slice(0, 20)) {
    try {
      const id = String(item.id ?? '').startsWith('my-') ? item.id : `my-${String(item.id ?? 'custom').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`
      customThemes.push(validateLayoutTheme({ ...item, id }))
    } catch {
      // 忽略不符合安全 CSS 白名单的外部自定义主题
    }
  }
  return { signature, cardPrefs, customThemes }
}

export async function readObsidianNoteToRed(options = {}) {
  const filePath = options.filePath || await findObsidianNoteToRed(options)
  if (!filePath) throw new Error(tr('未找到 Obsidian 的 note-to-red 插件配置（data.json）'))
  const raw = await readFile(filePath, 'utf8')
  const parsed = parseObsidianNoteToRed(JSON.parse(raw))
  return { ...parsed, path: filePath }
}
