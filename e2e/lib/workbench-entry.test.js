import assert from 'node:assert/strict';
import test from 'node:test';
import { workbenchEntryPath } from './workbench-entry.js';

test('故障注入取真实壳入口：开发 main/stage 与内容 hash，缺入口不静默打空', () => {
  const dev = '<script type="module" src="/@vite/client"></script><script type="module" src="/src/workbench/stage.js"></script><script type="module" src="/src/workbench/app/main.jsx"></script>';
  assert.equal(workbenchEntryPath(dev, { mode: 'dev' }), '/src/workbench/app/main.jsx');
  assert.equal(workbenchEntryPath(dev, { mode: 'dev', part: 'stage' }), '/src/workbench/stage.js');
  assert.equal(workbenchEntryPath('<script type="module" crossorigin src="/workbench/assets/index-newHASH.js"></script>', { mode: 'bundle' }), '/workbench/assets/index-newHASH.js');
  assert.throws(() => workbenchEntryPath(dev, { mode: 'bundle' }));
  assert.throws(() => workbenchEntryPath('', { mode: 'dev' }));
});
