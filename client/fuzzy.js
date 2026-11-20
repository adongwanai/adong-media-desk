// 命令面板的模糊匹配：连续命中排最前，字按顺序出现（中间可以隔字）也算命中。

/**
 * @param {string} query - 输入的词，空格分开的每一段都要命中。
 * @param {string} text - 被搜的文字。
 * @returns {number} 分数，越大越靠前；-1 表示没命中。
 */
export function fuzzyScore(query, text) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const target = String(text ?? '').toLowerCase()
  if (!words.length) return 0
  let total = 0
  for (const word of words) {
    const score = wordScore(word, target)
    if (score < 0) return -1
    total += score
  }
  return total
}

function wordScore(word, target) {
  const at = target.indexOf(word)
  // 整段连着出现：越靠前越好
  if (at >= 0) return 1000 - Math.min(at, 500)
  let from = 0
  let gaps = 0
  for (const char of word) {
    const found = target.indexOf(char, from)
    if (found < 0) return -1
    gaps += found - from
    from = found + 1
  }
  return Math.max(1, 500 - gaps)
}

/**
 * 按分数筛选并排序，分数一样时保持原来的顺序。
 * @template T
 * @param {T[]} rows
 * @param {string} query
 * @param {(row: T) => string} textOf
 * @returns {T[]}
 */
export function fuzzyFilter(rows, query, textOf) {
  return rows
    .map((row, index) => ({ row, index, score: fuzzyScore(query, textOf(row)) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.row)
}
