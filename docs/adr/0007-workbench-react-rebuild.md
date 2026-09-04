# 0007 · workbench 技术栈重构（react-rebuild milestone 收官）

Status: 现行 · Date: 2026-08-10 · Scope: `workbench/`

**Shipped**: goal `.gdd/goals/goal-20260810-workbench-react-rebuild.md`（本地 exclude）status=done；commit 链 `0acfdb2..c7c3760`（16 个，dev 未 push，发布等下一轮视觉组件库决策后一并走）。
**Decided**:
- chrome（侧栏/标注面板/HUD/设置/frame menu）= React 19 + zustand（`workbench/app/`，`store.js` 是共享状态唯一住处）；舞台保持命令式（`workbench/stage.js` + 簇模块 pages/board-nav/boot-prefs/screen-load/preview-mount/ann-bridge/export-core/frame-notes）。DOM id/class 是 e2e 契约，不许破。
- server state = TanStack Query（`app/query-client.js`，`staleTime: Infinity`；SSE `preview:update` 桥 `invalidateQueries` 是唯一失效源；手工 cacheBust/boardLoadGen 机械删除）。
- 弹层行为 = Radix Primitives（frame menu → DropdownMenu 非 portal + popper 置惰——`.wb-library` 是 transform:scale 空间，JS 量测定位在缩放 ≠1 必错位）；export dialog 保持原生 `<dialog>`+showModal（e2e 锁元素名 `dialog.wb-export-dialog`，原生已覆盖 focus trap/dismiss/焦点还原，评估证据见 goal 文档）。
- 视觉 = `--wb-*` token 体系（`scripts/build-wb-tokens.mjs` 生成 `workbench/wb-tokens.css`，`wb-tokens.test.js` 守鲜度；Radix Colors 锚定 ≤1 档，accent #007aff 锁定不漂移；radius/type/shadow/danger 阶梯归一，散装值清零）；`lib/ann-list.css` 双端同步 + annotate-inline 三向漂移守卫。
- 注入端 `client/annotate.js` 保持 vanilla 单文件（不进 React/构建）；URL 深链 `?page=&mode=`（读侧 URL 优先 prefs，写侧 replaceState 单向镜像）。
**Why**: 原 workbench.js 是 3621 行命令式单文件（87 个模块级 var），手写 DOM reconciliation/字符串拼 HTML/散装视觉值三重失控。
**纪律**: 禁循环 import（子模块不 import stage.js，反向依赖走 init*Deps DI）；lib/ 纯函数；每刀双门（npm test + e2e）绿后单 commit；e2e 中断后 `lsof -ti :5299 | xargs kill` 防孤儿端口。
