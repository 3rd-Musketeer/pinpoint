# Preview kit decisions

产品级 standing-question 结论见 **[`cold-topic/2026-08-13-topic-subs/DECISIONS.md`](../../cold-topic/2026-08-13-topic-subs/DECISIONS.md)**（2026-08-13 归档）。  
本文件只记本 kit / fixture 实现层决策。

**当前执行权威**：见 [`.gdd/goal.md`](.gdd/goal.md)。

---

## 索引

| 日期 | 当时问题 | 裁决 | successor | 状态 |
| --- | --- | --- | --- | --- |
| 2026-08-16c | CLI 注册入口形态 | `pinpoint add`（dir/file/url）+ registry-store SSOT + `/registry/reload`；file/无板 dir 合成 doc 板进 Pages；url 条目待阶段 4 | — | 现行（已落地） |
| 2026-08-16b | 五阶段 ROADMAP（Web 退役 / Pages 统一 / CLI / 代理 / 文档 mention） | 方向拍定，ROADMAP.md 落盘为阶段地图；Web 连壳退役；文档 mention = 活 DOM + 标注透传，不做冻结 | — | 现行（阶段 2–5 实现中） |
| 2026-08-16 | 侧栏宽度策略 | V2：右栏 260–440 拖拽 + 280 紧凑断点 + 双击复位 + 持久化；rail 档 / 自动让位不做 | — | 现行（已落地） |
| 2026-08-15d | 导出 picker 收敛 | 任意多选（单张直出 PNG / 多张 zip）；PNG 2× 固定；预览两栏（选中几帧预览几帧）；图纸内容永随；批注烘焙缓期进 backlog | — | 现行（批注档缓期） |
| 2026-08-15c | 左栏加大纲 + 层次形态 | 大纲（section → frame 树 + 计数徽标 + 点击定位）；层次 = 延伸线结构（V2） | 修订 08-15b（左栏内容） | 现行 |
| 2026-08-15b | REV 机制要不要做 | 缓期进 backlog（痛点未证实），设计储备留体验板 | 08-15c（左栏内容修订） | 现行 |
| 2026-08-15 | 图纸版式 / REV 协议 / 文档权威 | A1 引用法；装饰检验；DESIGN.md 正典化进 git；REV 协议 | 08-15b（REV 及其展示面缓期） | 部分缓期（图注 / 装饰检验 / 文档权威现行） |
| 2026-08-14 | 侧栏形态 + 设计语言 V2 | 左右分工（左上下文 / 右标注工作台）；钢灰蓝 #5b7fa6 + S3 圆角 + 双线网格 | — | 现行 |
| 2026-08-13 | 设计语言 token 锚定 | Steel Blue accent + 画布点阵 + 语义色收编 + 结构缝回调 | 08-14（accent 值、网格人格）、08-15（纹理入口进设置） | 部分被取代（语义色 / 结构缝 / mono 档仍现行） |
| 2026-08-11b | 扩展标注面板形态 | Chrome Side Panel + 点击必达 + 陈旧自愈 | — | 现行 |
| 2026-08-11 | 审美锚 | 扁平 / Linear 风 / 单 light 主题 | 08-13（accent 值与功能色微调） | 部分被取代（准则本体仍现行） |
| 2026-08-10b | workbench 技术栈 | React+zustand chrome / 命令式舞台 / TanStack Query / Radix Primitives | — | 现行 |
| 2026-08-10 | pinpoint 服务化 closeout | registry + 注入契约形态定型 | — | 现行 |
| 2026-08-07 | 产品定位 | UIUX 原型交付与对齐工具；kit / workbench / annotation 三层 | — | 现行 |
| 2026-07-21c | 分支模型 | main = 公开模板，dev = 日常 | — | 现行 |
| 2026-07-21b | 标注落盘归属 | 按项目分桶（~/.pinpoint 前身） | — | 现行 |
| 2026-07-21 | 模板 split + exclude | git 只跟踪模板，个人内容 exclude | 08-15（decisions.md / DESIGN.md 放出，教义随模板走） | 部分被修订（实例内容排除仍现行） |
| 2026-07-20 | topic / source / delivery 语义 | fixtures 分 topic；人 = source | — | 现行（产品 SSOT 已归档 cold-topic） |

---

## 2026-08-16c · CLI 注册入口：pinpoint add + 合成板 + registry 热重载

**Decided**（阶段 3/5 落地）:

