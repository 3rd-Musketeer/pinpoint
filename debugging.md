# 排查案例库（debugging hardcases）

收录本仓非显而易见、排查成本高的故障案例。价值不在记录修复（git log 里有），
而在**故障现象的模式匹配**：下次见到相似症状，先翻这里的「识别特征」。
决策结论归 `decisions.md`，组件静态契约归 `AGENTS.md` vendored 小节，本文件
只记「现象 → 误判 → 根因 → 识别特征」的完整链路。新案例追加在顶部（新的在前）。

条目格式：

```
## <日期> <一句话现象>
现象：用户/测试看到的症状（尽量原样，这是检索入口）
误判路径：怀疑过什么、排除了什么（诚实地记，含排查工具）
根因：一句话机制
修复：改了哪里
识别特征：下次见到什么信号应直接想到本条
防回归：哪条测试/规则挡着（没有就写「无」，并考虑补）
```

---

## 2026-08-17 页面清单整体加载失败（SPA fallback 喂 HTML 冒充 200）

现象：dev server 上 Pages 只剩 Component Library 一行，侧栏错误行
「页面清单读取失败：board.json 缺失或返回的不是 JSON」。

误判路径：先怀疑 registry 条目路径写错（当日刚做实例搬迁）——/health
与 /registry 都正常，22 条全在；再怀疑 manifest 合并逻辑被新代码改坏。

根因：`loadPageManifest` 先拉 `_index.local.json`，按「404 = 缺失 → 回落
_index.json」设计。但 vite dev 的 SPA fallback 把不存在路径喂成 index.html
（200 + text/html），`response.json()` 抛异常，整条清单加载失败。该回落
路径从未在 dev 生效过——此前被 _index.local.json 恒存在掩盖；e2e 则靠
template-only 插件对这条路恒 404 才正常。实例搬迁删除该文件后首次暴露。

修复：pages.js 判定改「200 且 content-type 含 json 才解析，否则按缺失回落」
（200 但 JSON 格式坏仍抛错——「broken 要暴露」语义不变）。

识别特征：dev 上「缺文件 → 拿到 200 HTML」是 vite SPA fallback 的固有行为，
任何「fetch 可能不存在的文件并按状态码分支」的代码都不能只信 status，
要同时看 content-type。

防回归：live 验证（删除 _index.local.json 后 Pages 全量恢复）；e2e 走
template-only 404 路径覆盖不到本例，判定逻辑本身无单测（pages.js 命令式
层，提取成本高于收益，留案例）。

---

## 2026-08-17 新建 doc 页「无法标注」（漏接 annotate.js 注入段）

现象：新建的 variants 方案板（doc 页）在 workbench 里打开后，切到标注模式
点选页面任何元素都没有反应——不出标注框。

误判路径：先怀疑选中模型改造（同日落地）与标注模式互斥，或 iframe 承载
阻断事件。实则该页是 owner-local 新文件，从未接过标注。

根因：doc 页的标注不在 workbench 侧注入，而是**文档自己在页尾接一段
loopback 才拉 `/annotate.js` 的脚本**（SKILL.md「要能标注」节）。新页面
照抄视觉 mock 时漏了这段接线，页面里根本没有标注客户端。

修复：variants.html 页尾补标准注入段（`data-ios-annotate`）。

识别特征：某 doc 页标注完全无反应时，先查页面源码有没有
`script[data-ios-annotate]` / iframe 里 `window.pinpoint` 是否存在——比
怀疑模式互斥、事件拦截都快。canvas 页（fragment 内联）不适用本条：
那边标注由 workbench 统一持有，页面不需要自己接。

防回归：2026-08-17e 机制修复——serve 即注入（`server/preview-inject.js`），
完整文档不再需要手工接线；e2e 覆盖 previews 完整文档注入 / fragment 不注入
（workbench.spec「serve 即注入」用例）。本条保留作为「症状 → 第一检查点」
的模式参考。

另记同日的次生现象：live 验证时用 `iframe.src = iframe.src` 强刷文档后，
侧栏面板不再反映新标注——`watchDocAnnotate` 的 onUpdate 订阅还挂在被
销毁的旧客户端上（bridge 只在板装载/条目切换时绑定）。整页刷新即恢复，
非产品 bug，但排查时容易误判为「标注没存上」。

---

## 2026-08-17 右键菜单「完全不弹出」（Popper 全局置惰误伤）

现象：侧栏行右键后什么都不出现——自研菜单没有，浏览器默认菜单也没有。
诊断页对照实验里同一浏览器 Radix 菜单正常弹出。

误判路径：先怀疑用户浏览器环境（扩展拦截、HMR 陈旧页签、Safari 内核）——
四种独立环境（Playwright Chromium / WebKit、agent-browser 真实鼠标事件、
e2e）DOM 断言全绿，险些结论为「用户侧问题」。诊断页（probe HTML 分
裸 DOM / Radix / 错误三区）证明 Radix 在用户浏览器正常后，回头对工作台
截图 + 读菜单祖先链 bounding box，才发现菜单 rect 在视口外（y=800）。

