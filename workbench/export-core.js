// Workbench export cluster — 导出 picker 的快照构建与请求（图片/zip）、文档导出
// 对话框、frame ⋯ 菜单 shell。
// P1 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
// 共享状态经 app/store.js 的 wbGet()/wbSet() 读写；escHtml、pageBaseUrl 取自 lib/。
// P2 说明：导出 POST（/api/export-image、/api/export-zip、/api/export-doc-tokens、
// /api/export-doc）是下载流 / 一次性计算，不是可缓存的 server state —— 保持 plain
// fetch，不走 Query（docTokenCache 只是对话框打开期间的估算回显缓存，同样无失效语义）。
// P3 说明：frame ⋯ 菜单的行为（trigger aria / Esc / 点外关闭 / roving focus）由
// Radix DropdownMenu 承载 —— 本模块只创建 shell 元素，React 岛（app/frame-menu.jsx）
// 经 initExportCore(deps) 注入的 mountFrameMenu/sweepFrameMenus 挂载与回收。
// 2026-08-15d 收敛：图片导出的唯一入口 = HUD「导出」→ app/ExportPicker.jsx
// （React 岛，单向 import 本模块的快照/请求函数）；旧 per-frame/per-section
// 触发器、旧导出对话框（预设/格式/清晰度 radio + 复制 PNG）已退役，图纸内容
// （图注/尺寸/frame note）永随导出。
import { wbGet, activeBoardMode } from './app/store.js';
import { escHtml } from './lib/esc-html.js';
import { pageBaseUrl } from './lib/page-url.js';

// 反向依赖注入：React 岛挂载器属 app/ 簇，本模块不得 import app/ 组件，
// 由 app/main.jsx 在初始化时经 initExportCore(deps) 注入。
var exportDeps = {};

export function initExportCore(deps) {
  exportDeps = deps || {};
}

var EXPORT_TOKEN_NAMES = [
  '--wb-phone-w', '--wb-phone-h', '--wb-cap-section', '--wb-cap-screen', '--wb-cap-note', '--wb-cap-gap', '--wb-cap-ref',
  '--wb-fg', '--wb-muted', '--wb-faint', '--wb-side', '--wb-line', '--wb-hover', '--wb-accent'
];

function syncExportDomState(source, clone) {
  var sources = [source].concat(Array.prototype.slice.call(source.querySelectorAll('*')));
  var clones = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
  sources.forEach(function (node, index) {
    var copy = clones[index];
    if (!copy) return;
    if (node instanceof HTMLInputElement) {
      copy.value = node.value;
      copy.setAttribute('value', node.value);
      if (node.checked) copy.setAttribute('checked', '');
      else copy.removeAttribute('checked');
    } else if (node instanceof HTMLTextAreaElement) {
      copy.value = node.value;
      copy.textContent = node.value;
    } else if (node instanceof HTMLSelectElement) {
      Array.prototype.forEach.call(copy.options, function (option, optionIndex) {
        option.selected = node.options[optionIndex] && node.options[optionIndex].selected;
      });
    } else if (node instanceof HTMLDetailsElement) {
      copy.open = node.open;
    } else if (node instanceof HTMLCanvasElement) {
      try {
        var image = document.createElement('img');
        image.src = node.toDataURL('image/png');
        image.width = node.width;
        image.height = node.height;
        image.style.cssText = node.style.cssText;
        image.className = copy.className;
        copy.replaceWith(image);
      } catch (e) { /* a tainted canvas remains blank instead of breaking export */ }
    }
    if (node.scrollTop || node.scrollLeft) {
      copy.setAttribute('data-export-scroll-top', String(node.scrollTop));
      copy.setAttribute('data-export-scroll-left', String(node.scrollLeft));
    }
  });
}

// 图纸内容永随（decisions 2026-08-15d）：图注（引用号 + 屏名）、尺寸行、frame note
// 一律随导出，不再有「干净画面」摘图注语义；editor 控件与 export UI 仍然摘除。
// 空 note（占位文案）不是图纸内容，摘掉。
function cleanExportClone(clone) {
  clone.querySelectorAll('script,style[data-export-ui],[data-export-ui],.wb-frame-note-edit,.wb-frame-note-editor').forEach(function (node) {
    node.remove();
  });
  clone.querySelectorAll('.wb-frame-note.is-empty').forEach(function (node) { node.remove(); });
  clone.querySelectorAll('[data-frame-note-view]').forEach(function (node) { node.hidden = false; });
  clone.removeAttribute('data-export-ui');
  clone.querySelectorAll('.has-frame-menu').forEach(function (node) { node.classList.remove('has-frame-menu'); });
  return clone;
}

