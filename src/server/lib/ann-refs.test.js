import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { expandRefs, expandStatus, resolveRef } from './ann-refs.js';

const BOARD = {
  sections: [
    { id: 'chat', title: '对话', screens: [{ id: 'home', title: '首页' }, { id: 'settings', title: '设置' }] },
    { id: 'flow', title: '流程', screens: [{ id: 'login', title: '登录' }] },
  ],
};

const ROWS = [
  { id: 'a1', n: 1, screenId: 'home', status: 'open', content: '一号' },
  { id: 'a2', n: 2, screenId: 'settings', status: 'check', content: '二号' },
  { id: 'a3', n: 3, screenId: 'settings', status: 'done', content: '三号' },
  { id: 'a4', n: 4, screenId: 'login', status: 'open', content: '四号' },
  { id: 'm9', n: 9, screenId: 'home', status: 'close', content: '九号' },
];

const CTX = { rows: ROWS, board: BOARD, pageId: 'demo' };

describe('resolveRef', () => {
  test('#n → 标注行', () => {
    assert.equal(resolveRef('#2', CTX).row.id, 'a2');
    assert.equal(resolveRef('#99', CTX).kind, 'unknown');
  });

  test('区间 #3-#7（也认 #3-7）', () => {
    assert.deepEqual(resolveRef('#3-#7', CTX).rows.map((r) => r.n), [3, 4]);
    assert.deepEqual(resolveRef('#3-7', CTX).rows.map((r) => r.n), [3, 4]);
    assert.equal(resolveRef('#7-#3', CTX).kind, 'unknown');
  });

  test('跨页 entry#n：同页折回 #n，异页走 crossPageRows', () => {
    assert.equal(resolveRef('demo#1', CTX).row.id, 'a1');
    const ctx = { ...CTX, crossPageRows: () => [{ id: 'x1', n: 1, screenId: 'p' }] };
    assert.equal(resolveRef('plugins#1', ctx).row.id, 'x1');
    assert.equal(resolveRef('plugins#2', ctx).kind, 'unknown');
    assert.equal(resolveRef('ghost#1', { ...CTX, crossPageRows: null }).kind, 'unknown');
  });

  test('A2 图纸号 → 帧；@frame:p/s 同归一处', () => {
    const b3 = resolveRef('A2', CTX);
    assert.equal(b3.kind, 'frame');
    assert.equal(b3.screenId, 'settings');
    assert.equal(resolveRef('@frame:demo/login', CTX).screenId, 'login');
    assert.equal(resolveRef('Z9', CTX).kind, 'unknown');
  });

  test('B 段字母 → 整段；<page> → 整页', () => {
    const b = resolveRef('B', CTX);
    assert.equal(b.kind, 'section');
    assert.deepEqual(b.frames.map((f) => f.id), ['login']);
    assert.equal(resolveRef('demo', CTX).kind, 'page');
    assert.equal(resolveRef('Q', CTX).kind, 'unknown');
  });

  test('@a:id → 标注内部 id', () => {
    assert.equal(resolveRef('@a:m9', CTX).row.n, 9);
    assert.equal(resolveRef('@a:nope', CTX).kind, 'unknown');
  });
});

describe('expandRefs', () => {
  test('mark/locate 语义：A2 展开成帧内标注，去重保序', () => {
    const { picks, errors } = expandRefs(['A2', '#3', '#1-#3'], CTX);
    assert.deepEqual(picks.map((p) => p.row.n), [2, 3, 1]);
    assert.deepEqual(errors, []);
  });

  test('shot 语义：B3 / B / 页保留为图目标，不展开标注', () => {
    const { picks } = expandRefs(['A2', 'B', 'demo'], CTX, { shotRefs: true });
    assert.deepEqual(picks.map((p) => p.kind), ['frame', 'section', 'page']);
    assert.equal(picks[0].screenId, 'settings');
  });

  test('空帧 / 坏引用逐条报错，不炸整批', () => {
    const { picks, errors } = expandRefs(['A2', '#1', 'Z9', '#40'], { ...CTX, rows: [ROWS[0], ROWS[3]] });
    assert.equal(picks.length, 1);
    assert.equal(errors.length, 3);
  });

  test('整页引用在非 shot 语义下报错', () => {
    const { errors } = expandRefs(['demo'], CTX);
    assert.match(errors[0], /只在 shot/);
  });
});

describe('expandStatus', () => {
  test('状态展开：缺省 status 归一 open；all 全量', () => {
    assert.deepEqual(expandStatus('open', ROWS).map((r) => r.n), [1, 4]);
    assert.deepEqual(expandStatus('close', ROWS).map((r) => r.n), [9]);
    assert.equal(expandStatus('all', ROWS).length, 5);
    assert.deepEqual(expandStatus('open', [{ n: 7, content: '无状态字段' }]).map((r) => r.n), [7]);
  });
});
