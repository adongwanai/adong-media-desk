// 发布：成稿之后按平台一步步去发。工作台只复制内容、准备草稿；唯一的例外是公众号，每次在确认框里点了确认才公开发布。
import React from 'react'
import { PlatformMark } from './board.jsx'
import { openInBrowser } from './browser.js'
import { dispatchOps, getDesk, openItem, pushWechatDraft, setDesk, toast, useDesk } from './desk.js'
import { plural, t, useLang } from './i18n.js'
import { Dialog, Empty, Icon, Segmented, Swap } from './ui.jsx'
import { Poster, useProgressive } from './lazy.jsx'
import { typeCover } from './cover.js'
import { PLATFORMS, PLATFORM_URL, fmtWhen, isPublished, isPublishable, publishPhase } from './util.js'
import { checkDraft, countFindings } from './checks.js'
import { ChecksPanel, plainBody, readyVersion, tagLine, useActiveStyle } from './versions.jsx'
import { readPrefs, usePrefs } from './layouts/prefs.js'
import { WechatPublishControls, WechatPublishDialog } from './publish-wechat.jsx'
import { SyncDraftsDialog } from './publish-sync.jsx'
import { CardsButton } from './version-flow.jsx'
import { FillDraftButton, FillDraftDialog } from './publish-fill.jsx'

// 中文原文，显示时再翻译
const STATE_LABEL = { none: '待发布', copied: '已复制去发布', drafted: '已推草稿', published: '已发布' }
const STATE_ICON = { copied: 'copy', drafted: 'save', published: 'check' }
const WECHAT = '公众号'

// 大屏上没选平台时默认看的四个，和大屏一致
const COMMON = ['公众号', '小红书', '抖音', 'B站']

const finishedAt = item => Date.parse(item.production?.finishedAt ?? item.production?.startedAt ?? item.createdAt) || 0
const stateOf = (item, platform) => item.publish?.[platform]?.state ?? 'none'

