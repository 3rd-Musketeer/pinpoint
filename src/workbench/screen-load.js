// Workbench 屏幕装配簇 — 屏幕 HTML 拉取（TanStack Query，SSE 失效）、壳装配、
// 整板 HTML 与图注（引用号纯派生自 lib/board-refs.js，doc 屏不进引用体系）。
// 壳分派只看 screen.shell（validateBoard 已按页 defaultShell 归一）；手机视口下
// doc 屏不套阅读器壳，套一块 402 × 874 的手机屏（wrapDocPhoneShell，真实布局
// 尺寸），整块屏由 pages.js syncPhoneDocScale 缩放居中、不上画布。
import { wbGet } from './app/store.js';
import { queryClient } from './app/query-client.js';
import { escHtml } from '../shared/esc-html.js';
import { validateScreenFragment } from './lib/preview-contracts.js';
import {
  defaultShellForPage,
  pageBaseUrl,
  pageEntry
} from './lib/page-url.js';
import { boardRefs } from './lib/board-refs.js';
import { rewriteFragmentAssetUrls } from './lib/sidecar-css.js';
import { PHONE_SCREEN_H, PHONE_SCREEN_W, htmlCardSize } from './lib/viewport.js';
import { isArticleBoard } from './lib/board-entries.js';
import {
  wrapCompStage,
  wrapPhoneShell
} from '../shared/frame-shell.js';
import { SCREEN_IMPORTS_ATTR, hoistedKeys, hoistedStyleHtml, splitImportOnlyStyles } from './lib/hoist-imports.js';

/**
 * 装载失败面板（2026-09-04，BACKLOG「空态与错误面板」）：说明三行（标题 / 出处 /
 * 原因）+ 固定两个动作「回到 Pages」「重试」。动作只写 data 契约，点击由
 * stage.js 挂在 stage 上的委托监听执行 —— 板每次装载整替换 innerHTML，
 * 监听不能挂在面板自己身上。动作容器带 data-ann-ui：标注客户端与舞台
 * pan / 选中判定一并让开它。
 * info = { title, source?, reason?, retry: { kind: 'board'|'screen', pageId, screenId? } }
 */
export function loadFailHtml(info) {
  var retry = (info && info.retry) || {};
  var attrs = ' data-err-retry="' + escHtml(retry.kind || 'board') + '"';
  if (retry.pageId) attrs += ' data-err-page="' + escHtml(retry.pageId) + '"';
  if (retry.screenId) attrs += ' data-err-screen="' + escHtml(retry.screenId) + '"';
  return '<div class="wb-screen-err" data-err-panel>' +
    '<p class="wb-screen-err-title">' + escHtml((info && info.title) || '加载失败') + '</p>' +
    (info && info.source ? '<p class="wb-screen-err-src">' + escHtml(info.source) + '</p>' : '') +
    (info && info.reason ? '<p class="wb-screen-err-why">' + escHtml(info.reason) + '</p>' : '') +
    '<div class="wb-screen-err-acts" data-ann-ui>' +
      '<button type="button" class="wb-screen-err-act" data-err-home>回到 Pages</button>' +
      '<button type="button" class="wb-screen-err-act"' + attrs + '>重试</button>' +
    '</div>' +
    '</div>';
}

function docFrameHtml(url, title) {
  return '<iframe class="wb-doc-frame" src="' + escHtml(url) + '"' +
    ' title="' + escHtml(title || url) + '" loading="lazy"></iframe>';
}

/** 一个 doc 屏的文档地址（iframe 的 src）：带 src 的用它，否则是页目录下的 <id>.html。 */
function docScreenUrl(pageId, screen) {
  var sc = typeof screen === 'string' ? { id: screen } : screen;
  return sc.src || pageBaseUrl(wbGet().pageManifest, pageId) + sc.id + '.html';
}

