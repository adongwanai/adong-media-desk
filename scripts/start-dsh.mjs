#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.argv[2] || 4372)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1–65535')
const dsh = process.env.DSH_BIN || 'dsh'
const dataHome = resolve(process.env.IP_WORKBENCH_HOME || join(homedir(), '.dsh-ip-workbench'))
const env = { ...process.env, DSH_HOME: dataHome }
for (const key of ['DSH_SESSION_ID', 'DSH_SHELL', 'DSH_WEB_URL', 'DSH_PROFILE', 'DSH_PROFILE_DIR', 'MEDIA_DESK_BROWSER_PROFILE', 'MEDIA_DESK_BROWSER_PORT', 'MEDIA_DESK_SAMPLES']) delete env[key]

function run(command, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', ...extra })
    const relay = signal => child.kill(signal)
    const sigint = () => relay('SIGINT'), sigterm = () => relay('SIGTERM')
    process.on('SIGINT', sigint); process.on('SIGTERM', sigterm)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      process.off('SIGINT', sigint); process.off('SIGTERM', sigterm)
      code === 0 ? resolve() : reject(new Error(`${command} 退出：${code ?? signal}`))
    })
  })
}

try {
  await run(dsh, ['--version'])
  await run(process.execPath, ['scripts/build.mjs'])
  await mkdir(dataHome, { recursive: true })
  // Include host files and templates: file dependencies may be copied by DSH.
  const hash = createHash('sha256')
  async function fingerprint(name) {
    const path = join(root, name)
    if ((await stat(path)).isDirectory()) {
      for (const child of (await readdir(path)).sort()) await fingerprint(join(name, child))
    } else {
      const body = await readFile(path)
      hash.update(`${name}\0${body.length}\0`).update(body)
    }
  }
  for (const name of ['package.json', 'cordis.patch.yml', 'src', 'templates', 'assets', 'dist']) await fingerprint(name)
  hash.update(root)
  const stamp = hash.digest('hex')
  const marker = join(dataHome, '.ip-workbench-install')
  if (await readFile(marker, 'utf8').catch(() => '') !== stamp) {
    await run(dsh, ['plugin', '--profile', 'web', 'add', `file:${root}`])
    await writeFile(marker, stamp)
  }
  console.log(`阿东IP工作台的数据目录：${dataHome}`)
  console.log('首次使用请登录你自己的 DSH 模型账号；在侧栏打开「阿东IP工作台」。')
  await run(dsh, ['--profile', 'web', '--port', String(port)])
} catch (error) {
  console.error(error.code === 'ENOENT' ? '未找到 DSH。请先安装官方 DeepSeek Harness，并将 dsh 加入 PATH，或设置 DSH_BIN 为其可执行文件路径。' : error.message)
  process.exitCode = 1
}
