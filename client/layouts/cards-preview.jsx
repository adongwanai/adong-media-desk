// 图文卡片：左边写、右边一排卡片。光标移到哪一节，卡片就翻到哪一页并闪一下对应的块；点卡片上的块，光标跳回原文那一行。
// 同言起 YANQI 的 RedView（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian；言起基于 Note to RED，Yeban8090，MIT）。
// 长稿也要顺：按节缓存切页结果，改了哪节只重切哪节；卡片只在滚到附近时才真正画出来。
import React from 'react'
import { auditDraftQuality, autoAnnotateHighlights, HUMANIZE_SKILL_PROMPT, normalizeDraftStructure } from '../../src/draft-quality.js'
import { dispatchOps, sendChat, setDesk, syncObsidianYanqi, toast, useDesk } from '../desk.js'
import { lang, t } from '../i18n.js'
import { Icon } from '../ui.jsx'
import { cardToPng, copyPng, downloadBlob, inlineImage, measureFits, shrinkImage, zipBlobs } from './card-dom.js'
import { CONTROL_CSS, attachControls, flashLine } from './card-interact.js'
import { CARD_LABELS, SAFE_AREA, applyCoverMode, bodyBox, cardContext, cardTitle, checkCover, dedupeSectionHeadings, formatDate, isTemplateCover, numberPages, packPages, pageAtLine, pageCharCount, pageOfKey, paginateSection, planSections, renderCard, sectionHeadings } from './cards.js'
import { BackgroundPicker, CoverPicker, CoverTitleField, Credit, FontControls, PagingPicker, SignatureForm, SizePicker, TemplatePicker, ThemeEditor, ThemeGallery } from './controls.jsx'
import { parseBlocks } from './markdown.js'
import { usePrefs, useItemMedia, useSignature } from './prefs.js'
import { SplitFrame, articleSaver, useArticleDraft, useSettled } from './split.jsx'
import { imageKey, yanqiTheme } from './yanqi.js'

function fileBase(title, fallback) {
  return String(title ?? '').replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 40) || fallback
}

function imageName(src, caption) {
  return caption || String(src).split('/').pop().slice(0, 40)
}

