// 「怎么用」面板的内容：按真实要做的事排的几条路，每步一句话，配一个「带我去」。
// 文字是中文原文（界面里再过 t() 翻译）；go 说明「带我去」去哪：
//   { view }                    跳到某一页（PAGES 里的 id）
//   { view: 'video', tab }      跳到视频页的某一步
//   { do: 'capture' }           打开记灵感的小窗
//   { do: 'import' }            打开「导入文件夹」
//   { do: 'author' }            打开作者信息（署名）
//   { do: 'income' }            到大屏，打开「记一笔收入」，默认关联最近一篇成稿
//   { do: 'piece', layout }     打开最近一篇成稿，停在某个视图（平台版本、图文卡片）
// 文字里的 {keys} 换成记灵感的快捷键（按系统显示 ⌘ 或 Ctrl）。

export const GUIDE_ACTIONS = ['capture', 'import', 'author', 'income', 'piece']
// 成稿页的视图，和 studio.jsx 的 SHEET_VIEWS 一致
export const SHEET_LAYOUTS = ['draft', 'wechat', 'xhs', 'spoken', 'versions']

export const GUIDE_PATHS = [
  {
    id: 'sponsored',
    icon: 'briefcase',
    title: '接了一篇推广笔记',
    hint: '从记下需求到收钱、看数据',
    steps: [
      { text: '先把品牌方的要求记成一条灵感：要点、交稿时间、链接都行。在 DeepSeek Harness 里随时按 {keys} 就能记。', go: { do: 'capture' } },
      { text: '到「灵感」打开选题，点「生成小红书图文」。自动按写作规则生成正文并排成卡片，素材和风格可按需补充。', go: { view: 'home' } },
      { text: '成稿后切到「平台版本」，勾上小红书生成：笔记正文和图片版的卡片文字一起写好。', go: { do: 'piece', layout: 'versions' } },
      { text: '切到「图文卡片」挑主题和封面，点「导出全部 ZIP」。正文太长时，它会提示改用小红书版本的图片版。', go: { do: 'piece', layout: 'xhs' } },
      { text: '到「发布」页，点这篇的小红书，再点「去发布」：内容复制好，发布页也打开了。发完回来点「标记已发布」，贴上链接。', go: { view: 'publish' } },
      { text: '钱到账了，在「大屏」右边的收入格点「记一笔」，选上是哪篇内容带来的。', go: { do: 'income' } },
      { text: '登录过创作后台的话数据每天自动更新，过几天到「复盘」看这篇的阅读和互动。', go: { view: 'insights' } },
    ],
  },
  {
    id: 'hot',
    icon: 'trend',
    title: '看到一条热点想写',
    hint: '从热榜到多平台发出去',
    steps: [
      { text: '到「信息源」，「热榜」里是今天大家在聊的，「订阅」里是你关注的博客和资讯。看中哪条就点「记为灵感」。', go: { view: 'sources' } },
      { text: '到「灵感」打开选题，补充可信素材，点「生成小红书图文」，写完后核对事实。', go: { view: 'home' } },
      { text: '切到「平台版本」，把要发的平台都勾上一起生成，每个平台的长度和语气各写一版。', go: { do: 'piece', layout: 'versions' } },
      { text: '想定个发的时间，到「排期」把它拖到日历上。', go: { view: 'schedule' } },
      { text: '到「发布」页一个平台一个平台去发，发完点「标记已发布」。', go: { view: 'publish' } },
    ],
  },
  {
    id: 'import',
    icon: 'folder',
    title: '把旧稿搬进来',
    hint: '让写出来的像你',
    steps: [
      { text: '在「内容」页点「导入文件夹」，贴上放 Markdown 稿子的文件夹路径，Obsidian 的库也行。', go: { do: 'import' } },
      { text: '先点「预览」，看清会导入哪些、重复的留哪份，再导入。只读文件，不会改动原文件。', go: { do: 'import' } },
      { text: '到「写作风格」挑一个最像你的，之后成稿都照它写。', go: { view: 'style' } },
      { text: '填上署名和一句话介绍，长文结尾会署上你的名字。', go: { do: 'author' } },
    ],
  },
  {
    id: 'morning',
    icon: 'clock',
    title: '每天早上看什么',
    hint: '五分钟过一遍',
    steps: [
      { text: '先看「大屏」：各平台的粉丝数自动更新，最新发布的那篇和它的数据在左上，右边是今天和这个月的收入。没读到的点「更新数据」再读一次。', go: { view: 'board' } },
      { text: '到「灵感」看「今日回顾」：挑出几条放了很久的灵感，拿去成稿，或者先不再提。', go: { view: 'home' } },
      { text: '到「发布」页筛「待发布」，看还有哪些成稿没发出去。', go: { view: 'publish' } },
      { text: '想找新选题，去「信息源」扫一眼热榜。', go: { view: 'sources' } },
    ],
  },
  {
    id: 'video',
    icon: 'film',
    title: '做一条口播视频',
    hint: '一篇成稿，六步出片',
    steps: [
      { text: '打开成稿的「口播内容」，改写或粘贴口播稿，点「导入视频工作台」。原正文会保留。', go: { view: 'home' } },
      { text: '到「视频」页，点左上角的标题换成要做的那篇。「稿子」里调语速和目标时长，逐句改到念着顺。', go: { view: 'video', tab: 'script' } },
      { text: '「录制」：打开摄像头或者录屏，跟着提词念。手机拍好的也能直接上传。', go: { view: 'video', tab: 'record' } },
      { text: '「粗剪」找出说话之间的停顿，一键去掉；「字幕」按口播稿生成，对一下时间。', go: { view: 'video', tab: 'cut' } },
      { text: '「成片」挑一个剪辑模板，套在录像或者这篇的图文上，改改字，渲染成一条视频。', go: { view: 'video', tab: 'finish' } },
      { text: '「发布包」把标题、口播稿、封面、视频和字幕文件一次下载，到各平台后台自己上传。', go: { view: 'video', tab: 'pack' } },
    ],
  },
]

/** 本地记住的东西：看过没有、上次走到哪条路第几步。读不到就当第一次。 */
const MEMO_KEY = 'md-guide'

export function readGuideMemo(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(MEMO_KEY) ?? 'null')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export function writeGuideMemo(patch, storage = globalThis.localStorage) {
  try {
    storage?.setItem(MEMO_KEY, JSON.stringify({ ...readGuideMemo(storage), ...patch }))
  } catch {
    // 隐私模式下存不了：这次打开里照常用，下次还会自动出现一次
  }
}
