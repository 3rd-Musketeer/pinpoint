# 0020 · 文档模式 mention 活 frame + 标注双向透传（阶段 5/5 落地）

Status: 现行（已落地） · Date: 2026-08-16 · Scope: `server/lib/frame-doc.js`、`lib/frame-anchor.js`、`client/frame-boot.js`

**Decided**:

- **mention 语法**：doc 正文写 `<div data-pinpoint-frame="<pageId>/<screenId>"></div>`（值 = 既有 @frame: 身份；组件库 `components/<comp>/<variant>`）。doc 自己的 annotate client 把挂载点水合成 iframe → `GET /api/frame` 出自包含文档（fragment + 共享机壳 `lib/frame-shell.js` + frame-boot 运行时 + annotate 注入带板身份 `__pinpointFrame`）；doc 壳屏被 mention 时 302 到屏自身 URL（同 pathname = 同账本）。iframe 自适应内容高度；已有子节点的挂载点（烤图产物）跳过水合。
- **透传核心：不改存储 schema**。调查发现画布锚点 = 板文档绝对 cssPath（`#lib-xxx > .wb-screen:nth-of-type(N) > .ios-stage > …`），frame 换序会断、存量迁移不可接受。解法是画布与 frame 嵌入页的 stage 以下 DOM 由**同一份机壳逐字节同构**，frame 内路径从既有 selector 字符串纯派生（`lib/frame-anchor.js`：切到 stage 段取后缀），解析时两端各自把 `:scope` 绑到本视图的 stage 根——canonical = pageId + screenId + frame 内路径成立，存量零迁移，frame 移动后锚点自愈；可派生而行内解析 miss = 诚实失效（锚点失效红卡语义），绝不回退撞上别的 frame；id 短路的 selector 维持全局解析逐字节不变。
- **存储与同步**：frame 标注读写在画布板的账本（行带 pageId/section/screenId），整账本报文读写不丢行，SSE 双向实时；frame 实例只渲染本 frame 的行；doc 正文标注归 doc 页自己的桶（命名空间分离，活体证明）。
- **模式路由**：侧栏开关 → doc 实例 → 级联每个 frame iframe（同源直调 setMode）；frame 实例启动反向领养父级模式（有界轮询防加载竞态）。标注模式 frame 内点选 = 标注；交互 = 原型照跑。
- **导出烤图**：html-full 换 `<img dataURL>`（/api/export-image 渲染器）、长图 PNG 渲染时运行时换图、html-no-css 换文本引用（不塞 base64）；复用既有渲染管线。
- 冻结/REV 不做（owner 拍板）。

**证据**：unit 256→292、e2e 67→69；活体 12/12（3 frame 活渲染含 sidecar 交互、双向透传各一条、命名空间分离、长图 1840×8040@2x 烤入 3 frame）；验证后桶逐字节恢复。演示页 = 本地实例 `previews/mention-demo/`（excluded）。
