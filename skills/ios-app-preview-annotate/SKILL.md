---
name: ios-app-preview-annotate
description: 本仓库（iOS App Preview workbench）的 Figma 式标注评审闭环：用户在浏览器「标注」模式里点选/框选元素写意见、画移动箭头、粘参考图，落盘到本项目专属的 ~/.html-annotate/<项目>/ 目录（从 /health 的 dataDir 字段取）；agent 读盘逐条改稿。当用户说「标注」「标好了」「你看一下标注」「读一下标注」「清空标记」，贴出 @page: / @section: / @frame: / @a: 形式的 indicator，或要求按标注修改预览时，必须先读本 skill——标注 JSON 的字段语义、mention 解析规则和「改哪个文件」的路由表都在这里，不读容易改错对象或弄丢用户的标注。
---

# ios-app-preview-annotate

标注评审闭环：**用户标 → agent 读 → agent 改 → 用户复核 / 清空 → 下一轮**。全程离线、零模型依赖；锚定基于 CSS selector，整机 `transform: scale()` / 窗口缩放都不错位。

搭页 / 改 `board.json` 走 [`ios-app-preview-build`](../ios-app-preview-build/SKILL.md)。总入口：根目录 [`AGENTS.md`](../../AGENTS.md)。

运行时：根目录 `annotate.js`（浏览器客户端）+ Vite `plugins/annotate-api.js`（磁盘 + SSE），与预览同端口。基于 [xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)，加了 section / `pageId` / `screenId` 路由和 `ios-kit.js` 自动注入。

## Domain language

| Term | Meaning |
|---|---|
| **annotate / 标注** | 模式 + 动作（点选 → 打开标注框）。快捷键 **A**。 |
| **interact / 交互** | 演示模式（默认）：产品点击/滚动；可选中文字；不触发标注。 |
| **annotation** | 一条持久化评审意见（`annotations[]`）。 |
| **content** | 标注正文（旧字段 `comment`）。 |
| **page** | Workbench 侧栏页（`pageId` / `data-vpage`）。 |
| **canvas → section → frame** | 画布层级。 |
| **screen** | frame 里的 iOS 内容（`previews/<page>/<screenId>.html`）。 |
| **frame** | 板上的手机/组件壳 ≈ screen + chrome；frame id = `screenId`。 |

## Indicators（给 agent 的短定位符）

不是新实体，只是对既有 JSON 字段的查询串。读整份标注 JSON 再过滤（或一次性 `jq`），没有 resolver CLI。

```
@page:<pageId>
@section:<pageId>/<sectionId>
@frame:<pageId>/<screenId>
@a:<id>
```

| Indicator | 含义 | 过滤字段 |
|---|---|---|
| `@page:library` | 该 workbench 页的全部标注 | `pageId == "library"` |
| `@section:library/brew-flow` | 该 section 下全部 | `pageId` + `section` |
| `@frame:library/timer` | 该 frame/screen 上全部 | `pageId` + `screenId` |
| `@a:ab12cd` | 单条 | `id == "ab12cd"` |

**复制入口**：Pages 列表行 🔗 → `@page:<id>`；标注框 🔗 → 对目标最具体的一档（已保存 → `@a:`；未保存回落 section/frame/page）。

**匹配规则**：scope indicator 要求 `annotation.pageId` 严格相等；缺 `pageId` 的旧数据不匹配 `@page` / `@section` / `@frame`（仍可 `@a:id` 命中）。

```bash
DIR=$(curl -s https://ios-app-preview.localhost/health | jq -r .dataDir)
jq '.annotations[] | select(.pageId == "library" and .section == "brew-flow")' "$DIR"/*.json
```

正文里的 mention 写 `[@a:<id>]`；旧 `[@m:<id>]` 读时兼容、保存时升级。

## 1. 保证服务在跑（每次涉及标注前先做）

```bash
curl -s --max-time 1 https://ios-app-preview.localhost/health || \
  (nohup npm run dev >/dev/null 2>&1 & sleep 1 && curl -s https://ios-app-preview.localhost/health)
```

