// 排版面板里的各个选择器：主题画廊、骨架、封面、字体字号、署名。
// 主题、骨架、封面来自言起 YANQI（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian），言起基于 Note to RED（Yeban8090，MIT）。
import React from 'react'
import { t } from '../i18n.js'
import { Icon } from '../ui.jsx'
import { validateLayoutTheme } from '../../src/layout-theme.js'
import { CARD_RATIOS, COVER_TEMPLATES, COVER_TITLE_MAX, CARD_TEMPLATES, EXPORT_TIERS, HEADING_LEVELS, TIME_FORMATS, YANQI_COVERS, cardSize, formatDate } from './cards.js'
import { THEME_KNOBS, applyKnob, knobValue, newThemeId } from './theme-edit.js'
import { FONT_SIZE_RANGE, YANQI_FONTS, YANQI_GROUPS, YANQI_THEMES, clampFontSize, cssValue, fontFamily, themeSwatch } from './yanqi.js'

// 缩略图的底：主题自己的底色、底纹和底纹尺寸
function swatchOf(theme) {
  const preview = theme.styles.imagePreview
  const sw = themeSwatch(theme)
  return { ...sw, style: { backgroundColor: cssValue(preview, 'background-color') ?? sw.bg, backgroundImage: cssValue(preview, 'background-image'), backgroundSize: cssValue(preview, 'background-size') } }
}

const SWATCHES = new Map(YANQI_THEMES.map(theme => [theme.id, swatchOf(theme)]))
const MINE = '我的主题'

/** 面板里的一组：小标题 + 内容。 */
export function PanelGroup({ title, aside, children }) {
  return (
    <section className="md-yq-group">
      <header className="md-yq-group-head">
        <h3>{title}</h3>
        {aside ? <span className="md-yq-group-aside">{aside}</span> : null}
      </header>
      {children}
    </section>
  )
}

/** 主题缩略图：用主题自己的底色、标题色、强调色画一张小卡。 */
function Swatch({ theme, font }) {
  const sw = SWATCHES.get(theme.id) ?? swatchOf(theme)
  return (
    <span className={`md-yq-swatch ${sw.dark ? 'is-dark' : ''}`} aria-hidden="true" style={sw.style}>
      <b style={{ color: sw.title, fontFamily: font }}>Aa</b>
      <i style={{ background: sw.accentBg ?? sw.accent, boxShadow: sw.accentBg ? `inset 3px 0 0 ${sw.accent}` : 'none' }} />
      <s style={{ background: sw.text }} />
      <s style={{ background: sw.text, width: '58%' }} />
    </span>
  )
}

