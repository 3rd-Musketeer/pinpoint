// B1：开下一条标注时，还开着的草稿先存。只有调用方显式 discard（画箭头回弹）才丢。
// 读源码断言 closeComposer 的参数，不装 openComposer（它会拉起整份标注客户端）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const open = fs.readFileSync(new URL('./composer-open.js', import.meta.url), 'utf8');
const arrow = fs.readFileSync(new URL('./arrow.js', import.meta.url), 'utf8');
const call = open.slice(open.indexOf('export function openComposer'), open.indexOf('m = normalizeAnnotation'));

test('开下一条标注时 closeComposer 不 discard，还开着的草稿走 commit', () => {
  assert.match(call, /closeComposer\(\{ silentRender: true, discard: !!\(opts && opts\.discard\) \}\)/);
  assert.doesNotMatch(call, /discard: true/);
});

test('画箭头回弹是唯一显式 discard 的调用方', () => {
  assert.match(arrow, /openComposer\([\s\S]*?\{ discard: true \}\)/);
  const others = ['create.js', 'nav.js'].map((name) => fs.readFileSync(new URL('./' + name, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(others, /discard: true/);
});
