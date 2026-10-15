/**
 * ppnt 的帮助文字：`ppnt --help` 是命令一览（USAGE），`ppnt <命令> --help` 是这个命令自己的
 * 用法与选项（HELP[命令].text）。用错选项时只打 HELP[命令].usage 这一行，不刷整份帮助。
 * 用词以 CONTEXT.md 为准：文章、节、帧、编号、页 id、画布视图、存量页。
 */
import { DEFAULT_ORIGIN } from './core.js';

const ADDRESS = `地址：文章写 <project>/<article>（也认文章网址和页 id <project>_<article>），输出一律是斜杠形；
      存量页写它的 id。节写 §2（文章页节号）、节 id 或字母 B；帧写 B1 或帧 id；
      标注写 <project>/<article>#3。第 n 节就是第 n 个字母，纯文字的节也占一个。`;

export const USAGE = `用法：ppnt <命令> [参数]（ppnt 和 pinpoint 是同一个入口）

${ADDRESS}

开始
  new article [<project>/]<article>    建一篇文章：写只有一节的 index.mdx，打印网址；不写 project 进默认的 notes
  new project <目录>                    建 project：写 docs/pinpoint/project.json 和空目录，并登记（文章要归类时用 mv 搬进来）
  dev --sandbox [<目录>]                起一个隔离服务（临时数据目录、登记表、端口），打印要 export 的变量

文章
  show <project>[/<article>]           一篇文章的节（§n · 字母 · 节 id · 帧 · open 数 · 网址），或一个 project 的文章、wiki、空 ref
  show <project>[/<article>] --uses <组件>  用到这个组件的帧和图
  open <目标> [§2 | wiki 名] [--print]   打开或打印网址：文章页、画布视图、wiki 词条页、project 首页
  check <project>[/<article>]          验证：布局错误、全部帧的编译与 lint、正文渲染错误、空 ref；有错退 1
  build <目标> [--frame <帧>] [--watch]  编译帧到 dist
  render <目标>/<帧 id>                 编译一帧打到 stdout，不落 dist
  shot <目标> [§2 | B | B1 | 帧 id …]   截图：只写目标截文章页整页，§2 截文章页的那一节，编号和帧 id 截画布视图，--figure <图 id> 截正文里的图
  list [关键词…]                        按口头说法找 project、文章和存量页

评论与标注
  comments <目标>                       读标注队列：画布标注和正文评论（目标可以是整个 project）
  locate <目标> <引用…>                  标注 → 源文件:行 · 组件
  mark <目标> <引用…> done|check [--note "<回复>"]  写状态；--note 同时在线程里回一句
  reply <目标> <引用…> "<回复>"           只在线程里回一句（不改状态）

服务
  status | start | stop | restart      体检、起停常驻服务

登记与存量页
  add <project 根> --project            登记一个 project
  mv <源> <目标>                        文章换 project 或改 id；project、存量页改 id 或换根目录
  add / remove / migrate / prune        存量页的登记、迁移与清理

每个命令都认 --json（stdout 只出一个 JSON）。退出码：0 成功 · 1 有问题（验证错误、引用没命中、服务没答）· 2 用法错或找不到目标。
每个命令的选项与例子：ppnt <命令> --help。环境变量见 ppnt status --help。`;

const REGISTRY_FLAG = '  --registry <路径>    用哪份登记表（缺省 PINPOINT_REGISTRY，再缺省 ~/.pinpoint/registry.json）';
const TARGET_NOTE = `  目标是第一个参数：<project>/<article>、存量页 id，或 @page:<页 id>。
  不写目标、引用里也没有 <project>/<article>#n、@frame:<页 id>/<帧 id> 或 @section:<页 id>/<节 id> 时报错并列出候选，不猜。`;

