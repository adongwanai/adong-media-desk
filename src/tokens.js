// 粗分词：中文按相邻两字、英文按整词切。不依赖 Node 模块，浏览器和 Host 共用。
const STOP = new Set(['我们', '你们', '他们', '这个', '那个', '一个', '什么', '怎么', '可以', '没有', '不是', '就是', '因为', '所以', '如果', '但是', '还是', '已经', '自己'])

/** 中文按相邻两字、英文按整词切，粗略衡量两段话聊的是不是一件事。 */
export function tokens(text) {
  const out = new Set()
  const source = String(text ?? '').toLowerCase()
  for (const word of source.match(/[a-z0-9][a-z0-9+#.-]{1,}/g) ?? []) out.add(word)
  for (const run of source.match(/[一-鿿]{2,}/g) ?? []) {
    for (let i = 0; i < run.length - 1; i += 1) {
      const pair = run.slice(i, i + 2)
      if (!STOP.has(pair)) out.add(pair)
    }
  }
  return out
}
