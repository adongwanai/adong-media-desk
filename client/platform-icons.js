// 平台图标：各平台自己的标志（来自 simple-icons），只用来标明数据属于哪个平台。
import { siBytedance, siBilibili, siGithub, siGooglescholar, siInstagram, siTiktok, siWechat, siX, siXiaohongshu, siYoutube, siZhihu } from 'simple-icons'

const mark = (icon, color = `#${icon.hex}`) => ({ path: icon.path, color })

// 抖音和 TikTok 是同一个标志；视频号没有单独收录，用微信标志配它的橙色；头条用字节跳动的标志配头条红
export const PLATFORM_ICON = {
  B站: mark(siBilibili), 抖音: mark(siTiktok, '#111111'), 小红书: mark(siXiaohongshu), 公众号: mark(siWechat), 视频号: mark(siWechat, '#FA9D3B'),
  知乎: mark(siZhihu), 头条: mark(siBytedance, '#F04142'), YouTube: mark(siYoutube), X: mark(siX, '#111111'), TikTok: mark(siTiktok, '#111111'), Instagram: mark(siInstagram),
  GitHub: mark(siGithub, '#24292F'), 谷歌学术: mark(siGooglescholar),
}
