// 平台版本的流程部分：素材判断（How I）、参考了哪些素材、自检结果、改过哪些项；小红书图片版；配图；公众号按规范整理。
// 模型写的内容只当纯文本显示，不当 HTML。
import React from 'react'
import { hostRequest, report, setDesk, toast, updateVersion, useDesk, watchProduction } from './desk.js'
import { t } from './i18n.js'
import { Dialog, Icon } from './ui.jsx'
import { CardsPreview } from './layouts/cards-preview.jsx'
import { classifyHowI } from '../src/howi.js'
import { measure } from '../src/platform-specs.js'
import { splitCards } from '../src/selfcheck.js'
import flowCss from './version-flow.css'

/** 这一组界面的样式，放在页面里一次。 */
export function FlowStyles() {
  return <style>{flowCss}</style>
}

async function call(path, body) {
  try {
    const data = await hostRequest(path, body)
    if (data?.state) setDesk({ state: data.state })
    return data ?? {}
  } catch (err) {
    report(err)
    return null
  }
}

const LEVEL_TEXT = { did: '写到了你亲手做过的事', studied: '写到了你研究过的东西', none: '没写到你自己的经历' }
// 素材判断的结论说成一句话：正文里有什么，版本就敢用什么口吻
const LEVEL_SENTENCE = {
  did: '正文里写了你亲手做过的事，各平台版本可以用「我做了…」的口吻，但只写正文里有的。',
  studied: '正文里是你研究过、读过的东西，版本会写成「我看了」「我研究了」，不会写成亲手做过。',
  none: '正文里看不出你亲手做过或研究过，版本会用旁观者的口吻写，不替你编经历。',
}

