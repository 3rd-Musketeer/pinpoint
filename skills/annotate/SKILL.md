---
name: ios-app-preview-annotate
description: iOS App Preview 模板的 Figma 式标注评审工具。用户在 workbench 的「标注」模式里点选/框选设计稿元素写标注、画移动箭头、粘参考图；「交互」模式用于演示（可选中文字）。标注按 page → section → frame（pageId + section + screenId）落盘，Claude 读文件逐条改。当用户说「标注」「标好了」「读一下标注」「清空标记」，或在 topics/ios-app-preview-html-template 下做 iOS 预览/AB 迭代评审时使用。Topic dir-ref（skills/annotate/）；不要安装到 .claude/skills。
---

# ios-app-preview-annotate

iOS App Preview 模板（`topics/ios-app-preview-html-template/`）的标注评审闭环：**用户标 → 我读 → 我改 → 用户清空 → 下一轮**。全程离线、零模型依赖；锚定基于 CSS selector，整机 `transform: scale()` / 窗口缩放都不错位。

搭页 / 改 `board.json` 走 [`../preview-build/SKILL.md`](../preview-build/SKILL.md)。总入口：[`../../AGENTS.md`](../../AGENTS.md)。

运行时：`skills/annotate.js` + Vite `plugins/annotate-api.js`，单端口 **5199**。基于 [xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)，加了 section / `pageId` / `screenId`、`ios-kit.js` 自动注入。

**用法**：topic dir-ref。**不要** symlink / 安装到 `mori-ws/.claude/skills/`。

## Domain language

| Term | Meaning |
|---|---|
| **annotate / 标注** | Mode + activity (click → open annotate box). Shortcut **A**. |
| **interact / 交互** | Demo mode (default): product click/scroll; text selection allowed; no annotate hit. |
| **annotation** | One persisted review item (`annotations[]`). |
| **content** | Annotation body text (legacy field was `comment`). |
| **page** | Workbench sidebar page (`pageId` / `data-vpage`). |
| **canvas → section → frame** | Board hierarchy. |
| **screen** | iOS content inside a frame (`previews/<page>/<screenId>.html`). |
| **frame** | Phone/comp shell on the board ≈ screen + chrome; frame id = `screenId`. |

## Indicators (copy for agents)

Short, explicit locators — **not** a new entity. They are query strings over existing JSON fields.
Agent: read the whole `~/.html-annotate/*.json`, then filter (or use a one-off `jq`). No resolver CLI.

```
@page:<pageId>
@section:<pageId>/<sectionId>
@frame:<pageId>/<screenId>
@a:<id>
```

| Indicator | Means | Filter fields |
|---|---|---|
| `@page:smart-todo` | all annotations on that workbench page | `pageId == "smart-todo"` |
| `@section:smart-todo/inbox` | all under that section | `pageId` + `section` |
| `@frame:smart-todo/today` | all on that frame/screen | `pageId` + `screenId` |
| `@a:ab12cd` | one annotation | `id == "ab12cd"` |

**Copy UI**

- Pages list row 🔗 → `@page:<id>`
- Annotate box 🔗 → most specific for the target (`@a` only after the annotation is saved; unsaved falls back to section/frame/page scope)

**Matching rule:** scope indicators require `annotation.pageId` to equal the indicator’s pageId. Rows missing `pageId` (legacy) do **not** match `@page` / `@section` / `@frame` (still match `@a:id`).

Example (optional):

```bash
jq '.annotations[] | select(.pageId == "smart-todo" and .section == "inbox")' ~/.html-annotate/*.json
```

Mentions inside `content`: write `[@a:<id>]`. Legacy `[@m:<id>]` is still read and upgraded on save.

## 1. 保证服务在跑（每次涉及标注前先做）

```bash
curl -s --max-time 1 http://127.0.0.1:5199/health || \
  (cd topics/ios-app-preview-html-template && nohup npm run dev >/dev/null 2>&1 & \
   sleep 1 && curl -s http://127.0.0.1:5199/health)
```

