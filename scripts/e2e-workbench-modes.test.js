import assert from 'node:assert/strict';
import test from 'node:test';
import { devModuleSupplement, workbenchGroupMode } from './e2e-workbench-modes.js';

test('单组降载和双组都保留 dev 模块顺序回归；bundle 专属行为另跑', () => {
  const tagged = ['canvas-overlay-motion.spec.js', 'workbench.spec.js'];
  assert.equal(workbenchGroupMode(0), 'bundle');
  assert.equal(workbenchGroupMode(1), 'dev');
  assert.deepEqual(devModuleSupplement([tagged], tagged), tagged);
  assert.deepEqual(devModuleSupplement([[tagged[0]], [tagged[1]]], tagged), [tagged[0]]);
  assert.deepEqual(devModuleSupplement([[tagged[0]], [tagged[1]]], tagged, 'bundle'), tagged);
  assert.deepEqual(devModuleSupplement([tagged], tagged, 'dev'), []);
});
