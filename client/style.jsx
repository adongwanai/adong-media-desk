// 风格：按博主类型分板块的预设，加上从自己账号提炼的专属风格。选哪张，就按哪张写。
import React from 'react'
import { dispatchOps, exportSkills, extractStyle, learnSkills, setDesk, useDesk, toast } from './desk.js'
import { PlatformRulesDialog } from './style-platforms.jsx'
import { lang, t, useLang } from './i18n.js'
import { StyleGlyph } from './style-picker.jsx'
import { Dialog, Icon, IconButton } from './ui.jsx'
import { STYLE_CATEGORIES, styleIcon } from './util.js'

function AddStyleDialog({ initialTab, onClose }) {
  const [tab, setTab] = React.useState(initialTab)
  const [text, setText] = React.useState('')
  const [urls, setUrls] = React.useState('')
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    const ok = await extractStyle(tab === 'text' ? { text, name } : { urls: urls.split(/\s+/).filter(Boolean), name })
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Dialog title={t('添加我的风格')} onClose={onClose} width={520}>
      <div className="md-capture-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'is-on' : ''} onClick={() => setTab('text')}>{t('贴内容')}</button>
        <button type="button" role="tab" aria-selected={tab === 'url'} className={tab === 'url' ? 'is-on' : ''} onClick={() => setTab('url')}>{t('贴链接')}</button>
      </div>
      <form className="md-form" onSubmit={submit}>
        {tab === 'text' ? (
          <label className="md-field">
            <span>{t('内容')}</span>
            <textarea rows={8} required value={text} onChange={e => setText(e.target.value)} placeholder={t('贴几篇你写过的稿子，越多越准。')} />
          </label>
        ) : (
          <label className="md-field">
            <span>{t('链接')}</span>
            <textarea rows={4} required value={urls} onChange={e => setUrls(e.target.value)} placeholder={t('你自己发过的内容链接\n一行一个，最多 5 个')} />
            <small>{t('只读公开页面。小红书、抖音、B 站和 TikTok、Instagram、X 要登录才能看，这几个平台请改用贴内容。')}</small>
          </label>
        )}
        <label className="md-field">
          <span>{t('名字（可选）')}</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('比如我的口播风格')} />
        </label>
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary" disabled={busy}>{busy ? <span className="md-shimmer">{t('正在提炼…')}</span> : t('提炼风格')}</button>
        </div>
      </form>
    </Dialog>
  )
}

function editStyle(style) {
  const sep = lang() === 'en' ? ', ' : '、'
  setDesk({
    dialog: {
      title: t('编辑风格'),
      initial: { ...style, icon: styleIcon(style), words: (style.words ?? []).join(sep), avoid: (style.avoid ?? []).join(sep) },
      fields: [
        { name: 'name', label: t('名字'), required: true },
        { name: 'icon', label: t('图标'), hint: t('一个 emoji') },
        { name: 'summary', label: t('一句话概括'), type: 'textarea', rows: 2 },
        { name: 'tone', label: t('语气'), type: 'textarea', rows: 2 },
        { name: 'sentences', label: t('句式'), type: 'textarea', rows: 2 },
        { name: 'opening', label: t('开头'), type: 'textarea', rows: 2 },
        { name: 'structure', label: t('结构'), type: 'textarea', rows: 2 },
        { name: 'words', label: t('常用词'), hint: t('用顿号分隔') },
        { name: 'avoid', label: t('绝不要'), hint: t('用顿号分隔') },
        { name: 'guide', label: t('完整写作规则'), type: 'textarea', rows: 8, hint: t('可以把自己的写作说明整段贴进来，每次成稿都会照着写') },
      ],
      onSubmit: (values) => {
        const list = value => String(value ?? '').split(/[、,，]/).map(v => v.trim()).filter(Boolean)
        dispatchOps([{ op: 'update_style', id: style.id, name: values.name, icon: values.icon ?? '', guide: values.guide ?? '', summary: values.summary ?? '', tone: values.tone ?? '', sentences: values.sentences ?? '', opening: values.opening ?? '', structure: values.structure ?? '', words: list(values.words), avoid: list(values.avoid) }], { label: t('修改风格') })
      },
      onDelete: style.preset ? undefined : () => dispatchOps([{ op: 'delete_style', id: style.id }], { label: t('删除风格「{name}」', { name: style.name }) }),
    },
  })
}

// platforms 是各平台的写法，visual 是配图偏好；导入时由 Host 再按白名单清洗
const STYLE_KEYS = ['name', 'icon', 'summary', 'tone', 'sentences', 'opening', 'structure', 'logic', 'story', 'flow', 'words', 'avoid', 'samples', 'guide', 'platforms', 'visual']

