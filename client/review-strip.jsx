// 灵感页的「今日回顾」：放了很久没动的 3 条灵感，打开看看、拿去成稿，或者这条先别再提。挑哪几条见 idea-review.js。
import React from 'react'
import { dispatchOps, openItem, runProduce, setDesk, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { idleDays, pickReview } from './idea-review.js'
import { dayKey, displayItem } from './util.js'

const DISMISS_KEY = 'md-review-dismissed'
// 「不再提醒这条」：十年内不再拿出来回顾，等于不再提醒；内容本身不动，撤销可以找回
const SNOOZE_DAYS = 3650

/** 今天点过「收起」就不再显示；浏览器存不了时照常显示。 */
function dismissedToday() {
  try {
    return localStorage.getItem(DISMISS_KEY) === dayKey(new Date())
  } catch {
    return false
  }
}

function produce(item) {
  const title = displayItem(item).title
  setDesk({
    dialog: {
      title: t('给《{title}》成稿', { title: title.slice(0, 18) }),
      submitLabel: t('开始成稿'),
      initial: { withImages: true },
      fields: [
        { name: 'note', label: t('会调用文字模型写一篇正文，消耗一次模型额度。'), type: 'hidden' },
        { name: 'withImages', label: t('同时生成封面、配图和分镜图'), type: 'checkbox' },
      ],
      onSubmit: (values) => {
        openItem(item.id)
        runProduce(item.id, { withImages: values.withImages !== false })
      },
    },
  })
}

/**
 * @param {{inline?: boolean}} props - inline 时排在信息流的首屏下面；否则浮在散落视图的左上角。
 */
export function TodayReview({ inline = false }) {
  const items = useDesk(s => s.state.items)
  const [hidden, setHidden] = React.useState(dismissedToday)
  const picks = React.useMemo(() => pickReview(items), [items])
  if (hidden || !picks.length) return null
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, dayKey(new Date()))
    } catch {
      // 存不了就只在这次打开里收起
    }
    setHidden(true)
  }
  return (
    <section className={`md-review ${inline ? 'is-inline' : 'is-float'}`} aria-label={t('今日回顾')} onPointerDown={e => e.stopPropagation()}>
      <header className="md-review-head">
        <Icon name="spark" size={14} />
        <h2>{t('今日回顾')}</h2>
        <small>{t('放了很久没动的灵感')}</small>
        <span className="md-grow" />
        <button type="button" className="md-review-close" aria-label={t('今天先不看')} title={t('今天先不看')} onClick={dismiss}><Icon name="close" size={13} /></button>
      </header>
      <ul className="md-review-list">
        {picks.map((item) => {
          const title = displayItem(item).title
          return (
            <li key={item.id}>
              <button type="button" className="md-review-title" title={title} onClick={() => openItem(item.id)}>{title}</button>
              <small className="md-review-age">{t('{n} 天没动', { n: idleDays(item) })}</small>
              <span className="md-review-acts">
                <button type="button" onClick={() => openItem(item.id)}>{t('打开')}</button>
                <button type="button" onClick={() => produce(item)}>{t('去成稿')}</button>
                <button type="button" className="is-quiet" onClick={() => dispatchOps([{ op: 'snooze_idea', id: item.id, days: SNOOZE_DAYS }], { label: t('不再提醒这条') })}>{t('不再提醒这条')}</button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
