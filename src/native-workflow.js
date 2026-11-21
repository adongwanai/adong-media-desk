// Only publish references. Native DSH chooses and reads relevant documents/Skills.
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { detectFlow } from './writing-flow.js'
import { activeStyle, styleToVoice } from './style.js'

export const contextHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function nativeWorkflow(settings, cwd, { home = homedir(), target } = {}) {
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
    const found = await detectFlow({ paths: flow.paths ?? [], workspace: cwd, home, target, metadataOnly: true })
    documents = found.docs.filter(row => row.on).map(({ path, name, group, modified, bytes }) => ({ path, name, group, modified, bytes }))
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

export async function nativeReferences({ state, settings, cwd, root, target }) {
  const documents = await nativeWorkflow(settings, cwd, { target })
  const style = activeStyle(state)
  const rules = (state.skills ?? []).filter(row => ['active', 'exported'].includes(row.status)).map(row => `- ${row.name}：${row.rule}`)
  const references = []
  if (style || rules.length || state.author?.signature || state.author?.bio) {
    const body = [
      style ? `# 当前个人风格：${style.name}\n\n${styleToVoice(style)}` : '',
      state.author?.bio ? `作者真实身份与视角定位：${state.author.bio}` : '',
      state.author?.signature ? `长文与完整笔记署名：${state.author.signature}` : '',
      ...rules,
      style?.reference ? `## 作者原声真稿样本（仅对齐断句气口、挑刺方式与工程取舍逻辑，严禁将样本里的具体事实搬进本篇）\n${style.reference}` : '',
    ].filter(Boolean).join('\n\n')
    references.push(`当前个人风格（${style?.name ?? '用户规则'}，写作或改文风时读取）：${JSON.stringify(await referenceFile(root, 'style', body))}`)
    for (const [platform, block] of Object.entries(style?.platforms ?? {})) {
      references.push(`${platform} 风格补充（仅该平台任务适用）：${JSON.stringify(await referenceFile(root, 'platform', `# ${platform}\n\n${JSON.stringify(block, null, 2)}`))}`)
    }
    if (style?.visual) references.push(`配图偏好（仅配图任务适用）：${JSON.stringify(await referenceFile(root, 'visual', style.visual))}`)
  }
  return [
    '工作台参考入口已更新，替代旧的工作台模板和清单。使用 DSH 原生选择性加载：根据本轮任务选择相关文档、Skills 和原文样本；读过且未变化的内容沿用会话，不把所有文件全文加载一遍。普通聊天无需读写作资料。',
    '生成或明显改写稿件时，个人风格解决“像谁”，原声切片与代表作样本对齐真实的断句气口与判断锐度，方法和 Skills 解决“怎么写”：起稿前务必先实际读取文风说明书、原声切片库（若有）、对应平台写作 Skill 以及 humanizer-zh（中文 22 特征分层去 AI 味）与 humanizer Skill，再动笔成稿。不要写出四平八稳的好学生汇报腔；资料和原声切片里的例句与数据只学表达与推理节奏，绝不能变成作者本篇的经历、情绪或事实。',
    '本轮要求（尤其是 <author-brief> 里的模式、读者与核心判断）和工作区 CLAUDE.md 最优先；个人风格优先于平台通用模板。交付终稿前必须对照 humanizer-zh 与 humanizer Skill 做去 AI 味编辑并完成「遮名换名检查」（若遮住名字像通用通稿，立即补上具体的取舍代价、失败边界与个人判断）。只在确实读取并执行后简短说明采用了哪项方法。',
    cwd ? `工作区：${cwd}（规则入口 CLAUDE.md；按该文件索引读取任务需要的内容）。` : '',
    ...references,
    '写作工作流与语感参考列表（成稿时优先读取文风、原声切片、目标平台 Skill 与 humanizer）：',
    ...documents.map(row => `- ${row.name}：${JSON.stringify(row.path)}${row.error ? `（${row.error}）` : `（版本 ${row.modified}:${row.bytes}）`}`),
  ].filter(Boolean).join('\n')
}
