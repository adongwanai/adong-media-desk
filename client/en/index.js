// 英文词典：key 是界面里的中文原文。按页面分文件，避免一个文件太长。
import { CORE } from './core.js'
import { LAYOUTS } from './layouts.js'
import { PAGES } from './pages.js'
import { STUDIO } from './studio.js'
import { WORKBENCH } from './workbench.js'
import { VIEWS } from './views.js'
import { BOARD } from './board.js'
import { EXTRA } from './extra.js'
import { MATERIALS } from './materials.js'

export const EN = { ...CORE, ...PAGES, ...STUDIO, ...WORKBENCH, ...VIEWS, ...LAYOUTS, ...BOARD, ...EXTRA, ...MATERIALS }
