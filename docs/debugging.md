# 排查案例库（debugging hardcases）

收录本仓非显而易见、排查成本高的故障案例。价值不在记录修复（git log 里有），
而在**故障现象的模式匹配**：下次见到相似症状，先翻这里的“识别特征”。
决策结论归 `docs/adr/`，组件静态契约归 `AGENTS.md` 的坑与约定一节，本文件
只记“现象 → 误判 → 根因 → 识别特征”的完整链路。新案例追加在顶部（新的在前）。

条目格式：

```text
## <日期> <一句话现象>
现象：用户/测试看到的症状（尽量原样，这是检索入口）
误判路径：怀疑过什么、排除了什么（诚实地记，含排查工具）
根因：一句话机制
修复：改了哪里
识别特征：下次见到什么信号应直接想到本条
防回归：哪条测试/规则挡着（没有就写“无”，并考虑补）
```

---

## 2026-09-22 浏览器扩展的“点击后无 sidebar，⌘R 恢复”

该案例随浏览器扩展（Chrome Side Panel，ADR 0009）于 2026-09-22 整体退役：扩展未再使用，
代理内嵌（`/sites/` url 条目）覆盖了它的场景，两条注入路径只留一条（见 [`registry.md`](registry.md)
“三条投递路径”）。原案例连同未定位的根因一并删除，不再排查。

---

## 2026-09-07 画布已有 rAF 调度，缩放仍触发重复全量更新

现象：在包含平移几何缓存的 B 版本中，1000 条标注的连续缩放和局部内容变化仍然卡顿。

误判路径：已有 rAF 不代表多个入口共享一次刷新。实验中去掉一条重复入口后，缩放 P95 从约 108 ms 降到 59 ms，仍未达到目标；仅增加节流或合并通知不足以解决问题。

根因：60 次缩放输入触发 90 次全量更新；锚点有效性判断、结构更新和列表同步重复解析目标，局部变化也连带重测整页。

