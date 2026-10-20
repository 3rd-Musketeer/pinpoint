import test from 'node:test';
import assert from 'node:assert/strict';

import { canvasHash, embedCanvasSrc, embedMessage, entrySection, overlayDocNext, overlayPhaseNext, parseCanvasHash, prewarmSection } from './canvas-overlay.js';

test('canvas hash: section, optional frame / annotation, round trip', () => {
  assert.equal(canvasHash('flow'), '#canvas=flow');
  assert.equal(canvasHash('flow', { frame: 'ask' }), '#canvas=flow&frame=ask');
  assert.equal(canvasHash('flow', { ann: 7 }), '#canvas=flow&ann=7');
  assert.deepEqual(parseCanvasHash('#canvas=flow'), { section: 'flow', frame: '', ann: null });
  assert.deepEqual(parseCanvasHash('#canvas=flow&frame=ask'), { section: 'flow', frame: 'ask', ann: null });
  assert.deepEqual(parseCanvasHash('#canvas=flow&ann=12'), { section: 'flow', frame: '', ann: 12 });
  assert.deepEqual(parseCanvasHash(canvasHash('a b', { frame: '帧/1', ann: 3 })), { section: 'a b', frame: '帧/1', ann: 3 });
  assert.deepEqual(parseCanvasHash('canvas=mech'), { section: 'mech', frame: '', ann: null }); // location.hash without '#'
  // 不是正整数的 ann 当没给。
  for (const bad of ['0', '-1', '1.5', 'x', '']) assert.equal(parseCanvasHash(`#canvas=flow&ann=${bad}`).ann, null, bad);
});

test('canvas hash: legacy view=frame is ignored; generated links only name a frame', () => {
  assert.equal(canvasHash('flow', { frame: 'ask', view: 'frame' }), '#canvas=flow&frame=ask');
  assert.deepEqual(parseCanvasHash('#canvas=flow&frame=ask&view=frame&ann=4'), { section: 'flow', frame: 'ask', ann: 4 });
});

test('canvas hash: other hashes are not the overlay', () => {
  for (const h of ['', '#', '#flow', '#canvas=', '#overlay=', '#overlay=flow', '#frame=ask&canvas=flow', '#canvasx=flow', null, undefined]) {
    assert.equal(parseCanvasHash(h), null, String(h));
  }
});

test('embedded workbench: canvas view + embed=overlay, landing on the section', () => {
  assert.equal(embedCanvasSrc('demo_flow', 'ask'), '/workbench/?page=demo_flow&section=ask&embed=overlay');
  assert.equal(embedCanvasSrc('a b', ''), '/workbench/?page=a%20b&embed=overlay');
  // 文档代次（C1）：重试换 src 时递增，工作台原样回传，文章页按它丢旧文档迟到的消息。
  assert.equal(embedCanvasSrc('demo_flow', 'ask', 3), '/workbench/?page=demo_flow&section=ask&embed=overlay&gen=3');
});

test('embedded workbench messages: close, section, readiness; anything else is ignored', () => {
  assert.deepEqual(embedMessage({ source: 'pinpoint-workbench', type: 'close' }), { type: 'close' });
  assert.deepEqual(embedMessage({ source: 'pinpoint-workbench', type: 'section', section: 'ask' }), { type: 'section', section: 'ask' });
  // 停驻回执（E2）：不带代次，文章页只在预热中认它。
  assert.deepEqual(embedMessage({ source: 'pinpoint-workbench', type: 'parked' }), { type: 'parked' });
  // 就绪三条（C1）：gen 归一成整数（缺失按 0），ready 带页 id。
  assert.deepEqual(
    embedMessage({ source: 'pinpoint-workbench', type: 'ready', gen: 2, pageId: 'demo_flow' }),
    { type: 'ready', gen: 2, pageId: 'demo_flow' },
  );
  assert.deepEqual(embedMessage({ source: 'pinpoint-workbench', type: 'board-error', gen: 2 }), { type: 'board-error', gen: 2 });
  assert.deepEqual(embedMessage({ source: 'pinpoint-workbench', type: 'boot-error', gen: 'x' }), { type: 'boot-error', gen: 0 });
  for (const m of [null, 'close', { type: 'close' }, { source: 'x', type: 'close' }, { source: 'pinpoint-workbench', type: 'section' }, { source: 'pinpoint-workbench', type: 'boom' }]) {
    assert.equal(embedMessage(m), null, JSON.stringify(m));
  }
});

