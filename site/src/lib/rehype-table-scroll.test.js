import test from 'node:test';
import assert from 'node:assert/strict';
import { rehypeTableScroll, numericColumns } from './rehype-table-scroll.js';

const el = (tagName, children = [], properties = {}) => ({ type: 'element', tagName, properties, children });
const t = (value) => ({ type: 'text', value });
const table = () => el('table', [
  el('thead', [el('tr', [el('th', [t('产品')]), el('th', [t('耗时')]), el('th', [t('说明')])])]),
  el('tbody', [
    el('tr', [el('td', [t('Kernel')]), el('td', [t('120 ms')]), el('td', [t('托管')])]),
    el('tr', [el('td', [t('gbh')]), el('td', [t('1,200')]), el('td', [t('本地 3 次')])]),
  ]),
]);

test('table is wrapped in .pp-table-scroll once; numeric columns get .num', () => {
  const tree = { type: 'root', children: [el('p', [t('前')]), table()] };
  rehypeTableScroll()(tree);
  const wrap = tree.children[1];
  assert.equal(wrap.tagName, 'div');
  assert.deepEqual(wrap.properties.className, ['pp-table-scroll']);
  assert.equal(wrap.children[0].tagName, 'table');
  assert.deepEqual(numericColumns(wrap.children[0]), [1]);
  const firstRow = wrap.children[0].children[1].children[0].children;
  assert.deepEqual(firstRow.map((c) => c.properties.className || []), [[], ['num'], []]);
  // 表头那一格也右对齐，和数字对齐。
  assert.deepEqual(wrap.children[0].children[0].children[0].children[1].properties.className, ['num']);
  // 再跑一遍不重复包。
  rehypeTableScroll()(tree);
  assert.equal(tree.children[1].children[0].tagName, 'table');
});

test('tables inside MDX JSX elements (e.g. <Section>) are wrapped too', () => {
  const tree = { type: 'root', children: [{ type: 'mdxJsxFlowElement', name: 'Section', attributes: [], children: [table()] }] };
  rehypeTableScroll()(tree);
  assert.deepEqual(tree.children[0].children[0].properties.className, ['pp-table-scroll']);
});
