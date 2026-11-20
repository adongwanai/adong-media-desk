import assert from 'node:assert/strict'
import test from 'node:test'
import { looksLikeNotePath, parseCapture } from '../client/capture-text.js'
import { fuzzyFilter, fuzzyScore } from '../client/fuzzy.js'

test('parseCapture：#标签 拿出来，正文去掉标签，重复的标签只留一个', () => {
  assert.deepEqual(parseCapture('#AI 今天看到一个好角度 #选题 #AI'), { text: '今天看到一个好角度', tags: ['AI', '选题'], url: null })
  assert.deepEqual(parseCapture('标题党不长久#观点'), { text: '标题党不长久#观点', tags: [], url: null })
  assert.deepEqual(parseCapture('# 这是一行标题'), { text: '# 这是一行标题', tags: [], url: null })
})

test('parseCapture：单独一个 http(s) 网址按链接收藏，网址里的 #片段 不当标签', () => {
  assert.deepEqual(parseCapture('  https://example.com/a#part  '), { text: 'https://example.com/a#part', tags: [], url: 'https://example.com/a#part' })
  assert.deepEqual(parseCapture('https://example.com/post #AI #读书'), { text: 'https://example.com/post', tags: ['AI', '读书'], url: 'https://example.com/post' })
  assert.equal(parseCapture('看看这个 https://example.com').url, null)
  assert.equal(parseCapture('ftp://example.com/file').url, null)
  assert.equal(parseCapture('https://a.com https://b.com').url, null)
})

test('parseCapture：只有标签时把原文当正文，不会记成空灵感', () => {
  assert.deepEqual(parseCapture('#AI #选题'), { text: '#AI #选题', tags: [], url: null })
  assert.deepEqual(parseCapture(''), { text: '', tags: [], url: null })
})

test('fuzzyScore：连续命中高于隔字命中，没命中是 -1，空查询都算命中', () => {
  assert.ok(fuzzyScore('设置', '打开设置') > fuzzyScore('开置', '打开设置'))
  assert.ok(fuzzyScore('开置', '打开设置') > 0)
  assert.equal(fuzzyScore('置开', '打开设置'), -1)
  assert.equal(fuzzyScore('', '随便'), 0)
  assert.ok(fuzzyScore('go board', 'Go to Dashboard board') > 0)
  assert.equal(fuzzyScore('go xyz', 'Go to Dashboard'), -1)
})

test('fuzzyFilter：按分数排，同分保持原顺序', () => {
  const rows = ['前往「内容」', '前往「信息源」', '重新抓取信息源', '打开设置']
  assert.deepEqual(fuzzyFilter(rows, '信息源', row => row), ['前往「信息源」', '重新抓取信息源'])
  assert.deepEqual(fuzzyFilter(rows, '', row => row), rows)
  assert.deepEqual(fuzzyFilter(rows, 'ZZ', row => row), [])
})

test('looksLikeNotePath：整段就是一个本地文本稿路径才算，带别的字、别的后缀都不算', () => {
  assert.equal(looksLikeNotePath('/Users/example/Documents/tmp/001.md'), true)
  assert.equal(looksLikeNotePath('  ~/notes/选题.markdown '), true)
  assert.equal(looksLikeNotePath('./draft.txt'), true)
  assert.equal(looksLikeNotePath('/Users/example/tmp/001.md 写一篇笔记'), false)
  assert.equal(looksLikeNotePath('/Users/example/tmp/cover.png'), false)
  assert.equal(looksLikeNotePath('想到一个选题'), false)
})
