---
name: ios-app-preview-build
description: 在本仓库（iOS App Preview workbench）里搭预览内容：加 page / section / screen / 组件，改 board.json，做屏内手势动画（内联 data-preview-script 或 sidecar mount 两种形态）。只要任务涉及新增或修改 previews/ 下的屏、components/ 下的组件、页面清单 previews/_index.json，或用户说「加一屏」「加个 flow」「搭个对比」「做个交互」「写 board」，就先读本 skill 再动手——文件结构和挂载规则有几条不直观的硬约束（overlay 同级、fragment 无 bezel、脚本不进 ios-kit.js），跳过本 skill 很容易踩坑。
---

# ios-app-preview-build

在这个仓库里**搭预览内容**。总入口约定见根目录 [`AGENTS.md`](../../AGENTS.md)；标注评审走 [`ios-app-preview-annotate`](../ios-app-preview-annotate/SKILL.md)。

## 0. 服务

```bash
npm run dev    # http://127.0.0.1:5199/index.html（PORT 可覆盖，占用时自动换口）
curl -s http://127.0.0.1:5199/health
```

## 1. 加 screen（已有 section）

1. 写 `previews/<pageId>/<screenId>.html` — **只写屏内 fragment**（loader 负责手机壳）。正文在 `.ios-app` / `.ios-lockscreen`；**sheet / tabbar / backdrop 与之同级**（见 §1.1），不要写进滚动层。
2. 需要手势 / 动画时：同文件 `data-preview-script`，或 sidecar `previews/<pageId>/<screenId>.js` + 根节点 `data-preview-mount`（见 §7）。**不要**改 `ios-kit.js`——kit 只承载通用原语，产品逻辑放进 kit 会让所有页互相污染。
3. 在该页 `board.json` 的对应 `sections[].screens` 里追加 id 或对象。

字符串简写：

```json
"screens": ["settings", "onboard"]
```

带标题 / 单屏 shell：

```json
"screens": [
  { "id": "msg-lock", "title": "1 · 锁屏通知", "shell": "lock" }
]
```

文件名 = screen `id` + `.html`（sidecar = 同名 `.js`）。

### 1.1 Overlay 挂载（sheet / tabbar）

`.ios-app` 是**滚动层**（`overflow-y: auto`）。`.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 用 `position: absolute` 相对 **`.ios-screen`（手机视口）** 定位，所以必须与 `.ios-app` 同级、落在 fragment 顶层：

```html
<div class="ios-app" data-preview-mount>
  <div class="ios-nav">…</div>
  <div class="ios-page">
    <div class="ios-cell tappable" data-sheet-open="detail">…</div>
  </div>
</div>
<!-- overlay：关闭 </div> 之后，禁止塞回 .ios-app -->
<div class="ios-sheet-backdrop"></div>
<div class="ios-sheet" id="detail">
  <div class="ios-grabber"></div>
  <div class="ios-sheet-body">
    …
    <button type="button" class="ios-btn" data-sheet-close>Done</button>
  </div>
