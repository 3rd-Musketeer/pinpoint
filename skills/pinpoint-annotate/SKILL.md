---
name: pinpoint-annotate
description: 读取 Pinpoint 标注、判断改帧还是改组件、改完编译截图、写回状态，全程不需要浏览器工具。用户要求查看或处理标注，或给出 #12、B3、plugins#12、@frame、@a 引用时使用。
---

# 标注改稿四步

`ppnt check` 读 → 判断改帧还是改组件 → 改、`ppnt build`、`ppnt shot` 看 → `ppnt mark` 写状态。
总入口 [`AGENTS.md`](../../AGENTS.md)；搭页见 [`pinpoint-build`](../pinpoint-build/SKILL.md)；
字段、账本与状态机的权威是 [`docs/annotation.md`](../../docs/annotation.md)。

引用写法：`#12`（本页序号，永不复用）、`plugins#12`（跨页）、`B3`（图纸号 = 该帧全部标注）、
`@frame:<page>/<screen>`、`@a:<id>`（兼容写法）。多条用空格分隔，区间 `#3-#7`。

## 1. `ppnt check <页>` 读

默认列出 open 状态、按帧分组：序号、帧号、正文、意图、源码摘录。`--frame B3` 收窄到一帧，
`--group-by component` 按组件分组（组头给共用帧数），`--status all` 看 check / done / close，
`--json` 给结构化输出。只读，无副作用；不要为读标注重启服务。

摘录里锚点在编译页是 `data-pp-id`（形如 `Nav.jsx:18@2`，源文件：行 + 同行第几个实例；组件锚点
给帧实例与组件定义两段）；存量 `.html` 页是 cssPath + 文本摘录。锚点已失效的标注仍保留原正文，
画布上留 lastRect 幽灵框——失效不等于已解决，照常处理。

## 2. 判断改帧还是改组件

- 摘录或 `--group-by component` 显示锚点落在组件（`data-pp-comp`）且共用多帧 → 改
  `<page>/components/<Name>.jsx`，所有引用帧一起变。
- 只影响一帧 → 改 `<page>/<screenId>.jsx`（存量 `.html` 页就是那个片段文件）。
- 意图字段：`changeTo` 是改文案（结合目标 pill 与上下文，多目标逐个处理，不要把整段指令当替换
  文本）；`move` 是移动，结合 `to_selector` / `to_point` 理解位置；`images` 是参考图，读实际图片。
- 不改代码就能回答的问题（设计取向、取舍）直接在对话里回答，标注留给 owner 处置。

## 3. 改、编译、看图

改源码（不碰 `~/.pinpoint/dist/`；kit 只在确要改所有页时动）→ `ppnt build <页>` 到全绿 →
`ppnt shot <帧>`（或 `ppnt check <页> --mode image`）对照看效果。lint / 编译错误指到文件与行，
规则见 build skill 的“lint 四禁”。改不动或没道理的标注留着不动，准备在 note 里说明。

## 4. `ppnt mark <ref…> done|check|open --note "…"`

- 看了但不改 → `check`，带一行 note（owner hover 可见）。
- 改完 → `done`，note 可选；`open` 把状态退回去。
- 服务端按 `baseRevision` 校验：冲突或非法转换逐条报 409，不影响其余条目，按提示重读再写。
- `close` 只有 owner 在工作台做（CLI 不接受）；owner 编辑正文或目标会自动回 `open`。

最后在对话里汇报：每条标注做了什么（done / check / 未动 + 原因）。清理与关闭标注留给 owner。
登记新页面、移动源路径、注入与代理问题见 [`docs/registry.md`](../../docs/registry.md)。
