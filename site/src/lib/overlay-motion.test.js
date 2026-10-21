import test from 'node:test';
import assert from 'node:assert/strict';

import { overlayOrigin } from './overlay-motion.js';

test('画布浮层：入口在视口上段时从顶放大', () => {
  assert.equal(overlayOrigin(40, 900), 'center top');
});

test('画布浮层：入口在视口中段时从中放大', () => {
  assert.equal(overlayOrigin(450, 900), 'center center');
});

test('画布浮层：入口在视口下段时从底放大', () => {
  assert.equal(overlayOrigin(800, 900), 'center bottom');
});
