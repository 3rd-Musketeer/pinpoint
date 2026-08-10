// Workbench 屏幕装配簇 — 屏幕 HTML 拉取、include 展开、壳装配、整板 HTML。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
import { wbGet } from './app/store.js';
import { escHtml } from './lib/esc-html.js';
import { applyIncludeSlots } from './lib/include-slots.js';
import { validateScreenFragment } from './lib/preview-contracts.js';
import {
  COMPONENTS_ID,
  defaultShellForPage,
  modeForPage,
  pageBaseUrl,
  pageEntry
} from './lib/page-url.js';

var includeCache = {};

/** HMR 入口：组件变更时由 workbench.js 的热更处理清空 include 缓存。 */
export function clearIncludeCache() {
  includeCache = {};
}

export function loadFailHtml(msg) {
  return '<div class="wb-screen-err">' + escHtml(msg) + '</div>';
}

function screenErrorHtml(pageId, screenId, err) {
  return loadFailHtml('加载 ' + pageId + '/' + screenId + ' 失败 · ' + err);
}

function parseIncludeRef(ref) {
  var m = String(ref || '').trim().match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  return m ? { component: m[1], variant: m[2] } : null;
}

function fetchIncludeHtml(ref) {
  var parsed = parseIncludeRef(ref);
  if (!parsed) return Promise.resolve({ ok: false, err: 'bad ref' });
  if (includeCache[ref]) return Promise.resolve(includeCache[ref]);
  return fetch('kits/ios/components/' + parsed.component + '/' + parsed.variant + '.html')
    .then(function (r) {
      if (!r.ok) throw r.status;
      return r.text();
    })
    .then(function (html) {
      includeCache[ref] = { ok: true, html: html };
      return includeCache[ref];
    })
    .catch(function (e) {
      return { ok: false, err: e };
    });
}

