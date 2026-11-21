// 对标：贴别人的主页地址，读他们公开显示的粉丝数，每天记一笔，和自己的放在一起看。
// 数字只来自公开接口或公开页面；读不到就写读不到，没记过的日子不补。
import React from 'react'
import { Spark, colorOf } from './board-charts.jsx'
import { PlatformMark } from './board.jsx'
import { openInBrowser } from './browser.js'
import { dispatchOps, refreshRivals, report, setDesk, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { myFollowers, rivalTrend } from './rival-stats.js'
import { launchCounterTopic, RivalWorks } from './rival-works.jsx'
import { scoreWorks } from '../src/rival-score.js'
import { Icon, IconButton, Swap } from './ui.jsx'
import { ACCOUNT_PLATFORMS, compact, fmtWhen } from './util.js'

const signed = n => `${n > 0 ? '+' : ''}${n.toLocaleString()}`
const short = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function Delta({ label, value }) {
  if (value === null) return null
  return <span className={`md-b-delta ${value > 0 ? 'is-up' : value < 0 ? 'is-down' : ''}`}>{label} <b>{signed(value)}</b></span>
}

function editRival(rival) {
  setDesk({
    dialog: {
      title: t('编辑对标账号'),
      initial: { name: rival.name ?? '', note: rival.note ?? '' },
      fields: [
        { name: 'name', label: t('名字'), placeholder: t('留空就用读到的名字') },
        { name: 'note', label: t('备注'), type: 'textarea', rows: 3, placeholder: t('为什么对标他、想学他什么') },
      ],
      onSubmit: values => dispatchOps([{ op: 'update_rival', id: rival.id, name: values.name ?? '', note: values.note ?? '' }], { label: t('编辑对标账号') }),
    },
  })
}

function RivalCard({ rival, trend, works, reading }) {
  const name = rival.name || hostOf(rival.url)
  // 展开作品表时这张卡占满一整行
  const [open, setOpen] = React.useState(false)
  return (
    <article className={`md-tile md-r-card ${open ? 'is-open' : ''}`} aria-busy={reading || undefined}>
      <header className="md-r-head">
        <PlatformMark platform={rival.platform} size={26} />
        <div className="md-r-name"><strong title={name}>{name}</strong><small>{t(rival.platform)}</small></div>
        <IconButton icon="edit" size={14} label={t('编辑名字和备注')} onClick={() => editRival(rival)} />
      </header>
      <div className="md-r-figure">
        {reading && trend.followers === null ? <span className="md-r-reading"><Icon name="refresh" size={13} />{t('正在读取公开主页…')}</span> : trend.followers === null ? <span className="md-muted">{rival.fetchedAt ? t('还没读到粉丝数') : t('还没读取过')}</span> : (
          <>
            <b>{trend.followers.toLocaleString()}</b>
            <small>{t('粉丝 · 记于 {date}', { date: short(trend.loggedAt) })}</small>
          </>
        )}
      </div>
      <div className="md-r-deltas">
        <Delta label={t('较前一天')} value={trend.d1} />
        <Delta label={t('近 7 天')} value={trend.d7} />
        {trend.works === null ? null : <span className="md-b-delta">{t('投稿')} <b>{trend.works.toLocaleString()}</b></span>}
      </div>
      <div className="md-r-spark">
        {trend.spark.length >= 2 ? <Spark points={trend.spark} color={colorOf(rival.platform)} label={t('{name}的粉丝走势', { name })} /> : <span className="md-muted">{t('记满两天才有走势')}</span>}
      </div>
      {reading && trend.followers !== null ? <p className="md-r-reading"><Icon name="refresh" size={13} />{t('正在读取…')}</p> : null}
      {!reading && rival.fetchError ? <p className="md-s-errors md-r-error">{t('{when} 没读到：{error}', { when: fmtWhen(rival.fetchedAt), error: rival.fetchError })}</p> : null}
      {rival.note ? <p className="md-r-note">{rival.note}</p> : null}
      <RivalWorks rival={rival} name={name} works={works} open={open} onToggle={() => setOpen(v => !v)} />
      <footer className="md-r-foot">
        <button type="button" className="md-pill is-small" onClick={() => openInBrowser(rival.url)}><Icon name="upRight" size={13} />{t('打开主页')}</button>
        <span className="md-grow" />
        <IconButton icon="trash" size={14} label={t('删除这个对标账号')} onClick={() => dispatchOps([{ op: 'delete_rival', id: rival.id }], { label: t('删除对标账号') })} />
      </footer>
    </article>
  )
}

/** 自己和对标账号放在一起：只在两边都真的记过数字时出现。 */
function Compare({ rows }) {
  if (!rows.length) return null
  return (
    <section className="md-r-compare" aria-label={t('和自己比')}>
      {rows.map(({ rival, trend, mine }) => (
        <div key={rival.id} className="md-r-pair">
          <PlatformMark platform={rival.platform} size={20} />
          <span><small>{t('我')}</small><b title={mine.followers.toLocaleString()}>{compact(mine.followers)}</b><em>{short(mine.date)}</em></span>
          <span className="md-r-vs">vs</span>
          <span><small>{rival.name || hostOf(rival.url)}</small><b title={trend.followers.toLocaleString()}>{compact(trend.followers)}</b><em>{short(trend.loggedAt)}</em></span>
        </div>
      ))}
    </section>
  )
}

/** 跨账号汇总的异动爆款雷达 + 单条爆款快拆反切入台。 */
function OutlierRadar({ rivals, allWorks }) {
  const [quickInput, setQuickInput] = React.useState('')
  const [launching, setLaunching] = React.useState(false)
  const outliers = React.useMemo(() => {
    const out = []
    for (const rival of rivals) {
      const works = (allWorks ?? []).filter(w => w.rivalId === rival.id)
      if (!works.length) continue
      const name = rival.name || hostOf(rival.url)
      for (const row of scoreWorks(works, rival.platform)) {
        if (['现象级', '爆款', '潜力'].includes(row.grade)) {
          out.push({ ...row, rivalName: name, platform: rival.platform })
        }
      }
    }
    return out.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, 8)
  }, [rivals, allWorks])

  const submitQuick = async (event) => {
    event.preventDefault()
    const raw = quickInput.trim()
    if (!raw || launching) return
    setLaunching(true)
    const isUrl = /^https?:\/\/\S+$/i.test(raw)
    try {
      await launchCounterTopic({
        title: isUrl ? `对标拆解：${hostOf(raw)}` : raw.slice(0, 80),
        url: isUrl ? raw : '',
        source: '单条爆款快拆',
      })
      setQuickInput('')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <section className="md-tile md-r-radar" aria-label={t('爆款异动与反切入拆题')}>
      <div className="md-r-radar-head">
        <div>
          <h2><Icon name="bolt" size={15} />{t('爆款异动与反角度拆题')}</h2>
          <p className="md-muted">{t('抓对标不是抄选题，是看哪条突然跑赢他自己的中位数，再从一线工程与 OPC 代价视角切出「同意一半」的新判断。')}</p>
        </div>
      </div>
      <form className="md-r-quick" onSubmit={submitQuick}>
        <input
          type="text"
          value={quickInput}
          onChange={e => setQuickInput(e.target.value)}
          placeholder={t('刷到同行爆款？直接粘贴链接或标题，一键拆钩子并按「同意一半/工程代价」反切入开写…')}
          aria-label={t('粘贴同行爆款链接或标题')}
        />
        <button type="submit" className="md-btn is-primary" disabled={!quickInput.trim() || launching}>
          <Icon name="spark" size={14} />{launching ? t('正在进入工作区…') : t('拆钩子反切入开写')}
        </button>
      </form>
      {outliers.length ? (
        <ul className="md-r-outliers" aria-label={t('异动爆款榜')}>
          {outliers.map(item => (
            <li key={item.id} className="md-r-outlier-row">
              <span className={`md-rw-grade ${item.grade === '现象级' ? 'is-top' : item.grade === '爆款' ? 'is-hit' : 'is-up'}`}>{t(item.grade)}</span>
              <span className="md-r-outlier-mult">{Number.isFinite(item.ratio) ? `${item.ratio.toFixed(1)}×` : '∞'}</span>
              <PlatformMark platform={item.platform} size={16} />
              <span className="md-r-outlier-author">{item.rivalName}</span>
              <strong className="md-r-outlier-title" title={item.title}>{item.title}</strong>
              <span className="md-grow" />
              <button
                type="button"
                className="md-pill is-small is-primary"
                onClick={() => launchCounterTopic({ title: item.title, url: item.url, source: item.rivalName, ratio: item.ratio })}
              >
                <Icon name="bolt" size={12} />{t('反切入开写')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export function RivalsView() {
  useLang()
  const rivals = useDesk(s => s.state.rivals ?? [])
  const log = useDesk(s => s.state.rivalLog ?? [])
  const allWorks = useDesk(s => s.state.rivalWorks)
  const followerLog = useDesk(s => s.state.followerLog)
  const [platform, setPlatform] = React.useState('B站')
  const [url, setUrl] = React.useState('')
  const urlInput = React.useRef(null)
  const [busy, setBusy] = React.useState(false)
  // 正在读的账号：卡片上显示进度。all 是点了「读取」全读
  const [reading, setReading] = React.useState(() => new Set())
  const read = async (ids) => {
    setBusy(true)
    setReading(new Set(ids ?? rivals.map(rival => rival.id)))
    try {
      await refreshRivals(ids)
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
      setReading(new Set())
    }
  }
  const add = async (event) => {
    event.preventDefault()
    const value = url.trim()
    if (!value) return
    const result = await dispatchOps([{ op: 'add_rival', platform, url: value }], { label: t('添加对标账号') })
    if (!result || result.errors?.length) return
    setUrl('')
    // 加完就读一次，不用再去点「读取」
    const id = result.receipts?.find(row => row.kind === 'rival')?.target
    if (id) read([id])
  }
  const refresh = () => read()
  const now = new Date()
  const cards = rivals.map(rival => ({ rival, trend: rivalTrend(log, rival.id, now), mine: myFollowers(followerLog, rival.platform) }))
  const pairs = cards.filter(row => row.mine && row.trend.followers !== null)
  const lastRead = rivals.reduce((latest, rival) => (rival.fetchedAt && (!latest || rival.fetchedAt > latest) ? rival.fetchedAt : latest), null)
  return (
    <div className="md-page">
      <div className="md-page-head">
        <div>
          <h1>{t('对标')}</h1>
          <p className="md-page-sub">{t('贴上想对标的账号主页，加完会自动读一次他们公开显示的粉丝数；之后点「读取」每天记一笔。不登录，读不到的会写明原因。')}</p>
        </div>
        <span className="md-grow" />
        {rivals.length ? (
          <div className="md-head-tools">
            {lastRead ? <span className="md-tile-meta">{t('上次读取 {time}', { time: fmtWhen(lastRead) })}</span> : null}
            <button type="button" className="md-btn is-primary" disabled={busy} onClick={refresh}><Icon name="refresh" size={14} /><Swap labels={[t('读取'), t('正在读取…')]} at={busy ? 1 : 0} /></button>
          </div>
        ) : null}
      </div>
      <OutlierRadar rivals={rivals} allWorks={allWorks} />
      <form className="md-s-add" onSubmit={add}>
        <select className="md-r-platform" value={platform} onChange={e => setPlatform(e.target.value)} aria-label={t('平台')}>
          {ACCOUNT_PLATFORMS.map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select>
        <input ref={urlInput} type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder={platform === 'B站' ? 'https://space.bilibili.com/…' : t('粘贴主页地址，以 https:// 开头')} aria-label={t('主页地址')} />
        <button type="submit" className="md-btn"><Icon name="plus" size={14} />{t('添加')}</button>
      </form>
      {rivals.length ? (
        <>
          <Compare rows={pairs} />
          <div className="md-r-grid">
            {cards.map(({ rival, trend }) => <RivalCard key={rival.id} rival={rival} trend={trend} reading={reading.has(rival.id)} works={(allWorks ?? []).filter(work => work.rivalId === rival.id)} />)}
          </div>
        </>
      ) : (
        <div className="md-r-empty">
          <p className="md-empty-title">{t('还没有对标账号')}</p>
          <p className="md-muted">{t('B 站能读到昵称、粉丝数和投稿数；其他平台只读公开页面上写着的数字，多数要登录才看得到，读不到会直接告诉你。')}</p>
          <div className="md-empty-actions" style={{ marginTop: 12 }}><button type="button" className="md-btn is-primary" onClick={() => urlInput.current?.focus()}><Icon name="plus" size={14} />{t('贴第一个对标账号')}</button></div>
        </div>
      )}
    </div>
  )
}
