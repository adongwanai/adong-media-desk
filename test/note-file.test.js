import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { looksLikePath, noteTags, noteTitle, readNoteFile, splitFrontMatter } from '../src/note-file.js'

test('什么样的文字算本地文本稿路径', () => {
  assert.equal(looksLikePath('/Users/example/Documents/tmp/001.md'), true)
  assert.equal(looksLikePath('  ~/notes/选题.md '), true)
  assert.equal(looksLikePath('./draft.markdown'), true)
  assert.equal(looksLikePath('C:\\notes\\draft.txt'), true)
  assert.equal(looksLikePath('/Users/example/tmp/001.md 写一篇笔记'), false)
  assert.equal(looksLikePath('/Users/example/tmp/001.md\n第二行'), false)
  assert.equal(looksLikePath('/Users/example/tmp/cover.png'), false)
  assert.equal(looksLikePath('想到一个选题'), false)
})

test('标题和标签：YAML 头优先，其次一级标题，再次第一段', () => {
  assert.deepEqual(splitFrontMatter('---\ntitle: 测试\n---\n正文'), { head: 'title: 测试', body: '正文' })
  assert.equal(noteTitle('title: "带引号的标题"', '正文'), '带引号的标题')
  assert.equal(noteTitle('', '# 一级标题\n\n正文'), '一级标题')
  assert.equal(noteTitle('', '**加粗的第一段**\n第二段'), '加粗的第一段')
  // 正文最前面那行是标题，后面的 ### 只是小标题，不能拿它当篇名
  assert.equal(noteTitle('', '**建议本硕博都去做benchmark**\n\n开头。\n\n### 为什么本硕博都该碰？\n正文'), '建议本硕博都去做benchmark')
  // 一上来就是标题（没有别的文字）时，用这个标题
  assert.equal(noteTitle('', '## 直接开头的小标题\n正文'), '直接开头的小标题')
  // 第一行太长（是正文段落），篇名退回第一个小标题
  assert.equal(noteTitle('', '这一行是一段很长的正文说明，长度明显超过六十个字，不能被当成篇名来用，否则标题会变成一整段话。\n\n## 真正的篇名\n正文'), '真正的篇名')
  assert.equal(noteTitle('', ''), '')
  assert.deepEqual(noteTags('tags: [AI, Agent]'), ['AI', 'Agent'])
  assert.deepEqual(noteTags('标签: 个人IP, 自媒体'), ['个人IP', '自媒体'])
  assert.deepEqual(noteTags(''), [])
})

test('读真实文件：去掉 YAML 头，正文原样，字数对', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-note-'))
  try {
    const file = join(dir, '001.md')
    await writeFile(file, '---\ntitle: 建议本硕博都去做benchmark\ntags: [benchmark]\n---\n\n第一段。\n\n第二段。\n', 'utf8')
    const note = await readNoteFile(file)
    assert.equal(note.title, '建议本硕博都去做benchmark')
    assert.deepEqual(note.tags, ['benchmark'])
    assert.equal(note.body, '第一段。\n\n第二段。')
    assert.equal(note.chars, note.body.length)
    // 路径前后有空格、或者用 ~ 开头的写法也要认
    await assert.rejects(readNoteFile(join(dir, 'nope.md')), /找不到这个文件/)
    await assert.rejects(readNoteFile('随便一句话'), /不是 Markdown/)
    await writeFile(join(dir, 'empty.md'), '---\ntitle: 空\n---\n', 'utf8')
    await assert.rejects(readNoteFile(join(dir, 'empty.md')), /没有正文/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
