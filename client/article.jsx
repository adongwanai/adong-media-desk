// 稿面上的文章格：默认显示渲染好的 Markdown，可以切到编辑（纯文本框）。长稿先渲染前一段，按需展开。
import React from 'react'
import { advanceStream } from './stream-text.js'
import { creationFormat } from '../src/creation.js'
import { autoAnnotateHighlights, HUMANIZE_SKILL_PROMPT } from '../src/draft-quality.js'
import { dispatchOps, rewriteSelection, sendChat, setDesk, toast, uploadAttachment, useDesk } from './desk.js'
import { clipboardImageFiles, normalizePastedImage } from './layouts/editor.jsx'
import { DshChatButton } from './dsh-chat.jsx'
import { plural, t } from './i18n.js'
import { markdownPlain, renderMarkdown, splitForPreview } from './md-render.js'
import { Plate, askAbout } from './studio-kit.jsx'
import { Icon, IconButton } from './ui.jsx'
import { fmtWhen, textLength } from './util.js'

/** 在 Markdown 原文里定位渲染后选中的纯文本片段并替换（兼容粗体、高亮等行内记号）。 */
function replaceSnippetInMarkdown(markdown, snippet, replacement) {
  const clean = String(snippet ?? '').trim()
  if (!clean) return null
  if (markdown.includes(clean)) return markdown.replace(clean, replacement)
  // 按标点或空白切出首尾锚点，在同一个自然段里匹配
  const blocks = markdown.split(/(\n\s*\n)/)
  for (let i = 0; i < blocks.length; i += 2) {
    const plain = markdownPlain(blocks[i]).replace(/\s+/g, ' ').trim()
    const target = clean.replace(/\s+/g, ' ').trim()
    if (!plain || !plain.includes(target)) continue
    if (plain === target) {
      const heading = /^(#{1,6}\s+)/.exec(blocks[i])?.[1] ?? ''
      blocks[i] = heading + replacement
      return blocks.join('')
    }
    // 段内局部选中：用转义后的字符序列允许中间夹带 ** / == / ` 记号
    const chars = Array.from(clean.trim()).map(ch => (/\s/.test(ch) ? '\\s+' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const pattern = new RegExp(chars.join('(?:[*_=`~]{0,2})'))
    if (pattern.test(blocks[i])) {
      blocks[i] = blocks[i].replace(pattern, () => replacement)
      return blocks.join('')
    }
  }
  return null
}

/** 按自然段做轻量 LCS 对比，用于历史快照与 AI 改稿的红绿对照预览。 */
function diffBlocks(beforeText, afterText) {
  const split = s => String(s ?? '').trim().split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const a = split(beforeText)
  const b = split(afterText)
  const m = a.length
  const n = b.length
  if (m * n > 40000) {
    return [{ kind: 'del', text: beforeText }, { kind: 'add', text: afterText }]
  }
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i += 1; j += 1 }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: 'del', text: a[i] }); i += 1 }
    else { out.push({ kind: 'add', text: b[j] }); j += 1 }
  }
  while (i < m) { out.push({ kind: 'del', text: a[i] }); i += 1 }
  while (j < n) { out.push({ kind: 'add', text: b[j] }); j += 1 }
  return out
}

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

function summarizeToolDetail(detail) {
  const raw = String(detail ?? '').trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const val = parsed.url || parsed.query || parsed.path || parsed.file_path || parsed.command || ''
    if (val) return String(val).replace(/\s+/g, ' ').slice(0, 68)
  } catch { /* plain string */ }
  return raw.replace(/\s+/g, ' ').slice(0, 68)
}

function stageToolName(name) {
  const n = String(name ?? '')
  if (/search|web|fetch|browse|tavily|curl/i.test(n)) return t('联网检索与抓取')
  if (/read|file|pdf|doc|view|cat|glob|grep/i.test(n)) return t('读取附件与规范')
  if (/bash|exec|run|shell|terminal|node|python/i.test(n)) return t('执行工具与下载配图')
  return n || t('调用能力')
}

