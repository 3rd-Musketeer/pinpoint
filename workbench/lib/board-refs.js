// 图纸引用号（decisions 2026-08-15 A1 引用法）：section 在 board.json 里的顺序 →
// 字母 A/B/C…，section 内 screen 顺序 → 数字 1/2/3…。纯派生，不落盘；人对 agent
// 说 A2，机器引用仍走 @frame:id。消费端：画布图注（screen-load.js）、左栏大纲
// （app/Sidebar.jsx）、右栏标注分组徽标（ann-bridge.js → app/AnnPanel.jsx）。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

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
    var letter = sectionLetter(outline.length);
    bySection[sec.id] = letter;
    var frames = (sec.screens || []).map(function (entry, fi) {
      var sc = typeof entry === 'string' ? { id: entry } : entry;
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
