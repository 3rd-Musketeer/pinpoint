# docs/adr — 决策记录

一条决策一个文件，文件名 `NNNN-<slug>.md`，编号按时间顺序发放，发出去不回收。
内容是当时写下的原文，只有头行是后加的：`Status · Date · Scope`。Status 说这条现在还算不算数，
Scope 列出它管的代码路径——改这些路径前先 grep 到这里。被后来的决策改掉的条目在头行加
`Superseded-by`，改掉别人的加 `Supersedes`。

新决策的判据（三条同时成立才写）：难逆转、不看背景会奇怪、真有取舍。写法照现有条目：
`**Decided**` 说决定了什么、`**Why**` 说机制理由，有被否的方案就写清否掉的是什么。
决定变了不改旧文件，新建一条并互相标注 supersession。

产品级 standing-question 结论不在这里，在 workspace 的
`.archive/2026-08-13-topic-subs/DECISIONS.md`（2026-08-13 归档）。本目录只记本仓实现层决策。

| # | 日期 | 决策 | 状态 | 被谁取代 |
| --- | --- | --- | --- | --- |
| [0035](0035-pp2-source-dist-and-status-machine.md) | 2026-09-22 | pp2：源码 / dist 分层 + 页内组件印章 + 标注状态机（open / check / done / close）+ `ppnt` CLI 扩面 | 现行 | — |
| [0034](0034-named-z-scale-and-stacking-rules.md) | 2026-09-17 | 外壳层级：命名阶梯 `--wb-z-*` + `.wb` 隔离 / `.wb-stage-wrap` 不成上下文两条规则 + 测试守 | 现行 | — |
| [0033](0033-offline-export-uses-live-shell.md) | 2026-09-15 | 离线分享 HTML 用 workbench 的外壳：满铺画布 + 浮动面板 + 底部横条 + 窄屏适配 | 现行 | — |
| [0032](0032-folders-in-registry-with-workbench-writes.md) | 2026-09-04 | Pages 分组 = 手动文件夹，登记表因此有了第二个写入口 | 现行 | — |
| [0031](0031-shell-glass-panel-bottom-strip-on-demand-list.md) | 2026-09-04 | 外壳重设计：满铺画布 + 浮动玻璃面板 + 底部单条 + 按需标注列表 | 现行 | — |
| [0030](0030-layout-src-content-and-url-contract.md) | 2026-09-04 | 目录重排：src/ 与 content/ 两轴，服务 URL 是契约 | 现行 | — |
| [0029](0029-pages-mtime-and-sort.md) | 2026-08-17 | Pages 时间显示 + 排序；「最近更新」= 仅内容改动 | 现行 | — |
| [0028](0028-areta-chat-eval-repoint-and-component-ownership.md) | 2026-08-17 | areta-chat-eval 条目重指 + 组件归属边界成文 | 部分被取代（条目重指仍现行；组件归属归 pp2 印章模型） | ADR 0035 |
| [0027](0027-serve-injects-and-instances-leave-previews.md) | 2026-08-17 | 注入契约统一 + registry 补全 + 实例迁出 previews/ | 现行 | — |
| [0026](0026-title-rule-section-note-detail-panel.md) | 2026-08-17 | title 规矩 + section note + 选中模型（note 收编右栏 detail 面板） | 现行 | — |
| [0025](0025-canvas-zoom-rebaseline.md) | 2026-08-17 | 画布缩放基准重定标（旧 50% 成为新 100%） | 现行 | — |
| [0024](0024-row-actions-context-menu.md) | 2026-08-17 | 行级动作收编右键菜单 + Popper 置惰收敛 + 排查案例库成文 | 现行 | — |
| [0023](0023-layout-assertions-and-vendored-contracts.md) | 2026-08-17 | 布局断言比几何不靠点击 + vendored 组件内部契约成文 | 现行 | — |
| [0022](0022-doc-mode-grilling.md) | 2026-08-16 | 文档模式 grilling 三问 + 下一轮 arc 暂缓（等真实任务） | 现行（arc 缓期） | — |
| [0021](0021-page-as-thread-container.md) | 2026-08-16 | 第二轮对象模型：Page = 线程容器，产物 + 草稿，类型下沉条目级 | 现行（方向已定，实现见 docs/2026-08-16-roadmap.md 阶段 6–8） | — |
| [0020](0020-doc-frame-mention.md) | 2026-08-16 | 文档模式 mention 活 frame + 标注双向透传（阶段 5/5 落地） | 现行（已落地） | — |
| [0019](0019-live-site-proxy.md) | 2026-08-16 | live 代理画中画：同源路径前缀代理 + 运行时重基（阶段 4/5 落地） | 现行（已落地） | — |
| [0018](0018-cli-registry-entry.md) | 2026-08-16 | CLI 注册入口：pinpoint add + 合成板 + registry 热重载 | 现行（已落地；0035 补充命令名与扩面） | — |
| [0017](0017-five-phase-roadmap.md) | 2026-08-16 | 五阶段 ROADMAP：Web 退役 + Pages 统一 + CLI / 代理 / 文档 mention 方向 | 部分被取代（阶段地图仍现行；“Component Library 作系统行保留”作废） | ADR 0035 |
| [0016](0016-sidebar-width-v2.md) | 2026-08-16 | 侧栏宽度策略（V2 拍定并落地） | 现行（已落地） | — |
| [0015](0015-export-picker.md) | 2026-08-15 | 导出 picker 收敛：任意多选 + 预览 + 选项减重 | 已退役（picker 随 pp2 导出削减删除；批注烘图由 0035 `shot --marks` 落地） | ADR 0035 |
| [0014](0014-outline-extension-lines.md) | 2026-08-15 | 左栏大纲 + 延伸线结构 | 现行 | — |
| [0013](0013-rev-deferred.md) | 2026-08-15 | REV 机制缓期进 backlog | 现行 | ADR 0014 |
| [0012](0012-sheet-format-rev-a1-refs.md) | 2026-08-15 | 图纸版式：铭牌 + REV 协议 + A1 引用法 + 装饰检验；DESIGN.md 正典化 | 部分缓期（图注 / 装饰检验 / 文档权威现行） | ADR 0013 |
| [0011](0011-sidebar-split-and-design-v2.md) | 2026-08-14 | 侧栏左右分工 + 设计语言 V2（钢灰蓝 × S3 圆角） | 部分被取代（accent / 圆角 / 网格人格 / 设置视图仍现行） | ADR 0031 |
| [0010](0010-design-tokens-steel-blue.md) | 2026-08-13 | 设计语言 token 级锚定：Steel Blue accent + 画布点阵 + 结构缝回调 | 部分被取代（语义色 / 结构缝 / mono 档仍现行） | ADR 0011、ADR 0012、ADR 0031 |
| [0009](0009-extension-side-panel.md) | 2026-08-11 | 扩展标注面板 = Chrome Side Panel（原生分屏）；点击必达 + 陈旧自愈 | 现行 | — |
| [0008](0008-design-anchor-flat-linear-light.md) | 2026-08-11 | 设计语言锚：扁平 / Linear 风 / light theme（owner 审美准则） | 部分被取代（准则本体仍现行） | ADR 0010、ADR 0031 |
| [0007](0007-workbench-react-rebuild.md) | 2026-08-10 | workbench 技术栈重构（react-rebuild milestone 收官） | 现行 | — |
| [0006](0006-pinpoint-service-closeout.md) | 2026-08-10 | pinpoint 服务化 milestone 收尾（closeout） | 现行 | — |
| [0005](0005-product-positioning.md) | 2026-08-07 | Product positioning: UIUX 原型交付与对齐工具 | 现行 | — |
| [0004](0004-branch-model-main-dev.md) | 2026-07-21 | Branch model: main = public template, dev = daily | 现行 | — |
| [0003](0003-per-project-annotation-dir.md) | 2026-07-21 | Per-project annotation dir | 现行 | — |
| [0002](0002-template-split-and-exclude.md) | 2026-07-21 | Template split + release workflow | 部分被修订（实例内容排除仍现行） | ADR 0012 |
| [0001](0001-topic-source-delivery-semantics.md) | 2026-07-20 | Separate topic, source, and delivery semantics | 现行（产品 SSOT 已归档到 workspace 的 .archive/2026-08-13-topic-subs/） | — |