修复：`feat/canvas-performance` 的 `1143681` 合并更新调度、复用锚点结果和未缩放几何，局部内容按 frame 及跨 frame 依赖更新。该实现尚未发布；具体缓存行为见 [标注几何缓存](annotation.md#画布标注的几何缓存)。

识别特征：输入次数少于全量刷新次数，或单 frame 变化时整页目标测量数同步增长。排查应同时比较输入次数、刷新次数、目标测量和样式布局耗时；禁用更新只能用于归因，不能作为修复，必须继续验证标注对齐与内容变化后的恢复。

防回归：`e2e/canvas-pan.spec.js` 检查缩放目标读取、节点复用、局部重测、跨 frame 依赖和对齐。CI 使用确定性工作量断言；毫秒性能通过独立交错采样报告，不能把 headless rAF 帧间隔直接称为真实显示 FPS。

---

## 2026-09-07 点击标注定位后，上方 sections 消失，滚回无效

现象：长画布点击下方 section 的标注定位后，上方 sections 变成空白；滚回去不能恢复，刷新才恢复，小地图仍有全部 frame。

误判路径：单纯上下滚动未复现；加入标注定位后稳定复现。新增标注不是必要条件，一条已有标注的定位就足够。禁用焦点自动滚动仍失败，跳过 section 的 `scrollIntoView` 或将包装层改为 `overflow:clip` 均通过。

根因：`goToMark → switchPage → scrollToGroup` 调用 `scrollIntoView`，会滚动祖先中的 `.wb-zoom-wrap`。它用 `overflow:hidden` 裁掉 transform 缩放前的布局溢出，但 hidden 仍创建可程序滚动的容器；缩小时内部存在可滚动空间。定位下方 section 会留下内部 scrollTop，上方内容移出裁剪边界，外层 `#wbstage` 滚回无法消除内部偏移。DOM 和账本都没有删除。

修复：`fix/sections-disappear` 将 `.wb-zoom-wrap` 改为 `overflow:clip`，保留裁剪但禁止内部滚动；画布滚动仍由 `#wbstage` 承担。该分支尚未合并、发布。

识别特征：定位后内容持续空白，但 DOM、几何和小地图仍在时，检查**所有祖先的 scrollTop / scrollLeft**，尤其没有滚动条的 `overflow:hidden` 层；不能只检查 display / visibility。回归必须检查返回原位置后的几何与命中结果。

防回归：`e2e/section-scroll.spec.js` 在 75%、117%、250% 下通过真实 UI 创建标注、点击定位、返回上方并继续新增标注。修复前前两档失败，内部 scrollTop 非零；修复后要求偏移为零、上方 frame 可见可命中、原标注仍保留。

---

## 2026-09-04 仓库目录被搬走后服务变 502（长命 vite 抱着旧绝对路径重启）

现象：`https://pinpoint.localhost` 返回 portless 的 502
“The target app is not responding”。portless 侧一切正常：`~/.portless/routes.json`
里 pinpoint.localhost → 4939、pid 28792 仍在，proxy daemon 也活着。

误判路径：先按 backlog 那条“服务进程死亡”（见下“关联”）猜进程没了——但
`portless run`、`npm run dev:app`、`vite` 三层进程全在。再猜 portless 路由表
写坏或端口被别人占。真正的入口是 `lsof -nP -p <vite pid> | grep LISTEN`：
它监听 `[::1]:5173`，既不是 portless 分配的 4939，也不是 `vite.config.js` 里的
`5199`/`127.0.0.1`。而 `ps -E` 显示环境里 `PORT=4939` 明明在。

根因：进程在 2026-08-31 从 `topics/pinpoint/` 启动，仓库目录在 2026-09-04 11:12
被搬到 `repos/github.com/3rd-Musketeer/pinpoint/`。macOS 的 rename 不影响运行中
进程（cwd 跟着 inode 走），但 vite 内部持有的是**启动时解析出的绝对路径字符串**；
它在这次搬迁时自我重启并按旧路径重新解析 root，那个路径此刻已是空壳——
`vite.config.js` 不在，于是**整份配置静默落回默认值**：端口 5173、host localhost
（解析成 `::1`）、全部 server 插件（annotate / sites / registry / preview-inject）
一个都没装。portless 仍往 4939 转发，那里没人监听，就是 502。旁证：旧路径下
`.vite/deps/_metadata.json` 的 mtime 恰是 11:12，且 `lockfileHash=e3b0c442…`
（空串的 sha）、`optimized:{}`——vite 在一个既无 `package.json` 也无
`package-lock.json` 的目录里做了依赖预构建，等于自证 root 已经指空。

修复：本次是运行态故障，不改代码。杀掉 28792 整棵进程树（proxy daemon 832 不动），
在新路径的 dev worktree 里重跑 `just dev`；portless 重新分配端口（4453）并更新
routes.json。顺手删掉旧路径残留的 `.vite` 缓存空目录。

识别特征：**“portless 路由在、进程也在，却 502”= 先 `lsof` 看进程到底在听哪个
端口，别先怀疑进程死了。** 监听端口等于框架默认值（vite 5173 / `::1`）而不是配置值，
就说明配置根本没被加载；此时查进程的 cwd 与它自报的 root 是否指向同一个真实目录。
更一般的信号：**任何长命 dev server 跨越了一次仓库目录搬迁，就必须重启**——
它可能表面还活着，其实已经在一个空路径上跑裸默认配置。同类线索还有 `/health`
返回空、`/` 返回 404（插件没装）、`.vite` 缓存出现在不该出现的目录。

防回归：无。这是进程生命周期问题，测试挡不住。关联 backlog“CLI 服务生命周期
管理 + 开机自启”（2026-08-17 owner 提出，动机是当日的服务进程死亡 → 404 事故）：
本条是同一 milestone 的另一种故障形态——那次是进程没了、这次是进程还在但已失效，
所以未来的 `pinpoint status` 不能只判断“进程活着 / 路由在”，要实际打 `/health`
并核对进程 root 与当前仓库路径一致。

---

## 2026-08-17 页面清单整体加载失败（SPA fallback 喂 HTML 冒充 200）

现象：dev server 上 Pages 只剩 Component Library 一行，侧栏错误行
“页面清单读取失败：board.json 缺失或返回的不是 JSON”。

误判路径：先怀疑 registry 条目路径写错（当日刚做实例搬迁）——/health
与 /registry 都正常，22 条全在；再怀疑 manifest 合并逻辑被新代码改坏。

根因：`loadPageManifest` 先拉 `_index.local.json`，按“404 = 缺失 → 回落
_index.json”设计。但 vite dev 的 SPA fallback 把不存在路径喂成 index.html
（200 + text/html），`response.json()` 抛异常，整条清单加载失败。该回落
路径从未在 dev 生效过——此前被 _index.local.json 恒存在掩盖；e2e 则靠
template-only 插件对这条路恒 404 才正常。实例搬迁删除该文件后首次暴露。

修复：pages.js 判定改“200 且 content-type 含 json 才解析，否则按缺失回落”
（200 但 JSON 格式坏仍抛错——“broken 要暴露”语义不变）。

识别特征：dev 上“缺文件 → 拿到 200 HTML”是 vite SPA fallback 的固有行为，
任何“fetch 可能不存在的文件并按状态码分支”的代码都不能只信 status，
要同时看 content-type。

防回归：live 验证（删除 _index.local.json 后 Pages 全量恢复）；e2e 走
template-only 404 路径覆盖不到本例，判定逻辑本身无单测（pages.js 命令式
层，提取成本高于收益，留案例）。

根因已修（2026-09-04）：`src/server/content-routes.js` 投影完先看磁盘——
`/previews/**` 与 `/kits/**` 下不存在的文件直接答 404 + text/plain，不再
next() 给 SPA fallback（纯判定 `resolveContentFile` 有单测）。`pages.js`
的“200 且 JSON 才解析”判定保留：它防的是同一类现象的其它来源（代理、
错误页），不是只防 vite。

---

## 2026-08-17 新建 doc 页“无法标注”（漏接 annotate.js 注入段）

现象：新建的 variants 方案板（doc 页）在 workbench 里打开后，切到标注模式
点选页面任何元素都没有反应——不出标注框。

误判路径：先怀疑选中模型改造（同日落地）与标注模式互斥，或 iframe 承载
阻断事件。实则该页是 owner-local 新文件，从未接过标注。

根因：doc 页的标注不在 workbench 侧注入，而是**文档自己在页尾接一段
loopback 才拉 `/annotate.js` 的脚本**（SKILL.md“要能标注”节）。新页面
照抄视觉 mock 时漏了这段接线，页面里根本没有标注客户端。

修复：variants.html 页尾补标准注入段（`data-ios-annotate`）。

识别特征：某 doc 页标注完全无反应时，先查页面源码有没有
`script[data-ios-annotate]` / iframe 里 `window.pinpoint` 是否存在——比
怀疑模式互斥、事件拦截都快。canvas 页（fragment 内联）不适用本条：
那边标注由 workbench 统一持有，页面不需要自己接。

防回归：2026-08-17e 机制修复——serve 即注入（`src/server/preview-inject.js`），
完整文档不再需要手工接线；e2e 覆盖 previews 完整文档注入 / fragment 不注入
（workbench.spec“serve 即注入”用例）。本条保留作为“症状 → 第一检查点”
的模式参考。

另记同日的次生现象：live 验证时用 `iframe.src = iframe.src` 强刷文档后，
侧栏面板不再反映新标注——`watchDocAnnotate` 的 onUpdate 订阅还挂在被
销毁的旧客户端上（bridge 只在板装载/条目切换时绑定）。整页刷新即恢复，
非产品 bug，但排查时容易误判为“标注没存上”。

---

## 2026-08-17 右键菜单“完全不弹出”（Popper 全局置惰误伤）

现象：侧栏行右键后什么都不出现——自研菜单没有，浏览器默认菜单也没有。
诊断页对照实验里同一浏览器 Radix 菜单正常弹出。

误判路径：先怀疑用户浏览器环境（扩展拦截、HMR 陈旧页签、Safari 内核）——
四种独立环境（Playwright Chromium / WebKit、agent-browser 真实鼠标事件、
e2e）DOM 断言全绿，险些结论为“用户侧问题”。诊断页（probe HTML 分
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

识别特征：“Radix 弹层组件 DOM 里在、屏幕上不在”或“右键完全无反应（连
默认菜单都没有）”→ 先查弹层包装层是否被全局 CSS 中和；新增 Popper 系组
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

识别特征：“vendored 组件包了一层我不知道的 DOM，我的样式没生效”→ 先
DevTools 逐层看内联 style，别先改自己的类。Radix/三方组件的内联样式优先
级高于样式表。

防回归：e2e `withinContainerViolations` 几何断言（左右栏默认宽/紧凑宽四组）；
AGENTS.md vendored 小节有条目。

---

## 2026-08-10 菜单“开 B 自动关 A”写出连锁关闭（frame-menu dismiss）

现象：自己写单例逻辑（开新菜单前程序化关掉旧菜单）后，新菜单 B 刚开就被
连锁关掉。

根因：程序化 `setOpen(false)` 走 A 的 close-autofocus 把焦点拽回 A 的
trigger，焦点移动触发 B 的 focus-outside dismiss，B 被关。

修复：删掉单例关闭逻辑——每层 Radix 菜单自己的 dismiss 监听天然达成互斥，
不要代劳。

识别特征：“我在管理浮层生命周期，越管越乱”→ 先查 Radix 是否已内建该行为；
不要给库的行为再写一层编排。

防回归：无（行为契约记在 `src/workbench/app/frame-menu.jsx` 头注）。

---

## 2026-08 两条 e2e flake（断言先于稳定态）

现象：`workbench.spec.js:907` / `:1045` 偶发失败，重跑即过。

根因（已定位）：断言读取的是异步收敛中的值（SSE / 动画 / 装载竞态），
一次性 expect 抢在稳定态之前。

修复（待做，backlog 在册）：把这两处一次性 expect 包成 `expect.poll`。

识别特征：“偶发失败 + 重跑即过”基本等价于“断言没有等稳定态”→ 直接找
断言处，先包 `expect.poll` 再谈别的。

防回归：修复后本条可删。

---

## 2026-08 预览 iframe 里嵌套了整个工作台（dev-server fallback）

现象：某个屏的 iframe 里没有预览内容，而是又装了一个完整 workbench。

根因：vite dev server 对缺失文件返回 SPA fallback（workbench 自己的
index.html），屏装载器把它当正常预览 HTML 挂进 iframe。

修复：screen loader 识别 dev-server fallback 文档并拒绝装载（当作屏缺失
处理，不嵌套）。

识别特征：“iframe 里出现了应用自己”→ 先想 dev-server fallback / 错误页被
当内容加载；装载器要校验拿到的是不是预期文档。

防回归：e2e“screen loader rejects a dev-server fallback document”。

---

## Canvas flicker diagnostics

The workbench keeps a local ring of up to 720 diagnostic events per load. During canvas
movement it samples viewport geometry at most four times per second and measures frame
gaps without scanning frames. It records input type, scroll position, zoom transform,
container visibility and error categories; it does not record annotation text or HTML.
Idle stops sampling. Batches are automatically sent to the local workbench server every
two seconds when events are pending. The server writes `<dataRoot>/diagnostics/canvas.ndjson`
(default `~/.pinpoint/diagnostics/`), rotating at 10 MiB and keeping four older files (`.1` through `.4`):
at most 50 MiB per service data root, oldest records overwritten. Preview/test data roots
remain isolated. Records include wall-clock time and a session ID; no remote upload.
An unavailable server keeps only a bounded retry buffer; a crash can lose the latest batch.

After a flicker, read these local files around the reported time; export is unnecessary.
The tab also retains current/previous-load sessionStorage records. Settings → 导出诊断日志
is an optional manual fallback.
`window.workbench.diagnostics.snapshot()` provides the same metadata for debugging.
A normal DOM snapshot cannot rule out a GPU/compositor paint failure; pair the log with
a screen recording when the canvas is visibly blank but its geometry remains normal.

日志容量按需要回溯的操作时长估算，而非只设一个磁盘上限。当前约 460–520 字节/条、移动时每秒约 4 条；50 MiB 预计覆盖约 5–8 小时连续操作，多标签页共享容量。该值是估算，不保证固定保留天数。
