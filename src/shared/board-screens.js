// board 的唯一遍历器（S2：替掉 page-compiler 的 screenIdsFromBoard / screenEntriesFromBoard、
// frame-doc 的 findScreen、stage.js loadBoard 的去重、board-entries 与 sites-api 各自的
// sections 遍历 —— 此前同一概念的六份平行实现，r2-consistency D2）。
//
// screenEntries(board)：摊平 tabs（shared/board-tabs.js），按板序逐屏产出
// { screen, section }；字符串屏归一成 { id }，section 是它所在的 section 对象。
// 同一个屏 id 在板里出现多次时只出第一次（编译、装载、findScreen 的既有口径都是
// 首次出现）。不校验形状、不滤 id（合法性归 validateBoard / 编译侧各自把关），
// 坏条目跳过。纯函数、DOM-free（node --test 直测）。

import { flattenTabs } from './board-tabs.js';

export function screenEntries(board) {
  var flat = flattenTabs(board);
  var sections = flat && Array.isArray(flat.sections) ? flat.sections : [];
  var seen = new Set();
  var out = [];
  for (var i = 0; i < sections.length; i++) {
    var section = sections[i];
    if (!section || typeof section !== 'object') continue;
    var screens = Array.isArray(section.screens) ? section.screens : [];
    for (var j = 0; j < screens.length; j++) {
      var raw = screens[j];
      var screen = typeof raw === 'string' ? { id: raw } : raw;
      if (!screen || typeof screen.id !== 'string' || !screen.id) continue;
      if (seen.has(screen.id)) continue;
      seen.add(screen.id);
      out.push({ screen: screen, section: section });
    }
  }
  return out;
}
