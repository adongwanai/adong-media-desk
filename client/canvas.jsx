// 首页：一句话记一个灵感。灵感可以散落在空间里，也可以按时间排成信息流。
import React from 'react'
import { Card, openCapture } from './card.jsx'
import { captureFile, captureFiles, captureUrl, dispatchOps, extractClipboardFiles, launchIdea, openItem, setDesk, toast, uploadAttachment, useDesk, watchProduction } from './desk.js'
import { plural, t } from './i18n.js'
import { Icon, IconButton, Segmented } from './ui.jsx'
import { MiniStamps } from './stamps.jsx'
import { TodayReview } from './review-strip.jsx'
import { CAPTURE_KEY, keysText } from './shortcuts.js'
import { cardSize, scatterLayout } from './layout.js'
import { relatedIdeas, relatedLayout } from './related.js'
import { looksLikeNotePath } from './capture-text.js'
import { SPRING_SOFT, computeStreak, displayItem, hash, pieceCounts, pieceStatus, posterOf, reducedMotion, isIdea } from './util.js'

function useCamera(stageRef, worldRef) {
  const cam = React.useRef({ x: 0, y: 0, s: 1, vx: 0, vy: 0, vs: 0, tx: 0, ty: 0, ts: 1, raf: 0 })
  const apply = React.useCallback(() => {
    const c = cam.current
    const world = worldRef.current
    const stage = stageRef.current
    if (!world || !stage) return
    world.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.s})`
    world.style.setProperty('--px', `${c.x / c.s}px`)
    world.style.setProperty('--py', `${c.y / c.s}px`)
    stage.style.setProperty('--grid-x', `${c.x}px`)
    stage.style.setProperty('--grid-y', `${c.y}px`)
    stage.style.setProperty('--grid-size', `${28 * c.s}px`)
  }, [stageRef, worldRef])
  const tick = React.useCallback(() => {
    const c = cam.current
    const k = c.stiffness ?? 90
    const d = c.damping ?? 17
    const dt = 1 / 60
    c.vx += (k * (c.tx - c.x) - d * c.vx) * dt
    c.vy += (k * (c.ty - c.y) - d * c.vy) * dt
    c.vs += (k * (c.ts - c.s) - d * c.vs) * dt
    c.x += c.vx * dt
    c.y += c.vy * dt
    c.s += c.vs * dt
    apply()
    const idle = Math.abs(c.tx - c.x) < 0.2 && Math.abs(c.ty - c.y) < 0.2 && Math.abs(c.ts - c.s) < 0.0005 && Math.abs(c.vx) + Math.abs(c.vy) < 0.5
    if (idle) {
      Object.assign(c, { x: c.tx, y: c.ty, s: c.ts, vx: 0, vy: 0, vs: 0, raf: 0 })
      apply()
      return
    }
    c.raf = requestAnimationFrame(tick)
  }, [apply])
  const flyTo = React.useCallback((target, { instant = false, stiffness = 90, damping = 17 } = {}) => {
    const c = cam.current
    Object.assign(c, { tx: target.x, ty: target.y, ts: target.s, stiffness, damping })
    if (instant || reducedMotion()) {
      cancelAnimationFrame(c.raf)
      Object.assign(c, { x: c.tx, y: c.ty, s: c.ts, vx: 0, vy: 0, vs: 0, raf: 0 })
      apply()
      return
    }
    if (!c.raf) c.raf = requestAnimationFrame(tick)
  }, [apply, tick])
  const halt = React.useCallback(() => {
    const c = cam.current
    cancelAnimationFrame(c.raf)
    Object.assign(c, { raf: 0, vx: 0, vy: 0, vs: 0, tx: c.x, ty: c.y, ts: c.s })
  }, [])
  React.useEffect(() => () => cancelAnimationFrame(cam.current.raf), [])
  return { cam, flyTo, halt }
}

function Inline({ src }) {
  const [failed, setFailed] = React.useState(false)
  // 没有图或图读不到时什么都不放，句子里不留一个空圆圈
  if (!src || failed) return null
  return <img className="md-inline-pic" src={src} alt="" draggable={false} onError={() => setFailed(true)} />
}

const GOAL_OPTS = [
  { value: 'xhs', label: '图文卡片' },
  { value: 'article', label: '公众号长文' },
  { value: 'script', label: '口播稿' },
  { value: 'both', label: '长文+口播' },
]

const MODE_OPTS = [
  { value: 'auto', label: '自动模式' },
  { value: 'A', label: 'A · 争议判断' },
  { value: 'B', label: 'B · 故事吐槽' },
  { value: 'C', label: 'C · 教程路径' },
  { value: 'D', label: 'D · 真诚分享' },
]

function extractUrls(str) {
  return [...new Set((String(str ?? '').match(/https?:\/\/[^\s<>)"'，。；！？]+/gi) ?? []))]
}

/** 首屏那句话：有图、有字、有数字，下面是极简渐进胶囊（既能随手记一句灵感，也能拖入任意附件写 Brief 马上成稿）。 */
function Hero() {
  const items = useDesk(s => s.state.items)
  const styles = useDesk(s => s.state.styles ?? [])
  const activeStyleId = useDesk(s => s.state.activeStyleId ?? '')
  const roots = items.filter(isIdea)
  // 和内容页、导航角标同一套数：灵感墙只放自己记的，导入的灵感另外说一句
  const counts = pieceCounts(items)
  const pending = roots.filter(i => pieceStatus(i) === 'idea')
  const waiting = counts.ideas - counts.importedIdeas
  const week = new Date()
  week.setDate(week.getDate() + 7)
  const upcoming = items.filter(i => i.scheduledAt && pieceStatus(i) !== 'published' && new Date(i.scheduledAt) >= new Date() && new Date(i.scheduledAt) <= week)
  const streak = computeStreak(items)
  const pic = list => list.map(posterOf).find(Boolean)
  const related = useDesk(s => s.related)

  const [text, setText] = React.useState('')
  const [focused, setFocused] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [attachments, setAttachments] = React.useState([])
  const [goal, setGoal] = React.useState('xhs')
  const [mode, setMode] = React.useState('auto')
  const [styleId, setStyleId] = React.useState(activeStyleId)
  const areaRef = React.useRef(null)
  const fileRef = React.useRef(null)
  const boxRef = React.useRef(null)

  React.useEffect(() => { setStyleId(activeStyleId) }, [activeStyleId])

  React.useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 136)}px`
  }, [text])

  const expanded = focused || Boolean(text.trim()) || attachments.length > 0 || uploading || submitting
  const runningItems = React.useMemo(() => items.filter(i => i.production?.status === 'running'), [items])
  const runningKey = runningItems.map(i => i.id).join(',')
  React.useEffect(() => {
    if (!runningKey) return undefined
    const stops = runningKey.split(',').filter(Boolean).slice(0, 3).map(id => watchProduction(id))
    return () => { for (const stop of stops) stop() }
  }, [runningKey])
  const goLabel = goal === 'xhs' ? t('生成笔记') : goal === 'script' ? t('生成口播') : t('开始写稿')

  const addFiles = async (fileList) => {
    const list = [...(fileList ?? [])].slice(0, 20)
    if (!list.length) return
    setUploading(true)
    try {
      const uploaded = []
      for (const file of list) {
        const res = await uploadAttachment(file)
        if (res?.attachment) uploaded.push(res.attachment)
      }
      if (uploaded.length) {
        setAttachments(prev => [...prev, ...uploaded].slice(0, 30))
        areaRef.current?.focus()
      }
    } catch (err) {
      toast(err.message || String(err), { error: true })
    } finally {
      setUploading(false)
    }
  }

  const resetComposer = () => {
    setText('')
    setAttachments([])
    setFocused(false)
  }

  const saveOnly = async () => {
    const value = text.trim()
    if ((!value && !attachments.length) || submitting || uploading) return
    setSubmitting(true)
    try {
      if (!attachments.length && /^https?:\/\//i.test(value) && !/\s/.test(value)) {
        await captureUrl(value)
        resetComposer()
        return
      }
      if (!attachments.length && looksLikeNotePath(value) && !value.includes('\n')) {
        await captureFile(value)
        resetComposer()
        return
      }
      if (!attachments.length) {
        const ids = relatedIdeas(roots, value)
        setDesk({ related: ids.length ? { query: value, ids, newId: null } : null })
      }
      const urls = extractUrls(value)
      const firstLine = value.split(/[。！？\n]|[.!?](?=\s|$)/)[0]?.trim().slice(0, 60) || ''
      const res = await launchIdea({
        title: firstLine,
        body: value.length > firstLine.length ? value : '',
        attachments,
        urls,
        styleId: styleId || undefined,
        goal,
        ...(mode !== 'auto' ? { creation: { mode } } : {}),
        startNow: false,
      })
      if (res) resetComposer()
    } catch (err) {
      toast(err.message, { error: true })
    } finally {
      setSubmitting(false)
    }
  }

  const startDrafting = async () => {
    const value = text.trim()
    if ((!value && !attachments.length) || submitting || uploading) return
    setSubmitting(true)
    try {
      const urls = extractUrls(value)
      const firstLine = value.split(/[。！？\n]|[.!?](?=\s|$)/)[0]?.trim().slice(0, 56) || ''
      const prompt = value || t('请阅读我挂载的全部附件，提炼核心价值并按我的个人风格直接成稿。')
      const res = await launchIdea({
        title: firstLine,
        body: value,
        prompt,
        attachments,
        urls,
        styleId: styleId || undefined,
        goal,
        ...(mode !== 'auto' ? { creation: { mode } } : {}),
        startNow: true,
      })
      if (res) resetComposer()
    } finally {
      setSubmitting(false)
    }
  }

  const now = new Date()
  const canAct = Boolean(text.trim() || attachments.length) && !submitting && !uploading

  return (
    <section className="md-hero" onPointerDown={e => e.stopPropagation()}>
      <p className="md-hero-date">{now.getFullYear()} · {t('{m} 月 {d} 日', { m: now.getMonth() + 1, d: now.getDate(), mon: now.toLocaleString('en-US', { month: 'short' }) })} · {t(WEEKDAYS[now.getDay()])}</p>
      <h1 className="md-hero-line">
        {t('还有')} <Inline src={pic(pending)} /> <b>{t('{n} 个灵感', { n: waiting, s: plural(waiting, '', 's') })}</b> {t('等你成稿，')}
        <br />
        <Inline src={pic(upcoming)} /> <b>{t('{n} 条内容', { n: upcoming.length, s: plural(upcoming.length, '', 's') })}</b> {t('排在本周，')}
        <br />
        {t('你已经连续记录')} <b className="md-hero-streak">{t('{n} 天', { n: streak, s: plural(streak, '', 's') })}</b>{t('。')}
      </h1>

      <form
        ref={boxRef}
        className={`md-hero-composer ${expanded ? 'is-expanded' : ''} ${dragging ? 'is-drag' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (attachments.length || text.includes('\n') || text.trim().length > 36) startDrafting()
          else saveOnly()
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!boxRef.current?.contains(e.relatedTarget)) setFocused(false)
        }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragging(false)
          if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
        }}
        onWheel={e => e.stopPropagation()}
      >
        {attachments.length > 0 ? (
          <div className="md-hero-atts" aria-label={t('已添加附件')}>
            {attachments.map(att => (
              <span key={att.id} className="md-att-chip" title={att.name}>
                <Icon name={att.mime?.startsWith('image/') ? 'image' : 'fileText'} size={12} />
                <span>{att.name}</span>
                <button type="button" aria-label={t('移除附件')} onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}>
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="md-hero-row">
          {!expanded ? (
            <button
              type="button"
              className="md-hero-plus"
              title={t('添加参考附件（PDF / 图片 / 文档 / 表格 / 代码，也可直接拖入）')}
              aria-label={t('添加参考附件')}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="plus" size={16} />
            </button>
          ) : null}
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = extractClipboardFiles(e.clipboardData)
              if (pasted.length) {
                e.preventDefault()
                addFiles(pasted)
              }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                startDrafting()
              } else if (e.key === 'Enter' && !e.shiftKey && !expanded) {
                e.preventDefault()
                saveOnly()
              }
            }}
            placeholder={t('记下一个灵感，或拖入附件、写下观点马上成稿…')}
            aria-label={t('记下灵感')}
          />
          {!expanded ? (
            <button type="submit" className="md-send" aria-label={t('记下')} disabled={!canAct}>
              <Icon name="send" size={15} />
            </button>
          ) : null}
        </div>

        {expanded ? (
          <div className="md-hero-bar">
            <div className="md-hero-picks">
              <button type="button" className="md-hero-chip" disabled={uploading} onClick={() => fileRef.current?.click()} title={t('支持 PDF、Word/Excel、图片、Markdown、CSV、字幕、代码等，由原生会话直接解析')}>
                <Icon name="plus" size={12} />
                <span>{uploading ? t('上传中…') : t('附件')}</span>
              </button>
              {styles.length > 0 ? (
                <label className="md-hero-select" title={t('写作风格')}>
                  <Icon name="pen" size={11} />
                  <select value={styleId} onChange={e => setStyleId(e.target.value)} aria-label={t('写作风格')}>
                    {styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="md-hero-select" title={t('产出目标')}>
                <select value={goal} onChange={e => setGoal(e.target.value)} aria-label={t('产出目标')}>
                  {GOAL_OPTS.map(opt => <option key={opt.value} value={opt.value}>{t(opt.label)}</option>)}
                </select>
              </label>
              <label className="md-hero-select" title={t('内容模式')}>
                <select value={mode} onChange={e => setMode(e.target.value)} aria-label={t('内容模式')}>
                  {MODE_OPTS.map(opt => <option key={opt.value} value={opt.value}>{t(opt.label)}</option>)}
                </select>
              </label>
            </div>
            <div className="md-hero-btns">
              <button type="button" className="md-hero-quiet" disabled={!canAct} onClick={saveOnly} title={t('仅保存为灵感卡片，稍后再写')}>
                {t('记下')}
              </button>
              <button type="button" className="md-hero-go" disabled={!canAct} onClick={startDrafting} title={t('保存并立即进入工作区开始写稿（⌘+Enter）')}>
                <Icon name="spark" size={12} />
                <span>{submitting ? t('正在进入成稿台…') : goLabel}</span>
              </button>
            </div>
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const list = e.target.files
            e.target.value = ''
            addFiles(list)
          }}
        />
      </form>
      {runningItems.length > 0 ? (
        <div className="md-hero-running" role="status">
          {runningItems.slice(0, 2).map(r => (
            <button key={r.id} type="button" className="md-hero-running-pill" onClick={() => openItem(r.id)}>
              <span className="md-live-dot" aria-hidden="true" />
              <span className="md-shimmer">{t('正在成稿')}</span>
              <b>《{(r.production?.title || r.title || t('未命名选题')).slice(0, 22)}》</b>
              <span className="md-hero-running-go">{t('查看实时进度 →')}</span>
            </button>
          ))}
        </div>
      ) : null}
      {counts.importedIdeas ? (
        <p className="md-hero-related">
          <span>{t('另有 {n} 条导入的灵感在「内容」里', { n: counts.importedIdeas })}</span>
          <button type="button" className="md-inline-link" onClick={() => setDesk({ view: 'content', focusId: null })}>{t('去看看')}</button>
        </p>
      ) : null}
      {related ? (
        <p className="md-hero-related">
          <span>{t('找到 {n} 条相关的灵感，放在了旁边', { n: related.ids.length, s: plural(related.ids.length, '', 's') })}</span>
          <button type="button" className="md-inline-link" onClick={() => setDesk({ related: null })}>{t('放回去')}</button>
        </p>
      ) : null}
      {roots.length === 0 ? (
        <p className="md-hero-hint">
          {t('写一句话、贴一个链接，或者把图片和视频拖进来。在 DeepSeek Harness 任何地方按 {keys} 也能记。', { keys: keysText(CAPTURE_KEY) })}
          <button type="button" className="md-inline-link" onClick={() => openCapture('file')}>{t('选图片或视频')}</button>
        </p>
      ) : null}
      <MiniStamps />
    </section>
  )
}

function Node({ item, pos, index, entered, onOpen, tone }) {
  const ref = React.useRef(null)
  React.useLayoutEffect(() => {
    if (entered.current.has(item.id)) return
    entered.current.add(item.id)
    const el = ref.current?.firstElementChild
    if (!el || reducedMotion()) return
    const k = 0.25
    el.animate([
      { transform: `translate(${-pos.x * k}px, ${-pos.y * k}px) scale(.8) rotate(${(hash(item.id) % 20) - 10}deg)`, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ], { duration: SPRING_SOFT.duration + 200, easing: SPRING_SOFT.easing, delay: Math.min(index * 32, 620), fill: 'backwards' })
  }, [entered, index, item.id, pos.x, pos.y])
  const size = cardSize(item)
  return (
    <div ref={ref} className={`md-node${tone ? ` is-${tone}` : ''}`} data-node={item.id} style={{ left: pos.x, top: pos.y, width: size.w, '--r': `${pos.r ?? 0}deg`, '--d': pos.d ?? 0 }}>
      <div className="md-pop"><Card item={item} onOpen={onOpen} /></div>
    </div>
  )
}

function originOf(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

function Scatter() {
  const items = useDesk(s => s.state.items)
  const stageRef = React.useRef(null)
  const worldRef = React.useRef(null)
  const { cam, flyTo, halt } = useCamera(stageRef, worldRef)
  const dragPos = React.useRef({})
  const [, force] = React.useReducer(v => v + 1, 0)
  const entered = React.useRef(new Set())
  const suppressClick = React.useRef(false)

  const kind = useDesk(s => s.kindFilter)
  const related = useDesk(s => s.related)
  const roots = React.useMemo(() => items.filter(isIdea), [items])
  const shown = React.useMemo(() => roots.filter(i => kind === 'all' || displayItem(i).kind === kind), [roots, kind])
  const rootKey = roots.map(i => `${i.id}:${i.pos ? `${i.pos.x},${i.pos.y}` : ''}:${i.production?.cover?.src ?? ''}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = React.useMemo(() => scatterLayout(roots), [rootKey])

  const relatedSpots = React.useMemo(() => {
    if (!related) return {}
    const byId = new Map(roots.map(i => [i.id, i]))
    return relatedLayout(related.ids.filter(id => byId.has(id)).map(id => ({ id, ...cardSize(byId.get(id)) })))
  }, [related, roots])

  const posOf = React.useCallback((item) => {
    if (dragPos.current[item.id]) return dragPos.current[item.id]
    if (related) {
      // 相关的围在中间那句话四周，刚记下的那条放在正上方，不被底部工具条挡住
      if (item.id === related.newId) return { x: 0, y: -200 - cardSize(item).h / 2, r: 0, d: 0 }
      const spot = relatedSpots[item.id]
      if (spot) return { ...spot, r: 0, d: 0 }
    }
    if (item.pos) return { d: 0, ...item.pos }
    return layout[item.id] ?? { x: 0, y: 0, r: 0, d: 0 }
  }, [layout, related, relatedSpots])

  // 拉出相关卡片后，镜头缩放到能把它们和中间那句话一起装下
  React.useEffect(() => {
    if (!related) return
    const byId = new Map(roots.map(i => [i.id, i]))
    let half = { x: 300, y: 240 }
    for (const [id, p] of Object.entries(relatedSpots)) {
      const size = cardSize(byId.get(id))
      half = { x: Math.max(half.x, Math.abs(p.x) + size.w / 2), y: Math.max(half.y, Math.abs(p.y) + size.h / 2) }
    }
    const fresh = related.newId && byId.get(related.newId)
    if (fresh) half.y = Math.max(half.y, 200 + cardSize(fresh).h)
    const home = frameHome()
    const { w, h } = stageBox()
    flyTo({ ...home, s: Math.min(home.s, (w - 80) / (half.x * 2), (h - 150) / (half.y * 2)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedSpots, related?.newId])

  const toneOf = (item) => {
    if (!related) return null
    if (item.id === related.newId || related.ids.includes(item.id)) return 'related'
    return 'dim'
  }

  const stageBox = React.useCallback(() => {
    const el = stageRef.current
    return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 1000, h: 700 }
  }, [])

  const frameHome = React.useCallback(() => {
    const { w, h } = stageBox()
    return { x: w / 2, y: h / 2 + 8, s: w < 760 ? 0.66 : w < 1040 ? 0.8 : w < 1400 ? 0.92 : 1 }
  }, [stageBox])

  React.useLayoutEffect(() => {
    flyTo(frameHome(), { instant: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 新记下的灵感可能落在屏幕外：相机带过去，让人看到它去了哪里
  const known = React.useRef(null)
  React.useEffect(() => {
    const previous = known.current
    known.current = new Set(roots.map(i => i.id))
    if (!previous) return
    const added = roots.find(i => !previous.has(i.id))
    if (!added) return
    if (related && !related.newId) {
      setDesk({ related: { ...related, newId: added.id } })
      return
    }
    const p = posOf(added)
    const size = cardSize(added)
    const { w, h } = stageBox()
    const c = cam.current
    const margin = 90
    const left = c.tx + c.ts * (p.x - size.w / 2)
    const right = c.tx + c.ts * (p.x + size.w / 2)
    const top = c.ty + c.ts * (p.y - size.h / 2)
    const bottom = c.ty + c.ts * (p.y + size.h / 2)
    const dx = left < margin ? margin - left : right > w - margin ? w - margin - right : 0
    const dy = top < margin ? margin - top : bottom > h - margin ? h - margin - bottom : 0
    if (dx || dy) flyTo({ x: c.tx + dx, y: c.ty + dy, s: c.ts })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots])

  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    let last = el.clientWidth
    const observer = new ResizeObserver(() => {
      const delta = el.clientWidth - last
      last = el.clientWidth
      if (!delta) return
      const c = cam.current
      flyTo({ x: c.tx + delta / 2, y: c.ty, s: c.ts }, { stiffness: 140, damping: 24 })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [cam, flyTo])

  const openCard = React.useCallback((item, event) => {
    if (suppressClick.current) return
    openItem(item.id, originOf(event))
  }, [])

  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest('input,textarea,button:not(.md-card),.md-toolrow,.md-ministamps')) return
    const cardEl = event.target.closest('[data-node]')
    const startX = event.clientX
    const startY = event.clientY
    const c = cam.current
    let moved = false
    suppressClick.current = false
    halt()
    if (cardEl) {
      const id = cardEl.dataset.node
      const origin = posOf(items.find(i => i.id === id))
      const onMove = (e) => {
        const dx = (e.clientX - startX) / c.s
        const dy = (e.clientY - startY) / c.s
        if (!moved && Math.hypot(dx, dy) < 4) return
        if (!moved) {
          moved = true
          cardEl.classList.add('is-dragging')
          suppressClick.current = true
        }
        const next = { x: origin.x + dx, y: origin.y + dy, r: origin.r, d: 0 }
        dragPos.current[id] = next
        cardEl.style.left = `${next.x}px`
        cardEl.style.top = `${next.y}px`
      }
      const onUp = async () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        cardEl.classList.remove('is-dragging')
        if (!moved) return
        const next = dragPos.current[id]
        setTimeout(() => { suppressClick.current = false }, 0)
        await dispatchOps([{ op: 'update_item', id, pos: { x: Math.round(next.x), y: Math.round(next.y), r: next.r } }], { undoable: false, silent: true })
        delete dragPos.current[id]
        force()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }
    const baseX = c.x
    const baseY = c.y
    let lastX = startX
    let lastY = startY
    let lastT = performance.now()
    let vx = 0
    let vy = 0
    stageRef.current.classList.add('is-panning')
    const onMove = (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true
      const now = performance.now()
      const dt = Math.max(now - lastT, 1)
      vx = (e.clientX - lastX) / dt
      vy = (e.clientY - lastY) / dt
      lastX = e.clientX
      lastY = e.clientY
      lastT = now
      flyTo({ x: baseX + e.clientX - startX, y: baseY + e.clientY - startY, s: c.s }, { instant: true })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      stageRef.current?.classList.remove('is-panning')
      if (moved) flyTo({ x: c.x + vx * 180, y: c.y + vy * 180, s: c.s }, { stiffness: 42, damping: 13 })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const zoomAt = React.useCallback((factor, cx, cy, instant = true) => {
    const c = cam.current
    const s = Math.max(0.3, Math.min(2.2, c.ts * factor))
    const k = s / c.ts
    flyTo({ x: cx - (cx - c.tx) * k, y: cy - (cy - c.ty) * k, s }, { instant, stiffness: 160, damping: 24 })
  }, [cam, flyTo])

  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top)
      } else {
        const c = cam.current
        flyTo({ x: c.tx - event.deltaX, y: c.ty - event.deltaY, s: c.ts }, { instant: true })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cam, flyTo, zoomAt])

  // 键盘 Tab 到屏幕外的卡片时，相机跟过去
  const onFocusIn = (event) => {
    const node = event.target.closest?.('[data-node]')
    if (!node || !event.target.matches(':focus-visible')) return
    const stageRect = stageRef.current.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    const c = cam.current
    const margin = 72
    let dx = 0
    let dy = 0
    if (rect.left < stageRect.left + margin) dx = stageRect.left + margin - rect.left
    else if (rect.right > stageRect.right - margin) dx = stageRect.right - margin - rect.right
    if (rect.top < stageRect.top + margin) dy = stageRect.top + margin - rect.top
    else if (rect.bottom > stageRect.bottom - margin) dy = stageRect.bottom - margin - rect.bottom
    if (dx || dy) flyTo({ x: c.tx + dx, y: c.ty + dy, s: c.ts })
  }

  const center = () => {
    const { w, h } = stageBox()
    return [w / 2, h / 2]
  }

  return (
    <div
      className="md-stage"
      ref={stageRef}
      onPointerDown={onPointerDown}
      onFocus={onFocusIn}
      onKeyDown={(event) => { if (event.key === 'Escape' && related) setDesk({ related: null }) }}
      onDragOver={e => e.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const files = [...(event.dataTransfer?.files ?? [])]
        if (files.length) captureFiles(files)
      }}
    >
      <div className="md-world" ref={worldRef}>
        <div className="md-hero-anchor"><Hero /></div>
        {shown.map((item, index) => <Node key={item.id} item={item} pos={posOf(item)} index={index} entered={entered} onOpen={openCard} tone={toneOf(item)} />)}
      </div>
      {/* 今日回顾浮在画布外层，不跟着镜头移动，也不占散落布局的位置 */}
      <TodayReview />
      <div className="md-toolrow md-toolrow-right" onPointerDown={e => e.stopPropagation()}>
        <IconButton icon="zoomOut" label={t('缩小')} onClick={() => zoomAt(0.8, ...center(), false)} />
        <IconButton icon="target" label={t('回到中心')} onClick={() => flyTo(frameHome())} />
        <IconButton icon="zoomIn" label={t('放大')} onClick={() => zoomAt(1.25, ...center(), false)} />
      </div>
    </div>
  )
}

/** 搜索：标题、正文、标签、来源里含有每个词才算命中，不分大小写。 */
function matchesQuery(item, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const shown = displayItem(item)
  // 成稿正文也搜：导入的稿子 body 只是摘录
  const text = [shown.title, item.body, item.production?.article, item.source, ...(item.tags ?? [])].filter(Boolean).join(' ').toLowerCase()
  return words.every(word => text.includes(word))
}

/** 用得最多的几个标签，给筛选条用。 */
function topTags(items, limit = 8) {
  const counts = new Map()
  for (const item of items) if (isIdea(item)) for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag)
}

/** 信息流：原来的瀑布流卡片，按时间从新到旧排。 */
function Feed() {
  const items = useDesk(s => s.state.items)
  const kind = useDesk(s => s.kindFilter)
  const related = useDesk(s => s.related)
  const query = useDesk(s => s.query)
  const tag = useDesk(s => s.tagFilter)
  const wallSort = useDesk(s => s.wallSort)
  const rank = id => (related ? related.ids.indexOf(id) : -1)
  const sorted = React.useMemo(() => items
    .filter(i => isIdea(i) && (kind === 'all' || displayItem(i).kind === kind) && (!tag || (i.tags ?? []).includes(tag)) && matchesQuery(i, query))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    // 按评分：打过分的从高到低，没打分的按时间排在后面
    .sort((a, b) => (wallSort === 'score' ? (Number.isFinite(b.score) ? b.score : -1) - (Number.isFinite(a.score) ? a.score : -1) : 0))
    // 有相关的灵感时排在最前面，按相关程度
    .sort((a, b) => {
      const ra = rank(a.id)
      const rb = rank(b.id)
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [items, kind, related, query, tag, wallSort])
  return (
    <div className="md-wall-scroll">
      <div className="md-feed-hero"><Hero /><TodayReview inline /></div>
      {query.trim() || tag ? <p className="md-wall-count">{sorted.length ? t('找到 {n} 条', { n: sorted.length }) : t('没有符合的灵感，换个词或清掉筛选')}</p> : null}
      <div className="md-wall">
        {sorted.map((item, index) => (
          <div key={item.id} className={`md-wall-cell${rank(item.id) >= 0 ? ' is-related' : ''}`} style={{ animationDelay: `${Math.min(index * 22, 400)}ms` }}>
            <Card item={item} onOpen={(row, event) => openItem(row.id, originOf(event))} />
          </div>
        ))}
      </div>
    </div>
  )
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const KIND_OPTIONS = [{ value: 'all', label: '全部' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }, { value: 'web', label: '网页' }, { value: 'quote', label: '金句' }, { value: 'note', label: '笔记' }]

export function HomeView() {
  const mode = useDesk(s => s.mode)
  const kind = useDesk(s => s.kindFilter)
  const query = useDesk(s => s.query)
  const tag = useDesk(s => s.tagFilter)
  const wallSort = useDesk(s => s.wallSort)
  const items = useDesk(s => s.state.items)
  const tags = React.useMemo(() => topTags(items), [items])
  return (
    <div className="md-home">
      {mode === 'feed' ? <Feed /> : <Scatter />}
      <div className="md-dockbar" role="toolbar" aria-label={t('灵感视图')}>
        <Segmented
          label={t('展示方式')}
          value={mode}
          onChange={value => setDesk({ mode: value })}
          options={[{ value: 'scatter', icon: 'scatter', title: t('散落') }, { value: 'feed', icon: 'wall', title: t('信息流') }]}
        />
        <span className="md-dockbar-sep" />
        <div className="md-chips">
          {KIND_OPTIONS.map(option => (
            <button type="button" key={option.value} className={kind === option.value ? 'is-on' : ''} onClick={() => setDesk({ kindFilter: option.value })}>{t(option.label)}</button>
          ))}
          {mode === 'feed' ? <button type="button" className={wallSort === 'score' ? 'is-on' : ''} aria-pressed={wallSort === 'score'} title={t('打过选题评分的从高到低排在前面')} onClick={() => setDesk({ wallSort: wallSort === 'score' ? null : 'score' })}>{t('按评分')}</button> : null}
        </div>
        <span className="md-dockbar-sep" />
        <label className="md-dock-search">
          <Icon name="search" size={14} />
          {/* 搜索结果按列表看更清楚，输入时自动切到信息流 */}
          <input type="search" value={query} placeholder={t('搜灵感')} aria-label={t('搜索灵感')} onChange={e => setDesk({ query: e.target.value, ...(e.target.value.trim() ? { mode: 'feed' } : {}) })} />
        </label>
        {tags.length ? (
          <div className="md-chips md-dock-tags">
            {tags.map(name => <button type="button" key={name} className={tag === name ? 'is-on' : ''} onClick={() => setDesk({ tagFilter: tag === name ? null : name, mode: 'feed' })}>#{name}</button>)}
          </div>
        ) : null}
        <span className="md-dockbar-sep" />
        <button type="button" className="md-round is-primary" aria-label={t('记下灵感')} title={t('记下灵感')} onClick={() => openCapture('text')}><Icon name="plus" size={18} /></button>
      </div>
    </div>
  )
}
