import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';

import { DEFAULT_ORIGIN, PORTLESS_HOSTNAME, REPO_ROOT, ioOf, displayWidth, padWide } from './core.js';
import { guardParse } from './args.js';
import { printPageStatus } from './list.js';

/** portless 路由表位置（PORTLESS_ROUTES 覆盖，给测试与非默认安装用）。 */
export function portlessRoutesPath(env = process.env) {
  return env.PORTLESS_ROUTES || path.join(os.homedir(), '.portless', 'routes.json');
}

/** routes.json 文本 → 规范化的 [{hostname, port, pid}]；坏文件当空表（status 另有一行说路由没有）。 */
export function parseRoutes(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(doc)) return [];
  return doc
    .filter((row) => row && typeof row.hostname === 'string' && Number.isFinite(Number(row.port)))
    .map((row) => ({ hostname: row.hostname, port: Number(row.port), pid: Number(row.pid) || 0 }));
}

export function pickRoute(routes, hostname = PORTLESS_HOSTNAME) {
  return routes.find((route) => route.hostname === hostname) || null;
}

function readRoutes(routesPath) {
  try {
    return parseRoutes(fs.readFileSync(routesPath, 'utf8'));
  } catch {
    return [];
  }
}

/** 服务日志目录（PINPOINT_DATA_DIR 跟着走，与标注数据同一个根）。 */
export function serviceLogPath(env = process.env) {
  return path.join(dataRoot(env), 'logs', 'service.log');
}

const STATE_LABEL = { ok: '正常', bad: '失败', warn: '注意', skip: '—' };

/**
 * 由采集到的事实判定服务状态（纯函数）。输入：
 *   repoRoot   CLI 所在仓库根
 *   routesPath portless 路由表路径（报错时打印）
 *   route      { hostname, port, pid } | null
 *   pidAlive   route.pid 是否还活着
 *   direct     { ok, status?, json?, error? } —— http://127.0.0.1:<port>/health（直连 vite）
 *   proxied    同上 —— https://pinpoint.localhost/health（穿 portless 代理）
 * 两条健康检查都做：2026-09-04 的故障恰恰是「vite 活着但听错端口、代理 502」，
 * 只查一条分不出「进程没了」和「进程在但配置错」。
 */
export function classifyStatus({ repoRoot, routesPath, route, pidAlive = false, direct = null, proxied = null }) {
  const rows = [];
  const health = (direct && direct.ok && direct.json) || (proxied && proxied.ok && proxied.json) || null;
  const serviceRoot = health && typeof health.root === 'string' ? health.root : null;

  rows.push(route
    ? { label: '路由', state: 'ok', detail: `${route.hostname} → 127.0.0.1:${route.port}` }
    : { label: '路由', state: 'bad', detail: `${routesPath} 里没有 ${PORTLESS_HOSTNAME}：服务没起过或已注销` });

  if (!route) rows.push({ label: '进程', state: 'skip', detail: '没有路由，无 pid 可查' });
  else if (!route.pid) rows.push({ label: '进程', state: 'bad', detail: 'routes.json 没记 pid' });
  else rows.push({ label: '进程', state: pidAlive ? 'ok' : 'bad', detail: `pid ${route.pid} ${pidAlive ? '在' : '已不在（进程死了）'}` });

  rows.push(probeRow('直连 /health', direct));
  rows.push(probeRow('代理 /health', proxied));

  if (!health) {
    rows.push({ label: '服务 root', state: 'skip', detail: '/health 不通，问不到' });
    rows.push({ label: 'registry', state: 'skip', detail: '/health 不通，问不到' });
  } else {
    if (!serviceRoot) {
      rows.push({ label: '服务 root', state: 'warn', detail: '/health 没有 root 字段（服务比本 CLI 旧，重启后可比对）' });
    } else if (serviceRoot === repoRoot) {
      rows.push({ label: '服务 root', state: 'ok', detail: serviceRoot });
    } else {
      rows.push({ label: '服务 root', state: 'bad', detail: `服务在 ${serviceRoot}；本 CLI 在 ${repoRoot}` });
    }
    const registry = health.registry || {};
    const errors = Array.isArray(registry.errors) ? registry.errors : [];
    const warnings = Array.isArray(registry.warnings) ? registry.warnings : [];
    const detail = `${registry.entries ?? 0} 条，${errors.length} error，${warnings.length} warning — ${registry.path || '路径未知'}`;
    rows.push({ label: 'registry', state: errors.length ? 'bad' : (warnings.length ? 'warn' : 'ok'), detail });
    for (const line of [...errors, ...warnings]) rows.push({ label: '', state: 'note', detail: line });
  }

  const bad = rows.filter((row) => row.state === 'bad');
  const ok = bad.length === 0;
  return {
    ok,
    rows,
    pid: route ? route.pid : 0,
    port: route ? route.port : 0,
    pidAlive: Boolean(route && route.pid && pidAlive),
    serviceRoot,
    diagnosis: diagnose({ ok, rows, route, pidAlive, direct, proxied, serviceRoot, repoRoot }),
  };
}

