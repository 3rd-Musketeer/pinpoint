# Preview kit decisions

产品级 standing-question 结论见 **[`cold-topic/2026-08-13-topic-subs/DECISIONS.md`](../../cold-topic/2026-08-13-topic-subs/DECISIONS.md)**（2026-08-13 归档）。  
本文件只记本 kit / fixture 实现层决策。

**当前执行权威**：见 [`.gdd/goal.md`](.gdd/goal.md)。

---

## 索引

| 日期 | 当时问题 | 裁决 | successor | 状态 |
| --- | --- | --- | --- | --- |
| 2026-08-17b | 行级动作放哪 + 右键菜单不可见 + hardcase 知识收集 | 行级动作统一进右键菜单（纯右键无 hover 档）；Popper 置惰收敛 `:has(> .wb-frame-menu)`；`debugging.md` 排查案例库成文（首批 6 条） | — | 现行 |
| 2026-08-17 | 复制按钮被裁出栏外 + vendored 组件摩擦是否系统性 | 是系统性：布局断言一律比 bounding box 不靠点击（`withinContainerViolations`）；vendored 组件已知内部契约成文（AGENTS.md 小节 + 组件头注）；登记处长到 5+ 条再评估契约测试 | — | 现行 |
| 2026-08-16g | 文档模式 grilling 三问 + 下一轮 arc 暂缓 | 「canvas 即文档」显式否决（维持 doc 条目 + mention embed）；屏前自用优先，embed 导出烤图已在线不新建；doc 正文 pin 标注允许（重申 08-16e）；text-range 选词高亮缓期；下一轮深化 arc 等真实任务激活 | 重申 08-16b / 08-16e | 现行（arc 缓期） |
| 2026-08-16f | 第二轮对象模型：Page = 线程容器，产物 + 草稿 | Page 去类型化（pill 撤到产物条目）；页内容 = 产物（画布/文档/网页，可多个）+ 草稿（整页 HTML）；草稿与产物无机制耦合；DocVersions 层级退役（多屏 doc 拆扁平条目）；url 条目 = 网页产物；画布裸帧明确不做；词汇：禁用自造词「册」 | 修订 08-16b 五阶段地图（Pages 壳标语义） | 现行（方向拍定，实现见 ROADMAP 阶段 6–8） |
| 2026-08-16e | 文档 mention 活 frame + 标注透传 | `<div data-pinpoint-frame>` + /api/frame 水合；透传不改存储 schema（同机壳逐字节同构 → frame 内路径纯派生）；导出烤静态图 | — | 现行（已落地） |
| 2026-08-16d | live 代理画中画路线 | 同源路径前缀代理 + 运行时绝对路径重基；SPA 路由虚拟化；url 条目进 Pages（doc 壳）；跨域 postMessage 桥路线废弃 | 取代 backlog「url 内嵌 postMessage 桥」 | 现行（已落地） |
| 2026-08-16c | CLI 注册入口形态 | `pinpoint add`（dir/file/url）+ registry-store SSOT + `/registry/reload`；file/无板 dir 合成 doc 板进 Pages；url 条目待阶段 4 | — | 现行（已落地） |
| 2026-08-16b | 五阶段 ROADMAP（Web 退役 / Pages 统一 / CLI / 代理 / 文档 mention） | 方向拍定，ROADMAP.md 落盘为阶段地图；Web 连壳退役；文档 mention = 活 DOM + 标注透传，不做冻结 | — | 现行（阶段 2–5 实现中） |
| 2026-08-16 | 侧栏宽度策略 | V2：右栏 260–440 拖拽 + 280 紧凑断点 + 双击复位 + 持久化；rail 档 / 自动让位不做 | — | 现行（已落地） |
| 2026-08-15d | 导出 picker 收敛 | 任意多选（单张直出 PNG / 多张 zip）；PNG 2× 固定；预览两栏（选中几帧预览几帧）；图纸内容永随；批注烘焙缓期进 backlog | — | 现行（批注档缓期） |
| 2026-08-15c | 左栏加大纲 + 层次形态 | 大纲（section → frame 树 + 计数徽标 + 点击定位）；层次 = 延伸线结构（V2） | 修订 08-15b（左栏内容） | 现行 |
| 2026-08-15b | REV 机制要不要做 | 缓期进 backlog（痛点未证实），设计储备留体验板 | 08-15c（左栏内容修订） | 现行 |
| 2026-08-15 | 图纸版式 / REV 协议 / 文档权威 | A1 引用法；装饰检验；DESIGN.md 正典化进 git；REV 协议 | 08-15b（REV 及其展示面缓期） | 部分缓期（图注 / 装饰检验 / 文档权威现行） |
| 2026-08-14 | 侧栏形态 + 设计语言 V2 | 左右分工（左上下文 / 右标注工作台）；钢灰蓝 #5b7fa6 + S3 圆角 + 双线网格 | — | 现行 |
| 2026-08-13 | 设计语言 token 锚定 | Steel Blue accent + 画布点阵 + 语义色收编 + 结构缝回调 | 08-14（accent 值、网格人格）、08-15（纹理入口进设置） | 部分被取代（语义色 / 结构缝 / mono 档仍现行） |
| 2026-08-11b | 扩展标注面板形态 | Chrome Side Panel + 点击必达 + 陈旧自愈 | — | 现行 |
| 2026-08-11 | 审美锚 | 扁平 / Linear 风 / 单 light 主题 | 08-13（accent 值与功能色微调） | 部分被取代（准则本体仍现行） |
| 2026-08-10b | workbench 技术栈 | React+zustand chrome / 命令式舞台 / TanStack Query / Radix Primitives | — | 现行 |
| 2026-08-10 | pinpoint 服务化 closeout | registry + 注入契约形态定型 | — | 现行 |
| 2026-08-07 | 产品定位 | UIUX 原型交付与对齐工具；kit / workbench / annotation 三层 | — | 现行 |
| 2026-07-21c | 分支模型 | main = 公开模板，dev = 日常 | — | 现行 |
| 2026-07-21b | 标注落盘归属 | 按项目分桶（~/.pinpoint 前身） | — | 现行 |
| 2026-07-21 | 模板 split + exclude | git 只跟踪模板，个人内容 exclude | 08-15（decisions.md / DESIGN.md 放出，教义随模板走） | 部分被修订（实例内容排除仍现行） |
| 2026-07-20 | topic / source / delivery 语义 | fixtures 分 topic；人 = source | — | 现行（产品 SSOT 已归档 cold-topic） |

