// 第一次打开、什么都还没有时的四步上手。每一步都直接带到要去的地方，不放示例数字。
import React from 'react'
import { setDesk, useDesk } from './desk.js'
import { t } from './i18n.js'
import { ImportFolderDialog } from './import-folder.jsx'
import { openQuickCapture } from './quick-capture.js'
import { CAPTURE_KEY, keysOf } from './shortcuts.js'
import { editAuthor } from './style.jsx'
import { Keys } from './ui.jsx'

/**
 * 还没有任何自己的内容、订阅和粉丝记录（示例数据不算）。有了任何一样就返回 false。
 * 新建时预置的默认订阅（fd_default_*）和内置信息源是工作台自己放的，不算用户动过。
 */
export function useFreshDesk() {
  return useDesk(s => Boolean(s.state)
    && !s.state.items.some(item => !item.sample)
    && !(s.state.feeds ?? []).some(feed => !String(feed?.id ?? '').startsWith('fd_default_'))
    && !(s.state.followerLog ?? []).some(row => !row.sample))
}

export function StartCard() {
  const author = useDesk(s => s.state?.author)
  const [importing, setImporting] = React.useState(false)
  const go = view => setDesk({ view, focusId: null })
  const steps = [
    {
      title: t('让写出来的像你'),
      hint: t('导入你写过的稿子，选风格、填署名。之后成稿会照着你的断句和口头禅写。'),
      // 这一步有三件小事，各给一个入口
      actions: [
        { label: t('导入旧稿'), run: () => setImporting(true) },
        { label: t('选风格'), run: () => go('style') },
        { label: t('填署名'), run: () => editAuthor(author) },
      ],
    },
    { title: t('加信息源或看热榜'), hint: t('订阅常看的博客和资讯，或者直接看几个公开热榜，找今天能写的事。'), actions: [{ label: t('去信息源'), run: () => go('sources') }] },
    { title: t('记一条灵感'), hint: <>{t('想到就记，在 DeepSeek Harness 任何地方按')} <Keys keys={keysOf(CAPTURE_KEY)} /> {t('都行，不用先打开工作台。')}</>, actions: [{ label: t('记一条灵感'), run: () => openQuickCapture(), primary: true }] },
    { title: t('一键成稿'), hint: t('在「灵感」里打开一条，点「一键成稿」，正文和标题一起出；接了生图模型还会画封面和配图。'), actions: [{ label: t('去灵感'), run: () => go('home') }] },
  ]
  return (
    <section className="md-tile md-start" aria-labelledby="md-start-title">
      <header>
        <h2 id="md-start-title">{t('四步开始')}</h2>
        <p className="md-muted">{t('工作台现在还是空的。照着走一遍，大屏就会换成你自己的数据。')}</p>
      </header>
      <ol>
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="md-start-no" aria-hidden="true">{index + 1}</span>
            <div className="md-start-copy"><strong>{step.title}</strong><p>{step.hint}</p></div>
            <div className="md-start-actions">
              {step.actions.map(action => <button key={action.label} type="button" className={`md-btn ${action.primary ? 'is-primary' : ''} ${step.actions.length > 1 ? 'is-small' : ''}`} onClick={action.run}>{action.label}</button>)}
            </div>
          </li>
        ))}
      </ol>
      {importing ? <ImportFolderDialog onClose={() => setImporting(false)} /> : null}
    </section>
  )
}
