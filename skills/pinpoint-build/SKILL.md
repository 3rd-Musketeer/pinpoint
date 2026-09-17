---
name: pinpoint-build
description: 在本仓库（pinpoint workbench）里搭预览内容：加 page / section / screen / 组件，改 board.json，做屏内手势动画（内联 data-preview-script 或 sidecar mount 两种形态）。只要任务涉及新增或修改 content/previews/ 下的屏、content/kits/ios/components/ 下的组件、页面清单 content/previews/_index.json，或用户说「加一屏」「加个 flow」「搭个对比」「做个交互」「写 board」，就先读本 skill 再动手——文件结构和挂载规则有几条不直观的硬约束（overlay 同级、safe area 接 token、fragment 无 bezel、脚本不进 ios-kit.js），跳过本 skill 很容易踩坑。
---

# pinpoint-build

在这个仓库里**搭预览内容**。总入口约定见根目录 [`AGENTS.md`](../../AGENTS.md)；标注评审走 [`pinpoint-annotate`](../pinpoint-annotate/SKILL.md)。

## 0. 服务

```bash
pinpoint status
```

核对服务 root 与当前工作区。仅在确需启动时用 `pinpoint start`；隔离开发使用独立端口、registry 和数据目录，不重启用户现用服务。

## 修改前后核对

先定位 page 的 registry 路径和 board，再列出本次要改、保持原样的 frame。按页面源文件修改，完成后对照清单逐屏检查，并报告已改、保留及未解决的项。共享 CSS 改动额外检查引用它的例外页面。

## 1. 加 screen（已有 section）

1. 写 `content/previews/<pageId>/<screenId>.html` — **只写屏内 fragment**（loader 负责手机壳）。正文在 `.ios-app` / `.ios-lockscreen`；**sheet / tabbar / backdrop 与之同级**（见 §1.1），不要写进滚动层。
2. 需要手势 / 动画时：同文件 `data-preview-script`，或 sidecar `content/previews/<pageId>/<screenId>.js` + 根节点 `data-preview-mount`（见 §7）。**不要**改 `ios-kit.js`——kit 只承载通用原语，产品逻辑放进 kit 会让所有页互相污染。
3. 在该页 `board.json` 的对应 `sections[].screens` 里追加 id 或对象。

字符串简写：

```json
"screens": ["settings", "onboard"]
```

带标题 / 单屏 shell：

