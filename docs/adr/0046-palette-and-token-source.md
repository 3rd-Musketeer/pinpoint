# 0046 · 全站一套调色板与一份 token 源；正文排版用 Tailwind Typography 加中文细节；圆角统一

Status: 现行 · Date: 2026-10-15 · Supersedes: 0010（accent 值、语义红 / 绿）、0011（钢灰蓝） · Scope: `scripts/tokens/source.mjs`、`scripts/build-tokens.mjs`、`src/workbench/wb-tokens.css`、`src/shared/ann-tokens.js`、`src/shared/ann-status.js`、`src/client/annotate-css.js`、`src/shared/ann-list.css`、`index.html`、`site/src/styles/`、`site/src/lib/rehype-table-scroll.js`、`site/src/layouts/Base.astro`、`content/kits/figure/`

**起因**：截至 2026-10-15，pinpoint 自己的界面有四份 token 值：工作台生成器、注入端钉值、文章站点、图 kit。工作台和注入端是钢灰蓝 `#5b7fa6` 加 Radix slate，站点和图 kit 是绿 `#0e8f6c` 加纯灰。读者从文章点进画布视图，强调色、灰的色温、圆角都会变。站点字号写死了 15 种，正文排版看着别扭（owner：“现在正文的间距、字号规范、布局与排版，依旧看起来怪怪的”）。owner：“看起来需要定一下我们的 palette？当个事儿办”。

**Decided**（owner 2026-10-15 在 palette probe 的浮动调色板上选定并导出，原文 `tasks/2026-10-15-palette/probe/chosen.json`；加实现时自定的部分）：

- **强调色全站一个：绿 A 青绿 `#0e8f6c`**，工作台也换绿，取代 0010 / 0011 的钢灰蓝。owner 看过 6 套橙色方案之后说：“感觉还是绿色好”。12 档色阶以 `#0e8f6c` 为第 9 档；色块用 green 9，实底压白字（主按钮、钉子、“标注”段）用 green 10 `#008564`，正文里的强调字用 green 11 `#007658`。工作台的 `--wb-accent` 取 green 10。
- **中性色用纯灰（Radix gray 12 档）**，工作台也从 slate 换过来。owner：“纯灰色吧，看起来更加温暖”。
- **标注四态用候选 2**：open `#1f5f8f`、check `#b85a14`、done `#7a4fd0`、close `#8d8d8d`；暗色取 probe 同名方案（`#5b9fd6` / `#d9782a` / `#8a5ae0` / `#8a8a8a`），暗色下 open、check、close 的钉上数字是深字。
- **危险色保持 `#c0392b`，圈选描边保持 `#f5a623`**（chosen.json 里两项都是“现值”）。
- **一份 token 源**：`scripts/tokens/source.mjs` 是纯数据（基础色阶 → 22 个语义色 → 四态、字体、圆角、字号、行高、阴影、正文排版层）。`scripts/build-tokens.mjs` 一次写四份产物：工作台 `src/workbench/wb-tokens.css`（`--wb-*` 名字不变）、注入端 `src/shared/ann-tokens.js`（字面量钉值串）、站点 `site/src/styles/tokens.css`（`--pp-*`）、图 kit `content/kits/figure/figure-palette.css`（`--fig-*`）。每份产物的新鲜度由 `scripts/build-tokens.test.js` 守；注入端另有对账单测比对亮暗钉值和全部 `var()` 兜底。iOS kit 不进源，它是被评审的内容。
- **正文排版用第 7 套**：Tailwind Typography 0.5.20 的 prose 原样 vendor 进 `site/src/styles/vendor/`，适配层把颜色接到 `--pp-*`、尺度接到 `--pp-prose-*`；中文细节是 `text-autospace`、`text-spacing-trim`、标题 600、行高 1.8、行宽 40em。owner：“7 不错……如果表格比较长可以允许横向滚动”。
- **表格是宽块**：不受 40em 行宽限制，最宽到正文栏，与画布卡片对齐；列宽按内容，放不下才横向滚动。owner 看了第 6 节的对比表说：“现在的表格有点挤，感觉没有做自适应的宽度？”
- **圆角全站一套阶梯** 4 / 6 / 8 / 12 / 16 / 20，加玻璃 14、药丸 999；文章卡片 12，画布卡 16，手机机身 22 留在阶梯外。owner：“最好都统一吧”。
- **`[[ ]]` 芯片不画下划线**，只留左侧圆点。owner：“感觉这个下划线不用了，可以去掉，左侧的这个圆形够了”。

实现时自定的：

- 工作台的元数据色 `--wb-faint` 并到次要字 gray 11（probe 的映射；原 gray 9 对白底只有 3.3:1），发丝线和结构缝从黑 7% / 9% 改成实色 gray 5 / gray 7。暗色网格线保留比亮色深一档（16% / 7%）。
- close 钉子仍是实心灰圆，没有改成 probe 样例页里的空心圈：配色 owner 选定了，钉子形状不在 chosen.json 里。
- 注入端也认文章站点的 `data-theme`：读者手动切暗，注入的评论界面跟着暗。
- 生成物落在 `src/shared/ann-tokens.js` 而不是 `src/client/`：`ann-status.js` 也读它，shared 不反向依赖 client。

**Why**：同一个读者在文章和画布之间来回走，强调色、灰、圆角是一套，界面才读得出是一件东西。四份值靠人手同步，单测只守玻璃 5 个值，迟早分家；一份源加新鲜度测试，让“改一处、四处跟着变”成为唯一的改法。Tailwind Typography 是主流 blog 里尺度最成体系的一套，全部用 em 和变量，换颜色只改一段映射，`not-prose` 正好豁免画布卡片和图；它缺的中文部分，两个原生 CSS 属性加几条字重、行高规则就补齐，不需要 heti 的 JS，评论高亮依赖的文本节点保持原样。

**被否的**：橙色强调色（6 套方案，owner 选回绿）；slate 中性灰；危险色加深到 `#b42318`；四态候选 1（open 跟强调色）；heti、GitHub Markdown CSS、Astro blog、Hugo PaperMod 四套正文样式。
