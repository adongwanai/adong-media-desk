import assert from 'node:assert/strict'
import test from 'node:test'
import { markdownPlain, renderInline, renderMarkdown, safeHref, safeImageSrc, splitForPreview, stripFrontmatter } from '../client/md-render.js'

test('renderMarkdown：标题、段落、加粗斜体、高亮、删除线、行内代码', () => {
  const html = renderMarkdown('# 大标题\n\n## 小节\n\n一段**重点**和*语气*，==记住这句==，~~删掉~~，`npm test`。\n第二行')
  assert.match(html, /<h1>大标题<\/h1>/)
  assert.match(html, /<h2>小节<\/h2>/)
  assert.match(html, /<strong>重点<\/strong>/)
  assert.match(html, /<em>语气<\/em>/)
  assert.match(html, /<mark>记住这句<\/mark>/)
  assert.match(html, /<del>删掉<\/del>/)
  assert.match(html, /<code>npm test<\/code>/)
  assert.match(html, /。<br>第二行<\/p>/)
})

test('renderMarkdown：列表可以嵌套，有序列表保留起始编号，任务列表有勾选标记', () => {
  const html = renderMarkdown('- 第一条\n  - 子项 A\n  - 子项 B\n- 第二条\n\n3. 第三步\n4. 第四步\n\n- [x] 做完了\n- [ ] 还没做')
  assert.match(html, /<ul><li>第一条<ul><li>子项 A<\/li><li>子项 B<\/li><\/ul><\/li><li>第二条<\/li><\/ul>/)
  assert.match(html, /<ol start="3"><li>第三步<\/li><li>第四步<\/li><\/ol>/)
  assert.match(html, /<li class="is-task"><span class="md-read-task is-done" aria-hidden="true"><\/span>做完了<\/li>/)
  assert.match(html, /<li class="is-task"><span class="md-read-task" aria-hidden="true"><\/span>还没做<\/li>/)
})

