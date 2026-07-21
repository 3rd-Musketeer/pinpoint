import assert from 'node:assert/strict';
import test from 'node:test';

import {
  centerScrollForPoint,
  closestBoardSection,
  findBoardFrame,
  focusScrollForRect,
  hitTestBoardNavigation,
} from './board-navigation.js';

const viewport = { width: 1000, height: 700, scrollWidth: 8000, scrollHeight: 12000 };

test('focus scroll centers fitting targets and leading-aligns oversized targets', () => {
  assert.deepEqual(
    focusScrollForRect({ left: 3200, top: 3300, width: 400, height: 600 }, viewport),
    { left: 2900, top: 3250 },
  );
  assert.deepEqual(
    focusScrollForRect({ left: 3200, top: 3300, width: 1200, height: 900 }, viewport),
    { left: 3176, top: 3276 },
  );
});

test('focus and point scroll clamp against the scrollable canvas', () => {
  assert.deepEqual(
    focusScrollForRect({ left: 0, top: 0, width: 100, height: 100 }, viewport),
    { left: 0, top: 0 },
  );
  assert.deepEqual(centerScrollForPoint({ x: 9000, y: 13000 }, viewport), {
    left: 7000,
    top: 11300,
  });
});

test('navigation lookup and closest section use the shared model', () => {
  const model = {
    sections: [
      { id: 'one', top: 100, height: 500 },
      { id: 'two', top: 800, height: 500 },
    ],
    frames: [{ sectionId: 'two', screenId: 'detail' }],
  };
  assert.equal(closestBoardSection(model, 1100).id, 'two');
  assert.equal(findBoardFrame(model, 'two', 'detail').screenId, 'detail');
  assert.equal(findBoardFrame(model, 'one', 'detail'), null);
});

test('minimap hit testing prioritizes frame, then section, then canvas', () => {
  const frame = { left: 120, top: 130, width: 100, height: 200 };
  const section = { left: 100, top: 100, width: 500, height: 500 };
  const model = { frames: [frame], sections: [section] };
  assert.deepEqual(hitTestBoardNavigation(model, 150, 150).kind, 'frame');
  assert.deepEqual(hitTestBoardNavigation(model, 500, 500).kind, 'section');
  assert.deepEqual(hitTestBoardNavigation(model, 800, 800).kind, 'canvas');
});
