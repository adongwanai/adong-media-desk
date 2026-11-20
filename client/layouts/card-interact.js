// 预览卡片上的图片和表格调整，同言起 setupImageZoom / setupTableResize：
// 图片：拖图片本体 = 平移；右上角 − / + = 缩放（再加一个滑杆、Ctrl/⌘ + 滚轮和触控板双指捏合）；四角拖拽 = 改大小；↺ = 复位。
// 表格：右上角 − / + / ↺ 调字号缩放，右下角拖拽缩放。
// 这些控件只加在预览的 shadow root 里，导出用的卡片 HTML 里没有它们。拖动中直接改样式，松手才记下来（重新排版）。
// 卡片在预览里按比例缩小显示，所以屏幕上的位移要除以缩放比，控件尺寸要乘回来，看起来才和言起一样大。

export const CONTROL_CSS = `
[data-img]{cursor:grab;touch-action:none}
[data-img].is-dragging{cursor:grabbing}
[data-img] img{transition:transform .18s cubic-bezier(.2,.8,.2,1)}
[data-img].is-dragging img,[data-img].is-live img{transition:none}
.mdx-ctrl{position:absolute;top:calc(6px * var(--inv));right:calc(6px * var(--inv));display:flex;align-items:center;gap:calc(4px * var(--inv));opacity:0;transition:opacity .15s ease;z-index:4;line-height:1}
.mdx-btn{width:calc(24px * var(--inv));height:calc(24px * var(--inv));padding:0;border:none;border-radius:calc(6px * var(--inv));background:rgba(0,0,0,.62);color:#fff;font:600 calc(15px * var(--inv))/1 system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center}
.mdx-btn:hover{background:rgba(0,0,0,.82)}
.mdx-range{width:calc(76px * var(--inv));height:calc(24px * var(--inv));margin:0;padding:0 calc(6px * var(--inv));border-radius:calc(6px * var(--inv));background:rgba(0,0,0,.62);accent-color:#fff;cursor:pointer}
.mdx-pct{min-width:calc(34px * var(--inv));height:calc(24px * var(--inv));padding:0 calc(4px * var(--inv));border-radius:calc(6px * var(--inv));background:rgba(0,0,0,.62);color:#fff;font:600 calc(11px * var(--inv))/calc(24px * var(--inv)) system-ui,sans-serif;text-align:center;font-variant-numeric:tabular-nums}
.mdx-corner{position:absolute;width:calc(16px * var(--inv));height:calc(16px * var(--inv));background:rgba(0,0,0,.55);border:calc(2px * var(--inv)) solid rgba(255,255,255,.92);border-radius:calc(3px * var(--inv));opacity:0;transition:opacity .15s ease;z-index:5;touch-action:none;box-sizing:border-box}
.mdx-corner:hover{background:rgba(0,0,0,.8)}
.mdx-nw{top:calc(5px * var(--inv));left:calc(5px * var(--inv));cursor:nwse-resize}
.mdx-ne{top:calc(5px * var(--inv));right:calc(5px * var(--inv));cursor:nesw-resize}
.mdx-sw{bottom:calc(5px * var(--inv));left:calc(5px * var(--inv));cursor:nesw-resize}
.mdx-se{bottom:calc(5px * var(--inv));right:calc(5px * var(--inv));cursor:nwse-resize}
[data-img]:hover .mdx-ctrl,[data-img]:hover .mdx-corner,[data-img]:focus-within .mdx-ctrl,[data-img].is-live .mdx-ctrl,[data-img].is-live .mdx-corner{opacity:1}
[data-img].is-snap{box-shadow:0 0 0 calc(2px * var(--inv)) #3b82f6 !important}
.mdx-twrap{position:relative}
.mdx-tctrl{position:absolute;top:calc(4px * var(--inv));right:calc(4px * var(--inv));display:flex;gap:calc(3px * var(--inv));opacity:0;transition:opacity .15s ease;z-index:6}
.mdx-tctrl .mdx-btn{width:calc(22px * var(--inv));height:calc(22px * var(--inv));font-size:calc(14px * var(--inv));background:rgba(0,0,0,.55)}
.mdx-tctrl .mdx-pct{height:calc(22px * var(--inv));line-height:calc(22px * var(--inv));background:rgba(0,0,0,.55)}
.mdx-tresize{position:absolute;right:calc(2px * var(--inv));bottom:calc(2px * var(--inv));width:calc(16px * var(--inv));height:calc(16px * var(--inv));box-sizing:border-box;border-radius:calc(4px * var(--inv));background:rgba(0,0,0,.5);border:calc(2px * var(--inv)) solid rgba(255,255,255,.9);cursor:nwse-resize;opacity:0;transition:opacity .15s ease;z-index:6;touch-action:none}
.mdx-twrap:hover .mdx-tctrl,.mdx-twrap:hover .mdx-tresize,.mdx-twrap.is-live .mdx-tctrl,.mdx-twrap.is-live .mdx-tresize{opacity:1}
[data-img].is-limit{box-shadow:0 0 0 calc(2px * var(--inv)) #f59e0b !important}
.mdx-limit{position:absolute;left:50%;bottom:calc(8px * var(--inv));transform:translateX(-50%);padding:calc(3px * var(--inv)) calc(8px * var(--inv));border-radius:calc(999px * var(--inv));background:#f59e0b;color:#1f1300;font:600 calc(11px * var(--inv))/1.3 system-ui,sans-serif;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s ease;z-index:6}
[data-img].is-limit .mdx-limit{opacity:1}
.mdx-twrap.is-limit table{outline:calc(2px * var(--inv)) solid #f59e0b;outline-offset:calc(2px * var(--inv))}
.mdx-twrap.is-limit .mdx-pct{background:#f59e0b;color:#1f1300}
[data-slot="title"]{cursor:text;border-radius:calc(4px * var(--inv))}
[data-slot="title"]:hover{outline:calc(1.5px * var(--inv)) dashed rgba(59,130,246,.75);outline-offset:calc(4px * var(--inv))}
[data-line].mdx-hit{outline:calc(2px * var(--inv)) solid rgba(59,130,246,.55);outline-offset:calc(3px * var(--inv));border-radius:4px;transition:outline-color .6s ease}
[data-line].mdx-hit.mdx-fade{outline-color:rgba(59,130,246,0)}
@media (prefers-reduced-motion: reduce){[data-img] img,.mdx-ctrl,.mdx-corner,.mdx-tctrl,.mdx-tresize,.mdx-limit{transition:none}}
`

