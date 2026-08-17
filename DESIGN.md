# DESIGN — pinpoint 设计语言正典

当前有效的设计语言只写在这里；被取代就改本文，不留尸骸。

分工：本文 = **现在是什么样**（正典）。为什么这么变、什么时候定的 → [decisions.md](decisions.md)（索引在文件顶部）。某个 token 值的理由 → `scripts/build-wb-tokens.mjs` / `workbench/wb-tokens.css` 注释。UI 文案（写什么字）→ [topics/ui-text](../../ui-text/)，本文引用不复制。

## 原则

1. **装饰即功能**：每个视觉元素必须回答「它标记、组织或反馈什么真实信息」。答不上来就删（判例：铭牌铆钉、画布角十字，decisions 2026-08-15）。
2. **层级靠线宽与明度阶梯，不靠颜色数量**。三级线各有语义：发丝（格内细分）→ 结构缝 `--wb-seam`（pane 分界）→ 图框（sheet 边界）。
3. **复古感由字体与编号体系承载**（mono + tabular-nums + 字距 + A1 / REV 这类编号词汇），不由质感贴皮承载（做旧、铆钉、假材质）。
4. **丰富由真实数据产生**；系统的职责是 hold 住它，不加戏。
5. **全场只允许一个签名物**（当前 = REV chip）。一个是意图，十个是噪音。
6. **情感来自行为的周密**（hover 联动、即时回显、克制动效），不来自表皮。

## 色彩

- 画布纸 `#faf8f4`；chrome 白面；ink `#1c2024`；muted `#6b6b70`。
- accent = 钢灰蓝 `#5b7fa6`：可交互 / 当前 / 系统标注语义；全页唯一实心 on 态。chrome 与 iOS kit 内容分色，内容侧 `#007aff` 不变。（decisions 08-13 → 08-14）
- 语义红 `#b84230`（08-13 收编的降饱和 danger）只给失效 / 过期 / 危险确认；琥珀 `#f5a623` 保留为标注武装功能色（双端一致信号）。
- 发丝线 / 浅面 / muted 由 accent color-mix 派生，不另立色相。
- 单 light 主题，不做 dark。

## 字体与排印

- 系统字栈（Apple）。mono（ui-monospace / SF Mono）给机器精度信息：编号、日期、尺寸、id、引用号；读数 tabular-nums。
- 区头 / eyebrow：10.5px semibold + 字距，英文可大写。
- 图标 = SVG 线性（lucide 族，约 1.7px 描边），emoji 不当图标。
- 文案不用「·」拼合信息：层级用版面表达（分行 / eyebrow / chip / 字重）。判据与 case 归 [ui-text](../../ui-text/) 规则 8。

## 画布（图纸人格）

- 双线网格 24 / 120px + sheet 外框。内图框与角部十字 2026-08-15 退役（屏幕上无对应物，边界信号与外框重复）。
- 画布背景三态（网格 / 圆点纸 / 空白）在设置视图，不占标注操作区（任务高频留底栏，环境低频进设置）；圆点 = accent 34% 透明度 1.2px。
- 图注 = 两行（引用号 + 屏名），frame 上方左对齐；尺寸在 frame 下方居中，mono 小字。
- 引用法：section 用字母，frame 用数字（A1 / A2 / B3）。人对 agent 说 A2；机器引用仍走 `@frame:id`。
- 比例读法：zoom 100% 视觉为原稿一半，写作 1:2，HUD 按图纸比例显示（2026-08-17 基准重定标：视觉 = zoom × 0.5，0.5 烘在基准，decisions 08-17c）。

## 侧栏分工（已拍定，已落地）

