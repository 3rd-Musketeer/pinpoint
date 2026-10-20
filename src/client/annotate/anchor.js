// 锚点解析：frame 内选择器归一、ppId 回退、live / broken 判定，以及
// 标注节点表 markNodes。导出 bind_anchor、init_anchor、resolveMarkAnchor、
// isMarkBroken、markOnActivePage 等。
import { normalizeTargetRefs } from '../../shared/annotation-indicator.js';
import { FRAME_STAGE_SELECTOR, frameInternalSelector, queryFrameScope } from '../../shared/frame-anchor.js';
import { ppIdAttrSelector, pickByTargetText } from '../../shared/ann-ppid.js';
import { annMarkBroken } from '../../shared/ann-row.js';
import { regionContains } from './create.js';
import { classifyTarget, cssPath, docRect, docToView, excerpt, markFact, ppIdOf, resolve, screenIdOf, sectionOf } from './dom.js';
import { annotationSection } from './marks.js';
export function bind_anchor(c) { ctx = c; }
var ctx;

export function init_anchor() {
  ctx.liveTargetBatch = null;
  ctx.structureDirty = true;
  ctx.markNodes = Object.create(null); // n -> { m, parts: [{ frame, badge }], arrow, liveTargets? }
}

// ---------- frame 内锚点归一（阶段 5 透传）----------
// frameInternalSelector / FRAME_STAGE_SELECTOR 由 src/shared/frame-anchor.js 内联提供。
// 行带 screenId 且 selector 含 stage 段 → 只在该 frame 的 stage 根里解析：
// 画布（.wb-screen[data-screen] 下的 stage）与 /api/frame 嵌入页（文档唯一
// stage）两端同构互解；frame 换序/跨 section 移动后锚点自愈。派生不出 frame
// 内路径的 selector（id 短路等）维持全局解析 —— 存量语义逐字节不变。
function scopedStageRoot(screenId) {
  if (ctx.FRAME) return document.querySelector(FRAME_STAGE_SELECTOR);
  if (!screenId) return null;
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return null;
  if (!ctx.frameRoots) {
    ctx.frameRoots = new Map();
    panel.querySelectorAll('.wb-screen[data-screen]').forEach(function (screen) {
      ctx.frameRoots.set(screen.getAttribute('data-screen'), screen.querySelector(FRAME_STAGE_SELECTOR));
    });
  }
  return ctx.frameRoots.get(screenId) || null;
}

export function resolveMarkSelector(selector, screenId) {
  if (!selector) return null;
  var rel = frameInternalSelector(selector);
  if (rel && (ctx.FRAME || screenId)) {
    var sid = ctx.FRAME ? ctx.FRAME.screenId : screenId;
    var key = sid + '\n' + selector;
    if (!ctx.selectorCache.has(key)) ctx.selectorCache.set(key, queryFrameScope(scopedStageRoot(sid), rel));
    return ctx.selectorCache.get(key);
  }
  return resolve(selector);
}

// ---------- ppId 优先解析（决定 #15）----------
// target 带 ppId（编译页源码稳定 id）时先按 [data-pp-id="…"] 找：帧结构改了
// （前面插元素、换包裹层）cssPath 的 nth-of-type 会漂到别的元素上，ppId 只要
// 那行源码还在就指同一个元素。范围与 cssPath 解析同界 —— 帧的 stage 根里
// （同行多实例靠文本择近；kit 组件同 id 出现在多帧时也不串）。多命中取文本
// 最接近的（pickByTargetText，src/shared/ann-ppid.js 内联）；找不到回落
// cssPath + 文本。缓存走同一个 selectorCache：clearAnchorCache 一并失效。
function resolveByPpId(ppId, text, screenId) {
  var sel = ppIdAttrSelector(ppId);
  if (!sel) return null;
  var sid = ctx.FRAME ? ctx.FRAME.screenId : (screenId || '');
  var key = sid + '\nppId:' + ppId + '\n' + (text || '');
  if (ctx.selectorCache.has(key)) {
    var cached = ctx.selectorCache.get(key);
    if (!cached || cached.isConnected) return cached;
  }
  var root = scopedStageRoot(sid) || document;
  var hits = [];
  try { hits = Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return null; }
  var best = pickByTargetText(hits.map(function (el) { return { el: el, text: excerpt(el) }; }), text);
  var el = best ? best.el : null;
  ctx.selectorCache.set(key, el);
  return el;
}

/** 一个 target 的解析（决定 #15 优先级）：ppId 先行，cssPath 兜底。 */
// 多选跨 frame：每个 target 自带所在 frame（screenId）；存量 target 没有，回落到 fallbackScreenId（行 / 部件的 frame）。
export function resolveMarkTarget(target, fallbackScreenId) {
  if (!target || !target.selector) return null;
  var screenId = target.screenId || fallbackScreenId || '';
  if (target.ppId) {
    var byId = resolveByPpId(target.ppId, target.text || '', screenId);
    if (byId) return byId;
  }
  return resolveMarkSelector(target.selector, screenId);
}

