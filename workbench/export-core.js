// Workbench export cluster — frame/section 图片导出、文档导出对话框、frame ⋯ 菜单。
// P1 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
// 共享状态经 app/store.js 的 wbGet()/wbSet() 读写；escHtml、pageBaseUrl 取自 lib/。
// P2 说明：三个导出 POST（/api/export-image、/api/export-doc-tokens、/api/export-doc）
// 是下载流 / 一次性计算，不是可缓存的 server state —— 保持 plain fetch，不走 Query
// （docTokenCache 只是对话框打开期间的估算回显缓存，同样无失效语义）。
import { wbGet } from './app/store.js';
import { escHtml } from './lib/esc-html.js';
import { pageBaseUrl } from './lib/page-url.js';

var EXPORT_TOKEN_NAMES = [
  '--wb-phone-w', '--wb-phone-h', '--wb-cap-section', '--wb-cap-screen', '--wb-cap-note', '--wb-cap-gap',
  '--wb-fg', '--wb-muted', '--wb-faint', '--wb-side', '--wb-line', '--wb-hover', '--wb-accent'
];
var exportDialog = null;
var exportTarget = null;
var openFrameMenu = null;
var frameMenuListenersWired = false;

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

function cleanExportClone(clone, includeNotes) {
  clone.querySelectorAll('script,style[data-export-ui],[data-export-ui],.wb-frame-note-edit,.wb-frame-note-editor').forEach(function (node) {
    node.remove();
  });
  if (!includeNotes) {
    clone.querySelectorAll('[data-frame-note]').forEach(function (node) { node.remove(); });
  } else {
    clone.querySelectorAll('[data-frame-note-view]').forEach(function (node) { node.hidden = false; });
  }
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
  var includeNotes = options.includeNotes === true;
  var source;
  source = target;
  if (!source) throw new Error('目标没有可导出的视觉内容');
  var clone = source.cloneNode(true);
  syncExportDomState(source, clone);
  cleanExportClone(clone, includeNotes);
  if (kind === 'frame' && !includeNotes) {
    clone.querySelectorAll('.wb-screen-cap').forEach(function (node) { node.remove(); });
  }
  if (kind === 'section' && !includeNotes) {
    clone.querySelectorAll('.wb-sec-row').forEach(function (node) { node.classList.add('wb-export-clean-row'); });
  }
  var format = options.format === 'png' ? 'png' : 'webp';
  var background = options.background || 'canvas';
  if (background === 'transparent') format = 'png';
  return {
    kind: kind,
    pageId: wbGet().activePageId,
    sectionId: section.getAttribute('data-ann-section') || section.getAttribute('data-ann-group'),
    screenId: screen ? screen.getAttribute('data-screen') : '',
    format: format,
    scale: Number(options.scale) === 1 ? 1 : 2,
    background: background,
    includeNotes: includeNotes,
    tokens: exportTokens(),
    html: clone.outerHTML
  };
}

