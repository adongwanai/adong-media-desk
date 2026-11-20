import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export function workspacePath(root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'ip-workbench'), env = process.env) {
  return env.IP_WORKBENCH_WORKSPACE ? resolve(env.IP_WORKBENCH_WORKSPACE) : join(root, 'workspace')
}

// Never inherit a nearby creator's workspace or replace the user's own files.
export async function ensureWorkspace(cwd) {
  for (const name of ['CLAUDE.md', 'style.md', 'methods/README.md']) {
    const path = join(cwd, name)
    await mkdir(dirname(path), { recursive: true })
    const body = await readFile(new URL(`../templates/workspace/${name}`, import.meta.url))
    await writeFile(path, body, { flag: 'wx', mode: 0o600 }).catch(error => {
      if (error.code !== 'EEXIST') throw error
    })
  }
  return cwd
}