/** 粘到各平台编辑器里的纯文本：去掉 Markdown 标记，本地图片的引用也去掉。 */
function plainText(markdown) {
  return String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))
    .map(line => line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/==([^=]+)==/g, '$1'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 公众号排版由 layouts/wechat.js 提供，按需加载；加载不到时退回纯文本。prefs 是用户记住的长文主题、字体和字号。 */
async function wechatHtml(markdown, prefs) {
  try {
    const layout = await import('./layouts/wechat.js')
    return typeof layout.renderWechat === 'function'
      ? layout.renderWechat(String(markdown ?? ''), prefs?.theme, {
        font: prefs?.font,
        fontSize: prefs?.fontSize,
        themes: prefs?.themes,
        figures: prefs?.figures,
        images: prefs?.images,
        linkFootnotes: Boolean(prefs?.linkFootnotes),
      })
      : null
  } catch {
    return null
  }
}

async function copyRich(html, text) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
    return true
  } catch {
    return false
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 剪贴板接口被拦时退回老办法
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

/** 去发布时复制的内容：有这个平台的版本就用版本，没有就用正文。 */
function publishDraft(item, platform) {
  const production = item.production
  const version = readyVersion(item, platform)
  // 小红书的 body 是正文框里的那段，图片版 cards 另外导出成图片
  if (version) return { from: 'version', title: version.title, body: plainBody(version.body), markdown: version.body, cards: version.cards, tags: version.tags ?? [], firstComment: version.firstComment }
  return { from: 'mother', title: production.title || item.title, body: plainText(production.article), markdown: production.article, tags: [] }
}

/** 复制标题和正文，再打开平台的发布页；只记一笔「已复制去发布」，已经往后走过的状态不退回。 */
async function goPublish(item, platform) {
  const draft = publishDraft(item, platform)
  const text = [draft.title, draft.body, tagLine(draft.tags)].filter(Boolean).join('\n\n')
  // 公众号编辑器认 HTML：同步使用「长文」页记住的主题、字体、字号、自定义主题与外链转脚注设置
  const articlePrefs = platform === WECHAT
    ? {
      ...readPrefs('article'),
      themes: getDesk().state?.layoutThemes ?? [],
      figures: (item.production?.images ?? []).filter(img => img?.src).map(img => ({ src: img.src, caption: img.caption, anchor: img.anchor })),
    }
    : null
  const html = platform === WECHAT ? await wechatHtml(draft.markdown, articlePrefs) : null
  const rich = html ? await copyRich(html, text) : false
  const copied = rich || await copyText(text)
  openInBrowser(PLATFORM_URL[platform])
  const fresh = stateOf(item, platform) === 'none'
  if (fresh) await dispatchOps([{ op: 'set_publish', id: item.id, platform, state: 'copied' }], { label: t('复制去{platform}发布', { platform: t(platform) }), silent: true })
  const message = rich
    ? t('排好版的正文已复制。到公众号编辑器粘贴正文、填上标题，检查无误后自己点发布')
    : !copied
      ? t('没能写入剪贴板，已打开{platform}的发布页，请打开这篇手动复制正文', { platform: t(platform) })
      : draft.from === 'version'
        ? t('{platform}版的标题、正文和标签已复制。到发布页粘贴，检查无误后自己点发布', { platform: t(platform) })
        : t('还没有{platform}的版本，复制的是正文。到发布页粘贴，检查无误后自己点发布', { platform: t(platform) })
  toast(message, { error: !copied, undo: copied && fresh })
}

/** 有硬伤时先问一句；要不要照发由用户决定。 */
function confirmPublish(item, platform, findings) {
  const { block } = countFindings(findings)
  if (!block) return goPublish(item, platform)
  setDesk({
    dialog: {
      title: t('发布前检查有 {n} 处要改', { n: block }),
      submitLabel: t('仍然去发布'),
      fields: [{ name: 'note', type: 'hidden', label: `${findings.filter(row => row.level === 'block').slice(0, 4).map(row => `${row.message}${row.excerpt ? `「${row.excerpt}」` : ''}`).join('；')}。${t('确认没问题再去发布，这是你的决定。')}` }],
      onSubmit: () => goPublish(item, platform),
    },
  })
  return null
}

/** 记一笔「已发布」。链接可选但建议贴上：之后能从这里直接打开，也能按链接读数据。 */
function savePublished(item, platform, url) {
  const ops = [{ op: 'set_publish', id: item.id, platform, state: 'published', url: url || null }]
  // 第一个平台发出去，整条内容就算已发布
  if (item.status !== 'published') ops.push({ op: 'set_status', id: item.id, status: 'published' })
  return dispatchOps(ops, { label: t('标记{platform}已发布', { platform: t(platform) }) })
}

/** 标记已发布的确认框：先要链接；真没有链接，要明确点「没有链接也标记」。 */
function MarkPublishedDialog({ item, platform, onClose }) {
  const row = item.publish?.[platform]
  const [url, setUrl] = React.useState(row?.url ?? '')
  const value = url.trim()
  const valid = /^https?:\/\/\S+$/i.test(value)
  const editing = row?.state === 'published'
  const submit = async (event) => {
    event.preventDefault()
    if (!valid) return
    await savePublished(item, platform, value)
    onClose()
  }
  return (
    <Dialog title={editing ? t('修改{platform}的发布链接', { platform: t(platform) }) : t('{platform}已经发出去了？', { platform: t(platform) })} onClose={onClose} width={460}>
      <form className="md-form" onSubmit={submit}>
        <p className="md-muted">{t('这里只是记一笔，工作台不会替你发布。贴上发布后的链接，之后可以从这里直接打开，也能按链接读回阅读和点赞。')}</p>
        <label className="md-field">
          <span>{t('发布后的链接')}</span>
          <input type="url" autoFocus value={url} placeholder="https://" onChange={e => setUrl(e.target.value)} />
          {value && !valid ? <small className="md-field-error">{t('链接要以 http:// 或 https:// 开头')}</small> : null}
        </label>
        <div className="md-form-foot">
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <span style={{ flex: 1 }} />
          {editing ? null : <button type="button" className="md-btn" onClick={async () => { await savePublished(item, platform, null); onClose() }}>{t('没有链接也标记')}</button>}
          <button type="submit" className="md-btn is-primary" disabled={!valid}>{editing ? t('保存链接') : t('标记已发布')}</button>
        </div>
      </form>
    </Dialog>
  )
}

function Actions({ item, platform, wechatReady, onModal }) {
  const [busy, setBusy] = React.useState(false)
  const row = item.publish?.[platform]
  const state = row?.state ?? 'none'
  const hasCover = /^media-desk\/files\//.test(item.production.cover?.src ?? '')
  const blocked = !wechatReady ? t('先在设置里填好公众号的 AppID 和 AppSecret') : !hasCover ? t('这篇还没有封面图，公众号草稿必须有封面') : null
  const [prefs] = usePrefs('article')
  const style = useActiveStyle()
  const draft = publishDraft(item, platform)
  const push = async () => {
    setBusy(true)
    // 按用户在排版里选的长文主题排好再送去；Host 会按白名单清洗，排版失败时由 Host 用朴素排版兜底
    // 正文图片带着工作台地址送去，Host 先传到公众号素材库再换成公众号的图片地址
    const html = await wechatHtml(draft.markdown, { ...prefs, images: 'draft' })
    const data = await pushWechatDraft(item.id, html ?? undefined)
    setBusy(false)
    if (data) toast(t('已推到公众号草稿箱，用的是你选的长文主题。到公众号后台检查后，可以在这里确认发布，或在后台自己点发布'))
  }
  const findings = React.useMemo(() => checkDraft(draft, platform, style), [draft.title, draft.body, draft.tags.join(' '), draft.firstComment, platform, style]) // eslint-disable-line react-hooks/exhaustive-deps
  const copyField = async (text, label) => {
    const ok = await copyText(text)
    toast(ok ? t('{label}已复制', { label }) : t('没能写入剪贴板，请手动选中复制'), { error: !ok })
  }
  return (
    <div className="md-pub-actions" role="group" aria-label={t('{platform}的发布操作', { platform: t(platform) })}>
      <p className="md-pub-note">
        <PlatformMark platform={platform} size={18} />
        <span>{state === 'none' ? t('{platform}：待发布', { platform: t(platform) }) : t('{platform}：{state} · {when}', { platform: t(platform), state: t(STATE_LABEL[state]), when: fmtWhen(row.at) })}</span>
        {row?.url ? <button type="button" className="md-pub-link" onClick={() => openInBrowser(row.url)}>{t('打开链接')}<Icon name="upRight" size={11} /></button> : null}
      </p>
      <span className="md-grow" />
      <button type="button" className={`md-btn is-small ${state === 'published' ? '' : 'is-primary'}`} title={t('复制标题和正文，并打开{platform}的发布页', { platform: t(platform) })} onClick={() => confirmPublish(item, platform, findings)}><Icon name="copy" size={13} />{t('去发布')}</button>
      <FillDraftButton platform={platform} onOpen={() => onModal({ kind: 'fill', id: item.id, platform })} />
      {platform === WECHAT ? (
        <span className="md-pub-tip" title={blocked ?? t('用公众号官方接口建一篇草稿，不会发布')}>
          <button type="button" className="md-btn is-small" disabled={Boolean(blocked) || busy || Boolean(row?.publishId)} onClick={push}><Icon name="save" size={13} /><Swap labels={[t('推到草稿箱'), t('推送中…')]} at={busy ? 1 : 0} /></button>
        </span>
      ) : null}
      {platform === WECHAT ? <WechatPublishControls item={item} onConfirm={(mediaId, options) => onModal({ kind: 'wechat', id: item.id, mediaId, title: draft.title, retryUnknown: Boolean(options?.retryUnknown) })} /> : null}
      <button type="button" className="md-btn is-small" title={t('已经在{platform}发出去了，记一笔', { platform: t(platform) })} onClick={() => onModal({ kind: 'mark', id: item.id, platform })}><Icon name="check" size={13} />{state === 'published' ? t('修改链接') : t('标记已发布…')}</button>
      {state !== 'none' ? <button type="button" className="md-btn is-small" title={t('清除这个平台的发布记录')} onClick={() => dispatchOps([{ op: 'set_publish', id: item.id, platform, state: null }], { label: t('清除发布记录') })}>{t('清除')}</button> : null}
      {draft.from === 'version' ? (
        <p className="md-pub-version">
          <span>{t('「去发布」复制的是{platform}版本。也可以分开复制：', { platform: t(platform) })}</span>
          {draft.title ? <button type="button" className="md-btn is-small" onClick={() => copyField(draft.title, t('标题'))}>{t('标题')}</button> : null}
          <button type="button" className="md-btn is-small" onClick={() => copyField(draft.body, t('正文'))}>{t('正文')}</button>
          {draft.tags.length ? <button type="button" className="md-btn is-small" onClick={() => copyField(tagLine(draft.tags), t('标签'))}>{t('标签')}</button> : null}
          {draft.firstComment ? <button type="button" className="md-btn is-small" title={t('第一条评论：发出去之后自己在评论区发')} onClick={() => copyField(draft.firstComment, t('首评'))}>{t('首评')}</button> : null}
          <CardsButton title={draft.title} cards={draft.cards} label="导出图片" />
        </p>
      ) : (
        <p className="md-pub-version is-missing">
          <span>{t('还没有这个平台的版本，「去发布」会复制正文。')}</span>
          <button type="button" className="md-pub-link" onClick={() => openItem(item.id)}>{t('去写平台版本')}<Icon name="upRight" size={11} /></button>
        </p>
      )}
      <ChecksPanel findings={findings} />
    </div>
  )
}

/** 一篇在所有平台上走到了哪一步，折叠时的摘要用。 */
function summaryOf(item) {
  const tally = { none: 0, copied: 0, drafted: 0, published: 0 }
  for (const platform of PLATFORMS) tally[stateOf(item, platform)] += 1
  return tally
}

/** 状态筛选：看全部平台，或者只看选中的那个平台。 */
const PHASES = [{ value: 'all', label: '全部' }, { value: 'todo', label: '待发布' }, { value: 'doing', label: '进行中' }, { value: 'done', label: '已发布' }]
const PAGE = 20

/**
 * 这一篇默认显示哪些平台：大屏上选的那几个（没选就是四个常用的），
 * 再加上已经动过的、排期里选的、正在筛选的，免得进度被藏起来。
 */
function platformsFor(item, chosen, extra) {
  const base = new Set(chosen?.length ? chosen : COMMON)
  return PLATFORMS.filter(platform => base.has(platform) || platform === extra || item.platform === platform || stateOf(item, platform) !== 'none')
}

/** 折叠时的平台摘要：一排小图标，颜色深浅就是进度。 */
function PlatformDots({ item, platforms }) {
  return (
    <span className="md-pub-dots" aria-hidden="true">
      {platforms.map(platform => <span key={platform} className={`md-pub-dot is-${stateOf(item, platform)} ${item.platform === platform ? 'is-planned' : ''}`}><PlatformMark platform={platform} size={18} /></span>)}
    </span>
  )
}

function summaryText(tally) {
  const parts = []
  if (tally.published) parts.push(t('已发 {n}', { n: tally.published }))
  if (tally.drafted) parts.push(t('草稿 {n}', { n: tally.drafted }))
  if (tally.copied) parts.push(t('已复制 {n}', { n: tally.copied }))
  return parts.length ? parts.join(' · ') : t('待发布')
}

/** 小封面：有封面图用封面图，没有就用和排期页同一套文字封面。 */
function Thumb({ item, title }) {
  const src = item.production.cover?.src
  const fallback = React.useMemo(() => typeCover({ id: item.id, title, size: 'thumb' }), [item.id, title])
  const typed = fallback ? <img src={fallback} alt="" draggable={false} loading="lazy" /> : null
  return <Poster src={src ?? fallback} fallback={typed} />
}

const PieceRow = React.memo(function PieceRow({ item, wechatReady, canSync, onModal, focusPlatform, chosen }) {
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(null)
  const [everything, setEverything] = React.useState(false)
  const production = item.production
  const title = production.title || item.title
  const shown = React.useMemo(() => platformsFor(item, chosen, focusPlatform ?? active), [item, chosen, focusPlatform, active])
  const platforms = everything ? PLATFORMS : shown
  const tally = summaryOf(item)
  const toggle = () => {
    setOpen(value => !value)
    // 按平台筛选时，展开直接落到那个平台的操作上
    if (!open && focusPlatform) setActive(focusPlatform)
  }
  return (
    <article className={`md-pub-row ${open ? 'is-open' : ''}`}>
      <header className="md-pub-head">
        <button type="button" className="md-pub-thumb" onClick={() => openItem(item.id)} aria-label={t('打开这条内容')}>
          <Thumb item={item} title={title} />
        </button>
        <div className="md-pub-copy">
          <h3><button type="button" title={title} onClick={() => openItem(item.id)}>{title}</button></h3>
          <p className="md-pub-meta">
            <span><Icon name="pen" size={12} />{t('成稿于 {when}', { when: fmtWhen(new Date(finishedAt(item)).toISOString()) })}</span>
            {item.scheduledAt ? <span><Icon name="calendar" size={12} />{t('排期 {when}', { when: fmtWhen(item.scheduledAt) })}{item.platform ? ` · ${t(item.platform)}` : ''}</span> : null}
          </p>
        </div>
        <button type="button" className="md-pub-summary" aria-expanded={open} aria-label={t('{title}：{state}，点开逐个平台处理', { title, state: summaryText(tally) })} onClick={toggle}>
          <PlatformDots item={item} platforms={shown} />
          <span className={`md-pub-count ${tally.published ? 'is-on' : ''}`}>{summaryText(tally)}</span>
          <span className={`md-pub-chev ${open ? 'is-open' : ''}`}><Icon name="chevD" size={14} /></span>
        </button>
      </header>
      {open ? (
        <div className="md-pub-body">
          <ul className="md-pub-chips">
            {platforms.map((platform) => {
              const state = stateOf(item, platform)
              // 走到哪一步就显示哪一步；知道链接时在格子右边放一个直达按钮
              const url = item.publish?.[platform]?.url
              const linkLabel = state === 'published' ? t('已发布链接') : t('草稿链接')
              return (
                <li key={platform} className={url ? 'has-link' : undefined}>
                  <button type="button" className={`md-pub-chip is-${state} ${active === platform ? 'is-active' : ''} ${item.platform === platform ? 'is-planned' : ''}`} aria-expanded={active === platform} title={item.platform === platform ? t('排期里选的平台') : undefined} onClick={() => setActive(current => (current === platform ? null : platform))}>
                    <PlatformMark platform={platform} size={20} />
                    <span className="md-pub-chip-text"><strong>{t(platform)}</strong><small>{t(STATE_LABEL[state])}{readyVersion(item, platform) ? t(' · 有版本') : ''}</small></span>
                    {STATE_ICON[state] && !url ? <Icon name={STATE_ICON[state]} size={13} /> : null}
                  </button>
                  {url ? <button type="button" className={`md-pub-chip-link is-${state}`} title={url} aria-label={`${t(platform)} · ${linkLabel}`} onClick={() => openInBrowser(url)}>{linkLabel}<Icon name="upRight" size={10} /></button> : null}
                </li>
              )
            })}
          </ul>
          {shown.length < PLATFORMS.length ? (
            <button type="button" className="md-pub-all" aria-expanded={everything} onClick={() => setEverything(value => !value)}>
              {everything ? t('只看大屏上选的平台') : t('显示全部平台（还有 {n} 个）', { n: PLATFORMS.length - shown.length })}
            </button>
          ) : null}
          {canSync ? (
            <p className="md-pub-sync">
              <button type="button" className="md-btn is-small" title={t('经 Wechatsync 浏览器扩展存成知乎、B站的草稿，不会发布')} onClick={() => onModal({ kind: 'sync', id: item.id })}><Icon name="save" size={13} />{t('同步到草稿')}</button>
            </p>
          ) : null}
          {active ? <Actions item={item} platform={active} wechatReady={wechatReady} onModal={onModal} /> : <p className="md-pub-pick">{t('点一个平台，复制内容去发布、推草稿或标记已发布。')}</p>}
        </div>
      ) : null}
    </article>
  )
})

/** 发布页顶部：搜索、按进度和平台筛选。 */
function PublishFilters({ query, setQuery, phase, setPhase, platform, setPlatform, counts, shown, total }) {
  return (
    <div className="md-pub-tools" role="search">
      <label className="md-search">
        <Icon name="search" size={15} />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('搜索成稿标题')} aria-label={t('搜索成稿')} />
      </label>
      <Segmented label={t('按进度筛选')} value={phase} onChange={setPhase} options={PHASES.map(row => ({ value: row.value, label: `${t(row.label)} ${counts[row.value]}` }))} />
      <label className="md-pub-select">
        <span className="md-sr">{t('按平台筛选')}</span>
        <select value={platform} onChange={e => setPlatform(e.target.value)}>
          <option value="">{t('所有平台')}</option>
          {PLATFORMS.map(row => <option key={row} value={row}>{t(row)}</option>)}
        </select>
        <Icon name="chevD" size={13} />
      </label>
      <span className="md-grow" />
      <span className="md-tile-meta">{t('显示 {shown} / {total} 篇', { shown, total })}</span>
    </div>
  )
}

