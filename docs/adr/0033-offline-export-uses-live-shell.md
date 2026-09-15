# 0033 · 离线分享 HTML 用 workbench 的外壳：满铺画布 + 浮动面板 + 底部横条 + 窄屏适配

Status: 现行 · Date: 2026-09-15 · Scope: `src/server/lib/offline-page-export.js`、`src/server/lib/offline-page-builder.js`、`src/client/share-runtime.js`、`e2e/export-picker.spec.js`

Related: ADR 0031（外壳重设计，本条复用它的面板 / 横条 / 材质）、ADR 0025（画布缩放基准）、ADR 0015（导出入口）

**Decided**（owner 2026-09-15 定，方案 B + 窄屏适配）:

- **画布就是 workbench 的画布。** 导出文件（`<page>__interactive.html`）的 DOM 与 `index.html` 的
  画布链一致：`.wb` → `.wb-stage-wrap`（网格纸）→ `.wb-stage`（scrollport，`#wbstage`）→ `.wb-panel` →
  `.wb-zoom-wrap` → `.wb-library`（一张整体缩放的面，`transform: scale(zoom × 0.5)`）。section 是
  `.wb-lib-item`（`.wb-lib-cap` 引用号 + 标题，`.wb-sec-body.wb-sec-row` 三行网格），帧是
  `offline-page-builder.frameHtml` 产出的 `.wb-screen`（图注 / 机身 / 尺寸行）。样式不另写：导出早就
  内联了 `index.html` 的全部 `<style>` 与 `wb-tokens.css`，之前那套 `.share-*` 布局（两栏 grid、
  sticky 大纲、每个 section 一条横向滚动的 `.share-frame-row`、每帧一个 219 × 500 的固定盒子 +
  `sizeFrames()`）整套删除。锚不变：section `id="section-<id>"`、帧 `id="frame-<screenId>"`，
  根元素保留 `data-section-count` / `data-frame-count`。
- **大纲 = 浮动玻璃面板。** `aside.wb-side.wb-glass#wbside`，几何与材质全部来自内联样式（距边 12、
  radius `--wb-r-glass`、下沿停在横条上方）。内容是页名 + 大纲（`.ol-sec` / `.ol-row`，与
  `app/Sidebar.jsx` 同名，`.on` 表示当前）。宽度固定 `--wb-side-w` 252，不带拖宽。
  收起 = 根元素加 `.wb-side-collapsed`，与 workbench 同一条规则。
- **底部横条。** `.wb-strip.wb-glass#wbstrip`，居中一条：面板开关 → 页名 → `‹ n / N ›` 帧导航 →
  缩放读数（点击回 100%）→ 回中。没有 React：横条控件是普通 HTML，能从内联样式拿到的类（`.wb-strip`、
  `.wb-strip-div`、token）直接用，其余几条补在 `SHARE_CSS` 里（`.share-btn` 等）。
- **交互是一份不依赖任何模块的运行时** `src/client/share-runtime.js`：经典脚本，读成文本内联（与
  `frame-boot.js` 同一做法，不能含 `</script`）。语义照 `stage.js` / `board-navigation.js`：普通滚轮滚动；
  ctrl/meta + 滚轮围绕光标缩放（0.92 / 1.08，zoom 轴 0.5–5）；空格 + 左键、中键在任意位置平移，
  无修饰左键只在空白画布上平移；大纲点击与 ‹ › 把目标定位到**可用区**（视口减掉面板与横条的实际
  占位）；首次进入把第一个 section 按可用宽度适配，放得下就 100%。纯函数挂在 `window.__pinpointShare`
  上给单测。
- **窄屏（≤ 760px）。** 面板默认收起，打开时是整宽浮层，选完一帧自动收起；`.wb-sec-row` 改成竖排，
  一帧一列，按视口宽度适配缩放（438 宽的机身撑满 375）；横条只留面板开关 + 页名 + ‹ n/N ›；
  单指滚动走原生，不做自定义捏合缩放。375 宽下页面与画布都没有横向滚动。

**Why**: 之前的分享壳是导出自己的一套布局，和 owner 每天看的画布是两个东西：帧被钉死在 0.5 缩放的小盒子里，
不能放大看细节；一个 section 一条横向滚动条，1440 宽下一屏放不下七帧时只能拖横条；大纲是 sticky 的一栏，
不能收起。收到分享的人看到的东西和发出去的人在 workbench 里看到的不一样，对齐讨论时两边指的不是同一张
图。外壳（面板 / 横条 / 材质 / 图注字阶）在 ADR 0031 已经定型，导出文件也早就内联了同一份 CSS，
差的只是 DOM 结构和一份不依赖模块的运行时。

**Rejected**:

- **A · 只改标记，不做平移 / 缩放。** 把 `.wb-library` 直接铺在页面上、让 body 滚动。1440 宽下一张不能缩放
  的大图比现状还差：七帧一行超出视口，只能靠浏览器横向滚动，没有回中也没有定位。
- **C · 把 `stage.js` / `boot-prefs.js` 抽成共享模块给导出复用。** 会动 owner 每天在用的那一侧
  （模块边界、store 依赖、annotate 桥），收益只有一个消费者。等第二个消费者出现再抽；这份运行时
  的纯函数（缩放夹取、定位算式）已经与 `board-navigation.js` 逐字节同算，抽的时候直接合并。

**Consequences**:

- `buildOfflineShareHtml` 多一个输入 `shareRuntimeJs`；`offline-page-builder` 用 `readInlineScript`
  读 `frame-boot.js` 与 `share-runtime.js`，含 `</script` 直接拒绝。
- `@property --wb-board-zoom { inherits: false }` 在内联样式里：缩放值要写在 `.wb-library` 元素上
  才生效（`:root` 上那份只给读数），与 `boot-prefs.syncBoardZoomLayout` 相同。
- `.wb-sec-row .wb-screen` 是 `display:contents`：帧的几何取图注 / 机身 / 尺寸行三块的并集，
  不能读 `.wb-screen` 自己的 bounding box。
- e2e（`e2e/export-picker.spec.js`）断言新 DOM：画布链、面板与横条、滚轮 / ctrl+滚轮 / 面板开关、
  375 宽无横向滚动。旧的 `.share-*` 选择器不再存在。
- 分享页没有标注、没有 Section Navigator / minimap、没有拖宽：这些是 workbench 的工作面，不是分享面。
