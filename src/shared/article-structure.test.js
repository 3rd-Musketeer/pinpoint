import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

import { articleStructure, descendants, isJsxElement, jsxAttribute, literalAttribute } from './article-structure.js';

const parse = (text) => unified().use(remarkParse).use(remarkMdx).parse(text);
const idOf = (node) => (literalAttribute(node, 'id') || {}).value;

test('article-structure is a leaf: imports only the shared project-ids leaf', () => {
  const source = fs.readFileSync(new URL('./article-structure.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./project-ids.js']);
});

test('articleStructure: sections in order with letters, canvases and nested sections inside, stray canvases', () => {
  const tree = parse([
    '<Canvas frames={["early"]} />',
    '',
    '<Section id="why">',
    '',
    '只有文字。',
    '',
    '</Section>',
    '',
    '<div>',
    '<Section id="flow" title="流程">',
    '',
    '<Canvas frames={["a"]} />',
    '',
    '<Section id="inner">',
    '<Canvas frames={["b"]} />',
    '</Section>',
    '',
    '</Section>',
    '</div>',
    '',
    '<Section id={dynamic}>x</Section>',
  ].join('\n'));
  const items = articleStructure(tree);
  assert.deepEqual(items.map((item) => [item.kind, item.kind === 'section' ? idOf(item.node) : null, item.letter]), [
    ['stray-canvas', null, undefined],
    ['section', 'why', 'A'],
    ['section', 'flow', 'B'],
    ['section', undefined, 'C'],
  ]);
  const flow = items[2];
  assert.equal(flow.index, 1);
  assert.deepEqual(flow.nested.map(idOf), ['inner']);
  // 套在里面那一节的 Canvas 也归外面这一节（深度优先序）。
  assert.equal(flow.canvases.length, 2);
  assert.equal(flow.node.position.start.line, 10);
  assert.deepEqual(items[0].node.position.start.line, 1);
  assert.deepEqual(items[1].canvases, []);
});

test('attribute helpers: literal, expression, absent', () => {
  const [section] = parse('<Section id="a" title={t} />').children;
  assert.ok(isJsxElement(section, 'Section') && !isJsxElement(section, 'Canvas') && !isJsxElement(null, 'Section'));
  assert.deepEqual(literalAttribute(section, 'id'), { value: 'a' });
  assert.ok(literalAttribute(section, 'title').expression);
  assert.equal(literalAttribute(section, 'nope'), undefined);
  assert.equal(jsxAttribute(section, 'id').value, 'a');
  assert.deepEqual([...descendants({ children: [{ children: [{ type: 'x' }] }] })].length, 2);
});
