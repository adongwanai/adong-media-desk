// 排版选择的记忆：长文和图文卡片各记一份（主题、骨架、封面、字体、字号、比例、导出尺寸、分页标题级别、背景图），
// 署名单独一份（含页脚、日期格式），编辑器的偏好（分栏宽度、锁定、打字机、行号）一份；
// 每篇内容自己的图片调整、表格缩放、封面槽位按内容 id 各记一份（同言起 imageScales / tableScales，只是多了内容 id）。
// 既记在 localStorage，也同步到当前工作台数据目录的 state.json（无内置个人默认）。
import React from 'react'
import { dispatchOps, useDesk } from '../desk.js'
import { DEFAULT_COVER, DEFAULT_HEADING_LEVEL, DEFAULT_RATIO, DEFAULT_TEMPLATE, DEFAULT_TIER, cleanImageState, cleanTableScale } from './cards.js'
import { DEFAULT_SIGNATURE } from './signature.js'
import { DEFAULT_WECHAT_SIZE } from './wechat.js'
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, DEFAULT_THEME, THEME_ALIASES, YANQI_THEMES } from './yanqi.js'

export { DEFAULT_SIGNATURE }

const KEY = 'media-desk:yanqi:'
// 旧版只记了主题，存的是 clean / tech / essay / night / journal
const LEGACY = { article: 'media-desk:layout-theme:wechat', card: 'media-desk:layout-theme:xhs' }

const DEFAULTS = {
  article: { theme: DEFAULT_THEME, font: DEFAULT_FONT, fontSize: DEFAULT_WECHAT_SIZE, linkFootnotes: false },
  card: { theme: DEFAULT_THEME, template: DEFAULT_TEMPLATE, cover: DEFAULT_COVER, font: DEFAULT_FONT, fontSize: DEFAULT_FONT_SIZE, ratio: DEFAULT_RATIO, tier: DEFAULT_TIER, headingLevel: DEFAULT_HEADING_LEVEL, background: null, safeArea: false, coverOnly: false, compactFlow: false },
  editor: { split: 0.44, locked: false, typewriter: false, lineNumbers: false },
}

function read(key) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // 存不了就只在这次生效
    return false
  }
}

function initialPrefs(form, serverCardPrefs) {
  const saved = read(KEY + form)
  if (saved && typeof saved === 'object' && (!saved.adongProfileRev || saved.customized)) {
    const merged = { ...DEFAULTS[form], ...(form === 'card' && serverCardPrefs ? serverCardPrefs : {}), ...saved }
    if (form === 'card' && saved.font === '雅黑' && !saved.fontTouched) merged.font = serverCardPrefs?.font || DEFAULT_FONT
    return merged
  }
  if (form === 'card' && serverCardPrefs && typeof serverCardPrefs === 'object') {
    return { ...DEFAULTS.card, ...serverCardPrefs }
  }
  let legacy = null
  try {
    legacy = window.localStorage.getItem(LEGACY[form])
  } catch { /* 读不了就用默认 */ }
  const theme = THEME_ALIASES[legacy] ?? (YANQI_THEMES.some(row => row.id === legacy) ? legacy : null)
  return theme ? { ...DEFAULTS[form], theme } : { ...DEFAULTS[form] }
}

function hasSignatureData(sig) {
  return Boolean(sig && typeof sig === 'object' && (sig.name || sig.id || sig.avatar || sig.left || sig.right))
}

function initialSignature(serverSig) {
  const saved = read(`${KEY}signature`)
  if (saved && typeof saved === 'object' && saved.customized && !saved.adongProfileRev) {
    return { ...DEFAULT_SIGNATURE, ...saved }
  }
  if (hasSignatureData(serverSig)) {
    return { ...DEFAULT_SIGNATURE, ...serverSig }
  }
  return { ...DEFAULT_SIGNATURE }
}

/** 直接读取某一组排版记忆（比如在发布页同步使用长文主题和脚注设置）。 */
export function readPrefs(form) {
  return initialPrefs(form)
}