function probeRow(label, probe) {
  if (!probe) return { label, state: 'skip', detail: '没有路由端口，没打' };
  if (probe.ok) return { label, state: 'ok', detail: `${probe.url} 200` };
  const why = probe.error ? probe.error : `HTTP ${probe.status}`;
  return { label, state: 'bad', detail: `${probe.url} ${why}` };
}

function diagnose({ ok, rows, route, pidAlive, direct, proxied, serviceRoot, repoRoot }) {
  if (ok) {
    return rows.some((row) => row.state === 'warn')
      ? '服务在跑，但有告警（见上）。'
      : '服务正常。';
  }
  if (!route) return '服务没在跑：portless 里没有这个 app 的路由。跑 `pinpoint start`。';
  if (!route.pid || !pidAlive) return '路由还在、进程没了（2026-08-17 形态：页面 404）。跑 `pinpoint restart`。';
  if (direct && !direct.ok) {
    return '进程活着但直连 /health 不通（2026-09-04 形态：vite 抱着旧绝对路径跑裸默认配置，端口/插件全落回默认）。跑 `pinpoint restart`。';
  }
  if (proxied && !proxied.ok) {
    return 'vite 在听自己的端口，但穿代理打不通：portless proxy daemon 或路由端口不对（proxy daemon 不归 pinpoint 管，自己看 `portless proxy`）。';
  }
  if (serviceRoot && serviceRoot !== repoRoot) {
    return `服务跑的是另一个目录（${serviceRoot}），不是本 CLI 所在的仓库（${repoRoot}）。要让服务改跑这里，在这里 \`pinpoint restart\`。`;
  }
  return 'registry 有 error，服务在按回落表跑（见上）。';
}

/** 状态表（一屏）。 */
export function formatStatus(report) {
  const labelWidth = Math.max(...report.rows.map((row) => displayWidth(row.label)), 10);
  const lines = report.rows.map((row) => (row.state === 'note'
    ? `  ${' '.repeat(labelWidth)}      · ${row.detail}`
    : `  ${padWide(row.label, labelWidth)}  ${padWide(STATE_LABEL[row.state], 4)}  ${row.detail}`));
  lines.push(`  → ${report.diagnosis}`);
  return lines;
}

/** start 的判定：健康就拒绝；进程还在但不健康也拒绝（同名 portless 注册会打架，走 restart）。 */
export function decideStart(report) {
  if (report.ok) return { action: 'refuse', reason: '服务已经在跑且健康；要重来用 `pinpoint restart`。' };
  if (report.pidAlive) {
    return { action: 'refuse', reason: `服务进程还在（pid ${report.pid}）但不健康；先 \`pinpoint stop\`，或直接 \`pinpoint restart\`。` };
  }
  return { action: 'start' };
}

/** stop 的判定：没有活进程就是幂等的 no-op。 */
export function decideStop(report) {
  if (!report.pid) return { action: 'none', reason: '没有在跑的 pinpoint 服务（portless 路由里没有 pid）。' };
  if (!report.pidAlive) return { action: 'none', reason: `路由记的 pid ${report.pid} 已不在；没有要停的进程。` };
  return { action: 'kill', pid: report.pid };
}