function exportTokens() {
  var library = document.querySelector('#wb-board-panel .wb-library');
  if (!library) return {};
  var computed = getComputedStyle(library);
  var tokens = {};
  EXPORT_TOKEN_NAMES.forEach(function (name) {
    var value = computed.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  });
  return tokens;
}

function resolveExportTarget(options) {
  options = options || {};
  if (options.target instanceof Element) return options.target;
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return null;
  if (options.kind === 'section') {
    return panel.querySelector('.wb-lib-item[data-ann-section="' + CSS.escape(options.sectionId || '') + '"]');
  }
  return panel.querySelector('[data-screen="' + CSS.escape(options.screenId || '') + '"]');
}

export function buildExportSnapshot(options) {
  options = options || {};
  var kind = options.kind === 'section' ? 'section' : 'frame';
  var target = resolveExportTarget(options);
  if (!target) throw new Error('找不到要导出的 ' + (kind === 'frame' ? 'Frame' : 'Section'));
  var section = kind === 'section' ? target : target.closest('.wb-lib-item');
  var screen = kind === 'frame' ? target.closest('[data-screen]') : null;
  var source;
  source = target;
  if (!source) throw new Error('目标没有可导出的视觉内容');
  var clone = source.cloneNode(true);
  syncExportDomState(source, clone);
  cleanExportClone(clone);
  return {
    kind: kind,
    pageId: wbGet().activePageId,
    sectionId: section.getAttribute('data-ann-section') || section.getAttribute('data-ann-group'),
    screenId: screen ? screen.getAttribute('data-screen') : '',
    format: options.format === 'webp' ? 'webp' : 'png',
    scale: Number(options.scale) === 1 ? 1 : 2,
    background: options.background || 'canvas',
    tokens: exportTokens(),
    html: clone.outerHTML
  };
}

function exportFileName(request) {
  var ids = [request.pageId, request.sectionId];
  if (request.kind === 'frame') ids.push(request.screenId);
  return ids.join('__').replace(/\//g, '-') + '@' + request.scale + 'x.' + request.format;
}

function postExportSnapshot(request) {
  return fetch('/api/export-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }).then(function (response) {
    if (!response.ok) return response.json().catch(function () { return {}; }).then(function (body) {
      throw new Error(body.message || ('导出失败 · ' + response.status));
    });
    return response.blob().then(function (blob) {
      return {
        blob: blob,
        filename: exportFileName(request),
        width: Number(response.headers.get('X-Export-Width')) || 0,
        height: Number(response.headers.get('X-Export-Height')) || 0,
        request: request
      };
    });
  });
}

export function requestExportImage(options) {
  return postExportSnapshot(buildExportSnapshot(options));
}

// 预览档（picker 右栏）：调用方已持有 buildExportSnapshot 产物（scale 1），
// 跳过重复快照直接 POST。picker 用它按帧取回低清 PNG 做并排预览。
export function requestExportPreview(request) {
  return postExportSnapshot(request);
}

// 多张打包（decisions 2026-08-15d）：snapshot 数组 → /api/export-zip → zip 流。
export function requestExportZip(requests) {
  return fetch('/api/export-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: requests })
  }).then(function (response) {
    if (!response.ok) return response.json().catch(function () { return {}; }).then(function (body) {
      throw new Error(body.message || ('打包失败 · ' + response.status));
    });
    var fallback = (requests[0] && requests[0].pageId || 'export') + '__frames@2x.zip';
    return response.blob().then(function (blob) {
      return {
        blob: blob,
        filename: filenameFromContentDisposition(response.headers.get('Content-Disposition'), fallback),
        entries: Number(response.headers.get('X-Export-Entries')) || requests.length
      };
    });
  });
}

