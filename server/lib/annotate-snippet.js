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