---

## 2026-08-17b · 行级动作收编右键菜单 + Popper 置惰收敛 + 排查案例库成文

**Decided**（owner 2026-08-17 提案确认，浏览器实测验收后批准提交）：

- **行级动作统一进右键菜单**（`workbench/app/row-menu.jsx`，Radix ContextMenu），行尾 hover 钮全退役，行宽全部还给标题。动作按行类型分发：Pages 行 = 复制 `@page:` + 重命名（系统页 Component Library 无重命名）；doc/草稿条目 = 复制 `@frame:` + 导出…；画布条目 = 复制 `@page:`（画布即页面默认视图，`@frame` 语法不覆盖它）；frame 树行 = 复制 `@frame:`。**纯右键、不留 hover ⋯ 折中档**——owner 判词「不占 list 位置」；工具用户 = owner 自己 + agent，发现性成本一次性。复制项点击后菜单保持打开、标签换「已复制 <全文>」（行上无可见元素，菜单是复制反馈的唯一落点）。菜单项皮肤与 frame-menu 共用一份常量，不再各抄。
- **Popper 置惰规则收敛到 `:has(> .wb-frame-menu)`**：08-10 为 frame 菜单写的全局置惰（`.wb-library` 是 scale 空间，JS 量测定位必错位）把新右键菜单一并压成 static——菜单渲染在 body 末尾、视口之外，DOM 断言在四种环境全绿但肉眼不可见，owner 报「完全不弹出」。排查经诊断页（裸 DOM / Radix / 错误三区）定位：Radix 在 owner 浏览器正常，问题只出工作台主程序；截图 + 菜单祖先链 bounding box 读出 rect 在视口外。防回归 = e2e 右键用例的视口几何断言（菜单 bounding box 必须在视口内）。
- **`debugging.md` 排查案例库成文**（owner 问「有没有地方收集这种 hardcase」后批准）：条目格式 = 现象（检索入口）/ 误判路径 / 根因 / 修复 / 识别特征 / 防回归。分工——decisions.md 记「为什么这么决定」，AGENTS.md vendored 小节记组件静态契约，debugging.md 记故障完整链路；新案例追加在顶部。首批 6 条（Popper 置惰、ScrollArea 裁切、frame-menu dismiss 连锁、两条 e2e flake、dev-server fallback 嵌套、扩展 ⌘R）。

**Why**: locator 复制是 owner 与 agent 协作的高频动作，但行尾钮常驻占 28px 且是窄栏溢出问题的发生面；右键菜单一次解决两者。Popper 误伤是「规则作用域比意图大」的跨组件隐性耦合（08-10 的规则被 08-17 才存在的组件继承），同类问题第二次出现（首次 = ScrollArea），故案例库成文、把「现象 → 识别特征」的模式匹配沉淀下来。

## 2026-08-17 · 布局断言比几何不靠点击 + vendored 组件内部契约成文

**Decided**（owner 2026-08-17 提问「这是不是一个潜在要修复的架构/系统性问题」后批准三件修复）：

- **布局/自适应断言一律比 bounding box，不靠点击**。Playwright 点击不检查祖先 `overflow` 裁剪，「能点到」证明不了「人能看到」——本次的实证：复制按钮被裁出栏外，e2e 与 agent 首轮排查的「点击 + 读剪贴板」断言却都通过，测试和排查犯了同一个错。e2e 辅助 = `withinContainerViolations`（workbench.spec.js），左右栏默认宽 + 紧凑宽各一档已生效；以后写 UI 布局用例照此断言。
- **vendored 组件已知内部契约成文**：`AGENTS.md`「Vendored 组件已知内部契约」小节 + 各 `ui/` 组件头注。「source-owned, edit freely」只覆盖包装层；Radix Primitive 的内部 DOM 契约是上游的，只有 computed style 可见。新增条目带日期与来路；登记处长到 5+ 条再评估更结构化对策（契约测试）。

**Why**: ScrollArea `display:table` 内层把 Page 行按自然宽 274px 排版（栏宽 250），行尾 copy 钮被 `overflow-x:hidden` 裁出——同类摩擦第二次出现（首次 = frame-menu Popper wrapper 需中和），证明「行为归组件、几何归 CSS」的收编分工默认了组件内部无害，这个默认不成立。

## 2026-08-16g · 文档模式 grilling 三问 + 下一轮 arc 暂缓（等真实任务）

**Decided**（owner 2026-08-16 /grilling 逐问拍板）：

- **「canvas 即文档」显式否决**（文本块上一等画布对象、消掉双表面的替代路线）：维持 08-16b/e 已落地的 doc 条目 + mention embed 形态；prose-first 长文稿（周报场景）是真需求，画布文本块不接。
- **导出语义不新建设**：屏前自用优先。embed 导出烤图管线 08-16e 已在线（html-full 换 `<img>` dataURL / 长图运行时换图 / no-css 换文本引用），现状即语义；对外交付的真实场景出现再复评。
- **doc 正文 pin 级标注允许**：文档本身是 HTML，serve 即注入即标（owner 原话「文档本身不也是一个 html 吗？为什么不允许标注」）。此乃 08-16e 已落地语义（正文标注归 doc 页自己的桶、与 frame 账本命名空间分离）的重申，非新决定。
- **text-range 选词高亮批注缓期** → backlog：需新建文本选区锚点引擎（选区序列化 + DOM 漂移修复），无真实场景不建（同 REV 判词逻辑）。
- **下一轮深化 arc 整段暂缓**（CLI 统一托管打磨 / 文档模式场景迭代）：owner 判词——需求表述仍抽象，「等我后续做一个真实任务，需求就具体了」。**启动信号** = owner 带真实原型/文稿任务回来；届时 shaping 按 08-16b 阶段切分原则（每刀按独立价值切）。

**注**：三问中两问结论与 08-16b/e 已落地语义一致（grilling 发起时上下文压缩遗漏了阶段 1–5 决策）；净新增 = 「canvas 即文档」显式否决 + text-range 缓期两项。

