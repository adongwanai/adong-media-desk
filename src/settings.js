// 工作台设置。密钥和内容数据分开存放，文件权限 600，也不会返回给浏览器。
import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tr } from './i18n.js'
import { cleanImageHost, IMAGE_HOST_DEFAULTS, publicImageHost } from './image-host.js'
import { cleanExclude, DEFAULT_MATERIAL_EXCLUDE } from './materials.js'
import { AUTO_READ_DEFAULTS, validTime } from './daily-read.js'
import { cleanWebhook, NOTIFY_DEFAULTS } from './notify.js'

const DEFAULTS = {
  image: { source: 'http', protocol: 'openai', baseUrl: '', model: '', apiKey: '', size: '1536x1024', quality: '', toolSize: '1536x1024', toolQuality: '', extra: '' },
  // 助手文字模型：空对象表示跟随 DeepSeek Harness 默认模型
  assistant: { provider: '', model: '' },
  voice: '',
  exportDir: '',
  // 素材库：一个本地 Markdown 文件夹，写平台版本前挑几篇相关的当参考；空表示不用
  materialDir: '',
  // 素材库里名字含这些字的文件和文件夹不当素材（规则、说明文档这类）；用户可以改
  materialExclude: DEFAULT_MATERIAL_EXCLUDE,
  // 写作工作流：成稿时当写法参考的文档。paths 是自定义路径（空表示自动探测已知位置）；selected 是勾上的文档，null 表示按默认勾
  writingFlow: { paths: [], selected: null },
  generateImages: true,
  // 成稿后再过一遍去 AI 味；会多调一次文字模型
  humanize: true,
  imageCount: 2,
  shotCount: 6,
  language: 'auto',
  // 公众号草稿箱接口的凭证；AppSecret 和生图密钥一样不发给浏览器
  wechat: { appId: '', appSecret: '', author: '' },
  // Wechatsync 浏览器扩展的本地连接 Token；和其他密钥一样不发给浏览器
  wechatsync: { token: '' },
  // 图床：长文里的本地图片上传到哪；令牌和其他密钥一样不发给浏览器
  imageHost: { ...IMAGE_HOST_DEFAULTS },
  // 每天自动读各平台账号数据：开关和时间（这台电脑的本地时间）
  autoRead: { ...AUTO_READ_DEFAULTS },
  // 登录后的创作后台：null 是还没选过（当关），点过「打开专用浏览器去登录」后变成开；用户自己选了就照选的
  backstage: { enabled: null },
  // 提醒推送：默认关；Webhook 地址和密钥一样不发给浏览器
  notify: { ...NOTIFY_DEFAULTS },
}

