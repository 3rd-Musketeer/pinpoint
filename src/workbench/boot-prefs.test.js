// 调用真实 boot-prefs / store / prefs / page-viewports；替身只提供浏览器环境
// 与本例不消费的 UI 桥，避免把挂载判断复制成测试模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stubs = {
  './scroll-motion.js': 'export function cancelStageScroll() {}',
  './board-nav.js': 'export function refreshBoardNavigationModel() {}',
  './ann-bridge.js': 'export function annotateApi() { return null; }',
  './annotate-surface.js': 'export function annotateViewportChanged() {}',
  './embed-park.js': 'export function embedParked() { return false; } export function registerEmbedPark() {}',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/workbench/boot-prefs.js') && stubs[specifier]) {
      return { url: 'stub:boot-prefs/' + specifier, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:boot-prefs/')) {
      return { format: 'module', source: stubs[url.slice('stub:boot-prefs/'.length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

let mounted = false;
let storageWrites = 0;
const stored = new Map();
const attributes = new Map();
const css = new Map();
const frames = [];
const stage = { scrollLeft: 0, scrollTop: 0 };
const library = { offsetWidth: 486, offsetHeight: 1152, style: { setProperty() {} } };
const wrap = { style: {}, querySelector: selector => selector === '.wb-library' ? library : null };
globalThis.document = {
  getElementById: id => id === 'wbstage' ? stage : null,
  querySelector: selector => selector === '#wb-board-panel .wb-zoom-wrap' && mounted ? wrap : null,
  documentElement: {
    setAttribute: (key, value) => attributes.set(key, String(value)),
    style: { setProperty: (key, value) => css.set(key, value) },
  },
};
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => { storageWrites++; stored.set(key, value); },
};
globalThis.getComputedStyle = () => ({ getPropertyValue: key => css.get(key) ?? '' });
globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };

const boot = await import('./boot-prefs.js');
const { wbGet, wbSet } = await import('./app/store.js');
const { savePrefs, readPrefs } = await import('./lib/prefs.js');
const { pageViewport } = await import('./lib/page-viewports.js');
const { BoardMountManager } = await import('./lib/board-mount-session.js');
hooks.deregister();
const manager = new BoardMountManager();
boot.initBootPrefs({ mountManager: manager });

function boardState(pageId = 'e2e-anchor', tabId = null, shell = 'app') {
  return { pageId, tabId, board: {
    sections: [{ id: 'main', screens: [{ id: 'anchor', shell }] }],
    ...(tabId ? { tabs: [{ id: 'a' }, { id: 'b' }] } : {}),
  } };
}
function reset() {
  manager.cancel();
  while (frames.length) frames.shift()();
  mounted = false;
  stage.scrollLeft = stage.scrollTop = 0;
  css.set('--wb-board-zoom', '1');
  savePrefs({ pageViewports: {} });
  storageWrites = 0;
  wbSet({ activePageId: 'e2e-anchor', activeBoard: null, activeEntryId: '@canvas', pageManifest: null });
}
function mount(active = boardState()) {
  mounted = true;
  wbSet({ activeBoard: active });
  manager.begin(active.pageId).settleBoard(true);
}

test('早到 HMR 快照不能创建视口存档，初次装板仍走无存档恢复分支', () => {
  reset();
  boot.snapshotPageViewport('e2e-anchor'); // 真实 HMR 调用的统一产品边界
  assert.equal(pageViewport('e2e-anchor'), null, '未挂载的空舞台不能发布零位存档');
  assert.equal(storageWrites, 0);
  mount();
  assert.equal(boot.restorePageViewportAfterMount('e2e-anchor'), false);
});

test('早到快照保留已有非零与缩放存档；store 和真实画布 DOM 必须同时就绪', () => {
  reset();
  const saved = { scrollLeft: 2100, scrollTop: 2600, canvasZoom: '1.5' };
  savePrefs({ pageViewports: { 'e2e-anchor': saved } });
  storageWrites = 0;
  manager.begin('e2e-anchor').settleBoard(true);
  const pending = [
    { active: null, dom: false },
    { active: boardState(), dom: false },
    { active: null, dom: true },
    { active: boardState('other-page'), dom: true },
  ];
  for (const { active, dom } of pending) {
    mounted = dom;
    wbSet({ activeBoard: active });
    boot.snapshotPageViewport('e2e-anchor');
    assert.deepEqual(pageViewport('e2e-anchor'), saved);
  }
  assert.equal(storageWrites, 0);
  mounted = true;
  wbSet({ activeBoard: boardState() });
  for (const state of ['pending', 'cancelled', 'other-page']) {
    const session = manager.begin(state === 'other-page' ? state : 'e2e-anchor');
    if (state !== 'pending') session.settleBoard(true);
    if (state === 'cancelled') session.cancel();
    boot.snapshotPageViewport('e2e-anchor');
    assert.deepEqual(pageViewport('e2e-anchor'), saved);
  }
  assert.equal(storageWrites, 0);
  mount();
  assert.equal(boot.restorePageViewportAfterMount('e2e-anchor'), true);
  assert.deepEqual([stage.scrollLeft, stage.scrollTop], [2100, 2600]);
  assert.equal(css.get('--wb-board-zoom'), '1.5');
});

test('已挂载的正常 HMR 和离页快照允许合法零位及非零，并可恢复缩放', () => {
  reset();
  mount();
  for (const [left, top, zoom] of [[0, 0, '0.75'], [2200, 2700, '1.25']]) {
    stage.scrollLeft = left; stage.scrollTop = top;
    css.set('--wb-board-zoom', zoom);
    boot.snapshotPageViewport('e2e-anchor');
    assert.deepEqual(pageViewport('e2e-anchor'), { scrollLeft: left, scrollTop: top, canvasZoom: zoom });
    stage.scrollLeft = stage.scrollTop = 99;
    assert.equal(boot.restorePageViewportAfterMount('e2e-anchor'), true);
    assert.deepEqual([stage.scrollLeft, stage.scrollTop], [left, top]);
    assert.equal(css.get('--wb-board-zoom'), zoom);
  }
});

test('文档 html 形态仍跳过快照和恢复，tab 视口存档互不覆盖', () => {
  reset();
  mount(boardState('e2e-anchor', null, 'doc'));
  boot.snapshotPageViewport('e2e-anchor');
  assert.equal(pageViewport('e2e-anchor'), null);
  assert.equal(boot.restorePageViewportAfterMount('e2e-anchor'), false);
  for (const [tab, left] of [['a', 2200], ['b', 2400]]) {
    mount(boardState('e2e-anchor', tab));
    stage.scrollLeft = left; stage.scrollTop = 2500;
    boot.snapshotPageViewport('e2e-anchor');
  }
  assert.equal(pageViewport('e2e-anchor'), null);
  assert.equal(pageViewport('e2e-anchor::a').scrollLeft, 2200);
  assert.equal(pageViewport('e2e-anchor::b').scrollLeft, 2400);
  mount(boardState('e2e-anchor', 'a'));
  assert.equal(boot.restorePageViewportAfterMount('e2e-anchor'), true);
  assert.equal(stage.scrollLeft, 2200);
});

test('已挂载快照仍收尾待保存缩放和滚动防抖，不让迟到写覆盖快照', t => {
  reset();
  mount();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  boot.setCanvasZoom('1.75', { save: true });
  stage.scrollLeft = 2200; stage.scrollTop = 2600;
  boot.scheduleViewportScrollSave();
  boot.snapshotPageViewport('e2e-anchor');
  assert.deepEqual(pageViewport('e2e-anchor'), { scrollLeft: 2200, scrollTop: 2600, canvasZoom: '1.75' });
  const writes = storageWrites;
  stage.scrollLeft = stage.scrollTop = 9;
  t.mock.timers.tick(301);
  assert.equal(storageWrites, writes);
  assert.deepEqual(readPrefs().pageViewports['e2e-anchor'], { scrollLeft: 2200, scrollTop: 2600, canvasZoom: '1.75' });
  assert.equal(wbGet().activePageId, 'e2e-anchor');
});
