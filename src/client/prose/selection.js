/* 选区 → “评论”按钮 → 草稿。选区不碰正文、落在画布卡片或图上时不出按钮。
 * 导出 createSelection。依赖 buildTextIndex、rangeToOffsets、SKIP_SELECTOR。 */

import { quoteFromText } from '../../shared/text-quote.js';
import { buildTextIndex, rangeToOffsets, sectionAtFor, SKIP_SELECTOR } from './text-index.js';

export function createSelection(opts) {
  var root = opts.root;
  var rail = opts.rail;
  var state = opts.state;
  var hooks = opts.hooks;

  var selBtn = null;

  function hideSelBtn() {
    if (selBtn) { selBtn.remove(); selBtn = null; }
    state.pendingSel = null;
  }

  function hasSelBtn() {
    return !!selBtn;
  }

  function selectionQuote() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    var startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    var endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    if ((startEl && startEl.closest(SKIP_SELECTOR)) || (endEl && endEl.closest(SKIP_SELECTOR))) return null;
    var index = buildTextIndex(root);
    var offsets = rangeToOffsets(range, index);
    if (!offsets) return null;
    var quote = quoteFromText(index.text, offsets.start, offsets.end);
    if (!quote) return null;
    return {
      quote: { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix, start: quote.start },
      start: quote.start,
      end: quote.end,
      section: sectionAtFor(index)(quote.start),
      rect: range.getBoundingClientRect(),
    };
  }

  function onSelectionDone(e) {
    if (e && e.target && e.target.closest && (e.target.closest('.pp-selbtn') || rail.contains(e.target))) return;
    setTimeout(function () {
      var picked = selectionQuote();
      state.selectionChecks += 1;
      state.lastOffered = !!picked;
      if (!picked) { hideSelBtn(); return; }
      if (selBtn && state.pendingSel && state.pendingSel.start === picked.start && state.pendingSel.end === picked.end) return;
      hideSelBtn();
      state.pendingSel = picked;
      selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'btn pri pp-selbtn';
      selBtn.textContent = '评论';
      var r = picked.rect;
      var left = Math.min(r.right + window.scrollX - 24, window.scrollX + document.documentElement.clientWidth - 72);
      selBtn.style.left = Math.max(window.scrollX + 8, left) + 'px';
      selBtn.style.top = Math.max(window.scrollY + 8, r.top + window.scrollY - 42) + 'px';
      selBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      selBtn.addEventListener('click', startDraft);
      document.body.appendChild(selBtn);
    }, 0);
  }

  function startDraft() {
    if (!state.pendingSel) return;
    state.draft = { quote: state.pendingSel.quote, section: state.pendingSel.section, start: state.pendingSel.start, end: state.pendingSel.end };
    hideSelBtn();
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    state.focusedId = '__draft';
    hooks.render();
    var area = rail.querySelector('textarea[data-reply="__draft"]');
    if (area) { area.scrollIntoView({ block: 'nearest' }); area.focus(); }
  }

  return { hideSelBtn: hideSelBtn, hasSelBtn: hasSelBtn, onSelectionDone: onSelectionDone, startDraft: startDraft };
}