test('overlay doc state machine (C1): readiness advances it, only definite failures turn it into retry', () => {
  // loading：等主动信号，不靠时长猜失败。
  assert.equal(overlayDocNext('loading', null), 'loading');
  assert.equal(overlayDocNext('loading', { type: 'section', section: 'ask' }), 'loading');
  // ready 收起准备态并放行定位；任何状态下都收（显示重试之后观察也不停）。
  assert.equal(overlayDocNext('loading', { type: 'ready', gen: 1 }), 'ready');
  assert.equal(overlayDocNext('retry', { type: 'ready', gen: 1 }), 'ready');
  assert.equal(overlayDocNext('board-error', { type: 'ready', gen: 1 }), 'ready');
  // 工作台自己的错误面板：收起准备态让出面板；已显示重试时不倒退。
  assert.equal(overlayDocNext('loading', { type: 'board-error', gen: 1 }), 'board-error');
  assert.equal(overlayDocNext('retry', { type: 'board-error', gen: 1 }), 'retry');
  assert.equal(overlayDocNext('board-error', { type: 'board-error', gen: 1 }), 'board-error');
  // 入口脚本加载失败：一律换成重试。
  assert.equal(overlayDocNext('loading', { type: 'boot-error', gen: 1 }), 'retry');
  assert.equal(overlayDocNext('board-error', { type: 'boot-error', gen: 1 }), 'retry');
  assert.equal(overlayDocNext('retry', { type: 'boot-error', gen: 1 }), 'retry');
});

test('overlay lifecycle: absent, warming, parked, open; reopen and open-while-warming both open', () => {
  // 未建 → 预热中 → 停驻。
  assert.equal(overlayPhaseNext('absent', 'prewarm'), 'warming');
  assert.equal(overlayPhaseNext('warming', 'park'), 'parked');
  // 预热中打开、停驻中打开、关闭中（仍记着 open）又打开，都是打开。
  assert.equal(overlayPhaseNext('warming', 'open'), 'open');
  assert.equal(overlayPhaseNext('parked', 'open'), 'open');
  assert.equal(overlayPhaseNext('open', 'open'), 'open');
  // 关掉停驻；换节不是生命周期事件，状态不动。
  assert.equal(overlayPhaseNext('open', 'park'), 'parked');
  assert.equal(overlayPhaseNext('open', 'section'), 'open');
  assert.equal(overlayPhaseNext('parked', 'section'), 'parked');
  // 已经在走的不倒退：停驻了不再预热，开着不重复预热，预热中的 park 才落停驻。
  assert.equal(overlayPhaseNext('parked', 'prewarm'), 'parked');
  assert.equal(overlayPhaseNext('open', 'prewarm'), 'open');
  assert.equal(overlayPhaseNext('warming', 'prewarm'), 'warming');
  assert.equal(overlayPhaseNext('absent', 'park'), 'absent');
  // 重试换文档：整段作废，回到未建。
  for (const phase of ['warming', 'parked', 'open']) assert.equal(overlayPhaseNext(phase, 'discard'), 'absent', phase);
  // 认不出的状态当未建，深链落点从那里直接打开。
  assert.equal(overlayPhaseNext('nope', 'open'), 'open');
  assert.equal(overlayPhaseNext('nope', 'prewarm'), 'warming');
});

test('prewarm section: the first visible canvas card, else the entry section', () => {
  const ids = ['confirm', 'variants', 'mixed'];
  assert.equal(prewarmSection(ids, ['mixed', 'variants'], 'confirm'), 'variants');
  assert.equal(prewarmSection(ids, ['mixed'], 'confirm'), 'mixed');
  // 视口里没有卡片（还没排版、都在折叠下）：用顶栏入口的那一节。
  assert.equal(prewarmSection(ids, [], 'mixed'), 'mixed');
  assert.equal(prewarmSection(ids, ['gone'], 'variants'), 'variants');
  // 入口节也不在画布里：第一张有画布的。
  assert.equal(prewarmSection(ids, [], ''), 'confirm');
  assert.equal(prewarmSection([], ['confirm'], 'confirm'), '');
});

test('entry section: the section being read if it has a canvas, else the next one with a canvas', () => {
  const order = ['why', 'confirm', 'talk', 'variants', 'mixed', 'end'];
  const ids = ['confirm', 'variants', 'mixed'];
  assert.equal(entrySection(ids, order, 'variants'), 'variants');
  assert.equal(entrySection(ids, order, 'why'), 'confirm');
  assert.equal(entrySection(ids, order, 'talk'), 'variants');
  assert.equal(entrySection(ids, order, 'end'), 'mixed');
  assert.equal(entrySection(ids, order, ''), 'confirm');
  assert.equal(entrySection([], order, 'why'), '');
});
