import { CliError, ioOf } from './core.js';
import { HELP, USAGE, helpFor } from './help.js';

export { HELP, USAGE, helpFor };

export const BOARDS = new Set(['ios', 'html']);
// 值选项与布尔开关（布尔开关不吃下一个 token，也不许带 =值）。
const VALUE_FLAGS = new Set(['title', 'board', 'id', 'registry', 'page', 'screen', 'frame', 'status', 'mode', 'group-by', 'scale', 'article', 'timeout', 'figure', 'uses', 'port', 'site-port', 'note']);
const BOOLEAN_FLAGS = new Set(['watch', 'full', 'json', 'marks', 'dry-run', 'project', 'canvas', 'frames', 'print', 'sandbox']);
// 每个命令接受的选项与位置参数个数。valueFlags：在这个命令里吃值的开关名（migrate 的
// --project <根目录>；add 的 --project 仍是开关）。locate / shot / mark 的位置参数
// 个数按子命令定（variadic = null），由命令自己校验下限。
const COMMANDS = {
  add: { positional: 1, flags: new Set(['title', 'board', 'id', 'registry', 'project']) },
  move: { positional: 2, flags: new Set(['registry']) },
  rename: { positional: 2, flags: new Set(['registry']) },
  remove: { positional: 1, flags: new Set(['registry']) },
  status: { positional: 0, flags: new Set(['page', 'registry', 'json']) },
  start: { positional: 0, flags: new Set() },
  stop: { positional: 0, flags: new Set() },
  restart: { positional: 0, flags: new Set() },
  build: { positional: 1, flags: new Set(['registry', 'screen', 'frame', 'watch', 'json']) },
  render: { positional: 1, flags: new Set(['registry', 'full']) },
  show: { positional: 1, flags: new Set(['registry', 'json', 'uses']) },
  // check 是验证；--frame / --status / --mode / --group-by 只为过渡期的旧用法（列标注队列）留着。
  check: { positional: 1, flags: new Set(['registry', 'frame', 'status', 'mode', 'group-by', 'json']) },
  comments: { positional: 1, flags: new Set(['registry', 'frame', 'status', 'mode', 'group-by', 'json']) },
  locate: { positional: null, flags: new Set(['registry', 'status', 'page', 'json']) },
  shot: { positional: null, flags: new Set(['registry', 'status', 'scale', 'marks', 'page', 'canvas', 'timeout', 'figure', 'json']) },
  mark: { positional: null, flags: new Set(['registry', 'status', 'page', 'json', 'note']) },
  reply: { positional: null, flags: new Set(['registry', 'page', 'json']) },
  prune: { positional: 1, flags: new Set(['registry', 'dry-run']) },
  migrate: { positional: 1, flags: new Set(['registry', 'project', 'article', 'dry-run']), valueFlags: new Set(['project']) },
  // new project <根> / new article <project>/<article>：脚手架，不覆盖已有文件。
  new: { positional: 2, flags: new Set(['registry', 'id', 'title', 'json']) },
  // open <目标> [§2 | 节 id | 概念名]：打印或打开网址。
  open: { positional: null, flags: new Set(['registry', 'print', 'json']) },
  // dev --sandbox [<目录>]：隔离服务，前台常驻。
  dev: { positional: null, flags: new Set(['sandbox', 'port', 'site-port', 'json']) },
};

/** `ppnt new` 能建的两种东西。 */
export const NEW_KINDS = ['project', 'article'];

/** 参数解析（纯函数）。add 返回 { command, target, flags }，move 返回 { command, id, target, flags }，
    服务命令返回 { command, flags }；非法输入抛 CliError。 */
