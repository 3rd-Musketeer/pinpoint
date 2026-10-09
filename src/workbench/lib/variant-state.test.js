import test from 'node:test';
import assert from 'node:assert/strict';
import { groupState, selectionsForPage, variantGroupKey, variantShown, withGroupState } from './variant-state.js';

const IDS = ['a', 'b', 'c'];
const KEY = variantGroupKey('s', 'g');

test('groupState: 缺省 = 收起 + 选第一个；脏值落回第一个', () => {
  assert.deepEqual(groupState({}, 'p', KEY, IDS), { open: false, sel: 'a' });
  assert.deepEqual(groupState(null, 'p', KEY, IDS), { open: false, sel: 'a' });
  const prefs = { variantsByPage: { p: { [KEY]: { open: true, sel: 'gone' } } } };
  assert.deepEqual(groupState(prefs, 'p', KEY, IDS), { open: true, sel: 'a' });
  assert.deepEqual(groupState({ variantsByPage: { p: { [KEY]: { open: 'yes', sel: 'c' } } } }, 'p', KEY, IDS), { open: false, sel: 'c' });
  assert.deepEqual(groupState({ variantsByPage: [] }, 'p', KEY, IDS), { open: false, sel: 'a' });
});

test('withGroupState: 非缺省才落盘，回到缺省删 key，空页删页，别的页与别的组不动', () => {
  let prefs = { variantsByPage: { other: { x: { open: true, sel: 'z' } } } };
  prefs = { ...prefs, ...withGroupState(prefs, 'p', KEY, IDS, { open: false, sel: 'c' }) };
  assert.deepEqual(prefs.variantsByPage.p[KEY], { open: false, sel: 'c' });
  prefs = { ...prefs, ...withGroupState(prefs, 'p', KEY, IDS, { open: true, sel: 'c' }) };
  assert.deepEqual(prefs.variantsByPage.p[KEY], { open: true, sel: 'c' });
  prefs = { ...prefs, ...withGroupState(prefs, 'p', KEY, IDS, { open: false, sel: 'a' }) };
  assert.equal(prefs.variantsByPage.p, undefined);
  assert.deepEqual(prefs.variantsByPage.other, { x: { open: true, sel: 'z' } });
  // 选中的 id 不在组内 → 当缺省
  assert.deepEqual(withGroupState({}, 'p', KEY, IDS, { open: false, sel: 'nope' }), { variantsByPage: {} });
});

test('variantShown: 展开全显示，收起只显示选中的', () => {
  assert.equal(variantShown({ open: false, sel: 'b' }, 'a'), false);
  assert.equal(variantShown({ open: false, sel: 'b' }, 'b'), true);
  assert.equal(variantShown({ open: true, sel: 'b' }, 'a'), true);
});

test('selectionsForPage: 只导出记过选择的组，脏条目忽略', () => {
  const prefs = { variantsByPage: { p: { [KEY]: { open: true, sel: 'b' }, bad: { open: true }, other: null }, q: { x: { sel: 'z' } } } };
  assert.deepEqual(selectionsForPage(prefs, 'p'), { [KEY]: 'b' });
  assert.deepEqual(selectionsForPage({}, 'p'), {});
});
