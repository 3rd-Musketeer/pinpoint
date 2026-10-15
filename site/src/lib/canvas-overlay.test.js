import test from 'node:test';
import assert from 'node:assert/strict';

import { canvasHash, embedCanvasSrc, embedMessage, entrySection, parseCanvasHash } from './canvas-overlay.js';

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

test('canvas hash: the old #overlay= links still open the overlay', () => {
  assert.deepEqual(parseCanvasHash('#overlay=flow&frame=ask'), { section: 'flow', frame: 'ask', ann: null });
  assert.deepEqual(parseCanvasHash('#overlay=flow'), { section: 'flow', frame: '', ann: null });
});

test('canvas hash: other hashes are not the overlay', () => {
  for (const h of ['', '#', '#flow', '#canvas=', '#overlay=', '#frame=ask&canvas=flow', '#canvasx=flow', null, undefined]) {
    assert.equal(parseCanvasHash(h), null, String(h));
  }
});

test('embedded workbench: canvas view + embed=overlay, landing on the section', () => {
  assert.equal(embedCanvasSrc('demo_flow', 'ask'), '/workbench/?page=demo_flow&section=ask&embed=overlay');
  assert.equal(embedCanvasSrc('a b', ''), '/workbench/?page=a%20b&embed=overlay');
});

test('embedded workbench messages: close, section; anything else is ignored', () => {
  assert.deepEqual(embedMessage({ source: 'pinpoint-workbench', type: 'close' }), { type: 'close' });
  assert.deepEqual(embedMessage({ source: 'pinpoint-workbench', type: 'section', section: 'ask' }), { type: 'section', section: 'ask' });
  for (const m of [null, 'close', { type: 'close' }, { source: 'x', type: 'close' }, { source: 'pinpoint-workbench', type: 'section' }, { source: 'pinpoint-workbench', type: 'boom' }]) {
    assert.equal(embedMessage(m), null, JSON.stringify(m));
  }
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
