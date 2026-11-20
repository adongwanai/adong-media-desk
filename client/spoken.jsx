import React from 'react'
import { dispatchOps, setDesk, useDesk } from './desk.js'
import { t } from './i18n.js'
import { useArticleDraft } from './layouts/split.jsx'
import { scriptOf } from './video/captions.js'
import { ConvertCard } from './video/script.jsx'
import { useStreamText } from './use-stream-text.js'

/** 原正文和口播内容分别保存；视频页读取同一条内容的 spoken。 */
export function SpokenContent({ item }) {
  const script = scriptOf(item.production)
  const live = useDesk(s => s.live[item.id]?.drafts?.spoken)
  const generating = useDesk(s => (s.thinking && s.chatItemId === item.id) || Boolean(s.live[item.id]?.native))
  const streamed = useStreamText(live?.text ?? '', Boolean(live))
  const [manual, setManual] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const queue = React.useRef(Promise.resolve())
  const save = React.useCallback(text => {
    const next = queue.current.then(async () => {
      const result = await dispatchOps([{ op: 'update_video', id: item.id, spoken: text }], { silent: true })
      return Boolean(result && !result.errors?.length)
    })
    queue.current = next.catch(() => false)
    return next
  }, [item.id])
  const draft = useArticleDraft(script, save)
  const importVideo = async () => {
    setBusy(true)
    try {
      if (await save(draft.text)) setDesk({ focusId: null, view: 'video', videoFocusId: item.id, videoStep: 'script' })
    } finally { setBusy(false) }
  }
  return <section className="md-spoken-content" aria-label={t('口播内容')}>
    {!script && !manual && !live ? <ConvertCard item={item} onManual={() => setManual(true)} /> : <>
      <header><p>{live ? 'DSH 正在写入口播内容…' : t('口播稿单独保存，原正文会保留。')}</p><button type="button" className="md-btn is-primary" disabled={busy || generating || !draft.text.trim()} onClick={importVideo}>{t(busy ? '正在保存…' : '导入视频工作台')}</button></header>
      <textarea aria-label={t('口播内容')} value={live ? streamed : draft.text} readOnly={generating} onChange={event => draft.setText(event.target.value)} spellCheck={false} />
      {draft.status === 'error' ? <p role="alert">{t('保存失败，请重试')}</p> : null}
    </>}
  </section>
}
