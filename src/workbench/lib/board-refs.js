// 图纸引用号（decisions 2026-08-15 A1 引用法）：section 在 board.json 里的顺序 →
// 字母 A/B/C…，section 内 screen 顺序 → 数字 1/2/3…。纯派生，不落盘；人对 agent
// 说 A2，机器引用仍走 @frame:id。消费端：画布图注（screen-load.js）、页 tab 条上的
// 大纲浮层（app/OutlinePopover.jsx）、标注列表的行引用号（ann-bridge.js → app/AnnPopover.jsx）。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

import { legacyShell } from './preview-contracts.js';
import { boardTabList, flattenTabs } from './board-tabs.js';
import { isSectionLetter, sectionLetter } from '../../shared/project-ids.js';

// 节字母（A … Z、AA …）定义在 src/shared/project-ids.js：正文节标题与画布编号同一套。
export { isSectionLetter, sectionLetter };

/**
 * board.sections → { outline, bySection, byFrame, tabs }：
 * - outline: [{ id, title, letter, tabId?, frames: [{ id, title, ref, tabId?, doc? }] }]（引用序，大纲/图注直接消费；
 *   doc 只出现在文章画布上，标出文档帧）；
 * - bySection: sectionId → letter；
 * - byFrame: sectionId + '\0' + screenId → ref（同一 screen 重复挂载取首次出现）；
 * - tabs?: [{ id, title }]（ADR 0041 页 tab；存量 board 没有这个键，结果形状同从前）。
 * 编号按 tab 重新从 A 开始（tabId 一变，字母计数清零）；section / screen id 全页唯一，
 * 所以 bySection / byFrame 仍以 id 为键，不必带 tab。多 tab 页上的位置号靠 tabId 区分，
 * 机器侧引用写 `<tabId>:B3`（server/lib/ann-refs.js）。
 * _empty 占位 section 不进引用体系（validateBoard 合成的空板标记，无对应图纸）。
 */
export function boardRefs(rawBoard) {
  var board = flattenTabs(rawBoard);
  var outline = [];
  var bySection = {};
  var byFrame = {};
  var counters = {};
  var sections = (board && board.sections) || [];
  sections.forEach(function (sec) {
    if (!sec || sec.id === '_empty') return;
    // 存量页：doc 帧不上画布、不占编号（画布视图的口径，各消费端直接喂 board 即可）。这里自己过滤，服务端拿
    // board.json 原文直接调也能和画布对上：原文的 shell 可能只写在 section 上。
    // 文章画布（节带正文字母）：编号跟正文走，第 n 节的第 k 帧就是 <字母>k，文档帧（HTML 帧）也占号，
    // 带 doc: true，画布上的消费端（大纲的帧树）据此跳过它们（docs/projects.md“HTML 帧”）。
    var article = isSectionLetter(sec.letter);
    var screens = (sec.screens || []).map(screenOf).filter(function (sc) {
      return article || legacyShell(sc.shell || sec.shell) !== 'doc';
    });
    if (!screens.length) return;
    var tabKey = sec.tabId || '';
    var index = counters[tabKey] || 0;
    counters[tabKey] = index + 1;
    // 文章画布（pp3）的 board 由正文派生，每节带正文里的字母（正文所有 Section 一起数，
    // 纯文字的节也占字母）：画布编号与文章节标题对得上。手写 board 不写这个字段。
    var letter = isSectionLetter(sec.letter) ? sec.letter : sectionLetter(index);
    bySection[sec.id] = letter;
    var frames = screens.map(function (sc, fi) {
      var ref = letter + (fi + 1);
      var key = sec.id + '\0' + sc.id;
      if (!byFrame[key]) byFrame[key] = ref;
      var frame = { id: sc.id, title: sc.title || sc.id, ref: ref };
      if (article && legacyShell(sc.shell || sec.shell) === 'doc') frame.doc = true;
      if (tabKey) frame.tabId = tabKey;
      return frame;
    });
    var section = { id: sec.id, title: sec.title || sec.id, letter: letter, frames: frames };
    if (tabKey) section.tabId = tabKey;
    outline.push(section);
  });
  var result = { outline: outline, bySection: bySection, byFrame: byFrame };
  var tabs = boardTabList(board);
  if (tabs.length) result.tabs = tabs;
  return result;
}

/** (board, sectionId, screenId) → 'A1' | ''（查不到即空串，调用方自行降级）。 */
export function frameRef(board, sectionId, screenId) {
  if (!board || !sectionId || !screenId) return '';
  return boardRefs(board).byFrame[sectionId + '\0' + screenId] || '';
}

// 形如显示编号的帧 id（a1-home、c1b-detail、b3）：编号按位置派生、调序就变，
// id 不变；id 仿编号，两套编号迟早对不上（2026-09-28 routine-creator：D1 的文件叫 c1-detail）。
var REF_LIKE_ID_RE = /^[a-z]{1,2}[0-9]+[a-z]?(?:-|$)/i;

/** board → 形如编号的帧 id 列表（board 序、去重）；ppnt build 据此提示。 */
/** board.sections[].screens 的条目可以是 id 字符串或屏对象；统一成对象（其余原样返回）。 */
export function screenOf(entry) {
  return typeof entry === 'string' ? { id: entry } : entry;
}

/** boardRefs 结果里按 section 序摊平的全部 frame。 */
export function outlineFrames(refs) {
  return refs.outline.flatMap(function (section) { return section.frames; });
}

// 手写在 title 里的编号前缀（K11 提交前确认、B3 · 登录）：编号由系统派生，手写必重复（ADR 0026）。
var REF_LIKE_TITLE_RE = /^[A-Za-z]{1,2}[0-9]+[a-z]?(?:[\s·:：.\-—]|$)/;

/** board → title 以编号样前缀开头的帧 / 段标题（board 序、去重）；ppnt build 据此提示。 */
export function refLikeTitles(rawBoard) {
  var board = flattenTabs(rawBoard);
  var seen = Object.create(null);
  var titles = [];
  function note(title) {
    if (typeof title !== 'string' || seen[title] || !REF_LIKE_TITLE_RE.test(title)) return;
    seen[title] = true;
    titles.push(title);
  }
  ((board && board.sections) || []).forEach(function (sec) {
    if (!sec) return;
    note(sec.title);
    (sec.screens || []).forEach(function (entry) {
      var sc = screenOf(entry);
      if (sc) note(sc.title);
    });
  });
  return titles;
}

export function refLikeFrameIds(rawBoard) {
  var board = flattenTabs(rawBoard);
  var seen = Object.create(null);
  var ids = [];
  ((board && board.sections) || []).forEach(function (sec) {
    ((sec && sec.screens) || []).forEach(function (entry) {
      var sc = screenOf(entry);
      var id = sc && sc.id;
      if (!id || seen[id] || !REF_LIKE_ID_RE.test(id)) return;
      seen[id] = true;
      ids.push(id);
    });
  });
  return ids;
}