export function PublishView() {
  useLang()
  const items = useDesk(s => s.state.items)
  const wechat = useDesk(s => s.settings?.wechat)
  const wechatReady = Boolean(wechat?.appId && wechat?.hasSecret)
  const canSync = useDesk(s => Boolean(s.settings?.wechatsync?.hasToken))
  // 大屏上选的平台：发布页默认只摆这几个
  const chosen = useDesk(s => s.state.boardPlatforms)
  // 确认框和同步框开在页面最外层：成稿卡片带入场动画，框放在卡片里会被卡片裁住
  const [modal, setModal] = React.useState(null)
  const publishFilter = useDesk(s => s.publishFilter)
  const [query, setQuery] = React.useState(() => publishFilter?.query ?? '')
  const [phase, setPhase] = React.useState(() => publishFilter?.phase ?? 'todo')
  const [platform, setPlatform] = React.useState(() => publishFilter?.platform ?? '')
  React.useEffect(() => {
    if (!publishFilter) return
    setQuery(publishFilter.query ?? '')
    setPhase(publishFilter.phase ?? 'all')
    setPlatform(publishFilter.platform ?? '')
    setDesk({ publishFilter: null })
  }, [publishFilter])
  const modalItem = modal ? items.find(item => item.id === modal.id) : null
  const pieces = React.useMemo(() => items.filter(isPublishable).sort((a, b) => finishedAt(b) - finishedAt(a)), [items])
  // 和内容页同一套「已发布」：状态是已发布，或者任何一个平台记了已发布
  const published = pieces.filter(isPublished).length
  const words = query.trim().toLowerCase()
  const matched = React.useMemo(() => (words ? pieces.filter(item => `${item.production.title ?? ''} ${item.title}`.toLowerCase().includes(words)) : pieces), [pieces, words])
  const counts = React.useMemo(() => {
    const tally = { all: matched.length, todo: 0, doing: 0, done: 0 }
    for (const item of matched) tally[publishPhase(item, platform)] += 1
    return tally
  }, [matched, platform])
  const visible = React.useMemo(() => (phase === 'all' ? matched : matched.filter(item => publishPhase(item, platform) === phase)), [matched, phase, platform])
  const { limit, sentinel, more } = useProgressive(visible.length, PAGE, `${words}|${phase}|${platform}`)
  const clear = () => { setQuery(''); setPhase('all'); setPlatform('') }
  return (
    <>
    <div className="md-page md-pub-page">
      <header className="md-page-head">
        <div>
          <h1>{t('发布')}</h1>
          <p className="md-page-sub">{[
            t(plural(pieces.length, '1 篇内容', '{n} 篇内容'), { n: pieces.length }),
            t('{n} 篇已发到至少一个平台', { n: published }),
          ].join(' · ')}</p>
        </div>
        <span className="md-grow" />
        {wechatReady ? null : <button type="button" className="md-btn" onClick={() => setDesk({ settingsOpen: true })}><Icon name="gear" size={14} />{t('接入公众号草稿箱')}</button>}
      </header>
      <div className="md-pub-rule">
        <p><Icon name="check" size={14} />{t('所有平台最多推到草稿，最后的发布由你自己点；唯一的例外是公众号：每次在确认框里点了确认，才会替你公开发布。')}</p>
        <ul className="md-pub-legend" aria-label={t('发布进度说明')}>
          <li className="is-copied"><i />{t('复制去发布：内容已复制，发布页已打开')}</li>
          <li className="is-drafted"><i />{t('推到草稿：已存进平台的草稿箱，还没公开')}</li>
          <li className="is-published"><i />{t('已发布：已经公开，有链接时可直接打开')}</li>
        </ul>
      </div>
      {pieces.length === 0 ? (
        <Empty
          title={t('还没有成稿')}
          hint={t('到「灵感」或「内容」里打开一条灵感，点「一键成稿」。成稿完成后会出现在这里，再按平台一个个去发。')}
          action={<div className="md-empty-actions"><button type="button" className="md-btn is-primary" onClick={() => setDesk({ view: 'home', focusId: null })}>{t('去灵感')}</button></div>}
        />
      ) : (
        <>
          <PublishFilters query={query} setQuery={setQuery} phase={phase} setPhase={setPhase} platform={platform} setPlatform={setPlatform} counts={counts} shown={Math.min(limit, visible.length)} total={visible.length} />
          {visible.length ? (
            <div className="md-pub-list">
              {visible.slice(0, limit).map(item => <PieceRow key={item.id} item={item} wechatReady={wechatReady} canSync={canSync} onModal={setModal} focusPlatform={platform || null} chosen={chosen} />)}
              {visible.length > limit ? <button type="button" ref={sentinel} className="md-btn md-pub-more" onClick={more}>{t('再显示 {n} 篇（还有 {left} 篇）', { n: Math.min(PAGE, visible.length - limit), left: visible.length - limit })}</button> : null}
            </div>
          ) : (
            <Empty title={t('没有符合条件的成稿')} hint={t('换个关键词，或者把筛选放宽一点。')} action={<div className="md-empty-actions"><button type="button" className="md-btn" onClick={clear}>{t('清空筛选')}</button></div>} />
          )}
        </>
      )}
    </div>
    {/* 放在滚动的页面外面，确认框总在可见区域正中 */}
    {modal?.kind === 'wechat' && modalItem ? <WechatPublishDialog item={modalItem} title={modal.title} mediaId={modal.mediaId} retryUnknown={modal.retryUnknown} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'sync' && modalItem ? <SyncDraftsDialog item={modalItem} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'mark' && modalItem ? <MarkPublishedDialog item={modalItem} platform={modal.platform} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'fill' && modalItem ? <FillDraftDialog item={modalItem} platform={modal.platform} onClose={() => setModal(null)} /> : null}
    </>
  )
}
