// 每条选题的输出类型与创作 Brief（内容模式、目标读者、一句话核心判断/槽点、硬性要求、篇幅与参考路径）。
export const CREATION_GOALS = ['xhs', 'article', 'script', 'both']
export const CREATION_MODES = ['auto', 'A', 'B', 'C', 'D']
export const CREATION_AUDIENCES = ['auto', 'user', 'builder', 'dev']

export const MODE_BRIEF = {
  A: 'A 争议判断型 —— 从具体人物、产品或现象切入，尽早亮出明确的反直觉判断，再用证据、适用条件和工程代价支撑；允许不同意，但不靠夸张口号制造冲突。',
  B: 'B 真实故事／吐槽型 —— 从真实场景、项目摩擦或踩坑麻烦进入，保留生活感与幽默感，吐槽最后落到一个具体判断、方法或选择；绝不编造对话与体感。',
  C: 'C 教程路径型 —— 围绕读者想完成的具体任务，写清前提、步骤、关键配置、验收标准与失败边界；只有实际验证过的步骤才写亲测，其余标明来自文档或研究。',
  D: 'D 真诚分享型（主模式） —— 第一人称讲清为什么关注、怎么选、哪里没跑通、下一步怎么验证；坦诚交代不确定性与取舍代价，绝不把计划写成结果。',
}

export const AUDIENCE_BRIEF = {
  user: '普通 AI 使用者 —— 从真实日常工作任务出发，讲清现成 Agent / Skills 怎么选、使用前提、关键操作和结果边界；必要术语随用随解释，不堆砌黑话。',
  builder: '创作者、OPC 与产品 Builder —— 讲工具如何组成持续可用的流程、需求是否成立、时间与成本如何取舍，以及如何做最小商业验证。',
  dev: '开发者与技术读者 —— 深入架构、机制、代码、Trajectory 评测与工程约束；保留技术精度，不用泛泛类比替代解释。',
}

export const creationFormat = (item, fallback = 'article') => item.creation?.goal ? (item.creation.goal === 'script' ? 'script' : 'article') : fallback

const clipText = (val, max) => (typeof val === 'string' ? val.trim().slice(0, max) : '')

/** 清洗并合并创作 Brief 字段。 */
export function cleanCreation(input, existing = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const next = { ...(existing && typeof existing === 'object' ? existing : {}) }
  if (CREATION_GOALS.includes(src.goal)) next.goal = src.goal
  if (src.mode !== undefined) {
    if (CREATION_MODES.includes(src.mode) && src.mode !== 'auto') next.mode = src.mode
    else delete next.mode
  }
  for (const [key, max] of [['thesis', 4000], ['requirements', 6000], ['audience', 500], ['lengthHint', 120]]) {
    if (src[key] !== undefined) {
      const cleaned = clipText(src[key], max)
      if (cleaned && !(key === 'audience' && cleaned === 'auto')) next[key] = cleaned
      else delete next[key]
    }
  }
  if (Array.isArray(src.refPaths)) {
    const paths = [...new Set(src.refPaths.map(p => clipText(p, 500)).filter(Boolean))].slice(0, 20)
    if (paths.length) next.refPaths = paths
    else delete next.refPaths
  }
  return next
}

export function hasCreationBrief(creation) {
  if (!creation || typeof creation !== 'object') return false
  return Boolean(creation.mode || creation.thesis || creation.requirements || creation.audience || creation.lengthHint || creation.refPaths?.length)
}

/** 拼成给模型的明确创作 Brief 指令块（区别于被动事实素材）。 */
export function formatCreationBrief(creation) {
  if (!hasCreationBrief(creation)) return ''
  const lines = []
  if (creation.mode && MODE_BRIEF[creation.mode]) lines.push(`- 内容模式定调：${MODE_BRIEF[creation.mode]}`)
  if (creation.audience) lines.push(`- 主要读者与解释深度：${AUDIENCE_BRIEF[creation.audience] ?? creation.audience}`)
  if (creation.thesis) lines.push(`- 核心观点 / 作者本人的真实判断与槽点（整篇顺着这个劲展开，不骑墙）：\n${creation.thesis}`)
  if (creation.lengthHint) lines.push(`- 期望篇幅：${creation.lengthHint}`)
  if (creation.requirements) lines.push(`- 写作要求 / 结构约束 / 必提点与禁区：\n${creation.requirements}`)
  if (creation.refPaths?.length) lines.push(`- 作者指定的本机附加参考路径（如工具支持，请先按需读取查阅）：\n${creation.refPaths.map(p => `  · ${p}`).join('\n')}`)
  return `<author-brief>\n${lines.join('\n')}\n</author-brief>`
}
