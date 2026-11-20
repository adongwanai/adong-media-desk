import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { importScan, isEdited, parseDate, parseFrontMatter, previewScan, removeImported, resolveImportDir, resolveStatus, scanFolder, variantOf } from '../src/import-md.js'
import { applyOps } from '../src/ops.js'
import { Store } from '../src/store.js'

const LONG = '这是一段正文，用来凑够两百字。'.repeat(20)

async function sandbox() {
  const home = await mkdtemp(join(tmpdir(), 'media-desk-import-'))
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) }
}

async function folder(home, name, files) {
  const dir = join(home, name)
  await mkdir(dir, { recursive: true })
  for (const [file, text] of Object.entries(files)) await writeFile(join(dir, file), text)
  return dir
}

const byName = (scan, name) => scan.files.find(row => row.name === name)

test('YAML 头：标量、引号、行内列表、「- 项」列表、CRLF；别的写法跳过', () => {
  const text = ['---', 'title: "带引号的：标题"', "note: 'it''s'", 'tags: [AI, "Agent 工程"]', 'platforms:', '  - 小红书', '  - 公众号', 'empty:', 'nested:', '  a: 1', 'block: |', '  多行', 'status: 写作中', '---', '正文'].join('\n')
  const { data, body, hasFront } = parseFrontMatter(text)
  assert.equal(hasFront, true)
  assert.equal(data.title, '带引号的：标题')
  assert.equal(data.note, "it's")
  assert.deepEqual(data.tags, ['AI', 'Agent 工程'])
  assert.deepEqual(data.platforms, ['小红书', '公众号'])
  assert.equal(data.status, '写作中')
  assert.equal('empty' in data, false)
  assert.equal('nested' in data, false)
  assert.equal('block' in data, false)
  assert.equal(body, '正文')
  // 没有结束的 --- 就当没有头
  assert.equal(parseFrontMatter('---\ntitle: x\n正文').hasFront, false)
  // __proto__ 这样的键不会污染对象
  const evil = parseFrontMatter('---\n__proto__: x\n---\n')
  assert.equal(Object.getPrototypeOf(evil.data), Object.prototype)
})

test('状态词表：status / stage 的常见写法，认不出算草稿；status 优先', () => {
  const cases = [
    ['idea', 'idea'], ['想法', 'idea'], ['选题', 'idea'], ['outline', 'outline'], ['大纲', 'outline'],
    ['writing', 'draft'], ['写作中', 'draft'], ['draft', 'draft'], ['草稿', 'draft'], ['review', 'draft'], ['审核', 'draft'],
    ['ready', 'ready'], ['待发布', 'ready'], ['published', 'published'], ['已发布', 'published'], ['Published', 'published'], ['archived', 'draft'],
  ]
  for (const [word, status] of cases) assert.equal(resolveStatus({ status: word }).status, status, word)
  assert.equal(resolveStatus({ stage: '待发布' }).status, 'ready')
  assert.equal(resolveStatus({}).status, 'draft')
  assert.equal(resolveStatus({}).from, null)
  assert.equal(resolveStatus({ status: 'writing', stage: '待发布' }).status, 'draft')
  assert.equal(resolveStatus({ status: 'idea', stage: '待发布' }).status, 'idea')
  // 「status: draft + stage: 待发布」是平台稿已备好
  assert.equal(resolveStatus({ status: 'draft', stage: '待发布' }).status, 'ready')
})

test('日期只认确定的写法，不存在的日子不收', () => {
  assert.equal(parseDate('2026-05-27'), new Date(2026, 4, 27).toISOString())
  assert.equal(parseDate('2026/5/7'), new Date(2026, 4, 7).toISOString())
  assert.equal(parseDate('2026-05-27 08:30'), new Date(2026, 4, 27, 8, 30).toISOString())
  assert.equal(parseDate('2026-05-27T08:30:00Z'), '2026-05-27T08:30:00.000Z')
  for (const bad of ['', '2026-02-31', '昨天', '5月27日', 'true', undefined]) assert.equal(parseDate(bad), null, String(bad))
})

test('版本后缀：图片版、短版、_v2', () => {
  assert.equal(variantOf('2026-06-15_Agent评测_图片版'), '图片版')
  assert.equal(variantOf('2026-06-15_Agent评测_图片版_v2'), '图片版_v2')
  assert.equal(variantOf('kimi-k3-为什么这么强-短版'), '短版')
  assert.equal(variantOf('2026-06-07_Hermes_600字版'), '600字版')
  assert.equal(variantOf('2026-06-25_文心VS豆包-两种战略选择'), null)
})

