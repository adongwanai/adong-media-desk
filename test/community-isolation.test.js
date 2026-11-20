import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/store.js'
import { Settings } from '../src/settings.js'
import { detectFlow } from '../src/writing-flow.js'
import { nativeWorkflow } from '../src/native-workflow.js'
import { ensureWorkspace, workspacePath } from '../src/workspace.js'
import { NativeAgent } from '../src/native-agent.js'

test('fresh installation is empty, uses its own namespace, and never reuses a personal workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ip-community-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await mkdir(join(home, 'media-desk'), { recursive: true })
    const sentinel = '{"personal":"do not touch"}'
    await writeFile(join(home, 'media-desk', 'state.json'), sentinel)
    const store = new Store(undefined, { samples: false })
    assert.equal(store.root, join(home, 'ip-workbench'))
    const state = await store.read()
    assert.deepEqual(state.items, [])
    assert.deepEqual(state.accounts, [])
    assert.equal(state.activeStyleId, 'preset_general')
    assert.equal(state.author.bio, '')
    assert.equal(state.author.signature, '')
    assert.equal(state.dshGeneralSessionId, undefined)
    assert.ok(!state.styles.some(row => row.id === 'preset_adong'))
    const settings = await new Settings(store.root).read()
    assert.equal(settings.image.apiKey, '')
    assert.equal(settings.image.baseUrl, '')
    assert.equal(settings.materialDir, '')
    assert.deepEqual(settings.writingFlow, { paths: [], selected: null })
    const workspace = workspacePath(store.root, {})
    await ensureWorkspace(workspace)
    const agent = new NativeAgent({ ctx: {}, store })
    assert.equal(await agent.workspace(), workspace)
    assert.ok((await nativeWorkflow(settings, workspace, { home })).every(row => row.path.startsWith(workspace + '/')))
    assert.deepEqual((await detectFlow({ home })).docs, [])
    await writeFile(join(workspace, 'style.md'), 'My own writing style')
    await ensureWorkspace(workspace)
    assert.equal(await readFile(join(workspace, 'style.md'), 'utf8'), 'My own writing style')
    assert.equal(await readFile(join(home, 'media-desk', 'state.json'), 'utf8'), sentinel)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