const IMAGE = { min: 60, scaleMin: 0.5, scaleMax: 3, step: 0.1 }
const TABLE = { min: 0.5, max: 1.6, step: 0.05 }
// 拖到离整宽、原图比例不到 6px 时吸附过去
const SNAP = 6

/**
 * 拖四角放大图片时，高度最多拉到多少（卡片像素）。
 * 切页时，图片和它前面的内容一起放得下这一页，图片才留在这页；图片底边一旦越过正文区底边，松手重新切页就会把整张图挤到下一页，
 * 手里拖着的东西突然不见了。所以拖的时候就把高度卡在「图片顶边到正文区底边」这段空间里：图片后面的文字放不下会自己流到下一页，图片不动。
 * @param {object} m - { room: 图片框顶边到正文区底边的距离, margin: 图片框的下边距, limit: 原来的上限（正文区高 - 24）, current: 开始拖时的高度 }，单位都是卡片像素。
 * @returns {number} 高度上限。
 */
export function imageMaxHeight({ room, margin = 0, limit = Infinity, current = 0 }) {
  const fit = Math.floor(room - margin) - 1
  // 原来就比这页还高（一页只有这张图、硬放进来的）：不让再往大拉，但也不在一按下时就把它压小
  return Math.max(IMAGE.min, Math.min(limit, Math.max(fit, Math.min(current, limit))))
}

/**
 * 在 [lo, hi] 里二分找放得下的最大缩放，精确到 0.01；hi 放得下就是 hi，lo 也放不下就返回 lo。
 * 表格放大是改字号，高度和缩放不成正比（单元格内边距不变），只能一边试一边量。
 */
