import assert from 'node:assert/strict';
import test from 'node:test';

import { offlineExportSupported } from './offline-export-scope.js';

test('offlineExportSupported：只有 board ios 的 dir 条目、页 id 不带 _', () => {
  assert.equal(offlineExportSupported('e2e-dir-ios', { kind: 'dir', board: 'ios' }), true);
  assert.equal(offlineExportSupported('e2e-dir', { kind: 'dir', board: 'html' }), false, '非 ios 画布');
  assert.equal(offlineExportSupported('e2e-dir', { kind: 'dir' }), false, '缺 board 是文档页');
  assert.equal(offlineExportSupported('report', { kind: 'file', board: 'ios' }), false, 'file 条目');
  assert.equal(offlineExportSupported('site', { kind: 'url', board: 'ios' }), false, 'url 条目');
  assert.equal(offlineExportSupported('demo_flow', { kind: 'dir', board: 'ios' }), false, '文章画布页的页 id');
  assert.equal(offlineExportSupported('demo_flow', { kind: 'article' }), false);
  assert.equal(offlineExportSupported('', { kind: 'dir', board: 'ios' }), false);
  assert.equal(offlineExportSupported('Bad', { kind: 'dir', board: 'ios' }), false);
});
