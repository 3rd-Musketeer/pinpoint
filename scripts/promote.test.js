import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promote } from './promote.mjs';

function fixture(t, { buildFails = false, installFails = false, changedLock = false, legacy = false, restartFails = false, incomplete = false, rollbackFails = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-promote-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rel = path.join(root, 'release');
  fs.mkdirSync(path.join(rel, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(rel, 'package-lock.json'), 'old-lock');
  const dist = path.join(rel, '.tmp/workbench-dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), 'old-shell');
  fs.writeFileSync(path.join(dist, 'enabled'), '');
  fs.writeFileSync(path.join(dist, 'assets/old-hash.js'), 'old');
  const calls = [];
  let current = 'old-sha';
  let prepared;
  function run(cmd, args, options) {
    calls.push({ cmd, args, cwd: options.cwd });
    if (cmd === 'git') {
      if (args[0] === 'checkout' && args.at(-1) === 'old-sha' && rollbackFails) throw new Error('rollback failed');
      if (args[0] === 'checkout') current = args.at(-1);
      if (args.includes('--git-common-dir')) return path.join(root, '.git');
      if (args[0] === 'status' || args[0] === 'branch') return '';
      if (args.includes('--verify')) return 'new-sha';
      if (args[0] === 'rev-parse') return 'old-sha';
      return '';
    }
    if (cmd === 'tar') {
      prepared = args.at(-1);
      fs.writeFileSync(path.join(prepared, 'package-lock.json'), changedLock ? 'new-lock' : 'old-lock');
      fs.writeFileSync(path.join(prepared, 'package.json'), JSON.stringify({ scripts: legacy ? {} : { 'build:workbench': 'build' } }));
    }
    if (cmd === 'npm' && args[0] === 'ci') {
      if (installFails) throw new Error('install failed');
      fs.mkdirSync(path.join(prepared, 'node_modules'));
      fs.writeFileSync(path.join(prepared, 'node_modules/new-dep'), 'new');
    }
    if (cmd === 'npm' && args[0] === 'run') {
      if (buildFails) throw new Error('build failed');
      if (!incomplete) {
        const built = options.env.PINPOINT_WORKBENCH_DIST;
        fs.mkdirSync(path.join(built, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(built, 'index.html'), 'new-shell');
        fs.writeFileSync(path.join(built, 'assets/new-hash.js'), 'new');
      }
    }
    if (cmd === process.execPath && args[1] === 'start' && current === 'new-sha' && restartFails) throw new Error('restart failed');
    return '';
  }
  return { root, rel, dist, calls, args: { root, release: rel, home: path.join(root, 'home'), run, log() {} } };
}

test('promote：构建/安装失败或伪成功无产物，不移动 release，不重启，不记发布', async t => {
  for (const failure of [{ buildFails: true }, { installFails: true, changedLock: true }, { incomplete: true }]) {
    const f = fixture(t, failure);
    await assert.rejects(() => promote(f.args));
    assert.equal(f.calls.some(c => c.args[0] === 'checkout' || c.cmd === process.execPath), false);
    assert.equal(fs.readFileSync(path.join(f.dist, 'index.html'), 'utf8'), 'old-shell');
    assert.equal(fs.existsSync(path.join(f.root, 'home/.pinpoint/logs/releases.log')), false);
    assert.deepEqual(fs.readdirSync(path.join(f.root, '.tmp')), []);
  }
});

test('promote：先构建后切换，复用依赖、保留旧 hash，成功后记日志与回滚提交', async t => {
  const f = fixture(t);
  assert.deepEqual(await promote(f.args), { prev: 'old-sha', target: 'new-sha' });
  const build = f.calls.findIndex(c => c.cmd === 'npm');
  const checkout = f.calls.findIndex(c => c.args[0] === 'checkout');
  const stop = f.calls.findIndex(c => c.args[1] === 'stop');
  const start = f.calls.findIndex(c => c.args[1] === 'start');
  const healthy = f.calls.findIndex(c => c.args[1] === 'status');
  assert.ok(build < stop && stop < checkout && checkout < start && start < healthy);
  assert.equal(fs.readFileSync(path.join(f.dist, 'index.html'), 'utf8'), 'new-shell');
  assert.equal(fs.readFileSync(path.join(f.dist, 'assets/old-hash.js'), 'utf8'), 'old');
  assert.match(fs.readFileSync(path.join(f.root, 'home/.pinpoint/logs/releases.log'), 'utf8'), /old-sha -> new-sha/);
});

test('promote：lock 变化在快照内安装；重启失败恢复提交、依赖和壳页并报错', async t => {
  const f = fixture(t, { changedLock: true, restartFails: true });
  await assert.rejects(() => promote(f.args), /restart failed/);
  const checkouts = f.calls.filter(c => c.args[0] === 'checkout').map(c => c.args.at(-1));
  assert.deepEqual(checkouts, ['new-sha', 'old-sha']);
  assert.equal(fs.existsSync(path.join(f.rel, 'node_modules/new-dep')), false);
  assert.equal(fs.readFileSync(path.join(f.dist, 'index.html'), 'utf8'), 'old-shell');
  assert.equal(fs.existsSync(path.join(f.dist, 'enabled')), true);
});

test('promote：可回滚到打包机制引入之前，停用 bundle 标记', async t => {
  const f = fixture(t, { legacy: true });
  await promote(f.args);
  assert.equal(f.calls.some(c => c.cmd === 'npm'), false);
  assert.equal(fs.existsSync(path.join(f.dist, 'enabled')), false);
});

test('promote：磁盘回滚也失败时，报出恢复路径并保留旧依赖副本', async t => {
  const f = fixture(t, { changedLock: true, restartFails: true, rollbackFails: true });
  await assert.rejects(() => promote(f.args), /restart failed.*旧服务恢复失败.*恢复材料保留在.*recovery\.sh/);
  const [kept] = fs.readdirSync(path.join(f.root, '.tmp'));
  assert.ok(kept);
  assert.equal(fs.statSync(path.join(f.root, '.tmp', kept, 'previous-node_modules')).isDirectory(), true);
});
