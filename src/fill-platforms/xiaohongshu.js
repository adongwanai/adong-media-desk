// 小红书图文：查重 → 打开发布页 → 切到「上传图文」→ 交图片 → 填标题 → 填正文和话题 → 回读核对 → 点一次「暂存离开」→ 去草稿箱确认。
// 绝不点「发布」。定位按 2026-11 实测的页面：文件框 input[type=file][accept*=".png"]、标题框 placeholder 含「标题」、
// 正文是 ProseMirror 的 contenteditable；「暂存离开」「发布」两个按钮在 <xhs-publish-btn> 的封闭影子树里，只按文字认。
// 页面上藏着一个放在 -9999px 的假「上传图文」，按落点核对的点击会自动跳过它。
import { measure, PLATFORM_SPECS } from '../platform-specs.js'
import { compareReadback, createFillRun, findDuplicate, splitTopics } from '../fill-check.js'
import { extractTags, plainText } from '../fill-guard.js'

const PNG_INPUT = 'input[type="file"][accept*=".png"]'
const TITLE_INPUT = 'input[placeholder*="标题"]'
const BODY_EDITOR = '.ProseMirror[contenteditable="true"]'
// 打「#话题」后弹出的联想框，选中的那一项
const TOPIC_PICKED = '#creator-editor-topic-container .item.is-selected .name'
const MAX_IMAGES = 18
const MAX_BODY = 1000
const MAX_TAGS = 10

// 只读查看的两个列表页：草稿箱、笔记管理。只读页面文字判断有没有同一篇，不点删除、不点编辑、不点发布。
const LISTS = Object.freeze([
  { key: 'draft', label: '草稿箱', url: 'https://creator.xiaohongshu.com/new/draft-manage' },
  { key: 'notes', label: '笔记管理', url: 'https://creator.xiaohongshu.com/new/note-manager' },
])

