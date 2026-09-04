# 0021 · 第二轮对象模型：Page = 线程容器，产物 + 草稿，类型下沉条目级

Status: 现行（方向已定，实现见 docs/2026-08-16-roadmap.md 阶段 6–8） · Date: 2026-08-16 · Scope: `workbench/lib/board-entries.js`、`workbench/app/Sidebar.jsx`

Supersedes: ADR 0017（五阶段地图的 Pages 壳标语义）

**Decided**（owner 当日逐轮拍板，对齐基准页 = 本地实例 `previews/hierarchy-demo/`）：

- **Page = 一件正在做的事（线程容器），自身无类型**。类型壳标（iOS/Doc pill，同
  日早些时候才上 Page 行）从 Page 行撤除，同一视觉语言挪到产物条目。「MCP 设置页」
  这个线程既不是画布也不是文档，它只是那件事；一个 Page 装了画布加网页之后，顶层
  壳标必然撒谎。
- **页内容分两组**：产物（交付物，类型 = 画布 / 文档 / 网页，可一到多个）与草稿
  （过程产物，恒为整页 HTML）。**草稿与产物无机制耦合**：选中 variant 后回灌是
  agent 改代码的动作，pinpoint 不提供系统功能。
- **DocVersions 层级退役**：多屏 doc 板拆成扁平条目。周报板 sections 是实证——
  delivered 两屏（W29/W30 终版）即产物、polish 六屏即草稿，既有分组与新语义近乎
  逐字对应。「Document 层级有没有用」的最终答案：版本切换的真实需求由分组语义
  接管，层级本身删除。
- **url 注册条目收编为类型「网页」的产物**，与画布、文档平级。
- **「画布裸帧」方案明确不做**（不是缓期）：web 组件 variant 对比在草稿页内部
  完成，不引入无壳 frame 新概念。
- **mention 定位澄清**：服务正式文稿嵌入活原型（阶段 5 已交付），不是草稿对比的
  依赖。
- **词汇约定**：容器就叫 Page，禁用自造词「册」（owner 明确指出）。

**证据**：库内 10 个 doc 页实测——仅周报板（2 sections / 8 屏）与
eval-queue-variants（2 屏）用到多版本切换，其余 8 个单屏页的 DocVersions 行是
死行（唯载「导出」钮）。
