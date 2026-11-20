// 口播稿：可改的稿子、逐句时长、语速和目标时长、三个备选开头、分镜秒数核对。
import React from 'react'
import { dispatchOps, getDesk, hostRequest, report, sendChat, setDesk, useDesk } from '../desk.js'
import { t } from '../i18n.js'
import { Icon, Swap } from '../ui.jsx'
import { useStreamText } from '../use-stream-text.js'
import { fmtClock, lineSeconds, MAX_RATE, MIN_RATE, replaceOpening, scriptTiming, spreadSeconds } from './captions.js'

export const TARGETS = [30, 60, 90, 120, 180, 300]

function saveSpoken(id, text, label = t('修改口播稿')) {
  return dispatchOps([{ op: 'update_video', id, spoken: text }], { label, silent: true })
}

/** 总时长对目标：差 10% 以内算刚好。 */
function Meter({ total, target }) {
  const diff = total - target
  const tone = Math.abs(diff) <= target * 0.1 ? 'is-ok' : diff > 0 ? 'is-over' : 'is-under'
  const said = Math.abs(diff) < 1 ? t('刚好') : diff > 0 ? t('比目标长 {n} 秒', { n: Math.round(diff) }) : t('比目标短 {n} 秒', { n: Math.round(-diff) })
  return (
    <div className={`md-vd-meter ${tone}`}>
      <div className="md-vd-meter-text"><b>{fmtClock(total)}</b><span>{t('目标 {time}', { time: fmtClock(target) })} · {said}</span></div>
      <div className="md-vd-meter-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (total / Math.max(1, target)) * 100)}%` }} /><em style={{ left: `${Math.min(100, (target / Math.max(total, target, 1)) * 100)}%` }} /></div>
    </div>
  )
}

export function RateControl({ rate, setRate, target, setTarget }) {
  return (
    <div className="md-vd-controls">
      <label className="md-vd-range is-wide">
        <span>{t('语速')}</span>
        <input type="range" min={MIN_RATE} max={MAX_RATE} step="0.1" value={rate} onChange={e => setRate(Number(e.target.value))} aria-label={t('语速')} />
        <b>{t('{rate} 字/秒', { rate: rate.toFixed(1) })}</b>
      </label>
      {setTarget ? (
        <label className="md-vd-check">{t('目标时长')}
          <select value={target} onChange={e => setTarget(Number(e.target.value))}>{TARGETS.map(n => <option key={n} value={n}>{fmtClock(n)}</option>)}</select>
        </label>
      ) : null}
    </div>
  )
}

/** 按钮只是当前稿件原生对话的快捷指令，沿用会话与运行过程。 */
export function ConvertCard({ item, onManual }) {
  const busy = useDesk(s => s.thinking || Boolean(s.live[item.id]?.native))
  const connected = useDesk(s => s.nativeAgent === true)
  const live = useDesk(s => s.live[item.id]?.drafts?.spoken)
  const streamed = useStreamText(live?.text ?? '', Boolean(live))
  const settings = useDesk(s => s.settings)
  const activeStyleId = useDesk(s => s.state.activeStyleId)
  const convert = async () => {
    if (busy || !connected) return
    setDesk({ studioDock: true, chatQuote: null, ...(getDesk().view === 'video' ? { dockOpen: true, videoChatItemId: item.id } : {}) })
    await sendChat('把当前正文改写成可以直接念的完整口播稿，单独写入口播内容，保留原正文。沿用当前风格和这篇稿子的对话上下文，按需参考已选方法和原生 Skills，做好开头、个人判断与观众能带走的收获。事实和数字以原稿及核验来源为准，不编造经历；可以基于材料展开有依据的判断，不把推测写成事实。按意思分段，段内一句一行，数字写成念出来的形式。口播内只放能念的内容；标题候选和参考说明放在左侧对话。直接完成改写。', { itemId: item.id, outputKind: 'spoken' })
  }
  return (
    <section className="md-vd-card md-vd-hero">
      <Icon name="pen" size={26} />
      <h3>{t('这篇是按「文章」写的，先改写成口播稿')}</h3>
      <p>{t('由 DSH 原生 Agent 改写：事实和数字只用原稿里的，按段落分组、段内一句一行，不写动作提示，数字写成念出来的样子。改写时按你在设置里选的风格和写作工作流来写，改写后可以逐句修改。')}</p>
      <div className="md-vd-row is-center">
        <button type="button" className="md-btn is-primary is-big" disabled={busy || !connected} onClick={convert}><Icon name="spark" size={16} />{busy ? t('DSH 正在改写…') : t('改写成口播稿')}</button>
        <button type="button" className="md-btn" disabled={busy} onClick={onManual}>{t('我自己写')}</button>
      </div>
      {live ? <textarea className="md-vd-script" aria-label={t('口播稿')} value={streamed} readOnly spellCheck={false} /> : null}
      {!settings?.writingFlow?.paths?.length && !activeStyleId ? <p className="md-vd-meta">{t('还没选风格和工作流：到「设置」里选几份自己的稿子或写作方法，改写会更像你。')}</p> : null}
    </section>
  )
}

