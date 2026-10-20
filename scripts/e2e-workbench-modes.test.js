import assert from 'node:assert/strict';
import test from 'node:test';
import { workbenchSupplement, workbenchGroupMode } from './e2e-workbench-modes.js';

test('单组降载和双组都保留 dev 模块顺序回归；bundle 专属行为另跑', () => {
  const tagged = ['canvas-overlay-motion.spec.js', 'workbench.spec.js'];
  assert.equal(workbenchGroupMode(0), 'bundle');
  assert.equal(workbenchGroupMode(1), 'dev');
  assert.deepEqual(workbenchSupplement([tagged], tagged, 'dev'), tagged);
  assert.deepEqual(workbenchSupplement([[tagged[0]], [tagged[1]]], tagged, 'dev'), [tagged[0]]);
  assert.deepEqual(workbenchSupplement([[tagged[0]], [tagged[1]]], tagged, 'bundle'), [tagged[1]]);
  assert.deepEqual(workbenchSupplement([tagged], tagged, 'dev', 'bundle'), tagged);
  assert.deepEqual(workbenchSupplement([tagged], tagged, 'dev', 'dev'), []);
  assert.deepEqual(workbenchSupplement([tagged], tagged, 'bundle', 'dev'), tagged);
});