export function downloadExportResult(result) {
  var url = URL.createObjectURL(result.blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  var star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch (e) { /* keep fallback */ }
  }
  var plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

export function activeDocExportTarget() {
  var panel = document.getElementById('wb-board-panel');
  var active = wbGet().activeBoard;
  if (activeBoardMode() !== 'html' || !panel || !active) return null;
  var screenNode = panel.querySelector('.wb-screen:not([data-doc-hidden])[data-screen]');
  if (!screenNode) return null;
  var screenId = screenNode.getAttribute('data-screen');
  var title = screenId;
  var src = null;
  (active.board.sections || []).forEach(function (sec) {
    (sec.screens || []).forEach(function (sc) {
      if (sc.id !== screenId) return;
      title = sc.title || sc.id;
      src = sc.src || (pageBaseUrl(wbGet().pageManifest, active.pageId) + sc.id + '.html');
    });
  });
  if (!src) {
    var frame = screenNode.querySelector('.wb-doc-frame');
    var attr = frame && frame.getAttribute('src');
    if (attr) src = attr;
  }
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) {
    try { src = new URL(src, location.href).pathname; } catch (e) { return null; }
  }
  src = String(src).replace(/^\/+/, '');
  if (src.indexOf('previews/') !== 0 && src.indexOf('sites/') !== 0) return null;
  return {
    pageId: active.pageId,
    screenId: screenId,
    title: title,
    src: src
  };
}

var docExportDialog = null;
var docTokenCache = {};
var docTokenRequestSeq = 0;

function requestDocTokenEstimate(src, mode, comments) {
  var key = mode + '\0' + (comments ? '1' : '0') + '\0' + src;
  if (docTokenCache[key]) return Promise.resolve(docTokenCache[key]);
  var body = { src: src, mode: mode, comments: !!comments };
  if (mode === 'image') {
    body.scale = 2;
    body.viewportWidth = comments ? 1184 : 920;
  }
  return fetch('/api/export-doc-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (response) {
    if (!response.ok) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.message || ('token 估算失败 · ' + response.status));
      });
    }
    return response.json();
  }).then(function (estimate) {
    docTokenCache[key] = estimate;
    return estimate;
  });
}

function renderDocTokenEstimate(estimate) {
  var row = docExportDialog && docExportDialog.querySelector('[data-export-tokens]');
  if (!row) return;
  if (!estimate || !estimate.providers) {
    row.hidden = true;
    row.innerHTML = '';
    row.removeAttribute('title');
    return;
  }
  row.hidden = false;
  var sizeLine = estimate.mode === 'image' && estimate.width && estimate.height
    ? estimate.width + '×' + estimate.height + 'px\n'
    : '';
  row.title = sizeLine + estimate.providers.map(function (p) {
    return p.label + ' ' + p.tokens.toLocaleString('en-US') + ' · ' + p.detail;
  }).join('\n');
  row.innerHTML = estimate.providers.map(function (p) {
    return '<span class="wb-export-token"><span class="wb-export-token-label">' + escHtml(p.label) +
      '</span><span class="wb-export-token-n">~' + escHtml(p.display) + '</span></span>';
  }).join('');
}

function refreshDocExportTokens() {
  if (!docExportDialog) return;
  var form = docExportDialog.querySelector('form');
  var target = docExportDialog._target;
  var mode = new FormData(form).get('mode') || 'html-full';
  var comments = !!(form.querySelector('[name="comments"]') && form.querySelector('[name="comments"]').checked);
  var tokensEl = docExportDialog.querySelector('[data-export-tokens]');
  if (!tokensEl) return;
  if (!target) {
    renderDocTokenEstimate(null);
    return;
  }
  var seq = ++docTokenRequestSeq;
  tokensEl.hidden = false;
  tokensEl.title = '';
  tokensEl.innerHTML = '<span class="wb-export-token-pending">' +
    (mode === 'image' ? '测量版面并估算视觉 tokens…' : '估算 tokens…') +
    '</span>';
  requestDocTokenEstimate(target.src, mode, comments).then(function (estimate) {
    if (seq !== docTokenRequestSeq) return;
    renderDocTokenEstimate(estimate);
  }).catch(function () {
    if (seq !== docTokenRequestSeq) return;
    tokensEl.hidden = false;
    tokensEl.title = '';
    tokensEl.innerHTML = '<span class="wb-export-token-pending">token 估算失败</span>';
  });
}