/** 采集一次现状（读 routes.json + 两条 /health），交给 classifyStatus 判定。 */
export async function collectStatus(io = {}) {
  const { env, requestFn } = ioOf(io);
  const pidAliveFn = io.pidAlive || (() => false);
  const routesPath = portlessRoutesPath(env);
  const route = pickRoute(readRoutes(routesPath));
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  const direct = route ? await probe(`http://127.0.0.1:${route.port}/health`, requestFn) : null;
  const proxied = await probe(`${origin}/health`, requestFn);
  return classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath,
    route,
    pidAlive: route && route.pid ? Boolean(pidAliveFn(route.pid)) : false,
    direct,
    proxied,
  });
}

async function probe(url, requestFn) {
  try {
    const res = await requestFn(url, { timeoutMs: 2000 });
    return { url, ok: res.status === 200 && Boolean(res.json), status: res.status, json: res.json };
  } catch (error) {
    return { url, ok: false, error: error.message };
  }
}

export async function runStatus(argv, io = {}) {
  const { env, out } = ioOf(io);
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  if (parsed.flags.page) return printPageStatus(parsed, { env, out, err: ioOf(io).err });
  const report = await collectStatus(io);
  out('pinpoint status');
  for (const line of formatStatus(report)) out(line);
  return report.ok ? 0 : 1;
}

export async function runStop(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  return stopService(io);
}

/** SIGTERM → 有界等待退出 → 复核路由/进程。返回退出码。 */
async function stopService(io) {
  const { env, out, err } = ioOf(io);
  const pidAlive = io.pidAlive || (() => false);
  const killPid = io.killPid;
  const sleep = io.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const report = await collectStatus(io);
  const decision = decideStop(report);
  if (decision.action === 'none') {
    out(decision.reason);
    return 0;
  }
  if (!killPid) throw new Error('runStop 需要 io.killPid');
  out(`停 pid ${decision.pid}（SIGTERM）…`);
  try {
    killPid(decision.pid, 'SIGTERM');
  } catch (error) {
    err(`发信号失败：${error.message}`);
    return 1;
  }
  const deadline = 8000;
  for (let waited = 0; waited < deadline; waited += 250) {
    await sleep(250);
    if (!pidAlive(decision.pid)) break;
  }
  // 复核：路由消失（portless 注销）或 pid 已死，两者任一即算停住。
  const route = pickRoute(readRoutes(portlessRoutesPath(env)));
  const gone = !route || route.pid !== decision.pid || !pidAlive(decision.pid);
  if (!gone) {
    err(`pid ${decision.pid} 在 ${deadline / 1000}s 内没退出；手动查 \`ps -p ${decision.pid}\` 再决定要不要 SIGKILL。`);
    return 1;
  }
  out('已停。');
  return 0;
}

export async function runStart(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  return startService(io);
}

/** spawn → 轮询健康（~20s）→ 打状态表。返回退出码。 */
async function startService(io) {
  const { env, out, err } = ioOf(io);
  const sleep = io.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const before = await collectStatus(io);
  const decision = decideStart(before);
  if (decision.action === 'refuse') {
    err(decision.reason);
    for (const line of formatStatus(before)) err(line);
    return 1;
  }
  if (!io.spawnService) throw new Error('runStart 需要 io.spawnService');
  const logFile = serviceLogPath(env);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const child = io.spawnService({ cwd: REPO_ROOT, logFile });
  out(`已在 ${REPO_ROOT} 启动 \`npm run dev\`（pid ${child && child.pid}），日志：${logFile}`);
  let report = before;
  for (let waited = 0; waited < 20000; waited += 1000) {
    await sleep(1000);
    report = await collectStatus(io);
    if (report.ok) break;
  }
  out('pinpoint status');
  for (const line of formatStatus(report)) out(line);
  if (!report.ok) err(`20s 内没起来；看日志：tail -n 40 ${logFile}`);
  return report.ok ? 0 : 1;
}

export async function runRestart(argv, io = {}) {
  const { out } = ioOf(io);
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const stopped = await stopService(io);
  if (stopped !== 0) return stopped;
  out('');
  return startService(io);
}

/* ---- pp2：build / render（编译面，进程内直接编译，不依赖服务） ---- */
