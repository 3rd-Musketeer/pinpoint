# 范例页：冲一杯

pp2 写法的最小完整样例。新页照这个结构写，不用从头读机制文档；机制细节在仓根 `docs/board-schema.md`。

| 文件 | 演示什么 |
|---|---|
| `board.json` | 三个段：一条流程（三帧）和两面 variants 墙（`shell: "comp"`，每屏内联 `comp` + `props`，不建帧文件）；`assets.css` 把页级样式注入每一帧 |
| `components/BeanCard.jsx` | 页内组件：印章，状态全用 props 表达，带 `goto` |
| `components/StepRow.jsx` | 页内组件，同时被帧和 sidecar 用到的结构约定（`data-stage`） |
| `beans.jsx` | 帧：kit 组件 + 页内组件拼一屏，`goto="recipe"` 连到下一屏 |
| `recipe.jsx` | 帧：只用 kit 组件 |
| `timer.jsx` + `timer.js` | 帧是静态快照；点“开始”之后的变化由同名 sidecar 在运行时改 |
| `example.css` | 页级样式，一页一份 |

改完跑 `ppnt build example`。标注这一页的流程见 `skills/pinpoint-annotate/SKILL.md`。
