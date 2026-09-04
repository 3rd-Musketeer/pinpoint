/**
 * Page slug used as the disk filename + SSE page key. Pure (no node deps) so it
 * can be inlined into the browser annotate script and imported by the node
 * store — both sides MUST use the same function or SSE page matching drifts.
 *
 * Consecutive non-word chars collapse to a single underscore; CJK kept.
 */
export function annotationSlug(page) {
  return String(page).replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 80) || 'index';
}
