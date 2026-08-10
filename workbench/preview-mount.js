// Workbench 预览脚本挂载簇（form A/B）与挂载后处理。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
import { wbGet } from './app/store.js';
import { COMPONENTS_ID, pageBaseUrl } from './lib/page-url.js';
import { wireExportControls } from './export-core.js';
import {
  frameBoardInView,
  rebuildSectionNavigator,
  scheduleMinimapUpdate
} from './board-nav.js';
import { restorePageViewportAfterMount, syncPanelPrefs } from './boot-prefs.js';

// 反向依赖注入：annotateApi / wireLibraryScrollSpy / refreshAnnPanel 还留在
// workbench.js（标注簇，后续轮次才拆），preview-mount 不得 import workbench.js，
// 由它在初始化时经 initPreviewMount(deps) 注入。
// （boot-prefs 簇的 syncPanelPrefs/restorePageViewportAfterMount 走直接 import。）
var mountDeps = {};

export function initPreviewMount(deps) {
  mountDeps = deps || {};
}

/**
 * Interactive frames (A+B) — screen HTML is mounted via innerHTML, so <script>
 * never runs by itself. Framework only mounts; product logic stays in the screen.
 *
 * A — inline in the same HTML:
 *   <script data-preview-script>… uses `root`; may return unmount …</script>
 *   <script type="module" data-preview-script>
 *     export default function mount(root) { return unmount; }
 *   </script>
 *
 * B — sidecar next to the screen (preferred when logic grows):
 *   previews/<page>/<screenId>.js  →  export default function mount(root) {…}
 *   Opt in with data-preview-mount on .ios-app / .ios-lockscreen, or
 *   <script type="module" data-preview-script src="./screenId.js"></script>
 *
 * root = nearest .ios-app / .ios-lockscreen (override: data-preview-root="css").
 * Do not put product gestures in ios-kit.js.
 */
function screenRootFrom(el) {
  if (!el) return null;
  if (el.classList && (el.classList.contains('ios-app') || el.classList.contains('ios-lockscreen'))) {
    return el;
  }
  var near = el.closest ? el.closest('.ios-app, .ios-lockscreen') : null;
  if (near) return near;
  var screen = el.closest ? el.closest('.wb-screen') : null;
  if (!screen) return null;
  return screen.querySelector('.ios-app, .ios-lockscreen') || screen;
}

function resolvePreviewRoot(scriptEl) {
  var screen = scriptEl.closest('.wb-screen');
  var sel = scriptEl.getAttribute('data-preview-root');
  if (sel) {
    var scoped = (screen || document).querySelector(sel);
    if (scoped) return scoped;
  }
  var prev = scriptEl.previousElementSibling;
  if (prev && (prev.classList.contains('ios-app') || prev.classList.contains('ios-lockscreen'))) {
    return prev;
  }
  return screenRootFrom(scriptEl);
}

function previewScriptLabel(el) {
  var screen = el && el.closest && el.closest('[data-screen]');
  return (screen && screen.getAttribute('data-screen')) || 'preview';
}

function cacheBust(url, generation) {
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  return url + sep + 'mount=' + generation;
}