- **CLI 心智**（owner 原话收敛）：想让一个页面进 pinpoint 就用 CLI；静态的 pinpoint 直接 host（/sites/ 管道），活的登记 URL 待阶段 4 代理映射。N 个项目小服务器 → 一台总线 + 一张登记表。
- `bin/pinpoint.mjs`：`add <path|url> [--title] [--board ios|html] [--id] [--registry]`；id = basename slug 化 + 冲突避让；dir/file 的 board 默认 html；file 拒 `--board ios`（合成板恒 doc 壳）。
- registry 读写收 `server/lib/registry-store.js`（原子写、严格校验、缺失时以默认 pinpoint 条目播种）；`POST /registry/reload` 热重载——启动期缓存的三处消费点（annotate-api / sites-api / export-doc-api）收编为共享活 store，reload 后全部即时生效；workbench 经 HMR `registry:update` 失效重拉 Pages。
- **合成板**：`/sites/<id>/board.json` 磁盘优先，缺失时合成 doc 板——file 条目单屏；无板 dir 顶层 *.html 码位序各一屏（侧栏版本列表）；dir 无顶层 html / 目录缺失 / 显式 `board:'ios'` 无板 → 404（不合成，与 registry 白名单惯例一致，打开呈现明确加载失败而非空页）。合成板导出、标注分桶（src percent-encode 三处逐字节一致）闭环。
- url 条目仍不进 Pages（阶段 4 代理内嵌时才进）。

**Why**: 「出现在 Pages」的语义 = 出现且能打开可读可标；否则不如不出现（改动前缺板条目打开是 404 错误面板）。

## 2026-08-16b · 五阶段 ROADMAP：Web 退役 + Pages 统一 + CLI / 代理 / 文档 mention 方向

**Decided**（owner 2026-08-16 讨论定稿；`ROADMAP.md` 落盘为阶段地图，goal 驱动执行）:

- **Web 模式连壳退役**：它从不是模式，只是「无机壳的画板」；存量内容在 doc 壳下都有更好的家（variants 板 → 整页 doc；服务器目录/页面 → doc iframe 1:1）。模式 Seg 退役，Pages 统一为单一列表 + 行内壳标记；壳仍是页/帧属性。真边界不是 iOS / Web / HTML，而是**画布（迭代态）/ 文档（表达态）**两形态。桌面 web 原型需求真出现时按 web-kit 哲学重建。
- **CLI 注册入口心智**：想让一个页面进 pinpoint 就用 CLI；静态的 pinpoint 直接 host（/sites/ 管道），活的登记 URL 待代理映射。N 个项目小服务器 → 一台总线 + 一张登记表；能标注不是附带福利，是「用 pinpoint host」的全部意义。
- **live 代理画中画**走同源代理（含 WS 转发），取代 backlog 的「跨域 iframe + postMessage 桥」路线——同源使桥不必要。
- **文档模式 mention 活 frame**：doc 引用画布 frame → 水合活 DOM（可交互，同一份 fragment）；**标注双向透传**——标注绑定对象（frame + 内部锚点）不绑定视图，同一份存储、两处渲染、实时同步；文档导出时 frame 烤静态图；不做冻结/REV。
- **阶段切分原则**（owner 原话）：每刀按独立价值切，不按实现便利。五阶段与切开理由见 `ROADMAP.md`。

## 2026-08-16 · 侧栏宽度策略（V2 拍定并落地）

**Decided**（owner 体验板 V1/V2/V3 可拖 mock 对比后拍板）: 右栏（标注工作台）补 splitter 拖拽，clamp 260–440、默认 308；宽度 <280 进紧凑态（卡片藏 cap、文本单行 truncate、底栏批注 dropdown 收 图标+值），拖回自动恢复；双击 splitter 复位 308；`annPanelWidth` 偏好持久化。左栏维持现状（200–480 + 折叠）。rail 档（56px 图标列）与窗口过窄自动让位：**不做**。
**Why**: 两栏夹画布挤小中间屏。内容分析结论——左栏 200 是「大纲可读」下限（屏名不足 5 字失去意义），右栏 260 是卡片舒适下限；窄态诉求由紧凑断点 / 折叠接，不由更窄宽度接。V1（min 卡死）做不到「想窄但保留列表」；V3 rail 对树形内容只剩字母、定位语义弱，且左栏窄诉求已被折叠 + 浮钮覆盖。
**契约**: 体验板 `previews/sidebar-variants/sidebar.html`「侧栏宽度：分析 + 方案」V2 mock（px 读数 chip 是演示道具，真实实现只有 aria-valuenow）。
**落地**: `boot-prefs.js`（ANN_W_* + applyAnnWidth + compact 类开关）、`stage.js`（#wbannsplit 拖拽/键盘/双击复位，镜像 #wbsplit，左拖 = 变宽）、`index.html`（--wb-ann-w + 紧凑样式 scope `#wbann-side.compact`；共享行 `lib/ann-list.css` 不动）、`AnnPanel.jsx`（dropdown 文案包 `.wb-ann-bubble-lbl`）。e2e 55 → 60，unit 173 持平；活体 16 断言 PASS。

