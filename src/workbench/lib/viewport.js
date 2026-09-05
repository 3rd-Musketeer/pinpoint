// 视口（viewport，2026-09-05）：文档条目怎么被看 —— 窗口 / 手机。
// owner 裁决：「doc 本身就是要展示的终态，而 prototype app 有多屏，所以 doc 可以只
// 展示 html 本身，而 app 需要 section + frames」；给要在手机上看的页面「应该给
// html / url 加一个切换不同 viewport 的功能」。用过第一版之后再裁：「html doc 的
// 手机视图就不需要画布了，直接就是一个自适应大小（大约 viewport 高度 90%）的手机
// screen，不需要状态栏和灵动岛；在画布上容易乱跑」。
//   · window = 文档形态：整份 HTML 在 iframe 里 1:1 铺满舞台；
//   · phone  = 同一份文档装进一个手机屏，居中摆在舞台上：iframe 的 CSS 视口恒为
//     402 × 874（iPhone 17 Pro CSS px，与 iOS frame 同一个 preset），整块屏按
//     phoneScaleFor 算出的 k 缩放，让它占可用区高度的九成；机壳跟「机壳 无 / 有」
//     设置走，但不带状态栏 / 岛 / home 条。
// 两种视口都是文档形态（stage 形态仍只由条目派生，lib/board-entries.js entryForm）：
// 没有网格、缩放、平移、图注、帧导航、导出——那些是画布工具。
// 视口是页的偏好（prefs.viewportByPage[pageId]），不进 registry、不进 URL；只对
// 文档条目有意义，画布条目永远是画布。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

export var VIEWPORT_WINDOW = 'window';
export var VIEWPORT_PHONE = 'phone';

/** 中文文案（横条两段控件）。 */
export var VIEWPORT_LABELS = { window: '窗口', phone: '手机' };

/** 手机屏的 CSS 视口（iframe 的布局尺寸）：与 kits/ios/ios-kit.css 的
    --ios-screen-w / --ios-screen-h 同源，是唯一的 device preset。 */
export var PHONE_SCREEN_W = 402;
export var PHONE_SCREEN_H = 874;

/** 屏占可用区的比例（owner：「大约 viewport 高度 90%」）。 */
export var PHONE_FILL = 0.9;

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

function positive(n, fallback) {
  return typeof n === 'number' && isFinite(n) && n > 0 ? n : fallback;
}

/** 手机屏的缩放系数 k。
    usable = { width, height, stripBand? }：舞台的尺寸与底部横条占的那一带
    （gap × 2 + strip-h）；可用高 = height − stripBand。左栏浮在画布上，不减。
    shell = { width, height }：整块屏（机壳 有 = 438 × 910，无 = 402 × 874）在
    transform 之前的布局尺寸；缺省按裸屏算。
    k 让屏高落在可用高的 PHONE_FILL，宽度同样不许超过舞台宽的 PHONE_FILL，
    上限 1（永不放大到 1:1 以上）；量不出尺寸时回 1。 */
export function phoneScaleFor(usable, shell) {
  var shellW = positive(shell && shell.width, PHONE_SCREEN_W);
  var shellH = positive(shell && shell.height, PHONE_SCREEN_H);
  var band = positive(usable && usable.stripBand, 0);
  var usableW = positive(usable && usable.width, 0);
  var usableH = positive((usable && usable.height) - band, 0);
  if (!usableW || !usableH) return 1;
  var k = Math.min(1, PHONE_FILL * usableH / shellH, PHONE_FILL * usableW / shellW);
  return Math.round(k * 10000) / 10000;
}
