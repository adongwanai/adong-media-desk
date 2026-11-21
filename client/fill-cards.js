// 不开图片版对话框，把小红书图片版直接导出成 PNG：和图片版预览（layouts/cards-preview.jsx）同一套切页、排版和导出，
// 用的也是同样的排版选择、署名和这一篇的封面、图片调整（填到草稿时传给平台的就是用户在图片版里看到的那几张）。
import { cardToPng, inlineImage, measureFits } from './layouts/card-dom.js'
import { CARD_LABELS, applyCoverMode, cardContext, dedupeSectionHeadings, formatDate, isTemplateCover, numberPages, packPages, paginateSection, planSections, renderCard, sectionHeadings } from './layouts/cards.js'
import { parseBlocks } from './layouts/markdown.js'
import { imageKey } from './layouts/yanqi.js'
import { coverOf } from './version-flow.jsx'
import { t } from './i18n.js'

/** 图片版的媒体记忆键，和平台版本页的图片版一致。 */
export const cardsMediaKey = itemId => `${itemId}:小红书`

/**
 * 切页：返回排好的页和导出用的排版。
 * @param {{cards: string, title: string, prefs: object, signature: object, media: object, themes: object[]}} input
 */
export async function planCardPages({ cards, title, prefs, signature, media, themes }) {
  const cover = coverOf(cards, title)
  const article = cover.article
  const bgSrc = prefs.background?.src
  const coverSrc = media.cover?.image && isTemplateCover(prefs.cover) ? media.cover.image : null
  const srcs = [...new Set([...parseBlocks(article).filter(block => block.type === 'image').map(block => block.src), ...(coverSrc ? [coverSrc] : []), ...(bgSrc && !bgSrc.startsWith('data:') ? [bgSrc] : [])])]
  const images = new Map(await Promise.all(srcs.map(async src => [src, await inlineImage(src)])))
  const sectionsRaw = planSections(article, { title: cover.title, coverTitle: media.cover?.title ?? '', figures: [], resolveImage: src => images.get(src) ?? null, headingLevel: prefs.headingLevel })
  const background = bgSrc ? { ...prefs.background, src: bgSrc.startsWith('data:') ? bgSrc : images.get(bgSrc)?.src } : null
  const coverImage = coverSrc && images.get(coverSrc) ? { ...images.get(coverSrc), key: imageKey(coverSrc) } : null
  const ctx = cardContext(prefs, signature, {
    date: formatDate(new Date(), signature.timeFormat),
    labels: Object.fromEntries(Object.entries(CARD_LABELS).map(([key, text]) => [key, t(text)])),
    themes,
    images: media.images,
    tables: media.tables,
    background,
    lines: true,
    cover: { ...media.cover, image: coverImage },
    article,
    headings: sectionHeadings(sectionsRaw),
  })
  // 量高度前等字体就位，不然切页和预览里不一样
  await document.fonts?.ready
  const fits = page => measureFits(page, ctx)
  const rawPages = dedupeSectionHeadings(applyCoverMode(sectionsRaw, ctx.cover, Boolean(prefs.coverOnly)))
    .flatMap(section => paginateSection(section, fits, { repeatHeading: false }))
  const pages = prefs.compactFlow === true
    ? packPages(rawPages, fits, { includeCover: !isTemplateCover(ctx.cover) && !prefs.coverOnly })
    : numberPages(rawPages)
  return { pages, ctx: { ...ctx, lines: false } }
}

/**
 * 一页页导出成 PNG。
 * @param {{pages: object[], ctx: object}} plan - planCardPages 的结果。
 * @param {(n: number, total: number) => void} [onPage] - 每导出一页报一次。
 * @returns {Promise<Blob[]>}
 */
export async function exportCardPngs({ pages, ctx }, onPage = () => {}) {
  const size = { cardWidth: ctx.width, cardHeight: ctx.height, width: ctx.exportWidth, height: ctx.exportHeight }
  const blobs = []
  for (let i = 0; i < pages.length; i += 1) {
    onPage(i + 1, pages.length)
    blobs.push(await cardToPng(renderCard(pages[i], ctx), size))
  }
  return blobs
}