## 2026-08-15d · 导出 picker 收敛：任意多选 + 预览 + 选项减重

**Decided**（owner 在体验板 picker 上拍板）:
- 批量规则 = 任意多选（勾选任意帧组合，section 行整选）+ 智能打包：单张直接下载 PNG，多张才 zip。
- 选项按「必须对应真实投放渠道差异」减重：格式固定 PNG（砍 WebP；复制 PNG 与下载统一，「透明强制 PNG」联动随之消失）；清晰度固定 2×（砍 1×）；背景保留三档（画布 / 白底 / 透明）。
- picker 两栏：左 proto tree，右实时预览（第一张选中帧，随背景 / 带说明刷新）；实现复用 `/api/export-image` 管线低清档 + debounce，不起新管线。
- 图纸内容（图注 = 引用号 + 屏名 + 尺寸，以及 frame note）永随导出，推翻旧 export-core 的「干净画面摘图注」语义。
- 批注烘进 frame 导出：当日缓期进 backlog（owner 复评无「带批注外发」场景；picker 曾做出带批注预览 mock，后按 backlog 惯例撤下）。doc 导出的批注烘焙管线（export-doc-bake + token 估算）原样在线保留，不删不改。
- 多选预览 = 选中几帧并排几帧（zip 里是什么就预览什么），不再只盯第一帧。
**Why**: 导出是交付动作，对话框每个选项都该对应一个真实投放渠道；WebP / 1× 没有渠道支撑。预览只服务改变视觉结果的选项（背景三档），格式与清晰度是文件属性，看预览无意义。
**Consequences**: per-frame / per-section 导出触发器、旧预设 radio、WebP / 1× 档在落地时拆除；⋯ 菜单里的导出入口删除，菜单本体看剩余项再定。doc 导出的批注烘焙支线（html-full / comments）不动。

---

## 2026-08-15c · 左栏大纲 + 延伸线结构

**Decided**（owner 在 `previews/outline-variants` 四案对比后拍定 V2）: 左栏 Pages 之下加大纲区——当前页 section → frame 树，行 = 引用号 + 屏名 + 计数徽标（红 = 含失效锚点）；点击 = 定位 frame 并打 focus 环，与右栏标注卡焦点双向同步（v1 不做卡片过滤）。层次处理 = 延伸线：14px rail 槽位，section 字母与竖向导线同轴，spine 贯穿整行逐行拼接，段头接续线自字母下缘起笔，末行收 └ 角；选中染整行、线压染色之上。
**Why**: 左栏原先只回答「我在哪一页」，不回答「这页里有什么、标注集中在哪」；大纲让 A1 引用体系从图注标签变成可导航地址。延伸线胜出：与画布网格同一套线的语言（制图引线），且不引入新交互元素（V4 折叠的收纳能力等 section 真多再补）。
**Consequences**: 修订 08-15b 的「第一批左栏只做 Pages + 设置」→ Pages + 大纲 + 设置。大纲数据从 board.json 派生，无新机制。rail / spine 槽位几何即正式 React 组件结构，禁用绝对定位 magic number 画法。四案对比板 `previews/outline-variants/` 保留作判例档案。

---

## 2026-08-15b · REV 机制缓期进 backlog

**Decided**（owner 复评同日 08-15 条目后拍板）: REV 版本机制整体缓期——bump 端点、左栏更改栏、铭牌、标注绑 REV、过期提示、「未记录改动」检测，全部进 [`.gdd/backlog.md`](.gdd/backlog.md)（含启动信号与分期预案）。
**Why**: owner 原话「我目前没有想到特别刚需的场景，之前没有这个一样迭代，它不是最关键的痛点」。设计时高估了异步多轮验收的频率；chat 在当前节奏下就是 changelog。
**Consequences**: 侧栏重构第一批的左栏只做 Pages + 设置视图；`DESIGN.md` 版本管理节只留缓期指针；设计储备（更改栏 / 铭牌 / REV chip / 三向联动）留在体验板 `previews/sidebar-variants/` 不删。画布图注（A1 引用法、尺寸下置）、导出 picker、装饰检验、文档正典化不受影响，按原计划推进。

