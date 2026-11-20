import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { styleLook } from '../client/style-look.js'
import { buildSeed } from '../src/seed.js'

const CLIENT = new URL('../client/', import.meta.url)

async function clientFiles(dir = CLIENT) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) out.push(...await clientFiles(url))
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(url)
  }
  return out
}

/** ui.jsx 里图标表的名字。 */
async function iconNames() {
  const src = await readFile(new URL('ui.jsx', CLIENT), 'utf8')
  const table = src.slice(src.indexOf('const ICONS = {'), src.indexOf('\n}\n', src.indexOf('const ICONS = {')))
  return new Set([...table.matchAll(/^ {2}(\w+): \[/gm)].map(m => m[1]))
}

test('图标：客户端用到的每个 Icon 名字都在图标表里', async () => {
  const names = await iconNames()
  assert.ok(names.size > 40)
  const used = new Map()
  for (const url of await clientFiles()) {
    const src = await readFile(url, 'utf8')
    const file = url.pathname.split('/client/')[1]
    const add = name => used.set(name, [...(used.get(name) ?? []), file])
    for (const m of src.matchAll(/<Icon\b[^>]*?\bname="(\w+)"/g)) add(m[1])
    for (const m of src.matchAll(/<Icon\b[^>]*?\bname=\{[^}]*?'(\w+)'[^}]*?'(\w+)'[^}]*\}/g)) { add(m[1]); add(m[2]) }
    for (const m of src.matchAll(/<IconButton\b[^>]*?\bicon="(\w+)"/g)) add(m[1])
    for (const m of src.matchAll(/<IconButton\b[^>]*?\bicon=\{[^}]*?'(\w+)'[^}]*?'(\w+)'[^}]*\}/g)) { add(m[1]); add(m[2]) }
    // 视频页的 { icon: '…' } 交给它自己的 LIcon，不在这张表里
    if (!file.startsWith('video/')) for (const m of src.matchAll(/\bicon: '(\w+)'/g)) add(m[1])
  }
  const missing = [...used].filter(([name]) => !names.has(name)).map(([name, files]) => `${name}（${[...new Set(files)].join('、')}）`)
  assert.deepEqual(missing, [])
})

test('图标：每个图标都是 24 网格里的节点，没有空的', async () => {
  const src = await readFile(new URL('ui.jsx', CLIENT), 'utf8')
  assert.match(src, /图标来自 Lucide（ISC/)
  for (const m of src.matchAll(/^ {2}(\w+): \[(.*)\],/gm)) assert.ok(m[2].trim().length > 4, m[1])
})

test('styleLook：内置预设全部换成线条图标和板块色，不再用 emoji', () => {
  const { styles } = buildSeed(new Date('2026-11-13T10:00:00+08:00'), 'zh')
  const presets = styles.filter(style => style.preset)
  assert.ok(presets.length >= 8)
  for (const style of presets) {
    const look = styleLook(style)
    assert.ok(look.glyph, `${style.name} 没有图标`)
    assert.notEqual(look.tint, 'ink', `${style.name} 没有板块色`)
  }
})

test('styleLook：自己的风格用自己的 emoji，没有就用名字的第一个字', () => {
  assert.deepEqual(styleLook({ name: '我的口播', icon: '🦊' }), { emoji: '🦊', tint: 'ink' })
  assert.deepEqual(styleLook({ name: 'slow writing', icon: '' }), { mono: 'S', tint: 'ink' })
  assert.deepEqual(styleLook({ name: '慢写', icon: '✍️' }), { glyph: 'feather', tint: 'ink' })
  assert.deepEqual(styleLook({ name: '  ', icon: 'abc' }), { mono: '·', tint: 'ink' })
  assert.deepEqual(styleLook(null), { glyph: 'feather', tint: 'ink' })
})
