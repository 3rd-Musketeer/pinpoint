import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

// r5 W2 回归：`workbench:ready` 原来先于 pageChangeListeners 初始化与 store 订阅
// 发出，与注释宣称的顺序相反 —— ready 回调里同步 onPageChange 会在 undefined 上
// push 崩掉。stage.js 是浏览器入口，单测够不着运行时，这里锁源码顺序：监听表与
// store 订阅都必须排在 dispatch 之前。
test('workbench:ready 在 pageChangeListeners 与 activePageId 订阅就位之后发出', () => {
  var src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'stage.js'),
    'utf8'
  );
  var at = (needle) => src.indexOf(needle);
  var listenersInit = at('var pageChangeListeners = [];');
  var subscribe = at('useWorkbenchStore.subscribe(function (s) { return s.activePageId; }');
  var dispatch = at("dispatchEvent(new Event('workbench:ready'))");
  assert.ok(listenersInit >= 0, 'pageChangeListeners 初始化没找到');
  assert.ok(subscribe >= 0, 'activePageId 订阅没找到');
  assert.ok(dispatch >= 0, 'workbench:ready 广播没找到');
  assert.ok(listenersInit < dispatch, 'pageChangeListeners 必须先于 workbench:ready 初始化');
  assert.ok(subscribe < dispatch, 'activePageId 订阅必须先于 workbench:ready 挂上');
});
