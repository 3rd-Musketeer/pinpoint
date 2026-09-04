import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FRAME_STAGE_CLASSES,
  FRAME_STAGE_SELECTOR,
  frameInternalSelector,
  queryFrameScope,
} from './frame-anchor.js';

test('frameInternalSelector cuts at the ios-stage segment (canvas board path)', () => {
  const canvas =
    '#lib-brew-flow > div.wb-sec-body:nth-of-type(1) > div.wb-screen:nth-of-type(2)' +
    ' > div.ios-stage:nth-of-type(2) > div.ios-root:nth-of-type(1) > div.ios-device:nth-of-type(1)' +
    ' > div.ios-bezel:nth-of-type(1) > div.ios-screen:nth-of-type(1) > div.ios-app:nth-of-type(3)' +
    ' > div.ios-page:nth-of-type(2) > div:nth-of-type(4) > div:nth-of-type(1)';
  assert.equal(
    frameInternalSelector(canvas),
    ':scope > div.ios-root:nth-of-type(1) > div.ios-device:nth-of-type(1)' +
      ' > div.ios-bezel:nth-of-type(1) > div.ios-screen:nth-of-type(1) > div.ios-app:nth-of-type(3)' +
      ' > div.ios-page:nth-of-type(2) > div:nth-of-type(4) > div:nth-of-type(1)',
  );
});

test('frameInternalSelector cuts at the stage segment in an /api/frame page path', () => {
  const embed =
    'body > div.wb-screen:nth-of-type(1) > div.ios-stage:nth-of-type(2)' +
    ' > div.ios-root:nth-of-type(1) > div.ios-device:nth-of-type(1) > div.ios-bezel:nth-of-type(1)' +
    ' > div.ios-screen:nth-of-type(1) > div.ios-app:nth-of-type(3)';
  assert.equal(
    frameInternalSelector(embed),
    ':scope > div.ios-root:nth-of-type(1) > div.ios-device:nth-of-type(1)' +
      ' > div.ios-bezel:nth-of-type(1) > div.ios-screen:nth-of-type(1) > div.ios-app:nth-of-type(3)',
  );
});

test('frameInternalSelector returns ":scope" for a frame-level anchor', () => {
  assert.equal(
    frameInternalSelector('#lib-home > div.wb-sec-body:nth-of-type(1) > div.wb-screen:nth-of-type(1) > div.ios-stage:nth-of-type(2)'),
    ':scope',
  );
});

test('frameInternalSelector supports comp / html / error stages', () => {
  assert.equal(
    frameInternalSelector('#lib-x > div.wb-sec-body:nth-of-type(1) > div.wb-screen:nth-of-type(1) > div.wb-comp-stage:nth-of-type(2) > div.ios-root:nth-of-type(1) > button:nth-of-type(1)'),
    ':scope > div.ios-root:nth-of-type(1) > button:nth-of-type(1)',
  );
  assert.equal(
    frameInternalSelector('body > div.wb-html-stage:nth-of-type(1) > main:nth-of-type(1)'),
    ':scope > main:nth-of-type(1)',
  );
  assert.equal(
    frameInternalSelector('#lib-x > div.wb-sec-body:nth-of-type(1) > div.wb-screen:nth-of-type(1) > div.wb-screen-err:nth-of-type(2)'),
    ':scope',
  );
});

test('frameInternalSelector returns null for non-frame selectors', () => {
  assert.equal(frameInternalSelector(''), null);
  assert.equal(frameInternalSelector('#brew-btn'), null);
  assert.equal(frameInternalSelector('#brew-btn > span:nth-of-type(1)'), null);
  assert.equal(frameInternalSelector('body > main:nth-of-type(1) > p:nth-of-type(2)'), null);
  assert.equal(frameInternalSelector('#lib-home'), null);
  assert.equal(frameInternalSelector(null), null);
});

test('frameInternalSelector does not match lookalike classes', () => {
  assert.equal(frameInternalSelector('body > div.ios-stage-x:nth-of-type(1) > div:nth-of-type(1)'), null);
  assert.equal(frameInternalSelector('body > div.x-ios-stage:nth-of-type(1)'), null);
});

test('queryFrameScope resolves :scope and relative chains', () => {
  const stageRoot = {
    querySelector(sel) {
      if (sel === ':scope > div:nth-of-type(1)') return { ok: true };
      if (sel === ':scope > div:nth-of-type(9)') throw new Error('bad');
      return null;
    },
  };
  assert.equal(queryFrameScope(stageRoot, ':scope'), stageRoot);
  assert.deepEqual(queryFrameScope(stageRoot, ':scope > div:nth-of-type(1)'), { ok: true });
  assert.equal(queryFrameScope(stageRoot, ':scope > div:nth-of-type(9)'), null);
  assert.equal(queryFrameScope(null, ':scope'), null);
  assert.equal(queryFrameScope(stageRoot, ''), null);
});

test('stage class list and selector stay aligned', () => {
  assert.equal(FRAME_STAGE_SELECTOR, FRAME_STAGE_CLASSES.map((c) => '.' + c).join(', '));
  assert.ok(FRAME_STAGE_CLASSES.includes('ios-stage'));
  assert.ok(FRAME_STAGE_CLASSES.includes('wb-comp-stage'));
});
