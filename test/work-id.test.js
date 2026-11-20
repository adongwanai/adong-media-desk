// 作品 ID：各平台链接和页面文字的写法各取一个样本，认得出是这条作品的 ID，认不出的不猜。
// 这些链接是照 2026-11 各平台公开页面的地址格式手写的（不带账号信息），不是从某个账号抓的。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { cleanWorkId, platformOfUrl, workIdFromText, workIdFromUrl, workIdOf } from '../src/work-id.js'

// 每个平台一条链接样本，放在一个文件里，和链接一起记下期望的 ID
const SAMPLE = JSON.parse(readFileSync(new URL('./fixtures/work-links.json', import.meta.url), 'utf8'))

test('workIdFromUrl：每个平台的链接取到自己的 ID（B 站 bvid、小红书 noteId、抖音 aweme_id、公众号 article id、视频号、YouTube、X）', () => {
  for (const [platform, { url, id }] of Object.entries(SAMPLE)) {
    assert.equal(platformOfUrl(url), platform, url)
    assert.equal(workIdFromUrl(url), id, url)
    assert.equal(workIdFromUrl(url, platform), id, url)
  }
})

test('workIdFromUrl：给了平台就按那个平台的正则；没给就按主机名判断；认不出的是 null', () => {
  assert.equal(workIdFromUrl('https://www.bilibili.com/video/BV1GJ411x7h7/?spm=1', 'B站'), 'BV1GJ411x7h7')
  assert.equal(workIdFromUrl('https://www.bilibili.com/video/BV1GJ411x7h7'), 'BV1GJ411x7h7')
  // 平台给错了：按给的那个平台的正则，取不到就是 null
  assert.equal(workIdFromUrl('https://www.bilibili.com/video/BV1GJ411x7h7', '小红书'), null)
  // 主机名认不出平台时，给了平台也照样按那个平台的正则取
  assert.equal(workIdFromUrl('https://example.com/status/1856789012345678901', 'X'), '1856789012345678901')
  for (const bad of ['', 'not a url', 'https://example.com/video/1', 'https://x.com/home', 'https://www.youtube.com/channel/UC123']) assert.equal(workIdFromUrl(bad, 'B站'), null, bad)
})

test('workIdOf：从页面文字里取 ID，标题改过、旁边有别的内容也认得出来', () => {
  assert.equal(workIdOf('B站', 'av123 已失效，改用 BV1GJ411x7h7 观看'), 'BV1GJ411x7h7')
  assert.equal(workIdOf('小红书', '笔记链接 https://www.xiaohongshu.com/explore/65f0c1a2000000000b00a1b2?xsec_token=abc'), '65f0c1a2000000000b00a1b2')
  assert.equal(workIdOf('抖音', 'https://www.douyin.com/video/7305123456789012345'), '7305123456789012345')
  assert.equal(workIdOf('抖音', 'https://www.douyin.com/?aweme_id=7305123456789012345'), '7305123456789012345')
  assert.equal(workIdOf('公众号', 'https://mp.weixin.qq.com/s?__biz=MzA1&mid=2247483651&idx=1&sn=abc'), '2247483651')
  assert.equal(workIdOf('视频号', 'https://channels.weixin.qq.com/platform/post/detail?feed_id=1420abcdef'), '1420abcdef')
  assert.equal(workIdOf('YouTube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1s'), 'dQw4w9WgXcQ')
  assert.equal(workIdOf('YouTube', 'https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(workIdOf('X', 'https://x.com/example/status/1856789012345678901'), '1856789012345678901')
  assert.equal(workIdOf('X', 'https://twitter.com/example/status/1856789012345678901'), '1856789012345678901')
  assert.equal(workIdOf('小红书', '标题里没有编号'), null)
})

test('workIdFromText：表里的一格给纯 ID、链接、或带链接的一段话都行；没给平台时先按链接的主机名认', () => {
  assert.equal(workIdFromText('BV1GJ411x7h7'), 'BV1GJ411x7h7')
  assert.equal(workIdFromText('https://www.xiaohongshu.com/discovery/item/65f0c1a2000000000b00a1b2'), '65f0c1a2000000000b00a1b2')
  assert.equal(workIdFromText('看看这条 https://www.douyin.com/video/7305123456789012345 挺有意思'), '7305123456789012345')
  assert.equal(workIdFromText('https://www.bilibili.com/video/BV1GJ411x7h7'), 'BV1GJ411x7h7')
  // 公众号的地址里没有主机名可依据以外的东西：给了平台才认
  assert.equal(workIdFromText('https://mp.weixin.qq.com/s?mid=2247483651', '公众号'), '2247483651')
  assert.equal(workIdFromText('', null), null)
  assert.equal(workIdFromText('随便一段话'), null)
})

test('cleanWorkId：只收字母、数字、下划线、连字符，1–80 个字符；别的不猜、不截断', () => {
  assert.equal(cleanWorkId(' BV1GJ411x7h7 '), 'BV1GJ411x7h7')
  assert.equal(cleanWorkId('65f0c1a2000000000b00a1b2'), '65f0c1a2000000000b00a1b2')
  assert.equal(cleanWorkId('a_b-C9'), 'a_b-C9')
  assert.equal(cleanWorkId('a'.repeat(80)), 'a'.repeat(80))
  for (const bad of ['', null, undefined, 'a'.repeat(81), '含中文', 'a b', 'https://x.com/status/1', 'a/b']) assert.equal(cleanWorkId(bad), null, String(bad))
})
