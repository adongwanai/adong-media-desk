// 发布页的「填到草稿」：用专用浏览器打开平台发布页，把这篇的平台版本（图片版、标题、正文、话题）填进去、存成草稿，然后停下。
// 永远不点发布；最后由用户在专用浏览器里检查、自己点发布。支持哪些平台、内容够不够填，都从 src/fill-platforms 读。
import React from 'react'
import { hostRequest, openItem, report, setDesk, toast, useDesk } from './desk.js'
import { lang, t, useLang } from './i18n.js'
import { Dialog, Icon } from './ui.jsx'
import { usePrefs, useItemMedia, useSignature } from './layouts/prefs.js'
import { cardsMediaKey, exportCardPngs, planCardPages } from './fill-cards.js'
import { fillAdapter } from '../src/fill-platforms/index.js'

// 进度：key 来自 Host 的 draft-fill.js 和这里自己的两步（导出图片、交给工作台）
// 主流程依次是：查重 → 上传图片 → 填标题 → 填正文 → 回读核对 → 存草稿 → 确认
const STEP_TEXT = {
  render: '生成图片 {n}/{total}',
  send: '把图片交给工作台 {n}/{total}',
  browser: '连接专用浏览器',
  open: '打开{platform}发布页',
  check: '查重：看{platform}的草稿箱和笔记管理',
  'check-missed': '{list}没打开，这一次没查到',
  tab: '切到「上传图文」',
  upload: '上传图片 {n}/{total}',
  title: '填标题',
  body: '填正文',
  tags: '加 {n} 个话题',
  readback: '回读核对：标题、正文、话题数量、图片张数',
  shot: '给填好时的页面拍一张',
  save: '点一次「暂存离开」',
  confirm: '去草稿箱确认',
  saved: '已存进草稿箱',
  filled: '已填好，页面上没有存草稿的按钮',
}

const ERROR_TEXT = {
  'no-version': '还没有{platform}版本，先去生成平台版本',
  'no-title': '{platform}版本还没有标题',
  'title-long': '标题算下来 {n} 字，超过{platform}的 {max} 字上限。没有替你截断，先把标题改短',
  'body-long': '正文加话题一共 {n} 字，超过 {max} 字上限，先删短一点',
  'no-cards': '还没有图片版，先在平台版本里生成{platform}图片版',
  'too-many-images': '图片版切出 {n} 页，超过{platform}一篇最多 {max} 张，先精简图片版',
  render: '图片版导出失败：{message}',
  duplicate: '这个平台已经有这篇的草稿/笔记了，先别重复填。看到的是「{title}」{where}。到专用浏览器里打开确认一下，要改旧的那篇就直接改',
  readback: '回读核对不一致：{what}对不上（页面上是 {got}，要填的是 {want}），所以没有存草稿。去专用浏览器看一眼，改好再点一次',
  'save-unconfirmed': '已经点过存草稿，但没确认到（草稿箱里没看到这一篇）。请到专用浏览器看一眼，不要再点第二次',
  login: '专用浏览器里的{platform}没登录，或者登录过期了，已停下。先在专用浏览器里登录，再点一次',
  captcha: '页面弹出了验证（验证码或滑块），已停下。请在专用浏览器里自己完成验证，再点一次',
  offsite: '页面跳到了白名单以外的地址，已停下：{url}',
  changed: '{platform}页面可能改版了，没找到「{what}」，没填完。已经填进去的留在页面上',
  denied: '要点的按钮「{what}」不在允许范围内，已停下（发布类按钮一律不点）',
  timeout: '等「{what}」超时了，已停下',
  verify: '填完核对时{what}对不上，已停下，请到页面上看看',
  hidden: '专用浏览器的窗口被别的窗口挡住了，输入可能没进去。把它放到前面，再点一次',
  files: '图片文件不对，没有交给页面',
  script: '页面没有响应，已停下',
  other: '{message}',
}

