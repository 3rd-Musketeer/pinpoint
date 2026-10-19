/**
 * Comment bubble template for the annotate review view.
 * Pure (no DOM) so the live /annotate.js (inlined) and the server-side export
 * share one implementation. Returns HTML strings; the caller mounts + positions.
 *
 * Bubble shape（2026-09-04 评审板 H1）：
 *   ┌────────────────────┐
 *   │ 1 指着的那段         │  ← 11px mono 眉标：序号 accent + 引用淡色
 *   │ 正文                 │
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
import { escHtml } from './esc-html.js';
export function bubbleCss() {
  return [
    '.ann-bubble{position:absolute;width:186px;background:var(--wb-surface,#ffffff);',
    'border:0;border-radius:var(--wb-r-3,8px);padding:7px 9px 8px;box-sizing:border-box;',
    'box-shadow:var(--wb-sh-2,0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.1));',
    'font:11px/1.45 var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Noto Sans SC",system-ui,sans-serif);',
    'color:var(--wb-fg,#202020);pointer-events:auto;z-index:3;overflow:hidden;}',
    '.ann-bubble[hidden]{display:none;}',
    '.ann-bubble-cap{display:flex;align-items:baseline;gap:5px;margin-bottom:3px;',
    'font-family:var(--wb-font-mono,ui-monospace,SFMono-Regular,Menlo,"PingFang SC",monospace);',
    'font-size:11px;line-height:1.3;color:var(--wb-muted,#646464);}',
    '.ann-bubble-n{flex:none;font-weight:var(--wb-w-semibold,600);letter-spacing:.04em;',
    'color:var(--wb-accent,#008564);}',
    '.ann-bubble-ref{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    // 正文 12.5/1.45。开头连续的目标引用单独一行；正文中间的引用留在原位，不拿出去拼。
    // 意见最多两行。pill：--wb-fill、12px、4px 圆角、横向 4px、最宽 100px，完整文字在 title 里。
    '.ann-bubble-body{font-size:12.5px;line-height:1.45;}',
    '.ann-bubble-refs{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:2px;}',
    '.ann-bubble-copy{white-space:pre-wrap;word-break:break-word;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
    '.ann-read-pill{display:inline-block;max-width:100px;vertical-align:baseline;box-sizing:border-box;',
    'padding:0 4px;border-radius:4px;background:var(--wb-fill,color-mix(in srgb,#202020 6%,transparent));',
    'font-size:12px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.ann-read-pill--missing{color:var(--wb-danger,#c0392b);}',
    '.ann-bubble-empty{color:var(--wb-faint,#646464);font-style:italic;}',
    '.ann-bubble-reply{margin-top:5px;padding-top:5px;border-top:1px solid var(--wb-seam,#cecece);white-space:pre-wrap;word-break:break-word;}',
    '.ann-bubble-who{font-family:var(--wb-font-mono,ui-monospace,SFMono-Regular,Menlo,"PingFang SC",monospace);font-size:10.5px;color:var(--wb-accent,#008564);margin-right:5px;}',
  ].join('');
}

function pillHtml(seg) {
  var cls = 'ann-read-pill' + (seg.missing ? ' ann-read-pill--missing' : '');
  return '<span class="' + cls + '" title="' + escHtml(seg.title) + '">' + escHtml(seg.label) + '</span>';
}

/** 开头连续的目标引用单独一行；正文中间的引用按原顺序留在意见里。
 *  没有 segments 时整段转义。 */
export function readingBodyHtml(m) {
  var segments = m && Array.isArray(m.segments) ? m.segments : null;
  if (!segments) return escHtml(m && m.content != null ? m.content : '');
  var lead = [];
  var i = 0;
  while (i < segments.length && segments[i] && segments[i].type === 'pill') lead.push(segments[i++]);
  var rest = '';
  for (; i < segments.length; i++) {
    var part = segments[i];
    if (!part) continue;
    rest += part.type === 'pill' ? pillHtml(part) : escHtml(part.text || '');
  }
  rest = rest.trim();
  // span 不是 div：列表行把这段塞进 .wb-ann-text（本身是 span），div 会被浏览器拆出父级。
  return (lead.length ? '<span class="ann-bubble-refs">' + lead.map(pillHtml).join('') + '</span>' : '')
    + (rest ? '<span class="ann-bubble-copy">' + rest + '</span>' : '');
}

/** Inner markup (眉标 + 正文) for one bubble. Caller wraps + positions.
 *  `m.cap` = 这条标注指着什么（annRowCap 的同一份口径）；没有就只出序号。 */
export function bubbleInnerHtml(m) {
  var n = (m && m.n) != null ? m.n : '';
  var cap = String((m && m.cap != null ? m.cap : '') || '').trim();
  var content = String((m && m.content != null ? m.content : '') || '');
  var hasBody = content || (m && Array.isArray(m.segments) && m.segments.length);
  var body = hasBody
    ? '<div class="ann-bubble-body">' + readingBodyHtml(m) + '</div>'
    : '<div class="ann-bubble-body ann-bubble-empty">（无正文）</div>';
  // 线程回复（m.replies = [{ who, text }]）：正文下面逐条，agent 改完说了什么 owner 在卡上就能读到。
  var replies = (m && Array.isArray(m.replies) ? m.replies : []).map(function (r) {
    return '<div class="ann-bubble-reply" data-who="' + escHtml(r.who) + '"><span class="ann-bubble-who">' + escHtml(r.who) + '</span>' + escHtml(r.text) + '</div>';
  }).join('');
  return '<div class="ann-bubble-cap">'
    + '<span class="ann-bubble-n">' + escHtml(n) + '</span>'
    + (cap ? '<span class="ann-bubble-ref">' + escHtml(cap) + '</span>' : '')
    + '</div>' + body + replies;
}
