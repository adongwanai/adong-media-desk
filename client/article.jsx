// 稿面上的文章格：默认显示渲染好的 Markdown，可以切到编辑（纯文本框）。长稿先渲染前一段，按需展开。
import React from 'react'
import { advanceStream } from './stream-text.js'
import { creationFormat } from '../src/creation.js'
import { dispatchOps, toast, useDesk } from './desk.js'
import { DshChatButton } from './dsh-chat.jsx'
import { plural, t } from './i18n.js'
import { markdownPlain, renderMarkdown, splitForPreview } from './md-render.js'
import { Plate, askAbout } from './studio-kit.jsx'
import { Icon, IconButton } from './ui.jsx'
import { textLength } from './util.js'

// 一次先渲染这么多字，再长的点「展开全文」
const FIRST_CHUNK = 12000

/** 渲染好的 Markdown。renderMarkdown 先转义再加标签，链接和图片地址过白名单，模型输出或导入稿里的 HTML 不会执行。 */
function MarkdownView({ text, title, className }) {
  const [all, setAll] = React.useState(false)
  const ref = React.useRef(null)
  const missing = t('本地图片，预览里看不到')
  const { html, rest } = React.useMemo(() => {
    const parts = splitForPreview(text, all ? Number.POSITIVE_INFINITY : FIRST_CHUNK)
    return { html: renderMarkdown(parts.head, { missingImage: missing, dropTitle: title }), rest: parts.rest }
  }, [text, all, title, missing])
  // 远程图片读不到时换成说明文字，不留一个破图标
  React.useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const onError = (event) => {
      const img = event.target
      if (img?.tagName !== 'IMG') return
      const note = document.createElement('span')
      note.className = 'md-read-noimg'
      note.title = img.getAttribute('src') ?? ''
      note.textContent = img.alt || note.title.split('/').pop()
      const small = document.createElement('small')
      small.textContent = t('图片读不到')
      note.appendChild(small)
      img.replaceWith(note)
    }
    el.addEventListener('error', onError, true)
    return () => el.removeEventListener('error', onError, true)
  }, [])
  const left = rest ? textLength(markdownPlain(rest)) : 0
  return (
    <>
      <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
      {rest ? (
        <button type="button" className="md-read-more" onClick={() => setAll(true)}>
          {t('展开全文')}<span>{t('还有约 {n} 字', { n: left.toLocaleString(), s: plural(left, '', 's') })}</span><Icon name="chevD" size={14} />
        </button>
      ) : null}
    </>
  )
}