/** 每个命令：usage 一行（出错时打它），text 是 `ppnt <命令> --help` 的全文。 */
export const HELP = {
  show: {
    usage: 'ppnt show <project>[/<article>] [--uses <组件>] [--json]',
    text: `用法：ppnt show <project>[/<article>] [--uses <组件>] [--json]

一篇文章：每节一行 §n · 字母 · 节 id · 标题 · 帧数 · open 数（画布标注 + 正文评论），
  下面是这一节的帧（编号 · 帧 id · 源文件）和网址（文章页锚点、画布视图）。纯文字的节也列，
  所以 owner 说“第 2 节”时在这里对上字母和节 id。
一个 project：文章（斜杠地址、节数、帧数、open 数）、wiki 词条、空 ref、布局错误；有布局错误退 1。
布局错误里也列正文里的图（<Figure>）编不过、在浏览器里运行出错的那些；过期的图先重编。
存量页：编号 · 帧 id · 源文件（同 list <页 id> --frames）。

  --uses <组件>        只列用到这个组件的帧（编号 · 帧 id）和图，改了组件后照这张单子截图。
                       组件写名字（ConfirmCard）或文件（components/ConfirmCard.jsx）；帧和图会先编到最新。
                       一个都没用到时退 1
  --json               结构化输出
${REGISTRY_FLAG}

例：ppnt show browser-use/payment-confirm
    ppnt show browser-use --uses ConfirmCard`,
  },
  check: {
    usage: 'ppnt check <project>[/<article>] [--json]',
    text: `用法：ppnt check <project>[/<article>] [--json]

汇报前的验证，一条命令看全：
  - 布局错误（project.json、目录、frontmatter、<Section> / <Canvas> 的写法、缺帧）；
  - 正文里每个 <Canvas> 列的帧都编一遍，报 lint 与编译错误，被布局错误挡在画布外的节也编；
  - 正文里每个 <Figure> 的图也编一遍，报同样的 lint 与编译错误（图在浏览器里的运行错误看 ppnt show）；
  - 正文渲染错误：没定义的组件 <Foo />、没定义的变量 {x} 这类打开文章页才出的错；
  - 空 ref（提示级，合法）。
每条诊断一行：文件:行  级别  code  说明。不写 dist，不需要服务在跑。
退出码：0 通过（只有提示）· 1 有错误 · 2 用法错或找不到目标。

  --json               结构化输出：{ target, ok, counts, articles, frames, figures, diagnostics: [{ severity, code, file, line, message, article?, section?, frame?, figure? }] }
${REGISTRY_FLAG}

读标注和正文评论用 ppnt comments。`,
  },
  comments: {
    usage: 'ppnt comments <目标> [--status open|check|done|close|all] [--frame <帧>] [--mode excerpt|image|both] [--group-by frame|component] [--json]',
    text: `用法：ppnt comments <目标>[#n] [选项]

读标注队列（只读）：画布标注按帧分组，给序号、编号、正文、意图、源码摘录；正文评论单独一组，
给引文、节、index.mdx 里的落脚行和整个线程；agent 的回复列在每一条下面。抬头是各状态的计数。
dist 不在或落后于源码时先编一次（stderr 打一行说明），不用先 build。
目标可以是一篇文章、一个存量页，也可以是整个 project（逐篇列出有条目的文章）。
<目标>#n 只看这一条（缺省 --status all）。

  --status <状态>      open（缺省）| check | done | close | all
  --frame <帧>         只看一帧：B3、帧 id（多 tab 的存量页写 <tab>:B3）
  --mode <形式>        excerpt（缺省，最小完整元素 + 父链 + 兄弟折叠）| image（服务渲染 1x 截图，服务要在跑）| both
  --group-by <分组>    frame（缺省）| component（组头给组件共用的帧数）
  --json               结构化输出
${REGISTRY_FLAG}

表面已经不存在的账本列在末尾的“孤儿标注”组，不计数；ppnt mark / reply 照样用 #n、@a:<id> 回它们，清理走 ppnt prune。

例：ppnt comments browser-use/payment-confirm
    ppnt comments browser-use --status all`,
  },
  build: {
    usage: 'ppnt build <目标> [--frame <帧 id>] [--watch]',
    text: `用法：ppnt build <目标> [--frame <帧 id>] [--watch]

编译帧到 dist（<数据目录>/dist/<页 id>/），每帧打 ok 或错误与耗时。文章的画布由 index.mdx 现派生。
${TARGET_NOTE.split('\n')[0]}

  --frame <帧 id>      只编一帧（其余帧的记录保留）
  --watch              编完后盯目录，改动自动重编（Ctrl-C 退出）
  --json               结构化输出：{ target, ok, ms, partial, frames, figures }；不和 --watch 同用
${REGISTRY_FLAG}

改完一篇文章要看全部问题（含正文渲染错误），用 ppnt check。`,
  },
  render: {
    usage: 'ppnt render <目标>/<帧 id> [--full]',
    text: `用法：ppnt render <目标>/<帧 id> [--full]

编译一帧打到 stdout，不落 dist。超 8000 字符截断，全文写 <数据目录>/render/<页 id>/<帧 id>.html 并打出路径。
例：ppnt render browser-use/payment-confirm/submit-confirm

  --full               不截断
${REGISTRY_FLAG}`,
  },
  shot: {
    usage: 'ppnt shot <目标> [§2 | B | B1 | 帧 id | #n …] [--canvas] [--figure <图 id>] [--marks] [--scale 1|2] [--timeout <秒>]',
    text: `用法：ppnt shot <目标> [引用…] [选项]

截图（PNG，打印“引用 → 路径 · 宽×高”）。服务要在跑；文章站点在启动时（503“站点启动中”）命令自己等。
  ppnt shot <project>/<article>        文章页整页（文章页的样子：正文、画布卡片、评论栏）
  ppnt shot <project>/<article> §2     文章页上的第 2 节
  ppnt shot <project>/<article> B1     画布视图上的一帧；B 是一整节；帧 id、节 id 同义
  ppnt shot <project>/<article> --canvas  画布视图整页（多 tab 的存量页每个 tab 一张）；文章的 HTML 帧不在画布那一行，各截一张整页
  ppnt shot <project>/<article> --figure <图 id>  正文里的一个图（<Figure>），浅色、深色各一张，760 宽
  ppnt shot <存量页 id> [B1 …]          存量页：不写引用是整个画布
纯文字的节没有画布，写它的字母或节 id 时截文章页上的那一节。
产物在 <数据目录>/shot/<页 id>/：文章页 article.png、article-<节 id>.png；画布 <帧 id|节 id|页 id>.png；
图 figure-<图 id>.png 与 figure-<图 id>-dark.png。

  --canvas             画布视图整页；文章的 HTML 帧（文档条目）各按自己的地址截 402 宽整页，全是 HTML 帧时不出画布图，打一行“说明：”
  --figure <图 id>     正文里的一个图（figures/<图 id>.jsx），不和引用同用；图编译失败或在浏览器里运行出错时打出原因、退 1
  --marks              把 open 标注的 #n 序号钉烤进画布截图
  --status <状态>      加上这个状态的标注所在的帧
  --scale 1|2          像素倍数（缺省 1）
  --timeout <秒>       等文章站点就绪的上限（缺省 60）
  --json               结构化输出：{ target, shots: [{ kind, label, out, width, height, truncated?, pending? }], notes, warnings, errors }
${REGISTRY_FLAG}
${TARGET_NOTE}

文章页截到一半（正文渲染出错，页面里没有正文结束标记）：图照样存下，stderr 打一行“注意”，退 1；
ppnt check <project>/<article> 给出错在哪一行。
截之前等页面里（含嵌套 iframe 里）懒加载的 iframe 和图片加载完，上限 15 秒；到时还没加载完的照常截，
stderr 打一行“注意”列出它们，退 1。`,
  },
  new: {
    usage: 'ppnt new project <目录> [--id <id>] [--title <标题>] | ppnt new article [<project>/]<article> [--title <标题>]',
    text: `用法：ppnt new project <目录> [--id <id>] [--title <标题>]
      ppnt new article [<project>/]<article> [--title <标题>]

new project：在 <目录>/docs/pinpoint/ 下写 project.json，建空的 articles/ 和 wiki/，再登记（同 ppnt add <目录> --project）。
  id 缺省取目录名（小写、连字符）。project.json 已经在就不改它，只补登记。
new article：在 project 里建 articles/<article>/index.mdx，frontmatter 写 title，正文是一节 <Section>，
  打印文章页网址和下一步。project 要先登记；index.mdx 已经在就拒绝，不覆盖。
  只写 <article>（不带 /）时建在默认 project notes 里：notes 没登记就先在 $PINPOINT_DEFAULT_PROJECT
  （缺省 ~/notes）建好并登记，id notes、标题 Notes；登记过之后以登记表为准。
两个命令都不覆盖已有文件，打印写了哪些、跳过了哪些。

  --id <id>            project id（只用于 new project）
  --title <标题>        project 或文章的标题（缺省用 id）
  --json               结构化输出：{ kind, address, files, skipped, registered, urls, next }
${REGISTRY_FLAG}

例：ppnt new article quick-idea                         # 进默认 project：notes/quick-idea
    ppnt new article browser-use/payment-confirm --title 付款确认
    ppnt new project ~/work/browser-use --title "Browser Use"
    ppnt mv notes/quick-idea browser-use/              # 之后归类：搬进 browser-use，保留 id`,
  },
  open: {
    usage: 'ppnt open <目标> [§2 | 节 id | wiki 词条名] [--print] [--json]',
    text: `用法：ppnt open <目标> [§2 | 节 id | wiki 词条名] [--print] [--json]

打开或打印网址（地址按 PINPOINT_ORIGIN，缺省 ${DEFAULT_ORIGIN}）：
  ppnt open <project>/<article>          文章页、画布视图（没有带画布的节时不打）
  ppnt open <project>/<article> §2       文章页上那一节的锚点，和画布视图里那一节（纯文字的节只有锚点）
  ppnt open <project>                    project 首页、llms.txt、每篇文章、每个 wiki 词条页
  ppnt open <project> <wiki 词条名>      那个 wiki 词条页
不带 --print 时用系统浏览器打开第一个网址，其余照样打印。

  --print              只打印，不打开浏览器
  --json               结构化输出：{ target, urls: [{ kind, label, url }] }
${REGISTRY_FLAG}`,
  },
  dev: {
    usage: 'ppnt dev --sandbox [<目录>] [--port <端口>] [--site-port <端口>]',
    text: `用法：ppnt dev --sandbox [<目录>] [--port <端口>] [--site-port <端口>]

起一个和 owner 的常驻服务完全分开的服务，前台常驻，Ctrl-C（或 kill 它打印的 pid）停服务和文章站点。
  数据目录      <目录>（缺省新建一个临时目录），标注、dist、截图都写这里
  登记表        <目录>/registry.json
  端口          --port，缺省从 6400 起找一个空的；文章站点 --site-port，缺省端口 + 5
  起法          在 pinpoint 仓库里跑 npm run dev:app（直接起 vite，不经 portless，不碰 pinpoint.localhost）
就绪后打印一行要 export 的变量，同时写进 <目录>/env.sh。另一个终端里先 source 它，之后的 ppnt 命令都对着这个服务：
  source <目录>/env.sh && ppnt new project /tmp/demo
不接受 owner 的端口（4134、站点 4530、5199）和 ~/.pinpoint。

  --port <端口>         服务端口
  --site-port <端口>    文章站点端口
  --json               就绪时 stdout 打一行 JSON：{ dataDir, registry, origin, port, sitePort, pid, envFile }`,
  },
  locate: {
    usage: 'ppnt locate <目标> <引用…> [--status <状态>]',
    text: `用法：ppnt locate <目标> <引用…> [--status <状态>]

每条标注一行：#n → 源文件:行 · 组件（共用 n 帧）。正文评论落到 index.mdx 里引文所在的行；
存量页的 HTML 帧给 dist 路径 + selector。
引用：#12、#3-#7、B3（这一帧的全部标注）、B 或 §2（这一节）、帧 id、节 id、<project>/<article>#12、
@frame:<页 id>/<帧 id>、@section:<页 id>/<节 id>、@a:<id>。
${TARGET_NOTE}

  --status <状态>      加上这个状态的全部标注（open | check | done | close | all）
  --json               结构化输出：{ target, rows: [{ n, type, status, frame?, section?, file?, line?, text }], empty, errors }
${REGISTRY_FLAG}

引用指到的帧或节上没有标注：打一行说明，退 0。引用没命中（没有这条、这一帧）：退 1。

例：ppnt locate browser-use/payment-confirm '#3' B1`,
  },
  mark: {
    usage: 'ppnt mark <目标> <引用…> done|check [--note "<回复>"]',
    text: `用法：ppnt mark <目标> <引用…> done|check [--note "<回复>"]

写状态，走服务的状态端点（带 baseRevision），逐条打印结果；冲突或非法转换打 409 原因，不中断其他条。
看了但不改 → check；改完 → done。open 由 owner 编辑时自动回，close 只有 owner 在工作台或文章右栏做。
--note 先在这条标注的线程里回一句（改了什么、为什么没改），再写状态；回复失败时状态不写。
画布标注、存量页的文档标注、正文评论都有线程，owner 在工作台标注列表、标注卡和文章右栏里看到。
引用同 locate。
${TARGET_NOTE}

  --note <回复>        同时回一句
  --status <状态>      加上这个状态的全部标注
  --json               结构化输出：{ target, status, results: [{ n, ok, note?, error? }], errors, empty }
${REGISTRY_FLAG}

例：ppnt mark browser-use/payment-confirm '#3' '#4' done
    ppnt mark hosted-pages '#7' check --note "标题已经缩短，见 v2"`,
  },
  reply: {
    usage: 'ppnt reply <目标>#<n> "<回复>"',
    text: `用法：ppnt reply <目标>#<n> "<回复>"
      ppnt reply <目标> '#<n>' "<回复>"

在一条标注的线程末尾追加一条 agent 消息，走服务的回复端点（带 baseRevision），状态不动。
画布标注、存量页的文档标注、正文评论都可以回。要同时改状态用 mark … --note。zsh 里单独的 #n 要加引号。
${TARGET_NOTE.split('\n')[0]}

  --json               结构化输出：{ target, n, ok, status?, text?, error? }
${REGISTRY_FLAG}`,
  },
  list: {
    usage: 'ppnt list [关键词…]',
    text: `用法：ppnt list [关键词…]

把口头说法对上地址：列 project（下面每篇文章一行 <project>/<article>）和存量页（id · 标题 · 类型 ·
open / check / done 计数，次行源路径）。关键词在 id、标题、路径上宽松匹配，多个词要同时对上，
英文复数自动去 s，连字符与空格互通；也匹配文章的 id 和标题。
  ppnt list <project>                 同 ppnt show <project>
  ppnt list <页 id> --frames          编号 · 帧 id · 源文件 · 标题（同 ppnt show <存量页 id>）

  --frames             见上
  --json               结构化输出：{ query, registry, projects, pages }
${REGISTRY_FLAG}`,
  },
  status: {
    usage: 'ppnt status',
    text: `用法：ppnt status

服务体检：路由 · 进程 · 直连 /health · 代理 /health · 服务 root · registry · project · 文章站点；全绿才退 0。
  --json               结构化输出：体检的每一项和总结论
${REGISTRY_FLAG}

环境变量：
  PINPOINT_REGISTRY    同 --registry（--registry 优先）
  PINPOINT_DATA_DIR    数据目录：标注桶、dist、截图、日志（缺省 ~/.pinpoint）
  PINPOINT_ORIGIN      服务地址（缺省 ${DEFAULT_ORIGIN}）。登记后 CLI 探活并让服务重读登记表；
                       shot、mark、reply、comments --mode image 也走它；设了它，status 只体检这一个服务
  PORTLESS_ROUTES      portless 路由表位置（缺省 ~/.portless/routes.json），status 读它`,
  },
  start: { usage: 'ppnt start', text: '用法：ppnt start\n\n起常驻服务（https://pinpoint.localhost）。已经健康就拒绝；日志在 <数据目录>/logs/service.log。\n要隔离运行（测试、冒烟）不要用它，见 docs/registry.md“隔离运行”。' },
  stop: { usage: 'ppnt stop', text: '用法：ppnt stop\n\n停常驻服务：只给 portless 记下的那个进程发 SIGTERM。' },
  restart: { usage: 'ppnt restart', text: '用法：ppnt restart\n\n停 + 起。服务跨过一次仓库目录搬迁后（status 报服务 root 不对）用它。' },
  add: {
    usage: 'ppnt add <project 根> --project | ppnt add <目录|文件.html> [--title X] [--board ios|html] [--id xxx]',
    text: `用法：ppnt add <project 根> --project
      ppnt add <目录|文件.html> [选项]

登记进 registry（文件留在原地，只登记路径），服务在跑就让它重读登记表。
  目录 + --project     project：读 <根>/docs/pinpoint/project.json，id 与标题都取它；不能和 --title / --board 同用
  目录                 存量页（kind dir），服务在 /sites/<id>/ 下只读托管并注入标注
  单个 .html           kind file，只托管这个文件

  --project            见上
  --title X            显示名（缺省目录名 / 文件名）
  --board ios|html     工作台的壳（缺省 html；只对目录生效）
  --id xxx             本条目自己的 id（缺省由名称派生；撞了已有 id 就报错）
${REGISTRY_FLAG}`,
  },
  mv: {
    usage: 'ppnt mv <源> <目标> [--dry-run]（<project>/<a> <project>/<b> | <id> <新 id> | <id> <路径>）',
    text: `用法：ppnt mv <project>/<article> <project>/<article>|<project>/   文章换 project 和 / 或改 id
      ppnt mv <id> <新 id>                                           project 或存量页改 id
      ppnt mv <id> <路径>                                            换根目录 / 落点，id 不变

按目标的写法决定做什么。目标以 /、.、~ 开头是磁盘路径；源是文章时目标写 <project>/<article>，
写 <project>/ 保留文章 id。

文章：目录搬到目标 project 的 articles/<新 id>/，标注桶 <p>_<a> 改名成 <p2>_<b>，账本里的 pageId 与正文评论的
  path 改写；文章里写死的 /sites/<旧页 id>/ 换成新页 id；shot / check 缓存跟着搬，dist / render 删掉，有 dist 的
  按新页 id 重编。下面任何一条不过就整单不动：源文章不在、目标 project 没登记、目标目录已经在、目标桶里有标注行、
  换 project 时 HTML 帧（{ id, src }）在新 project 里找不到（source 没登记、相对 project 根的文件不在）。
  别的文章里指向它的 [[ ]] 不改，逐条列成注意。
改 id：四件事都能做才动手：登记表换 id、标注桶改名、目录条目里的 /sites/<旧 id>/ 换成新前缀、服务重读。
  project：改写 project.json 的 id，每篇文章的桶 <旧 id>_<文章> 改名成 <新 id>_<文章>（任何一个目标已存在就整单不动），
  画布视图按新页 id 重编。
换路径：把已登记的条目指到新路径，id 和标题不变，标注照旧对得上。project：新根目录里 project.json 的 id 必须不变。

  --dry-run            只列计划，什么都不写
${REGISTRY_FLAG}

例：ppnt mv notes/quick-idea browser-use/payment-retry
    ppnt mv notes/quick-idea browser-use/
    ppnt mv browser-use areta-browser
    ppnt mv browser-use ~/work/areta/browser-use`,
  },
  remove: {
    usage: 'ppnt remove <id>',
    text: `用法：ppnt remove <id>

从登记表删掉一个条目，源文件不动，重新 add 就恢复。两种情况拒绝：id 不存在；
标注桶里还有标注行（先处理，或 ppnt prune）。桶是空的就顺手删掉。project 的每篇文章的桶守同一条。
${REGISTRY_FLAG}`,
  },
  migrate: {
    usage: 'ppnt migrate <存量页 id> --project <根> [--article <id>] [--dry-run]',
    text: `用法：ppnt migrate <存量页 id> --project <根> [--article <id>] [--dry-run]

把存量页迁成 project 里的一篇文章（docs/projects.md“从存量页迁移”）：每个 board section 成为一节
（<Section> + <Canvas>，tab 摊平成二级标题），帧、组件、sidecar、资源照原相对路径复制。写完逐帧编译，
和旧页的渲染逐行比；有帧编不过或 shell 不一致退 1。旧页的文件、登记和标注都不动。

  --project <根>       project 根目录，要已有 docs/pinpoint/project.json
  --article <id>       文章 id（缺省 = 页 id）；目录已存在就拒绝
  --dry-run            只打印计划与 index.mdx，不写文件
${REGISTRY_FLAG}`,
  },
  prune: {
    usage: 'ppnt prune <目标> [--dry-run]',
    text: `用法：ppnt prune <目标> [--dry-run]

删掉这个桶里的孤儿账本（表面已经不存在：文件删了、文章删了或改名了、页不在了）。直接删除、不备份，
由 owner 决定；--dry-run 只列不删。目标写 <project>/<article>、页 id 或桶名。
${REGISTRY_FLAG}`,
  },
};

/** 一个命令的全文帮助；未知命令给命令一览。 */
export function helpFor(command) {
  return HELP[command] ? HELP[command].text : USAGE;
}
