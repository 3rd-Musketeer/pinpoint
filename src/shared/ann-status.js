/**
 * Annotation status palette — the SSOT of the four status colors. Three CSS
 * sites consume the same `--ann-st-*` custom properties and must stay
 * value-identical:
 *   - canvas pin (.ann-badge, [data-ann-ui] base rule in src/client/annotate.js)
 *   - workbench popover row number (#wbann-pop rule in index.html)
 *   - injected sidebar row number (#ann-sidebar, same [data-ann-ui] rule; the
 *     shared row rules in src/shared/ann-list.css only reference the variables)
 * Three-way drift turns red in src/shared/ann-status.test.js — same trick as
 * the #ann-sidebar pin check in annotate-inline.test.js.
 *
 * Pure data + tiny mappers, DOM-free like every shared/ module: node-tested
 * directly, imported by the workbench, inlined into the served /annotate.js
 * (INLINED_LIBS in src/server/annotate-api.js).
 */

/** Status → pin / row-number background. White glyph on every value; the
 * computed WCAG ratios are asserted in ann-status.test.js. open / done clear
 * the AA large-text bar (3:1); check / close sit just below — check is the
 * owner-picked amber (2026-09-23, 等 owner 看), close is deliberate
 * de-emphasis. Both are recorded, not hidden. */
export var ANN_STATUS_COLORS = {
  open: '#5b7fa6',   // = --wb-accent，现状蓝灰
  check: '#c98a1b',  // 琥珀
  done: '#2f9e63',   // 绿
  close: '#9aa3ae',  // 灰
};

/** Status → CSS variable name carrying the color. Unknown / missing status
 * falls back to open (same default as annRowModel). */
export function annStatusVar(status) {
  return '--ann-st-' + (ANN_STATUS_COLORS[status] ? status : 'open');
}
