// 公众号公开发布：唯一一处会让内容公开出去的代码。
// 只在用户这一次在确认框里点了确认（请求带 confirm: true），而且确认的正是这篇内容当前那份草稿（media_id 对得上）时才提交；
// 不自动发布，不排期发布。提交后有限次数地查结果，可以中途停止等待；停止只是不再等，已提交的任务照常进行。
import { applyOps } from './ops.js'
import { tr } from './i18n.js'
import { pollPublish, publishDraft, wechatReady } from './wechat.js'

const WECHAT = '公众号'
// 正在等结果的内容：id → AbortController
const running = new Map()

function refuse(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

async function findItem(store, id) {
  if (typeof id !== 'string' || !id) throw refuse(tr('缺少内容 ID'))
  const item = (await store.read()).items.find(row => row.id === id)
  if (!item) throw refuse(tr('找不到这条内容'), 404)
  return item
}

function record(store, label, id, ops) {
  return store.mutate(label, (draft) => {
    applyOps(draft, ops)
    return draft
  }, { undoable: false })
}

// 提交发出去、还没拿到任务 ID 时的占位标记
export const SUBMITTING = 'submitting'

async function markPublished(store, item, mediaId, url) {
  const ops = [{ op: 'set_publish', id: item.id, platform: WECHAT, state: 'published', url: url ?? null, mediaId }]
  // 第一个平台发出去，整条内容就算已发布
  if (item.status !== 'published') ops.push({ op: 'set_status', id: item.id, status: 'published' })
  return record(store, tr('发布到公众号'), item.id, ops)
}

/**
 * POST publish/wechat-publish 的主体。
 * @param {{store: object, settings: object, body: {id?: unknown, mediaId?: unknown, confirm?: unknown}, fetchImpl?: typeof fetch, poll?: object}} options
 * @returns {Promise<{published: boolean, pending?: boolean, url?: string|null, state: object}>}
 */
export async function publishFromItem({ store, settings, body, fetchImpl, poll = {} }) {
  const item = await findItem(store, body?.id)
  // 每一次都要用户在确认框里点过确认；没有这一步一律不发
  if (body.confirm !== true) throw refuse(tr('公开发布需要你在确认框里点「确认公开发布」，这次没有发出任何内容'))
  const row = item.publish?.[WECHAT]
  if (row?.state === 'published') throw refuse(tr('这篇已经发布到公众号了，不会重复发布'), 409)
  if (!row?.mediaId) throw refuse(tr('还没有推到公众号草稿箱的草稿，先推草稿，检查后再发布'))
  if (typeof body.mediaId !== 'string' || body.mediaId !== row.mediaId) throw refuse(tr('草稿已经换过了，你确认的不是当前这份草稿。请重新打开确认框再确认一次'), 409)
  // 上一次提交后没拿到明确结果（比如网络超时）：公众号那边可能已经收下了。要用户先去后台看过，明确说了「确认没发出去」才允许再提交
  if (row.publishId === SUBMITTING && body.retryUnknown !== true) throw refuse(tr('上一次提交没有得到明确结果，公众号可能已经在发了。先到公众号后台看看有没有发出去；确认没有，再选「确认没发出去，重新提交」'), 409)
  if (row.publishId && row.publishId !== SUBMITTING) throw refuse(tr('上一次的发布已经提交，结果还没查到。先点「查询发布结果」'), 409)
  if (!wechatReady(settings)) throw refuse(tr('先在设置里填好公众号的 AppID 和 AppSecret'))
  if (running.has(item.id)) throw refuse(tr('这篇正在发布，稍等一下'), 409)
  const controller = new AbortController()
  running.set(item.id, controller)
  try {
    // 提交之前先落一个「正在提交」的标记：就算提交后进程挂了或超时，也不会在不知情的情况下发第二次
    await record(store, tr('提交公众号发布'), item.id, [{ op: 'set_publish', id: item.id, platform: WECHAT, state: 'drafted', url: row.url ?? null, mediaId: row.mediaId, publishId: SUBMITTING }])
    const result = await publishDraft(settings.wechat, row.mediaId, {
      ...poll,
      fetchImpl,
      signal: controller.signal,
      // 一提交就先记下任务 ID：之后无论等没等到结果，都不会让同一份草稿再提交一次
      onSubmitted: publishId => record(store, tr('提交公众号发布'), item.id, [{ op: 'set_publish', id: item.id, platform: WECHAT, state: 'drafted', url: row.url ?? null, mediaId: row.mediaId, publishId }]),
    })
    if (!result.done) return { published: false, pending: true, cancelled: Boolean(result.cancelled), state: await store.read() }
    return { published: true, url: result.url ?? null, state: await markPublished(store, item, row.mediaId, result.url) }
  } catch (err) {
    // 提交之后查到“没发出去”：去掉任务 ID，草稿还在，用户可以改完再确认一次
    // 公众号明确拒绝了这次提交（返回了错误码），同样可以去掉标记；网络出错、超时这类说不清结果的，标记留着
    if (err?.publishStatus !== undefined || err?.errcode !== undefined) await clearPending(store, item.id, row.mediaId)
    throw err
  } finally {
    running.delete(item.id)
  }
}

async function clearPending(store, id, mediaId) {
  await record(store, tr('公众号发布没有成功'), id, [{ op: 'set_publish', id, platform: WECHAT, state: 'drafted', mediaId }])
}

/**
 * POST publish/wechat-status：已经提交过的发布再查一次结果，只查不提交。
 */
export async function publishStatusOfItem({ store, settings, body, fetchImpl }) {
  const item = await findItem(store, body?.id)
  const row = item.publish?.[WECHAT]
  if (!row?.publishId) throw refuse(tr('这篇没有等待结果的发布'))
  if (row.publishId === SUBMITTING) throw refuse(tr('上一次提交没有得到明确结果，查不了。请到公众号后台看看有没有发出去'), 409)
  if (!wechatReady(settings)) throw refuse(tr('先在设置里填好公众号的 AppID 和 AppSecret'))
  if (running.has(item.id)) throw refuse(tr('这篇正在发布，稍等一下'), 409)
  try {
    const result = await pollPublish(settings.wechat, row.publishId, { fetchImpl, attempts: 1, interval: 0 })
    if (!result.done) return { published: false, pending: true, state: await store.read() }
    return { published: true, url: result.url ?? null, state: await markPublished(store, item, row.mediaId, result.url) }
  } catch (err) {
    if (err?.publishStatus !== undefined) await clearPending(store, item.id, row.mediaId)
    throw err
  }
}

/** POST publish/wechat-cancel：不再等结果。已经提交的发布任务没法撤回，这里只停止等待。 */
export function stopWaiting(id) {
  const controller = running.get(id)
  if (!controller) return false
  controller.abort()
  return true
}
