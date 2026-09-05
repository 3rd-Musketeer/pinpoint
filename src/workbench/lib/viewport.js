// 视口（viewport，2026-09-05）：文档条目怎么被看 —— 窗口 / 手机。
// owner 裁决：「doc 本身就是要展示的终态，而 prototype app 有多屏，所以 doc 可以只
// 展示 html 本身，而 app 需要 section + frames」；给要在手机上看的页面「应该给
// html / url 加一个切换不同 viewport 的功能」。
//   · window = 今天的文档形态：整份 HTML 在 iframe 里 1:1 铺满舞台；
//   · phone  = 同一份文档装进一个手机 frame 摆上画布：iframe 402 × 874（iPhone 17 Pro
//     CSS px，与 iOS frame 同一个 preset），机壳跟「机壳 无 / 有」设置走。
// 视口是页的偏好（prefs.viewportByPage[pageId]），不进 registry、不进 URL；只对
// 文档条目有意义，画布条目永远是画布。stage 形态因此由「条目 + 视口」一起派生
// （stageFormFor），activeBoardMode() 与 pages.js 都走这一个函数。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。
import { canvasBoard, entryForm } from './board-entries.js';

export var VIEWPORT_WINDOW = 'window';
export var VIEWPORT_PHONE = 'phone';

/** 中文文案（横条两段控件）。 */
export var VIEWPORT_LABELS = { window: '窗口', phone: '手机' };

/** 未知 / 缺省一律落窗口：偏好里的脏值不能把页面变成第三种形态。 */
export function normalizeViewport(value) {
  return value === VIEWPORT_PHONE ? VIEWPORT_PHONE : VIEWPORT_WINDOW;
}

/** prefs.viewportByPage 的宽容读法（缺失 / 非对象 → {}）。 */
export function readViewportPrefs(prefs) {
  var raw = prefs && prefs.viewportByPage;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function viewportForPage(prefs, pageId) {
  if (!pageId) return VIEWPORT_WINDOW;
  return normalizeViewport(readViewportPrefs(prefs)[pageId]);
}

/** 写侧的 patch（savePrefs 合并写）：窗口是默认值，落回窗口时删 key，偏好不积灰。 */
export function withViewportPref(prefs, pageId, viewport) {
  var all = Object.assign({}, readViewportPrefs(prefs));
  if (normalizeViewport(viewport) === VIEWPORT_PHONE) all[pageId] = VIEWPORT_PHONE;
  else delete all[pageId];
  return { viewportByPage: all };
}

/** 视口开关只对文档条目出现；画布条目没有第二种看法。 */
export function entryHasViewport(entry) {
  return !!entry && entry.kind === 'doc';
}

/** 条目 + 视口 → stage 形态：文档条目在手机视口下就是画布（ios），其余照 entryForm。 */
export function stageFormFor(entry, viewport) {
  if (entryHasViewport(entry) && normalizeViewport(viewport) === VIEWPORT_PHONE) return 'ios';
  return entryForm(entry);
}

/** 画布视图（导出树 / 尺寸行）：手机视口下画布上只有当前这一份文档的 frame，
    所以导出树只列它；其余形态照 canvasBoard（doc 屏从不上画布）。 */
export function exportBoardFor(board, entry, viewport) {
  if (stageFormFor(entry, viewport) === 'ios' && entryHasViewport(entry)) {
    var sections = ((board && board.sections) || []).map(function (sec) {
      var screens = (sec.screens || []).filter(function (sc) {
        return sc && typeof sc === 'object' && sc.id === entry.id;
      });
      return Object.assign({}, sec, { screens: screens });
    }).filter(function (sec) { return sec.screens.length > 0; });
    return { sections: sections };
  }
  return canvasBoard(board);
}
