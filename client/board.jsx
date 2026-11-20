// 大屏：打开就能看全的一页。最近的几条稿子轮播、粉丝合计和每日净增、按规则算出的几句分析，下面一排平台卡片。
import React from 'react'
import { GhostBars, NetBars, PlatformMark, colorOf } from './board-charts.jsx'
import { AutoReadStatus, PlatformCard, autoReadFollowers, editAccountLinks, logFollowers, readAccountsNow } from './board-accounts.jsx'
import { CollectEntry } from './collect-entry.jsx'
import { IncomeTile } from './board-income.jsx'
import { boardAgeLine } from '../src/age-compare.js'
import { typeCover } from './cover.js'
import { dispatchOps, fetchBoard, openItem, refreshPublic, setDesk, toast, useDesk } from './desk.js'
import { StartCard, useFreshDesk } from './start-card.jsx'
import { t, useLang } from './i18n.js'
import { Dialog, Icon, IconButton, Segmented, Swap } from './ui.jsx'
import { ACCOUNT_PLATFORMS, compact, dayKey, displayItem, fmtDate, fmtWhen, isPublished, pad, posterOf } from './util.js'

// 别的页面从这里拿平台图标；命令面板从这里拿「自动读取」
export { PlatformMark, autoReadFollowers }

const REFRESH_MS = 60_000
const signed = n => `${n > 0 ? '+' : ''}${n.toLocaleString()}`
const rate = value => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`)
const short = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

function Delta({ label, value, why }) {
  if (value === null || value === undefined) return null
  return <span className={`md-b-delta ${value > 0 ? 'is-up' : value < 0 ? 'is-down' : ''}`} title={why}>{label} <b>{signed(value)}</b></span>
}

/** 合计里有的平台没数时，标上是几个平台的合计。 */
function partOf(total, key) {
  return total.partial?.[key] ? t('{n}/{m} 个平台', { n: total.known[key], m: total.platforms }) : ''
}

function Clock() {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(timer)
  }, [])
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  return <span className="md-b-clock"><small>{now.getMonth() + 1}/{now.getDate()} {t(week)}</small>{pad(now.getHours())}:{pad(now.getMinutes())}</span>
}

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen?.()
  else el?.requestFullscreen?.().catch(() => toast(t('这个窗口不能全屏'), { error: true }))
}

const go = view => setDesk({ view, focusId: null })

/* ───────────── 最新发布：正文洗成纯文字 ───────────── */

/** 一行 Markdown 去掉格式符号，只留读得出来的字。 */
function plainLine(line) {
  return line
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/<\/?[A-Za-z][^<>]*>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*>+\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g, '$1$2')
    .replace(/==(.+?)==/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_=~]{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 正文去掉标题、表格、分隔线、代码块和 front matter，剩下的每段洗成纯文字。 */
export function plainText(markdown) {
  const body = String(markdown ?? '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?(?:```|$)/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
  return body.split('\n')
    .filter(line => !/^\s{0,3}(?:#{1,6}\s|\|)/.test(line) && !/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line))
    .map(plainLine)
    .filter(Boolean)
}

/** 简介：正文里第一句像样的话，太短就再接一句。传进来的是 plainText 洗过的各段。 */
function introOf(paragraphs, title) {
  // 只有话题标签（#AI编程 #Codex）的那种行不算正文
  const lines = paragraphs.filter(line => line !== title && [...line.replace(/#\S+/gu, '').replace(/[^\p{L}\p{N}]/gu, '')].length >= 6)
  const sentences = lines.slice(0, 3).join(' ').match(/[^。！？!?]+[。！？!?]*/gu) ?? []
  let out = ''
  for (const sentence of sentences) {
    out += sentence.trim()
    if ([...out].length >= 36) break
  }
  return [...out].slice(0, 160).join('')
}

/** 字数：汉字一个算一个，英文和数字一个词算一个。 */
function wordCount(lines) {
  const text = lines.join(' ')
  return (text.match(/\p{Script=Han}/gu)?.length ?? 0) + (text.match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g)?.length ?? 0)
}

/* ───────────── 最新发布：挑哪几条、各自的数据 ───────────── */

const SLIDES = 5
const CYCLE_MS = 6000
const when = item => item.publishedAt || item.scheduledAt || item.production?.finishedAt || item.updatedAt || item.createdAt || ''
// 已发布 → 排了期的 → 待发布 → 成了稿的；灵感不放进来
function rankOf(item, now) {
  // 和内容页同一套「已发布」：任何一个平台记了已发布就算
  if (isPublished(item)) return 0
  if (item.scheduledAt && Date.parse(item.scheduledAt) >= now) return 1
  if (item.status === 'ready') return 2
  if (item.production?.status === 'done' && item.status !== 'idea') return 3
  return -1
}
const KIND = ['published', 'scheduled', 'ready', 'done']
const EYEBROW = { published: '已发布', scheduled: '即将发布', ready: '待发布', done: '刚成稿' }
const PUBLISH_STATE = { copied: '已复制', drafted: '已推草稿', published: '已发布' }

function addUp(rows) {
  const sum = values => (values.length ? values.reduce((a, b) => a + b, 0) : null)
  const engaged = row => sum([row.likes, row.comments, row.shares, row.saves, row.recommends].filter(Number.isFinite))
  const paired = rows.filter(row => row.views > 0 && engaged(row) !== null)
  return {
    views: sum(rows.map(row => row.views).filter(Number.isFinite)),
    engaged: sum(rows.map(engaged).filter(value => value !== null)),
    rate: paired.length ? sum(paired.map(engaged)) / sum(paired.map(row => row.views)) : null,
  }
}

function coverOf(item, platform, at) {
  const real = item.production?.status === 'running' ? null : item.production?.cover?.src || posterOf(displayItem(item))
  if (real) return { src: real, real: true }
  return { src: typeCover({ id: item.id, title: displayItem(item).title, platform, date: at }), real: false }
}

/** 一条稿子在大屏上要显示的全部内容。 */
function slideOf(item, { rank, metrics, previous, targets }) {
  const shown = displayItem(item)
  const own = metrics.filter(row => row.itemId === item.id)
  const at = item.publishedAt || item.scheduledAt || null
  const platforms = [...new Set([item.platform, ...Object.keys(item.publish ?? {}), ...own.map(row => row.platform), ...targets].filter(Boolean))].slice(0, 4)
  const chips = platforms.map((platform) => {
    const rows = own.filter(row => row.platform === platform)
    const state = item.publish?.[platform]?.state ?? (item.status === 'published' && platform === item.platform ? 'published' : null)
    return { platform, state, ...addUp(rows) }
  })
  // 正文只洗一遍，简介和字数都用它
  const paragraphs = plainText(item.production?.article || item.body || '')
  return {
    id: item.id,
    kind: KIND[rank],
    title: shown.title,
    intro: introOf(paragraphs, shown.title),
    length: wordCount(paragraphs),
    platform: item.platform ?? null,
    at,
    created: item.createdAt,
    cover: coverOf(item, item.platform, at || item.createdAt),
    chips,
    stats: addUp(own),
    previous: previous ? { id: previous.id, title: displayItem(previous).title, views: addUp(metrics.filter(row => row.itemId === previous.id)).views } : null,
    // 和上一篇的同龄对比：两边发布后同一个龄期都有数、算得出倍数时才有
    age: rank === 0 && previous ? boardAgeLine(metrics, { ...item, title: shown.title }, { ...previous, title: displayItem(previous).title }, t) : null,
  }
}

/** 只有示例数据时，服务端算好的那条直接用。 */
function slideFromBoard(latest) {
  return {
    id: latest.id,
    kind: latest.scheduled ? 'scheduled' : 'published',
    title: latest.title,
    intro: introOf(plainText(latest.summary), latest.title),
    length: 0,
    platform: latest.platform,
    at: latest.at,
    created: latest.at,
    cover: latest.cover ? { src: latest.cover, real: true } : { src: typeCover({ id: latest.id, title: latest.title, platform: latest.platform ?? '', date: latest.at ?? '' }), real: false },
    chips: latest.platforms.map(row => ({ platform: row.platform, state: null, views: row.views, engaged: row.engaged })),
    stats: { views: latest.views, engaged: latest.engaged, rate: latest.engagementRate },
    previous: latest.previous,
    // 示例数据（还没有自己的内容）没法比同龄：同样交给 slideOf 算
    age: null,
  }
}

function buildSlides(items, metrics, latest) {
  const now = Date.now()
  const tops = items.filter(item => !item.parentId && !item.sample)
  if (!tops.length) return latest ? [slideFromBoard(latest)] : []
  const ranked = tops.map(item => ({ item, rank: rankOf(item, now) })).filter(row => row.rank >= 0)
  // 排期按时间先后，其余按最近在前
  ranked.sort((a, b) => a.rank - b.rank || (a.rank === 1 ? when(a.item).localeCompare(when(b.item)) : when(b.item).localeCompare(when(a.item))))
  const first = latest ? ranked.findIndex(row => row.item.id === latest.id) : -1
  if (first > 0) ranked.unshift(...ranked.splice(first, 1))
  const published = ranked.filter(row => row.rank === 0).map(row => row.item)
  // 每条都列出自己常发的平台，没发过的显示「未处理」
  const counts = new Map()
  for (const item of tops) if (item.platform) counts.set(item.platform, (counts.get(item.platform) ?? 0) + 1)
  const targets = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([platform]) => platform)
  const real = metrics.some(row => !row.sample) ? metrics.filter(row => !row.sample) : metrics
  return ranked.slice(0, SLIDES).map(({ item, rank }) => slideOf(item, {
    rank,
    metrics: real,
    targets,
    previous: rank === 0 ? published[published.indexOf(item) + 1] ?? null : null,
  }))
}

/* ───────────── 最新发布：格子 ───────────── */

function Chip({ chip }) {
  const data = chip.views ?? chip.engaged
  return (
    <li className={`md-b-chip ${chip.state ? `is-${chip.state}` : ''}`}>
      <PlatformMark platform={chip.platform} size={22} />
      <span className="md-b-chip-name">{t(chip.platform)}</span>
      {data !== null && data !== undefined
        ? <b>{chip.views !== null && chip.views !== undefined ? t('{n} 播放', { n: compact(chip.views) }) : t('{n} 互动', { n: compact(chip.engaged) })}</b>
        : <em><i aria-hidden="true" />{t(chip.state ? PUBLISH_STATE[chip.state] : '未处理')}</em>}
    </li>
  )
}

function SlideFoot({ slide }) {
  const { stats } = slide
  if (slide.kind !== 'published') {
    return (
      <div className="md-b-actions">
        <button type="button" className="md-btn is-small is-primary" onClick={() => go('publish')}><Icon name="send" size={13} />{t('去发布')}</button>
        <button type="button" className="md-btn is-small" onClick={() => go('schedule')}><Icon name="calendar" size={13} />{slide.kind === 'scheduled' ? t('改排期') : t('排期')}</button>
      </div>
    )
  }
  if (stats.views === null && stats.engaged === null) {
    return <p className="md-b-quiet">{t('这条还没有播放和互动数据。')}<button type="button" onClick={() => go('insights')}>{t('到「复盘」录入')}<Icon name="chevR" size={12} /></button></p>
  }
  return (
    <dl className="md-b-stats">
      <div><dt>{t('全平台播放')}</dt><dd>{compact(stats.views)}</dd></div>
      <div><dt title={t('赞、评、藏、转合计')}>{t('互动')}</dt><dd>{compact(stats.engaged)}</dd></div>
      <div><dt>{t('互动率')}</dt><dd title={stats.rate === null ? t('没有同时记了播放和互动的数据，算不出互动率') : undefined}>{rate(stats.rate)}</dd></div>
    </dl>
  )
}

function whenLine(slide) {
  const where = slide.platform ? ` · ${t(slide.platform)}` : ''
  if (slide.kind === 'published') return t('发布于 {when}', { when: fmtWhen(slide.at) }) + where
  if (slide.kind === 'scheduled') return t('定时 {when}', { when: fmtWhen(slide.at) }) + where
  return t('还没排期 · 写于 {date}', { date: fmtDate(slide.created) }) + where
}

function Slide({ slide, first }) {
  const open = () => openItem(slide.id)
  const eyebrow = first && slide.kind === 'published' ? t('最新发布') : t(EYEBROW[slide.kind])
  return (
    <div className="md-b-slide">
      <figure className="md-b-cover-wrap">
        <button type="button" className="md-b-cover" onClick={open} aria-label={t('打开《{title}》', { title: slide.title })}>
          {slide.cover.src ? <img src={slide.cover.src} alt="" draggable={false} /> : null}
        </button>
        {slide.cover.real && slide.platform ? <span className="md-b-cover-badge"><PlatformMark platform={slide.platform} size={28} /></span> : null}
        <span className={`md-b-cover-pill is-${slide.kind}`}><i aria-hidden="true" />{slide.length ? t('{n} 字', { n: slide.length.toLocaleString() }) : t(EYEBROW[slide.kind])}</span>
      </figure>
      <div className="md-b-latest-copy">
        <span className="md-b-eyebrow">{eyebrow}</span>
        <h1><button type="button" onClick={open}>{slide.title}</button></h1>
        {slide.intro ? <p className="md-b-summary">{slide.intro}</p> : null}
        <p className="md-b-when"><Icon name="clock" size={13} />{whenLine(slide)}</p>
        {slide.chips.length ? <ul className="md-b-chips" aria-label={t('各平台进度')}>{slide.chips.map(chip => <Chip key={chip.platform} chip={chip} />)}</ul> : null}
        <span className="md-grow" />
        <SlideFoot slide={slide} />
        {slide.previous ? (
          <p className="md-b-prev">
            <span>{t('上一期')}</span>
            <button type="button" onClick={() => openItem(slide.previous.id)}>《{slide.previous.title}》</button>
            <b>{slide.previous.views === null ? t('还没有数据') : t('{n} 播放', { n: slide.previous.views.toLocaleString() })}</b>
          </p>
        ) : null}
        {/* 同龄对比：上一期在同一龄期的数够比时才出现 */}
        {slide.age ? <p className="md-b-age" title={slide.age.text}>{slide.age.text}</p> : null}
      </div>
    </div>
  )
}

/** 小圆点：当前那颗拉长成进度条，走完自动翻到下一条；悬停、聚焦或系统要求减少动态时不走。 */
function Dots({ slides, index, onPick, onDone, running }) {
  const onKey = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (index + step + slides.length) % slides.length
    onPick(next)
    event.currentTarget.querySelectorAll('button')[next]?.focus()
  }
  return (
    <div className={`md-b-dots ${running ? '' : 'is-paused'}`} role="group" aria-label={t('切换最近的稿子')} onKeyDown={onKey}>
      {slides.map((slide, i) => (
        <button type="button" key={slide.id} className={i === index ? 'is-on' : ''} aria-current={i === index ? 'true' : undefined} aria-label={t('第 {n} 条：{title}', { n: i + 1, title: slide.title })} title={slide.title} onClick={() => onPick(i)}>
          {i === index ? <i key={slide.id} onAnimationEnd={event => { if (event.animationName === 'md-b-progress') onDone() }} /> : null}
        </button>
      ))}
    </div>
  )
}

function LatestTile({ board }) {
  const items = useDesk(s => s.state.items)
  const metrics = useDesk(s => s.state.metrics)
  const slides = React.useMemo(() => buildSlides(items, metrics ?? [], board.latest), [items, metrics, board.latest])
  const [index, setIndex] = React.useState(0)
  const [hover, setHover] = React.useState(false)
  const [focus, setFocus] = React.useState(false)
  if (!slides.length) {
    return (
      <section className="md-tile md-b-latest is-empty">
        <p className="md-muted">{t('还没有发布或排期的内容。在「内容」里把一条稿子标成已发布，这里就会出现。')}</p>
        <div className="md-empty-actions"><button type="button" className="md-btn" onClick={() => go('content')}>{t('去内容页')}</button></div>
      </section>
    )
  }
  const current = index % slides.length
  const next = () => setIndex(i => (i + 1) % slides.length)
  return (
    <section
      className="md-tile md-b-latest"
      aria-roledescription={t('轮播')}
      aria-label={t('最近的稿子')}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      // 鼠标点圆点也会让它获得焦点，只有键盘聚焦才算「正在看」，不然点一下就再也不轮播了
      onFocus={(event) => { if (event.target.matches(':focus-visible')) setFocus(true) }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false) }}
    >
      <Slide key={slides[current].id} slide={slides[current]} first={current === 0} />
      {slides.length > 1 ? <Dots slides={slides} index={current} onPick={setIndex} onDone={next} running={!hover && !focus} /> : null}
    </section>
  )
}

