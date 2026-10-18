import test from 'node:test';
import assert from 'node:assert/strict';

import { OV_CLOSE_MS, OV_EASE, OV_OPEN_MS, OV_REDUCED_MS, OV_SCALE, overlayOrigin } from './overlay-motion.js';

test('画布浮层：入口在视口上段时从顶放大', () => {
  assert.equal(overlayOrigin(40, 900), 'center top');
});

test('画布浮层：入口在视口中段时从中放大', () => {
  assert.equal(overlayOrigin(450, 900), 'center center');
});

test('画布浮层：入口在视口下段时从底放大', () => {
  assert.equal(overlayOrigin(800, 900), 'center bottom');
});

test('画布浮层：动效参数与设计一致', () => {
  assert.deepEqual(
    { open: OV_OPEN_MS, close: OV_CLOSE_MS, scale: OV_SCALE, ease: OV_EASE, reduced: OV_REDUCED_MS },
    { open: 140, close: 100, scale: 0.985, ease: 'cubic-bezier(.2,.8,.2,1)', reduced: 80 },
  );
});
