import { mkdir, writeFile, readFile, realpath, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNativeTask } from './native-task.js'
import { imageBuffer } from './images.js'

// Host never sends image requests itself. DSH invokes the configured image tool.
export async function generateNativeImage(ctx, root, image, prompt, { signal } = {}) {
  const dir = join(root, 'files')
  await mkdir(dir, { recursive: true })
  const request = join(dir, `image-request-${randomUUID()}.txt`)
  await writeFile(request, prompt, { flag: 'wx', mode: 0o600 })
  const command = `node ${JSON.stringify(fileURLToPath(new URL('./native-image-cli.js', import.meta.url)))} ${JSON.stringify(root)} ${JSON.stringify(request)}`
  const result = await runNativeTask(ctx, {
    task: '生成文章配图', signal,
    system: '用户已请求生成一张图片。本轮只执行一次生图，不重试，不改文案，不发到外部平台。保留原生工具权限确认，不读取或展示凭证。成功后最终答复只返回 JSON {"path":"实际图片的绝对路径"}；失败如实报告，不冒充成功。',
    user: image.source === 'tool'
      ? `通过 DSH 自带的图片工具生成一张图，保存到 ${dir}，返回真实文件路径。图片描述：\n${prompt}`
      : `使用已配置的生图服务，调用原生终端执行以下本地脚本；提示词文件已准备好，不要另写脚本或读取 settings.json：\n${command}`,
  })
  const match = /\{[\s\S]*\}/.exec(result.text)
  let output
  try { output = JSON.parse(match?.[0]) } catch { throw new Error(`DSH 生图没有返回图片：${result.text.slice(0, 300)}`) }
  if (typeof output.path !== 'string') throw new Error('DSH 生图没有返回真实文件路径')
  const [file, allowed] = await Promise.all([realpath(output.path), realpath(dir)])
  if (dirname(file) !== allowed) throw new Error('DSH 图片必须保存在工作台图片目录内')
  if ((await stat(file)).size > 40_000_000) throw new Error('图片过大')
  return { ...imageBuffer(await readFile(file)), sessionId: result.sessionId }
}
