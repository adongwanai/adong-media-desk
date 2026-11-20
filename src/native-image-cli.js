// Invoked by the native Agent's ordinary terminal tool. Credentials stay local.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { generateImage } from './images.js'

export async function createNativeImage(root, prompt, generate = generateImage) {
  if (!root || !String(prompt ?? '').trim()) throw new Error('需要数据目录和图片描述')
  const { image } = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))
  if (image?.source !== 'http' || !image.baseUrl || !image.model || !image.apiKey) throw new Error('当前未配置 HTTP 生图；请使用 DSH 已有图片工具或可用的生图 Skill')
  const { buffer, ext } = await generate(image, String(prompt), { attempts: 1 })
  if (!['.png', '.jpg', '.webp', '.gif'].includes(ext)) throw new Error('图片格式无效')
  const name = `agent-${randomUUID()}${ext}`
  const dir = join(root, 'files')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), buffer, { flag: 'wx' })
  return { src: `/media-desk/files/${name}`, path: join(dir, name), model: image.model }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, promptFile] = process.argv.slice(2)
  try {
    if (!promptFile) throw new Error('用法：node native-image-cli.js 数据目录 图片描述文本文件')
    console.log(JSON.stringify(await createNativeImage(root, await readFile(promptFile, 'utf8'))))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