/** 发布页平台行里的按钮：只对支持的平台显示。 */
export function FillDraftButton({ platform, onOpen }) {
  if (!fillAdapter(platform)) return null
  return (
    <button type="button" className="md-btn is-small" title={t('用专用浏览器打开{platform}发布页，填好内容、存成草稿；不会点发布', { platform: t(platform) })} onClick={onOpen}>
      <Icon name="save" size={13} />{t('填到草稿')}
    </button>
  )
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// 进度一步一行，紧凑一点；步骤多时在框里滚动，对话框不会长出屏幕
const STEPS_STYLE = { display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto', margin: '10px 0', padding: '8px 12px', listStyle: 'none', borderRadius: 10, background: 'var(--hover)', fontSize: 12.5 }
const STEP_STYLE = { display: 'flex', alignItems: 'center', gap: 6, margin: 0 }

async function sendPng(blob) {
  const res = await fetch('media-desk/fill/image', { method: 'POST', headers: { 'content-type': 'image/png', 'x-media-desk-lang': lang() }, body: blob })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || t('请求失败（{status}）', { status: res.status }))
  return data.name
}

function stepText(step, platform) {
  // 查重的补充行：某个列表页没打开，说一声这次没查到
  if (step.key === 'check-missed') return t('{list}没打开，这一次没查到', { list: t(step.vars?.list ?? '') })
  // 截图单独渲染（带「看填好时的页面」的入口）
  if (step.key === 'shot') return ''
  const vars = { platform: t(platform), ...step.vars }
  return t(STEP_TEXT[step.key] ?? step.key, vars)
}

/** 截图那一步：拍到了给「看填好时的页面」的入口，没拍到就说一句。 */
function ShotStep({ step }) {
  if (step.vars?.name) {
    return <a className="md-pub-link" href={`media-desk/files/${step.vars.name}`} target="_blank" rel="noreferrer">{t('看填好时的页面')}<Icon name="upRight" size={11} /></a>
  }
  return <span>{t('填好时的页面没截上，不影响这次填草稿')}</span>
}

function errorText(error, platform) {
  const vars = { platform: t(platform), ...error.vars }
  // what 是页面上的按钮文字或步骤名：步骤名翻一下，按钮文字原样
  if (typeof vars.what === 'string') vars.what = t(vars.what)
  return t(ERROR_TEXT[error.code] ?? ERROR_TEXT.other, vars)
}

/** 填到草稿的对话框：先看内容够不够，点开始后逐步显示进度，失败时说清停在哪一步、为什么。 */
export function FillDraftDialog({ item, platform, onClose }) {
  useLang()
  const adapter = fillAdapter(platform)
  const content = React.useMemo(() => adapter.content(item), [adapter, item])
  const [prefs] = usePrefs('card')
  const [signature] = useSignature()
  const [media] = useItemMedia(cardsMediaKey(item.id))
  const themes = useDesk(s => s.state?.layoutThemes) ?? []
  const [steps, setSteps] = React.useState([])
  const [phase, setPhase] = React.useState('ready')
  const [error, setError] = React.useState(null)
  const [result, setResult] = React.useState(null)
  const [confirmNeeded, setConfirmNeeded] = React.useState(false)
  const alive = React.useRef(true)
  React.useEffect(() => () => { alive.current = false }, [])
  const busy = phase === 'running'
  const blocked = content.problems.length > 0

  const local = (key, vars) => setSteps(prev => (prev.at(-1)?.key === key ? [...prev.slice(0, -1), { key, vars }] : [...prev, { key, vars }]))
  const fail = (err) => { setError(err); setPhase('failed') }

  const run = async () => {
    setPhase('running')
    setError(null)
    setSteps([])
    setConfirmNeeded(false)
    let blobs
    try {
      const plan = await planCardPages({ cards: content.cards, title: content.title, prefs, signature, media, themes })
      if (plan.pages.length > adapter.limits.images) return fail({ code: 'too-many-images', vars: { n: plan.pages.length, max: adapter.limits.images } })
      blobs = await exportCardPngs(plan, (n, total) => local('render', { n, total }))
    } catch (err) {
      return fail({ code: 'render', vars: { message: err?.message ?? String(err) } })
    }
    let job
    try {
      const images = []
      for (let i = 0; i < blobs.length; i += 1) {
        local('send', { n: i + 1, total: blobs.length })
        images.push(await sendPng(blobs[i]))
      }
      job = (await hostRequest('fill/start', { id: item.id, platform, images })).job
    } catch (err) {
      return fail({ code: 'other', vars: { message: err?.message ?? String(err) } })
    }
    // Host 在后台填；每隔一会儿读一次进度。关掉对话框后不再读，Host 照样填完
    while (alive.current) {
      const hostSteps = job.steps ?? []
      setSteps(prev => [...prev.filter(row => row.key === 'render' || row.key === 'send'), ...hostSteps])
      if (job.status !== 'running') break
      await sleep(800)
      try {
        const data = await hostRequest(`fill/status?job=${encodeURIComponent(job.id)}`)
        job = data.job
        if (data.state) setDesk({ state: data.state })
      } catch (err) {
        report(err)
        break
      }
    }
    if (job.status === 'done') {
      setResult(job.result)
      setPhase('done')
      toast(job.result === 'saved' ? t('已存进草稿箱，去专用浏览器检查后再自己点发布') : t('已填好，去专用浏览器检查并点发布'))
    } else if (job.status === 'failed') {
      // 点过存草稿但没确认到：单独说清「不要再点第二次」
      if (job.confirmNeeded || job.error?.code === 'save-unconfirmed') setConfirmNeeded(true)
      fail(job.error ?? { code: 'other', vars: { message: '' } })
    }
    return null
  }

  const close = () => onClose()
  return (
    <Dialog title={t('填到{platform}草稿', { platform: t(platform) })} onClose={close} width={500}>
      <div className="md-sync">
        <p className="md-sync-note">{t('用专用浏览器打开{platform}发布页：传图片版、填标题、正文和话题，点「暂存离开」存成草稿后停下，标签页留在前台。不会点发布，检查无误后由你自己发布。', { platform: t(platform) })}</p>
        {blocked ? (
          <ul className="md-sync-list">
            {content.problems.map(problem => <li key={problem.code}><span className="md-sync-result is-bad">{errorText(problem, platform)}</span></li>)}
            {content.problems.some(problem => problem.code === 'no-version' || problem.code === 'no-cards') ? <li><button type="button" className="md-pub-link" onClick={() => { onClose(); openItem(item.id) }}>{t('去写平台版本')}<Icon name="upRight" size={11} /></button></li> : null}
          </ul>
        ) : (
          <ul className="md-sync-list">
            <li><span>{t('标题')}</span><small>{content.title}</small></li>
            <li><span>{t('正文')}</span><small>{t('{n} 字', { n: Array.from(content.body).length })}{content.tags.length ? ` · ${t('{n} 个话题', { n: content.tags.length })}` : ''}</small></li>
            <li><span>{t('图片版')}</span><small>{t('按图片版当前的排版导出成图片')}</small></li>
          </ul>
        )}
        {steps.length ? (
          <ol aria-live="polite" style={STEPS_STYLE}>
            {steps.map((step, i) => {
              const current = i === steps.length - 1 && busy
              // 失败就停在最后一步：这里不给它打对勾
              const stopped = i === steps.length - 1 && phase === 'failed'
              const text = stepText(step, platform)
              return (
                <li key={`${step.key}-${i}`} className={`md-sync-result ${current || stopped ? '' : 'is-ok'}`} style={STEP_STYLE}>
                  {step.key === 'shot'
                    ? <><Icon name="image" size={12} /><ShotStep step={step} /></>
                    : current ? <span className="md-shimmer">{text}</span>
                      : stopped ? <><Icon name="close" size={12} />{text}</>
                        : <><Icon name="check" size={12} />{text}</>}
                </li>
              )
            })}
          </ol>
        ) : null}
        {phase === 'failed' && error ? (
          <p className={`md-sync-state ${confirmNeeded ? 'is-warn' : 'is-bad'}`}>
            {confirmNeeded ? <Icon name="help" size={13} /> : null}
            <span>{errorText(error, platform)}{confirmNeeded ? t('这一步不会自动重试') : ''}</span>
          </p>
        ) : null}
        {phase === 'done' ? (
          <p className="md-sync-state is-ok">
            <Icon name="check" size={13} />
            <span>
              {result === 'saved'
                ? t('已填好并存进{platform}草稿箱。去专用浏览器检查：发布页右上角「草稿箱」里打开这篇，确认无误后自己点发布', { platform: t(platform) })
                : t('已填好，去专用浏览器检查并点发布')}
            </span>
          </p>
        ) : null}
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={close}>{phase === 'done' || phase === 'failed' ? t('完成') : t('取消')}</button>
          {phase === 'done' || confirmNeeded ? null : (
            <button type="button" className="md-btn is-primary" disabled={busy || blocked} onClick={run}>
              <Icon name="save" size={13} />{busy ? t('正在填…') : phase === 'failed' ? t('再试一次') : t('开始填到草稿')}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