/* ───────────── 粉丝 ───────────── */

function FansTile({ board, onAutoRead, marks }) {
  const [show, setShow] = React.useState('chart')
  const platforms = board.platforms.map(row => row.platform).filter(platform => board.daily.some(row => row.net[platform] !== undefined))
  const hasNet = platforms.length > 0
  const total = board.total.followers
  const known = total !== null && total !== undefined
  return (
    <section className={`md-tile md-b-fans ${known ? '' : 'is-empty'}`}>
      <header className="md-tile-head">
        <h2>{t('粉丝')}</h2>
        <span className="md-tile-meta" title={board.total.partial?.followers ? t('有的平台还没记粉丝数，这里只加了记过的') : undefined}>{!known ? t('还没有平台记过粉丝') : board.total.partial?.followers ? t('{n}/{m} 个平台合计', { n: board.total.known.followers, m: board.total.platforms }) : t('{n} 个平台合计', { n: board.platforms.filter(row => row.followers !== null).length })}</span>
        <span className="md-grow" />
        {hasNet ? <Segmented label={t('显示方式')} value={show} onChange={setShow} options={[{ value: 'chart', label: t('图') }, { value: 'table', label: t('表') }]} /> : null}
      </header>
      {known ? (
        <>
          <div className="md-b-total">{total.toLocaleString()}</div>
          <div className="md-b-deltas">
            <Delta label={[t('今日'), partOf(board.total, 'today')].filter(Boolean).join(' · ')} value={board.total.today} why={board.total.partial?.today ? t('只加了两头都记过的平台') : undefined} />
            <Delta label={[t('近 7 天'), partOf(board.total, 'd7')].filter(Boolean).join(' · ')} value={board.total.d7} why={board.total.partial?.d7 ? t('只加了两头都记过的平台') : undefined} />
            <Delta label={[t('近 30 天'), partOf(board.total, 'd30')].filter(Boolean).join(' · ')} value={board.total.d30} why={board.total.partial?.d30 ? t('只加了两头都记过的平台') : undefined} />
            {board.total.today === null && board.total.d7 === null ? <span className="md-b-delta">{t('连续记两天就能看到涨跌')}</span> : null}
          </div>
        </>
      ) : null}
      {hasNet ? (
        <>
          <div className="md-b-legend">
            <span>{t('每日净增 · 近 30 天')}</span>
            <span className="md-grow" />
            {platforms.map(platform => <span key={platform} className="md-b-key"><i style={{ background: colorOf(platform) }} />{t(platform)}</span>)}
          </div>
          {show === 'chart' ? <div className="md-b-plot"><NetBars daily={board.daily} platforms={platforms} label={t('近 30 天各平台每日净增粉丝')} /></div> : (
            <div className="md-i-table">
              <table className="md-table is-plain">
                <thead><tr><th>{t('日期')}</th>{platforms.map(p => <th key={p} className="is-num">{t(p)}</th>)}<th className="is-num">{t('合计')}</th></tr></thead>
                <tbody>{[...board.daily].reverse().filter(row => Object.keys(row.net).length).map(row => <tr key={row.date}><td>{row.date}</td>{platforms.map(p => <td key={p} className="is-num">{row.net[p] === undefined ? '—' : signed(row.net[p])}</td>)}<td className="is-num">{signed(row.total)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="md-b-ghost">
          <GhostBars />
          <div className="md-b-ghost-copy">
            {known ? null : <span className="md-b-ghost-marks" aria-hidden="true">{marks.map(platform => <PlatformMark key={platform} platform={platform} size={32} />)}</span>}
            <p>{known ? t('明天再记一次，这里就会画出每日净增') : t('记录后这里会画出每日净增')}</p>
            <button type="button" className="md-btn is-primary" onClick={() => logFollowers(board)}><Icon name="plus" size={14} />{t('记录今天的粉丝数')}</button>
            {known ? null : <button type="button" className="md-b-link" onClick={onAutoRead}>{t('或者填好主页地址，自动读取')}</button>}
          </div>
        </div>
      )}
    </section>
  )
}

/* ───────────── 数据分析 ───────────── */

const TAG_TONE = { 涨粉: 'up', 发布日: 'day', 播放: 'play', 互动: 'talk', 收藏: 'save' }
// 数据不够时先告诉用户以后会出现哪几类，每一类要什么数据
const UPCOMING = [
  { tag: '涨粉', text: '近 7 天哪个平台涨得最多' },
  { tag: '发布日', text: '发布当天比平时多涨多少' },
  { tag: '播放', text: '播放主要来自哪个平台' },
  { tag: '互动', text: '哪个平台互动率最高' },
]

/** 句子里的数字加粗，一眼先看到数。 */
function withNumbers(text) {
  return text.split(/([+-]?\d[\d,]*(?:\.\d+)?%?)/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))
}

function AnalysisTile({ analysis, info, reading, onRead }) {
  return (
    <section className="md-tile md-b-analysis">
      <header className="md-tile-head"><h2>{t('数据分析')}</h2><span className="md-grow" /><span className="md-tile-meta">{t('按规则自动算')}</span></header>
      {analysis.length ? (
        <ul className="md-b-notes">
          {analysis.map(row => <li key={row.tag}><span className={`md-b-tag is-${TAG_TONE[row.tag] ?? 'up'}`}>{t(row.tag)}</span><p>{withNumbers(row.text)}</p></li>)}
        </ul>
      ) : (
        <div className="md-b-notes is-upcoming">
          <p className="md-b-notes-lead">{t('数据够了以后，这里会自动写出：')}</p>
          <ul>
            {UPCOMING.map(row => <li key={row.tag}><span className={`md-b-tag is-${TAG_TONE[row.tag]}`}>{t(row.tag)}</span><p>{t(row.text)}</p></li>)}
          </ul>
          <CollectEntry info={info} reading={reading} onRead={onRead} className="is-compact" />
        </div>
      )}
    </section>
  )
}

/* ───────────── 平台卡片 ───────────── */

// 一个平台都没数据时，默认只放最常用的四个，不摆一长排空卡
const COMMON = ['公众号', '小红书', '抖音', 'B站']

function blankRow(platform) {
  return { platform, blank: true, followers: null, today: null, d7: null, spark: [], latestViews: null, previousViews: null, engagementRate: null }
}

/** 用户选过就按选的顺序；没选过（自动）就放有数据的平台，没有就放常用的四个。 */
function shownRows(chosen, rows) {
  const names = chosen?.length ? chosen : rows.length ? rows.map(row => row.platform) : COMMON
  return names.map(platform => rows.find(row => row.platform === platform) ?? blankRow(platform))
}

/** 横向放不下时左右边缘渐隐，提示还能往旁边滚。卡片张数变了要重新量。 */
function useEdges(count) {
  const ref = React.useRef(null)
  const [edges, setEdges] = React.useState('')
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const more = el.scrollWidth - el.clientWidth > 1
      setEdges(!more ? '' : `${el.scrollLeft > 1 ? 'has-left' : ''} ${el.scrollLeft < el.scrollWidth - el.clientWidth - 1 ? 'has-right' : ''}`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure) }
  }, [count])
  return [ref, edges]
}

function PlatformRow({ board, chosen, accounts, onPick }) {
  const rows = shownRows(chosen, board.platforms)
  const [ref, edges] = useEdges(rows.length)
  const quiet = rows.every(row => row.followers === null)
  const support = board.autoRead?.support ?? {}
  return (
    <div className={`md-b-cards ${quiet ? 'is-quiet' : ''} ${edges}`} ref={ref} style={{ '--n': rows.length, '--cols': Math.min(rows.length, 4) }}>
      {rows.map(row => (
        <PlatformCard
          key={row.platform}
          row={row}
          auto={support[row.platform]}
          onLog={() => logFollowers(board)}
          onLink={() => editAccountLinks(accounts, support, row.platform)}
          onRead={() => readAccountsNow([row.platform])}
        />
      ))}
      <button type="button" className="md-b-pick-btn" onClick={onPick} title={t('显示哪些平台')}><Icon name="gear" size={16} /><span>{t('显示哪些平台')}</span></button>
    </div>
  )
}

/** 选大屏下面放哪些平台、什么顺序。存成 set_board_platforms，可撤销；全不选就是自动。 */
function PlatformPicker({ chosen, withData, onClose }) {
  const [list, setList] = React.useState(() => (chosen?.length ? chosen : withData.length ? withData : COMMON))
  const toggle = platform => setList(current => (current.includes(platform) ? current.filter(p => p !== platform) : [...current, platform]))
  const move = (platform, step) => setList((current) => {
    const from = current.indexOf(platform)
    const to = from + step
    if (to < 0 || to >= current.length) return current
    const next = [...current]
    next[from] = current[to]
    next[to] = platform
    return next
  })
  const save = (platforms) => {
    dispatchOps([{ op: 'set_board_platforms', platforms }], { label: t('调整大屏平台') })
    onClose()
  }
  const rest = ACCOUNT_PLATFORMS.filter(platform => !list.includes(platform))
  const row = (platform, on, index) => (
    <li key={platform} className={on ? 'is-on' : ''}>
      <label>
        <input type="checkbox" checked={on} onChange={() => toggle(platform)} />
        <PlatformMark platform={platform} size={22} />
        <span>{t(platform)}</span>
        {withData.includes(platform) ? <small>{t('有数据')}</small> : null}
      </label>
      {on ? (
        <span className="md-b-pick-move">
          <IconButton icon="chevD" className="is-up" label={t('往前挪')} disabled={index === 0} onClick={() => move(platform, -1)} />
          <IconButton icon="chevD" label={t('往后挪')} disabled={index === list.length - 1} onClick={() => move(platform, 1)} />
        </span>
      ) : null}
    </li>
  )
  return (
    <Dialog title={t('显示哪些平台')} onClose={onClose} width={420}>
      <p className="md-b-pick-hint">{t('勾选放在大屏下面的平台，用箭头调顺序。上面的粉丝合计仍然算所有记过数的平台。')}</p>
      <ul className="md-b-pick">
        {list.map((platform, index) => row(platform, true, index))}
        {rest.map(platform => row(platform, false, -1))}
      </ul>
      <div className="md-b-pick-foot">
        <button type="button" className="md-btn is-small" onClick={() => save([])} title={t('有数据的平台；都没有时放最常用的四个')}>{t('改回自动')}</button>
        <span className="md-grow" />
        <button type="button" className="md-btn is-small" onClick={onClose}>{t('取消')}</button>
        <button type="button" className="md-btn is-small is-primary" onClick={() => save(list)}>{t('保存')}</button>
      </div>
    </Dialog>
  )
}

/* ───────────── 整页 ───────────── */

export function BoardView() {
  useLang()
  const version = useDesk(s => s.state)
  const [board, setBoard] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [attempt, setAttempt] = React.useState(0)
  const root = React.useRef(null)
  const accounts = useDesk(s => s.state.accounts)
  const chosen = useDesk(s => s.state.boardPlatforms)
  const [reading, setReading] = React.useState(false)
  // 打开大屏时公开接口的数过了 6 小时：在后台补读一次，不挡界面，状态条写「正在更新」
  const [refreshing, setRefreshing] = React.useState(false)
  const refreshed = React.useRef(false)
  const stale = Boolean(board?.autoRead?.stale)
  React.useEffect(() => {
    if (!stale || refreshed.current) return
    refreshed.current = true
    setRefreshing(true)
    refreshPublic().catch(() => {}).finally(() => setRefreshing(false))
  }, [stale])
  const [picking, setPicking] = React.useState(false)
  // 还没有任何自己的内容、订阅和粉丝记录：先给三步上手，不摆一排空格子
  const fresh = useFreshDesk()
  const autoRead = async () => {
    setReading(true)
    try {
      await autoReadFollowers(board?.autoRead?.support)
    } finally {
      setReading(false)
    }
  }
  React.useEffect(() => {
    let alive = true
    const load = () => fetchBoard()
      .then((next) => { if (alive) { setBoard(next); setError(null) } })
      .catch((err) => { if (alive) setError(err.message || String(err)) })
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [version, attempt])
  if (!board && error) return <div className="md-page"><p className="md-muted">{t('大屏加载失败：{error}', { error })}</p><button type="button" className="md-btn" onClick={() => setAttempt(n => n + 1)}>{t('重试')}</button></div>
  if (!board) return <div className="md-board-page"><div className="md-tile md-b-latest" /></div>
  return (
    <div className="md-board-page md-b-page" ref={root}>
      {/* 顶上只留一行：数据记到哪天、时间，和一个「更新数据」入口。别的入口都收进各自的格子里 */}
      <div className="md-b-bar">
        <span className="md-b-status"><i className={board.updatedAt === dayKey(new Date()) ? 'is-ok' : ''} />{board.updatedAt ? t('粉丝数记到 {date}', { date: short(board.updatedAt) }) : t('还没有粉丝记录')}</span>
        <AutoReadStatus info={board.autoRead} reading={reading} refreshing={refreshing} onRead={autoRead} onLinks={() => editAccountLinks(accounts, board.autoRead?.support)} />
        {board.hasSample ? <span className="md-b-status">{t('现在是示例数据')}</span> : null}
        {error ? <span className="md-b-status">{t('刷新失败，显示的是上一次的数据')}</span> : null}
        <span className="md-grow" />
        {/* 视频页入口：口播稿、提词录制、字幕、粗剪 */}
        <button type="button" className="md-pill is-small" onClick={() => go('video')}><Icon name="film" size={13} />{t('做视频')}</button>
        <details className="md-b-menu">
          <summary className="md-pill is-small"><Icon name="refresh" size={13} /><Swap labels={[t('更新数据'), t('正在读取…')]} at={reading ? 1 : 0} /></summary>
          <div className="md-b-menu-list" onClick={event => event.currentTarget.parentElement.removeAttribute('open')}>
            <button type="button" disabled={reading} onClick={autoRead}><Icon name="refresh" size={14} /><span><b>{t('立即读取账号数据')}</b><small>{t('按填好的主页地址读粉丝、获赞、最新一条等公开数据')}</small></span></button>
            <button type="button" onClick={() => logFollowers(board)}><Icon name="plus" size={14} /><span><b>{t('手动记录粉丝')}</b><small>{t('读不到的平台自己填今天的数')}</small></span></button>
            <button type="button" onClick={() => setDesk({ view: 'insights' })}><Icon name="upload" size={14} /><span><b>{t('手动补数据')}</b><small>{t('后台读不到的平台，到「复盘」录入或粘贴表格')}</small></span></button>
            <button type="button" onClick={() => editAccountLinks(accounts, board.autoRead?.support)}><Icon name="link" size={14} /><span><b>{t('各平台主页地址')}</b><small>{t('每天自动读取要用')}</small></span></button>
            <button type="button" onClick={() => setPicking(true)}><Icon name="gear" size={14} /><span><b>{t('显示哪些平台')}</b><small>{t('选大屏下面放哪几张平台卡片')}</small></span></button>
          </div>
        </details>
        <button type="button" className="md-icon-btn" aria-label={t('全屏')} title={t('全屏')} onClick={() => toggleFullscreen(root.current?.closest('.md-root'))}><Icon name="expand" size={15} /></button>
        <Clock />
      </div>
      {fresh ? <StartCard /> : null}
      {/* 有示例数据时格子不空，照常显示在三步下面 */}
      {fresh && !board.hasSample ? null : (
        <div className="md-b-grid">
          <LatestTile board={board} />
          <FansTile board={board} onAutoRead={autoRead} marks={shownRows(chosen, board.platforms).map(row => row.platform).slice(0, 5)} />
          <div className="md-b-side"><AnalysisTile analysis={board.analysis} info={board.autoRead} reading={reading} onRead={autoRead} /><IncomeTile income={board.income ?? null} /></div>
          <PlatformRow board={board} chosen={chosen} accounts={accounts} onPick={() => setPicking(true)} />
        </div>
      )}
      {picking ? <PlatformPicker chosen={chosen} withData={board.platforms.map(row => row.platform)} onClose={() => setPicking(false)} /> : null}
    </div>
  )
}
