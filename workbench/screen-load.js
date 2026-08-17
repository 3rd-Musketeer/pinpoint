// Workbench 屏幕装配簇 — 屏幕 HTML 拉取、include 展开、壳装配、整板 HTML。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
// P2：screen/include 拉取迁入 TanStack Query（app/query-client.js），手工
// includeCache/clearIncludeCache 机械删除 —— 失效只由 SSE 桥的 invalidateQueries 驱动。
// 2026-08-15 图纸图注（decisions 08-15）：frame 上方两行（mono 引用号 accent +
// 屏名 .wb-cap-title），尺寸行 .wb-screen-dim 在 frame 下方居中（仅手机机身 frame，
// 402 × 874 = iPhone 16 Pro 逻辑分辨率，钉值对齐 kits/ios/ios-kit.css）；引用号
// 纯派生自画布视图（lib/board-refs.js over lib/board-entries.js canvasBoard），
// 不落盘。doc 屏不上画布、不套图注（阅读器态由 index.html [data-page-mode="html"]
// 规则隐藏图注语汇）。
// 2026-08-16f 阶段 6（产物与草稿模型）：壳分派只看 screen.shell（validateBoard
// 已按页 defaultShell 归一完毕），不再回查 page.mode —— 同一板里 app/lock 屏摆
// 画布、doc 屏成阅读器条目（选中后由 pages.js setActiveEntry 切 stage 形态与显隐）。
import { wbGet } from './app/store.js';
import { queryClient } from './app/query-client.js';
import { escHtml } from './lib/esc-html.js';
import { applyIncludeSlots } from './lib/include-slots.js';
import { canvasBoard } from './lib/board-entries.js';
import { validateScreenFragment } from './lib/preview-contracts.js';
import {
  COMPONENTS_ID,
  defaultShellForPage,
  pageBaseUrl,
  pageEntry
} from './lib/page-url.js';
import { boardRefs } from './lib/board-refs.js';
import {
  expandIncludeRefs,
  wrapCompStage,
  wrapFragmentForLibrary,
  wrapPhoneShell
} from '../lib/frame-shell.js';

export function loadFailHtml(msg) {
  return '<div class="wb-screen-err">' + escHtml(msg) + '</div>';
}

function screenErrorHtml(pageId, screenId, err) {
  return loadFailHtml('加载 ' + pageId + '/' + screenId + ' 失败 · ' + err);
}

function fetchIncludeHtml(ref) {
  // 失败不走缓存（fetchQuery reject，query 不留 data）——下次装载自然重试；
  // 组件修复经 SSE invalidate 后同样重拉。
  var parsed = ref.split('/');
  return queryClient.fetchQuery({
    queryKey: ['include', parsed[0], parsed[1]],
    queryFn: function () {
      return fetch('kits/ios/components/' + ref + '.html')
        .then(function (r) {
          if (!r.ok) throw r.status;
          return r.text();
        });
    }
  });
}

