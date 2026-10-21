// B 的可执行反例转为健康判据：真实 afterMount/chrome-ready/session 与
// boot-prefs/store/prefs，环境只给单 comp 帧；UI/几何桥不承担保存或ready逻辑。
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

globalThis.__viewportMountProbe = { focus: 0 };
const stubs = {
  './scroll-motion.js': 'export function cancelStageScroll() {}',
  './board-nav.js': `export function refreshBoardNavigationModel() {} export function initializeBoardGeometry() {}
    export function focusFirstBoardFrame() { globalThis.__viewportMountProbe.focus++; return true; }
    export function frameBoardInView() { throw new Error('首帧存在，不应走fallback'); }`,
  './ann-bridge.js': 'export function annotateApi() { return null; } export function scheduleAnnSnap() {}',
  './annotate-surface.js': 'export function annotateViewportChanged() {}',
  './embed-park.js': 'export function embedParked() { return false; } export function registerEmbedPark() {}',
  './pages.js': 'export function wireLibraryScrollSpy() {}',
  './export-core.js': 'export function wireExportControls() {}',
  './frame-reset.js': 'export function rememberBoard() {}',
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (/\/workbench\/(boot-prefs|preview-mount)\.js$/.test(context.parentURL || '') && stubs[specifier]) {
      return { url: 'stub:viewport-mount/' + specifier, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('stub:viewport-mount/')) {
      return { format: 'module', source: stubs[url.slice('stub:viewport-mount/'.length)], shortCircuit: true };
    }
    return next(url, context);
  },
});
const stored = new Map();
const css = new Map([['--wb-board-zoom', '1']]);
const frames = [];
const stage = { scrollLeft: 0, scrollTop: 0 };
const library = { offsetWidth: 486, offsetHeight: 1152, style: { setProperty() {} } };
const wrap = { style: {}, querySelector: s => s === '.wb-library' ? library : null };
const screen = { querySelectorAll: () => [] };
const panel = { isConnected: true, querySelectorAll: s => s === '.wb-screen' ? [screen] : [] };
globalThis.document = {
  getElementById: id => id === 'wbstage' ? stage : null,
  querySelector: s => s === '#wb-board-panel .wb-zoom-wrap' ? wrap : null,
  documentElement: { setAttribute() {}, style: { setProperty: (key, value) => css.set(key, value) } },
};
globalThis.window = {};
globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
globalThis.getComputedStyle = () => ({ getPropertyValue: key => css.get(key) ?? '' });
globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
globalThis.fetch = () => { throw new Error('network forbidden'); };

const boot = await import('./boot-prefs.js');
const { afterMount } = await import('./preview-mount.js');
const { markChromeReady } = await import('./lib/chrome-ready.js');
const { BoardMountManager } = await import('./lib/board-mount-session.js');
const { wbSet } = await import('./app/store.js');
const { savePrefs } = await import('./lib/prefs.js');
const { pageViewport } = await import('./lib/page-viewports.js');
hooks.deregister();
const manager = new BoardMountManager();
boot.initBootPrefs({ mountManager: manager });
function drainFrames() { while (frames.length) frames.shift()(); }
function reset() {
  manager.cancel();
  drainFrames();
  savePrefs({ pageViewports: {} });
  stage.scrollLeft = stage.scrollTop = 0;
  css.set('--wb-board-zoom', '1');
  globalThis.__viewportMountProbe.focus = 0;
  wbSet({ activePageId: 'anchor', activeEntryId: '@canvas', activeBoard: {
    pageId: 'anchor', board: { sections: [{ id: 'main', screens: [{ id: 'first', shell: 'comp' }] }] },
  } });
}

test('chrome 尚未就绪时早到 HMR 快照不抑制新会话的首访聚焦', async () => {
  reset();
  const first = manager.begin('anchor');
  const waiting = afterMount(panel, first);
  boot.snapshotPageViewport('anchor');
  const premature = pageViewport('anchor');
  const second = manager.begin('anchor');
  const reloaded = afterMount(panel, second);
  markChromeReady();
  await Promise.all([waiting, reloaded]);
  drainFrames();
  assert.equal(premature, null, 'DOM就位但chrome未就绪时不能创建视口存档');
  assert.equal(globalThis.__viewportMountProbe.focus, 1);
  assert.equal(await first.boardSettled, false);
  assert.equal(await second.boardSettled, true);
});

test('几何 rAF 尚未执行时早到 HMR 快照不抑制新会话的首访聚焦', async () => {
  reset();
  const first = manager.begin('anchor');
  await afterMount(panel, first);
  assert.ok(frames.length, '真实afterMount已经排入几何rAF');
  boot.snapshotPageViewport('anchor');
  const premature = pageViewport('anchor');
  const second = manager.begin('anchor');
  await afterMount(panel, second);
  drainFrames();
  assert.equal(premature, null, '首访聚焦未落定时不能创建视口存档');
  assert.equal(globalThis.__viewportMountProbe.focus, 1);
  assert.equal(await first.boardSettled, false);
  assert.equal(await second.boardSettled, true);
});

test('无早到快照的真实挂载对照会聚焦，落定后允许零位和非零缩放快照', async () => {
  reset();
  const session = manager.begin('anchor');
  await afterMount(panel, session);
  drainFrames();
  assert.equal(await session.boardSettled, true);
  assert.equal(globalThis.__viewportMountProbe.focus, 1);
  assert.equal(pageViewport('anchor'), null);
  for (const [left, top, zoom] of [[0, 0, '1'], [2200, 2600, '1.5']]) {
    stage.scrollLeft = left; stage.scrollTop = top;
    css.set('--wb-board-zoom', zoom);
    boot.snapshotPageViewport('anchor');
    assert.deepEqual(pageViewport('anchor'), { scrollLeft: left, scrollTop: top, canvasZoom: zoom });
  }
  manager.cancel();
});
