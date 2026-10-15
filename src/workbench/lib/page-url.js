/** Manifest entry for a page (registry-sourced "site" pages carry site:true).
    pp3：文章画布页在 manifest.articles 里（不进左栏 Pages），这里一并认得。 */
export function pageEntry(manifest, pageId) {
  if (!manifest) return null;
  var lists = [manifest.pages, manifest.articles];
  for (var l = 0; l < lists.length; l++) {
    var list = lists[l];
    if (!list) continue;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === pageId) return list[i];
    }
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
  var entry = params.get('entry');
  var tab = params.get('tab');
  var section = params.get('section');
  var link = {
    pageId: pageId || null,
    mode: DEEP_LINK_MODES[mode] ? mode : null,
    entry: entry || null
  };
  // 页 tab（ADR 0041）：?tab= 直达多 tab 页的某个 tab；未知 tab id 由 resolveTabId 落第一个。
  // 没给就没有这个键，存量深链的解析结果形状不变。
  if (tab) link.tab = tab;
  // 落点 section（2026-10-13）：?section= 打开页的画布条目并定位到这个 section（多 tab 页先切到它所在的 tab）。
  // 一次性落点指令，不是状态：落地后 url-sync 不回写它（地址栏随后只剩 page/entry/tab）。同样没给就没有这个键。
  if (section) link.section = section;
  // 嵌入（2026-10-15）：?embed=overlay = 文章页的画布浮层里那份工作台（site/README.md「画布浮层」）。
  // 不出左栏和“← 文章标题”，Esc 交给文章页关浮层。只认这一个值；没给就没有这个键。
  if (EMBED_MODES[params.get('embed')]) link.embed = params.get('embed');
  return link;
}

var EMBED_MODES = { overlay: true };

/** 当前文档是不是嵌在文章画布浮层里的工作台（?embed=overlay）。 */
export function isEmbedded(search) {
  return parseDeepLink(search).embed === 'overlay';
}

/** 生成深链查询串（不含前导 ?）；pageId 为空返回空串。mode / entryId / tabId / sectionId 非法或为空时省略。
    sectionId 只给链接生成方用（如文章页的“打开画布”）；url-sync 镜像的是状态，从不传它。 */
export function deepLinkQuery(pageId, mode, entryId, tabId, sectionId) {
  if (!pageId) return '';
  var params = new URLSearchParams();
  params.set('page', pageId);
  if (DEEP_LINK_MODES[mode]) params.set('mode', mode);
  if (entryId) params.set('entry', entryId);
  if (tabId) params.set('tab', tabId);
  if (sectionId) params.set('section', sectionId);
  return params.toString();
}

/** 把嵌入标记接回 url-sync 写出的查询串：浮层里的工作台镜像地址时不能丢掉 ?embed=。 */
export function withEmbed(query, embed) {
  if (!query || !EMBED_MODES[embed]) return query;
  return query + '&embed=' + encodeURIComponent(embed);
}