/** 某一组排版选择（'article' 长文 / 'card' 图文卡片 / 'editor' 编辑器），改了就记下来。 */
export function usePrefs(form) {
  const serverCardPrefs = useDesk(s => (form === 'card' ? s.state?.cardPrefs : null))
  const [prefs, setPrefs] = React.useState(() => initialPrefs(form, serverCardPrefs))
  React.useEffect(() => {
    if (form !== 'card' || !serverCardPrefs) return
    setPrefs((prev) => {
      if (prev.customized) return prev
      return { ...prev, ...serverCardPrefs }
    })
  }, [form, serverCardPrefs])
  const update = React.useCallback((patch) => {
    setPrefs((prev) => {
      const resolved = typeof patch === 'function' ? patch(prev) : patch
      const { adongProfileRev: _legacy, ...cleanPrev } = prev
      const next = {
        ...cleanPrev,
        ...resolved,
        customized: true,
        ...(resolved && 'font' in resolved ? { fontTouched: true } : {}),
      }
      write(KEY + form, next)
      if (form === 'card') dispatchOps([{ op: 'save_card_profile', prefs: next }], { silent: true }).catch(() => {})
      return next
    })
  }, [form])
  return [prefs, update]
}

/** 卡片上的署名：默认全空，由当前工作台数据目录或用户自行填写/同步提供。 */
export function useSignature() {
  const serverSig = useDesk(s => s.state?.cardSignature)
  const [signature, setSignature] = React.useState(() => initialSignature(serverSig))
  React.useEffect(() => {
    if (!hasSignatureData(serverSig)) return
    setSignature((prev) => {
      if (prev.customized && !prev.adongProfileRev) return prev
      return { ...DEFAULT_SIGNATURE, ...serverSig }
    })
  }, [serverSig])
  const update = React.useCallback((next) => {
    const { adongProfileRev: _legacy, ...clean } = next ?? {}
    const stamped = { ...DEFAULT_SIGNATURE, ...clean, customized: true }
    setSignature(stamped)
    write(`${KEY}signature`, stamped)
    dispatchOps([{ op: 'save_card_profile', signature: stamped }], { silent: true }).catch(() => {})
  }, [])
  return [signature, update]
}

const EMPTY_MEDIA = { images: {}, tables: {}, cover: {} }

/**
 * 一篇内容自己的排版调整：图片（平移、缩放、宽高）、表格缩放、封面槽位（引子、标签、编号、配图）。
 * @param {string} itemId - 内容 id；没有时只在这次生效。
 * @returns {[object, object]} [当前值, { setImage, resetImage, setTable, setCover }]
 */
export function useItemMedia(itemId) {
  const key = itemId ? `${KEY}media:${itemId}` : null
  const [media, setMedia] = React.useState(() => ({ ...EMPTY_MEDIA, ...(key ? read(key) : null) }))
  React.useEffect(() => { setMedia({ ...EMPTY_MEDIA, ...(key ? read(key) : null) }) }, [key])
  const timer = React.useRef(null)
  const latest = React.useRef(media)
  latest.current = media
  // 同言起：拖动时不停地改，停下 400ms 后才写一次
  const persist = React.useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (key) write(key, latest.current) }, 400)
  }, [key])
  React.useEffect(() => () => { clearTimeout(timer.current); if (key) write(key, latest.current) }, [key])
  const actions = React.useMemo(() => ({
    setImage: (imageKey, state) => { setMedia(prev => ({ ...prev, images: { ...prev.images, [imageKey]: cleanImageState(state) } })); persist() },
    resetImage: (imageKey) => { setMedia(({ images: { [imageKey]: _gone, ...images }, ...prev }) => ({ ...prev, images })); persist() },
    setTable: (tableKey, scale) => { setMedia(prev => ({ ...prev, tables: { ...prev.tables, [tableKey]: cleanTableScale(scale) } })); persist() },
    setCover: patch => { setMedia(prev => ({ ...prev, cover: { ...prev.cover, ...patch } })); persist() },
  }), [persist])
  return [media, actions]
}
