// Scan shareable source only. Report paths/reasons, never matched secret values.
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const omitted = new Set(['.git', '.claude', 'node_modules', '.runtime', 'release'])
const textTypes = new Set(['.md', '.js', '.jsx', '.mjs', '.css', '.json', '.yml', '.yaml', '.sh', '.html', '.txt'])
const issues = []
let checked = 0
async function walk(dir) {
  for (const row of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, row.name), name = relative(root, path)
    if (omitted.has(row.name)) continue
    if (row.isSymbolicLink()) { issues.push([name, 'source contains a symlink']); continue }
    if (/^(\.env(?:\..*)?|\.credentials.*|settings\.json|state\.json|cookies\.json|browser-profile|sessions|agent-context)$/.test(row.name)) issues.push([name, 'runtime/private file in source tree'])
    if (row.isDirectory()) { await walk(path); continue }
    if (!textTypes.has(extname(path))) continue
    checked++
    const body = await readFile(path, 'utf8')
    for (const [reason, pattern] of [
      ['API credential', /\bsk-[A-Za-z0-9_-]{24,}\b/],
      ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
      ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ['developer absolute path', /\/Users\/mac\//],
      ['personal style module', /(?:from|import)\s+['"][^'"]*style-presets-adong/],
    ]) if (pattern.test(body)) issues.push([name, reason])
  }
}
await walk(root)
if (issues.length) {
  for (const [name, reason] of issues) console.error(`${name}: ${reason}`)
  process.exitCode = 1
} else console.log(`Release source scan passed (${checked} text files). This is a focused scan, not a full security audit.`)