export function parseArgs(argv) {
  const args = [...argv];
  if (args.includes('-h') || args.includes('--help')) return args[0] && !args[0].startsWith('-') ? { help: true, command: args[0] } : { help: true };
  const command = args.shift();
  if (!command) throw new CliError('缺少命令');
  const spec = COMMANDS[command];
  if (!spec) throw new CliError(`未知命令：${command}`);
  // 选项错了要知道是哪个命令的，好只打这一个命令的用法行。
  const fail = (message) => {
    const error = new CliError(message);
    error.command = command;
    throw error;
  };
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const inline = arg.includes('=') ? arg.indexOf('=') : -1;
    const name = inline > 0 ? arg.slice(2, inline) : arg.slice(2);
    const takesValue = !!(spec.valueFlags && spec.valueFlags.has(name));
    if (BOOLEAN_FLAGS.has(name) && !takesValue) {
      // 布尔开关：不吃下一个 token，也不许 --watch=xxx 带值。
      if (inline > 0) fail(`选项 --${name} 是开关，不带值`);
      if (!spec.flags.has(name)) fail(`选项 --${name} 不适用于 ${command}`);
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name) && !takesValue) {
      fail(`未知选项：--${name}`);
    }
    if (!spec.flags.has(name)) fail(`选项 --${name} 不适用于 ${command}`);
    const value = inline > 0 ? arg.slice(inline + 1) : args[++i];
    if (value === undefined || value === '' || value.startsWith('--')) {
      fail(`选项 --${name} 缺少值`);
    }
    flags[name] = value;
  }
  if (spec.positional !== null && positional.length !== spec.positional) {
    fail(positionalProblem(command, spec.positional, positional.length));
  }
  if (command === 'add') return { command, target: positional[0], flags };
  if (command === 'move') return { command, id: positional[0], target: positional[1], flags };
  if (command === 'rename') return { command, id: positional[0], newId: positional[1], flags };
  if (command === 'remove') return { command, id: positional[0], flags };
  if (['build', 'render', 'check', 'comments', 'show', 'prune', 'migrate'].includes(command)) return { command, target: positional[0], flags };
  if (command === 'new') {
    if (!NEW_KINDS.includes(positional[0])) fail(`new 的第一个参数是 ${NEW_KINDS.join(' 或 ')}，收到：${positional[0]}`);
    return { command, kind: positional[0], target: positional[1], flags };
  }
  if (command === 'open') {
    if (positional.length < 1 || positional.length > 2) fail(positional.length ? `open 最多两个参数（目标和一个引用），收到 ${positional.length} 个` : 'open 需要一个目标（<project> 或 <project>/<article>）');
    return { command, target: positional[0], ref: positional[1] || null, flags };
  }
  if (command === 'dev') {
    if (!flags.sandbox) fail('dev 只有隔离模式：ppnt dev --sandbox [<目录>]（常驻服务用 ppnt start）');
    if (positional.length > 1) fail(`dev --sandbox 最多一个目录，收到 ${positional.length} 个`);
    return { command, dir: positional[0] || null, flags };
  }
  if (command === 'locate' || command === 'shot') {
    // shot --figure <图 id> 只要目标（第一个参数或 --page），不要引用；缺目标由 runShot 报并列候选。
    if (!positional.length && !flags.page && !(command === 'shot' && flags.figure)) fail(`${command} 至少要一个目标或引用（<project>/<article>、#n、B3、§2、帧 id …）`);
    return { command, refs: positional, flags };
  }
  if (command === 'reply') {
    // ppnt reply <目标> '#3' "<回复>"：第一个参数不带 # 也不是 @a: 时是目标，第二个是引用。
    if (positional.length >= 3 && !positional[0].includes('#') && !positional[0].startsWith('@')) {
      return { command, target: positional[0], refs: [positional[1]], text: positional.slice(2).join(' '), flags };
    }
    if (positional.length < 2) fail('reply 需要引用与回复内容：ppnt reply <project>/<article>#<n> "<回复>"');
    return { command, refs: [positional[0]], text: positional.slice(1).join(' '), flags };
  }
  if (command === 'mark') {
    if (positional.length < 2) fail('mark 需要目标、引用与状态：ppnt mark <project>/<article> <引用…> done|check');
    return { command, refs: positional.slice(0, -1), statusWord: positional[positional.length - 1], flags };
  }
  return { command, flags };
}

function positionalProblem(command, want, got) {
  if (command === 'add') {
    return got === 0 ? 'add 需要一个目标（目录 / 文件 / URL）' : `add 只接受一个目标，收到 ${got} 个`;
  }
  if (command === 'move') {
    return got < 2
      ? 'move 需要两个参数：<id> <新目录|新文件>'
      : `move 只接受两个参数，收到 ${got} 个`;
  }
  if (command === 'rename') {
    return got < 2
      ? 'rename 需要两个参数：<旧 id> <新 id>'
      : `rename 只接受两个参数，收到 ${got} 个`;
  }
  if (command === 'remove') {
    return got === 0 ? 'remove 需要一个条目 id' : `remove 只接受一个条目 id，收到 ${got} 个`;
  }
  if (command === 'build') {
    return got === 0 ? 'build 需要一个目标（<project>/<article> 或存量页 id）' : `build 只接受一个目标，收到 ${got} 个`;
  }
  if (command === 'render') {
    return got === 0 ? 'render 需要一帧（<目标>/<帧 id>）' : `render 只接受一帧，收到 ${got} 个`;
  }
  if (command === 'check' || command === 'show' || command === 'comments') {
    return got === 0 ? `${command} 需要一个目标（<project> 或 <project>/<article>）` : `${command} 只接受一个目标，收到 ${got} 个`;
  }
  if (command === 'migrate') {
    return got === 0 ? 'migrate 需要一个存量页 id' : `migrate 只接受一个存量页，收到 ${got} 个`;
  }
  if (command === 'new') {
    return got < 2 ? 'new 需要两个参数：ppnt new project <目录> 或 ppnt new article <project>/<article>' : `new 只接受两个参数，收到 ${got} 个`;
  }
  if (command === 'prune') {
    return got === 0 ? 'prune 需要一个目标（<project>/<article>、页 id 或桶名）' : `prune 只接受一个目标，收到 ${got} 个`;
  }
  return `${command} 不接受位置参数，收到 ${got} 个`;
}

/** 用法错的统一出口：一行错误 + 这个命令的用法行 + 去哪看选项。退出码 2。 */
export function reportUsageError(command, message, err) {
  err(`错误：${message}`);
  if (HELP[command]) {
    err(`用法：${HELP[command].usage}`);
    err(`选项与例子：ppnt ${command} --help`);
  } else {
    err('命令一览：ppnt --help');
  }
  return USAGE_EXIT;
}

/** 用法错（参数形状、未知选项、缺目标）的退出码；运行时失败是 1。 */
export const USAGE_EXIT = 2;

export function guardParse(argv, io) {
  const { out, err } = ioOf(io);
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      out(helpFor(parsed.command));
      return { help: true };
    }
    return parsed;
  } catch (error) {
    return reportUsageError(error.command || argv[0], error.message, err);
  }
}
