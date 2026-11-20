// 提醒推送（可选，默认关）：每天自动读取之后，有平台要重新登录、或者连着几轮都没读到时，往用户自己填的 Webhook 地址 POST 一条。
// 发出去的只有 {title, text, at}：哪个平台、哪一类原因、什么时候。不带稿子内容、账号名、粉丝数和任何数据，
// 原因只用下面两句固定的话，不把读取时的报错原文发出去（报错里可能带主页地址）。
// 每个平台每天最多一条；发失败不重试；地址和密钥一样只存在设置里，不写进状态、日志和报错。
import { platformName, tr } from './i18n.js'

export const NOTIFY_DEFAULTS = { enabled: false, webhook: '' }
const TIMEOUT_MS = 10_000

/** 本地时区的 YYYY-MM-DD。 */
function localDay(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 检查用户填的 Webhook 地址：只收 http(s)，不带账号密码段。
 * @param {string} value - 用户填的地址。
 * @returns {string|null} 整理好的地址；不合格是 null。
 */
export function cleanWebhook(value) {
  const text = String(value ?? '').trim()
  if (!text || text.length > 1000) return null
  try {
    const url = new URL(text)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * 一条要作者处理的记录写成推送内容。只用平台名、固定的原因和时间。
 * @param {{platform: string, needLogin?: boolean, at: string}} entry - autoRead.attention 里的一条。
 * @returns {{title: string, text: string, at: string}}
 */
export function buildNotice(entry) {
  const platform = platformName(entry.platform)
  const when = new Date(entry.at)
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  const reason = entry.needLogin ? tr('需要重新登录创作后台') : tr('连着几次自动读取都没读到数据')
  return {
    title: tr('阿东IP工作台：{platform}需要你处理', { platform }),
    text: tr('{platform}：{reason}（{time}）', { platform, reason, time }),
    at: when.toISOString(),
  }
}

/**
 * 今天还该推哪几条：每个平台每天最多一条，今天推过的不再推。纯函数。
 * @param {{attention?: Array<object>, sent?: {day?: string, platforms?: string[]}|null, now: Date}} input
 * @returns {Array<object>} 要推的 attention 记录，一个平台一条。
 */
export function pendingNotices({ attention = [], sent = null, now }) {
  const day = localDay(now)
  const done = new Set(sent?.day === day ? sent.platforms ?? [] : [])
  const out = []
  for (const entry of attention ?? []) {
    if (!entry?.platform || done.has(entry.platform) || !Number.isFinite(Date.parse(entry.at ?? ''))) continue
    // 只推今天这几轮新得出的结论，前几天留下来的不再打扰
    if (localDay(entry.at) !== day) continue
    done.add(entry.platform)
    out.push(entry)
  }
  return out
}

/**
 * 自动读取一轮之后调用：开了推送、填了地址、有今天还没推过的平台才发。
 * 先记下「今天这个平台推过了」再发：发失败不重试，另一个 DSH 进程也不会重复发。
 * @param {{store: {mutate: Function}, settings: {notify?: {enabled?: boolean, webhook?: string}}, fetchImpl?: typeof fetch, now?: () => Date}} deps
 * @returns {Promise<{sent: number, failed: number}>} 发出去几条、失败几条。
 */
export async function pushAttention({ store, settings, fetchImpl = fetch, now = () => new Date() }) {
  const none = { sent: 0, failed: 0 }
  const url = settings?.notify?.enabled === true ? cleanWebhook(settings.notify.webhook) : null
  if (!url) return none
  const at = now()
  const day = localDay(at)
  const todo = await store.mutate('', (draft) => {
    const list = pendingNotices({ attention: draft.autoRead?.attention, sent: draft.notified, now: at })
    if (list.length) draft.notified = { day, platforms: [...(draft.notified?.day === day ? draft.notified.platforms ?? [] : []), ...list.map(entry => entry.platform)] }
    return list
  }, { undoable: false })
  let sent = 0
  for (const entry of todo) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildNotice(entry)), signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.ok) sent += 1
    } catch {
      // 发不出去就算了：不重试，也不把报错往外抛（报错里可能带地址）
    }
  }
  return { sent, failed: todo.length - sent }
}
