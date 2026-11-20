// 风格卡里「各平台的写法」的编辑框：每个平台一段规则文字，加上流程要用到的数、禁用词、自检项和交稿前自己过的清单。
import React from 'react'
import { dispatchOps } from './desk.js'
import { t } from './i18n.js'
import { Dialog } from './ui.jsx'
import { PLATFORMS } from './util.js'
import { CHECKS, checksFor, KNOBS, knobsOf, LANGS, RULES_MAX } from '../src/platform-rules.js'
import { effectiveSpec } from '../src/platform-rules.js'
import flowCss from './version-flow.css'

const LANG_TEXT = { auto: '跟随界面', zh: '中文', en: '英文' }
const lines = value => String(value ?? '').split('\n').map(row => row.trim()).filter(Boolean)
const words = value => String(value ?? '').split(/[、,，\n]/).map(row => row.trim()).filter(Boolean)

/** 一个平台的编辑区。没填的数用平台默认值做占位提示。 */
function PlatformForm({ platform, block, onChange }) {
  const defaults = effectiveSpec(platform, null)
  const hint = {
    titleMax: defaults?.title?.max, bodyMin: defaults?.body?.min, bodyMax: defaults?.body?.max, tagsMin: defaults?.tags.min, tagsMax: defaults?.tags.max,
    cardsMin: defaults?.cards?.min, cardsMax: defaults?.cards?.max, cardChars: defaults?.cards?.perCard, cardImageChars: defaults?.cards?.perImageCard, cardMinChars: defaults?.cards?.minCard,
    cardsTotalMin: defaults?.cards?.total.min, cardsTotalMax: defaults?.cards?.total.max, cardTitleMin: defaults?.cards?.heading.min, cardTitleMax: defaults?.cards?.heading.max,
    postMax: defaults?.post?.max, threadMin: defaults?.post?.threadMin, threadMax: defaults?.post?.threadMax,
  }
  const set = patch => onChange({ ...block, ...patch })
  const all = checksFor(platform)
  const on = new Set(block.checks?.length ? block.checks : all)
  const toggle = (id) => {
    const next = new Set(on)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({ checks: all.filter(row => next.has(row)) })
  }
  return (
    <div className="md-plat-rules">
      <label className="md-field">
        <span>{t('{platform}的写法', { platform: t(platform) })}</span>
        <textarea rows={10} maxLength={RULES_MAX} value={block.rules ?? ''} onChange={e => set({ rules: e.target.value })} placeholder={t('结构、开头、结尾、标题怎么起、哪些写法不要……整段贴进来，写这个平台的版本时照着写')} />
        <small>{t('{n} / {max} 字', { n: (block.rules ?? '').length, max: RULES_MAX })}</small>
      </label>
      <div className="md-plat-knobs">
        {knobsOf(platform).map(key => (
          <label key={key}>
            <span>{t(KNOBS[key])}</span>
            <input type="number" min={0} value={block[key] ?? ''} placeholder={hint[key] !== undefined ? String(hint[key]) : t('不查')} onChange={e => set({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </label>
        ))}
        <label>
          <span>{t('用什么语言写')}</span>
          <select value={block.lang ?? 'auto'} onChange={e => set({ lang: e.target.value })}>{LANGS.map(row => <option key={row} value={row}>{t(LANG_TEXT[row])}</option>)}</select>
        </label>
      </div>
      <label className="md-field">
        <span>{t('禁用词')}</span>
        <textarea rows={2} value={(block.banned ?? []).join('、')} onChange={e => set({ banned: words(e.target.value) })} placeholder={t('用顿号分隔，自检时一个都不能有')} />
      </label>
      <div className="md-field">
        <span>{t('自检项（不调模型，没过的才让模型改一次）')}</span>
        <div className="md-plat-checks">
          {all.map(id => <label key={id}><input type="checkbox" checked={on.has(id)} onChange={() => toggle(id)} /><span>{t(CHECKS[id].label)}</span></label>)}
        </div>
      </div>
      <label className="md-field">
        <span>{t('交稿前自己过的清单')}</span>
        <textarea rows={4} value={(block.review ?? []).join('\n')} onChange={e => set({ review: lines(e.target.value) })} placeholder={t('一行一条，会写进提示词，也会列在版本卡片上给你自己看')} />
      </label>
    </div>
  )
}

/** 编辑一张风格卡的各平台写法和配图偏好。 */
/** 风格卡片带动画和裁切，这个框要放在风格页最外层，不能放在卡片里。 */
export function PlatformRulesDialog({ style, onClose }) {
  const [platform, setPlatform] = React.useState('小红书')
  const [value, setValue] = React.useState(() => structuredClone(style.platforms ?? {}))
  const [visual, setVisual] = React.useState(style.visual ?? '')
  const save = async () => {
    // 空的数不存，交给平台默认值
    const clean = Object.fromEntries(Object.entries(value).map(([key, block]) => [key, Object.fromEntries(Object.entries(block).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)))]).filter(([, block]) => Object.keys(block).length))
    const result = await dispatchOps([{ op: 'update_style', id: style.id, platforms: clean, visual }], { label: t('修改各平台写法') })
    if (result) onClose()
  }
  return (
    <Dialog title={t('「{name}」的各平台写法', { name: style.name })} onClose={onClose} width={760}>
      <style>{flowCss}</style>
      <div className="md-form">
        <p className="md-muted">{t('写平台版本时按这里来：先判断素材、翻旧稿和素材库，再按这里的写法起草，然后按这里的数自检，没过的项让模型定向改一次。')}</p>
        <div className="md-plat-tabs" role="tablist">
          {PLATFORMS.map(name => <button key={name} type="button" role="tab" aria-selected={platform === name} className={`md-pill is-small ${platform === name ? 'is-primary' : ''}`} onClick={() => setPlatform(name)}>{t(name)}{value[name]?.rules ? ' ·' : ''}</button>)}
        </div>
        <PlatformForm key={platform} platform={platform} block={value[platform] ?? {}} onChange={block => setValue(current => ({ ...current, [platform]: block }))} />
        <label className="md-field">
          <span>{t('配图偏好')}</span>
          <textarea rows={3} maxLength={6000} value={visual} onChange={e => setVisual(e.target.value)} placeholder={t('配图的类型、颜色和画风，比如「架构和流程图，主色深青，简洁矢量」。提议配图和生图时都会带上')} />
        </label>
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <button type="button" className="md-btn is-primary" onClick={save}>{t('保存')}</button>
        </div>
      </div>
    </Dialog>
  )
}
