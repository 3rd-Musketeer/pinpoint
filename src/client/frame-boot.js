/**
 * /api/frame 嵌入页的预览脚本运行时（阶段 5）。
 * 画布把 fragment 以 innerHTML 内联进板文档（<script> 不执行），由
 * workbench/preview-mount.js 按 form A/B 契约手动挂载；frame 嵌入页是完整文档，
 * 但 data-preview-script 的语义（classic 的 root 形参、module 的默认导出
 * mount(root)）不是原生 <script> 语义 —— 端点已把预览脚本改写成惰性
 * type="text/x-pinpoint-preview"（防原生执行），这里按同一契约手动跑。
 * iframe 生命周期即页面生命周期：没有 HMR/重挂载，不产生 unmount/session 需求。
 */
(function () {
  'use strict';

  function screenLabel() {
    var screen = document.querySelector('.wb-screen[data-screen]');
    return (screen && screen.getAttribute('data-screen')) || 'frame';
  }

  function screenRootFrom(el) {
    if (!el) return null;
    if (el.classList && (el.classList.contains('ios-app') || el.classList.contains('ios-lockscreen'))) return el;
    var near = el.closest ? el.closest('.ios-app, .ios-lockscreen') : null;
    if (near) return near;
    return document.querySelector('.ios-app, .ios-lockscreen');
  }

  function resolvePreviewRoot(scriptEl) {
    var sel = scriptEl.getAttribute('data-preview-root');
    if (sel) {
      var scoped = document.querySelector(sel);
      if (scoped) return scoped;
    }
    var prev = scriptEl.previousElementSibling;
    if (prev && (prev.classList.contains('ios-app') || prev.classList.contains('ios-lockscreen'))) return prev;
    return screenRootFrom(scriptEl);
  }

  function invokeMountModule(mod, root, label) {
    var mount = mod && (typeof mod.default === 'function' ? mod.default
      : (typeof mod.mount === 'function' ? mod.mount : null));
    if (!mount) {
      console.warn('[frame-boot] ' + label + ': module has no default/mount export');
      return;
    }
    mount(root);
  }

  function importModule(url, root, label) {
    return import(/* @vite-ignore */ url)
      .then(function (mod) { invokeMountModule(mod, root, label); })
      .catch(function (err) { console.error('[frame-boot] ' + label + ' ← ' + url, err); });
  }

  function runOnePreviewScript(el) {
    var root = resolvePreviewRoot(el);
    if (!root) return Promise.resolve();
    var label = screenLabel();
    var src = el.getAttribute('data-preview-src');
    var body = (el.textContent || '').trim();
    var isModule = (el.getAttribute('data-preview-kind') || '').toLowerCase() === 'module';

    if (src) {
      return importModule(new URL(src, document.baseURI).href, root, label);
    }
    if (!body) return Promise.resolve();
    if (isModule) {
      var blob = new Blob([body + '\n//# sourceURL=preview-script/' + label + '.js'], { type: 'text/javascript' });
      var blobUrl = URL.createObjectURL(blob);
      return import(/* @vite-ignore */ blobUrl)
        .then(function (mod) {
          URL.revokeObjectURL(blobUrl);
          invokeMountModule(mod, root, label);
        })
        .catch(function (err) {
          URL.revokeObjectURL(blobUrl);
          console.error('[frame-boot] ' + label, err);
        });
    }
    try {
      var fn = new Function('root', body + '\n//# sourceURL=preview-script/' + label + '.js');
      fn(root);
    } catch (err) {
      console.error('[frame-boot] ' + label, err);
    }
    return Promise.resolve();
  }

  function runSidecarMounts() {
    // B 形态：data-preview-mount 标记根 → 同名 sidecar（<base> 已指向页面 baseUrl）。
    var roots = document.querySelectorAll('[data-preview-mount]');
    var jobs = [];
    for (var i = 0; i < roots.length; i++) {
      (function (root) {
        var screen = root.closest('[data-screen]');
        var screenId = screen && screen.getAttribute('data-screen');
        if (!screenId) return;
        jobs.push(importModule(new URL(screenId + '.js', document.baseURI).href, root, screenId));
      })(roots[i]);
    }
    return Promise.all(jobs);
  }

  function boot() {
    if (window.iOSKit && typeof window.iOSKit.refresh === 'function') window.iOSKit.refresh(document);
    var scripts = document.querySelectorAll('script[data-preview-script]');
    var jobs = [];
    for (var i = 0; i < scripts.length; i++) jobs.push(runOnePreviewScript(scripts[i]));
    jobs.push(runSidecarMounts());
    Promise.all(jobs).then(function () {
      // 内容高度可能被交互脚本改变 —— 通知不了父级也没关系（父级有延迟重测）。
      document.documentElement.setAttribute('data-frame-boot', 'done');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
