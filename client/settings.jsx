// 设置：开放接入的生图模型和保存位置。
import React from 'react'
import { previewWritingFlow, saveSettings, scanWritingFlow, setDesk, testImage, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { Dialog, Icon } from './ui.jsx'
import { SyncSettings } from './settings-sync.jsx'
import { ImageHostSettings } from './layouts/image-host-settings.jsx'
import { loginBackstage } from './board-accounts.jsx'

// 常见服务的 OpenAI 兼容地址，模型名以各家文档为准。label 是中文原文，显示时再翻译
const PRESETS = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', size: '1536x1024', quality: 'medium', extra: '' },
  { id: 'xai', label: 'xAI', protocol: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-2-image', size: '', quality: '', extra: '' },
  { id: 'ark', label: '火山方舟', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', size: '1024x1024', quality: '', extra: '' },
  { id: 'zhipu', label: '智谱', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4', size: '1024x1024', quality: '', extra: '' },
  { id: 'silicon', label: '硅基流动', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: '', size: '', quality: '', extra: '{"image_size":"1024x1024"}' },
  { id: 'bailian', label: '阿里云百炼', protocol: 'bailian', baseUrl: 'https://dashscope.aliyuncs.com', model: 'qwen-image-2.0-pro', size: '2688x1536', quality: '', extra: '' },
  { id: 'bailian-token', label: '百炼 Token Plan', protocol: 'bailian', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com', model: 'qwen-image-3.0-pro', size: '1024x1024', quality: '', extra: '' },
  { id: 'wan', label: '百炼万相（异步）', protocol: 'wan', baseUrl: 'https://dashscope.aliyuncs.com', model: 'wan2.5-t2i-preview', size: '1280x1280', quality: '', extra: '' },
  { id: 'custom', label: '其他自定义', baseUrl: '', model: '', size: '1024x1024', quality: '', extra: '' },
]

// 中文和 English 各用自己的语言写，切错了也认得出来
const LANGUAGES = [
  { value: 'auto', label: () => t('跟随 DeepSeek Harness') },
  { value: 'zh', label: () => '中文' },
  { value: 'en', label: () => 'English' },
]

// 写作工作流：探测能读到的文档，勾选要注入的那几份；只读，不改用户的文件。
// selected 是 null 时按默认勾（文风说明书、平台 skill、自定义路径），用户点过任何一个勾就存成明确的列表
function WritingFlowSettings({ paths, selected, onChange }) {
  const [found, setFound] = React.useState(null)
  const [preview, setPreview] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const lines = paths.split(/\n+/).map(row => row.trim()).filter(Boolean)
  const scanKey = JSON.stringify(lines)
  const selectKey = JSON.stringify([lines, selected])
  React.useEffect(() => {
    let live = true
    setLoading(true)
    // 路径一边打字一边扫，停半秒再读
    const timer = setTimeout(() => scanWritingFlow({ paths: lines, selected }).then((data) => {
      if (!live) return
      setFound(data)
      setLoading(false)
    }), 400)
    return () => { live = false; clearTimeout(timer) }
  }, [scanKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // 勾着的文档真读一遍：界面上写的是会注入的字数（截断后），不是估算
  React.useEffect(() => {
    let live = true
    previewWritingFlow({ paths: lines, selected }).then((data) => { if (live) setPreview(data) })
    return () => { live = false }
  }, [selectKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const docs = (found?.docs ?? []).map(row => ({ ...row, on: !row.error && (Array.isArray(selected) ? selected.includes(row.id) : row.on) }))
  const toggle = (id, on) => {
    const current = docs.filter(row => row.on).map(row => row.id)
    onChange({ paths, selected: on ? [...current, id] : current.filter(row => row !== id) })
  }
  const parts = preview?.parts ?? []
  const chars = parts.reduce((sum, row) => sum + row.text.length, 0)
  const groups = [['style', '文风说明书'], ['skill', '平台写作 skill'], ['method', '方法论沉淀'], ['custom', '自定义']]
  return (
    <div className="md-field md-flow-setting">
      <span>{t('写作工作流（可选）')}</span>
      <small>{t('仅索引独立工作区内的 style.md 和 methods，或你填写的文档路径。DSH 按任务读取相关参考，Skills 使用原生发现机制。个人风格在「写作风格」里配置。')}</small>
      <textarea rows={2} value={paths} onChange={e => onChange({ paths: e.target.value, selected: null })} placeholder={t('留空使用独立工作区；自定义路径一行一个')} aria-label={t('写作工作流路径')} />
      {docs.length ? (
        <div className="md-flow-docs" role="group" aria-label={t('可用的工作流文档')}>
          {groups.filter(([group]) => docs.some(row => row.group === group)).map(([group, label]) => (
            <div key={group} className="md-flow-group">
              <span className="md-flow-group-name">{t(label)}</span>
              {docs.filter(row => row.group === group).map(row => (
                <label key={row.id} className="md-flow-doc" title={row.error ? `${row.path}\n${row.error}` : row.path}>
                  <input type="checkbox" checked={row.on} disabled={Boolean(row.error)} onChange={e => toggle(row.id, e.target.checked)} />
                  <span className="md-flow-doc-name">{row.name}</span>
                  <span className="md-flow-doc-chars">{row.error ? row.error : t('{n} 字', { n: row.chars })}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {loading && !found ? <small className="md-shimmer">{t('正在读…')}</small>
        : docs.length ? <small className={parts.length ? 'is-ok' : ''}>{t('已加载 {n} 份，共 {chars} 字', { n: parts.length, chars })}</small>
          : lines.length ? <small>{t('这个路径下没有找到能读的 Markdown 或文本文件。')}</small>
            : <small>{t('没有探测到工作流文档。填一个路径，或者不管它，照样能成稿。')}</small>}
      {(preview?.dropped ?? []).length ? <small>{t('超出字数上限没有加载：{names}', { names: preview.dropped.map(row => row.name).join('、') })}</small> : null}
      {(preview?.errors ?? []).length ? <small className="is-error">{(preview.errors ?? []).join('；')}</small> : null}
    </div>
  )
}

export function SettingsDialog() {
  useLang()
  const open = useDesk(s => s.settingsOpen)
  const settings = useDesk(s => s.settings)
  const [form, setForm] = React.useState(null)
  const [testing, setTesting] = React.useState(false)
  const [sample, setSample] = React.useState(null)
  const [advanced, setAdvanced] = React.useState(false)
  React.useEffect(() => {
    if (!open || !settings) return
    const { image } = settings
    setForm({ source: image.source ?? 'http', protocol: image.protocol ?? 'openai', language: settings.language ?? 'auto', baseUrl: image.baseUrl, model: image.model, apiKey: '', size: image.size, quality: image.quality, toolSize: image.toolSize ?? '1536x1024', toolQuality: image.toolQuality ?? '', extra: image.extra, exportDir: settings.exportDir ?? '', materialDir: settings.materialDir ?? '', materialExclude: (settings.materialExclude ?? []).join('、'), writingFlowPaths: (settings.writingFlow?.paths ?? []).join('\n'), writingFlowSelected: settings.writingFlow?.selected ?? null, humanize: settings.humanize !== false, generateImages: settings.generateImages !== false, imageCount: settings.imageCount, shotCount: settings.shotCount, wechatAppId: settings.wechat?.appId ?? '', wechatSecret: '', wechatAuthor: settings.wechat?.author ?? '', syncToken: '', notifyEnabled: settings.notify?.enabled === true, notifyWebhook: '', clearNotifyWebhook: false, imageHost: { ...settings.imageHost, token: '' }, autoReadEnabled: settings.autoRead?.enabled !== false, autoReadTime: settings.autoRead?.time ?? '06:30', autoReadEvening: settings.autoRead?.evening ?? '18:30', backstageEnabled: settings.backstage?.enabled === true })
    setSample(null)
  }, [open, settings])
  if (!open || !form) return null
  const close = () => setDesk({ settingsOpen: false })
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const payload = () => ({
    language: form.language,
    image: { source: form.source, protocol: form.protocol, baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey, size: form.size, quality: form.quality, toolSize: form.toolSize, toolQuality: form.toolQuality, extra: form.extra },
    exportDir: form.exportDir, materialDir: form.materialDir, materialExclude: form.materialExclude.split(/[,，、\n]/).map(word => word.trim()).filter(Boolean),
    writingFlow: { paths: form.writingFlowPaths.split(/\n+/).map(row => row.trim()).filter(Boolean), selected: form.writingFlowSelected },
    generateImages: form.generateImages, humanize: form.humanize, imageCount: Number(form.imageCount), shotCount: Number(form.shotCount),
    wechat: { appId: form.wechatAppId, appSecret: form.wechatSecret, author: form.wechatAuthor },
    wechatsync: { token: form.syncToken },
    imageHost: form.imageHost,
    autoRead: { enabled: form.autoReadEnabled, time: form.autoReadTime, evening: form.autoReadEvening },
    backstage: { enabled: form.backstageEnabled },
    notify: { enabled: form.notifyEnabled, webhook: form.notifyWebhook, clearWebhook: form.clearNotifyWebhook },
  })
  const activePreset = PRESETS.find(p => p.baseUrl && p.baseUrl === form.baseUrl && (p.protocol ?? 'openai') === form.protocol)?.id ?? (form.baseUrl ? 'custom' : null)
  return (
    <Dialog title={t('设置')} onClose={close} width={520}>
      <form className="md-form md-settings" onSubmit={async (event) => {
        event.preventDefault()
        if (await saveSettings(payload())) close()
      }}>
        <div className="md-field">
          <span>{t('语言')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('语言')}>
            {LANGUAGES.map(option => (
              <button type="button" key={option.value} role="radio" aria-checked={form.language === option.value} className={form.language === option.value ? 'is-on' : ''} onClick={() => set('language', option.value)}>{option.label()}</button>
            ))}
          </div>
        </div>
        <label className="md-field">
          <span>{t('成稿保存到')}</span>
          <input value={form.exportDir} onChange={e => set('exportDir', e.target.value)} placeholder={settings.defaultExportDir} />
        </label>
        <label className="md-field">
          <span>{t('素材库（可选）')}</span>
          <input value={form.materialDir} onChange={e => set('materialDir', e.target.value)} placeholder={t('一个放 Markdown 笔记的文件夹，比如概念、金句、写过的好稿')} />
          <small>{t('写平台版本前会从这里挑几篇相关的当参考，只读不改；要在你的主目录下。留空就跳过这一步。')}</small>
        </label>
        <label className="md-field">
          <span>{t('素材库里跳过')}</span>
          <input value={form.materialExclude} onChange={e => set('materialExclude', e.target.value)} placeholder={t('比如：说明书、规则、README')} />
          <small>{t('文件名或文件夹名里含这些字的不当素材，用顿号或逗号隔开。默认跳过规则、说明文档和写给 AI 的指令文件。')}</small>
        </label>
        <WritingFlowSettings paths={form.writingFlowPaths} selected={form.writingFlowSelected} onChange={({ paths, selected }) => setForm(f => ({ ...f, writingFlowPaths: paths, writingFlowSelected: selected }))} />

        <div className="md-field md-set-section">
          <span>{t('生图来源')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('生图来源')}>
            {[['http', '图片 API'], ['tool', 'DSH 生成工具']].map(([value, label]) => <button type="button" key={value} role="radio" aria-checked={form.source === value} className={form.source === value ? 'is-on' : ''} onClick={() => set('source', value)}>{t(label)}</button>)}
          </div>
          {form.source === 'tool' ? <>
            <small>{t(settings.imageToolAvailable ? '已检测到生图工具；账号登录和额度以试画结果为准。' : '未找到订阅生图工具，或默认执行器不支持直接调用；请检查插件和执行器后刷新工作台。')}</small>
            <small>{t('复用插件接入 DSH 的订阅生图能力。例如，插件已让你通过 ChatGPT（GPT）订阅在 DSH 中生成图片，工作台就可复用，无需另填图片 API Key。其他国内外服务的订阅也需由插件接入生图功能，并在工作台适配范围内；仅登录订阅或接入聊天模型并不代表支持生图。')}</small>
            <small>{t('当前适配 dsh-plugin-subscriptions。使用的服务、账号及回退规则由该插件决定，工作台不会自动切换到图片 API。')}</small>
            <small>{t('试画和生成图片会消耗订阅账号的生图额度。')}</small>
          </> : null}
        </div>
        {form.source === 'http' ? <>
        <div className="md-field">
          <span>{t('生图模型')}</span>
          <div className="md-presets">
            {PRESETS.map(preset => (
              <button type="button" key={preset.id} className={activePreset === preset.id ? 'is-on' : ''} onClick={() => setForm(f => ({ ...f, protocol: preset.protocol ?? f.protocol, baseUrl: preset.baseUrl, model: preset.model, size: preset.size, quality: preset.quality, extra: preset.extra }))}>{t(preset.label)}</button>
            ))}
          </div>
          <small>{t('支持 OpenAI 兼容图片接口（/images/generations），以及阿里云百炼的千问同步接口和万相异步接口。')}</small>
        </div>
        <label className="md-field">
          <span>{t('接口地址')}</span>
          <input type="url" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} placeholder="https://…/v1" />
        </label>
        <label className="md-field">
          <span>{t('模型')}</span>
          <input value={form.model} onChange={e => set('model', e.target.value)} placeholder={t('模型名称')} />
        </label>
        <label className="md-field">
          <span>{t('密钥')}{settings.image.hasKey ? t('（已保存，末四位 {hint}）', { hint: settings.image.keyHint }) : ''}</span>
          <input type="password" autoComplete="off" value={form.apiKey} onChange={e => set('apiKey', e.target.value)} placeholder={settings.image.hasKey ? t('留空表示不修改') : 'sk-…'} />
          <small>{t('只保存在这台电脑上，不会写进内容数据，也不会被打包或发给模型。')}</small>
        </label>
        </> : null}
        <div className="md-field md-set-section">
          <span>{t('成稿时默认')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('成稿时默认')}>
            {[[true, '同时生成图片'], [false, '只出文字']].map(([value, label]) => (
              <button type="button" key={String(value)} role="radio" aria-checked={form.generateImages === value} className={form.generateImages === value ? 'is-on' : ''} onClick={() => set('generateImages', value)}>{t(label)}</button>
            ))}
          </div>
          <small>{settings.imageReady ? t('每次成稿前还可以单独改。') : t('还没接生图模型：接好之前，成稿时「生成图片」默认不勾，只出文字。')}</small>
        </div>
        <div className="md-field">
          <span>{t('成稿后去 AI 味')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('成稿后去 AI 味')}>
            {[[true, '写完再改一遍'], [false, '不改']].map(([value, label]) => (
              <button type="button" key={String(value)} role="radio" aria-checked={form.humanize === value} className={form.humanize === value ? 'is-on' : ''} onClick={() => set('humanize', value)}>{t(label)}</button>
            ))}
          </div>
          <small>{t('会多调一次文字模型，只改表达，不动事实和小标题。')}</small>
        </div>
        <div className="md-field-row">
          <label className="md-field"><span>{t('配图数量')}</span><input type="number" min="0" max="4" value={form.imageCount} onChange={e => set('imageCount', e.target.value)} /></label>
          <label className="md-field"><span>{t('分镜格数')}</span><input type="number" min="0" max="12" value={form.shotCount} onChange={e => set('shotCount', e.target.value)} /></label>
        </div>
        <div className="md-field md-set-section">
          <span>{t('公众号')}</span>
          <small>{t('填好后，发布页可以把成稿推到公众号草稿箱，最后由你在公众号后台自己点发布。AppID 和 AppSecret 在公众号后台「设置与开发 → 基本配置」里，还要把这台电脑的出口 IP 加进 IP 白名单。')}</small>
        </div>
        <div className="md-field-row">
          <label className="md-field"><span>AppID</span><input autoComplete="off" spellCheck={false} value={form.wechatAppId} onChange={e => set('wechatAppId', e.target.value)} placeholder="wx…" /></label>
          <label className="md-field"><span>{t('作者')}</span><input value={form.wechatAuthor} maxLength={16} onChange={e => set('wechatAuthor', e.target.value)} placeholder={t('可不填')} /></label>
        </div>
        <label className="md-field">
          <span>AppSecret{settings.wechat?.hasSecret ? t('（已保存）') : ''}</span>
          <input type="password" autoComplete="off" value={form.wechatSecret} onChange={e => set('wechatSecret', e.target.value)} placeholder={settings.wechat?.hasSecret ? t('留空表示不修改') : ''} />
          <small>{t('只保存在这台电脑上，不会写进内容数据，也不会被打包或发给模型。')}</small>
        </label>
        <div className="md-field md-set-section">
          <span>{t('每天自动读取账号数据')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('每天自动读取账号数据')}>
            {[[true, '开'], [false, '关']].map(([value, label]) => (
              <button type="button" key={String(value)} role="radio" aria-checked={form.autoReadEnabled === value} className={form.autoReadEnabled === value ? 'is-on' : ''} onClick={() => set('autoReadEnabled', value)}>{t(label)}</button>
            ))}
          </div>
          <small>{t('公开数据（主页链接读的 GitHub、B 站、X、谷歌学术、YouTube）：每天早上读一次；打开大屏时如果超过 6 小时没更新，会在后台再补读一次。')}</small>
          <small>{t('登录后的数据（创作后台）：每天两次，早上和傍晚各一次；打开大屏不会自动去读，想马上看就点「立即读取」，两次手动读取至少隔 10 分钟。')}</small>
        </div>
        {form.autoReadEnabled ? (
          <div className="md-field-row">
            <label className="md-field">
              <span>{t('早上几点读一整轮')}</span>
              <input type="time" required value={form.autoReadTime} onChange={e => set('autoReadTime', e.target.value)} />
              <small>{t('这台电脑的本地时间。DSH 那时没开，打开后补读。')}</small>
            </label>
            <label className="md-field">
              <span>{t('第二轮（只读登录后的数据）')}</span>
              <input type="time" value={form.autoReadEvening} onChange={e => set('autoReadEvening', e.target.value)} />
              <small>{t('清空就是不读第二轮。')}</small>
            </label>
          </div>
        ) : null}
        <div className="md-field">
          <span>{t('登录后的创作后台')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('登录后的创作后台')}>
            {[[true, '开'], [false, '关']].map(([value, label]) => (
              <button type="button" key={String(value)} role="radio" aria-checked={form.backstageEnabled === value} className={form.backstageEnabled === value ? 'is-on' : ''} onClick={() => set('backstageEnabled', value)}>{t(label)}</button>
            ))}
          </div>
          <small>{t('工作台用一个专用浏览器打开小红书、抖音、公众号、视频号、B 站的创作后台首页，只读页面上的文字，交给模型认出粉丝、获赞和近期数据，再核对每个数确实在页面上。不点击、不发布，数据只留在这台电脑上。')}</small>
          <div className="md-pull-row"><button type="button" className="md-btn is-small" onClick={() => loginBackstage()}><Icon name="upRight" size={13} />{t('打开专用浏览器去登录')}</button></div>
        </div>
        <div className="md-field md-set-section">
          <span>{t('提醒推送到手机')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('提醒推送到手机')}>
            {[[true, '开'], [false, '关']].map(([value, label]) => (
              <button type="button" key={String(value)} role="radio" aria-checked={form.notifyEnabled === value} className={form.notifyEnabled === value ? 'is-on' : ''} onClick={() => set('notifyEnabled', value)}>{t(label)}</button>
            ))}
          </div>
          <small>{t('每天自动读取后，某个平台需要重新登录、或者连着几次都没读到数据时，往下面这个地址发一条提醒。没有这些情况就不发。')}</small>
          <label className="md-field">
            <span>{t('Webhook 地址（自定义）')}{settings.notify?.hasWebhook && !form.clearNotifyWebhook ? t('（已保存）') : ''}</span>
            <input autoComplete="off" spellCheck={false} value={form.notifyWebhook} onChange={e => setForm(f => ({ ...f, notifyWebhook: e.target.value, clearNotifyWebhook: false }))} placeholder={settings.notify?.hasWebhook ? t('留空表示不修改') : 'https://…'} />
            {settings.notify?.hasWebhook && !form.clearNotifyWebhook ? <button type="button" className="md-btn is-small" onClick={() => setForm(f => ({ ...f, notifyWebhook: '', clearNotifyWebhook: true }))}>{t('删除地址')}</button> : null}
            <small>{t('收到的是固定格式的 JSON：{title, text, at}，内容是「哪个平台、什么原因、什么时候」。不带稿子内容、账号数据和任何统计数。可以填飞书、钉钉群机器人的转发地址，或你自己的接口。')}</small>
            <small>{t('每个平台每天最多一条，发不出去不会重试。地址和密钥一样只保存在这台电脑上，不写进日志。')}</small>
          </label>
        </div>
        <SyncSettings token={form.syncToken} onToken={value => set('syncToken', value)} hasToken={Boolean(settings.wechatsync?.hasToken)} />
        <ImageHostSettings value={form.imageHost} saved={settings.imageHost} onChange={value => set('imageHost', value)} wechatReady={Boolean(form.wechatAppId && (form.wechatSecret || settings.wechat?.hasSecret))} />
        <button type="button" className="md-advanced" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><Icon name={advanced ? 'chevD' : 'chevR'} size={12} />{t('高级')}</button>
        {advanced ? (
          <>
            {form.source === 'http' ? <>
              <label className="md-field">
                <span>{t('接口协议')}</span>
                <select value={form.protocol} onChange={e => set('protocol', e.target.value)}>
                  <option value="openai">{t('OpenAI 兼容')}</option>
                  <option value="bailian">{t('阿里云百炼')}</option>
                  <option value="wan">{t('百炼万相（异步）')}</option>
                </select>
              </label>
              {form.protocol !== 'openai' ? (
                <label className="md-field">
                  <span>{t('尺寸')}</span>
                  <input value={form.size} onChange={e => set('size', e.target.value)} placeholder={form.protocol === 'wan' ? '1280x1280' : '2688x1536'} />
                  <small>{t('会转成百炼的 宽*高 格式；留空由模型自动选择。')}</small>
                </label>
              ) : (
                <div className="md-field-row">
                  <label className="md-field"><span>{t('尺寸')}</span><input value={form.size} onChange={e => set('size', e.target.value)} placeholder="1536x1024" /></label>
                  <label className="md-field"><span>{t('质量')}</span><input value={form.quality} onChange={e => set('quality', e.target.value)} placeholder="low / medium / high" /></label>
                </div>
              )}
              <label className="md-field">
                <span>{t('附加参数（JSON）')}</span>
                <input value={form.extra} onChange={e => set('extra', e.target.value)} placeholder={form.protocol === 'wan' ? '{"negative_prompt":"人物","prompt_extend":false}' : form.protocol === 'bailian' ? '{"prompt_extend":false,"watermark":false}' : '{"output_format":"jpeg"}'} />
                {form.protocol === 'bailian' ? <small>{t('附加参数会并入百炼请求的 parameters。')}</small> : form.protocol === 'wan' ? <small>{t('附加参数会并入 parameters；negative_prompt 会放进 input。')}</small> : null}
              </label>
            </> : <div className="md-field-row">
              <label className="md-field"><span>{t('尺寸')}</span><select value={form.toolSize} onChange={e => set('toolSize', e.target.value)}><option value="">{t('工具默认')}</option>{['1024x1024', '1024x1536', '1536x1024', 'auto'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className="md-field"><span>{t('质量')}</span><select value={form.toolQuality} onChange={e => set('toolQuality', e.target.value)}><option value="">{t('工具默认')}</option>{['low', 'medium', 'high', 'auto'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            </div>}
          </>
        ) : null}
        {sample ? <img className="md-test-sample" src={sample} alt={t('测试图')} /> : null}
        {/* 设置很长，保存按钮贴在对话框底部，滚到哪都点得到 */}
        <div className="md-form-foot md-settings-foot">
          <button type="button" className="md-btn" disabled={testing} onClick={async () => {
            setTesting(true)
            setSample(null)
            setSample(await testImage(payload()))
            setTesting(false)
          }}>{testing ? <span className="md-shimmer">{t('正在试画…')}</span> : t('试画一张')}</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary">{t('保存')}</button>
        </div>
      </form>
    </Dialog>
  )
}
