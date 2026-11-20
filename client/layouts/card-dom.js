// 图文卡片在浏览器里的部分：量真实高度、把本地图片转成 data URL、导出 PNG。
// 导出不用第三方库：卡片 HTML → SVG <foreignObject> → Image → canvas → PNG。卡片只有行内样式和 data URL 图片，画布不会被污染。
// 排版来自言起 YANQI（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian），言起基于 Note to RED（Yeban8090，MIT）。
import { CARD_HEIGHT, CARD_WIDTH, EXPORT_HEIGHT, EXPORT_WIDTH, renderCard } from './cards.js'
import { makeZip } from './zip.js'
import { fetchImageViaHost } from '../desk.js'

let measurer = null

/** 量高度用的隐藏卡片：挂在页面外，用 shadow root 隔开工作台自己的样式。 */
function measureRoot(width = CARD_WIDTH, height = CARD_HEIGHT) {
  if (!measurer?.host.isConnected) {
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    document.body.appendChild(host)
    measurer = { host, root: host.attachShadow({ mode: 'open' }) }
  }
  measurer.host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict;`
  return measurer.root
}

/** 这一页放进卡片里会不会溢出：正文那一节的内容高度不超过它的可见高度。 */
export function measureFits(page, ctx) {
  const root = measureRoot(ctx.width, ctx.height)
  // renderCard 先转义再拼标签，正文里的 HTML 不会执行
  root.innerHTML = renderCard(page, ctx)
  const body = root.querySelector('[data-part="body"]')
  return body ? body.scrollHeight <= body.clientHeight + 1 : true
}

// 工作台自己的文件，和打包进来的言起背景图
const LOCAL = /^\/?media-desk\/(files\/[\w.-]+|imported\/[\w-]+\.[a-z0-9]{2,5}|assets\/yanqi-bg-\d\.jpg)$/i
const DATA = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i
const REMOTE = /^https?:\/\/[^\s"'<>]+$/i
const MAX_SIDE = 1600

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * 把一张图转成 data URL，并记下原始宽高。只收工作台自己的文件（media-desk/files/…）、data:image 和 http(s) 图片。
 * 太大的图缩到长边 1600 像素，导出时不至于拖慢。
 * @returns {Promise<{src: string, width: number, height: number} | null>} 读不到时是 null。
 */
export async function inlineImage(src) {
  const raw = String(src ?? '')
  try {
    let url = raw
    if (REMOTE.test(raw)) {
      // 公网图片：先直接取（GitHub 图床这类允许跨域），不行再请 Host 代取
      url = await fetch(raw, { mode: 'cors', credentials: 'omit' })
        .then(res => (res.ok ? res.blob() : Promise.reject(new Error('http'))))
        .then(blob => (/^image\/(png|jpe?g|webp|gif)$/.test(blob.type) ? readAsDataUrl(blob) : Promise.reject(new Error('type'))))
        .catch(() => fetchImageViaHost(raw).then(data => data.src))
      if (!DATA.test(url)) return null
    } else if (LOCAL.test(raw)) {
      const res = await fetch(raw)
      if (!res.ok) return null
      const blob = await res.blob()
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(blob.type)) return null
      url = await readAsDataUrl(blob)
    } else if (!DATA.test(raw)) {
      return null
    }
    const img = await loadImage(url)
    const width = img.naturalWidth
    const height = img.naturalHeight
    if (!width || !height) return null
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    if (scale >= 1) return { src: url, width, height }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    const type = /^data:image\/png/.test(url) ? 'image/png' : 'image/jpeg'
    return { src: canvas.toDataURL(type, 0.92), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

/** 抽样检查画布：读得出像素（没被污染），而且不止一种颜色（不是空白）。 */
function assertNotBlank(ctx, width, height) {
  const data = ctx.getImageData(0, 0, width, height).data
  const seen = new Set()
  const step = 7
  for (let y = 3; y < height; y += Math.floor(height / 48)) {
    for (let x = 3; x < width; x += step) {
      const i = (y * width + x) * 4
      seen.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3},${data[i + 3] >> 5}`)
      if (seen.size > 2) return
    }
  }
  throw new Error('blank')
}

/**
 * 一张卡片 → PNG。
 * @param {string} html - renderCard 的结果（图片已经是 data URL）。
 * @param {{cardWidth?: number, cardHeight?: number, width?: number, height?: number}} [size] - 排版尺寸和导出像素。
 * @returns {Promise<Blob>} 导出像素大小的 PNG。
 */
export async function cardToPng(html, { cardWidth = CARD_WIDTH, cardHeight = CARD_HEIGHT, width = EXPORT_WIDTH, height = EXPORT_HEIGHT } = {}) {
  const CARD_W = cardWidth
  const CARD_H = cardHeight
  const template = document.createElement('template')
  // template 里的内容不会加载图片、不会执行；html 由 renderCard 生成，正文已全部转义
  template.innerHTML = html
  const node = template.content.firstElementChild
  if (!node) throw new Error('empty')
  const xhtml = new XMLSerializer().serializeToString(node)
  // SVG 本身按导出像素声明：位图在这一步就按高分辨率栅格化，放大后文字不糊
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${CARD_W} ${CARD_H}"><foreignObject x="0" y="0" width="${CARD_W}" height="${CARD_H}">${xhtml}</foreignObject></svg>`
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, width, height)
  assertNotBlank(ctx, width, height)
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/png'))
}

/** 触发浏览器下载。 */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** 一张卡片的 PNG 写进剪贴板（同言起 ClipboardManager）。浏览器不允许时抛错。 */
export async function copyPng(blobOrPromise) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('clipboard')
  // 把 Promise 直接交给 ClipboardItem：生成图片要时间，Safari 要求在点击的同一轮里调用 write
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blobOrPromise) })])
}

/**
 * 多张卡片打成一个 ZIP（只存不压，同言起 jszip 的 STORE）。
 * @param {Array<{name: string, blob: Blob}>} files
 * @returns {Promise<Blob>}
 */
export async function zipBlobs(files) {
  const entries = []
  for (const file of files) entries.push({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) })
  return new Blob([makeZip(entries)], { type: 'application/zip' })
}

/** 图片文件读成 data URL，长边缩到 max 像素（背景图、头像用）。 */
export function shrinkImage(file, max = 1600, type = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL(type, 0.86))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image'))
    }
    img.src = url
  })
}
