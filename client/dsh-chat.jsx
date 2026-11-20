// 交给 DSH 助手继续改：成稿之后，一键开一个真正的 DSH 会话，把稿子、素材和写作要求带进对话。
// 有人值守：会话就在用户自己的 DSH 里，权限弹窗由他自己点。这里只负责带资料进去、把改好的取回来预览。
import React from 'react'
import { hostRequest, report, setDesk, toast } from './desk.js'
import { t } from './i18n.js'
import { renderMarkdown } from './md-render.js'
import { Dialog, Icon } from './ui.jsx'
/** 会话服务在不在，一次问清，按钮据此显示或藏起来。 */
function useBridge() {
  const [state, setState] = React.useState({ known: false, ready: false, reason: '' })
  React.useEffect(() => {
    let alive = true
    hostRequest('dsh-chat/ready').then(data => {
      if (alive) setState({ known: true, ready: Boolean(data?.ready), reason: data?.reason ?? '' })
    }).catch(() => { if (alive) setState({ known: true, ready: false, reason: t('读不到会话服务') }) })
    return () => { alive = false }
  }, [])
  return state
}

function CopyId({ value }) {
  const [done, setDone] = React.useState(false)
  return (
    <button type="button" className="md-pill is-small" onClick={async () => {
      await navigator.clipboard.writeText(value)
      setDone(true)
      toast(t('会话 id 已复制'))
    }}>
      <Icon name={done ? 'check' : 'copy'} size={13} />{done ? t('已复制') : t('复制会话 id')}
    </button>
  )
}

/** 取回后的变化预览：按行标出新增和删掉的地方，原样渲染 Markdown 的段落就能看出改了什么。 */
function DiffView({ diff, text, plain }) {
  const rows = diff?.rows ?? []
  if (plain) {
    return <div className="md-dshchat-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { missingImage: t('本地图片，预览里看不到') }) }} />
  }
  return (
    <div className="md-dshchat-diff">
      {rows.map((row, index) => (
        <p key={index} className={`is-${row.type}`}>{row.type === 'add' ? '+ ' : row.type === 'del' ? '− ' : '  '}{row.text}</p>
      ))}
      {diff?.truncated ? <p className="md-dshchat-more">{t('变化太多，这里只显示前 {n} 行', { n: rows.length })}</p> : null}
    </div>
  )
}

