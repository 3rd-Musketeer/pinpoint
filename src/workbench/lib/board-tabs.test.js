import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boardForTab,
  boardTabList,
  flattenTabs,
  hasRawTabs,
  isMultiTab,
  qualifyRef,
  resolveTabId,
  tabIdOfScreen,
  tabIdOfSection,
} from './board-tabs.js';
import { boardRefs, outlineFrames } from './board-refs.js';
import { ContractError, validateBoard, validateBoardTabs } from './preview-contracts.js';

const sec = (id, screens, extra = {}) => ({ id, title: id, layout: 'row', screens, ...extra });

const TABBED = {
  assets: { css: ['pk.css'] },
  tabs: [
    { id: 'comps', title: '组件', sections: [
      sec('btn', ['btn-default', 'btn-busy']),
      sec('chip', ['chip-a']),
    ] },
    { id: 'flow', title: '交互', sections: [
      sec('onboard', ['ob-1', 'ob-2', 'ob-3']),
    ] },
  ],
};

test('flattenTabs: 磁盘 tabs → 扁平 sections（带 tabId）+ tabs 元数据，其余字段留着', () => {
  const flat = flattenTabs(TABBED);
  assert.deepEqual(flat.sections.map((s) => [s.id, s.tabId]), [['btn', 'comps'], ['chip', 'comps'], ['onboard', 'flow']]);
  assert.deepEqual(flat.tabs, [{ id: 'comps', title: '组件' }, { id: 'flow', title: '交互' }]);
  assert.deepEqual(flat.assets, { css: ['pk.css'] });
  assert.equal(hasRawTabs(TABBED), true);
  assert.equal(hasRawTabs(flat), false);
});

test('flattenTabs: 幂等；存量 board（只有 sections）原样返回同一个对象', () => {
  const flat = flattenTabs(TABBED);
  assert.equal(flattenTabs(flat), flat);
  const legacy = { sections: [sec('a', ['x'])] };
  assert.equal(flattenTabs(legacy), legacy);
  assert.equal(flattenTabs(null), null);
  assert.deepEqual(boardTabList(legacy), []);
  assert.equal(isMultiTab(legacy), false);
});

test('isMultiTab: 一个 tab 不算多 tab（切换条不出现，位置号不带前缀）', () => {
  const one = { tabs: [{ id: 'only', sections: [sec('a', ['x'])] }] };
  assert.equal(boardTabList(one).length, 1);
  assert.equal(isMultiTab(one), false);
  assert.equal(isMultiTab(TABBED), true);
  assert.equal(qualifyRef(one, 'only', 'A1'), 'A1');
  assert.equal(qualifyRef(TABBED, 'flow', 'A1'), 'flow:A1');
  assert.equal(qualifyRef({ sections: [] }, '', 'A1'), 'A1');
});

test('resolveTabId / boardForTab: 非法或缺省落第一个 tab，视图只留活动 tab 的 section', () => {
  assert.equal(resolveTabId(TABBED, 'flow'), 'flow');
  assert.equal(resolveTabId(TABBED, 'nope'), 'comps');
  assert.equal(resolveTabId(TABBED, undefined), 'comps');
  assert.equal(resolveTabId({ sections: [] }, 'flow'), '');
  const view = boardForTab(TABBED, 'flow');
  assert.deepEqual(view.sections.map((s) => s.id), ['onboard']);
  assert.equal(view.activeTabId, 'flow');
  assert.equal(view.tabs.length, 2);
  const legacy = { sections: [sec('a', ['x'])] };
  assert.equal(boardForTab(legacy, 'flow'), legacy);
});

test('tabIdOfScreen / tabIdOfSection: id 全页唯一，查得到所在 tab', () => {
  assert.equal(tabIdOfScreen(TABBED, 'ob-2'), 'flow');
  assert.equal(tabIdOfScreen(TABBED, 'btn-busy'), 'comps');
  assert.equal(tabIdOfScreen(TABBED, 'missing'), '');
  assert.equal(tabIdOfSection(TABBED, 'chip'), 'comps');
  assert.equal(tabIdOfScreen({ sections: [sec('a', ['x'])] }, 'x'), '');
});

test('boardRefs: 编号按 tab 重新从 A 开始，frame / section 带 tabId', () => {
  const refs = boardRefs(TABBED);
  assert.deepEqual(refs.outline.map((s) => [s.tabId, s.id, s.letter]), [
    ['comps', 'btn', 'A'], ['comps', 'chip', 'B'], ['flow', 'onboard', 'A'],
  ]);
  assert.deepEqual(outlineFrames(refs).map((f) => [f.tabId, f.id, f.ref]), [
    ['comps', 'btn-default', 'A1'], ['comps', 'btn-busy', 'A2'], ['comps', 'chip-a', 'B1'],
    ['flow', 'ob-1', 'A1'], ['flow', 'ob-2', 'A2'], ['flow', 'ob-3', 'A3'],
  ]);
  assert.equal(refs.bySection.onboard, 'A');
  assert.equal(refs.byFrame['onboard\0ob-3'], 'A3');
  assert.deepEqual(refs.tabs.map((t) => t.id), ['comps', 'flow']);
});

