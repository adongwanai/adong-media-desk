// 工作区顶上的提醒条：正文里有几句写成了「我亲手做过」，但灵感和素材里找不到依据。
// 逐句可以定位、改成观察口吻、或者确认是真的保留。接口还没上线时按钮照样在，点了给一句说明。
import React from 'react'
import { OBSERVE_REASON, claimAction, toast } from './desk.js'
import { t } from './i18n.js'
import { Icon, Swap } from './ui.jsx'
import { userText } from '../src/howi.js'
import { unsupportedClaims } from '../src/selfcheck.js'

const MISSING = '这个功能还在接入，暂时只能在正文里手动改这一句'

/** production.flow.unsupported 里的一条：{ sentence, index }，旧数据也可能只是一句字符串。 */
function claimOf(row, position) {
  if (typeof row === 'string') return { sentence: row, index: position }
  return { sentence: String(row?.sentence ?? row?.text ?? ''), index: Number.isInteger(row?.index) ? row.index : position }
}

export function ClaimsBar({ item, onLocate }) {
  const production = item.production
  const raw = production?.flow?.unsupported
  // 查过才有这一栏；数字跟着正文走：手动改掉、确认保留之后马上少一句，不用等下一次成稿
  const kept = (production?.flow?.kept ?? []).join('\n')
  const live = React.useMemo(() => (Array.isArray(raw) ? unsupportedClaims(production?.article ?? '', userText(item)) : null), [production?.article, production?.aiArticle, item.title, item.body, kept, Array.isArray(raw)]) // eslint-disable-line react-hooks/exhaustive-deps
  const claims = (live ?? (Array.isArray(raw) ? raw : [])).map(claimOf).filter(row => row.sentence.trim())
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(null)
  if (!claims.length) return null
  const run = async (kind, target, key) => {
    setBusy(key)
    const data = await claimAction(kind, { id: item.id, ...target })
    setBusy(null)
    if (!data) return
    if (data.missing) toast(t(MISSING))
    // 改写没成（reason 不为空）时正文一个字都没动，照实说原因
    else if (kind === 'rewrite' && data.reason) toast(t(OBSERVE_REASON[data.reason] ?? data.reason), { error: data.reason !== 'none' })
    else if (kind === 'rewrite') toast(t(data.applied === 1 ? '改了 1 句，改成观察口吻' : '改了 {n} 句，改成观察口吻', { n: data.applied }), { undo: true })
    else toast(data.kept ? t('好，这几句按你的经历保留') : t('没有要保留的句子'), { undo: Boolean(data.kept) })
  }
  return (
    <section className="md-claims" role="status" aria-label={t('需要确认的经历')}>
      <header className="md-claims-head">
        <Icon name="user" size={14} />
        <p>
          <b>{t('{n} 句写成了你亲手做过', { n: claims.length })}</b>
          <span>{t('灵感和素材里找不到依据。是真的就保留，不是就改成观察口吻。')}</span>
        </p>
        <span className="md-grow" />
        <button type="button" className="md-btn is-small" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? t('收起') : t('逐句看')}<Icon name={open ? 'chevD' : 'chevR'} size={12} /></button>
        <button type="button" className="md-btn is-small" disabled={Boolean(busy)} onClick={() => run('keep', { all: true }, 'keep-all')}>{t('都是真的，保留')}</button>
        <button type="button" className="md-btn is-small is-primary" disabled={Boolean(busy)} onClick={() => run('rewrite', { all: true }, 'rewrite-all')}><Swap labels={[t('全部改成观察口吻'), t('正在改…')]} at={busy === 'rewrite-all' ? 1 : 0} /></button>
      </header>
      {open ? (
        <ol className="md-claims-list">
          {claims.map((row, position) => (
            <li key={`${row.index}:${position}`}>
              <q>{row.sentence.replace(/\*\*|==|__/g, '').replace(/^\s*(?:\d+[.)、]|[-*+])\s*/, '')}</q>
              <span className="md-claims-acts">
                <button type="button" className="md-inline-link" onClick={() => onLocate(row.sentence)}><Icon name="target" size={12} />{t('定位')}</button>
                <button type="button" className="md-inline-link" disabled={Boolean(busy)} onClick={() => run('rewrite', { index: row.index }, `rewrite-${position}`)}>{busy === `rewrite-${position}` ? t('正在改…') : t('改成观察口吻')}</button>
                <button type="button" className="md-inline-link" disabled={Boolean(busy)} onClick={() => run('keep', { index: row.index }, `keep-${position}`)}>{t('这是真的，保留')}</button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
