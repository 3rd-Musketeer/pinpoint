/**
 * 文章站点开发服务器（Astro）的进程生命周期，归 pinpoint 服务管：
 *
 * - 按需拉起：第一次有文章请求时 ensure() 才 spawn，服务启动时不起。
 * - 就绪判定：轮询 GET http://127.0.0.1:<port>/_astro/@vite/client，有 HTTP 应答就算
 *   就绪；不是 200 说明站点的 vite 没用 /_astro/ 做 base（site/astro.config 没读
 *   PINPOINT_SITE_VITE_BASE），记一条 warning，status 里能看到。
 * - 死了就重启：就绪过的进程退出后按 0.5s、1s、2s… 退避重启（上限 5s）；60s 内退出
 *   5 次，或者连续 2 次没就绪就退出，进 failed，不再自动拉。failed 之后的请求
 *   距上次失败超过 5s 才重试一次，避免自动刷新的错误页把进程拉成死循环。
 * - 跟服务一起停：stop() 给整个进程组发 SIGTERM（npm → astro 两层），3s 没退
 *   再 SIGKILL；stopSync() 给 process 'exit' 兜底。子进程是 detached（自己一个
 *   进程组），服务被信号杀掉时不会连带它，'exit' 也不触发（Node 对 SIGTERM 的缺省
 *   处理是直接退出），所以 stopOnSignals() 在 SIGTERM / SIGINT / SIGHUP 时先同步
 *   停站点，再照原样把信号交还给进程（2026-10-13：e2e 结束后站点留成孤儿，下一轮
 *   把它当 external 用）。
 * - 端口上已经有服务在答（owner 自己跑着 npm run site:dev）：不再 spawn，直接
 *   用它，snapshot 里 external: true。
 *
 * 命令默认 `npm run -s site:dev -- --port {port} --host 127.0.0.1 --ignore-lock`，
 * PINPOINT_SITE_CMD 覆盖（shell 命令，{port} 会被替换）。--ignore-lock 让 Astro 7
 * 在前台跑：它检测到 agent 环境时会自己转后台、立刻退出，服务就管不住它了。
 * 端口默认 4530，PINPOINT_SITE_PORT 覆盖。日志追加写到 <数据根>/logs/site-dev.log。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { ASTRO_DEV_BASE } from './article-routes.js';

const DEFAULT_SITE_PORT = 4530;
export const DEFAULT_SITE_COMMAND = 'npm run -s site:dev -- --port {port} --host 127.0.0.1 --ignore-lock';

const RESTART_WINDOW_MS = 60_000;
const RESTART_LIMIT = 5;
const EARLY_EXIT_LIMIT = 2;
const FAILED_RETRY_COOLDOWN_MS = 5_000;
const STOP_GRACE_MS = 3_000;

export function siteDevConfig(env = process.env) {
  const port = Number(env.PINPOINT_SITE_PORT) || DEFAULT_SITE_PORT;
  const template = env.PINPOINT_SITE_CMD || DEFAULT_SITE_COMMAND;
  return { port, command: template.replaceAll('{port}', String(port)) };
}

/** 一次 HTTP 探测：有应答返回 { status }，连不上返回 null。 */
export function probeHttp(port, pathname, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ status: res.statusCode || 0 });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

function tailLines(file, count) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').filter(Boolean).slice(-count);
  } catch {
    return [];
  }
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export const SHUTDOWN_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT', 'SIGHUP']);

/**
 * 服务收到 SIGTERM / SIGINT / SIGHUP 时先 devServer.stopSync()（给站点进程组发
 * SIGTERM），再交还信号：别的监听者（比如 vite 自己的 SIGTERM 收尾）还在就让它们
 * 处理；没有了就按缺省行为用同一个信号结束自己。返回撤销函数。proc 供测试替换。
 */
export function stopOnSignals(devServer, proc = process) {
  const handlers = SHUTDOWN_SIGNALS.map((signal) => {
    const handler = () => {
      devServer.stopSync();
      if (proc.listenerCount(signal) === 0) proc.kill(proc.pid, signal);
    };
    proc.once(signal, handler);
    return [signal, handler];
  });
  return () => { for (const [signal, handler] of handlers) proc.off(signal, handler); };
}

