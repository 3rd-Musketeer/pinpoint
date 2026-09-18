# 0034 · 外壳层级：命名阶梯 `--wb-z-*` + 两条堆叠上下文规则 + 测试守

Status: 现行 · Date: 2026-09-17 · Scope: `scripts/build-wb-tokens.mjs`、`src/workbench/wb-tokens.css`、`index.html`、`src/workbench/`（`ann-bridge.js`、`app/*.jsx`、`layering.test.js`）、`src/client/annotate.js`、`e2e/workbench.spec.js`

Related: ADR 0031（外壳重设计，“列表不盖被定位气泡”那一条的层级含义由本条落实）、ADR 0024（Popper 置惰收敛，右键菜单 Portal 到 body 的前提）

**Decided**:

- **一份命名阶梯。** 外壳里每一个带 z-index 的元素从 `--wb-z-*` 挑一档，代码里不写数字。阶梯在
  `scripts/build-wb-tokens.mjs` 里生成，每档一行注释写清“谁用、压谁、不压谁”，值留空档：
  marks 10 → panel 20 → dock 30 → hud 40 → marks-active 50 → strip 60 → float 100 → float-2 110；
  画布内另有一条子阶梯 cap 30 → frame-menu 50（`.wb-library` 是 transform 上下文，只和帧内容比）。
  表在 `docs/design.md` “层级”一节。两层不编号：top layer（原生 dialog showModal；`#ann-overlay`
  挂进 modal 或挂在 body 时的 popover）与客座层（`#ann-toolbar` / `#ann-sidebar` /
  `#ann-export-overlay` 的 21474836xx，注入到别人页面时和宿主竞争，workbench 里不出现）。
  `#ann-overlay` 内部的 1 / 2 / 3 / 4 / 5 / 6 / 10 只在 overlay 内部比，数字保留，不进阶梯。
- **R1** `.wb { isolation:isolate; }`：外壳自成一个堆叠上下文，页内各档只在它里面比；body 上的
  portal（float 档）与 top layer 天然在整个外壳之上。
- **R2** `.wb-stage-wrap` 永远不能成为堆叠上下文：不许出现 z-index / transform / filter /
  backdrop-filter / opacity<1 / contain（paint | layout | strict | content）/ isolation / will-change /
  perspective / mix-blend-mode / clip-path / mask。它的孩子（`#wbstage`、`#ann-overlay`、
  `#wb-ann-gutter`、`#wbdock`、`.wb-canvas-dock`）靠 z token 与 `.wb-side` / `.wb-strip` 交错。
- **测试守。** `src/workbench/layering.test.js` 扫源码：z 值不走 token 就失败，例外在允许名单里逐条写
  原因；解析 `index.html` 断言 R1 / R2；比对 `annotate.js` 的 `var(--wb-z-*, N)` 兜底数与 token 同值。
  `e2e/workbench.spec.js` 读计算样式断言 R1 / R2，用 `elementFromPoint` 断言选中气泡压过列表、
  列表与气泡都在横条之下、右键菜单在外壳之上。

**Why**: 同一类事故出了三次。2026-08-17 全局 popper 置惰把右键菜单压成 static（ADR 0024）；
2026-09-04 弹出列表盖住被定位的气泡（ADR 0031 的 owner 批注 2）；2026-09-08 e890a08 把 `#ann-overlay`
无条件送进 top layer，钉子和命中框画到底部横条上面，2026-09-17 才发现。根因两条：每个元素按感觉挑一个
数字，没有一份看得见的阶梯，新加的元素只能猜自己该比谁大；`.wb` / `.wb-stage-wrap` 是不是堆叠上下文
全凭巧合，没人守，任何一处顺手加的 transform 都会让整组孩子塌到面板之下或之上。命名阶梯解决第一条：
挑档时看得到相邻的是谁。R1 / R2 加测试解决第二条：结构前提变成显式契约。

**Rejected**:

- **全部搬进 top layer。** 把钉子、气泡、composer 都用 popover 送进 top layer，就不用和面板 / 横条比。
  否掉：top layer 里没有阶梯，外壳内部“横条永远在最上、列表盖画布但不盖被定位气泡”这套顺序会整个丢掉；
  原生 modal 打开时 modal 之外的节点 inert，overlay 进不进 top layer 要按挂载点分情况，语义会乱。
  overlay 只在挂进 modal 或挂在 body 时进 top layer 的规则（5988ba4）保留。
- **只改数字不改结构。** 把 5 / 6 / 7 / 8 / 9 / 10 换成留空档的数字，不动 `.wb` 与 `.wb-stage-wrap`。
  否掉：数字再整齐，`.wb-stage-wrap` 再加一个 transform 就整体塌，e890a08 这类事故还会再来一次。

**Consequences**:

- `index.html` 六处、`ann-bridge.js` 一处、`annotate.js` 两处、四个 jsx 的 Tailwind `z-50` / `z-[60]`
  全部换成 token 引用（Tailwind v4 的 `z-(--wb-z-*)` 写法）。`annotate.js` 带兜底值，因为独立文档页不
  加载 `wb-tokens.css`。
- 新元素先挑 token；挑不到就在 `build-wb-tokens.mjs` 加一档并写注释，重跑 `npm run build:tokens`。
- `toggle-group.jsx` 的 `focus:z-10` 是组件内部序，留在允许名单里。
- `docs/design.md` “钉子与评论卡”里“浮层使用 top layer”一句改为只在 modal / body 挂载时成立。
- 2026-09-18 owner 决定：输入框最高。加一档 `--wb-z-composer` 70（横条 60 之上、float 100 之下）；workbench 挂法下
  `#ann-chrome`（lasso / tip / 输入框）不再是 `#ann-overlay` 的孩子，而是它在 `.wb-stage-wrap` 里的兄弟，坐标不变
  （两者都是同一父级的 inset:0）。modal / body 两种 top layer 挂法里 chrome 仍留在 overlay 内。
  `--wb-z-marks-active` 从此只管点亮的气泡与 flash。