function clamp(value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export class Settings {
  constructor(root) {
    this.file = join(root, 'settings.json')
    this.value = null
  }

  async read() {
    // 每次都读文件：桌面版和 Web 版可能同时运行
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      this.value = { ...DEFAULTS, ...saved, image: { ...DEFAULTS.image, ...saved.image }, assistant: { ...DEFAULTS.assistant, ...(saved.assistant ?? {}) }, wechat: { ...DEFAULTS.wechat, ...(saved.wechat ?? {}) }, wechatsync: { ...DEFAULTS.wechatsync, ...(saved.wechatsync ?? {}) }, imageHost: { ...DEFAULTS.imageHost, ...(saved.imageHost ?? {}) }, autoRead: { ...DEFAULTS.autoRead, ...(saved.autoRead ?? {}) }, backstage: { ...DEFAULTS.backstage, ...(saved.backstage ?? {}) }, notify: { ...DEFAULTS.notify, ...(saved.notify ?? {}) }, writingFlow: { ...DEFAULTS.writingFlow, ...(saved.writingFlow ?? {}) } }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      this.value = structuredClone(DEFAULTS)
    }
    return this.value
  }

  /** 空密钥表示不修改，clearKey 才会删除。 */
  async update(patch) {
    const current = await this.read()
    const next = structuredClone(current)
    const image = patch.image ?? {}
    if (image.source !== undefined) {
      if (!['http', 'tool'].includes(image.source)) throw Object.assign(new Error(tr('生图来源无效')), { status: 400 })
      next.image.source = image.source
    }
    if (image.protocol !== undefined) {
      if (!['openai', 'bailian', 'wan'].includes(image.protocol)) throw Object.assign(new Error(tr('生图协议无效')), { status: 400 })
      next.image.protocol = image.protocol
    }
    for (const key of ['model', 'size', 'quality']) {
      if (typeof image[key] === 'string') next.image[key] = image[key].trim().slice(0, 200)
    }
    for (const [key, values, message] of [
      ['toolSize', ['', '1024x1024', '1024x1536', '1536x1024', 'auto'], '订阅生图工具不支持这个尺寸'],
      ['toolQuality', ['', 'low', 'medium', 'high', 'auto'], '订阅生图工具不支持这个质量'],
    ]) {
      if (image[key] !== undefined) {
        if (typeof image[key] !== 'string' || !values.includes(image[key].trim())) throw Object.assign(new Error(tr(message)), { status: 400 })
        next.image[key] = image[key].trim()
      }
    }
    if (typeof image.baseUrl === 'string') {
      let url = image.baseUrl.trim().replace(/\/+$/, '')
      if (next.image.protocol === 'bailian') {
        // 百炼可能被贴成完整端点或带 /api/v1，统一存域名
        url = url.replace(/\/api\/v1\/services\/aigc\/multimodal-generation\/generation$/i, '').replace(/\/api\/v1$/i, '')
      } else if (next.image.protocol === 'wan') {
        url = url.replace(/\/api\/v1\/(?:services\/aigc\/text2image\/image-synthesis|tasks\/[^/]+)$/i, '').replace(/\/api\/v1$/i, '')
      } else {
        url = url.replace(/\/images\/generations$/, '')
      }
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw Object.assign(new Error(tr('接口地址要以 http:// 或 https:// 开头')), { status: 400 })
      next.image.baseUrl = url
    }
    if (typeof image.extra === 'string') {
      const extra = image.extra.trim()
      if (extra) {
        let parsed
        try {
          parsed = JSON.parse(extra)
        } catch {
          parsed = null
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error(tr('附加参数要是一个 JSON 对象')), { status: 400 })
      }
      next.image.extra = extra
    }
    if (typeof image.apiKey === 'string' && image.apiKey.trim()) next.image.apiKey = image.apiKey.trim()
    if (image.clearKey === true) next.image.apiKey = ''
    const wechat = patch.wechat && typeof patch.wechat === 'object' ? patch.wechat : {}
    if (typeof wechat.appId === 'string') {
      const appId = wechat.appId.trim()
      if (appId && !/^wx[0-9a-z]{16}$/i.test(appId)) throw Object.assign(new Error(tr('公众号 AppID 是 wx 开头的 18 位字符')), { status: 400 })
      next.wechat.appId = appId
    }
    if (typeof wechat.appSecret === 'string' && wechat.appSecret.trim()) {
      const appSecret = wechat.appSecret.trim()
      if (!/^[0-9a-z]{16,64}$/i.test(appSecret)) throw Object.assign(new Error(tr('公众号 AppSecret 格式不对，请到公众号后台重新复制')), { status: 400 })
      next.wechat.appSecret = appSecret
    }
    if (wechat.clearSecret === true) next.wechat.appSecret = ''
    if (typeof wechat.author === 'string') next.wechat.author = wechat.author.trim().slice(0, 16)
    const sync = patch.wechatsync && typeof patch.wechatsync === 'object' ? patch.wechatsync : {}
    if (typeof sync.token === 'string' && sync.token.trim()) {
      const token = sync.token.trim()
      if (!/^[\x21-\x7e]{4,200}$/.test(token)) throw Object.assign(new Error(tr('Wechatsync Token 格式不对，请到扩展设置里重新复制')), { status: 400 })
      next.wechatsync.token = token
    }
    if (sync.clearToken === true) next.wechatsync.token = ''
    if (patch.imageHost && typeof patch.imageHost === 'object') next.imageHost = cleanImageHost(next.imageHost, patch.imageHost)
    if (patch.assistant && typeof patch.assistant === 'object') {
      const provider = typeof patch.assistant.provider === 'string' ? patch.assistant.provider.trim().slice(0, 200) : ''
      const model = typeof patch.assistant.model === 'string' ? patch.assistant.model.trim().slice(0, 200) : ''
      // provider 和 model 要么都填（指定模型），要么都空（跟随默认）
      if (Boolean(provider) !== Boolean(model)) throw Object.assign(new Error(tr('助手模型的提供方和模型要一起填')), { status: 400 })
      next.assistant = { provider, model }
    }
    if (typeof patch.voice === 'string') next.voice = patch.voice.slice(0, 8000)
    if (typeof patch.exportDir === 'string') next.exportDir = patch.exportDir.trim().slice(0, 500)
    // 路径在用的时候按导入文件夹的规则检查（主目录下、真实路径），这里只存
    if (typeof patch.materialDir === 'string') next.materialDir = patch.materialDir.trim().slice(0, 500)
    if (patch.materialExclude !== undefined) {
      const list = cleanExclude(patch.materialExclude)
      if (!list) throw Object.assign(new Error(tr('素材库排除列表要是一组名字，每个不超过 40 个字，最多 30 个')), { status: 400 })
      next.materialExclude = list
    }
    if (patch.writingFlow && typeof patch.writingFlow === 'object') {
      const flow = { paths: next.writingFlow?.paths ?? [], selected: next.writingFlow?.selected ?? null }
      if (patch.writingFlow.paths !== undefined) {
        if (!Array.isArray(patch.writingFlow.paths) || patch.writingFlow.paths.length > 20) throw Object.assign(new Error(tr('写作工作流最多填 20 个路径')), { status: 400 })
        flow.paths = patch.writingFlow.paths.map(row => String(row ?? '').trim().slice(0, 500)).filter(Boolean)
      }
      if (patch.writingFlow.selected !== undefined) {
        const list = patch.writingFlow.selected
        if (list !== null && (!Array.isArray(list) || list.length > 100)) throw Object.assign(new Error(tr('写作工作流的勾选状态无效')), { status: 400 })
        flow.selected = list === null ? null : list.map(row => String(row ?? '').trim().slice(0, 1000)).filter(Boolean)
      }
      next.writingFlow = flow
    }
    if (patch.autoRead && typeof patch.autoRead === 'object') {
      if (patch.autoRead.enabled !== undefined) {
        if (typeof patch.autoRead.enabled !== 'boolean') throw Object.assign(new Error(tr('自动读取的开关无效')), { status: 400 })
        next.autoRead.enabled = patch.autoRead.enabled
      }
      if (patch.autoRead.time !== undefined) {
        if (!validTime(patch.autoRead.time)) throw Object.assign(new Error(tr('自动读取的时间要写成 06:30 这样')), { status: 400 })
        next.autoRead.time = patch.autoRead.time
      }
      // 第二轮（只读登录后的数据）：空字符串是关掉
      if (patch.autoRead.evening !== undefined) {
        if (patch.autoRead.evening !== '' && !validTime(patch.autoRead.evening)) throw Object.assign(new Error(tr('自动读取的时间要写成 06:30 这样')), { status: 400 })
        next.autoRead.evening = patch.autoRead.evening
      }
    }
    if (patch.backstage && typeof patch.backstage === 'object' && patch.backstage.enabled !== undefined) {
      if (typeof patch.backstage.enabled !== 'boolean') throw Object.assign(new Error(tr('创作后台的开关无效')), { status: 400 })
      next.backstage = { enabled: patch.backstage.enabled }
    }
    if (patch.notify && typeof patch.notify === 'object') {
      // 空地址表示不修改，clearWebhook 才会删除；删掉地址就一起关掉
      if (typeof patch.notify.webhook === 'string' && patch.notify.webhook.trim()) {
        const webhook = cleanWebhook(patch.notify.webhook)
        if (!webhook) throw Object.assign(new Error(tr('Webhook 地址要以 http:// 或 https:// 开头')), { status: 400 })
        next.notify.webhook = webhook
      }
      if (patch.notify.clearWebhook === true) next.notify.webhook = ''
      if (patch.notify.enabled !== undefined) {
        if (typeof patch.notify.enabled !== 'boolean') throw Object.assign(new Error(tr('提醒推送的开关无效')), { status: 400 })
        next.notify.enabled = patch.notify.enabled
      }
      if (!next.notify.webhook) next.notify.enabled = false
    }
    if (typeof patch.generateImages === 'boolean') next.generateImages = patch.generateImages
    if (typeof patch.humanize === 'boolean') next.humanize = patch.humanize
    if (patch.imageCount !== undefined) next.imageCount = clamp(patch.imageCount, 0, 4, current.imageCount)
    if (['auto', 'zh', 'en'].includes(patch.language)) next.language = patch.language
    if (patch.shotCount !== undefined) next.shotCount = clamp(patch.shotCount, 0, 12, current.shotCount)
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
    this.value = next
    return next
  }
}

export function imageReady(settings, toolAvailable = false) {
  if (settings.image.source === 'tool') return toolAvailable
  return Boolean(settings.image.baseUrl && settings.image.model && settings.image.apiKey)
}

/** 发给浏览器的版本：只告诉它有没有密钥和末四位。 */
export function publicSettings(settings, toolAvailable = false) {
  const { apiKey, ...image } = settings.image
  const wechat = settings.wechat ?? {}
  return { ...settings, image: { ...image, hasKey: Boolean(apiKey), keyHint: apiKey ? apiKey.slice(-4) : '' }, wechat: { appId: wechat.appId ?? '', author: wechat.author ?? '', hasSecret: Boolean(wechat.appSecret) }, wechatsync: { hasToken: Boolean(settings.wechatsync?.token) }, imageHost: publicImageHost(settings.imageHost), notify: { enabled: settings.notify?.enabled === true && Boolean(settings.notify?.webhook), hasWebhook: Boolean(settings.notify?.webhook) }, imageToolAvailable: toolAvailable, imageReady: imageReady(settings, toolAvailable) }
}