/** 把一张风格卡存成文件，发给别人就能导入。 */
function exportStyle(style) {
  const data = { type: 'media-desk-style', version: 1, style: Object.fromEntries(STYLE_KEYS.filter(key => style[key] !== undefined && style[key] !== '').map(key => [key, style[key]])) }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  link.download = `${String(style.name).replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 40) || 'style'}.style.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

/** 读一个风格文件，加进「我的风格」并设为当前风格。字段由 Host 再过滤一遍。 */
async function importStyle(file) {
  try {
    if (file.size > 200_000) throw new Error(t('文件太大，不像是风格文件'))
    const data = JSON.parse(await file.text())
    const style = data?.type === 'media-desk-style' && data.style && typeof data.style === 'object' ? data.style : null
    if (!style || typeof style.name !== 'string' || !style.name.trim()) throw new Error(t('这不是工作台导出的风格文件'))
    const result = await dispatchOps([{ op: 'add_style', ...Object.fromEntries(STYLE_KEYS.filter(key => style[key] !== undefined).map(key => [key, style[key]])), source: t('导入') }], { label: t('导入风格「{name}」', { name: style.name }) })
    const id = result?.receipts?.[0]?.target
    if (id) await dispatchOps([{ op: 'set_style', id }], { label: t('切换风格'), silent: true })
  } catch (err) {
    toast(err.message || String(err), { error: true })
  }
}

/** 作者介绍和署名是每个人自己的，不跟着风格卡走。 */
export function editAuthor(author) {
  setDesk({
    dialog: {
      title: t('作者信息'),
      initial: { bio: author?.bio ?? '', signature: author?.signature ?? '' },
      fields: [
        { name: 'bio', label: t('一句话介绍'), type: 'textarea', rows: 2, hint: t('比如你的职业和在做的事。只在文章需要介绍作者时用到') },
        { name: 'signature', label: t('文末署名'), hint: t('长文结尾会单独一行写上它；留空就不署名') },
      ],
      onSubmit: values => dispatchOps([{ op: 'set_author', bio: values.bio ?? '', signature: values.signature ?? '' }], { label: t('更新作者信息') }),
    },
  })
}

function StyleCard({ style, active, onRules }) {
  return (
    <article className={`md-style ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined}>
      <header>
        <StyleGlyph style={style} size={40} />
        <div className="md-style-name">
          <strong title={style.name}>{style.name}</strong>
          {active ? <small className="md-style-using"><Icon name="check" size={12} stroke={2.2} />{t('正在使用')}</small> : <small>{style.preset ? t(style.category) : style.source ?? t('手动')}</small>}
        </div>
        <div className="md-style-tools">
          <IconButton icon="save" label={t('导出「{name}」', { name: style.name })} onClick={() => exportStyle(style)} />
          <IconButton icon="edit" label={t('编辑「{name}」', { name: style.name })} onClick={() => editStyle(style)} />
        </div>
      </header>
      {style.summary ? <p className="md-style-summary">{style.summary}</p> : null}
      {style.samples?.[0] ? <blockquote>{style.samples[0]}</blockquote> : null}
      <footer>
        <button type="button" className="md-pill is-small" title={t('各平台的写法、字数、自检项和配图偏好')} onClick={() => onRules(style.id)}>{t('各平台写法')}{style.platforms && Object.keys(style.platforms).length ? ` · ${Object.keys(style.platforms).length}` : ''}</button>
        <span className="md-grow" />
        <button type="button" className={`md-pill is-small ${active ? 'is-quiet' : 'is-primary'}`} onClick={() => dispatchOps([{ op: 'set_style', id: active ? null : style.id }], { label: t('切换风格'), silent: true })}>{active ? t('不用了') : t('用这个写')}</button>
      </footer>
    </article>
  )
}

