import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkbenchBundleHandler, workbenchMode } from './workbench-bundle.js';
import { mockReq, mockRes } from '../test-harness.js';

test('工作台打包模式：开发缺省、发布标记与显式开关；缺产物启动即失败', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-wb-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(workbenchMode({ root, env: {} }), 'dev');
  const dist = path.join(root, '.tmp/workbench-dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'enabled'), '');
  assert.equal(workbenchMode({ root, env: {} }), 'bundle');
  assert.equal(workbenchMode({ root, env: { PINPOINT_WORKBENCH_MODE: 'dev' } }), 'dev');
  assert.throws(() => workbenchMode({ root, env: { PINPOINT_WORKBENCH_MODE: 'typo' } }));
  assert.throws(() => createWorkbenchBundleHandler({ root, dist }), /build:workbench/);
});

test('工作台壳不缓存、hash 资源永久缓存；HEAD、缺文件与越界不会掉进 SPA fallback', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-wb-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html>本版</html>');
  fs.writeFileSync(path.join(root, 'assets/index-abc123.js'), 'window.ready=true;');
  const handle = createWorkbenchBundleHandler({ root, dist: root });
  fs.writeFileSync(path.join(root, 'index.html'), '<html>下一版</html>');
  const shell = mockRes();
  assert.equal(handle(mockReq('GET', '/workbench/?page=a'), shell, true), true);
  assert.equal(shell.text, '<html>本版</html>');
  assert.equal(shell.headers['Cache-Control'], 'no-store');
  for (const method of ['GET', 'HEAD']) {
    const res = mockRes();
    assert.equal(handle(mockReq(method, '/workbench/assets/index-abc123.js?v=1'), res), true);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Cache-Control'], /immutable/);
    assert.equal(res.text, method === 'HEAD' ? '' : 'window.ready=true;');
  }
  for (const url of ['/workbench/assets/missing-abc.js', '/workbench/assets/%2e%2e/index.html', '/workbench/assets/%ZZ.js']) {
    const res = mockRes();
    assert.equal(handle(mockReq('GET', url), res), true);
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(handle(mockReq('GET', '/previews/a.html'), mockRes()), false);
});
