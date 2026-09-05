import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// env.js reads process.env at import time, so a fresh view means a fresh
// module instance. The query string busts the ESM cache.
let seq = 0;
async function loadEnv(port) {
  const previous = { ...process.env };
  delete process.env.E2E_UPSTREAM_PORT;
  if (port === undefined) delete process.env.E2E_PORT;
  else process.env.E2E_PORT = String(port);
  try {
    seq += 1;
    return await import(`./env.js?probe=${seq}`);
  } finally {
    for (const key of ['E2E_PORT', 'E2E_UPSTREAM_PORT']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('一个端口一套固件：两轮并发跑在不同 tmpdir 与不同上游端口', async () => {
  const a = await loadEnv(5399);
  const b = await loadEnv(5499);

  assert.notEqual(a.E2E_DATA_DIR, b.E2E_DATA_DIR);
  assert.notEqual(a.E2E_REGISTRY, b.E2E_REGISTRY);
  assert.notEqual(a.E2E_UPSTREAM_PORT, b.E2E_UPSTREAM_PORT);
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
  assert.equal(first.E2E_UPSTREAM_PORT, second.E2E_UPSTREAM_PORT);
});

test('仓内产物目录：默认端口不带后缀，显式端口分家', async () => {
  const fallback = await loadEnv(undefined);
  assert.equal(fallback.E2E_RUN_SLOT, '');

  const a = await loadEnv(5399);
  const b = await loadEnv(5499);
  assert.equal(a.E2E_RUN_SLOT, '5399');
  assert.notEqual(a.E2E_RUN_SLOT, b.E2E_RUN_SLOT);
});

test('默认端口 5299，上游端口跟着主端口走', async () => {
  const fallback = await loadEnv(undefined);
  assert.equal(fallback.E2E_PORT, 5299);
  assert.equal(fallback.E2E_UPSTREAM_PORT, 5309);

  const shifted = await loadEnv(5399);
  assert.equal(shifted.E2E_UPSTREAM_PORT, 5409);
});
