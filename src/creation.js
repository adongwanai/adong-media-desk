// 每条选题的输出类型；默认小红书图文，正文始终按自然段写。
export const CREATION_GOALS = ['xhs', 'article', 'script', 'both']
export const creationFormat = (item, fallback = 'article') => item.creation?.goal ? (item.creation.goal === 'script' ? 'script' : 'article') : fallback