/** 30 套主题 + 我的主题：分组 + 搜索，网格里每套一张小卡。 */
export function ThemeGallery({ value, onChange, font, custom = [], onEdit, onDelete }) {
  const [group, setGroup] = React.useState('')
  const [query, setQuery] = React.useState('')
  const all = React.useMemo(() => [...custom.map(theme => ({ ...theme, group: MINE, mine: true })), ...YANQI_THEMES], [custom])
  const current = all.find(theme => theme.id === value) ?? YANQI_THEMES[0]
  const needle = query.trim().toLowerCase()
  const shown = all.filter(theme => (!group || theme.group === group) && (!needle || [theme.name, t(theme.name), theme.id, theme.description, theme.group].some(text => String(text ?? '').toLowerCase().includes(needle))))
  const family = fontFamily(font)
  const grid = React.useRef(null)
  const groups = custom.length ? [MINE, ...YANQI_GROUPS] : YANQI_GROUPS
  // 打开时把选中的主题滚到看得见的地方，只动网格自己的滚动条
  React.useEffect(() => {
    const box = grid.current
    const tile = box?.querySelector('.md-yq-theme.is-on')
    if (tile && (tile.offsetTop < box.scrollTop || tile.offsetTop + tile.offsetHeight > box.scrollTop + box.clientHeight)) box.scrollTop = tile.offsetTop - box.offsetTop - 6
  }, [group]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <PanelGroup title={t('主题')} aside={current.mine ? current.name : t(current.name)}>
      <div className="md-yq-theme-tools">
        <p className="md-yq-hint">{current.mine ? (current.description || t('我的主题')) : t(current.description)}</p>
        {onEdit ? <button type="button" className="md-pill is-small" onClick={onEdit}><Icon name="palette" size={13} />{t('编辑主题')}</button> : null}
      </div>
      <label className="md-yq-search">
        <Icon name="search" size={14} />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('搜主题')} aria-label={t('搜主题')} />
      </label>
      <div className="md-yq-chips" role="tablist" aria-label={t('主题分组')}>
        {['', ...groups].map(name => (
          <button key={name || 'all'} type="button" role="tab" aria-selected={group === name} className={group === name ? 'is-on' : ''} onClick={() => setGroup(name)}>
            {name ? t(name) : t('全部')}
          </button>
        ))}
      </div>
      <div ref={grid} className="md-yq-themes" role="radiogroup" aria-label={t('主题')}>
        {shown.map(theme => (
          <div key={theme.id} className={`md-yq-theme-cell ${theme.mine ? 'is-mine' : ''}`}>
            <button type="button" role="radio" aria-checked={value === theme.id} className={`md-yq-theme ${value === theme.id ? 'is-on' : ''}`} title={theme.mine ? theme.name : `${t(theme.name)} · ${t(theme.description)}`} onClick={() => onChange(theme.id)}>
              <Swatch theme={theme} font={family} />
              <span className="md-yq-theme-name">{theme.mine ? theme.name : t(theme.name)}</span>
            </button>
            {theme.mine && onDelete ? <button type="button" className="md-yq-theme-del" aria-label={t('删除「{name}」', { name: theme.name })} title={t('删除')} onClick={() => onDelete(theme)}><Icon name="close" size={11} /></button> : null}
          </div>
        ))}
        {!shown.length ? <p className="md-yq-empty">{t('没有找到这个主题')}</p> : null}
      </div>
    </PanelGroup>
  )
}

/**
 * 主题编辑器（同言起 CreateThemeModal）：以当前主题为底，取色器改颜色，滑杆改字号行距，改动立刻显示在预览里。
 * 「保存为我的主题」先在本地按 Host 同一套规则校验，再交给 onSave。
 */
