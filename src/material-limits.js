// 素材文件的限制和状态里那一行的形状。Host 和浏览器共用，不能引用 node 模块。
/** 一次最多加几份。 */
export const MAX_FILES_PER_ADD = 10
/** 单份素材的正文字数上限。 */
export const MAX_MATERIAL_CHARS = 200_000
/** 一条灵感下所有素材的正文合计上限。 */
export const MAX_TOTAL_CHARS = 200_000
/** 超过这么多字的正文不进 state，写到 files 里。 */
export const INLINE_MAX = 20_000
/** 一条灵感最多带几份素材。 */
export const MAX_MATERIALS = 30
/** 成稿时素材最多占多少字；超出的整份删掉，并在结果里说明。 */
export const MATERIALS_BUDGET = 24_000

const NAME_MAX = 120
const PATH_MAX = 500
const NOTE_MAX = 300

export const clip = (value, max) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').slice(0, max) : '')

/**
 * 把状态里存的素材行收拾成能用的形状。旧数据没有 materials；坏掉的行丢掉，不报错。
 * 缺 id 的行按顺序补一个稳定的：迁移每次读都会跑，不能每次生成新 id。
 * @param {*} value - item.materials。
 * @returns {Array<{id: string, name: string, path: string, chars: number, text: string, file?: string, error?: string, addedAt: string}>}
 */
export function cleanMaterials(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const [index, row] of value.slice(0, MAX_MATERIALS).entries()) {
    if (!row || typeof row !== 'object') continue
    const name = clip(row.name, NAME_MAX).trim()
    if (!name) continue
    const id = typeof row.id === 'string' && /^[\w-]{1,64}$/.test(row.id) ? row.id : `mt_legacy_${index}`
    if (seen.has(id)) continue
    seen.add(id)
    const text = clip(row.text, INLINE_MAX)
    const entry = {
      id,
      name,
      path: clip(row.path, PATH_MAX),
      chars: Number.isFinite(row.chars) ? Math.max(0, Math.round(row.chars)) : text.length,
      text,
      addedAt: typeof row.addedAt === 'string' ? row.addedAt : new Date(0).toISOString(),
    }
    // 正文落盘的文件名只认 material-<id>.txt 这种，别的名字指不到 files 外面也不认
    if (typeof row.file === 'string' && /^material-[\w-]+\.txt$/.test(row.file)) entry.file = row.file
    if (typeof row.error === 'string' && row.error) entry.error = clip(row.error, NOTE_MAX)
    out.push(entry)
  }
  return out
}