export const xiaohongshu = Object.freeze({
  platform: '小红书',
  label: '小红书图文',
  slug: 'xiaohongshu',
  url: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  hosts: ['creator.xiaohongshu.com'],
  // 没登录时会跳去创作平台的登录页，或者小红书的统一登录
  loginHosts: ['www.xiaohongshu.com', 'login.xiaohongshu.com', 'customer.xiaohongshu.com'],
  loginPath: /^\/login/,
  // 白名单：只有这几个按钮会被点
  clicks: ['上传图文', '我知道了', '暂存离开'],
  // 平台自己的黑名单，叠在全局黑名单（发布、发表、定时、群发……）上面
  deny: ['笔记预览', '立即发布'],
  draftButton: '暂存离开',
  lists: LISTS,
  limits: { images: MAX_IMAGES, title: PLATFORM_SPECS.小红书.title.max, body: MAX_BODY },

  /**
   * 要填的内容来自这篇的「平台版本 · 小红书」：标题、正文、话题；图片版另由界面导出成图片。
   * @returns {{title: string, body: string, tags: string[], cards: string, problems: Array<{code: string, vars?: object}>}}
   */
  content(item) {
    const version = item?.production?.versions?.小红书
    if (!(version?.status === 'done' && String(version.body ?? '').trim())) return { title: '', body: '', tags: [], cards: '', problems: [{ code: 'no-version' }] }
    const title = String(version.title ?? '').replace(/\s+/g, ' ').trim()
    const plain = plainText(version.body)
    const tags = extractTags(version.tags, plain, MAX_TAGS)
    // 正文只放正文；话题在填的时候一个个打，好让平台认成真话题
    const body = plain
    const cards = String(version.cards ?? '')
    const problems = []
    const titleCount = measure(title, PLATFORM_SPECS.小红书.title.count)
    if (!title) problems.push({ code: 'no-title' })
    else if (titleCount > this.limits.title) problems.push({ code: 'title-long', vars: { n: titleCount, max: this.limits.title } })
    const total = Array.from(body).length + tags.reduce((sum, tag) => sum + Array.from(tag).length + 2, tags.length ? 2 : 0)
    if (total > MAX_BODY) problems.push({ code: 'body-long', vars: { n: total, max: MAX_BODY } })
    if (!cards.trim()) problems.push({ code: 'no-cards' })
    return { title, body, tags, cards, problems }
  },

  /**
   * 从列表页（草稿箱、笔记管理）的可见文字里认作品：标题 + 最近一行时间。
   * 页面结构读不准时宁可多认几条——多认是停下来问一句，少认才会悄悄填重。
   * @param {string} text - 列表页文字。
   * @param {number} [now] - 现在的时间，用来把「今天 / 昨天」换成日期。
   * @returns {Array<{title: string, at: string|null, text: string}>}
   */
  seen(text, now = Date.now()) {
    const lines = String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean)
    const times = lines.map(line => parseListTime(line, now))
    const out = []
    for (let i = 0; i < lines.length; i += 1) {
      if (times[i]) continue
      const line = lines[i]
      // 标题：单独成行，不太短也不太长，不像按钮、导航和计数
      if (line.length < 4 || line.length > 60) continue
      if (/^(草稿箱|笔记管理|发布笔记|发布|上传图文|编辑|删除|更多|搜索|全部|最近编辑|笔记|图文|视频|置顶|筛选|排序|暂无)/.test(line)) continue
      if (/^[\d\s.,%万wW亿/+]+$/.test(line)) continue
      // 最近的一个时间行（上面或下面两行以内）
      let at = null
      for (const gap of [1, 2]) {
        at = at ?? times[i + gap] ?? times[i - gap] ?? null
      }
      out.push({ title: line, at, text: line })
    }
    return out
  },

  /**
   * 在打开的发布页里填。page 是 fill-page.js 的 createPage 结果，step(key, vars) 报进度。
   * @returns {Promise<'saved'|'filled'>} saved：点了「暂存离开」并在草稿箱确认到；filled：填好了但页面上没有暂存按钮。
   */
  async fill(page, content, files, step) {
    const run = createFillRun()
    // 主步骤往下走一步；页面上的小步骤（切图文、加话题）只写进进度，不改流程位置
    const mark = (key, vars) => {
      run.next(key)
      step(key, vars)
    }
    try {
      // 1. 查重：草稿箱和笔记管理只读地看一遍
      mark('check')
      const seen = []
      for (const list of this.lists) {
        let listing
        try {
          listing = await page.visit(list.url, { what: list.label })
        } catch (err) {
          // 登录页、跳出白名单：照原样停下，不猜；页面没打开（改版）就记一句，继续往下
          if (['login', 'offsite'].includes(err?.code)) throw err
          step('check-missed', { list: list.label })
          continue
        }
        seen.push(...this.seen(listing.text))
      }
      const dup = findDuplicate(content.title, seen)
      if (dup) throw Object.assign(new Error('duplicate'), { code: 'duplicate', vars: { title: dup.item.title.slice(0, 60), where: dup.item.at ? '' : '（时间没读到）' } })

      // 2. 上传图片
      await page.waitFor(async () => (await page.count(PNG_INPUT)) || page.has('上传图文'), { what: '发布页', timeout: 30_000 })
      await page.rest()
      if (!(await page.count(PNG_INPUT))) {
        step('tab')
        await page.click('上传图文')
        await page.waitFor(() => page.count(PNG_INPUT), { what: '上传图文' })
        await page.rest()
      }
      mark('upload', { n: 0, total: files.length })
      await page.upload(PNG_INPUT, files)
      // 编辑区出来、左上角的「n/18」数到全部图片、没有还在传的，才算传完
      await page.waitFor(async () => {
        const text = await page.text()
        const done = Number(/(\d+)\s*\/\s*18/.exec(text)?.[1] ?? 0)
        step('upload', { n: Math.min(done, files.length), total: files.length })
        return done >= files.length && !/上传中|正在上传/.test(text) && (await page.count(TITLE_INPUT)) > 0
      }, { what: '图片上传', timeout: 30_000 + files.length * 15_000, every: 1_000 })
      await page.rest()
      // 第一次进编辑页会弹「新功能」引导，盖在编辑区上面；有就关掉
      if (await page.has('我知道了')) {
        await page.click('我知道了')
        await page.rest()
      }
      // 3. 填标题
      mark('title')
      await page.type(TITLE_INPUT, content.title)
      await page.rest()
      // 4. 填正文和话题
      mark('body')
      await page.type(BODY_EDITOR, content.body, { multiline: true })
      // 话题：一个个打「#话题」，联想里选中的第一项正好是它就按回车变成真话题，不是就留成普通文字
      if (content.tags.length) {
        step('tags', { n: content.tags.length })
        await page.enter()
        await page.enter()
        for (const tag of content.tags) {
          await page.insert(`#${tag}`)
          await page.rest()
          const picked = await page.evaluate(`document.querySelector('${TOPIC_PICKED}')?.innerText?.trim() ?? null`)
          if (picked === `#${tag}`) await page.enter()
          else await page.insert(' ')
          await page.rest()
        }
      }
      await page.rest()

      // 5. 回读核对：标题、正文、话题数量、图片张数，逐项从页面读回来比
      mark('readback')
      const pageText = await page.text()
      const got = await this.readback(page, pageText)
      const verdict = compareReadback({ title: content.title, body: content.body, tags: content.tags, images: files.length }, got)
      if (!verdict.ok) {
        const first = verdict.problems[0]
        throw Object.assign(new Error('readback'), { code: 'readback', vars: { what: first.what, want: String(first.want), got: first.got === null ? '—' : String(first.got) } })
      }
      // 截图失败不影响流程，只在进度里留一句；拍到了就把文件名给人看
      if (typeof page.snapshot === 'function') {
        const shot = await page.snapshot()
        if (shot?.name) step('shot', { name: shot.name })
        else if (shot?.error) step('shot', { error: shot.error })
      }

      if (!(await page.has(this.draftButton))) return 'filled'

      // 6. 只点一次「暂存离开」
      mark('save')
      const before = draftCount(pageText)
      await page.click(this.draftButton)
      let bumped = false
      try {
        await page.waitFor(async () => {
          if ((await page.count(TITLE_INPUT)) > 0) return false
          const after = draftCount(await page.text())
          return before === null || after === null || after > before
        }, { what: '暂存结果', timeout: 20_000 })
        bumped = true
      } catch {
        // 点过了、页面上没看到结果：去草稿箱确认，不再点第二次
      }

      // 7. 确认：草稿箱里能看到这一篇才算存好；没确认到就停在这里，交给用户看
      mark('confirm')
      const after = draftCount(await page.text())
      const listing = await page.visit(this.lists[0].url, { what: this.lists[0].label }).catch(() => null)
      const inDrafts = listing ? this.seen(listing.text).some(item => findDuplicate(content.title, [item]) !== null) : false
      if (inDrafts) return 'saved'
      throw Object.assign(new Error('unconfirmed'), { code: 'save-unconfirmed', vars: { saw: after === null ? '' : String(after), bumped: bumped ? '1' : '' } })
    } catch (err) {
      run.fail({ code: err?.code ?? 'other', vars: err?.vars ?? { message: String(err?.message ?? err).slice(0, 300) } })
      throw err
    }
  },

  /**
   * 从当前编辑页读回标题、正文、话题和图片张数。读不到的给 null，由 compareReadback 决定比不比。
   * @param {object} page - createPage 的结果。
   * @param {string} text - 已经是页面文字（createPage.text() 的结果）。
   * @returns {Promise<{title: string|null, bodyText: string|null, tags: string[]|null, images: number|null}>}
   */
  async readback(page, text) {
    const title = await page.read(TITLE_INPUT).catch(() => null)
    const bodyText = await page.read(BODY_EDITOR).catch(() => null)
    // 已识别成真话题的节点（名字里带 topic 的元素）：从正文里拆出来的 + 这些一起去重
    const picked = await page.evaluate(`[...document.querySelectorAll('[class*="topic" i]')].map(el => (el.innerText || '').trim()).filter(Boolean)`).catch(() => [])
    // 图片张数用页面上「n/18」的计数：和上传完成用的是同一个信号
    const counted = /(\d+)\s*\/\s*18/.exec(String(text ?? ''))
    const images = counted ? Number(counted[1]) : null
    const fromText = splitTopics(bodyText).tags
    const tags = [...new Set([...fromText, ...(Array.isArray(picked) ? picked : []).map(tag => tag.replace(/^[#＃]+/, '').replace(/\[话题\]/g, '').trim()).filter(Boolean)])]
    return { title, bodyText, tags, images }
  },
})

/** 页面上「草稿箱(n)」里的 n；没有就是 null。 */
export function draftCount(text) {
  const match = /草稿箱\s*[(（]\s*(\d+)\s*[)）]/.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

/** 列表页一行里是不是时间：「今天 10:23」「昨天」「11-16」「2026-11-16」「10 分钟前」「刚刚」。读不出就是 null。 */
export function parseListTime(line, now = Date.now()) {
  const text = String(line ?? '').trim()
  if (!text) return null
  const base = new Date(now)
  const time = (day, h = 12, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString()
  if (/^刚刚$/.test(text)) return new Date(now).toISOString()
  let match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?/.exec(text)
  if (match) {
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 12), Number(match[5] ?? 0))
    return day.toISOString()
  }
  match = /^(今天|昨天|前天)(?:\s+(\d{1,2}):(\d{2}))?/.exec(text)
  if (match) {
    const day = new Date(base)
    day.setDate(day.getDate() - { 今天: 0, 昨天: 1, 前天: 2 }[match[1]])
    return time(day, Number(match[2] ?? 12), Number(match[3] ?? 0))
  }
  match = /^(\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text)
  if (match) {
    const day = new Date(base.getFullYear(), Number(match[1]) - 1, Number(match[2]), Number(match[3] ?? 12), Number(match[4] ?? 0))
    if (day.getTime() - now > 24 * 3600e3) day.setFullYear(day.getFullYear() - 1)
    return day.toISOString()
  }
  match = /^(\d+)\s*(分钟|小时|天)前/.exec(text)
  if (match) {
    const ms = { 分钟: 60e3, 小时: 3600e3, 天: 86400e3 }[match[2]] * Number(match[1])
    return new Date(now - ms).toISOString()
  }
  return null
}