```json
"screens": [
    { "id": "msg-lock", "title": "锁屏通知", "shell": "lock" }
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

范例：[`content/previews/library/home.html`](../../content/previews/library/home.html)（tab 页 + sheet + tabbar 全套）。

错挂的症状（用来自查）：sheet 关着仍占滚动溢出、滚到底能看见；开着时 panel 贴内容底而非手机底，画面变暗但 sheet 超出视口。

Sidecar 里查 sheet：`root` = `.ios-app`，overlay 不在 `root` 内，用 `root.closest('.ios-screen')` 或 `document`。

### 1.2 Chrome / safe area

顶底 inset 是 **Variables**（`ios-kit.css` `.ios-root`），不是随手写的像素：

| Token | 用途 |
|---|---|
| `--ios-safe-top` | 内容顶 inset（避 Dynamic Island） |
| `--ios-safe-bottom` | Home Indicator inset |
| `--ios-sb-h` | 状态栏高度本身（≠ safe-top） |

- 自定义顶栏对齐 `.ios-navbar`：`padding-top: var(--ios-safe-top)`，`height: calc(var(--ios-safe-top) + 44px)`。
- 自定义底栏 / composer：padding 含 `var(--ios-safe-bottom)`（与 `.ios-tabbar` / sheet 同理）。
- 优先复用 `.ios-nav` / `.ios-navbar`；自写 chrome 时**禁止**写死 `54` / `62` / `34`，也**禁止**用空 spacer div 代替 token。

数字以 `ios-kit.css` 为 SSOT；换机型 / 调 chrome 只改 token，screen 不跟改。

## 2. 加 section

在 `content/previews/<pageId>/board.json` 的 `sections[]` 追加：

```json
{
  "id": "checkout",
  "title": "结算流程",
  "layout": "row",
  "screens": [
    { "id": "cart", "title": "购物车" },
    { "id": "pay", "title": "支付" }
  ]
}
```

- `layout`: `row`（并排，适合 flow / AB 对比）| `column`（纵排）
- `shell`: 可写在 section（整段锁屏）或单个 screen
- `id` → `[data-ann-section]` / annotation `section`
- `title` → `.wb-lib-cap`；screen `title` → `.wb-screen-cap`（**只写文案**，字号来自 board tokens，勿设 font-size）

### 2.1 title 规矩（2026-08-17）

title 是单行短名词短语，只回答“这是什么”。引用编号由系统按 board 顺序自动派生
（section = A/B/C，frame = A1/B2，显示在 title 左侧），**不要在 title 里手写编号**，
否则画面上编号会出现两次。

- 单行：契约层硬拦换行（`validateBoard` 报错）。
- 短：名词短语，不用「·」拼接多段信息，不写图例、设计意图、对比结论。
- 正例：`锁屏通知`、`同日型基线 vs 当日 sankey`、`阴性对照（这种天不推）`。
- 反例：`★ SPIKE · B 形态 · 同日型基线 vs 当日 sankey — 直通带 = 照常的部分；彩色斜带 = 挤占……`
  （这是把整组图例塞进了 section title；正确做法是 title = `同日型基线 vs 当日 sankey`。）


### 2.2 导出 Frame 图片

导出属于 Workbench，不在单个 screen 里实现截图逻辑。唯一入口 = 画布 HUD 的「导出」
钮 → picker 对话框（当前页 proto tree 任意多选，section 行整选；实时预览；背景三档
画布 / 白底 / 透明）。输出固定 PNG 2×：单张直出 PNG，多张服务端打包 zip。
图注（引用号 + 屏名 + 尺寸）是图纸内容，导出永随（decisions 2026-08-15d）。
Agent / CLI 使用同一条隔离 Chromium 渲染链路：

```bash
npm run export -- --page library --section brew-flow --frame timer
npm run export -- --page library --section brew-flow
```

- 默认：PNG、2×、Canvas 背景（`#faf8f4`）、输出到 gitignored `exports/`。
- Frame 导出 = 图注 + 当前手机状态 + 尺寸行，48 CSS px 安全边距，不带标注、侧栏或相邻 Frame。
- Section 保持 `row` / `column` 和 Frame 顺序，带 Section / Frame 标题。
- 导出先克隆 live DOM，再在只含目标的页面截图，因此打开的 sheet / Ask User、选中态、输入值、内部滚动和 canvas 会被保留。
- 透明背景只能用 PNG。超大 2× Section 会明确提示改用 1×，不得静默换行、裁切或压扁 flow。
- 可用参数：`--scale 1|2`、`--background canvas|white|transparent`、`--format png|webp`、`--output <path>`。`--with-notes` 已退役，传了也只是空占位。

## 3. 加 workbench page

**页面放哪都行**——2026-08-17e 起实例页面不再住 `content/previews/`（那里只放进 git 的模板：library / doc-library）。在你自己的 topic（推荐 `topics/<topic>/prototypes/<pageId>/`）建 `board.json` + 若干 `*.html`（交互屏可加同名 `*.js`），然后登记：

```bash
pinpoint add <目录> --id <pageId> --title "My Flow" --board ios   # 画布页
pinpoint add <目录> --id <pageId> --title "My Doc"                # 文档页（默认 html）
```

登记后页面立即出现在 Pages（服务在线时 CLI 自动触发 reload）；热刷新、标注注入对 registry 页面全部同权。`content/previews/` 新增页面只限于要分发给所有使用者的模板内容（进 `content/previews/_index.json` + git）。

**完整单页 HTML 文档**（汇报页、说明页这类自带 `<head>` 和全套样式的）用 `"shell": "doc"`（registry 登记时 `--board html`，也是默认值），参考 `content/previews/doc-library/`。两点与 iOS 板不同：

1. **承载方式**：doc 走 iframe，文档原样渲染，loader 不包装也不做 fragment 校验——内联会让它的 `body{}` 规则失效、`<style>` 漏进 workbench。
2. **不画布化**：汇报页必须在读者真实的窗口尺寸下读，所以文档 1:1 铺满 stage，没有缩放、平移、画板与 Frame 标题。2026-08-16f 阶段 6 起，doc 屏是**条目**：一屏一个文档条目（`role` 缺省 `product`，`"draft"` 标草稿），侧栏「内容」区一次选中一个、stage 形态跟选中条目走（画布 / 阅读器页内切换），选择按页记住（`activeEntryIdByPage`），深链 `?page=<id>&entry=<screenId>` 直达。画布的 Frame 导出在这里也隐掉了——它出的图不等于真实版面；出图用「内容」区文档/草稿条目行上 hover 浮现的 **导出** 钮（HTML 完整 / 去 CSS HTML / 长图 PNG）。注意坍缩：纯单 doc 屏页的「内容」区整区不出（也就没有导出钮），多条目页才有条目行。

