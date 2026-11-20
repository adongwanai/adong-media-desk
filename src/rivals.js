// 对标账号：读别人主页上公开的数字。和「我的账号」用同一套读取器（collect.js）：只读公开接口和页面里的结构化数据，不登录；读不到就如实说读不到，不估算。
import { readAccount, readSupport } from './collect.js'
import { fetchErrorText, harvest } from './harvest.js'
import { safeFetch } from './net.js'
import { ACCOUNT_PLATFORMS } from './ops.js'
import { tr } from './i18n.js'

const CONCURRENCY = 4

/** 从 B 站主页地址里取 UID。 */
export function bilibiliUid(url) {
  return /space\.bilibili\.com\/(\d+)/.exec(String(url))?.[1] ?? null
}

/** 没有读取器的平台只看公开页面：标题当名字。页面文字里的「数字 + 粉丝」可能是关注数或推荐语，不当成粉丝数记。 */
async function fromPage(url, fetchImpl) {
  const page = await harvest(url, fetchImpl)
  return { name: page.title, followers: null, works: null }
}

/**
 * 读一个对标账号。
 * @param {{id: string, platform: string, url: string}} rival - 对标账号。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{id: string, name: string|null, followers: number|null, works: number|null, error: string|null}>} 读到的数字或原因。
 */
export async function readRival(rival, fetchImpl = safeFetch) {
  try {
    if (!ACCOUNT_PLATFORMS.includes(rival.platform)) throw new Error(tr('平台无效'))
    if (readSupport()[rival.platform].readable) {
      const got = await readAccount(rival, fetchImpl)
      return { id: rival.id, name: got.name, followers: got.followers, works: got.stats.works ?? null, error: got.error }
    }
    const info = await fromPage(rival.url, fetchImpl)
    return { id: rival.id, name: info.name || null, followers: null, works: null, error: tr('这个平台不登录读不到粉丝数') }
  } catch (err) {
    return { id: rival.id, name: null, followers: null, works: null, error: fetchErrorText(err) }
  }
}

/**
 * 这次要读哪几个：ids 是数组就只读里面的（刚加的账号加完就读一次），否则全读。
 * @param {Array<object>} rivals - 全部对标账号。
 * @param {unknown} ids - 请求里给的账号 ID。
 * @returns {Array<object>} 要读的账号。
 */
export function pickRivals(rivals, ids) {
  if (!Array.isArray(ids)) return rivals ?? []
  const wanted = new Set(ids.filter(id => typeof id === 'string'))
  return (rivals ?? []).filter(rival => wanted.has(rival.id))
}

/**
 * 读全部对标账号。同时最多 4 个，每个账号只发一次请求。
 * @param {Array<object>} rivals - 对标账号。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<Array<object>>} 和输入同序的结果。
 */
export async function readRivals(rivals, fetchImpl = safeFetch) {
  const results = new Array(rivals.length)
  let next = 0
  const worker = async () => {
    while (next < rivals.length) {
      const index = next
      next += 1
      results[index] = await readRival(rivals[index], fetchImpl)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rivals.length) }, worker))
  return results
}