test('renderMarkdown：引用、分割线、代码块、表格（带对齐）', () => {
  const html = renderMarkdown('> 引用第一行\n> - 引用里的列表\n\n---\n\n```js\nconst a = "<b>"\n```\n\n| 名字 | 数量 |\n|:---|---:|\n| 苹果 | 3 |\n| 梨 | |')
  assert.match(html, /<blockquote><p>引用第一行<\/p><ul><li>引用里的列表<\/li><\/ul><\/blockquote>/)
  assert.match(html, /<hr>/)
  assert.match(html, /<pre data-lang="js"><code>const a = &quot;&lt;b&gt;&quot;<\/code><\/pre>/)
  assert.match(html, /<div class="md-read-table"><table><thead><tr><th style="text-align:left|<th>名字/)
  assert.match(html, /<td style="text-align:right">3<\/td>/)
  assert.match(html, /<td style="text-align:right"><\/td>/)
})

test('renderMarkdown：远程图片、工作台图片能显示，本地相对路径显示成说明', () => {
  const html = renderMarkdown('![流程图](https://example.com/a.png)\n\n![](media-desk/files/f_1.png)\n\n![架构](imgs/arch.png)', { missingImage: '本地图片' })
  assert.match(html, /<figure><img src="https:\/\/example\.com\/a\.png" alt="流程图" loading="lazy" decoding="async" referrerpolicy="no-referrer"><figcaption>流程图<\/figcaption><\/figure>/)
  assert.match(html, /<img src="media-desk\/files\/f_1\.png" alt=""/)
  assert.match(html, /<span class="md-read-noimg" title="imgs\/arch\.png">架构<small>本地图片<\/small><\/span>/)
  assert.ok(!/src="imgs/.test(html))
})

test('renderMarkdown：链接在新标签打开并带 noopener，裸链接也能点', () => {
  const html = renderMarkdown('看 [仓库](https://github.com/x/y) 和 https://example.com/path。')
  assert.match(html, /<a href="https:\/\/github\.com\/x\/y" target="_blank" rel="noopener noreferrer">仓库<\/a>/)
  assert.match(html, /<a href="https:\/\/example\.com\/path" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/path<\/a>。/)
})

test('renderMarkdown：恶意输入一律转义，不产生可执行的标签、属性和链接', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[点我](javascript:alert(1))',
    '[点我](JaVaScRiPt:alert(1))',
    '[点我](data:text/html;base64,PHNjcmlwdD4=)',
    '![x](javascript:alert(1))',
    '![x](https://e.com/a.png"onerror="alert(1))',
    '[x](https://e.com/"onmouseover="alert(1))',
    '**<svg onload=alert(1)>**',
    '| <iframe src=x> | b |\n|---|---|\n| <script>c</script> | d |',
    '> <a href="javascript:1">q</a>',
    '```\n</code></pre><script>alert(1)</script>\n```',
    '<https://e.com/"><script>x</script>>',
  ].join('\n\n')
  const html = renderMarkdown(hostile)
  assert.ok(!/<script/i.test(html), 'script 标签')
  assert.ok(!/<img[^>]*onerror/i.test(html), 'onerror 属性')
  assert.ok(!/<(svg|iframe)/i.test(html), 'svg / iframe 标签')
  assert.ok(!/href="(javascript|data):/i.test(html), '危险链接')
  assert.ok(!/src="javascript:/i.test(html), '危险图片地址')
  assert.ok(!/\son\w+="/i.test(html.replace(/&quot;/g, '')), '事件属性')
  // 每个生成的标签都在白名单里
  const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[1].toLowerCase())
  const allowed = new Set(['p', 'br', 'strong', 'em', 'mark', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'figure', 'figcaption', 'img', 'a', 'span', 'small', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td'])
  for (const tag of tags) assert.ok(allowed.has(tag), `不认识的标签 ${tag}`)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('safeHref / safeImageSrc：只放行白名单协议和工作台路径', () => {
  assert.equal(safeHref('https://a.com'), 'https://a.com')
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c')
  assert.equal(safeHref(' javascript:alert(1)'), null)
  assert.equal(safeHref('//evil.com'), null)
  assert.equal(safeHref('/relative'), null)
  assert.equal(safeImageSrc('http://a.com/x.png'), 'http://a.com/x.png')
  assert.equal(safeImageSrc('media-desk/files/a.png'), 'media-desk/files/a.png')
  assert.equal(safeImageSrc('/media-desk/files/a.png'), '/media-desk/files/a.png')
  assert.equal(safeImageSrc('media-desk/../../etc/passwd'), null)
  assert.equal(safeImageSrc('data:image/svg+xml,<svg onload=1>'), null)
  assert.equal(safeImageSrc('file:///etc/passwd'), null)
  assert.equal(safeImageSrc('imgs/a.png'), null)
})

test('stripFrontmatter：去掉开头的 YAML 头，正文里的分割线不受影响', () => {
  assert.equal(stripFrontmatter('---\ntitle: 测试\ntags:\n  - a\n---\n\n正文'), '正文')
  assert.equal(renderMarkdown('---\ntitle: 测试\ntype: content\n---\n# 标题'), '<h1>标题</h1>')
  // 开头就是分割线，后面没有 key: value，不当成头信息
  assert.equal(stripFrontmatter('---\n\n一段话\n\n---\n结尾'), '---\n\n一段话\n\n---\n结尾')
})

test('renderMarkdown：dropTitle 去掉和成稿标题重复的开头一级标题', () => {
  assert.equal(renderMarkdown('# 同一个标题\n\n正文', { dropTitle: '同一个 标题' }), '<p>正文</p>')
  assert.equal(renderMarkdown('# 别的标题\n\n正文', { dropTitle: '同一个标题' }), '<h1>别的标题</h1><p>正文</p>')
})

test('splitForPreview：长稿在空行处切开，不切进代码块', () => {
  const para = '字'.repeat(100)
  const long = Array.from({ length: 30 }, () => para).join('\n\n')
  const { head, rest } = splitForPreview(long, 1000)
  assert.ok(head.length >= 1000 && head.length < 1300)
  assert.equal(`${head}\n\n${rest}`, long)
  const fenced = `${'甲'.repeat(50)}\n\n\`\`\`\n${'a\n\n'.repeat(20)}\`\`\`\n\n尾巴`
  const cut = splitForPreview(fenced, 60)
  assert.ok(cut.head.trimEnd().endsWith('```'), cut.head)
  assert.deepEqual(splitForPreview('短稿', 100), { head: '短稿', rest: '' })
})

test('markdownPlain：数字数时不算记号和链接地址', () => {
  assert.equal(markdownPlain('## 标题\n\n- **重点** [链接](https://a.com/very/long)\n\n![图](x.png)').replace(/\s/g, ''), '标题重点链接图')
})

test('renderInline：长文本不会卡住（无灾难回溯）', () => {
  const started = Date.now()
  renderInline(`${'*'.repeat(5000)}${'=='.repeat(3000)}${'['.repeat(3000)}`)
  renderMarkdown(`${'- '.repeat(2000)}\n${'> '.repeat(2000)}x`)
  assert.ok(Date.now() - started < 1500)
})

test('renderMarkdown：表格里的 <br> 当换行，旁边的标签照样转义', () => {
  const html = renderMarkdown('| a |\n|---|\n| 第一行<br>第二行 <BR/> <b>粗</b> |')
  assert.match(html, /<td>第一行<br>第二行<br>&lt;b&gt;粗&lt;\/b&gt;<\/td>/)
})
