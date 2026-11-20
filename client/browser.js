// 在 DeepSeek Harness 右侧的内置浏览器里打开网页；宿主没有这个能力（比如独立运行）时退回系统浏览器的新标签页。
let host = null

/** 插件加载时记下宿主上下文。 */
export function bindHost(ctx) {
  host = ctx
}

function sidebar() {
  try {
    const service = host?.sidebarRight ?? host?.get?.('sidebarRight')
    return typeof service?.openTab === 'function' ? service : null
  } catch {
    return null
  }
}

/**
 * @param {string} url - 只接受 http(s) 地址。
 * @returns {'sidebar'|'window'|null} 在哪里打开的；地址不合法时为 null。
 */
export function openInBrowser(url) {
  let target
  try {
    target = new URL(url)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  const service = sidebar()
  if (service) {
    try {
      service.openTab('browser', { params: { url: target.toString() } })
      return 'sidebar'
    } catch (error) {
      console.warn('[dsh-media-desk] 右侧浏览器打不开，改用新标签页：', error)
    }
  }
  window.open(target.toString(), '_blank', 'noopener,noreferrer')
  return 'window'
}