## 2026-08-16f · 第二轮对象模型：Page = 线程容器，产物 + 草稿，类型下沉条目级

**Decided**（owner 当日逐轮拍板，对齐基准页 = 本地实例 `previews/hierarchy-demo/`）：

- **Page = 一件正在做的事（线程容器），自身无类型**。类型壳标（iOS/Doc pill，同
  日早些时候才上 Page 行）从 Page 行撤除，同一视觉语言挪到产物条目。「MCP 设置页」
  这个线程既不是画布也不是文档，它只是那件事；一个 Page 装了画布加网页之后，顶层
  壳标必然撒谎。
- **页内容分两组**：产物（交付物，类型 = 画布 / 文档 / 网页，可一到多个）与草稿
  （过程产物，恒为整页 HTML）。**草稿与产物无机制耦合**：选中 variant 后回灌是
  agent 改代码的动作，pinpoint 不提供系统功能。
- **DocVersions 层级退役**：多屏 doc 板拆成扁平条目。周报板 sections 是实证——
  delivered 两屏（W29/W30 终版）即产物、polish 六屏即草稿，既有分组与新语义近乎
  逐字对应。「Document 层级有没有用」的最终答案：版本切换的真实需求由分组语义
  接管，层级本身删除。
- **url 注册条目收编为类型「网页」的产物**，与画布、文档平级。
- **「画布裸帧」方案明确不做**（不是缓期）：web 组件 variant 对比在草稿页内部
  完成，不引入无壳 frame 新概念。
- **mention 定位澄清**：服务正式文稿嵌入活原型（阶段 5 已交付），不是草稿对比的
  依赖。
- **词汇约定**：容器就叫 Page，禁用自造词「册」（owner 明确指出）。

**证据**：库内 10 个 doc 页实测——仅周报板（2 sections / 8 屏）与
eval-queue-variants（2 屏）用到多版本切换，其余 8 个单屏页的 DocVersions 行是
死行（唯载「导出」钮）。

## 2026-08-16e · 文档模式 mention 活 frame + 标注双向透传（阶段 5/5 落地）

**Decided**:

- **mention 语法**：doc 正文写 `<div data-pinpoint-frame="<pageId>/<screenId>"></div>`（值 = 既有 @frame: 身份；组件库 `components/<comp>/<variant>`）。doc 自己的 annotate client 把挂载点水合成 iframe → `GET /api/frame` 出自包含文档（fragment + 共享机壳 `lib/frame-shell.js` + frame-boot 运行时 + annotate 注入带板身份 `__pinpointFrame`）；doc 壳屏被 mention 时 302 到屏自身 URL（同 pathname = 同账本）。iframe 自适应内容高度；已有子节点的挂载点（烤图产物）跳过水合。
- **透传核心：不改存储 schema**。调查发现画布锚点 = 板文档绝对 cssPath（`#lib-xxx > .wb-screen:nth-of-type(N) > .ios-stage > …`），frame 换序会断、存量迁移不可接受。解法是画布与 frame 嵌入页的 stage 以下 DOM 由**同一份机壳逐字节同构**，frame 内路径从既有 selector 字符串纯派生（`lib/frame-anchor.js`：切到 stage 段取后缀），解析时两端各自把 `:scope` 绑到本视图的 stage 根——canonical = pageId + screenId + frame 内路径成立，存量零迁移，frame 移动后锚点自愈；可派生而行内解析 miss = 诚实失效（锚点失效红卡语义），绝不回退撞上别的 frame；id 短路的 selector 维持全局解析逐字节不变。
- **存储与同步**：frame 标注读写在画布板的账本（行带 pageId/section/screenId），整账本报文读写不丢行，SSE 双向实时；frame 实例只渲染本 frame 的行；doc 正文标注归 doc 页自己的桶（命名空间分离，活体证明）。
- **模式路由**：侧栏开关 → doc 实例 → 级联每个 frame iframe（同源直调 setMode）；frame 实例启动反向领养父级模式（有界轮询防加载竞态）。标注模式 frame 内点选 = 标注；交互 = 原型照跑。
- **导出烤图**：html-full 换 `<img dataURL>`（/api/export-image 渲染器）、长图 PNG 渲染时运行时换图、html-no-css 换文本引用（不塞 base64）；复用既有渲染管线。
- 冻结/REV 不做（owner 拍板）。

**证据**：unit 256→292、e2e 67→69；活体 12/12（3 frame 活渲染含 sidecar 交互、双向透传各一条、命名空间分离、长图 1840×8040@2x 烤入 3 frame）；验证后桶逐字节恢复。演示页 = 本地实例 `previews/mention-demo/`（excluded）。

## 2026-08-16d · live 代理画中画：同源路径前缀代理 + 运行时重基（阶段 4/5 落地）

**Decided**:

- url 条目挂 `/sites/<id>/` 同源代理（与 dir/file 同一 URL 空间）：HTTP 全透传 + 响应重写（HTML 的 src/href/action/srcset 等根绝对路径加前缀、CSS url()、3xx Location、Set-Cookie 去 Domain 加前缀、CSP/X-Frame-Options/COOP/COEP 剥离）+ 运行时重基 bootstrap（patch fetch/XHR/EventSource/WebSocket/sendBeacon 的根绝对 URL，annotate client 端点按名单豁免）+ WS upgrade 转发兜底。目标应用零感知（08-07 注入契约延伸）。
- **SPA 路由虚拟化**：my-todos 这类 router 直读 `location.pathname` 的 SPA，前缀路径会掉 catch-all；bootstrap 用 replaceState 把 URL 虚拟回应用路径。意外收获：标注账本 page key 落应用路径，与扩展在目标 origin 注入出的账本**逐字节同 key**——代理与扩展两处标注天然汇合到同一账本（活体实测：`global_u0km1e.json`）。
- url 条目进 Pages（doc 壳），`synth-board` 合成单屏板（src = `sites/<id>/`）；代理路径下 `?annotate=off` 只关标注注入，bootstrap/重写保留（是代理机制的一部分）。
- **跨域 iframe + postMessage 桥路线废弃**：同源代理使桥不必要；backlog 条目关闭。
- 已知盲区（README/AGENTS/SKILL 已录）：DOM 属性赋 URL（`img.src='/x'`）、`//` 协议相对 URL、目标路由与豁免名单撞名、同源共享 localStorage、`location.href` 硬导航跳出代理。

