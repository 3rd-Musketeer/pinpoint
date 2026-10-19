// 变更记录的失效范围（K1 第三刀）：属性变更不升级全局失效，哪怕账本里全是
// 全局选择器的标注 —— 这是工作台同值 class 重写喂不出自持重绘循环的判据。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mutationScope } from './mutation-scope.js';

// closest 的替身：返回非空 = 记录目标在 style / link 里。
function el(inStylesheet) {
  return { nodeType: 1, closest: () => (inStylesheet ? { tagName: 'STYLE' } : null) };
}
const depsOf = (relational, global) => () => ({ relational, global });

test('属性变更不升级全局：账本有全局选择器，class 记录仍只失效所在帧', () => {
  const record = { type: 'attributes', attributeName: 'class', target: el(false) };
  assert.equal(mutationScope(record, depsOf(false, true)), record);
});

test('属性变更不因关系选择器依赖升级', () => {
  const record = { type: 'attributes', attributeName: 'data-open', target: el(false) };
  assert.equal(mutationScope(record, depsOf(true, true)), record);
});

test('style 属性变更同局部（原行为保留）', () => {
  const record = { type: 'attributes', attributeName: 'style', target: el(false) };
  assert.equal(mutationScope(record, depsOf(false, true)), record);
});

test('对照：结构变更仍按依赖升级全局', () => {
  const moved = { type: 'childList', target: el(false) };
  assert.equal(mutationScope(moved, depsOf(false, true)), null);
  assert.equal(mutationScope(moved, depsOf(true, false)), null);
});

test('结构变更无依赖时不升级（原行为保留）', () => {
  const record = { type: 'childList', target: el(false) };
  assert.equal(mutationScope(record, depsOf(false, false)), record);
});

test('文字变更不因全局选择器升级，关系选择器仍升级（原行为保留）', () => {
  const text = { type: 'characterData', attributeName: null, target: el(false) };
  assert.equal(mutationScope(text, depsOf(false, true)), text);
  assert.equal(mutationScope(text, depsOf(true, false)), null);
});

test('样式表内的变更一律升级（attributes 也算，href 换样式表能到达别的帧）', () => {
  const record = { type: 'attributes', attributeName: 'href', target: el(true) };
  assert.equal(mutationScope(record, depsOf(false, false)), null);
});

test('文本节点的 target 回退到 parentElement 判样式表归属', () => {
  const parent = el(true);
  const record = { type: 'characterData', attributeName: null, target: { nodeType: 3, parentElement: parent } };
  assert.equal(mutationScope(record, depsOf(false, false)), null);
});