/** Annotation belongs to the active workbench page. */
export function markOnActivePage(m) {
  if (!m) return false;
  // /api/frame 嵌入帧：本实例只承载「某一个 frame」的标注 —— 同账本里其它
  // page/screen 的行既不渲染也不计数（行的读写仍整账本报文，绝不丢行）。
  if (ctx.FRAME) return m.pageId === ctx.FRAME.pageId && m.screenId === ctx.FRAME.screenId;
  // storage-unify：桶 = 页 —— 画布账本（@canvas）与独立文档账本（按路径分）
  // 整本都属于「当前这一页」，行上的 pageId 不再承担归属：rename 只改桶名
  // 不改行，切页 = 换桶。旧「一本账装多页」按 pageId/section/锚点过滤的
  // 判定随共享账本一起退役。
  return true;
}

// ---------- section / frame stamping ----------
export function stampTargetMeta(m, el) {
  var s = sectionOf(el);
  if (s) {
    m.section = s.section;
    m.sectionLabel = s.sectionLabel;
  }
  var sid = screenIdOf(el);
  if (sid) m.screenId = sid;
  // /api/frame 嵌入帧：DOM 近亲查不到（或结构漂移）时用注入身份兜底，
  // 保证行恒带画布侧的 pageId/section/screenId 三件套。
  if (ctx.FRAME) {
    if (!m.screenId) m.screenId = ctx.FRAME.screenId;
    if (!annotationSection(m) && ctx.FRAME.section) {
      m.section = ctx.FRAME.section;
      m.sectionLabel = ctx.FRAME.sectionLabel || ctx.FRAME.section;
    }
  }
  m.indicatorKind = classifyTarget(el);
  return m;
}

/** True when `el` has a rendered box an annotation can anchor to.
 *  offsetParent is an HTML-box-model concept: SVG / MathML / foreignObject
 *  nodes leave it undefined, so a visible <text>/<path> read as "no layout"
 *  under the old probe and falsely showed 锚点失效. Keep offsetParent as the
 *  fast path (so nothing previously live becomes broken) and fall back to
 *  geometry for non-HTML namespaces and any element with a rendered rect.
 *  This is the single "has layout" probe — isHidden and regionContains share
 *  it so the ctx.lasso and the anchor-brokenness check can't drift apart. */
export function hasLayout(el) {
  if (!el || el === document.body) return true;
  if (el.offsetParent) return true;
  if (getComputedStyle(el).position === 'fixed') return true;
  if (el.getClientRects && el.getClientRects().length) return true;
  return false;
}

// display:none / 无 layout → 没有 rendered box（fixed 除外）；SVG 等非 HTML 盒
// 模型节点走 getClientRects 兜底，否则可见的 <text> 会被误判隐藏。
export function isHidden(el) {
  return !hasLayout(el);
}

// ---------- multi-anchor element marks ----------
export function markElementTargets(m) {
  if (!m || m.type !== 'element') return [];
  return normalizeTargetRefs(m.targets);
}

export function withLiveTargets(fn) {
  if (ctx.liveTargetBatch) return fn();
  ctx.liveTargetBatch = new Map();
  try { return fn(); } finally { ctx.liveTargetBatch = null; }
}

export function resolveAllLiveTargets(m) {
  if (ctx.liveTargetBatch && ctx.liveTargetBatch.has(m)) return ctx.liveTargetBatch.get(m);
  var out = [];
  markElementTargets(m).forEach(function (t) {
    var el = resolveMarkTarget(t, m.screenId);
    if (el && !isHidden(el)) {
      out.push({ el: el, ref: t.ref, selector: t.selector, text: t.text, rectDoc: docRect(el) });
    }
  });
  if (ctx.liveTargetBatch) ctx.liveTargetBatch.set(m, out);
  return out;
}

export function normalizeElementTargets(m) {
  if (!m || m.type !== 'element') return m;
  var targets = markElementTargets(m);
  if (targets.length) {
    m.targets = targets;
    m.selector = targets[0].selector;
    m.text = targets[0].text || '';
  }
  return m;
}