**证据**：my-todos 活体 13/13（内嵌渲染、assets/API/SSE 全经代理、标注落桶同扩展账本、验证后数据逐字节恢复）；unit 228→256、e2e 63→67。

## 2026-08-16c · CLI 注册入口：pinpoint add + 合成板 + registry 热重载

**Decided**（阶段 3/5 落地）:

- **CLI 心智**（owner 原话收敛）：想让一个页面进 pinpoint 就用 CLI；静态的 pinpoint 直接 host（/sites/ 管道），活的登记 URL 待阶段 4 代理映射。N 个项目小服务器 → 一台总线 + 一张登记表。
- `bin/pinpoint.mjs`：`add <path|url> [--title] [--board ios|html] [--id] [--registry]`；id = basename slug 化 + 冲突避让；dir/file 的 board 默认 html；file 拒 `--board ios`（合成板恒 doc 壳）。
- registry 读写收 `server/lib/registry-store.js`（原子写、严格校验、缺失时以默认 pinpoint 条目播种）；`POST /registry/reload` 热重载——启动期缓存的三处消费点（annotate-api / sites-api / export-doc-api）收编为共享活 store，reload 后全部即时生效；workbench 经 HMR `registry:update` 失效重拉 Pages。
- **合成板**：`/sites/<id>/board.json` 磁盘优先，缺失时合成 doc 板——file 条目单屏；无板 dir 顶层 *.html 码位序各一屏（侧栏版本列表）；dir 无顶层 html / 目录缺失 / 显式 `board:'ios'` 无板 → 404（不合成，与 registry 白名单惯例一致，打开呈现明确加载失败而非空页）。合成板导出、标注分桶（src percent-encode 三处逐字节一致）闭环。
- url 条目仍不进 Pages（阶段 4 代理内嵌时才进）。

**Why**: 「出现在 Pages」的语义 = 出现且能打开可读可标；否则不如不出现（改动前缺板条目打开是 404 错误面板）。

## 2026-08-16b · 五阶段 ROADMAP：Web 退役 + Pages 统一 + CLI / 代理 / 文档 mention 方向

**Decided**（owner 2026-08-16 讨论定稿；`ROADMAP.md` 落盘为阶段地图，goal 驱动执行）:

- **Web 模式连壳退役**：它从不是模式，只是「无机壳的画板」；存量内容在 doc 壳下都有更好的家（variants 板 → 整页 doc；服务器目录/页面 → doc iframe 1:1）。模式 Seg 退役，Pages 统一为单一列表 + 行内壳标记；壳仍是页/帧属性。真边界不是 iOS / Web / HTML，而是**画布（迭代态）/ 文档（表达态）**两形态。桌面 web 原型需求真出现时按 web-kit 哲学重建。
- **CLI 注册入口心智**：想让一个页面进 pinpoint 就用 CLI；静态的 pinpoint 直接 host（/sites/ 管道），活的登记 URL 待代理映射。N 个项目小服务器 → 一台总线 + 一张登记表；能标注不是附带福利，是「用 pinpoint host」的全部意义。
- **live 代理画中画**走同源代理（含 WS 转发），取代 backlog 的「跨域 iframe + postMessage 桥」路线——同源使桥不必要。
- **文档模式 mention 活 frame**：doc 引用画布 frame → 水合活 DOM（可交互，同一份 fragment）；**标注双向透传**——标注绑定对象（frame + 内部锚点）不绑定视图，同一份存储、两处渲染、实时同步；文档导出时 frame 烤静态图；不做冻结/REV。
- **阶段切分原则**（owner 原话）：每刀按独立价值切，不按实现便利。五阶段与切开理由见 `ROADMAP.md`。

## 2026-08-16 · 侧栏宽度策略（V2 拍定并落地）

**Decided**（owner 体验板 V1/V2/V3 可拖 mock 对比后拍板）: 右栏（标注工作台）补 splitter 拖拽，clamp 260–440、默认 308；宽度 <280 进紧凑态（卡片藏 cap、文本单行 truncate、底栏批注 dropdown 收 图标+值），拖回自动恢复；双击 splitter 复位 308；`annPanelWidth` 偏好持久化。左栏维持现状（200–480 + 折叠）。rail 档（56px 图标列）与窗口过窄自动让位：**不做**。
**Why**: 两栏夹画布挤小中间屏。内容分析结论——左栏 200 是「大纲可读」下限（屏名不足 5 字失去意义），右栏 260 是卡片舒适下限；窄态诉求由紧凑断点 / 折叠接，不由更窄宽度接。V1（min 卡死）做不到「想窄但保留列表」；V3 rail 对树形内容只剩字母、定位语义弱，且左栏窄诉求已被折叠 + 浮钮覆盖。
**契约**: 体验板 `previews/sidebar-variants/sidebar.html`「侧栏宽度：分析 + 方案」V2 mock（px 读数 chip 是演示道具，真实实现只有 aria-valuenow）。
**落地**: `boot-prefs.js`（ANN_W_* + applyAnnWidth + compact 类开关）、`stage.js`（#wbannsplit 拖拽/键盘/双击复位，镜像 #wbsplit，左拖 = 变宽）、`index.html`（--wb-ann-w + 紧凑样式 scope `#wbann-side.compact`；共享行 `lib/ann-list.css` 不动）、`AnnPanel.jsx`（dropdown 文案包 `.wb-ann-bubble-lbl`）。e2e 55 → 60，unit 173 持平；活体 16 断言 PASS。

## 2026-08-15d · 导出 picker 收敛：任意多选 + 预览 + 选项减重

