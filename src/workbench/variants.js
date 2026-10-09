// 变体组的画布侧（2026-10-10；纯逻辑在 lib/variant-state.js，数据模型见 ADR 0039）。
//
// screen-load 把变体都渲染进板子，各带 data-var-group / 图注里的 tickbox；这里按本机偏好决定谁摆上画布：
// 收起 = 只有选中的（缺省第一个），展开 = 全部并排、选中的高亮。收起的变体不用 display:none ——
// 标注层靠“有排版”判锚点是否活着（annotate.js hasLayout），display:none 会让它们全显示“锚点失效”。
// 所以收起 = .wb-var-off：脱离网格、挪到画布外、不可见（index.html），DOM 与排版都在，标注照常解析，
// 只是钉子落在可视区外被裁掉。
import { wbGet } from './app/store.js';
import { syncBoardZoomLayout } from './boot-prefs.js';
import { readPrefs, savePrefs } from './lib/prefs.js';
import { groupState, variantGroupKey, variantShown, withGroupState } from './lib/variant-state.js';

var panelDeps = { onChange: null };

/** 板里的变体组：[{ key, section, ids, screens: [el…] }]（板序）。 */
function collectGroups(panel) {
  var groups = [];
  panel.querySelectorAll('.wb-lib-item').forEach(function (item) {
    var bySection = {};
    item.querySelectorAll('.wb-screen[data-var-group]').forEach(function (screen) {
      var gid = screen.getAttribute('data-var-group');
      if (!bySection[gid]) {
        bySection[gid] = { key: variantGroupKey(item.getAttribute('data-ann-section'), gid), section: item, id: gid, ids: [], screens: [] };
        groups.push(bySection[gid]);
      }
      bySection[gid].ids.push(screen.getAttribute('data-screen'));
      bySection[gid].screens.push(screen);
    });
  });
  return groups;
}

function renumberColumns(item) {
  var body = item.querySelector('.wb-sec-body');
  if (!body || !body.classList.contains('wb-sec-row')) return;
  var col = 0;
  body.querySelectorAll(':scope > .wb-screen').forEach(function (screen) {
    if (screen.classList.contains('wb-var-off')) return;
    col += 1;
    screen.style.setProperty('--wb-col', String(col));
  });
}

/** 把偏好灌进板子：显隐、选中高亮、tickbox / 展开钮读数、网格列号。装载板后与每次操作后都调。
    options.forceOpen = 全部展开（ppnt shot 用：一张图要把组里的变体都拍进去；不写偏好）。 */
export function applyVariantState(panel, pageId, options) {
  if (!panel) return;
  var prefs = readPrefs();
  var touched = [];
  collectGroups(panel).forEach(function (group) {
    var state = groupState(prefs, pageId, group.key, group.ids);
    if (options && options.forceOpen) state = { open: true, sel: state.sel };
    group.screens.forEach(function (screen) {
      var id = screen.getAttribute('data-screen');
      screen.classList.toggle('wb-var-off', !variantShown(state, id));
      screen.classList.toggle('wb-var-sel', state.open && state.sel === id);
      screen.setAttribute('data-var-open', state.open ? 'true' : 'false');
      screen.querySelectorAll('[data-var-pick]').forEach(function (tick) {
        tick.setAttribute('aria-checked', tick.getAttribute('data-var-pick') === state.sel ? 'true' : 'false');
      });
      screen.querySelectorAll('[data-var-toggle]').forEach(function (btn) {
        btn.textContent = state.open ? '收起' : '展开';
        btn.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      });
    });
    if (touched.indexOf(group.section) < 0) touched.push(group.section);
  });
  touched.forEach(renumberColumns);
  syncGroupBoxes(panel, openGroups(panel, pageId, prefs, options));
}

/** 展开的组：[{ group, state }]，供摆组底。 */
function openGroups(panel, pageId, prefs, options) {
  return collectGroups(panel).map(function (group) {
    var state = groupState(prefs, pageId, group.key, group.ids);
    if (options && options.forceOpen) state = { open: true, sel: state.sel };
    return { group: group, state: state };
  }).filter(function (entry) { return entry.state.open; });
}

/** 展开态的组底：每个展开的组一块框，跨它的列（列号 = renumberColumns 刚写的 --wb-col）。 */
function syncGroupBoxes(panel, opened) {
  panel.querySelectorAll('.wb-var-box, .wb-var-collapse').forEach(function (box) { box.remove(); });
  opened.forEach(function (entry) {
    var body = entry.group.section.querySelector('.wb-sec-body');
    if (!body || !body.classList.contains('wb-sec-row')) return;
    var cols = entry.group.screens
      .filter(function (el) { return !el.classList.contains('wb-var-off'); })
      .map(function (el) { return parseInt(el.style.getPropertyValue('--wb-col'), 10); })
      .filter(function (n) { return n > 0; });
    if (!cols.length) return;
    var box = document.createElement('div');
    box.className = 'wb-var-box';
    box.setAttribute('aria-hidden', 'true');
    box.setAttribute('data-var-box', entry.group.id);
    var span = Math.min.apply(null, cols) + ' / ' + (Math.max.apply(null, cols) + 1);
    box.style.gridColumn = span;
    body.insertBefore(box, body.firstChild);
    // “收起”挂在组底框的上沿（不占变体图注的位置）。框在帧之下（z:-1）吃不到点击，
    // 所以钮是框的同格兄弟、层级在帧之上。
    var collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'wb-var-collapse';
    collapse.setAttribute('data-var-toggle', '');
    collapse.setAttribute('data-var-box', entry.group.id);
    collapse.setAttribute('aria-expanded', 'true');
    collapse.textContent = '收起';
    collapse.style.gridColumn = span;
    body.insertBefore(collapse, box.nextSibling);
  });
}

