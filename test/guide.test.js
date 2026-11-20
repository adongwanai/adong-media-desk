import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { EN } from '../client/en/index.js'
import { GUIDE_ACTIONS, GUIDE_PATHS, SHEET_LAYOUTS, readGuideMemo, writeGuideMemo } from '../client/guide-paths.js'
import { PAGES } from '../client/shortcuts.js'

const CLIENT = new URL('../client/', import.meta.url)

async function clientSource(dir = CLIENT) {
  let out = ''
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) { if (entry.name !== 'en') out += await clientSource(url) } else if (/\.(jsx?)$/.test(entry.name) && !entry.name.startsWith('guide')) out += await readFile(url, 'utf8')
  }
  return out
}

const steps = GUIDE_PATHS.flatMap(path => path.steps.map(step => ({ path: path.id, ...step })))

test('怎么用：五条路都在，每条 4 到 7 步，id 不重复', () => {
  assert.deepEqual(GUIDE_PATHS.map(path => path.id), ['sponsored', 'hot', 'import', 'morning', 'video'])
  for (const path of GUIDE_PATHS) assert.ok(path.steps.length >= 4 && path.steps.length <= 7, `${path.id} 有 ${path.steps.length} 步`)
})

test('怎么用：每个「带我去」都去得了——页面是真页面，动作是认得的动作', () => {
  const views = new Set(PAGES.map(page => page.id))
  for (const step of steps) {
    const { go } = step
    assert.ok(go && (go.view || go.do), `${step.path}：${step.text} 没有去处`)
    if (go.view) assert.ok(views.has(go.view), `${go.view} 不是页面`)
    if (go.do) assert.ok(GUIDE_ACTIONS.includes(go.do), `${go.do} 不是认得的动作`)
    if (go.do === 'piece') assert.ok(SHEET_LAYOUTS.includes(go.layout), `${go.layout} 不是成稿页的视图`)
  }
})

test('怎么用：成稿页的视图和视频页的步骤跟真实代码一致', async () => {
  const studio = await readFile(new URL('studio.jsx', CLIENT), 'utf8')
  const sheet = studio.slice(studio.indexOf('const SHEET_VIEWS'), studio.indexOf(']', studio.indexOf('const SHEET_VIEWS')))
  assert.deepEqual([...sheet.matchAll(/value: '(\w+)'/g)].map(m => m[1]), SHEET_LAYOUTS)
  const video = await readFile(new URL('video/page.jsx', CLIENT), 'utf8')
  const table = video.slice(video.indexOf('const TABS'), video.indexOf(']', video.indexOf('const TABS')))
  const tabs = new Set([...table.matchAll(/id: '(\w+)'/g)].map(m => m[1]))
  for (const step of steps.filter(row => row.go.tab)) {
    assert.equal(step.go.view, 'video')
    assert.ok(tabs.has(step.go.tab), `${step.go.tab} 不是视频页的步骤`)
  }
})

test('怎么用：文案里「」引起来的按钮和页面名，界面上真的有这几个字', async () => {
  const src = await clientSource()
  const missing = new Set()
  for (const step of steps) {
    for (const [, label] of step.text.matchAll(/「([^」]+)」/g)) if (!src.includes(`'${label}'`)) missing.add(label)
  }
  assert.deepEqual([...missing], [])
})

test('怎么用：每句文案都有英文，{keys} 占位符两边都在', () => {
  const texts = GUIDE_PATHS.flatMap(path => [path.title, path.hint, ...path.steps.map(step => step.text)])
  for (const text of texts) {
    assert.ok(EN[text], `没有英文：${text}`)
    assert.equal(text.includes('{keys}'), EN[text].includes('{keys}'), text)
  }
})

test('怎么用：本地记忆读写，存储坏了或被禁用也不抛错', () => {
  const box = new Map()
  const storage = { getItem: key => box.get(key) ?? null, setItem: (key, value) => box.set(key, value) }
  assert.deepEqual(readGuideMemo(storage), {})
  writeGuideMemo({ seen: true }, storage)
  writeGuideMemo({ path: 'video', step: 2 }, storage)
  assert.deepEqual(readGuideMemo(storage), { seen: true, path: 'video', step: 2 })
  box.set('md-guide', '{坏的')
  assert.deepEqual(readGuideMemo(storage), {})
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.deepEqual(readGuideMemo(broken), {})
  assert.doesNotThrow(() => writeGuideMemo({ seen: true }, broken))
  assert.deepEqual(readGuideMemo(undefined), {})
})