---

## 2026-08-15 · 图纸版式：铭牌 + REV 协议 + A1 引用法 + 装饰检验；DESIGN.md 正典化

**Decided**（owner 在评审板 `previews/sheet-rev` 上逐轮拍板）:
- **sheet 元信息进左栏**：铭牌（格子语言，图名与图号同格 + REV / 张次 / 更新）固定左栏底部，不随列表滚动；更改栏（Revisions）居左栏中部。画布不再承担标题栏 / 更改栏。
- **引用法**：图幅边缘刻度（ABCD / 123）删除，引用体系取而代之——section 用字母、frame 用数字（A1 / A2 / B3）。人对 agent 说 A2；机器引用仍走 `@frame:id`。
- **图注两行**（引用号 + 屏名），尺寸挪 frame 下方居中 mono 小字。
- **REV 协议**：字母制；agent 每轮改动完成后自调 `POST /api/pages/:id/rev {"note":"一行说明"}`，服务端自增字母、落日期写进 board.json；标注记录创建时 REV，页面 REV 前进后旧标注标「可能已过期」；不做画布时间轴穿越（git 即全量历史）；screen / board 变化但无新 REV 时，更改栏显示「未记录的改动」灰行提醒补注记。
- **装饰检验**（设计语言原则第 1 条）：每个视觉元素必须回答「它标记 / 组织 / 反馈什么真实信息」。判例：铭牌铆钉删（CSS 里不固定任何东西）；画布内图框 + 角部十字退役（纸上是裁切 / 对折标记，屏幕无对应物，边界信号与外框重复）。
- **无「·」**：文案判据归 topics/ui-text 规则 8（本 repo 引用不复制）。
- **文档权威**：新增 `DESIGN.md`（当前正典）；本文件保持 journal 角色并加索引（含 successor 列）；`decisions.md` 与 `DESIGN.md` 自 07-21 的 exclude 清单放出——教义随模板走；实例内容（previews/ 个人页、组件、`.gdd/`、CHANGELOG.local.md）排除不变。
- **导出收敛方向**：单入口 picker + 当前页 proto tree 多选，per-section 导出钮删除。未定：批量档位（zip 任意多选 vs 单选 + section 整选）、frame ⋯ 菜单去留——落地前补拍。

**Why**: 复古 / old-school 感来自建造逻辑可见（字体、编号、线宽纪律），不来自贴皮；REV 绑定的收益 = 多轮迭代里「这条反馈针对哪一版」可对齐。文档侧只有日志没有正典，supersession 曾只存在于读者脑子里。

---

## 2026-08-14 · 侧栏左右分工 + 设计语言 V2（钢灰蓝 × S3 圆角）

**Decided**（owner 在评审板 `previews/sidebar-variants` 上逐轮拍板，含 11 条标注反馈全部落地）:
- **侧栏 = 左右分工**：左栏 = 页面上下文（Pages + 设置视图），右栏 = 标注工作台（可整栏折叠，画布两缘浮钮复开，右钮带计数）。
- **设计语言 V2**：S3 圆角组件（radius 8）× 钢灰蓝 `#5b7fa6`（取代 08-13 的 Steel Blue `#1769aa`，后者过深）+ Blueprint 画布人格（24 / 120 双线网格）。发丝线 / 浅面 / muted 由 accent color-mix 派生。
- **右栏结构**：head（计数钉 + 收起）→ meta（status 左 + 「清空标注」两段确认 armed 红字 3s）→ 卡片列表（白卡 + 淡蓝描边 + 分组 eyebrow）→ 底栏两行（模式单钮 + 画布批注 dropdown 三态：隐藏批注 / 叠在页面 / 右侧通道）。
- 模式 = 单钮点按，标注中 = 实心 accent（全页唯一实心 on 态）；交互模式图钉保留（opacity .38 + pointer-events:none），气泡仅标注模式。
- 锚点失效 = 整卡红描边 + 红浅面 + 文本退灰 + 序号钉转红，不用 tag。
- 移除：暂停、Pin、通道钮（并入批注 dropdown）、全部 / 当前筛选、footer 主题分段（单主题决策）、设置常驻格（进左栏齿轮 → 设置视图）。
- 画布背景三态（网格 / 圆点纸 / 空白）进设置视图（「任务高频留底栏，环境低频进设置」）；圆点 = accent 34% 透明度 1.2px。
- 设置图标 = lucide cog（旧辐条图标被误读成明暗切换）。