</div>
<!-- 有底栏时同样同级： -->
<!-- <div class="ios-tabbar">…</div> -->
```

范例：[`previews/library/home.html`](../../previews/library/home.html)（tab 页 + sheet + tabbar 全套）。

错挂的症状（用来自查）：sheet 关着仍占滚动溢出、滚到底能看见；开着时 panel 贴内容底而非手机底，画面变暗但 sheet 超出视口。

Sidecar 里查 sheet：`root` = `.ios-app`，overlay 不在 `root` 内，用 `root.closest('.ios-screen')` 或 `document`。

## 2. 加 section

在 `previews/<pageId>/board.json` 的 `sections[]` 追加：

```json
{
  "id": "checkout",
  "title": "结算流程",
  "layout": "row",
  "screens": [
    { "id": "cart", "title": "1 · 购物车" },
    { "id": "pay", "title": "2 · 支付" }
  ]
}
```

- `layout`: `row`（并排，适合 flow / AB 对比）| `column`（纵排）
- `shell`: 可写在 section（整段锁屏）或单个 screen
- `id` → `[data-ann-section]` / annotation `section`
- `title` → `.wb-lib-cap`；screen `title` → `.wb-screen-cap`（**只写文案**，字号来自 board tokens，勿设 font-size）

Canonical：[`previews/library/board.json`](../../previews/library/board.json)。顶层必须是 `sections[]`，不接受扁平 `{ "id", "screens" }`。

## 3. 加 workbench page

1. 建 `previews/<pageId>/board.json` + 若干 `*.html`（交互屏可加同名 `*.js`）
2. `previews/_index.json` 的 `pages[]` 增加：

```json
{ "id": "<pageId>", "title": "My Flow" }
```

3. 刷新；manifest 自动生成导航，`pageId` 同时是 annotate 的 `pageId`。不要自写第二套 loader。

Manifest 是 page id / title / order / default 的 SSOT；`board.json` 只写 `sections[]`。长期实例可用 gitignored `previews/_index.local.json` 覆盖整份清单（结构相同），模板文件保持干净。

## 4. 加 component

```
components/<id>/
  meta.json
  <variant>.html
```

```json
{
  "id": "bubble",
  "title": "Message Bubble",
  "system": false,
  "layout": "row",
  "variants": [
    { "id": "incoming", "title": "Incoming" },
    { "id": "outgoing", "title": "Outgoing" }
  ]
}
```

- `system: true` = kit 原语，少而稳；产品组件一律 `false`
- 可选 `components/_index.json` 排序；不在清单里的目录会自动发现、排在后面
- Component Library 页自动合成（`/components/board.json`），无需手动注册

## 5. 在 screen 里引用组件

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>
```

- `data-text` → 填 `[data-ios-slot="text"]`
- 改组件源 → Library 页和引用它的 flow 一起 HMR
- **不要**把组件 HTML 复制进 screen——复制体会让后续「改组件」类反馈只改到一处

## 6. Caption / HMR

- Caption 字号：`--wb-cap-section` / `--wb-cap-screen`（相对 `--wb-phone-w`）。只写文案。
- HMR：`previews/<page>/board.json|*.html|*.js`、`components/**` → 当前板自动刷新。

## 7. 可交互屏（A+B）

Workbench 用 `innerHTML` 挂屏，**裸 `<script>` 不会执行**——这是两种形态存在的原因。自定义手势跟屏走。

**A · 短逻辑（同文件内联）**

```html
<div class="ios-app">…</div>
<script data-preview-script>
  root.querySelector('[data-x]').addEventListener('click', function () { … });
  // optional: return function unmount() { … }
</script>
```

或 module 形态：

```html
<script type="module" data-preview-script>
  export default function mount(root) {
    // …
    return function unmount() { … };
  }
</script>
```

**B · 长逻辑（sidecar，推荐）**

1. `previews/<pageId>/<screenId>.js`：

```js
export default function mount(root) {
  // bind on root
  return function unmount() { /* remove listeners、clearInterval */ };
}
```

2. 屏根节点加 `data-preview-mount`（自动加载同名 `.js`），或 `<script type="module" data-preview-script src="./screenId.js">`。

- `root` = 该屏 `.ios-app` / `.ios-lockscreen`（可用 `data-preview-root="css"` 覆盖）
- `mount` 返回的 `unmount` 会在换板 / HMR 时调用——有定时器、全局监听时必须返回
- 样板：[`previews/library/timer.html`](../../previews/library/timer.html) + [`timer.js`](../../previews/library/timer.js)（B），[`previews/library/recipe.html`](../../previews/library/recipe.html)（A）

## 8. 反模式

- 扁平 `board.json`（缺 `sections[]`）
- 把 `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 放进 `.ios-app`（见 §1.1）
- 改 loader chrome / bezel / `ios-kit.css` 去「对齐」一条标注
- 产品手势 / 屏状态写进 `ios-kit.js`
- 手写 `.wb-lib-cap` / `.wb-screen-cap` 的 font-size
- 组件 HTML 复制进 screen（用 `data-ios-include`）