function exportFileName(request) {
  var ids = [request.pageId, request.sectionId];
  if (request.kind === 'frame') ids.push(request.screenId);
  return ids.join('__').replace(/\//g, '-') + '@' + request.scale + 'x.' + request.format;
}

export function requestExportImage(options) {
  var request = buildExportSnapshot(options);
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

function downloadExportResult(result) {
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
  if (wbGet().boardMode !== 'html' || !panel || !active) return null;
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
  docExportDialog.innerHTML = '<form class="wb-export-form" method="dialog">' +
    '<div class="wb-export-head"><div class="wb-export-head-copy"><h2>导出文档</h2><p class="wb-export-target" data-export-target-label></p></div><button class="wb-export-close" value="cancel" aria-label="关闭">×</button></div>' +
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

function ensureExportDialog() {
  if (exportDialog) return exportDialog;
  exportDialog = document.createElement('dialog');
  exportDialog.className = 'wb-export-dialog';
  exportDialog.setAttribute('data-ann-ui', '');
  exportDialog.setAttribute('data-export-ui', '');
  exportDialog.innerHTML = '<form class="wb-export-form" method="dialog">' +
    '<div class="wb-export-head"><div class="wb-export-head-copy"><h2>导出图片</h2><p class="wb-export-target" data-export-target-label></p></div><button class="wb-export-close" value="cancel" aria-label="关闭">×</button></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">预设</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="notes" value="clean" checked><span>干净画面</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="notes" value="notes"><span>带说明</span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">格式</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="format" value="webp" checked><span>WebP</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="format" value="png"><span>PNG</span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">清晰度</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="scale" value="1"><span>1×</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="scale" value="2" checked><span>2×</span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">背景</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="background" value="canvas" checked><span>Canvas</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="background" value="white"><span>白色</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="background" value="transparent"><span>透明</span></label>' +
    '</div></div>' +
    '<div class="wb-export-status" data-export-status>WebP · 2× · 干净背景</div>' +
    '<div class="wb-export-actions"><button type="button" class="wb-export-action" data-export-copy>复制 PNG</button><button type="button" class="wb-export-action primary" data-export-download>下载图片</button></div>' +
    '</form>';
  document.body.appendChild(exportDialog);
  var form = exportDialog.querySelector('form');
  function panelOptions(overrides) {
    var data = new FormData(form);
    return Object.assign({
      kind: exportTarget.kind,
      target: exportTarget.target,
      includeNotes: data.get('notes') === 'notes',
      format: data.get('format'),
      scale: Number(data.get('scale')),
      background: data.get('background')
    }, overrides || {});
  }
  function status(text, isError) {
    var el = exportDialog.querySelector('[data-export-status]');
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }
  function busy(value) {
    exportDialog.querySelectorAll('.wb-export-action').forEach(function (button) { button.disabled = value; });
  }
  form.addEventListener('change', function (event) {
    if (event.target.name === 'background' && event.target.value === 'transparent') {
      form.querySelector('[name="format"][value="png"]').checked = true;
    }
    if (event.target.name === 'format' && event.target.value === 'webp') {
      var transparent = form.querySelector('[name="background"][value="transparent"]');
      if (transparent.checked) form.querySelector('[name="background"][value="canvas"]').checked = true;
    }
    var data = new FormData(form);
    status((data.get('format') || '').toUpperCase() + ' · ' + data.get('scale') + '× · ' + (data.get('notes') === 'notes' ? '带说明' : '干净画面'));
  });
  exportDialog.querySelector('[data-export-download]').addEventListener('click', function () {
    busy(true); status('正在生成高保真图片…');
    requestExportImage(panelOptions()).then(function (result) {
      downloadExportResult(result);
      status(result.width + ' × ' + result.height + ' · ' + (result.blob.size / 1024).toFixed(0) + ' KB · 已下载');
    }).catch(function (error) { status(error.message, true); }).finally(function () { busy(false); });
  });
  exportDialog.querySelector('[data-export-copy]').addEventListener('click', function () {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') { status('当前浏览器不支持复制图片，请使用下载。', true); return; }
    busy(true); status('正在生成剪贴板 PNG…');
    requestExportImage(panelOptions({ format: 'png' })).then(function (result) {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': result.blob })]).then(function () {
        status(result.width + ' × ' + result.height + ' · 已复制 PNG');
      });
    }).catch(function (error) { status(error.message, true); }).finally(function () { busy(false); });
  });
  return exportDialog;
}

function openExportDialog(kind, target) {
  var dialog = ensureExportDialog();
  exportTarget = { kind: kind, target: target };
  var section = target.closest('.wb-lib-item');
  var screen = kind === 'frame' ? target.closest('[data-screen]') : null;
  var label = wbGet().activePageId + ' / ' + (section.getAttribute('data-ann-section-label') || section.getAttribute('data-ann-section'));
  if (screen) label += ' / ' + screen.getAttribute('data-screen');
  dialog.querySelector('[data-export-target-label]').textContent = label;
  var notesOption = dialog.querySelector('[name="notes"][value="notes"]');
  notesOption.disabled = kind === 'frame' && !target.querySelector('[data-frame-note]');
  if (notesOption.disabled) dialog.querySelector('[name="notes"][value="clean"]').checked = true;
  dialog.showModal();
}

function closeFrameMenu() {
  if (!openFrameMenu) return;
  openFrameMenu.menu.hidden = true;
  openFrameMenu.trigger.setAttribute('aria-expanded', 'false');
  openFrameMenu = null;
}

function copyFrameIndicator(screen, button) {
  var text = '@frame:' + wbGet().activePageId + '/' + screen.getAttribute('data-screen');
  var done = function () {
    var label = button.querySelector('[data-frame-menu-label]');
    if (label) label.textContent = '已复制 ' + text;
    setTimeout(function () { if (label) label.textContent = '复制 @frame'; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () {});
  }
}

function wireFrameMenuGlobalListeners() {
  if (frameMenuListenersWired) return;
  frameMenuListenersWired = true;
  document.addEventListener('click', function (event) {
    if (openFrameMenu && !event.target.closest('.wb-frame-menu-shell')) closeFrameMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeFrameMenu();
  });
}

export function wireExportControls(panel) {
  if (!panel) return;
  closeFrameMenu();
  wireFrameMenuGlobalListeners();
  panel.querySelectorAll('.wb-lib-item').forEach(function (section) {
    if (!section.querySelector(':scope > .wb-export-section-trigger')) {
      var sectionButton = document.createElement('button');
      sectionButton.type = 'button';
      sectionButton.className = 'wb-export-trigger wb-export-section-trigger';
      sectionButton.setAttribute('data-export-ui', '');
      sectionButton.setAttribute('aria-label', '导出 Section');
      sectionButton.title = '导出 Section 图片';
      sectionButton.innerHTML = '<span data-wb-icon="export-image" data-wb-icon-size="16"></span>';
      sectionButton.addEventListener('click', function () { openExportDialog('section', section); });
      section.appendChild(sectionButton);
    }
  });
  panel.querySelectorAll('[data-screen]').forEach(function (screen) {
    var caption = screen.querySelector(':scope > .wb-screen-cap');
    if (!caption || caption.querySelector(':scope > .wb-frame-menu-shell')) return;
    caption.classList.add('has-frame-menu');
    var shell = document.createElement('span');
    shell.className = 'wb-frame-menu-shell';
    shell.setAttribute('data-export-ui', '');
    shell.setAttribute('data-ann-ui', '');
    shell.innerHTML = '<button type="button" class="wb-frame-menu-trigger" aria-label="Frame 菜单" aria-haspopup="menu" aria-expanded="false" title="Frame 菜单">⋯</button>' +
      '<span class="wb-frame-menu" role="menu" hidden>' +
        '<button type="button" class="wb-frame-menu-item" role="menuitem" data-frame-export><span data-wb-icon="export-image" data-wb-icon-size="15"></span><span>导出图片…</span></button>' +
        '<button type="button" class="wb-frame-menu-item" role="menuitem" data-frame-copy><span aria-hidden="true" style="width:15px;text-align:center;color:var(--wb-muted)">@</span><span data-frame-menu-label>复制 @frame</span></button>' +
      '</span>';
    var trigger = shell.querySelector('.wb-frame-menu-trigger');
    var menu = shell.querySelector('.wb-frame-menu');
    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      var shouldOpen = menu.hidden;
      closeFrameMenu();
      if (!shouldOpen) return;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      openFrameMenu = { trigger: trigger, menu: menu };
    });
    shell.querySelector('[data-frame-export]').addEventListener('click', function (event) {
      event.stopPropagation();
      closeFrameMenu();
      openExportDialog('frame', screen);
    });
    shell.querySelector('[data-frame-copy]').addEventListener('click', function (event) {
      event.stopPropagation();
      copyFrameIndicator(screen, event.currentTarget);
    });
    caption.appendChild(shell);
  });
  if (window.mountWorkbenchIcons) window.mountWorkbenchIcons(panel);
}