function ensureDocExportDialog() {
  if (docExportDialog) return docExportDialog;
  docExportDialog = document.createElement('dialog');
  docExportDialog.className = 'wb-export-dialog';
  docExportDialog.setAttribute('data-ann-ui', '');
  docExportDialog.setAttribute('data-export-ui', '');
  // 原生 showModal 已承载模态语义（焦点圈禁 / Esc 取消 / ::backdrop / 关后焦点还原），
  // 只补可访问名（P3 评估结论：上 Radix Dialog 是纯增负，见 goal 执行进展）。
  docExportDialog.setAttribute('aria-labelledby', 'wb-export-doc-title');
  docExportDialog.innerHTML = '<form class="wb-export-form" method="dialog">' +
    '<div class="wb-export-head"><div class="wb-export-head-copy"><h2 id="wb-export-doc-title">导出文档</h2><p class="wb-export-target" data-export-target-label></p></div><button class="wb-export-close" value="cancel" aria-label="关闭">×</button></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">格式</span><div class="wb-export-options wb-export-options--stack">' +
      '<label class="wb-export-option"><input type="radio" name="mode" value="html-full" checked><span><span class="wb-export-option-copy"><strong>HTML 完整</strong><small>源文件，含样式 · 适合本地打开 / 外发</small></span></span></label>' +
      '<label class="wb-export-option"><input type="radio" name="mode" value="html-no-css"><span><span class="wb-export-option-copy"><strong>去除 CSS 的 HTML</strong><small>结构与正文保留 · 适合喂给 AI</small></span></span></label>' +
      '<label class="wb-export-option"><input type="radio" name="mode" value="image"><span><span class="wb-export-option-copy"><strong>长图</strong><small>整页 PNG · 920 宽 · 2×</small></span></span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><label class="wb-export-check"><input type="checkbox" name="comments" value="1"><span>含评论（标注框 + 序号 + 侧栏气泡）</span></label></div>' +
    '<div class="wb-export-status" data-export-status>HTML 完整 · 源文件下载</div>' +
    '<div class="wb-export-tokens" data-export-tokens hidden></div>' +
    '<div class="wb-export-actions"><button type="button" class="wb-export-action primary" data-export-download>下载</button></div>' +
    '</form>';
  document.body.appendChild(docExportDialog);
  var form = docExportDialog.querySelector('form');
  function status(text, isError) {
    var el = docExportDialog.querySelector('[data-export-status]');
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }
  function commentsOn() {
    var el = form.querySelector('[name="comments"]');
    return !!(el && el.checked);
  }
  function modeHint(mode) {
    var withComments = commentsOn();
    if (mode === 'html-no-css') {
      return withComments
        ? '去除 CSS 的 HTML · 文末追加评论列表 · 适合喂给 AI'
        : '去除 CSS 的 HTML · 适合喂给 AI';
    }
    if (mode === 'image') {
      return withComments
        ? '长图 · PNG · 1184×2（920 正文 + 264 侧栏气泡）· 含标注框、序号、评论气泡 · 下方为视觉 token'
        : '长图 · PNG · 920×2 · 不含评论 · 下方为视觉 token';
    }
    return withComments
      ? 'HTML 完整 · 打开时按锚点重定位标注框 + 评论气泡 · 可本地打开'
      : 'HTML 完整 · 源文件下载';
  }
  form.addEventListener('change', function () {
    var mode = new FormData(form).get('mode');
    status(modeHint(mode));
    refreshDocExportTokens();
  });
  docExportDialog.querySelector('[data-export-download]').addEventListener('click', function () {
    var target = docExportDialog._target;
    if (!target) { status('当前没有可导出的文档', true); return; }
    var mode = new FormData(form).get('mode') || 'html-full';
    var comments = commentsOn();
    var button = docExportDialog.querySelector('[data-export-download]');
    button.disabled = true;
    status(mode === 'image'
      ? (comments ? '正在生成含评论的长图…' : '正在生成高保真长图…')
      : (comments ? '正在烘焙评论并准备下载…' : '正在准备下载…'));
    requestDocExport(Object.assign({}, target, { mode: mode, comments: comments }))
      .then(function (result) {
        downloadExportResult(result);
        var commentNote = result.commentsBaked != null
          ? ' · ' + result.commentsBaked + ' 条评论'
            + (result.commentsBroken ? '（跳过 ' + result.commentsBroken + ' 条失效锚点）' : '')
          : '';
        if (result.width && result.height) {
          status(result.width + ' × ' + result.height + ' · ' + (result.blob.size / 1024).toFixed(0) + ' KB · 已下载' + commentNote);
        } else {
          status('已下载' + commentNote);
        }
      })
      .catch(function (err) {
        status(String(err && err.message || err), true);
      })
      .then(function () { button.disabled = false; });
  });
  return docExportDialog;
}

