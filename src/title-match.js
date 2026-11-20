// 按标题把一条数据挂到工作台里的内容上。表格导入和本机工具读到的作品共用这一套规则，纯函数。

/**
 * 标题和已有内容（灵感标题或成稿标题）完全一样、且只对上一条时，返回那条内容的 id；对不上或同名的不止一条就不挂。
 * @param {Array<object>} items - 工作台里的内容。
 * @returns {(title: string|undefined) => string|null} 按标题找内容 id。
 */
export function titleMatcher(items) {
  const owners = new Map()
  for (const item of items ?? []) {
    for (const title of new Set([item.title, item.production?.title].map(value => String(value ?? '').trim()).filter(Boolean))) {
      owners.set(title, [...(owners.get(title) ?? []), item.id])
    }
  }
  return (title) => {
    const ids = title ? owners.get(title) ?? [] : []
    return ids.length === 1 ? ids[0] : null
  }
}
