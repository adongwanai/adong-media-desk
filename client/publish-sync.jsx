// 多平台草稿同步：经 Wechatsync 浏览器扩展把成稿存成各平台的草稿，只存草稿、不发布。
import React from 'react'
import { PlatformMark } from './board.jsx'
import { openInBrowser } from './browser.js'
import { checkSyncBridge, syncPlatformDrafts } from './desk.js'
import { t, useLang } from './i18n.js'
import { Dialog, Icon, Swap } from './ui.jsx'

// 和 Host 的 sync-drafts.js 保持一致：只放核对过只存草稿的平台
export const SYNC_PLATFORMS = { 知乎: 'zhihu', B站: 'bilibili' }

export function SyncDraftsDialog({ item, onClose }) {
  useLang()
  const [status, setStatus] = React.useState(null)
  const [picked, setPicked] = React.useState(() => new Set())
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState(null)
  const check = React.useCallback(async () => {
    setStatus(null)
    setStatus(await checkSyncBridge())
  }, [])
  React.useEffect(() => { check() }, [check])
  const seen = Object.fromEntries((status?.platforms ?? []).map(row => [row.id, row]))
  const toggle = platform => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(platform)) next.delete(platform)
    else next.add(platform)
    return next
  })
  const chosen = [...picked].filter(platform => status?.reachable && seen[SYNC_PLATFORMS[platform]]?.loggedIn)
  const run = async () => {
    setBusy(true)
    const data = await syncPlatformDrafts(item.id, chosen)
    setBusy(false)
    if (data) setResults(data.results)
  }
  const close = () => { if (!busy) onClose() }
  return (
    <Dialog title={t('同步到草稿')} onClose={close} width={480}>
      <div className="md-sync">
        <p className="md-sync-note">{t('通过 Wechatsync 浏览器扩展，用你浏览器里已登录的账号把这篇存成各平台的草稿。只存草稿，不会发布；到各平台检查后自己点发布。有平台版本时用版本，没有就用正文。')}</p>
        {status === null ? <p className="md-sync-state"><span className="md-shimmer">{t('正在检测扩展连接…')}</span></p> : status.reachable ? (
          <p className="md-sync-state is-ok"><Icon name="check" size={13} />{t('扩展已连接')}</p>
        ) : (
          <p className="md-sync-state is-bad"><span>{status.message || t('连不上 Wechatsync 扩展')}</span><button type="button" className="md-btn is-small" onClick={check}>{t('重新检测')}</button></p>
        )}
        <ul className="md-sync-list">
          {Object.entries(SYNC_PLATFORMS).map(([platform, id]) => {
            const info = seen[id]
            const result = results?.find(row => row.platform === platform)
            const usable = Boolean(status?.reachable && info?.loggedIn)
            return (
              <li key={platform}>
                <label className="md-check">
                  <input type="checkbox" disabled={!usable || busy} checked={usable && picked.has(platform)} onChange={() => toggle(platform)} />
                  <PlatformMark platform={platform} size={18} />
                  <span>{t(platform)}</span>
                </label>
                <small>{!status?.reachable ? '' : !info ? t('扩展里没有这个平台') : info.loggedIn ? (info.username ? t('已登录：{name}', { name: info.username }) : t('已登录')) : t('未登录，先在浏览器里登录')}</small>
                {result ? (
                  result.ok ? (
                    <span className="md-sync-result is-ok">
                      {t('已存草稿')}{result.from === 'version' ? t('（平台版本）') : t('（正文）')}
                      {result.url ? <button type="button" className="md-pub-link" onClick={() => openInBrowser(result.url)}>{t('草稿链接')}<Icon name="upRight" size={11} /></button> : null}
                    </span>
                  ) : <span className="md-sync-result is-bad">{result.error}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
        <p className="md-sync-hint">{t('头条、小红书、抖音、X 在扩展里没有公开源码，没法确认只存草稿，所以这里不提供。')}</p>
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" disabled={busy} onClick={close}>{results ? t('完成') : t('取消')}</button>
          <button type="button" className="md-btn is-primary" disabled={busy || !chosen.length} onClick={run}><Icon name="save" size={13} /><Swap labels={[t('同步到草稿'), t('同步中…')]} at={busy ? 1 : 0} /></button>
        </div>
      </div>
    </Dialog>
  )
}
