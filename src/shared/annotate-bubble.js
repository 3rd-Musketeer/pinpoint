/**
 * Comment bubble template for the annotate review view.
 * Pure (no DOM) so the live /annotate.js (inlined) and the server-side export
 * share one implementation. Returns HTML strings; the caller mounts + positions.
 *
 * Bubble shape（2026-09-04 评审板 H1）：
 *   ┌────────────────────┐
 *   │ 1 指着的那段         │  ← 11px mono 眉标：序号 accent + 引用淡色
 *   │ 正文                 │
 *   │ agent 备注 ▸（有 note）│  ← 2026-09-23 折叠段，点开展开原文
 *   └────────────────────┘
 */



/** CSS for .ann-bubble (+ export anchor badge). Shared by live overlay and export bake.
 *  2026-09-04 评审板 H1：卡片收成一块白面小卡 —— 186 宽、11px 正文、一条 11px
 *  mono 眉标（序号 accent + 「指着什么」淡色）。琥珀序号 chip 与「评论」这个
 *  作者标都删了：一次只出一张卡（hover 钉子才出），卡自己不必再自报是什么。
 *  琥珀仍是「正在圈选」的功能色（hover ghost / target / lasso），不再当序号色。
 *  var(--wb-*, fallback)：live 侧钉值在 [data-ann-ui] 基规则（src/client/annotate.js），
 *  export bake 无钉值走兜底 —— 兜底值与 src/workbench/wb-tokens.css 同值。
 *  240 宽的两处（doc 导出烤图、workbench gutter）自己写 inline width，不吃这里的值。 */
import { escHtml } from '../workbench/lib/esc-html.js';
export function bubbleCss() {
  return [
    '.ann-bubble{position:absolute;width:186px;background:var(--wb-surface,#fff);',
    'border:0;border-radius:var(--wb-r-3,8px);padding:7px 9px 8px;box-sizing:border-box;',
    'box-shadow:var(--wb-sh-2,0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.1));',
    'font:11px/1.45 var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif);',
    'color:var(--wb-fg,#1c2024);pointer-events:auto;z-index:3;overflow:hidden;}',
    '.ann-bubble[hidden]{display:none;}',
    '.ann-bubble-cap{display:flex;align-items:baseline;gap:5px;margin-bottom:3px;',
    'font-family:var(--wb-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);',
    'font-size:11px;line-height:1.3;color:var(--wb-muted,#6b6b70);}',
    '.ann-bubble-n{flex:none;font-weight:var(--wb-w-semibold,600);letter-spacing:.04em;',
    'color:var(--wb-accent,#5b7fa6);}',
    '.ann-bubble-ref{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.ann-bubble-body{white-space:pre-wrap;word-break:break-word;}',
    '.ann-bubble-empty{color:var(--wb-faint,#8d8d8d);font-style:italic;}',
    // agent 备注折叠段（2026-09-23）：折叠头一行 mono muted 与眉标同档，正文
    // 下加分隔线；展开的原文 pre-wrap 保留换行，最多 6 行（6 × 1.45em）后卡内
    // 滚动 —— 上限与工作台 hover 备注卡（AnnPopover NoteCard）一致。live 评论卡
    // 消费；导出烤图（bubbleHtml）不消费：静态图没有交互，折叠头不进烤图。
    '.ann-bubble-note-head{margin-top:6px;padding-top:5px;border-top:1px solid var(--wb-line,rgba(0,0,0,.07));cursor:pointer;user-select:none;font-family:var(--wb-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:1.3;color:var(--wb-muted,#6b6b70);}',
    '.ann-bubble-note-head:hover{color:var(--wb-fg,#1c2024);}',
    '.ann-bubble-note-body{margin-top:4px;white-space:pre-wrap;word-break:break-word;max-height:8.7em;overflow-y:auto;}',
  ].join('');
}

/** agent 备注折叠段（画布评论卡，2026-09-23）。`expanded` 归调用方持有（本次
 *  页面内存，不落盘）：收起只出折叠头，展开才出原文。note 由调用方保证非空。 */
export function bubbleNoteHtml(note, expanded) {
  return '<div class="ann-bubble-note-head">' + (expanded ? 'agent 备注 ▾' : 'agent 备注 ▸') + '</div>'
    + (expanded ? '<div class="ann-bubble-note-body">' + escHtml(note) + '</div>' : '');
}

/** Inner markup (眉标 + 正文 + agent 备注折叠段) for one bubble. Caller wraps + positions.
 *  `m.cap` = 这条标注指着什么（annRowCap 的同一份口径）；没有就只出序号。
 *  `m.note` = agent 备注（pp2 状态机随行字段）：有才出折叠段，展开态走
 *  opts.noteExpanded（调用方持有，见 bubbleNoteHtml）。 */
export function bubbleInnerHtml(m, opts) {
  var n = (m && m.n) != null ? m.n : '';
  var cap = String((m && m.cap != null ? m.cap : '') || '').trim();
  var content = String((m && m.content != null ? m.content : '') || '');
  var note = String((m && m.note != null ? m.note : '') || '');
  var body = content
    ? '<div class="ann-bubble-body">' + escHtml(content) + '</div>'
    : '<div class="ann-bubble-body ann-bubble-empty">（无正文）</div>';
  return '<div class="ann-bubble-cap">'
    + '<span class="ann-bubble-n">' + escHtml(n) + '</span>'
    + (cap ? '<span class="ann-bubble-ref">' + escHtml(cap) + '</span>' : '')
    + '</div>' + body
    + (note.trim() ? bubbleNoteHtml(note, !!(opts && opts.noteExpanded)) : '');
}

/** Full bubble wrapper as a string (export use). Live uses bubbleInnerHtml on its own node.
 *  导出不消费 agent 备注：烤图是静态的，折叠头点不开，note 在这里剥掉。 */
export function bubbleHtml(m) {
  var n = (m && m.n) != null ? m.n : '';
  return '<div class="ann-bubble" data-n="' + escHtml(n) + '">'
    + bubbleInnerHtml(Object.assign({}, m, { note: '' }))
    + '</div>';
}
