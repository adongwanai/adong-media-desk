// 侧边对话：一句话改一切。解析和执行都在 Host，这里只负责展示回执。
import React from 'react'
import { cancelChat, clearChat, openItem, sendChat, setDesk, undo, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon, IconButton } from './ui.jsx'
import { renderMarkdown } from './md-render.js'

const short = title => (String(title ?? '').length > 16 ? `${String(title).slice(0, 16)}…` : String(title ?? ''))

let lastSuggest = { key: '', value: [] }
/**
 * 助手栏下面的几句提示：只放通用的动作，或者从你自己的内容里来的（最新一条还没写的灵感、写好了还没排期的一篇）。
 * 不放编出来的示例句子。结果按内容缓存，免得每次状态变化都换一个新数组。
 */
function dockSuggestions(state) {
  const mine = (state?.items ?? []).filter(item => !item.sample && !item.parentId)
  const newest = list => [...list].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
  const idea = newest(mine.filter(item => item.status === 'idea' && !item.imported && !item.production))
  const done = newest(mine.filter(item => item.production?.status === 'done' && !item.scheduledAt && item.status !== 'published'))
  const value = [
    idea ? t('把《{title}》成稿', { title: short(idea.title) }) : null,
    done ? t('讨论《{title}》的改进方向', { title: short(done.production.title || done.title) }) : null,
    t('帮我梳理接下来值得写的选题'),
  ].filter(Boolean)
  const key = value.join('\n')
  if (key !== lastSuggest.key) lastSuggest = { key, value }
  return lastSuggest.value
}

function Receipt({ receipt }) {
  const clickable = receipt.kind === 'item' && receipt.target
  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag type={clickable ? 'button' : undefined} className="md-receipt" onClick={clickable ? () => openItem(receipt.target) : undefined}>
      <span className="md-receipt-check"><Icon name="check" size={11} stroke={2.2} /></span>
      <span>{receipt.text}</span>
    </Tag>
  )
}

function Activity({ rows, active = false }) {
  if (!rows?.length) return null
  return <details className="md-agent-activity" open={active || undefined}><summary>运行过程 · {rows.length} 次工具调用</summary>{rows.map((row, index) => <details key={row.id || index}><summary>{row.status === 'running' ? '执行中' : row.status === 'failed' ? '失败' : '完成'} · {row.name}</summary><pre>{row.detail}</pre></details>)}</details>
}

function Reasoning({ text, active = false }) {
  if (!text) return null
  return <details className="md-agent-activity md-agent-reasoning" open={active || undefined}><summary>{active ? 'DSH 正在思考' : 'DSH 思考过程'}</summary><pre>{text}</pre></details>
}

function RunStatus({ progress, itemId }) {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const phase = { connecting: '正在连接 DSH', waiting: '等待 DSH 响应', reasoning: 'DSH 正在思考', writing: 'DSH 正在输出', tool: 'DSH 正在调用工具' }[progress?.phase] ?? '等待 DSH 响应'
  const seconds = Math.max(0, Math.floor((now - (progress?.startedAt ?? now)) / 1000))
  return <div className="md-agent-status" role="status"><span>{phase} · {seconds} 秒</span><button type="button" onClick={() => cancelChat(itemId)}>停止</button></div>
}

// Completed and streaming replies use the same safe Markdown renderer.
const ReplyBody = React.memo(function ReplyBody({ text, streaming = false }) {
  const html = React.useMemo(() => renderMarkdown(text), [text])
  return <div className={`md-chat-reply${streaming ? ' is-streaming' : ''}`}><div className="md-read" dangerouslySetInnerHTML={{ __html: html }} />{streaming ? <span className="md-caret" aria-hidden="true" /> : null}</div>
})

function Message({ message, canUndoThis }) {
  if (message.role === 'user') return <div className="md-msg is-user">{message.text}</div>
  return (
    <div className="md-msg is-bot">
      <Reasoning text={message.reasoning} />
      <ReplyBody text={message.text} />
      <Activity rows={message.activity} />
      {message.receipts?.map((receipt, index) => <Receipt key={index} receipt={receipt} />)}
      {message.errors?.map((error, index) => <p key={index} className="md-msg-error">{error}</p>)}
      {message.notice ? <p className="md-msg-note">{message.notice}</p> : null}
      <footer>
        <span>{message.engine === 'local' ? t('未连接 DSH') : message.engine === 'DSH 原生 Agent' ? message.engine : ''}</span>
        {canUndoThis ? <button type="button" onClick={undo}><Icon name="undo" size={12} />{t('撤销')}</button> : null}
      </footer>
    </div>
  )
}

