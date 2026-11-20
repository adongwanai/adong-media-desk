// 快速记灵感：按快捷键弹出一个输入框，写一句回车就进灵感库。工作台页面没打开时也能用，所以不依赖 React 树。
// 一段文字里的 #标签 会变成标签；只贴一个网址就按链接收藏；粘贴图片直接存成图片灵感。
import { looksLikeNotePath, parseCapture } from './capture-text.js'
import { captureFile, captureFiles, captureUrl, dispatchOps, getDesk, loadDesk, setDesk, toast, undo } from './desk.js'
import { plural, t } from './i18n.js'
import { CAPTURE_ID, CAPTURE_KEY, keysText, registerShortcut } from './shortcuts.js'

const ID = 'md-quick-capture'
const DONE_ID = 'md-quick-capture-done'
const MUTED = 'color:var(--dsw-alias-label-tertiary,#7c7c82);font-size:12px;line-height:18px'
const KBD = 'display:inline-block;min-width:18px;padding:0 5px;margin:0 1px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#3c3c43);font:inherit;font-size:11px;line-height:18px;text-align:center'
const LINK = 'margin-left:8px;padding:0;border:0;background:none;color:var(--dsw-alias-link,#2f6fed);font:inherit;font-size:12px;cursor:pointer'

function titleOf(text) {
  return text.split(/[。！？\n]|[.!?](?=\s|$)/)[0].slice(0, 40)
}

function el(tag, style, text) {
  const node = document.createElement(tag)
  if (style) node.style.cssText = style
  if (text !== undefined) node.textContent = text
  return node
}

/** 记一段文字；返回记下的标题，没记上返回 null。回执由小窗自己显示，工作台的提示条就不再重复。 */
async function saveText(raw) {
  // 工作台还没打开过时先把状态读进来，撤销和列表才对得上
  if (!getDesk().state) await loadDesk()
  const { text, tags, url } = parseCapture(raw)
  if (url) {
    const id = await captureUrl(url, tags.length ? { tags } : {})
    if (!id) return null
    setDesk({ toast: null })
    return getDesk().state?.items.find(item => item.id === id)?.title || url
  }
  // 贴的是一个本地 Markdown 路径：读文件当正文。读不了就如实说，不做成一条只有路径的灵感
  if (looksLikeNotePath(text)) {
    try {
      const id = await captureFile(text)
      setDesk({ toast: null })
      return getDesk().state?.items.find(item => item.id === id)?.title || text
    } catch (err) {
      toast(err.message, { error: true })
      return null
    }
  }
  const title = titleOf(text)
  const result = await dispatchOps([{ op: 'add_item', kind: 'note', title, body: text, source: t('快捷键'), ...(tags.length ? { tags } : {}) }], { label: t('记下灵感'), silent: true })
  return result && !result.errors?.length ? title || text.slice(0, 40) : null
}

/** 小窗关掉之后，在页面底部留几秒「已记下 · 撤销」。 */
function showDone(text) {
  document.getElementById(DONE_ID)?.remove()
  const bar = el('div', 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:4px;max-width:calc(100vw - 32px);padding:9px 14px;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1c1c1e);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.16));font-family:var(--dsw-font-family,system-ui);font-size:13px;line-height:20px')
  bar.id = DONE_ID
  bar.setAttribute('role', 'status')
  const label = el('span', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text)
  const button = el('button', LINK, t('撤销'))
  button.type = 'button'
  let timer = setTimeout(() => bar.remove(), 6000)
  button.addEventListener('click', async () => {
    clearTimeout(timer)
    button.remove()
    await undo()
    label.textContent = t('已撤销')
    timer = setTimeout(() => bar.remove(), 2000)
  })
  bar.append(label, button)
  document.body.append(bar)
}