// 点钮的那一帧在屏幕上的位置：变体展开 / 收起会让后面的帧挪位、画布变宽变窄；不补偿的话，
// 在最右边收起后视口会落在空白画布里。变了之后把锚帧挪回原处（instant，不动画）。
function anchorRect(screen) {
  var cap = screen && screen.querySelector('.wb-screen-cap');
  return cap ? cap.getBoundingClientRect() : null;
}

/** 一次性全部展开（不落偏好）：截图要把变体组整组拍进去、选中的高亮。 */
export function expandAllVariants() {
  var panel = document.getElementById('wb-board-panel');
  var pageId = wbGet().activePageId;
  if (!panel || !pageId) return false;
  applyVariantState(panel, pageId, { forceOpen: true });
  syncBoardZoomLayout();
  if (panelDeps.onChange) panelDeps.onChange();
  return true;
}

function change(panel, pageId, group, next, anchorScreen) {
  var stage = document.getElementById('wbstage');
  var before = anchorRect(anchorScreen);
  savePrefs(withGroupState(readPrefs(), pageId, group.key, group.ids, next));
  applyVariantState(panel, pageId);
  // 画布外框（.wb-zoom-wrap）的宽高是按内容量好钉死的：内容变宽 / 变窄后要重量，
  // 否则展开出来的变体被裁在旧外框外（点不到），收起后滚动范围还是旧的。
  syncBoardZoomLayout();
  if (stage && before) {
    // 锚帧被收起了（点的是别的变体的 tickbox）：改锚到现在摆在画布上的那一个。
    var anchor = anchorScreen.classList.contains('wb-var-off')
      ? group.screens.find(function (el) { return !el.classList.contains('wb-var-off'); })
      : anchorScreen;
    var after = anchorRect(anchor);
    if (after) {
      stage.scrollLeft += after.left - before.left;
      stage.scrollTop += after.top - before.top;
    }
  }
  if (panelDeps.onChange) panelDeps.onChange();
}

function groupOf(panel, el) {
  var screen = el.closest('.wb-screen[data-var-group]');
  var box = screen ? null : el.closest('.wb-var-collapse');
  if (!screen && !box) return null;
  var gid = screen ? screen.getAttribute('data-var-group') : box.getAttribute('data-var-box');
  var section = (screen || box).closest('.wb-lib-item').getAttribute('data-ann-section');
  var key = variantGroupKey(section, gid);
  return collectGroups(panel).find(function (g) { return g.key === key; }) || null;
}

/**
 * 选中某个变体；收起态下它就是被摆上画布的那个，展开态下它是被高亮的那个。
 * 目标不在画布上（收起且不是选中的）时，被导航 / 标注跳转用来把它“请出来”。返回是否有变化。
 */
export function revealVariant(panel, pageId, sectionId, screenId) {
  if (!panel) return false;
  var group = collectGroups(panel).find(function (g) {
    return g.ids.indexOf(screenId) >= 0 && g.section.getAttribute('data-ann-section') === sectionId;
  });
  if (!group) return false;
  var state = groupState(readPrefs(), pageId, group.key, group.ids);
  if (variantShown(state, screenId)) return false;
  change(panel, pageId, group, { open: state.open, sel: screenId });
  return true;
}

/** 事件委托：图注里的 tickbox（选中）与展开 / 收起钮。onChange = 变了之后让标注层和导航重算。 */
export function wireVariants(panel, options) {
  panelDeps.onChange = (options && options.onChange) || null;
  panel.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-var-pick]');
    var toggle = e.target.closest('[data-var-toggle]');
    if (!pick && !toggle) return;
    var pageId = wbGet().activePageId;
    var group = groupOf(panel, (pick || toggle));
    if (!group || !pageId) return;
    // 图注点击会选中 frame（stage.js）；变体控件的点击到这里为止。
    e.stopPropagation();
    e.preventDefault();
    var state = groupState(readPrefs(), pageId, group.key, group.ids);
    // 组底框上的“收起”没有自己的屏：锚点取组里摆在画布上的第一个变体。
    var screen = (pick || toggle).closest('.wb-screen')
      || group.screens.find(function (el) { return !el.classList.contains('wb-var-off'); });
    if (pick) change(panel, pageId, group, { open: state.open, sel: pick.getAttribute('data-var-pick') }, screen);
    else change(panel, pageId, group, { open: !state.open, sel: state.sel }, screen);
  });
}
