/**
 * Shared annotation-list row model — one annotation mark → one list row.
 *
 * Consumers: the workbench sidebar (#wbann-list in workbench/workbench.js) and
 * the injected client sidebar (#ann-sidebar in client/annotate.js). Grouping
 * and navigation stay per-consumer (board jump vs goToMark); what must not
 * drift is how one mark becomes one row: the cap excerpt, the content preview,
 * the broken flag, and the tag glyphs.
 *
 * Pure and DOM-free like every lib/ module: node-tested directly, imported by
 * the workbench as an ES module, and inlined into the served /annotate.js (see
 * INLINED_LIBS in server/annotate-api.js).
 */

/** Last `>`-separated selector segment, trimmed and truncated — the "which
 * element" excerpt used when a mark carries no stored text. */
export function selectorExcerpt(selector, max = 60) {
  const tail = (String(selector || '').split('>').pop() || '').trim();
  return tail.slice(0, max);
}

/**
 * Cap line: what the annotation points at.
 * opts.region      — label for region marks (default '框选区域', the client
 *                    sidebar wording; the workbench list passes '框选').
 * opts.element     — fallback label when nothing else fits ('元素').
 * opts.textMax     — stored-text truncation (40 on both sides).
 * opts.selectorMax — selector-excerpt truncation (client 60; pass 0 to skip
 *                    the selector fallback, as the workbench list does).
 */
export function annRowCap(mark, opts = {}) {
  const region = opts.region || '框选区域';
  const element = opts.element || '元素';
  const textMax = opts.textMax == null ? 40 : opts.textMax;
  const selectorMax = opts.selectorMax == null ? 60 : opts.selectorMax;
  if (mark && mark.type === 'region') return region;
  const text = String((mark && mark.text) || '').slice(0, textMax);
  if (text) return text;
  if (selectorMax > 0) {
    const excerpt = selectorExcerpt(mark && mark.selector, selectorMax);
    if (excerpt) return excerpt;
  }
  return element;
}

/** Content preview line: trimmed and truncated; '' means the row hides the
 * line. The display conversion (@mention / target refs) stays with the
 * caller — each sidebar resolves targets against its own live document. */
export function annRowPreview(displayContent, max = 80) {
  return String(displayContent || '').trim().slice(0, max);
}

/** Tag glyphs for the row's affordance line:
 * ✎ changeTo · ↗ move · 🖼 images · 🔍 research · @ mentions. */
export function annRowTags(mark) {
  if (!mark) return '';
  const tags = [];
  if (mark.changeTo) tags.push('✎');
  if (mark.move) tags.push('↗');
  if (mark.images && mark.images.length) tags.push('🖼');
  if (mark.research) tags.push('🔍');
  if (mark.mentions && mark.mentions.length) tags.push('@');
  return tags.join(' ');
}

/**
 * Brokenness, distilled from the client's anchor check into a pure predicate:
 * `hasSelector(selector)` reports whether a selector still resolves in the
 * caller's live document; `elementTargets` is the mark's normalized target
 * list (only consulted for type 'element'). A hidden-but-resolvable target is
 * NOT broken — the same selector goes live again when the view returns.
 */
export function annMarkResolvable(mark, hasSelector, elementTargets) {
  if (!mark) return false;
  if (mark.type === 'element') {
    const targets = Array.isArray(elementTargets) ? elementTargets : [];
    return targets.some((target) => !!(target && target.selector && hasSelector(target.selector)));
  }
  if (mark.base && mark.base.selector && hasSelector(mark.base.selector)) return true;
  if (Array.isArray(mark.contains) && mark.contains.length) {
    return mark.contains.some((item) => !!(item && item.selector && hasSelector(item.selector)));
  }
  return false;
}

export function annMarkBroken(mark, hasSelector, elementTargets) {
  return !annMarkResolvable(mark, hasSelector, elementTargets);
}

/**
 * Row model shared by both sidebars. `context.preview` is the already
 * display-converted content line (caller-side, see annRowPreview);
 * `context.broken` is the already-evaluated anchor state (see annMarkBroken);
 * `context.cap` carries the annRowCap options of the calling sidebar.
 */
export function annRowModel(mark, context = {}) {
  return {
    n: mark ? mark.n : 0,
    cap: annRowCap(mark, context.cap),
    preview: context.preview == null ? '' : String(context.preview),
    broken: !!context.broken,
    tags: annRowTags(mark),
  };
}