test('扫描：标题、正文、标签、平台、日期按文件来，跳过画板、短文和索引', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const dir = await folder(home, '小红书', {
      'a.md': `---\r\ntitle: 头里的标题\r\nstatus: 已发布\r\npublish_date: 2026-06-25\r\ncreated: 2026-06-20\r\ntags: [AI, Agent]\r\n---\r\n\r\n# 正文里的一级标题\r\n\r\n${LONG}\r\n`,
      'b.md': `## 开头的二级标题\n\n${LONG}\n## 第二节\n`,
      'c_图片版.md': `## 开头的二级标题\n\n${LONG}`,
      '2026-05-03_只有文件名.md': `第一行不是标题\n${LONG}\n![[配图.png]]\n==高亮==`,
      'd.md': `---\nstatus: published\nplatform: 公众号\n---\n${LONG}`,
      'e.md': `---\nstatus: writing\npublish_date: 2026-07-01\ndate: 2026-02-31\n---\n${LONG}`,
      'f.md': `---\nplatforms: [知乎]\n---\n![cover](imgs/c.png)\n\n# 封面后面的标题\n${LONG}`,
      'g.excalidraw.md': LONG,
      'h.flowchart.md': LONG,
      'i.md': `---\nexcalidraw-plugin: parsed\n---\n${LONG}`,
      'short.md': '# 太短\n不够两百字',
      'README.md': LONG,
      'index.md': LONG,
      'notes.txt': LONG,
      '.hidden.md': LONG,
    })
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'deep.md'), LONG)
    const scan = await scanFolder(dir, { home })
    assert.deepEqual(scan.files.map(row => row.name).sort(), ['2026-05-03_只有文件名.md', 'a.md', 'b.md', 'c_图片版.md', 'd.md', 'e.md', 'f.md'])
    const reasons = Object.fromEntries(scan.skipped.map(row => [row.name, row.reason]))
    for (const name of ['g.excalidraw.md', 'h.flowchart.md', 'i.md']) assert.match(reasons[name], /Excalidraw/)
    assert.match(reasons['short.md'], /不到 200 字/)
    assert.match(reasons['README.md'], /索引/)
    assert.match(reasons['index.md'], /索引/)

    const a = byName(scan, 'a.md')
    assert.equal(a.title, '头里的标题')
    assert.ok(!a.body.includes('正文里的一级标题'), '开头的一级标题不留在正文里')
    assert.deepEqual(a.tags, ['AI', 'Agent'])
    assert.equal(a.status, 'published')
    assert.equal(a.publishedAt, new Date(2026, 5, 25).toISOString())
    assert.equal(a.createdAt, new Date(2026, 5, 20).toISOString())
    assert.equal(a.dateFrom, 'front')
    assert.equal(a.platform, '小红书')
    assert.equal(a.platformFrom, 'folder')
    assert.ok(!a.body.includes('\r'))

    const b = byName(scan, 'b.md')
    assert.equal(b.title, '开头的二级标题')
    assert.ok(b.body.startsWith('这是一段正文'))
    assert.ok(b.body.includes('## 第二节'))
    assert.deepEqual(b.tags, [], '没写标签就没有标签')
    assert.equal(b.status, 'draft')
    assert.equal(b.statusFrom, null)
    assert.equal(b.dateFrom, 'mtime')
    assert.equal(b.publishedAt, null)

    assert.equal(byName(scan, 'c_图片版.md').title, '开头的二级标题（图片版）')
    const named = byName(scan, '2026-05-03_只有文件名.md')
    assert.equal(named.title, '只有文件名')
    assert.ok(named.body.includes('![[配图.png]]') && named.body.includes('==高亮=='), 'Obsidian 写法原样保留')

    const d = byName(scan, 'd.md')
    assert.equal(d.platform, '公众号', '头里写的平台优先于文件夹名')
    assert.equal(d.status, 'published')
    assert.equal(d.publishedAt, null, '已发布但没写日期：不补发布时间')

    const e = byName(scan, 'e.md')
    assert.equal(e.publishedAt, null, '没发布的不记发布时间')
    assert.equal(e.dateFrom, 'mtime', '不存在的日期不收，退回文件修改时间')

    const f = byName(scan, 'f.md')
    assert.equal(f.title, '封面后面的标题')
    assert.equal(f.platform, '知乎')
    // 本地图片换成了工作台能读的地址
    assert.match(f.body, /^!\[cover\]\(media-desk\/imported\/[\w-]+\.png\)/)

    // 再往下看一层
    const deeper = await scanFolder(dir, { home, depth: 1 })
    assert.ok(deeper.files.some(row => row.name === 'deep.md'))
    assert.equal(deeper.files.find(row => row.name === 'deep.md').platform, '小红书')

    // 别的文件夹名不当平台
    const plain = await folder(home, '草稿箱', { 'x.md': LONG })
    assert.equal((await scanFolder(plain, { home })).files[0].platform, null)

    const preview = previewScan({ items: [] }, scan)
    assert.equal(preview.byStatus.published, 2)
    assert.equal(preview.byPlatform.小红书, 5)
    assert.ok(preview.files.every(row => row.body === undefined && row.relation === 'new'))
  } finally {
    await cleanup()
  }
})

test('上限：文件数和单个文件大小', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const dir = await folder(home, 'many', { '1.md': LONG, '2.md': LONG, '3.md': LONG, 'big.md': 'x'.repeat(1_000_001) })
    const scan = await scanFolder(dir, { home, max: 2 })
    assert.equal(scan.files.length, 2)
    const reasons = scan.skipped.map(row => row.reason)
    assert.ok(reasons.some(reason => /上限/.test(reason)))
    const big = await scanFolder(dir, { home })
    assert.match(big.skipped.find(row => row.name === 'big.md').reason, /1 MB/)
  } finally {
    await cleanup()
  }
})

test('路径安全：相对路径、主目录外、链接逃逸、不是文件夹都拒绝；只读不写', async () => {
  const { home: base, cleanup } = await sandbox()
  try {
    const home = join(base, 'home')
    const outside = await folder(base, 'outside', { 'secret.md': LONG })
    const dir = await folder(home, 'notes', { 'ok.md': LONG })
    await assert.rejects(resolveImportDir('notes', { home }), /完整路径/)
    await assert.rejects(resolveImportDir('', { home }), /路径/)
    await assert.rejects(resolveImportDir(outside, { home }), err => err.status === 403)
    await assert.rejects(resolveImportDir(join(home, 'missing'), { home }), /找不到/)
    await assert.rejects(resolveImportDir(join(dir, 'ok.md'), { home }), /不是文件夹/)
    await assert.rejects(resolveImportDir(`${home}/notes/../../outside`, { home }), err => err.status === 403)
    // 主目录里的链接指向外面：按真实路径算，拒绝
    await symlink(outside, join(home, 'escape'))
    await assert.rejects(resolveImportDir(join(home, 'escape'), { home }), err => err.status === 403)
    // 文件夹里指向外面的文件链接：跳过并说明
    await symlink(join(outside, 'secret.md'), join(dir, 'leak.md'))
    await mkdir(join(dir, 'inner'))
    await symlink(outside, join(dir, 'inner-link'))
    // Windows「复制为路径」带引号，~/ 开头也认
    assert.equal(await resolveImportDir(`"${dir}"`, { home }), await resolveImportDir(dir, { home }))
    assert.equal(await resolveImportDir('~/notes', { home }), await resolveImportDir(dir, { home }))
    const before = await readFile(join(dir, 'ok.md'), 'utf8')
    const scan = await scanFolder(dir, { home, depth: 1 })
    assert.deepEqual(scan.files.map(row => row.name), ['ok.md'])
    assert.match(scan.skipped.find(row => row.name === 'leak.md').reason, /外面/)
    assert.equal(await readFile(join(dir, 'ok.md'), 'utf8'), before)
  } finally {
    await cleanup()
  }
})

