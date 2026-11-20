// 设置里的「图片上传」：长文里的本地图片粘不进公众号等平台编辑器，复制或推草稿前先传到一个公网地址。
// 三种方式：不上传（默认）、公众号素材库（用上面填的公众号凭证，地址只能在公众号文章里用）、自定义图床（HTTP POST 上传）。
// 令牌和其他密钥一样只存在这台电脑的设置里，浏览器只知道「有没有」。
import React from 'react'
import { t } from '../i18n.js'

const MODES = [
  { value: 'none', label: '不上传' },
  { value: 'wechat', label: '公众号素材库' },
  { value: 'custom', label: '自定义图床' },
]

/**
 * @param {object} props - value：表单里的 imageHost（token 为空表示不改）；saved：设置里现在的值（有没有令牌）；onChange(next)；wechatReady：公众号凭证填好没有。
 */
export function ImageHostSettings({ value, saved, onChange, wechatReady }) {
  const host = value ?? { mode: 'none' }
  const set = patch => onChange({ ...host, ...patch })
  return (
    <>
      <div className="md-field md-set-section">
        <span>{t('图片上传')}</span>
        <small>{t('长文里的本地图片粘不进公众号编辑器。选一个图床后，复制到公众号前会先把图片传上去，同一张图只传一次。')}</small>
      </div>
      <div className="md-field">
        <div className="md-presets" role="radiogroup" aria-label={t('图片上传')}>
          {MODES.map(mode => (
            <button type="button" key={mode.value} role="radio" aria-checked={host.mode === mode.value} className={host.mode === mode.value ? 'is-on' : ''} onClick={() => set({ mode: mode.value })}>{t(mode.label)}</button>
          ))}
        </div>
        {host.mode === 'none' ? <small>{t('不上传时，复制到公众号会提示哪些本地图片会丢。推公众号草稿时，正文图片总是先传到公众号素材库。')}</small> : null}
        {host.mode === 'wechat' ? <small>{wechatReady ? t('用上面的公众号凭证调用素材接口（uploadimg），返回的地址只能在公众号文章里显示。') : t('先在上面填好公众号的 AppID 和 AppSecret。')}</small> : null}
      </div>
      {host.mode === 'custom' ? (
        <>
          <label className="md-field">
            <span>{t('上传地址')}</span>
            <input autoComplete="off" spellCheck={false} value={host.endpoint ?? ''} onChange={e => set({ endpoint: e.target.value })} placeholder="https://img.example.com/api/v1/upload" />
            <small>{t('图片用 multipart/form-data 的 POST 发过去，PicGo-Server、兰空、SM.MS 这类都行。')}</small>
          </label>
          <div className="md-field-row">
            <label className="md-field"><span>{t('文件字段名')}</span><input spellCheck={false} value={host.field ?? 'file'} onChange={e => set({ field: e.target.value })} placeholder="file" /></label>
            <label className="md-field"><span>{t('返回地址的路径')}</span><input spellCheck={false} value={host.urlPath ?? 'url'} onChange={e => set({ urlPath: e.target.value })} placeholder="data.url" /></label>
          </div>
          <div className="md-field-row">
            <label className="md-field"><span>{t('请求头名称')}</span><input spellCheck={false} value={host.header ?? ''} onChange={e => set({ header: e.target.value })} placeholder="Authorization" /></label>
            <label className="md-field">
              <span>{t('令牌')}{saved?.hasToken ? t('（已保存）') : ''}</span>
              <input type="password" autoComplete="off" value={host.token ?? ''} onChange={e => set({ token: e.target.value })} placeholder={saved?.hasToken ? t('留空表示不修改') : 'Bearer …'} />
            </label>
          </div>
          <label className="md-check">
            <input type="checkbox" checked={Boolean(host.allowPrivate)} onChange={e => set({ allowPrivate: e.target.checked })} />
            <span>{t('这是我本机/内网的图床')}</span>
          </label>
          <div className="md-field"><small>{t('默认只连公网地址；勾上后才允许 127.0.0.1、192.168.x.x 这类地址。令牌只保存在这台电脑上，不会发给浏览器或模型。')}</small></div>
        </>
      ) : null}
    </>
  )
}
