// 公众号公开发布的确认框。每一次发布都要在这里明确点确认，没有“下次不再询问”。
// 确认框只认打开时的那一份草稿（media_id），Host 那边会再核对一次。
import React from 'react'
import { checkWechatPublish, publishWechat, stopWechatWait, toast, useDesk } from './desk.js'
import { openInBrowser } from './browser.js'
import { t, useLang } from './i18n.js'
import { Dialog, Icon, Swap } from './ui.jsx'
import { PLATFORM_HOME } from './util.js'

const WECHAT = '公众号'
// 和 src/wechat-publish.js 的 SUBMITTING 一致：提交出去了但没拿到明确结果
const SUBMITTING = 'submitting'

export function WechatPublishDialog({ item, title, mediaId, onClose, retryUnknown = false }) {
  useLang()
  const wechat = useDesk(s => s.settings?.wechat)
  const [busy, setBusy] = React.useState(false)
  const close = () => { if (!busy) onClose() }
  const confirm = async () => {
    setBusy(true)
    const data = await publishWechat(item.id, mediaId, { retryUnknown })
    setBusy(false)
    if (!data) return
    onClose()
    if (data.published) {
      toast(t('已发布到公众号'))
      if (data.url) openInBrowser(data.url)
    } else {
      toast(t('发布已提交，公众号还在处理。稍后在发布页点「查询发布结果」，不要重复发布'))
    }
  }
  return (
    <Dialog title={t('确认公开发布到公众号')} onClose={close} width={460}>
      <div className="md-pubc">
        <p className="md-pubc-warn"><strong>{t('公开、无法撤回')}</strong><span>{t('这是公开发布：点确认后，文章会发到公众号，关注者和所有人都能看到，发出后无法撤回。')}</span></p>
        <dl className="md-pubc-facts">
          <dt>{t('标题')}</dt><dd>{title}</dd>
          <dt>{t('公众号')}</dt><dd>{`AppID ${wechat?.appId || t('未填')}`}{wechat?.author ? ` · ${t('作者')} ${wechat.author}` : ''}</dd>
          <dt>{t('草稿')}</dt><dd>{t('上次推到草稿箱的那一份')}</dd>
        </dl>
        {retryUnknown ? <p className="md-pubc-warn"><strong>{t('上一次提交没有明确结果')}</strong><span>{t('只有在公众号后台确认这篇没有发出去，才重新提交；不然可能会发两次。')}</span></p> : null}
        <p className="md-pubc-hint">{t('发布前建议先到公众号后台打开这篇草稿，用手机预览检查一遍。')}</p>
        {busy ? (
          <p className="md-pubc-wait">
            <span className="md-shimmer">{t('已提交，正在等公众号返回结果…')}</span>
            <button type="button" className="md-btn is-small" onClick={() => stopWechatWait(item.id)}>{t('停止等待')}</button>
          </p>
        ) : null}
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" disabled={busy} onClick={close}>{t('取消')}</button>
          <button type="button" className="md-btn is-danger" disabled={busy} onClick={confirm}><Icon name="upRight" size={13} />{t('确认公开发布')}</button>
        </div>
      </div>
    </Dialog>
  )
}

/** 公众号这一格里和公开发布有关的按钮：有草稿时可以发布；已提交但没查到结果时只能查询。确认框由发布页在最外层打开。 */
export function WechatPublishControls({ item, onConfirm }) {
  useLang()
  const row = item.publish?.[WECHAT]
  const [checking, setChecking] = React.useState(false)
  if (!row?.mediaId || row.state === 'published') return null
  // 提交了但没拿到明确结果（网络断了、超时）：可能已经在发了。先去后台看，确认没发出去才重新提交；这时查不了结果
  if (row.publishId === SUBMITTING) {
    return (
      <p className="md-pub-unknown" role="status">
        <Icon name="clock" size={14} />
        <span>{t('上一次提交没有得到明确结果，公众号可能已经在发了。先到公众号后台看看')}</span>
        <button type="button" className="md-btn is-small" onClick={() => openInBrowser(PLATFORM_HOME[WECHAT])}><Icon name="upRight" size={13} />{t('打开公众号后台')}</button>
        <button type="button" className="md-btn is-small" title={t('会再打开一次确认框，确认后重新提交这一份草稿')} onClick={() => onConfirm(row.mediaId, { retryUnknown: true })}>{t('确认没发出去，重新提交')}</button>
      </p>
    )
  }
  if (row.publishId) {
    const check = async () => {
      setChecking(true)
      const data = await checkWechatPublish(item.id)
      setChecking(false)
      if (data?.published) toast(t('已发布到公众号'))
      else if (data) toast(t('公众号还在处理这次发布，稍后再查'))
    }
    return (
      <span className="md-pub-tip" title={t('发布已经提交，只查结果，不会再发一次')}>
        <button type="button" className="md-btn is-small" disabled={checking} onClick={check}><Icon name="refresh" size={13} /><Swap labels={[t('查询发布结果'), t('查询中…')]} at={checking ? 1 : 0} /></button>
      </span>
    )
  }
  return <button type="button" className="md-btn is-small is-danger" title={t('用公众号官方接口公开发布草稿箱里的这一份，发布前会再确认一次')} onClick={() => onConfirm(row.mediaId)}><Icon name="upRight" size={13} />{t('发布到公众号')}</button>
}