test('导入：按路径新增或更新，工作台里改过的跳过；整次导入一步撤销', async () => {
  const { home, cleanup } = await sandbox()
  const store = new Store(join(home, 'state'), { samples: false })
  try {
    const dir = await folder(home, '公众号', {
      'one.md': `---\nstatus: ready\ntags: [AI]\n---\n# 第一篇\n${LONG}`,
      'two.md': `## 第二篇\n${LONG}`,
      'three.md': `## 第三篇\n${LONG}`,
    })
    const scan = await scanFolder(dir, { home })
    const report = await store.mutate('导入', state => importScan(state, scan))
    assert.deepEqual([report.added, report.updated, report.unchanged, report.edited.length], [3, 0, 0, 0])
    let state = await store.read()
    const one = state.items.find(row => row.importPath === join(scan.dir, 'one.md'))
    assert.equal(one.title, '第一篇')
    assert.equal(one.status, 'ready')
    assert.equal(one.platform, '公众号')
    assert.equal(one.source, '公众号')
    assert.equal(one.imported, true)
    assert.equal(one.importDir, scan.dir)
    assert.equal(one.production.status, 'done')
    assert.equal(one.production.article, one.body)
    assert.equal(one.production.importedFrom, join(scan.dir, 'one.md'))
    assert.equal(one.publishedAt, undefined)
    assert.equal(one.scheduledAt, undefined, '不替用户排期')
    assert.equal(state.metrics.length, 0, '不编数据')
    assert.equal(isEdited(one), false)
    assert.deepEqual(state.importDirs.map(row => [row.dir, row.count]), [[scan.dir, 3]])

    // 只选一部分文件，同样的文件再导一次不重复
    const again = await store.mutate('再导', draft => importScan(draft, scan, { paths: [join(scan.dir, 'two.md')] }))
    assert.deepEqual([again.added, again.unchanged], [0, 1])
    assert.equal((await store.read()).items.length, 3)

    // 工作台里改了第二篇的成稿；然后两篇文件都改了
    const two = state.items.find(row => row.importPath === join(scan.dir, 'two.md'))
    await store.mutate('改稿', draft => applyOps(draft, [{ op: 'update_production', id: two.id, article: '我在工作台里改过' }]))
    await writeFile(join(dir, 'one.md'), `---\nstatus: published\npublish_date: 2026-06-25\n---\n# 第一篇改了\n${LONG}`)
    await writeFile(join(dir, 'two.md'), `## 第二篇改了\n${LONG}`)
    const later = new Date(Date.now() + 60_000)
    await utimes(join(dir, 'one.md'), later, later)
    await utimes(join(dir, 'two.md'), later, later)
    const rescan = await scanFolder(dir, { home })
    const preview = previewScan(await store.read(), rescan)
    assert.deepEqual(Object.fromEntries(preview.files.map(row => [row.name, row.relation])), { 'one.md': 'update', 'three.md': 'same', 'two.md': 'edited' })
    const second = await store.mutate('重新导入', draft => importScan(draft, rescan))
    assert.deepEqual([second.added, second.updated, second.unchanged], [0, 1, 1])
    assert.equal(second.edited.length, 1)
    assert.equal(second.edited[0].reason, '已在工作台改过，跳过')
    state = await store.read()
    const updated = state.items.find(row => row.id === one.id)
    assert.equal(updated.title, '第一篇改了')
    assert.equal(updated.production.title, '第一篇改了')
    assert.equal(updated.status, 'published')
    assert.equal(updated.publishedAt, new Date(2026, 5, 25).toISOString())
    assert.equal(updated.tags.length, 0, '文件里删掉的标签跟着删')
    assert.equal(state.items.find(row => row.id === two.id).production.article, '我在工作台里改过')

    // 撤销这一次重新导入：第一篇回到上一版
    await store.undoLast()
    assert.equal((await store.read()).items.find(row => row.id === one.id).title, '第一篇')
  } finally {
    await cleanup()
  }
})

test('移除：只移除从这个文件夹导入、没在工作台改过的；可以撤销', async () => {
  const { home, cleanup } = await sandbox()
  const store = new Store(join(home, 'state'), { samples: false })
  try {
    const dir = await folder(home, '小红书', { 'a.md': `## A\n${LONG}`, 'b.md': `## B\n${LONG}` })
    const other = await folder(home, '公众号', { 'c.md': `## C\n${LONG}` })
    const scan = await scanFolder(dir, { home })
    await store.mutate('导入', state => importScan(state, scan))
    await store.mutate('导入', async state => importScan(state, await scanFolder(other, { home })))
    await store.mutate('记灵感', state => applyOps(state, [{ op: 'add_item', title: '自己记的灵感' }]))
    const b = (await store.read()).items.find(row => row.importPath === join(scan.dir, 'b.md'))
    await store.mutate('改状态', state => applyOps(state, [{ op: 'set_status', id: b.id, status: 'published' }]))
    const result = await store.mutate('移除', state => removeImported(state, scan.dir))
    assert.deepEqual(result, { removed: 1, kept: 1 })
    let state = await store.read()
    assert.deepEqual(state.items.map(row => row.title).sort(), ['B', 'C', '自己记的灵感'])
    assert.deepEqual(state.importDirs.map(row => row.name), ['公众号'])
    await assert.rejects(store.mutate('再移除', draft => removeImported(draft, join(home, 'never'))), /没有从这个文件夹导入过/)
    await store.undoLast()
    state = await store.read()
    assert.deepEqual(state.items.map(row => row.title).sort(), ['A', 'B', 'C', '自己记的灵感'])
    assert.equal(state.importDirs.length, 2)
  } finally {
    await cleanup()
  }
})

test('导入稿子里的本地图片：相对路径换成工作台地址，只放行已导入文件夹里的图片', async () => {
  const { linkLocalImages, importedImagePath, allowedImportedImage } = await import('../src/import-md.js')
  const { mkdtemp, mkdir, writeFile, rm, symlink, realpath } = await import('node:fs/promises')
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await realpath(await mkdtemp(join(homedir(), '.md-img-test-')))
  try {
    await mkdir(join(root, 'notes', 'imgs'), { recursive: true })
    await writeFile(join(root, 'notes', 'imgs', 'a b.png'), 'x')
    await writeFile(join(root, 'secret.png'), 'x')
    await symlink(join(root, 'secret.png'), join(root, 'notes', 'imgs', 'link.png'))
    const file = join(root, 'notes', 'post.md')
    const body = linkLocalImages('![图](imgs/a%20b.png) ![网](https://x.example/a.png) ![文](imgs/a.txt) ![外](../secret.png)', file)
    const srcs = [...body.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1])
    assert.match(srcs[0], /^media-desk\/imported\/[\w-]+\.png$/)
    assert.equal(srcs[1], 'https://x.example/a.png')
    assert.equal(srcs[2], 'imgs/a.txt')
    const state = { importDirs: [{ dir: join(root, 'notes') }], items: [{ imported: true, body: '', production: { article: body } }] }
    const name = src => src.slice('media-desk/imported/'.length)
    assert.equal(await allowedImportedImage(state, name(srcs[0])), join(root, 'notes', 'imgs', 'a b.png'))
    // 文件夹外面的、经链接指到外面的、不存在的、格式不对的，都不给
    assert.equal(await allowedImportedImage(state, name(srcs[3])), null)
    assert.equal(await allowedImportedImage(state, `${Buffer.from(join(root, 'notes', 'imgs', 'link.png')).toString('base64url')}.png`), null)
    assert.equal(await allowedImportedImage(state, `${Buffer.from(join(root, 'notes', 'nope.png')).toString('base64url')}.png`), null)
    assert.equal(await allowedImportedImage({ importDirs: [] }, name(srcs[0])), null)
    // 在文件夹里、但没有哪篇稿子引用过的图片也不给
    assert.equal(await allowedImportedImage({ importDirs: [{ dir: join(root, 'notes') }], items: [] }, name(srcs[0])), null)
    assert.equal(importedImagePath('../../etc/passwd'), null)
    assert.equal(importedImagePath(`${Buffer.from('relative/a.png').toString('base64url')}.png`), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// —— 合篇、发布状态、重复、标题、Obsidian 图片、正文摘要 ——

const { importScans, previewImport, scanFolders, userText, excerptOf, contentHash, nameDate, looksLikeLabel, linkLocalImages, allowedImportedImage } = await import('../src/import-md.js')

/** 按文件写进去，可以指定修改时间（毫秒）。 */
async function files(dir, rows) {
  await mkdir(dir, { recursive: true })
  for (const [name, text, mtime] of rows) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), text)
    if (mtime) await utimes(join(dir, name), new Date(mtime), new Date(mtime))
  }
  return dir
}