**Why**: 旧侧栏把导航 / 标注 / 设置 / 主题混在一栏；Steel Blue 在圆角组件上过深。
**状态**: 体验板全交互验证完毕，真实代码落地中（2026-08 批次）。

---

## 2026-08-13 · 设计语言 token 级锚定：Steel Blue accent + 画布点阵 + 结构缝回调

**Decided**（owner 在评审板 `previews/accent-orange` 上拍板；细化 2026-08-11 的审美锚）:
- **accent = Steel Blue `#1769aa`**（eval harness 现役 `--blue`），替换 iOS 蓝 `#007aff`。核心理由：chrome 与 iOS kit 内容分色（内容继续用 `#007aff`）。评审覆盖橙 / 蓝图蓝 / 制图绿三族 15 个候选，含 WCAG 对比度与琥珀同框检查。
- **画布纹理 = 24px 中性暖灰点阵**（`--wb-stage-dot`，屏空间固定，pan/zoom 不带动、无 moiré；职责是平移反馈不是测量）。灵感 = 绘图室三原色（绘图纸 / 晒图蓝图 / 坐标纸绿网格）；制图绿线网格保留为日后人格化选项。
- **语义色收编 eval 族降饱和对**：danger `#ff3b30`→`#b84230`，ok/online 绿 `#1b7a3d`/`#34c759`/`#e8f8ef` 散字面量 → `--wb-ok` / `--wb-ok-soft`。琥珀 `#f5a623` 保留为标注特性功能色（双端一致信号，不动）。
- **结构缝回调**：V5 全面去线矫枉过正——缝（pane 分界 1px `--wb-seam`）≠ 已退役的卡片描边。落在侧栏 head/footer、Annotations 段界、设置头、扩展面板头。
- **元数据 mono 档** `--wb-font-mono`（标注行 cap/tags 首消费，双端共享表同源）。
- 字体保持 Apple 系统栈；单 light 主题，不做 dark。

**Why**: 审美参照系是 owner 自己的 my-todos（DESIGN.md 自称 Linear Light，accent `#5e6ad2`）与 areta eval harness（shadcn 中性 + Geist + 降饱和语义色）；token 管道（生成器 → shadcn 桥 → Tailwind + 注入端钉值）让换皮只动值不动组件，本轮即验证。

**顺带修复**: 扩展面板（`#panel-list`）此前不在 `lib/ann-list.css` 作用域内——行/空态从未吃到共享样式，本轮补入第三消费端。

---

## 2026-08-11b · 扩展标注面板 = Chrome Side Panel（原生分屏）；点击必达 + 陈旧自愈

**Decided**（owner 拍板，扩展 0.3.0 落地，dev `5a1ed12`）:
- 图标点击打开 **Chrome Side Panel**（`chrome.sidePanel.open`），标注列表/模式切换/跳转/编辑/删除搬进浏览器原生侧栏。页面内 `#ann-sidebar` 浮层不再是扩展场景的主控制面，保留给无扩展场景（`/sites/` 直开、S 键、工具条「列表」）。
- 面板页由 **pinpoint 服务托管**（`panel.html` + `workbench/app/Panel.jsx`），扩展壳（`sidepanel.html/js`）只做 tab 锁定、page-info 查询、命令转发与死法提示——行模型/样式（`lib/ann-row.js`、`lib/ann-list.css`）与 API/SSE 零复制。
- **写入单归页面 client**：面板动作经 `postMessage → 壳（校验 source+origin）→ content script → pinpoint:command DOM 桥 → client` 执行（goToMark/openMark/removeMark/toggleMode），SSE 广播回面板；面板永不直接写盘，无 revision 并发面。
- **点击必达契约**：点击永远有可见结果。死法分层提示（壳内本地渲染）：服务没起 / 页面不支持 / 桥没响应 / 页面组件过旧→⌘R / 未注册 / workbench 壳页。
- **陈旧自愈**：扩展重载前的旧标签页没有活 content script，面板壳经 `chrome.scripting` 幂等补注（`window.__pinpointContent` 守卫）后重试；页面内 client 过旧（无 `data-pinpoint-client` 标记）是唯一必须 ⌘R 的情形——`window.__pinpoint` 防重入守卫使 JS 层无法替换旧 client。