export function requestDocExport(options) {
  options = options || {};
  var comments = !!options.comments;
  var request = {
    mode: options.mode || 'html-full',
    pageId: options.pageId,
    screenId: options.screenId,
    src: options.src,
    comments: comments,
    format: 'png',
    scale: 2,
    viewportWidth: comments ? 1184 : 920
  };
  return fetch('/api/export-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }).then(function (response) {
    if (!response.ok) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.message || ('导出失败 · ' + response.status));
      });
    }
    var fallback = request.pageId + '__' + request.screenId
      + (request.mode === 'html-no-css'
        ? (comments ? '.comments.no-css.html' : '.no-css.html')
        : request.mode === 'image'
          ? (comments ? '@2x.comments.png' : '@2x.png')
          : (comments ? '.comments.html' : '.html'));
    return response.blob().then(function (blob) {
      return {
        blob: blob,
        filename: filenameFromContentDisposition(response.headers.get('Content-Disposition'), fallback),
        width: Number(response.headers.get('X-Export-Width')) || 0,
        height: Number(response.headers.get('X-Export-Height')) || 0,
        commentsBaked: response.headers.has('X-Export-Comments')
          ? Number(response.headers.get('X-Export-Comments'))
          : null,
        commentsBroken: response.headers.has('X-Export-Comments-Broken')
          ? Number(response.headers.get('X-Export-Comments-Broken'))
          : null,
        request: request
      };
    });
  });
}

export function openDocExportDialog() {
  var target = activeDocExportTarget();
  if (!target) return;
  var dialog = ensureDocExportDialog();
  dialog._target = target;
  dialog.querySelector('[data-export-target-label]').textContent =
    target.pageId + ' / ' + target.title;
  dialog.querySelector('[data-export-status]').textContent = 'HTML 完整 · 源文件下载';
  dialog.querySelector('[data-export-status]').classList.remove('is-error');
  var full = dialog.querySelector('[name="mode"][value="html-full"]');
  if (full) full.checked = true;
  var comments = dialog.querySelector('[name="comments"]');
  if (comments) comments.checked = false;
  dialog.showModal();
  refreshDocExportTokens();
  // Prefetch the AI-friendly variant so switching modes feels instant.
  requestDocTokenEstimate(target.src, 'html-no-css', false).catch(function () {});
}

// 板面重建后为每个 frame 图注挂上 ⋯ 菜单 shell（React 岛本体见 app/frame-menu.jsx）。
// 2026-08-15d 收敛：per-section 导出浮钮与菜单里的导出入口已随旧对话框退役 ——
// 图片导出唯一入口 = HUD「导出」→ app/ExportPicker.jsx；这里只剩菜单 shell 挂载。
export function wireExportControls(panel) {
  if (!panel) return;
  // 板面重建后旧 shell 已游离 —— 先卸载它们的 React root。
  exportDeps.sweepFrameMenus();
  panel.querySelectorAll('[data-screen]').forEach(function (screen) {
    var caption = screen.querySelector(':scope > .wb-screen-cap');
    if (!caption || caption.querySelector(':scope > .wb-frame-menu-shell')) return;
    caption.classList.add('has-frame-menu');
    var shell = document.createElement('span');
    shell.className = 'wb-frame-menu-shell';
    shell.setAttribute('data-export-ui', '');
    shell.setAttribute('data-ann-ui', '');
    caption.appendChild(shell);
    exportDeps.mountFrameMenu(shell, {
      screenId: screen.getAttribute('data-screen')
    });
  });
}