function Openings({ item, draft, spokenCount, onPick }) {
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const count = Math.min(2, Math.max(1, spokenCount))
  const run = async () => {
    setBusy(true)
    try {
      setResult(await hostRequest('video/openings', { id: item.id, script: draft, count }))
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="md-vd-card">
      <header className="md-vd-card-head">
        <h3>{t('换个开头')}</h3>
        <span className="md-vd-meta">{t('建议，不会自动替换；选中的会换掉前 {n} 句', { n: result?.count ?? count })}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="md-btn" disabled={busy || !spokenCount} onClick={run}><Icon name="spark" size={14} /><Swap labels={[t('生成 3 个开头'), t('再来 3 个'), t('正在想…')]} at={busy ? 2 : result ? 1 : 0} /></button>
      </header>
      {result ? (
        <div className="md-vd-openings">
          {result.openings.map((opening, i) => (
            <article key={i} className="md-vd-opening">
              <span className="md-vd-tag">{t('建议 {n}', { n: i + 1 })}{opening.angle ? ` · ${opening.angle}` : ''}</span>
              {opening.lines.map((line, j) => <p key={j}>{line}</p>)}
              <button type="button" className="md-btn is-small" onClick={() => onPick(opening.lines, result.count)}>{t('用这个开头')}</button>
            </article>
          ))}
        </div>
      ) : <p className="md-vd-empty-line">{t('开头决定前三秒有没有人划走。这里给三个不同思路的写法，只用稿子里已有的事实。')}</p>}
    </section>
  )
}

/** 分镜：每镜的秒数要和口播稿的总时长对得上。 */
function Storyboard({ item, total, rate }) {
  const shots = item.production.shots ?? []
  const [values, setValues] = React.useState(() => shots.map(shot => shot.seconds ?? 0))
  React.useEffect(() => setValues(shots.map(shot => shot.seconds ?? 0)), [shots])
  if (!shots.length) return null
  const estimates = shots.map(shot => lineSeconds(shot.voice ?? '', rate))
  const sum = values.reduce((a, b) => a + (Number(b) || 0), 0)
  const diff = sum - total
  const commit = (next) => {
    if (next.every((v, i) => v === (shots[i].seconds ?? 0))) return
    dispatchOps([{ op: 'update_video', id: item.id, shotSeconds: next.map(v => Number(v) || 1) }], { label: t('修改分镜秒数'), silent: true })
  }
  return (
    <section className="md-vd-card">
      <header className="md-vd-card-head">
        <h3>{t('分镜头脚本')}</h3>
        <span className={`md-vd-meta ${Math.abs(diff) > 2 ? 'is-warn' : 'is-ok'}`}>{t('分镜合计 {sum} 秒 · 口播稿约 {total} 秒 · {diff}', { sum, total: Math.round(total), diff: Math.abs(diff) < 1 ? t('对得上') : diff > 0 ? t('多 {n} 秒', { n: Math.round(diff) }) : t('少 {n} 秒', { n: Math.round(-diff) }) })}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="md-btn is-small" onClick={() => commit(spreadSeconds(estimates, total))}>{t('按口播稿重新分配秒数')}</button>
      </header>
      <div className="md-vd-table-wrap">
        <table className="md-vd-table">
          <thead><tr><th>{t('镜')}</th><th>{t('景别')}</th><th>{t('画面')}</th><th>{t('口播')}</th><th className="is-num">{t('按语速估')}</th><th className="is-num">{t('秒数')}</th></tr></thead>
          <tbody>
            {shots.map((shot, i) => (
              <tr key={i}>
                <td>{String(shot.no ?? i + 1).padStart(2, '0')}</td>
                <td>{shot.shot ? t(shot.shot) : ''}</td>
                <td>{shot.visual}</td>
                <td>{shot.voice}</td>
                <td className="is-num">{estimates[i].toFixed(1)}</td>
                <td className="is-num"><input type="number" min="1" max="120" value={values[i]} aria-label={t('第 {n} 镜秒数', { n: i + 1 })} onChange={e => setValues(v => v.map((x, k) => (k === i ? e.target.value : x)))} onBlur={() => commit(values.map(v => Math.max(1, Math.min(120, Math.round(Number(v) || 1)))))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ScriptTab({ item, script, rate, setRate, target, setTarget, onNext }) {
  const [draft, setDraft] = React.useState(script)
  const [manual, setManual] = React.useState(false)
  const [undoText, setUndoText] = React.useState(null)
  const area = React.useRef(null)
  const latest = React.useRef({ draft, script })
  latest.current = { draft, script }
  const dirty = draft !== script
  // 外面改了（撤销、改写完成）而这里没有未保存的改动时，跟着换
  React.useEffect(() => { setDraft(script) }, [script])
  // 切走时把没保存的改动存上
  React.useEffect(() => () => {
    const { draft: text, script: saved } = latest.current
    if (text !== saved && text.trim()) saveSpoken(item.id, text)
  }, [item.id])
  const timing = React.useMemo(() => scriptTiming(draft, rate), [draft, rate])
  const [saving, setSaving] = React.useState(false)
  const save = async () => {
    if (!dirty) return true
    const result = await saveSpoken(item.id, draft)
    return Boolean(result && !result.errors?.length)
  }
  const next = async () => {
    setSaving(true)
    try { if (await save()) onNext() } finally { setSaving(false) }
  }

  if (!script && !manual && item.production.format === 'article') return <ConvertCard item={item} onManual={() => setManual(true)} />

  const pick = (lines, count) => {
    const next = replaceOpening(draft, lines, count)
    setUndoText(draft)
    setDraft(next)
    saveSpoken(item.id, next, t('换开头'))
  }
  const restore = () => {
    setDraft(undoText)
    saveSpoken(item.id, undoText, t('撤销换开头'))
    setUndoText(null)
  }
  // 点右边某一句，在稿子里选中它
  const focusLine = (index) => {
    const el = area.current
    if (!el) return
    const rows = draft.split('\n')
    const start = rows.slice(0, index).reduce((n, row) => n + row.length + 1, 0)
    el.focus()
    el.setSelectionRange(start, start + rows[index].length)
  }
  const digits = timing.lines.filter(row => row.spoken && /\d/.test(row.text)).length
  const spoken = timing.lines.filter(row => row.spoken)
  return (
    <div className="md-vd-stack">
      <section className="md-vd-card">
        <div className="md-vd-toolbar">
          <RateControl rate={rate} setRate={setRate} target={target} setTarget={setTarget} />
          <Meter total={timing.total} target={target} />
        </div>
      </section>
      {undoText !== null ? <p className="md-vd-alert is-info">{t('已换上新开头。')}<button type="button" className="md-link-btn" onClick={restore}>{t('换回原来的')}</button></p> : null}
      <div className="md-vd-split">
        <section className="md-vd-card md-vd-editor">
          <header className="md-vd-card-head">
            <h3>{t('口播稿')}</h3>
            <span className="md-vd-meta">{t('{n} 句 · 一段一起念，段内一句一行，空行分段，# 开头的行不念', { n: timing.spokenCount })}</span>
            <span style={{ flex: 1 }} />
            {dirty ? <button type="button" className="md-btn is-small" onClick={save}><Icon name="check" size={13} />{t('保存')}</button> : <span className="md-vd-meta">{t('已保存')}</span>}
          </header>
          <textarea ref={area} className="md-vd-script" value={draft} spellCheck={false} aria-label={t('口播稿')} placeholder={t('一句话一行。写好后在右边看每句要念多久。')} onChange={e => setDraft(e.target.value)} onBlur={save} />
          {item.production.spoken && item.production.format === 'article' ? <p className="md-vd-meta">{t('这是从文章改写来的口播稿，改这里不会动原文。')}</p> : null}
        </section>
        <section className="md-vd-card md-vd-lines">
          <header className="md-vd-card-head">
            <h3>{t('逐句时长')}</h3>
            {digits ? <span className="md-vd-meta is-warn">{t('{n} 句有阿拉伯数字，确认怎么念', { n: digits })}</span> : null}
          </header>
          {spoken.length ? (
            <ol className="md-vd-linelist">
              {spoken.map(row => (
                <li key={row.index}>
                  <button type="button" onClick={() => focusLine(row.index)}>
                    <span className="md-vd-line-text">{row.text}</span>
                    <span className="md-vd-line-meta">
                      {row.units > 30 ? <em className="is-warn">{t('偏长')}</em> : null}
                      {/\d/.test(row.text) ? <em className="is-warn">{t('数字')}</em> : null}
                      <b>{row.seconds.toFixed(1)}s</b>
                      <small>{fmtClock(row.start + row.seconds)}</small>
                    </span>
                    <i style={{ width: `${Math.min(100, (row.seconds / 10) * 100)}%` }} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="md-vd-empty-line">{t('左边写下第一句，这里会算出每句要念多久。')}</p>}
        </section>
      </div>
      <Openings item={item} draft={draft} spokenCount={timing.spokenCount} onPick={pick} />
      <Storyboard item={item} total={timing.total} rate={rate} />
      {timing.spokenCount ? (
        <div className="md-vd-next">
          <button type="button" className="md-btn is-primary is-big" disabled={saving} onClick={next}>{t('下一步：提词 + 录制')}<Icon name="chevR" size={16} /></button>
        </div>
      ) : null}
    </div>
  )
}