test('boardRefs: doc 帧不占编号（per tab 口径同样成立），已摊平的 board 与磁盘形态结果相同', () => {
  const board = { tabs: [
    { id: 't1', sections: [sec('d', [{ id: 'doc1', shell: 'doc' }], { shell: 'doc' }), sec('a', ['x'])] },
    { id: 't2', sections: [sec('b', ['y'])] },
  ] };
  const refs = boardRefs(board);
  assert.deepEqual(refs.outline.map((s) => [s.id, s.letter]), [['a', 'A'], ['b', 'A']]);
  assert.deepEqual(boardRefs(flattenTabs(board)), refs);
});

test('boardRefs: 存量 board 的结果形状不变（无 tabId，无 tabs 键）', () => {
  const refs = boardRefs({ sections: [sec('a', ['x', 'y']), sec('b', ['z'])] });
  assert.deepEqual(refs.outline[0], { id: 'a', title: 'a', letter: 'A', frames: [
    { id: 'x', title: 'x', ref: 'A1' }, { id: 'y', title: 'y', ref: 'A2' },
  ] });
  assert.equal(refs.outline[1].letter, 'B');
  assert.equal('tabs' in refs, false);
});

test('validateBoard: tabs 通过，输出扁平 sections（带 tabId）+ tabs', () => {
  const out = validateBoard(TABBED, { pageId: 'demo' });
  assert.deepEqual(out.tabs, [{ id: 'comps', title: '组件' }, { id: 'flow', title: '交互' }]);
  assert.deepEqual(out.sections.map((s) => [s.id, s.tabId, s.screens.length]), [['btn', 'comps', 2], ['chip', 'comps', 1], ['onboard', 'flow', 3]]);
  // tab 缺 title 用 id
  const noTitle = validateBoard({ tabs: [{ id: 'one', sections: [sec('a', ['x'])] }] });
  assert.deepEqual(noTitle.tabs, [{ id: 'one', title: 'one' }]);
});

test('validateBoard: sections 与 tabs 二选一', () => {
  assert.throws(
    () => validateBoard({ sections: [sec('a', ['x'])], tabs: TABBED.tabs }),
    (error) => error instanceof ContractError && error.path === 'tabs' && /二选一/.test(error.message),
  );
  assert.throws(() => validateBoardTabs({ sections: [], tabs: [] }), /二选一/);
});

test('validateBoard: tab id 合法且唯一，空 tab 与空 tabs 报错', () => {
  assert.throws(() => validateBoard({ tabs: [] }), (e) => e.path === 'tabs');
  assert.throws(() => validateBoard({ tabs: 'x' }), (e) => e.path === 'tabs');
  assert.throws(() => validateBoard({ tabs: [{ id: 'bad id', sections: [sec('a', ['x'])] }] }), (e) => e.path === 'tabs[0].id');
  assert.throws(
    () => validateBoard({ tabs: [{ id: 't', sections: [sec('a', ['x'])] }, { id: 't', sections: [sec('b', ['y'])] }] }),
    (e) => e.path === 'tabs[1].id' && /duplicate tab id/.test(e.message),
  );
  assert.throws(
    () => validateBoard({ tabs: [{ id: 'empty', sections: [] }] }),
    (e) => e.path === 'tabs[0].sections' && /至少要有一个 section/.test(e.message),
  );
  assert.throws(() => validateBoard({ tabs: [{ id: 'nosec' }] }), (e) => e.path === 'tabs[0].sections');
  assert.throws(() => validateBoard({ tabs: [{ id: 't', title: 'a\nb', sections: [sec('a', ['x'])] }] }), (e) => e.path === 'tabs[0].title');
});

test('validateBoard: section id / screen id 跨 tab 也必须全页唯一，报错路径指回磁盘位置', () => {
  assert.throws(
    () => validateBoard({ tabs: [
      { id: 't1', sections: [sec('same', ['x'])] },
      { id: 't2', sections: [sec('same', ['y'])] },
    ] }),
    (e) => e.path === 'tabs[1].sections[0].id' && /duplicate id "same"/.test(e.message),
  );
  assert.throws(
    () => validateBoard({ tabs: [
      { id: 't1', sections: [sec('a', ['dup'])] },
      { id: 't2', sections: [sec('b', ['ok', 'dup'])] },
    ] }),
    (e) => e.path === 'tabs[1].sections[0].screens[1]' && /duplicate screen id "dup"/.test(e.message),
  );
});

test('validateBoard: 存量 sections board 输出不带 tabs / tabId', () => {
  const out = validateBoard({ sections: [sec('a', ['x'])] });
  assert.deepEqual(Object.keys(out), ['sections']);
  assert.equal('tabId' in out.sections[0], false);
});
