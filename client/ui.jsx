// 通用小组件：图标、按钮、对话框、提示。
import React from 'react'
import { setDesk, undo, useDesk } from './desk.js'
import { t } from './i18n.js'

// 图标来自 Lucide（ISC，https://lucide.dev），24×24 网格、圆头圆角描边。
// 每个图标是一组节点：字符串是 path 的 d，数组是 [标签, 属性]。名字沿用工作台自己的叫法，对应关系见右边的 Lucide 名。
const ICONS = {
  plus: ['M5 12h14', 'M12 5v14'], // plus
  minus: ['M5 12h14'], // minus
  close: ['M18 6 6 18', 'm6 6 12 12'], // x
  send: ['m5 12 7-7 7 7', 'M12 19V5'], // arrow-up
  check: ['M20 6 9 17l-5-5'], // check
  chevL: ['m15 18-6-6 6-6'], // chevron-left
  chevR: ['m9 18 6-6-6-6'], // chevron-right
  chevD: ['m6 9 6 6 6-6'], // chevron-down
  chevUD: ['m7 15 5 5 5-5', 'm7 9 5-5 5 5'], // chevrons-up-down
  search: [['circle', {cx: '11', cy: '11', r: '8'}], 'm21 21-4.3-4.3'], // search
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'], // message-square
  quote: ['M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z', 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'], // quote
  scatter: [['rect', {width: '7', height: '9', x: '3', y: '3', rx: '1'}], ['rect', {width: '7', height: '5', x: '14', y: '3', rx: '1'}], ['rect', {width: '7', height: '9', x: '14', y: '12', rx: '1'}], ['rect', {width: '7', height: '5', x: '3', y: '16', rx: '1'}]], // layout-dashboard
  wall: [['rect', {width: '7', height: '7', x: '3', y: '3', rx: '1'}], ['rect', {width: '7', height: '7', x: '14', y: '3', rx: '1'}], ['rect', {width: '7', height: '7', x: '14', y: '14', rx: '1'}], ['rect', {width: '7', height: '7', x: '3', y: '14', rx: '1'}]], // layout-grid
  list: ['M3 12h.01', 'M3 18h.01', 'M3 6h.01', 'M8 12h13', 'M8 18h13', 'M8 6h13'], // list
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', ['circle', {cx: '12', cy: '7', r: '4'}]], // user
  userPen: ['M11.5 15H7a4 4 0 0 0-4 4v2', 'M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z', ['circle', {cx: '10', cy: '7', r: '4'}]], // user-pen
  spark: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z', 'M20 3v4', 'M22 5h-4', 'M4 17v2', 'M5 18H3'], // sparkles
  pen: ['M12 20h9', 'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z'], // pen-line
  film: [['rect', {width: '18', height: '18', x: '3', y: '3', rx: '2'}], 'M7 3v18', 'M3 7.5h4', 'M3 12h18', 'M3 16.5h4', 'M17 3v18', 'M17 7.5h4', 'M17 16.5h4'], // film
  branch: ['M16 3h5v5', 'M8 3H3v5', 'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3', 'm15 9 6-6'], // split
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', ['line', {x1:'10', x2:'10', y1:'11', y2:'17'}], ['line', {x1:'14', x2:'14', y1:'11', y2:'17'}]], // trash-2
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'], // pin
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'], // link
  copy: [['rect', {width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2'}], 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'], // copy
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', ['polyline', {points: '17 8 12 3 7 8'}], ['line', {x1:'12', x2:'12', y1:'3', y2:'15'}]], // upload
  fileUp: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M12 12v6', 'm15 15-3-3-3 3'], // file-up
  calendar: ['M8 2v4', 'M16 2v4', ['rect', {width: '18', height: '18', x: '3', y: '4', rx: '2'}], 'M3 10h18'], // calendar
  zoomIn: ['M5 12h14', 'M12 5v14'], // plus
  zoomOut: ['M5 12h14'], // minus
  target: [['line', {x1:'2', x2:'5', y1:'12', y2:'12'}], ['line', {x1:'19', x2:'22', y1:'12', y2:'12'}], ['line', {x1:'12', x2:'12', y1:'2', y2:'5'}], ['line', {x1:'12', x2:'12', y1:'19', y2:'22'}], ['circle', {cx: '12', cy: '12', r: '7'}], ['circle', {cx: '12', cy: '12', r: '3'}]], // locate-fixed
  play: [['polygon', {points: '6 3 20 12 6 21 6 3'}]], // play
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'], // undo-2
  bolt: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'], // zap
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'], // refresh-cw
  edit: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'], // pencil
  eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', ['circle', {cx: '12', cy: '12', r: '3'}]], // eye
  upRight: ['M7 7h10v10', 'M7 17 17 7'], // arrow-up-right
  image: [['rect', {width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2'}], ['circle', {cx: '9', cy: '9', r: '2'}], 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'], // image
  clock: [['circle', {cx: '12', cy: '12', r: '10'}], ['polyline', {points: '12 6 12 12 16 14'}]], // clock
  expand: [['polyline', {points: '15 3 21 3 21 9'}], ['polyline', {points: '9 21 3 21 3 15'}], ['line', {x1:'21', x2:'14', y1:'3', y2:'10'}], ['line', {x1:'3', x2:'10', y1:'21', y2:'14'}]], // maximize-2
  shrink: [['polyline', {points: '4 14 10 14 10 20'}], ['polyline', {points: '20 10 14 10 14 4'}], ['line', {x1:'14', x2:'21', y1:'10', y2:'3'}], ['line', {x1:'3', x2:'10', y1:'21', y2:'14'}]], // minimize-2
  save: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', ['polyline', {points: '7 10 12 15 17 10'}], ['line', {x1:'12', x2:'12', y1:'15', y2:'3'}]], // download
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'], // folder
  more: [['circle', {cx: '12', cy: '12', r: '1'}], ['circle', {cx: '19', cy: '12', r: '1'}], ['circle', {cx: '5', cy: '12', r: '1'}]], // ellipsis
  gear: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', ['circle', {cx: '12', cy: '12', r: '3'}]], // settings
  compass: ['m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z', ['circle', {cx: '12', cy: '12', r: '10'}]], // compass
  bot: ['M12 8V4H8', ['rect', {width: '16', height: '12', x: '4', y: '8', rx: '2'}], 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'], // bot
  phone: [['rect', {width: '14', height: '20', x: '5', y: '2', rx: '2', ry: '2'}], 'M12 18h.01'], // smartphone
  plane: ['M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'], // plane
  utensils: ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7'], // utensils
  clapper: ['M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z', 'm6.2 5.3 3.1 3.9', 'm12.4 3.4 3.1 4', 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'], // clapperboard
  house: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'], // house
  book: ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'], // book-open
  briefcase: ['M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', ['rect', {width: '20', height: '14', x: '2', y: '6', rx: '2'}]], // briefcase
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'], // wrench
  trend: [['polyline', {points: '22 7 13.5 15.5 8.5 10.5 2 17'}], ['polyline', {points: '16 7 22 7 22 13'}]], // trending-up
  palette: [['circle', {cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor'}], ['circle', {cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor'}], ['circle', {cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor'}], ['circle', {cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor'}], 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z'], // palette
  shirt: ['M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z'], // shirt
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'], // moon
  baby: ['M9 12h.01', 'M15 12h.01', 'M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5', 'M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1'], // baby
  news: ['M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2', 'M18 14h-8', 'M15 18h-5', 'M10 6h8v4h-8V6Z'], // newspaper
  feather: ['M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z', 'M16 8 2 22', 'M17.5 15H9'], // feather
  history: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'], // history
  fileText: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'], // file-text
  help: [['circle', {cx: '12', cy: '12', r: '10'}], 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'], // circle-help
}

/** 图标：默认 1.75 的描边，小尺寸时稍微加粗一点，免得发虚。 */
export function Icon({ name, size = 16, fill = false, stroke }) {
  const nodes = ICONS[name] ?? ICONS.more
  const width = stroke ?? (size <= 12 ? 2 : 1.75)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="md-icon">
      {nodes.map((node, index) => (typeof node === 'string' ? <path key={index} d={node} /> : React.createElement(node[0], { key: index, ...node[1] })))}
    </svg>
  )
}

/** 所有图标名，给测试和调试用。 */
export const ICON_NAMES = Object.keys(ICONS)

export function IconButton({ icon, label, onClick, active, tone, size = 16, className = '', ...rest }) {
  return (
    <button type="button" className={`md-icon-btn ${active ? 'is-active' : ''} ${tone ? `is-${tone}` : ''} ${className}`} aria-label={label} title={label} onClick={onClick} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="md-seg" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'is-on' : ''} onClick={() => onChange(option.value)} title={option.title ?? option.label}>
          {option.icon ? <Icon name={option.icon} size={15} /> : null}
          {option.label ? <span className="md-keepw" data-label={option.label}>{option.label}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Dialog({ title, onClose, children, width = 440 }) {
  const ref = React.useRef(null)
  // onClose 每次渲染都可能是新函数；放进 ref，免得每打一个字焦点就被抢走
  const close = React.useRef(onClose)
  close.current = onClose
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const body = ref.current
    ;(body?.querySelector('.md-dialog-head ~ * input, .md-dialog-head ~ * textarea, .md-dialog-head ~ * select') ?? body?.querySelector('.md-dialog-head ~ * button'))?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <div className="md-dialog-mask" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="md-dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width }} ref={ref}>
        <div className="md-dialog-head">
          <h2>{title}</h2>
          <IconButton icon="close" label={t('关闭')} onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}

/** 字段驱动的通用编辑框，风格、规则和数据都用它。 */
export function FormDialog() {
  const dialog = useDesk(s => s.dialog)
  const [values, setValues] = React.useState({})
  React.useEffect(() => {
    if (dialog) setValues(dialog.initial ?? {})
  }, [dialog])
  if (!dialog) return null
  const close = () => setDesk({ dialog: null })
  const submit = (event) => {
    event.preventDefault()
    dialog.onSubmit(values)
    close()
  }
  return (
    <Dialog title={dialog.title} onClose={close}>
      <form onSubmit={submit} className="md-form">
        {dialog.fields.map((field) => {
          if (field.type === 'hidden') return <p key={field.name} className="md-muted">{field.label}</p>
          if (field.type === 'checkbox') {
            return (
              <label key={field.name} className="md-check">
                <input type="checkbox" checked={Boolean(values[field.name])} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.checked }))} />
                <span>{field.label}</span>
              </label>
            )
          }
          return (
            <label key={field.name} className="md-field">
              <span>{field.label}</span>
              {field.type === 'textarea' ? (
                <textarea rows={field.rows ?? 3} value={values[field.name] ?? ''} placeholder={field.placeholder} required={field.required} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))} />
              ) : field.type === 'select' ? (
                <select value={values[field.name] ?? ''} required={field.required} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}>
                  {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input type={field.type ?? 'text'} step={field.type === 'number' ? field.step ?? 'any' : undefined} value={values[field.name] ?? ''} placeholder={field.placeholder} required={field.required} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))} />
              )}
              {field.hint ? <small>{field.hint}</small> : null}
            </label>
          )
        })}
        <div className="md-form-foot">
          {dialog.onDelete ? <button type="button" className="md-btn is-danger" onClick={() => { dialog.onDelete(); close() }}>{t('删除')}</button> : null}
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary">{dialog.submitLabel ?? t('保存')}</button>
        </div>
      </form>
    </Dialog>
  )
}

