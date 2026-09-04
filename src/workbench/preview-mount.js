// Workbench 预览脚本挂载簇（form A/B）与挂载后处理。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
import { wbGet } from './app/store.js';
import { COMPONENTS_ID, pageBaseUrl } from './lib/page-url.js';
import { wireExportControls } from './export-core.js';
import {
  focusFirstBoardFrame,
  frameBoardInView,
  rebuildSectionNavigator,
  scheduleMinimapUpdate
} from './board-nav.js';
import { restorePageViewportAfterMount, syncPanelPrefs } from './boot-prefs.js';
import { annotateApi, scheduleAnnSnap } from './ann-bridge.js';
import { cssImportUrls } from './lib/sidecar-css.js';

// 反向依赖注入：wireLibraryScrollSpy 属 pages.js 簇，沿用 initPreviewMount(deps)
// 注入（历史上由 workbench.js 持有，DI 通道保留）。标注面板刷新不再是 DI ——
// 直接 import ann-bridge 的 scheduleAnnSnap。（boot-prefs 同走直接 import。）
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

// P2 收尾说明：这里 bust 的是浏览器动态 import() 的模块缓存，不是 fetch 缓存
// —— 不归 TanStack Query 管。每次挂载（session.generation 递增）都要拿到干净的
// 模块实例（sidecar 可能有模块级状态），HMR 改文件后也必须重新 import；
// 不能用 query 的 dataUpdatedAt 当 token —— 缓存回填的重挂载 dataUpdatedAt 不变，
// 模块级状态会跨挂载泄漏。所以保留 generation 作 token，仅正名。
function moduleBustUrl(url, generation) {
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  return url + sep + 'mount=' + generation;
}

/* frame 内资源没进来时的行内提示（2026-09-04，BACKLOG「改 registry id 后
   /sites/<旧 id>/ 资源静默 404」候选 ③）。旧行为：CSS 的 @import 404 无任何反馈，
   JS sidecar 404 只进 console —— 机壳和内联 HTML 还在，脚本注入的卡 / modal 整段
   消失，看起来像设计坏了。现在在那个 frame 上挂一条 .wb-asset-err 条，把打不开的
   url 逐条写出来。带 data-ann-ui：不是原型内容，标注与选中判定让开它。 */
function noteAssetFailure(el, url) {
  var host = el && el.closest ? el.closest('.wb-screen') : null;
  if (!host || !url) return;
  var box = host.querySelector('.wb-asset-err');
  if (!box) {
    box = document.createElement('div');
    box.className = 'wb-asset-err';
    box.setAttribute('data-ann-ui', '');
    var title = document.createElement('p');
    title.className = 'wb-asset-err-title';
    title.textContent = '资源打不开';
    box.appendChild(title);
    host.appendChild(box);
  }
  var listed = box.querySelectorAll('[data-asset-url]');
  for (var i = 0; i < listed.length; i++) {
    if (listed[i].getAttribute('data-asset-url') === url) return;
  }
  var line = document.createElement('p');
  line.className = 'wb-asset-err-src';
  line.setAttribute('data-asset-url', url);
  line.textContent = url;
  box.appendChild(line);
}

/* CSS 侧没有 onerror 可听（@import 失败是静默的），所以装载后按同源绝对路径
   探一次存在性。只探 '/' 开头的 url —— 相对路径已被 lib/sidecar-css.js 改写成
   pageBaseUrl 前缀，跨域资源不归我们判。 */
function probeFragmentStyles(panel, session) {
  if (!panel) return;
  panel.querySelectorAll('.wb-screen').forEach(function (screen) {
    var urls = [];
    screen.querySelectorAll('style').forEach(function (node) {
      cssImportUrls(node.textContent).forEach(function (url) { urls.push(url); });
    });
    screen.querySelectorAll('link[rel~="stylesheet"]').forEach(function (node) {
      urls.push(node.getAttribute('href') || '');
    });
    var seen = {};
    urls.forEach(function (url) {
      if (!url || url.charAt(0) !== '/' || seen[url]) return;
      seen[url] = true;
      fetch(url).then(function (res) {
        if (res.ok || !session.isUsable(screen)) return;
        noteAssetFailure(screen, url);
      }, function () {
        if (session.isUsable(screen)) noteAssetFailure(screen, url);
      });
    });
  });
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

function importPreviewModule(url, root, label, session, declared) {
  // 两段 catch 分工：前一段是 sidecar 本身没进来（404 / 求值失败），后一段是
  // mount 自己抛的产品逻辑错误 —— 后者只进 console。
  // declared = 作者在片段里显式写了 src：那条 url 打不开是真故障，在 frame 上
  // 显式报。约定式 sidecar（<screenId>.js，data-preview-mount 隐式探的那条）
  // 本来就允许不存在 —— 每个 doc 屏都会探一次，报出来全是噪音。
  return import(/* @vite-ignore */ moduleBustUrl(url, session.generation))
    .catch(function (err) {
      console.error('[preview-script] ' + label + ' ← ' + url, err);
      if (declared) noteAssetFailure(root, url);
      return null;
    })
    .then(function (mod) {
      if (mod) return invokeMountModule(mod, root, label, session);
    })
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
    return importPreviewModule(resolveSidecarUrl(pageId, screenId, srcAttr), root, label, session, true);
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
      jobs.push(importPreviewModule(url, root, screenId, session, false));
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
      probeFragmentStyles(panel, session);
      return runPreviewScripts(panel, session.pageId, session).then(function () {
        if (!session.isUsable(panel)) return;
        // Coalesce the post-script DOM batch into one frame so layout
        // reads/writes (navigator positions, frame-in-view, ann panel) batch.
        requestAnimationFrame(function () {
          if (!session.isUsable(panel)) return;
          var _a = annotateApi(); if (_a) _a.render();
          rebuildSectionNavigator(panel);
          mountDeps.wireLibraryScrollSpy();
          if (!hadViewport && !focusFirstBoardFrame()) frameBoardInView(panel, { pageId: session.pageId });
          scheduleAnnSnap();
          scheduleMinimapUpdate();
        });
      });
  }, 0);
}
