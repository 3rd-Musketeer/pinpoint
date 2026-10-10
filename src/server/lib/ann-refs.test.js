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
    assert.deepEqual(resolveRef('demo', CTX), { kind: 'page', pageId: 'demo' });
    assert.equal(resolveRef('Q', CTX).kind, 'unknown');
  });

  test('页 id 对照登记页清单：不限基页，未登记的照旧认不出', () => {
    const ctx = { ...CTX, pageIds: ['demo', 'example'] };
    assert.deepEqual(resolveRef('demo', ctx), { kind: 'page', pageId: 'demo' });
    // 基页是 demo，「example」是别的登记页 —— <页> 语义本就该指到它。
    assert.deepEqual(resolveRef('example', ctx), { kind: 'page', pageId: 'example' });
    assert.equal(resolveRef('ghost', ctx).kind, 'unknown');
    // 段字母 / 帧号优先级不受影响：大写 token 不会被当成页。
    assert.equal(resolveRef('B', ctx).kind, 'section');
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
    assert.equal(picks[2].pageId, 'demo');
  });

  test('shot 语义：页引用带着自己的 pageId 走（可异于基页）', () => {
    const ctx = { ...CTX, pageIds: ['demo', 'example'] };
    const { picks, errors } = expandRefs(['demo', 'example'], ctx, { shotRefs: true });
    assert.deepEqual(picks.map((p) => p.kind), ['page', 'page']);
    assert.deepEqual(picks.map((p) => p.pageId), ['demo', 'example']);
    assert.deepEqual(errors, []);
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

describe('resolveRef：裸 id 与显示编号同义', () => {
  test('帧 id → 同一帧，带当前编号；段 id → 同一段', () => {
    assert.deepEqual(resolveRef('settings', CTX), resolveRef('A2', CTX));
    const section = resolveRef('flow', CTX);
    assert.equal(section.kind, 'section');
    assert.equal(section.ref, 'B');
    assert.equal(section.sectionId, 'flow');
  });

  test('页 id 同名时页优先', () => {
    const ctx = { ...CTX, board: { sections: [{ id: 'chat', screens: [{ id: 'demo' }] }] } };
    assert.equal(resolveRef('demo', ctx).kind, 'page');
  });

  test('doc 帧不占编号：B3 与 CLI、画布同一口径', () => {
    const ctx = { ...CTX, board: { sections: [{ id: 'intro', shell: 'doc', screens: [{ id: 'm1' }] }, ...BOARD.sections] } };
    assert.equal(resolveRef('A1', ctx).screenId, 'home');
    assert.equal(resolveRef('m1', ctx).kind, 'unknown');
  });
});

describe('resolveRef：多 tab 页（ADR 0041）', () => {
  const sec = (id, screens) => ({ id, title: id, layout: 'row', screens });
  const TABBED = {
    tabs: [
      { id: 'comps', title: '组件', sections: [sec('btn', ['btn-a', 'btn-b']), sec('chip', ['chip-a'])] },
      { id: 'flow', title: '交互', sections: [sec('onboard', ['ob-1', 'ob-2'])] },
    ],
  };
  const TROWS = [
    { id: 't1', n: 1, screenId: 'btn-b', status: 'open' },
    { id: 't2', n: 2, screenId: 'ob-2', status: 'open' },
  ];
  const TCTX = { rows: TROWS, board: TABBED, pageId: 'demo' };

  test('<tab>:B3 / <tab>:B 指到那个 tab 里的帧与段，ref 带前缀', () => {
    const frame = resolveRef('flow:A2', TCTX);
    assert.equal(frame.kind, 'frame');
    assert.equal(frame.screenId, 'ob-2');
    assert.equal(frame.ref, 'flow:A2');
    assert.equal(frame.tabId, 'flow');
    assert.equal(resolveRef('comps:A2', TCTX).screenId, 'btn-b');
    const section = resolveRef('comps:B', TCTX);
    assert.equal(section.kind, 'section');
    assert.equal(section.sectionId, 'chip');
    assert.equal(section.ref, 'comps:B');
    assert.equal(resolveRef('flow:A', TCTX).sectionId, 'onboard');
  });

  test('裸 A1 / A 在多个 tab 里都有：报歧义并点名候选', () => {
    const frame = resolveRef('A1', TCTX);
    assert.equal(frame.kind, 'unknown');
    assert.match(frame.message, /A1 在多个 tab 里有，写 comps:A1 或 flow:A1/);
    const section = resolveRef('A', TCTX);
    assert.equal(section.kind, 'unknown');
    assert.match(section.message, /A 在多个 tab 里有，写 comps:A 或 flow:A/);
  });

  test('裸 B1 只在一个 tab 里有：放行（带前缀的 ref 返回）', () => {
    const frame = resolveRef('B1', TCTX);
    assert.equal(frame.kind, 'frame');
    assert.equal(frame.screenId, 'chip-a');
    assert.equal(frame.ref, 'comps:B1');
    assert.equal(resolveRef('B', TCTX).sectionId, 'chip');
  });

  test('未知 tab、tab 里没有那个号都带原文报错；存量页写前缀也报清楚', () => {
    assert.match(resolveRef('nope:A1', TCTX).message, /没有 tab "nope"（有：comps、flow）/);
    assert.match(resolveRef('flow:A9', TCTX).message, /图纸上没有帧 flow:A9/);
    assert.match(resolveRef('flow:Z', TCTX).message, /图纸上没有段 flow:Z/);
    assert.match(resolveRef('flow:A1', CTX).message, /这页没有 tab/);
  });

  test('帧 id / 段 id / @frame 在多 tab 页上仍裸写可用，且带 tabId', () => {
    assert.equal(resolveRef('ob-1', TCTX).screenId, 'ob-1');
    assert.equal(resolveRef('ob-1', TCTX).ref, 'flow:A1');
    assert.equal(resolveRef('onboard', TCTX).tabId, 'flow');
    assert.equal(resolveRef('@frame:demo/btn-b', TCTX).tabId, 'comps');
  });

  test('只有一个 tab 的页：位置号不带前缀、裸写即可', () => {
    const one = { tabs: [{ id: 'only', sections: [sec('s', ['x', 'y'])] }] };
    const ctx = { rows: [], board: one, pageId: 'demo' };
    const frame = resolveRef('A2', ctx);
    assert.equal(frame.screenId, 'y');
    assert.equal(frame.ref, 'A2');
    assert.equal(resolveRef('only:A2', ctx).screenId, 'y');
  });

  test('expandRefs：tab 前缀引用展开成帧内标注；歧义逐条报错不炸整批；shot 语义带 tabId', () => {
    const { picks, errors } = expandRefs(['flow:A2', 'A1', 'comps:A2'], TCTX);
    assert.deepEqual(picks.map((p) => p.row.n), [2, 1]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /在多个 tab 里有/);
    const shots = expandRefs(['flow:A', 'comps:A2'], TCTX, { shotRefs: true }).picks;
    assert.deepEqual(shots.map((p) => [p.kind, p.tabId]), [['section', 'flow'], ['frame', 'comps']]);
  });
});
