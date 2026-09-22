# 0035 · pp2：源码 / dist 分层、页内组件印章、标注状态机、agent 面 CLI

Status: 现行 · Date: 2026-09-22 · Supersedes: 0028（组件归属半边）、0015（导出 picker）、0017（“Component Library 作系统行保留”一句）、0009（扩展整体） · Scope: `src/server/lib/page-compiler.js`、`src/server/lib/pp-jsx-runtime.js`、`content/kits/ios/jsx/`、`bin/pinpoint-cli.js`、`src/client/annotate.js`（状态机与幽灵框）、`docs/board-schema.md`

**Decided**（2026-09-22，owner 对话定稿；决定全表与切片执行记录在 `tasks/2026-09-22-pp2/`）：

- **源码 / dist 分层**：页目录是源码——`<screenId>.jsx`、`components/<Name>.jsx`、页级 css / js、
  `board.json`（存量 `.html` 也是源码）；`ppnt build` 编成静态 HTML 产物，住 `~/.pinpoint/dist/<entry>/`，
  不进 git、不放回页目录。标注、导出、mention、`/sites/` 下的屏 HTML 只认产物。内容层内核借 Preact
  （工作台留 React），编译期打 `data-pp-id="<文件>:<行>#<n>"`（按文档顺序编号，永不复用）与
  `data-pp-comp`；服务启动全量编译 34 页 144 ms。
- **页内组件优先**：组件先住页里——印章，输入 props 与 children 输出 HTML，无状态无事件无副作用，
  lint 四禁（`preact/hooks` / `onX` 属性 / `fetch` / 帧顶层语句）在编译期挡；variant 用 props 表达；
  同名时页内覆盖 kit；跨页复用 = 手动搬进 kit（`pinpoint/kit`），没有自动提升。取代 0028 的
  kit 集中归属与“page-local 解析不实现”。include 一族随之退役：存量页已一次性展开写回源码
  （双编译逐屏字节相同复验），kit 的 HTML 组件目录由 JSX 印章接替。
- **variants 墙 = comp section**：board.json 里 `shell: "comp"` 的 section，screen 条目内联
  `comp` + `props`，编译器渲染，不建帧文件；墙由手写显式列出，不自动生成。
- **标注状态机**：四态 open（owner 写下；编辑正文或目标自动回此）→ check / done（agent 写，带一行
  note）→ close（owner 工作台单击确认，toast 撤销，不二次确认；CLI 不能 close）。对外引用 = 按桶
  单调取号的 `#n`，永不复用，跨页写 `<entry>#n`，随机 id 降为内部主键。锚点失效存 `lastRect`
  画幽灵框（虚线框 + 序号钉，点行仍跳最后位置）。取代 review-refinements 的“结果指示”（蓝框）——
  那个决定从来没有 ADR，现状记在 `docs/annotation.md` 与 `docs/design.md`。
- **CLI 扩面**：命令名 `ppnt`（`pinpoint` 保留全名，同一入口）；`add` / `move` / `rename` / `folder`
  之外扩 `build` / `render` / `check` / `locate` / `shot` / `mark` / `status --page`。`check` 只读、
  无副作用；只有 `mark` 写状态。补充 0018。
- **`shot --marks`**：把标注序号钉烤进帧图（图上只烤钉，清单由 `check` 给）。0015 当日缓期的
  “批注烘进 frame 导出”以此落地，缓期关闭。
- **Component Library 删除**：组件板、`components-board.js`、`/components/board.json` 路由与
  `allowComponentRefs` 整个删掉（screenId 收窄为单段），`?page=components` 落“页面不存在”；
  跨页复用信号出现再按印章模型重做。0017 阶段 2 的“Component Library 作系统行保留”一句作废。
- **退役**：浏览器扩展（Chrome Side Panel，0009 的实现）与文档导出（三种模式、token 估算、zip）
  退场；用户面导出只剩“整个画布导出为离线可交互 HTML”（ADR 0033），服务端帧图片渲染器保留给
  `ppnt shot` / `check --mode image`。模板页（library / doc-library）删除，范例页由 owner 在 pp2
  之后亲自写。

**Why**（证据 + owner 原话）：

- 重复的量：areta-chat 源码行级逐字重复 63%、plugins 88%；plugins 35% 的 HTML 是四个壳块的
  逐字复制（`tasks/2026-09-22-pp2/dup-analysis.py` 实测）。kit include 组件 34 页里只有 6 页用过，
  2026-09-07 停用业务组件之后为 0——集中式组件库没有长出使用。
- 复用的起点：“应该先从本地复用、局部复用开始；当我们真的发现需要跨不同 Page 复用时，再去开启
  Global 复用页面”——反转 0028 的 kit 集中模型。
- 借框架借在哪一层：“代码用来方便写，编译产物用来展示和肉眼看”——所以运行时零框架，标注、
  导出、mention 全部只认产物。
- 组件模型：“我们要的是切片、展示、标注”——印章 + 状态即帧（一个状态一帧），交互仍走 sidecar；
  岛式水合不做。
- 蓝框：“蓝框是一个失败且复杂的设计”——换成显式状态机；谁写状态分清（mark 写、check 只读），
  “这样意图更清晰，没有预期外副作用”。
- 导出：“我现在其实依旧只需要导出整个画布作为 handoff 素材，所以其他都可以删除（但是注意不是
  让你删除 agent 需要的导出和渲染工具）”。
- CLI：“我从一个月前就开始规划 CLI 了，今天看起来我们可以实现它”；`ppnt` 这个名字是 owner 定的
  （本机不撞）。
- 模板页：“模板页太旧了，直接删掉，加一个 TODO，等 pp2 升级完，你亲自写范例”。

**Consequences**: 机制文档收敛到 `docs/board-schema.md` 一处权威（AGENTS / README / skill 只链接
不复述）；两个 skill 按读序预算重写——加一帧 3 文件约 400 行、处理标注 3 文件约 350 行、全程
不开浏览器工具；存量账本的 `result` 字段迁 `status: done`
（`scripts/migrate-annotation-status.mjs`，带备份）。