**Decided**（owner 在体验板 picker 上拍板）:
- 批量规则 = 任意多选（勾选任意帧组合，section 行整选）+ 智能打包：单张直接下载 PNG，多张才 zip。
- 选项按「必须对应真实投放渠道差异」减重：格式固定 PNG（砍 WebP；复制 PNG 与下载统一，「透明强制 PNG」联动随之消失）；清晰度固定 2×（砍 1×）；背景保留三档（画布 / 白底 / 透明）。
- picker 两栏：左 proto tree，右实时预览（第一张选中帧，随背景 / 带说明刷新）；实现复用 `/api/export-image` 管线低清档 + debounce，不起新管线。
- 图纸内容（图注 = 引用号 + 屏名 + 尺寸，以及 frame note）永随导出，推翻旧 export-core 的「干净画面摘图注」语义。
- 批注烘进 frame 导出：当日缓期进 backlog（owner 复评无「带批注外发」场景；picker 曾做出带批注预览 mock，后按 backlog 惯例撤下）。doc 导出的批注烘焙管线（export-doc-bake + token 估算）原样在线保留，不删不改。
- 多选预览 = 选中几帧并排几帧（zip 里是什么就预览什么），不再只盯第一帧。
**Why**: 导出是交付动作，对话框每个选项都该对应一个真实投放渠道；WebP / 1× 没有渠道支撑。预览只服务改变视觉结果的选项（背景三档），格式与清晰度是文件属性，看预览无意义。
**Consequences**: per-frame / per-section 导出触发器、旧预设 radio、WebP / 1× 档在落地时拆除；⋯ 菜单里的导出入口删除，菜单本体看剩余项再定。doc 导出的批注烘焙支线（html-full / comments）不动。

---

## 2026-08-15c · 左栏大纲 + 延伸线结构

**Decided**（owner 在 `previews/outline-variants` 四案对比后拍定 V2）: 左栏 Pages 之下加大纲区——当前页 section → frame 树，行 = 引用号 + 屏名 + 计数徽标（红 = 含失效锚点）；点击 = 定位 frame 并打 focus 环，与右栏标注卡焦点双向同步（v1 不做卡片过滤）。层次处理 = 延伸线：14px rail 槽位，section 字母与竖向导线同轴，spine 贯穿整行逐行拼接，段头接续线自字母下缘起笔，末行收 └ 角；选中染整行、线压染色之上。
**Why**: 左栏原先只回答「我在哪一页」，不回答「这页里有什么、标注集中在哪」；大纲让 A1 引用体系从图注标签变成可导航地址。延伸线胜出：与画布网格同一套线的语言（制图引线），且不引入新交互元素（V4 折叠的收纳能力等 section 真多再补）。
**Consequences**: 修订 08-15b 的「第一批左栏只做 Pages + 设置」→ Pages + 大纲 + 设置。大纲数据从 board.json 派生，无新机制。rail / spine 槽位几何即正式 React 组件结构，禁用绝对定位 magic number 画法。四案对比板 `previews/outline-variants/` 保留作判例档案。

---

## 2026-08-15b · REV 机制缓期进 backlog

**Decided**（owner 复评同日 08-15 条目后拍板）: REV 版本机制整体缓期——bump 端点、左栏更改栏、铭牌、标注绑 REV、过期提示、「未记录改动」检测，全部进 [`.gdd/backlog.md`](.gdd/backlog.md)（含启动信号与分期预案）。
**Why**: owner 原话「我目前没有想到特别刚需的场景，之前没有这个一样迭代，它不是最关键的痛点」。设计时高估了异步多轮验收的频率；chat 在当前节奏下就是 changelog。
**Consequences**: 侧栏重构第一批的左栏只做 Pages + 设置视图；`DESIGN.md` 版本管理节只留缓期指针；设计储备（更改栏 / 铭牌 / REV chip / 三向联动）留在体验板 `previews/sidebar-variants/` 不删。画布图注（A1 引用法、尺寸下置）、导出 picker、装饰检验、文档正典化不受影响，按原计划推进。

---

## 2026-08-15 · 图纸版式：铭牌 + REV 协议 + A1 引用法 + 装饰检验；DESIGN.md 正典化

**Decided**（owner 在评审板 `previews/sheet-rev` 上逐轮拍板）:
- **sheet 元信息进左栏**：铭牌（格子语言，图名与图号同格 + REV / 张次 / 更新）固定左栏底部，不随列表滚动；更改栏（Revisions）居左栏中部。画布不再承担标题栏 / 更改栏。
- **引用法**：图幅边缘刻度（ABCD / 123）删除，引用体系取而代之——section 用字母、frame 用数字（A1 / A2 / B3）。人对 agent 说 A2；机器引用仍走 `@frame:id`。
- **图注两行**（引用号 + 屏名），尺寸挪 frame 下方居中 mono 小字。
- **REV 协议**：字母制；agent 每轮改动完成后自调 `POST /api/pages/:id/rev {"note":"一行说明"}`，服务端自增字母、落日期写进 board.json；标注记录创建时 REV，页面 REV 前进后旧标注标「可能已过期」；不做画布时间轴穿越（git 即全量历史）；screen / board 变化但无新 REV 时，更改栏显示「未记录的改动」灰行提醒补注记。
- **装饰检验**（设计语言原则第 1 条）：每个视觉元素必须回答「它标记 / 组织 / 反馈什么真实信息」。判例：铭牌铆钉删（CSS 里不固定任何东西）；画布内图框 + 角部十字退役（纸上是裁切 / 对折标记，屏幕无对应物，边界信号与外框重复）。
- **无「·」**：文案判据归 topics/ui-text 规则 8（本 repo 引用不复制）。
- **文档权威**：新增 `DESIGN.md`（当前正典）；本文件保持 journal 角色并加索引（含 successor 列）；`decisions.md` 与 `DESIGN.md` 自 07-21 的 exclude 清单放出——教义随模板走；实例内容（previews/ 个人页、组件、`.gdd/`、CHANGELOG.local.md）排除不变。
- **导出收敛方向**：单入口 picker + 当前页 proto tree 多选，per-section 导出钮删除。未定：批量档位（zip 任意多选 vs 单选 + section 整选）、frame ⋯ 菜单去留——落地前补拍。

**Why**: 复古 / old-school 感来自建造逻辑可见（字体、编号、线宽纪律），不来自贴皮；REV 绑定的收益 = 多轮迭代里「这条反馈针对哪一版」可对齐。文档侧只有日志没有正典，supersession 曾只存在于读者脑子里。

---

## 2026-08-14 · 侧栏左右分工 + 设计语言 V2（钢灰蓝 × S3 圆角）

