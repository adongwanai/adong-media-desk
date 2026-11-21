// 平台版本：成稿之后按平台各写一版，每个平台一张卡片，可以改、可以换标题，复制时按字段分开。
// 模型写的内容只当纯文本显示，不当 HTML。
import React from 'react'
import { PlatformMark } from './board.jsx'
import { checkDraft, countFindings } from './checks.js'
import { typeCover } from './cover.js'
import { cancelVersions, dispatchOps, generateTitles, generateVersions, reviseVersion, setDesk, toast, updateVersion, useDesk, watchProduction } from './desk.js'
import { t } from './i18n.js'
import { renderMarkdown } from './md-render.js'
import { Icon, IconButton } from './ui.jsx'
import { PLATFORMS } from './util.js'
import { COUNTING, fingerprint, measure, splitThread } from '../src/platform-specs.js'
import { splitCards } from '../src/selfcheck.js'
import { effectiveSpec } from '../src/platform-rules.js'
import { CardsButton, CardsField, FlowPanel, FlowStyles, HowIBadge, IllustrationPanel, TitleOptions, WechatFormatBar } from './version-flow.jsx'

const SIMILAR_LIMIT = 0.5
// 只差在长短上的几项：可以让模型只为这一项再改一次（压到或补到范围内）
const LENGTH_RULES = new Set(['title-length', 'body-length', 'post-length', 'cards-total', 'card-chars'])
// 每一项问题出在哪个输入框里：「去改」就滚到那里、选中原句
const FIELD_OF = {
  'title-length': 'title', 'title-empty': 'title', 'card-title': 'cards', 'cards-count': 'cards', 'cards-total': 'cards', 'card-chars': 'cards', 'card-images': 'cards', 'similar-cards': 'body',
  'tag-count': 'tags', tags: 'tags', 'body-length': 'body', 'post-length': 'body', 'thread-count': 'body', 'thread-question': 'body', 'caption-format': 'body',
}

/** 和正文有多像，说成人话；具体数字放在提示里。 */
function similarityText(value, retried) {
  const base = value <= 0.2 ? t('和正文重复很少') : value <= SIMILAR_LIMIT ? t('和正文有点像') : t('和正文太像了')
  return retried ? t('{base}，已重写一次', { base }) : base
}

/** 去掉 Markdown 记号，摘要和引文里不出现 ** 这类符号。 */
export function stripMarks(text) {
  return String(text ?? '').replace(/\*\*|__|==|~~|`/g, '').replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '').trim()
}

/** 粘到平台编辑器里的纯文本：去掉 Markdown 的标题井号、加粗和高亮记号。 */
export function plainBody(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))
    .map(line => line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/==([^=]+)==/g, '$1'))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const tagLine = tags => (tags ?? []).map(tag => `#${tag}`).join(' ')

/** 这个平台能用的版本（写完的）。 */
export function readyVersion(item, platform) {
  const version = item.production?.versions?.[platform]
  return version?.status === 'done' && version.body ? version : null
}

/** 一键复制的整段：标题、正文、标签。 */
export function versionCopy(version) {
  return [version.title, plainBody(version.body), tagLine(version.tags)].filter(Boolean).join('\n\n')
}

export function useActiveStyle() {
  return useDesk(s => (s.state.styles ?? []).find(row => row.id === s.state.activeStyleId) ?? null)
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('{label}已复制', { label }))
  } catch {
    toast(t('没能写入剪贴板，请手动选中复制'), { error: true })
  }
}

/**
 * 发布前检查的结果：先只给一句「几项要看一下」，点开再逐条看原句。数字照实给，不一上来摊一片红。
 * actions(row) 给每一条加操作按钮（比如「去改」「压到范围内」）。
 */