/* ---- 文章画布的 HTML 卡片（2026-10-15 一篇文章一张画布；同日改成活的）----------------
   文章画布上一个 HTML 帧摆成两样东西，都在它那一节里：
   · 卡片（.wb-screen--html-card，带 data-screen）：画布上的那一帧，一个固定尺寸的浏览器窗口（窗口 1280 × 800 /
     手机 402 × 874，lib/viewport.js htmlCardSize）。交互模式下里面能滚、能点、能悬停，和 iOS 帧一样可操作；
     标注模式下这一页自己的标注客户端在卡片里标（live-cards.js 把模式同步过去）。iframe 先只写 data-src，
     进了舞台视野才装（live-cards.js 懒加载）。卡片带 data-ann-ui：画布上的标注客户端让开它。
     图注行的“全页”钮（data-html-card-open）打开页面浮层。
   · 页面浮层（.wb-screen--doc / --phone-doc，带 data-page-screen，平时 data-doc-hidden）：“全页”打开的完整页面，
     就是存量页的文档条目那一套（窗口 1:1 铺满 / 手机屏居中，可滚动、交互、标注）。iframe 同样只写 data-src，
     第一次打开才装。
   卡片上的标注数由 html-card-counts.js 写进 [data-html-card-count]。 */
function htmlCardHtml(url, title, viewport) {
  var size = htmlCardSize(viewport);
  return '<div class="wb-html-card" data-ann-ui data-card-viewport="' + escHtml(viewport) + '"' +
    ' style="--wb-card-w:' + size.width + 'px;--wb-card-h:' + size.height + 'px">' +
      '<iframe class="wb-html-card-frame" data-src="' + escHtml(url) + '"' +
        ' title="' + escHtml(title || url) + '"></iframe>' +
    '</div>';
}

function pageOverlayFrameHtml(url, title) {
  return '<iframe class="wb-doc-frame" data-pp-parent-events data-src="' + escHtml(url) + '"' +
    ' title="' + escHtml(title || url) + '"></iframe>';
}

/* 连续两拍 HMR 时 fetchQuery 只会搭在飞的那班：Query.fetch 不带 cancelRefetch
   （fetchQuery 的第二个参数根本传不进去）时直接返回在飞的 retryer.promise，
   第二个调用方拿到的就是上一拍的内容 —— 画布停在旧稿（BACKLOG「连续 HMR 时
   在飞的帧请求吞掉最新一拍」）。在飞时改走 refetchQueries：它的 cancelRefetch
   默认 true，悄悄取消在飞请求重拉，旧调用方的 promise 被 query-core 接到新
   请求上（CancelledError silent → 新 retryer.promise），两边都拿到不旧于自己
   起跑那一拍的内容。重拉完再走同一条 fetchQuery：新稿不 stale 不加请求；重拉
   失败时 error 态把查询标回 invalidated，fetchQuery 会再试、再失败照旧上抛。 */
export function fetchQueryFresh(options) {
  var state = queryClient.getQueryState(options.queryKey);
  if (!state || state.fetchStatus !== 'fetching') return queryClient.fetchQuery(options);
  return queryClient.refetchQueries({ queryKey: options.queryKey }).then(function () {
    return queryClient.fetchQuery(options);
  });
}