/** 脱离的看门进程：delayMs 后进程组还在就 SIGKILL（发起方退出了也照样执行）。 */
function killGroupLater(pid, delayMs) {
  const script = `setTimeout(()=>{try{process.kill(-${Number(pid)},'SIGKILL')}catch{}},${Number(delayMs)})`;
  try {
    spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 起不了看门进程：只剩 SIGTERM */ }
}

/**
 * options:
 *   cwd            spawn 的工作目录（仓库根）
 *   port, command  缺省取 siteDevConfig(env)
 *   env            传给子进程的环境（缺省 process.env），会补上 PINPOINT_SITE_PORT /
 *                  PINPOINT_SITE_VITE_BASE
 *   logFile        子进程 stdout/stderr 追加到这里
 *   readyTimeoutMs 拉起后多久没就绪算失败（缺省 90s）
 *   pollMs         就绪轮询间隔（缺省 200ms）
 *   log            服务日志输出（缺省 console.error）
 */
export function createSiteDevServer(options = {}) {
  const env = options.env || process.env;
  const config = siteDevConfig(env);
  const port = options.port || config.port;
  const command = options.command || config.command;
  const cwd = options.cwd || process.cwd();
  const logFile = options.logFile || null;
  const readyTimeoutMs = options.readyTimeoutMs || 90_000;
  const pollMs = options.pollMs || 200;
  const log = options.log || ((message) => console.error(`[site-dev] ${message}`));

  let state = 'idle';
  let child = null;
  let external = false;
  let startedAt = null;
  let readyAt = null;
  let restarts = 0;
  let lastExit = null;
  let lastError = null;
  let warning = null;
  let failedAt = 0;
  let earlyExits = 0;
  let exitTimes = [];
  let restartTimer = null;
  let readyWaiters = [];
  let generation = 0;

  function settleWaiters() {
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const resolve of waiters) resolve(snapshot());
  }

  function setState(next) {
    state = next;
    if (next !== 'starting' && next !== 'restarting') settleWaiters();
  }

  function snapshot() {
    return {
      state,
      port,
      pid: child ? child.pid : null,
      external,
      command,
      cwd,
      logFile,
      startedAt,
      readyAt,
      restarts,
      lastExit,
      lastError,
      warning,
    };
  }

  function fail(message) {
    lastError = message;
    failedAt = Date.now();
    log(`failed: ${message}`);
    setState('failed');
  }

  async function checkBase() {
    const res = await probeHttp(port, `${ASTRO_DEV_BASE}@vite/client`);
    warning = res && res.status === 200
      ? null
      : `站点的 vite 没有以 ${ASTRO_DEV_BASE} 为 base（GET ${ASTRO_DEV_BASE}@vite/client → ${res ? res.status : '无应答'}）；site/astro.config 要读 PINPOINT_SITE_VITE_BASE`;
    if (warning) log(warning);
  }

  async function waitReady(gen) {
    const deadline = Date.now() + readyTimeoutMs;
    while (gen === generation && state === 'starting') {
      const res = await probeHttp(port, `${ASTRO_DEV_BASE}@vite/client`);
      if (gen !== generation || state !== 'starting') return;
      if (res) {
        await checkBase();
        if (gen !== generation || state !== 'starting') return;
        readyAt = Date.now();
        earlyExits = 0;
        log(`ready on 127.0.0.1:${port}${child ? ` (pid ${child.pid})` : ''}`);
        setState('ready');
        return;
      }
      if (Date.now() > deadline) {
        const pid = child && child.pid;
        fail(`${Math.round(readyTimeoutMs / 1000)}s 内没有就绪`);
        if (pid) killGroup(pid, 'SIGKILL');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  function openLog() {
    if (!logFile) return 'ignore';
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, 'a');
    fs.writeSync(fd, `--- ${new Date().toISOString()} spawn (port ${port}): ${command}\n`);
    return fd;
  }

  function spawnChild() {
    const gen = ++generation;
    const out = openLog();
    let proc;
    try {
      proc = spawn(command, {
        cwd,
        shell: true,
        detached: true,
        stdio: ['ignore', out, out],
        env: {
          ...env,
          PINPOINT_SITE_PORT: String(port),
          PINPOINT_SITE_VITE_BASE: ASTRO_DEV_BASE,
          BROWSER: 'none',
        },
      });
    } catch (error) {
      if (typeof out === 'number') fs.closeSync(out);
      fail(`spawn 失败：${error.message}`);
      return;
    }
    if (typeof out === 'number') fs.closeSync(out);
    child = proc;
    startedAt = Date.now();
    readyAt = null;
    setState('starting');
    log(`spawned pid ${proc.pid}: ${command}`);
    proc.on('error', (error) => {
      lastError = `spawn 失败：${error.message}`;
    });
    proc.on('exit', (code, signal) => onExit(proc, gen, code, signal));
    waitReady(gen);
  }

  function onExit(proc, gen, code, signal) {
    if (child !== proc) return;
    child = null;
    const wasReady = state === 'ready';
    lastExit = { code, signal, at: Date.now() };
    if (state === 'stopped') return;
    if (state === 'failed') return;
    generation++;
    log(`pid ${proc.pid} exited (code ${code}, signal ${signal})`);
    const now = Date.now();
    exitTimes = exitTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    exitTimes.push(now);
    if (!wasReady) earlyExits++;
    if (earlyExits >= EARLY_EXIT_LIMIT) {
      fail(`连续 ${earlyExits} 次没就绪就退出（最后一次 code ${code}, signal ${signal}）`);
      return;
    }
    if (exitTimes.length >= RESTART_LIMIT) {
      fail(`${RESTART_WINDOW_MS / 1000}s 内退出 ${exitTimes.length} 次`);
      return;
    }
    const delay = Math.min(500 * 2 ** (exitTimes.length - 1), 5000);
    setState('restarting');
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (state !== 'restarting') return;
      restarts++;
      spawnChild();
    }, delay);
  }

  async function start() {
    external = false;
    // 端口上已经有人在答：用它，不再 spawn（owner 手动跑着站点的情形）。
    const res = await probeHttp(port, `${ASTRO_DEV_BASE}@vite/client`, 500);
    if (state !== 'starting') return;
    if (res) {
      external = true;
      await checkBase();
      readyAt = Date.now();
      log(`port ${port} already answering; using the running server`);
      setState('ready');
      return;
    }
    spawnChild();
  }

  /**
   * 确保站点在起或正在起。返回当前 snapshot（不等就绪）；要等就用 whenReady()。
   */
  function ensure() {
    if (state === 'ready' || state === 'starting' || state === 'restarting') return snapshot();
    if (state === 'failed' && Date.now() - failedAt < FAILED_RETRY_COOLDOWN_MS) return snapshot();
    if (state === 'failed') {
      earlyExits = 0;
      exitTimes = [];
    }
    lastError = state === 'failed' ? lastError : null;
    startedAt = Date.now();
    setState('starting');
    start();
    return snapshot();
  }

  /** 等到 ready / failed / stopped 之一。 */
  function whenReady() {
    if (state !== 'starting' && state !== 'restarting') return Promise.resolve(snapshot());
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  /**
   * 代理连不上上游时调：外部服务器没了就回到 idle 等下一次 ensure()；
   * 自己的子进程如果还活着，说明它在重启自己的监听，回到 starting 重新探测。
   */
  function noteUnreachable() {
    if (state !== 'ready') return;
    if (external || !child) {
      external = false;
      setState('idle');
      return;
    }
    const gen = ++generation;
    setState('starting');
    waitReady(gen);
  }

  function stop() {
    generation++;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const proc = child;
    setState('stopped');
    if (!proc) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        killGroup(proc.pid, 'SIGKILL');
        resolve();
      }, STOP_GRACE_MS);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      if (!killGroup(proc.pid, 'SIGTERM')) {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /**
   * process 'exit' 和信号处理里只能做同步的事：给进程组发 SIGTERM，再留一个脱离的
   * 看门进程，STOP_GRACE_MS 后组还在就 SIGKILL。服务自己马上就退出了，等不到 stop()
   * 那样的升级；Astro 在重同步内容时收到 SIGTERM 可能迟迟不退（2026-10-13 e2e 实测
   * 留成孤儿）。
   */
  function stopSync() {
    if (restartTimer) clearTimeout(restartTimer);
    const proc = child;
    state = 'stopped';
    if (proc && killGroup(proc.pid, 'SIGTERM')) killGroupLater(proc.pid, STOP_GRACE_MS);
  }

  return {
    ensure,
    whenReady,
    noteUnreachable,
    snapshot,
    stop,
    stopSync,
    logTail: (count = 20) => (logFile ? tailLines(logFile, count) : []),
    port,
    command,
  };
}
