import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTargetText,
  pickByTargetText,
  ppIdAttrSelector,
  targetTextAffinity,
} from './ann-ppid.js';

test('ppIdAttrSelector：合法值拼属性选择器，空值不给', () => {
  assert.equal(ppIdAttrSelector('home.jsx:9@1'), '[data-pp-id="home.jsx:9@1"]');
  assert.equal(ppIdAttrSelector('content/kits/ios/jsx/Nav.jsx:18@2'), '[data-pp-id="content/kits/ios/jsx/Nav.jsx:18@2"]');
  // 文件名带空白合法（引号串里允许）；引号与反斜杠转义。
  assert.equal(ppIdAttrSelector('my page.jsx:3@1'), '[data-pp-id="my page.jsx:3@1"]');
  assert.equal(ppIdAttrSelector('a"b.jsx:1@1'), '[data-pp-id="a\\"b.jsx:1@1"]');
  assert.equal(ppIdAttrSelector(null), null);
  assert.equal(ppIdAttrSelector(''), null);
});

test('normalizeTargetText 与 client excerpt() 同规则', () => {
  assert.equal(normalizeTargetText('  早  早\n\t早 '), '早 早 早');
  assert.equal(normalizeTargetText('x'.repeat(200)), 'x'.repeat(120));
  assert.equal(normalizeTargetText(null), '');
});

test('targetTextAffinity：相等 > 包含 > 公共前缀比例', () => {
  assert.equal(targetTextAffinity('第二段', '第二段'), 3);
  assert.equal(targetTextAffinity('确认订单', '确认订单（含税）'), 2);
  assert.equal(targetTextAffinity('row 2', 'row 22'), 2);
  assert.ok(targetTextAffinity('abc', 'abd') > targetTextAffinity('abc', 'xyz'));
  assert.equal(targetTextAffinity('', ''), 1);
  assert.equal(targetTextAffinity('文案', ''), 0);
});

test('pickByTargetText：多命中取文本最接近的；平手留文档序第一个', () => {
  const items = [
    { id: 'a', text: 'row 1' },
    { id: 'b', text: 'row 2' },
    { id: 'c', text: 'row 3' },
  ];
  assert.equal(pickByTargetText(items, 'row 2').id, 'b');
  // 源码改过文案：存的还是旧文本，公共前缀 / 包含关系仍能挑出最近的一个。
  const edited = [
    { id: 'a', text: '今日订单' },
    { id: 'b', text: '确认订单（含税）' },
  ];
  assert.equal(pickByTargetText(edited, '确认订单').id, 'b');
  // 平手（文本对比较无分辨力）：文档序第一个。
  assert.equal(pickByTargetText(items, '').id, 'a');
  assert.equal(pickByTargetText([], 'x'), null);
  // 候选缺 text 字段按空串参与，不抛。
  assert.equal(pickByTargetText([{ id: 'only' }], 'x').id, 'only');
});