根因：`index.html` 为 frame ⋯ 菜单写的 Popper 置惰规则
`[data-radix-popper-content-wrapper] { position:static !important }` 是全局
选择器（原意：画布是 transform:scale 空间，JS 量测定位必错位，frame 菜单
改由 CSS 绝对定位）。新右键菜单也走 Radix Popper 但住在侧栏（非 scale
空间，恰恰需要 JS 定位），被同一规则压成 static，菜单按文档流落在 body
末尾、视口之外。Radix 照常 preventDefault，所以连浏览器默认菜单也不出现。

修复：置惰规则收敛为 `[data-radix-popper-content-wrapper]:has(> .wb-frame-menu)`，
作用域与意图一致。

识别特征：「Radix 弹层组件 DOM 里在、屏幕上不在」或「右键完全无反应（连
默认菜单都没有）」→ 先查弹层包装层是否被全局 CSS 中和；新增 Popper 系组
件（ContextMenu / Tooltip / HoverCard…）时先核对这条规则的作用域。

防回归：e2e 右键用例的视口几何断言（菜单 bounding box 必须落在视口内）；
AGENTS.md vendored 小节有条目。

教训：DOM 断言全绿 ≠ 肉眼可见。布局/可见性问题的断言必须比 bounding box，
或截图看。

---

## 2026-08-17 行尾复制按钮被裁出栏外（ScrollArea 内层 display:table）

现象：侧栏 Pages 行行尾的复制按钮看不见、点不到；拖动分隔条改变栏宽，行
布局不跟着变。

误判路径：先当成行内 flex 宽度问题调样式，无效；逐层读 DOM 内联样式才发
现视口内层。

根因：Radix ScrollArea 的 Viewport 给 children 包一层内联
`display:table; min-width:100%` 的 div（上游为横向滚动场景设计），内容按
自然宽排版（274px > 栏宽 250px），超出部分被 `#wbside` 的
`overflow-x:hidden` 裁掉。栏宽变化时 table 布局不收缩。

修复：`index.html` 加
`#wbside [data-slot="scroll-area-viewport"] > div { display:block !important; }`。
（2026-08-17 行尾按钮已随右键菜单退役，规则保留防同类问题。）

识别特征：「vendored 组件包了一层我不知道的 DOM，我的样式没生效」→ 先
DevTools 逐层看内联 style，别先改自己的类。Radix/三方组件的内联样式优先
级高于样式表。

防回归：e2e `withinContainerViolations` 几何断言（左右栏默认宽/紧凑宽四组）；
AGENTS.md vendored 小节有条目。

---

## 2026-08-10 菜单「开 B 自动关 A」写出连锁关闭（frame-menu dismiss）

现象：自己写单例逻辑（开新菜单前程序化关掉旧菜单）后，新菜单 B 刚开就被
连锁关掉。

根因：程序化 `setOpen(false)` 走 A 的 close-autofocus 把焦点拽回 A 的
trigger，焦点移动触发 B 的 focus-outside dismiss，B 被关。

修复：删掉单例关闭逻辑——每层 Radix 菜单自己的 dismiss 监听天然达成互斥，
不要代劳。

识别特征：「我在管理浮层生命周期，越管越乱」→ 先查 Radix 是否已内建该行为；
不要给库的行为再写一层编排。

防回归：无（行为契约记在 `workbench/app/frame-menu.jsx` 头注）。

---

## 2026-08 两条 e2e flake（断言先于稳定态）

现象：`workbench.spec.js:907` / `:1045` 偶发失败，重跑即过。

根因（已定位）：断言读取的是异步收敛中的值（SSE / 动画 / 装载竞态），
一次性 expect 抢在稳定态之前。

修复（待做，backlog 在册）：把这两处一次性 expect 包成 `expect.poll`。

识别特征：「偶发失败 + 重跑即过」基本等价于「断言没有等稳定态」→ 直接找
断言处，先包 `expect.poll` 再谈别的。

防回归：修复后本条可删。

---

## 2026-08 预览 iframe 里嵌套了整个工作台（dev-server fallback）

现象：某个屏的 iframe 里没有预览内容，而是又装了一个完整 workbench。

根因：vite dev server 对缺失文件返回 SPA fallback（workbench 自己的
index.html），屏装载器把它当正常预览 HTML 挂进 iframe。

修复：screen loader 识别 dev-server fallback 文档并拒绝装载（当作屏缺失
处理，不嵌套）。

识别特征：「iframe 里出现了应用自己」→ 先想 dev-server fallback / 错误页被
当内容加载；装载器要校验拿到的是不是预期文档。

防回归：e2e「screen loader rejects a dev-server fallback document」。

---

## 2026-08-16 浏览器扩展点击后无 sidebar，⌘R 后恢复

现象：pinpoint 浏览器扩展在页面上点击后侧边栏不出现，刷新页面（⌘R）后正常。

根因：未定位（内容脚本注入时机或扩展 SW 休眠待查；复发时再深挖，届时补全
本条）。

识别特征：扩展行为异常先试 ⌘R；若只有刷新能恢复，嫌疑集中在内容脚本注入
时机 / service worker 休眠。

防回归：无。
