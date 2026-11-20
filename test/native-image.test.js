import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeImage } from '../src/native-image-cli.js'

test('原生图片入口复用配置，返回可嵌入图片路径且不暴露凭证', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-'))
  try {
    await writeFile(join(root, 'settings.json'), JSON.stringify({ image: { source: 'http', baseUrl: 'https://example.com', model: 'configured-image', apiKey: 'test-secret' } }))
    const result = await createNativeImage(root, '配图描述', async (config, prompt) => {
      assert.equal(config.model, 'configured-image')
      assert.equal(prompt, '配图描述')
      return { buffer: Buffer.from('image-fixture'), ext: '.png' }
    })
    assert.match(result.src, /^\/media-desk\/files\/agent-[\w-]+\.png$/)
    assert.equal(await readFile(result.path, 'utf8'), 'image-fixture')
    assert.ok(!JSON.stringify(result).includes('test-secret'))
    await writeFile(join(root, 'settings.json'), JSON.stringify({ image: { source: 'tool' } }))
    await assert.rejects(createNativeImage(root, '配图'), /未配置 HTTP/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