- 正常入口是 Portless 管理的 `https://ios-app-preview.localhost`；先探活再启动。
- 落盘：**磁盘 SSOT**，目录按项目隔离——`~/.html-annotate/<repo目录名>-<hash>/<页面名>.json`（含 `revision`），参考图在同目录 `images/`。**目录路径从 `/health` 响应的 `dataDir` 字段取**，不要自己猜 hash；同机多个 clone 各有各的目录，互不可见。`HTML_ANNOTATE_DATA_DIR` 环境变量可整体覆盖（e2e 在用）。
- 浏览器 `localStorage` 只是缓存；启动时从磁盘 hydrate，多窗口经 SSE（`GET /events`）同步。
- 所有修改（含清空）走串行 `POST /save`，`baseRevision` 必填；没有 `/clear` endpoint。
- Workbench prefs（当前页 / 缩放 / 侧栏）在 `ios-preview-wb`，viewer 本地状态，**不同步**。

## 2. 注入：模板自动，无需手动

`ios-kit.js` 在 loopback / `.localhost` 自动注入 `/annotate.js`（同源；服务没跑则静默失败；非本机 host 不注入）。

- link 了 `ios-kit.js` 的预览零样板即有标注。
- 关掉：`<html data-annotate="off">`。
- 裸 HTML：`</body>` 前 `<script src="https://ios-app-preview.localhost/annotate.js"></script>`。

## 3. 用户怎么用（向用户解释时按这个说）

侧栏 **Pages** + **Annotations**（可折叠）：

- Pages：顶端 **Component Library**；其下 flow 页。每行 🔗 复制 `@page:<id>`。
- Annotations：**标注 / 交互**切换、暂停、**评论**、清空、Pin；列表按 section 分组；点一条先切到对应 page，再以所属 **frame** 为中心定位（和略缩图 / Section Navigator 同一套规则），标注锚点只闪烁提示；旧数据缺 `screenId` 才居中锚点。× 删除单条；过滤 全部 / 当前示例。

画布：

- **A** 切换 标注 ↔ 交互
- **评论**（在画布渲染评论）：开关，把每条标注的 `content` 作为 Word 式气泡渲染在画布 overlay 上、锚点旁。气泡带序号（与 pin 一致），稀疏默认放右侧 margin、密集时左右分流。**不画连线**——靠序号与 pin / 选区对应。只渲染当前视口内锚点对应的气泡，滚动/缩放重排；与 标注/交互 模式独立，只读，点气泡打开该标注。不改磁盘数据。
  - **inline / sidebar**（评论开启后才出现，点击二态切换）：inline=气泡在 iframe overlay、锚点旁（窄窗口可能压正文）；sidebar=气泡搬到父级 workbench 右侧 gutter（iframe 收窄腾位、文档自己响应式回流，不注入 foreign style、不压不遮）。关评论即撤销。
- **导出含评论**：HTML 板导出对话框勾选「含评论（标注框 + 序号 + 侧栏气泡）」后，三种格式都带评论。导出画 **live 同款选区框 + 橙色序号角标 + 右侧侧栏评论气泡**（content，按序号排序）：
  - 长图 → 1184 宽（920+264）PNG，叠加 `.ann-target`/`.ann-frame` + `.ann-badge` + `.ann-bubble`；
  - HTML 完整 → 内联定位脚本，打开时按锚点重算框 + 气泡位置（适配不同窗口/`@media`）；不加载 annotate 编辑器；
  - 去除 CSS → 文末 `#comments` 纯文本列表（喂 AI）。
  导出只读 annotation store，不写盘；失效锚点跳过。
- **标注**：单击元素在画布底部打开 Target Composer；composer 开着继续单击会向当前草稿加 target，textarea 保持焦点。点屏标题 / bezel 标整机 **frame**；**Alt/⌥+单击**屏内内容升到 frame；拖拽框选 region；Space 拖动画布
- **交互**：演示产品（可选中文字；中键 / Space 拖画布）
- Target Composer：默认「仅引用」；「插入到文本」在光标处插 `[indicator N]`。Pill hover 高亮、点击定位、× 移除；文字、粘图、「改文案」「调研」、「移动到」箭头、`@` 引用其他标注都在这里；🔗 复制 indicator
- Composer 只能从标题栏六点手柄拖动；隔离草稿，保存才落盘，取消 / Esc / 换页都会回滚
- **Esc** 关 mention / 关框 / 取消拖拽