/** Expand <div data-ios-include="comp/variant" data-text="…"> placeholders. */
function resolveIncludes(html) {
  // 展开算法收编到 lib/frame-shell.js（与 /api/frame 嵌入页、导出烤图共享同一份
  // 机壳不变量）；这里只注入 client 侧 fetch loader 与 slot 应用。
  return expandIncludeRefs(html, function (parsed) {
    return fetchIncludeHtml(parsed.component + '/' + parsed.variant).catch(function () { return null; });
  }, applyIncludeSlots);
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
  // Query 缓存的是未展开 include 的原始片段 —— 组件变更只需 invalidate ['include']，
  // 重装载时重新展开即拿到新内容；校验与 include 展开留在缓存外逐次执行。
  return queryClient.fetchQuery({
    queryKey: ['screen', pageId, sc.id],
    queryFn: function () {
      return fetch(fetchUrl).then(function (r) {
        if (!r.ok) throw r.status;
        return r.text();
      });
    }
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
  if (shell === 'doc') return wrapDocShell(bodyHtml);
  return wrapPhoneShell(bodyHtml, shell);
}

// iPhone 16 Pro 逻辑分辨率（图注尺寸行）——钉值与 kits/ios/ios-kit.css 的
// --ios-screen-w/--ios-screen-h 同源（唯一 device preset）；读法见 mock 的 .fig .dim。
var IOS_DEVICE_DIM = '402 × 874';

/** 只有手机机身 frame 有固定逻辑分辨率可标；comp/doc 画板是流体尺寸，不出尺寸行。 */
function isPhoneFrame(pageId, shell) {
  if (pageId === COMPONENTS_ID) return false;
  return shell !== 'doc';
}

/** 尺寸行文案：手机机身 frame → '402 × 874'，其余画板 → ''（导出 picker tree 复用）。 */
export function frameDimLabel(pageId, shell) {
  return isPhoneFrame(pageId, shell) ? IOS_DEVICE_DIM : '';
}

function screenClassForShell(pageId, shell) {
  if (pageId === COMPONENTS_ID) return 'wb-screen wb-screen--comp';
  if (shell === 'doc') return 'wb-screen wb-screen--doc';
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
  // 图注引用号（decisions 2026-08-15）：纯派生自画布视图（doc 屏不进引用体系，
  // 混合板的 A1 编号与大纲/导出树同源），不落盘；
  // frame 上方两行（mono 引用号 accent + 屏名），尺寸在 frame 下方居中 mono 小字。
  var refs = boardRefs(canvasBoard(board));
  var parts = sections.map(function (sec) {
    var layout = sec.layout === 'row' ? 'row' : 'column';
    var screens = sec.screens || [];
    // 图注引用号（decisions 2026-08-15）：纯派生自 board 顺序，不落盘；
    // frame 上方两行（mono 引用号 accent + 屏名），尺寸在 frame 下方居中 mono 小字。
    var secLetter = refs.bySection[sec.id] || '';
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
      var frameRef = refs.byFrame[sec.id + '\0' + sc.id] || '';
      // title 属性 = 截断兜底（2026-08-17 caption 两行 clamp）的全文出口
      var capHtml = '<div class="wb-screen-cap">' +
        (frameRef ? '<span class="wb-cap-ref">' + escHtml(frameRef) + '</span>' : '') +
        '<span class="wb-cap-title" title="' + escHtml(sc.title || '') + '">' + escHtml(sc.title || '') + '</span>' +
        '</div>';
      var dimHtml = isPhoneFrame(pageId, sc.shell)
        ? '<div class="wb-screen-dim">' + IOS_DEVICE_DIM + '</div>'
        : '';
      // 2026-08-17：Frame Note 不再渲染上画布 —— note 的读/写收编到右栏
      // detail 面板（选中模型），画布只留图注 + 机身 + 尺寸行。
      return '<div class="' + screenCls + '" data-screen="' + escHtml(sc.id) + '">' +
        capHtml +
        inner +
        dimHtml +
        '</div>';
    }).join('');
    return '<article class="wb-lib-item" id="lib-' + escHtml(sec.id) + '"' +
      ' data-ann-section="' + escHtml(sec.id) + '"' +
      ' data-ann-section-label="' + escHtml(sec.title || sec.id) + '"' +
      ' data-ann-group="' + escHtml(sec.id) + '"' +
      ' data-ann-group-label="' + escHtml(sec.title || sec.id) + '">' +
      '<h2 class="wb-lib-cap" title="' + escHtml(sec.title || sec.id) + '">' +
        (secLetter ? '<span class="wb-cap-ref wb-cap-ref--section">' + escHtml(secLetter) + '</span>' : '') +
        escHtml(sec.title || sec.id) +
      '</h2>' +
      '<div class="wb-sec-body wb-sec-' + layout + '">' + body + '</div>' +
      '</article>';
  });
  return '<div class="wb-zoom-wrap"><div class="wb-library">' + parts.join('') + '</div></div>';
}