**Decided**（owner 在评审板 `previews/sidebar-variants` 上逐轮拍板，含 11 条标注反馈全部落地）:
- **侧栏 = 左右分工**：左栏 = 页面上下文（Pages + 设置视图），右栏 = 标注工作台（可整栏折叠，画布两缘浮钮复开，右钮带计数）。
- **设计语言 V2**：S3 圆角组件（radius 8）× 钢灰蓝 `#5b7fa6`（取代 08-13 的 Steel Blue `#1769aa`，后者过深）+ Blueprint 画布人格（24 / 120 双线网格）。发丝线 / 浅面 / muted 由 accent color-mix 派生。
- **右栏结构**：head（计数钉 + 收起）→ meta（status 左 + 「清空标注」两段确认 armed 红字 3s）→ 卡片列表（白卡 + 淡蓝描边 + 分组 eyebrow）→ 底栏两行（模式单钮 + 画布批注 dropdown 三态：隐藏批注 / 叠在页面 / 右侧通道）。
- 模式 = 单钮点按，标注中 = 实心 accent（全页唯一实心 on 态）；交互模式图钉保留（opacity .38 + pointer-events:none），气泡仅标注模式。
- 锚点失效 = 整卡红描边 + 红浅面 + 文本退灰 + 序号钉转红，不用 tag。
- 移除：暂停、Pin、通道钮（并入批注 dropdown）、全部 / 当前筛选、footer 主题分段（单主题决策）、设置常驻格（进左栏齿轮 → 设置视图）。
- 画布背景三态（网格 / 圆点纸 / 空白）进设置视图（「任务高频留底栏，环境低频进设置」）；圆点 = accent 34% 透明度 1.2px。
- 设置图标 = lucide cog（旧辐条图标被误读成明暗切换）。

**Why**: 旧侧栏把导航 / 标注 / 设置 / 主题混在一栏；Steel Blue 在圆角组件上过深。
**状态**: 体验板全交互验证完毕，真实代码落地中（2026-08 批次）。

---

## 2026-08-13 · 设计语言 token 级锚定：Steel Blue accent + 画布点阵 + 结构缝回调

**Decided**（owner 在评审板 `previews/accent-orange` 上拍板；细化 2026-08-11 的审美锚）:
- **accent = Steel Blue `#1769aa`**（eval harness 现役 `--blue`），替换 iOS 蓝 `#007aff`。核心理由：chrome 与 iOS kit 内容分色（内容继续用 `#007aff`）。评审覆盖橙 / 蓝图蓝 / 制图绿三族 15 个候选，含 WCAG 对比度与琥珀同框检查。
- **画布纹理 = 24px 中性暖灰点阵**（`--wb-stage-dot`，屏空间固定，pan/zoom 不带动、无 moiré；职责是平移反馈不是测量）。灵感 = 绘图室三原色（绘图纸 / 晒图蓝图 / 坐标纸绿网格）；制图绿线网格保留为日后人格化选项。
- **语义色收编 eval 族降饱和对**：danger `#ff3b30`→`#b84230`，ok/online 绿 `#1b7a3d`/`#34c759`/`#e8f8ef` 散字面量 → `--wb-ok` / `--wb-ok-soft`。琥珀 `#f5a623` 保留为标注特性功能色（双端一致信号，不动）。
- **结构缝回调**：V5 全面去线矫枉过正——缝（pane 分界 1px `--wb-seam`）≠ 已退役的卡片描边。落在侧栏 head/footer、Annotations 段界、设置头、扩展面板头。
- **元数据 mono 档** `--wb-font-mono`（标注行 cap/tags 首消费，双端共享表同源）。
- 字体保持 Apple 系统栈；单 light 主题，不做 dark。

**Why**: 审美参照系是 owner 自己的 my-todos（DESIGN.md 自称 Linear Light，accent `#5e6ad2`）与 areta eval harness（shadcn 中性 + Geist + 降饱和语义色）；token 管道（生成器 → shadcn 桥 → Tailwind + 注入端钉值）让换皮只动值不动组件，本轮即验证。

**顺带修复**: 扩展面板（`#panel-list`）此前不在 `lib/ann-list.css` 作用域内——行/空态从未吃到共享样式，本轮补入第三消费端。

---

## 2026-08-11b · 扩展标注面板 = Chrome Side Panel（原生分屏）；点击必达 + 陈旧自愈

**Decided**（owner 拍板，扩展 0.3.0 落地，dev `5a1ed12`）:
- 图标点击打开 **Chrome Side Panel**（`chrome.sidePanel.open`），标注列表/模式切换/跳转/编辑/删除搬进浏览器原生侧栏。页面内 `#ann-sidebar` 浮层不再是扩展场景的主控制面，保留给无扩展场景（`/sites/` 直开、S 键、工具条「列表」）。
- 面板页由 **pinpoint 服务托管**（`panel.html` + `workbench/app/Panel.jsx`），扩展壳（`sidepanel.html/js`）只做 tab 锁定、page-info 查询、命令转发与死法提示——行模型/样式（`lib/ann-row.js`、`lib/ann-list.css`）与 API/SSE 零复制。
- **写入单归页面 client**：面板动作经 `postMessage → 壳（校验 source+origin）→ content script → pinpoint:command DOM 桥 → client` 执行（goToMark/openMark/removeMark/toggleMode），SSE 广播回面板；面板永不直接写盘，无 revision 并发面。
- **点击必达契约**：点击永远有可见结果。死法分层提示（壳内本地渲染）：服务没起 / 页面不支持 / 桥没响应 / 页面组件过旧→⌘R / 未注册 / workbench 壳页。
- **陈旧自愈**：扩展重载前的旧标签页没有活 content script，面板壳经 `chrome.scripting` 幂等补注（`window.__pinpointContent` 守卫）后重试；页面内 client 过旧（无 `data-pinpoint-client` 标记）是唯一必须 ⌘R 的情形——`window.__pinpoint` 防重入守卫使 JS 层无法替换旧 client。

**Why**: 页面内浮层恒压右侧 280px，且 margin 推挤会让 fixed/vw/媒体查询破相——与「高保真评审必须看到真实布局」冲突；原生分屏让页面按更窄视口正常 reflow。此前 quiet no-op 让「client 过旧/未注册/插件坏了」三种死法不可分辨，点击必须有反馈。

