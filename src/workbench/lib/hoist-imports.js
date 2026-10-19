/**
 * 每个帧片段都自带一条 `<style>@import url(页面.css)</style>`，同一份 CSS 在板上被当成
 * 几十张独立样式表，样式引擎逐张匹配（plugins 57 张 → 切标注模式重算 106ms，去重后 37ms）。
 * 板级装载时把每屏 import-only 的 style 拆出来，按内容去重、提到 .wb-library 最前只留一份；
 * 帧片段本身（单帧热更新、/api/frame、导出）不动，仍各带自己的 CSS。ppnt shot 从板上克隆帧 / 节，
 * 克隆里没有被提走的这几条，由 bin/ppnt-shot.js 补回快照。
 *
 * 所有权（final review M4）：提走的样式归板上用到它的那几屏共有。每屏用到哪几条记在
 * 这一屏的 data-wb-imports 上；板级那一组永远等于 hoistedKeys(各屏清单，按板上顺序)。
 * 整板装载与按屏换内容（HMR、重置）都按这一条算：最后一个使用者删掉 import 才撤销，
 * 旁屏还在用的保留，新出现的照提，顺序与刷新后整板装载的一致。
 */
var IMPORT_ONLY = /<style>(\s*@import[^<;]+;\s*)<\/style>/g;

/** 板级那一组样式的标记；ppnt shot 按 .wb-library 直接子 STYLE 收，标记不影响它。 */
export var HOISTED_ATTR = 'data-wb-hoisted';
/** 一屏用到的 import 清单（JSON 数组）记在 .wb-screen 的这个属性上。 */
export var SCREEN_IMPORTS_ATTR = 'data-wb-imports';

/** 拆出一屏 HTML 里 import-only 的 style：keys 按首次出现排、去重，rest 是去掉它们之后的 HTML。 */
export function splitImportOnlyStyles(html) {
  var keys = [];
  var rest = String(html).replace(IMPORT_ONLY, function (whole, css) {
    var key = css.trim();
    if (keys.indexOf(key) < 0) keys.push(key);
    return '';
  });
  return { keys: keys, rest: rest };
}

/** 板级应有的样式：各屏清单按板上顺序拼起来、按首次出现去重。没有任何屏再用的那条不在里面。 */
export function hoistedKeys(screenKeyLists) {
  var out = [];
  screenKeyLists.forEach(function (keys) {
    (keys || []).forEach(function (key) {
      if (out.indexOf(key) < 0) out.push(key);
    });
  });
  return out;
}

/** 一条 import 还原成帧片段里的写法（重置记下的初始 HTML 要带着它，换回时照样拆出来）。 */
export function importStyleHtml(key) {
  return '<style>' + key + '</style>';
}

/** 板级那一组里的一条（整板装载拼进 .wb-library 开头）。key 里没有 `<`（见 IMPORT_ONLY），可原样放进 style。 */
export function hoistedStyleHtml(key) {
  return '<style ' + HOISTED_ATTR + '>' + key + '</style>';
}

/** 读一屏的 import 清单；属性缺失或坏掉都当没有。 */
export function readScreenImports(screen) {
  var raw = screen && screen.getAttribute(SCREEN_IMPORTS_ATTR);
  if (!raw) return [];
  try {
    var keys = JSON.parse(raw);
    return Array.isArray(keys) ? keys.filter(function (k) { return typeof k === 'string'; }) : [];
  } catch (e) {
    return [];
  }
}

/** 按各屏清单重排 library 开头的板级样式：没人用的删掉，缺的补上，已有的元素原样保留
    （不重建就不重新拉取、不重新解析），只在位置不对时挪。 */
export function syncHoistedStyles(library) {
  if (!library) return;
  var lists = [];
  library.querySelectorAll('.wb-screen[' + SCREEN_IMPORTS_ATTR + ']').forEach(function (screen) {
    lists.push(readScreenImports(screen));
  });
  var want = hoistedKeys(lists);
  var have = new Map();
  Array.prototype.forEach.call(library.children, function (child) {
    if (child.tagName !== 'STYLE' || !child.hasAttribute(HOISTED_ATTR)) return;
    var key = child.textContent;
    if (want.indexOf(key) < 0 || have.has(key)) child.remove();
    else have.set(key, child);
  });
  var anchor = library.firstChild;
  want.forEach(function (key) {
    var el = have.get(key);
    if (!el) {
      el = library.ownerDocument.createElement('style');
      el.setAttribute(HOISTED_ATTR, '');
      el.textContent = key;
    }
    if (el === anchor) anchor = anchor.nextSibling;
    else library.insertBefore(el, anchor);
  });
}
