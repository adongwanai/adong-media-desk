// 快捷键总表：导航、命令面板、速查表和各处的提示都从这里读，改一处全跟着变。
import { lang, t } from './i18n.js'

// navKey：同一个中文在别处意思不同（单数的“灵感”“风格”），英文导航另查一条。letter 是 G 之后按的字母
export const NAV = [
  { id: 'board', label: '大屏', letter: 'D' },
  { id: 'sources', label: '信息源', letter: 'S' },
  { id: 'home', label: '灵感', navKey: '灵感（导航）', letter: 'I' },
  { id: 'content', label: '内容', letter: 'C' },
  { id: 'schedule', label: '排期', letter: 'A' },
  { id: 'publish', label: '发布', letter: 'P' },
  { id: 'video', label: '视频', letter: 'V' },
  { id: 'insights', label: '复盘', letter: 'R' },
  { id: 'rivals', label: '对标', letter: 'B' },
]
// 写作风格不在导航条里（收在右上角），但一样能用 G W 过去
export const STYLE_PAGE = { id: 'style', label: '写作风格', letter: 'W' }
export const PAGES = [...NAV, STYLE_PAGE]

export const CAPTURE_ID = 'media-desk.capture'
export const PALETTE_ID = 'media-desk.palette'
export const CAPTURE_KEY = { code: 'KeyI', modifiers: ['primary', 'shift'] }
// ⌘/Ctrl + K 在宿主里已经是「搜索会话」（桌面版），网页版又不允许只带一个修饰键，所以只在工作台里由我们自己接；
// 交给宿主的是 ⌘/Ctrl + Shift + K，在 DeepSeek Harness 任何地方都能按，会先打开工作台
export const PALETTE_KEY = { code: 'KeyK', modifiers: ['primary'] }
export const PALETTE_HOST_KEY = { code: 'KeyK', modifiers: ['primary', 'shift'] }

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

/** 导航上显示的页面名。 */
export function pageLabel(page) {
  return page.navKey && lang() === 'en' ? t(page.navKey) : t(page.label)
}

/** 一组按键在当前系统上的写法，比如 ['⌘', '⇧', 'I'] 或 ['Ctrl', 'Shift', 'I']。 */
export function keysOf({ code, modifiers = [] }) {
  const mac = isMac()
  const mods = modifiers.map(name => ({ primary: mac ? '⌘' : 'Ctrl', shift: mac ? '⇧' : 'Shift', alt: mac ? '⌥' : 'Alt' })[name] ?? name)
  const key = code.replace(/^Key|^Digit/, '').replace(/^Enter$/, t('回车')).replace(/^Escape$/, 'Esc')
  return [...mods, key]
}

/** 按键写成一行字，放进提示和 title 里。 */
export function keysText(binding) {
  return keysOf(binding).join(isMac() ? '' : '+')
}

const primary = (code, extra = []) => ({ keys: keysOf({ code, modifiers: ['primary', ...extra] }) })
const plain = (...keys) => ({ keys })
const seq = (...keys) => ({ keys, seq: true })

/** 速查表：每组一个标题，每行一个说明和一到两种按法。在渲染时调用，文字已经翻译好。 */
export function shortcutGroups() {
  return [
    {
      title: t('在 DeepSeek Harness 里随时可用'),
      rows: [
        { label: t('记下一个灵感'), keys: [{ keys: keysOf(CAPTURE_KEY) }] },
        { label: t('打开工作台的命令面板'), keys: [{ keys: keysOf(PALETTE_HOST_KEY) }] },
      ],
    },
    {
      title: t('工作台里（光标不在输入框时）'),
      rows: [
        { label: t('命令面板：跳页面、做常用操作、搜灵感和稿子'), keys: [{ keys: keysOf(PALETTE_KEY) }] },
        ...PAGES.map((page, index) => ({ label: t('前往「{page}」', { page: pageLabel(page) }), keys: [seq('G', page.letter), ...(index < NAV.length ? [primary(`Digit${index + 1}`)] : [])] })),
        { label: t('撤销上一步'), keys: [primary('KeyZ')] },
        { label: t('显示这张快捷键表'), keys: [plain('?')] },
      ],
    },
    {
      title: t('记灵感的小窗里'),
      rows: [
        { label: t('记下并关闭'), keys: [plain(t('回车'))] },
        { label: t('记下，接着记下一条'), keys: [primary('Enter')] },
        { label: t('换行'), keys: [{ keys: keysOf({ code: 'Enter', modifiers: ['shift'] }) }] },
        { label: t('关闭'), keys: [plain('Esc')] },
      ],
    },
    {
      title: t('命令面板里'),
      rows: [
        { label: t('上下选择'), keys: [plain('↑', '↓')] },
        { label: t('执行选中的一项'), keys: [plain(t('回车'))] },
        { label: t('关闭'), keys: [plain('Esc')] },
      ],
    },
  ]
}

/**
 * 向宿主登记一个快捷键（用户可以在宿主的快捷键设置里改）。快捷键服务是软依赖：等它就绪再登记，没有就什么都不做。
 * @param {object} ctx - 宿主上下文。
 * @param {{ id: string, label: string, aliases: string[], binding: object, regions: string[], run: (inner: object) => void, ready?: (inner: object) => boolean }} command
 */
export function registerShortcut(ctx, { id, label, aliases, binding, regions, run, ready = () => true }) {
  const register = (inner) => {
    try {
      const shortcuts = inner.shortcuts ?? inner.get?.('shortcuts')
      if (typeof shortcuts?.register !== 'function') return
      inner.effect(() => shortcuts.register({
        id,
        label: () => t(label),
        aliases,
        // 宿主在 Linux 网页版只放行几个固定组合，写上 web:linux 整条登记都会被拒；那里由工作台自己兜底
        defaults: Object.fromEntries(['desktop:macos', 'desktop:windows', 'desktop:linux', 'web:macos', 'web:windows'].map(key => [key, binding])),
        regions,
        modals: [],
        resolve: () => (ready(inner) ? { status: 'handled', run: () => run(inner) } : { status: 'pass' }),
      }), `dsh-media-desk: ${id} shortcut`)
    } catch (error) {
      console.warn(`[dsh-media-desk] 快捷键 ${id} 没注册上：`, error)
    }
  }
  try {
    // 只在 apply 里直接读 ctx.shortcuts 时，服务可能还没就绪，登记会悄悄落空
    if (typeof ctx.inject === 'function') ctx.inject(['shortcuts'], register)
    else register(ctx)
  } catch (error) {
    console.warn(`[dsh-media-desk] 快捷键 ${id} 没注册上：`, error)
  }
}
