/**
 * pinpoint CLI —— 登记评审入口 + 服务生命周期（bin/pinpoint.mjs 的逻辑层，node --test 直接测这里）。
 *
 * pinpoint 是 HTML 宿主：想让一个页面进 pinpoint，就用 `pinpoint add`；
 * 已登记条目换路径用 `pinpoint move`（保留 id；标注桶按页寻址——挂靠条目的
 * 桶是宿主页的桶（storage-unify），换路径不会孤儿化）；
 * 换 id 用 `pinpoint rename`（登记表 + 标注桶 + 存量 HTML 里的 /sites/<id>/ 一起改）；
 * 从登记表删掉条目用 `pinpoint remove`（只删登记，源文件 / URL 不动；桶里还有
 * 标注行或有条目挂着它时拒绝，空桶顺手删掉）。
 * 静态内容（目录 / 单个 .html）由服务直接 host 在 /sites/<id>/；活的应用登记 URL。
 * 文件留在原地，CLI 只登记路径/URL。
 *
 * 服务侧：`status` / `start` / `stop` / `restart` 管的是这个 app 的 portless 注册
 * （`portless run --name pinpoint npm run dev:app`）与它那棵进程树。portless 的
 * proxy daemon（443，多 app 共享）不归 pinpoint 管，本文件一个字都不碰它。
 *
 * 进程原语（发信号、spawn、sleep）由 bin/pinpoint.mjs 注入 io，本文件只做判定，
 * 所以两种真实故障形态（进程死了 / 进程活着但配置错）都能拿构造输入单测。
 */
import { USAGE } from './cli/args.js';
import { ioOf } from './cli/core.js';
import { runAdd, runMove, runPrune, runRename, runRemove } from './cli/registry.js';
import { runFolder } from './cli/folders.js';
import { runStatus, runStop, runStart, runRestart } from './cli/service.js';
import { runBuild, runRender } from './cli/pages.js';
import { runCheck, runLocate, runShot, runMark } from './cli/annotate.js';
import { runList } from './cli/list.js';

// 原有导出面保持不变：测试与 bin/pinpoint.mjs 仍从这里 import。
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
  parseArgs,
} from './cli/args.js';
export {
  resolveTarget,
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
  runMove,
  runPrune,
  runRename,
  planRemove,
  runRemove,
} from './cli/registry.js';
export {
  buildFolderAdd,
  buildFolderRename,
  buildFolderRemove,
  buildFolderMove,
  folderRows,
  formatFolderList,
  planFolder,
  runFolder,
} from './cli/folders.js';
export {
  portlessRoutesPath,
  parseRoutes,
  pickRoute,
  serviceLogPath,
  classifyStatus,
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
  runLocate,
  planShotJobs,
  runShot,
  runMark,
} from './cli/annotate.js';
export {
  pageListRows,
  runList,
} from './cli/list.js';

export async function run(argv, io = {}) {
  const { out, err } = ioOf(io);
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    out(USAGE);
    return 0;
  }
  switch (argv[0]) {
    case 'list': return runList(argv, io);
    case 'add': return runAdd(argv, io);
    case 'move': return runMove(argv, io);
    case 'rename': return runRename(argv, io);
    case 'remove': return runRemove(argv, io);
    case 'folder': return runFolder(argv, io);
    case 'status': return runStatus(argv, io);
    case 'start': return runStart(argv, io);
    case 'stop': return runStop(argv, io);
    case 'restart': return runRestart(argv, io);
    case 'build': return runBuild(argv, io);
    case 'render': return runRender(argv, io);
    case 'check': return runCheck(argv, io);
    case 'locate': return runLocate(argv, io);
    case 'shot': return runShot(argv, io);
    case 'mark': return runMark(argv, io);
    case 'prune': return runPrune(argv, io);
    default:
      err(`错误：未知命令：${argv[0]}`);
      err(USAGE);
      return 1;
  }
}
