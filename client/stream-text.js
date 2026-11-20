// 只展示服务端实际收到的文字，把轮询批次平滑展开；替换或撤回时立即跟随。
export function advanceStream(current, target, active) {
  if (!active || !target.startsWith(current)) return target
  const remaining = Array.from(target.slice(current.length))
  return current + remaining.slice(0, Math.max(1, Math.ceil(remaining.length / 6))).join('')
}
