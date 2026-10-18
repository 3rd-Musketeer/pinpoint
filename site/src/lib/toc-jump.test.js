import test from 'node:test';
import assert from 'node:assert/strict';

import { TOC_EASE, TOC_OPEN_MS, TOC_OPEN_Y, TOC_REDUCED_MS, tocJumpScroll } from './toc-jump.js';

test('目录跳转：标题落在粘住的顶栏加目录入口下面 8px', () => {
  // 顶栏 57 + 入口 36 = 93，节在文档 800 处。
  assert.equal(tocJumpScroll(800, 93), 800 - 93 - 8);
});

test('目录跳转：第一节靠近页顶时不滚出负值', () => {
  assert.equal(tocJumpScroll(40, 93), 0);
});

test('目录跳转：占用高度含目录入口，标题不会藏在它下面', () => {
  const barOnly = tocJumpScroll(800, 57);
  const withEntry = tocJumpScroll(800, 57 + 36);
  assert.equal(barOnly - withEntry, 36);
});

test('目录入口：动效参数与设计一致', () => {
  assert.deepEqual(
    { open: TOC_OPEN_MS, y: TOC_OPEN_Y, ease: TOC_EASE, reduced: TOC_REDUCED_MS },
    { open: 120, y: -4, ease: 'cubic-bezier(.2,.8,.2,1)', reduced: 80 },
  );
});
