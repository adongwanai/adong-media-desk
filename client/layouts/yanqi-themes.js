// 本文件由 scripts/gen-yanqi-themes.mjs 生成，不要手改。重新生成：node scripts/gen-yanqi-themes.mjs <yanqi-obsidian 目录>
// 排版主题来自言起 YANQI（阿东玩AI，https://github.com/adongwanai/yanqi-obsidian），
// 言起基于 Note to RED（Yeban8090，MIT，https://github.com/Yeban8090/note-to-red）。转载或改编请保留这两处署名。
// 样式是写在元素 style 上的 CSS 字符串，只来自这里，不会来自正文。

/** 主题分组，顺序同言起 README 的主题画廊。 */
export const YANQI_GROUPS = ["通用 / 极简","信息流 / 社媒","暗色 / 科技","杂志 / 文艺","东方 / 自然"]

/** 言起的默认选择。 */
export const YANQI_DEFAULTS = {
  "themeId": "adong-xhs-dense",
  "templateId": "default",
  "coverStyle": "cover-bold",
  "fontSize": 17,
  "font": "雅黑"
}

/** 言起的字体：只是 CSS font-family，不带字体文件。 */
export const YANQI_FONTS = [
  {
    "id": "默认字体",
    "name": "默认字体",
    "family": "Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, 'PingFang SC', Cambria, Cochin, Georgia, Times, 'Times New Roman', serif"
  },
  {
    "id": "宋体",
    "name": "宋体",
    "family": "SimSun, '宋体', serif"
  },
  {
    "id": "黑体",
    "name": "黑体",
    "family": "SimHei, '黑体', sans-serif"
  },
  {
    "id": "楷体",
    "name": "楷体",
    "family": "KaiTi, '楷体', serif"
  },
  {
    "id": "雅黑",
    "name": "雅黑",
    "family": "'Microsoft YaHei', '微软雅黑', sans-serif"
  },
  {
    "id": "苹方",
    "name": "苹方",
    "family": "'PingFang SC','苹方',-apple-system,sans-serif"
  },
  {
    "id": "冬青黑体",
    "name": "冬青黑体",
    "family": "'Hiragino Sans GB','冬青黑体',sans-serif"
  },
  {
    "id": "思源黑体",
    "name": "思源黑体",
    "family": "'Source Han Sans SC','Noto Sans CJK SC','思源黑体',sans-serif"
  },
  {
    "id": "思源宋体",
    "name": "思源宋体",
    "family": "'Source Han Serif SC','Noto Serif CJK SC','思源宋体',serif"
  },
  {
    "id": "霞鹜文楷",
    "name": "霞鹜文楷",
    "family": "'LXGW WenKai','霞鹜文楷',serif"
  },
  {
    "id": "得意黑",
    "name": "得意黑",
    "family": "'Smiley Sans','得意黑',sans-serif"
  },
  {
    "id": "华文细黑",
    "name": "华文细黑",
    "family": "STXihei,'华文细黑',sans-serif"
  },
  {
    "id": "等宽代码",
    "name": "等宽代码",
    "family": "'JetBrains Mono','SF Mono',Menlo,Consolas,monospace"
  },
  {
    "id": "Helvetica",
    "name": "Helvetica",
    "family": "Helvetica,Arial,'Helvetica Neue',sans-serif"
  }
]

