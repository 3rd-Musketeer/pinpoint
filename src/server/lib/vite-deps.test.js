import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { WORKBENCH_DEPS, viteCacheDir } from './vite-deps.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// vite.config.js 在 import 时读环境变量，换一组变量就换一个模块实例（查询串绕开 ESM 缓存）。
let seq = 0;
async function loadViteConfig(env) {
  const keys = ['PINPOINT_VITE_CACHE', 'PINPOINT_REGISTRY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  // 登记表指到不存在的文件：只读配置，不碰 ~/.pinpoint。
  process.env.PINPOINT_REGISTRY = path.join(os.tmpdir(), `pinpoint-vite-deps-test-${process.pid}`, 'registry.json');
  delete process.env.PINPOINT_VITE_CACHE;
  Object.assign(process.env, env);
  try {
    seq += 1;
    return (await import(`${path.join(REPO, 'vite.config.js')}?probe=${seq}`)).default;
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const insideNodeModules = (dir) => path.resolve(dir).split(path.sep).includes('node_modules');

test('服务的 vite 缓存不在 node_modules 下：缺省落在本 checkout 真实路径的 .tmp/vite', async () => {
  // worktree 的 node_modules 软链到主 clone，缺省的 node_modules/.vite 会让所有实例共用一份 deps/。
  const config = await loadViteConfig({});
  assert.ok(config.cacheDir, 'vite.config.js 要显式设 cacheDir');
  assert.equal(insideNodeModules(config.cacheDir), false);
  assert.equal(config.cacheDir, path.join(fs.realpathSync(REPO), '.tmp', 'vite'));
});

test('PINPOINT_VITE_CACHE 覆盖缓存目录（e2e 每组、隔离服务各设自己的）', async () => {
  const dir = path.join(os.tmpdir(), 'pinpoint-vite-cache-probe');
  const config = await loadViteConfig({ PINPOINT_VITE_CACHE: dir });
  assert.equal(config.cacheDir, dir);
  assert.equal(viteCacheDir({ root: REPO, env: { PINPOINT_VITE_CACHE: 'rel/cache' } }), path.resolve('rel/cache'));
});

test('缺省目录按 root 的真实路径算：经软链进来的 root 也落在真实目录下', (t) => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-vite-root-'));
  const link = `${real}-link`;
  fs.symlinkSync(real, link);
  t.after(() => { fs.rmSync(link, { force: true }); fs.rmSync(real, { recursive: true, force: true }); });
  assert.equal(viteCacheDir({ root: link, env: {} }), path.join(fs.realpathSync(real), '.tmp', 'vite'));
});

/** 浏览器端源码（index.html 引的工作台、标注客户端、共享模块）里的裸 import。 */
function browserBareImports() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|mjs)$/.test(entry.name) && !/\.test\.(jsx?|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        // import … from 'x' / export … from 'x' / import 'x' / import('x')
        const statements = /^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
        for (const m of text.matchAll(statements)) {
          const spec = m[1] || m[2] || m[3];
          if (!/^[./]/.test(spec) && !spec.startsWith('node:')) found.add(spec);
        }
      }
    }
  };
  for (const dir of ['src/workbench', 'src/client', 'src/shared']) walk(path.join(REPO, dir));
  return found;
}

test('optimizeDeps.include 列全工作台用到的依赖，且不留已经不用的', async () => {
  const config = await loadViteConfig({});
  assert.deepEqual(config.optimizeDeps.include, WORKBENCH_DEPS);
  const used = browserBareImports();
  // @vitejs/plugin-react 编出来的 JSX 引这两个运行时，源码里看不见。
  const jsxRuntimes = ['react/jsx-runtime', 'react/jsx-dev-runtime'];
  assert.deepEqual([...used].filter((dep) => !WORKBENCH_DEPS.includes(dep)).sort(), [], '新依赖登记进 WORKBENCH_DEPS');
  assert.deepEqual(WORKBENCH_DEPS.filter((dep) => !used.has(dep) && !jsxRuntimes.includes(dep)), [], '不再用的依赖从 WORKBENCH_DEPS 删掉');
});
