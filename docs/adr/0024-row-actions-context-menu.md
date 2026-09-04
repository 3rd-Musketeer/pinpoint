# 0024 · 行级动作收编右键菜单 + Popper 置惰收敛 + 排查案例库成文

Status: 现行 · Date: 2026-08-17 · Scope: `src/workbench/app/row-menu.jsx`、`index.html`、`docs/debugging.md`

**Decided**（owner 2026-08-17 提案确认，浏览器实测验收后批准提交）：

- **行级动作统一进右键菜单**（`workbench/app/row-menu.jsx`，Radix ContextMenu），行尾 hover 钮全退役，行宽全部还给标题。动作按行类型分发：Pages 行 = 复制 `@page:` + 重命名（系统页 Component Library 无重命名）；doc/草稿条目 = 复制 `@frame:` + 导出…；画布条目 = 复制 `@page:`（画布即页面默认视图，`@frame` 语法不覆盖它）；frame 树行 = 复制 `@frame:`。**纯右键、不留 hover ⋯ 折中档**——owner 判词「不占 list 位置」；工具用户 = owner 自己 + agent，发现性成本一次性。复制项点击后菜单保持打开、标签换「已复制 <全文>」（行上无可见元素，菜单是复制反馈的唯一落点）。菜单项皮肤与 frame-menu 共用一份常量，不再各抄。
- **Popper 置惰规则收敛到 `:has(> .wb-frame-menu)`**：08-10 为 frame 菜单写的全局置惰（`.wb-library` 是 scale 空间，JS 量测定位必错位）把新右键菜单一并压成 static——菜单渲染在 body 末尾、视口之外，DOM 断言在四种环境全绿但肉眼不可见，owner 报「完全不弹出」。排查经诊断页（裸 DOM / Radix / 错误三区）定位：Radix 在 owner 浏览器正常，问题只出工作台主程序；截图 + 菜单祖先链 bounding box 读出 rect 在视口外。防回归 = e2e 右键用例的视口几何断言（菜单 bounding box 必须在视口内）。
- **`debugging.md` 排查案例库成文**（owner 问「有没有地方收集这种 hardcase」后批准）：条目格式 = 现象（检索入口）/ 误判路径 / 根因 / 修复 / 识别特征 / 防回归。分工——decisions.md 记「为什么这么决定」，AGENTS.md vendored 小节记组件静态契约，debugging.md 记故障完整链路；新案例追加在顶部。首批 6 条（Popper 置惰、ScrollArea 裁切、frame-menu dismiss 连锁、两条 e2e flake、dev-server fallback 嵌套、扩展 ⌘R）。

**Why**: locator 复制是 owner 与 agent 协作的高频动作，但行尾钮常驻占 28px 且是窄栏溢出问题的发生面；右键菜单一次解决两者。Popper 误伤是「规则作用域比意图大」的跨组件隐性耦合（08-10 的规则被 08-17 才存在的组件继承），同类问题第二次出现（首次 = ScrollArea），故案例库成文、把「现象 → 识别特征」的模式匹配沉淀下来。
