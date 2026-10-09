import test from 'node:test';
import assert from 'node:assert/strict';

import { expandVariants } from './board-variants.js';
import { boardRefs, frameRef, refLikeFrameIds, refLikeTitles, sectionLetter } from './board-refs.js';

const BOARD = {
  sections: [
    { id: 'home', title: '首页', layout: 'column', screens: [{ id: 'home', title: 'Today' }] },
    { id: 'flow', title: '流程', layout: 'row', screens: [
      { id: 'a', title: '第一步' },
      'b',
      { id: 'c' },
    ] },
  ],
};

test('sectionLetter: 0→A … 25→Z，26 起表格列名式递进', () => {
  assert.equal(sectionLetter(0), 'A');
  assert.equal(sectionLetter(1), 'B');
  assert.equal(sectionLetter(25), 'Z');
  assert.equal(sectionLetter(26), 'AA');
  assert.equal(sectionLetter(27), 'AB');
  assert.equal(sectionLetter(52), 'BA');
});

test('boardRefs: 引用号纯由顺序派生，字符串 screen 与无 title 走 id 兜底', () => {
  const { outline, bySection, byFrame } = boardRefs(BOARD);
  assert.equal(outline.length, 2);
  assert.deepEqual(outline[0], {
    id: 'home', title: '首页', letter: 'A',
    frames: [{ id: 'home', title: 'Today', ref: 'A1' }],
    groups: [],
  });
  assert.equal(outline[1].letter, 'B');
  assert.deepEqual(outline[1].frames.map((f) => f.ref), ['B1', 'B2', 'B3']);
  assert.equal(outline[1].frames[1].title, 'b'); // 字符串 screen 无 title → id
  assert.equal(outline[1].frames[2].title, 'c'); // 无 title → id
  assert.equal(bySection.flow, 'B');
  assert.equal(byFrame['flow\0c'], 'B3');
});

test('boardRefs: _empty 占位不进引用体系，空 board 安全返回', () => {
  const { outline } = boardRefs({ sections: [{ id: '_empty', screens: [{ id: 'x' }] }] });
  assert.equal(outline.length, 0);
  assert.deepEqual(boardRefs(null), { outline: [], bySection: {}, byFrame: {}, byGroup: {} });
  assert.deepEqual(boardRefs({}), { outline: [], bySection: {}, byFrame: {}, byGroup: {} });
});

test('boardRefs: 同一 screen 重复挂载取首次出现的引用号', () => {
  const { byFrame } = boardRefs({
    sections: [
      { id: 's1', screens: ['dup'] },
      { id: 's2', screens: ['dup'] },
    ],
  });
  assert.equal(byFrame['s1\0dup'], 'A1');
  assert.equal(byFrame['s2\0dup'], 'B1');
});

test('frameRef: 命中返回引用号，缺参/未命中返回空串', () => {
  assert.equal(frameRef(BOARD, 'flow', 'b'), 'B2');
  assert.equal(frameRef(BOARD, 'flow', 'nope'), '');
  assert.equal(frameRef(BOARD, 'nope', 'b'), '');
  assert.equal(frameRef(null, 'flow', 'b'), '');
  assert.equal(frameRef(BOARD, '', 'b'), '');
});

test('boardRefs: doc 帧不占编号，board.json 原文（shell 只写在 section 上）也和画布一致', () => {
  const { bySection, byFrame } = boardRefs({
    sections: [
      { id: 'mech', shell: 'doc', screens: [{ id: 'm1' }] },
      { id: 'flow', screens: [{ id: 'a' }, { id: 'note', shell: 'doc' }, { id: 'b' }] },
      { id: 'legacy', screens: [{ id: 'w', shell: 'web' }] },
    ],
  });
  assert.deepEqual(bySection, { flow: 'A' });
  assert.deepEqual(byFrame, { 'flow\0a': 'A1', 'flow\0b': 'A2' });
});

test('refLikeFrameIds: 只挑形如编号的帧 id，按 board 序去重', () => {
  const ids = refLikeFrameIds({
    sections: [
      { id: 'a', screens: [{ id: 'a1-home' }, { id: 'detail-noop-run' }, 'c1b-detail', { id: 'b3' }] },
      { id: 'b', screens: [{ id: 'a1-home' }, { id: 'v2-layout' }, { id: 'home' }, { id: 'step10' }] },
    ],
  });
  assert.deepEqual(ids, ['a1-home', 'c1b-detail', 'b3', 'v2-layout']);
});

test('boardRefs: 变体组整组占一个位置号，变体派生 a/b/c，后面的帧顺延', () => {
  const board = {
    sections: [{
      id: 's',
      screens: [
        'a',
        { id: 'submit', title: '提交前确认', variants: ['v1', { id: 'v2', title: '核对信息' }, 'v3'] },
        'b',
      ],
    }],
  };
  const { outline, byFrame, byGroup } = boardRefs(board);
  assert.deepEqual(outline[0].frames.map((f) => [f.id, f.ref]), [
    ['a', 'A1'], ['v1', 'A2a'], ['v2', 'A2b'], ['v3', 'A2c'], ['b', 'A3'],
  ]);
  assert.deepEqual(outline[0].groups.map((g) => [g.id, g.title, g.ref, g.frames.length]), [['submit', '提交前确认', 'A2', 3]]);
  assert.equal(outline[0].frames[2].variantOf, 'submit');
  assert.equal(outline[0].frames[2].groupRef, 'A2');
  assert.equal(byFrame['s\0v2'], 'A2b');
  assert.equal(byGroup['s\0submit'], 'A2');
  // 摊平后再喂一遍结果相同（服务端既可能给原板也可能给摊平板）
  assert.deepEqual(boardRefs(expandVariants(board)), boardRefs(board));
});

test('refLikeTitles: 只挑以编号样前缀开头的标题（段 / 帧 / 组 / 变体），去重', () => {
  const titles = refLikeTitles({
    sections: [
      { id: 's', title: 'K 系列', screens: [
        { id: 'a', title: 'K11 提交前确认' },
        { id: 'b', title: 'B3 · 登录' },
        { id: 'c', title: 'iOS 17 设置' },
        { id: 'g', title: 'K12', variants: [{ id: 'v1', title: 'K12a：授权' }, { id: 'v2', title: '核对信息' }] },
        { id: 'd', title: 'K11 提交前确认' },
      ] },
    ],
  });
  assert.deepEqual(titles, ['K11 提交前确认', 'B3 · 登录', 'K12', 'K12a：授权']);
});
