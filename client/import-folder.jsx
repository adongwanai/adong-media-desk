// 内容页的「导入文件夹」：贴一个或几个放着 Markdown 稿子的文件夹路径，先看预览，确认后整批导入。
// 同一篇的公众号稿、小红书正文和图片版合成一篇（可以拆开）；可能重复的文件选留哪份；每个文件夹答一句「发过了吗」。
import React from 'react'
import { hostRequest, report, setDesk, toast, useDesk } from './desk.js'
import { plural, t } from './i18n.js'
import { Dialog, Icon, IconButton, Segmented, Swap } from './ui.jsx'
import { STATUSES, STATUS_LABEL, dayKey } from './util.js'

const RELATION = { new: '新增', update: '会更新', same: '没变', edited: '工作台改过，跳过', attach: '挂到已导入的那篇' }
const DATE_FROM = { front: '文件头', name: '文件名', mtime: '文件时间' }
const PUBLISHED = [
  { value: 'all', label: '都发过了' },
  { value: 'file', label: '按文件里的标记来（默认）' },
  { value: 'none', label: '都还没发' },
]

/** 路径最后一段，显示文件名或文件夹名用。 */
export function baseName(path) {
  return String(path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}

/** 导入的内容在卡片和表格里带一个小标记，悬停看文件名。 */
export function ImportedBadge({ item }) {
  if (!item.imported || !item.importPath) return null
  const names = (item.importParts ?? [{ path: item.importPath }]).map(part => baseName(part.path)).join('\n')
  return <span className="md-impf-badge" title={t('从文件导入：{name}', { name: names })}>{t('导入')}</span>
}

function counts(map, label) {
  return Object.entries(map).filter(([, n]) => n > 0).map(([key, n]) => `${label(key)} ${n}`).join(' · ')
}

/** 会合成一篇的组：一行一篇，每条合并关系一个勾，取消就拆开。 */
function groupRows(groups) {
  const crosses = groups.filter(group => group.kind === 'cross')
  const pairs = groups.filter(group => group.kind === 'pair')
  const used = new Set()
  const rows = crosses.map((cross) => {
    const pair = pairs.find(row => row.paths.every(path => cross.paths.includes(path)))
    if (pair) used.add(pair.key)
    return { key: cross.key, title: cross.title, names: cross.names, count: cross.count, links: [pair, cross].filter(Boolean) }
  })
  return [...rows, ...pairs.filter(pair => !used.has(pair.key)).map(pair => ({ key: pair.key, title: pair.title, names: pair.names, count: pair.count, links: [pair] }))]
}

function linkLabel(group) {
  if (group.kind === 'pair') return t(group.how === 'title' ? '小红书正文和图片版合成一篇（文件名不同，按同一天、标题对上的）' : '小红书正文和图片版合成一篇')
  return group.target ? t('挂到已导入的《{title}》下面，当它的小红书版本', { title: group.target.title }) : t('挂到公众号那篇下面，当它的小红书版本')
}

function Groups({ groups, split, toggle }) {
  const rows = groupRows(groups)
  if (!rows.length) return null
  return (
    <details className="md-impf-section" open>
      <summary>{t('会合成一篇的文件（{n} 组）', { n: rows.length })}</summary>
      <ul className="md-impf-groups">
        {rows.map(row => {
          const on = row.links.every(link => !split.has(link.key))
          return (
            <li key={row.key}>
              <div className="md-impf-group-head"><strong>{row.title}</strong><em>{on ? t('这 {n} 个文件会合成 1 篇', { n: row.count }) : t('已拆开')}</em></div>
              <small>{row.names.join('  ·  ')}</small>
              {row.links.map(link => (
                <label key={link.key} className="md-impf-check"><input type="checkbox" checked={!split.has(link.key)} onChange={() => toggle(link.key)} />{linkLabel(link)}</label>
              ))}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function Duplicates({ duplicates, keep, choose }) {
  if (!duplicates.length) return null
  return (
    <details className="md-impf-section" open>
      <summary>{t('可能重复（{n} 组）：同一天、标题几乎一样，只导入选中的那份', { n: duplicates.length })}</summary>
      <ul className="md-impf-groups">
        {duplicates.map(dup => {
          const chosen = keep[dup.key] ?? dup.keep
          return (
            <li key={dup.key} role="radiogroup" aria-label={t('留哪份')}>
              {dup.files.map(file => (
                <label key={file.path} className="md-impf-check">
                  <input type="radio" name={dup.key} checked={chosen === file.path} onChange={() => choose(dup.key, file.path)} />
                  <span className="md-impf-dup">{file.title}<small>{t('{name} · {date} 改过 · {n} 字', { name: file.name, date: dayKey(file.mtimeMs), n: file.chars })}{file.path === dup.suggested ? t(' · 最近改过') : ''}</small></span>
                </label>
              ))}
              <label className="md-impf-check"><input type="radio" name={dup.key} checked={chosen === 'all'} onChange={() => choose(dup.key, 'all')} />{t('不是重复，几份都导入')}</label>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function Pieces({ pieces }) {
  if (!pieces.length) return null
  return (
    <div className="md-imp-table md-impf-table">
      <table className="md-table is-plain">
        <thead><tr><th>{t('标题')}</th><th>{t('状态')}</th><th>{t('平台')}</th><th>{t('日期')}</th><th>{t('发布')}</th><th>{t('导入后')}</th></tr></thead>
        <tbody>
          {pieces.map(row => (
            <tr key={row.key}>
              <td className="md-imp-title" title={row.files.map(file => `${file.label}：${file.name}`).join('\n')}>{row.title}<small>{row.files.map(file => file.name).join(' + ')}</small></td>
              <td className="md-nowrap"><span className={`md-status status-${row.status}`}>{t(STATUS_LABEL[row.status])}</span>{row.statusFrom ? null : <small>{t('没写状态')}</small>}</td>
              <td className="md-nowrap">{row.platform ? t(row.platform) : '—'}{row.versions.length ? <small>{t('+ 小红书版本')}</small> : null}</td>
              <td className="md-nowrap">{dayKey(row.createdAt)}<small>{t(DATE_FROM[row.dateFrom])}</small></td>
              <td className="md-nowrap">{row.publishedAt ? <>{dayKey(row.publishedAt)}<small>{t(DATE_FROM[row.publishedFrom] ?? '文件头')}</small></> : '—'}</td>
              <td className="md-nowrap">{t(RELATION[row.relation])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Preview({ preview, split, keep, toggle, choose }) {
  const statusText = counts(Object.fromEntries(STATUSES.map(s => [s, preview.pieces.filter(row => row.status === s).length])), s => t(STATUS_LABEL[s]))
  const dateText = counts(Object.fromEntries(Object.keys(DATE_FROM).map(key => [key, preview.pieces.filter(row => row.dateFrom === key).length])), key => t(DATE_FROM[key]))
  const dropped = preview.files.filter(row => row.dropped).length
  return (
    <div className="md-imp-preview">
      <p className="md-imp-summary">
        {t(plural(preview.files.length, '找到 1 个稿子文件', '找到 {n} 个稿子文件'), { n: preview.files.length })}
        {t('，导入后是 {n} 篇', { n: preview.pieces.length })}
        {preview.skipped.length ? t('，跳过 {n} 个文件', { n: preview.skipped.length }) : ''}
        {dropped ? t('，{n} 个可能重复的文件不导入', { n: dropped }) : ''}
        {preview.pieces.length ? <><br />{statusText}<br />{t('日期来自：{list}', { list: dateText })}</> : null}
      </p>
      <Groups groups={preview.groups} split={split} toggle={toggle} />
      <Duplicates duplicates={preview.duplicates} keep={keep} choose={choose} />
      <Pieces pieces={preview.pieces} />
      {preview.skipped.length ? (
        <details className="md-impf-skipped">
          <summary>{t('跳过的文件（{n}）', { n: preview.skipped.length })}</summary>
          <ul>{preview.skipped.map(row => <li key={row.path}><span>{row.name}</span><em>{row.reason}</em></li>)}</ul>
        </details>
      ) : null}
    </div>
  )
}

function resultText(data) {
  const parts = [t('新增 {n} 篇', { n: data.added })]
  if (data.updated) parts.push(t('更新 {n} 篇', { n: data.updated }))
  if (data.attached) parts.push(t('{n} 篇挂到已导入的稿子下面', { n: data.attached }))
  if (data.grouped) parts.push(t('{n} 篇由几个文件合成', { n: data.grouped }))
  if (data.unchanged) parts.push(t('{n} 篇没变', { n: data.unchanged }))
  if (data.edited?.length) parts.push(t('{n} 篇已在工作台改过，跳过', { n: data.edited.length }))
  if (data.dropped?.length) parts.push(t('{n} 个可能重复的文件没导入', { n: data.dropped.length }))
  return t('从「{name}」导入：{parts}', { name: data.name, parts: parts.join('，') })
}

function ImportedDirs({ busy, run }) {
  const dirs = useDesk(s => s.state?.importDirs) ?? []
  if (!dirs.length) return null
  return (
    <div className="md-impf-dirs">
      <h3>{t('已导入的文件夹')}</h3>
      <ul>
        {dirs.map(row => (
          <li key={row.dir}>
            <Icon name="folder" size={14} />
            <span className="md-impf-dir" title={row.dir}><strong>{row.name}</strong><small>{t('{n} 篇 · 上次导入 {date}', { n: row.count, date: dayKey(row.importedAt) })}</small></span>
            <button type="button" className="md-btn" disabled={busy} onClick={() => run('import/run', { dir: row.dir, depth: row.depth ?? 0 })}>{t('重新导入')}</button>
            <button type="button" className="md-btn" disabled={busy} onClick={() => run('import/remove', { dir: row.dir })}>{t('移除')}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function removedText(data) {
  const base = data.kept ? t('移除 {removed} 篇；{kept} 篇在工作台改过，留着', data) : t(plural(data.removed, '移除 1 篇导入的内容', '移除 {n} 篇导入的内容'), { n: data.removed })
  return data.detached ? `${base}${t('；{n} 篇只去掉了这个文件夹的那部分', { n: data.detached })}` : base
}

export function ImportFolderDialog({ onClose }) {
  const [folders, setFolders] = React.useState([{ dir: '', published: 'file' }])
  const [deep, setDeep] = React.useState(false)
  const [split, setSplit] = React.useState(() => new Set())
  const [keep, setKeep] = React.useState({})
  const [preview, setPreview] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const depth = deep ? 1 : 0
  const paths = folders.map(row => row.dir.trim()).filter(Boolean)
  const request = () => ({ folders: folders.filter(row => row.dir.trim()).map(row => ({ dir: row.dir.trim(), depth, published: row.published })), split: [...split], keep })
  // 路径或层级改了，旧预览和选择作废
  // 只认最后一次请求的结果：连着点几下勾，不会被先回来的旧预览盖掉
  const seq = React.useRef(0)
  const pathKey = `${paths.join('\n')}|${depth}`
  React.useEffect(() => { seq.current += 1; setPreview(null); setSplit(new Set()); setKeep({}) }, [pathKey])

  const load = async () => {
    if (!paths.length) return
    const id = ++seq.current
    setBusy(true)
    try {
      const data = await hostRequest('import/scan', request())
      if (id === seq.current) setPreview(data)
    } catch (err) {
      if (id === seq.current) report(err)
    } finally {
      if (id === seq.current) setBusy(false)
    }
  }
  // 预览出来以后，「发过了吗」、拆组、留哪份改了就重新算一遍
  const choiceKey = `${folders.map(row => row.published).join(',')}|${[...split].join(',')}|${JSON.stringify(keep)}`
  React.useEffect(() => { if (preview) load() }, [choiceKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const scan = (event) => {
    event.preventDefault()
    if (!busy) load()
  }

  // 导入、重新导入和移除都是一步，可以撤销
  const run = async (path, body, { close = false } = {}) => {
    if (busy) return
    setBusy(true)
    try {
      const data = await hostRequest(path, body)
      setDesk({ state: data.state, canUndo: true })
      toast(path === 'import/remove' ? removedText(data) : resultText(data), { undo: true })
      if (close) onClose()
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }

  const update = (index, patch) => setFolders(list => list.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const toggle = key => setSplit((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const choose = (key, value) => setKeep(current => ({ ...current, [key]: value }))
  const importable = preview ? preview.pieces.filter(row => ['new', 'update', 'attach'].includes(row.relation)).length : 0
  const nameOf = dir => preview?.folders.find(row => row.dir === dir || dir.endsWith(row.name))?.name ?? baseName(dir)
  return (
    <Dialog title={t('导入文件夹')} onClose={onClose} width={820}>
      <form className="md-form" onSubmit={scan}>
        {folders.map((row, index) => (
          <div key={index} className="md-impf-folder">
            <label className="md-field">
              <span>{folders.length > 1 ? t('文件夹路径 {n}', { n: index + 1 }) : t('文件夹路径')}</span>
              <span className="md-impf-path">
                <input value={row.dir} onChange={e => update(index, { dir: e.target.value })} placeholder={index ? '/Users/…/小红书' : '/Users/…/公众号'} spellCheck={false} />
                {folders.length > 1 ? <IconButton icon="close" label={t('去掉这个文件夹')} onClick={() => setFolders(list => list.filter((_, i) => i !== index))} /> : null}
              </span>
            </label>
            {row.dir.trim() ? (
              <div className="md-impf-ask">
                <span>{t('「{name}」这个文件夹里的稿子发过了吗？', { name: nameOf(row.dir.trim()) })}</span>
                <Segmented value={row.published} label={t('发过了吗')} options={PUBLISHED.map(option => ({ ...option, label: t(option.label) }))} onChange={value => update(index, { published: value })} />
              </div>
            ) : null}
          </div>
        ))}
        <small className="md-muted md-impf-note">{t('Mac：在访达里选中文件夹，按 ⌥⌘C 拷贝路径；Windows：按住 Shift 右键文件夹，选「复制为路径」。公众号和小红书的文件夹一起导入，同一篇会合在一起。')}</small>
        <div className="md-impf-row">
          {folders.length < 6 ? <button type="button" className="md-btn" onClick={() => setFolders(list => [...list, { dir: '', published: 'file' }])}><Icon name="plus" size={14} />{t('再加一个文件夹')}</button> : null}
          <label className="md-impf-check"><input type="checkbox" checked={deep} onChange={e => setDeep(e.target.checked)} />{t('也看下一层子文件夹')}</label>
        </div>
        <p className="md-muted md-impf-note">{t('只读取 .md 文件，不会改动或删除文件夹里的任何东西。日期按文件头、文件名开头的日期、文件修改时间的顺序取；「都发过了」时发布日期也这样取。')}</p>
        {preview ? <Preview preview={preview} split={split} keep={keep} toggle={toggle} choose={choose} /> : null}
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          {preview ? (
            <button type="button" className="md-btn is-primary" disabled={busy || !importable} onClick={() => run('import/run', request(), { close: true })}>
              {importable ? t(plural(importable, '导入 1 篇', '导入 {n} 篇'), { n: importable }) : t('没有要导入的')}
            </button>
          ) : (
            <button type="submit" className="md-btn is-primary" disabled={busy || !paths.length}><Swap labels={[t('预览'), t('读取中…')]} at={busy ? 1 : 0} /></button>
          )}
        </div>
      </form>
      <ImportedDirs busy={busy} run={run} />
    </Dialog>
  )
}