export function Toast() {
  const toast = useDesk(s => s.toast)
  if (!toast) return null
  return (
    <div key={toast.key} className={`md-toast ${toast.error ? 'is-error' : ''}`} role={toast.error ? 'alert' : 'status'}>
      {toast.undo ? <Icon name="check" size={14} /> : null}
      <span>{toast.text}</span>
      {toast.undo ? <button type="button" onClick={undo}>{t('撤销')}</button> : null}
    </div>
  )
}

export function Empty({ title, hint, action }) {
  return (
    <div className="md-empty">
      <p className="md-empty-title">{title}</p>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  )
}

/** 一组按键：seq 为真时是先后按（G 然后 D），否则是同时按（⌘ K）。 */
export function Keys({ keys, seq = false }) {
  return (
    <span className="md-keys">
      {keys.map((key, index) => (
        <React.Fragment key={index}>
          {seq && index ? <span className="md-keys-then">{t('然后')}</span> : null}
          <kbd className="md-kbd">{key}</kbd>
        </React.Fragment>
      ))}
    </span>
  )
}

/**
 * 会换字的按钮标签（比如「重新抓取」↔「正在抓取…」）：几段字叠在同一格里，宽度按最宽的那段算，换字时按钮不变宽变窄、旁边的东西不跟着挪。
 * @param {{ labels: string[], at?: number }} props - labels 是所有可能出现的字，at 是现在显示第几段。
 */
export function Swap({ labels, at = 0 }) {
  return (
    <span className="md-swap">
      {labels.map((label, index) => <span key={index} aria-hidden={index === at ? undefined : 'true'}>{label}</span>)}
    </span>
  )
}