/** 言起的 30 套主题。 */
export const YANQI_THEMES = [
  {
    "id": "default",
    "name": "默认主题",
    "group": "通用 / 极简",
    "description": "干净通用的默认配色，第一次用就选它，百搭不出错。",
    "styles": {
      "imagePreview": "background-color: #1c1c1e; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 12px; overflow: hidden;",
          "placeholder": "background: #2c2c2e; transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 8px;",
        "userName": "font-size: 15px; font-weight: 600; color: #ffffff;",
        "userId": "font-size: 12.5px; color: #98989d;",
        "postTime": "font-size: 12px; color: #636366;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #98989d; font-size: 11.5px; border-top: 1px solid #2c2c2e; background: #1c1c1e;",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #636366;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 600; color: #f2f2f7;",
          "after": ""
        },
        "h3": {
          "base": "margin: 26px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 600; color: #f2f2f7;",
          "after": ""
        },
        "base": {
          "base": "margin: 22px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 600; color: #f2f2f7;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.1em; font-size: 15px; color: #f2f2f7;",
      "emphasis": {
        "strong": "font-weight: 700; color: #0A84FF;",
        "em": "font-style: normal; color: #98989d; background: rgba(152,152,157,0.1); padding: 0 4px;",
        "del": "text-decoration: line-through; color: #636366;"
      },
      "list": {
        "container": "padding-left: 26px; margin-bottom: 1.1em; color: #d1d1d6;",
        "item": "margin-bottom: 0.7em; font-size: 15px; color: #d1d1d6; line-height: 1.75;",
        "taskList": "list-style: none; margin-left: -22px; font-size: 15px; color: #d1d1d6; line-height: 1.75;"
      },
      "code": {
        "block": "background: #2c2c2e; padding: 1em 1.2em; border-radius: 12px; font-size: 14px; font-family: SF Mono, Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #ffffff; margin: 1.3em 0;",
        "inline": "background: #2c2c2e; padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 14px; font-family: SF Mono, Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #0A84FF; padding: 0 0 0 18px; margin: 1.2em 0; color: #f2f2f7; font-style: normal; font-size: 15px; line-height: 1.75;",
      "image": "max-width: 100%; height: auto; margin: 1.3em auto; border-radius: 12px;",
      "link": "color: #0A84FF; text-decoration: underline; text-underline-offset: 2px; transition: opacity 0.2s ease;",
      "table": {
        "container": "width: 100%; margin: 1.3em 0; border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; border: 1px solid #2c2c2e;",
        "header": "background: #2c2c2e; font-weight: 600; color: #f2f2f7; padding: 12px;",
        "cell": "padding: 12px; color: #d1d1d6; border-top: 1px solid #2c2c2e;"
      },
      "hr": "border: none; border-top: 1px solid #2c2c2e; margin: 26px 0;",
      "footnote": {
        "ref": "color: #98989d; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #98989d; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "minimal",
    "name": "极简主题",
    "group": "通用 / 极简",
    "description": "大留白、细字重，信息克制到只剩内容本身。",
    "styles": {
      "imagePreview": "background-color: #ffffff; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);",
          "placeholder": "background: #f5f5f5; transition: all 0.2s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 8px;",
        "userName": "font-size: 15px; font-weight: 600; color: #333333; letter-spacing: 0.02em;",
        "userId": "font-size: 12.5px; color: #666666;",
        "postTime": "font-size: 12px; color: #999999;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 16px; padding: 7px 18px; color: #999999; font-size: 11.5px; border-top: 1px solid #eeeeee; background: rgba(250,250,250,0.95); backdrop-filter: blur(8px);",
        "text": "color: inherit; transition: opacity 0.2s ease; white-space: nowrap;",
        "separator": "color: #dddddd;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; line-height: 1.5;",
          "content": "font-weight: 600; color: #333333;",
          "after": ""
        },
        "h3": {
          "base": "margin: 32px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 600; color: #333333;",
          "after": ""
        },
        "base": {
          "base": "margin: 28px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 600; color: #333333;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.2em; font-size: 15px; color: #444444;",
      "emphasis": {
        "strong": "font-weight: 700; color: #4a4a4a; background: rgba(74,74,74,0.05); padding: 0 2px;",
        "em": "font-style: normal; color: #6c9eb8; background: rgba(108,158,184,0.05); padding: 0 2px;",
        "del": "text-decoration: line-through; color: #999999; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 28px; margin-bottom: 1.2em; color: #666666;",
        "item": "margin-bottom: 0.8em; font-size: 15px; color: #666666; line-height: 1.8;",
        "taskList": "list-style: none; margin-left: -20px; font-size: 15px; color: #666666; line-height: 1.8;"
      },
      "code": {
        "block": "background: #f5f5f5; padding: 1.2em; border-radius: 8px; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #555555; margin: 1.5em 0; border: 1px solid #eeeeee;",
        "inline": "background: #f5f5f5; padding: 4px 8px; border-radius: 4px; color: #555555; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; border: 1px solid #eeeeee;"
      },
      "quote": "border-left: 3px solid #eeeeee; padding: 0 0 0 20px; margin: 1.5em 0; color: #666666; font-style: normal; font-size: 15px; line-height: 1.8;",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);",
      "link": "color: #6c9eb8; text-decoration: none; border-bottom: 1px solid rgba(108,158,184,0.3); transition: all 0.2s ease;",
      "table": {
        "container": "width: 100%; margin: 1.5em 0; border-collapse: collapse;",
        "header": "background: #f5f5f5; font-weight: 600; color: #333333; border-bottom: 2px solid #eeeeee; padding: 14px;",
        "cell": "padding: 14px; color: #666666; border-bottom: 1px solid #eeeeee;"
      },
      "hr": "border: none; border-top: 1px solid #eeeeee; margin: 32px 0;",
      "footnote": {
        "ref": "color: #999999; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #999999; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "clean-min",
    "name": "性冷淡极简",
    "group": "通用 / 极简",
    "description": "纯白 + 黑字 + 极细灰线，安静克制，质感账号通用。",
    "styles": {
      "imagePreview": "background-color: #ffffff; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #f1f1f3;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #18181b;",
        "userId": "font-size: 12.5px; color: #a1a1aa;",
        "postTime": "font-size: 12px; color: #c4c4cc;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #18181b;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #b4b4bc; font-size: 11.5px; border-top: 1px solid #f0f0f0; background: rgba(255,255,255,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #ededed;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.6em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 700; color: #18181b;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #18181b;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #18181b;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #52525b;",
      "emphasis": {
        "strong": "font-weight: 800; color: #18181b; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #18181b; background: rgba(24,24,27,0.06); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #a1a1aa; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #6b6b73;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #6b6b73; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #6b6b73; line-height: 1.6;"
      },
      "code": {
        "block": "background: #18181b; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #fafafa; margin: 0.85em 0;",
        "inline": "background: #f4f4f5; padding: 2px 6px; border-radius: 4px; color: #18181b; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #d4d4d8; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #71717a; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(0,0,0,0.02); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 240px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.05); object-fit: contain;",
      "link": "color: #18181b; text-decoration: none; border-bottom: 1px solid #18181b55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(24,24,27,0.06); font-weight: 700; color: #18181b; border-bottom: 1px solid #ededed; padding: 8px;",
        "cell": "padding: 8px; color: #52525b; border-bottom: 1px solid #ededed;"
      },
      "hr": "border: none; border-top: 1px solid #ededed; margin: 18px 0;",
      "footnote": {
        "ref": "color: #a1a1aa; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #a1a1aa; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "morandi",
    "name": "莫兰迪灰调",
    "group": "通用 / 极简",
    "description": "低饱和灰阶色，温柔耐看的莫兰迪美学。",
    "styles": {
      "imagePreview": "background-color: #eceae4; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #ddd9cf;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #3b3935;",
        "userId": "font-size: 12.5px; color: #a39d93;",
        "postTime": "font-size: 12px; color: #b6b1a6;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #8a7a6d;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #a8a294; font-size: 11.5px; border-top: 1px solid #dcd8cf; background: rgba(236,234,228,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #cfcabf;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.62em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 700; color: #3b3935;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #3b3935;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #3b3935;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #54514c;",
      "emphasis": {
        "strong": "font-weight: 800; color: #8a7a6d; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #4a4138; background: rgba(168,150,134,0.30); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #a39d93; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #5c574e;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #5c574e; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #5c574e; line-height: 1.6;"
      },
      "code": {
        "block": "background: #3b3935; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f3f1ea; margin: 0.85em 0;",
        "inline": "background: #e2ded4; padding: 2px 6px; border-radius: 4px; color: #3b3935; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #a89686; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #5c574e; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(168,150,134,0.10); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 5px 16px rgba(80,70,55,0.10); object-fit: contain;",
      "link": "color: #8a7a6d; text-decoration: none; border-bottom: 1px solid #8a7a6d55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(168,150,134,0.30); font-weight: 700; color: #3b3935; border-bottom: 1px solid #dcd8cf; padding: 8px;",
        "cell": "padding: 8px; color: #54514c; border-bottom: 1px solid #dcd8cf;"
      },
      "hr": "border: none; border-top: 1px solid #dcd8cf; margin: 18px 0;",
      "footnote": {
        "ref": "color: #a39d93; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #a39d93; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "swiss-grid",
    "name": "瑞士红格",
    "group": "通用 / 极简",
    "description": "瑞士国际主义网格，红黑点缀，秩序与理性。",
    "styles": {
      "imagePreview": "background-color: #ffffff; background-image: linear-gradient(#f1f1f1 1px, transparent 1px), linear-gradient(90deg, #f1f1f1 1px, transparent 1px); background-size: 26px 26px; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #f0f0f0;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #111111;",
        "userId": "font-size: 12.5px; color: #8a8a8a;",
        "postTime": "font-size: 12px; color: #aaaaaa;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #E2231A;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #9a9a9a; font-size: 11.5px; border-top: 1px solid #eeeeee; background: rgba(255,255,255,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #dddddd;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.74em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #111111;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #111111;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #111111;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #222222;",
      "emphasis": {
        "strong": "font-weight: 800; color: #E2231A; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #9a140d; background: rgba(226,35,26,0.10); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #8a8a8a; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #333333;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #333333; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #333333; line-height: 1.6;"
      },
      "code": {
        "block": "background: #111111; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #ffffff; margin: 0.85em 0;",
        "inline": "background: #f2f2f2; padding: 2px 6px; border-radius: 4px; color: #111111; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #E2231A; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #444444; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(226,35,26,0.04); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 225px; height: auto; margin: 0.62em auto; border-radius: 0; box-shadow: none; object-fit: contain;",
      "link": "color: #E2231A; text-decoration: none; border-bottom: 1px solid #E2231A55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(226,35,26,0.10); font-weight: 700; color: #111111; border-bottom: 1px solid #e6e6e6; padding: 8px;",
        "cell": "padding: 8px; color: #222222; border-bottom: 1px solid #e6e6e6;"
      },
      "hr": "border: none; border-top: 1px solid #e6e6e6; margin: 18px 0;",
      "footnote": {
        "ref": "color: #8a8a8a; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #8a8a8a; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "vellum",
    "name": "学者羊皮",
    "group": "通用 / 极简",
    "description": "深底暖黄衬线，安静的学者羊皮卷气质。",
    "styles": {
      "imagePreview": "background-color: #1b2436; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #28344a;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #f0e9da;",
        "userId": "font-size: 12.5px; color: #8893a3;",
        "postTime": "font-size: 12px; color: #6e7889;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #e9c46a;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #7d8799; font-size: 11.5px; border-top: 1px solid #2c374b; background: rgba(27,36,54,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #33405a;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.66em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #f0e9da;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #f0e9da;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #f0e9da;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #cfd6e2;",
      "emphasis": {
        "strong": "font-weight: 800; color: #e9c46a; background: rgba(233,196,106,0.12); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #f3e0a8; background: rgba(233,196,106,0.16); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #7d8799; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #bcc4d0;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #bcc4d0; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #bcc4d0; line-height: 1.6;"
      },
      "code": {
        "block": "background: #0f1726; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #e9c46a; margin: 0.8em 0;",
        "inline": "background: #222d40; padding: 2px 6px; border-radius: 4px; color: #9fc1c0; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #4a8a86; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #b9c2cf; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(74,138,134,0.10); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 225px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.4); object-fit: contain;",
      "link": "color: #e9c46a; text-decoration: none; border-bottom: 1px solid #e9c46a55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(233,196,106,0.16); font-weight: 700; color: #f0e9da; border-bottom: 1px solid #2c374b; padding: 8px;",
        "cell": "padding: 8px; color: #cfd6e2; border-bottom: 1px solid #2c374b;"
      },
      "hr": "border: none; border-top: 1px solid #2c374b; margin: 16px 0;",
      "footnote": {
        "ref": "color: #7d8799; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #7d8799; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "adong-xhs-dense",
    "name": "阿东信息流主题",
    "group": "信息流 / 社媒",
    "description": "紧凑高信息密度，专为信息流长文优化的默认主力。",
    "styles": {
      "imagePreview": "background-color: #ffffff; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);",
          "placeholder": "background: #f5f5f5; transition: all 0.2s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #202124;",
        "userId": "font-size: 12.5px; color: #777777;",
        "postTime": "font-size: 12px; color: #9a9a9a;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #0066FF;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #a0a0a0; font-size: 11.5px; border-top: 1px solid #f0f0f0; background: rgba(255,255,255,0.96); backdrop-filter: blur(6px);",
        "text": "color: inherit; transition: opacity 0.2s ease; white-space: nowrap;",
        "separator": "color: #dddddd;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.62em; line-height: 1.26;",
          "content": "font-weight: 800; color: #202124;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 750; color: #202124;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #202124;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.58; margin: 0 0 0.72em; font-size: 15px; color: #3f3f46;",
      "emphasis": {
        "strong": "font-weight: 800; color: #0066FF; background: rgba(0,102,255,0.07); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #1f2937; background: rgba(255,107,0,0.13); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #999999; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #4b5563;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #4b5563; line-height: 1.55;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #4b5563; line-height: 1.55;"
      },
      "code": {
        "block": "background: #111827; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.48; white-space: pre-wrap; word-wrap: break-word; color: #f9fafb; margin: 0.85em 0; border: 1px solid #1f2937;",
        "inline": "background: #f3f4f6; padding: 2px 6px; border-radius: 4px; color: #111827; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; border: 1px solid #e5e7eb;"
      },
      "quote": "border-left: 3px solid #0066FF; padding: 0 0 0 12px; margin: 0.75em 0; color: #4b5563; font-style: normal; font-size: 15px; line-height: 1.58; background: rgba(0,102,255,0.04); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 252px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 4px 14px rgba(15,23,42,0.08); object-fit: contain;",
      "link": "color: #0066FF; text-decoration: none; border-bottom: 1px solid rgba(0,102,255,0.28); transition: all 0.2s ease;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: #f3f4f6; font-weight: 700; color: #111827; border-bottom: 1px solid #e5e7eb; padding: 8px;",
        "cell": "padding: 8px; color: #4b5563; border-bottom: 1px solid #eeeeee;"
      },
      "hr": "border: none; border-top: 1px solid #eeeeee; margin: 18px 0;",
      "footnote": {
        "ref": "color: #999999; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #999999; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "memo-note",
    "name": "便签备忘录",
    "group": "信息流 / 社媒",
    "description": "iOS 备忘录质感，随手记的清爽便签风。",
    "styles": {
      "imagePreview": "background-color: #fbfaf6; background-image: radial-gradient(#e6e2d6 1.1px, transparent 1.1px); background-size: 20px 20px; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #efece2;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #1c1c1a;",
        "userId": "font-size: 12.5px; color: #8a877d;",
        "postTime": "font-size: 12px; color: #a8a59a;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #1c1c1a;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #a8a59a; font-size: 11.5px; border-top: 1px solid #ece8dd; background: rgba(251,250,246,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #dcd8cc;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.66em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #1c1c1a;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #1c1c1a;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #1c1c1a;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #3a3a36;",
      "emphasis": {
        "strong": "font-weight: 800; color: #1c1c1a; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #1c1c1a; background: rgba(255,214,0,0.45); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #9b988e; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #54514a;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #54514a; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #54514a; line-height: 1.6;"
      },
      "code": {
        "block": "background: #1f2937; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f9fafb; margin: 0.85em 0;",
        "inline": "background: #f1eee5; padding: 2px 6px; border-radius: 4px; color: #1c1c1a; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #d8b400; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #5a574e; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(255,214,0,0.10); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 240px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.06); object-fit: contain;",
      "link": "color: #b08900; text-decoration: none; border-bottom: 1px solid #b0890055;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(255,214,0,0.45); font-weight: 700; color: #1c1c1a; border-bottom: 1px solid #ece8dd; padding: 8px;",
        "cell": "padding: 8px; color: #3a3a36; border-bottom: 1px solid #ece8dd;"
      },
      "hr": "border: none; border-top: 1px solid #ece8dd; margin: 18px 0;",
      "footnote": {
        "ref": "color: #9b988e; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #9b988e; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "cream-journal",
    "name": "奶油手账",
    "group": "信息流 / 社媒",
    "description": "奶油底色与手账感，柔软治愈的记录风。",
    "styles": {
      "imagePreview": "background-color: #fdf6ec; background-image: linear-gradient(#f0e6d2 1px, transparent 1px); background-size: 100% 30px; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #ecdfc9;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #3d3328;",
        "userId": "font-size: 12.5px; color: #a99f8e;",
        "postTime": "font-size: 12px; color: #bcae98;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #e07a5f;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #aa9f8a; font-size: 11.5px; border-top: 1px solid #ece0cd; background: rgba(253,246,236,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #ddd0b8;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.62em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 750; color: #3d3328;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #3d3328;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #3d3328;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #5a4f43;",
      "emphasis": {
        "strong": "font-weight: 800; color: #e07a5f; background: rgba(224,122,95,0.12); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #5a4f43; background: rgba(255,205,120,0.50); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #a99f8e; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #6b6052;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #6b6052; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #6b6052; line-height: 1.6;"
      },
      "code": {
        "block": "background: #3d3328; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #fdf6ec; margin: 0.85em 0;",
        "inline": "background: #f3e9d6; padding: 2px 6px; border-radius: 4px; color: #3d3328; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #e07a5f; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #6b6052; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(224,122,95,0.07); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 5px 16px rgba(90,70,40,0.10); object-fit: contain;",
      "link": "color: #cf6a1a; text-decoration: none; border-bottom: 1px solid #cf6a1a55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(255,205,120,0.50); font-weight: 700; color: #3d3328; border-bottom: 1px solid #ece0cd; padding: 8px;",
        "cell": "padding: 8px; color: #5a4f43; border-bottom: 1px solid #ece0cd;"
      },
      "hr": "border: none; border-top: 1px solid #ece0cd; margin: 18px 0;",
      "footnote": {
        "ref": "color: #a99f8e; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #a99f8e; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "sakura",
    "name": "樱花飞舞",
    "group": "信息流 / 社媒",
    "description": "粉白渐变，柔软浪漫的春日气息。",
    "styles": {
      "imagePreview": "background-color: #1f1a1d; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(255,182,193,0.25); border: 1px solid #ffb6c180;",
          "placeholder": "background: linear-gradient(135deg, #2d2428, #3a2d33); transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease; filter: brightness(1.05) contrast(1.02);"
        },
        "nameContainer": "display: flex; align-items: center; gap: 10px;",
        "userName": "font-size: 15px; font-weight: 700; color: #ffb6c1; text-shadow: 0 2px 8px rgba(255,182,193,0.2);",
        "userId": "font-size: 12.5px; color: #ff8da1; font-family: 'SF Pro Text';",
        "postTime": "font-size: 12px; color: #ff6b88; letter-spacing: 0.03em;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #ff8da1; font-size: 11.5px; border-top: 1px solid #ffb6c140; background: rgba(31,26,29,0.95); backdrop-filter: blur(12px);",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #ff6b88;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 700; color: #ffb6c1; text-shadow: 0 2px 8px rgba(255,182,193,0.15);",
          "after": ""
        },
        "h3": {
          "base": "margin: 28px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 700; color: #ffb6c1;",
          "after": ""
        },
        "base": {
          "base": "margin: 24px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 700; color: #ffb6c1;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.2em; font-size: 15px; color: #fff5f7;",
      "emphasis": {
        "strong": "font-weight: 700; color: #ff69b4; text-shadow: 0 2px 8px rgba(255,105,180,0.2);",
        "em": "font-style: normal; color: #ff8da1; background: rgba(255,141,161,0.1); padding: 0 4px; border-left: 2px solid #ff8da180;",
        "del": "text-decoration: line-through; color: #ff6b88; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 28px; margin-bottom: 1.2em; color: #ffd1d9;",
        "item": "margin-bottom: 0.8em; font-size: 15px; color: #ffd1d9; line-height: 1.8;",
        "taskList": "list-style: none; margin-left: -24px; font-size: 15px; color: #ffd1d9; line-height: 1.8;"
      },
      "code": {
        "block": "background: #2d2428; padding: 1.2em; border-radius: 14px; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #ffd1d9; margin: 1.5em 0; box-shadow: inset 0 4px 12px rgba(0,0,0,0.15), 0 2px 8px rgba(255,182,193,0.1); border: 1px solid #ffb6c180;",
        "inline": "background: #2d2428; padding: 4px 10px; border-radius: 6px; color: #ffd1d9; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; border: 1px solid #ffb6c180;"
      },
      "quote": "border-left: 3px solid #ff8da1; padding: 0 0 0 20px; margin: 1.5em 0; color: #ff8da1; font-style: normal; font-size: 15px; line-height: 1.8; background: linear-gradient(to right, rgba(255,141,161,0.05), transparent);",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 14px; box-shadow: 0 8px 24px rgba(255,182,193,0.25); border: 1px solid #ffb6c180;",
      "link": "color: #ffb6c1; text-decoration: none; border-bottom: 1px solid rgba(255,182,193,0.3); transition: all 0.2s ease; text-shadow: 0 2px 4px rgba(255,182,193,0.1);",
      "table": {
        "container": "width: 100%; margin: 1.5em 0; border-collapse: separate; border-spacing: 0; border-radius: 14px; overflow: hidden; border: 1px solid #ffb6c180; box-shadow: 0 4px 12px rgba(255,182,193,0.15);",
        "header": "background: linear-gradient(135deg, #2d2428, #1f1a1d); font-weight: 700; color: #ffb6c1; padding: 14px; border-bottom: 2px solid #ffb6c180;",
        "cell": "padding: 14px; color: #ffd1d9; border-top: 1px solid #ffb6c180;"
      },
      "hr": "border: none; border-top: 2px solid #ffb6c180; margin: 32px 0; box-shadow: 0 2px 8px rgba(255,182,193,0.15);",
      "footnote": {
        "ref": "color: #ff8da1; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #ff8da1; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "warm",
    "name": "暖阳文艺",
    "group": "信息流 / 社媒",
    "description": "暖橘奶白，午后阳光般的温柔文艺调。",
    "styles": {
      "imagePreview": "background-color: #fffaf5; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(184,115,51,0.1); border: 1px solid #b8733380;",
          "placeholder": "background: linear-gradient(135deg, #fff0e6, #ffe4c4); transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease; filter: brightness(1.05) contrast(1.02);"
        },
        "nameContainer": "display: flex; align-items: center; gap: 8px;",
        "userName": "font-size: 15px; font-weight: 600; color: #8b4513; serif; text-shadow: 0 2px 4px rgba(139,69,19,0.1);",
        "userId": "font-size: 12.5px; color: #b87333; font-family: 'Noto Serif SC', serif;",
        "postTime": "font-size: 12px; color: #d2691e; font-style: italic;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #b87333; font-size: 11.5px; border-top: 1px solid #b8733380; background: rgba(255,250,245,0.95); backdrop-filter: blur(8px);",
        "text": "color: inherit; transition: color 0.2s ease; font-style: italic; white-space: nowrap;",
        "separator": "color: #deb887;"
      },
      "title": {
        "h2": {
          "base": "margin: 10px 0 0; font-size: 1.6em; letter-spacing: 0.01em; line-height: 1.5;",
          "content": "font-weight: 600; color: #8b4513;",
          "after": ""
        },
        "h3": {
          "base": "margin: 8px 0 0; font-size: 1.3em; line-height: 1.5;",
          "content": "font-weight: 600; color: #8b4513;",
          "after": ""
        },
        "base": {
          "base": "margin: 6px 0 0; font-size: 1.15em; line-height: 1.5;",
          "content": "font-weight: 600; color: #8b4513;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.75; margin-bottom: 1.1em; font-size: 15px; color: #5a4a42;",
      "emphasis": {
        "strong": "font-weight: 600; color: #d2691e; text-shadow: 0 2px 4px rgba(210,105,30,0.1);",
        "em": "font-style: normal; color: #b87333; background: rgba(184,115,51,0.1); padding: 0 4px; border-left: 2px solid #b8733380;",
        "del": "text-decoration: line-through; color: #8b4513; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 26px; margin-bottom: 1.2em; color: #6b4423;",
        "item": "margin-bottom: 0.8em; font-size: 15px; color: #6b4423; line-height: 1.85; font-family: 'Noto Serif SC', serif;",
        "taskList": "list-style: none; margin-left: -22px; font-size: 15px; color: #6b4423; line-height: 1.85; font-family: 'Noto Serif SC', serif;"
      },
      "code": {
        "block": "background: #fff6e9; padding: 1.2em; border-radius: 8px; font-size: 14px; font-family: 'Fira Code', monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #8b4513; margin: 1.3em 0; border: 1px solid #b8733380; box-shadow: inset 0 4px 12px rgba(184,115,51,0.05), 0 2px 8px rgba(184,115,51,0.05);",
        "inline": "background: #fff6e9; padding: 4px 10px; border-radius: 4px; color: #8b4513; font-size: 14px; font-family: 'Fira Code', monospace; border: 1px solid #b8733380;"
      },
      "quote": "border-left: 3px solid #deb887; padding: 0 0 0 20px; margin: 1.3em 0; color: #b87333; font-style: italic; font-size: 15px; line-height: 1.85; font-family: 'Noto Serif SC', serif; background: linear-gradient(to right, rgba(222,184,135,0.1), transparent);",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 12px; box-shadow: 0 4px 16px rgba(184,115,51,0.1); border: 1px solid #b8733380;",
      "link": "color: #d2691e; text-decoration: none; background-image: linear-gradient(to right, #d2691e80, #b8733380); background-size: 0% 1px; background-repeat: no-repeat; background-position: 0 100%; transition: all 0.3s ease; font-family: 'Noto Serif SC', serif;",
      "table": {
        "container": "width: 100%; margin: 1.4em 0; border-collapse: separate; border-spacing: 0; border: 1px solid #b8733380; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(184,115,51,0.05);",
        "header": "background: linear-gradient(135deg, #fff6e9, #fffaf5); font-weight: 600; color: #8b4513; padding: 14px; font-family: 'Noto Serif SC', serif; border-bottom: 2px solid #b8733380;",
        "cell": "padding: 14px; color: #6b4423; border-top: 1px solid #b8733380; font-family: 'Noto Serif SC', serif;"
      },
      "hr": "border: none; border-top: 2px solid #b8733380; margin: 28px 0; box-shadow: 0 2px 8px rgba(184,115,51,0.05);",
      "footnote": {
        "ref": "color: #b87333; text-decoration: none; font-size: 0.9em; font-style: italic;",
        "backref": "color: #b87333; text-decoration: none; font-size: 0.9em; font-style: italic;"
      }
    }
  },
  {
    "id": "elegant",
    "name": "优雅暗色",
    "group": "暗色 / 科技",
    "description": "深色底配柔和高光，沉稳有质感的夜读感。",
    "styles": {
      "imagePreview": "background-color: #1a1721; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(180,144,255,0.15);",
          "placeholder": "background: #2a2433; transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 8px;",
        "userName": "font-size: 15px; font-weight: 600; color: #e2d9f3; letter-spacing: 0.02em;",
        "userId": "font-size: 12.5px; color: #a393c9;",
        "postTime": "font-size: 12px; color: #6d617f;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #a393c9; font-size: 11.5px; border-top: 1px solid #2a2433; background: rgba(26,23,33,0.95); backdrop-filter: blur(12px);",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #6d617f;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 600; color: #e2d9f3; text-shadow: 0 2px 4px rgba(0,0,0,0.1);",
          "after": ""
        },
        "h3": {
          "base": "margin: 28px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 600; color: #e2d9f3;",
          "after": ""
        },
        "base": {
          "base": "margin: 24px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 600; color: #e2d9f3;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.75; margin-bottom: 1.1em; font-size: 15px; color: #c4b8dd;",
      "emphasis": {
        "strong": "font-weight: 600; color: #b490ff; text-shadow: 0 1px 2px rgba(180,144,255,0.2);",
        "em": "font-style: normal; color: #a393c9; background: rgba(163,147,201,0.1); padding: 0 4px; border-radius: 2px;",
        "del": "text-decoration: line-through; color: #6d617f; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 26px; margin-bottom: 1.2em; color: #c4b8dd;",
        "item": "margin-bottom: 0.7em; font-size: 15px; color: #c4b8dd; line-height: 1.75;",
        "taskList": "list-style: none; margin-left: -22px; font-size: 15px; color: #c4b8dd; line-height: 1.75;"
      },
      "code": {
        "block": "background: #2a2433; padding: 1.2em; border-radius: 14px; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #c4b8dd; margin: 1.3em 0; box-shadow: inset 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #3a3443;",
        "inline": "background: #2a2433; padding: 4px 10px; border-radius: 6px; color: #c4b8dd; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; border: 1px solid #3a3443;"
      },
      "quote": "border-left: 3px solid #b490ff; padding: 0 0 0 18px; margin: 1.5em 0; color: #a393c9; font-style: normal; font-size: 15px; line-height: 1.75; background: rgba(180,144,255,0.05); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.2);",
      "link": "color: #b490ff; text-decoration: none; transition: all 0.2s ease; border-bottom: 1px solid rgba(180,144,255,0.3);",
      "table": {
        "container": "width: 100%; margin: 1.5em 0; border-collapse: separate; border-spacing: 0; border-radius: 14px; overflow: hidden; border: 1px solid #3a3443; box-shadow: 0 4px 12px rgba(0,0,0,0.1);",
        "header": "background: #2a2433; font-weight: 600; color: #e2d9f3; padding: 14px;",
        "cell": "padding: 14px; color: #c4b8dd; border-top: 1px solid #3a3443;"
      },
      "hr": "border: none; border-top: 1px solid #3a3443; margin: 32px 0;",
      "footnote": {
        "ref": "color: #a393c9; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #a393c9; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "cyber",
    "name": "赛博朋克",
    "group": "暗色 / 科技",
    "description": "霓虹紫青撞色，故障感与未来都市气息。",
    "styles": {
      "imagePreview": "background-color: #ffffff; padding: 20px 22px 40px;",
      "header": {
        "container": "margin-bottom: 10px;",
        "userInfo": "display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 10px 14px; line-height: normal;",
        "userLeft": "display: flex; align-items: center; gap: 14px;",
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 12px; overflow: hidden; cursor: pointer; position: relative; background: linear-gradient(45deg, #ff00ff, #00ffff); box-shadow: 0 0 15px rgba(255, 0, 255, 0.3); transition: all 0.3s ease; &::before { content: ''; position: absolute; inset: 1px; background: #ffffff; border-radius: 11px; z-index: 1; } &::after { content: ''; position: absolute; inset: -2px; background: linear-gradient(45deg, #ff00ff, #00ffff, #05ffa1); border-radius: 14px; z-index: -1; opacity: 0.5; } &:hover { transform: translateY(-2px); box-shadow: 0 0 20px rgba(255, 0, 255, 0.4); &::after { opacity: 0.8; } }",
          "placeholder": "width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(255, 0, 255, 0.1), rgba(0, 255, 255, 0.1)); color: #ff00ff; font-size: 18px; text-shadow: 0 0 10px rgba(255, 0, 255, 0.5); position: relative; z-index: 2;",
          "image": "width: 100%; height: 100%; object-fit: cover; transition: all 0.3s ease; filter: saturate(1.2) contrast(1.1); position: relative; z-index: 2; &:hover { transform: scale(1.05); filter: saturate(1.4) contrast(1.15); }"
        },
        "nameContainer": "display: flex; align-items: center; gap: 8px;",
        "userName": "font-size: 15px; font-weight: 600; color: #ff00ff; cursor: pointer; transition: all 0.2s ease; text-shadow: 0 0 10px rgba(255, 0, 255, 0.3); &:hover { color: #ff2a6d; }",
        "userId": "font-size: 12.5px; color: #00ffff; cursor: pointer; transition: all 0.2s ease; &:hover { color: #05ffa1; }",
        "postTime": "font-size: 12px; color: #00ffff; cursor: pointer; transition: all 0.2s ease; &:hover { color: #05ffa1; }",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "margin-top: 20px; padding: 7px 18px; position: absolute; bottom: 5px; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 16px; border-top: 1px solid rgba(0, 255, 255, 0.2); backdrop-filter: blur(8px); background: rgba(255, 255, 255, 0.9);",
        "text": "color: #00ffff; font-size: 13px; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; line-height: 1; display: inline-flex; align-items: center; vertical-align: middle; &:hover { color: #05ffa1; transform: translateY(-1px); }",
        "separator": "color: rgba(255, 0, 255, 0.5); font-size: 13px; line-height: 1; display: inline-flex; align-items: center;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; line-height: 1.4; display: block; letter-spacing: -0.01em;",
          "content": "font-weight: 600; color: #ff00ff; text-shadow: 0 0 10px rgba(255, 0, 255, 0.3);",
          "after": ""
        },
        "h3": {
          "base": "margin: 0; font-size: 1.25em; line-height: 1.5; display: block;",
          "content": "font-weight: 600; color: #00ffff; text-shadow: 0 0 10px rgba(0, 255, 255, 0.3);",
          "after": ""
        },
        "base": {
          "base": "margin: 0; font-size: 1.1em; line-height: 1.5; display: block;",
          "content": "font-weight: 500; color: #05ffa1; text-shadow: 0 0 10px rgba(5, 255, 161, 0.3);",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 16px; font-size: 16px; color: #333333; text-align: justify; letter-spacing: 0.2px;",
      "emphasis": {
        "strong": "font-weight: 700; color: #00ffaa; text-shadow: 0 0 12px #00ffaa80;",
        "em": "font-style: normal; color: #4dffbe; background: rgba(77,255,190,0.15); padding: 0 4px;",
        "del": "text-decoration: line-through; color: #2f8f98; opacity: 0.9;"
      },
      "quote": "position: relative; border-left: 4px solid #ff00ff; border-right: 1px solid #f0f0f0; padding: 16px 20px; margin: 1.5em 0; color: #666666; font-size: 16px; line-height: 1.7; background-color: #f8f8f8; border-radius: 6px; font-style: italic; box-shadow: 0 0 15px rgba(255, 0, 255, 0.1);",
      "code": {
        "block": "background: #f8f8f8; padding: 16px; border-radius: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 14px; position: relative; margin: 24px 0; line-height: 1.6; color: #333333; border: 1px solid rgba(0, 255, 255, 0.2); box-shadow: 0 0 15px rgba(0, 255, 255, 0.1);",
        "inline": "background: #f8f8f8; padding: 4px 10px; border-radius: 4px; color: #333333; font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; border: 1px solid rgba(0, 255, 255, 0.2);"
      },
      "list": {
        "container": "padding-left: 24px; margin: 16px 0; color: #333333;",
        "item": "margin: 8px 0; font-size: 16px; color: #333333; line-height: 1.8;",
        "taskList": "list-style: none; margin-left: -22px; font-size: 16px; color: #333333; line-height: 1.8;"
      },
      "table": {
        "container": "width: 100%; margin: 24px 0; border-collapse: separate; border-spacing: 0; border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 255, 255, 0.2); box-shadow: 0 0 15px rgba(0, 255, 255, 0.1);",
        "header": "background: #f8f8f8; font-weight: 600; color: #333333; padding: 14px 18px; border: 1px solid rgba(0, 255, 255, 0.2);",
        "cell": "padding: 14px 18px; color: #333333; border: 1px solid rgba(0, 255, 255, 0.2); background: #ffffff;"
      },
      "hr": "width: 100%; margin: 32px 0; border: none; height: 2px; background: linear-gradient(90deg, #ff00ff 0%, #00ffff 50%, #05ffa1 100%); box-shadow: 0 0 15px rgba(255, 0, 255, 0.3); border-radius: 4px;",
      "image": "max-width: 100%; height: auto; margin: 24px auto; display: block; border-radius: 12px; box-shadow: 0 0 20px rgba(255, 0, 255, 0.2);",
      "link": "color: #00ffaa; text-decoration: none; border-bottom: 2px solid #00ffaa80; transition: all 0.2s ease; text-shadow: 0 0 12px #00ffaa40;",
      "footnote": {
        "ref": "color: #4dffbe; text-decoration: none; font-size: 0.9em; font-family: 'JetBrains Mono', monospace;",
        "backref": "color: #4dffbe; text-decoration: none; font-size: 0.9em; font-family: 'JetBrains Mono', monospace;"
      }
    }
  },
  {
    "id": "terminal-dark",
    "name": "暗夜终端",
    "group": "暗色 / 科技",
    "description": "深色终端配等宽字，开发者的极客夜色。",
    "styles": {
      "imagePreview": "background-color: #0d1117; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #161b22;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #e6edf3;",
        "userId": "font-size: 12.5px; color: #7d8590;",
        "postTime": "font-size: 12px; color: #6e7681;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #39d353;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #6e7681; font-size: 11.5px; border-top: 1px solid #21262d; background: rgba(13,17,23,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #2a3038;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.7em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 700; color: #e6edf3; font-family: 'SF Mono', Menlo, monospace;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #e6edf3;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #e6edf3;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #c9d1d9;",
      "emphasis": {
        "strong": "font-weight: 800; color: #39d353; background: rgba(57,211,83,0.12); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #7ee787; background: rgba(57,211,83,0.16); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #6e7681; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #adbac7;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #adbac7; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #adbac7; line-height: 1.6;"
      },
      "code": {
        "block": "background: #010409; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #7ee787; margin: 0.85em 0;",
        "inline": "background: #161b22; padding: 2px 6px; border-radius: 4px; color: #79c0ff; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #39d353; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #9aa6b2; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(57,211,83,0.06); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 225px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.5); object-fit: contain;",
      "link": "color: #58a6ff; text-decoration: none; border-bottom: 1px solid #58a6ff55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(57,211,83,0.16); font-weight: 700; color: #e6edf3; border-bottom: 1px solid #21262d; padding: 8px;",
        "cell": "padding: 8px; color: #c9d1d9; border-bottom: 1px solid #21262d;"
      },
      "hr": "border: none; border-top: 1px solid #21262d; margin: 18px 0;",
      "footnote": {
        "ref": "color: #6e7681; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #6e7681; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "tech-blue",
    "name": "科技蓝",
    "group": "暗色 / 科技",
    "description": "清爽信号蓝，干净利落的科技产品感。",
    "styles": {
      "imagePreview": "background-color: #f5f8fc; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #dde7f3;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #0f2540;",
        "userId": "font-size: 12.5px; color: #8595a8;",
        "postTime": "font-size: 12px; color: #a3b1c2;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #1467d6;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #9aa8ba; font-size: 11.5px; border-top: 1px solid #dce6f2; background: rgba(245,248,252,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #cfdcec;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.66em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 750; color: #0f2540;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #0f2540;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #0f2540;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #37475a;",
      "emphasis": {
        "strong": "font-weight: 800; color: #1467d6; background: rgba(20,103,214,0.10); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #0d3f87; background: rgba(20,103,214,0.14); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #8595a8; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #3d4f63;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #3d4f63; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #3d4f63; line-height: 1.6;"
      },
      "code": {
        "block": "background: #0b1b30; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #e6f0ff; margin: 0.85em 0;",
        "inline": "background: #e7eff8; padding: 2px 6px; border-radius: 4px; color: #0f2540; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #1467d6; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #3d4f63; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(20,103,214,0.05); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 5px 16px rgba(15,37,64,0.10); object-fit: contain;",
      "link": "color: #1467d6; text-decoration: none; border-bottom: 1px solid #1467d655;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(20,103,214,0.14); font-weight: 700; color: #0f2540; border-bottom: 1px solid #dce6f2; padding: 8px;",
        "cell": "padding: 8px; color: #37475a; border-bottom: 1px solid #dce6f2;"
      },
      "hr": "border: none; border-top: 1px solid #dce6f2; margin: 18px 0;",
      "footnote": {
        "ref": "color: #8595a8; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #8595a8; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "metal",
    "name": "金属科技",
    "group": "暗色 / 科技",
    "description": "冷灰金属反光，硬朗的工业科技感。",
    "styles": {
      "imagePreview": "background-color: #1e2228; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 4px; overflow: hidden; box-shadow: 0 4px 16px rgba(192,192,192,0.3); border: 1px solid #4d4d4d80;",
          "placeholder": "background: #282c34; transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease; filter: contrast(1.1) saturate(1.2);"
        },
        "nameContainer": "display: flex; align-items: center; gap: 10px;",
        "userName": "font-size: 15px; font-weight: 700; color: #f0f0f0; text-shadow: 0 2px 4px rgba(0,0,0,0.3);",
        "userId": "font-size: 12.5px; color: #a0a0a0; font-family: 'SF Pro Display';",
        "postTime": "font-size: 12px; color: #808080; letter-spacing: 0.03em;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #a0a0a0; font-size: 11.5px; border-top: 1px solid #4d4d4d80; background: rgba(30,34,40,0.95); backdrop-filter: blur(12px);",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #808080;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 700; color: #f0f0f0; text-shadow: 0 2px 4px rgba(0,0,0,0.3);",
          "after": ""
        },
        "h3": {
          "base": "margin: 28px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 700; color: #f0f0f0;",
          "after": ""
        },
        "base": {
          "base": "margin: 24px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 700; color: #f0f0f0;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.1em; font-size: 15px; color: #e0e0e0;",
      "emphasis": {
        "strong": "font-weight: 700; color: #4d8ee7; text-shadow: 0 2px 4px rgba(77,142,231,0.2);",
        "em": "font-style: normal; color: #a0a0a0; background: rgba(160,160,160,0.1); padding: 0 4px; border-left: 2px solid #4d4d4d80;",
        "del": "text-decoration: line-through; color: #808080; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 26px; margin-bottom: 1.2em; color: #c0c0c0;",
        "item": "margin-bottom: 0.7em; font-size: 15px; color: #c0c0c0; line-height: 1.75;",
        "taskList": "list-style: none; margin-left: -22px; font-size: 15px; color: #c0c0c0; line-height: 1.75;"
      },
      "code": {
        "block": "background: #282c34; padding: 1.2em; border-radius: 4px; font-size: 14px; font-family: 'JetBrains Mono', monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #e0e0e0; margin: 1.5em 0; border: 1px solid #4d4d4d80; box-shadow: inset 0 4px 12px rgba(0,0,0,0.2);",
        "inline": "background: #282c34; padding: 4px 10px; border-radius: 2px; color: #e0e0e0; font-size: 14px; font-family: 'JetBrains Mono', monospace; border: 1px solid #4d4d4d80;"
      },
      "quote": "border-left: 3px solid #4d8ee7; padding: 0 0 0 20px; margin: 1.5em 0; color: #a0a0a0; font-style: normal; font-size: 15px; line-height: 1.75; background: linear-gradient(to right, rgba(77,142,231,0.1), transparent);",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); border: 1px solid #4d4d4d80;",
      "link": "color: #4d8ee7; text-decoration: none; border-bottom: 1px solid #4d8ee780; transition: all 0.2s ease; text-shadow: 0 2px 4px rgba(77,142,231,0.1);",
      "table": {
        "container": "width: 100%; margin: 1.5em 0; border-collapse: separate; border-spacing: 0; border-radius: 4px; overflow: hidden; border: 1px solid #4d4d4d80; box-shadow: 0 4px 12px rgba(0,0,0,0.2);",
        "header": "background: linear-gradient(135deg, #282c34, #1e2228); font-weight: 700; color: #4d8ee7; padding: 14px; border-bottom: 2px solid #4d4d4d80;",
        "cell": "padding: 14px; color: #c0c0c0; border-top: 1px solid #4d4d4d80;"
      },
      "hr": "border: none; border-top: 2px solid #4d4d4d80; margin: 32px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.3);",
      "footnote": {
        "ref": "color: #a0a0a0; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #a0a0a0; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "studio-volt",
    "name": "高压工作室",
    "group": "暗色 / 科技",
    "description": "黑底电光黄，高电压的设计工作室能量。",
    "styles": {
      "imagePreview": "background-color: #111111; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #222220;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #ffffff;",
        "userId": "font-size: 12.5px; color: #8a8a84;",
        "postTime": "font-size: 12px; color: #6a6a64;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #e8e22a;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #7a7a74; font-size: 11.5px; border-top: 1px solid #262626; background: rgba(17,17,17,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #303030;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.92em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #ffffff;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #ffffff;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #ffffff;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #d6d6d2;",
      "emphasis": {
        "strong": "font-weight: 800; color: #e8e22a; background: rgba(232,226,42,0.14); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #f5ef6a; background: rgba(232,226,42,0.22); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #7a7a74; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #b2b2ac;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #b2b2ac; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #b2b2ac; line-height: 1.6;"
      },
      "code": {
        "block": "background: #0a0a0a; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #e8e22a; margin: 0.8em 0;",
        "inline": "background: #1d1d1d; padding: 2px 6px; border-radius: 4px; color: #e8e22a; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #e8e22a; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #b6b6b0; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(232,226,42,0.08); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 225px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.45); object-fit: contain;",
      "link": "color: #e8e22a; text-decoration: none; border-bottom: 1px solid #e8e22a55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(232,226,42,0.22); font-weight: 700; color: #ffffff; border-bottom: 1px solid #262626; padding: 8px;",
        "cell": "padding: 8px; color: #d6d6d2; border-bottom: 1px solid #262626;"
      },
      "hr": "border: none; border-top: 1px solid #262626; margin: 16px 0;",
      "footnote": {
        "ref": "color: #7a7a74; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #7a7a74; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "starry",
    "name": "星空梦境",
    "group": "暗色 / 科技",
    "description": "深紫夜空点缀星光，梦幻而辽阔。",
    "styles": {
      "imagePreview": "background-color: #0d0f1a; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 24px rgba(147,112,219,0.3); border: 1px solid #9370db80;",
          "placeholder": "background: linear-gradient(135deg, #252640, #1a1b2e); transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease; filter: brightness(1.1) contrast(1.05);"
        },
        "nameContainer": "display: flex; align-items: center; gap: 10px;",
        "userName": "font-size: 15px; font-weight: 700; color: #9370db; text-shadow: 0 2px 8px rgba(147,112,219,0.2);",
        "userId": "font-size: 12.5px; color: #b19cd9; font-family: 'SF Pro Text';",
        "postTime": "font-size: 12px; color: #8a7bb5; letter-spacing: 0.03em;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #b19cd9; font-size: 11.5px; border-top: 1px solid #252640; background: rgba(13,15,26,0.95); backdrop-filter: blur(12px);",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #8a7bb5;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 700; color: #9370db; text-shadow: 0 2px 8px rgba(147,112,219,0.15);",
          "after": ""
        },
        "h3": {
          "base": "margin: 28px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 700; color: #9370db;",
          "after": ""
        },
        "base": {
          "base": "margin: 24px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 700; color: #9370db;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.2em; font-size: 15px; color: #f0e6ff;",
      "emphasis": {
        "strong": "font-weight: 700; color: #9b59b6; text-shadow: 0 2px 8px rgba(155,89,182,0.2);",
        "em": "font-style: normal; color: #b19cd9; background: rgba(177,156,217,0.1); padding: 0 4px; border-left: 2px solid #b19cd980;",
        "del": "text-decoration: line-through; color: #8a7bb5; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 28px; margin-bottom: 1.2em; color: #d8cef6;",
        "item": "margin-bottom: 0.8em; font-size: 15px; color: #d8cef6; line-height: 1.8;",
        "taskList": "list-style: none; margin-left: -24px; font-size: 15px; color: #d8cef6; line-height: 1.8;"
      },
      "code": {
        "block": "background: #252640; padding: 1.2em; border-radius: 14px; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #d8cef6; margin: 1.5em 0; box-shadow: inset 0 4px 12px rgba(0,0,0,0.15), 0 2px 8px rgba(147,112,219,0.1); border: 1px solid #9370db80;",
        "inline": "background: #252640; padding: 4px 10px; border-radius: 6px; color: #d8cef6; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; border: 1px solid #9370db80;"
      },
      "quote": "border-left: 3px solid #b19cd9; padding: 0 0 0 20px; margin: 1.5em 0; color: #b19cd9; font-style: normal; font-size: 15px; line-height: 1.8; background: linear-gradient(to right, rgba(177,156,217,0.05), transparent);",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 14px; box-shadow: 0 8px 24px rgba(147,112,219,0.25); border: 1px solid #9370db80;",
      "link": "color: #9370db; text-decoration: none; background-image: linear-gradient(to right, #9370db80, #b19cd980); background-size: 0% 1px; background-repeat: no-repeat; background-position: 0 100%; transition: all 0.3s ease; text-shadow: 0 2px 4px rgba(147,112,219,0.1);",
      "table": {
        "container": "width: 100%; margin: 1.5em 0; border-collapse: separate; border-spacing: 0; border-radius: 14px; overflow: hidden; border: 1px solid #9370db80; box-shadow: 0 4px 12px rgba(147,112,219,0.15);",
        "header": "background: linear-gradient(135deg, #252640, #0d0f1a); font-weight: 700; color: #9370db; padding: 14px; border-bottom: 2px solid #9370db80;",
        "cell": "padding: 14px; color: #d8cef6; border-top: 1px solid #9370db80;"
      },
      "hr": "border: none; border-top: 2px solid #9370db80; margin: 32px 0; box-shadow: 0 2px 8px rgba(147,112,219,0.15);",
      "footnote": {
        "ref": "color: #b19cd9; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #b19cd9; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "editorial-mag",
    "name": "电子杂志暖刊",
    "group": "杂志 / 文艺",
    "description": "暖色刊物排版，像一本精致的电子杂志。",
    "styles": {
      "imagePreview": "background-color: #f2ecdd; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #e2dac6;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #23211a;",
        "userId": "font-size: 12.5px; color: #8c856e;",
        "postTime": "font-size: 12px; color: #a59d84;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #C0392B;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #9c937a; font-size: 11.5px; border-top: 1px solid #ddd5c0; background: rgba(242,236,221,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #cfc6ad;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.74em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #23211a;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #23211a;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #23211a;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #46412f;",
      "emphasis": {
        "strong": "font-weight: 800; color: #C0392B; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #7a2018; background: rgba(192,57,43,0.12); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #8c856e; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #5c5644;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #5c5644; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #5c5644; line-height: 1.6;"
      },
      "code": {
        "block": "background: #2a261c; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f2ecdd; margin: 0.85em 0;",
        "inline": "background: #e8e0cb; padding: 2px 6px; border-radius: 4px; color: #23211a; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #23211a; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #5c5644; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(35,33,26,0.05); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 5px 16px rgba(60,50,20,0.12); object-fit: contain;",
      "link": "color: #9c6b1a; text-decoration: none; border-bottom: 1px solid #9c6b1a55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(192,57,43,0.12); font-weight: 700; color: #23211a; border-bottom: 1px solid #ddd5c0; padding: 8px;",
        "cell": "padding: 8px; color: #46412f; border-bottom: 1px solid #ddd5c0;"
      },
      "hr": "border: none; border-top: 1px solid #ddd5c0; margin: 18px 0;",
      "footnote": {
        "ref": "color: #8c856e; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #8c856e; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "bold-signal",
    "name": "大字报黑金",
    "group": "杂志 / 文艺",
    "description": "黑底金字超大标题，宣言式的强冲击力。",
    "styles": {
      "imagePreview": "background-color: #161619; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #26262d;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #ffffff;",
        "userId": "font-size: 12.5px; color: #8a8a93;",
        "postTime": "font-size: 12px; color: #6a6a72;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #F0997B;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #7c7c86; font-size: 11.5px; border-top: 1px solid #2a2a30; background: rgba(22,22,25,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #33333a;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 2.0em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #ffffff;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #ffffff;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #ffffff;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #d6d6dc;",
      "emphasis": {
        "strong": "font-weight: 800; color: #F0997B; background: rgba(240,153,123,0.14); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #FBD9CB; background: rgba(240,153,123,0.22); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #7c7c86; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #b0b0b8;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #b0b0b8; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #b0b0b8; line-height: 1.6;"
      },
      "code": {
        "block": "background: #0e0e12; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f4d9cb; margin: 0.85em 0;",
        "inline": "background: #23232a; padding: 2px 6px; border-radius: 4px; color: #F0997B; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #F0997B; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #b9b9c2; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(240,153,123,0.08); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 230px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.45); object-fit: contain;",
      "link": "color: #F0997B; text-decoration: none; border-bottom: 1px solid #F0997B55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(240,153,123,0.22); font-weight: 700; color: #ffffff; border-bottom: 1px solid #2a2a30; padding: 8px;",
        "cell": "padding: 8px; color: #d6d6dc; border-bottom: 1px solid #2a2a30;"
      },
      "hr": "border: none; border-top: 1px solid #2a2a30; margin: 18px 0;",
      "footnote": {
        "ref": "color: #7c7c86; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #7c7c86; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "kraft-paper",
    "name": "牛皮纸",
    "group": "杂志 / 文艺",
    "description": "牛皮纸底纹，怀旧手作的复古质感。",
    "styles": {
      "imagePreview": "background-color: #ddccae; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #cdba95;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #3a2e1e;",
        "userId": "font-size: 12.5px; color: #8d7e5e;",
        "postTime": "font-size: 12px; color: #a3946f;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #8a4a1e;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #9c8d6c; font-size: 11.5px; border-top: 1px solid #cbb893; background: rgba(221,204,174,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #c3b08a;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.64em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #3a2e1e;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #3a2e1e;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #3a2e1e;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #4a3f2c;",
      "emphasis": {
        "strong": "font-weight: 800; color: #8a4a1e; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #3a2e1e; background: rgba(58,46,30,0.12); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #998a6a; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #5a4d36;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #5a4d36; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #5a4d36; line-height: 1.6;"
      },
      "code": {
        "block": "background: #2a2114; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f0e6cf; margin: 0.8em 0;",
        "inline": "background: #d2bf9a; padding: 2px 6px; border-radius: 4px; color: #3a2e1e; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #3a2e1e; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #5a4d36; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(58,46,30,0.06); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: none; object-fit: contain;",
      "link": "color: #8a4a1e; text-decoration: none; border-bottom: 1px solid #8a4a1e55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(58,46,30,0.12); font-weight: 700; color: #3a2e1e; border-bottom: 1px solid #cbb893; padding: 8px;",
        "cell": "padding: 8px; color: #4a3f2c; border-bottom: 1px solid #cbb893;"
      },
      "hr": "border: none; border-top: 1px solid #cbb893; margin: 16px 0;",
      "footnote": {
        "ref": "color: #998a6a; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #998a6a; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "dune",
    "name": "沙丘",
    "group": "杂志 / 文艺",
    "description": "沙色暖调，辽阔粗粝的大地气息。",
    "styles": {
      "imagePreview": "background-color: #ece0cc; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #ddd0ba;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #3a2e22;",
        "userId": "font-size: 12.5px; color: #9a8b76;",
        "postTime": "font-size: 12px; color: #aea08a;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #b5562f;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #a8997f; font-size: 11.5px; border-top: 1px solid #ddd0ba; background: rgba(236,224,204,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #cfc1a9;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.64em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #3a2e22;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #3a2e22;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #3a2e22;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #4a3f33;",
      "emphasis": {
        "strong": "font-weight: 800; color: #b5562f; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #3a2e22; background: rgba(181,86,47,0.12); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #a3947f; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #5c4f40;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #5c4f40; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #5c4f40; line-height: 1.6;"
      },
      "code": {
        "block": "background: #2c2318; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #ece0cc; margin: 0.8em 0;",
        "inline": "background: #e2d4bd; padding: 2px 6px; border-radius: 4px; color: #3a2e22; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #b5562f; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #5c4f40; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(181,86,47,0.06); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: none; object-fit: contain;",
      "link": "color: #b5562f; text-decoration: none; border-bottom: 1px solid #b5562f55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(181,86,47,0.12); font-weight: 700; color: #3a2e22; border-bottom: 1px solid #ddd0ba; padding: 8px;",
        "cell": "padding: 8px; color: #4a3f33; border-bottom: 1px solid #ddd0ba;"
      },
      "hr": "border: none; border-top: 1px solid #ddd0ba; margin: 16px 0;",
      "footnote": {
        "ref": "color: #a3947f; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #a3947f; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "mat-midcentury",
    "name": "中世暖橘",
    "group": "杂志 / 文艺",
    "description": "暗哑绿配灼橘，中世纪现代的木质暖调。",
    "styles": {
      "imagePreview": "background-color: #3a423a; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #414a41;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #f0ece0;",
        "userId": "font-size: 12.5px; color: #9aa18f;",
        "postTime": "font-size: 12px; color: #7e8574;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #c4622d;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #8a917f; font-size: 11.5px; border-top: 1px solid #4a534a; background: rgba(58,66,58,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #525b52;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.64em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #f0ece0;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #f0ece0;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #f0ece0;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #d7dccf;",
      "emphasis": {
        "strong": "font-weight: 800; color: #c4622d; background: rgba(196,98,45,0.16); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #e89a6a; background: rgba(196,98,45,0.20); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #8a917f; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #c3c9b8;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #c3c9b8; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #c3c9b8; line-height: 1.6;"
      },
      "code": {
        "block": "background: #252a25; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f0ece0; margin: 0.8em 0;",
        "inline": "background: #434c43; padding: 2px 6px; border-radius: 4px; color: #e3c9a0; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #c4622d; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #c3c9b8; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(196,98,45,0.10); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 225px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.32); object-fit: contain;",
      "link": "color: #c4622d; text-decoration: none; border-bottom: 1px solid #c4622d55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(196,98,45,0.20); font-weight: 700; color: #f0ece0; border-bottom: 1px solid #4a534a; padding: 8px;",
        "cell": "padding: 8px; color: #d7dccf; border-bottom: 1px solid #4a534a;"
      },
      "hr": "border: none; border-top: 1px solid #4a534a; margin: 16px 0;",
      "footnote": {
        "ref": "color: #8a917f; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #8a917f; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "yueling",
    "name": "悦灵雅棕",
    "group": "杂志 / 文艺",
    "description": "雅致棕调，温润耐看的轻奢气质。",
    "styles": {
      "imagePreview": "background-color: #1c1c1e; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 12px; overflow: hidden;",
          "placeholder": "background: #2c2c2e; transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 8px;",
        "userName": "font-size: 15px; font-weight: 600; color: #ffffff;",
        "userId": "font-size: 12.5px; color: #98989d;",
        "postTime": "font-size: 12px; color: #636366;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #98989d; font-size: 11.5px; border-top: 1px solid #2c2c2e; background: #1c1c1e;",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #636366;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 600; color: #f2f2f7;",
          "after": ""
        },
        "h3": {
          "base": "margin: 26px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 600; color: #f2f2f7;",
          "after": ""
        },
        "base": {
          "base": "margin: 22px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 600; color: #f2f2f7;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.1em; font-size: 15px; color: #ffffff;",
      "emphasis": {
        "strong": "font-weight: 700; color: #c57512;",
        "em": "font-style: italic; color: #c57512;",
        "del": "text-decoration: line-through; color: #636366;"
      },
      "list": {
        "container": "padding-left: 26px; margin-bottom: 1.1em; color: #d1d1d6;",
        "item": "margin-bottom: 0.7em; font-size: 15px; color: #d1d1d6; line-height: 1.75;",
        "taskList": "list-style: none; margin-left: -22px; font-size: 15px; color: #d1d1d6; line-height: 1.75;"
      },
      "code": {
        "block": "background: #2c2c2e; padding: 1em 1.2em; border-radius: 12px; font-size: 14px; font-family: SF Mono, Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #ffffff; margin: 1.3em 0;",
        "inline": "background: #2c2c2e; padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 14px; font-family: SF Mono, Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #c57512; padding: 0 0 0 18px; margin: 1.2em 0; color: #f2f2f7; font-style: normal; font-size: 15px; line-height: 1.75;",
      "image": "max-width: 100%; height: auto; margin: 1.3em auto; border-radius: 12px;",
      "link": "color: #c57512; text-decoration: underline; text-underline-offset: 2px; transition: opacity 0.2s ease;",
      "table": {
        "container": "width: 100%; margin: 1.3em 0; border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; border: 1px solid #2c2c2e;",
        "header": "background: #2c2c2e; font-weight: 600; color: #f2f2f7; padding: 12px;",
        "cell": "padding: 12px; color: #d1d1d6; border-top: 1px solid #2c2c2e;"
      },
      "hr": "border: none; border-top: 1px solid #2c2c2e; margin: 26px 0;",
      "footnote": {
        "ref": "color: #98989d; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #98989d; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "ink-cn",
    "name": "新中式水墨",
    "group": "东方 / 自然",
    "description": "留白与墨韵，含蓄雅致的新中式气质。",
    "styles": {
      "imagePreview": "background-color: #f4f1e9; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #e3dece;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #1f1d1a;",
        "userId": "font-size: 12.5px; color: #9a958b;",
        "postTime": "font-size: 12px; color: #b2ac9f;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #9e2a2b;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #a39e92; font-size: 11.5px; border-top: 1px solid #e0dccf; background: rgba(244,241,233,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #d2ccbb;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.7em; line-height: 1.24; letter-spacing: -0.01em;",
          "content": "font-weight: 700; color: #1f1d1a;",
          "after": ""
        },
        "h3": {
          "base": "margin: 18px 0 8px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #1f1d1a;",
          "after": ""
        },
        "base": {
          "base": "margin: 14px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #1f1d1a;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.72em; font-size: 15px; color: #3a3733;",
      "emphasis": {
        "strong": "font-weight: 800; color: #9e2a2b; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #7a1e1f; background: rgba(158,42,43,0.10); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #9a958b; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.72em; color: #54504a;",
        "item": "margin: 0 0 0.42em; font-size: 15px; color: #54504a; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #54504a; line-height: 1.6;"
      },
      "code": {
        "block": "background: #1f1d1a; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f4f1e9; margin: 0.85em 0;",
        "inline": "background: #e6e1d2; padding: 2px 6px; border-radius: 4px; color: #1f1d1a; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #9e2a2b; padding: 2px 0 2px 12px; margin: 0.75em 0; color: #54504a; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(158,42,43,0.04); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.62em auto; border-radius: 8px; box-shadow: 0 5px 16px rgba(40,35,25,0.10); object-fit: contain;",
      "link": "color: #9e2a2b; text-decoration: none; border-bottom: 1px solid #9e2a2b55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(158,42,43,0.10); font-weight: 700; color: #1f1d1a; border-bottom: 1px solid #e0dccf; padding: 8px;",
        "cell": "padding: 8px; color: #3a3733; border-bottom: 1px solid #e0dccf;"
      },
      "hr": "border: none; border-top: 1px solid #e0dccf; margin: 18px 0;",
      "footnote": {
        "ref": "color: #9a958b; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #9a958b; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "ink-classic",
    "name": "墨水经典",
    "group": "东方 / 自然",
    "description": "黑白水墨书卷气，沉稳通用的文人调。",
    "styles": {
      "imagePreview": "background-color: #f3efe6; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #e6e0d0;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #1a1814;",
        "userId": "font-size: 12.5px; color: #8f8a7e;",
        "postTime": "font-size: 12px; color: #a8a294;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #2b4a6f;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #a39e90; font-size: 11.5px; border-top: 1px solid #e4ded0; background: rgba(243,239,230,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #d3ccbc;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.66em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #1a1814;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #1a1814;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #1a1814;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #2c2a24;",
      "emphasis": {
        "strong": "font-weight: 800; color: #2b4a6f; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #1a1814; background: rgba(43,74,111,0.10); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #9a958a; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #46433a;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #46433a; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #46433a; line-height: 1.6;"
      },
      "code": {
        "block": "background: #1a1814; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #f3efe6; margin: 0.8em 0;",
        "inline": "background: #ece6d6; padding: 2px 6px; border-radius: 4px; color: #1a1814; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #2b4a6f; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #4a473e; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(43,74,111,0.05); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: none; object-fit: contain;",
      "link": "color: #2b4a6f; text-decoration: none; border-bottom: 1px solid #2b4a6f55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(43,74,111,0.10); font-weight: 700; color: #1a1814; border-bottom: 1px solid #e4ded0; padding: 8px;",
        "cell": "padding: 8px; color: #2c2a24; border-bottom: 1px solid #e4ded0;"
      },
      "hr": "border: none; border-top: 1px solid #e4ded0; margin: 16px 0;",
      "footnote": {
        "ref": "color: #9a958a; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #9a958a; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "indigo-porcelain",
    "name": "靛蓝瓷",
    "group": "东方 / 自然",
    "description": "靛蓝如瓷，清雅而有东方器物感。",
    "styles": {
      "imagePreview": "background-color: #eef1f6; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #dde3ec;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #243a66;",
        "userId": "font-size: 12.5px; color: #8893a3;",
        "postTime": "font-size: 12px; color: #a3adbb;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #243a66;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #99a3b2; font-size: 11.5px; border-top: 1px solid #dde3ec; background: rgba(238,241,246,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #cfd6e1;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.64em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #243a66;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #243a66;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #243a66;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #37414f;",
      "emphasis": {
        "strong": "font-weight: 800; color: #243a66; background: rgba(36,58,102,0.08); padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #1a2c4f; background: rgba(36,58,102,0.12); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #8893a3; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #3d4858;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #3d4858; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #3d4858; line-height: 1.6;"
      },
      "code": {
        "block": "background: #1a2336; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #eef1f6; margin: 0.8em 0;",
        "inline": "background: #e3e8f0; padding: 2px 6px; border-radius: 4px; color: #243a66; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #243a66; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #3d4858; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(36,58,102,0.05); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: none; object-fit: contain;",
      "link": "color: #243a66; text-decoration: none; border-bottom: 1px solid #243a6655;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(36,58,102,0.12); font-weight: 700; color: #243a66; border-bottom: 1px solid #dde3ec; padding: 8px;",
        "cell": "padding: 8px; color: #37414f; border-bottom: 1px solid #dde3ec;"
      },
      "hr": "border: none; border-top: 1px solid #dde3ec; margin: 16px 0;",
      "footnote": {
        "ref": "color: #8893a3; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #8893a3; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "forest-ink",
    "name": "森林墨",
    "group": "东方 / 自然",
    "description": "墨绿沉色，安静内敛的林间书写感。",
    "styles": {
      "imagePreview": "background-color: #e9ede4; padding: 20px 22px 40px; box-sizing: border-box;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 9px; overflow: hidden;",
          "placeholder": "background: #dbe1d1;",
          "image": "object-fit: cover;"
        },
        "nameContainer": "display: flex; align-items: center; gap: 6px;",
        "userName": "font-size: 15px; font-weight: 700; color: #1f3a2c;",
        "userId": "font-size: 12.5px; color: #8d9784;",
        "postTime": "font-size: 12px; color: #a3ad99;",
        "verifiedIcon": "width: 18px; height: 18px; margin-left: -3px; fill: #1f3a2c;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 7px 18px; color: #9aa48f; font-size: 11.5px; border-top: 1px solid #d9e0d2; background: rgba(233,237,228,0.96);",
        "text": "color: inherit; white-space: nowrap;",
        "separator": "color: #cdd4c2;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.64em; line-height: 1.26; letter-spacing: -0.01em;",
          "content": "font-weight: 800; color: #1f3a2c;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "h3": {
          "base": "margin: 16px 0 7px; font-size: 1.18em; line-height: 1.36;",
          "content": "font-weight: 700; color: #1f3a2c;font-family: Georgia, 'Times New Roman', 'Songti SC', '宋体', serif;",
          "after": ""
        },
        "base": {
          "base": "margin: 13px 0 6px; font-size: 1.05em; line-height: 1.35;",
          "content": "font-weight: 700; color: #1f3a2c;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.62; margin: 0 0 0.7em; font-size: 15px; color: #3a4239;",
      "emphasis": {
        "strong": "font-weight: 800; color: #a0522d; background: transparent; padding: 0 3px; border-radius: 3px;",
        "em": "font-style: normal; color: #1f3a2c; background: rgba(31,58,44,0.10); padding: 0 4px; border-radius: 3px;",
        "del": "text-decoration: line-through; color: #909a89; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 22px; margin: 0 0 0.7em; color: #46503f;",
        "item": "margin: 0 0 0.4em; font-size: 15px; color: #46503f; line-height: 1.6;",
        "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #46503f; line-height: 1.6;"
      },
      "code": {
        "block": "background: #16241b; padding: 0.8em 0.95em; border-radius: 8px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; color: #e9ede4; margin: 0.8em 0;",
        "inline": "background: #dde3d4; padding: 2px 6px; border-radius: 4px; color: #1f3a2c; font-size: 14px; font-family: 'SF Mono', Menlo, monospace;"
      },
      "quote": "border-left: 3px solid #1f3a2c; padding: 2px 0 2px 12px; margin: 0.7em 0; color: #46503f; font-style: normal; font-size: 15px; line-height: 1.6; background: rgba(31,58,44,0.05); border-radius: 0 4px 4px 0;",
      "image": "max-width: 100%; max-height: 235px; height: auto; margin: 0.6em auto; border-radius: 8px; box-shadow: none; object-fit: contain;",
      "link": "color: #1f3a2c; text-decoration: none; border-bottom: 1px solid #1f3a2c55;",
      "table": {
        "container": "width: 100%; margin: 0.8em 0; border-collapse: collapse; font-size: 13px;",
        "header": "background: rgba(31,58,44,0.10); font-weight: 700; color: #1f3a2c; border-bottom: 1px solid #d9e0d2; padding: 8px;",
        "cell": "padding: 8px; color: #3a4239; border-bottom: 1px solid #d9e0d2;"
      },
      "hr": "border: none; border-top: 1px solid #d9e0d2; margin: 16px 0;",
      "footnote": {
        "ref": "color: #909a89; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #909a89; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "forest",
    "name": "森林清晨",
    "group": "东方 / 自然",
    "description": "草木绿与雾白，清新自然的呼吸感。",
    "styles": {
      "imagePreview": "background-color: #1a2420; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(46,204,113,0.15); border: 1px solid #2ecc7180;",
          "placeholder": "background: #243830; transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease; filter: brightness(1.05);"
        },
        "nameContainer": "display: flex; align-items: center; gap: 10px;",
        "userName": "font-size: 15px; font-weight: 600; color: #2ecc71; text-shadow: 0 2px 4px rgba(46,204,113,0.1);",
        "userId": "font-size: 12.5px; color: #27ae60; font-family: 'SF Pro Text';",
        "postTime": "font-size: 12px; color: #16a085; letter-spacing: 0.02em;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #27ae60; font-size: 11.5px; border-top: 1px solid #2ecc7140; background: rgba(26,36,32,0.95); backdrop-filter: blur(12px);",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #16a085;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 600; color: #2ecc71; text-shadow: 0 2px 4px rgba(46,204,113,0.1);",
          "after": ""
        },
        "h3": {
          "base": "margin: 28px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 600; color: #2ecc71;",
          "after": ""
        },
        "base": {
          "base": "margin: 24px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 600; color: #2ecc71;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.1em; font-size: 15px; color: #e8f5e9;",
      "emphasis": {
        "strong": "font-weight: 700; color: #2ecc71; text-shadow: 0 2px 4px rgba(46,204,113,0.2);",
        "em": "font-style: normal; color: #27ae60; background: rgba(39,174,96,0.1); padding: 0 4px; border-radius: 2px;",
        "del": "text-decoration: line-through; color: #16a085; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 26px; margin-bottom: 1.2em; color: #a8e6cf;",
        "item": "margin-bottom: 0.7em; font-size: 15px; color: #a8e6cf; line-height: 1.75;",
        "taskList": "list-style: none; margin-left: -22px; font-size: 15px; color: #a8e6cf; line-height: 1.75;"
      },
      "code": {
        "block": "background: #243830; padding: 1.2em; border-radius: 14px; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #a8e6cf; margin: 1.5em 0; box-shadow: inset 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #2ecc7180;",
        "inline": "background: #243830; padding: 4px 10px; border-radius: 6px; color: #a8e6cf; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; border: 1px solid #2ecc7180;"
      },
      "quote": "border-left: 3px solid #2ecc71; padding: 0 0 0 20px; margin: 1.5em 0; color: #27ae60; font-style: normal; font-size: 15px; line-height: 1.75; background: rgba(46,204,113,0.05);",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 14px; box-shadow: 0 8px 24px rgba(46,204,113,0.1); border: 1px solid #2ecc7180;",
      "link": "color: #2ecc71; text-decoration: none; border-bottom: 1px solid #2ecc7180; transition: all 0.2s ease; text-shadow: 0 2px 4px rgba(46,204,113,0.1);",
      "table": {
        "container": "width: 100%; margin: 1.5em 0; border-collapse: separate; border-spacing: 0; border-radius: 14px; overflow: hidden; border: 1px solid #2ecc7180; box-shadow: 0 4px 12px rgba(46,204,113,0.1);",
        "header": "background: #243830; font-weight: 600; color: #2ecc71; padding: 14px; border-bottom: 1px solid #2ecc7180;",
        "cell": "padding: 14px; color: #a8e6cf; border-top: 1px solid #2ecc7180;"
      },
      "hr": "border: none; border-top: 1px solid #2ecc7180; margin: 32px 0; box-shadow: 0 2px 8px rgba(46,204,113,0.1);",
      "footnote": {
        "ref": "color: #27ae60; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #27ae60; text-decoration: none; font-size: 0.9em;"
      }
    }
  },
  {
    "id": "ocean",
    "name": "深海之境",
    "group": "东方 / 自然",
    "description": "深蓝层叠，安静幽邃的海洋色温。",
    "styles": {
      "imagePreview": "background-color: #0a192f; padding: 20px 22px 40px;",
      "header": {
        "avatar": {
          "container": "width: 32px; height: 32px; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(64,169,255,0.25); border: 1px solid #1d3552;",
          "placeholder": "background: linear-gradient(135deg, #112a45, #1d3552); transition: all 0.3s ease;",
          "image": "object-fit: cover; transition: transform 0.3s ease; filter: brightness(1.1) contrast(1.05);"
        },
        "nameContainer": "display: flex; align-items: center; gap: 10px;",
        "userName": "font-size: 15px; font-weight: 700; color: #40a9ff; text-shadow: 0 2px 8px rgba(64,169,255,0.2);",
        "userId": "font-size: 12.5px; color: #69c0ff; font-family: 'SF Pro Text';",
        "postTime": "font-size: 12px; color: #91d5ff; letter-spacing: 0.03em;",
        "verifiedIcon": "width: 20px; height: 20px; margin-left: -5px; fill: #1DA1F2;"
      },
      "footer": {
        "container": "position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 7px 18px; color: #69c0ff; font-size: 11.5px; border-top: 1px solid #1d3552; background: rgba(10,25,47,0.95); backdrop-filter: blur(12px);",
        "text": "color: inherit; transition: color 0.2s ease; white-space: nowrap;",
        "separator": "color: #91d5ff;"
      },
      "title": {
        "h2": {
          "base": "margin: 0; font-size: 1.5em; letter-spacing: -0.01em; line-height: 1.5;",
          "content": "font-weight: 700; color: #40a9ff; text-shadow: 0 2px 8px rgba(64,169,255,0.15);",
          "after": ""
        },
        "h3": {
          "base": "margin: 28px 0 0; font-size: 1.25em; line-height: 1.5;",
          "content": "font-weight: 700; color: #40a9ff;",
          "after": ""
        },
        "base": {
          "base": "margin: 24px 0 0; font-size: 1.1em; line-height: 1.5;",
          "content": "font-weight: 700; color: #40a9ff;",
          "after": ""
        }
      },
      "paragraph": "line-height: 1.8; margin-bottom: 1.2em; font-size: 15px; color: #e6f7ff;",
      "emphasis": {
        "strong": "font-weight: 700; color: #40a9ff; text-shadow: 0 2px 8px rgba(64,169,255,0.2);",
        "em": "font-style: normal; color: #69c0ff; background: rgba(105,192,255,0.1); padding: 0 4px; border-left: 2px solid #69c0ff80;",
        "del": "text-decoration: line-through; color: #91d5ff; opacity: 0.8;"
      },
      "list": {
        "container": "padding-left: 28px; margin-bottom: 1.2em; color: #bae7ff;",
        "item": "margin-bottom: 0.8em; font-size: 15px; color: #bae7ff; line-height: 1.8;",
        "taskList": "list-style: none; margin-left: -24px; font-size: 15px; color: #bae7ff; line-height: 1.8;"
      },
      "code": {
        "block": "background: #112a45; padding: 1.2em; border-radius: 14px; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #bae7ff; margin: 1.5em 0; box-shadow: inset 0 4px 12px rgba(0,0,0,0.15), 0 2px 8px rgba(64,169,255,0.1); border: 1px solid #1d3552;",
        "inline": "background: #112a45; padding: 4px 10px; border-radius: 6px; color: #bae7ff; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; border: 1px solid #1d3552;"
      },
      "quote": "border-left: 3px solid #40a9ff; padding: 0 0 0 20px; margin: 1.5em 0; color: #69c0ff; font-style: normal; font-size: 15px; line-height: 1.8; background: linear-gradient(to right, rgba(64,169,255,0.05), transparent);",
      "image": "max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 14px; box-shadow: 0 8px 24px rgba(64,169,255,0.25); border: 1px solid #69c0ff80;",
      "link": "color: #40a9ff; text-decoration: none; border-bottom: 1px solid rgba(64,169,255,0.3); transition: all 0.2s ease; text-shadow: 0 2px 4px rgba(64,169,255,0.1);",
      "table": {
        "container": "width: 100%; margin: 1.5em 0; border-collapse: separate; border-spacing: 0; border-radius: 14px; overflow: hidden; border: 1px solid #1d3552; box-shadow: 0 4px 12px rgba(64,169,255,0.15);",
        "header": "background: linear-gradient(135deg, #112a45, #0a192f); font-weight: 700; color: #40a9ff; padding: 14px; border-bottom: 2px solid #1d3552;",
        "cell": "padding: 14px; color: #bae7ff; border-top: 1px solid #1d3552;"
      },
      "hr": "border: none; border-top: 2px solid #1d3552; margin: 32px 0; box-shadow: 0 2px 8px rgba(64,169,255,0.15);",
      "footnote": {
        "ref": "color: #69c0ff; text-decoration: none; font-size: 0.9em;",
        "backref": "color: #69c0ff; text-decoration: none; font-size: 0.9em;"
      }
    }
  }
]
