/**
 * The injection contract shared by every server-side HTML injector
 * (/sites/ static entries, the /sites/ url proxy, and previews/ pages alike):
 * one inline entry marker + the client bundle tag — keep one SSOT.
 *
 * storage-unify：entryId 一律是「这条内容属于哪一页」的页 id（挂靠条目给
 * 宿主页 id），不再有落缺省 pinpoint 桶的注入方。存量 previews 账本（旧落
 * pinpoint 桶）由 scripts/migrate-ledgers.mjs 一次性迁到页桶。
 */
export function annotateSnippet(entryId) {
  return `<script>window.__pinpointEntry='${entryId}'</script><script src="/annotate.js"></script>`;
}

export function injectAnnotateClient(html, entryId) {
  const snippet = annotateSnippet(entryId);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}