const XHS_BODY = '我先说结论：这个机制值得每个做 Agent 的人看一遍。'.repeat(12)
const CARDS = `## 第一页大标题\n\n一句小标题\n\n## 第二页\n\n${'卡片里的细节和数据。'.repeat(25)}`
const WECHAT_BODY = '公众号长文的正文，讲得更完整，也有更多推导。'.repeat(20)

async function realFolders(home) {
  const wechat = await files(join(home, '公众号'), [
    ['2026-06-15_Loop-Engineering.md', `---\nstatus: ready\ncreated: 2026-06-10\n---\n# Loop Engineering 到底在说什么\n${WECHAT_BODY}`],
    ['2026-09-08_火山把版权做成了一门生意.md', `---\ntitle: 火山把版权做成了一门生意\n---\n${WECHAT_BODY}`],
    ['2026-11-09-文心ERNIE-Evolve-RSI解读.md', `---\ntitle: 文心 5.5 Flash 研发技术首次揭秘\ndate: 2026-11-09\nstatus: draft\n---\n${WECHAT_BODY}`],
  ])
  const xhs = await files(join(home, '小红书'), [
    ['2026-06-07_Hermes自进化机制.md', `## Hermes自进化机制：字节面试复盘\n${XHS_BODY}`],
    ['2026-06-07_Hermes自进化机制_图片版.md', `## 一句话定位\n\n${CARDS}`],
    ['2026-06-07_Hermes自进化机制_600字版.md', `## Hermes自进化机制：字节面试复盘\n${XHS_BODY}`],
    ['2026-06-19-大厂集体砍AI额度-正文版.md', `# 大厂集体砍AI额度，但我反而觉得是好事\n${XHS_BODY}`],
    ['2026-06-19-大厂集体砍AI额度_图片版.md', CARDS],
    ['2026-05-03_Anthropic产品负责人说PM该被淘汰了未命名.md', `# Anthropic产品负责人说PM该被淘汰了\n${XHS_BODY}`],
    ['2026-05-03_Anthropic产品负责人说PM该被淘汰了_图片版.md', `# Anthropic产品负责人说PM该被淘汰了\n${CARDS}`],
    ['2026-05-06_Agent自进化7篇论文的核心判断.md', `## Agent自进化：做过的事不能白做\n${XHS_BODY}`],
    ['2026-05-06_我读了7篇Agent自进化论文的核心判断_图片版.md', `## Agent自进化：做过的事不能白做\n${CARDS}`],
    ['2026-06-16_Loop-Engineering.md', `---\ntags: [Agent, 工程]\n---\n## 你不该再给Agent写提示词了\n${XHS_BODY}`],
    ['2026-06-16_Loop-Engineering_图片版.md', CARDS],
    ['2026-09-08_AI让内容贬值值钱的只剩IP.md', `## AI 让内容贬值，值钱的只剩 IP\n${XHS_BODY}`],
    ['2026-11-09-文心ERNIE-Evolve-短笔记.md', `百度让 AI 自己调推理代码，3 天吞吐涨了 33.7%\n${XHS_BODY}`],
  ])
  return { wechat, xhs }
}

const versionOf = item => item.production?.versions?.['小红书']

test('合篇：小红书正文和图片版（含 -正文版、未命名、按标题配对）合成一篇；短版另算', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const { xhs } = await realFolders(home)
    const scans = await scanFolders({ dir: xhs }, { home })
    const state = { items: [] }
    importScans(state, scans)
    const find = name => state.items.find(row => (row.importParts ?? []).some(part => part.path.endsWith(`/${name}`)))
    const hermes = find('2026-06-07_Hermes自进化机制.md')
    assert.equal(hermes, find('2026-06-07_Hermes自进化机制_图片版.md'), '正文和图片版是同一条')
    assert.equal(hermes.title, 'Hermes自进化机制：字节面试复盘')
    assert.deepEqual(hermes.importParts.map(part => part.role).sort(), ['xhs-body', 'xhs-cards'])
    assert.equal(hermes.platform, '小红书')
    const version = versionOf(hermes)
    assert.equal(version.status, 'done')
    assert.ok(version.body.startsWith('我先说结论'))
    assert.ok(version.cards.startsWith('## 一句话定位') && version.cards.includes('## 第二页'), '图片版原文整段放进 cards，按 ## 分页')
    assert.equal(hermes.production.article, version.body)
    // 600字版不是图片版，另成一篇
    const short = find('2026-06-07_Hermes自进化机制_600字版.md')
    assert.notEqual(short, hermes)
    assert.match(short.title, /（600字版）$/)
    assert.equal(versionOf(short), undefined)
    // -正文版 当正文；文件名多了「未命名」也认
    assert.equal(find('2026-06-19-大厂集体砍AI额度-正文版.md'), find('2026-06-19-大厂集体砍AI额度_图片版.md'))
    assert.equal(versionOf(find('2026-06-19-大厂集体砍AI额度-正文版.md')).title, '大厂集体砍AI额度，但我反而觉得是好事')
    assert.equal(find('2026-05-03_Anthropic产品负责人说PM该被淘汰了未命名.md'), find('2026-05-03_Anthropic产品负责人说PM该被淘汰了_图片版.md'))
    // 文件名不同、同一天、标题明显是一件事
    assert.equal(find('2026-05-06_Agent自进化7篇论文的核心判断.md'), find('2026-05-06_我读了7篇Agent自进化论文的核心判断_图片版.md'))
    const preview = previewImport({ items: [] }, scans)
    const pair = preview.groups.find(group => group.kind === 'pair' && group.names.includes('2026-05-06_Agent自进化7篇论文的核心判断.md'))
    assert.equal(pair.how, 'title')
    assert.equal(pair.on, true)
    assert.equal(pair.count, 2)
  } finally {
    await cleanup()
  }
})