/** 正文还未流出来之前的实时成稿看板：明确告知当前走到哪一步、读了什么资料、搜了什么信源，不再只摆一排死灰骨架条。 */
function LiveDraftingStage({ item, live, production }) {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const startedMs = live?.startedAt ?? (production?.startedAt ? Date.parse(production.startedAt) : now)
  const seconds = Math.max(0, Math.floor((now - (Number.isFinite(startedMs) ? startedMs : now)) / 1000))
  const goal = item.creation?.goal ?? 'xhs'
  const phase = live?.phase || (production?.stage === 'connecting' ? 'connecting' : 'waiting')
  const activity = live?.activity ?? []
  const reasoning = String(live?.reasoning ?? '').trim()
  const replyPreview = String(live?.reply ?? '').trim()

  const headline = phase === 'connecting'
    ? t('正在连接原生会话，加载个人风格与写作规范…')
    : phase === 'tool'
      ? t('正在解析参考附件与检索一手信源…')
      : phase === 'reasoning'
        ? t('正在构思切入角度与章节结构…')
        : phase === 'writing'
          ? t('正在输出成稿内容，马上呈现在纸面…')
          : t('已提交选题要求，正在准备成稿…')

  const nodes = [
    { label: t('加载风格'), done: phase !== 'connecting', active: phase === 'connecting' },
    { label: t('解析与检索'), done: phase === 'reasoning' || phase === 'writing', active: phase === 'waiting' || phase === 'tool' },
    { label: goal === 'xhs' ? t('撰写图文稿') : goal === 'script' ? t('撰写口播稿') : t('撰写长文'), done: false, active: phase === 'reasoning' || phase === 'writing' },
    { label: goal === 'xhs' ? t('切分小红书卡片') : t('版式规整'), done: false, active: false },
  ]

  const recentTools = activity.slice(-4).reverse()
  const thoughtTail = reasoning ? reasoning.slice(-220) : replyPreview ? replyPreview.slice(-180) : ''

  return (
    <div className="md-live-stage" role="status" aria-live="polite">
      <div className="md-live-stage-card">
        <div className="md-live-stage-top">
          <span className="md-live-dot" aria-hidden="true" />
          <h3 className="md-shimmer">{headline}</h3>
          <span className="md-live-stage-sec">{seconds}s</span>
        </div>

        <div className="md-live-track" aria-hidden="true">
          {nodes.map((node, i) => (
            <div key={i} className={`md-live-node ${node.done ? 'is-done' : node.active ? 'is-active' : ''}`}>
              <i>{node.done ? <Icon name="check" size={10} stroke={2.6} /> : i + 1}</i>
              <span>{node.label}</span>
            </div>
          ))}
        </div>

        {recentTools.length > 0 ? (
          <ul className="md-live-tools">
            {recentTools.map((row, idx) => {
              const detail = summarizeToolDetail(row.detail)
              return (
                <li key={row.id || idx} className={`is-${row.status || 'running'}`}>
                  <span className="md-live-tool-badge">{row.status === 'running' ? t('进行中') : row.status === 'failed' ? t('跳过') : t('已完成')}</span>
                  <b>{stageToolName(row.name)}</b>
                  {detail ? <code>{detail}</code> : null}
                </li>
              )
            })}
          </ul>
        ) : null}

        {thoughtTail ? (
          <div className="md-live-thought">
            <span>{reasoning ? t('实时构思') : t('实时进展')}</span>
            <p>{thoughtTail.length >= 180 ? `…${thoughtTail}` : thoughtTail}</p>
          </div>
        ) : null}
      </div>

      <div className="md-skeleton is-compact" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => <i key={i} />)}
      </div>
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
  const [customOpen, setCustomOpen] = React.useState(false)
  const [customPrompt, setCustomPrompt] = React.useState('')
  const [rewriting, setRewriting] = React.useState(false)
  const [pendingDiff, setPendingDiff] = React.useState(null)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [selectedRevId, setSelectedRevId] = React.useState(null)
  const article = production?.article ?? ''
  const revisions = production?.revisions ?? []
  React.useEffect(() => {
    setPicked(null)
    setPendingDiff(null)
    setHistoryOpen(false)
    setSelectedRevId(null)
  }, [item.id])
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
    setCustomOpen(false)
    setCustomPrompt('')
    setPicked({ text: value, x: Math.max(140, Math.min(rect.left - box.left + rect.width / 2, box.width - 140)), y: Math.max(44, rect.top - box.top) })
  }

  const runSurgicalRewrite = async (mode, instruction = '') => {
    if (!picked?.text || rewriting) return
    const targetSnippet = picked.text
    setRewriting(true)
    const res = await rewriteSelection(item.id, { selection: targetSnippet, mode, instruction })
    setRewriting(false)
    if (!res?.replacement) return
    setPicked(null)
    window.getSelection()?.removeAllRanges()
    setPendingDiff({ original: targetSnippet, replacement: res.replacement, mode, instruction })
  }

  const applyPendingDiff = async () => {
    if (!pendingDiff) return
    const nextArticle = replaceSnippetInMarkdown(article, pendingDiff.original, pendingDiff.replacement)
    if (!nextArticle) {
      await navigator.clipboard.writeText(pendingDiff.replacement)
      toast(t('原文包含跨段复杂格式，已将改写结果复制到剪贴板，可切到编辑粘贴'))
      setPendingDiff(null)
      return
    }
    const modeLabel = { humanize: '局部去 AI 味', shorten: '局部精简', punchy: '局部提炼', clarify: '局部理顺', custom: '局部定向改写' }[pendingDiff.mode] ?? '局部改写'
    await dispatchOps([{ op: 'update_production', id: item.id, article: nextArticle, by: 'ai', snapshot: true, reason: modeLabel }], { label: t(modeLabel) })
    setPendingDiff(null)
  }

  const activeRev = revisions.find(r => r.id === selectedRevId) ?? revisions.at(-1) ?? null
  const revDiff = React.useMemo(() => (historyOpen && activeRev ? diffBlocks(activeRev.article, article) : []), [historyOpen, activeRev, article])
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
            {isArticle ? (
              <button
                type="button"
                className="md-pill is-small"
                title={t('自动为文稿补齐加蓝加粗（**…**）与加黄荧光笔（==…==）重点标注')}
                onClick={async () => {
                  const currentText = editing ? draft : article
                  const res = autoAnnotateHighlights(currentText, { goal: item.creation?.goal || 'xhs', force: true })
                  if (!res.changed) {
                    toast(t('当前稿件已有充足的加蓝加粗与加黄高亮标注'))
                    return
                  }
                  if (editing) setDraft(res.text)
                  await dispatchOps([{ op: 'update_production', id: item.id, article: res.text, snapshot: true, reason: '自动标注重点前' }], { label: t('自动标注重点') })
                  toast(t('已自动标注 {b} 处加蓝加粗、{m} 处加黄高亮', { b: res.addedBold, m: res.addedMark }))
                }}
              >
                <Icon name="spark" size={12} />{t('自动标注重点')}
              </button>
            ) : null}
            <button
              type="button"
              className="md-pill is-small"
              title={t('调用 Humanizer Skill（中文 22 特征 + 结构去 AI 味）对全文精修去 AI 腔，保留事实与配图')}
              onClick={async () => {
                if (editing) await commit()
                setDesk({ studioDock: true })
                await sendChat(HUMANIZE_SKILL_PROMPT, { itemId: item.id })
              }}
            >
              <Icon name="spark" size={12} />{t('Humanizer 去AI味')}
            </button>
            {revisions.length > 0 ? (
              <button
                type="button"
                className={`md-pill is-small ${historyOpen ? 'is-on' : ''}`}
                aria-expanded={historyOpen}
                title={t('查看稿件历史快照与红绿修改对比，随时一键回滚')}
                onClick={() => { setHistoryOpen(v => !v); setSelectedRevId(revisions.at(-1)?.id ?? null) }}
              >
                <Icon name="clock" size={12} />{t('历史')} ({revisions.length})
              </button>
            ) : null}
            <span className="md-tile-head-sep" aria-hidden="true" />
            {!native ? <DshChatButton item={item} /> : null}
            <IconButton icon="copy" label={isArticle ? t('复制正文') : t('复制脚本')} onClick={copy} />
            <IconButton icon={open ? 'shrink' : 'expand'} label={open ? t('收起') : t('放大阅读')} onClick={onToggle} />
          </>
        ) : null}
      </header>
      {pendingDiff ? (
        <div className="md-inline-diff" role="region" aria-label={t('局部改写预览')}>
          <div className="md-inline-diff-head">
            <b><Icon name="spark" size={13} />{t('局部改写对照预览')}</b>
            <span className="md-muted">{t('确认无误后再写回正文，不影响其余段落')}</span>
            <span className="md-grow" />
            <button type="button" className="md-btn is-small" disabled={rewriting} onClick={ async () => {
              setRewriting(true)
              const res = await rewriteSelection(item.id, { selection: pendingDiff.original, mode: pendingDiff.mode, instruction: pendingDiff.instruction })
              setRewriting(false)
              if (res?.replacement) setPendingDiff(prev => (prev ? { ...prev, replacement: res.replacement } : null))
            }}><Icon name="refresh" size={12} />{rewriting ? t('重写中…') : t('换一版')}</button>
            <button type="button" className="md-btn is-small" onClick={() => setPendingDiff(null)}>{t('放弃')}</button>
            <button type="button" className="md-btn is-small is-primary" onClick={applyPendingDiff}><Icon name="check" size={12} />{t('采纳替换')}</button>
          </div>
          <div className="md-inline-diff-body">
            <del className="md-diff-del">{pendingDiff.original}</del>
            <ins className="md-diff-add">{pendingDiff.replacement}</ins>
          </div>
        </div>
      ) : null}
      {historyOpen && activeRev ? (
        <div className="md-rev-drawer" role="region" aria-label={t('版本快照对比')}>
          <div className="md-rev-bar">
            <select aria-label={t('选择历史快照')} value={activeRev.id} onChange={e => setSelectedRevId(e.target.value)}>
              {[...revisions].reverse().map((rev, idx) => (
                <option key={rev.id} value={rev.id}>{t('{label} · {time}', { label: t(rev.label || '历史快照'), time: fmtWhen(rev.at) })}{idx === 0 ? ` (${t('最近')})` : ''}</option>
              ))}
            </select>
            <span className="md-muted">{t('红色为该旧版原有、绿色为当前新增')}</span>
            <span className="md-grow" />
            <button
              type="button"
              className="md-btn is-small is-primary"
              onClick={async () => {
                await dispatchOps([{ op: 'update_production', id: item.id, article: activeRev.article, title: activeRev.title, snapshot: true, reason: '回滚历史版本前' }], { label: t('恢复历史版本') })
                setHistoryOpen(false)
              }}
            >
              <Icon name="undo" size={12} />{t('恢复到此版本')}
            </button>
            <IconButton icon="close" size={13} label={t('关闭历史对比')} onClick={() => setHistoryOpen(false)} />
          </div>
          <div className="md-rev-diff-scroll">
            {revDiff.map((part, idx) => (
              <p key={idx} className={`md-rev-line is-${part.kind}`}>{part.text}</p>
            ))}
          </div>
        </div>
      ) : editing ? (
        // 边改边看：左边改，右边跟着渲染，不用来回切
        <div className="md-article-split">
          <div className="md-article-edit-wrap is-split">
            <textarea
              className="md-article-edit"
              aria-label={name}
              value={draft}
              spellCheck={false}
              onChange={e => setDraft(e.target.value)}
              onPaste={async (e) => {
                const imgs = clipboardImageFiles(e.clipboardData)
                if (!imgs.length) return
                e.preventDefault()
                const el = e.currentTarget
                const start = el.selectionStart ?? draft.length
                const end = el.selectionEnd ?? draft.length
                toast(t('正在插入图片…'))
                try {
                  const mdLines = []
                  for (let i = 0; i < imgs.length; i += 1) {
                    const { file, alt } = normalizePastedImage(imgs[i], i)
                    const res = await uploadAttachment(file)
                    if (res?.src) mdLines.push(`![${alt}](/${String(res.src).replace(/^\/+/, '')})`)
                  }
                  if (mdLines.length) {
                    const before = draft.slice(0, start)
                    const after = draft.slice(end)
                    const padB = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
                    const padA = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
                    setDraft(`${before}${padB}${mdLines.join('\n\n')}${padA}${after}`)
                    toast(mdLines.length > 1 ? t('已插入 {n} 张图片', { n: mdLines.length }) : t('已插入图片'))
                  }
                } catch (err) {
                  toast(err.message || t('图片插入失败'), { error: true })
                }
              }}
              onBlur={commit}
            />
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
      ) : running ? (
        <LiveDraftingStage item={item} live={live} production={production} />
      ) : (
        <div className="md-skeleton is-still" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
      )}
      {picked ? (
        <div className="md-pick-bar" style={{ left: picked.x, top: picked.y }} onMouseDown={e => e.preventDefault()}>
          {rewriting ? (
            <span className="md-pick-busy"><span className="md-shimmer">{t('正在改写选中段…')}</span></span>
          ) : customOpen ? (
            <form className="md-pick-form" onSubmit={(e) => { e.preventDefault(); if (customPrompt.trim()) runSurgicalRewrite('custom', customPrompt.trim()) }}>
              <input
                type="text"
                autoFocus
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder={t('这段怎么改？回车生成')}
                onKeyDown={e => { if (e.key === 'Escape') setCustomOpen(false) }}
              />
              <button type="submit" disabled={!customPrompt.trim()}>{t('生成')}</button>
            </form>
          ) : (
            <>
              <button type="button" onClick={() => runSurgicalRewrite('humanize')} title={t('去掉套话和连接词，只改选中这段')}><Icon name="spark" size={12} />{t('去AI味')}</button>
              <button type="button" onClick={() => runSurgicalRewrite('shorten')} title={t('保留核心事实，精简篇幅')}>{t('精简')}</button>
              <button type="button" onClick={() => runSurgicalRewrite('punchy')} title={t('提炼得更有力量感、适合划线')}>{t('更抓人')}</button>
              <button type="button" onClick={() => setCustomOpen(true)}>{t('指令…')}</button>
              <i aria-hidden="true" />
              <button type="button" onClick={() => {
                askAbout(t('这段'), picked.text)
                setPicked(null)
                window.getSelection()?.removeAllRanges()
              }}><Icon name="chat" size={12} />{t('问助手')}</button>
            </>
          )}
        </div>
      ) : null}
    </>
  )
}