**Why**: 页面内浮层恒压右侧 280px，且 margin 推挤会让 fixed/vw/媒体查询破相——与「高保真评审必须看到真实布局」冲突；原生分屏让页面按更窄视口正常 reflow。此前 quiet no-op 让「client 过旧/未注册/插件坏了」三种死法不可分辨，点击必须有反馈。

**桥协议**（`data-pinpoint-*` on `<html>`，client 启动时打）：`data-pinpoint-client="1"` 就绪 / `data-pinpoint-entry` 账本归属 / `data-pinpoint-sidebar="suppressed"` 壳页抑制 / `data-pinpoint-mode` 交互|标注。

**自动化边界**（排查实测，后来者省时间）: 品牌 Chrome 151 忽略 `--load-extension`；Chromium 对程序化 `chrome.runtime.reload()` 的未打包扩展直接禁用（disable_reasons `1<<24`）；Playwright 点不了工具栏图标、开不了真 side panel——测试路径 = 壳作为普通标签页打开（SW 里 `chrome.tabs.create`）+ `?tab=<id>` 覆盖。

---

## 2026-08-11 · 设计语言锚：扁平 / Linear 风 / light theme（owner 审美准则）

**Decided**（owner 钦定，本 repo 一切 UI 工作的验收尺）: chrome 与注入端一律扁平 Linear 系 light 风。具体表现形式：
- **色彩**：中性灰阶低饱和；分层靠明度差不靠边框；唯一强调色 accent #007aff（主行动/选中态），功能色 danger/琥珀（标注武装）/绿（成功回显）各一枚；无渐变、无彩色图标。
- **边界**：禁 1px 描边卡片；分区靠留白与明度差，浮层靠阴影阶梯（--wb-sh-1..4）；描边只作功能信号（锚点框/套索/focus 环）；圆角控件 6 / 面板 12 / 模态 20，药丸只属于 badge/tag。
- **控件**：ghost 优先（透明底 + hover 浅灰填充），主行动才给实心色面；分段控件 = 灰槽 + 白面选中项；28px 高、13/12/10.5px 字阶、4 的倍数间距；hover/focus-visible/active/disabled 全态；过渡 ≤150ms，尊重 reduced-motion。
- **字体图标**：系统字栈；字重四档；读数 tabular-nums；区头 10.5px semibold 大写加字距；lucide 线性图标（1.75 描边，12/14/16 三档）；emoji 不当图标。
- **反馈**：状态变化用填充/字色不用描边；即时回显低打扰（ok 态消退，不弹 toast）；危险动作用 danger 浅面克制写法；键盘可达（roving focus / Esc / focus 还原）。
- **布局**：信息密度优先于呼吸感；画布内容永远是视觉重心，chrome 退后；严格左对齐与控件网格。
- **反模式**：hairline 卡片、渐变、毛玻璃、彩色阴影、大圆角卡片、emoji 图标、多强调色、满 bleed 色块。
**Why**: owner 对 V0-V4 换皮的终审反馈——灰槽 + 发丝边卡片是「AI 味」模板脸；此前配方太保守导致「改了这么多视觉没变化」。
**Consequences**: `--wb-sh-line` 叠用与各处 border-border 在 2026-08-11 扁平化试点中清除（侧栏/浮层/舞台/对话框）；后续新增 UI 一律按此验收。

---

## 2026-08-10b · workbench 技术栈重构（react-rebuild milestone 收官）