export function ChecksPanel({ findings, compact = false, actions = null, note = null }) {
  const [open, setOpen] = React.useState(false)
  const { block, warn } = countFindings(findings)
  // 只剩参考项（句长、连词密度）时仍算没问题，参考可以点开看
  const info = findings.length - block - warn
  if (!findings.length) return <p className="md-ck is-clean"><Icon name="check" size={13} />{t('发布前检查：没发现问题')}{note}</p>
  const need = block + warn
  return (
    <div className={`md-ck ${compact ? 'is-compact' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="md-ck-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={`md-ck-dot ${block ? 'is-block' : need ? 'is-warn' : 'is-ok'}`} aria-hidden="true" />
        <span className="md-ck-line">{need ? t('{n} 项要看一下', { n: need }) : t('没发现要改的')}</span>
        {block ? <span className="md-ck-sub" title={t('标红的是发出去可能会被限流、删掉或出错的')}>{t('其中 {n} 项建议发前改掉', { n: block })}</span> : null}
        {info ? <span className="md-ck-sub">{t('{n} 条参考', { n: info })}</span> : null}
        <span className="md-grow" />
        <span className="md-ck-toggle">{open ? t('收起') : t('逐条看')}</span>
        <Icon name={open ? 'chevD' : 'chevR'} size={13} />
      </button>
      {note}
      {open ? (
        <ul className="md-ck-list">
          {findings.map((row, index) => (
            <li key={index} className={`is-${row.level}`}>
              <span>{stripMarks(row.message)}</span>
              {row.excerpt ? <q>{stripMarks(row.excerpt)}</q> : null}
              {actions ? <span className="md-ck-acts">{actions(row)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// 打开着的标题浮层对应的按钮。浮层画在稿面最外层，不会被格子的 overflow 裁掉
let pickerAnchor = null

/** 换标题：模型出一批候选，本地标出问题，推荐三个方法不同的。选中就写进去，可以撤销。 */
function TitlePicker({ item, platform = null, onClose, layer }) {
  const [data, setData] = React.useState(null)
  const [busy, setBusy] = React.useState(true)
  const ref = React.useRef(null)
  // 打开时按按钮的位置摆：下面放得下就放下面，否则放上面
  const place = React.useMemo(() => {
    const rect = pickerAnchor?.getBoundingClientRect()
    const box = layer.current?.getBoundingClientRect()
    if (!rect || !box) return {}
    const width = Math.min(440, box.width - 16)
    const left = Math.max(8, Math.min(rect.left - box.left, box.width - width - 8))
    const below = box.bottom - rect.bottom
    const above = rect.top - box.top
    return below >= 320 || below >= above
      ? { left, width, top: rect.bottom - box.top + 6, maxHeight: Math.min(460, below - 14) }
      : { left, width, bottom: box.bottom - rect.top + 6, maxHeight: Math.min(460, above - 14) }
  }, [layer])
  const run = React.useCallback(async () => {
    setBusy(true)
    const result = await generateTitles(item.id, platform)
    setBusy(false)
    if (result) setData(result)
    else onClose()
  }, [item.id, platform, onClose])
  React.useEffect(() => { run() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const inside = target => ref.current?.contains(target) || pickerAnchor?.contains(target)
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }
    const onDown = (event) => { if (!inside(event.target)) onClose() }
    // 位置是打开时算好的，外面一滚动就对不上了，直接收起
    const onScroll = (event) => { if (!inside(event.target)) onClose() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  const apply = async (title) => {
    if (platform) {
      const result = await updateVersion({ id: item.id, platform, title })
      if (result) toast(t('标题换好了'), { undo: true })
    } else {
      await dispatchOps([{ op: 'update_production', id: item.id, title }], { label: t('换标题') })
    }
    onClose()
  }
  const picks = new Set(data?.picks ?? [])
  return (
    <div className="md-tp" ref={ref} role="dialog" aria-label={t('换标题')} style={place}>
      <header className="md-tp-head">
        <b>{t('换标题')}</b>
        <span className="md-muted">{platform ? t(platform) : t('正文')}</span>
        <span className="md-grow" />
        <IconButton icon="refresh" label={t('再出一批')} disabled={busy} onClick={run} size={14} />
        <IconButton icon="close" label={t('关闭')} onClick={onClose} size={14} />
      </header>
      {busy ? <p className="md-tp-busy"><span className="md-shimmer">{t('正在想标题…')}</span></p> : null}
      {!busy && data ? (
        <ol className="md-tp-list">
          {data.candidates.map((row, index) => (
            <li key={index}>
              <button type="button" className={`md-tp-row ${picks.has(index) ? 'is-pick' : ''}`} onClick={() => apply(row.title)}>
                <span className="md-tp-title">{picks.has(index) ? <Icon name="spark" size={12} /> : null}{row.title}</span>
                <span className="md-tp-meta">
                  <i>{row.method}</i>
                  <span className={row.length > row.limit ? 'is-over' : ''}>{row.length}/{row.limit}</span>
                  {row.flags.map((flag, k) => <em key={k} className={`is-${flag.level}`}>{flag.message}</em>)}
                </span>
              </button>
            </li>
          ))}
          {data.candidates.length === 0 ? <li className="md-muted">{t('模型没给出可用的标题，再出一批试试')}</li> : null}
        </ol>
      ) : null}
      {!busy && data ? <p className="md-tp-foot">{t('带星的是推荐：没有硬伤、方法各不相同。点一个就换上，可以撤销。')}</p> : null}
    </div>
  )
}

/** 「换标题」按钮。浮层由 TitlePickerLayer 画。 */
export function TitleButton({ item, platform = null, className = 'md-pill' }) {
  const open = useDesk(s => s.titlePick?.id === item.id && (s.titlePick.platform ?? null) === platform)
  const ref = React.useRef(null)
  const toggle = () => {
    pickerAnchor = open ? null : ref.current
    setDesk({ titlePick: open ? null : { id: item.id, platform } })
  }
  return <button type="button" ref={ref} className={className} aria-expanded={open} onClick={toggle}><Icon name="spark" size={13} />{t('换标题')}</button>
}

/** 放在稿面最外层的一层，标题浮层画在这里。 */
export function TitlePickerLayer({ item }) {
  const pick = useDesk(s => (s.titlePick?.id === item.id ? s.titlePick : null))
  const layer = React.useRef(null)
  const close = React.useCallback(() => {
    pickerAnchor = null
    setDesk({ titlePick: null })
  }, [])
  // 换了条目或离开稿面时收起
  React.useEffect(() => close, [item.id, close])
  return (
    <div className="md-tp-layer" ref={layer} aria-hidden={pick ? undefined : true}>
      {pick ? <TitlePicker key={`${pick.platform}`} item={item} platform={pick.platform} onClose={close} layer={layer} /> : null}
    </div>
  )
}

function Counter({ n, max, min }) {
  const over = n > max
  const under = min !== undefined && n < min
  return <span className={`md-ver-count ${over ? 'is-over' : under ? 'is-under' : ''}`}>{min !== undefined ? t('{n} / {min}–{max}', { n, min, max }) : `${n}/${max}`}</span>
}

function BodyCounter({ body, spec }) {
  if (spec.thread) {
    const posts = splitThread(body)
    const longest = Math.max(0, ...posts.map(post => measure(post, spec.post.count)))
    return <span className={`md-ver-count ${longest > spec.post.max ? 'is-over' : ''}`} title={COUNTING[spec.post.count]}>{t('{n} 条，最长一条 {len}/{max}', { n: posts.length, len: longest, max: spec.post.max })}</span>
  }
  return <span title={COUNTING[spec.body.count]}><Counter n={measure(body, spec.body.count)} min={spec.body.min} max={spec.body.max} /></span>
}

/** 在输入框里找到这句并选中；找不到就只把光标放进去。textarea 自己也滚到那一行。 */
function focusField(el, excerpt) {
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  el.focus({ preventScroll: true })
  const probe = stripMarks(excerpt).slice(0, 24)
  const at = probe ? el.value.indexOf(probe) : -1
  if (at < 0) return
  el.setSelectionRange(at, at + probe.length)
  if (el.tagName === 'TEXTAREA') {
    // 量出这句前面的文字（含自动换行）有多高，把它滚到框里上三分之一处
    const full = el.value
    const top = el.scrollTop
    el.value = full.slice(0, at)
    el.scrollTop = 0
    const height = el.scrollHeight
    el.value = full
    el.scrollTop = top
    el.setSelectionRange(at, at + probe.length)
    el.scrollTop = height <= el.clientHeight ? 0 : height - el.clientHeight / 3
  }
}

/** 图片版里第一页超出字数的那页标题：「去改」直接选中它。 */
function overPage(cards, spec) {
  const page = splitCards(cards).find(row => row.chars > (row.images ? spec.cards.perImageCard : spec.cards.perCard))
  return page?.heading ?? ''
}

/** 刚才「压到范围内」的结果，说成一句话。 */
function revisionNote(revision, checks) {
  if (!revision?.targeted) return null
  const names = revision.fixed.map(id => t(checks.find(row => row.id === id)?.label ?? id)).join('、')
  return revision.accepted ? t('刚才定向改了一次：{list} 已经改好', { list: names || '—' }) : t('刚才定向改了一次，没采用：{reason}', { reason: t(REVISE_REASON[revision.reason] ?? '修改这一步没成功') })
}
const REVISE_REASON = { empty: '改出来是空的', facts: '加了正文里没有的数字', experience: '把没做过的事写成了做过', headings: '丢了小标题', worse: '改完别的项反而没过', unfixed: '改完还是不在范围内', error: '模型这一步出错了' }

/** X (Twitter) 串推可视化气泡编辑器：每条独立计字数、单条复制、增删调序。 */
function XThreadEditor({ body, spec, disabled, onChange, onCommit, handle }) {
  const posts = React.useMemo(() => {
    const list = splitThread(body)
    return list.length ? list : ['']
  }, [body])
  const updateAt = (index, nextText) => {
    const next = posts.map((p, i) => (i === index ? nextText : p))
    onChange(next.join('\n\n---\n\n'))
  }
  const addAfter = (index) => {
    const next = [...posts.slice(0, index + 1), '', ...posts.slice(index + 1)]
    const joined = next.join('\n\n---\n\n')
    onChange(joined)
    onCommit(joined)
  }
  const removeAt = (index) => {
    if (posts.length <= 1) return
    const next = posts.filter((_, i) => i !== index)
    const joined = next.join('\n\n---\n\n')
    onChange(joined)
    onCommit(joined)
  }
  const move = (index, delta) => {
    const target = index + delta
    if (target < 0 || target >= posts.length) return
    const next = [...posts]
    ;[next[index], next[target]] = [next[target], next[index]]
    const joined = next.join('\n\n---\n\n')
    onChange(joined)
    onCommit(joined)
  }
  return (
    <div className="md-x-thread" role="list" aria-label={t('X 串推分条编辑')}>
      {posts.map((post, idx) => {
        const len = measure(post, spec.post.count)
        const over = len > spec.post.max
        return (
          <div key={idx} className={`md-x-post ${over ? 'is-over' : ''}`} role="listitem">
            <div className="md-x-rail" aria-hidden="true">
              <span className="md-x-avatar">𝕏</span>
              {idx < posts.length - 1 ? <i className="md-x-line" /> : null}
            </div>
            <div className="md-x-main">
              <div className="md-x-head">
                <b>{handle || 'Creator'}</b>
                <span className="md-muted">{posts.length > 1 ? `${idx + 1}/${posts.length}` : '1/1'}</span>
                <span className="md-grow" />
                <span className={`md-ver-count ${over ? 'is-over' : ''}`} title={COUNTING[spec.post.count]}>{len}/{spec.post.max}</span>
                {idx > 0 ? <button type="button" className="md-inline-link" disabled={disabled} title={t('上移')} onClick={() => move(idx, -1)}>↑</button> : null}
                {idx < posts.length - 1 ? <button type="button" className="md-inline-link" disabled={disabled} title={t('下移')} onClick={() => move(idx, 1)}>↓</button> : null}
                <button type="button" className="md-inline-link" title={t('复制这一条')} onClick={() => copy(post, t('第 {n} 条推文', { n: idx + 1 }))}>{t('复制')}</button>
                {posts.length > 1 ? <button type="button" className="md-inline-link" disabled={disabled} title={t('删除这一条')} onClick={() => removeAt(idx)}>✕</button> : null}
              </div>
              <textarea
                rows={Math.max(2, Math.min(7, Math.ceil(post.length / 42) + 1))}
                value={post}
                disabled={disabled}
                placeholder={t('写这一条推文…')}
                onChange={e => updateAt(idx, e.target.value)}
                onBlur={() => onCommit(posts.join('\n\n---\n\n'))}
              />
              <div className="md-x-foot">
                <button type="button" className="md-link-btn" disabled={disabled} onClick={() => addAfter(idx)}>+ {t('在下面加一条推文')}</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 小红书双列发现流模拟预览：一眼看清封面大字与标题前两行截断效果。 */
function XhsFeedSimulator({ item, title, cards }) {
  const author = useDesk(s => s.state.author?.signature || s.state.accounts?.find(a => a.platform === '小红书')?.handle || t('你的账号'))
  const coverTitle = React.useMemo(() => {
    const firstHeading = /^#{1,3}\s+(.+)/m.exec(String(cards ?? ''))?.[1]?.trim()
    return firstHeading || title || item.production?.title || item.title
  }, [cards, title, item.production?.title, item.title])
  const coverSrc = item.production?.cover?.src
  const generated = React.useMemo(() => typeCover({ id: item.id, title: coverTitle }), [item.id, coverTitle])
  const displayTitle = title || item.production?.title || item.title
  const chars = measure(displayTitle, 'xhs')
  return (
    <details className="md-xhs-sim">
      <summary>
        <Icon name="eye" size={13} />
        <span>{t('小红书双列信息流模拟预览')}</span>
        <span className="md-muted">{chars > 20 ? t('标题超出 20 字上限') : chars > 18 ? t('标题贴近两行末尾') : t('两行内完整露出')}</span>
      </summary>
      <div className="md-xhs-feed" aria-label={t('小红书发现页双列模拟')}>
        <div className="md-xhs-feed-card is-mine">
          <div className="md-xhs-feed-cover">
            <img src={coverSrc || generated} alt="" draggable={false} />
            {coverSrc && coverTitle ? <b>{coverTitle.slice(0, 18)}</b> : null}
          </div>
          <p className="md-xhs-feed-title">{displayTitle || t('未填写标题')}</p>
          <div className="md-xhs-feed-meta">
            <span className="md-xhs-feed-user"><i />{String(author).slice(0, 10)}</span>
            <span>♡ 128</span>
          </div>
        </div>
        <div className="md-xhs-feed-card is-peer" aria-hidden="true">
          <div className="md-xhs-feed-cover is-placeholder">
            <span>{t('同屏竞品参照')}</span>
          </div>
          <p className="md-xhs-feed-title">{t('为什么你的封面在双列信息流里没人点？看这 3 个细节')}</p>
          <div className="md-xhs-feed-meta">
            <span className="md-xhs-feed-user"><i />{t('某科技博主')}</span>
            <span>♡ 1.2k</span>
          </div>
        </div>
      </div>
    </details>
  )
}

function VersionCard({ item, platform, version }) {
  const style = useActiveStyle()
  const accountHandle = useDesk(s => s.state.accounts?.find(a => a.platform === platform)?.handle ?? '')
  // 平台规矩叠上风格卡里定的数（小红书正文、图片版页数等）
  const spec = React.useMemo(() => effectiveSpec(platform, style), [platform, style])
  const pair = Boolean(spec.cards)
  const [title, setTitle] = React.useState(version.title ?? '')
  const [body, setBody] = React.useState(version.body ?? '')
  const [tags, setTags] = React.useState(tagLine(version.tags))
  const [firstComment, setFirstComment] = React.useState(version.firstComment ?? '')
  const [rawThread, setRawThread] = React.useState(false)
  React.useEffect(() => setTitle(version.title ?? ''), [version.title])
  React.useEffect(() => setBody(version.body ?? ''), [version.body])
  React.useEffect(() => setTags(tagLine(version.tags)), [version.tags])
  React.useEffect(() => setFirstComment(version.firstComment ?? ''), [version.firstComment])
  const fields = { title: React.useRef(null), body: React.useRef(null), tags: React.useRef(null), cards: React.useRef(null) }
  const running = version.status === 'running'
  const parsedTags = tags.split(/[\s,，、#＃]+/).filter(Boolean)
  const findings = React.useMemo(() => checkDraft({ title, body: plainBody(body), markdown: body, cards: version.cards, tags: parsedTags, firstComment }, platform, style), [title, body, tags, version.cards, firstComment, platform, style]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (patch) => updateVersion({ id: item.id, platform, ...patch })
  const stale = version.source && version.source !== fingerprint(item.production.article)
  const regenerate = () => {
    if (!version.edited) return generateVersions(item.id, [platform])
    setDesk({ dialog: { title: t('重新生成{platform}版本', { platform: t(platform) }), submitLabel: t('重新生成'), fields: [{ name: 'note', type: 'hidden', label: version.imported ? t('这个版本是你导入的自己的稿子，重新生成会换掉它，而且这一步不能撤销。') : t('你手动改过这个版本，重新生成会换掉它，而且这一步不能撤销。') }], onSubmit: () => generateVersions(item.id, [platform]) } })
    return null
  }
  // 「去改」：滚到出问题的输入框，选中原句；内容类的问题按原句去几个框里找
  const goFix = (row) => {
    const name = FIELD_OF[row.rule] ?? (['title', 'body', 'cards', 'tags'].find(key => row.excerpt && String(fields[key].current?.value ?? '').includes(stripMarks(row.excerpt).slice(0, 24))) || 'body')
    const excerpt = row.rule === 'card-chars' ? overPage(version.cards, spec) : row.excerpt
    focusField(fields[name].current ?? fields.body.current, excerpt)
  }
  const shrink = async (row) => {
    // 先把手上没保存的改动存进去，再让模型只改这一项
    const pending = title !== (version.title ?? '') || body !== (version.body ?? '')
    if (pending) await save({ title, body })
    const data = await reviseVersion(item.id, platform, [row.rule])
    if (data?.started) toast(t('正在只改这一项，其余句子不动'))
  }
  const actions = row => (
    <>
      <button type="button" className="md-inline-link" onClick={() => goFix(row)}>{t('去改')}</button>
      {LENGTH_RULES.has(row.rule) ? <button type="button" className="md-inline-link" disabled={running} onClick={() => shrink(row)}>{/少于|至少|扩到|补到|单薄/.test(row.message) ? t('补到范围内') : t('压到范围内')}</button> : null}
    </>
  )
  const note = revisionNote(version.flow?.revision, version.flow?.checks ?? [])
  return (
    <article className={`md-ver-card ${running ? 'is-running' : ''}`} data-status={version.status}>
      <header className="md-ver-head">
        <PlatformMark platform={platform} size={20} />
        <h3>{t(platform)}</h3>
        {version.carried ? <span className="md-ver-badge">{t('沿用正文')}</span> : null}
        {!version.carried && Number.isFinite(version.similarity) && !running ? (
          <span className={`md-ver-badge ${version.similarity > SIMILAR_LIMIT ? 'is-high' : ''}`} title={t('和正文的用词重合度 {n}（0 到 1，越小越不一样；超过 {limit} 说明改写得不够）', { n: version.similarity.toFixed(2), limit: SIMILAR_LIMIT })}>{similarityText(version.similarity, version.retried)}</span>
        ) : null}
        {version.imported ? <span className="md-ver-badge" title={t('从你导入的文件里来，是你自己写的；重新生成之前会先问你')}>{t('你自己的稿子')}</span> : version.edited ? <span className="md-ver-badge" title={t('你在这里改过；重新生成之前会先问你')}>{t('改过')}</span> : null}
        <span className="md-grow" />
        {running ? <button type="button" className="md-btn is-small" onClick={() => cancelVersions(item.id, platform)}>{t('取消')}</button> : (
          <>
            {spec.title ? <TitleButton item={item} platform={platform} className="md-btn is-small" /> : null}
            <button type="button" className="md-btn is-small" onClick={regenerate}><Icon name="refresh" size={13} />{t('重新生成')}</button>
          </>
        )}
      </header>
      {running ? <p className="md-ver-running"><span className="md-shimmer">{version.body ? t('正在重写…') : t('正在按{platform}的写法改写…', { platform: t(platform) })}</span></p> : null}
      {version.status === 'failed' ? <p className="md-ver-error">{t('没写成：{error}', { error: version.error || t('未知原因') })}</p> : null}
      {version.error && version.status === 'done' ? <p className="md-ver-note is-warn">{t('刚才那次修改没成功：{error}', { error: version.error })}</p> : null}
      {stale && !running ? <p className="md-ver-note">{t('正文在这之后改过，这个版本可能对不上了，可以重新生成。')}</p> : null}
      {version.newNumbers?.length ? <p className="md-ver-note is-warn">{t('这些数字在正文里找不到，请核对：{nums}', { nums: version.newNumbers.join('、') })}</p> : null}
      {version.body && !running ? <ChecksPanel findings={findings} compact actions={actions} note={note ? <span className="md-ck-note">{note}</span> : null} /> : null}
      {version.body || !running ? (
        <div className="md-ver-fields">
          {spec.title ? (
            <label className="md-ver-field">
              <span className="md-ver-label">{t('标题')}<Counter n={measure(title, spec.title.count)} max={spec.title.max} /></span>
              <input ref={fields.title} value={title} disabled={running} aria-label={t('标题')} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title !== (version.title ?? '')) save({ title }) }} />
            </label>
          ) : null}
          {platform === '小红书' && !running ? <XhsFeedSimulator item={item} title={title} cards={version.cards} /> : null}
          <div className="md-ver-field">
            <span className="md-ver-label">
              {spec.thread ? t('串推内容') : pair ? t('正文（发在正文框里，和图片版是两段不同的话）') : t('正文')}
              {spec.thread ? (
                <button type="button" className="md-link-btn" onClick={() => setRawThread(v => !v)}>
                  {rawThread ? t('切成气泡视图') : t('切成纯文本')}
                </button>
              ) : null}
              <BodyCounter body={pair ? plainBody(body) : body} spec={pair && !version.cards ? { ...spec, body: { ...spec.body, min: spec.cards.total.min, max: spec.cards.total.max } } : spec} />
            </span>
            {spec.thread && !rawThread ? (
              <XThreadEditor
                body={body}
                spec={spec}
                disabled={running}
                handle={accountHandle}
                onChange={setBody}
                onCommit={(nextBody) => { if (nextBody !== (version.body ?? '')) save({ body: nextBody }) }}
              />
            ) : (
              <textarea ref={fields.body} value={body} rows={10} disabled={running} aria-label={t('正文')} onChange={e => setBody(e.target.value)} onBlur={() => { if (body !== (version.body ?? '')) save({ body }) }} />
            )}
          </div>
          {pair && (version.cards !== undefined || version.flow) ? <CardsField item={item} version={version} spec={spec} running={running} areaRef={fields.cards} /> : null}
          {spec.title && !running ? <TitleOptions item={item} platform={platform} version={version} /> : null}
          {spec.tags.max ? (
            <label className="md-ver-field">
              <span className="md-ver-label">{t('标签')}<Counter n={parsedTags.length} min={spec.tags.min} max={spec.tags.max} /></span>
              <input ref={fields.tags} value={tags} disabled={running} aria-label={t('标签')} placeholder={t('空格隔开')} onChange={e => setTags(e.target.value)} onBlur={() => { if (parsedTags.join(' ') !== (version.tags ?? []).join(' ')) save({ tags: parsedTags }) }} />
            </label>
          ) : null}
          <label className="md-ver-field">
            <span className="md-ver-label">{t('置顶首评（可选）')}<span className="md-muted">{t('放外链、补充资料或互动提问，避免正文限流')}</span></span>
            <input
              value={firstComment}
              disabled={running}
              maxLength={500}
              aria-label={t('置顶首评')}
              placeholder={t('发出后在评论区自己补的第一条评论…')}
              onChange={e => setFirstComment(e.target.value)}
              onBlur={() => { if (firstComment.trim() !== (version.firstComment ?? '')) save({ firstComment: firstComment.trim() }) }}
            />
          </label>
          {version.digest ? <p className="md-ver-comment"><b>{t('摘要')}</b>{version.digest}</p> : null}
        </div>
      ) : null}
      {version.body && !running ? (
        <>
          <FlowPanel version={version} />
          {platform === '公众号' ? <WechatFormatBar item={item} version={version} /> : null}
          {(pair && version.cards) || platform === '公众号' ? <IllustrationPanel item={item} platform={platform} version={version} /> : null}
          <footer className="md-ver-copy">
            <span>{t('复制')}</span>
            {spec.title ? <button type="button" className="md-btn is-small" onClick={() => copy(title, t('标题'))}>{t('标题')}</button> : null}
            <button type="button" className="md-btn is-small" onClick={() => copy(plainBody(body), t('正文'))}>{t('正文')}</button>
            {spec.tags.max ? <button type="button" className="md-btn is-small" disabled={!parsedTags.length} onClick={() => copy(tagLine(parsedTags), t('标签'))}>{t('标签')}</button> : null}
            {firstComment.trim() ? <button type="button" className="md-btn is-small" title={t('第一条评论：发出去之后自己在评论区发')} onClick={() => copy(firstComment.trim(), t('首评'))}>{t('首评')}</button> : null}
            {pair ? <CardsButton title={title} cards={version.cards} itemId={item.id} label="图片版：看卡片、导出图片" /> : null}
          </footer>
        </>
      ) : null}
    </article>
  )
}

const CORE_PLATFORMS = ['公众号', '小红书', '视频号', '知乎', 'X']

/** 平台版本页：勾平台、一键生成，下面一个平台一张卡。 */
export function VersionsView({ item }) {
  const versions = item.production?.versions ?? {}
  const have = PLATFORMS.filter(platform => versions[platform])
  const [picked, setPicked] = React.useState(() => new Set())
  const [showSource, setShowSource] = React.useState(false)
  const running = have.some(platform => versions[platform].status === 'running')
  React.useEffect(() => (running ? watchProduction(item.id) : undefined), [running, item.id])
  const toggle = platform => setPicked((current) => {
    const next = new Set(current)
    if (next.has(platform)) next.delete(platform)
    else next.add(platform)
    return next
  })
  const start = async () => {
    const list = PLATFORMS.filter(platform => picked.has(platform))
    const data = await generateVersions(item.id, list)
    if (data) setPicked(new Set())
  }
  const missingCore = CORE_PLATFORMS.filter(p => versions[p]?.status !== 'done')
  const runCoreBundle = async () => {
    const targets = missingCore.length ? missingCore : CORE_PLATFORMS
    const data = await generateVersions(item.id, targets)
    if (data) setPicked(new Set())
  }
  const pickCore = () => setPicked(new Set(CORE_PLATFORMS))
  const sourceHtml = React.useMemo(() => (showSource ? renderMarkdown(item.production?.article ?? '') : ''), [showSource, item.production?.article])
  return (
    <section className="md-ver">
      <div className="md-ver-pick">
        <div className="md-ver-pick-head">
          <h2>{t('平台版本')}</h2>
          <p className="md-muted">{t('按每个平台的长度、结构和语气各写一版。事实只用正文里的，不会加你没写过的经历。公众号版直接沿用正文。')}</p>
          <button type="button" className="md-pill is-small" onClick={pickCore} title={t('快速勾选公众号、小红书、视频号、知乎、X 五大主力阵地')}>
            <Icon name="target" size={13} />{t('选主力 5 平台')}
          </button>
          <button type="button" className={`md-pill is-small ${showSource ? 'is-on' : ''}`} aria-pressed={showSource} onClick={() => setShowSource(v => !v)}>
            <Icon name="eye" size={13} />{showSource ? t('收起母稿对照') : t('分栏对照母稿')}
          </button>
          <FlowStyles />
        </div>
        {/* 生成前就告诉作者：正文里有没有亲手做过的事，决定版本用哪种口吻 */}
        <HowIBadge item={item} />
        <ul className="md-ver-boxes" role="group" aria-label={t('选择平台')}>
          {PLATFORMS.map(platform => (
            <li key={platform}>
              <label className={`md-ver-box ${picked.has(platform) ? 'is-on' : ''}`} title={versions[platform]?.status === 'done' ? t('{platform}已经有版本，再勾会重新写', { platform: t(platform) }) : undefined}>
                <input type="checkbox" checked={picked.has(platform)} onChange={() => toggle(platform)} />
                <PlatformMark platform={platform} size={18} />
                <span>{t(platform)}</span>
                {versions[platform]?.status === 'done' ? <Icon name="check" size={12} /> : null}
              </label>
            </li>
          ))}
        </ul>
        <div className="md-ver-go">
          <button type="button" className="md-btn is-primary" disabled={!picked.size} onClick={start}><Icon name="spark" size={14} />{t('生成所选平台版本')}</button>
          <button type="button" className="md-btn" disabled={running} onClick={runCoreBundle} title={t('一键按各平台专属规则生成公众号、小红书、视频号、知乎、X 版本')}>
            <Icon name="bolt" size={14} />{missingCore.length && missingCore.length < CORE_PLATFORMS.length ? t('补齐主力矩阵（差 {n} 个）', { n: missingCore.length }) : t('一键出主力 5 平台')}
          </button>
          {running ? <button type="button" className="md-btn" onClick={() => cancelVersions(item.id)}>{t('全部取消')}</button> : null}
          <span className="md-muted">{picked.size ? t('已选 {n} 个平台，最多同时写 2 个', { n: picked.size }) : t('先勾选要发的平台，或直接点一键出主力 5 平台')}</span>
        </div>
      </div>
      {have.length ? (
        <div className={`md-ver-workspace ${showSource ? 'has-source' : ''}`}>
          {showSource ? (
            <aside className="md-ver-source" aria-label={t('母稿对照')}>
              <header><b>{item.production?.title || item.title}</b><span className="md-muted">{t('母稿只读对照')}</span></header>
              <div className="md-ver-source-body md-read" dangerouslySetInnerHTML={{ __html: sourceHtml }} />
            </aside>
          ) : null}
          <div className={`md-ver-grid ${have.length === 1 && !showSource ? 'is-single' : ''}`}>
            {have.map(platform => <VersionCard key={platform} item={item} platform={platform} version={versions[platform]} />)}
          </div>
        </div>
      ) : <p className="md-ver-empty">{t('还没有平台版本。勾选平台后点「生成所选平台版本」。')}</p>}
    </section>
  )
}