/** 对话面板：首页的助手和成稿工作区共用。每条灵感有自己的对话。 */
export function ChatPanel({ itemId, head, top = null, suggestions, placeholder, disabled = false, intro = true }) {
  const connected = useDesk(s => s.nativeAgent === true)
  disabled = disabled || !connected
  const all = useDesk(s => s.state.chat)
  const chat = React.useMemo(() => all.filter(m => (m.itemId ?? null) === (itemId ?? null)), [all, itemId])
  const thinking = useDesk(s => (s.thinking && (s.chatItemId ?? null) === (itemId ?? null)) || Boolean(itemId && s.live[itemId]?.native))
  const chatLive = useDesk(s => (s.chatItemId ?? null) === (itemId ?? null) && s.thinking ? s.chatLive : s.live[itemId]?.reply)
  const activity = useDesk(s => (s.chatItemId ?? null) === (itemId ?? null) && s.thinking ? s.chatActivity : s.live[itemId]?.activity)
  const reasoning = useDesk(s => (s.chatItemId ?? null) === (itemId ?? null) && s.thinking ? s.chatReasoning : s.live[itemId]?.reasoning)
  const progress = useDesk(s => (s.chatItemId ?? null) === (itemId ?? null) && s.thinking ? s.chatProgress : s.live[itemId])
  const quote = useDesk(s => s.chatQuote)
  const [text, setText] = React.useState('')
  const scroller = React.useRef(null)
  const followReply = React.useRef(true)
  const input = React.useRef(null)

  React.useLayoutEffect(() => {
    if (followReply.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [chat.length, thinking, chatLive, reasoning, activity?.length])
  React.useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])
  React.useEffect(() => {
    if (quote) input.current?.focus()
  }, [quote])

  const send = (value) => {
    const message = (value ?? text).trim()
    if (!message || thinking || disabled) return
    followReply.current = true
    setText('')
    sendChat(message, { itemId })
  }
  const lastBot = [...chat].reverse().find(m => m.role === 'assistant')

  return (
    <div className="md-chat">
      <header className="md-dock-head" data-window-drag="">{head}</header>
      <div className="md-dock-scroll" ref={scroller} aria-live="polite" onScroll={event => {
        const el = event.currentTarget
        followReply.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
      }}>
        {!connected ? <p className="md-model-alert" role="status">未连接 DSH 原生 Agent。请在本地 DSH 中打开工作台，独立预览不支持对话。</p> : null}
        {top}
        {chat.length === 0 && intro ? (
          <div className="md-dock-intro">
            <h3>{t('说一句话，')}<br />{t('剩下的我来补全。')}</h3>
            <p>{t('直接讨论选题、查资料或修改稿件。对话由 DSH 原生 Agent 执行，连续交流保留上下文。')}</p>
          </div>
        ) : chat.map(message => <Message key={message.id} message={message} canUndoThis={message === lastBot && message.undoable} />)}
        {thinking ? <div className="md-msg is-bot is-live"><RunStatus progress={progress} itemId={itemId} /><Reasoning text={reasoning} active={progress?.phase === 'reasoning'} />{chatLive ? <ReplyBody text={chatLive} streaming /> : null}<Activity rows={activity} active /></div> : null}
      </div>
      {suggestions?.length ? (
        <div className="md-suggest" aria-label={t('试试这样说')}>
          {suggestions.slice(0, chat.length ? 2 : 4).map(row => <button type="button" key={row} title={row} onClick={() => send(row)} disabled={thinking || disabled}>{row}</button>)}
        </div>
      ) : null}
      <form className="md-composer" onSubmit={(event) => { event.preventDefault(); send() }}>
        {quote ? (
          <div className="md-composer-ctx">
            <Icon name="target" size={12} />
            <span>{quote.text ? t('{label}：{text}', { label: quote.label, text: quote.text }) : quote.label}</span>
            <button type="button" aria-label={t('取消引用')} onClick={() => setDesk({ chatQuote: null })}><Icon name="close" size={11} /></button>
          </div>
        ) : null}
        <textarea
          ref={input}
          rows={1}
          aria-label={t('给助手发消息')}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => setText(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button type="submit" className="md-send" aria-label={t('发送')} disabled={!text.trim() || thinking || disabled}><Icon name="send" size={15} /></button>
      </form>
    </div>
  )
}

export function ChatDock() {
  const connected = useDesk(s => s.nativeAgent === true)
  const itemId = useDesk(s => s.view === 'video' ? s.videoChatItemId : null)
  const hasChat = useDesk(s => s.state.chat.some(m => (m.itemId ?? null) === (itemId ?? null)))
  const suggestions = useDesk(s => dockSuggestions(s.state))
  return (
    <aside className="md-dock" aria-label={t('对话助手')}>
      <ChatPanel
        itemId={itemId}
        head={(
          <>
            <h2>{t('助手')}</h2>
            <span className={`md-engine ${connected ? 'is-live' : ''}`} title={connected ? '使用本地 DSH 原生 Agent，保留连续会话上下文' : '请在本地 DSH 中打开工作台'}>
              <i />{connected ? 'DSH 原生 Agent' : t('未连接 DSH')}
            </span>
            <span style={{ flex: 1 }} />
            {hasChat ? <IconButton icon="refresh" label={t('清空对话')} onClick={() => clearChat(itemId)} /> : null}
            <IconButton icon="close" label={t('收起对话')} onClick={() => setDesk({ dockOpen: false })} />
          </>
        )}
        suggestions={suggestions}
        placeholder={t('想改什么，直接说')}
      />
    </aside>
  )
}
