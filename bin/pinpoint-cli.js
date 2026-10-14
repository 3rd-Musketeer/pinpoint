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
import { USAGE, helpFor, reportUsageError } from './cli/args.js';
import { ioOf } from './cli/core.js';
import { runAdd, runMove, runPrune, runRename, runRemove } from './cli/registry.js';
import { runFolder } from './cli/folders.js';
import { runStatus, runStop, runStart, runRestart } from './cli/service.js';
import { runBuild, runRender } from './cli/pages.js';
import { runCheck, runComments, runLocate, runShot, runMark, runReply } from './cli/annotate.js';
import { runShow } from './cli/show.js';
import { runList } from './cli/list.js';
import { runMigrate } from './cli/migrate.js';
import { runNew } from './cli/new.js';
import { runOpen } from './cli/open.js';
import { runDev } from './cli/sandbox.js';

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
export { ensureDist } from './cli/dist.js';
export {
  pageListRows,
  projectListRows,
  formatProjectRow,
  formatProjectDetail,
  runList,
} from './cli/list.js';

/**
 * 每个命令都认 --json（docs/registry.md“CLI”）：stdout 只出一个 JSON 文档，人读的提示照旧走 stderr。
 * NATIVE_JSON 里的命令自己排 JSON；其余命令的文字输出包进同一个信封
 * { ok, exit, command, error?, output: [行], stderr: [行] }。原生命令出错没打 JSON 时也给信封，
 * 所以带 --json 的调用永远能 JSON.parse(stdout)。dev 是常驻命令，自己处理 --json。
 */
export const NATIVE_JSON = new Set(['show', 'check', 'comments', 'list', 'locate', 'shot', 'mark', 'reply', 'build', 'status', 'new', 'open']);
const SELF_JSON = new Set(['dev']);

function jsonEnvelope(command, code, output, stderr) {
  const firstError = stderr.find((line) => /^错误：/.test(line)) || (code ? stderr[0] : undefined);
  return {
    ok: code === 0,
    exit: code,
    command: command || null,
    ...(code && firstError ? { error: String(firstError).replace(/^错误：/, '') } : {}),
    output,
    stderr,
  };
}

async function runAsJson(argv, io) {
  const { out, err } = ioOf(io);
  const command = argv[0];
  const native = NATIVE_JSON.has(command);
  const output = [];
  const stderr = [];
  const captured = {
    ...io,
    out: (line) => output.push(String(line)),
    err: (line) => {
      stderr.push(String(line));
      err(line);
    },
  };
  const code = await dispatch(native ? argv : argv.filter((arg) => arg !== '--json'), captured);
  if (native && output.length) {
    try {
      JSON.parse(output.join('\n'));
      out(output.join('\n'));
      return code;
    } catch { /* 原生命令这次打的不是 JSON（不该发生）：包进信封 */ }
  }
  out(JSON.stringify(jsonEnvelope(command, code, output, stderr), null, 2));
  return code;
}

export async function run(argv, io = {}) {
  const { out } = ioOf(io);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    out(USAGE);
    return 0;
  }
  // ppnt help <命令> = ppnt <命令> --help
  if (argv[0] === 'help') {
    out(helpFor(argv[1]));
    return 0;
  }
  const wantsHelp = argv.includes('-h') || argv.includes('--help');
  if (argv.includes('--json') && !wantsHelp && !SELF_JSON.has(argv[0])) return runAsJson(argv, io);
  return dispatch(argv, io);
}

function dispatch(argv, io) {
  const { err } = ioOf(io);
  switch (argv[0]) {
    case 'list': return runList(argv, io);
    case 'show': return runShow(argv, io);
    case 'new': return runNew(argv, io);
    case 'open': return runOpen(argv, io);
    case 'dev': return runDev(argv, io);
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
    case 'comments': return runComments(argv, io);
    case 'locate': return runLocate(argv, io);
    case 'shot': return runShot(argv, io);
    case 'mark': return runMark(argv, io);
    case 'reply': return runReply(argv, io);
    case 'prune': return runPrune(argv, io);
    case 'migrate': return runMigrate(argv, io);
    default:
      return reportUsageError(argv[0], `未知命令：${argv[0]}`, err);
  }
}