**桥协议**（`data-pinpoint-*` on `<html>`，client 启动时打）：`data-pinpoint-client="1"` 就绪 / `data-pinpoint-entry` 账本归属 / `data-pinpoint-sidebar="suppressed"` 壳页抑制 / `data-pinpoint-mode` 交互|标注。

**自动化边界**（排查实测，后来者省时间）: 品牌 Chrome 151 忽略 `--load-extension`；Chromium 对程序化 `chrome.runtime.reload()` 的未打包扩展直接禁用（disable_reasons `1<<24`）；Playwright 点不了工具栏图标、开不了真 side panel——测试路径 = 壳作为普通标签页打开（SW 里 `chrome.tabs.create`）+ `?tab=<id>` 覆盖。

---

## 2026-08-11 · 设计语言锚：扁平 / Linear 风 / light theme（owner 审美准则）

**Decided**（owner 钦定，本 repo 一切 UI 工作的验收尺）: chrome 与注入端一律扁平 Linear 系 light 风。具体表现形式：
- **色彩**：中性灰阶低饱和；分层靠明度差不靠边框；唯一强调色 accent #007aff（主行动/选中态），功能色 danger/琥珀（标注武装）/绿（成功回显）各一枚；无渐变、无彩色图标。
- **边界**：禁 1px 描边卡片；分区靠留白与明度差，浮层靠阴影阶梯（--wb-sh-1..4）；描边只作功能信号（锚点框/套索/focus 环）；圆角控件 6 / 面板 12 / 模态 20，药丸只属于 badge/tag。
- **控件**：ghost 优先（透明底 + hover 浅灰填充），主行动才给实心色面；分段控件 = 灰槽 + 白面选中项；28px 高、13/12/10.5px 字阶、4 的倍数间距；hover/focus-visible/active/disabled 全态；过渡 ≤150ms，尊重 reduced-motion。
- **字体图标**：系统字栈；字重四档；读数 tabular-nums；区头 10.5px semibold 大写加字距；lucide 线性图标（1.75 描边，12/14/16 三档）；emoji 不当图标。
- **反馈**：状态变化用填充/字色不用描边；即时回显低打扰（ok 态消退，不弹 toast）；危险动作用 danger 浅面克制写法；键盘可达（roving focus / Esc / focus 还原）。
- **布局**：信息密度优先于呼吸感；画布内容永远是视觉重心，chrome 退后；严格左对齐与控件网格。
- **反模式**：hairline 卡片、渐变、毛玻璃、彩色阴影、大圆角卡片、emoji 图标、多强调色、满 bleed 色块。
**Why**: owner 对 V0-V4 换皮的终审反馈——灰槽 + 发丝边卡片是「AI 味」模板脸；此前配方太保守导致「改了这么多视觉没变化」。
**Consequences**: `--wb-sh-line` 叠用与各处 border-border 在 2026-08-11 扁平化试点中清除（侧栏/浮层/舞台/对话框）；后续新增 UI 一律按此验收。

---

## 2026-08-10b · workbench 技术栈重构（react-rebuild milestone 收官）

**Shipped**: goal `.gdd/goals/goal-20260810-workbench-react-rebuild.md`（本地 exclude）status=done；commit 链 `0acfdb2..c7c3760`（16 个，dev 未 push，发布等下一轮视觉组件库决策后一并走）。
**Decided**:
- chrome（侧栏/标注面板/HUD/设置/frame menu）= React 19 + zustand（`workbench/app/`，`store.js` 是共享状态唯一住处）；舞台保持命令式（`workbench/stage.js` + 簇模块 pages/board-nav/boot-prefs/screen-load/preview-mount/ann-bridge/export-core/frame-notes）。DOM id/class 是 e2e 契约，不许破。
- server state = TanStack Query（`app/query-client.js`，`staleTime: Infinity`；SSE `preview:update` 桥 `invalidateQueries` 是唯一失效源；手工 cacheBust/boardLoadGen 机械删除）。
- 弹层行为 = Radix Primitives（frame menu → DropdownMenu 非 portal + popper 置惰——`.wb-library` 是 transform:scale 空间，JS 量测定位在缩放 ≠1 必错位）；export dialog 保持原生 `<dialog>`+showModal（e2e 锁元素名 `dialog.wb-export-dialog`，原生已覆盖 focus trap/dismiss/焦点还原，评估证据见 goal 文档）。
- 视觉 = `--wb-*` token 体系（`scripts/build-wb-tokens.mjs` 生成 `workbench/wb-tokens.css`，`wb-tokens.test.js` 守鲜度；Radix Colors 锚定 ≤1 档，accent #007aff 锁定不漂移；radius/type/shadow/danger 阶梯归一，散装值清零）；`lib/ann-list.css` 双端同步 + annotate-inline 三向漂移守卫。
- 注入端 `client/annotate.js` 保持 vanilla 单文件（不进 React/构建）；URL 深链 `?page=&mode=`（读侧 URL 优先 prefs，写侧 replaceState 单向镜像）。
**Why**: 原 workbench.js 是 3621 行命令式单文件（87 个模块级 var），手写 DOM reconciliation/字符串拼 HTML/散装视觉值三重失控。
**纪律**: 禁循环 import（子模块不 import stage.js，反向依赖走 init*Deps DI）；lib/ 纯函数；每刀双门（npm test + e2e）绿后单 commit；e2e 中断后 `lsof -ti :5299 | xargs kill` 防孤儿端口。

---

## 2026-08-10 · pinpoint 服务化 milestone 收尾（closeout）

