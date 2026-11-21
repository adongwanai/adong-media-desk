// 把 client/ 打包成 DSH 的 lazy CommonJS 模块：react 留给宿主提供，CSS 内联成字符串。
import { build, context, transform } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { EN } from '../client/en/index.js'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const watching = process.argv.includes('--watch')
await writeFile(new URL('../assets/en.json', import.meta.url), JSON.stringify(EN))

// 生产构建把内联进 JS 的 CSS 注释与多余空白一并压缩，减少首屏包体积
const inlineMinifiedCss = {
  name: 'inline-minified-css',
  setup(b) {
    if (watching) return
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const raw = await readFile(args.path, 'utf8')
      const { code } = await transform(raw, { loader: 'css', minify: true, target: 'chrome120' })
      return { contents: code, loader: 'text' }
    })
  },
}

const options = {
  entryPoints: ['client/index.jsx'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react'],
  loader: { '.css': 'text' },
  plugins: [inlineMinifiedCss],
  minify: !watching,
  legalComments: 'none',
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;` },
  footer: { js: 'return module.exports}})' },
}

// 不装 DeepSeek Harness 也能跑的独立版：react 一起打进去，由 scripts/standalone.mjs 提供页面和接口
const standalone = {
  entryPoints: ['client/standalone.jsx'],
  outfile: 'dist/standalone.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  loader: { '.css': 'text' },
  plugins: [inlineMinifiedCss],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: !watching,
  // 独立版把 React 打进去了，它的版权声明要留着
  legalComments: 'eof',
}

if (process.argv.includes('--watch')) {
  const ctx = await context(options)
  await ctx.watch()
  await (await context(standalone)).watch()
  console.log('watching client/')
} else {
  const result = await build({ ...options, metafile: true })
  const size = Object.values(result.metafile.outputs)[0].bytes
  console.log(`dist/client.js ${(size / 1024).toFixed(1)} KB`)
  await build(standalone)
}
