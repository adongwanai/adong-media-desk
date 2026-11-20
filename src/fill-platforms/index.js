// 「填到草稿」支持的平台：每个平台一个小文件（发布页地址、各字段怎么定位、草稿按钮、绝不能点的按钮）。
// 加平台：照 xiaohongshu.js 写一个，再登记到这里。公众号走官方接口推草稿，不在这里。
// 这些文件不引 Node 模块，界面也从这里读支持哪些平台、内容够不够填。
import { xiaohongshu } from './xiaohongshu.js'

export const FILL_ADAPTERS = Object.freeze({ [xiaohongshu.platform]: xiaohongshu })
export const FILL_PLATFORMS = Object.freeze(Object.keys(FILL_ADAPTERS))

/** 某个平台的适配器；不支持就是 null。 */
export function fillAdapter(platform) {
  return Object.hasOwn(FILL_ADAPTERS, platform) ? FILL_ADAPTERS[platform] : null
}
