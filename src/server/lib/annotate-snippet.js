/**
 * The injection contract shared by every server-side HTML injector
 * (/sites/ static entries and the /sites/ url proxy alike): one inline entry
 * marker + the client bundle tag. The export pipeline's
 * stripAnnotateBootstrap recognizes exactly this shape — keep one SSOT.
 */
export function annotateSnippet(entryId) {
  return `<script>window.__pinpointEntry='${entryId}'</script><script src="/annotate.js"></script>`;
}

export function injectAnnotateClient(html, entryId) {
  const snippet = annotateSnippet(entryId);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}

/**
 * previews/ 全文档注入（2026-08-17 契约统一）：只注入客户端 tag，不带 entry
 * 标记——previews 页的账本 ENTRY 必须保持缺省 'pinpoint'（client/annotate.js
 * 的 fallback），与手工注入段时代逐字节一致，否则存量标注账本孤儿化。
 * 手工注入段（data-ios-annotate IIFE）从此不再必要；存量页面的该段由
 * 客户端的 window.__pinpoint 防双载兜底（本 tag 同步执行，永远先到）。
 */
export function annotateClientTag() {
  return '<script src="/annotate.js"></script>';
}

export function injectAnnotateClientTag(html) {
  const tag = annotateClientTag();
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${tag}\n</body>`);
  return `${html}\n${tag}\n`;
}
