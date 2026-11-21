import React from 'react'
import { dispatchOps, sendChat, setDesk, toast, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { useArticleDraft } from './layouts/split.jsx'
import { clampRate, DEFAULT_RATE, fmtClock, formatSpokenBreathLines, scriptOf, scriptTiming } from './video/captions.js'
import { readPref, writePref } from './video/prompter.js'
import { ConvertCard } from './video/script.jsx'
import { useStreamText } from './use-stream-text.js'

const QUICK_TARGETS = [
  { sec: 60, label: '60s 短口播' },
  { sec: 90, label: '90s 标准' },
  { sec: 180, label: '3min 干货' },
  { sec: 300, label: '5min 深度' },
]

/** 原正文和口播内容分别保存；视频页读取同一条内容的 spoken，支持一键气口断句、口语化精修与直达提词器开录。 */
export function SpokenContent({ item }) {
  const script = scriptOf(item.production)
  const live = useDesk(s => s.live[item.id]?.drafts?.spoken)
  const generating = useDesk(s => (s.thinking && s.chatItemId === item.id) || Boolean(s.live[item.id]?.native))
  const connected = useDesk(s => s.nativeAgent === true)
  const streamed = useStreamText(live?.text ?? '', Boolean(live))
  const [manual, setManual] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [rate, setRateState] = React.useState(() => clampRate(readPref('rate', DEFAULT_RATE)))
  const [target, setTargetState] = React.useState(() => {
    const saved = Number(readPref('target', 90))
    return QUICK_TARGETS.some(row => row.sec === saved) ? saved : 90
  })
  const [prevBreath, setPrevBreath] = React.useState(null)
  const areaRef = React.useRef(null)
  const queue = React.useRef(Promise.resolve())

  const setRate = (val) => {
    const next = clampRate(val)
    setRateState(next)
    writePref('rate', next)
  }
  const setTarget = (sec) => {
    setTargetState(sec)
    writePref('target', sec)
  }

  const save = React.useCallback(text => {
    const next = queue.current.then(async () => {
      const result = await dispatchOps([{ op: 'update_video', id: item.id, spoken: text }], { silent: true })
      return Boolean(result && !result.errors?.length)
    })
    queue.current = next.catch(() => false)
    return next
  }, [item.id])

  const draft = useArticleDraft(script, save)
  const activeText = live ? streamed : draft.text
  const timing = React.useMemo(() => scriptTiming(activeText, rate), [activeText, rate])
  const spokenRows = React.useMemo(() => timing.lines.filter(row => row.spoken), [timing.lines])
  const longCount = React.useMemo(() => spokenRows.filter(row => row.units > 28).length, [spokenRows])
  const digitCount = React.useMemo(() => spokenRows.filter(row => /\d/.test(row.text)).length, [spokenRows])
  const takesCount = (item.production?.takes ?? []).filter(row => row.kind !== 'render').length

  const goVideo = async (step = 'record') => {
    setBusy(true)
    try {
      if (!draft.text.trim() || await save(draft.text)) {
        setDesk({ focusId: null, view: 'video', videoFocusId: item.id, videoStep: step })
      }
    } finally {
      setBusy(false)
    }
  }

  const applyBreathSplit = () => {
    const formatted = formatSpokenBreathLines(draft.text, { maxUnits: 26 })
    if (!formatted || formatted === draft.text) {
      toast(t('当前已经是清晰的短句气口格式'))
      return
    }
    setPrevBreath(draft.text)
    draft.setText(formatted)
    toast(t('已按提词气口自动断句并清理书面符号'))
  }

  const undoBreathSplit = () => {
    if (prevBreath === null) return
    draft.setText(prevBreath)
    setPrevBreath(null)
  }

  const runSpokenPrompt = async (prompt) => {
    if (generating || !connected) {
      if (!connected) toast(t('当前未连接本地工作台，暂无法使用 AI 口播改写'), { error: true })
      return
    }
    await save(draft.text)
    setDesk({ studioDock: true, chatQuote: null })
    await sendChat(prompt, { itemId: item.id, outputKind: 'spoken' })
  }

  const focusLine = (lineIndex) => {
    const el = areaRef.current
    if (!el) return
    const rows = activeText.split('\n')
    const start = rows.slice(0, lineIndex).reduce((sum, r) => sum + r.length + 1, 0)
    el.focus()
    el.setSelectionRange(start, start + (rows[lineIndex]?.length ?? 0))
  }

  const diff = Math.round(timing.total - target)
  const diffTone = Math.abs(diff) <= target * 0.12 ? 'is-ok' : diff > 0 ? 'is-over' : 'is-under'
  const targetChars = Math.round(target * rate)

  return (
    <section className="md-spoken-content" aria-label={t('口播内容')}>
      {!script && !manual && !live ? (
        <ConvertCard item={item} onManual={() => setManual(true)} />
      ) : (
        <>
          <header className="md-spoken-head">
            <div className="md-spoken-status">
              <span className="md-spoken-kicker">
                <Icon name="chat" size={14} />
                <b>{live ? t('正在写入口播稿…') : t('口播提词稿')}</b>
              </span>
              <span className={`md-spoken-meter ${diffTone}`}>
                <b>{fmtClock(timing.total)}</b>
                <span>
                  {t('{n} 句', { n: timing.spokenCount })} · {Math.abs(diff) <= 3 ? t('时长刚好') : diff > 0 ? t('比目标长 {n}s', { n: diff }) : t('比目标短 {n}s', { n: -diff })}
                </span>
              </span>
              {longCount ? <span className="md-spoken-flag is-warn" title={t('超过 28 字的句子在提词器里容易一口气念不完，建议点「按气口断句」')}>{t('{n} 句偏长', { n: longCount })}</span> : null}
              {digitCount ? <span className="md-spoken-flag" title={t('建议把阿拉伯数字改成顺嘴的中文读法')}>{t('{n} 处数字', { n: digitCount })}</span> : null}
            </div>
            <div className="md-spoken-actions">
              {takesCount > 0 ? (
                <button type="button" className="md-pill is-small" disabled={busy || generating} onClick={() => goVideo('cut')}>
                  <Icon name="film" size={13} />{t('去粗剪 ({n})', { n: takesCount })}
                </button>
              ) : null}
              <button type="button" className="md-pill is-small" disabled={busy || generating || !activeText.trim()} onClick={() => goVideo('script')}>
                {t('视频工作台')}
              </button>
              <button type="button" className="md-btn is-primary" disabled={busy || generating || !activeText.trim()} onClick={() => goVideo('record')}>
                <Icon name="play" size={13} fill />{t(busy ? '正在保存…' : '打开提词器开录')}
              </button>
            </div>
          </header>

          <div className="md-spoken-Subbar">
            <div className="md-spoken-targets" role="group" aria-label={t('目标口播时长')}>
              {QUICK_TARGETS.map(opt => (
                <button
                  key={opt.sec}
                  type="button"
                  className={`md-spoken-chip ${target === opt.sec ? 'is-on' : ''}`}
                  onClick={() => setTarget(opt.sec)}
                >
                  {t(opt.label)}
                </button>
              ))}
              <label className="md-spoken-rate">
                <span>{t('语速')}</span>
                <select value={rate.toFixed(1)} onChange={e => setRate(Number(e.target.value))} aria-label={t('口播语速')}>
                  {[3.8, 4.2, 4.5, 4.8, 5.2].map(r => <option key={r} value={r.toFixed(1)}>{r.toFixed(1)} {t('字/秒')}</option>)}
                </select>
              </label>
            </div>

            <div className="md-spoken-tools">
              <button type="button" className="md-pill is-small" disabled={generating || !draft.text.trim()} onClick={applyBreathSplit} title={t('自动清掉加粗/列表符号，并把长句按逗号和句号拆成提词器好念的一句一行')}>
                <Icon name="spark" size={12} />{t('按气口断句')}
              </button>
              {prevBreath !== null ? (
                <button type="button" className="md-inline-link" onClick={undoBreathSplit}>{t('撤回断句')}</button>
              ) : null}
              <button
                type="button"
                className="md-pill is-small"
                disabled={generating || !connected || !draft.text.trim()}
                onClick={() => runSpokenPrompt('把当前口播稿顺一遍口语：去掉书面连接词和拗口长定语，改成自然聊天感的一句一行，数字改成念出来的形式，严格保留原有事实判断，直接更新口播内容。')}
              >
                {t('更口语顺嘴')}
              </button>
              <button
                type="button"
                className="md-pill is-small"
                disabled={generating || !connected || !draft.text.trim()}
                onClick={() => runSpokenPrompt(`把当前口播稿精炼控制在约 ${fmtClock(target)}（约 ${targetChars} 字，按 ${rate.toFixed(1)} 字/秒估算），保留前 3 秒钩子、核心判断与结尾收获，删掉重复铺垫，一句一行直接更新口播内容。`)}
              >
                {t('压到 {time}', { time: fmtClock(target) })}
              </button>
              <button
                type="button"
                className="md-pill is-small"
                disabled={generating || !connected || !draft.text.trim()}
                onClick={() => runSpokenPrompt('只针对当前口播稿的前 3 秒开头（前两句）重写一个更有反差感和停留率的黄金钩子，其余正文保持不变，不编造事实，直接更新口播内容。')}
              >
                {t('换前3秒钩子')}
              </button>
            </div>
          </div>

          <div className="md-spoken-grid">
            <div className="md-spoken-editor-col">
              <textarea
                ref={areaRef}
                aria-label={t('口播内容')}
                value={activeText}
                readOnly={generating}
                placeholder={t('一句一行写口播稿，空行分段，# 开头可写阶段提示（提词器不会念 # 行）…')}
                onChange={(event) => {
                  if (prevBreath !== null) setPrevBreath(null)
                  draft.setText(event.target.value)
                }}
                spellCheck={false}
              />
              <p className="md-spoken-foot-note">
                {t('口播稿与长文母稿独立保存，互不覆盖；# 开头的小标题仅作结构提示，提词器与字幕会自动跳过。')}
                {draft.status === 'error' ? <strong role="alert"> · {t('保存失败，请重试')}</strong> : null}
              </p>
            </div>

            <aside className="md-spoken-lines-col" aria-label={t('逐句气口预览')}>
              <header>
                <b>{t('提词气口与逐句秒数')}</b>
                <span>{t('点句子定位编辑')}</span>
              </header>
              {spokenRows.length ? (
                <ol className="md-spoken-line-list">
                  {spokenRows.map(row => (
                    <li key={row.index} className={row.units > 28 ? 'is-long' : ''}>
                      <button type="button" onClick={() => focusLine(row.index)}>
                        <span className="md-spoken-line-txt">{row.text}</span>
                        <span className="md-spoken-line-meta">
                          {row.units > 28 ? <em>{t('偏长')}</em> : null}
                          {/\d/.test(row.text) ? <em className="is-num">{t('数字')}</em> : null}
                          <b>{row.seconds.toFixed(1)}s</b>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="md-spoken-empty">{t('写下第一句口播后，这里实时测算每句气口长度与累计读秒。')}</p>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  )
}