/** 引文里去掉 Markdown 记号和行首的编号，不露出 ** 这类符号。 */
const plainQuote = text => String(text ?? '').replace(/\*\*|__|==|~~|`/g, '').replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '').trim()

/** 素材判断：正文里有没有亲手做过的事，决定这一版能用哪种口吻。用一句人话说，依据放在后面。 */
export function HowIBadge({ item, howI: given }) {
  const howI = given ?? classifyHowI(item)
  const evidence = (howI.evidence ?? []).map(plainQuote).filter(Boolean)
  return (
    <p className={`md-howi is-${howI.level}`}>
      <span>{t(LEVEL_SENTENCE[howI.level] ?? LEVEL_SENTENCE.none)}</span>
      {evidence.length ? <span className="md-howi-ev"><small>{t('依据')}</small>{evidence.map((row, i) => <q key={i}>{row}</q>)}</span> : null}
    </p>
  )
}

const REASON_TEXT = {
  empty: '改出来是空的，没采用',
  facts: '改的时候加了正文里没有的数字，没采用',
  experience: '改的时候把没做过的事写成了做过，没采用',
  headings: '改的时候丢了小标题，没采用',
  length: '篇幅和正文差太多，没采用',
  worse: '改完没过的项反而更多，没采用',
  unfixed: '改完一项都没改好，留着原稿',
  error: '修改这一步没成功',
}

/** 这一版是怎么来的：参考了哪些素材、自检结果、改过哪些项。没过的项在上面的检查里逐条列，这里收起不重复。 */
export function FlowPanel({ version }) {
  const flow = version.flow
  const [open, setOpen] = React.useState(false)
  if (!flow) return null
  const checks = flow.checks ?? []
  const bad = checks.filter(row => !row.ok)
  const refs = flow.refs
  const revision = flow.revision
  const summary = [
    flow.howI?.level ? t(LEVEL_TEXT[flow.howI.level] ?? '') : null,
    refs ? t('参考了 {n} 篇', { n: (refs.past?.length ?? 0) + (refs.materials?.length ?? 0) }) : null,
    bad.length ? t('写完检查有 {n} 项没过', { n: bad.length }) : t('写完检查都过了'),
    revision ? (revision.accepted ? t('自动改过 {n} 项', { n: revision.fixed.length }) : t('自动改了一次没采用')) : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="md-flow">
      <button type="button" className="md-flow-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        <b>{t('这一版怎么来的')}</b>
        <span className="md-flow-sum">{summary}</span>
      </button>
      {open ? (
        <>
          {flow.howI ? <div className="md-flow-sec"><b>{t('1. 素材与判断')}</b><HowIBadge howI={flow.howI} /></div> : null}
          {refs ? (
            <div className="md-flow-sec">
              <b>{t('2. 参考了哪些素材')}</b>
              <ul>
                {refs.past?.map(row => <li key={row.id}><i>·</i><span>{t('以前写过：{title}', { title: row.title })}</span></li>)}
                {refs.materials?.map(row => <li key={row.path}><i>·</i><span>{t('素材库：{title}（{path}）', { title: row.title, path: row.path })}</span></li>)}
                {!refs.past?.length && !refs.materials?.length ? <li><i>·</i><span>{t('没有找到相关的旧稿或素材')}</span></li> : null}
                <li><i>·</i><span>{refs.materialStatus === 'none' ? t('素材库没有设置，这一步跳过了（设置里可以指一个 Markdown 文件夹）') : refs.materialStatus === 'error' ? t('素材库读不了：{error}', { error: refs.materialError ?? '' }) : t('素材库看了 {n} 个文件', { n: refs.scanned ?? 0 })}</span></li>
              </ul>
            </div>
          ) : null}
          <div className="md-flow-sec">
            <b>{t('3. 按平台规则起草')}</b>
            <span>{flow.rules?.style ? t('风格「{name}」{rules}', { name: flow.rules.style, rules: flow.rules.platformRules ? t('，带这个平台的写法') : t('，没写这个平台的写法，按通用规矩') }) : t('没有选风格，按通用规矩')}</span>
          </div>
          <div className="md-flow-sec">
            <b>{t('4. 自检（不调模型）')}</b>
            <ul>
              {checks.map(row => <li key={row.id}><i className={row.ok ? 'md-flow-ok' : row.level === 'block' ? 'md-flow-bad' : 'md-flow-warn'}>{row.ok ? '✓' : '✗'}</i><span>{t(row.label)}：{plainQuote(row.detail)}{!row.ok && row.excerpt ? <q>{plainQuote(row.excerpt)}</q> : null}</span></li>)}
            </ul>
          </div>
          <div className="md-flow-sec">
            <b>{t('5. 定向修改')}</b>
            <span>
              {!revision ? t('自检都过了，没有再改') : revision.accepted
                ? t('让模型改了 {asked} 项，改好 {fixed} 项：{list}', { asked: revision.asked.length, fixed: revision.fixed.length, list: revision.fixed.map(id => t(checks.find(row => row.id === id)?.label ?? id)).join('、') || '—' })
                : t(REASON_TEXT[revision.reason] ?? '修改这一步没成功')}
            </span>
          </div>
          {flow.rules?.review?.length ? (
            <div className="md-flow-sec">
              <b>{t('还要你自己看的')}</b>
              <ul>{flow.rules.review.map((row, i) => <li key={i}><i>□</i><span>{row}</span></li>)}</ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** 图片版第一个「## 」是封面：拿它当封面标题，剩下的给卡片排版。 */
export function coverOf(cards, fallback) {
  const text = String(cards ?? '')
  const match = /^\s*##\s+(.+)$/m.exec(text)
  if (!match || text.slice(0, match.index).trim()) return { title: fallback, article: text }
  return { title: match[1].trim(), article: text.slice(match.index + match[0].length).replace(/^\n+/, '') }
}

/**
 * 图片版：直接在卡片排版里看，选主题、骨架、封面，导出图片。
 * 传了 itemId 时，左边改的字写回这个版本的 cards（versions/update），封面那行「## 」原样留着。
 */
export function CardsDialog({ title, cards, onClose, itemId, platform = '小红书' }) {
  const cover = coverOf(cards, title)
  const production = React.useMemo(() => ({ article: cover.article, images: [] }), [cover.article])
  // 封面那一行（和它后面的空行）不进编辑器，保存时接回去
  const head = String(cards ?? '').slice(0, String(cards ?? '').length - cover.article.length)
  const onSave = React.useMemo(() => (itemId ? async text => Boolean(await updateVersion({ id: itemId, platform, cards: head + text })) : undefined), [itemId, platform, head])
  return (
    <Dialog title={t('图片版')} onClose={onClose} width={1180}>
      <div className="md-cards-dialog">
        <CardsPreview production={production} title={cover.title} onSave={onSave} mediaKey={itemId ? `${itemId}:${platform}` : undefined} />
      </div>
    </Dialog>
  )
}

/** 打开图片版的按钮，平台版本卡片和发布页都用。传了 itemId 时图片版里改的字会保存。 */
export function CardsButton({ title, cards, className = 'md-btn is-small', label = '图片版', itemId }) {
  const [open, setOpen] = React.useState(false)
  if (!String(cards ?? '').trim()) return null
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><Icon name="image" size={13} />{t(label)}</button>
      {open ? <CardsDialog title={title} cards={cards} itemId={itemId} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** 小红书图片版的编辑框：页数、合计字数、超出每页上限的页，各自有计数。 */
export function CardsField({ item, version, spec, running, areaRef }) {
  const [cards, setCards] = React.useState(version.cards ?? '')
  React.useEffect(() => setCards(version.cards ?? ''), [version.cards])
  const pages = React.useMemo(() => splitCards(cards), [cards])
  const c = spec.cards
  const total = pages.reduce((sum, page) => sum + page.chars, 0)
  const over = pages.filter(page => page.chars > (page.images ? c.perImageCard : c.perCard)).length
  const badCount = pages.length < c.min || pages.length > c.max
  const badTotal = total < c.total.min || total > c.total.max
  return (
    <label className="md-ver-field">
      <span className="md-ver-label md-pair-label">
        <span>{t('长图文（按内容分节，自动分页）')}</span>
        <span className="md-grow" />
        <span className={`md-ver-count ${badCount ? 'is-over' : ''}`}>{t('{n} 节 / {min}–{max}', { n: pages.length, min: c.min, max: c.max })}</span>
        <span className={`md-ver-count ${badTotal ? 'is-under' : ''}`}>{t('合计 {n} / {min}–{max}', { n: total, min: c.total.min, max: c.total.max })}</span>
        {over ? <span className="md-ver-count is-over">{t('{n} 节超过建议 {max} 字', { n: over, max: c.perCard })}</span> : null}
      </span>
      <textarea ref={areaRef} value={cards} rows={12} disabled={running} aria-label={t('图片版')} placeholder={t('## 封面大标题\n\n一句小标题\n\n## 第二页标题\n\n……')} onChange={e => setCards(e.target.value)} onBlur={() => { if (cards !== (version.cards ?? '')) updateVersion({ id: item.id, platform: '小红书', cards }) }} />
    </label>
  )
}

/** 正文的字数，按风格卡里定的范围标颜色。 */
export function captionCount(body, spec) {
  return { n: measure(body, spec.body.count), min: spec.body.min, max: spec.body.max }
}

/** 三个封面标题候选：点一个换上，可以撤销。 */
export function TitleOptions({ item, platform, version }) {
  const options = (version.titleOptions ?? []).filter(row => row && row !== version.title)
  if (!options.length) return null
  const apply = async (title) => {
    const result = await updateVersion({ id: item.id, platform, title })
    if (result) toast(t('标题换好了'), { undo: true })
  }
  return (
    <p className="md-title-opts">
      <span>{t('其他封面标题：')}</span>
      {options.map(row => <button key={row} type="button" className="md-pill is-small" onClick={() => apply(row)}>{row}</button>)}
    </p>
  )
}

/** 配图：先让模型逐页提议，用户勾选后才生图；没接生图就说明并跳过。 */
export function IllustrationPanel({ item, platform, version }) {
  const ready = useDesk(s => Boolean(s.settings?.imageReady))
  const rows = version.illustrations ?? []
  const [picked, setPicked] = React.useState(() => new Set(rows.filter(row => row.need && row.status === 'idle').map(row => row.page)))
  const [busy, setBusy] = React.useState(false)
  const drawing = rows.some(row => row.status === 'pending' || row.status === 'running')
  React.useEffect(() => (drawing ? watchProduction(item.id) : undefined), [drawing, item.id])
  React.useEffect(() => { setPicked(new Set(rows.filter(row => row.need && row.status === 'idle').map(row => row.page))) }, [rows.length]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <p className="md-ver-note">{t('配图：还没有接入生图模型，这一步跳过。到设置里接入之后，这里可以逐页提议配图。')}</p>
  const propose = async () => {
    setBusy(true)
    await call('versions/illustrations/propose', { id: item.id, platform })
    setBusy(false)
  }
  const generate = async () => {
    setBusy(true)
    const data = await call('versions/illustrations/generate', { id: item.id, platform, pages: [...picked] })
    setBusy(false)
    if (data?.started) toast(t('开始画 {n} 张，画好一张就插进对应的{unit}', { n: data.started.length, unit: platform === '小红书' ? t('页') : t('节') }))
  }
  const toggle = page => setPicked((current) => {
    const next = new Set(current)
    if (next.has(page)) next.delete(page)
    else next.add(page)
    return next
  })
  const STATUS = { pending: '排队中', running: '正在画', done: '已插入', failed: '失败' }
  return (
    <div className="md-illus">
      {rows.length ? rows.map(row => (
        <label key={row.page} className="md-illus-row">
          <input type="checkbox" checked={picked.has(row.page)} disabled={drawing || row.status === 'running'} onChange={() => toggle(row.page)} />
          <span>{t('第 {n} {unit}', { n: row.page + 1, unit: platform === '小红书' ? t('页') : t('节') })}{row.heading ? `「${row.heading}」` : ''} · {row.need ? t(row.kind) : t('不建议配图')}{row.status !== 'idle' ? ` · ${t(STATUS[row.status] ?? row.status)}` : ''}</span>
          {row.prompt ? <small>{row.prompt}</small> : null}
          {row.error ? <small className="md-flow-bad">{row.error}</small> : null}
          {row.src ? <img src={row.src} alt="" loading="lazy" /> : null}
        </label>
      )) : null}
      <div className="md-illus-foot">
        <button type="button" className="md-btn is-small" disabled={busy || drawing} onClick={propose}><Icon name="spark" size={13} />{rows.length ? t('重新提议配图') : t('逐页提议配图')}</button>
        {rows.length ? <button type="button" className="md-btn is-small is-primary" disabled={busy || drawing || !picked.size} onClick={generate}><Icon name="image" size={13} />{t('生成所选（{n} 张）', { n: picked.size })}</button> : null}
        <span className="md-muted">{t('提议只调一次文字模型；勾选之后才会生图')}</span>
      </div>
    </div>
  )
}

/** 公众号：默认沿用正文；可以按公众号规范整理成一个真正的版本，看改了什么，也可以退回沿用。 */
export function WechatFormatBar({ item, version }) {
  const running = version.status === 'running'
  const format = () => call('versions/format-wechat', { id: item.id })
  const carry = () => call('versions/carry-wechat', { id: item.id })
  const changes = version.changes
  return (
    <div className="md-wx-changes">
      {version.carried ? (
        <span>
          {t('现在是原样沿用正文。')}
          <button type="button" className="md-btn is-small" disabled={running} onClick={format}><Icon name="spark" size={13} />{t('按公众号规范整理')}</button>
        </span>
      ) : version.formatted ? (
        <>
          <span>
            {t('按公众号规范整理过：段落 {a} → {b}，改动 {n} 段；加粗 {b0} → {b1}，高亮 {h0} → {h1}{opening}{ending}', {
              a: changes?.paragraphs.before ?? 0, b: changes?.paragraphs.after ?? 0, n: changes?.paragraphs.changed ?? 0,
              b0: changes?.bold[0] ?? 0, b1: changes?.bold[1] ?? 0, h0: changes?.highlight[0] ?? 0, h1: changes?.highlight[1] ?? 0,
              opening: changes?.opening ? t('；开头改过') : '', ending: changes?.ending ? t('；结尾改过') : '',
            })}
          </span>
          {changes?.headings.added.length || changes?.headings.removed.length ? <span>{t('小标题：新增 {added}；去掉 {removed}', { added: changes.headings.added.join('、') || '—', removed: changes.headings.removed.join('、') || '—' })}</span> : null}
          {changes?.samples.map((row, i) => <span key={i}><del>{row.before}</del> → <ins>{row.after}</ins></span>)}
          <span>
            <button type="button" className="md-btn is-small" disabled={running} onClick={format}><Icon name="refresh" size={13} />{t('重新整理')}</button>
            <button type="button" className="md-btn is-small" disabled={running} onClick={carry}>{t('恢复沿用正文')}</button>
          </span>
        </>
      ) : (
        <span>
          {t('这个版本插过图，和正文不完全一样。')}
          <button type="button" className="md-btn is-small" disabled={running} onClick={carry}>{t('恢复沿用正文')}</button>
        </span>
      )}
      {version.error && !running ? <span className="md-ver-error">{version.error}</span> : null}
    </div>
  )
}
