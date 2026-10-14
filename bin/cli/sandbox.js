/**
 * `ppnt dev --sandbox [<目录>]`：一条命令起一个隔离服务（docs/registry.md“隔离运行”）。
 *
 * 数据目录、登记表、端口、文章站点端口都和 owner 的常驻服务分开：
 *   - 起法是 `npm run dev:app`（直接起 vite），不经 portless，不注册 pinpoint.localhost；
 *   - 不接受 owner 的端口（OWNER_PORTS）和 ~/.pinpoint；
 *   - 端口缺省从 6400 起找一对空的（服务端口和它 + 5 的站点端口）。
 * 就绪后打印要 export 的变量并写进 <目录>/env.sh，然后前台常驻；收到 SIGINT / SIGTERM / SIGHUP
 * 时给服务的进程组发 SIGTERM（vite 收到后会停掉它拉起的站点进程组），等它退出再退。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_ORIGIN, REPO_ROOT, ioOf, requestJson } from './core.js';
import { guardParse, reportUsageError } from './args.js';

/** owner 的常驻服务占的端口：portless 给 pinpoint 的 4134、文章站点 4530、dev:direct 的 5199。 */
export const OWNER_PORTS = Object.freeze([4134, 4530, 5199]);
const AUTO_START = 6400;
const AUTO_END = 6499;
const SITE_OFFSET = 5;

/** 端口在 127.0.0.1 上能不能 listen。 */
export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * 选端口 → { port, sitePort } 或 { error }。isFree 可注入（测试）。
 * 写了 --port / --site-port 就只验它们；没写就从 AUTO_START 起找一对空的。
 */
export async function pickSandboxPorts({ port = null, sitePort = null, isFree = portFree } = {}) {
  const wanted = port === null ? null : validPort(port);
  if (port !== null && !wanted) return { error: `--port 要一个端口号，收到：${port}` };
  const wantedSite = sitePort === null ? null : validPort(sitePort);
  if (sitePort !== null && !wantedSite) return { error: `--site-port 要一个端口号，收到：${sitePort}` };
  for (const value of [wanted, wantedSite]) {
    if (value && OWNER_PORTS.includes(value)) return { error: `端口 ${value} 是 owner 的常驻服务在用的（${OWNER_PORTS.join('、')} 都不接受），换一个` };
  }
  if (wanted) {
    const site = wantedSite || wanted + SITE_OFFSET;
    if (site === wanted) return { error: '服务端口和站点端口不能相同' };
    if (OWNER_PORTS.includes(site)) return { error: `站点端口 ${site} 是 owner 在用的，用 --site-port 换一个` };
    if (!(await isFree(wanted))) return { error: `端口 ${wanted} 已经被占了` };
    if (!(await isFree(site))) return { error: `站点端口 ${site} 已经被占了（这个端口上有服务在答时 pinpoint 会直接拿来用），用 --site-port 换一个` };
    return { port: wanted, sitePort: site };
  }
  for (let candidate = AUTO_START; candidate <= AUTO_END; candidate += 1) {
    const site = wantedSite || candidate + SITE_OFFSET;
    if (site === candidate || OWNER_PORTS.includes(candidate) || OWNER_PORTS.includes(site)) continue;
    if ((await isFree(candidate)) && (await isFree(site))) return { port: candidate, sitePort: site };
  }
  return { error: `${AUTO_START}~${AUTO_END} 里找不到一对空端口，用 --port 指定` };
}

/** owner 的数据根：隔离运行绝不碰它。 */
export function ownerDataRoot(home = os.homedir()) {
  return path.join(home, '.pinpoint');
}