**Shipped**: goal `.gdd/goals/goal-20260810-workbench-react-rebuild.md`（本地 exclude）status=done；commit 链 `0acfdb2..c7c3760`（16 个，dev 未 push，发布等下一轮视觉组件库决策后一并走）。
**Decided**:
- chrome（侧栏/标注面板/HUD/设置/frame menu）= React 19 + zustand（`workbench/app/`，`store.js` 是共享状态唯一住处）；舞台保持命令式（`workbench/stage.js` + 簇模块 pages/board-nav/boot-prefs/screen-load/preview-mount/ann-bridge/export-core/frame-notes）。DOM id/class 是 e2e 契约，不许破。
- server state = TanStack Query（`app/query-client.js`，`staleTime: Infinity`；SSE `preview:update` 桥 `invalidateQueries` 是唯一失效源；手工 cacheBust/boardLoadGen 机械删除）。
- 弹层行为 = Radix Primitives（frame menu → DropdownMenu 非 portal + popper 置惰——`.wb-library` 是 transform:scale 空间，JS 量测定位在缩放 ≠1 必错位）；export dialog 保持原生 `<dialog>`+showModal（e2e 锁元素名 `dialog.wb-export-dialog`，原生已覆盖 focus trap/dismiss/焦点还原，评估证据见 goal 文档）。
- 视觉 = `--wb-*` token 体系（`scripts/build-wb-tokens.mjs` 生成 `workbench/wb-tokens.css`，`wb-tokens.test.js` 守鲜度；Radix Colors 锚定 ≤1 档，accent #007aff 锁定不漂移；radius/type/shadow/danger 阶梯归一，散装值清零）；`lib/ann-list.css` 双端同步 + annotate-inline 三向漂移守卫。
- 注入端 `client/annotate.js` 保持 vanilla 单文件（不进 React/构建）；URL 深链 `?page=&mode=`（读侧 URL 优先 prefs，写侧 replaceState 单向镜像）。
**Why**: 原 workbench.js 是 3621 行命令式单文件（87 个模块级 var），手写 DOM reconciliation/字符串拼 HTML/散装视觉值三重失控。
**纪律**: 禁循环 import（子模块不 import stage.js，反向依赖走 init*Deps DI）；lib/ 纯函数；每刀双门（npm test + e2e）绿后单 commit；e2e 中断后 `lsof -ti :5299 | xargs kill` 防孤儿端口。

---

## 2026-08-10 · pinpoint 服务化 milestone 收尾（closeout）

**Shipped**: WP0-WP9 共 12 个 commit（`8172f74..8f7dddf`）已 push 至 `origin/dev`（GitHub: 3rd-Musketeer/pinpoint）。公开模板 main **未**发布（owner 选择 A：只 ship-dev；`just publish` 留待明示）。
**Verified**: `npm test` 156/156、e2e 43/43（含 SPA 账本、扩展注入、/sites/、侧边栏全部用例）；真机回路（my-todos 注入/分桶/跳转）以自动化浏览器走完；owner 完成过一次真实 pickup 标注。
**形态**: registry（`~/.pinpoint/registry.json`）+ dir 服务端注入（/sites/）+ url 扩展注入 + SPA 账本 + 标注侧边栏（共享行渲染 `lib/ann-row.js` + `lib/ann-list.css`）；命名全部 pinpoint 化（`window.pinpoint`，`iOSAnnotate` 保留 deprecated alias）。
**残留归属**:
- `repos/` 下 morii-service、morii-ios 两处旧路径引用 → 归各 repo 自己的工作流。
- 未承诺候选（registry 热加载、Frame Note 写回、扩展非 localhost 支持、实例内容搬迁、web/html kit 等）→ [`.gdd/backlog.md`](.gdd/backlog.md)。
- e2e 环境教训：playwright 浏览器二进制会被机器上其它项目的新版 install 清走；e2e 全挂先查 `ls ~/Library/Caches/ms-playwright/`，修复 = `npx playwright install chromium`。
**重建指针**: 服务 `just dev`（https://pinpoint.localhost）；样式回归探针 `.tmp/keep/wp8-style-probe.mjs`（`--diff` 复跑）；扩展安装见 `extension/README.md`。

---

## 2026-07-20 · Separate topic, source, and delivery semantics

**Decided**: Feed fixtures use focused topics (`宝贝今日饮食`, `宝贝情绪`, `硬件进展`); people are shown as sources, while Alert remains a realtime delivery priority rather than a content type.
**Why**: Broad topics and the unconfirmed “主动分享” mechanism made Alert urgency, Digest scope, and source identity contradict the reviewed product intent.
**Alternatives**: Rejected patching individual card copy while keeping `伴侣近况` and person-prefixed topic titles because the same drift would persist in timelines and legacy frames.
**Files**: `previews/shared-calendar/_topic-data.js`, feed renderers, topic strategy fixtures, and `topic-feed-order.test.js`.
**Product SSOT**: `cold-topic/2026-08-13-topic-subs/`（2026-08-13 归档）。

---

## 2026-07-21 · Template split + release workflow

