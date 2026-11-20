import React from 'react'
import { advanceStream } from './stream-text.js'

// 平滑展示已收到的字，不生成占位内容；结束后立即显示完整稿件。
export function useStreamText(target, active) {
  const [shown, setShown] = React.useState(target)
  React.useEffect(() => {
    if (!active || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(target); return }
    const timer = setInterval(() => setShown(current => advanceStream(current, target, true)), 24)
    return () => clearInterval(timer)
  }, [target, active])
  return active ? shown : target
}