/** 打开输入框；已经开着就把焦点放回去。 */
export function openQuickCapture() {
  const existing = document.getElementById(ID)
  if (existing) { existing.querySelector('textarea')?.focus(); return }
  document.getElementById(DONE_ID)?.remove()
  const opener = document.activeElement
  const mask = el('div', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;padding-top:18vh;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.28));font-family:var(--dsw-font-family,system-ui)')
  mask.id = ID
  mask.setAttribute('role', 'dialog')
  mask.setAttribute('aria-modal', 'true')
  mask.setAttribute('aria-labelledby', `${ID}-title`)
  const box = el('form', 'width:min(560px,calc(100vw - 32px));padding:14px 18px 12px;border-radius:20px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1c1c1e);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.16))')
  const head = el('div', `display:flex;align-items:center;gap:8px;margin-bottom:6px;${MUTED}`)
  const title = el('strong', 'flex:1;color:var(--dsw-alias-label-secondary,#3c3c43);font-weight:600', t('记下一个灵感'))
  title.id = `${ID}-title`
  head.append(title, el('span', '', t('随时按 {keys} 打开', { keys: keysText(CAPTURE_KEY) })))
  const input = el('textarea', 'display:block;width:100%;box-sizing:border-box;border:0;outline:0;resize:none;background:none;color:inherit;font:inherit;font-size:16px;line-height:26px')
  input.rows = 3
  input.placeholder = t('想到什么就写什么。可以贴链接、粘贴图片，用 #标签 分类')
  input.setAttribute('aria-label', t('灵感内容'))
  input.setAttribute('aria-describedby', `${ID}-hint`)
  // 记下之后的回执和撤销
  const status = el('div', `display:none;align-items:center;margin-top:6px;${MUTED}`)
  status.setAttribute('role', 'status')
  const statusText = el('span', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap')
  const undoButton = el('button', LINK, t('撤销'))
  undoButton.type = 'button'
  status.append(statusText, undoButton)
  const hint = el('div', `margin-top:8px;${MUTED}`)
  hint.id = `${ID}-hint`
  const enter = t('回车')
  const keys = [[enter, t('记下')], [keysText({ code: 'Enter', modifiers: ['primary'] }), t('记下并接着记')], [keysText({ code: 'Enter', modifiers: ['shift'] }), t('换行')], ['Esc', t('关闭')]]
  keys.forEach(([key, what], index) => {
    if (index) hint.append(' · ')
    hint.append(el('kbd', KBD, key), ` ${what}`)
  })
  box.append(head, input, status, hint)
  mask.append(box)

  const setStatus = (text, { canUndo = false } = {}) => {
    status.style.display = text ? 'flex' : 'none'
    statusText.textContent = text
    undoButton.hidden = !canUndo
  }
  const close = () => {
    mask.remove()
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus()
  }
  const busy = (on) => {
    input.disabled = on
    if (on) setStatus(t('保存中…'))
  }
  const saved = (what, keepOpen) => {
    const text = t('已记下：{title}', { title: what })
    if (!keepOpen) { close(); showDone(text); return }
    input.value = ''
    busy(false)
    setStatus(text, { canUndo: true })
    input.focus()
  }
  const submit = async (keepOpen) => {
    const raw = input.value.trim()
    if (!raw) { if (!keepOpen) close(); return }
    busy(true)
    const what = await saveText(raw)
    if (what) { saved(what, keepOpen); return }
    busy(false)
    setStatus(t('没记上，再试一次'))
    input.focus()
  }
  undoButton.addEventListener('click', async () => {
    undoButton.hidden = true
    await undo()
    setStatus(t('已撤销'))
    input.focus()
  })
  box.addEventListener('submit', (event) => { event.preventDefault(); submit(false) })
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    submit(event.metaKey || event.ctrlKey)
  })
  // 剪贴板里有图片就直接存成图片灵感，小窗留着，可以接着写字
  input.addEventListener('paste', async (event) => {
    const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (!files.length) return
    event.preventDefault()
    busy(true)
    if (!getDesk().state) await loadDesk()
    const { tags } = parseCapture(input.value)
    const count = await captureFiles(files, tags.length ? { tags } : {})
    busy(false)
    if (count) {
      setDesk({ toast: null })
      setStatus(t(plural(count, '已记下 1 张图片', '已记下 {n} 张图片'), { n: count }), { canUndo: true })
    } else {
      setStatus(t('图片没存上，再试一次'))
    }
    input.focus()
  })
  // Esc 关闭；Tab 只在小窗里转，不跑到后面的页面上
  mask.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing) {
      event.stopPropagation()
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const stops = [...box.querySelectorAll('textarea, button')].filter(node => !node.hidden && !node.disabled && node.offsetParent !== null)
    if (!stops.length) return
    const at = stops.indexOf(document.activeElement)
    const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at === stops.length - 1 ? 0 : at + 1)
    event.preventDefault()
    stops[next].focus()
  })
  mask.addEventListener('pointerdown', (event) => { if (event.target === mask) close() })
  document.body.append(mask)
  input.focus()
}

/**
 * 向宿主登记快捷键（默认 ⌘/Ctrl + Shift + I，可在宿主的快捷键设置里改）。宿主没有快捷键服务时什么都不做。
 * @param {object} ctx - 宿主上下文。
 */
export function registerQuickCapture(ctx) {
  registerShortcut(ctx, {
    id: CAPTURE_ID,
    label: '记下一个灵感',
    aliases: ['idea', 'capture', '灵感'],
    binding: CAPTURE_KEY,
    regions: ['page', 'editable', 'terminal'],
    run: () => openQuickCapture(),
  })
}
