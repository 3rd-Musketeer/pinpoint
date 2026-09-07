# 存量 include 兼容

仅在页面实际使用 `data-ios-include` / `data-ios-from`，或用户明确要求维护 kit 时读取。业务页面默认直接写自己的 HTML；重复出现本身不触发抽组件。底层 include/slot 继续兼容，iOS kit 原语保持共享。

## Kit 资产目录

```
content/kits/ios/components/<id>/
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

- 可选 `content/kits/ios/components/_index.json` 排序；不在清单里的目录会自动发现、排在后面（`PREVIEW_TEMPLATE_ONLY=1` 时只认清单）
- Component Library 页自动合成（`/components/board.json`），无需手动注册

## 存量 include 与 slot

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>

<div data-ios-include="your-card/default"
     data-text="冲煮完成"
     data-slot-detail="总时长 3:12 · 粉水比 1:16"></div>
```

- `data-text` → 填 `[data-ios-slot="text"]`
- 任意 `data-slot-<name>` → 填同一组件里的 `[data-ios-slot="<name>"]`；用来复用同一组件的文案/状态，不要为每组文字复制一个 variant
- Slot 只替换节点内容，不改属性或样式；结构和视觉仍由 component variant 统一拥有
- 改组件源 → Library 页和引用它的 flow 一起 HMR
- 修改共享源会影响所有引用者；仅改当前页时，先用本页的 slot 或页面内样式限定范围。需要改变结构时可将本页内容内联，其他引用者保持原样。