function resolveSidecarUrl(pageId, screenId, src) {
  // dynamic import() rejects bare specifiers — sidecar URLs must start with '/'
  if (src) {
    if (/^(https?:|\/|blob:)/.test(src)) return src;
    src = String(src).replace(/^\.\//, '');
    return pageBaseUrl(wbGet().pageManifest, pageId) + src;
  }
  return pageBaseUrl(wbGet().pageManifest, pageId) + screenId + '.js';
}

function invokeMountModule(mod, root, label, session) {
  if (!mod || !session.isUsable(root)) return;
  var mount = typeof mod.default === 'function' ? mod.default
    : (typeof mod.mount === 'function' ? mod.mount : null);
  if (!mount) {
    console.warn('[preview-script] ' + label + ': module has no default/mount export');
    return;
  }
  var ret = mount(root);
  if (ret && typeof ret.then === 'function') {
    return ret.then(function (v) { session.trackDisposer(v, root); });
  }
  session.trackDisposer(ret, root);
  if (typeof mod.unmount === 'function') {
    session.trackDisposer(function () { mod.unmount(root); }, root);
  }
}

function importPreviewModule(url, root, label, session) {
  return import(/* @vite-ignore */ cacheBust(url, session.generation))
    .then(function (mod) { return invokeMountModule(mod, root, label, session); })
    .catch(function (err) {
      console.error('[preview-script] ' + label + ' ← ' + url, err);
    });
}

function runOnePreviewScript(el, pageId, session) {
  if (!el || el.dataset.previewBound === '1' || !session.isUsable(el)) return Promise.resolve();
  el.dataset.previewBound = '1';
  var root = resolvePreviewRoot(el);
  if (!root) return Promise.resolve();
  var label = previewScriptLabel(el);
  var srcAttr = el.getAttribute('src') || el.getAttribute('data-preview-src');
  var body = (el.textContent || '').trim();
  var isModule = (el.getAttribute('type') || '').toLowerCase() === 'module';

  if (srcAttr) {
    var screen = el.closest('[data-screen]');
    var screenId = (screen && screen.getAttribute('data-screen')) || label;
    return importPreviewModule(resolveSidecarUrl(pageId, screenId, srcAttr), root, label, session);
  }

  if (!body) return Promise.resolve();

  if (isModule) {
    var blob = new Blob(
      [body + '\n//# sourceURL=preview-script/' + label + '.js'],
      { type: 'text/javascript' }
    );
    var blobUrl = URL.createObjectURL(blob);
    return import(/* @vite-ignore */ blobUrl)
      .then(function (mod) {
        URL.revokeObjectURL(blobUrl);
        return invokeMountModule(mod, root, label, session);
      })
      .catch(function (err) {
        URL.revokeObjectURL(blobUrl);
        console.error('[preview-script] ' + label, err);
      });
  }

  try {
    var fn = new Function('root', body + '\n//# sourceURL=preview-script/' + label + '.js');
    if (session.isUsable(root)) session.trackDisposer(fn(root), root);
  } catch (err) {
    console.error('[preview-script] ' + label, err);
  }
  return Promise.resolve();
}

/** B: roots marked data-preview-mount load previews/<page>/<screenId>.js */
function runSidecarMounts(scope, pageId, session) {
  if (!scope || pageId === COMPONENTS_ID || !session.active) return Promise.resolve();
  var roots = scope.querySelectorAll('[data-preview-mount]');
  var jobs = [];
  for (var i = 0; i < roots.length; i++) {
    (function (root) {
      if (root.dataset.previewBound === '1') return;
      root.dataset.previewBound = '1';
      var screen = root.closest('[data-screen]');
      var screenId = screen && screen.getAttribute('data-screen');
      if (!screenId) return;
      var url = resolveSidecarUrl(pageId, screenId, null);
      jobs.push(importPreviewModule(url, root, screenId, session));
    })(roots[i]);
  }
  return Promise.all(jobs);
}

function runPreviewScripts(scope, pageId, session) {
  if (!scope || !session.active) return Promise.resolve();
  var list = scope.querySelectorAll('script[data-preview-script]');
  var jobs = [];
  for (var i = 0; i < list.length; i++) {
    jobs.push(runOnePreviewScript(list[i], pageId, session));
  }
  jobs.push(runSidecarMounts(scope, pageId, session));
  return Promise.all(jobs);
}

export function afterMount(panel, session) {
  return session.defer(function () {
      if (!session.isUsable(panel)) return;
      // Board phones keep intrinsic size; zoom is on .wb-library, not per-stage fit.
      panel.querySelectorAll('.ios-stage[data-fit]').forEach(function (s) {
        s.removeAttribute('data-fit');
        var device = s.querySelector('.ios-device');
        if (device) device.style.setProperty('--ios-scale', '1');
      });
      syncPanelPrefs(panel);
      wireExportControls(panel);
      var hadViewport = restorePageViewportAfterMount(session.pageId);
      if (window.iOSKit) window.iOSKit.refresh(panel);
      return runPreviewScripts(panel, session.pageId, session).then(function () {
        if (!session.isUsable(panel)) return;
        // Coalesce the post-script DOM batch into one frame so layout
        // reads/writes (navigator positions, frame-in-view, ann panel) batch.
        requestAnimationFrame(function () {
          if (!session.isUsable(panel)) return;
          var _a = mountDeps.annotateApi(); if (_a) _a.render();
          rebuildSectionNavigator(panel);
          mountDeps.wireLibraryScrollSpy();
          if (!hadViewport) frameBoardInView(panel, { pageId: session.pageId });
          mountDeps.refreshAnnPanel();
          scheduleMinimapUpdate();
        });
      });
  }, 0);
}