**混合板**（阶段 6，阶段 7 出「内容」区形态）：同一份 `board.json` 可以同时有 app/lock 屏和 doc 屏——app/lock 屏合成一个「画布」条目（只它们上画布，选中时条目行下挂 frame 树），每个 doc 屏各是一个文档/草稿条目；「内容」区分产物组（画布/文档/网页条目 + 类型 tag）与草稿组（纯标题行）。页级 `"mode"` 只剩两个用途：给 `board.json` 校验提供缺省壳、以及深链 `?mode=` 提示；stage 形态不再看它。

screen 可用 `"src"` 指向任意 URL。仓库外的内容不要再用符号链接挂进 `content/previews/`——`/sites/` 服务拒绝逃出条目目录的 symlink（防泄漏契约），正确做法是 `pinpoint add` 直接登记源目录。

**标注零接线**：serve 即注入（2026-08-17e 契约统一）——服务端对 `/sites/` 与 `content/previews/` 的完整文档一律自动注入 `/annotate.js`，页面不需要自己抄注入脚本；`?annotate=off` 单请求豁免（导出管线走这里）。文件本身保持干净：`file://` 打开、导出 PNG、外发副本都不带标注 UI、不联网。**正文不必打 `wb-html-surface` / `data-ann-surface`**：独立文档 / HTML 板 iframe 里，annotate 把整份 body 当可标注区域。标注落在文档自己的 page key 下（previews 页 = 默认 entry `pinpoint` 的桶，registry 页 = 条目 id 的桶，路径从 `/health` 的 `dataDir` 读）。

**doc 正文可以 mention 画布上的 frame**（阶段 5）：写一个空挂载点
`<div data-pinpoint-frame="<pageId>/<screenId>"></div>`（值就是 `@frame:` 指示器里的身份；
组件库写法 `components/<comp>/<variant>`），annotate client 会把它水合成活 frame
（iframe → `/api/frame`，同一份 fragment + 机壳 + 可交互脚本）。挂载点保持空、别放子
节点（有子节点会被当作导出烤图产物而跳过水合）；样式隔离天然（iframe），高度自适应内容。
文档里对嵌入 frame 的标注与画布同桶同账本、两处实时渲染——所以评审稿可以直接引用活原型
而不是截图。doc 导出时挂载点烤成 2× 静态 PNG（`html-no-css` 换成文本引用），产物不联网、
不可交互。示例：`content/previews/mention-demo/`（实例本地页，模板不带）。

Pages 是单一混排列表（模板页 + registry 条目；2026-08-16 阶段 2 起 iOS/Web/HTML Seg 已退役），Component Library 作为系统行居首。

3. 刷新；manifest 自动生成导航，`pageId` 同时是 annotate 的 `pageId`。不要自写第二套 loader。

Manifest 是 page id / title / order / default / mode 的 SSOT；`board.json` 只写 `sections[]`。长期实例可用 gitignored `content/previews/_index.local.json` 覆盖整份清单（结构相同），模板文件保持干净。

### 3.1 仓库外的项目：registry dir entry

要评审的项目不在本仓库时，不要把文件复制进来——用 CLI 在本机 registry 登记一个 `dir` entry：

```bash
pinpoint add /abs/path/to/your-app/dist --title "Your App" --board ios
# 没 `npm link` 过就用 node bin/pinpoint.mjs add ...
```

CLI 会从目录名派生 id（slug 化，冲突自动追加 `-2`/`-3`；`--id` 显式指定且冲突时报错而不是覆盖），原子写入 `~/.pinpoint/registry.json`（`--registry` / `PINPOINT_REGISTRY` 覆盖文件位置），并在服务可达时自动 `POST /registry/reload`——**不用重启服务**；服务没跑则下次启动生效。单个 `.html` 文件同理（kind `file`，只 serve 该文件，恒 doc 壳，`--board ios` 会被拒）；SPA / 自己起服务的应用登记 URL（kind `url`）——阶段 4 起它经同源代理以 doc 壳嵌进 workbench Pages（活应用 iframe 阅读器，标注照常；机制与盲区见 [pinpoint-annotate](../pinpoint-annotate/SKILL.md) §2），不经浏览器扩展也能标。