export function largestFit(lo, hi, fits) {
  if (hi <= lo || fits(hi)) return hi
  // 按百分之一一格二分：a 一直是放得下的那头（起点当作放得下），b 是还没试过的最大值
  let a = Math.round(lo * 100)
  let b = Math.round(hi * 100) - 1
  while (a < b) {
    const mid = Math.ceil((a + b) / 2)
    if (fits(mid / 100)) a = mid
    else b = mid - 1
  }
  return Math.max(lo, a / 100)
}

function limitBadge(text) {
  const el = document.createElement('span')
  el.className = 'mdx-limit'
  el.textContent = text
  return el
}

function button(text, title, onClick) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'mdx-btn'
  el.textContent = text
  el.title = title
  el.setAttribute('aria-label', title)
  el.addEventListener('pointerdown', event => event.stopPropagation())
  el.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick() })
  return el
}

function stop(event) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * 给一张卡片（shadow root）里的图片和表格装上调整控件。
 * @param {ShadowRoot} root - 卡片所在的 shadow root。
 * @param {object} options - { scale: () => 预览缩放比, labels, images: key → 状态, tables: key → 缩放, body: 正文区宽高,
 *   onImage(key, state), onImageReset(key), onTable(key, scale) }。
 */
export function attachControls(root, options) {
  const L = options.labels
  const inv = () => 1 / Math.max(0.2, options.scale())
  root.host.style.setProperty('--inv', String(inv()))
  const body = root.querySelector('[data-part="body"]')
  // 某个元素底边到正文区底边还剩多少（卡片像素）；卡片在预览里缩小显示，屏幕距离要乘回来
  const roomBelow = (el, edge = 'bottom') => (body ? (body.getBoundingClientRect().bottom - el.getBoundingClientRect()[edge]) * inv() : Infinity)
  const marginBelow = el => parseFloat(getComputedStyle(el).marginBottom) || 0
  // 封面标题可以点了直接改（改的是卡片自己的封面标题，不是稿子标题）
  for (const title of root.querySelectorAll('[data-slot="title"]')) title.title = L.editTitle

  for (const frame of root.querySelectorAll('[data-img]')) {
    const key = frame.getAttribute('data-img')
    const img = frame.querySelector('img')
    if (!img) continue
    const fixed = frame.hasAttribute('data-fixed')
    const st = { s: 1, x: 0, y: 0, ...(options.images[key] ?? {}) }
    const natural = Number(img.getAttribute('width')) / Number(img.getAttribute('height')) || img.naturalWidth / img.naturalHeight || 4 / 3
    const pct = document.createElement('span')
    pct.className = 'mdx-pct'
    const range = document.createElement('input')
    range.type = 'range'
    range.className = 'mdx-range'
    range.min = String(IMAGE.scaleMin)
    range.max = String(IMAGE.scaleMax)
    range.step = '0.05'
    range.setAttribute('aria-label', L.zoom)
    range.addEventListener('pointerdown', event => event.stopPropagation())
    // 平移不能把图拖得完全离开框：最多拖出去八成
    const clampPan = () => {
      const w = frame.clientWidth * st.s
      const h = frame.clientHeight * st.s
      st.x = Math.round(Math.max(-w * 0.8, Math.min(w * 0.8, st.x)) * 10) / 10
      st.y = Math.round(Math.max(-h * 0.8, Math.min(h * 0.8, st.y)) * 10) / 10
    }
    const applyT = () => {
      img.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.s})`
      pct.textContent = `${Math.round(st.s * 100)}%`
      range.value = String(st.s)
    }
    const applyH = () => {
      if (fixed) return
      if (typeof st.w === 'number') frame.style.width = `${st.w}px`
      if (typeof st.h === 'number') frame.style.height = `${st.h}px`
    }
    const save = () => options.onImage(key, { ...st })
    const zoomTo = (value) => {
      st.s = Math.min(IMAGE.scaleMax, Math.max(IMAGE.scaleMin, Math.round(value * 100) / 100))
      clampPan()
      applyT()
    }
    applyT()
    range.addEventListener('input', () => { frame.classList.add('is-live'); zoomTo(Number(range.value)) })
    range.addEventListener('change', () => { frame.classList.remove('is-live'); save() })

    const ctrl = document.createElement('div')
    ctrl.className = 'mdx-ctrl'
    ctrl.append(
      button('−', L.zoomOut, () => { zoomTo(st.s - IMAGE.step); save() }),
      range,
      pct,
      button('+', L.zoomIn, () => { zoomTo(st.s + IMAGE.step); save() }),
      button('↺', L.reset, () => { st.s = 1; st.x = 0; st.y = 0; delete st.w; delete st.h; applyT(); options.onImageReset(key) }),
    )
    frame.appendChild(ctrl)
    img.title = L.imageHint

    // 平移
    let drag = null
    img.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      drag = { sx: event.clientX, sy: event.clientY, ox: st.x, oy: st.y, moved: false }
      frame.classList.add('is-dragging')
      try { img.setPointerCapture(event.pointerId) } catch { /* 拿不到捕获也能拖 */ }
      stop(event)
    })
    img.addEventListener('pointermove', (event) => {
      if (!drag) return
      const k = inv()
      st.x = drag.ox + (event.clientX - drag.sx) * k
      st.y = drag.oy + (event.clientY - drag.sy) * k
      drag.moved = drag.moved || Math.abs(event.clientX - drag.sx) + Math.abs(event.clientY - drag.sy) > 2
      clampPan()
      applyT()
    })
    const endDrag = (event) => {
      if (!drag) return
      const moved = drag.moved
      drag = null
      frame.classList.remove('is-dragging')
      try { img.releasePointerCapture(event.pointerId) } catch { /* 已经释放 */ }
      if (moved) save()
    }
    img.addEventListener('pointerup', endDrag)
    img.addEventListener('pointercancel', endDrag)
    img.addEventListener('click', event => event.stopPropagation())

    // Ctrl / ⌘ + 滚轮，触控板捏合（浏览器会带上 ctrlKey）
    let wheelTimer = null
    frame.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      stop(event)
      frame.classList.add('is-live')
      zoomTo(st.s * Math.exp(-event.deltaY * 0.0025))
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => { frame.classList.remove('is-live'); save() }, 260)
    }, { passive: false })

    if (fixed) continue
    frame.appendChild(limitBadge(L.pageLimit))
    // 四角改大小：横向按中心对称（同言起 ×2），纵向单边；不超过正文区，也不超过这一页剩下的高度（见 imageMaxHeight）
    for (const [cls, hx, vy] of [['mdx-nw', -1, -1], ['mdx-ne', 1, -1], ['mdx-sw', -1, 1], ['mdx-se', 1, 1]]) {
      const handle = document.createElement('div')
      handle.className = `mdx-corner ${cls}`
      handle.title = L.resize
      frame.appendChild(handle)
      let rz = null
      handle.addEventListener('pointerdown', (event) => {
        const h0 = st.h ?? frame.offsetHeight
        const maxH = imageMaxHeight({ room: roomBelow(frame, 'top'), margin: marginBelow(frame), limit: options.body.height - 24, current: h0 })
        rz = { sx: event.clientX, sy: event.clientY, w0: st.w ?? frame.offsetWidth, h0, maxW: options.body.width, maxH }
        frame.classList.add('is-live')
        try { handle.setPointerCapture(event.pointerId) } catch { /* 拿不到捕获也能拖 */ }
        stop(event)
      })
      handle.addEventListener('pointermove', (event) => {
        if (!rz) return
        const k = inv()
        let w = Math.max(IMAGE.min, Math.min(rz.maxW, rz.w0 + hx * (event.clientX - rz.sx) * 2 * k))
        const want = rz.h0 + vy * (event.clientY - rz.sy) * k
        let h = Math.max(IMAGE.min, Math.min(rz.maxH, want))
        // 顶到这页底了：亮一圈橙色并提示，让人知道不是没拖动
        frame.classList.toggle('is-limit', want > rz.maxH + 0.5)
        let snapped = false
        if (rz.maxW - w < SNAP) { w = rz.maxW; snapped = true }
        if (Math.abs(h - w / natural) < SNAP && w / natural <= rz.maxH) { h = w / natural; snapped = true }
        frame.classList.toggle('is-snap', snapped)
        st.w = Math.round(w)
        st.h = Math.round(h)
        applyH()
      })
      const end = (event) => {
        if (!rz) return
        rz = null
        frame.classList.remove('is-live', 'is-snap', 'is-limit')
        try { handle.releasePointerCapture(event.pointerId) } catch { /* 已经释放 */ }
        save()
      }
      handle.addEventListener('pointerup', end)
      handle.addEventListener('pointercancel', end)
      handle.addEventListener('click', event => event.stopPropagation())
    }
  }

  for (const table of root.querySelectorAll('table[data-table]')) {
    const key = table.getAttribute('data-table')
    const wrap = document.createElement('div')
    wrap.className = 'mdx-twrap'
    table.parentNode.insertBefore(wrap, table)
    wrap.appendChild(table)
    const cells = [...table.querySelectorAll('th, td')]
    const base = cells.map(cell => parseFloat(cell.style.fontSize) || 16)
    const start = options.tables[key] ?? 1
    let s = start
    const pct = document.createElement('span')
    pct.className = 'mdx-pct'
    const apply = () => {
      cells.forEach((cell, i) => { cell.style.fontSize = `${((base[i] / start) * s).toFixed(2)}px` })
      pct.textContent = `${Math.round(s * 100)}%`
    }
    const set = (value) => { s = Math.min(TABLE.max, Math.max(TABLE.min, Math.round(value * 100) / 100)); apply() }
    apply()
    const ctrl = document.createElement('div')
    ctrl.className = 'mdx-tctrl'
    ctrl.append(
      button('−', L.tableSmaller, () => { set(s - TABLE.step); options.onTable(key, s) }),
      pct,
      button('+', L.tableBigger, () => { set(s + TABLE.step); options.onTable(key, s) }),
      button('↺', L.reset, () => { set(1); options.onTable(key, 1) }),
    )
    wrap.appendChild(ctrl)
    const handle = document.createElement('div')
    handle.className = 'mdx-tresize'
    handle.title = L.tableDrag
    // 表格到页底时不另贴提示条（会盖住最后一行字），橙色描边 + 百分比变橙就够了
    wrap.appendChild(handle)
    // 表格底边离正文区底边还剩多少；小于 0 就是超出这一页了
    const slack = () => roomBelow(wrap) - marginBelow(table)
    let rz = null
    handle.addEventListener('pointerdown', (event) => {
      // 开始拖时整张表还在这页里，就把放大卡在这页放得下的范围内，免得松手后整张表被挤走；
      // 表格本来就顶着页底（已经拆到下一页）时不卡：多出来的行本来就会接到下一页，表头留在这页
      rz = { start: event.clientX + event.clientY, s0: s, capped: slack() > 4 }
      wrap.classList.add('is-live')
      try { handle.setPointerCapture(event.pointerId) } catch { /* 拿不到捕获也能拖 */ }
      stop(event)
    })
    handle.addEventListener('pointermove', (event) => {
      if (!rz) return
      // 同言起：对角线方向每 300px 变 1 倍
      const before = s
      set(rz.s0 + ((event.clientX + event.clientY - rz.start) * inv()) / 300)
      const over = rz.capped && s > before && slack() < 0
      if (over) set(largestFit(before, s, (value) => { set(value); return slack() >= 0 }))
      wrap.classList.toggle('is-limit', over)
      pct.title = over ? L.pageLimit : ''
    })
    const end = (event) => {
      if (!rz) return
      rz = null
      wrap.classList.remove('is-live', 'is-limit')
      try { handle.releasePointerCapture(event.pointerId) } catch { /* 已经释放 */ }
      options.onTable(key, s)
    }
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
    for (const el of [ctrl, handle]) el.addEventListener('click', event => event.stopPropagation())
  }
}

/** 预览里闪一下第 line 行对应的块（同言起切页时的高亮，多了块级定位）。 */
export function flashLine(root, line) {
  const nodes = [...root.querySelectorAll('[data-line]')].filter(node => node.closest('[data-part="body"]'))
  let best = null
  for (const node of nodes) {
    const at = Number(node.getAttribute('data-line'))
    if (at <= line && (!best || at >= Number(best.getAttribute('data-line')))) best = node
  }
  if (!best) return
  best.classList.remove('mdx-hit', 'mdx-fade')
  best.classList.add('mdx-hit')
  setTimeout(() => best.classList.add('mdx-fade'), 700)
  setTimeout(() => best.classList.remove('mdx-hit', 'mdx-fade'), 1400)
}