test('合篇：小红书挂到同一天（或差一天）、标题对得上的公众号下面；证据不够不合；可以拆开', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const { wechat, xhs } = await realFolders(home)
    const scans = await scanFolders({ folders: [{ dir: wechat }, { dir: xhs }] }, { home })
    const state = { items: [] }
    const report = importScans(state, scans)
    const byPath = name => state.items.find(row => (row.importParts ?? []).some(part => part.path.endsWith(`/${name}`)))
    const loop = byPath('2026-06-15_Loop-Engineering.md')
    assert.equal(loop, byPath('2026-06-16_Loop-Engineering.md'), '差一天、同名：挂上')
    assert.equal(loop, byPath('2026-06-16_Loop-Engineering_图片版.md'))
    assert.equal(loop.platform, '公众号')
    assert.equal(loop.title, 'Loop Engineering 到底在说什么')
    assert.ok(loop.production.article.startsWith('公众号长文'), '公众号正文是母稿')
    // 小红书正文开头是二级标题、和文件名说的不是一件事：用文件名当标题
    assert.equal(versionOf(loop).title, 'Loop-Engineering')
    assert.ok(versionOf(loop).body.startsWith('## 你不该再给Agent写提示词了\n我先说结论'), '没当标题用的开头那行留在正文里')
    assert.ok(versionOf(loop).cards.includes('## 第一页大标题'))
    assert.deepEqual(versionOf(loop).tags, ['Agent', '工程'])
    assert.deepEqual(loop.importParts.map(part => [part.role, part.root]).sort(), [['article', scans[0].dir], ['xhs-body', scans[1].dir], ['xhs-cards', scans[1].dir]])
    // 短笔记当小红书正文挂到同一天的公众号下面（文件名里的英文名拆开比）
    assert.equal(byPath('2026-11-09-文心ERNIE-Evolve-RSI解读.md'), byPath('2026-11-09-文心ERNIE-Evolve-短笔记.md'))
    // 同一天、话题不同：不合
    assert.notEqual(byPath('2026-09-08_火山把版权做成了一门生意.md'), byPath('2026-09-08_AI让内容贬值值钱的只剩IP.md'))
    assert.ok(report.grouped >= 6)

    // 预览里列出这几组，用户取消「挂到公众号」那一组，小红书那篇单独成一篇
    const preview = previewImport({ items: [] }, scans)
    const cross = preview.groups.find(group => group.kind === 'cross' && group.names.includes('2026-06-15_Loop-Engineering.md'))
    assert.equal(cross.count, 3)
    const split = { items: [] }
    importScans(split, scans, { split: [cross.key] })
    const mother = split.items.find(row => row.importPath.endsWith('2026-06-15_Loop-Engineering.md'))
    assert.equal(versionOf(mother), undefined)
    // 拆开记在文件夹上，「重新导入」照旧拆开
    assert.ok(split.importDirs.some(row => row.split.includes(cross.key)))
    importScans(split, scans)
    assert.equal(versionOf(split.items.find(row => row.id === mother.id)), undefined)
    const own = split.items.find(row => row.importPath.endsWith('2026-06-16_Loop-Engineering.md'))
    assert.equal(versionOf(own).cards.includes('## 第一页大标题'), true, '拆开挂靠，小红书正文和图片版还是一篇')
    // 再拆开正文和图片版：变成两篇
    const pairKey = previewImport({ items: [] }, scans, { split: [cross.key] }).groups.find(group => group.kind === 'pair' && group.names.includes('2026-06-16_Loop-Engineering.md')).key
    const apart = { items: [] }
    importScans(apart, scans, { split: [cross.key, pairKey] })
    assert.notEqual(apart.items.find(row => row.importPath.endsWith('2026-06-16_Loop-Engineering.md')), apart.items.find(row => row.importPath.endsWith('2026-06-16_Loop-Engineering_图片版.md')))
    assert.equal(previewImport({ items: [] }, scans, { split: [pairKey] }).groups.find(group => group.key === pairKey).on, false, '拆开的组还在预览里，可以再勾回来')
  } finally {
    await cleanup()
  }
})

test('合篇：差三天、或者同分分不出挂哪篇，就不合', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const wechat = await files(join(home, '公众号'), [
      ['2026-06-01_Loop-Engineering.md', `# Loop Engineering\n${WECHAT_BODY}`],
      ['2026-07-01_Codex团队采访-工程篇.md', `# Codex 团队采访：工程篇\n${WECHAT_BODY}`],
      ['2026-07-01_Codex团队采访-产品篇.md', `# Codex 团队采访：产品篇\n${WECHAT_BODY.slice(10)}`],
    ])
    const xhs = await files(join(home, '小红书'), [
      ['2026-06-04_Loop-Engineering.md', `# Loop Engineering\n${XHS_BODY}`],
      ['2026-07-01_Codex团队采访.md', `# Codex 团队采访\n${XHS_BODY}`],
    ])
    const scans = await scanFolders({ folders: [{ dir: wechat }, { dir: xhs }] }, { home })
    const preview = previewImport({ items: [] }, scans)
    assert.equal(preview.groups.filter(group => group.kind === 'cross').length, 0)
    assert.equal(preview.pieces.length, 5)
  } finally {
    await cleanup()
  }
})

test('合篇：只导入小红书文件夹时挂到以前导入的公众号稿子；移除哪个文件夹只去掉那部分', async () => {
  const { home, cleanup } = await sandbox()
  const store = new Store(join(home, 'state'), { samples: false })
  try {
    const { wechat, xhs } = await realFolders(home)
    await store.mutate('导入公众号', async state => importScans(state, await scanFolders({ dir: wechat }, { home })))
    const xhsScans = await scanFolders({ dir: xhs }, { home })
    const preview = previewImport(await store.read(), xhsScans)
    const attach = preview.pieces.find(piece => piece.relation === 'attach' && piece.files.some(file => file.name === '2026-06-16_Loop-Engineering.md'))
    assert.equal(attach.target.title, 'Loop Engineering 到底在说什么')
    const report = await store.mutate('导入小红书', state => importScans(state, xhsScans))
    assert.ok(report.attached >= 2, JSON.stringify(report))
    let state = await store.read()
    const loop = state.items.find(row => row.importPath.endsWith('2026-06-15_Loop-Engineering.md'))
    assert.ok(versionOf(loop).cards)
    assert.equal(state.items.filter(row => row.importParts?.some(part => part.path.endsWith('2026-06-16_Loop-Engineering.md'))).length, 1)
    // 再导一次：没变；已经挂上的不会因为又出现一篇同一天、标题也对得上的公众号稿子而换地方
    await files(wechat, [['2026-06-15_Loop-Engineering_长文版.md', `# Loop Engineering 你不该再给Agent写提示词了\n${WECHAT_BODY}`]])
    await store.mutate('导入公众号长文版', async draft => importScans(draft, await scanFolders({ dir: wechat }, { home }), { paths: [join((await scanFolders({ dir: wechat }, { home }))[0].dir, '2026-06-15_Loop-Engineering_长文版.md')] }))
    const again = await store.mutate('再导小红书', async draft => importScans(draft, await scanFolders({ dir: xhs }, { home })))
    assert.equal(again.added + again.updated + again.attached, 0)
    assert.equal(again.unchanged, preview.pieces.length)
    // 去掉这篇长文版，免得后面两篇公众号同分、分不出挂哪篇
    const extra = (await store.read()).items.find(row => row.importPath.endsWith('_长文版.md'))
    await store.mutate('删长文版', draft => applyOps(draft, [{ op: 'delete_item', id: extra.id }]))
    await rm(join(wechat, '2026-06-15_Loop-Engineering_长文版.md'))

    // 移除小红书文件夹：公众号那篇留着，小红书版本去掉
    const removed = await store.mutate('移除小红书', draft => removeImported(draft, xhsScans[0].dir))
    assert.ok(removed.detached >= 2)
    state = await store.read()
    const kept = state.items.find(row => row.id === loop.id)
    assert.equal(versionOf(kept), undefined)
    assert.deepEqual(kept.importParts.map(part => part.role), ['article'])
    assert.equal(isEdited(kept), false)
    assert.equal(state.items.filter(row => row.importDir === xhsScans[0].dir).length, 0)

    // 反过来：一起导入后移除公众号文件夹，挂着的小红书那篇变回单独的一篇
    await store.mutate('导回小红书', async draft => importScans(draft, await scanFolders({ dir: xhs }, { home })))
    const wechatDir = (await scanFolders({ dir: wechat }, { home }))[0].dir
    const back = await store.mutate('移除公众号', draft => removeImported(draft, wechatDir))
    assert.ok(back.detached >= 2)
    state = await store.read()
    const alone = state.items.find(row => row.importPath.endsWith('2026-06-16_Loop-Engineering.md'))
    assert.equal(alone.platform, '小红书')
    assert.equal(alone.title, 'Loop-Engineering')
    assert.ok(alone.production.article.startsWith('## 你不该再给Agent写提示词了'))
    assert.equal(alone.importDir, xhsScans[0].dir)
    assert.ok(versionOf(alone).cards)
    assert.equal(state.items.some(row => row.importDir === wechatDir), false)
    assert.equal(isEdited(alone), false)
  } finally {
    await cleanup()
  }
})

