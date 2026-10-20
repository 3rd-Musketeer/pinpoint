import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// env.js reads process.env at import time, so a fresh view means a fresh
// module instance. The query string busts the ESM cache.
let seq = 0;
async function loadEnv(port) {
  const previous = { ...process.env };
  delete process.env.E2E_SITE_PORT;
  if (port === undefined) delete process.env.E2E_PORT;
  else process.env.E2E_PORT = String(port);
  try {
    seq += 1;
    return await import(`./env.js?probe=${seq}`);
  } finally {
    for (const key of ['E2E_PORT', 'E2E_SITE_PORT']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('一个端口一套固件：两轮并发跑在不同 tmpdir 与不同站点端口', async () => {
  const a = await loadEnv(5399);
  const b = await loadEnv(5499);

  assert.notEqual(a.E2E_DATA_DIR, b.E2E_DATA_DIR);
  assert.notEqual(a.E2E_REGISTRY, b.E2E_REGISTRY);
  assert.notEqual(a.E2E_SITE_PORT, b.E2E_SITE_PORT);
  assert.notEqual(a.E2E_BASE_URL, b.E2E_BASE_URL);

  // 一套固件整块挂在自己的目录下：删掉这个目录就清干净了。
  for (const env of [a, b]) {
    assert.equal(path.dirname(env.E2E_DATA_DIR), env.E2E_FIXTURE_DIR);
    assert.equal(path.dirname(env.E2E_REGISTRY), env.E2E_FIXTURE_DIR);
    assert.equal(path.dirname(env.E2E_FIXTURE_DIR), os.tmpdir());
  }
});

test('同一个端口推导出同一套路径（四个进程各加载一次也要对得上）', async () => {
  const first = await loadEnv(5399);
  const second = await loadEnv(5399);

  assert.equal(first.E2E_FIXTURE_DIR, second.E2E_FIXTURE_DIR);
  assert.equal(first.E2E_DATA_DIR, second.E2E_DATA_DIR);
  assert.equal(first.E2E_REGISTRY, second.E2E_REGISTRY);
  assert.equal(first.E2E_SITE_PORT, second.E2E_SITE_PORT);
});

test('仓内产物目录：默认端口不带后缀，显式端口分家', async () => {
  const fallback = await loadEnv(undefined);
  assert.equal(fallback.E2E_RUN_SLOT, '');

  const a = await loadEnv(5399);
  const b = await loadEnv(5499);
  assert.equal(a.E2E_RUN_SLOT, '5399');
  assert.notEqual(a.E2E_RUN_SLOT, b.E2E_RUN_SLOT);
});

test('默认端口 5299，站点端口跟着主端口走', async () => {
  const fallback = await loadEnv(undefined);
  assert.equal(fallback.E2E_PORT, 5299);
  assert.equal(fallback.E2E_SITE_PORT, 5304);

  const shifted = await loadEnv(5399);
  assert.equal(shifted.E2E_SITE_PORT, 5404);
});

// playwright.config.js 经它自己 import 的 env.js 读 E2E_PORT，模块缓存绕不开，每个端口起一个子进程读。
function webServerEnv(port) {
  const script = `const c = (await import(${JSON.stringify(new URL('../playwright.config.js', import.meta.url).href)})).default;
process.stdout.write(JSON.stringify(c.webServer[0].env.PINPOINT_VITE_CACHE ?? null));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, E2E_PORT: String(port) }, encoding: 'utf8' });
  return JSON.parse(out);
}

test('服务的 vite 缓存按轮分家：同一次 ship 的两组各用自己固件目录下的 deps/，不在 node_modules 下', async () => {
  const a = await loadEnv(5399);
  const b = await loadEnv(5419);
  assert.notEqual(a.E2E_VITE_CACHE, b.E2E_VITE_CACHE);
  for (const env of [a, b]) {
    assert.equal(path.dirname(env.E2E_VITE_CACHE), env.E2E_FIXTURE_DIR);
    assert.equal(env.E2E_VITE_CACHE.split(path.sep).includes('node_modules'), false);
  }

  // 真传给了 webServer：vite.config.js 认的是 PINPOINT_VITE_CACHE。
  assert.equal(webServerEnv(5399), a.E2E_VITE_CACHE);
  assert.equal(webServerEnv(5419), b.E2E_VITE_CACHE);
});

test('打包 e2e：构建发生在起服前，产物随端口分家，开发模式保留现场转译', async () => {
  for (const port of [5399, 5419]) {
    const env = await loadEnv(port);
    assert.equal(path.dirname(env.E2E_WORKBENCH_DIST), env.E2E_FIXTURE_DIR);
    const script = `const c = (await import(${JSON.stringify(new URL('../playwright.config.js', import.meta.url).href)})).default;
process.stdout.write(JSON.stringify(c.webServer[0]));`;
    for (const mode of ['dev', 'bundle']) {
      const config = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, E2E_PORT: String(port), PINPOINT_WORKBENCH_MODE: mode }, encoding: 'utf8',
      }));
      assert.equal(config.env.PINPOINT_WORKBENCH_MODE, mode);
      assert.equal(config.env.PINPOINT_WORKBENCH_DIST, env.E2E_WORKBENCH_DIST);
      assert.equal(config.command.includes('build:workbench && npm run dev:app'), mode === 'bundle');
    }
  }
});