**归属既有 Page（2026-08-16f 阶段 8）**：`pinpoint add ./draft.html --page <pageId> [--draft]` 让条目**不自成 Pages 行**——它作为目标页「内容」区的 doc 条目出现（`--draft` 落草稿组，缺省落产物组；role 缺省 product）。`<pageId>` 必须可解析（本地 manifest 页或另一 registry 条目 id，CLI 直接校验，不可解析响亮报错）；url 条目恒为独立页，`--page` 与之互斥。典型场景：在别的项目写完一页草稿 HTML，直接登记进既有线程页当草稿。阅读器 / 标注（落条目自己的桶）/ 导出（条目行 hover 钮）全部复用 doc 管线；从 registry 删掉该条目即从侧栏消失，不留死行。

- 服务把该目录**只读** serve 在 `https://pinpoint.localhost/sites/your-app/`：registry 即白名单，未知 id / `..` 穿越 / symlink 逃逸一律 404；目录回落 `index.html`。
- HTML 响应在 `</body>` 前自动注入 `window.__pinpointEntry='your-app'` + `/annotate.js`；`?annotate=off` 原样输出磁盘字节（导出管线和 workbench 内联加载走它）。
- 该 entry 自动成为 workbench 页面（跳过 workbench 自己的 `pinpoint` entry；`content/previews/` 里同 id 的页面优先；**带 `page` 归属字段的条目例外**——它不进 Pages，而是并入目标页的「内容」区，见上）。`board` 字段选壳：`ios` / `html`，缺省 `html`（残留 `web` 归一到 `html`）。
- 页面结构仍由它自己的 `board.json` + screens 决定（从 `/sites/<id>/board.json` 拉取）——schema 与本仓页面完全相同，编辑对象是登记目录里的磁盘文件，serve 只读不影响改稿。**没有 `board.json` 也能打开**：服务合成 doc 阅读板，目录顶层每个 `*.html` 一屏（侧栏切版本）；磁盘 `board.json` 一旦补上立即优先。要机壳画布（`board:"ios"`）则必须手写 `board.json`。
- 标注落在 `~/.pinpoint/your-app/` 桶，与本仓 `pinpoint` 桶互不干扰。
- 验证：`curl -s https://pinpoint.localhost/registry | jq '.entries[] | select(.id=="your-app")'` 能看到 entry；`curl -s https://pinpoint.localhost/sites/your-app/ | grep __pinpointEntry` 能看到注入；workbench 侧栏出现该页（CLI 触发的 reload 会让打开的 workbench 自动刷新 Pages）。

## 4. 页面内容与共享样式

业务 HTML 直接放在所属 page，保留 iOS kit 与共享 CSS。不要因跨屏重复就主动建立组件库。仅在实际遇到 `data-ios-include` / `data-ios-from` 时读取[存量兼容说明](../../docs/legacy-includes.md)。

改共享 CSS 前列出匹配页面；如果需求只针对部分 frame，收窄到这些 frame 的 class。改后检查目标与例外 frame，避免扩大范围。

## 6. Caption / HMR

- Caption 字号：`--wb-cap-section` / `--wb-cap-screen`（相对 `--wb-phone-w`）。只写文案。
- HMR：`content/previews/<page>/board.json|*.html|*.js`、`content/kits/ios/components/**` → 当前板自动刷新。

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

1. `content/previews/<pageId>/<screenId>.js`：

```js
export default function mount(root) {
  // bind on root
  return function unmount() { /* remove listeners、clearInterval */ };
}
```

2. 屏根节点加 `data-preview-mount`（自动加载同名 `.js`），或 `<script type="module" data-preview-script src="./screenId.js">`。

- `root` = 该屏 `.ios-app` / `.ios-lockscreen`（可用 `data-preview-root="css"` 覆盖）
- `mount` 返回的 `unmount` 会在换板 / HMR 时调用——有定时器、全局监听时必须返回
- 样板：[`content/previews/library/timer.html`](../../content/previews/library/timer.html) + [`timer.js`](../../content/previews/library/timer.js)（B），[`content/previews/library/recipe.html`](../../content/previews/library/recipe.html)（A）

## 8. 反模式

- 扁平 `board.json`（缺 `sections[]`）
- 把 `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 放进 `.ios-app`（见 §1.1）
- 手写 safe-area 像素或不接 `--ios-safe-*`（见 §1.2）
- 改 loader chrome / bezel / `ios-kit.css` 去「对齐」一条标注
- 产品手势 / 屏状态写进 `ios-kit.js`
- 手写 `.wb-lib-cap` / `.wb-screen-cap` 的 font-size
- title 里手写编号 / 用「·」拼接多段信息 / 塞图例与意图（title = 单行短名词短语，见 §2.1）
- 新增 section / frame 说明字段；评审意见应使用 annotations
- 为普通改稿主动搭建业务组件库
