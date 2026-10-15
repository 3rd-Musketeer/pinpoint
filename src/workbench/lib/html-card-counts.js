// 文章画布上 HTML 卡片的标注数（2026-10-15 一篇文章一张画布）。一个 HTML 帧的标注在它自己的
// 文档账本里（同桶 = 文章页 id，账本名 = 页面地址的 pageKeyFromPathname，标注客户端在 iframe 里
// 按 location.pathname 定的），不在 @canvas 里；卡片图注末尾显示这一页待验收（open / check / done）
// 的条数，与横条计数、文章页卡片同口径。纯函数、DOM-free（node --test 直测）。
import { pageKeyFromPathname } from '../../shared/annotate-page-key.js';
import { annotationSlug } from '../../shared/annotation-slug.js';

/** 卡片 / 页面浮层的 iframe 地址 → 那一页的账本名。base 是解析相对地址的基准（location.href）。 */
export function htmlFrameLedgerKey(src, base) {
  if (!src) return '';
  var pathname;
  try { pathname = new URL(src, base || 'http://localhost/').pathname; } catch (e) { return ''; }
  return pageKeyFromPathname(pathname);
}

/** 账本（GET /annotations/<名>、SSE annotations 事件的 doc）→ 待验收条数。没有 status 的行算 open。 */
export function htmlFramePending(doc) {
  var rows = doc && Array.isArray(doc.annotations) ? doc.annotations : [];
  return rows.filter(function (a) {
    return a && a.type !== 'prose' && (a.status || 'open') !== 'close';
  }).length;
}

/** 卡片上的字：0 条不显示（''）。 */
export function htmlCardCountText(n) {
  return n > 0 ? n + ' 条标注' : '';
}

/** SSE 推来的 doc.page 是不是这本账本：服务端有时报原名、有时报落盘的 slug（annotation-store.js），两种都认。 */
export function ledgerMatches(docPage, key) {
  return !!key && (docPage === key || docPage === annotationSlug(key));
}