/** Expand <div data-ios-include="comp/variant" data-text="…"> placeholders. */
function resolveIncludes(html) {
  var re = /<([a-zA-Z0-9]+)([^>]*?)\bdata-ios-include=(["'])([^"']+)\3([^>]*)>(?:\s*<\/\1>)?/gi;
  var refs = [];
  var m;
  while ((m = re.exec(html))) {
    if (refs.indexOf(m[4]) < 0) refs.push(m[4]);
  }
  if (!refs.length) return Promise.resolve(html);
  return Promise.all(refs.map(fetchIncludeHtml)).then(function () {
    return html.replace(re, function (full, tag, pre, q, ref, post) {
      var attrs = (pre || '') + (post || '');
      var fetched = includeCache[ref];
      if (!fetched || !fetched.ok) {
        return '<div class="wb-screen-err">include 失败 · ' + escHtml(ref) + '</div>';
      }
      var frag = fetched.html.trim();
      frag = applyIncludeSlots(frag, attrs);
      // Mark include root for annotate → component source routing
      if (/^<([a-zA-Z0-9]+)/.test(frag)) {
        frag = frag.replace(/^<([a-zA-Z0-9]+)/, '<$1 data-ios-from="' + ref + '"');
      }
      return frag;
    });
  });
}

function wrapFragmentForLibrary(html) {
  var t = (html || '').trim();
  if (!t) return '<div class="ios-app"><div class="ios-page"></div></div>';
  if (/\bios-app\b/.test(t) || /\bios-lockscreen\b/.test(t)) return t;
  return '<div class="ios-app" style="display:flex;flex-direction:column">' +
    '<div class="ios-page" style="flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center">' +
    t +
    '</div></div>';
}

function docFrameHtml(url, title) {
  return '<iframe class="wb-doc-frame" src="' + escHtml(url) + '"' +
    ' title="' + escHtml(title || url) + '" loading="lazy"></iframe>';
}

export function fetchScreenHtml(pageId, screen) {
  var sc = typeof screen === 'string' ? { id: screen } : screen;
  var url;
  if (sc.src) {
    url = sc.src;
  } else if (pageId === COMPONENTS_ID && String(sc.id).indexOf('/') >= 0) {
    url = 'kits/ios/components/' + sc.id + '.html';
  } else {
    url = pageBaseUrl(wbGet().pageManifest, pageId) + sc.id + '.html';
  }
  // doc shell 承载的是完整独立文档（有 <!doctype>/<head>/自己的 <style>），
  // 不能当 fragment 内联——它的 body 规则会失效、style 会漏进 workbench。
  // 交给 iframe，文档保持原样；标注由文档自己注入的 annotate.js 负责。
  if ((sc.shell || defaultShellForPage(wbGet().pageManifest, pageId)) === 'doc') {
    return Promise.resolve({ ok: true, html: docFrameHtml(url, sc.title || sc.id) });
  }
  // Site pages are served with the annotate client injected; fragments inlined
  // into the board must stay clean — the workbench owns annotation here.
  var fetchUrl = url;
  var page = pageEntry(wbGet().pageManifest, pageId);
  if (page && page.site) fetchUrl += (fetchUrl.indexOf('?') >= 0 ? '&' : '?') + 'annotate=off';
  return fetch(fetchUrl)
    .then(function (r) {
      if (!r.ok) throw r.status;
      return r.text();
    })
    .then(function (raw) {
      if (pageId !== COMPONENTS_ID) {
        raw = validateScreenFragment(raw, 'screen(' + pageId + '/' + sc.id + ')', {
          shell: sc.shell || defaultShellForPage(wbGet().pageManifest, pageId)
        });
      }
      return resolveIncludes(raw).then(function (html) {
        if (pageId === COMPONENTS_ID) html = wrapFragmentForLibrary(html);
        return { ok: true, html: html };
      });
    })
    .catch(function (e) { return { ok: false, err: e }; });
}

/** True if the fragment already includes phone chrome (legacy full-shell files). */
function looksPhoneWrapped(html) {
  return /\bios-stage\b/.test(html) || /\bios-device\b/.test(html);
}

/**
 * Wrap screen body in shared phone chrome.
 * Agent writes only in-screen content; loader owns stage/device/bezel/statusbar/home.
 * shell: "app" (default) | "lock"
 */
function wrapPhoneShell(bodyHtml, shell) {
  if (looksPhoneWrapped(bodyHtml)) return bodyHtml;
  var screenClass = shell === 'lock' ? 'ios-screen ios-lock' : 'ios-screen';
  return (
    '<div class="ios-stage">' +
      '<div class="ios-root screen-only" data-device="iphone-16-pro" data-theme="light">' +
        '<div class="ios-device">' +
          '<span class="ios-key act"></span><span class="ios-key vup"></span>' +
          '<span class="ios-key vdn"></span><span class="ios-key pwr"></span>' +
          '<div class="ios-bezel"><div class="' + screenClass + '">' +
            '<div class="ios-island"></div>' +
            '<div class="ios-statusbar"><span class="ios-sb-time"></span><span class="ios-sb-icons"></span></div>' +
            bodyHtml +
            '<div class="ios-home"></div>' +
          '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

/** Component Library: light board, no phone chrome. Still uses .ios-root for tokens/theme. */
function wrapCompStage(bodyHtml) {
  if (looksPhoneWrapped(bodyHtml)) return bodyHtml;
  return (
    '<div class="wb-comp-stage">' +
      '<div class="ios-root" data-theme="light">' +
        bodyHtml +
      '</div>' +
    '</div>'
  );
}

/** Web board: desktop/report artboard without phone chrome. */
function wrapHtmlShell(bodyHtml) {
  if (/\bwb-html-stage\b/.test(bodyHtml)) return bodyHtml;
  return (
    '<div class="wb-html-stage" data-ann-frame>' +
      '<div class="wb-html-surface" data-ann-surface data-preview-mount>' +
        bodyHtml +
      '</div>' +
    '</div>'
  );
}

/** HTML board: a standalone document artboard (iframe inside). */
function wrapDocShell(bodyHtml) {
  if (/\bwb-doc-stage\b/.test(bodyHtml)) return bodyHtml;
  return (
    '<div class="wb-doc-stage" data-ann-frame>' +
      '<div class="wb-doc-surface" data-preview-mount>' +
        bodyHtml +
      '</div>' +
    '</div>'
  );
}

function wrapScreenShell(pageId, bodyHtml, shell) {
  if (pageId === COMPONENTS_ID) return wrapCompStage(bodyHtml);
  if (shell === 'doc' || modeForPage(wbGet().pageManifest, pageId) === 'html') return wrapDocShell(bodyHtml);
  if (shell === 'web' || modeForPage(wbGet().pageManifest, pageId) === 'web') return wrapHtmlShell(bodyHtml);
  return wrapPhoneShell(bodyHtml, shell);
}

function screenClassForShell(pageId, shell) {
  if (pageId === COMPONENTS_ID) return 'wb-screen wb-screen--comp';
  if (shell === 'doc' || modeForPage(wbGet().pageManifest, pageId) === 'html') return 'wb-screen wb-screen--doc';
  if (shell === 'web' || modeForPage(wbGet().pageManifest, pageId) === 'web') return 'wb-screen wb-screen--web';
  return 'wb-screen';
}

export function buildBoardHtml(pageId, board, screenMap) {
  var isCompLib = pageId === COMPONENTS_ID;
  var sections = board.sections || [];
  if (!sections.length || (sections.length === 1 && sections[0].id === '_empty')) {
    var emptyTitle = isCompLib ? '暂无组件' : '暂无屏幕';
    var emptyHelp = isCompLib
      ? '在 kits/ios/components/ 下添加 meta.json + variant HTML，刷新后会出现在此页。'
      : '在这个页面的 board.json sections[] 中添加 screen。';
    return '<div class="wb-zoom-wrap"><div class="wb-library">' +
      '<article class="wb-lib-item" id="lib-_empty" data-ann-section="_empty" data-ann-section-label="' + emptyTitle + '" data-ann-group="_empty" data-ann-group-label="' + emptyTitle + '">' +
      '<h2 class="wb-lib-cap">' + emptyTitle + '</h2>' +
      '<p class="wb-muted" style="color:var(--wb-muted);font-size:13px;max-width:420px">' + emptyHelp + '</p>' +
      '</article></div></div>';
  }
  var parts = sections.map(function (sec) {
    var layout = sec.layout === 'row' ? 'row' : 'column';
    var screens = sec.screens || [];
    var body = screens.map(function (sc) {
      var key = sc.id;
      var fetched = screenMap[key];
      var inner;
      if (fetched && fetched.ok) {
        inner = wrapScreenShell(pageId, fetched.html, sc.shell);
      } else {
        inner = screenErrorHtml(pageId, sc.id, fetched ? fetched.err : 'missing');
      }
      var screenCls = screenClassForShell(pageId, sc.shell);
      var note = sc.note || '';
      var noteHtml = '';
      if (!isCompLib) {
        noteHtml = '<div class="wb-frame-note' + (note ? '' : ' is-empty') + '" data-frame-note data-ann-ui>' +
          '<div class="wb-frame-note-view" data-frame-note-view>' +
            '<div class="wb-frame-note-text' + (note ? '' : ' wb-frame-note-placeholder') + '" data-frame-note-text>' +
              escHtml(note || '添加这一步的场景、交互或能力说明。') +
            '</div>' +
            '<button type="button" class="wb-frame-note-edit" data-frame-note-action="edit">' + (note ? '编辑' : '＋ Frame Note') + '</button>' +
          '</div>' +
          '<div class="wb-frame-note-editor" data-frame-note-editor hidden>' +
            '<textarea class="wb-frame-note-input" data-frame-note-input maxlength="12000" aria-label="Frame Note"></textarea>' +
            '<div class="wb-frame-note-footer">' +
              '<span class="wb-frame-note-status" data-frame-note-status></span>' +
              '<button type="button" class="wb-frame-note-action" data-frame-note-action="cancel">取消</button>' +
              '<button type="button" class="wb-frame-note-action" data-frame-note-action="save">保存</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }
      return '<div class="' + screenCls + '" data-screen="' + escHtml(sc.id) + '">' +
        '<div class="wb-screen-cap' + (sc.title ? '' : ' wb-screen-cap--empty') + '">' + escHtml(sc.title || '') + '</div>' +
        inner +
        noteHtml +
        '</div>';
    }).join('');
    return '<article class="wb-lib-item" id="lib-' + escHtml(sec.id) + '"' +
      ' data-ann-section="' + escHtml(sec.id) + '"' +
      ' data-ann-section-label="' + escHtml(sec.title || sec.id) + '"' +
      ' data-ann-group="' + escHtml(sec.id) + '"' +
      ' data-ann-group-label="' + escHtml(sec.title || sec.id) + '">' +
      '<h2 class="wb-lib-cap">' + escHtml(sec.title || sec.id) + '</h2>' +
      '<div class="wb-sec-body wb-sec-' + layout + '">' + body + '</div>' +
      '</article>';
  });
  return '<div class="wb-zoom-wrap"><div class="wb-library">' + parts.join('') + '</div></div>';
}
