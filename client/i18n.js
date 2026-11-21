// 界面语言：中文写在代码里，英文词典在切到 English 时按需懒加载（assets/en.json），首屏中文不解析近 300KB 词表。
import React from 'react'

let preference = 'auto'
let hostLang = readHostLang()
let enDict = null
let loadingEn = null
const listeners = new Set()

function readHostLang() {
  if (typeof document === 'undefined') return 'zh'
  const tag = (document.documentElement.lang || navigator.language || 'zh').toLowerCase()
  return tag.startsWith('zh') ? 'zh' : 'en'
}

function notify() {
  listeners.forEach(fn => fn())
}

function ensureEnLoaded() {
  if (enDict || loadingEn || typeof fetch === 'undefined') return
  loadingEn = fetch('media-desk/assets/en.json')
    .then(r => (r.ok ? r.json() : {}))
    .then((data) => {
      enDict = data && typeof data === 'object' ? data : {}
      notify()
    })
    .catch(() => { enDict = {} })
    .finally(() => { loadingEn = null })
}

if (typeof document !== 'undefined') {
  if (hostLang === 'en') ensureEnLoaded()
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => {
      const next = readHostLang()
      if (next !== hostLang) {
        hostLang = next
        if (lang() === 'en') ensureEnLoaded()
        if (preference === 'auto') notify()
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
}

/** 当前生效的语言：'zh' 或 'en'。 */
export function lang() {
  return preference === 'auto' ? hostLang : preference
}

/** 设置里的语言偏好：'auto'、'zh' 或 'en'。 */
export function setLanguagePreference(value) {
  const next = value === 'zh' || value === 'en' ? value : 'auto'
  if (next === preference) return
  const before = lang()
  preference = next
  if (lang() === 'en') ensureEnLoaded()
  if (lang() !== before) notify()
}

export function subscribeLang(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useLang() {
  return React.useSyncExternalStore(subscribeLang, lang)
}

/**
 * 翻译一段界面文字。key 就是中文原文，{name} 是占位符。
 * @param {string} zh - 中文原文。
 * @param {Record<string, unknown>} [vars] - 占位符的值。
 * @returns {string} 当前语言的文字。
 */
export function t(zh, vars) {
  if (lang() === 'en' && !enDict) ensureEnLoaded()
  const text = lang() === 'en' && enDict ? (enDict[zh] ?? zh) : zh
  if (!vars) return text.includes('{s}') ? text.replace(/\{s\}/g, 's') : text
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (vars[key] !== undefined) return String(vars[key])
    // 英文复数后缀：调用的地方没给 s 时按 n 推，免得界面上露出 {s}
    if (key === 's') return Number(String(vars.n ?? '').replace(/,/g, '')) === 1 ? '' : 's'
    return match
  })
}

/** 按需读取已加载的英文词典项。 */
export function lookupEn(key) {
  if (lang() === 'en' && !enDict) ensureEnLoaded()
  return enDict ? enDict[key] : undefined
}

/** 英文要加空格和复数的地方用这个：n 为 1 时取 one，否则取 other。 */
export function plural(n, one, other) {
  return n === 1 ? one : other
}
