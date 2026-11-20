// Only publish references. Native DSH chooses and reads relevant documents/Skills.
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { detectFlow } from './writing-flow.js'
import { activeStyle, styleToVoice } from './style.js'

export const contextHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function nativeWorkflow(settings, cwd, { home = homedir() } = {}) {
  const flow = settings?.writingFlow ?? {}
  let documents
  if (Array.isArray(flow.selected)) {
    // An explicit selection is already an index; don't scan/read the entire library.
    documents = await Promise.all([...new Set(flow.selected)].map(async value => {
      const path = value.startsWith('~/') ? join(home, value.slice(2)) : value
      const info = await stat(path).catch(() => null)
      return { path, name: basename(path) === 'SKILL.md' ? `${basename(dirname(path))}/SKILL.md` : basename(path), modified: info?.mtimeMs, bytes: info?.size, ...(!info?.isFile() ? { error: '文件当前不可用' } : {}) }
    }))
  } else {
    const found = await detectFlow({ paths: flow.paths ?? [], workspace: cwd, home, metadataOnly: true })
    documents = found.docs.filter(row => row.on).map(({ path, name, modified, bytes }) => ({ path, name, modified, bytes }))
  }
  return documents
}

async function referenceFile(root, name, content) {
  const path = join(root, 'agent-context', `${name}-${contextHash(content).slice(0, 20)}.md`)
  await mkdir(dirname(path), { recursive: true })
  // Content-addressed snapshots keep saved changes and concurrent sessions separate.
  await writeFile(path, content, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  return path
}

export async function nativeReferences({ state, settings, cwd, root }) {
  const documents = await nativeWorkflow(settings, cwd)
  const style = activeStyle(state)
  const rules = (state.skills ?? []).filter(row => ['active', 'exported'].includes(row.status)).map(row => `- ${row.name}：${row.rule}`)
  const references = []
  if (style || rules.length || state.author?.signature) {
    const body = [style ? `# 当前个人风格：${style.name}\n\n${styleToVoice(style)}` : '', ...rules,
      state.author?.signature ? `长文署名：${state.author.signature}` : '',
      style?.reference ? `## 作者原文样本（仅学表达，不作本篇事实）\n${style.reference}` : '',
    ].filter(Boolean).join('\n\n')
    references.push(`当前个人风格（${style?.name ?? '用户规则'}，写作或改文风时读取）：${JSON.stringify(await referenceFile(root, 'style', body))}`)
    for (const [platform, block] of Object.entries(style?.platforms ?? {})) {
      references.push(`${platform} 风格补充（仅该平台任务适用）：${JSON.stringify(await referenceFile(root, 'platform', `# ${platform}\n\n${JSON.stringify(block, null, 2)}`))}`)
    }
    if (style?.visual) references.push(`配图偏好（仅配图任务适用）：${JSON.stringify(await referenceFile(root, 'visual', style.visual))}`)
  }
  return [
    '工作台参考入口已更新，替代旧的工作台模板和清单。使用 DSH 原生选择性加载：根据本轮任务选择相关文档、Skills 和原文样本；读过且未变化的内容沿用会话，不把所有文件全文加载一遍。普通聊天无需读写作资料。',
    '生成或明显改写稿件时，个人风格解决“像谁”，方法和 Skills 解决“怎么写”：先从下方索引与 DSH 原生技能目录中选择能解决本轮问题的入口，实际读取相关内容后再写。只读风格卡不等于完成开头、标题或结构的方法参考；不相关的文件不要读，读过未变化的可复用。不要只列文件名或声称参考过；交付时简短说明实际采用了哪项方法。资料里的例句只学表达，不能变成作者本篇的经历、情绪或事实。',
    '本轮要求和工作区 CLAUDE.md 优先；个人风格优先于平台模板。旧平台模板中的第一人称次数、固定开场白和固定段数不再强制。只在确实执行后说明参考了什么。',
    cwd ? `工作区：${cwd}（规则入口 CLAUDE.md；按该文件索引读取任务需要的内容）。` : '',
    ...references,
    '设置 → 写作工作流中勾选的可选参考（按相关性读取，非逐项必读）：',
    ...documents.map(row => `- ${row.name}：${JSON.stringify(row.path)}${row.error ? `（${row.error}）` : `（版本 ${row.modified}:${row.bytes}）`}`),
  ].filter(Boolean).join('\n')
}