/** 目录是不是 owner 的数据根或在它里面。 */
export function insideOwnerData(dir, home = os.homedir()) {
  const root = ownerDataRoot(home);
  const rel = path.relative(root, path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 隔离服务和 CLI 共用的环境变量。 */
export function sandboxEnv({ dataDir, port, sitePort }) {
  return {
    PINPOINT_DATA_DIR: dataDir,
    PINPOINT_REGISTRY: path.join(dataDir, 'registry.json'),
    PINPOINT_ORIGIN: `http://127.0.0.1:${port}`,
    PORT: String(port),
    PINPOINT_SITE_PORT: String(sitePort),
  };
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/** <目录>/env.sh 的内容：CLI 要的三个变量。 */
export function envFileText(vars) {
  return ['PINPOINT_DATA_DIR', 'PINPOINT_REGISTRY', 'PINPOINT_ORIGIN']
    .map((name) => `export ${name}=${shellQuote(vars[name])}`)
    .join('\n') + '\n';
}

/** 起服务（bin 层可替换）：npm run dev:app，自己一个进程组，输出进日志文件。 */
function spawnSandbox({ env, cwd, logFile }) {
  const log = fs.openSync(logFile, 'a');
  fs.writeSync(log, `\n=== ${new Date().toISOString()} ppnt dev --sandbox (cwd ${cwd}) ===\n`);
  return spawn('npm', ['run', 'dev:app'], { cwd, detached: true, stdio: ['ignore', log, log], env });
}

async function waitHealthy(origin, { child, timeoutMs = 90_000, requestFn = requestJson, sleep }) {
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null && child.exitCode !== undefined) return false;
    try {
      const res = await requestFn(`${origin}/health`, { timeoutMs: 1500 });
      if (res.status === 200) return true;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) return false;
    await sleep(300);
  }
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* 已经退了 */ }
  }
}

export async function runDev(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { cwd, env, out, err } = ioOf(io);
  const sleep = io.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const home = io.home || os.homedir();
  let dataDir = parsed.dir ? path.resolve(cwd, parsed.dir) : null;
  if (dataDir && insideOwnerData(dataDir, home)) {
    return reportUsageError('dev', `${dataDir} 是 owner 的数据目录（~/.pinpoint）；隔离服务用别的目录，不写就新建一个临时目录`, err);
  }
  const ports = await pickSandboxPorts({ port: parsed.flags.port ?? null, sitePort: parsed.flags['site-port'] ?? null, isFree: io.portFree || portFree });
  if (ports.error) return reportUsageError('dev', ports.error, err);
  if (!dataDir) dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-sandbox-'));
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  const vars = sandboxEnv({ dataDir, ...ports });
  const envFile = path.join(dataDir, 'env.sh');
  fs.writeFileSync(envFile, envFileText(vars));
  const logFile = path.join(dataDir, 'logs', 'service.log');
  const childEnv = { ...env, ...vars };
  delete childEnv.PINPOINT_ORIGIN; // 服务自己不读它；留给 CLI
  const child = (io.spawnSandbox || spawnSandbox)({ env: childEnv, cwd: REPO_ROOT, logFile });
  let exited = false;
  const exitedPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  const stop = async () => {
    if (exited) return;
    (io.killGroup || killGroup)(child.pid, 'SIGTERM');
    const timer = setTimeout(() => { if (!exited) (io.killGroup || killGroup)(child.pid, 'SIGKILL'); }, 8000);
    await exitedPromise;
    clearTimeout(timer);
  };
  const onSignal = io.onSignal || ((handler) => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, handler);
  });
  let stopping = null;
  onSignal(() => {
    if (!stopping) stopping = stop();
  });
  const ready = await waitHealthy(vars.PINPOINT_ORIGIN, { child, sleep, requestFn: io.requestFn || requestJson, timeoutMs: io.readyTimeoutMs || 90_000 });
  if (!ready) {
    await stop();
    err(`错误：隔离服务没起来（${vars.PINPOINT_ORIGIN}/health 一直不答）；日志：${logFile}`);
    return 1;
  }
  const info = { dataDir, registry: vars.PINPOINT_REGISTRY, origin: vars.PINPOINT_ORIGIN, port: ports.port, sitePort: ports.sitePort, pid: child.pid, envFile, logFile };
  if (parsed.flags.json) {
    out(JSON.stringify(info));
  } else {
    out(`隔离服务已就绪：${info.origin}（文章站点端口 ${info.sitePort}，第一次读文章时拉起）`);
    out(`数据目录 ${dataDir} · 登记表 ${info.registry} · 日志 ${logFile}`);
    out('另一个终端里先执行这一行，之后的 ppnt 都对着这个服务：');
    out(`  source ${envFile}`);
    out(`停：在这里按 Ctrl-C，或 kill ${process.pid}（会连服务和文章站点一起停）`);
    out(`和 owner 的服务（${DEFAULT_ORIGIN}）无关，那边的数据和登记不受影响。`);
  }
  const result = await exitedPromise;
  if (stopping) await stopping;
  if (!stopping) err(`隔离服务退出了（${result.signal || `exit ${result.code}`}）；日志：${logFile}`);
  return stopping ? 0 : 1;
}
