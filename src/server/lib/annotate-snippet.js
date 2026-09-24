/**
 * The injection contract shared by every server-side HTML injector
 * (/sites/ static entries, the /sites/ url proxy, and previews/ pages alike):
 * one inline entry marker + the client bundle tag — keep one SSOT.
 *
 * 客户端标签引用构建产物的内容哈希地址 /annotate.<hash>.js（审计 B3，immutable
 * 永久缓存）；构建还没落地或失败时回退老地址 /annotate.js —— 那条路由对同一个
 * 失败显式 500 带原因，注入面不吞错。
 *
 * storage-unify：entryId 一律是「这条内容属于哪一页」的页 id（挂靠条目给
 * 宿主页 id），不再有落缺省 pinpoint 桶的注入方。存量 previews 账本（旧落
 * pinpoint 桶）由 scripts/migrate-ledgers.mjs 一次性迁到页桶。
 */
import { annotateClientSrc } from './annotate-bundle.js';

export function annotateSnippet(entryId) {
  return `<script>window.__pinpointEntry='${entryId}'</script><script src="${annotateClientSrc()}"></script>`;
}

export function injectAnnotateClient(html, entryId) {
  const snippet = annotateSnippet(entryId);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}