export function StyleView() {
  const author = useDesk(s => s.state.author)
  useLang()
  const styles = useDesk(s => s.state.styles ?? [])
  const activeId = useDesk(s => s.state.activeStyleId)
  const skills = useDesk(s => s.state.skills)
  const [adding, setAdding] = React.useState(null)
  // 正在编辑哪张风格卡的各平台写法
  const [rulesFor, setRulesFor] = React.useState(null)
  const rulesStyle = styles.find(row => row.id === rulesFor)
  const [category, setCategory] = React.useState('全部')
  const active = styles.find(row => row.id === activeId)
  const mine = styles.filter(row => !row.preset)
  const presets = styles.filter(row => row.preset)
  const categories = STYLE_CATEGORIES.filter(name => presets.some(row => row.category === name))
  const shown = category === '全部' ? categories : categories.filter(name => name === category)
  const proposed = skills.filter(s => s.status === 'proposed')
  const rules = skills.filter(s => s.status !== 'proposed')
  const rule = skill => (
    <li key={skill.id} className="md-rule">
      <div>
        <strong>{skill.name}</strong>
        <p>{skill.rule}</p>
      </div>
      {skill.status === 'proposed'
        ? <button type="button" className="md-pill is-small is-primary" onClick={() => dispatchOps([{ op: 'update_skill', id: skill.id, status: 'active' }], { label: t('启用规则「{name}」', { name: skill.name }), silent: true })}>{t('启用')}</button>
        : <button type="button" className="md-pill is-small" onClick={() => dispatchOps([{ op: 'update_skill', id: skill.id, status: 'proposed' }], { label: t('停用规则「{name}」', { name: skill.name }), silent: true })}>{t('停用')}</button>}
      <IconButton icon="trash" label={t('删除规则「{name}」', { name: skill.name })} onClick={() => dispatchOps([{ op: 'delete_skill', id: skill.id }], { label: t('删除规则「{name}」', { name: skill.name }) })} />
    </li>
  )
  return (
    <div className="md-board-page">
      <div className="md-style-page">
        <section className="md-tile md-i-hero md-style-hero">
          <div className="md-hero-copy">
            <h1 className="md-i-line">
              {active ? <>{t('现在按')} <span className="md-inline-glyph"><StyleGlyph style={active} size={34} /></span> <b>{active.name}</b> {t('的风格写。')}</> : <>{t('选一种预设直接开写，')}<br />{t('或者贴几篇自己的内容，提炼你的风格。')}</>}
            </h1>
            {/* 添加风格的几种方式放一组；作者信息不属于哪种风格，单独放在右边 */}
            <div className="md-style-add-row" role="group" aria-label={t('添加我的风格')}>
              <span className="md-style-add-label">{t('添加我的风格')}</span>
              <button type="button" className="md-pill is-primary" onClick={() => setAdding('text')}><Icon name="pen" size={14} />{t('贴内容')}</button>
              <button type="button" className="md-pill" onClick={() => setAdding('url')}><Icon name="link" size={14} />{t('贴链接')}</button>
              <label className="md-pill"><Icon name="fileUp" size={14} />{t('导入风格文件')}<input type="file" hidden accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importStyle(file) }} /></label>
            </div>
          </div>
          <aside className="md-style-author" aria-label={t('作者信息')}>
            <header>
              <span>{t('作者信息')}</span>
              <IconButton icon="edit" label={t('编辑作者信息')} onClick={() => editAuthor(author)} />
            </header>
            {author?.signature || author?.bio ? (
              <>
                {author.signature ? <p className="md-style-author-sign"><small>{t('文末署名')}</small>{author.signature}</p> : null}
                {author.bio ? <p className="md-style-author-bio"><small>{t('一句话介绍')}</small>{author.bio}</p> : null}
              </>
            ) : <button type="button" className="md-inline-link" onClick={() => editAuthor(author)}>{t('填写作者信息')}</button>}
          </aside>
        </section>

        {mine.length ? (
          <section className="md-style-section" aria-label={t('我的风格')}>
            <h2>{t('我的风格')}<span>{mine.length}</span></h2>
            <div className="md-style-grid">{mine.map(style => <StyleCard key={style.id} style={style} active={style.id === activeId} onRules={setRulesFor} />)}</div>
          </section>
        ) : null}

        <div className="md-style-filter" role="tablist" aria-label={t('博主类型')}>
          {['全部', ...categories].map(name => <button type="button" key={name} role="tab" aria-selected={category === name} className={category === name ? 'is-on' : ''} onClick={() => setCategory(name)}>{t(name)}</button>)}
        </div>

        {shown.map(name => (
          <section key={name} className="md-style-section" aria-label={t(name)}>
            <h2>{t(name)}<span>{presets.filter(row => row.category === name).length}</span></h2>
            <div className="md-style-grid">{presets.filter(row => row.category === name).map(style => <StyleCard key={style.id} style={style} active={style.id === activeId} onRules={setRulesFor} />)}</div>
          </section>
        ))}

        <section className="md-tile md-rules">
          <header className="md-tile-head">
            <h2>{t('写作规则')}</h2>
            <span className="md-tile-meta">{t('每种风格都会遵守')}</span>
            <span className="md-grow" />
            <button type="button" className="md-pill is-small" onClick={learnSkills}><Icon name="spark" size={13} />{t('从数据中学习')}</button>
            <button type="button" className="md-pill is-small" title={t('把启用的写作规则交给 DeepSeek Harness：在别的对话里让它写东西时，也会照这些规则写')} onClick={exportSkills}><Icon name="bolt" size={13} />{t('导出写作规则给 DeepSeek Harness')}</button>
          </header>
          <ul>
            {proposed.map(rule)}
            {rules.map(rule)}
            {!proposed.length && !rules.length ? <li className="md-muted md-rule-empty">{t('在对话里说「以后标题都不要超过 20 个字」，这里就会多一条。')}<button type="button" className="md-inline-link" style={{ marginLeft: 6 }} onClick={() => setDesk({ dockOpen: true })}>{t('打开助手')}</button></li> : null}
          </ul>
        </section>
      </div>
      {adding ? <AddStyleDialog initialTab={adding} onClose={() => setAdding(null)} /> : null}
      {rulesStyle ? <PlatformRulesDialog style={rulesStyle} onClose={() => setRulesFor(null)} /> : null}
    </div>
  )
}
