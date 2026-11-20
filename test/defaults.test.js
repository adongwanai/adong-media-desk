import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store } from '../src/store.js'

test('新用户默认写文章；老用户存过的体裁（或没存过）不替他改', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-defaults-'))
  try {
    const fresh = await new Store(dir, { samples: false }).read()
    assert.equal(fresh.draftFormat, 'article')
    // 老用户的状态文件：选过脚本的留着脚本，没选过的也不补成文章
    const file = join(dir, 'state.json')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...saved, draftFormat: 'script' }))
    assert.equal((await new Store(dir, { samples: false }).read()).draftFormat, 'script')
    const { draftFormat: _gone, ...older } = saved
    await writeFile(file, JSON.stringify(older))
    assert.equal((await new Store(dir, { samples: false }).read()).draftFormat, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