**Shipped**: WP0-WP9 共 12 个 commit（`8172f74..8f7dddf`）已 push 至 `origin/dev`（GitHub: 3rd-Musketeer/pinpoint）。公开模板 main **未**发布（owner 选择 A：只 ship-dev；`just publish` 留待明示）。
**Verified**: `npm test` 156/156、e2e 43/43（含 SPA 账本、扩展注入、/sites/、侧边栏全部用例）；真机回路（my-todos 注入/分桶/跳转）以自动化浏览器走完；owner 完成过一次真实 pickup 标注。
**形态**: registry（`~/.pinpoint/registry.json`）+ dir 服务端注入（/sites/）+ url 扩展注入 + SPA 账本 + 标注侧边栏（共享行渲染 `lib/ann-row.js` + `lib/ann-list.css`）；命名全部 pinpoint 化（`window.pinpoint`，`iOSAnnotate` 保留 deprecated alias）。
**残留归属**:
- `repos/` 下 morii-service、morii-ios 两处旧路径引用 → 归各 repo 自己的工作流。
- 未承诺候选（registry 热加载、Frame Note 写回、扩展非 localhost 支持、实例内容搬迁、web/html kit 等）→ [`.gdd/backlog.md`](.gdd/backlog.md)。
- e2e 环境教训：playwright 浏览器二进制会被机器上其它项目的新版 install 清走；e2e 全挂先查 `ls ~/Library/Caches/ms-playwright/`，修复 = `npx playwright install chromium`。
**重建指针**: 服务 `just dev`（https://pinpoint.localhost）；样式回归探针 `.tmp/keep/wp8-style-probe.mjs`（`--diff` 复跑）；扩展安装见 `extension/README.md`。

---

## 2026-07-20 · Separate topic, source, and delivery semantics

**Decided**: Feed fixtures use focused topics (`宝贝今日饮食`, `宝贝情绪`, `硬件进展`); people are shown as sources, while Alert remains a realtime delivery priority rather than a content type.
**Why**: Broad topics and the unconfirmed “主动分享” mechanism made Alert urgency, Digest scope, and source identity contradict the reviewed product intent.
**Alternatives**: Rejected patching individual card copy while keeping `伴侣近况` and person-prefixed topic titles because the same drift would persist in timelines and legacy frames.
**Files**: `previews/shared-calendar/_topic-data.js`, feed renderers, topic strategy fixtures, and `topic-feed-order.test.js`.
**Product SSOT**: `cold-topic/2026-08-13-topic-subs/`（2026-08-13 归档）。

---

## 2026-07-21 · Template split + release workflow

**Decided**: 本目录 git 化，git 只跟踪模板（框架 + Example Library + system 组件）。个人内容经 `.git/info/exclude` 本地排除（产品 preview 页、产品组件目录、decisions.md、CHANGELOG.local.md）；页面清单走 gitignored `previews/_index.local.json` 覆盖（workbench 先取 local，404 才回落 tracked）。
**Why**: exclude 不进共享 .gitignore，模板使用者看不到个人目录名。
**注意**: 锁屏字标默认已中性化为 HELLO（`data-lock-word` 覆盖）；个人锁屏已逐屏加 `data-lock-word="MORI"`。新增个人 preview 页 / 产品组件时记得同步加进 `.git/info/exclude` + `_index.local.json`。

## 2026-07-21b · Per-project annotation dir
**Decided**: 标注落盘从共享 `~/.html-annotate/` 改为按项目 `~/.html-annotate/<repo目录名>-<绝对路径hash>/`（本实例=`ios-app-preview-html-template-1t8yetj`，旧文件已迁入）。路径从 `GET /health` 的 `dataDir` 读，`HTML_ANNOTATE_DATA_DIR` 可覆盖。
**Why**: workbench page key 恒为 /index.html，同机多 clone 共享目录会混标注、共享 clear/revision——clone-per-project 模式必踩。

## 2026-08-07 · Product positioning: UIUX 原型交付与对齐工具

**Decided**（owner 产品思想，后续设计的准绳）: 这个项目的核心不是 "iOS HTML preview"，而是**帮助 owner deliver 高保真 UIUX 原型——把 UIUX 设计想清楚，并设计出符合 owner 审美的方案**。三个层各自服务这个目标：

- **kit**（ios-kit，未来可能有 web-kit / html-kit）= owner 个人设计规范的积累，是"符合我审美"的沉淀层；
- **workbench / canvas** = 多方案原型的对比查看界面，服务"想清楚设计"；
- **annotation** = 人 → Agent 的视觉反馈回路，服务"迭代修改原型"。

**Why**: 之前 repo 以 "iOS preview 模板" 自我定位，导致跨 topic 内容（symlink）、server 托管页面标注等需求无处安放；按上述定位，annotate 是独立的反馈协议层，kit/workbench 是它的两个 client。

**已定**（2026-08-07 讨论结论）:

- 跨 topic 内容用 **registry**（中央注册表，entry 分 `dir`/`url` 两类，稳定 id）替代 symlink；内容留在 owning topic 原地。
- 注入契约 = **"登记过才注入"**：`dir` 类由 review 服务在 serve 时自动注入 annotate client；`url` 类（如 my-todos）由浏览器扩展注入；`file://`、自起 server、未登记 origin 一律干净。目标项目零感知。
- 导出物（PNG / 完整 HTML）**不得**包含注入的标注脚本；导出管线内部绕开注入，不作为用户可见开关。
- client 只有一份 `annotate.js`；服务端注入与扩展注入只是两种投递方式，通信协议（`POST /save` + 磁盘 SSOT）唯一。

**Open**（讨论中，未定）: ~~SPA 前端路由切换时 page key 的重算~~ ~~annotation key 需含 origin/项目 id~~ —— 两项均已在 pinpoint 服务化 milestone（`.gdd/goal.md`）落地：SPA 账本切换见 WP2（Navigation API + switchLedger + epoch 护栏），key 归属见 WP1（按 registry entry-id 分桶）。该 milestone 执行完毕（2026-08-09，dev 分支 `8172f74..7fe4a5b`）。

---

## 2026-07-21c · Branch model: main = public template, dev = daily

**Decided**: 远端公开仓心智改为两支——**`main`** = 对外模板（原 `release`）；**`dev`** = 日常开发（原 `main`）。实例目录跟 `dev`；纯模板校验 worktree（`~/workspace/ios-app-preview-release`）跟 `main`。
**发布**: 在干净模板视图跑 `npm ci && npm run check`（e2e 自带 `PREVIEW_TEMPLATE_ONLY=1`）后，把 `dev` tip 推到 `main`（`git push origin dev:main`，或 worktree 里 `reset --hard dev && push`）。
**远端**: https://github.com/3rd-Musketeer/ios-app-preview（public）。上仓内容只含模板；产品页名不进文档/测试 fixture。
**Why**: 访客默认落到可发布模板；本地实例继续在 `dev` 叠 exclude 内容，不必再记「还有一个 release」。