test('发过了吗：都发过了按 文件头 → 文件名 → 修改时间 取发布日期；都还没发不算发布；默认按文件；文件名日期当创建日期', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const mtime = new Date(2026, 9, 3, 12).getTime()
    const wechat = await files(join(home, '公众号'), [
      ['2026-11-12_词元所我最在意的不是7000亿.md', `# 词元所我最在意的不是7000亿\n${WECHAT_BODY}`, mtime],
      ['20261105火山把版权做成了一门生意.md', `# 火山把版权做成了一门生意\n${WECHAT_BODY}`, mtime],
      ['2026-06-25-文心VS豆包.md', `---\nstatus: 已发布\npublish_date: 2026-06-26\ncreated: 2026-06-24\n---\n# 同一天，文心和豆包选了相反的方向\n${WECHAT_BODY}`, mtime],
      ['长程agent.md', `## 搞长程 Agent 最该学的东西\n${WECHAT_BODY}`, mtime],
    ])
    const xhs = await files(join(home, '小红书'), [
      ['2026-11-12_词元所我最在意的不是7000亿.md', `## 李彦宏发了个大模型交易所\n${XHS_BODY}`, mtime],
      ['2026-11-12_词元所我最在意的不是7000亿_图片版.md', CARDS, mtime],
    ])
    const scan = async (a, b) => scanFolders({ folders: [{ dir: wechat, published: a }, { dir: xhs, published: b }] }, { home })
    const dirs = (await scan()).map(row => row.dir)
    const piece = (preview, name) => preview.pieces.find(row => row.files.some(file => file.name === name))

    // 默认按文件：只有写了已发布的那篇算发布；创建日期按文件头、文件名、修改时间
    const byFile = previewImport({ items: [] }, await scan())
    assert.deepEqual(byFile.folders.map(row => row.published), ['file', 'file'])
    const ciyuan = piece(byFile, '2026-11-12_词元所我最在意的不是7000亿.md')
    assert.equal(ciyuan.status, 'draft')
    assert.equal(ciyuan.createdAt, new Date(2026, 10, 12).toISOString())
    assert.equal(ciyuan.dateFrom, 'name')
    assert.equal(piece(byFile, '20261105火山把版权做成了一门生意.md').createdAt, new Date(2026, 10, 5).toISOString())
    const wenxin = piece(byFile, '2026-06-25-文心VS豆包.md')
    assert.deepEqual([wenxin.status, wenxin.dateFrom, wenxin.publishedAt, wenxin.publishedFrom], ['published', 'front', new Date(2026, 5, 26).toISOString(), 'front'])
    assert.equal(piece(byFile, '长程agent.md').dateFrom, 'mtime')

    // 都发过了
    const state = { items: [] }
    importScans(state, await scan('all', 'file'))
    const item = name => state.items.find(row => row.importParts.some(part => part.path.endsWith(`公众号/${name}`)))
    const one = item('2026-11-12_词元所我最在意的不是7000亿.md')
    assert.equal(one.status, 'published')
    assert.equal(one.publishedAt, new Date(2026, 10, 12).toISOString())
    assert.deepEqual(one.publish['公众号'], { state: 'published', at: new Date(2026, 10, 12).toISOString(), url: null, from: 'import' })
    assert.equal(one.publish['小红书'], undefined, '小红书文件夹按文件来、文件里没写发布：不记')
    assert.ok(versionOf(one).cards)
    assert.equal(item('长程agent.md').publishedAt, new Date(mtime).toISOString(), '没有别的日期才用修改时间')
    assert.equal(item('2026-06-25-文心VS豆包.md').publishedAt, new Date(2026, 5, 26).toISOString())
    const all = previewImport({ items: [] }, await scan('all', 'all'))
    assert.deepEqual(['name', 'mtime', 'front'].map(from => all.pieces.filter(row => row.publishedFrom === from).length > 0), [true, true, true])
    assert.deepEqual(all.folders.map(row => row.published), ['all', 'all'])
    const both = { items: [] }
    importScans(both, await scan('file', 'all'))
    const crossed = both.items.find(row => row.importParts.length === 3)
    assert.equal(crossed.status, 'published', '小红书发过了，这一篇就算发过')
    assert.deepEqual(Object.keys(crossed.publish), ['小红书'])
    assert.deepEqual(both.importDirs.map(row => row.published), ['file', 'all'])

    // 都还没发：文件里写了已发布也不算
    const none = previewImport({ items: [] }, await scan('none', 'none'))
    assert.equal(piece(none, '2026-06-25-文心VS豆包.md').status, 'ready')
    assert.equal(none.pieces.filter(row => row.status === 'published').length, 0)

    // 换了回答再导一次：文件没变也会更新；重新导入沿用上次的回答
    importScans(state, await scan('none', 'file'))
    assert.equal(item('2026-11-12_词元所我最在意的不是7000亿.md').status, 'draft')
    assert.equal(item('2026-11-12_词元所我最在意的不是7000亿.md').publish?.['公众号'], undefined)
    importScans(state, await scan('all', 'file'))
    const again = importScans(state, await scanFolders({ dir: dirs[0] }, { home }))
    assert.equal(again.unchanged, 4)
  } finally {
    await cleanup()
  }
})