## 4. Agent 怎么读（用户说「标好了」时）

```bash
DIR=$(curl -s https://ios-app-preview.localhost/health | jq -r .dataDir)
ls -t "$DIR"/*.json
```

- `path` = 被标页面（workbench 多为壳 `index.html`）。
- 先按 `pageId`，再按 `section`，再用 `screenId` / `selector` 区分同 section 多屏（AB）。
- 用户贴了 indicator：按 `@page` / `@section` / `@frame` / `@a` 过滤后再改。
- 裸页 / `starter.html` 才直接改 `path` 指向的文件。
- 实际改完后，在对话中简短说明“改了什么 / 为什么”；不要只说“已处理”，也不要替用户清空标注。

### Schema

磁盘文档：

```json
{
  "page": "index.html~…",
  "path": "/index.html",
  "revision": 3,
  "annotations": [ /* … */ ]
}
```

每条 annotation：

- `pageId` — workbench 页（`library` / `components` / …）
- `section` / `sectionLabel` — board section（`[data-ann-section]`；旧 `group` 兼容读）
- `screenId` — frame id（= screen 文件 id）
- `type` — `element` | `region`
- `id` — 稳定短 uid（6 位 `[a-z0-9]`）
- `indicatorKind` — 可选 `page` | `section` | `frame` | `annotation`
- `selector` / `rect` / `content` / `move` / `images` / `research` / `changeTo` / `mentions`
- `targets` — element 标注必有 `[{ ref, selector, text }, …]`；`ref` 是 annotation 内稳定的 `i1`, `i2`, …，删除不重排；顶层 `selector` / `text` 镜像第一个目标（兼容旧读法）
- 旧数据 hydrate 时双读：`marks`→`annotations`、`comment`→`content`、`group`→`section`、`[@m:id]`→`[@a:id]`

**`changeTo: true`**：用户点了「改文案」——把目标文案改成本条 `content` 的正文（去掉 mention 语法后的可读文案）。侧栏 tag：`✎`。

**Mentions**：磁盘存稳定引用 `[@a:<id>]`（UI 显示 `@n` 序号）。读盘时按 `id` 解析到对应 annotation 再读其 `content` / 锚点；**不要**只信 `@n`（序号会变）。

**Target indicators**：UI 显示 `[indicator N]`；磁盘存 `[@t:iN]`，只解析到本条的 `targets[].ref`，不进 `mentions[]`、不跨 annotation。缺失 ref 保留原样并如实呈现，不要猜测或自动重绑。

**锚点失效**：agent 改稿后 selector 可能解析失败。画布不画幽灵框；侧栏列出该条并标「锚点失效」，`content` + `text` 仍可读。失效是渲染时计算，不写进 JSON——结构恢复后框自动回来。

### 改哪里（路由表）

| 标注落点 | 改 |
|---|---|
| Component Library 页 | `components/<id>/` |
| flow 屏且节点带 `data-ios-from="bubble/outgoing"` | 优先改该组件源 |
| flow screen（静态） | `previews/<pageId>/<screen>.html` 内容层 only |
| flow screen（手势 / 动画） | 同屏 `data-preview-script` 或同名 sidecar `.js`；**不要**改 `ios-kit.js` |

## 5. 反模式

- 替用户清空标注（清空是用户的动作）
- 把 localStorage 当标注真相（磁盘才是；空 LS 不得覆盖磁盘）
- 用陈旧 `rect` 硬画已失效锚点（侧栏「锚点失效」即可）
- 只按 `@n` 序号解析 mention（用 `[@a:id]` / `mentions`）
- 改 `ios-kit.css` / bezel 去「修」一条标注
- 组件 HTML 复制进 screen（用 `data-ios-include`）
- 手写 caption font-size（用 board tokens）
