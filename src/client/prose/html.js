/* 右栏卡片的 HTML 片段。纯函数，不读闭包状态：状态钉、引文、线程消息、已关闭一行、
 * 正文线程、画布标注卡片、草稿卡。导出 esc、statusChip、quoteHtml、messageEditKey、messagesHtml、
 * collapsedHtml、threadHtml、canvasThreadHtml、draftHtml。 */

import { ANN_STATUS_COLORS } from '../../shared/ann-status.js';
import {
  authorLabel,
  canvasContentHasTargets,
  canvasContentText,
  canvasLeadingEdit,
  canvasLeadingLabel,
  formatWhen,
  isProseClosed,
  threadMessages,
} from '../../shared/prose-thread.js';

export function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

export function statusChip(row) {
  var st = row.status || 'open';
  var known = Object.prototype.hasOwnProperty.call(ANN_STATUS_COLORS, st) ? st : 'open';
  var n = Number.isInteger(row.n) ? '#' + row.n : '#…';
  var word = st === 'open' ? '' : '<span class="pp-st">' + esc(st) + '</span>';
  // 钉子颜色归站点样式（.pp-n[data-st]，--pp-status-*，亮暗都对）。
  return '<span class="pp-n" data-st="' + known + '">' + esc(n) + '</span>' + word;
}

export function quoteHtml(exact) {
  var text = String(exact || '');
  if (text.length > 160) text = text.slice(0, 157) + '…';
  return '<div class="q">' + esc(text) + '</div>';
}

/** 这一句能不能点着改。threadKey 是线程的编辑键（正文评论 id，或 'c:' + 画布标注 id）；
    第一句用它本身，owner 之后的回复再加 '/m' + messages 下标。agent 的、空的不给键。
    画布标注的目标记号夹在文字中间时也不给：右栏显示的是换成元素文字的结果，整段存回去会丢掉记号。
    记号全在开头时给键，键只落在记号后面的文字上。 */
export function messageEditKey(row, messageIndex, threadKey) {
  if (!threadKey) return '';
  var messages = threadMessages(row);
  var message = messages[messageIndex];
  if (!message || message.who !== 'owner' || typeof message.text !== 'string' || !message.text) return '';
  if (messageIndex === 0) {
    if (threadKey.indexOf('c:') === 0 && canvasContentHasTargets(row) && !canvasLeadingEdit(row.content)) return '';
    return threadKey;
  }
  if (threadKey.indexOf('c:') === 0) return ''; // 画布标注的回复在画布上改，右栏只改正文第一句
  return threadKey + '/m' + (messageIndex - 1);
}

/** 开头全是目标记号：元素文字在前、只读，后面的文字单独可点。编辑时后面那段仍是这个 span，
    只是可写；记号留在 span 外面。换成 textarea 会另起一行，并把后面的文字收进一条更窄的矩形。 */
function leadingEditHtml(row, leading, editKey, editingId, editText) {
  var label = canvasLeadingLabel(row, leading.prefix);
  var lead = label ? '<span class="pp-targets">' + esc(label) + '</span>' : '';
  var value = editText[editKey] != null ? editText[editKey] : leading.text;
  var body = editingId === editKey
    ? '<span class="pp-body pp-edit" contenteditable="plaintext-only" role="textbox" aria-multiline="true" data-edit="' + esc(editKey) + '" aria-label="编辑评论">' + esc(value) + '</span>'
    : '<span class="pp-body" data-edit="' + esc(editKey) + '" title="点击编辑">' + esc(leading.text) + '</span>';
  return '<div class="text pp-with-targets' + (lead ? ' pp-with-lead' : '') + '">' + lead + body + '</div>';
}

/** 线程消息。owner 写的那几句可点着改：正在编辑就渲染成编辑框，否则渲染成带 data-edit 的正文
    （agent 的回复、引文、记号夹在中间的画布标注正文永远不可编辑）。 */
