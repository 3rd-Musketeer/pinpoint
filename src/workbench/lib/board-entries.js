// 板条目派生（2026-08-16f 产物与草稿模型，ROADMAP 阶段 6）：Page = 一件正在
// 做的事（线程容器），自身无类型；一个 Page 一份 board.json，板内容的可选单元
// 叫「条目」（entry）——
//   · 有 app/lock 屏则有一个「画布」条目（id 恒 CANVAS_ENTRY_ID，role product）；
//   · 每个 doc 屏各一个文档条目（id = screenId，role = screen 的 role 字段，
//     product 默认 / draft = 草稿；草稿恒为整页 HTML，与产物无机制耦合）。
// stage 形态由选中条目派生（entryForm），不再由 page.mode 派生；深链 / prefs /
// URL sync 都收到条目级（activeEntryId）。
// 2026-08-16f 阶段 7（左栏第二层合一）：条目类型下沉为产物条目的 tag
// （画布 / 文档）；contentsModel 给出侧栏「内容」区的
// 产物/草稿分组与坍缩规则。Page 行不再带任何类型信息。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

import { boardForTab, boardTabList, flattenTabs } from './board-tabs.js';

/* 画布条目 id 用 '@canvas'：screen id 契约是 /^[a-zA-Z0-9_-]+$/（preview-contracts
   ID_PATTERN），'@' 永不可能与 doc 屏 id 撞车，混合板条目 id 因此天然唯一。 */
export var CANVAS_ENTRY_ID = '@canvas';

function screenShellOf(sc) {
  return typeof sc === 'string' ? 'app' : sc.shell || 'app';
}

/** 文章画布（2026-10-15 一篇文章一张画布）：board 由正文派生（validateBoard 留下 article: true）。
 *  这种板上 HTML 帧（doc 屏）也摆在画布上，是一张白底卡片；双击卡片开完整页面浮层。
 *  存量页（手写 board.json）不受影响：doc 屏照旧是文档条目（ADR 0042）。 */
export function isArticleBoard(board) {
  return !!(board && board.article);
}

/** 条目是不是文章画布上一张 HTML 卡片的页面浮层：它不进大纲的条目行、横条不数它，
 *  只由双击卡片 / 右栏标注 / 深链打开，关掉回画布原位。 */
export function isPageOverlayEntry(entry) {
  return !!(entry && entry.kind === 'doc' && entry.overlay);
}

/** board（validateBoard 产物）→ 有序条目数组：画布条目居首，文档条目按 board 序。
 *  文章画布：只要有帧就有画布条目（HTML 帧也在画布上）；每个 HTML 帧仍有一个文档条目，带
 *  overlay: true，那是它的页面浮层（isPageOverlayEntry）。 */
export function boardEntries(board) {
  var entries = [];
  var hasCanvas = false;
  var docEntries = [];
  var article = isArticleBoard(board);
  ((board && board.sections) || []).forEach(function (sec) {
    (sec.screens || []).forEach(function (sc) {
      if (screenShellOf(sc) === 'doc') {
        var entry = {
          id: sc.id,
          kind: 'doc',
          role: sc.role === 'draft' ? 'draft' : 'product',
          title: sc.title || sc.id,
          section: sec.title || sec.id,
          sectionId: sec.id
        };
        if (article) { entry.overlay = true; hasCanvas = true; }
        docEntries.push(entry);
      } else {
        hasCanvas = true;
      }
    });
  });
  if (hasCanvas) {
    entries.push({ id: CANVAS_ENTRY_ID, kind: 'canvas', role: 'product', title: '画布' });
  }
  return entries.concat(docEntries);
}

/** 大纲浮层要画的那一截（2026-10-10）。
 *  指定了 tabId：view 只留这个 tab 的 section，帧号在 tab 内从 A 重计。
 *  tabId 空：没有 tab 的存量页，view 是整页；有 tab 时落到第一个 tab 的 section。
 *  单 tab 页那一个钮不传 tabId，第一个 tab 就是整页。
 *  有画布的页：文档 / 草稿只出现在第一个 tab 的浮层里（与「doc 条目归第一个 tab」一致），
 *  其它 tab 只留画布条目。
 *  纯文档的多 tab 页（2026-10-14）：没有帧可列，每个 tab 的浮层列这个 tab 自己的文档条目。 */
export function outlineSlice(board, tabId) {
  var flat = flattenTabs(board);
  var tabs = boardTabList(flat);
  var firstId = tabs.length ? tabs[0].id : '';
  var scoped = tabId || '';
  var view = tabs.length ? boardForTab(flat, scoped || firstId) : flat;
  if (tabs.length && !boardHasCanvas(flat)) {
    return { view: view, entries: boardEntries(view), showDocs: true, firstTabId: firstId };
  }
  var showDocs = !tabs.length || !scoped || scoped === firstId;
  var entries = boardEntries(showDocs ? flat : view);
  if (!showDocs) entries = entries.filter(function (e) { return e && e.kind === 'canvas'; });
  return { view: view, entries: entries, showDocs: showDocs, firstTabId: firstId };
}

