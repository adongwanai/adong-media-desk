// 大屏上和「自动读取账号数据」有关的部分：平台卡片、顶栏的自动读取状态、填主页链接和手动记录。
// 卡片上看得出哪项是自动读的、读于何时；读不到的平台写明原因，保留手动记录。
import React from 'react'
import { PlatformMark, Spark, colorOf } from './board-charts.jsx'
import { dispatchOps, getDesk, openBackstageLogin, refreshFollowers, setDesk, toast } from './desk.js'
import { lang, t } from './i18n.js'
import { Icon } from './ui.jsx'
import { openInBrowser } from './browser.js'
import { ACCOUNT_PLATFORMS, PLATFORM_HOME, compact, countName, dayKey, fmtTime } from './util.js'

const signed = n => `${n > 0 ? '+' : ''}${n.toLocaleString()}`
const rate = value => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`)
const short = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
// 上亿的数（B 站获赞）用「亿」，不然会写成一长串「万」
const big = n => (n < 100_000 ? n.toLocaleString() : n >= 1e8 && lang() !== 'en' ? `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}亿` : compact(n))

// 同一个键在不同平台意思不一样：B 站的作品叫投稿，GitHub 的叫仓库
const STAT_LABEL = {
  likes: '获赞', works: '作品', fans: '关注者', hIndex: 'h 指数', i10Index: 'i10 指数',
  // 创作后台里一段时间的数
  impressions: '曝光', views: '播放', ctr: '点击率', completion: '完播率', periodLikes: '点赞', comments: '评论', saves: '收藏', shares: '分享', netFollowers: '净涨粉', newFollowers: '新增关注', unfollows: '取消关注', visitors: '主页访客',
}
// 卡片上最多放几项、先放哪几项；其余的在悬停提示里
const FACT_ORDER = ['likes', 'works', 'views', 'netFollowers', 'impressions', 'visitors', 'ctr', 'periodLikes', 'saves', 'comments', 'shares', 'newFollowers', 'unfollows', 'completion', 'fans', 'hIndex', 'i10Index']
const PERIOD_KEYS = new Set(['impressions', 'views', 'ctr', 'completion', 'periodLikes', 'comments', 'saves', 'shares', 'netFollowers', 'newFollowers', 'unfollows', 'visitors'])
const MAX_FACTS = 4
const VIA_TEXT = { backstage: '后台读于 {when}' }
const viaText = (via, iso) => t(VIA_TEXT[via] ?? '自动读于 {when}', { when: whenText(iso) })
/** 约数（后台只给了「1.13万」）写成「约 1.13 万」，英文写「~11.3K」。 */
const approxText = n => (lang() === 'en' ? `~${compact(n)}` : n >= 1e8 ? `约 ${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')} 亿` : n >= 1e4 ? `约 ${(n / 1e4).toFixed(2).replace(/\.?0+$/, '')} 万` : `约 ${n.toLocaleString()}`)
const STAT_LABEL_BY = { B站: { works: '投稿' }, GitHub: { works: '仓库' }, X: { works: '帖子' } }
const statLabel = (platform, key) => t(STAT_LABEL_BY[platform]?.[key] ?? STAT_LABEL[key] ?? key)
const POST_LABEL = { GitHub: '最新仓库', 谷歌学术: '最新论文', YouTube: '最新视频', X: '最新帖子', B站: '最新视频', 小红书: '最新笔记' }
const PLACEHOLDER = { B站: 'https://space.bilibili.com/…', GitHub: 'https://github.com/…', 谷歌学术: 'https://scholar.google.com/citations?user=…', X: 'https://x.com/…', YouTube: 'https://www.youtube.com/@…' }

/** 今天 6:31 / 昨天 6:31 / 11/12 6:31。 */
export function whenText(iso) {
  const day = dayKey(iso)
  const today = dayKey(new Date())
  const yesterday = dayKey(new Date(Date.now() - 86_400_000))
  const time = fmtTime(iso)
  if (day === today) return t('今天 {time}', { time })
  if (day === yesterday) return t('昨天 {time}', { time })
  return `${short(day)} ${time}`
}

/* ───────────── 手动记录、填主页链接、立即读取 ───────────── */

export function logFollowers(board) {
  const current = Object.fromEntries(board.platforms.map(row => [row.platform, row.followers]))
  setDesk({
    dialog: {
      title: t('记录今天的粉丝数'),
      submitLabel: t('记录'),
      initial: { date: dayKey(new Date()) },
      fields: [
        { name: 'date', label: t('日期'), type: 'date', required: true },
        ...ACCOUNT_PLATFORMS.map(platform => ({ name: platform, label: countName(platform) === '粉丝' ? t(platform) : `${t(platform)} · ${t(countName(platform))}`, type: 'number', placeholder: current[platform] === null || current[platform] === undefined ? t('没有就留空') : t('上次 {n}', { n: current[platform].toLocaleString() }) })),
      ],
      onSubmit: (values) => {
        const ops = ACCOUNT_PLATFORMS
          .filter(platform => values[platform] !== undefined && values[platform] !== '' && Number(values[platform]) >= 0)
          .map(platform => ({ op: 'log_followers', platform, date: values.date, followers: Number(values[platform]) }))
        if (!ops.length) { toast(t('一个平台都没填'), { error: true }); return }
        dispatchOps(ops, { label: t('记录 {n} 个平台的粉丝数', { n: ops.length }) })
      },
    },
  })
}

/** 读到了但没有主数字时：写读到了几条作品或几项账号数据。 */
const gotText = (row) => {
  if (row.followers !== null && row.followers !== undefined) return row.followersApprox ? approxText(row.followers) : row.followers.toLocaleString()
  const posts = Array.isArray(row.posts) ? row.posts.length : row.posts ?? 0
  return posts ? t('{n} 条作品的数据', { n: posts }) : t('{n} 项账号数据', { n: Array.isArray(row.got) ? row.got.length : Object.keys(row.stats ?? {}).length + (row.latest ? 1 : 0) })
}

/** 打开专用浏览器去登录这些平台的创作后台。 */
export async function loginBackstage(platforms) {
  try {
    await openBackstageLogin(platforms)
    toast(t('已打开专用浏览器，登录好后回来点「立即读取」'))
  } catch (err) {
    toast(err.message || String(err), { error: true })
  }
}

/** 一轮读完后的提示：读到的写数，读不到的写原因；创作后台离上次不到 10 分钟没打开的单独说。 */
function readSummary(results) {
  const succeeded = row => row.ok ?? row.followers !== null
  const ok = results.filter(row => !row.skipped && succeeded(row))
  const failed = results.filter(row => !row.skipped && !succeeded(row))
  const skipped = results.filter(row => row.skipped)
  const parts = [
    ok.length ? ok.map(row => `${t(row.platform)} ${gotText(row)}`).join(t('、')) : '',
    failed.length ? t('读不到：{list}', { list: failed.map(row => `${t(row.platform)}（${row.error}）`).join(t('、')) }) : '',
    skipped.length ? t('没调用：{list}', { list: skipped.map(row => `${t(row.platform)}（${row.error}）`).join(t('、')) }) : '',
  ].filter(Boolean)
  return { text: parts.join(' · ') || t('没有填了主页地址的平台'), error: !ok.length }
}

/** 现在就读一遍；platforms 只读这几个平台。 */
export async function readAccountsNow(platforms) {
  try {
    const { text, error } = readSummary(await refreshFollowers(platforms))
    toast(text, { error })
  } catch (err) {
    toast(err.message || String(err), { error: true })
  }
}

/**
 * 填主页地址：only 给了就只填这一个平台。保存后马上把新填的、能自动读的平台读一次。
 * support 是服务端给的每个平台能不能读、读不到的原因，写在输入框下面。
 */
export function editAccountLinks(accounts, support = {}, only = null) {
  const mine = (accounts ?? []).filter(account => !account.sample)
  const platforms = only ? [only] : ACCOUNT_PLATFORMS
  const byPlatform = Object.fromEntries(platforms.map(platform => [platform, mine.find(account => account.platform === platform)]))
  setDesk({
    dialog: {
      title: only ? t('{platform}主页链接', { platform: t(only) }) : t('各平台的主页地址'),
      submitLabel: t('保存并读取'),
      initial: Object.fromEntries(platforms.map(platform => [platform, byPlatform[platform]?.url ?? ''])),
      fields: platforms.map(platform => ({ name: platform, label: t(platform), type: 'url', placeholder: PLACEHOLDER[platform] ?? 'https://', hint: support[platform]?.reason ?? support[platform]?.partial })),
      onSubmit: async (values) => {
        const changed = []
        const ops = platforms.flatMap((platform) => {
          const url = String(values[platform] ?? '').trim()
          const account = byPlatform[platform]
          if (url === (account?.url ?? '')) return []
          if (url && support[platform]?.readable !== false) changed.push(platform)
          if (account) return [{ op: 'update_account', id: account.id, url: url || null }]
          return url ? [{ op: 'add_account', platform, url }] : []
        })
        if (!ops.length) return
        const done = await dispatchOps(ops, { label: t('更新主页地址'), silent: changed.length > 0 })
        if (done && changed.length) await readAccountsNow(changed)
      },
    },
  })
}

/** 按填好的主页地址读一遍各平台账号数据；还没填地址时先弹出填地址的框。命令面板也用它。 */
export async function autoReadFollowers(support) {
  const accounts = getDesk().state?.accounts ?? []
  // 开了创作后台的平台不用主页地址也能读
  const studio = Object.values(support ?? {}).some(row => row?.backstage)
  if (!studio && !accounts.some(account => !account.sample && account.url)) { editAccountLinks(accounts, support); return }
  await readAccountsNow()
}

/* ───────────── 顶栏：自动读取状态 ───────────── */

const TRIGGER_TEXT = { schedule: '{when} 自动更新过', catchup: '{when} 补读过', manual: '{when} 手动读取过', refresh: '{when} 打开大屏时更新过', retry: '{when} 重读过没读到的平台' }

function statusLabel(info, reading, refreshing) {
  const last = info?.last
  if (refreshing && !reading) return t('正在更新…')
  if (reading || last?.running) return t('正在读取各平台…')
  const results = last?.results ?? []
  if (last?.at) {
    const ok = results.filter(row => row.ok).length
    const counts = [ok ? t('{n} 个成功', { n: ok }) : '', results.length - ok ? t('{n} 个读不到', { n: results.length - ok }) : ''].filter(Boolean).join(' ')
    return [t(TRIGGER_TEXT[last.trigger] ?? TRIGGER_TEXT.manual, { when: whenText(last.at) }), counts].filter(Boolean).join(' · ')
  }
  return info?.schedule?.enabled ? t('每天 {time} 自动读取', { time: info.schedule.time }) : t('自动读取已关闭')
}

/** 自动读取的时间说明：早上整轮，晚上只读登录后的数据，打开大屏时公开数据过了 6 小时会补读。 */
export function scheduleText(schedule) {
  const first = t('DSH 开着时每天 {time} 读一整轮；那时没开，打开后补读。', { time: schedule.time })
  const second = schedule.evening ? t('{time} 再读一次登录后的创作后台。', { time: schedule.evening }) : ''
  return [first, second, t('打开大屏时，公开数据超过 6 小时没更新会在后台补读。')].filter(Boolean).join('')
}

/** 一个平台这一轮的结果：读到的写主数字和另外读到了哪几项，读不到的写原因。 */
function ResultLine({ row }) {
  const extra = (row.got ?? []).map(key => (key === 'latest' ? t(POST_LABEL[row.platform] ?? '最新一条') : statLabel(row.platform, key)))
  return (
    <li className={row.ok ? '' : 'is-fail'}>
      <PlatformMark platform={row.platform} size={20} />
      <span className="md-b-auto-name">{t(row.platform)}</span>
      <span className="md-b-auto-detail">
        {!row.ok ? <em>{row.error || t('读不到')}</em> : row.followers === undefined ? <b>{gotText(row)}</b> : <b>{t(countName(row.platform))} {gotText(row)}</b>}
        {extra.length ? <small>{t('另读到：{list}', { list: extra.join(t('、')) })}</small> : null}
        {row.ok && row.followers !== undefined && row.posts ? <small>{t('另读到 {n} 条作品的数据', { n: row.posts })}</small> : null}
        {row.source === 'backstage' ? <small>{t('来源：登录后的创作后台（只读）')}</small> : null}
        {row.backstageError ? <small>{t('创作后台没读到：{error}', { error: row.backstageError })}</small> : null}
        {row.pending ? <small>{t('粉丝数待确认：{reason}', { reason: row.pending.reason })}</small> : null}
        {row.needLogin ? <button type="button" className="md-b-auto-login" onClick={() => loginBackstage([row.platform])}>{t('去登录')}</button> : null}
      </span>
    </li>
  )
}

/**
 * 要作者处理的一个平台：原因、「去登录」「立即重试」；读不到时留了页面截图的，点「看当时的页面」在下面展开。
 * 原因优先用这一轮结果里的（换了语言服务端会再翻一次），没有再用记下来的。
 */
function AttentionLine({ item, row, studio }) {
  const [shown, setShown] = React.useState(false)
  // 截图文件超过每个平台 3 张后被清掉了：不显示破图
  const [gone, setGone] = React.useState(false)
  const reason = (item.needLogin ? null : row?.error) || item.reason || t('读不到')
  const src = item.shot ? `media-desk/files/${item.shot}` : null
  return (
    <li className="is-fail">
      <PlatformMark platform={item.platform} size={20} />
      <span className="md-b-auto-name">{t(item.platform)}</span>
      <span className="md-b-auto-detail">
        <em>{reason}</em>
        <small>{item.needLogin ? t('登录好后点「立即重试」') : t('连着两次没读到 · {when}', { when: whenText(item.at) })}</small>
        <span className="md-b-attn-actions">
          {item.needLogin || studio ? <button type="button" className="md-b-auto-login" onClick={() => loginBackstage([item.platform])}>{t('去登录')}</button> : null}
          <button type="button" className="md-b-auto-login" onClick={() => readAccountsNow([item.platform])}>{t('立即重试')}</button>
          {src ? <button type="button" className="md-b-auto-login" data-keep="" aria-expanded={shown} onClick={() => setShown(value => !value)}>{shown ? t('收起截图') : t('看当时的页面')}</button> : null}
        </span>
        {src && shown && gone ? <small className="md-b-attn-gone">{t('截图已经清掉了')}</small> : null}
        {src && shown && !gone ? <a className="md-b-attn-shot" href={src} target="_blank" rel="noreferrer" title={t('在新标签页里看大图')}><img src={src} alt={t('{platform}读不到时的页面', { platform: t(item.platform) })} onError={() => setGone(true)} /></a> : null}
      </span>
    </li>
  )
}

export function AutoReadStatus({ info, reading, refreshing = false, onRead, onLinks }) {
  const last = info?.last
  const results = last?.results ?? []
  const fresh = last?.day === dayKey(new Date()) && results.some(row => row.ok)
  const schedule = info?.schedule ?? { enabled: true, time: '06:30' }
  // 要重新登录的、连着两轮没读到的：状态条换成提醒的样子；正在读时先不提
  const attention = reading || last?.running ? [] : last?.attention ?? []
  return (
    <details className="md-b-menu md-b-auto">
      <summary className={`md-b-status is-button${attention.length ? ' is-attention' : ''}`}><i className={attention.length ? 'is-warn' : fresh ? 'is-ok' : ''} />{attention.length ? t('{n} 个平台读不到，去看看', { n: attention.length }) : statusLabel(info, reading, refreshing)}<Icon name="chevD" size={12} /></summary>
      {/* 点了里面的按钮就收起，不和弹出的对话框叠在一起；展开截图的按钮不收 */}
      <div className="md-b-menu-list md-b-auto-list" onClick={(event) => { if (event.target.closest('button:not([data-keep])')) event.currentTarget.parentElement.removeAttribute('open') }}>
        {attention.length ? (
          <section className="md-b-attn">
            <p className="md-b-attn-head">{t('这几个平台要你处理一下')}</p>
            <ul className="md-b-auto-rows">{attention.map(item => <AttentionLine key={item.platform} item={item} row={results.find(row => row.platform === item.platform)} studio={Boolean(info?.support?.[item.platform]?.backstage)} />)}</ul>
          </section>
        ) : null}
        <p className="md-b-auto-head">
          {schedule.enabled ? scheduleText(schedule) : t('每天自动读取已关闭。')}
          <button type="button" onClick={() => setDesk({ settingsOpen: true })}>{t('改时间')}</button>
        </p>
        {results.length
          ? <ul className="md-b-auto-rows">{results.map(row => <ResultLine key={row.platform} row={row} />)}</ul>
          : <p className="md-b-auto-empty">{t('还没读过。填好主页链接，到点就会自动读。')}</p>}
        {info?.error ? <p className="md-b-auto-empty is-error">{t('上次定时读取出错：{error}', { error: info.error })}</p> : null}
        <div className="md-b-auto-foot">
          <button type="button" className="md-btn is-small is-primary" disabled={reading || last?.running} onClick={onRead}><Icon name="refresh" size={13} />{t('立即读取')}</button>
          <button type="button" className="md-btn is-small" onClick={onLinks}><Icon name="link" size={13} />{t('各平台主页地址')}</button>
        </div>
      </div>
    </details>
  )
}

/* ───────────── 平台卡片 ───────────── */

function HomeLink({ platform }) {
  if (!PLATFORM_HOME[platform]) return null
  return <button type="button" className="md-b-open" title={t('在右侧打开{platform}创作后台', { platform: t(platform) })} onClick={() => openInBrowser(PLATFORM_HOME[platform])}>{t('后台')}<Icon name="upRight" size={12} /></button>
}

function Delta({ label, value }) {
  if (value === null || value === undefined) return null
  return <span className={`md-b-delta ${value > 0 ? 'is-up' : value < 0 ? 'is-down' : ''}`}>{label} <b>{signed(value)}</b></span>
}

/** 自动读到的其他账号级数字：获赞、投稿、关注者、h 指数…… */
function Facts({ row }) {
  const stats = row.stats ?? {}
  const keys = [...FACT_ORDER.filter(key => key in stats), ...Object.keys(stats).filter(key => !FACT_ORDER.includes(key))]
  if (!keys.length) return null
  const approx = new Set(row.statsApprox ?? [])
  const value = key => (['ctr', 'completion'].includes(key) ? rate(stats[key]) : approx.has(key) ? approxText(stats[key]) : key === 'netFollowers' ? signed(stats[key]) : big(stats[key]))
  // 账号累计的数一行；一段时间的数一行，前面用小字写统计周期。两行合起来最多四项，其余在悬停提示里
  const total = keys.filter(key => !PERIOD_KEYS.has(key)).slice(0, 2)
  const period = keys.filter(key => PERIOD_KEYS.has(key)).slice(0, MAX_FACTS - total.length)
  const tag = shortPeriod(row.period)
  const all = [row.statsAt ? viaText(row.statsVia, row.statsAt) : '', row.period ?? '', ...keys.map(key => `${statLabel(row.platform, key)} ${value(key)}`)].filter(Boolean).join('\n')
  return (
    <div className="md-b-facts" title={all}>
      {total.length ? <p>{total.map(key => <span key={key}>{statLabel(row.platform, key)} <b>{value(key)}</b></span>)}</p> : null}
      {period.length ? <p>{tag ? <small className="md-b-period">{tag}</small> : null}{period.map(key => <span key={key}>{statLabel(row.platform, key)} <b>{value(key)}</b></span>)}</p> : null}
    </div>
  )
}

/** 统计周期写成小字：「近7日」「昨日」照用；「统计截至：2026-11-12…」「11月12日 00:00 - 24:00」缩成日期。 */
function shortPeriod(period) {
  if (!period) return null
  if (period.length <= 6) return period
  const date = /(?:\d{4}[-./年])?(\d{1,2})[-./月](\d{1,2})/.exec(period)
  if (!date) return null
  const day = `${Number(date[1])}/${Number(date[2])}`
  return /截至/.test(period) ? t('截至 {day}', { day }) : day
}

const POST_NUMBERS = [['views', '{n} 播放'], ['stars', '{n} Star'], ['citations', '被引 {n}'], ['likes', '{n} 赞'], ['comments', '{n} 评论']]

/** 最新一条内容：上面一行是发布时间和最主要的一个公开数字，标题最多两行，全文在悬停提示里。点开在右侧浏览器里看。 */
function PostLine({ row }) {
  const post = row.latestPost
  const date = post.at ? short(dayKey(post.at)) : post.year ? String(post.year) : ''
  const nums = POST_NUMBERS.filter(([key]) => Number.isFinite(post[key])).slice(0, 1).map(([key, text]) => t(text, { n: compact(post[key]) }))
  return (
    <button type="button" className="md-b-post" title={post.title} onClick={() => openInBrowser(post.url)}>
      <small>{[t(POST_LABEL[row.platform] ?? '最新一条'), date, ...nums].filter(Boolean).map((part, i) => <span key={i}>{part}</span>)}</small>
      <span className="md-b-post-title">{post.title}</span>
    </button>
  )
}

/** 卡片底部一行：最近一次没读到时写原因；读不到的平台写明只能手动记，点一下就记。读于何时写在涨跌那一行。 */
function Source({ row, auto, onLog }) {
  if (row.needLogin) {
    return <button type="button" className="md-b-src is-link is-warn" title={row.readError ?? undefined} onClick={() => loginBackstage([row.platform])}>{t('后台需要重新登录 · 去登录')}<Icon name="upRight" size={11} /></button>
  }
  if (row.pending) return <p className="md-b-src is-warn" title={row.pending.reason}>{t('粉丝数待确认：{reason}', { reason: row.pending.reason })}</p>
  if (!auto.readable && !row.fetchedAt) {
    return <button type="button" className="md-b-src is-link" title={auto.reason} onClick={onLog}>{t('不登录读不到 · 手动记录')}<Icon name="plus" size={11} /></button>
  }
  if (!row.readError) return null
  return <p className="md-b-src is-warn" title={row.readError}>{t('最近一次没读到：{error}', { error: row.readError })}</p>
}

/** 还没有主数字的卡片：能自动读的给「填主页链接」，读不到的写原因；都保留手动记录。 */
function BlankCard({ row, auto, onLog, onLink, onRead }) {
  const count = t(countName(row.platform))
  let note = auto.reason
  let primary = null
  if (row.needLogin) {
    note = row.readError ?? t('后台需要重新登录')
    primary = <button type="button" className="md-b-blank is-primary" onClick={() => loginBackstage([row.platform])}><Icon name="upRight" size={13} />{t('去登录')}</button>
  } else if (auto.backstage) {
    // 从登录后的创作后台读：不用填主页链接
    note = row.pending?.reason ?? row.readError ?? (row.statsVia === 'backstage' && row.statsAt ? viaText('backstage', row.statsAt) : t('从登录后的创作后台读，不用填主页链接'))
    primary = <button type="button" className="md-b-blank is-primary" onClick={onRead}><Icon name="refresh" size={13} />{t('立即读取')}</button>
  } else if (auto.readable && !row.url) {
    note = auto.partial ?? t('填上主页链接，每天自动读{count}和其他公开数据', { count })
    primary = <button type="button" className="md-b-blank is-primary" onClick={onLink}><Icon name="link" size={13} />{t('填主页链接')}</button>
  } else if (auto.readable && row.readError) {
    // 只能读一部分的平台（YouTube）用短说明，完整原因在悬停提示里
    note = auto.partial ?? row.readError
  } else if (!auto.readable && !row.url) {
    // 现在不登录读不到的平台也先收下主页链接：点「后台」能直达，以后接上登录后的采集不用再填
    primary = <button type="button" className="md-b-blank is-primary" onClick={onLink}><Icon name="link" size={13} />{t('填主页链接')}</button>
  } else if (auto.readable) {
    note = t('主页链接已填，读一次就有数')
    primary = <button type="button" className="md-b-blank is-primary" onClick={onRead}><Icon name="refresh" size={13} />{t('立即读取')}</button>
  }
  return (
    <section className="md-tile md-b-card is-blank">
      <header><PlatformMark platform={row.platform} size={24} /><strong>{t(row.platform)}</strong><span className="md-grow" /><HomeLink platform={row.platform} /></header>
      <div className="md-b-count" aria-hidden="true">—</div>
      {note ? <p className="md-b-card-note" title={row.readError ?? undefined}>{note}</p> : null}
      {row.latestPost ? <PostLine row={row} /> : null}
      <div className="md-b-card-actions">
        {primary}
        <button type="button" className="md-b-blank" onClick={onLog}><Icon name="plus" size={13} />{t(`记录${countName(row.platform)}`)}</button>
      </div>
    </section>
  )
}

export function PlatformCard({ row, auto = { readable: false }, onLog, onLink, onRead }) {
  if (row.followers === null) return <BlankCard row={row} auto={auto} onLog={onLog} onLink={onLink} onRead={onRead} />
  const name = t(row.platform)
  const hasFoot = !row.latestPost && (row.latestViews !== null || row.engagementRate !== null)
  return (
    <section className="md-tile md-b-card">
      <header><PlatformMark platform={row.platform} size={24} /><strong>{name}</strong><span className="md-grow" /><HomeLink platform={row.platform} /></header>
      <div className="md-b-count" title={row.followersApprox ? t('后台只给了约数') : undefined}>{row.followersApprox ? approxText(row.followers) : row.followers.toLocaleString()}</div>
      <div className="md-b-deltas">
        <Delta label={t('今日')} value={row.today} />
        <Delta label={t('7 天')} value={row.d7} />
        {row.fetchedAt
          ? <span className="md-b-delta is-src" title={viaText(row.fetchedVia, row.fetchedAt)}>{viaText(row.fetchedVia, row.fetchedAt)}</span>
          : row.today === null && row.d7 === null ? <span className="md-b-delta">{row.loggedAt ? t('上次记录 {date}', { date: short(row.loggedAt) }) : t('还没开始逐日记录')}</span> : null}
        {/* 主数字是手动记的、其他项是后台读的：读于何时单独标出来 */}
        {!row.fetchedAt && row.statsVia && row.statsAt ? <span className="md-b-delta is-src">{viaText(row.statsVia, row.statsAt)}</span> : null}
      </div>
      <Facts row={row} />
      {row.spark.length > 1
        ? <Spark points={row.spark} color={colorOf(row.platform)} label={t('{platform}近 30 天粉丝走势', { platform: name })} />
        : row.latestPost ? <span className="md-grow" /> : <p className="md-b-spark-note">{t('再记一天就能画出走势')}</p>}
      {row.latestPost ? <PostLine row={row} /> : null}
      {hasFoot ? (
        <dl>
          <div><dt>{t('最新一条')}</dt><dd>{row.latestViews === null ? '—' : compact(row.latestViews)}</dd></div>
          <div><dt title={t('近 30 天互动率')}>{t('互动率')}</dt><dd title={row.engagementRate === null ? t('近 30 天没有同时记了播放和互动的数据') : t('近 30 天互动率')}>{rate(row.engagementRate)}</dd></div>
        </dl>
      ) : null}
      <Source row={row} auto={auto} onLog={onLog} />
    </section>
  )
}