export function messagesHtml(row, threadKey, editingId, editText) {
  var messages = threadMessages(row);
  var leading = threadKey && threadKey.indexOf('c:') === 0 ? canvasLeadingEdit(row.content) : null;
  // 画布标注的第一句：记号全在开头时，框里只放后面的文字；否则显示成元素文字。存盘正文留在 row 上。
  if (threadKey && threadKey.indexOf('c:') === 0 && messages[0]) {
    messages = messages.slice();
    messages[0] = { who: messages[0].who, text: leading ? leading.text : canvasContentText(row), at: messages[0].at };
  }
  return '<div class="msgs">' + messages.map(function (m, i) {
    var editKey = messageEditKey(row, i, threadKey);
    var body;
    if (editKey && leading && i === 0) {
      body = leadingEditHtml(row, leading, editKey, editingId, editText);
    } else if (editKey) {
      if (editingId === editKey) {
        var value = editText[editKey] != null ? editText[editKey] : m.text;
        body = '<textarea class="pp-edit" data-edit="' + esc(editKey) + '" aria-label="编辑评论">' + esc(value) + '</textarea>';
      } else {
        body = '<div class="text" data-edit="' + esc(editKey) + '" title="点击编辑">' + esc(m.text) + '</div>';
      }
    } else {
      body = '<div class="text">' + esc(m.text) + '</div>';
    }
    return '<div class="msg" data-who="' + esc(m.who) + '"><span class="who' + (m.who === 'agent' ? ' agent' : '') + '">' + esc(authorLabel(m.who)) + '</span>'
      + '<span class="when">' + esc(formatWhen(m.at)) + '</span>' + body + '</div>';
  }).join('') + '</div>';
}

// 已关闭的线程留在原位收成一行：序号钉 + “已关闭” + 引文开头，点开成完整卡片，再点收回。
export function collapsedHtml(row) {
  var n = Number.isInteger(row.n) ? '#' + row.n : '#…';
  return '<div class="pp-thread pp-closed" data-id="' + esc(row.id) + '" data-n="' + esc(row.n) + '" data-status="close">'
    + '<button type="button" class="pp-closed-row" data-act="expand" aria-expanded="false">'
    + '<span class="pp-n" data-st="close">' + esc(n) + '</span>'
    + '<span class="pp-closed-word">已关闭</span>'
    + '<span class="pp-closed-peek">' + esc(String((row.quote && row.quote.exact) || '')) + '</span>'
    + '<span class="pp-chev" aria-hidden="true"></span></button></div>';
}

export function threadHtml(row, view) {
  if (isProseClosed(row) && !view.expanded.has(row.id)) return collapsedHtml(row);
  var anchor = view.anchors.get(row.id);
  var stale = anchor === null && view.anchors.has(row.id);
  var closed = (row.status || 'open') === 'close';
  var act = closed
    ? '<button class="pp-act" type="button" data-act="reopen">重新打开</button>'
    : '<button class="pp-act" type="button" data-act="close">完成</button>';
  var focused = row.id === view.focusedId;
  // 回复框默认不出现：点“回复”才展开，发送后收起。框收起时留着的草稿在按钮上标出来。
  var reply = view.replyOpen.has(row.id)
    ? '<div class="pp-reply"><textarea data-reply="' + esc(row.id) + '" rows="2" placeholder="回复…" aria-label="回复 #' + esc(row.n) + '"></textarea>'
      + '<div class="acts"><button class="btn pri" type="button" data-act="reply">发送</button></div></div>'
    : '<div class="pp-foot"><button class="pp-act" type="button" data-act="open-reply">回复</button>'
      + (view.replyText[row.id] ? '<span class="pp-draft-tag">有草稿</span>' : '') + '</div>';
  return '<div class="pp-thread' + (stale ? ' stale' : '') + (focused ? ' on' : '') + '" data-id="' + esc(row.id) + '" data-n="' + esc(row.n) + '" data-status="' + esc(row.status || 'open') + '">'
    + '<div class="pp-meta">' + statusChip(row)
    + (stale ? '<span class="pp-stale" title="正文里找不到这段引文了">失效</span>' : '')
    + '<span class="sp"></span>' + act
    + (isProseClosed(row) ? '<button class="pp-act pp-fold" type="button" data-act="collapse" aria-expanded="true" aria-label="收起"><span class="pp-chev up" aria-hidden="true"></span></button>' : '')
    + '</div>'
    + quoteHtml(row.quote && row.quote.exact)
    + messagesHtml(row, row.id, view.editingId, view.editText)
    + reply
    + '</div>';
}