/** 页上有没有画布条目。 */
export function boardHasCanvas(board) {
  var entries = boardEntries(flattenTabs(board));
  for (var i = 0; i < entries.length; i++) {
    if (entries[i] && entries[i].kind === 'canvas') return true;
  }
  return false;
}

/** 工作台渲染不渲染 #wbtabbar（2026-10-15）：有 ≥ 2 个 tab 才渲染，条目是什么类型都一样。
 *  不到 2 个 tab 不出条（文章画布、单 tab 与不带 tab 的存量页）：条上原本只剩一个大纲钮，
 *  悬在横条上方像个孤儿 tab（owner 2026-10-15），这个钮挪进横条（boardHasStripOutline）。 */
export function boardShowsTabBar(board) {
  return boardTabList(board).length >= 2;
}

/** 横条里有没有大纲钮（2026-10-15）：不出 tab 条、页上有画布时，大纲钮在横条里。
 *  单 tab 的纯文档页没有帧可列，不出钮（条目切换走横条的 ‹ n / N ›）。 */
export function boardHasStripOutline(board) {
  return !boardShowsTabBar(board) && boardHasCanvas(board);
}

/** 条上这个 tab 要不要大纲钮（2026-10-14）。有画布的页每个 tab 都要。
 *  纯文档页的浮层只列这个 tab 的文档，不到 2 篇时没什么可选，不出钮；切换靠 tab 标题。 */
export function tabHasOutline(board, tabId) {
  if (boardHasCanvas(board)) return true;
  return outlineSlice(board, tabId).entries.length >= 2;
}

/** 默认条目 = 画布条目（有画布时），否则第一个文档条目；空板 → null。 */
export function defaultEntryId(entries) {
  return entries && entries.length ? entries[0].id : null;
}

export function entryById(entries, id) {
  if (!entries || id == null) return null;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id === id) return entries[i];
  }
  return null;
}

/** 选中解析：非法 / 缺失 id 一律落默认条目（深链与 prefs 的容错点）。 */
export function resolveEntry(entries, id) {
  return entryById(entries, id) || entryById(entries, defaultEntryId(entries));
}

/** 条目 → stage 形态（沿用 data-page-mode 的 ios/html 值域：html = 文档阅读器）。 */
export function entryForm(entry) {
  return entry && entry.kind === 'doc' ? 'html' : 'ios';
}

/* ---- 阶段 7：条目类型 tag 与「内容」区坍缩 ------------------------------- */

/** 产物条目的类型 tag key（阶段 7，Page 去类型后类型信息的唯一落点）：
    canvas = 画布，doc = 文档。
    草稿条目不挂 tag（草稿恒为整页 HTML，无类型维度）。 */
export function entryTag(entry) {
  if (!entry) return null;
  return entry.kind === 'canvas' ? 'canvas' : 'doc';
}

/** tag key → 中文文案（mono 小字；消费端 = 侧栏产物条目行）。 */
export var ENTRY_TAG_LABELS = { canvas: '画布', doc: '文档' };

/** 侧栏「内容」区模型（阶段 7 坍缩规则，ROADMAP：单条目不显示目录）：
    - 纯画布页（有画布、无任何 doc 条目）：不出条目行（productRows 空），
      frame 树直接挂区头下 —— 即旧大纲体验，无多余「画布」行；
    - 纯单 doc 屏页（无画布无草稿）：整区不出现（hidden）——
      这类页占多数，侧栏立即干净；
    - 其余（画布+文档/草稿、多文档、多草稿）：产物组 / 草稿组条目行全出。
    frame 树的存在性由 tree 给出；显示时机（画布条目选中时才展开）归组件侧。 */
export function contentsModel(entries) {
  // 文章画布上的页面浮层不是条目行：那些页在画布上，是卡片（isPageOverlayEntry）。
  var list = (entries || []).filter(function (e) { return !isPageOverlayEntry(e); });
  var canvas = null;
  var productDocs = [];
  var drafts = [];
  list.forEach(function (e) {
    if (e && e.role === 'draft') { drafts.push(e); return; }
    if (e && e.kind === 'canvas') canvas = e;
    else if (e) productDocs.push(e);
  });
  var pureCanvas = !!canvas && productDocs.length === 0 && drafts.length === 0;
  var singlePlainDoc = !canvas && productDocs.length === 1 && drafts.length === 0;
  return {
    hidden: list.length === 0 || singlePlainDoc,
    canvas: canvas,
    productRows: pureCanvas ? [] : (canvas ? [canvas] : []).concat(productDocs),
    drafts: drafts,
    tree: !!canvas
  };
}
