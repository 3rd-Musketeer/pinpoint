/**
 * Comment bubble template for the annotate review view.
 * Pure (no DOM) so the live /annotate.js (inlined) and the server-side export
 * share one implementation. Returns HTML strings; the caller mounts + positions.
 *
 * Bubble shape:
 *   ┌─ #n  author ──────┐
 *   │ content            │
 *   ├─ reply ───────────┤
 *   │ reply author       │
 *   │ reply content      │
 *   └────────────────────┘
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** CSS for .ann-bubble (+ export anchor badge). Shared by live overlay and export bake. */
export function bubbleCss() {
  return [
    '.ann-bubble{position:absolute;width:240px;background:#fff;',
    'border:1px solid rgba(35,44,66,.14);border-radius:10px;',
    'box-shadow:0 4px 14px rgba(35,44,66,.10);font:13px/1.55 var(--sans,system-ui,sans-serif);',
    'color:#232C42;pointer-events:auto;z-index:3;overflow:hidden;}',
    '.ann-bubble[hidden]{display:none;}',
    '.ann-bubble-head{display:flex;align-items:center;gap:8px;padding:6px 10px;',
    'background:#F4F2EE;border-bottom:1px solid rgba(35,44,66,.08);}',
    '.ann-bubble-num{font:600 11px/1 var(--mono,ui-monospace,monospace);',
    'background:#3D5EC7;color:#fff;border-radius:6px;padding:2px 6px;letter-spacing:.02em;}',
    '.ann-bubble-author{font-size:11.5px;color:#7A8296;}',
    '.ann-bubble-body{padding:8px 10px 9px;white-space:pre-wrap;word-break:break-word;}',
    '.ann-bubble-reply{padding:7px 10px 9px;background:#FAFAF7;',
    'border-top:1px dashed rgba(35,44,66,.12);}',
    '.ann-bubble-reply-author{font:600 10.5px/1 var(--mono,ui-monospace,monospace);',
    'color:#2E6B45;letter-spacing:.04em;text-transform:uppercase;}',
    '.ann-bubble-reply-body{margin-top:4px;white-space:pre-wrap;word-break:break-word;font-size:12.5px;}',
    '.ann-bubble-empty{padding:8px 10px;color:#9A9FAB;font-style:italic;}',
    /* Export-only: soft circular number pinned to the selected-box top-right
       (same corner as live .ann-badge via badgePositionForRect). */
    '.ann-export-badge{position:absolute;width:18px;height:18px;border-radius:50%;',
    'background:rgba(61,94,199,.55);color:#fff;',
    'font:600 10px/1 var(--mono,ui-monospace,monospace);',
    'display:flex;align-items:center;justify-content:center;',
    'letter-spacing:0;box-shadow:0 1px 3px rgba(35,44,66,.12);',
    'pointer-events:none;z-index:4;}',
  ].join('');
}

/** Soft circular number badge for export bake (absolute, caller sets left/top). */
export function exportBadgeHtml(n) {
  return '<div class="ann-export-badge" data-n="' + esc(n) + '">' + esc(n) + '</div>';
}

/** Badge size used by export bake; half of this is passed to badgePositionForRect. */
export const EXPORT_BADGE_SIZE = 18;

/** Inner markup (head + body + reply) for one bubble. Caller wraps + positions. */
export function bubbleInnerHtml(m, opts) {
  opts = opts || {};
  var n = (m && m.n) != null ? m.n : '';
  var content = String((m && m.content != null ? m.content : '') || '');
  var reply = m && m.reply;
  var authorLabel = opts.authorLabel || '评论';
  var body = content
    ? '<div class="ann-bubble-body">' + esc(content) + '</div>'
    : '<div class="ann-bubble-empty">（无正文）</div>';
  var replyBlock = '';
  if (reply && reply.content) {
    var ra = reply.author === 'agent' ? 'Agent'
      : reply.author === 'user' ? 'User'
      : (reply.author || 'Reply');
    replyBlock = '<div class="ann-bubble-reply">'
      + '<div class="ann-bubble-reply-author">' + esc(ra) + '</div>'
      + '<div class="ann-bubble-reply-body">' + esc(reply.content) + '</div>'
      + '</div>';
  }
  return '<div class="ann-bubble-head">'
    + '<span class="ann-bubble-num">' + esc(n) + '</span>'
    + '<span class="ann-bubble-author">' + esc(authorLabel) + '</span>'
    + '</div>' + body + replyBlock;
}

/** Full bubble wrapper as a string (export use). Live uses bubbleInnerHtml on its own node. */
export function bubbleHtml(m, opts) {
  var n = (m && m.n) != null ? m.n : '';
  return '<div class="ann-bubble" data-n="' + esc(n) + '">'
    + bubbleInnerHtml(m, opts)
    + '</div>';
}