test('可能重复：同一文件夹、同一天、标题几乎一样，默认只导入最近改过的；可以换一份或都留；不同版本不算重复', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const dir = await files(join(home, '公众号'), [
      ['DeepSeek 这篇 Super-agent 把 Agent 架构的底裤扒了.md', `---\ntitle: DeepSeek 这篇 Super-agent 把 Agent 架构的底裤扒了\ncreated: 2026-11-01\n---\n${WECHAT_BODY}`, new Date(2026, 10, 1, 18, 23).getTime()],
      ['Harness 如何接上 RL？推荐看看这篇 Hugging Face 博客.md', `## DeepSeek 这篇 Super-agent 把 Agent 架构的底裤扒了\n${WECHAT_BODY}`, new Date(2026, 10, 1, 18, 46).getTime()],
      ['2026-06-25_文心VS豆包-两种战略选择.md', `## 同一天，文心和豆包选了相反的方向\n${WECHAT_BODY}`, new Date(2026, 5, 25, 22, 37).getTime()],
      ['2026-06-25-文心VS豆包-两种战略选择.md', `---\nstatus: 已发布\n---\n# 同一天，文心和豆包选了相反的方向\n${WECHAT_BODY}`, new Date(2026, 5, 25, 22, 46).getTime()],
      ['2026-06-10_Codex团队采访.md', `## 付费看完了 Codex 团队的采访\n${WECHAT_BODY}`],
      ['2026-06-10_Codex团队采访_短版.md', `## 付费看完了 Codex 团队的采访\n${WECHAT_BODY}`],
    ])
    const scans = await scanFolders({ dir }, { home })
    const preview = previewImport({ items: [] }, scans)
    assert.equal(preview.duplicates.length, 2, '短版和正文同一个标题也不算重复')
    const deepseek = preview.duplicates.find(dup => dup.files.some(file => file.name.startsWith('DeepSeek')))
    assert.ok(deepseek.suggested.endsWith('Harness 如何接上 RL？推荐看看这篇 Hugging Face 博客.md'))
    assert.equal(deepseek.keep, deepseek.suggested)
    assert.equal(preview.pieces.length, 4)
    assert.equal(preview.files.filter(row => row.dropped).length, 2)

    const state = { items: [] }
    const report = importScans(state, scans)
    assert.equal(report.added, 4)
    assert.equal(report.dropped.length, 2)
    assert.equal(state.items.filter(row => /文心和豆包/.test(row.title)).length, 1, '不会悄悄导入两份')
    assert.equal(state.items.find(row => /文心和豆包/.test(row.title)).status, 'published', '默认留最近改过的那份')

    // 换成留另一份；或者都留
    const other = deepseek.paths.find(path => path !== deepseek.suggested)
    const picked = { items: [] }
    importScans(picked, scans, { keep: { [deepseek.key]: other } })
    assert.ok(picked.items.some(row => row.importPath === other))
    assert.ok(!picked.items.some(row => row.importPath === deepseek.suggested))
    const kept = { items: [] }
    importScans(kept, scans, { keep: { [deepseek.key]: 'all' } })
    assert.equal(kept.items.length, 5)
    // 选择记在文件夹上：「重新导入」按钮不带选择，照上次的来，不会把另一份也导进来
    const picked2 = { items: [] }
    importScans(picked2, scans, { keep: { [deepseek.key]: other } })
    assert.deepEqual(picked2.importDirs[0].keep, { [deepseek.key]: other })
    const rerun = importScans(picked2, await scanFolders({ dir }, { home }))
    assert.equal(rerun.added, 0)
    assert.equal(picked2.items.length, 4)
    // 乱填的选择当没选
    assert.equal(previewImport({ items: [] }, scans, { keep: { [deepseek.key]: '/etc/passwd', __proto__: 'x' } }).duplicates.find(dup => dup.key === deepseek.key).keep, deepseek.suggested)
  } finally {
    await cleanup()
  }
})

test('标题：开头是小节名或者和文件名对不上的二级标题，用文件名（去掉日期和版本后缀）', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const dir = await files(join(home, '小红书'), [
      ['2026-06-07_Hermes自进化机制_图片版.md', `## 一句话定位\n\n${CARDS}`],
      ['未命名 5.md', `## ⭕️项目背景\n${XHS_BODY}`],
      ['2026-10-29_Mac新品AI短剧接单.md', `# 一、分品规划【博主需要根据自己的选品来】\n${XHS_BODY}`],
      ['2026-08-16_当一次rollout要跑几十小时Agent该怎么学.md', `## 当一次 rollout 要跑几十小时，Agent 该怎么学\n${XHS_BODY}`],
      ['2026-05-08_我读了8篇Agent规划论文.md', `## 规划能力的瓶颈，不在"想不出计划"\n${XHS_BODY}`],
      ['27.md', `## 27 届想投 Agent 方向的，先看完这篇再投\n${XHS_BODY}`],
    ])
    const scan = (await scanFolders({ dir }, { home }))[0]
    const title = name => scan.files.find(row => row.name === name).title
    assert.equal(title('2026-06-07_Hermes自进化机制_图片版.md'), 'Hermes自进化机制（图片版）')
    assert.equal(title('未命名 5.md'), '⭕️项目背景', '文件名不像标题时，只能用开头那行')
    assert.equal(title('2026-10-29_Mac新品AI短剧接单.md'), 'Mac新品AI短剧接单')
    assert.equal(title('2026-08-16_当一次rollout要跑几十小时Agent该怎么学.md'), '当一次 rollout 要跑几十小时，Agent 该怎么学', '和文件名说的是一件事：用带标点的这行')
    assert.equal(title('2026-05-08_我读了8篇Agent规划论文.md'), '我读了8篇Agent规划论文')
    assert.ok(scan.files.find(row => row.name === '2026-05-08_我读了8篇Agent规划论文.md').body.startsWith('## 规划能力的瓶颈'), '没用作标题的那行留在正文里')
    assert.equal(title('27.md'), '27 届想投 Agent 方向的，先看完这篇再投')
    for (const label of ['一句话定位', '⭕️项目背景', '一、分品规划', '3. 方法', '背景']) assert.equal(looksLikeLabel(label), true, label)
    for (const real of ['Hermes自进化机制：字节面试复盘', '规划能力的瓶颈，不在"想不出计划"', '🦞我用3个AI Agent搭了一个自媒体工厂，每天自动出稿']) assert.equal(looksLikeLabel(real), false, real)
    assert.equal(nameDate('2026-11-12_词元所'), new Date(2026, 10, 12).toISOString())
    assert.equal(nameDate('2026-11-12-词元所'), new Date(2026, 10, 12).toISOString())
    assert.equal(nameDate('20261112词元所'), new Date(2026, 10, 12).toISOString())
    for (const bad of ['0213', '2026-02-31_x', '202611123', 'Drawing 2026-05-26']) assert.equal(nameDate(bad), null, bad)
  } finally {
    await cleanup()
  }
})

