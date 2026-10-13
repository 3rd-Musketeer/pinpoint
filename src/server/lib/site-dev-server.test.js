import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { createSiteDevServer, DEFAULT_SITE_COMMAND, probeHttp, SHUTDOWN_SIGNALS, siteDevConfig, stopOnSignals } from './site-dev-server.js';

const STUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'site-dev-stub.mjs');
const HOST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'site-dev-host.mjs');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(fn, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('until: timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function tmpLog(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-dev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'logs', 'site-dev.log');
}

test('siteDevConfig：端口缺省 4530，PINPOINT_SITE_PORT / PINPOINT_SITE_CMD 覆盖，{port} 被替换', () => {
  assert.deepEqual(siteDevConfig({}), { port: 4530, command: DEFAULT_SITE_COMMAND.replaceAll('{port}', '4530') });
  assert.match(DEFAULT_SITE_COMMAND, /--ignore-lock/);
  assert.deepEqual(siteDevConfig({ PINPOINT_SITE_PORT: '4999', PINPOINT_SITE_CMD: 'node s.mjs --port {port}' }),
    { port: 4999, command: 'node s.mjs --port 4999' });
});

test('按需拉起：ensure 前不起进程；起来后探测就绪；子进程死了自动重启；stop 停掉', async (t) => {
  const port = await freePort();
  const logFile = tmpLog(t);
  const dev = createSiteDevServer({
    port,
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(STUB)} --port ${port}`,
    env: { ...process.env, STUB_READY_DELAY_MS: '300' },
    logFile,
    log: () => {},
  });
  t.after(() => dev.stop());

  assert.equal(dev.snapshot().state, 'idle');
  assert.equal(await probeHttp(port, '/_astro/@vite/client'), null);

  assert.equal(dev.ensure().state, 'starting');
  const ready = await dev.whenReady();
  assert.equal(ready.state, 'ready');
  assert.equal(ready.warning, null);
  assert.equal(ready.external, false);
  const firstPid = ready.pid;
  assert.ok(pidAlive(firstPid));
  assert.match(fs.readFileSync(logFile, 'utf8'), /spawn \(port \d+\)/);

  // 子进程（整个进程组）被杀 → 退避重启，pid 换新，重启计数 +1。
  process.kill(-firstPid, 'SIGKILL');
  const again = await until(async () => {
    const snap = dev.snapshot();
    return snap.state === 'ready' && snap.pid !== firstPid ? snap : null;
  });
  assert.equal(again.restarts, 1);

  await dev.stop();
  assert.equal(dev.snapshot().state, 'stopped');
  await until(() => !pidAlive(again.pid));
  assert.equal(await probeHttp(port, '/_astro/@vite/client'), null);
});

test('起不来：连续两次没就绪就退出 → failed，带原因；冷却期内 ensure 不再拉', async (t) => {
  const port = await freePort();
  const dev = createSiteDevServer({
    port,
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(STUB)} --port ${port}`,
    env: { ...process.env, STUB_EXIT_CODE: '3' },
    logFile: tmpLog(t),
    log: () => {},
  });
  t.after(() => dev.stop());
  dev.ensure();
  const snap = await until(() => (dev.snapshot().state === 'failed' ? dev.snapshot() : null));
  assert.match(snap.lastError, /连续 2 次没就绪就退出（最后一次 code 3/);
  assert.equal(snap.lastExit.code, 3);
  assert.equal(dev.ensure().state, 'failed');
});

test('端口上已有服务在答：直接用它（external），vite base 不对时记 warning', async (t) => {
  const port = await freePort();
  const { spawn } = await import('node:child_process');
  const outside = spawn(process.execPath, [STUB, '--port', String(port)], {
    env: { ...process.env, PINPOINT_SITE_VITE_BASE: '/' },
    stdio: 'ignore',
  });
  t.after(() => outside.kill('SIGKILL'));
  await until(() => probeHttp(port, '/'));
  const dev = createSiteDevServer({ port, command: 'false', logFile: tmpLog(t), log: () => {} });
  t.after(() => dev.stop());
  dev.ensure();
  const snap = await dev.whenReady();
  assert.equal(snap.state, 'ready');
  assert.equal(snap.external, true);
  assert.equal(snap.pid, null);
  assert.match(snap.warning, /没有以 \/_astro\/ 为 base（GET \/_astro\/@vite\/client → 404）/);
  // 外部进程没了：代理报连不上 → 回到 idle，下一次 ensure 重新判定。
  outside.kill('SIGKILL');
  await until(async () => !(await probeHttp(port, '/')));
  dev.noteUnreachable();
  assert.equal(dev.snapshot().state, 'idle');
  assert.equal(dev.snapshot().external, false);
});

// 2026-10-13：服务被 SIGTERM 杀掉时，detached 的站点进程组留成孤儿，下一轮 e2e 把它当 external。
for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`服务收到 ${signal}：站点进程组跟着停，服务按同一个信号退出`, async (t) => {
    const port = await freePort();
    const host = spawn(process.execPath, [HOST, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(() => { try { host.kill('SIGKILL'); } catch { /* gone */ } });
    let out = '';
    host.stdout.on('data', (chunk) => { out += chunk; });
    const ready = JSON.parse(await until(() => (out.includes('\n') ? out.split('\n')[0] : null)));
    assert.equal(ready.state, 'ready');
    assert.ok(pidAlive(ready.pid));
    t.after(() => { try { process.kill(-ready.pid, 'SIGKILL'); } catch { /* gone */ } });
    const exited = new Promise((resolve) => host.once('exit', (code, sig) => resolve({ code, sig })));
    host.kill(signal);
    assert.deepEqual(await exited, { code: null, sig: signal });
    await until(() => !pidAlive(ready.pid));
    await until(async () => (await probeHttp(port, '/_astro/@vite/client')) === null);
  });
}

test('stopOnSignals：别的监听者还在就把信号留给它们；撤销后不再响应', () => {
  const calls = [];
  const fake = new (class extends EventEmitter {
    pid = 4242;
    kill(pid, signal) { calls.push(['kill', pid, signal]); }
  })();
  const dev = { stopSync: () => calls.push(['stopSync']) };
  const off = stopOnSignals(dev, fake);
  for (const signal of SHUTDOWN_SIGNALS) assert.equal(fake.listenerCount(signal), 1);
  fake.on('SIGTERM', () => calls.push(['vite']));
  fake.emit('SIGTERM');
  assert.deepEqual(calls, [['stopSync'], ['vite']]); // vite 自己收尾，不再重发
  calls.length = 0;
  fake.emit('SIGHUP');
  assert.deepEqual(calls, [['stopSync'], ['kill', 4242, 'SIGHUP']]); // 没有别人：按缺省行为退出
  off();
  assert.equal(fake.listenerCount('SIGINT'), 0);
});