- 左栏 = 页面上下文：Pages（单一列表：本地页 + registry dir 条目混排，行内壳标记区分机壳/文档；模式 Seg 2026-08-16 随 Web 退役一并退役，decisions 08-16b）→ 大纲（当前页 section → frame 树：引用号 + 屏名 + 计数徽标（红 = 含失效锚点）；点击定位 frame，与标注卡焦点双向同步；层次 = 延伸线结构：14px rail 槽位、字母与导线同轴、逐行拼接、末行收 └ 角，decisions 08-15c）→ 设置（齿轮进设置视图）。更改栏与铭牌是 REV 机制的展示面，随 REV 缓期（见下），不进第一批。宽度 200–480 拖拽（默认 250），双击 splitter 折叠。
- 右栏 = 标注工作台：head（计数钉 + 收起）→ meta（status + 清空两段确认）→ 卡片列表（白卡 + accent 淡描边 + radius 8 + 分组 eyebrow）→ 底栏（模式单钮 + 画布批注 dropdown）。可整栏折叠，画布两缘浮钮复开，右钮带计数。宽度 260–440 拖拽（默认 308，双击 splitter 复位，`annPanelWidth` 持久化）；<280 进紧凑态：卡片藏 cap + 文本单行，底栏批注 dropdown 收 图标+值（decisions 08-16）。
- 模式切换 = 单钮点按；标注中 = 实心 accent（全页唯一实心 on 态），交互 = 浅面。
- 交互模式保留图钉（opacity .38 + pointer-events:none）；气泡仅标注模式。
- 锚点失效 = 整卡红描边 + 红浅面 + 文本退灰 + 序号钉转红，不用 tag。
- 画布批注三态：隐藏批注 / 叠在页面 / 右侧通道（通道 = 画布右缘 gutter，内容让位）。

## 版本管理（REV 协议）

**2026-08-15 缓期进 backlog**：owner 复评——当前迭代节奏下「这条标注针对哪一版」不是真实痛点（chat 即 changelog）。完整设计与分期预案见 decisions.md 2026-08-15 / 08-15b 条目与 `.gdd/backlog.md`；视觉储备在体验板。痛点信号出现前不要实现。

## 导出（2026-08-15d 拍定，已落地）

- 单入口：HUD「导出」→ picker 对话框；per-frame / per-section 触发器与 ⋯ 菜单里的导出入口已删除（菜单本体保留剩余项）。
- picker 两栏：左 proto tree（section 整选 / frame 任意勾选），右实时预览（选中几帧并排几帧，随背景刷新；复用 `/api/export-image` 低清档 + debounce，不起新管线）。
- 批量规则：任意多选；单张直出 PNG，多张 `/api/export-zip` 打包（store-only zip，`server/lib/zip-store.js`）。
- 固定项：PNG、2×。选项只留对应真实投放面的：背景三档（画布 / 白底 / 透明）。批注烘焙（序号钉 + 评论随图）缓期进 backlog——场景未证实；doc 导出「含评论」管线在线保留。
- 图纸内容（图注 = 引用号 + 屏名 + 尺寸）导出永随，不再有「干净画面」摘图注语义。note 自 2026-08-17 起不上画布、不进导出（注入导出图随导出系统重构另立，backlog）。

## 选中模型与 note（2026-08-17）

- 画布点选：点 frame 图注（cap/dim 行）选 frame，点 section 大标题选 section，点板空白清选中；frame 内部点击永远留给原型交互，标注模式下选择让位给标注客户端。选中态 = 持久 accent 环（frame）/ 标题转 accent（section），与定位反馈的 flash 环分工。
- 右栏 = detail 面板（上段，选中才展开）+ 标注工作台。detail 展示选中对象的引用号 / 标题 / note；note 编辑走 revision 链路（GET 拉 revision → PUT 带 baseRevision，409 保留草稿）。
- note 两级挂载：`sections[].note` 承载整组共用说明（图例 / 对比结论），`screens[].note` 承载单帧说明；都不再渲染上画布。
- title 规矩：单行短名词短语；编号系统派生（A/B1）禁手写；禁「·」拼接；图例 / 意图 / 结论进 note。契约层硬拦换行，画布 caption 两行截断兜底。

## 组件惯用式

- 浮层 = 白面 + 阴影阶梯 `--wb-sh-*`，无发丝描边（2026-08-11 扁平化；结构缝 08-13 回调）。
- 分段 / 单选 = 槽式（灰槽 + 白面选中项）；瞬时动作组只借槽皮，不给单选态。
- ghost 优先，主行动才实心；hover / focus-visible / active / disabled 全态；过渡 ≤150ms，尊重 reduced-motion。
- 危险动作两段确认：armed 红字 3s。
- 圆角档位：控件 6 / 卡片 8 / 面板 12 / 模态 20；药丸只属于 badge / tag。
