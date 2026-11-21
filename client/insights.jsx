// 数据复盘。
import React from 'react'
import { dispatchOps, fetchBoard, fetchInsights, learnSkills, openItem, setDesk, toast, useDesk } from './desk.js'
import { ImportDialog } from './import-dialog.jsx'
import { DiagnosisTile, linkPiece } from './diagnosis.jsx'
import { CollectEntry } from './collect-entry.jsx'
import { lang, lookupEn, plural, t, useLang } from './i18n.js'
import { Icon, Segmented } from './ui.jsx'
const clip = (text, n) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text)
import { PLATFORMS, PLATFORM_EN_NAMES, compact, platformChoices, displayItem, fmtDate, isDense, posterOf, dayKey } from './util.js'
import { Poster, initialOf } from './lazy.jsx'

/** 带数量的文字：英文在 1 时用单数那条 key；{s} 给共用词典里写成 piece{s} 的那种。 */
function count(n, one, other, vars = {}) {
  return t(plural(n, one, other), { n: Number(n).toLocaleString(), s: n === 1 ? '' : 's', ...vars })
}

function niceMax(value) {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find(n => n * pow >= value) ?? 10
  return step * pow
}

/** 单序列趋势：每天都有数时画折线，数据稀疏时按真实日期画成一根根柱子，不连线。十字准线 + 提示框，配一份可切换的表格。 */
function TrendChart({ daily: rows, field, word }) {
  // 那天这一项一条都没记：不画这个点，不当 0
  const daily = rows.filter(row => row[field] !== null && row[field] !== undefined).map(row => ({ ...row, value: row[field] }))
  const [hover, setHover] = React.useState(null)
  const box = React.useRef(null)
  const [size, setSize] = React.useState({ width: 640, height: 220 })
  React.useLayoutEffect(() => {
    const el = box.current
    if (!el) return undefined
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: Math.max(entry.contentRect.height, 140) }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const { width, height } = size
  if (!daily.length) return <div className="md-chart" ref={box}><p className="md-muted">{field === 'views' ? t('记了数据，但还没有哪天记了播放') : t('记了数据，但还没有哪天记了互动')}</p></div>
  const pad = { l: 44, r: 12, t: 12, b: 26 }
  const max = niceMax(Math.max(...daily.map(d => d.value)))
  const dense = isDense(daily.map(d => d.date))
  // 稀疏时横轴按真实日期排：差一个月的两点就隔得远，一眼看得出中间没数据
  const first = Date.parse(`${daily[0].date}T12:00:00Z`)
  const span = Date.parse(`${daily[daily.length - 1].date}T12:00:00Z`) - first
  const share = i => (dense ? i / Math.max(daily.length - 1, 1) : span ? (Date.parse(`${daily[i].date}T12:00:00Z`) - first) / span : 0.5)
  const x = i => pad.l + share(i) * (width - pad.l - pad.r)
  const y = v => pad.t + (1 - v / max) * (height - pad.t - pad.b)
  const line = daily.map((d, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(daily.length - 1).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z`
  const ticks = [0, 0.5, 1].map(t => t * max)
  const crossYear = daily[0].date.slice(0, 4) !== daily.at(-1).date.slice(0, 4)
  const labelEvery = Math.ceil(daily.length / Math.max(Math.floor(width / 72), 2))
  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const at = event.clientX - rect.left
    // 离指针最近的那个点
    let best = 0
    daily.forEach((_, i) => { if (Math.abs(x(i) - at) < Math.abs(x(best) - at)) best = i })
    setHover(best)
  }
  const bar = Math.max(4, Math.min(14, (width - pad.l - pad.r) / Math.max(daily.length * 3, 1)))
  // 日期标签：折线按间隔挑；柱子按真实日期排，离上一个标签太近的不写，免得叠在一起
  const shown = new Set()
  daily.forEach((_, i) => {
    const last = [...shown].pop()
    if (dense ? i % labelEvery === 0 : last === undefined || x(i) - x(last) >= (crossYear ? 90 : 44)) shown.add(i)
  })
  const point = hover === null ? null : daily[hover]
  return (
    <div className="md-chart" ref={box}>
      <svg width={width} height={height} role="img" aria-label={t(field === 'views' ? `每日${word}趋势，共 {n} 天，峰值 {peak}` : '每日互动趋势，共 {n} 天，峰值 {peak}', { n: daily.length, peak: compact(Math.max(...daily.map(d => d.value))) })} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={y(tick)} y2={y(tick)} className="md-chart-grid" />
            <text x={pad.l - 8} y={y(tick) + 4} textAnchor="end" className="md-chart-axis">{compact(tick)}</text>
          </g>
        ))}
        {daily.map((d, i) => (shown.has(i) ? <text key={d.date} x={x(i)} y={height - 6} textAnchor="middle" className="md-chart-axis">{crossYear ? `${d.date.slice(0, 4)}/` : ''}{Number(d.date.slice(5, 7))}/{Number(d.date.slice(8, 10))}</text> : null))}
        {dense ? <path d={area} className="md-chart-area" /> : null}
        {dense ? <path d={line} className="md-chart-line" pathLength="1" /> : daily.map((d, i) => <rect key={d.date} x={x(i) - bar / 2} y={y(d.value)} width={bar} height={Math.max(y(0) - y(d.value), 1)} rx={Math.min(3, bar / 2)} className="md-chart-bar" />)}
        {point ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} className="md-chart-cross" />
            <circle cx={x(hover)} cy={y(point.value)} r="4.5" className="md-chart-dot" />
          </g>
        ) : null}
      </svg>
      {point ? (
        <div className="md-chart-tip" style={{ left: Math.min(x(hover) + 12, width - 150), top: Math.max(y(point.value) - 56, 0) }}>
          <small>{fmtDate(`${point.date}T12:00:00`)}</small>
          <b>{field === 'views' ? count(point.value, `1 ${word}`, `{n} ${word}`) : count(point.value, '1 互动', '{n} 互动')}</b>
          {field === 'views' && point.engaged !== null ? <small>{count(point.engaged, '1 互动', '{n} 互动')}</small> : null}
        </div>
      ) : null}
      {dense ? null : <p className="md-chart-note">{t('只有 {n} 天记了数，按日期画成柱子，中间没记的日子不连线', { n: daily.length })}</p>}
    </div>
  )
}

// 手动录入的项：留空就是没记
const MANUAL_FIELDS = [['views', '播放 / 阅读'], ['impressions', '曝光'], ['likes', '点赞'], ['comments', '评论'], ['saves', '收藏'], ['shares', '转发'], ['recommends', '在看（公众号）'], ['completion', '完播率（%）'], ['newFollowers', '涨粉'], ['minutes', '制作分钟']]

function addMetric(items) {
  setDesk({
    dialog: {
      title: t('录入一条数据'),
      initial: { platform: '公众号', date: dayKey(new Date()) },
      fields: [
        { name: 'itemId', label: t('对应内容'), type: 'select', options: [{ value: '', label: t('不关联内容') }, ...items.filter(i => !i.parentId).map(i => ({ value: i.id, label: displayItem(i).title.slice(0, 26) }))] },
        { name: 'platform', label: t('平台'), type: 'select', options: platformChoices().map(v => ({ value: v, label: t(v) })) },
        { name: 'date', label: t('日期'), type: 'date', required: true },
        ...MANUAL_FIELDS.map(([name, label]) => ({ name, label: t(label), type: 'number', placeholder: t('没有就留空'), ...(name === 'completion' ? { hint: t('填百分数，35 就是 35%') } : {}) })),
      ],
      onSubmit: (v) => {
        // 留空就是没记，不当 0；填了 0 才是 0
        const numbers = {}
        for (const [name, label] of MANUAL_FIELDS) {
          const raw = String(v[name] ?? '').trim()
          if (!raw) continue
          const value = Number(raw)
          if (!Number.isFinite(value) || value < 0 || (name === 'completion' && value > 100)) { toast(t('「{field}」要填 0 或更大的数字', { field: t(label) }), { error: true }); return }
          numbers[name] = name === 'completion' ? value / 100 : value
        }
        if (!Object.keys(numbers).length) { toast(t('一个数都没填'), { error: true }); return }
        dispatchOps([{ op: 'add_metric', itemId: v.itemId || null, platform: v.platform, date: new Date(`${v.date}T12:00:00`).toISOString(), ...numbers }], { label: t('录入数据') })
      },
    },
  })
}

/** 平台名：中文原文，或者它的英文名（不分大小写）。 */
function platformOf(name) {
  const value = String(name ?? '').toLowerCase()
  return PLATFORMS.find(p => p.toLowerCase() === value || String(lookupEn(p) ?? PLATFORM_EN_NAMES[p] ?? '').toLowerCase() === value)
}

/** CSV：日期,平台,阅读,点赞,评论,转发,收藏 */
export function parseCsv(text) {
  const ops = []
  const errors = []
  text.trim().split(/\r?\n/).forEach((line, index) => {
    const cols = line.split(/[,，\t]/).map(c => c.trim())
    if (index === 0 && !/\d/.test(cols[0])) return
    const date = new Date(cols[0])
    const platform = platformOf(cols[1])
    if (Number.isNaN(date.getTime()) || !platform) {
      errors.push(index + 1)
      return
    }
    // 空格是没记，不当 0
    const values = cols.slice(2, 7).map(v => (v === '' ? undefined : Number(v)))
    const numbers = Object.fromEntries(['views', 'likes', 'comments', 'shares', 'saves'].map((key, i) => [key, values[i]]).filter(([, value]) => Number.isFinite(value)))
    ops.push({ op: 'add_metric', platform, date: date.toISOString(), ...numbers })
  })
  return { ops, errors }
}

function Metric({ label, value, unit, wide, why }) {
  return <div className={`md-metric ${wide ? 'is-wide' : ''}`} title={why}><dt>{label}</dt><dd>{value}{unit ? <small>{unit}</small> : null}</dd></div>
}

/** 没记的数显示「—」，不显示 0。 */
const num = value => (value === null || value === undefined ? '—' : compact(value))

/** 头部句子里的小圆图：读不到就不放。 */
function HeroPic({ src }) {
  const [failed, setFailed] = React.useState(false)
  if (!src || failed) return null
  return <img className="md-inline-pic" src={src} alt="" draggable={false} onError={() => setFailed(true)} />
}

export function InsightsView() {
  useLang()
  const items = useDesk(s => s.state.items)
  const metrics = useDesk(s => s.state.metrics)
  const skills = useDesk(s => s.state.skills)
  const [data, setData] = React.useState(null)
  const [show, setShow] = React.useState('chart')
  const [topLimit, setTopLimit] = React.useState(5)
  const [importing, setImporting] = React.useState(false)
  // 自动采集的状态（哪些平台登录了、上次什么时候更新）和大屏用同一份
  const [collect, setCollect] = React.useState(null)
  const accounts = useDesk(s => s.state.accounts)
  React.useEffect(() => {
    let alive = true
    fetchInsights().then((next) => { if (alive) setData(next) }).catch(err => toast(err.message, { error: true }))
    fetchBoard().then((board) => { if (alive) setCollect(board.autoRead ?? null) }).catch(() => {})
    return () => { alive = false }
  }, [metrics, items])
  if (!data) return <div className="md-board-page md-insights-page"><div className="md-tile md-i-hero" /></div>
  // 有真实数据后，不再把示例规则当建议
  const proposed = skills.filter(s => s.status === 'proposed' && (data.hasSample || !s.sample))
  // 有的平台公开接口读不到播放量，这时统一按互动来比
  const hasViews = data.views > 0
  // 图文平台叫阅读，视频平台叫播放，混着就是「阅读/播放」
  const word = data.viewWord ?? '播放'
  const loose = data.unlinked ?? { count: 0, views: null, engaged: null }
  // 头句只说下面列出来的那几条带来了多少
  const reach = (views, engaged) => (views > 0 ? t(plural(views, `1 次${word}`, `{n} 次${word}`), { n: compact(views) }) : engaged !== null && engaged !== undefined ? t(plural(engaged, '1 次互动', '{n} 次互动'), { n: compact(engaged) }) : t('还没记播放和互动'))
  const barKey = data.platforms.every(p => p.views > 0) ? 'views' : 'engaged'
  const maxBar = Math.max(1, ...data.platforms.map(p => p[barKey] ?? 0))
  const realAccounts = accounts.some(row => row.externalId)
  const dialog = importing ? <ImportDialog items={items} onClose={() => setImporting(false)} /> : null
  const best = data.top[0]
  const bestItem = best && items.find(i => i.id === best.id)
  const heroPic = bestItem && posterOf(displayItem(bestItem))
  const actions = (
    <div className="md-hero-actions">
      <CollectEntry info={collect} className="is-hero" />
      {/* 后台读不到的平台（X、YouTube、知乎等）的兜底 */}
      <details className="md-b-menu md-manual-menu">
        <summary className="md-pill"><Icon name="plus" size={14} />{t('手动补数据')}<Icon name="chevD" size={12} /></summary>
        <div className="md-b-menu-list" onClick={event => event.currentTarget.parentElement.removeAttribute('open')}>
          <button type="button" onClick={() => addMetric(items)}><Icon name="plus" size={14} /><span><b>{t('录入数据')}</b><small>{t('一条一条填')}</small></span></button>
          <button type="button" onClick={() => setImporting(true)}><Icon name="upload" size={14} /><span><b>{t('粘贴数据表')}</b><small>{t('从平台后台复制或导出的表格')}</small></span></button>
        </div>
      </details>
    </div>
  )
  if (!metrics.length) {
    return (
      <div className="md-board-page md-insights-page">
        <section className="md-tile md-i-hero is-empty">
          <div className="md-hero-copy">
            <h1 className="md-i-line">{t('登录创作后台，数据每天自动进来，')}<br />{t('这里就开始替你复盘。')}</h1>
            {actions}
          </div>
        </section>
        {dialog}
      </div>
    )
  }
  return (
    <div className="md-board-page md-insights-page">
      <div className={`md-insights ${data.pieces?.length ? 'has-diag' : ''}`}>
        <section className="md-tile md-i-hero">
          <div className="md-hero-copy">
            <h1 className="md-i-line">
              {data.published ? <><b>{count(data.published, '1 条内容', '{n} 条内容')}</b> {t('带来了')} <b>{reach(data.pieceViews, data.pieceEngaged)}</b></> : <><b>{count(loose.count, '1 条记录', '{n} 条记录')}</b> {t('合计')} <b>{reach(loose.views, loose.engaged)}</b>{t('，还没对应到具体内容')}</>}{best ? t('，') : t('。')}

            </h1>
            {data.published && loose.count ? <p className="md-i-note">{t('另有 {n} 条记录没对应到内容（{reach}），不算在上面这句里。', { n: loose.count, reach: reach(loose.views, loose.engaged) })}</p> : null}
            <p className="md-i-note">{t('按作品和平台统计；导入记录也参与排行，可关联到工作台稿件。')}</p>
            {actions}
          </div>
          <dl className="md-metrics">
            {hasViews ? (data.engagementRate === null
              ? <Metric label={t('互动率')} value="—" why={t('没有同时记了播放和互动的数据，算不出互动率')} />
              : <Metric label={t('互动率')} value={(data.engagementRate * 100).toFixed(1)} unit="%" why={t('只用同时记了播放和互动的记录算')} />) : null}
            <Metric label={t('总互动')} value={num(data.engaged)} why={data.engaged === null ? t('还没有记过赞、评、藏、转') : undefined} />
            {realAccounts && data.followers ? <Metric label={t('粉丝')} value={compact(data.followers)} /> : <Metric label={lang() === 'en' ? t('平台（数量）') : '平台'} value={data.platforms.length} unit={t('个')} />}
          </dl>
          {data.hasSample ? <span className="md-i-sample">{t('示例数据')}</span> : null}
        </section>

        <section className="md-tile md-i-trend">
          <header className="md-tile-head">
            <h2>{hasViews ? t(`每日${word}`) : t('每日互动')}</h2>
            <span className="md-grow" />
            <Segmented label={t('显示方式')} value={show} onChange={setShow} options={[{ value: 'chart', label: t('图') }, { value: 'table', label: t('表') }]} />
          </header>
          {show === 'chart' ? <div className="md-i-chart"><TrendChart daily={data.daily} field={hasViews ? 'views' : 'engaged'} word={word} /></div> : (
            <div className="md-i-table">
              <table className="md-table is-plain">
                <thead><tr><th>{t('日期')}</th>{hasViews ? <th className="is-num">{t(word)}</th> : null}<th className="is-num">{t('互动')}</th></tr></thead>
                <tbody>{[...data.daily].reverse().map(d => <tr key={d.date}><td>{lang() === 'en' ? fmtDate(`${d.date}T12:00:00`) : d.date}</td>{hasViews ? <td className="is-num" title={d.views === null ? t('这天没记播放') : undefined}>{d.views === null ? '—' : d.views.toLocaleString()}</td> : null}<td className="is-num" title={d.engaged === null ? t('这天没记互动') : undefined}>{d.engaged === null ? '—' : d.engaged.toLocaleString()}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="md-tile md-i-platforms">
          <header className="md-tile-head"><h2>{t('平台分布')}</h2><span className="md-tile-meta">{barKey === 'views' ? t(word) : t('互动')}</span></header>
          <ul className="md-bars" aria-label={barKey === 'views' ? t('各平台播放') : t('各平台互动')}>
            {data.platforms.map(platform => (
              <li key={platform.platform} title={t('{platform}：{views} 播放，{likes} 赞，{saves} 收藏，互动率 {rate}（「—」是没记）', { platform: t(platform.platform), views: num(platform.views), likes: num(platform.likes), saves: num(platform.saves), rate: platform.engagementRate === null ? '—' : `${(platform.engagementRate * 100).toFixed(1)}%` })}>
                <span>{t(platform.platform)}</span>
                <b>{num(platform[barKey])}</b>
                <span className="md-bar-track"><i style={{ width: `${((platform[barKey] ?? 0) / maxBar) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
        </section>

        <section className="md-tile md-i-top">
          <header className="md-tile-head"><h2>{t('表现最好的内容')}</h2><span className="md-grow" /><span className="md-tile-meta">{count(data.top.length, '共 1 条', '共 {n} 条')}</span></header>
          {/* 全部列出（可以往下滚），条数和头句里的一样 */}
          <ol className="md-top">
            {data.top.slice(0, topLimit).map((row, index) => {
              const item = items.find(i => i.id === row.id)
              const poster = item && posterOf(displayItem(item))
              return (
                <li key={row.key}>
                  <button type="button" onClick={() => row.id ? openItem(row.id) : linkPiece(row, items)}>
                    <span className="md-top-rank">{index + 1}</span>
                    <span className="md-thumb"><Poster src={poster} fallback={<span>{initialOf(row.title)}</span>} /></span>
                    <span className="md-top-title"><strong title={row.title}>{row.title}</strong><small>{[row.platform ? t(row.platform) : null, !row.id ? t('关联稿件') : null, t('{likes} 赞 · {saves} 收藏', { likes: num(row.likes), saves: num(row.saves) })].filter(Boolean).join(' · ')}</small></span>
                    <b>{row.views ? compact(row.views) : row.engaged !== null ? t(plural(row.engaged, '1 互动', '{n} 互动'), { n: compact(row.engaged) }) : '—'}</b>
                  </button>
                </li>
              )
            })}
          </ol>
          {data.top.length > 5 ? <button type="button" className="md-pill is-small md-dg-more" onClick={() => setTopLimit(topLimit === 5 ? data.top.length : 5)}>{topLimit === 5 ? `查看全部 ${data.top.length} 条` : t("收起")}</button> : null}
        </section>

        <section className="md-tile md-i-advice">
          <header className="md-tile-head">
            <h2>{t('给你的建议')}</h2>
            <span className="md-grow" />
            <button type="button" className="md-pill is-small" onClick={learnSkills}><Icon name="spark" size={13} />{t('重新分析')}</button>
          </header>
          <div className="md-i-advice-list">
            {proposed.length ? proposed.slice(0, 4).map(skill => (
              <div key={skill.id} className="md-i-tip">
                <strong>{skill.name}</strong>
                <p>{skill.evidence ?? skill.rule}</p>
                <button type="button" className="md-pill is-small" onClick={() => dispatchOps([{ op: 'update_skill', id: skill.id, status: 'active' }], { label: t('启用规则「{name}」', { name: skill.name }) })}>{t('写进规则')}</button>
              </div>
            )) : data.pieces?.some(piece => ['low', 'strong'].includes(piece.verdict)) ? data.pieces.filter(piece => ['low', 'strong'].includes(piece.verdict)).slice(0, 4).map(piece => (
              <div key={piece.key} className="md-i-tip"><strong>{piece.title}</strong><p>{piece.line}</p><p>{t('建议：{action}', { action: piece.action })}</p></div>
            )) : <p className="md-muted">{t('点「重新分析」，从现有数据里找出值得坚持的做法。')}</p>}
          </div>
        </section>
        {data.pieces?.length ? <DiagnosisTile pieces={data.pieces} /> : null}
      </div>
      {dialog}
    </div>
  )
}
