/* 右栏重画。按引文位置排正文评论、按卡片位置穿插画布标注，重画前后保住输入框和编辑框的字与光标。
 * 导出 createRail。依赖 html.js 的卡片片段和 edit-field.js 的光标读写。 */

import { canvasRailItems, railOrder } from '../../shared/prose-thread.js';
import { canvasThreadHtml, draftHtml, esc, threadHtml } from './html.js';
import { placeRailCards } from './rail-layout.js';
import { buildTextIndex, offsetsToSegments } from './text-index.js';
import {
  editAreaOf,
  editFieldSelection,
  editFieldText,
  growEdit,
  railArea,
  setEditFieldSelection,
  setEditFieldText,
} from './edit-field.js';

export function createRail(opts) {
  var rail = opts.rail;
  var root = opts.root;
  var state = opts.state;
  var sync = opts.sync;
  var hooks = opts.hooks;
  // 宽屏（右栏在正文旁边，site.css 的 861px）才按锚点绝对定位、没选中的收成摘要。
  // 窄屏右栏排在正文下面，保持文档流和完整卡片。跨过这条线要重画：摘要是 HTML，不是样式。
  var wideQuery = window.matchMedia('(min-width: 861px)');
  var wasWide = wideQuery.matches;
  var GAP = 14;
  var placeFrame = 0;
  var resizeObserver = null;
  // 正在编辑或回复的那张：进入的那一次对齐锚点（不钉），之后打字、SSE 重画都钉住这个 top。
  // 重画会换掉节点，所以记在这里，不读卡片自己的 style。
  var heldId = null;
  var heldTop = null;
  var heldPlaced = false;

  /** 右栏即将因进入编辑或展开回复重画。这一次按锚点排，不沿用碰撞推开的旧位置；
   *  排完才记下 top，之后打字变高、SSE 推来回复都钉住它。 */
  function hold(id) {
    heldId = id;
    heldTop = null;
    heldPlaced = false;
  }

  /** 正在编辑或正在回复的那张优先：打字变高时它自己的 top 不动，只推下面的。没有就用选中的。 */
  function activeId() {
    if (state.editingId != null) {
      return state.editingId.indexOf('c:') === 0 ? state.editingId : state.editingId.split('/m')[0];
    }
    var open = null;
    state.replyOpen.forEach(function (id) { open = id; });
    if (open) return open;
    return state.focusedId;
  }

  function renderRail() {
    // value 和选区不能恢复浏览器的 composition 会话；所有更新合并到组字结束后重画。
    if (state.composingArea && state.composingArea.isConnected) { state.railDirty = true; return; }
    state.railDirty = false;
    // 重画会换掉卡片节点。先按 data-id 记下旧 top，新节点没有旧位置，过渡无从插值。
    var prevTops = {};
    var prevCards = rail.querySelectorAll('.pp-thread');
    for (var p = 0; p < prevCards.length; p++) {
      var prevTop = prevCards[p].style.top;
      if (prevTop) prevTops[prevCards[p].getAttribute('data-id')] = prevTop;
    }
    // 重画前记下输入框的内容与光标，重画后放回（SSE 推来 agent 回复时正在打字）。
    var keep = {};
    var active = document.activeElement;
    var areas = rail.querySelectorAll('textarea[data-reply]');
    for (var i = 0; i < areas.length; i++) {
      var key = areas[i].getAttribute('data-reply');
      keep[key] = {
        value: areas[i].value,
        focus: areas[i] === active,
        start: areas[i].selectionStart,
        end: areas[i].selectionEnd,
      };
      if (key !== '__draft') {
        if (areas[i].value) state.replyText[key] = areas[i].value;
        else delete state.replyText[key];
      }
    }
    var keepEdit = {};
    var editAreas = rail.querySelectorAll('textarea.pp-edit[data-edit], .pp-body.pp-edit[data-edit]');
    for (var j = 0; j < editAreas.length; j++) {
      var range = editFieldSelection(editAreas[j]);
      keepEdit[editAreas[j].getAttribute('data-edit')] = {
        value: editFieldText(editAreas[j]),
        focus: editAreas[j] === active,
        start: range.start,
        end: range.end,
      };
    }
    // 一列：正文评论按引文位置，画布标注按所属卡片的位置（排在紧跟卡片的那段正文之前），同位按 #n。
    var canvasItems = sync.canvas ? canvasRailItems(sync.canvas.rows(), hooks.canvasCards()) : [];
    var entries = state.rows.map(function (row) { return { kind: 'prose', row: row, n: row.n, key: hooks.orderKey(row) }; })
      .concat(canvasItems.map(function (item) {
        var at = state.cardOffsets.has(item.section) ? state.cardOffsets.get(item.section) - 0.5 : Infinity;
        return { kind: 'canvas', item: item, n: item.row.n, key: at };
      }));
    var ordered = railOrder(entries, function (e) { return e.key; });
    var list = '';
    var draftPlaced = false;
    var draftKey = state.draft ? state.draft.start : Infinity;
    var view = hooks.view();
    ordered.forEach(function (e) {
      if (state.draft && !draftPlaced && e.key > draftKey) { list += draftHtml(state.draft); draftPlaced = true; }
      list += e.kind === 'canvas' ? canvasThreadHtml(e.item, view) : threadHtml(e.row, view);
    });
    if (state.draft && !draftPlaced) list += draftHtml(state.draft);
    var empty = !ordered.length && !state.draft
      ? '<p class="empty-rail">选中正文里的一段文字，点“评论”。</p>'
      : '';
    var note = sync.connection() === 'offline'
      ? '未连接 pinpoint 服务，评论暂时存不下。'
      : (sync.prose.error() || (sync.canvas && sync.canvas.error()) || '');
    rail.innerHTML = '<div class="pp-rail-head"><div class="label">评论</div></div>'
      + '<div class="pp-threads">' + list + '</div>' + empty
      + '<p class="pp-rail-note" role="status">' + esc(note) + '</p>';
    // 新卡片当场排好再往下走：等下一帧才写 top，这一帧里所有卡片都叠在栏顶，
    // 接下来的 focus() 会把页面滚到栏顶（选中文字点“评论”跳走就是这个）。
    // 还在的卡片先写回旧 top 再过渡到目标；新出现的没有旧 top，直接放在目标位置。
    if (placeFrame) { cancelAnimationFrame(placeFrame); placeFrame = 0; }
    placeCards(prevTops);
    Object.keys(keep).forEach(function (id) {
      var area = railArea(rail, id);
      if (!area) return;
      area.value = keep[id].value;
      if (keep[id].focus) {
        area.focus({ preventScroll: true });
        try { area.setSelectionRange(keep[id].start, keep[id].end); } catch (e) { /* */ }
      }
    });
    // 编辑框：放回重画前的字与光标（没有旧字就是渲染时带上的原文），再按内容长高。
    // 框没了（SSE 推来状态改动把线程收成了行）：字收进 editText，别跟着框一起丢。
    Object.keys(keepEdit).forEach(function (id) {
      var area = editAreaOf(rail, id);
      if (!area) {
        if (state.editingId === id && keepEdit[id].value) state.editText[id] = keepEdit[id].value;
        return;
      }
      setEditFieldText(area, keepEdit[id].value);
      if (keepEdit[id].focus) {
        area.focus({ preventScroll: true });
        setEditFieldSelection(area, keepEdit[id].start, keepEdit[id].end);
      }
      growEdit(area);
    });
    // 刚展开的回复框：放回框收起前留下的草稿。
    state.replyOpen.forEach(function (id) {
      var area = railArea(rail, id);
      if (area && !area.value && state.replyText[id]) area.value = state.replyText[id];
    });
    Object.keys(sync.restoreText).forEach(function (id) {
      var area = railArea(rail, id);
      if (!area) return;
      area.value = area.value ? area.value + '\n' + sync.restoreText[id] : sync.restoreText[id];
      delete sync.restoreText[id];
    });
    schedulePlace();
  }

  /** 宽屏才按锚点排。窄屏（右栏在正文下面）清掉定位，回到文档流。 */
  function aligned() {
    return wideQuery.matches;
  }

  /** 引文在规范化文本里的 start 换成正文里那段的顶部。已关闭的线程不画 mark，
   *  但 state.anchors 里还有 start/end，用这个当锚点，不把它当成缺失。 */
  function quoteTop(start, railTop) {
    if (!Number.isFinite(start)) return null;
    var index = buildTextIndex(root);
    var segments = offsetsToSegments(start, start + 1, index);
    if (!segments.length) return null;
    var seg = segments[0];
    var range = document.createRange();
    range.setStart(seg.entry.node, seg.from);
    range.setEnd(seg.entry.node, Math.min(seg.entry.node.data.length, seg.from + 1));
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.top === 0 && rect.bottom === 0 && rect.height === 0)) return null;
    return rect.top - railTop;
  }

  /** 这张卡的锚点相对右栏内容顶部的高度。正文评论取第一个 mark.pp-hl 的顶部；
      没画高亮但引文还能定位的（已关闭、收着的）用引文位置。画布标注取所属画布卡片的顶部。
      引文失效、卡片不在，返回 null。 */
  function anchorTop(card, railTop) {
    var id = card.getAttribute('data-id');
    if (id === '__draft') {
      var draftMark = root.querySelector('mark.pp-hl.draft');
      return draftMark ? draftMark.getBoundingClientRect().top - railTop : null;
    }
    if (card.getAttribute('data-kind') === 'canvas') {
      var section = card.getAttribute('data-section') || '';
      var canvas = section ? root.querySelector('[data-pp-canvas][data-pp-section="' + (window.CSS && CSS.escape ? CSS.escape(section) : section) + '"]') : null;
      return canvas ? canvas.getBoundingClientRect().top - railTop : null;
    }
    var marks = root.querySelectorAll('mark.pp-hl');
    for (var i = 0; i < marks.length; i++) {
      var ids = (marks[i].getAttribute('data-ids') || '').split(' ');
      if (ids.indexOf(id) >= 0) return marks[i].getBoundingClientRect().top - railTop;
    }
    var hit = state.anchors && state.anchors.get(id);
    if (hit && Number.isFinite(hit.start)) return quoteTop(hit.start, railTop);
    return null;
  }

  /** 读当前布局、算出每张卡的 top，写回去。只读几何、只写 top，合并到一帧里做。
   *  fromTops：重画前按 data-id 记下的旧 top。有旧位置的先写回去、强制一次布局，再写目标，过渡才插值得到。 */
  function placeCards(fromTops) {
    placeFrame = 0;
    var list = rail.querySelector('.pp-threads');
    if (!list) return;
    var cards = list.querySelectorAll(':scope > .pp-thread');
    if (!aligned()) {
      rail.classList.remove('pp-rail-aligned');
      list.style.height = '';
      for (var k = 0; k < cards.length; k++) cards[k].style.top = '';
      return;
    }
    rail.classList.add('pp-rail-aligned');
    // 锚点相对卡片容器，不相对整栏：栏顶的“评论”标题不占卡片的 top。
    var railTop = list.getBoundingClientRect().top;
    var items = [];
    for (var i = 0; i < cards.length; i++) {
      items.push({ id: cards[i].getAttribute('data-id'), anchor: anchorTop(cards[i], railTop), height: cards[i].offsetHeight });
    }
    // 选中的卡片上面挤不下时，可以越过栏顶一直排到文档顶部：它自己必须留在锚点旁边。
    var docTop = -(railTop + window.scrollY);
    // 正在编辑或回复，而且这一次已经按锚点排过：钉住那个 top。进入的第一次不钉，对齐锚点。
    // 钉在排版之前定好，上面往上挤、下面往下推一次算完，不再先排好再整段平移。
    var pinId = (state.editingId != null || state.replyOpen.size > 0) ? activeId() : null;
    var pinTop = null;
    if (pinId && pinId === heldId && heldPlaced && heldTop != null) pinTop = heldTop;
    if (!pinId) { heldId = null; heldTop = null; heldPlaced = false; }
    var placed = placeRailCards(items, activeId(), GAP, docTop, pinTop == null ? undefined : { pinTop: pinTop });
    if (pinId && pinId === heldId) {
      for (var h = 0; h < placed.length; h++) {
        if (placed[h].id === pinId) { heldTop = placed[h].top; heldPlaced = true; break; }
      }
    }
    var motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var seed = fromTops && motion ? fromTops : null;
    if (seed) {
      var seeded = false;
      for (var s = 0; s < cards.length; s++) {
        var oldTop = seed[cards[s].getAttribute('data-id')];
        if (!oldTop || oldTop === placed[s].top + 'px') continue;
        cards[s].style.top = oldTop;
        seeded = true;
      }
      // 强制一次布局：新节点先落在旧 top，下一行写目标 top 才有起点可插值。
      if (seeded) void list.offsetHeight;
    }
    var bottom = 0;
    for (var j = 0; j < cards.length; j++) {
      cards[j].style.top = placed[j].top + 'px';
      bottom = Math.max(bottom, placed[j].top + items[j].height);
    }
    list.style.height = (cards.length ? bottom : 0) + 'px';
  }

  function schedulePlace() {
    if (placeFrame) return;
    placeFrame = requestAnimationFrame(placeCards);
  }

  /** 正文高度、卡片高度、窗口尺寸变了就重排。观察者一直看着，不在重画时断开：
   *  排版只写 top 和容器高度，写完的这一轮回调合并进同一帧，不会自己再排一遍。 */
  function watchLayout() {
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', schedulePlace);
      return;
    }
    resizeObserver = new ResizeObserver(function () { schedulePlace(); });
    resizeObserver.observe(root);
    resizeObserver.observe(rail);
    window.addEventListener('resize', function () {
      if (wideQuery.matches !== wasWide) { wasWide = wideQuery.matches; renderRail(); return; }
      schedulePlace();
    });
  }

  watchLayout();

  /** 卡片超出视口时才滚页面，让它进来。已经在视口里就不动 scrollY：宽屏下卡片贴着锚点，点高亮不必滚。
   *  要看的是卡片顶部时传 card；进编辑或点“回复”时传输入框，卡片顶看得见不代表框也看得见。 */
  function revealCard(card, target) {
    if (!card) return;
    // top 有过渡动画，渲染位置还在旧处：按刚写上的目标 top 算，不读 card 自己的 rect。
    var list = card.parentElement;
    var top = list.getBoundingClientRect().top + (parseFloat(card.style.top) || 0);
    var el = target && target.isConnected ? target : card;
    var elTop = el === card ? top : top + (el.getBoundingClientRect().top - card.getBoundingClientRect().top);
    var box = { top: elTop, bottom: elTop + el.offsetHeight };
    var viewTop = 72;
    var viewBottom = window.innerHeight;
    // 要看的那一块顶部在视口里、并且至少露出一行（约 40px）就不滚。
    // 长卡片底部超出视口时滚页面，会把读者正在看的正文拽走。
    var readable = 40;
    if (box.top >= viewTop && box.top + readable <= viewBottom) return;
    // 要滚时停在视口下沿以上 24px，不贴着屏幕底边。
    var margin = 24;
    var delta = box.top < viewTop ? box.top - viewTop : Math.min(box.bottom - (viewBottom - margin), box.top - viewTop);
    window.scrollBy({ top: delta, left: 0 });
  }

  /** 让卡片进视口：宽屏按目标 top 判断、顶部看得见就不滚；窄屏右栏在正文下面，照常滚到它。
   *  target 是卡片里真正要看的那一块（回复框、编辑框）。给了就看它，不看整张卡。 */
  function reveal(card, target) {
    if (!card) return;
    if (aligned()) revealCard(card, target);
    else (target && target.isConnected ? target : card).scrollIntoView({ block: 'nearest' });
  }

  function focusThread(id, focusOpts) {
    state.focusedId = id;
    renderRail();
    hooks.syncFocusClasses();
    var t = rail.querySelector('.pp-thread[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    // 宽屏卡片贴锚点，先排好再决定要不要滚页面。窄屏仍滚到卡片（右栏在正文下面）。
    if (t && (!focusOpts || focusOpts.scroll !== false)) {
      if (aligned()) {
        placeCards();
        revealCard(t);
      } else {
        t.scrollIntoView({ block: 'nearest' });
      }
    }
    if (focusOpts && focusOpts.reveal && !aligned()) {
      var mark = root.querySelector('mark.pp-hl.on');
      if (mark) mark.scrollIntoView({ block: 'nearest' });
    }
  }

  return { renderRail: renderRail, focusThread: focusThread, schedulePlace: schedulePlace, hold: hold, reveal: reveal };
}