export function fetchScreenHtml(pageId, screen) {
  var sc = typeof screen === 'string' ? { id: screen } : screen;
  var url = docScreenUrl(pageId, sc);
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
  // pp2：拉到的就是 dist 屏；缓存只按 SSE 失效重拉。fetchQueryFresh：连续两拍
  // HMR 时不搭在飞的旧班（见上）。
  return fetchQueryFresh({
    queryKey: ['screen', pageId, sc.id],
    queryFn: function () {
      return fetch(fetchUrl).then(function (r) {
        if (!r.ok) throw r.status;
        return r.text();
      });
    }
  })
    .then(function (raw) {
      var shell = sc.shell || defaultShellForPage(wbGet().pageManifest, pageId);
      // comp 屏（pp2 切片 2，variants 墙）是无机壳片段，不套 ios-app 契约校验。
      if (shell !== 'comp') {
        raw = validateScreenFragment(raw, 'screen(' + pageId + '/' + sc.id + ')', { shell: shell });
      }
      // fragment 里的 CSS 资源与 JS sidecar 同规则重定位到 pageBaseUrl
      // （lib/sidecar-css.js 有理由与测试）：@import 本来按 index.html 解析，
      // 相对路径会打到站点根，作者写 ./x.css 必 404。
      return {
        ok: true,
        html: rewriteFragmentAssetUrls(raw, pageBaseUrl(wbGet().pageManifest, pageId))
      };
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

/** 手机视口里的文档（2026-09-05）：doc 屏的 iframe 装进 kit 的机壳骨架（.ios-root →
    .ios-device → .ios-bezel → .ios-screen），但不带岛 / 状态栏 / home 条 —— 文档不是
    app，没有系统 chrome 可模仿。机壳 无 / 有 仍由 syncPanelPrefs 统一切 .screen-only
    （无 = 裸圆角屏 + --wb-sh-board 板影，有 = 钛框 + 黑边框）；iframe 本身 402 × 874，
    整块屏的缩放与居中是 .wb-phone-doc 的事（index.html 规则 + pages.js syncPhoneDocScale）。
    data-ann-frame 与阅读器壳同款：标注客户端把它当 frame 容器。 */
function wrapDocPhoneShell(bodyHtml) {
  return (
    '<div class="wb-phone-doc" data-ann-frame>' +
      '<div class="ios-root screen-only" data-device="iphone-16-pro" data-theme="light">' +
        '<div class="ios-device">' +
          '<span class="ios-key act"></span><span class="ios-key vup"></span>' +
          '<span class="ios-key vdn"></span><span class="ios-key pwr"></span>' +
          '<div class="ios-bezel"><div class="ios-screen">' + bodyHtml + '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function wrapScreenShell(pageId, bodyHtml, shell, viewport) {
  // comp 屏（pp2 切片 2，variants 墙）：无机壳 comp 画板，不按页分派、按 shell 分派。
  if (shell === 'comp') return wrapCompStage(bodyHtml);
  if (shell === 'doc') return viewport === 'phone' ? wrapDocPhoneShell(bodyHtml) : wrapDocShell(bodyHtml);
  return wrapPhoneShell(bodyHtml, shell);
}

// iPhone 16 Pro 逻辑分辨率（图注尺寸行）——与 lib/viewport.js 的手机视口、
// kits/ios/ios-kit.css 的 --ios-screen-w/--ios-screen-h 同一个 device preset。
var IOS_DEVICE_DIM = PHONE_SCREEN_W + ' × ' + PHONE_SCREEN_H;

/** 只有手机机身 frame 有固定逻辑分辨率可标；comp/doc 画板是流体尺寸，不出尺寸行
    （手机视口里的 doc 屏也不出：它不在画布上，图注 / 尺寸行都是画布语汇）。 */
function isPhoneFrame(pageId, shell) {
  return shell !== 'doc' && shell !== 'comp';
}

function screenClassForShell(pageId, shell, viewport) {
  if (shell === 'comp') return 'wb-screen wb-screen--comp';
  if (shell === 'doc') return viewport === 'phone' ? 'wb-screen wb-screen--phone-doc' : 'wb-screen wb-screen--doc';
  return 'wb-screen';
}

/** 一屏的内层 HTML（图注 / 尺寸行之间的那块）：拉取成功套机壳，失败出重试面板。
    整板装载（buildBoardHtml）与按屏重摆（S2/F2：stage.js 的 preview:update 增量路径）共用，
    保证同一条拉取结果两边画出来一样。 */
export function screenContentHtml(pageId, sc, res, viewport) {
  if (res && res.ok) {
    return wrapScreenShell(pageId, res.html, sc.shell, viewport);
  }
  return loadFailHtml({
    title: '加载失败',
    source: pageId + '/' + sc.id,
    reason: String(res ? res.err : 'missing'),
    retry: { kind: 'screen', pageId: pageId, screenId: sc.id }
  });
}

export function buildBoardHtml(pageId, board, screenMap, options) {
  var viewport = (options && options.viewport) || 'window';
  // 文章画布：HTML 帧的视口是帧的偏好（卡片宽度与浮层的看法都跟它走）。
  var article = isArticleBoard(board);
  var frameViewport = (options && options.frameViewport) || function () { return 'window'; };
  var sections = board.sections || [];
  if (!sections.length || (sections.length === 1 && sections[0].id === '_empty')) {
    var emptyTitle = '暂无屏幕';
    var emptyHelp = '在这个页面的 board.json sections[] 中添加 screen。';
    return '<div class="wb-zoom-wrap"><div class="wb-library" data-pp-scrollbar="off">' +
      '<article class="wb-lib-item" id="lib-_empty" data-ann-section="_empty" data-ann-section-label="' + emptyTitle + '" data-ann-group="_empty" data-ann-group-label="' + emptyTitle + '">' +
      '<h2 class="wb-lib-cap">' + emptyTitle + '</h2>' +
      '<p class="wb-muted" style="color:var(--wb-muted);font-size:13px;max-width:420px">' + emptyHelp + '</p>' +
      '</article></div></div>';
  }
  // 图注引用号（decisions 2026-08-15）：纯派生自画布视图（doc 屏不进引用体系，
  // 混合板的 A1 编号与大纲/导出树同源），不落盘；
  // frame 上方两行（mono 引用号 accent + 屏名），尺寸在 frame 下方居中 mono 小字。
  var refs = boardRefs(board);
  var screenImports = [];
  var parts = sections.map(function (sec) {
    var layout = sec.layout === 'row' ? 'row' : 'column';
    var screens = sec.screens || [];
    // 图注引用号（decisions 2026-08-15）：纯派生自 board 顺序，不落盘；
    // frame 上方两行（mono 引用号 accent + 屏名），尺寸在 frame 下方居中 mono 小字。
    var secLetter = refs.bySection[sec.id] || '';
    var body = screens.map(function (sc, col) {
      if (article && sc.shell === 'doc') return htmlFrameScreensHtml(pageId, sec, sc, col, layout, refs, frameViewport(sc.id));
      var key = sc.id;
      var fetched = screenMap[key];
      // 帧里 import-only 的 style 提到板级（lib/hoist-imports.js）；这一屏用到哪几条记在
      // 自己身上，按屏换内容时据此维护板级那一组。
      var split = splitImportOnlyStyles(screenContentHtml(pageId, sc, fetched, viewport));
      var inner = split.rest;
      screenImports.push(split.keys);
      var importsAttr = split.keys.length
        ? ' ' + SCREEN_IMPORTS_ATTR + '="' + escHtml(JSON.stringify(split.keys)) + '"'
        : '';
      var screenCls = screenClassForShell(pageId, sc.shell, viewport);
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
      // row 段（2026-09-23 comp 布局修复）：.wb-screen 在段级三行网格里是
      // display:contents，三个子块直接占格。列号钉在 --wb-col 上（行号在
      // index.html 按 nth-child 钉死）—— comp / doc 屏不出尺寸行，每屏只有
      // 两格，隐式按列填充会从第二屏起整体串位（图注落进上一列的空格）。
      var colAttr = layout === 'row' ? ' style="--wb-col:' + (col + 1) + '"' : '';
      return '<div class="' + screenCls + '" data-screen="' + escHtml(sc.id) + '"' + importsAttr + colAttr + '>' +
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
  return '<div class="wb-zoom-wrap"><div class="wb-library" data-pp-scrollbar="off">' + hoistedKeys(screenImports).map(hoistedStyleHtml).join('') + parts.join('') + '</div></div>';
}

/** 文章画布上的一个 HTML 帧 → 卡片 + 页面浮层两块（见 htmlCardHtml 上的说明）。
    卡片占这一列的图注与机身两格，没有尺寸行（图注那一行有标注数）；浮层平时收着，不占格。 */
function htmlFrameScreensHtml(pageId, sec, sc, col, layout, refs, viewport) {
  var url = docScreenUrl(pageId, sc);
  var title = sc.title || sc.id;
  var frameRef = refs.byFrame[sec.id + '\0' + sc.id] || '';
  var colAttr = layout === 'row' ? ';--wb-col:' + (col + 1) : '';
  var capHtml = '<div class="wb-screen-cap">' +
    (frameRef ? '<span class="wb-cap-ref">' + escHtml(frameRef) + '</span>' : '') +
    '<span class="wb-cap-title" title="' + escHtml(sc.title || '') + '">' + escHtml(sc.title || '') + '</span>' +
    '<button type="button" class="wb-cap-open" data-html-card-open data-ann-ui title="打开完整页面">全页</button>' +
    '<span class="wb-cap-count" data-html-card-count hidden></span>' +
    '</div>';
  var size = htmlCardSize(viewport);
  var card = '<div class="wb-screen wb-screen--html-card" data-screen="' + escHtml(sc.id) + '" data-html-card' +
    ' style="--wb-phone-w:' + size.width + 'px' + colAttr + '">' +
    capHtml + htmlCardHtml(url, title, viewport) +
    '</div>';
  var page = '<div class="' + screenClassForShell(pageId, 'doc', viewport) + '" data-page-screen="' + escHtml(sc.id) + '" data-doc-hidden>' +
    wrapScreenShell(pageId, pageOverlayFrameHtml(url, title), 'doc', viewport) +
    '</div>';
  return card + page;
}
