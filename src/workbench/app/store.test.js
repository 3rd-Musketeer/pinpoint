// store 订阅粒度（C3）：subscribeWithSelector 之后 selector 订阅只在所选字段
// 变化时回调，裸 subscribe（url-sync 的深链镜像）仍是每次写入都进。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useWorkbenchStore, wbSet } from './store.js';

test('selector 订阅只在所选字段变化时触发，同值写入不触发', () => {
  const seen = [];
  const unsubscribe = useWorkbenchStore.subscribe(
    s => s.activePageId,
    id => seen.push(id)
  );
  wbSet({ annSnap: { available: false, rows: [] } }); // 无关字段不扇出
  assert.deepEqual(seen, []);
  wbSet({ activePageId: 'p1' });
  wbSet({ activePageId: 'p1' }); // 同值：Object.is 相等不回调
  wbSet({ activePageId: 'p2' });
  assert.deepEqual(seen, ['p1', 'p2']);
  unsubscribe();
  wbSet({ activePageId: 'p3' });
  assert.deepEqual(seen, ['p1', 'p2']);
});

test('equalityFn 逐项比较数组 selector：无关字段写入不触发', () => {
  const seen = [];
  const unsubscribe = useWorkbenchStore.subscribe(
    s => [s.activeBoard, s.focusFrameKey, s.focusSectionId],
    value => seen.push(value),
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] }
  );
  const board = { pageId: 'p1' };
  wbSet({ activeBoard: board, focusFrameKey: 'sec\0frame' });
  wbSet({ sideWidth: 300, focusAnnN: 1 }); // 选中字段与板本体没动
  assert.equal(seen.length, 1);
  wbSet({ focusFrameKey: null });
  assert.equal(seen.length, 2);
  unsubscribe();
});

test('裸 subscribe 仍是全店扇出（url-sync 的深链镜像靠它看每次写入）', () => {
  let calls = 0;
  const unsubscribe = useWorkbenchStore.subscribe(() => { calls++; });
  wbSet({ sideCollapsed: true });
  wbSet({ sideCollapsed: false });
  assert.equal(calls, 2);
  unsubscribe();
});