// 画布标注（@canvas）在右栏里的卡片：标明是画布标注和帧名，有截图放缩略图；点了在文章上开画布浮层、
// 定位到这颗钉子（a[data-pp-canvas-link]，site/src/lib/canvas-overlay-client.js 接住）。四态与已关闭
// 原地收起同正文评论；这里改状态，也改 owner 的正文（点着进编辑，同正文评论），回复在画布上。
// 开头全是 [@t:iN] 时只改后面的文字，记号原样接回去。记号夹在文字中间时不进编辑。
// 线程 id 带 c: 前缀，和正文评论分开。
export function canvasThreadHtml(item, view) {
  var row = item.row;
  var key = 'c:' + row.id;
  var text = canvasContentText(row);
  var n = Number.isInteger(row.n) ? '#' + row.n : '#…';
  var attrs = ' data-kind="canvas" data-id="' + esc(key) + '" data-n="' + esc(row.n) + '" data-section="' + esc(item.section) + '" data-frame="' + esc(item.frameId) + '"';
  if (isProseClosed(row) && !view.expanded.has(key)) {
    return '<div class="pp-thread pp-closed pp-canvas-ann"' + attrs + ' data-status="close">'
      + '<button type="button" class="pp-closed-row" data-act="expand" aria-expanded="false">'
      + '<span class="pp-n" data-st="close">' + esc(n) + '</span>'
      + '<span class="pp-closed-word">已关闭</span>'
      + '<span class="pp-kind">画布</span>'
      + '<span class="pp-closed-peek">' + esc(text) + '</span>'
      + '<span class="pp-chev" aria-hidden="true"></span></button></div>';
  }
  var closed = isProseClosed(row);
  var act = closed
    ? '<button class="pp-act" type="button" data-act="reopen">重新打开</button>'
    : '<button class="pp-act" type="button" data-act="close">完成</button>';
  var image = Array.isArray(row.images) && row.images[0] && row.images[0].file
    ? '<img class="pp-canvas-shot" alt="" loading="lazy" src="' + esc(view.SERVER + '/images/' + encodeURIComponent(row.images[0].file) + '?entry=' + encodeURIComponent(view.ENTRY)) + '">'
    : '';
  return '<div class="pp-thread pp-canvas-ann"' + attrs + ' data-status="' + esc(row.status || 'open') + '">'
    + '<div class="pp-meta">' + statusChip(row) + '<span class="pp-kind">画布标注</span>'
    + '<span class="sp"></span>' + act
    + (closed ? '<button class="pp-act pp-fold" type="button" data-act="collapse" aria-expanded="true" aria-label="收起"><span class="pp-chev up" aria-hidden="true"></span></button>' : '')
    + '</div>'
    + '<a class="pp-canvas-open" data-pp-canvas-link href="' + esc(view.canvasHref(item)) + '" title="在画布上打开这条标注">'
    + image + '<span class="pp-canvas-frame">帧<b>' + esc(item.frameTitle) + '</b></span></a>'
    + messagesHtml(row, key, view.editingId, view.editText)
    + '</div>';
}

export function draftHtml(draft) {
  return '<div class="pp-thread draft on" data-id="__draft">'
    + quoteHtml(draft.quote.exact)
    + '<textarea data-reply="__draft" rows="3" placeholder="写评论…" aria-label="写评论"></textarea>'
    + '<div class="acts"><button class="btn" type="button" data-act="cancel-draft">取消</button>'
    + '<button class="btn pri" type="button" data-act="send-draft">发送</button></div></div>';
}
