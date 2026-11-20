import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderWechat } from '../client/layouts/wechat.js'
import { hasText, sanitizeArticleHtml, sanitizeStyle } from '../src/sanitize.js'

const ALLOWED_TAGS = new Set(['section', 'p', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'span', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'a'])

/** 清洗结果里每个标签和属性都必须在白名单里。 */
function assertClean(html) {
  for (const match of html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)) {
    assert.ok(ALLOWED_TAGS.has(match[1]), `tag ${match[1]} in ${html}`)
    const attrs = [...match[2].matchAll(/\s([^\s=]+)=/g)].map(row => row[1])
    for (const attr of attrs) assert.ok(attr === 'style' || (attr === 'href' && match[1] === 'a'), `attr ${attr} in ${html}`)
  }
  assert.doesNotMatch(html, /javascript:|vbscript:|data:|expression|url\(|@import|<script|onerror|onclick|onload|srcdoc/i)
}

test('sanitizeArticleHtml：脚本、事件属性、危险标签和链接全部去掉', () => {
  const hostile = [
    '<p onclick="alert(1)" style="color:red">正文<script>alert(1)</script></p>',
    '<img src=x onerror=alert(1)>',
    '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<a href="javascript:alert(1)">坏链接</a>',
    '<a href="&#106;avascript:alert(1)">实体绕过</a>',
    '<a href=" JaVaScRiPt:alert(1)">大小写</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">data</a>',
    '<a href="https://example.com/ok" target="_blank" onclick="x()">好链接</a>',
    '<style>body{background:url(javascript:alert(1))}</style>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<div><p>外壳 div 去掉，文字留下</p></div>',
    '<!-- <script>alert(1)</script> -->',
    '<![CDATA[<script>alert(1)</script>]]>',
    '<p style="background:url(https://evil/x.png)">背景图</p>',
    '<p style="width: expression(alert(1))">IE 表达式</p>',
    '<p style="color: red; @import \'x\'">导入</p>',
    '<p style="color:\\72 ed">转义</p>',
    '<p style="color: red /* */; position: fixed; z-index: 9999">注释和定位</p>',
    '<form action="https://evil"><input name=x><button>提交</button></form>',
    '<object data="x"></object><embed src="x"><base href="https://evil/">',
    '<<script>script>alert(1)<</script>/script>',
    '<p>1 < 2 && 3 > 2</p>',
    '<sCrIpT>alert(1)</ScRiPt><p>后面的字</p>',
    '<p style="behavior: url(x.htc)">htc</p>',
    '<span style="font-family:&quot;x&quot;;color:red">实体引号</span>',
  ]
  // 每段单独洗一遍，再整串洗一遍（没闭合的 <style> 会吞掉后面全部内容，这也是安全的）
  for (const piece of hostile) assertClean(sanitizeArticleHtml(piece))
  assertClean(sanitizeArticleHtml(hostile.join('')))
  const clean = hostile.filter(piece => !piece.startsWith('<math>')).map(sanitizeArticleHtml).join('')
  assert.match(clean, /<a href="https:\/\/example\.com\/ok">好链接<\/a>/)
  assert.match(clean, /坏链接/)
  assert.match(clean, /外壳 div 去掉，文字留下/)
  assert.match(clean, /1 &lt; 2 &amp;&amp; 3 &gt; 2/)
  assert.match(clean, /后面的字/)
  assert.doesNotMatch(clean, /position|z-index|fixed/)
  assert.match(clean, /<p style="color: red">正文<\/p>/)
})

test('sanitizeArticleHtml：标签自动补齐，多余的闭合标签丢掉，嵌套有上限', () => {
  assert.equal(sanitizeArticleHtml('<p><strong>没闭合'), '<p><strong>没闭合</strong></p>')
  assert.equal(sanitizeArticleHtml('</p></section>文字<p>段</em></p>'), '文字<p>段</p>')
  assert.equal(sanitizeArticleHtml('<br/><hr style="border:0"><br>'), '<br><hr style="border: 0"><br>')
  const deep = sanitizeArticleHtml(`${'<span>'.repeat(500)}x${'</span>'.repeat(500)}`)
  assert.ok((deep.match(/<span>/g) ?? []).length <= 64)
  // 很长的坏标签不会卡住
  const started = Date.now()
  sanitizeArticleHtml(`<p ${'a=b/'.repeat(20000)}`)
  sanitizeArticleHtml(`<p${' x'.repeat(50000)}`)
  assert.ok(Date.now() - started < 2000)
})

test('sanitizeArticleHtml：mark/b/i 换成白名单写法，样式保留', () => {
  assert.equal(sanitizeArticleHtml('<mark style="background-color:#ff0">高亮</mark><b>粗</b><i>斜</i>'), '<span style="background-color: #ff0">高亮</span><strong>粗</strong><em>斜</em>')
})

test('sanitizeStyle：只留白名单属性，渐变可以，url() 和未知函数不行', () => {
  assert.equal(sanitizeStyle('color: #333; font-size: 16px; position: absolute; cursor: pointer'), 'color: #333; font-size: 16px')
  assert.equal(sanitizeStyle('background-image: linear-gradient(90deg, rgba(0,0,0,.1), transparent)'), 'background-image: linear-gradient(90deg, rgba(0,0,0,.1), transparent)')
  assert.equal(sanitizeStyle('background-image: url(x)'), '')
  assert.equal(sanitizeStyle('background-image: image-set("x.png" 1x)'), '')
  assert.equal(sanitizeStyle('width: env(safe-area-inset-left)'), '')
  assert.equal(sanitizeStyle('display: none; color: red'), 'color: red')
  assert.equal(sanitizeStyle('font-family: "PingFang SC", \'微软雅黑\', serif; color: red'), 'font-family: "PingFang SC", \'微软雅黑\', serif; color: red')
  // 引号里藏分号的整条不要
  assert.equal(sanitizeStyle('font-family: "a;b", serif; color: red'), 'color: red')
  assert.equal(sanitizeStyle('color: red"; x'), '')
})

test('sanitizeArticleHtml：言起主题排出来的正文洗完后样式基本不变', () => {
  const html = renderWechat('## 小标题\n\n段落 **加粗** ==高亮== `code`\n\n> 引用\n\n- 一\n- 二\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---')
  const clean = sanitizeArticleHtml(html)
  assertClean(clean)
  assert.ok(hasText(clean))
  assert.equal((clean.match(/<h2/g) ?? []).length, (html.match(/<h2/g) ?? []).length)
  assert.equal((clean.match(/style="/g) ?? []).length, (html.match(/style="/g) ?? []).length)
  assert.ok(!hasText('<p> </p><br>'))
})
