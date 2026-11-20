// 长列表和封面图的两个小工具：分段渲染、图片读不到时的兜底。
import React from 'react'

/**
 * 一屏装不下时先画前面一段，末尾的哨兵快进入视野时再接着画。
 * @param {number} total - 一共多少条。
 * @param {number} page - 每次多画几条。
 * @param {unknown} [reset] - 这个值变了（比如换了筛选）就回到第一段。
 */
export function useProgressive(total, page, reset) {
  const [limit, setLimit] = React.useState(page)
  const sentinel = React.useRef(null)
  React.useEffect(() => { setLimit(page) }, [reset, page])
  React.useEffect(() => {
    const el = sentinel.current
    if (!el || limit >= total || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setLimit(value => value + page) }, { rootMargin: '400px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [limit, total, page])
  return { limit, sentinel, more: () => setLimit(value => value + page) }
}

/** 封面图：没有地址或读不到时显示 fallback，不出现破图标。 */
export function Poster({ src, fallback = null }) {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [src])
  if (!src || failed) return fallback
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
}

/** 缩略图占位用的一个字：跳过开头的括号和标点，【验证】取「验」。 */
export function initialOf(title) {
  const match = String(title ?? '').match(/[\p{L}\p{N}]/u)
  return match ? match[0].toUpperCase() : '·'
}
