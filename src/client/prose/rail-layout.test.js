import assert from 'node:assert/strict';
import test from 'node:test';

import { placeRailCards } from './rail-layout.js';

const GAP = 14;

function tops(items, activeId) {
  return placeRailCards(items, activeId == null ? null : activeId, GAP).map((card) => card.top);
}

test('无碰撞：每张卡片的 top 等于锚点', () => {
  const items = [
    { id: 'a', anchor: 40, height: 80 },
    { id: 'b', anchor: 200, height: 60 },
    { id: 'c', anchor: 400, height: 90 },
  ];
  assert.deepEqual(tops(items), [40, 200, 400]);
  assert.deepEqual(tops(items, 'b'), [40, 200, 400]);
});

test('连续碰撞：重叠的卡片往下推，间距 14px，不重叠的仍贴锚点', () => {
  const items = [
    { id: 'a', anchor: 0, height: 100 },
    { id: 'b', anchor: 50, height: 100 },
    { id: 'c', anchor: 80, height: 40 },
    { id: 'd', anchor: 500, height: 40 },
  ];
  // a 在 0，b 被推到 114，c 被推到 228，d 锚点够远仍在 500。
  assert.deepEqual(tops(items), [0, 114, 228, 500]);
});

test('选中项往上挤：选中的钉在锚点，上面重叠的依次上移，下面的下推', () => {
  const items = [
    { id: 'a', anchor: 0, height: 100 },
    { id: 'b', anchor: 300, height: 100 },
    { id: 'c', anchor: 340, height: 80 },
  ];
  // 没选中：b 在 300，c 被推到 414。
  assert.deepEqual(tops(items), [0, 300, 414]);
  // 选中 c：c 回到 340；b 会盖住它，挤到 340 - 14 - 100 = 226；a 离得够远不动。
  assert.deepEqual(tops(items, 'c'), [0, 226, 340]);
});

test('选中项上面挤不下：选中的留在锚点，挤不下的叠在顶部', () => {
  const items = [
    { id: 'a', anchor: 0, height: 120 },
    { id: 'b', anchor: 40, height: 80 },
  ];
  // 选中 b 钉在 40，a 要挤到 -94，越出顶部 0：a 停在 0，被 b 盖住。
  assert.deepEqual(tops(items, 'b'), [0, 40]);
  // 没选中时照常下推：a 在 0，b 在 134。
  assert.deepEqual(tops(items), [0, 134]);
});

test('给了 minTop：上面挤不下的越过栏顶往上排，选中的留在锚点', () => {
  const items = [
    { id: 'a', anchor: 0, height: 120 },
    { id: 'b', anchor: 40, height: 80 },
  ];
  // 文档顶部在栏顶上方 300：a 挤到 -94 还够得着，b 钉在 40。
  assert.deepEqual(placeRailCards(items, 'b', 14, -300).map((p) => p.top), [-94, 40]);
  // 文档顶部只在上方 50：a 最多到 -50，叠在那里；b 仍在 40。
  assert.deepEqual(placeRailCards(items, 'b', 14, -50).map((p) => p.top), [-50, 40]);
});

test('锚点缺失：紧跟上一张，不按 Infinity 甩到最后', () => {
  const items = [
    { id: 'a', anchor: 20, height: 50 },
    { id: 'b', anchor: null, height: 40 },
    { id: 'c', anchor: Infinity, height: 30 },
    { id: 'd', anchor: 400, height: 30 },
  ];
  // a 在 20，b 紧跟在 84，c 紧跟在 138，d 锚点够远仍在 400。
  assert.deepEqual(tops(items), [20, 84, 138, 400]);
});

test('选中项上面有锚点缺失的卡片：缺失的贴着选中项往上排', () => {
  const items = [
    { id: 'a', anchor: 100, height: 40 },
    { id: 'b', anchor: null, height: 30 },
    { id: 'c', anchor: 200, height: 50 },
  ];
  // 选中 c 钉在 200。b 没有自己的锚点，贴着 c 往上：200 - 14 - 30 = 156。a 锚点 100 更靠上，留在 100。
  assert.deepEqual(tops(items, 'c'), [100, 156, 200]);
});

test('编辑中钉住 top：自己留在给定高度，上面变高往上挤，不和它重叠', () => {
  const items = [
    { id: 'a', anchor: 0, height: 100 },
    { id: 'b', anchor: 40, height: 80 },
    { id: 'c', anchor: 40, height: 60 },
  ];
  // 进入编辑前 b 被下推到 114。进入那一刻不钉，对齐锚点 40；a 高 100，挤到 40 - 14 - 100 = -74。
  assert.deepEqual(placeRailCards(items, 'b', GAP, -300).map((p) => p.top), [-74, 40, 134]);
  // 之后打字：钉在 40。a 长到 200，往上挤到 -174，不把 b 推走，也不和 b 重叠。
  const grown = [
    { id: 'a', anchor: 0, height: 200 },
    { id: 'b', anchor: 40, height: 80 },
    { id: 'c', anchor: 40, height: 60 },
  ];
  assert.deepEqual(placeRailCards(grown, 'b', GAP, -300, { pinTop: 40 }).map((p) => p.top), [-174, 40, 134]);
  // 文档顶部只允许到 -50：a 叠在 -50，b 仍钉在 40。
  assert.deepEqual(placeRailCards(grown, 'b', GAP, -50, { pinTop: 40 }).map((p) => p.top), [-50, 40, 134]);
});

test('钉住的卡片锚点没了：留在钉住的高度，不掉到上一张下面', () => {
  const items = [
    { id: 'a', anchor: 0, height: 50 },
    { id: 'b', anchor: null, height: 40 },
  ];
  assert.deepEqual(placeRailCards(items, 'b', GAP, 0, { pinTop: 200 }).map((p) => p.top), [0, 200]);
});

test('选中项自己没有锚点：不当选中项钉，照普通下推', () => {
  const items = [
    { id: 'a', anchor: 0, height: 40 },
    { id: 'b', anchor: Infinity, height: 40 },
  ];
  assert.deepEqual(tops(items, 'b'), [0, 54]);
});

test('空列表与没有选中项', () => {
  assert.deepEqual(placeRailCards([], 'x', GAP), []);
  assert.deepEqual(placeRailCards(null, null, GAP), []);
});
