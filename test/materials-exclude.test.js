import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { cleanExclude, DEFAULT_MATERIAL_EXCLUDE, findMaterials, isExcluded } from '../src/materials.js'
import { Settings } from '../src/settings.js'

const NOTE = '# Agent Harness 复盘\n\nClaude Code 的 review 流程、Agent Harness 的回滚和评测，这是一篇真正的素材。'

test('素材库：默认跳过名字里含说明书、规则、README、CLAUDE、AGENTS 的文件和文件夹', async () => {
  const home = await mkdtemp(join(tmpdir(), 'md-home-'))
  try {
    const lib = join(home, '素材库')
    await mkdir(join(lib, '写作规则'), { recursive: true })
    await mkdir(join(lib, '概念'), { recursive: true })
    await writeFile(join(lib, '概念', 'harness.md'), NOTE)
    await writeFile(join(lib, '示例作者文风说明书.md'), NOTE.replace('复盘', '说明'))
    await writeFile(join(lib, '写作规则', '标题.md'), NOTE.replace('复盘', '规则'))
    await writeFile(join(lib, 'CLAUDE.md'), NOTE)
    await writeFile(join(lib, 'readme.md'), NOTE)
    const query = 'Claude Code 的 review 流程和 Agent Harness 回滚评测'
    const found = await findMaterials(lib, query, { home, max: 0 })
    assert.equal(found.scanned, 1)
    assert.equal(found.excluded, 4)
    const picked = await findMaterials(lib, query, { home })
    assert.deepEqual(picked.picks.map(row => row.path), [join('概念', 'harness.md')])
    // 用户把排除列表清空：全都算素材
    const all = await findMaterials(lib, query, { home, exclude: [] })
    assert.equal(all.scanned, 5)
    assert.equal(all.excluded, 0)
    // 自己加一个词：整个「概念」文件夹也跳过
    const custom = await findMaterials(lib, query, { home, exclude: ['概念'], max: 0 })
    assert.equal(custom.scanned, 4)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('排除列表的校验：去空白去重；不是一组文字、太长、太多、带控制字符都不收', () => {
  assert.deepEqual(cleanExclude([' 规则 ', '', 'README', 'readme']), ['规则', 'README'])
  assert.deepEqual(cleanExclude([]), [])
  for (const bad of ['规则', [1], ['x'.repeat(41)], Array(31).fill('a'), ['a\nb'], null]) assert.equal(cleanExclude(bad), null)
  assert.equal(isExcluded(join('写作规则', '标题.md'), DEFAULT_MATERIAL_EXCLUDE), true)
  assert.equal(isExcluded('Readme.md', DEFAULT_MATERIAL_EXCLUDE), true)
  assert.equal(isExcluded(join('概念', 'harness.md'), DEFAULT_MATERIAL_EXCLUDE), false)
})

test('设置：默认带上排除列表，能改、能清空，格式不对拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md-settings-'))
  try {
    const settings = new Settings(dir)
    assert.deepEqual((await settings.read()).materialExclude, DEFAULT_MATERIAL_EXCLUDE)
    assert.deepEqual((await settings.update({ materialExclude: ['规则', ' 草稿 '] })).materialExclude, ['规则', '草稿'])
    assert.deepEqual((await new Settings(dir).read()).materialExclude, ['规则', '草稿'])
    assert.deepEqual((await settings.update({ materialExclude: [] })).materialExclude, [])
    await assert.rejects(settings.update({ materialExclude: '规则' }), /排除列表/)
    await assert.rejects(settings.update({ materialExclude: ['x'.repeat(41)] }), err => err.status === 400)
    assert.deepEqual((await settings.read()).materialExclude, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
