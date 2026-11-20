// 成稿之后的平台版本：公众号长文和图文卡片，左边写、右边实时预览，在工作区里直接复制、导出。
// 主题、骨架、封面来自言起 YANQI（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian），
// 言起基于 Note to RED（Yeban8090，MIT，https://github.com/Yeban8090/note-to-red）。
import React from 'react'
import { dispatchOps, hostImages, toast, useDesk } from '../desk.js'
import { t } from '../i18n.js'
import { Icon, Segmented } from '../ui.jsx'
import { CardsPreview, XHS_MAX_PAGES } from './cards-preview.jsx'
import { CardsDialog } from '../version-flow.jsx'
import { Credit, FontControls, ThemeEditor, ThemeGallery } from './controls.jsx'
import { usePrefs } from './prefs.js'
import { SplitFrame, articleSaver, useArticleDraft, useSettled } from './split.jsx'
import { localImages, renderWechat, wechatParts } from './wechat.js'
import { yanqiTheme } from './yanqi.js'

const MODES = [
  { value: 'draft', label: '正文' },
  { value: 'wechat', label: '长文' },
  { value: 'xhs', label: '图文卡片' },
]

/** 富文本写进剪贴板：优先用异步剪贴板，不行就选中一个看不见的可编辑块再复制。 */
async function copyRich(html, text) {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
      return
    }
  } catch { /* 没有剪贴板权限时退回旧办法 */ }
  const box = document.createElement('div')
  box.contentEditable = 'true'
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;opacity:0;pointer-events:none;'
  // html 由 renderWechat 生成，正文已全部转义
  box.innerHTML = html
  document.body.appendChild(box)
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(box)
  selection.removeAllRanges()
  selection.addRange(range)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    selection.removeAllRanges()
    box.remove()
  }
  if (!ok) throw new Error(t('浏览器不允许写入剪贴板'))
}

/** 长文的一个块：html 没变就不重画（改一处只动一块）。 */
const Block = React.memo(function Block({ html, line, onJump }) {
  // html 由 wechatParts 生成，正文已全部转义
  return <div className="md-wechat-block" data-line={line} onClick={() => onJump(line)} dangerouslySetInnerHTML={{ __html: html }} />
})

