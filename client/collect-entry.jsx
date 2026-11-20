// 「登录后台自动采集」的入口：大屏「数据分析」空状态和复盘页顶部共用。
// 没开或还没登录时引导去登录；登录过了写明哪些平台在自动更新、上次什么时候更新，给「立即更新」。
import React from 'react'
import { loginBackstage, readAccountsNow, whenText } from './board-accounts.jsx'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'

/**
 * @param {{info: object|null, reading?: boolean, onRead?: () => Promise<void>, className?: string}} props - info 是大屏接口里的 autoRead。
 */
export function CollectEntry({ info, reading = false, onRead, className = '' }) {
  const enabled = Object.values(info?.support ?? {}).some(row => row?.backstage)
  const rows = (info?.last?.results ?? []).filter(row => row.source === 'backstage' || row.needLogin)
  const live = rows.filter(row => row.ok && row.source === 'backstage').map(row => row.platform)
  const needLogin = rows.filter(row => row.needLogin).map(row => row.platform)
  const read = onRead ?? (() => readAccountsNow())
  if (!enabled || !live.length) {
    return (
      <div className={`md-collect ${className}`}>
        <p className="md-collect-note">{t('登录创作后台后每天自动更新：粉丝、近 7 日数据和每条作品的播放、点赞、收藏、评论、分享。')}</p>
        <div className="md-collect-actions">
          <button type="button" className="md-btn is-small is-primary" onClick={() => loginBackstage()}><Icon name="upRight" size={13} />{t('登录后台自动采集')}</button>
          {enabled ? <button type="button" className="md-btn is-small" disabled={reading} onClick={read}><Icon name="refresh" size={13} />{t('立即更新')}</button> : null}
        </div>
      </div>
    )
  }
  return (
    <div className={`md-collect ${className}`}>
      <p className="md-collect-note" title={t('后台自动采集：{list}', { list: live.map(name => t(name)).join(t('、')) })}>
        {info?.last?.at ? t('后台自动采集 · 上次更新 {when}', { when: whenText(info.last.at) }) : t('后台自动采集：{list}', { list: live.map(name => t(name)).join(t('、')) })}
      </p>
      {needLogin.length ? <p className="md-collect-note is-warn">{t('需要重新登录：{list}', { list: needLogin.map(name => t(name)).join(t('、')) })}</p> : null}
      <div className="md-collect-actions">
        <button type="button" className="md-btn is-small is-primary" disabled={reading} onClick={read}><Icon name="refresh" size={13} />{reading ? t('正在更新…') : t('立即更新')}</button>
        {needLogin.length ? <button type="button" className="md-btn is-small" onClick={() => loginBackstage(needLogin)}><Icon name="upRight" size={13} />{t('去登录')}</button> : null}
      </div>
    </div>
  )
}
