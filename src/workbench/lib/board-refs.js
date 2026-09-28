// 图纸引用号（decisions 2026-08-15 A1 引用法）：section 在 board.json 里的顺序 →
// 字母 A/B/C…，section 内 screen 顺序 → 数字 1/2/3…。纯派生，不落盘；人对 agent
// 说 A2，机器引用仍走 @frame:id。消费端：画布图注（screen-load.js）、左栏大纲
// （app/Sidebar.jsx）、标注列表的行引用号（ann-bridge.js → app/AnnPopover.jsx）。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

import { legacyShell } from './preview-contracts.js';

/** 0 → A，25 → Z，26 → AA（表格列名式递进）。 */
export function sectionLetter(index) {
  var n = Math.max(0, Math.floor(Number(index) || 0));
  var out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * board.sections → { outline, bySection, byFrame }：
 * - outline: [{ id, title, letter, frames: [{ id, title, ref }] }]（引用序，大纲/图注直接消费）；
 * - bySection: sectionId → letter；
 * - byFrame: sectionId + '\0' + screenId → ref（同一 screen 重复挂载取首次出现）。
 * _empty 占位 section 不进引用体系（validateBoard 合成的空板标记，无对应图纸）。
 */
export function boardRefs(board) {
  var outline = [];
  var bySection = {};
  var byFrame = {};
  var sections = (board && board.sections) || [];
  sections.forEach(function (sec) {
    if (!sec || sec.id === '_empty') return;
    // doc 帧不上画布、不占编号（与 canvasBoard 同一口径）。这里自己过滤，服务端拿
    // board.json 原文直接调也能和画布对上：原文的 shell 可能只写在 section 上。
    var screens = (sec.screens || []).map(function (entry) {
      return typeof entry === 'string' ? { id: entry } : entry;
    }).filter(function (sc) {
      return legacyShell(sc.shell || sec.shell) !== 'doc';
    });
    if (!screens.length) return;
    var letter = sectionLetter(outline.length);
    bySection[sec.id] = letter;
    var frames = screens.map(function (sc, fi) {
      var ref = letter + (fi + 1);
      var key = sec.id + '\0' + sc.id;
      if (!byFrame[key]) byFrame[key] = ref;
      return { id: sc.id, title: sc.title || sc.id, ref: ref };
    });
    outline.push({ id: sec.id, title: sec.title || sec.id, letter: letter, frames: frames });
  });
  return { outline: outline, bySection: bySection, byFrame: byFrame };
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
export function refLikeFrameIds(board) {
  var seen = Object.create(null);
  var ids = [];
  ((board && board.sections) || []).forEach(function (sec) {
    ((sec && sec.screens) || []).forEach(function (entry) {
      var id = typeof entry === 'string' ? entry : entry && entry.id;
      if (!id || seen[id] || !REF_LIKE_ID_RE.test(id)) return;
      seen[id] = true;
      ids.push(id);
    });
  });
  return ids;
}
