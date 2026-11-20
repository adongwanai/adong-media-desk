// 大屏平台行显示哪些平台：set_board_platforms 的校验、去重、空列表回到自动，以及能撤销。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import { Store } from '../src/store.js'

function empty() {
  return { items: [], metrics: [], accounts: [], followerLog: [], skills: [] }
}

test('set_board_platforms：按给的顺序存下，重复的只留第一次', () => {
  const state = empty()
  const { errors, receipts } = applyOps(state, [{ op: 'set_board_platforms', platforms: ['小红书', '公众号', '小红书', 'X'] }])
  assert.deepEqual(errors, [])
  assert.equal(receipts.length, 1)
  assert.deepEqual(state.boardPlatforms, ['小红书', '公众号', 'X'])
})

test('set_board_platforms：空列表表示自动，去掉字段', () => {
  const state = { ...empty(), boardPlatforms: ['公众号'] }
  const { errors } = applyOps(state, [{ op: 'set_board_platforms', platforms: [] }])
  assert.deepEqual(errors, [])
  assert.equal('boardPlatforms' in state, false)
})

test('set_board_platforms：不认识的平台或不是列表时报错，原来的设置不动', () => {
  const state = { ...empty(), boardPlatforms: ['公众号', '知乎'] }
  for (const platforms of [['公众号', '微博'], 'X', undefined, [null], [42], [undefined], ['公众号', undefined]]) {
    const { errors } = applyOps(state, [{ op: 'set_board_platforms', platforms }])
    assert.equal(errors.length, 1, JSON.stringify(platforms))
    assert.deepEqual(state.boardPlatforms, ['公众号', '知乎'])
  }
})

test('set_board_platforms：走 store 时能撤销', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-'))
  try {
    const store = new Store(dir)
    await store.read()
    await store.mutate('选平台', state => applyOps(state, [{ op: 'set_board_platforms', platforms: ['B站', '抖音'] }]))
    assert.deepEqual((await store.read()).boardPlatforms, ['B站', '抖音'])
    await store.undoLast()
    assert.equal((await store.read()).boardPlatforms, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
