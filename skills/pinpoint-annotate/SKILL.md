---
name: pinpoint-annotate
description: 读取 Pinpoint 标注，定位对应页面和源文件，按意见修改并验证结果。用户要求查看或处理标注，或给出 @page、@section、@frame、@a 引用时使用。
---

# Pinpoint 标注改稿

流程：定位页面 → 读意见与目标 → 修改页面 → 验证 → 用户复核。搭页与 board 结构见 [build skill](../pinpoint-build/SKILL.md)。

## 1. 定位页面与标注

先运行 `pinpoint status`，核对服务 root、registry 和数据目录。不要为了读标注重启现用服务。隔离测试使用独立 worktree、端口、registry 和数据目录。

`GET /health` 的 `dataRoot` 是数据根，`dataDir` 是默认桶；`GET /registry` 才是完整 entry 清单。标注磁盘文件是事实源，localStorage 是缓存，不能用空缓存覆盖磁盘。服务按 registry entry 分桶、按 pathname 分账本。

读取完整账本的 `annotations[]`，再按引用过滤：

| 引用 | 匹配 |
|---|---|
| `@page:<pageId>` | `pageId` |
| `@section:<pageId>/<sectionId>` | `pageId` + `section` |
| `@frame:<pageId>/<screenId>` | `pageId` + `screenId` |
| `@a:<id>` | 稳定 `id` |

正文 `[@t:iN]` 只指向本条 `targets[].ref`；`[@a:id]` 指向另一条标注。不要根据显示序号猜引用。缺失引用保持原样并说明。旧 `marks/comment/group/[@m:id]` 由读取层兼容。

看不到标注时先检查当前 entry 与完整 pathname，`/` 和 `/index.html` 可能是不同账本。再检查 board 是否成功加载：无效的 section layout 也会使页面和标注看起来消失。不要先创建新桶或重建标注。

## 2. 修改对应页面

从 registry 找源目录，再按 board 的 `screenId` 找 HTML 或 sidecar。业务 HTML 直接在页面里修改；iOS kit 与共享 CSS 继续使用。只有页面实际包含 `data-ios-include` / `data-ios-from` 时才读[存量兼容说明](../../docs/legacy-includes.md)，不要默认改共享源。

改前列出目标 frame 和明确的例外 frame。改后逐项核对，报告已改、保留、未解决。修改共享 CSS 时检查所有匹配页面，局部需求使用局部选择器。产品手势放同屏脚本，不放进 `ios-kit.js`。

- `changeTo: true` 表示改文案意图。结合正文、目标 pill 和各目标上下文理解要求，多目标分别处理；不要把整段指令当成替换文案。
- `move` 是移动目的地与箭头；结合 `to_selector` / `to_point` 理解位置。
- `images` 是参考图；读取实际图片。
- 原锚点失效时仍读原正文和目标摘录，不用旧 `rect` 伪造活框，也不自动清空意见。

## 3. 报告执行结果

结果指示保留原意见与 ID，用蓝框展示当前结果；蓝框不代表用户已验收。一个标注可对应多个操作，首版不追加评论或版本历史；用户不满意时可删除后重新标注。

在实际修改后的页面中，由浏览器工具读取 DOM，选择结果元素；优先使用源码中稳定且唯一的 id/data 属性，不写猜测的 selector。客户端会在指定 frame 内验证存在且唯一。

通过实际页面的 `window.pinpoint`（workbench 文档页使用其 iframe 实例）读取 `getState().revision`，再调用：

```javascript
await window.pinpoint.recordResults(annotationId, [
  { action: 'add', targets: [{ selector: '#new-message', screenId: 'chat' }] },
  { action: 'modify', targets: [{ selector: '#send-label', screenId: 'chat' }] },
  { action: 'move', targets: [{ selector: '#toolbar', screenId: 'chat' }] },
  { action: 'delete', targets: [] }
], { baseRevision: window.pinpoint.getState().revision });
```

只提交实际发生的操作。删除操作无结果 DOM；其他操作至少一个目标。普通文档可省略 `screenId`。目标不存在、匹配多个、页面不符、仍有编辑或 revision 已过期时会拒绝写入；重新读取并核对，不覆盖重试。

写完重新读取标注，核对原正文、ID 和 targets 未被改写，再看蓝框是否指对元素。没有可验证的结果 DOM 时如实说明，不提交伪造结果。工具与保存字段详见[标注协议](../../docs/annotation.md)。

## 4. 用户复核

点击标注列表整行可定位并打开编辑；删除需要两次点击确认。输入框以 DOM 边界避让，正文 pill 与文字混排，粘贴附图在上，最多十行高；`+` 菜单提供改文案和移动。

用户清理无效标注时，只清当前页原目标与结果目标全部失效的整条标注，隐藏/未加载不算失效。agent 不替用户清空标注。

登记新页面、移动源路径、注入与代理问题按需读[registry 文档](../../docs/registry.md)。不要手工给未登记页面注入脚本。
