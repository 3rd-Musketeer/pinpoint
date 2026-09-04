# 0025 · 画布缩放基准重定标（旧 50% 成为新 100%）

Status: 现行 · Date: 2026-08-17 · Scope: `src/workbench/lib/canvas-zoom.js`、`index.html`

**Decided**（owner 2026-08-17 提出「原来的 50% 应该是现在的 100%，我要调整的是默认视窗大小」后确认方向）：

- **视觉 = zoom × 0.5 烘进渲染基准**，不再由 zoom 值本身承担：`index.html` 的 `.wb-library` transform 改 `scale(calc(var(--wb-board-zoom, 1) * 0.5))`，`syncBoardZoomLayout` 的 wrap 量测共用同一常量 `BASE_CANVAS_SCALE`（lib/canvas-zoom.js）——全库只有这两个消费点，其余（minimap / 聚焦 / 标注几何）都靠 `getBoundingClientRect` 量测，自动一致。HUD 100% = owner 舒适默认（旧轴 50% 的视觉）；「重置为 100%」手势语义自然变成「回到默认大小」。
- **zoom 轴范围 0.5–5**（× 0.5 后视觉跨度仍是 0.25–2.5，与旧轴相同）；设置视图 75/100/125/150 预设不变。
- **存量视口一次性迁移**：pageViewports 的 canvasZoom 全部 ×2（clamp 到新轴范围）保持每页视觉不变，`zoomAxis:2` 标记防重跑（仿 migrateLegacyCanvasZoom 先例；`data-fit` 自动适配与画布无关，preview-mount 挂板时剥除，不受影响）。

**Why**: 08-16 把默认缩放降到 50% 治好了「太大」，但留下了数字语义偏心——舒适区在 50%、100% 反而过大，缩放轴的「中点」不是「默认」。owner 要的是基准本身变小：100% 看起来就是舒服的大小，放大才去 200%。本刀把 0.5 从「默认值」下沉为「基准常量」，zoom 轴回到以默认为中心。

**注**: e2e 顺得一条经验——等 200ms 防抖落盘的 expect.poll 回调必须容错返回 undefined，链式取值抛 TypeError 时部分 Playwright 版本不重试（记录在 debugging.md 的 flake 条目语义内）。