/** 把配图插回文章：优先放到对应小标题那一节的末尾。 */
function ArticleBody({ production, text, onView, proseClass }) {
  const sections = React.useMemo(() => text.split(/\n(?=##\s)/).map(part => ({ text: part, heading: /^##\s+(.+)/.exec(part)?.[1]?.trim() ?? '' })), [text])
  const images = production?.images ?? []
  const placed = React.useMemo(() => {
    const map = new Map()
    images.forEach((image, i) => {
      if (!image.src) return
      let at = sections.findIndex(s => image.anchor && s.heading === image.anchor)
      if (at < 0) at = Math.min(sections.length - 1, Math.round(((i + 1) * sections.length) / (images.length + 1)))
      if (!map.has(at)) map.set(at, [])
      map.get(at).push({ image, i })
    })
    return map
  }, [images, sections])
  return (
    <>
      {sections.map((section, index) => (
        <React.Fragment key={index}>
          {/* renderMarkdown 会先转义，模型输出里的 HTML 不会执行 */}
          <div className={proseClass} dangerouslySetInnerHTML={{ __html: renderMarkdown(section.text, { missingImage: t('本地图片，预览里看不到') }) }} />
          {(placed.get(index) ?? []).map(({ image, i }) => (
            <figure key={i} className="md-article-figure">
              <Plate asset={image} alt={image.caption} onOpen={() => onView(`image:${i}`)} />
              {image.caption ? <figcaption>{image.caption}</figcaption> : null}
            </figure>
          ))}
        </React.Fragment>
      ))}
    </>
  )
}

/** 预览 / 编辑 的切换。 */
function ModeSwitch({ editing, onChange }) {
  return (
    <div className="md-mini-seg" role="radiogroup" aria-label={t('显示方式')}>
      <button type="button" role="radio" aria-checked={!editing} className={!editing ? 'is-on' : ''} onClick={() => onChange(false)}><Icon name="eye" size={13} />{t('预览')}</button>
      <button type="button" role="radio" aria-checked={editing} className={editing ? 'is-on' : ''} onClick={() => onChange(true)}><Icon name="edit" size={13} />{t('编辑')}</button>
    </div>
  )
}

export function ArticleTile({ item, live, open, onToggle, onView, tileRef }) {
  const native = useDesk(s => s.nativeAgent)
  const production = item.production
  const running = production?.status === 'running'
  const scroller = React.useRef(null)
  const [editing, setEditing] = React.useState(false)
  const [picked, setPicked] = React.useState(null)
  const article = production?.article ?? ''
  const [draft, setDraft] = React.useState(article)
  React.useEffect(() => setDraft(article), [article])
  const nativeText = live?.native && (live.drafts?.article || live.drafts?.spoken) ? live.text : null
  const targetText = nativeText ?? (article || (live?.text ?? '').replace(/^\s*#\s+.*\n?/, ''))
  const streaming = nativeText !== null || (running && !article)
  React.useEffect(() => { if (streaming) setEditing(false) }, [streaming])
  const [shown, setShown] = React.useState(targetText)
  React.useEffect(() => {
    if (!streaming || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(targetText); return }
    const timer = setInterval(() => setShown(current => advanceStream(current, targetText, true)), 24)
    return () => clearInterval(timer)
  }, [targetText, streaming])
  const text = streaming ? shown : targetText
  React.useEffect(() => {
    if (streaming && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [text, streaming])
  // 写完之后回到开头，从第一句读起
  React.useEffect(() => {
    if (article && scroller.current) scroller.current.scrollTop = 0
  }, [Boolean(article)]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (draft !== article) dispatchOps([{ op: 'update_production', id: item.id, article: draft }], { label: t('修改正文'), silent: true })
  }
  const setMode = (next) => {
    if (!next) commit()
    setEditing(next)
  }
  const copy = async () => {
    await navigator.clipboard.writeText(`# ${production?.title || item.title}\n\n${article}`)
    toast(production?.format === 'article' ? t('正文已复制') : t('脚本已复制'))
  }
  // 选中一段，交给助手改
  const onMouseUp = () => {
    const selection = window.getSelection()
    const value = selection?.toString().trim()
    if (!value || value.length < 4 || !article || !scroller.current?.contains(selection.anchorNode)) {
      setPicked(null)
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    const box = tileRef.current.getBoundingClientRect()
    setPicked({ text: value, x: Math.max(70, Math.min(rect.left - box.left + rect.width / 2, box.width - 70)), y: rect.top - box.top })
  }
  const source = editing ? draft : text
  const words = React.useMemo(() => textLength(markdownPlain(source)), [source])
  // 正在写和写好的稿子看它自己的体裁；还没写的看当前选的
  const isArticle = (production?.format ?? creationFormat(item, 'article')) === 'article'
  const name = isArticle ? t('正文') : t('脚本')
  const heading = production?.title || item.title
  const proseClass = `md-read ${isArticle ? 'is-article' : 'is-script'}`
  const figures = (production?.images ?? []).some(image => image?.src)
  return (
    <>
      <header className="md-tile-head">
        <h2>{name}</h2>
        {words ? <span className="md-tile-meta">{t('{n} 字', { n: words.toLocaleString(), s: plural(words, '', 's') })}</span> : null}
        <span className="md-grow" />
        {article && !streaming ? (
          <>
            <ModeSwitch editing={editing} onChange={setMode} />
            <span className="md-tile-head-sep" aria-hidden="true" />
            {!native ? <DshChatButton item={item} /> : null}
            <IconButton icon="copy" label={isArticle ? t('复制正文') : t('复制脚本')} onClick={copy} />
            <IconButton icon={open ? 'shrink' : 'expand'} label={open ? t('收起') : t('放大阅读')} onClick={onToggle} />
          </>
        ) : null}
      </header>
      {editing ? (
        // 边改边看：左边改，右边跟着渲染，不用来回切
        <div className="md-article-split">
          <div className="md-article-edit-wrap is-split">
            <textarea className="md-article-edit" aria-label={name} value={draft} spellCheck={false} onChange={e => setDraft(e.target.value)} onBlur={commit} />
          </div>
          <div className="md-article-scroll is-split" ref={scroller}>
            <div className="md-article">
              <MarkdownView text={draft} title={heading} className={proseClass} />
            </div>
          </div>
        </div>
      ) : text ? (
        <div className="md-article-scroll" ref={scroller} onMouseUp={onMouseUp} onScroll={() => setPicked(null)}>
          <div className="md-article">
            {/* 稿面上方已经有大标题；放大阅读时盖住了它，这里再写一遍 */}
            {open ? <h1 className="md-article-title">{heading}</h1> : null}
            {streaming ? <span className="md-stream-cursor" aria-label={t('正在写…')} /> : null}
            {open && figures ? <ArticleBody production={production} text={text} onView={onView} proseClass={proseClass} /> : <MarkdownView text={text} title={heading} className={proseClass} />}
          </div>
        </div>
      ) : (
        <div className={`md-skeleton ${running ? '' : 'is-still'}`} aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
      )}
      {picked ? (
        <button type="button" className="md-pick" style={{ left: picked.x, top: picked.y }} onMouseDown={e => e.preventDefault()} onClick={() => {
          askAbout(t('这段'), picked.text)
          setPicked(null)
          window.getSelection()?.removeAllRanges()
        }}><Icon name="chat" size={12} />{t('让助手改这段')}</button>
      ) : null}
    </>
  )
}