/** 弹窗的三种状态：确认带什么过去、开好之后怎么进会话、取回后要不要写回。 */
function BridgeDialog({ item, onClose }) {
  const production = item.production
  const [note, setNote] = React.useState('')
  const [stage, setStage] = React.useState('confirm')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [session, setSession] = React.useState(null)
  const [preview, setPreview] = React.useState(null)
  const [pulled, setPulled] = React.useState(null)
  const [plain, setPlain] = React.useState(false)

  // 打开弹窗先算一遍摘要：字数、素材份数，让用户知道要带走什么。这篇已经开过会话时直接停在「取回修改」
  React.useEffect(() => {
    let alive = true
    hostRequest('dsh-chat/preview', { itemId: item.id }).then((data) => {
      if (!alive) return
      setPreview(data)
      if (data?.linked?.sessionId) {
        setSession({ sessionId: data.linked.sessionId, hint: data.hint })
        setStage('opened')
      }
    }).catch(err => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [item.id])

  const open = async () => {
    setBusy(true)
    setError('')
    try {
      const data = await hostRequest('dsh-chat/open', { itemId: item.id, note })
      setSession(data)
      setStage('opened')
      toast(t('会话开好了，去 DSH 里接着聊'))
    } catch (err) {
      // 失败说清楚卡在哪一步，不假装成功
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const pull = async () => {
    setBusy(true)
    setError('')
    try {
      const data = await hostRequest('dsh-chat/pull', { itemId: item.id, sessionId: session?.sessionId })
      setPulled(data)
      setStage('pulled')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const writeBack = async (heading) => {
    setBusy(true)
    try {
      const data = await hostRequest('dsh-chat/write', { itemId: item.id, reply: pulled.text, heading: heading || undefined })
      // 写回走的是一次可撤销的 mutate，界面跟着换成新状态
      setDesk({ state: data.state, canUndo: true })
      toast(heading ? t('这一节已经换成助手写的版本') : t('正文已更新'))
      onClose()
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={t('交给 DSH 助手')} onClose={onClose} width={560}>
      {stage === 'confirm' ? (
        <div className="md-dshchat">
          <p className="md-dshchat-lead">{t('会在你的 DSH 里开一个新会话，把这些带进去：')}</p>
          <ul className="md-dshchat-list">
            <li><Icon name="fileText" size={13} />{t('稿子全文：{title}，约 {n} 字', { title: production?.title || item.title, n: (preview?.words ?? 0).toLocaleString() })}</li>
            <li><Icon name="folder" size={13} />{t('素材 {n} 份，加上灵感和写作要求', { n: preview?.materials ?? 0 })}</li>
          </ul>
          <label className="md-dshchat-field">
            <span>{t('这次想改什么（可以不填）')}</span>
            <textarea value={note} rows={3} placeholder={t('比如：开头再抓人一点，第三节太散了')} onChange={e => setNote(e.target.value)} />
          </label>
          <p className="md-dshchat-hint">{t('会话是有人值守的：打开的是你自己的 DSH，权限弹窗你自己点，工作台不会替你确认任何权限。')}</p>
          {error ? <p className="md-dshchat-error">{error}</p> : null}
          <div className="md-dshchat-actions">
            <button type="button" className="md-pill is-quiet" onClick={onClose}>{t('取消')}</button>
            <button type="button" className="md-pill is-primary" disabled={busy} onClick={open}>
              <Icon name="bot" size={14} />{busy ? t('正在开会话…') : t('开会话并把稿子带过去')}
            </button>
          </div>
        </div>
      ) : null}
      {stage === 'opened' || stage === 'pulled' ? (
        <div className="md-dshchat">
          <p className="md-dshchat-lead">{t('会话已经开好了：{id}', { id: session?.sessionId ?? '' })}</p>
          <p className="md-dshchat-hint">{session?.hint}</p>
          <div className="md-dshchat-actions">
            <CopyId value={session?.sessionId ?? ''} />
            <button type="button" className="md-pill is-small is-quiet" disabled={busy} onClick={() => { setSession(null); setPulled(null); setError(''); setStage('confirm') }}>{t('再开一个新会话')}</button>
            <span className="md-grow" />
            <button type="button" className="md-pill" disabled={busy} onClick={pull}><Icon name="refresh" size={13} />{busy ? t('正在取回…') : t('取回修改')}</button>
          </div>
          {error ? <p className="md-dshchat-error">{error}</p> : null}
        </div>
      ) : null}
      {stage === 'pulled' && pulled ? (
        <div className="md-dshchat">
          <p className="md-dshchat-lead">{t('取回了最新一条回复，约 {n} 字。先看预览，不会自动覆盖正文。', { n: pulled.words.toLocaleString() })}</p>
          {pulled.status === 'running' ? <p className="md-dshchat-hint">{t('助手还在写新的一条；这里是上一条已经写完的回复，等它写完可以再取一次。')}</p> : null}
          {pulled.status === 'waiting' ? <p className="md-dshchat-hint">{t('助手在等你在 DSH 里确认；这里是上一条已经写完的回复。')}</p> : null}
          {pulled.same ? <p className="md-dshchat-hint">{t('和现在的正文一模一样，没有什么要写回的。')}</p> : (
            <div className="md-dshchat-preview">
              <div className="md-dshchat-preview-head">
                <span>{t('+{add} 行，−{del} 行', { add: pulled.diff.added, del: pulled.diff.removed })}</span>
                <span className="md-grow" />
                <button type="button" className="md-pill is-small is-quiet" onClick={() => setPlain(v => !v)}>{plain ? t('看变化') : t('看整篇')}</button>
              </div>
              <DiffView diff={pulled.diff} text={pulled.text} plain={plain} />
            </div>
          )}
          {pulled.sections?.length ? (
            <label className="md-dshchat-field">
              <span>{t('只取某一节')}</span>
              <select value="" onChange={(event) => { const heading = event.target.value; if (heading) writeBack(heading) }}>
                <option value="">{t('选一个小标题，只替换这一节')}</option>
                {pulled.sections.map(row => <option key={row.heading} value={row.heading}>{row.heading}</option>)}
              </select>
            </label>
          ) : null}
          <div className="md-dshchat-actions">
            <button type="button" className="md-pill is-quiet" onClick={onClose}>{t('先不写回')}</button>
            <span className="md-grow" />
            <button type="button" className="md-pill is-primary" disabled={busy || pulled.same} onClick={() => writeBack(null)}><Icon name="check" size={14} />{t('替换整篇正文')}</button>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

/** 成稿页工具行上的入口：会话服务不可用时整个按钮不出现，不报错。 */
export function DshChatButton({ item }) {
  const bridge = useBridge()
  const [open, setOpen] = React.useState(false)
  if (!bridge.known || !bridge.ready) return null
  return (
    <>
      <button type="button" className="md-pill" onClick={() => setOpen(true)} title={t('开一个 DSH 会话，带着稿子和素材接着聊')}>
        <Icon name="bot" size={14} />{t('交给 DSH 助手')}
      </button>
      {open ? <BridgeDialog item={item} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
