import test from 'node:test';
import assert from 'node:assert/strict';

import { neighborSection, overlayHash, overlayScale, parseOverlayHash } from './canvas-overlay.js';

test('overlay hash: section, optional frame, round trip', () => {
  assert.equal(overlayHash('flow'), '#overlay=flow');
  assert.equal(overlayHash('flow', 'ask'), '#overlay=flow&frame=ask');
  assert.deepEqual(parseOverlayHash('#overlay=flow'), { section: 'flow', frame: '' });
  assert.deepEqual(parseOverlayHash('#overlay=flow&frame=ask'), { section: 'flow', frame: 'ask' });
  assert.deepEqual(parseOverlayHash(overlayHash('a b', '帧/1')), { section: 'a b', frame: '帧/1' });
  assert.deepEqual(parseOverlayHash('overlay=mech'), { section: 'mech', frame: '' }); // location.hash without '#'
});

test('overlay hash: other hashes are not the overlay', () => {
  for (const h of ['', '#', '#flow', '#overlay=', '#frame=ask&overlay=flow', '#overlayx=flow', null, undefined]) {
    assert.equal(parseOverlayHash(h), null, String(h));
  }
});

test('overlay scale: one scale fits the tallest frame, capped at real size', () => {
  const phone = { width: 413, height: 872 };
  const comp = { width: 315, height: 371 };
  // 1440×900 desktop: height binds; the comp card gets the same scale as the phone.
  assert.equal(overlayScale({ boxes: [phone, comp], availWidth: 1300, availHeight: 727 }), 727 / 872);
  // Tall viewport: never above real size.
  assert.equal(overlayScale({ boxes: [phone, comp], availWidth: 1800, availHeight: 1400 }), 1);
  // Only small comp frames: real size, not blown up.
  assert.equal(overlayScale({ boxes: [comp], availWidth: 1300, availHeight: 727 }), 1);
  // Phone width (390 − gutters): the widest frame fits the width.
  assert.equal(overlayScale({ boxes: [phone, comp], availWidth: 358, availHeight: 800 }), 358 / 413);
  // A wide doc frame binds on width too.
  assert.equal(overlayScale({ boxes: [{ width: 1280, height: 900 }], availWidth: 640, availHeight: 727 }), 0.5);
});

test('overlay scale: no measurable box → max', () => {
  assert.equal(overlayScale({ boxes: [], availWidth: 800, availHeight: 600 }), 1);
  assert.equal(overlayScale({ boxes: [{ width: 0, height: 0 }], availWidth: 800, availHeight: 600, max: 0.5 }), 0.5);
  assert.equal(overlayScale({ boxes: [{ width: 300, height: 300 }], availWidth: 0, availHeight: 600 }), 1);
});

test('neighbor section: previous / next among sections with a canvas', () => {
  const ids = ['options', 'card', 'takeover'];
  assert.equal(neighborSection(ids, 'card', -1), 'options');
  assert.equal(neighborSection(ids, 'card', 1), 'takeover');
  assert.equal(neighborSection(ids, 'options', -1), '');
  assert.equal(neighborSection(ids, 'takeover', 1), '');
  assert.equal(neighborSection(ids, 'ghost', 1), '');
});

test('natural box before measuring: phone = workbench phone chrome, document = page width × full height, others = card box', async () => {
  const { shellBox } = await import('./canvas-card.js');
  const { naturalBox, PHONE_STAGE } = await import('./canvas-overlay.js');
  assert.deepEqual(naturalBox(shellBox()), PHONE_STAGE);
  assert.deepEqual(naturalBox(shellBox('comp')), { width: 480, height: 320 });
  // HTML 帧：缺省手机宽度，高度不定（浮层里占满可用高，页面在帧里滚动）。
  assert.deepEqual(naturalBox(shellBox('doc')), { width: 390, height: null });
  assert.deepEqual(naturalBox(shellBox('doc', 'desktop')), { width: 1280, height: null });
  assert.deepEqual(naturalBox(shellBox('doc', 'nonsense')), { width: 390, height: null });
});

test('overlayScale: a document frame binds only by width', async () => {
  const { overlayScale } = await import('./canvas-overlay.js');
  // 三个手机宽度的页面并排：宽度装得下就是真实大小，不管多高。
  assert.equal(overlayScale({ boxes: [{ width: 390, height: null }, { width: 390, height: null }], availWidth: 1300, availHeight: 700 }), 1);
  // 桌面宽度放进 1000 宽的浮层：按宽度缩。
  assert.equal(overlayScale({ boxes: [{ width: 1280, height: null }], availWidth: 1000, availHeight: 700 }), 1000 / 1280);
  // 和手机帧同节：手机帧的高度照样约束缩放。
  assert.equal(overlayScale({ boxes: [{ width: 402, height: 874 }, { width: 390, height: null }], availWidth: 2000, availHeight: 437 }), 0.5);
});

test('layer stack: Esc closes only the top layer and marks the event handled', async () => {
  const { createLayerStack } = await import('./layers.js');
  const L = createLayerStack();
  const closed = [];
  const event = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  L.push('overlay', () => closed.push('overlay'));
  const releasePop = L.push('popup', () => closed.push('popup'));
  const e1 = event();
  assert.equal(L.escape(e1), true);
  assert.deepEqual(closed, ['popup']);
  assert.equal(e1.defaultPrevented, true);
  assert.equal(L.top(), 'overlay');
  releasePop(); // releasing an already-popped layer is a no-op
  assert.deepEqual(L.names(), ['overlay']);
  // An Esc someone else already handled is left alone.
  const e2 = event(); e2.preventDefault();
  assert.equal(L.escape(e2), false);
  assert.deepEqual(closed, ['popup']);
  L.push('popup', () => closed.push('popup2'));
  L.dismiss('popup');
  assert.deepEqual(L.names(), ['overlay']);
  assert.deepEqual(closed, ['popup', 'popup2']);
  assert.equal(L.escape(event()), true);
  assert.equal(L.escape(event()), false); // empty stack: Esc goes to the page (prose draft etc.)
});