- 端口 **5199**；先探活再启动。
- mori-ws：`preview_start ios-preview-kit`。
- 落盘：**磁盘 SSOT** `~/.html-annotate/<页面名>.json`（含 `revision`）；参考图：`~/.html-annotate/images/`。
- 浏览器 `localStorage` 只是缓存；启动时 `GET /marks/<page>` hydrate，多窗口经 `GET /events`（SSE）同步。
- 所有修改（含清空）走串行 `POST /save`；`baseRevision` 必填，已移除 `/clear` endpoint。
- Workbench prefs（当前页 / 缩放 / 侧栏）在 `ios-preview-wb`，**不同步**（viewer 状态）。

## 2. 注入：模板自动，无需手动

`ios-kit.js` 在 localhost 自动注入 `/annotate.js`（同端口；服务没跑则静默失败；非本机 host 不注入）。

- link 了 `ios-kit.js` 的预览零样板即有标注。
- 关掉：`<html data-annotate="off">`。
- 裸 HTML：`</body>` 前 `<script src="http://127.0.0.1:5199/annotate.js"></script>`。

## 3. 用户怎么用

侧栏 **Pages** + **Annotations**（可折叠）：

- Pages：顶端 **Component Library**；其下 flow 页。每行 🔗 复制 `@page:<id>`。
- Annotations：**标注 / 交互** 切换、暂停、清空、Pin；列表按 section 分组；点一条跳转（跨 page 会先切 page）；× 删除单条；过滤 全部 / 当前示例。

画布：

- **A** 切换 标注 ↔ 交互
- **标注**：单击元素立即在画布底部打开 Target Composer；composer 打开期间继续单击会向当前草稿添加 target，textarea 保持焦点和光标。点屏标题 / bezel 标整机 **frame**；**Alt/⌥+单击**屏内内容升到 frame；拖拽框选；空格仍可 pan 画布。Shift 不参与画布选择，只保留输入法与 Shift+Enter 语义
- **交互**：演示产品（可选中文字；中键 / Space 拖动画布）；不打开标注框
- Target Composer：默认“仅引用”；“插入到文本”会在当前光标插入 `[indicator N]`。Pill hover 高亮，点击定位并闪烁，尾部 × 移除 target；已有标注的唯一 target 不能单独移除。文字（`content`）、粘图、「改文案」「调研」、「移动到」箭头和 `@` 引用其他标注保持可用；**🔗** 复制 indicator（已保存 → `@a:`；未保存 → section/frame/page scope）
- Composer 标题栏左侧的六点手柄是唯一拖动区域。拖放后 composer 固定在 viewport 新位置，并在本次页面会话的后续打开中复用；textarea、pill、按钮和框体空白处都不触发移动
- Composer 使用隔离草稿：保存才替换 `annotations[]`；取消、Esc、换 page、暂停或退出标注模式都会回滚。另一条 badge 不会静默切走，需先保存或取消。Region 复用 composer，但不与 element targets 混合
- **Esc** 关 mention / 关框 / 取消拖拽
- Overlay 挂在 `.wb-stage-wrap`（不盖侧栏）

Workbench：侧栏可收起；每页记住 scroll+zoom；HUD 缩放 / 回中。

## 4. 我怎么读标注（用户说「标好了」时）

```bash
ls -t ~/.html-annotate/*.json
```

- `path` = 被标页面（workbench 多为壳 `index.html`）。
- 先按 `pageId`，再按 `section`，再用 `screenId` / `selector` 区分同 section 多屏（AB）。
- 若用户贴了 indicator：按 `@page` / `@section` / `@frame` / `@a` 过滤后再改。
- 裸页 / `starter.html` 才直接改 `path` 文件。

### Schema

Disk document:

```json
{
  "page": "index.html~…",
  "path": "/index.html",
  "revision": 3,
  "annotations": [ /* … */ ]
}
```

