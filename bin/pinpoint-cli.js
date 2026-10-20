/**
 * pinpoint CLI —— 登记评审入口 + 服务生命周期（bin/pinpoint.mjs 的逻辑层，node --test 直接测这里）。
 *
 * pinpoint 是 HTML 宿主：想让一个页面进 pinpoint，就用 `pinpoint add`；
 * 已登记条目换路径用 `ppnt mv <id> <路径>`（保留 id；标注桶按页寻址，换路径不会孤儿化）；
 * 换 id 用 `ppnt mv <旧 id> <新 id>`（登记表 + 标注桶 + 存量 HTML 里的 /sites/<id>/ 一起改）；
 * 文章换 project 或改 id 用 `ppnt mv <project>/<a> <project2>/<b>`（目录与标注桶一起搬，见 cli/mv.js）；
 * 从登记表删掉条目用 `pinpoint remove`（只删登记，源文件不动；桶里还有
 * 标注行时拒绝，空桶顺手删掉）。
 * 静态内容（目录 / 单个 .html）由服务直接 host 在 /sites/<id>/。
 * 文件留在原地，CLI 只登记路径。
 *
 * 服务侧：`status` / `start` / `stop` / `restart` 管的是这个 app 的 portless 注册
 * （`portless run --name pinpoint npm run dev:app`）与它那棵进程树。portless 的
 * proxy daemon（443，多 app 共享）不归 pinpoint 管，本文件一个字都不碰它。
 *
 * 进程原语（发信号、spawn、sleep）由 bin/pinpoint.mjs 注入 io，本文件只做判定，
 * 所以两种真实故障形态（进程死了 / 进程活着但配置错）都能拿构造输入单测。
 *
 * 本文件只是导出面（测试与既有消费方从这里 import）：运行时入口在 cli/dispatch.js
 * —— run / --json 信封 / 按命令动态 import 的 dispatch 都在那边，`ppnt <命令>` 只
 * 加载自己那棵子树；从这里 import 会把下面 re-export 的全部子树拖进来（2026-10-20
 * r2，此前 bin/pinpoint.mjs 从这里进，status 也要付 annotate / show 的 ~80ms）。
 */
export {
  DEFAULT_ORIGIN,
  PORTLESS_HOSTNAME,
  CliError,
  slugify,
  requestJson,
  displayWidth,
} from './cli/core.js';
export {
  USAGE,
  HELP,
  helpFor,
  parseArgs,
} from './cli/args.js';
export {
  parseAddress,
  resolveAddress,
  displayAddress,
  toPageRef,
  normalizeRefToken,
  letterNumber,
  looksLikeRef,
} from './cli/address.js';
export { runShow, articleModel, projectModel } from './cli/show.js';
export { formatDiagnostic, countDiagnostics } from './cli/validate.js';
export {
  resolveTarget,
  resolveProjectRoot,
  entryTargetDesc,
  buildEntry,
  manifestPageIds,
  buildMove,
  rewriteSitePrefix,
  rewriteSitePrefixUnder,
  buildRename,
  planRename,
  resolveRegistryPath,
  planAdd,
  planMove,
  runAdd,
  moveEntry,
  runPrune,
  renameEntry,
  planRemove,
  runRemove,
} from './cli/registry.js';
export {
  portlessRoutesPath,
  parseRoutes,
  pickRoute,
  serviceLogPath,
  classifyStatus,
  classifyOriginStatus,
  formatStatus,
  decideStart,
  decideStop,
  collectStatus,
  runStatus,
  runStop,
  runStart,
  runRestart,
} from './cli/service.js';
export {
  refLikeIdNotice,
  startPageWatch,
  runBuild,
  planRenderOutput,
  runRender,
} from './cli/pages.js';
export {
  runCheck,
  runComments,
  runLocate,
  planArticleShots,
  pendingWarning,
  planShotJobs,
  runShot,
  runMark,
  runReply,
} from './cli/annotate.js';
export { formatPlan, formatVerify, migrateNextSteps, runMigrate } from './cli/migrate.js';
export { planNewProject, planNewArticle, articleScaffold, runNew } from './cli/new.js';
export { openUrls, runOpen } from './cli/open.js';
export { pickSandboxPorts, sandboxEnv, OWNER_PORTS, runDev } from './cli/sandbox.js';
export { componentUses } from './cli/uses.js';
export { classifyMv, planArticleMove, runMv } from './cli/mv.js';
export { ensureDist } from './cli/dist.js';
export {
  pageListRows,
  projectListRows,
  formatProjectRow,
  formatProjectDetail,
  runList,
} from './cli/list.js';

export { run } from './cli/dispatch.js';
