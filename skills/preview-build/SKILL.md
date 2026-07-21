---
name: ios-app-preview-build
description: 在 iOS App Preview workbench 里加 page / section / screen / component，或改 board.json；含可交互屏的 A+B 脚本约定（data-preview-script / data-preview-mount sidecar）。当用户说加页、加 flow、加示例、加组件、写 board.json、搭预览板、做屏内手势/动画，或在 topics/ios-app-preview-html-template 下搭 HTML iOS 预览时使用。Topic dir-ref（skills/preview-build/）；不要安装到 .claude/skills。
---

# ios-app-preview-build

在 `topics/ios-app-preview-html-template/` 里**搭预览内容**。先读 topic [`AGENTS.md`](../../AGENTS.md)。标注评审走 [`../annotate/SKILL.md`](../annotate/SKILL.md)。

**Dir-ref only** — 不要 symlink / 安装到 `.claude/skills/`。

## 0. 服务

```bash
cd topics/ios-app-preview-html-template && npm run dev
# http://127.0.0.1:5199/  ·  curl -s http://127.0.0.1:5199/health
```

## 1. 加 screen（已有 section）

1. 写 `previews/<pageId>/<screenId>.html` — **只写屏内 fragment**（loader 包 bezel）。正文在 `.ios-app` / `.ios-lockscreen`；**sheet / tabbar / backdrop 与之同级**（见 §1.1），不要写进滚动层。
2. 需要手势 / 动画时：同文件 `data-preview-script`，或 sidecar `previews/<pageId>/<screenId>.js` + 根节点 `data-preview-mount`（见 §7）。**不要**改 `ios-kit.js`。
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

`.ios-app` 是 **滚动层**（`overflow-y: auto`）。`.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 用 `position: absolute` 相对 **`.ios-screen`（手机视口）** 定位。

**正确**：与 `.ios-app` 同级，落在 fragment 顶层（loader 塞进 `.ios-screen` 后即盖住整机）：

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

范例：[`previews/library/feed.html`](../../previews/library/feed.html)、[`previews/dr-shape/shape.html`](../../previews/dr-shape/shape.html)。

**禁止**：把 sheet / backdrop / tabbar 写进 `.ios-app`（或 `.ios-page`）。错挂后：关着仍占滚动溢出、滚到底能看见；开着时 panel 贴内容底而非手机底，画面变暗但 sheet 超出视口。

Sidecar：`root` = `.ios-app`，查 sheet 用 `root.closest('.ios-screen')`（或 `document`），不要只在 `root` 内 `querySelector`。

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

- `layout`: `row` | `column`
- `shell`: 可写在 section（整段锁屏）或单个 screen
- `id` → `[data-ann-section]` / annotation `section` (also stamps legacy `data-ann-group`)
- `title` → `.wb-lib-cap`；screen `title` → `.wb-screen-cap`（**只写文案**，勿设 font-size）

Canonical: `previews/library/board.json`。**禁止**扁平 `{ "id", "screens" }` 顶层（无 `sections`）。

## 3. 加 workbench page

1. `previews/<pageId>/board.json` + 若干 `*.html`（交互屏可加同名 `*.js`）
2. `previews/_index.json` 的 `pages[]` 增加：

```json
{ "id": "<pageId>", "title": "My Flow" }
```

3. 刷新；manifest 自动生成 `data-vpage` 导航，值也是 annotate `pageId`。不要自写第二套 loader。

Manifest 是 page id / title / order / default 的 SSOT；`board.json` 只写 `sections[]`，顶层 `title` 会被忽略。

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

- `system: true` = kit 原语，少而稳
- 可选 `components/_index.json` 排序；system 段始终在前
- Component Library 页自动合成（`/components/board.json`）

## 5. 在 screen 里引用组件

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>
```

- `data-text` → 填 `[data-ios-slot="text"]`
- 改组件源 → Library + 引用它的 flow 一起 HMR
- **禁止**把组件 HTML 复制进 screen

## 6. Caption / HMR

- Caption 尺寸：`--wb-cap-section` / `--wb-cap-screen`（相对 `--wb-phone-w`）。Agent 只写文案。
- HMR：`previews/<page>/board.json|*.html|*.js`、`components/**` → 当前板刷新。

## 7. 可交互屏（A+B）

Workbench 用 `innerHTML` 挂屏，裸 `<script>` 不会执行。自定义手势跟屏走，不要改 `ios-kit.js`。

**A · 短逻辑（同文件）**

```html
<div class="ios-app">…</div>
<script data-preview-script>
  root.querySelector('[data-x]').addEventListener('click', function () { … });
  // optional: return function unmount() { … }
</script>
```

或 module：

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
  return function unmount() { /* remove listeners */ };
}
```

2. 屏根节点加 `data-preview-mount`（自动加载同名 `.js`），或：

```html
<script type="module" data-preview-script src="./screenId.js"></script>
```

- `root` = 该屏 `.ios-app` / `.ios-lockscreen`（overlay 不在 `root` 内，见 §1.1）
- 样板：`previews/time-insight/tear-calendar.html` + `tear-calendar.js`
- kit 只留 tabs / sheet / segmented / clock 等通用原语

## 8. 反模式

- 扁平 `board.json`（缺 `sections[]`）
- 把 `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 放进 `.ios-app`（必须 fragment 顶层同级，见 §1.1）
- 改 loader chrome / bezel / `ios-kit.css` 去「对齐」一条标注
- 产品手势 / 屏状态写进 `ios-kit.js`
- 手写 `.wb-lib-cap` / `.wb-screen-cap` 的 font-size
- 安装本 skill 到 `.claude/skills/`
