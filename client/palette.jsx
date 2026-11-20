// 命令面板（工作台里按 ⌘/Ctrl + K）：输入几个字就能跳页面、做常用操作、打开某条灵感或稿子。另有一张快捷键速查表（按 ?）。
import React from 'react'
import { autoReadFollowers } from './board.jsx'
import { openInBrowser } from './browser.js'
import { dispatchOps, openItem, setDesk, useDesk } from './desk.js'
import { fuzzyFilter } from './fuzzy.js'
import { t } from './i18n.js'
import { openQuickCapture } from './quick-capture.js'
import { CAPTURE_KEY, PALETTE_HOST_KEY, PALETTE_ID, PAGES, keysOf, pageLabel, registerShortcut, shortcutGroups } from './shortcuts.js'
import { Dialog, Icon, Keys } from './ui.jsx'
import { PLATFORM_HOME, PLATFORMS, STATUS_LABEL } from './util.js'

const RECENT = 6
const LIMIT = 60

function go(view) {
  setDesk({ view, focusId: null })
}

/** 面板里的全部条目。hidden 的只在输入了关键词时出现，免得一打开就是长长一串。 */
function buildCommands(state) {
  const pages = PAGES.map(page => ({
    id: `go:${page.id}`, icon: 'chevR', label: t('前往「{page}」', { page: pageLabel(page) }), search: `${page.label} ${page.id}`,
    keys: { keys: ['G', page.letter], seq: true }, run: () => go(page.id),
  }))
  const actions = [
    { id: 'capture', icon: 'spark', label: t('记下一个灵感'), search: '记灵感 capture idea note', keys: { keys: keysOf(CAPTURE_KEY) }, run: openQuickCapture },
    { id: 'followers', icon: 'refresh', label: t('自动读取粉丝'), search: '粉丝 followers', run: () => { go('board'); autoReadFollowers() } },
    { id: 'refetch', icon: 'refresh', label: t('重新抓取信息源'), search: '订阅 热榜 feeds rss refresh', run: () => setDesk(s => ({ view: 'sources', focusId: null, reload: s.reload + 1 })) },
    { id: 'style', icon: 'pen', label: t('切换写作风格'), search: '风格 style', run: () => go('style') },
    { id: 'settings', icon: 'gear', label: t('打开设置'), search: '设置 settings', run: () => setDesk({ settingsOpen: true }) },
    { id: 'keys', icon: 'list', label: t('查看全部快捷键'), search: '快捷键 shortcuts keyboard', keys: { keys: ['?'] }, run: () => setDesk({ shortcutSheet: true }) },
    { id: 'guide', icon: 'help', label: t('怎么用'), search: '怎么用 使用指南 帮助 新手 上手 guide help how', run: () => setDesk({ guide: true }) },
  ]
  const desks = PLATFORMS.filter(platform => PLATFORM_HOME[platform]).map(platform => ({
    id: `desk:${platform}`, icon: 'upRight', label: t('打开{platform}创作后台', { platform: t(platform) }), search: `${platform} 创作后台 后台 creator`, hidden: true,
    run: () => openInBrowser(PLATFORM_HOME[platform]),
  }))
  const styles = (state.styles ?? []).filter(style => style.id !== state.activeStyleId).map(style => ({
    id: `style:${style.id}`, icon: 'pen', label: t('改用「{name}」风格写', { name: style.name }), search: `风格 style ${style.name}`, hidden: true,
    run: () => dispatchOps([{ op: 'set_style', id: style.id }], { label: t('切换风格') }),
  }))
  const items = state.items.filter(item => item.title).map((item, index) => ({
    id: `item:${item.id}`, icon: item.status === 'idea' ? 'spark' : 'edit', label: item.title, meta: t(STATUS_LABEL[item.status] ?? '灵感'),
    search: [item.title, item.production?.title, ...(item.tags ?? [])].filter(Boolean).join(' '), hidden: index >= RECENT,
    run: () => openItem(item.id),
  }))
  // 常用操作排最前，其次是跳页面和最近的几条
  return [...actions, ...pages, ...items, ...desks, ...styles]
}

