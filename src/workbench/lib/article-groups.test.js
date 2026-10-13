import assert from 'node:assert/strict';
import test from 'node:test';

import { articleGroups, articleReadUrl, articleRowTooltip, projectErrorTooltip } from './article-groups.js';

const PROJECTS = [
  {
    id: 'demo', title: 'Demo', errors: [],
    articles: [
      { id: 'flow', title: '流程', summary: '一句摘要', pageId: 'demo_flow', canvasSections: 2 },
      { id: 'notes', title: '笔记', pageId: 'demo_notes', canvasSections: 0 },
    ],
  },
  { id: 'empty', title: '', errors: ['缺 docs/pinpoint/ 目录'], articles: [] },
];

test('articleGroups：project → 文章两层，照登记与文章顺序；没有文章的 project 也出组', () => {
  const groups = articleGroups(PROJECTS, ['demo_flow', 'demo_notes']);
  assert.deepEqual(groups.map((g) => [g.id, g.title, g.errorCount, g.articles.map((a) => a.id)]), [
    ['demo', 'Demo', 0, ['flow', 'notes']],
    ['empty', 'empty', 1, []],
  ]);
  assert.deepEqual(groups[0].articles[0], {
    id: 'flow', title: '流程', summary: '一句摘要', pageId: 'demo_flow', readUrl: '/demo/flow/', canvas: true,
  });
});

test('articleGroups：canvas 要画布节 > 0，且清单认得画布页（撞名时模板页优先 = 当没有画布）', () => {
  const [demo] = articleGroups(PROJECTS, new Set(['demo_notes']));
  assert.deepEqual(demo.articles.map((a) => [a.id, a.canvas]), [['flow', false], ['notes', false]]);
  const [again] = articleGroups(PROJECTS, ['demo_flow']);
  assert.deepEqual(again.articles.map((a) => [a.id, a.canvas]), [['flow', true], ['notes', false]]);
  // 没有 pageId（project id 不合法时 listProjects 不给）也不当画布。
  const [odd] = articleGroups([{ id: 'x', articles: [{ id: 'a', canvasSections: 1 }] }], []);
  assert.equal(odd.articles[0].canvas, false);
  assert.equal(odd.articles[0].pageId, null);
});

test('articleGroups：坏输入不抛', () => {
  assert.deepEqual(articleGroups(null, null), []);
  assert.deepEqual(articleGroups([null, { title: '无 id' }], []), []);
});

test('projectErrorTooltip：前三条逐行，多的折成一句；没有错误为空', () => {
  assert.equal(projectErrorTooltip([]), '');
  assert.equal(projectErrorTooltip(['a', 'b']), '布局错误 2 条：\na\nb');
  assert.equal(projectErrorTooltip(['a', 'b', 'c', 'd', 'e']),
    '布局错误 5 条：\na\nb\nc\n…还有 2 条（ppnt list <project> 看全部）');
});

test('articleReadUrl / articleRowTooltip', () => {
  assert.equal(articleReadUrl('demo', 'flow'), '/demo/flow/');
  const [demo] = articleGroups(PROJECTS, ['demo_flow']);
  assert.equal(articleRowTooltip(demo, demo.articles[0]), '流程\n一句摘要\ndemo / flow');
  assert.equal(articleRowTooltip(demo, demo.articles[1]), '笔记\ndemo / notes · 没有画布，点开正文');
});
