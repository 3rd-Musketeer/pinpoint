import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 只守已退役的完整能力说明；ADR 的历史决定不做禁词扫描。
test('文章与标注指南按整张画布、HTML 活卡片说明入口', () => {
  const contracts = {
    'CONTEXT.md': ['文章页的卡片和浮层上不做。', '画布视图里它是一个文档条目，不在画布那一行。', '（卡片、浮层、导出走这条）'],
    'docs/projects.md': ['卡片和浮层（`annotate=off`）不注入。', '浮层头有同一个开关，两边同步。'],
    'site/README.md': ['点帧在文章上打开这一帧的预览'],
    'skills/pinpoint-build/SKILL.md': ['文章里的 HTML 帧不在画布那一行'],
    'docs/registry.md': ['文章的 HTML 帧是文档条目，不在画布那一行'],
  };
  for (const [file, stale] of Object.entries(contracts)) {
    const text = fs.readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    for (const sentence of stale) assert.equal(text.includes(sentence), false, `${file}: ${sentence}`);
  }
});