Per annotation:

- `pageId` — workbench page (`library` / `components` / …)
- `section` / `sectionLabel` — board section (`[data-ann-section]`; legacy `group` / `data-ann-group` still read)
- `screenId` — frame id (= screen file id)
- `type` — `element` | `region`
- `id` — 稳定短 uid（6 位 `[a-z0-9]`）
- `indicatorKind` — optional `page` | `section` | `frame` | `annotation` (drives 🔗 copy)
- `selector` / `rect` / `content` / `move` / `images` / `research` / `changeTo` / `mentions`
- `targets` — every saved `element` annotation writes `[{ ref, selector, text }, …]`。`ref` 是 annotation 内稳定的 `i1`, `i2`, …；删除后不重排，新 target 用历史最大编号加一。顶层 `selector` / `text` 始终镜像第一个目标（兼容旧读法）
- Legacy dual-read on hydrate: `marks`→`annotations`, `comment`→`content`, `group`→`section`, `[@m:id]`→`[@a:id]`

**`changeTo: true`：** 用户点了「改文案」。把目标文案改成 **本条 `content` 的正文**（去掉 mention 语法后的可读文案即可）。侧栏 tag：`✎`。

**Mentions：**

- UI / 侧栏摘要显示 `@<n>`（当前序号）。
- 磁盘 `content` 存稳定引用：`[@a:<id>]`（例如 `[@a:ab12cd]`）。
- 可选 `mentions: ["ab12cd", …]` 便于扫引用。
- Agent 读盘时：把 `[@a:id]`（或遗留 `[@m:id]`）解析到对应 annotation（按 `id`），再读那条的 `content` / 锚点；**不要**只信 `@n`（序号会变）。

**Target indicators：**

- UI 显示 `[indicator N]`；磁盘 `content` 存 `[@t:iN]`，只解析到当前 annotation 的 `targets[].ref`。
- `[@t:]` 不加入 `mentions[]`，也不跨 annotation。它可以和 `[@a:id]` 同时出现在正文里。
- 删除 target 时删除正文中全部对应 token；异常的缺失 ref 保留，UI 显示 `[missing indicator iN]`，不要猜测或自动重绑。
- 旧单 target 或无 `ref` 的旧 `targets[]` 会按顺序补 ref；无需批量迁移，下次保存写入新结构。

`goToMark` 会在需要时 `setActivePage`。

**锚点失效：** Agent 改稿后 selector 可能解析失败。画布**不画**幽灵框；侧栏仍列出该条并标 **锚点失效**。读 `content` + `text` 即可；用户可删或重标。失效是运行时计算，不写进 JSON——结构恢复后框会自动回来。

### 改哪里

| 场景 | 改 |
|---|---|
| Component Library | `components/<id>/` |
| flow + `data-ios-from="bubble/outgoing"` | 优先组件源 |
| flow screen（静态） | `previews/<pageId>/<screen>.html` 内容层 only |
| flow screen（手势 / 动画） | 同屏 HTML 的 `data-preview-script`，或同名 sidecar `.js`（`data-preview-mount`）；**不要**改 `ios-kit.js` |

## 5. 反模式

- 不要替用户清空标注
- 不要把 localStorage 当成标注真相（磁盘才是；空 LS 不得覆盖磁盘）
- 不要用陈旧 `rect` 在画布上硬画已失效锚点（侧栏「锚点失效」即可）
- 不要只按 `@n` 解析 mention（用 `[@a:id]` / `mentions`；兼容 `[@m:id]`）
- 不要改 `ios-kit.css` / bezel 去「修」一条标注
- 不要把产品手势塞进 `ios-kit.js`（走 preview-build A+B）
- 不要把组件 HTML 复制进 screen；用 `data-ios-include`
- 不要安装本 skill 到 `.claude/skills/`
- 不要手写 caption font-size（用 board tokens）