function PaletteBox() {
  const state = useDesk(s => s.state)
  const [query, setQuery] = React.useState('')
  const [index, setIndex] = React.useState(0)
  const input = React.useRef(null)
  const list = React.useRef(null)
  const opener = React.useRef(typeof document === 'undefined' ? null : document.activeElement)
  const all = React.useMemo(() => buildCommands(state), [state])
  const rows = React.useMemo(() => {
    const words = query.trim()
    if (!words) return all.filter(row => !row.hidden)
    const found = fuzzyFilter(all, words, row => `${row.label} ${row.search ?? ''}`).slice(0, LIMIT)
    // 什么都没对上时，顺手把这句话记成灵感
    return [...found, { id: 'note', icon: 'plus', label: t('把「{text}」记成灵感', { text: words.slice(0, 40) }), run: () => dispatchOps([{ op: 'add_item', kind: 'note', title: words.slice(0, 40), body: words }], { label: t('记下灵感') }) }]
  }, [all, query])
  React.useEffect(() => { setIndex(0) }, [query])
  React.useEffect(() => {
    input.current?.focus()
    const back = opener.current
    return () => { if (back?.isConnected && typeof back.focus === 'function') back.focus() }
  }, [])
  React.useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, rows])
  const close = () => setDesk({ palette: false })
  const run = (row) => {
    if (!row) return
    close()
    row.run()
  }
  const onKeyDown = (event) => {
    if (event.nativeEvent.isComposing) return
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (move) {
      event.preventDefault()
      setIndex(i => (i + move + rows.length) % rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(rows[index])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      // 焦点只留在输入框里，用上下键选
      event.preventDefault()
    }
  }
  const activeId = rows[index] ? `md-palette-${index}` : undefined
  return (
    <div className="md-dialog-mask md-palette-mask" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="md-palette" role="dialog" aria-modal="true" aria-label={t('命令面板')}>
        <div className="md-palette-input">
          <Icon name="search" size={16} />
          <input
            ref={input}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('搜页面、操作、灵感和稿子…')}
            role="combobox"
            aria-expanded="true"
            aria-controls="md-palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={t('搜索命令')}
          />
          <Keys keys={['Esc']} />
        </div>
        <ul className="md-palette-list" id="md-palette-list" role="listbox" aria-label={t('命令')} ref={list}>
          {rows.map((row, i) => (
            <li key={row.id} id={`md-palette-${i}`} role="option" aria-selected={i === index} className={i === index ? 'is-on' : ''} onPointerMove={() => { if (i !== index) setIndex(i) }} onClick={() => run(row)}>
              <Icon name={row.icon} size={15} />
              <span className="md-palette-label">{row.label}</span>
              {row.meta ? <small>{row.meta}</small> : null}
              {row.keys ? <Keys keys={row.keys.keys} seq={row.keys.seq} /> : null}
            </li>
          ))}
        </ul>
        <footer className="md-palette-foot">
          <span><Keys keys={['↑', '↓']} /> {t('选择')}</span>
          <span><Keys keys={[t('回车')]} /> {t('执行')}</span>
          <span><Keys keys={['?']} /> {t('全部快捷键')}</span>
        </footer>
      </div>
    </div>
  )
}

export function Palette() {
  const open = useDesk(s => s.palette)
  return open ? <PaletteBox /> : null
}

/** 快捷键速查表，内容全部来自 shortcuts.js 的总表。 */
export function ShortcutSheet() {
  const open = useDesk(s => s.shortcutSheet)
  if (!open) return null
  return (
    <Dialog title={t('键盘快捷键')} onClose={() => setDesk({ shortcutSheet: false })} width={820}>
      <div className="md-keysheet">
        {shortcutGroups().map(group => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map(row => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.keys.map((binding, i) => <React.Fragment key={i}>{i ? <span className="md-keys-then">{t('或')}</span> : null}<Keys keys={binding.keys} seq={binding.seq} /></React.Fragment>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="md-muted">{t('前两个是默认按键，可以在 DeepSeek Harness 的快捷键设置里改。在浏览器里用时，⌘/Ctrl + 数字可能被浏览器拿去切标签页，用 G 加字母更稳。')}</p>
      </div>
    </Dialog>
  )
}

/**
 * 向宿主登记「打开命令面板」：工作台没开着时先把它打开。
 * @param {object} ctx - 宿主上下文。
 * @param {string} panelId - 工作台在侧栏里的 id。
 */
export function registerPalette(ctx, panelId) {
  const visible = () => [...document.querySelectorAll('.md-root')].some(node => node.getClientRects().length > 0)
  // 宿主的布局服务（用来打开工作台）也是软依赖，没注入时读 ctx.layout 会直接抛错
  let layout = null
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['layout'], inner => inner.effect(() => {
        layout = inner.layout
        return () => { layout = null }
      }, 'dsh-media-desk: layout for palette'))
    }
  } catch (error) {
    console.warn('[dsh-media-desk] 拿不到宿主的布局服务，命令面板只能在工作台里打开：', error)
  }
  registerShortcut(ctx, {
    id: PALETTE_ID,
    label: '打开工作台的命令面板',
    aliases: ['command palette', 'media desk', 'ip workbench', '命令面板', '工作台', '阿东IP工作台'],
    binding: PALETTE_HOST_KEY,
    regions: ['page', 'editable'],
    ready: () => visible() || typeof layout?.selectPanel === 'function',
    run: () => {
      if (!visible()) layout.selectPanel(panelId)
      setDesk({ palette: true })
    },
  })
}