// 决定 #15 迁移：存量标注不带 ppId，owner 下次编辑保存时在这里自然补上 ——
// 不跑账本迁移脚本，磁盘账本不整体重写。解析不到的目标不硬补（锚已失效的
// 行保持原样，等 cssPath 修好或被人处理）；补 ppId 不改 selector 集合，服务
// 端的目标指纹不变，状态不会被这次保存顶回 open。
export function backfillTargetPpIds(m) {
  if (!m || m.type !== 'element') return m;
  var targets = markElementTargets(m);
  var changed = false;
  targets.forEach(function (t) {
    if (t.ppId) return;
    var el = resolveMarkTarget(t, m.screenId);
    var ppId = el ? ppIdOf(el) : '';
    if (ppId) { t.ppId = ppId; changed = true; }
  });
  // markElementTargets 给的是归一副本：改在副本上，必须写回 m.target 再归一，
  // 否则补的字段随副本一起丢。
  if (changed) {
    m.targets = targets;
    normalizeElementTargets(m);
  }
  return m;
}
// ---------- 锚点解析（live vs broken；禁止用陈旧 rect 画框）----------
export function resolveMarkAnchor(m) {
  if (!m) return { live: false, el: null, rectDoc: null };
  if (m.type === 'element') {
    var lives = resolveAllLiveTargets(m);
    if (!lives.length) return { live: false, el: null, rectDoc: null };
    return { live: true, el: lives[0].el, rectDoc: lives[0].rectDoc };
  }
  var el = null;
  var mSid = m.screenId || '';
  if (m.base && m.base.selector) {
    el = resolveMarkSelector(m.base.selector, mSid);
  } else if (m.contains && m.contains.length) {
    for (var i = 0; i < m.contains.length; i++) {
      el = resolveMarkSelector(m.contains[i].selector, mSid);
      if (el) break;
    }
  }
  if (!el || isHidden(el)) return { live: false, el: null, rectDoc: null };
  // region: translate stored box by live base delta (same zoom session / layout shift)
  if (m.base && m.base.rect) {
    var now = docRect(el);
    var br = m.base.rect;
    var rr = m.rect || br;
    // 双向透传把 region 带到另一份文档（画布 zoom ≠ 嵌入页 1:1）：平移之外按
    // 锚元素的尺寸比缩放，比例 1 时与旧行为逐值相同。
    var sx = br[2] > 0 ? now[2] / br[2] : 1;
    var sy = br[3] > 0 ? now[3] / br[3] : 1;
    return {
      live: true,
      el: el,
      rectDoc: [
        Math.round(now[0] + (rr[0] - br[0]) * sx),
        Math.round(now[1] + (rr[1] - br[1]) * sy),
        Math.round(rr[2] * sx),
        Math.round(rr[3] * sy)
      ]
    };
  }
  return { live: true, el: el, rectDoc: docRect(el) };
}

export function screenOffTab(screenId) {
  var wb = window.workbench;
  return !!(wb && typeof wb.isScreenOffTab === 'function' && wb.isScreenOffTab(screenId));
}

export function markHasLiveTarget(m) {
  if (!m) return false;
  var fact = markFact(m);
  if (fact.live != null) return fact.live;
  fact.live = computeMarkLive(m);
  return fact.live;
}

function computeMarkLive(m) {
  if (m.type === 'element' && markElementTargets(m).length) {
    return resolveAllLiveTargets(m).length > 0;
  }
  return resolveMarkAnchor(m).live;
}

/** The anchor target still resolves, even if its current product view is hidden.
 *  A hidden tab / route is not a broken annotation: once the view returns,
 *  the same anchor can become live again. The resolvability walk itself is
 *  the shared pure predicate from src/shared/ann-row.js (inlined at serve time);
 *  the callback owns the 决定 #15 priority (ppId first, cssPath fallback). */
export function isMarkBroken(m) {
  var sid = (m && m.screenId) || '';
  // 页 tab（ADR 0041）：这屏在另一个 tab 里、此刻没挂载 —— 找不到锚点是因为没挂，不是标注坏了。
  // 切到那个 tab 之前既不画钉子（不是 live）也不画幽灵框（不是 broken）。
  if (sid && screenOffTab(sid)) return false;
  var fact = markFact(m);
  if (fact.broken == null) fact.broken = annMarkBroken(m, function (target) { return !!resolveMarkTarget(target, sid); }, markElementTargets(m));
  return fact.broken;
}

export function markAnchorRect(m) {
  var a = resolveMarkAnchor(m);
  return a.live ? a.rectDoc : null;
}

export function moveEndPoint(m) {
  var mv = m.move;
  if (!mv) return null;
  if (mv.to_selector) {
    var el = resolveMarkSelector(mv.to_selector, m.screenId || '');
    if (el && !isHidden(el)) {
      var r = docRect(el);
      var rel = mv.to_rel || [0.5, 0.5];
      return [r[0] + r[2] * rel[0], r[1] + r[3] * rel[1]];
    }
    return null; // end anchor broken — do not paint from stale to_point
  }
  return mv.to_point || null;
}

function markAnchorViewRect(m) {
  var r = markAnchorRect(m);
  return r ? docToView(r) : null;
}

function markAnchorEl(m) {
  return resolveMarkAnchor(m).el;
}