**Decided**: 本目录 git 化，git 只跟踪模板（框架 + Example Library + system 组件）。个人内容经 `.git/info/exclude` 本地排除（产品 preview 页、产品组件目录、decisions.md、CHANGELOG.local.md）；页面清单走 gitignored `previews/_index.local.json` 覆盖（workbench 先取 local，404 才回落 tracked）。
**Why**: exclude 不进共享 .gitignore，模板使用者看不到个人目录名。
**注意**: 锁屏字标默认已中性化为 HELLO（`data-lock-word` 覆盖）；个人锁屏已逐屏加 `data-lock-word="MORI"`。新增个人 preview 页 / 产品组件时记得同步加进 `.git/info/exclude` + `_index.local.json`。

## 2026-07-21b · Per-project annotation dir
**Decided**: 标注落盘从共享 `~/.html-annotate/` 改为按项目 `~/.html-annotate/<repo目录名>-<绝对路径hash>/`（本实例=`ios-app-preview-html-template-1t8yetj`，旧文件已迁入）。路径从 `GET /health` 的 `dataDir` 读，`HTML_ANNOTATE_DATA_DIR` 可覆盖。
**Why**: workbench page key 恒为 /index.html，同机多 clone 共享目录会混标注、共享 clear/revision——clone-per-project 模式必踩。

## 2026-08-07 · Product positioning: UIUX 原型交付与对齐工具

**Decided**（owner 产品思想，后续设计的准绳）: 这个项目的核心不是 "iOS HTML preview"，而是**帮助 owner deliver 高保真 UIUX 原型——把 UIUX 设计想清楚，并设计出符合 owner 审美的方案**。三个层各自服务这个目标：

- **kit**（ios-kit，未来可能有 web-kit / html-kit）= owner 个人设计规范的积累，是"符合我审美"的沉淀层；
- **workbench / canvas** = 多方案原型的对比查看界面，服务"想清楚设计"；
- **annotation** = 人 → Agent 的视觉反馈回路，服务"迭代修改原型"。

**Why**: 之前 repo 以 "iOS preview 模板" 自我定位，导致跨 topic 内容（symlink）、server 托管页面标注等需求无处安放；按上述定位，annotate 是独立的反馈协议层，kit/workbench 是它的两个 client。

**已定**（2026-08-07 讨论结论）:

- 跨 topic 内容用 **registry**（中央注册表，entry 分 `dir`/`url` 两类，稳定 id）替代 symlink；内容留在 owning topic 原地。
- 注入契约 = **"登记过才注入"**：`dir` 类由 review 服务在 serve 时自动注入 annotate client；`url` 类（如 my-todos）由浏览器扩展注入；`file://`、自起 server、未登记 origin 一律干净。目标项目零感知。
- 导出物（PNG / 完整 HTML）**不得**包含注入的标注脚本；导出管线内部绕开注入，不作为用户可见开关。
- client 只有一份 `annotate.js`；服务端注入与扩展注入只是两种投递方式，通信协议（`POST /save` + 磁盘 SSOT）唯一。

**Open**（讨论中，未定）: ~~SPA 前端路由切换时 page key 的重算~~ ~~annotation key 需含 origin/项目 id~~ —— 两项均已在 pinpoint 服务化 milestone（`.gdd/goal.md`）落地：SPA 账本切换见 WP2（Navigation API + switchLedger + epoch 护栏），key 归属见 WP1（按 registry entry-id 分桶）。该 milestone 执行完毕（2026-08-09，dev 分支 `8172f74..7fe4a5b`）。

---

## 2026-07-21c · Branch model: main = public template, dev = daily

**Decided**: 远端公开仓心智改为两支——**`main`** = 对外模板（原 `release`）；**`dev`** = 日常开发（原 `main`）。实例目录跟 `dev`；纯模板校验 worktree（`~/workspace/ios-app-preview-release`）跟 `main`。
**发布**: 在干净模板视图跑 `npm ci && npm run check`（e2e 自带 `PREVIEW_TEMPLATE_ONLY=1`）后，把 `dev` tip 推到 `main`（`git push origin dev:main`，或 worktree 里 `reset --hard dev && push`）。
**远端**: https://github.com/3rd-Musketeer/ios-app-preview（public）。上仓内容只含模板；产品页名不进文档/测试 fixture。
**Why**: 访客默认落到可发布模板；本地实例继续在 `dev` 叠 exclude 内容，不必再记「还有一个 release」。
