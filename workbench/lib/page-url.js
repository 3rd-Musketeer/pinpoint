/** Page id of the built-in Component Library board. */
export var COMPONENTS_ID = 'components';
export var LIB_ID = 'library';
export var WEB_LIB_ID = 'web-library';
export var DOC_LIB_ID = 'doc-library';
export var SYSTEM_PAGES = { components: true };

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

export function modeForPage(manifest, pageId) {
  if (pageId === COMPONENTS_ID) return 'ios';
  var page = pageEntry(manifest, pageId);
  return (page && page.mode) || 'ios';
}

export function defaultShellForPage(manifest, pageId) {
  var mode = modeForPage(manifest, pageId);
  if (mode === 'web') return 'web';
  if (mode === 'html') return 'doc';
  return 'app';
}

/* ---- URL 深链（goal-20260810-workbench-react-rebuild P3）----
   workbench 的 ?page=&mode= 解析与生成，纯函数；效果侧在 url-sync.js（写）
   与 workbench.js resolveBootPageId（读，URL 优先于 prefs）。不引 router。 */

var DEEP_LINK_MODES = { ios: true, web: true, html: true };

/** 解析 location.search 的深链参数；没给或非法的字段为 null（调用方回落 prefs）。 */
export function parseDeepLink(search) {
  var params = new URLSearchParams(search || '');
  var pageId = params.get('page');
  var mode = params.get('mode');
  return {
    pageId: pageId || null,
    mode: DEEP_LINK_MODES[mode] ? mode : null
  };
}

/** 生成深链查询串（不含前导 ?）；pageId 为空返回空串。mode 非法时省略。 */
export function deepLinkQuery(pageId, mode) {
  if (!pageId) return '';
  var params = new URLSearchParams();
  params.set('page', pageId);
  if (DEEP_LINK_MODES[mode]) params.set('mode', mode);
  return params.toString();
}
