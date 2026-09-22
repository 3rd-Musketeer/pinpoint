export var LIB_ID = 'library';
export var DOC_LIB_ID = 'doc-library';

/** Manifest entry for a page (registry-sourced "site" pages carry site:true). */
export function pageEntry(manifest, pageId) {
  if (!manifest || !manifest.pages) return null;
  for (var i = 0; i < manifest.pages.length; i++) {
    if (manifest.pages[i].id === pageId) return manifest.pages[i];
  }
  return null;
}

/** Board/screen base URL for a page: registry dir entries are served read-only
    under /sites/<id>/; template pages live in previews/. */
export function pageBaseUrl(manifest, pageId) {
  var page = pageEntry(manifest, pageId);
  if (page && page.site) return '/sites/' + pageId + '/';
  return '/previews/' + pageId + '/';
}

/* page.mode（manifest 的 ios/html）在 2026-08-16f 阶段 6 起不再是 stage 形态的
   来源 —— 形态由选中条目派生（lib/board-entries.js entryForm）。阶段 7 撤掉
   Pages 行壳标 pill 后只剩两个用途：1) defaultShellForPage 给 validateBoard
   的缺省壳；2) 深链 ?mode= 提示的页面回落（resolveActivePage）。 */
export function modeForPage(manifest, pageId) {
  var page = pageEntry(manifest, pageId);
  return (page && page.mode) || 'ios';
}

export function defaultShellForPage(manifest, pageId) {
  var mode = modeForPage(manifest, pageId);
  if (mode === 'html') return 'doc';
  return 'app';
}

/* ---- URL 深链（goal-20260810-workbench-react-rebuild P3）----
   workbench 的 ?page=&mode=&entry= 解析与生成，纯函数；效果侧在 url-sync.js（写）
   与 stage.js resolveBootPageId（读，URL 优先于 prefs）。不引 router。
   2026-08-16 阶段 2：web 模式退役 —— 残留 ?mode=web 深链归一到 html（doc 阅读器）。
   2026-08-16f 阶段 6：深链收到条目级 —— ?entry= 直达板内条目（画布条目 id 见
   lib/board-entries.js CANVAS_ENTRY_ID，文档条目 id = doc 屏 screenId）；
   entry 只在 page 有效时生效，未知条目 id 由选中解析落默认条目（URL 随后被
   url-sync 重写为真实值）。 */

var DEEP_LINK_MODES = { ios: true, html: true };

/** 解析 location.search 的深链参数；没给或非法的字段为 null（调用方回落 prefs）。 */
export function parseDeepLink(search) {
  var params = new URLSearchParams(search || '');
  var pageId = params.get('page');
  var mode = params.get('mode');
  if (mode === 'web') mode = 'html';
  var entry = params.get('entry');
  return {
    pageId: pageId || null,
    mode: DEEP_LINK_MODES[mode] ? mode : null,
    entry: entry || null
  };
}

/** 生成深链查询串（不含前导 ?）；pageId 为空返回空串。mode / entryId 非法或为空时省略。 */
export function deepLinkQuery(pageId, mode, entryId) {
  if (!pageId) return '';
  var params = new URLSearchParams();
  params.set('page', pageId);
  if (DEEP_LINK_MODES[mode]) params.set('mode', mode);
  if (entryId) params.set('entry', entryId);
  return params.toString();
}
