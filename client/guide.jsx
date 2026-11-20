// 「怎么用」：按手上要做的事挑一条路，每步一句话，点「带我去」直接到那一页或打开那个框。
// 顶栏的 ? 和命令面板里都能打开；第一次进工作台自动出现一次，之后不再打扰。
import React from 'react'
import { logIncome } from './board-income.jsx'
import { setDesk, toast, useDesk } from './desk.js'
import { GUIDE_PATHS, readGuideMemo, writeGuideMemo } from './guide-paths.js'
import { t } from './i18n.js'
import { ImportFolderDialog } from './import-folder.jsx'
import { openQuickCapture } from './quick-capture.js'
import { CAPTURE_KEY, PAGES, keysOf, pageLabel } from './shortcuts.js'
import { editAuthor } from './style.jsx'
import { writePref } from './video/prompter.js'
import { Dialog, Icon, Keys } from './ui.jsx'

const finishedAt = item => Date.parse(item.production?.finishedAt ?? item.production?.startedAt ?? item.createdAt) || 0

/** 最近写好的一篇成稿（示例不算）。 */
function latestPiece(items) {
  return items.filter(item => !item.sample && item.production?.status === 'done').sort((a, b) => finishedAt(b) - finishedAt(a))[0] ?? null
}

/** 「带我去」去的地方，按钮的提示里用。 */
function destination(go) {
  if (go.view) return pageLabel(PAGES.find(page => page.id === go.view))
  return t({ capture: '记灵感的小窗', import: '导入文件夹', author: '作者信息', income: '记一笔收入', piece: '最近一篇成稿' }[go.do])
}

/** 照着一步的 go 走过去。 */
function follow(go, state) {
  if (go.view === 'video' && go.tab) {
    // 视频页打开时读上次停在哪一步；reload 加一让它按这一步重新挂上
    writePref('tab', go.tab)
    setDesk(s => ({ view: 'video', focusId: null, reload: s.reload + 1 }))
    return
  }
  if (go.view) {
    setDesk({ view: go.view, focusId: null })
    return
  }
  const piece = latestPiece(state.items)
  if (go.do === 'capture') openQuickCapture()
  else if (go.do === 'import') setDesk({ guideImport: true })
  else if (go.do === 'author') editAuthor(state.author)
  else if (go.do === 'income') {
    setDesk({ view: 'board', focusId: null })
    logIncome(state.items, piece?.id ?? '')
  } else if (go.do === 'piece') {
    if (piece) setDesk({ focusId: piece.id, sheetOrigin: null, sheetLayout: go.layout })
    else {
      setDesk({ view: 'home', focusId: null })
      toast(t('还没有成稿：先在「灵感」里打开一条，点「一键成稿」'))
    }
  }
}

/** 一步的文字：{keys} 换成记灵感的快捷键。 */
function StepText({ text }) {
  const parts = t(text).split('{keys}')
  return <p>{parts.map((part, i) => <React.Fragment key={i}>{i ? <Keys keys={keysOf(CAPTURE_KEY)} /> : null}{part}</React.Fragment>)}</p>
}

function GuideBox() {
  const state = useDesk(s => s.state)
  const memo = React.useMemo(() => readGuideMemo(), [])
  const [pathId, setPathId] = React.useState(() => (GUIDE_PATHS.some(path => path.id === memo.path) ? memo.path : GUIDE_PATHS[0].id))
  const path = GUIDE_PATHS.find(row => row.id === pathId)
  // 上次在这条路上点到第几步：下一步标出来，回来时接着走
  const next = memo.path === pathId && Number.isInteger(memo.step) ? Math.min(memo.step + 1, path.steps.length - 1) : -1
  const close = () => setDesk({ guide: false })
  const go = (index) => {
    writeGuideMemo({ path: pathId, step: index })
    close()
    follow(path.steps[index].go, state)
  }
  return (
    <Dialog title={t('怎么用')} onClose={close} width={860}>
      <p className="md-guide-lead">{t('按手上要做的事挑一条，跟着点「带我去」。之后随时点右上角的 ? 再打开。')}</p>
      <div className="md-guide">
        <div className="md-guide-tasks" role="tablist" aria-label={t('要做的事')} aria-orientation="vertical">
          {GUIDE_PATHS.map(row => (
            <button key={row.id} type="button" role="tab" id={`md-guide-tab-${row.id}`} aria-selected={row.id === pathId} aria-controls="md-guide-steps" className={row.id === pathId ? 'is-on' : ''} onClick={() => setPathId(row.id)}>
              <Icon name={row.icon} size={16} />
              <span><strong>{t(row.title)}</strong><small>{t(row.hint)}</small></span>
            </button>
          ))}
        </div>
        <ol className="md-guide-steps" id="md-guide-steps" role="tabpanel" aria-labelledby={`md-guide-tab-${pathId}`}>
          {path.steps.map((step, index) => (
            <li key={index} className={index === next ? 'is-next' : ''}>
              <span className="md-guide-no" aria-hidden="true">{index + 1}</span>
              <StepText text={step.text} />
              <button type="button" className="md-btn is-small" title={t('带我去：{place}', { place: destination(step.go) })} onClick={() => go(index)}>{t('带我去')}<Icon name="chevR" size={13} /></button>
            </li>
          ))}
        </ol>
      </div>
      <footer className="md-guide-foot">
        <span>{t('工作台帮你写、排版、记账；发不发、什么时候发，都是你自己点。')}</span>
        <button type="button" className="md-inline-link" onClick={() => setDesk({ guide: false, shortcutSheet: true })}>{t('全部快捷键')}</button>
      </footer>
    </Dialog>
  )
}

/** 挂在工作台根上：「怎么用」面板、从它打开的导入框，以及第一次进来时自动打开一次。 */
export function GuideLayer() {
  const open = useDesk(s => s.guide)
  const importing = useDesk(s => s.guideImport)
  const ready = useDesk(s => Boolean(s.state))
  React.useEffect(() => {
    if (!ready || readGuideMemo().seen) return
    writeGuideMemo({ seen: true })
    setDesk({ guide: true })
  }, [ready])
  React.useEffect(() => {
    if (open) writeGuideMemo({ seen: true })
  }, [open])
  return (
    <>
      {open && ready ? <GuideBox /> : null}
      {importing ? <ImportFolderDialog onClose={() => setDesk({ guideImport: false })} /> : null}
    </>
  )
}