function WechatPreview({ production, title, itemId, onSave }) {
  const [prefs, update] = usePrefs('article')
  const [editorPrefs, setEditorPrefs] = usePrefs('editor')
  const custom = useDesk(s => s.state?.layoutThemes) ?? []
  const imageHost = useDesk(s => s.settings?.imageHost)
  const save = React.useMemo(() => onSave ?? articleSaver(itemId), [onSave, itemId])
  const draft = useArticleDraft(production.article ?? '', save)
  const locked = Boolean(editorPrefs.locked)
  const article = useSettled(draft.text, 150, locked)
  const [tab, setTab] = React.useState('source')
  const [editing, setEditing] = React.useState(false)
  const [draftTheme, setDraftTheme] = React.useState(null)
  const editorApi = React.useRef(null)
  const scroller = React.useRef(null)
  const figures = React.useMemo(() => (production.images ?? []).filter(image => image?.src).map(image => ({ src: image.src, caption: image.caption, anchor: image.anchor })), [production.images])
  const themes = React.useMemo(() => (draftTheme ? [...custom, draftTheme] : custom), [custom, draftTheme])
  const themeId = draftTheme ? draftTheme.id : prefs.theme
  // 预览按块渲染，带行号；data-line 放在外面那层，块的 html 不随行号变，改一处只重画一块
  const parts = React.useMemo(() => wechatParts(article, themeId, { font: prefs.font, fontSize: prefs.fontSize, themes, figures, images: 'preview' }), [article, themeId, prefs.font, prefs.fontSize, themes, figures])
  const [copying, setCopying] = React.useState(false)
  const local = React.useMemo(() => localImages(article, figures), [article, figures])

  const jump = React.useCallback((line) => {
    if (document.querySelector('.md-yq-split-card.is-tabs')) setTab('source')
    requestAnimationFrame(() => editorApi.current?.goto(line))
  }, [])

  // 光标跟随：滚到光标所在的块并闪一下
  const onCaret = React.useCallback((line) => {
    if (locked) return
    const nodes = [...(scroller.current?.querySelectorAll('.md-wechat-block') ?? [])]
    let best = null
    for (const node of nodes) if (Number(node.dataset.line) <= line) best = node
    if (!best) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // 只滚预览自己，不连带外面的容器
    const box = scroller.current
    const top = box.scrollTop + best.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2 + Math.min(best.offsetHeight, box.clientHeight) / 2
    box.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
    best.classList.remove('is-flash')
    requestAnimationFrame(() => best.classList.add('is-flash'))
  }, [locked])

  const copy = async () => {
    setCopying(true)
    try {
      // 公网图片原样带上；本地图片有图床时换成图床地址
      let images = {}
      let missing = []
      if (local.length && imageHost?.mode && imageHost.mode !== 'none') {
        // 本地图片先传到图床，换成公网地址再复制
        const result = await hostImages(local)
        images = result.urls
        missing = Object.keys(result.errors ?? {})
      }
      const out = wechatParts(draft.text, themeId, { font: prefs.font, fontSize: prefs.fontSize, themes, figures, images })
      const html = `<section style="${out.root}">${out.blocks.map(block => block.html).join('')}</section>`
      await copyRich(html, draft.text)
      const lost = [...new Set([...out.missing, ...missing.map(src => src.split('/').pop())])]
      if (lost.length) toast(t('已复制，但 {n} 张本地图片粘不进公众号：{names}。到设置里配好「图片上传」后再复制，或在公众号后台手动插图', { n: lost.length, names: lost.slice(0, 4).join('、') }), { error: true })
      else toast(t('已复制，粘贴到公众号编辑器会保留排版'))
    } catch (err) {
      toast(t('复制失败：{error}', { error: err.message }), { error: true })
    } finally {
      setCopying(false)
    }
  }

  const baseTheme = React.useMemo(() => {
    const mine = custom.find(theme => theme.id === prefs.theme)
    return mine ? { ...mine, mine: true } : yanqiTheme(prefs.theme)
  }, [custom, prefs.theme])
  const saveTheme = async (theme) => {
    const data = await dispatchOps([{ op: 'save_layout_theme', theme }], { label: t('保存排版主题'), silent: true })
    if (data && !data.errors?.length) {
      update({ theme: theme.id })
      setDraftTheme(null)
      setEditing(false)
      toast(t('已保存为我的主题「{name}」', { name: theme.name }))
    }
  }
  const deleteTheme = async (theme) => {
    if (!window.confirm(t('删除主题「{name}」？用到它的排版会换回默认主题。', { name: theme.name }))) return
    await dispatchOps([{ op: 'delete_layout_theme', id: theme.id }], { label: t('删除排版主题') })
    if (prefs.theme === theme.id) update({ theme: theme.base || undefined })
  }

  const panel = (
    <>
      {editing ? (
        <ThemeEditor key={baseTheme.id} base={baseTheme} onDraft={styles => setDraftTheme({ id: 'my-draft', name: t('编辑中'), styles })} onSave={saveTheme} onClose={() => { setEditing(false); setDraftTheme(null) }} onError={message => toast(message, { error: true })} />
      ) : (
        <ThemeGallery value={prefs.theme} font={prefs.font} custom={custom} onChange={theme => update({ theme })} onEdit={() => setEditing(true)} onDelete={deleteTheme} />
      )}
      <Credit />
    </>
  )
  const hostMode = imageHost?.mode ?? 'none'
  const meta = local.length
    ? (hostMode === 'none' ? <span className="md-yq-warn" title={local.join('\n')}>{t('{n} 张本地图片复制时会丢，可在设置里配图床', { n: local.length })}</span> : t('{n} 张本地图片会先传到{host}', { n: local.length, host: hostMode === 'wechat' ? t('公众号素材库') : t('自定义图床') }))
    : t('标题和封面在公众号后台单独填')
  const preview = (
    <div ref={scroller} className="md-layout-scroll">
      <article className="md-wechat-paper">
        <h1 className="md-wechat-title">{title}</h1>
        <div className="md-wechat-body">
          <section style={Object.fromEntries(parts.root.split(';').map(decl => decl.trim()).filter(Boolean).map((decl) => {
            const at = decl.indexOf(':')
            return [decl.slice(0, at).trim().replace(/-([a-z])/g, (m, c) => c.toUpperCase()), decl.slice(at + 1).trim()]
          }))}
          >
            {parts.blocks.map((block, i) => <Block key={i} html={block.html} line={block.line} onJump={jump} />)}
          </section>
        </div>
      </article>
    </div>
  )
  return (
    <SplitFrame
      label={t('公众号长文')}
      title={t('公众号长文')}
      meta={meta}
      panel={panel}
      previewBar={<FontControls font={prefs.font} size={prefs.fontSize} onFont={font => update({ font })} onSize={fontSize => update({ fontSize })} />}
      preview={preview}
      draft={draft}
      editorPrefs={editorPrefs}
      setEditorPrefs={setEditorPrefs}
      onCaret={onCaret}
      editorApi={editorApi}
      tab={tab}
      setTab={setTab}
      actions={<button type="button" className="md-pill is-primary" onClick={copy} disabled={copying || !draft.text}><Icon name="copy" size={14} />{copying ? t('上传图片中…') : t('复制到公众号')}</button>}
    />
  )
}

