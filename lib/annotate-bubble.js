/**
 * Comment bubble template for the annotate review view.
 * Pure (no DOM) so the live /annotate.js (inlined) and the server-side export
 * share one implementation. Returns HTML strings; the caller mounts + positions.
 *
 * Bubble shape:
 *   ┌─ #n  author ──────┐
 *   │ content            │
 *   └────────────────────┘
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** CSS for .ann-bubble (+ export anchor badge). Shared by live overlay and export bake.
 *  V4（goal-20260811-workbench-visual-rebuild）：气泡收编 workbench 浮层白面语言 ——
 *  白面 + 克制阴影 sh-2 + r-4 圆角 + --wb-font 字栈（2026-08-11 扁平化摘掉发
 *  丝边）；序号 chip 从蓝色 palette 改琥珀（与 .ann-badge / ann-list.css 的
 *  .wb-ann-num 同族）。
 *  var(--wb-*, fallback)：live 侧钉值在 [data-ann-ui] 基规则（client/annotate.js），
 *  export bake 无钉值走兜底 —— 兜底值与 workbench/wb-tokens.css 同值。 */
export function bubbleCss() {
  return [
    '.ann-bubble{position:absolute;width:240px;background:var(--wb-surface,#fff);',
    'border:0;border-radius:var(--wb-r-4,12px);',
    'box-shadow:var(--wb-sh-2,0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.1));',
    'font:13px/1.55 var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif);',
    'color:var(--wb-fg,#1c2024);pointer-events:auto;z-index:3;overflow:hidden;}',
    '.ann-bubble[hidden]{display:none;}',
    '.ann-bubble-head{display:flex;align-items:center;gap:8px;padding:6px 10px;',
    'background:var(--wb-side,#f6f6f7);border-bottom:0;}',
    '.ann-bubble-num{font:var(--wb-w-semibold,600) 11px/1 var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif);',
    'background:#f5a623;color:#1a1a1a;border-radius:var(--wb-r-2,6px);padding:2px 6px;letter-spacing:.02em;}',
    '.ann-bubble-author{font-size:11.5px;color:var(--wb-muted,#6b6b70);}',
    '.ann-bubble-body{padding:8px 10px 9px;white-space:pre-wrap;word-break:break-word;}',
    '.ann-bubble-empty{padding:8px 10px;color:var(--wb-faint,#8d8d8d);font-style:italic;}',
    /* Export-only: soft circular number pinned to the selected-box top-right
       (same corner as live .ann-badge via badgePositionForRect). */
    '.ann-export-badge{position:absolute;width:18px;height:18px;border-radius:50%;',
    'background:rgba(245,166,35,.55);color:#fff;',
    'font:var(--wb-w-semibold,600) 10px/1 var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif);',
    'display:flex;align-items:center;justify-content:center;',
    'letter-spacing:0;box-shadow:var(--wb-sh-1,0 1px 2px rgba(0,0,0,.06),0 0 0 0.5px rgba(0,0,0,.04));',
    'pointer-events:none;z-index:4;}',
  ].join('');
}

/** Soft circular number badge for export bake (absolute, caller sets left/top). */
export function exportBadgeHtml(n) {
  return '<div class="ann-export-badge" data-n="' + esc(n) + '">' + esc(n) + '</div>';
}

/** Badge size used by export bake; half of this is passed to badgePositionForRect. */
export const EXPORT_BADGE_SIZE = 18;

/** Inner markup (head + body) for one bubble. Caller wraps + positions. */
export function bubbleInnerHtml(m, opts) {
  opts = opts || {};
  var n = (m && m.n) != null ? m.n : '';
  var content = String((m && m.content != null ? m.content : '') || '');
  var authorLabel = opts.authorLabel || '评论';
  var body = content
    ? '<div class="ann-bubble-body">' + esc(content) + '</div>'
    : '<div class="ann-bubble-empty">（无正文）</div>';
  return '<div class="ann-bubble-head">'
    + '<span class="ann-bubble-num">' + esc(n) + '</span>'
    + '<span class="ann-bubble-author">' + esc(authorLabel) + '</span>'
    + '</div>' + body;
}

/** Full bubble wrapper as a string (export use). Live uses bubbleInnerHtml on its own node. */
export function bubbleHtml(m, opts) {
  var n = (m && m.n) != null ? m.n : '';
  return '<div class="ann-bubble" data-n="' + esc(n) + '">'
    + bubbleInnerHtml(m, opts)
    + '</div>';
}
