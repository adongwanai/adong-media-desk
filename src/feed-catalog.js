// 一键源包：几个公开的 RSS / Atom 地址，用户在「订阅」页点一下才会加，不会自动订阅。
// 每个地址都在 2026-11-13 从这台电脑用 Node 实际请求过（走工作台自己的 readPage + parseFeed，底层是 net.js 的 safeFetch，不走系统代理），
// 也在真实的工作台里加上、抓取、再删掉过一遍，能读到条目才收进来。
// 当天没通过、没收进来的：Hugging Face 博客、Simon Willison、阮一峰的网络日志（8 秒内无响应）；
// Google AI 博客（五次里两次 8 秒内没读完，不稳定）；
// 36氪（返回的是拦截页）、机器之心（没有公开订阅地址）、Anthropic（官网没有 RSS，/rss.xml、/news/rss.xml 都是 404）；
// arXiv 的每日 RSS 当天是空的，改用 arXiv 公开查询接口返回的 Atom（按提交时间倒序）。

export const FEED_CATALOG_VERIFIED = '2026-11-13'

export const FEED_GROUPS = ['英文 · AI 官方', '英文 · 技术社区', '中文 · AI 与开发', '中文 · 科技与产品']

export const FEED_CATALOG = [
  { title: 'OpenAI News', url: 'https://openai.com/news/rss.xml', group: '英文 · AI 官方', note: 'OpenAI 官方新闻和发布' },
  { title: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', group: '英文 · AI 官方', note: 'Hugging Face 官方博客（国内需要代理）' },
  { title: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', group: '英文 · 技术社区', note: '大模型工程实践的一手记录（国内需要代理）' },
  { title: 'Hacker News 首页', url: 'https://hnrss.org/frontpage', group: '英文 · 技术社区', note: 'hnrss.org 转出的 HN 首页' },
  { title: 'GitHub Blog', url: 'https://github.blog/feed/', group: '英文 · 技术社区', note: 'GitHub 官方博客' },
  { title: 'arXiv cs.AI 最新论文', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20', group: '英文 · 技术社区', note: 'arXiv 人工智能分类，按提交时间最新 20 篇' },
  { title: '量子位', url: 'https://www.qbitai.com/feed', group: '中文 · AI 与开发', note: 'AI 资讯' },
  { title: 'InfoQ 中文', url: 'https://www.infoq.cn/feed', group: '中文 · AI 与开发', note: '软件开发和架构' },
  { title: '开源中国', url: 'https://www.oschina.net/news/rss', group: '中文 · AI 与开发', note: '开源项目和技术新闻' },
  { title: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', group: '中文 · AI 与开发', note: '科技爱好者周刊' },
  { title: '少数派', url: 'https://sspai.com/feed', group: '中文 · 科技与产品', note: '效率工具和数字生活' },
  { title: 'IT之家', url: 'https://www.ithome.com/rss/', group: '中文 · 科技与产品', note: '科技快讯' },
  { title: '极客公园', url: 'https://www.geekpark.net/rss', group: '中文 · 科技与产品', note: '科技产品和公司' },
  { title: '爱范儿', url: 'https://www.ifanr.com/feed', group: '中文 · 科技与产品', note: '消费科技和产品' },
]

// GitHub 项目的发布记录也是 Atom：只给格式，不替用户挑项目
export const GITHUB_RELEASES_PATTERN = 'https://github.com/OWNER/REPO/releases.atom'

// 内置信息源：不是 RSS，由 Host 里的小读取器（src/builtin.js）读公开 JSON。默认全关，用户打开哪组才读哪组。
// 2026-11-13 同样从这台电脑用 Node 实际请求过。
// 一手 · X 建设者 / 建设者播客：数据来自开源项目 follow-builders（MIT 许可，github.com/zarazhangrui/follow-builders）公开的 feed-x.json、feed-podcasts.json。
//   同目录的 feed-blogs.json 当天是空的（0 篇），没有收进来。
// 中文 AI 资讯：和作者本地日报流程同一个来源，ainav.cn 每天汇总的九家站点 JSON（ainav.cn/news/json/<站点>_<日期>.json），九家当天都能读到。
// 没收进来：Hugging Face Daily Papers（这台电脑不走代理时 huggingface.co 连不上）、Reddit 公开 JSON / RSS（同样连不上）、
//   r.jina.ai 这类网页转文字代理（会把用户在读什么发给第三方）。
export const BUILTIN_GROUPS = [
  { id: 'builders-x', name: '一手 · X 建设者', note: 'AI 建设者最近 24 小时在 X 上发的帖子', via: 'follow-builders（MIT）' },
  { id: 'builders-podcasts', name: '一手 · 建设者播客', note: 'AI 建设者常上的播客的最新一期', via: 'follow-builders（MIT）' },
  { id: 'hf-papers', name: '论文 · HF Daily Papers', note: 'Hugging Face 每日论文，按点赞排（国内需要代理）', via: 'huggingface.co' },
  { id: 'cn-ai', name: '中文 AI 资讯', note: '36氪、量子位、机器之心、智源社区、HelloGitHub、新智元、AIbase、IT之家、极客公园当天的 AI 相关文章', via: 'ainav.cn 每日汇总' },
]

/** 第一次打开时默认订好的源：开箱就有内容看，之后用户随时增删。 */
export const DEFAULT_FEED_URLS = ['https://openai.com/news/rss.xml', 'https://github.blog/feed/', 'https://simonwillison.net/atom/everything/', 'https://www.qbitai.com/feed', 'https://www.infoq.cn/feed', 'https://sspai.com/feed', 'https://www.ruanyifeng.com/blog/atom.xml']

export const BUILTIN_GROUP_IDS = BUILTIN_GROUPS.map(group => group.id)
