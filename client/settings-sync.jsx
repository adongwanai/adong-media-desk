// 设置里的「多平台同步」：Wechatsync 浏览器扩展的 Token 和连接检测。
import React from 'react'
import { checkSyncBridge } from './desk.js'
import { t, useLang } from './i18n.js'

export function SyncSettings({ token, onToken, hasToken }) {
  useLang()
  const [checking, setChecking] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const check = async () => {
    if (token.trim()) { setResult({ reachable: false, message: t('Token 改过还没保存。先点「保存」，再打开设置检测') }); return }
    setChecking(true)
    setResult(null)
    setResult(await checkSyncBridge())
    setChecking(false)
  }
  const loggedIn = (result?.platforms ?? []).filter(row => row.loggedIn)
  return (
    <>
      <div className="md-field md-set-section">
        <span>{t('多平台同步（需要安装 Wechatsync 浏览器扩展）')}</span>
        <small>{t('可选。装好 Wechatsync 扩展、在扩展设置里打开「MCP 连接」并设一个 Token，把同一个 Token 填在这里。之后发布页可以把成稿存成知乎、B站的草稿，只存草稿，不会发布。扩展通过本机 127.0.0.1:9527 和工作台通信，用的是你浏览器里已登录的账号。')}</small>
      </div>
      <label className="md-field">
        <span>Token{hasToken ? t('（已保存）') : ''}</span>
        <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => onToken(e.target.value)} placeholder={hasToken ? t('留空表示不修改') : t('和扩展里设的一致')} />
        <small>{t('只保存在这台电脑上，不会写进内容数据，也不会被打包或发给模型。')}</small>
      </label>
      <div className="md-field">
        <div className="md-sync-check">
          <button type="button" className="md-btn is-small" disabled={checking || (!hasToken && !token.trim())} onClick={check}>{checking ? <span className="md-shimmer">{t('检测中，最多等 15 秒…')}</span> : t('检测连接')}</button>
          {result ? <small className={result.reachable ? 'is-ok' : 'is-bad'}>{result.reachable
            ? t('已连上扩展{via}。已登录：{names}', { via: result.mode === 'relay' ? t('（经 Wechatsync 命令行转发）') : '', names: loggedIn.length ? loggedIn.map(row => `${row.name}${row.workbench ? '' : t('（不在同步范围）')}`).join('、') : t('没有') })
            : result.message}</small> : null}
        </div>
      </div>
    </>
  )
}
