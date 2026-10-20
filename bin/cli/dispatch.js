/**
 * CLI 的运行时入口：run() / --json 信封 / dispatch。与命令模块分开是这个文件的
 * 存在理由（2026-10-20 r2：pinpoint-cli.js 的静态 re-export 面是给测试的，谁都不能
 * 从它进运行时——一旦从它 import，13 个命令模块的子树全部加载，`ppnt status`
 * 也要付 annotate / show 那些子树的 ~80ms）。命令按需动态 import：跑哪个命令
 * 只加载哪个子树。
 */
import { USAGE, helpFor, reportUsageError } from './args.js';
import { ioOf } from './core.js';

/**
 * 每个命令都认 --json（docs/registry.md“CLI”）：stdout 只出一个 JSON 文档，人读的提示照旧走 stderr。
 * NATIVE_JSON 里的命令自己排 JSON；其余命令的文字输出包进同一个信封
 * { ok, exit, command, error?, output: [行], stderr: [行] }。原生命令出错没打 JSON 时也给信封，
 * 所以带 --json 的调用永远能 JSON.parse(stdout)。dev 是常驻命令，自己处理 --json。
 */
const NATIVE_JSON = new Set(['show', 'check', 'comments', 'list', 'locate', 'shot', 'mark', 'reply', 'build', 'status', 'new', 'open']);
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
  // 命令与原生命令判定都看剥掉 --json 之后的 argv：--json 是全局开关，写在前
  // 面（ppnt --json list）和写在后面是同一次调用，信封的 command 字段与原生命
  // 令的顶层文档形状不该随 flag 位置变。
  const stripped = argv.filter((arg) => arg !== '--json');
  const command = stripped[0];
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
  // dispatch 收「命令在头」的 argv；原生命令要自己看到 --json 才出原生 JSON，
  // 所以剥掉的前置 flag 补回到尾部 —— 位置从此不挑（parseArgs 对 flag 顺序不敏感）。
  const code = await dispatch(native ? [...stripped, '--json'] : stripped, captured);
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
  const stripped = argv.filter((arg) => arg !== '--json');
  if (argv.length === 0 || stripped[0] === '-h' || stripped[0] === '--help') {
    out(USAGE);
    return 0;
  }
  const wantsHelp = argv.includes('-h') || argv.includes('--help');
  if (argv.includes('--json') && !wantsHelp && !SELF_JSON.has(stripped[0])) return runAsJson(argv, io);
  // dev 自己处理 --json，不经 runAsJson：这里同样把命令归一到头（ppnt --json dev …）。
  return dispatch(stripped.length === argv.length ? argv : [...stripped, '--json'], io);
}

/** 命令 → [模块, 运行函数]；动态 import 让每个子命令只加载自己的子树。 */
const COMMANDS = {
  logo: ['./logo.js', 'runLogo'],
  list: ['./list.js', 'runList'],
  show: ['./show.js', 'runShow'],
  new: ['./new.js', 'runNew'],
  open: ['./open.js', 'runOpen'],
  dev: ['./sandbox.js', 'runDev'],
  add: ['./registry.js', 'runAdd'],
  mv: ['./mv.js', 'runMv'],
  remove: ['./registry.js', 'runRemove'],
  status: ['./service.js', 'runStatus'],
  start: ['./service.js', 'runStart'],
  stop: ['./service.js', 'runStop'],
  restart: ['./service.js', 'runRestart'],
  build: ['./pages.js', 'runBuild'],
  render: ['./pages.js', 'runRender'],
  check: ['./annotate.js', 'runCheck'],
  comments: ['./annotate.js', 'runComments'],
  locate: ['./annotate.js', 'runLocate'],
  shot: ['./annotate.js', 'runShot'],
  mark: ['./annotate.js', 'runMark'],
  reply: ['./annotate.js', 'runReply'],
  prune: ['./registry.js', 'runPrune'],
  migrate: ['./migrate.js', 'runMigrate'],
  help: [null, null], // help 在 dispatch 里内联答，不加载任何命令模块
};

function dispatch(argv, io) {
  const { err, out } = ioOf(io);
  const entry = COMMANDS[argv[0]];
  if (!entry) return reportUsageError(argv[0], `未知命令：${argv[0]}`, err);
  // ppnt help <命令> = ppnt <命令> --help；--json help <命令> 的帮助文本进信封 output。
  if (argv[0] === 'help') {
    out(helpFor(argv[1]));
    return 0;
  }
  const [modulePath, fnName] = entry;
  return import(modulePath).then((mod) => mod[fnName](argv, io));
}
