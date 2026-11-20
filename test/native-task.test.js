import test from 'node:test'
import assert from 'node:assert/strict'
import { callModel } from '../src/ai.js'
import { configureNativeTasks } from '../src/native-task.js'
import { nativeFixture } from './fixtures/native-session.js'

test('独立 AI 按钮只用 DSH 会话，保留工具事件并只解析最后结果', async () => {
  const { ctx, calls } = nativeFixture({ final: '{"candidates":[{"title":"真实标题"}]}' })
  const records = [], deltas = []
  configureNativeTasks(ctx, { cwd: '/workspace', record: row => records.push(row) })
  const result = await callModel(ctx, { system: '只输出 JSON', user: '生成标题', onText: text => deltas.push(text) })
  assert.equal(JSON.parse(result.text).candidates[0].title, '真实标题')
  assert.equal(result.model, 'DSH 原生 Agent')
  assert.equal(result.activity[0].status, 'done')
  assert.equal(records.at(-1).status, 'done')
  assert.ok(deltas.length)
  await callModel(ctx, { system: '口播', user: '转口播' })
  assert.notEqual(calls[0].sessionId, calls[1].sessionId)
})

test('即使宿主有直接 llm 接口，没有原生 Agent 时也拒绝独立 AI 请求', async () => {
  await assert.rejects(callModel({ get: name => name === 'llm' ? { prepareCall: () => assert.fail('不得绕过 Agent') } : null }, { user: '写标题' }), /原生 Agent/)
})

test('独立任务失败取消原生执行，不把半截输出当成成功', async () => {
  const { ctx, calls } = nativeFixture({ fail: true })
  configureNativeTasks(ctx, { cwd: '/workspace' })
  await assert.rejects(callModel(ctx, { user: '写稿' }), /未完成/)
  assert.equal(calls.at(-1).cancelled, 'native-1')
})

test('原生取消同步返回或抛错时，仍记录任务失败并保留原始错误', async () => {
  for (const cancel of [() => ({}), () => { throw new Error('取消失败') }]) {
    const { ctx, service } = nativeFixture({ fail: true })
    service.cancel = cancel
    const records = []
    configureNativeTasks(ctx, { cwd: '/workspace', record: row => records.push(row) })
    await assert.rejects(callModel(ctx, { user: '写稿' }), /DSH 任务未完成/)
    assert.equal(records.at(-1).status, 'failed')
    assert.match(records.at(-1).error, /DSH 任务未完成/)
    assert.ok(records.at(-1).finishedAt)
  }
})