/** 正文和配图里要用到的图片，先全部转成 data URL：预览、量高度、导出用的是同一份。已经转过的不再转。 */
function useInlinedImages(srcs) {
  const key = srcs.join('\n')
  const cache = React.useRef(new Map())
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    let alive = true
    const todo = srcs.filter(src => !cache.current.has(src))
    if (!todo.length) return undefined
    Promise.all(todo.map(async src => [src, await inlineImage(src)])).then((rows) => {
      if (!alive) return
      for (const [src, image] of rows) cache.current.set(src, image)
      setVersion(v => v + 1)
    })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = srcs.every(src => cache.current.has(src))
  return React.useMemo(() => (ready ? new Map(srcs.map(src => [src, cache.current.get(src)])) : null), [key, ready, version]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** 页里的行号整体挪一段（同一节内容没变、只是前面多了几行时，直接用缓存）。 */
function shiftLines(value, delta) {
  if (!delta) return value
  if (Array.isArray(value)) return value.map(item => shiftLines(item, delta))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = (key === 'line' || key === 'end') && Number.isInteger(item) ? item + delta : shiftLines(item, delta)
  return out
}

/** 一节的缓存键：内容（行号换成节内的相对行号）+ 这一节用到的图片大小和表格缩放。 */
function sectionKey(section, ctx) {
  const base = section.line ?? 0
  const body = JSON.stringify(section, (key, value) => ((key === 'line' || key === 'end') && Number.isInteger(value) ? value - base : key === 'src' ? String(value).length : value))
  const keys = section.blocks.map(block => block.key).filter(Boolean)
  const sizes = keys.map(key => [ctx.images[key]?.w, ctx.images[key]?.h, ctx.tables[key]])
  return `${body}|${JSON.stringify(sizes)}`
}

/** 按节切页（默认按选定的标题级别与 --- 换页，可选跨节紧凑连排），结果按节缓存；排版选择变了才全部重切。 */
function usePages(sections, ctx, layoutKey, { compactFlow = false, includeCover = true } = {}) {
  const cache = React.useRef({ layoutKey: null, map: new Map() })
  return React.useMemo(() => {
    if (!sections) return []
    if (cache.current.layoutKey !== layoutKey) cache.current = { layoutKey, map: new Map() }
    const next = new Map()
    const fits = page => measureFits(page, ctx)
    const pages = []
    for (const section of dedupeSectionHeadings(sections)) {
      const key = sectionKey(section, ctx)
      let hit = cache.current.map.get(key)
      if (!hit) hit = { line: section.line ?? 0, pages: paginateSection(section, fits, { repeatHeading: false }) }
      next.set(key, hit)
      pages.push(...shiftLines(hit.pages, (section.line ?? 0) - hit.line))
    }
    cache.current.map = next
    if (compactFlow) return packPages(pages, fits, { includeCover })
    return numberPages(pages)
  }, [sections, ctx, layoutKey, compactFlow, includeCover])
}

// 舞台左右留白和卡片间距，和 layouts.css 里 .md-yq-stage 的 padding、gap 一致
const STAGE_PAD = 22
const STAGE_GAP = 18

/** 卡片按舞台高度缩放；舞台很窄时也按宽度收，至少一整张放得下。 */
function useStageScale(el, overview, height, width) {
  const [scale, setScale] = React.useState(0.8)
  React.useLayoutEffect(() => {
    if (!el || overview) return undefined
    const fit = () => {
      const room = el.clientWidth - STAGE_PAD * 2 - 4
      const base = Math.max(0.2, Math.min(1, (el.clientHeight - 64) / height, room / width))
      // 一排里最后一张只露出大半截时，整体略缩一点（不超过 20%），让它整张放进来，不在右边缘被切掉
      const count = (room + STAGE_GAP) / (width * base + STAGE_GAP)
      const whole = Math.ceil(count)
      const snug = (room - STAGE_GAP * (whole - 1)) / (whole * width)
      setScale(count - Math.floor(count) >= 0.5 && snug >= base * 0.8 ? snug : base)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el, overview, height, width])
  return overview ? Math.min(0.42, 180 / height * 1.3) : scale
}

const CONTROL_LABELS = () => ({
  zoom: t('缩放'), zoomIn: t('框内放大'), zoomOut: t('框内缩小'), reset: t('复位'),
  resize: t('等比调整图片大小（不裁剪）'),
  resizeWidth: t('左右拉缩宽度'),
  resizeHeight: t('上下拉缩高度'),
  imageHint: t('按住图片拖动位置；四角等比缩放不裁剪；上下左右边条独立拉缩；右上角 +/− 与滑杆调框内缩放'),
  tableSmaller: t('表格缩小'), tableBigger: t('表格放大'), tableDrag: t('拖拽缩放表格'),
  pageLimit: t('已达卡片最大尺寸'), editTitle: t('点击修改封面标题'),
})

/** 安全区示意：左右 8%、上下 10% 的虚线框，底部 15% 是信息流里可能被标题、点赞盖住的地方。只在预览里画。 */
function SafeArea({ width, height, scale }) {
  const w = width * scale
  const h = height * scale
  return (
    <span className="md-yq-safe-area" aria-hidden="true" style={{ width: w, height: h }}>
      <i style={{ left: w * SAFE_AREA.side, right: w * SAFE_AREA.side, top: h * SAFE_AREA.top, bottom: h * SAFE_AREA.bottom }} />
      <b style={{ height: h * SAFE_AREA.overlay }}>{t('信息流可能遮挡')}</b>
    </span>
  )
}

/**
 * 一张卡片：放在 shadow root 里，工作台的样式进不去，看到的就是导出的样子。只在滚到附近时才画（虚拟化）。
 */
const CardFrame = React.memo(function CardFrame({ html, width, height, scale, label, sparse, active, flip, flash, cover, safeArea, controls, onSelect, onJump, onCopy, onTitle, root }) {
  const host = React.useRef(null)
  const shell = React.useRef(null)
  const [near, setNear] = React.useState(false)
  React.useEffect(() => {
    const el = shell.current
    if (!el) return undefined
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root?.current ?? null, rootMargin: '900px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [root])
  React.useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    if (!near) { shadow.innerHTML = ''; return }
    // html 由 renderCard 生成，正文已全部转义；控件样式只在预览里有
    shadow.innerHTML = `<style>${CONTROL_CSS}</style>${html}`
    if (controls) attachControls(shadow, controls)
  }, [html, near, controls])
  React.useEffect(() => {
    if (near && flash && host.current?.shadowRoot) flashLine(host.current.shadowRoot, flash.line)
  }, [flash, near])
  const click = (event) => {
    // 图片、表格控件上的操作不算点卡片
    const path = event.nativeEvent.composedPath()
    if (path.some(node => node?.classList?.contains?.('mdx-ctrl') || node?.classList?.contains?.('mdx-tctrl') || node?.classList?.contains?.('mdx-corner') || node?.classList?.contains?.('mdx-edge') || node?.classList?.contains?.('mdx-tresize'))) return
    // 点封面标题：去改卡片自己的封面标题，不跳回正文（标题不在正文里，跳过去也改不了）
    if (cover && onTitle && path.some(node => node?.getAttribute?.('data-slot') === 'title')) {
      onSelect()
      onTitle()
      return
    }
    const hit = path.find(node => node?.getAttribute?.('data-line') !== null && node?.getAttribute?.('data-line') !== undefined && node.nodeType === 1)
    onSelect()
    onJump(hit ? Number(hit.getAttribute('data-line')) : null)
  }
  return (
    <figure ref={shell} className={`md-yq-card ${active ? 'is-on' : ''} ${flip ? 'is-flip' : ''} ${sparse ? 'is-sparse' : ''}`} role="listitem">
      <div className="md-yq-card-hit" role="button" tabIndex={0} aria-label={label} aria-current={active ? 'true' : undefined} style={{ width: width * scale, height: height * scale }} onClick={click} onKeyDown={(event) => { if (event.key === 'Enter') { onSelect(); onJump(null) } }}>
        <div ref={host} className="md-yq-card-host" style={{ width, height, transform: `scale(${scale})` }} />
        {cover && safeArea ? <SafeArea width={width} height={height} scale={scale} /> : null}
        <button type="button" className="md-yq-card-copy" title={t('复制这张图')} aria-label={t('复制这张图')} onClick={(event) => { event.stopPropagation(); onCopy() }}><Icon name="copy" size={13} /></button>
      </div>
      <figcaption>{label}{sparse ? <span className="md-yq-sparse-badge" title={t('这张卡片字数很少，建议合并进上一节或调整分页')}>{t('字少')}</span> : null}</figcaption>
    </figure>
  )
})

/**
 * 图文卡片的预览、编辑和导出。
 * 左边改的正文默认写回母稿（itemId）；别处复用时传 onSave(text) → Promise<boolean>（比如小红书图片版写回版本的 cards），
 * 两个都不传就只预览不保存。mediaKey 是这一份图片、表格调整记在哪（默认用 itemId）。
 */
// 小红书一篇笔记最多 18 张图：切出来的页数超过这个数，就提示改用精简过的图片版
export const XHS_MAX_PAGES = 18

/** 图文卡片顶部的通用规则质检条：实时检查首页与每页饱满度、加粗高亮、配图信源、去 AI 味、活人感 5 项通用规则。 */
function CardQualityBar({ quality, onNormalize, onAnnotate, onAutoFix, onFocusCheck }) {
  const hasBad = quality.hardFailures.length > 0
  const [open, setOpen] = React.useState(hasBad)
  React.useEffect(() => {
    if (hasBad) setOpen(true)
  }, [hasBad])
  const stateIcon = state => (state === 'ok' ? '✓' : state === 'bad' ? '!' : '·')
  return (
    <div className={`md-yq-qbar ${quality.ok ? 'is-ok' : hasBad ? 'is-bad' : 'is-warn'}`} role="region" aria-label={t('通用规则检查')}>
      <div className="md-yq-qbar-top">
        <button type="button" className="md-yq-qbar-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <span className={`md-yq-qbar-dot is-${quality.ok ? 'ok' : hasBad ? 'bad' : 'warn'}`}>{quality.ok ? '✓' : '!'}</span>
          <b>{t('通用规则检查')}</b>
          <span className="md-yq-qbar-score">{t('{pass}/{total} 通过', { pass: quality.passCount, total: quality.totalChecks })}</span>
        </button>
        <div className="md-yq-qbar-chips">
          {quality.checks.map(row => (
            <button
              key={row.id}
              type="button"
              className={`md-yq-qchip is-${row.state}`}
              title={`${row.label}：${row.detail}`}
              onClick={() => { setOpen(true); onFocusCheck(row) }}
            >
              <i>{stateIcon(row.state)}</i>
              <span>{t(row.shortLabel)}</span>
              <em>{row.value}</em>
            </button>
          ))}
        </div>
        <span className="md-grow" />
        {quality.canAnnotate && onAnnotate ? (
          <button type="button" className="md-pill is-small" onClick={onAnnotate} title={t('自动为各节补齐加蓝加粗（**…**）与加黄荧光笔（==…==）重点标注')}>
            <Icon name="spark" size={12} />{t('一键加蓝加黄')}
          </button>
        ) : null}
        {quality.canNormalize ? (
          <button type="button" className="md-pill is-small" onClick={onNormalize} title={t('自动合并开头的重复封面短节并移出卡片内的标签墙，立即消除空卡')}>
            <Icon name="bolt" size={12} />{t('一键清空白卡')}
          </button>
        ) : null}
        {!quality.ok && onAutoFix && quality.fixPrompt ? (
          <button type="button" className="md-pill is-small is-primary" onClick={onAutoFix} title={t('将未达标的通用规则项发给左侧助手一键修整')}>
            <Icon name="spark" size={12} />{t('按规则自动修整')}
          </button>
        ) : null}
        <button type="button" className="md-yq-qbar-more" onClick={() => setOpen(v => !v)}>
          {open ? t('收起') : t('详情')}
        </button>
      </div>
      {open ? (
        <ul className="md-yq-qbar-list">
          {quality.checks.map(row => (
            <li key={row.id} className={`is-${row.state}`} onClick={() => onFocusCheck(row)}>
              <i className={`md-yq-qbar-dot is-${row.state}`}>{stateIcon(row.state)}</i>
              <b>{t(row.label)}</b>
              <span className="md-yq-qbar-detail">{row.detail}</span>
              {row.excerpt ? <q className="md-yq-qbar-quote">{row.excerpt.slice(0, 44)}</q> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function CardsPreview({ production, title, itemId, onSave, mediaKey, overLimit = null }) {
  const [prefs, update] = usePrefs('card')
  const [editorPrefs, setEditorPrefs] = usePrefs('editor')
  const [signature, setSignature] = useSignature()
  const [media, mediaActions] = useItemMedia(mediaKey ?? itemId)
  const custom = useDesk(s => s.state?.layoutThemes) ?? []
  const currentStyle = useDesk((s) => {
    const styles = s.state?.styles ?? []
    return styles.find(r => r.id === s.state?.activeStyleId) ?? styles[0] ?? null
  })
  const save = React.useMemo(() => onSave ?? articleSaver(itemId), [onSave, itemId])
  const draft = useArticleDraft(production.article ?? '', save)
  const locked = Boolean(editorPrefs.locked)
  // 打字时 150ms 后才重排；锁定时预览不动
  const article = useSettled(draft.text, 150, locked)
  const [tab, setTab] = React.useState('source')
  const [draftTheme, setDraftTheme] = React.useState(null)
  const [editing, setEditing] = React.useState(false)
  const editorApi = React.useRef(null)
  const titleInput = React.useRef(null)
  // 封面标题只存在这篇的封面槽位里，不改稿子；打字时和正文一样停 150ms 再重排
  const customTitle = useSettled(media.cover?.title ?? '', 150)
  const shownTitle = cardTitle(customTitle, title)

  const figures = React.useMemo(() => (production.images ?? []).filter(image => image?.src).map(image => ({ src: image.src, caption: image.caption, anchor: image.anchor })), [production.images])
  const coverChoices = React.useMemo(() => [
    ...(production.cover?.src ? [{ src: production.cover.src, label: t('封面图') }] : []),
    ...figures.map((figure, i) => ({ src: figure.src, label: figure.caption || t('配图 {n}', { n: i + 1 }) })),
  ], [production.cover?.src, figures])
  const articleImages = React.useMemo(() => parseBlocks(article).filter(block => block.type === 'image').map(block => block.src), [article])
  const bgSrc = prefs.background?.src
  const autoCoverImage = media.cover?.image === undefined ? (coverChoices[0]?.src ?? articleImages[0] ?? null) : media.cover.image
  const coverSrc = autoCoverImage && isTemplateCover(prefs.cover) ? autoCoverImage : null
  const srcs = React.useMemo(() => [...new Set([...figures.map(figure => figure.src), ...articleImages, ...(coverSrc ? [coverSrc] : []), ...(bgSrc && !bgSrc.startsWith('data:') ? [bgSrc] : [])])], [figures, articleImages, coverSrc, bgSrc])
  const images = useInlinedImages(srcs)

  const themes = React.useMemo(() => (draftTheme ? [...custom, draftTheme] : custom), [custom, draftTheme])
  const themeId = draftTheme ? draftTheme.id : prefs.theme
  const date = formatDate(new Date(), signature.timeFormat)
  const sectionsRaw = React.useMemo(() => {
    if (!images) return null
    return planSections(article, { title, coverTitle: customTitle, figures, resolveImage: src => images.get(src) ?? null, headingLevel: prefs.headingLevel })
  }, [article, title, customTitle, figures, images, prefs.headingLevel])
  const headings = React.useMemo(() => (sectionsRaw ? sectionHeadings(sectionsRaw) : []), [sectionsRaw])
  const ctx = React.useMemo(() => {
    const bg = prefs.background?.src ? { ...prefs.background, src: bgSrc.startsWith('data:') ? bgSrc : images?.get(bgSrc)?.src } : null
    const coverImage = coverSrc && images?.get(coverSrc) ? { ...images.get(coverSrc), key: imageKey(coverSrc) } : null
    return cardContext({ ...prefs, theme: themeId }, signature, {
      date,
      labels: Object.fromEntries(Object.entries(CARD_LABELS).map(([key, text]) => [key, t(text)])),
      themes,
      images: media.images,
      tables: media.tables,
      background: bg,
      lines: true,
      cover: { ...media.cover, image: coverImage },
      article,
      headings,
    })
  }, [prefs, themeId, signature, date, themes, media, bgSrc, images, coverSrc, article, headings])
  const sections = React.useMemo(() => (sectionsRaw ? applyCoverMode(sectionsRaw, ctx.cover, Boolean(prefs.coverOnly)) : null), [sectionsRaw, ctx.cover, prefs.coverOnly])
  // 只有影响排版高度的选择变了才全部重切（图片大小、表格缩放按节算）；封面标题只影响封面那一节，按节缓存就够了
  const { title: _coverTitle, ...coverSlots } = media.cover ?? {}
  const compactFlow = Boolean(prefs.compactFlow)
  const includeCover = !isTemplateCover(ctx.cover) && !prefs.coverOnly
  const layoutKey = JSON.stringify([ctx.theme.id, draftTheme?.styles ?? null, ctx.template, ctx.cover, Boolean(prefs.coverOnly), compactFlow, ctx.font, ctx.size, ctx.width, ctx.height, ctx.headingLevel, signature, date, ctx.background?.src?.length ?? 0, coverSlots, lang()])
  const pages = usePages(sections, ctx, layoutKey, { compactFlow, includeCover })
  const exportCtx = React.useMemo(() => ({ ...ctx, lines: false }), [ctx])
  const htmls = React.useMemo(() => pages.map(page => renderCard(page, ctx)), [pages, ctx])
  const checks = React.useMemo(() => (pages[0] ? checkCover(pages[0], ctx) : []), [pages, ctx])
  const skipped = React.useMemo(() => (images ? srcs.filter(src => !images.get(src) && src !== bgSrc).map(src => imageName(src, figures.find(figure => figure.src === src)?.caption)) : []), [images, srcs, figures, bgSrc])
  const renderedPages = React.useMemo(() => (pages.length ? pages.map(page => ({
    kind: page.kind,
    line: page.line ?? 0,
    continued: Boolean(page.continued),
    blocks: page.blocks ?? [],
    hasMedia: (page.blocks ?? []).some(b => b.type === 'image' || b.type === 'table' || b.type === 'code'),
    chars: pageCharCount(page),
    hasCoverVisual: page.kind === 'cover' && (isTemplateCover(ctx.cover) || headings.length >= 2 || Boolean(ctx.coverData?.image)),
  })) : null), [pages, ctx.cover, headings.length, ctx.coverData?.image])
  const quality = React.useMemo(
    () => (images ? auditDraftQuality(article, { title: shownTitle, goal: 'xhs', style: currentStyle, renderedPages, skippedImages: skipped }) : null),
    [images, article, shownTitle, currentStyle, renderedPages, skipped]
  )
  const [current, setCurrent] = React.useState(0)
  const [overview, setOverview] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [flip, setFlip] = React.useState(null)
  const stage = React.useRef(null)
  // 舞台在窄屏的「正文 / 预览」标签之间会重新挂载：用回调 ref 记下当前这一个，缩放跟着它重新量
  const [stageNode, setStageNode] = React.useState(null)
  const stageRef = React.useCallback((node) => { stage.current = node; setStageNode(node) }, [])
  const scale = useStageScale(stageNode, overview, ctx.height, ctx.width)
  const at = Math.min(current, Math.max(0, pages.length - 1))

  React.useEffect(() => {
    if (skipped.length) toast(t('{n} 张图片读不到，已跳过：{names}', { n: skipped.length, names: skipped.join('、') }), { error: true })
  }, [skipped.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps

  // 只滚舞台自己：scrollIntoView 会连外面工作台的容器一起滚。
  // 一排卡片时：当前这张已经整张看得见就不动；不然把它的左边对齐到吸附点，整张露出来
  const scrollToCard = (i) => {
    const box = stage.current
    const card = box?.querySelectorAll('.md-yq-card')[i]
    if (!card) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const a = box.getBoundingClientRect()
    const b = card.getBoundingClientRect()
    const pad = 22
    if (overview) {
      box.scrollTo({ top: Math.max(0, box.scrollTop + (b.top - a.top) - (box.clientHeight - b.height) / 2), behavior: reduce ? 'auto' : 'smooth' })
      return
    }
    if (b.left >= a.left + pad - 1 && b.right <= a.right - pad + 1) return
    box.scrollTo({ left: Math.max(0, box.scrollLeft + (b.left - a.left) - pad), behavior: reduce ? 'auto' : 'smooth' })
  }

  // 光标跟随（同言起 syncPreviewFromEditor）：翻到光标所在的页，闪一下对应的块
  const onCaret = React.useCallback((line) => {
    if (locked || !pages.length) return
    const i = pageAtLine(pages, line)
    setCurrent(i)
    setFlip({ index: i, line, n: Date.now() })
    requestAnimationFrame(() => scrollToCard(i))
  }, [locked, pages, overview]) // eslint-disable-line react-hooks/exhaustive-deps

  // 点卡片（同言起 _jumpEditorToSection）：光标跳到原文那一行；点到具体的块就跳到那个块
  const jump = (i, line) => {
    const target = Number.isInteger(line) ? line : pages[i]?.line ?? 0
    if (tab !== 'source' && document.querySelector('.md-yq-split-card.is-tabs')) setTab('source')
    requestAnimationFrame(() => editorApi.current?.goto(target))
  }

  const select = (i) => {
    setCurrent(i)
    if (overview) setOverview(false)
    // 点到半露的那张，也把它整张挪进来
    requestAnimationFrame(() => scrollToCard(i))
  }

  const size = { cardWidth: ctx.width, cardHeight: ctx.height, width: ctx.exportWidth, height: ctx.exportHeight }
  const pngOf = i => cardToPng(renderCard(pages[i], exportCtx), size)
  const failure = (err) => {
    const reason = err?.name === 'SecurityError' ? t('卡片里有读不了的外部资源') : { blank: t('生成的图片是空白的'), image: t('卡片转图片失败'), empty: t('卡片是空的'), toBlob: t('图片生成失败'), clipboard: t('浏览器不允许写入剪贴板') }[err?.message] ?? err?.message
    return reason
  }
  const base = fileBase(shownTitle, t('图文卡片'))
  const name = i => `${base}-${String(i + 1).padStart(2, '0')}.png`
  const saveOne = async (i) => {
    setProgress(1)
    try {
      downloadBlob(await pngOf(i), name(i))
      toast(t('已导出第 {n} 页（{w}×{h}）', { n: i + 1, w: ctx.exportWidth, h: ctx.exportHeight }))
    } catch (err) {
      toast(t('导出失败：{error}', { error: failure(err) }), { error: true })
    } finally {
      setProgress(0)
    }
  }
  // 导出全部：每页一张 PNG，打成一个 ZIP（同言起 downloadAllImages）
  const saveAll = async () => {
    try {
      const files = []
      for (let i = 0; i < pages.length; i += 1) {
        setProgress(i + 1)
        files.push({ name: name(i), blob: await pngOf(i) })
      }
      downloadBlob(await zipBlobs(files), `${base}.zip`)
      toast(t('已导出 {n} 张图片，打包成 ZIP', { n: files.length }))
    } catch (err) {
      toast(t('导出失败：{error}', { error: failure(err) }), { error: true })
    } finally {
      setProgress(0)
    }
  }
  const copyOne = async (i) => {
    try {
      await copyPng(pngOf(i))
      toast(t('第 {n} 页已复制到剪贴板', { n: i + 1 }))
    } catch (err) {
      toast(t('复制失败：{error}', { error: failure(err) }), { error: true })
    }
  }

  // 调完图片、表格大小会重新切页：记下刚调的是哪一个，切完页如果它换了页，预览跟过去并选中那一页，不让它凭空消失。
  // 只认 2 秒内的调整，免得之后别的改动重排时突然翻页
  const follow = React.useRef(null)
  const followKey = key => { follow.current = { key, at: Date.now() } }
  React.useEffect(() => {
    const target = follow.current
    if (!target) return
    follow.current = null
    if (Date.now() - target.at > 2000) return
    const i = pageOfKey(pages, target.key)
    if (i >= 0 && i !== at) select(i)
  }, [pages]) // eslint-disable-line react-hooks/exhaustive-deps

  const controls = React.useMemo(() => ({
    scale: () => scale,
    labels: CONTROL_LABELS(),
    images: media.images,
    tables: media.tables,
    body: bodyBox(ctx),
    onImage: (key, state) => { followKey(key); mediaActions.setImage(key, state) },
    onImageReset: (key) => { followKey(key); mediaActions.resetImage(key) },
    onTable: (key, value) => { followKey(key); mediaActions.setTable(key, value) },
  }), [scale, media.images, media.tables, ctx, mediaActions])

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
  const pickBackground = async (file) => {
    try {
      update({ background: { src: await shrinkImage(file, 1400), scale: 1, x: 0, y: 0 } })
    } catch {
      toast(t('读不了这张图片'), { error: true })
    }
  }

  const handleSyncObsidian = async () => {
    const data = await syncObsidianYanqi()
    if (data?.signature) setSignature(data.signature)
    if (data?.cardPrefs) update({ ...data.cardPrefs, coverOnly: false, compactFlow: false })
    if (data?.synced) toast(t('已从 Obsidian 同步头像、页脚与主题偏好'))
  }
  const applyAnnotate = () => {
    const res = autoAnnotateHighlights(draft.text, { goal: 'xhs', force: true })
    if (!res.changed) {
      toast(t('当前稿件已有充足的加蓝加粗与加黄高亮标注'))
      return
    }
    draft.setText(res.text)
    toast(t('已自动标注 {b} 处加蓝加粗、{m} 处加黄高亮', { b: res.addedBold, m: res.addedMark }))
  }
  const panel = (
    <>
      {editing ? (
        <ThemeEditor key={baseTheme.id} base={baseTheme} onDraft={styles => setDraftTheme({ id: 'my-draft', name: t('编辑中'), styles })} onSave={saveTheme} onClose={() => { setEditing(false); setDraftTheme(null) }} onError={message => toast(message, { error: true })} />
      ) : (
        <ThemeGallery value={prefs.theme} font={prefs.font} custom={custom} onChange={theme => update({ theme })} onEdit={() => setEditing(true)} onDelete={deleteTheme} />
      )}
      <SizePicker ratio={ctx.ratio} tier={prefs.tier} onRatio={ratio => update({ ratio })} onTier={tier => update({ tier })} />
      <CoverPicker value={ctx.cover} onChange={cover => update({ cover })} slots={media.cover} onSlots={mediaActions.setCover} images={coverChoices} checks={checks} safeArea={prefs.safeArea} onSafeArea={safeArea => update({ safeArea })} coverOnly={prefs.coverOnly} onCoverOnly={coverOnly => update({ coverOnly })} fallbackTitle={title} />
      <TemplatePicker value={prefs.template} onChange={template => update({ template })} />
      <PagingPicker value={ctx.headingLevel} onChange={headingLevel => update({ headingLevel })} compactFlow={compactFlow} onCompactFlow={val => update({ compactFlow: val })} />
      <BackgroundPicker value={prefs.background} ratio={ctx.ratio} onChange={background => update({ background })} onPick={pickBackground} />
      <SignatureForm
        value={signature}
        onChange={setSignature}
        onSync={handleSyncObsidian}
        onError={message => toast(message, { error: true })}
      />
      <Credit />
    </>
  )
  // 预览上面常驻的一条：封面标题、字体、字号（同言起工具栏），不用打开样式面板往下翻
  const editTitle = () => requestAnimationFrame(() => { titleInput.current?.focus(); titleInput.current?.select() })
  const quick = (
    <>
      <CoverTitleField compact value={media.cover?.title} fallback={title} onChange={text => mediaActions.setCover({ title: text })} inputRef={titleInput} />
      <FontControls font={prefs.font} size={prefs.fontSize} onFont={font => update({ font })} onSize={fontSize => update({ fontSize })} />
      <button
        type="button"
        className="md-pill is-small"
        title={t('自动为文稿补齐加蓝加粗（**…**）与加黄荧光笔（==…==）重点标注')}
        onClick={applyAnnotate}
      >
        <Icon name="spark" size={12} />{t('自动标注重点')}
      </button>
      <button
        type="button"
        className="md-pill is-small"
        title={t('从本机 Obsidian 的 note-to-red 插件同步头像、昵称、名言页脚与默认主题')}
        onClick={handleSyncObsidian}
      >
        {t('同步 Obsidian')}
      </button>
      {!isTemplateCover(ctx.cover) ? (
        <button
          type="button"
          className={`md-pill is-small ${prefs.coverOnly ? 'is-on' : ''}`}
          aria-pressed={Boolean(prefs.coverOnly)}
          title={t('开启后封面只放标题，正文统一从第 2 页开始排，避免封面塞满文字或第 2 页只剩半句尾巴')}
          onClick={() => update({ coverOnly: !prefs.coverOnly })}
        >
          {t('封面只放标题')}
        </button>
      ) : null}
      <button
        type="button"
        className="md-pill is-small"
        title={t('在光标处插入手动分页符（---），避免一句话被切在两张卡中间')}
        onClick={() => editorApi.current?.insertBlock('---')}
      >
        + {t('分页符')}
      </button>
      {itemId ? (
        <button
          type="button"
          className="md-pill is-small"
          title={t('调用 Humanizer Skill（中文 22 特征 + 结构去 AI 味）对全文精修去 AI 腔，保留事实与配图')}
          onClick={async () => {
            await draft.flush()
            setDesk({ studioDock: true })
            await sendChat(HUMANIZE_SKILL_PROMPT, { itemId })
          }}
        >
          <Icon name="spark" size={12} />{t('Humanizer 去AI味')}
        </button>
      ) : null}
    </>
  )
  const busy = Boolean(progress) || !pages.length
  const actions = (
    <>
      <button type="button" className={`md-pill md-yq-act ${overview ? 'is-on' : ''}`} aria-pressed={overview} aria-label={t('全览')} title={t('全览')} onClick={() => setOverview(value => !value)}><Icon name="wall" size={14} /><span>{t('全览')}</span></button>
      <button type="button" className="md-pill md-yq-act" onClick={() => copyOne(at)} disabled={busy} aria-label={t('复制当前页')} title={t('把当前页复制成图片')}><Icon name="copy" size={14} /><span>{t('复制当前页')}</span></button>
      <button type="button" className="md-pill md-yq-act" onClick={() => saveOne(at)} disabled={busy} aria-label={t('导出当前页')} title={t('导出当前页')}><Icon name="image" size={14} /><span>{t('导出当前页')}</span></button>
      <button type="button" className="md-pill is-primary" onClick={saveAll} disabled={busy}>
        <Icon name="save" size={14} />{progress && pages.length > 1 ? t('导出中 {done}/{total}', { done: progress, total: pages.length }) : t('导出全部 ZIP')}
      </button>
    </>
  )
  const applyNormalize = () => {
    const norm = normalizeDraftStructure(draft.text, { fallbackTitle: shownTitle, goal: 'xhs' })
    if (!norm.changed) return
    if (norm.coverTitle && !media.cover?.title) mediaActions.setCover({ title: norm.coverTitle })
    draft.setText(norm.body)
    toast(norm.fixes[0] || t('已自动规整卡片结构'))
  }
  const autoFixByAgent = itemId ? async () => {
    if (!quality?.fixPrompt) return
    await draft.flush()
    setDesk({ studioDock: true })
    await sendChat(quality.fixPrompt, { itemId })
  } : null
  const focusQualityCheck = (row) => {
    if (!pages.length) return
    const idx = Number.isInteger(row.cardIndex) ? Math.min(row.cardIndex, pages.length - 1) : pageAtLine(pages, row.line ?? 0)
    select(idx)
    if (Number.isInteger(row.line)) jump(idx, row.line)
  }
  const preview = (
    <div ref={stageRef} className={`md-yq-stage ${overview ? 'is-overview' : ''}`} role="list" aria-label={overview ? t('全览') : t('卡片')} style={overview ? { gridTemplateColumns: `repeat(auto-fill, ${Math.round(ctx.width * scale)}px)` } : undefined}>
      {pages.map((page, i) => {
        const chars = pageCharCount(page)
        const sparse = page.kind !== 'cover' && pages.length > 2 && Number.isFinite(chars) && chars > 0 && chars < 58
        return (
          <CardFrame
            key={i}
            root={stage}
            html={htmls[i]}
            width={ctx.width}
            height={ctx.height}
            scale={scale}
            active={i === at}
            flip={flip?.index === i ? flip.n : null}
            flash={flip?.index === i ? flip : null}
            cover={page.kind === 'cover'}
            safeArea={prefs.safeArea}
            controls={controls}
            sparse={sparse}
            label={page.kind === 'cover' ? t('封面') : `${i + 1} / ${pages.length}`}
            onSelect={() => select(i)}
            onJump={line => jump(i, line)}
            onCopy={() => copyOne(i)}
            onTitle={page.kind === 'cover' ? editTitle : null}
          />
        )
      })}
    </div>
  )
  const combinedNotice = (quality && pages.length) || (overLimit && pages.length > XHS_MAX_PAGES) ? (
    <>
      {quality && pages.length ? (
        <CardQualityBar
          quality={quality}
          onNormalize={applyNormalize}
          onAnnotate={applyAnnotate}
          onAutoFix={autoFixByAgent}
          onFocusCheck={focusQualityCheck}
        />
      ) : null}
      {overLimit && pages.length > XHS_MAX_PAGES ? overLimit(pages.length) : null}
    </>
  ) : null
  return (
    <SplitFrame
      label={t('图文卡片')}
      title={t('图文卡片')}
      meta={pages.length ? (
        <>
          {t('{n} 页 · {w}×{h}', { n: pages.length, w: ctx.exportWidth, h: ctx.exportHeight })}
          {skipped.length ? <span className="md-yq-warn" title={skipped.join('\n')}>{t(' · {n} 张图片读不到：{names}', { n: skipped.length, names: skipped.join('、') })}</span> : null}
        </>
      ) : t('正在排版')}
      actions={actions}
      notice={combinedNotice}
      panel={panel}
      editingTheme={editing}
      onExitTheme={() => { setEditing(false); setDraftTheme(null) }}
      previewBar={quick}
      preview={preview}
      draft={draft}
      editorPrefs={editorPrefs}
      setEditorPrefs={setEditorPrefs}
      onCaret={onCaret}
      editorApi={editorApi}
      tab={tab}
      setTab={setTab}
    />
  )
}