test('正文摘要：导入的内容 item.body 只存 400 字以内的纯文字，全文在成稿里，userText 给全文；旧数据指纹不变', async () => {
  const { home, cleanup } = await sandbox()
  try {
    const long = `# 长文\n\n**加粗**的开头，==高亮==，[链接](https://x.example)，![图](imgs/a.png) ![[b.png]]\n\n| 表 | 头 |\n|---|---|\n| a | b |\n\n${'很长的正文。'.repeat(2000)}`
    const dir = await files(join(home, '公众号'), [['长文.md', long]])
    const state = { items: [] }
    importScans(state, await scanFolders({ dir }, { home }))
    const [item] = state.items
    assert.ok(item.body.length <= 400)
    assert.ok(item.body.startsWith('加粗的开头，高亮，链接，'), item.body.slice(0, 40))
    assert.doesNotMatch(item.body, /[*#=|![\]]/)
    assert.ok(item.production.article.length > 10000)
    assert.equal(userText(item), item.production.article)
    assert.equal(userText({ body: '自己记的灵感' }), '自己记的灵感')
    assert.equal(userText({ imported: true, body: '账号导入的帖子' }), '账号导入的帖子', '账号导入的没有成稿，用 body')
    assert.equal(excerptOf('## 标题\n- 一\n- 二\n```js\ncode()\n```\n结尾'), '标题 一 二 结尾')
    // 以前导入的内容没有 importParts：指纹算法和原来一样，不会因为升级被当成改过
    const old = { title: 'a', body: 'b', status: 'draft', tags: [], platform: '公众号', production: { title: 'a', article: 'b', versions: { 小红书: { body: 'x' } } } }
    const { createHash } = await import('node:crypto')
    assert.equal(contentHash(old), createHash('sha1').update(JSON.stringify(['a', 'b', 'draft', [], '公众号', 'a', 'b'])).digest('hex'))
  } finally {
    await cleanup()
  }
})

test('重新导入合成的一篇：图片版文件改了就更新；小红书版本在工作台改过就跳过；以前分开导入的几条合进来', async () => {
  const { home, cleanup } = await sandbox()
  const store = new Store(join(home, 'state'), { samples: false })
  try {
    const xhs = await files(join(home, '小红书'), [
      ['2026-06-16_Loop-Engineering.md', `## 你不该再给Agent写提示词了\n${XHS_BODY}`],
      ['2026-06-16_Loop-Engineering_图片版.md', CARDS],
    ])
    const scans = await scanFolders({ dir: xhs }, { home })
    // 旧版本导入的样子：两条分开，用 paths 只导其中一个文件也是单独一条
    await store.mutate('只导正文', state => importScans(state, scans, { paths: [join(scans[0].dir, '2026-06-16_Loop-Engineering.md')] }))
    await store.mutate('只导图片版', state => importScans(state, scans, { paths: [join(scans[0].dir, '2026-06-16_Loop-Engineering_图片版.md')] }))
    assert.equal((await store.read()).items.length, 2)
    const merged = await store.mutate('一起导', state => importScans(state, scans))
    assert.deepEqual([merged.updated, merged.merged], [1, 1])
    let state = await store.read()
    assert.equal(state.items.length, 1)
    const id = state.items[0].id
    assert.ok(versionOf(state.items[0]).cards.includes('## 第一页大标题'))

    const later = new Date(Date.now() + 60_000)
    await writeFile(join(xhs, '2026-06-16_Loop-Engineering_图片版.md'), `## 改过的首页\n\n${CARDS}`)
    await utimes(join(xhs, '2026-06-16_Loop-Engineering_图片版.md'), later, later)
    const rescan = await scanFolders({ dir: xhs }, { home })
    assert.equal(previewImport(await store.read(), rescan).pieces[0].relation, 'update')
    const updated = await store.mutate('重新导入', draft => importScans(draft, rescan))
    assert.equal(updated.updated, 1)
    state = await store.read()
    assert.ok(versionOf(state.items[0]).cards.startsWith('## 改过的首页'))
    assert.equal(state.items[0].id, id)

    // 在工作台改了小红书版本：文件再变也不覆盖
    await store.mutate('改版本', draft => { versionOf(draft.items[0]).body = '我自己改的'; return draft })
    assert.equal(isEdited((await store.read()).items[0]), true)
    const latest = new Date(Date.now() + 120_000)
    await utimes(join(xhs, '2026-06-16_Loop-Engineering.md'), latest, latest)
    const skipped = await store.mutate('再导', async draft => importScans(draft, await scanFolders({ dir: xhs }, { home })))
    assert.equal(skipped.edited.length, 1)
    assert.equal(versionOf((await store.read()).items[0]).body, '我自己改的')
  } finally {
    await cleanup()
  }
})

test('Obsidian 图片 ![[图.png]]：稿子旁边、imgs/、assets/、attachments/ 里找得到才换；只放行被导入稿子引用的', async () => {
  const { realpath } = await import('node:fs/promises')
  const { homedir } = await import('node:os')
  const root = await realpath(await mkdtemp(join(homedir(), '.md-embed-test-')))
  try {
    const notes = join(root, '小红书')
    await files(notes, [['next.png', 'x'], ['imgs/in-imgs.png', 'x'], ['assets/in-assets.jpg', 'x'], ['attachments/sub/deep.webp', 'x'], ['unused.png', 'x']])
    await writeFile(join(root, 'outside.png'), 'x')
    const note = join(notes, 'post.md')
    const body = linkLocalImages('![[next.png]] ![[in-imgs.png|300]] ![[in-assets.jpg|封面]] ![[sub/deep.webp]] ![[missing.png]] ![[../outside.png]] ![[画板.excalidraw]]', note, notes)
    const srcs = [...body.matchAll(/!\[([^\]]*)\]\((media-desk\/imported\/[^)]+)\)/g)].map(m => [m[1], m[2]])
    assert.equal(srcs.length, 4)
    assert.equal(srcs[1][0], '', '纯数字的尺寸不当说明')
    assert.equal(srcs[2][0], '封面')
    assert.ok(body.includes('![[missing.png]]') && body.includes('![[../outside.png]]') && body.includes('![[画板.excalidraw]]'), '找不到的、文件夹外面的、不是图片的原样留着')
    const name = src => src.slice('media-desk/imported/'.length)
    // 引用只在小红书版本的图片版里也算
    const state = { importDirs: [{ dir: notes }], items: [{ imported: true, importPath: note, body: '', production: { article: '', versions: { 小红书: { body: '', cards: body } } } }] }
    assert.equal(await allowedImportedImage(state, name(srcs[0][1])), join(notes, 'next.png'))
    assert.equal(await allowedImportedImage(state, name(srcs[3][1])), join(notes, 'attachments', 'sub', 'deep.webp'))
    assert.equal(await allowedImportedImage({ ...state, items: [] }, name(srcs[0][1])), null)
    // 扫描时一样换：图片放在导入文件夹的 imgs/ 里
    await writeFile(note, `## 带图的稿子\n![[in-imgs.png]]\n${LONG}`)
    const scanned = await scanFolder(notes, { home: root })
    assert.match(scanned.files[0].body, /!\[\]\(media-desk\/imported\/[\w-]+\.png\)/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