export function ThemeEditor({ base, onDraft, onSave, onClose, onError }) {
  const [styles, setStyles] = React.useState(base.styles)
  const [name, setName] = React.useState(base.mine ? base.name : '')
  const groups = [...new Set(THEME_KNOBS.map(knob => knob.group))]
  const change = (knob, value) => {
    const next = applyKnob(styles, knob, value)
    setStyles(next)
    onDraft(next)
  }
  const save = () => {
    const label = name.trim()
    if (!label) { onError(t('主题名称不能为空')); return }
    try {
      const theme = validateLayoutTheme({ id: base.mine ? base.id : newThemeId(label), name: label, description: t('基于「{name}」', { name: base.mine ? base.name : t(base.name) }), base: base.mine ? base.base : base.id, styles })
      onSave(theme)
    } catch (err) {
      onError(t(err.message))
    }
  }
  return (
    <section className="md-yq-group md-yq-editor" aria-label={t('主题编辑器')}>
      <header className="md-yq-group-head">
        <h3>{t('主题编辑器')}</h3>
        <span className="md-yq-group-aside">{t('基于「{name}」', { name: base.mine ? base.name : t(base.name) })}</span>
      </header>
      {groups.map(group => (
        <div key={group} className="md-yq-subgroup">
          <span className="md-yq-subhead">{t(group)}</span>
          <div className="md-yq-knobs">
            {THEME_KNOBS.filter(knob => knob.group === group).map((knob) => {
              const value = knobValue(styles, knob)
              return (
                <label key={knob.id} className={`md-yq-knob is-${knob.kind}`} title={knob.hint ? t(knob.hint) : undefined}>
                  <span>{t(knob.name)}</span>
                  {knob.kind === 'color'
                    ? <input type="color" value={value} onChange={event => change(knob, event.target.value)} aria-label={t(knob.name)} />
                    : (
                      <span className="md-yq-knob-range">
                        <input type="range" min={knob.min} max={knob.max} step={knob.step} value={value} onChange={event => change(knob, Number(event.target.value))} aria-label={t(knob.name)} />
                        <output>{knob.kind === 'em' ? `${value}em` : knob.kind === 'px' ? `${value}px` : value}</output>
                      </span>
                    )}
                </label>
              )
            })}
          </div>
        </div>
      ))}
      <label className="md-yq-field">
        <span>{t('主题名称')}</span>
        <input type="text" value={name} maxLength={30} placeholder={t('比如：我的暖色')} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') save() }} />
      </label>
      <div className="md-yq-row">
        <button type="button" className="md-pill is-primary is-small" onClick={save}><Icon name="save" size={13} />{base.mine ? t('保存修改') : t('保存为我的主题')}</button>
        <button type="button" className="md-pill is-small" onClick={() => { setStyles(base.styles); onDraft(base.styles) }}><Icon name="undo" size={13} />{t('还原')}</button>
        <span className="md-grow" />
        <button type="button" className="md-pill is-small" onClick={onClose}>{t('关闭')}</button>
      </div>
      <p className="md-yq-hint">{t('保存在工作台数据里，长文和图文卡片都能用')}</p>
    </section>
  )
}

/** 骨架小图：页眉、正文、页脚三条，示意外壳长什么样。 */
function TemplateGlyph({ id }) {
  const head = { 'minimal-cover': 0, signature: 0, notes: 1, newspaper: 2, quote: 3, terminal: 4, github: 4 }[id]
  const foot = { notes: 0, xhs: 2, weibo: 2, quote: 3, signature: 3 }[id]
  return (
    <span className={`md-yq-glyph is-h${head ?? 5} is-f${foot ?? 1}`} aria-hidden="true">
      <i /><s /><s /><s /><u />
    </span>
  )
}

