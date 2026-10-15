import test from 'node:test';
import assert from 'node:assert/strict';

import { cardPointToParent, planLiveCards } from './live-cards.js';

const card = (id, extra) => ({ id, visible: false, live: false, loading: false, seenAt: 0, ...extra });

test('看得见的卡片装上，一次最多两张在装，排队按画布先后', () => {
  const plan = planLiveCards([card('a', { visible: true }), card('b', { visible: true }), card('c', { visible: true }), card('d')]);
  assert.deepEqual(plan, { load: ['a', 'b'], unload: [] });
  const next = planLiveCards([card('a', { visible: true, live: true }), card('b', { visible: true, loading: true }), card('c', { visible: true })]);
  assert.deepEqual(next.load, ['c']);
});

test('视野外的卡片不装；装着的超过上限，从视野外最久没看见的开始卸，看得见的从不卸', () => {
  const cards = [
    card('a', { live: true, seenAt: 5 }),
    card('b', { live: true, seenAt: 1 }),
    card('c', { live: true, seenAt: 3 }),
    card('d', { visible: true, live: true, seenAt: 9 }),
    card('e', { visible: true }),
  ];
  assert.deepEqual(planLiveCards(cards, { maxLive: 3 }), { load: ['e'], unload: ['b', 'c'] });
  // 全都看得见：超过上限也不卸。
  const all = [1, 2, 3, 4].map((n) => card('v' + n, { visible: true, live: true }));
  assert.deepEqual(planLiveCards(all, { maxLive: 2 }).unload, []);
  assert.deepEqual(planLiveCards([], {}), { load: [], unload: [] });
});

test('卡片里的点按画布缩放换算到工作台坐标', () => {
  assert.deepEqual(cardPointToParent({ left: 100, top: 50, width: 640 }, 1280, 200, 100), { x: 200, y: 100 });
  assert.deepEqual(cardPointToParent({ left: 0, top: 0, width: 10 }, 0, 4, 6), { x: 4, y: 6 });
});