/**
 * 整篇正文切出来超过 18 张：小红书一篇笔记放不下。有小红书版本的图片版（精简过的卡片文字）就直接打开它，
 * 还没有就带去平台版本生成一个。
 */
function XhsLimitNote({ count, production, title, itemId, onOpenVersions }) {
  const [open, setOpen] = React.useState(false)
  const version = production.versions?.['小红书']
  const cards = version?.status === 'done' ? String(version.cards ?? '').trim() : ''
  return (
    <div className="md-yq-limit" role="note">
      <Icon name="image" size={14} />
      <p>{t('整篇正文切出来 {n} 张，小红书一篇笔记最多放 {max} 张。', { n: count, max: XHS_MAX_PAGES })}<span>{cards ? t('小红书版本里有一份精简过的图片版，用它更合适。') : t('可以先生成小红书版本，它会把正文压成一组精简的卡片。')}</span></p>
      {cards
        ? <button type="button" className="md-pill is-primary" onClick={() => setOpen(true)}>{t('打开小红书图片版')}</button>
        : onOpenVersions ? <button type="button" className="md-pill is-primary" onClick={onOpenVersions}>{t('去生成小红书版本')}</button> : null}
      {open ? <CardsDialog title={version.title || title} cards={version.cards} itemId={itemId} onClose={() => setOpen(false)} /> : null}
    </div>
  )
}

/** 正文 / 长文 / 图文卡片 的切换。 */
export function LayoutSwitch({ value, onChange }) {
  return (
    <div className="md-layout-bar">
      <Segmented label={t('平台版本')} value={value} onChange={onChange} options={MODES.map(mode => ({ value: mode.value, label: t(mode.label) }))} />
    </div>
  )
}

/** 平台版本的预览区，替换掉稿面的格子。itemId 用来保存左边改过的正文和每篇自己的图片调整。 */
export function LayoutPreview({ mode, production, title, itemId, onOpenVersions }) {
  if (mode === 'wechat') return <WechatPreview production={production} title={title} itemId={itemId} />
  if (mode === 'xhs') return <CardsPreview production={production} title={title} itemId={itemId} overLimit={count => <XhsLimitNote count={count} production={production} title={title} itemId={itemId} onOpenVersions={onOpenVersions} />} />
  return null
}

export { renderWechat }