/** 12 套骨架，按言起的三组排。 */
export function TemplatePicker({ value, onChange }) {
  const groups = [...new Set(CARD_TEMPLATES.map(row => row.group))]
  return (
    <PanelGroup title={t('骨架')} aside={t(CARD_TEMPLATES.find(row => row.id === value)?.name ?? '')}>
      {groups.map(group => (
        <div key={group} className="md-yq-subgroup">
          <span className="md-yq-subhead">{t(group)}</span>
          <div className="md-yq-options" role="radiogroup" aria-label={t(group)}>
            {CARD_TEMPLATES.filter(row => row.group === group).map(row => (
              <button key={row.id} type="button" role="radio" aria-checked={value === row.id} className={value === row.id ? 'is-on' : ''} onClick={() => onChange(row.id)}>
                <TemplateGlyph id={row.id} />
                <span>{t(row.name)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </PanelGroup>
  )
}

const CHECK_LABEL = {
  length: ['标题字数 {v}', '建议 12 字以内，最多 16 字'],
  lines: ['标题 {v} 行', '信息流里两行以内最好读'],
  size: ['标题字号约 {v}', '按 1080 宽算，建议不小于 70px（信息流缩略图约缩小到 0.17 倍）'],
  contrast: ['文字对比度 {v}', 'WCAG 2.2：正文至少 4.5:1，大字至少 3:1'],
  area: ['文字面积 {v}', '建议 8%–70%，图片封面少一些字'],
  margin: ['最小边距 {v}', '左右至少留 8%，信息流裁切时不贴边'],
  fit: ['文字都放得下', '自动排字后仍然放不下时会提示'],
  image: ['文字压在图上 {v}', '人物或主体那块别被字盖住，建议不超过 15%'],
  claims: ['标题里的数字正文里都有', '封面说的数字正文里要能找到，不做标题党'],
}

/** 封面检查：几条能打勾的规则，见 covers.js 的 coverChecks。 */
export function CoverChecks({ checks }) {
  if (!checks?.length) return null
  const bad = checks.filter(row => row.state !== 'ok').length
  return (
    <div className="md-yq-checks" role="list" aria-label={t('封面检查')}>
      <span className="md-yq-subhead">{t('封面检查')}<b className={bad ? 'is-warn' : 'is-ok'}>{bad ? t('{n} 项要看一下', { n: bad }) : t('全部通过')}</b></span>
      {checks.map(row => (
        <span key={row.id} role="listitem" className={`md-yq-check-row is-${row.state}`} title={t(CHECK_LABEL[row.id][1])}>
          <i aria-hidden="true">{row.state === 'ok' ? '✓' : row.state === 'warn' ? '!' : '✕'}</i>
          {t(CHECK_LABEL[row.id][0], { v: row.value })}
        </span>
      ))}
    </div>
  )
}

/** 言起的 5 种封面 + 新增的固定版式封面；固定版式的封面下面再填槽位。最上面是封面标题（所有封面都用）。 */
export function CoverPicker({ value, onChange, slots, onSlots, images = [], checks, safeArea, onSafeArea, fallbackTitle = '' }) {
  const template = COVER_TEMPLATES.find(row => row.id === value)
  const row = (list, kind) => (
    <div className={`md-yq-covers is-${kind}`} role="radiogroup" aria-label={t(kind === 'yanqi' ? '言起封面' : '固定版式')}>
      {list.map(item => (
        <button key={item.id} type="button" role="radio" aria-checked={value === item.id} className={value === item.id ? 'is-on' : ''} title={t(item.hint)} onClick={() => onChange(item.id)}>
          <span className={`md-yq-cover-glyph is-${item.id}`} aria-hidden="true"><i /><s /><s /></span>
          <span>{t(item.name)}</span>
        </button>
      ))}
    </div>
  )
  const field = (key, label, placeholder, max) => (
    <label className="md-yq-field">
      <span>{label}</span>
      <input type="text" value={slots?.[key] ?? ''} maxLength={max} placeholder={placeholder} onChange={event => onSlots({ [key]: event.target.value })} />
    </label>
  )
  return (
    <PanelGroup title={t('封面')} aside={t('只影响第一页')}>
      <CoverTitleField value={slots?.title} fallback={fallbackTitle} onChange={title => onSlots({ title })} />
      <span className="md-yq-subhead">{t('言起封面')}</span>
      {row(YANQI_COVERS, 'yanqi')}
      <span className="md-yq-subhead md-yq-subhead-gap">{t('固定版式（开头几段挪到第 2 页）')}</span>
      {row(COVER_TEMPLATES, 'fixed')}
      {template ? (
        <div className="md-yq-slots">
          <p className="md-yq-hint">{t(template.hint)}</p>
          <div className="md-yq-field-row">
            {template.slots.includes('kicker') ? field('kicker', t('引子 / 刊名'), t('一句短话'), 30) : null}
            {template.slots.includes('tag') ? field('tag', t('标签'), t('比如：干货'), 16) : null}
          </div>
          {template.slots.includes('number') ? field('number', t('编号 / 数字'), t('比如 06，空着就从标题里找'), 8) : null}
          {template.slots.includes('image') ? (
            <label className="md-yq-field">
              <span>{t('配图')}</span>
              <select value={slots?.image ?? ''} onChange={event => onSlots({ image: event.target.value })}>
                <option value="">{t('不用配图')}</option>
                {images.map(image => <option key={image.src} value={image.src}>{image.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <label className="md-yq-check md-yq-safe">
        <input type="checkbox" checked={Boolean(safeArea)} onChange={event => onSafeArea(event.target.checked)} />
        <span>{t('显示安全区')}</span>
      </label>
      <CoverChecks checks={checks} />
    </PanelGroup>
  )
}

/** 卡片比例和导出像素。小红书一篇笔记跟第一张图的比例走，整组要一致。 */
export function SizePicker({ ratio, tier, onRatio, onTier }) {
  const size = cardSize(ratio, tier)
  return (
    <PanelGroup title={t('尺寸')} aside={`${size.exportWidth}×${size.exportHeight}`}>
      <div className="md-yq-seg4" role="radiogroup" aria-label={t('卡片比例')}>
        {CARD_RATIOS.map(row => (
          <button key={row.id} type="button" role="radio" aria-checked={ratio === row.id} className={ratio === row.id ? 'is-on' : ''} onClick={() => onRatio(row.id)} title={`${t(row.platform)} · ${t(row.name)}`}>
            <span className={`md-yq-ratio is-r${row.id.replace(':', '-')}`} aria-hidden="true" />
            <span>{row.id}</span>
            <small>{t(row.platform)}</small>
          </button>
        ))}
      </div>
      <div className="md-yq-seg3" role="radiogroup" aria-label={t('导出像素')}>
        {EXPORT_TIERS.map((value) => {
          const out = cardSize(ratio, value)
          return (
            <button key={value} type="button" role="radio" aria-checked={Number(tier) === value} className={Number(tier) === value ? 'is-on' : ''} onClick={() => onTier(value)}>
              {out.exportWidth}×{out.exportHeight}
            </button>
          )
        })}
      </div>
      <p className="md-yq-hint">{t('小红书一篇笔记的比例跟第一张图走，整组导出用同一个比例')}</p>
    </PanelGroup>
  )
}

/** 按几级标题分页（同言起「内容分割标题级别」）。 */
export function PagingPicker({ value, onChange }) {
  return (
    <PanelGroup title={t('分页')} aside={t('每个小标题一张卡')}>
      <div className="md-yq-seg3" role="radiogroup" aria-label={t('按几级标题分页')}>
        {HEADING_LEVELS.map(level => (
          <button key={level} type="button" role="radio" aria-checked={value === level} className={value === level ? 'is-on' : ''} onClick={() => onChange(level)}>
            {'#'.repeat(level)} {t(['一级标题', '二级标题', '三级标题'][level - 1])}
          </button>
        ))}
      </div>
      <p className="md-yq-hint">{t('小标题下面用 --- 还能手动分页，每页都带标题')}</p>
    </PanelGroup>
  )
}

const BUILTIN_BACKGROUNDS = [1, 2, 3, 4, 5, 6].map(n => `media-desk/assets/yanqi-bg-${n}.jpg`)

/**
 * 背景图（同言起 BackgroundSettingModal）：6 张内置底图或自己上传，滑杆缩放（0.1–2），在小预览上拖动调位置。
 * value 是 { src, scale, x, y }；src 是内置底图地址或 data URL。
 */
export function BackgroundPicker({ value, onChange, onPick, ratio }) {
  const fileRef = React.useRef(null)
  const box = React.useRef(null)
  const size = cardSize(ratio)
  const mini = 132 / size.width
  const bg = value?.src ? value : null
  const set = patch => onChange({ scale: 1, x: 0, y: 0, ...bg, ...patch })
  const drag = (event) => {
    if (!bg) return
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, ox: bg.x, oy: bg.y }
    const el = event.currentTarget
    el.setPointerCapture(event.pointerId)
    el.classList.add('is-dragging')
    const move = (e) => onChange({ ...bg, x: Math.round(start.ox + (e.clientX - start.x) / mini), y: Math.round(start.oy + (e.clientY - start.y) / mini) })
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.classList.remove('is-dragging') }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <details className="md-yq-group md-yq-sign md-yq-bg">
      <summary className="md-yq-group-head">
        <h3>{t('背景图')}</h3>
        <span className="md-yq-group-aside">{bg ? t('已设置') : t('不用')}</span>
        <Icon name="chevD" size={14} />
      </summary>
      <div className="md-yq-bg-thumbs">
        {BUILTIN_BACKGROUNDS.map(src => (
          <button key={src} type="button" className={bg?.src === src ? 'is-on' : ''} aria-label={t('内置底图')} onClick={() => onChange({ src, scale: 1, x: 0, y: 0 })}><img src={src} alt="" loading="lazy" /></button>
        ))}
        <button type="button" className="md-yq-bg-add" aria-label={t('上传背景图')} onClick={() => fileRef.current?.click()}><Icon name="upload" size={15} /></button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onPick(file) }} />
      </div>
      {bg ? (
        <>
          <div ref={box} className="md-yq-bg-stage" style={{ width: size.width * mini, height: size.height * mini, backgroundImage: `url(${bg.src})`, backgroundSize: `${bg.scale * 100}%`, backgroundPosition: `${bg.x * mini}px ${bg.y * mini}px` }} onPointerDown={drag} title={t('拖动调整位置')} />
          <label className="md-yq-knob is-num">
            <span>{t('缩放')}</span>
            <span className="md-yq-knob-range">
              <input type="range" min="0.1" max="2" step="0.01" value={bg.scale} onChange={event => set({ scale: Number(event.target.value) })} aria-label={t('缩放')} />
              <output>{Math.round(bg.scale * 100)}%</output>
            </span>
          </label>
          <div className="md-yq-row">
            <button type="button" className="md-pill is-small" onClick={() => set({ scale: 1, x: 0, y: 0 })}>{t('复位')}</button>
            <button type="button" className="md-pill is-small" onClick={() => onChange(null)}>{t('清除图片')}</button>
          </div>
        </>
      ) : null}
      <p className="md-yq-hint">{t('背景图铺在主题底色上，文字颜色不变；选浅一点的图更好读')}</p>
    </details>
  )
}

/**
 * 字体（只是 CSS 字体栈，系统没有的字会退回系统字体）和字号：一个下拉 + 一个 − 16 + 步进器。
 * 同言起：两样都放在预览上面那一条里常驻，不藏进样式面板（言起的工具栏也是这样摆的）。
 */
export function FontControls({ font, size, onFont, onSize }) {
  const step = delta => onSize(clampFontSize(size + delta, size))
  return (
    <div className="md-yq-font">
      <select value={font} onChange={event => onFont(event.target.value)} aria-label={t('字体')} title={t('电脑上没装的字体会用系统字体代替')} style={{ fontFamily: fontFamily(font) }}>
        {YANQI_FONTS.map(row => <option key={row.id} value={row.id}>{t(row.name)}</option>)}
      </select>
      <div className="md-yq-stepper" role="group" aria-label={t('字号')} title={t('字号')}>
        <button type="button" onClick={() => step(-FONT_SIZE_RANGE.step)} disabled={size <= FONT_SIZE_RANGE.min} aria-label={t('字号减小')}>−</button>
        <output aria-live="polite">{size}</output>
        <button type="button" onClick={() => step(FONT_SIZE_RANGE.step)} disabled={size >= FONT_SIZE_RANGE.max} aria-label={t('字号增大')}>+</button>
      </div>
    </div>
  )
}

/**
 * 封面标题：只改图文卡片封面上印的字，不动稿子标题；空着就用稿子标题（占位文字里看得到）。
 * 存在这篇内容自己的封面槽位里，预览、导出图片、ZIP 文件名用的都是它。
 */
export function CoverTitleField({ value, fallback, onChange, inputRef, compact = false }) {
  return (
    <label className={compact ? 'md-yq-cover-title is-compact' : 'md-yq-field md-yq-cover-title'}>
      <span>{t('封面标题')}</span>
      <span className="md-yq-cover-title-box">
        <input
          ref={inputRef}
          type="text"
          value={value ?? ''}
          maxLength={COVER_TITLE_MAX}
          placeholder={fallback || t('空着就用稿子标题')}
          title={t('只改卡片封面上的标题，不改稿子标题；空着就用稿子标题')}
          onChange={event => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur() }}
        />
        {value ? <button type="button" aria-label={t('改回稿子标题')} title={t('改回稿子标题')} onClick={() => onChange('')}><Icon name="close" size={11} /></button> : null}
      </span>
    </label>
  )
}

/** 头像缩成 128×128 的 PNG，存得下也不拖慢导出。 */
function shrinkAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('读不了这张图片')))
    }
    img.src = url
  })
}

/** 署名：头像、名字、账号、页脚文字。只存在这台设备上，默认都是空的。 */
export function SignatureForm({ value, onChange, onError }) {
  const fileRef = React.useRef(null)
  const set = key => event => onChange({ ...value, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
  const pick = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      onChange({ ...value, avatar: await shrinkAvatar(file) })
    } catch (err) {
      onError(err.message)
    }
  }
  const field = (key, label, placeholder) => (
    <label className="md-yq-field">
      <span>{label}</span>
      <input type="text" value={value[key] ?? ''} maxLength={40} placeholder={placeholder} onChange={set(key)} />
    </label>
  )
  return (
    <details className="md-yq-group md-yq-sign">
      <summary className="md-yq-group-head">
        <h3>{t('署名')}</h3>
        <span className="md-yq-group-aside">{value.name || t('未填写')}</span>
        <Icon name="chevD" size={14} />
      </summary>
      <div className="md-yq-avatar-row">
        <span className="md-yq-avatar">{value.avatar ? <img src={value.avatar} alt="" /> : <Icon name="user" size={18} />}</span>
        <button type="button" className="md-pill is-small" onClick={() => fileRef.current?.click()}>{value.avatar ? t('换头像') : t('上传头像')}</button>
        {value.avatar ? <button type="button" className="md-pill is-small" onClick={() => onChange({ ...value, avatar: '' })}>{t('移除')}</button> : null}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
      </div>
      {field('name', t('名字'), t('印在页眉上'))}
      {field('id', t('账号'), t('比如 @你的账号'))}
      <div className="md-yq-field-row">
        {field('left', t('页脚左侧'), t('一句话'))}
        {field('right', t('页脚右侧'), t('一句话'))}
      </div>
      <div className="md-yq-field-row is-tight">
        <label className="md-yq-check">
          <input type="checkbox" checked={value.showDate !== false} onChange={set('showDate')} />
          <span>{t('页眉显示日期')}</span>
        </label>
        <label className="md-yq-check">
          <input type="checkbox" checked={value.showFooter !== false} onChange={set('showFooter')} />
          <span>{t('显示页脚')}</span>
        </label>
      </div>
      {value.showDate !== false ? (
        <label className="md-yq-field">
          <span>{t('日期格式')}</span>
          <select value={value.timeFormat ?? 'zh-CN'} onChange={set('timeFormat')}>
            {TIME_FORMATS.map(format => <option key={format} value={format}>{formatDate(new Date(), format)}{/^[a-z]{2}-/.test(format) ? ` · ${format}` : ''}</option>)}
          </select>
        </label>
      ) : null}
      <p className="md-yq-hint">{t('只保存在这台设备上，不会上传')}</p>
    </details>
  )
}

/** 面板底部的署名：主题和版式的出处。 */
export function Credit() {
  return <p className="md-yq-credit">{t('排版主题来自言起 YANQI（阿东玩AI），基于 Note to RED（Yeban8090，MIT）')}</p>
}
