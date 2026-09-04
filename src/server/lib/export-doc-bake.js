/**
 * Server-side helpers for baking annotation marks + comment bubbles into doc exports.
 * Paints the same yellow boxes + orange number badges as the live annotate overlay,
 * plus sidebar comment bubbles in a right gutter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { targetContentToDisplay } from '../../shared/annotation-indicator.js';
import { bubbleCss } from '../../shared/annotate-bubble.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BAKE_LIBS = [
  '../../shared/annotate-clip.js',
  '../../shared/annotate-bubble.js',
  '../../workbench/lib/annotate-bubble-layout.js',
];

function stripExportKeywords(src) {
  return src.replace(/^export /gm, '');
}

function readBakeLibs() {
  return BAKE_LIBS.map((name) => {
    const file = path.join(__dirname, name);
    return stripExportKeywords(fs.readFileSync(file, 'utf8'));
  }).join('\n');
}

/** Live-matching mark box + badge + bubble CSS for export bake. */
export function exportMarkCss() {
  return [
    '.ann-target{position:absolute;box-sizing:border-box;',
    'border:2px solid rgba(245,166,35,.85);border-radius:4px;',
    'background:rgba(245,166,35,.05);pointer-events:none;z-index:1;}',
    '.ann-frame{position:absolute;box-sizing:border-box;',
    'border:2px dashed #f5a623;background:rgba(245,166,35,.06);',
    'border-radius:6px;pointer-events:none;z-index:1;}',
    '.ann-badge{position:absolute;width:22px;height:22px;border-radius:50%;',
    'background:#f5a623;color:#1a1a1a;font-size:12px;font-weight:700;',
    'display:flex;align-items:center;justify-content:center;',
    'box-shadow:0 1px 2px rgba(0,0,0,.06),0 0 0 0.5px rgba(0,0,0,.04);pointer-events:none;z-index:3;}',
    bubbleCss(),
  ].join('');
}

/**
 * Prepare annotations for bake / text export.
 * Assigns stable display numbers when `n` is missing.
 * Resolves [@t:iN] target refs and [@a:id] mentions to display form.
 */
export function prepareExportAnnotations(annotations) {
  const list = Array.isArray(annotations) ? annotations : [];
  let auto = 1;
  const byId = new Map();
  const prepared = list.map((raw, i) => {
    const a = raw && typeof raw === 'object' ? raw : {};
    const n = a.n != null ? a.n : auto++;
    const targets = Array.isArray(a.targets) ? a.targets : [];
    const item = {
      n,
      id: a.id || null,
      type: a.type || 'element',
      selector: a.selector || (targets[0] && targets[0].selector) || null,
      text: a.text || (targets[0] && targets[0].text) || '',
      targets,
      content: a.content != null ? String(a.content) : '',
      rect: Array.isArray(a.rect) ? a.rect : null,
      base: a.base || null,
      contains: Array.isArray(a.contains) ? a.contains : null,
      _index: i,
    };
    if (item.id) byId.set(String(item.id), item);
    return item;
  });
  for (const item of prepared) {
    let content = targetContentToDisplay(item.content, item.targets);
    content = content.replace(/\[@a:([A-Za-z0-9._-]+)\]/gi, (_, id) => {
      const hit = byId.get(String(id));
      return hit ? ('@' + hit.n) : '@?';
    });
    item.content = content;
  }
  return prepared;
}

/** Plain-text comments section for html-no-css + comments. */
export function formatCommentsTextSection(annotations) {
  const prepared = prepareExportAnnotations(annotations);
  if (!prepared.length) {
    return '<section id="comments">\n<h2>Comments</h2>\n<p>（无评论）</p>\n</section>\n';
  }
  const items = prepared.map((a) => {
    const anchor = a.text ? ` [${escapeHtml(a.text)}]` : '';
    return `<li>#${escapeHtml(a.n)}${anchor}: ${escapeHtml(a.content)}</li>`;
  }).join('\n');
  return [
    '<section id="comments">',
    '<h2>Comments</h2>',
    '<ol>',
    items,
    '</ol>',
    '</section>',
    '',
  ].join('\n');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build an IIFE that paints live-style mark boxes + number badges.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.defer=false] When true (standalone HTML export), place on
 *   load/resize so marks follow the viewer's layout — absolute coords baked at a
 *   fixed Playwright width drift when `@media` / `margin:auto` see a different
 *   window. When false (PNG path), place immediately and set __EXPORT_BAKE_RESULT__.
 */
export function buildExportBakeScript(annotations, opts) {
  opts = opts || {};
  const defer = !!opts.defer;
  const bubbles = !!opts.bubbles;
  const docW = Number(opts.docW) || 0;
  const prepared = prepareExportAnnotations(annotations);
  const libs = readBakeLibs();
  const payload = JSON.stringify(prepared);
  const glue = `
(function () {
  var BADGE = 22;
  var annotations = ${payload};
  var defer = ${defer ? 'true' : 'false'};
  var bubbles = ${bubbles ? 'true' : 'false'};
  var docW = ${docW};
  window.__EXPORT_ANNOTATIONS__ = annotations;

  function ensureChrome() {
    if (!document.querySelector('style[data-export-comments]')) {
      var style = document.createElement('style');
      style.setAttribute('data-export-comments', '');
      style.textContent = ${JSON.stringify(exportMarkCss())}
        + 'body{position:relative;}'
        + (bubbles && docW > 0
          ? 'body{padding-right:' + GUTTER_W + 'px !important;}'
          : '')
        + '#ann-export-overlay{position:absolute;left:0;top:0;width:100%;pointer-events:none;z-index:2147483000;}'
        + '#ann-export-overlay .ann-target,#ann-export-overlay .ann-frame,'
        + '#ann-export-overlay .ann-badge{position:absolute;pointer-events:none;}'
        + '#ann-export-overlay .ann-bubble{position:absolute;pointer-events:none;}';
      (document.head || document.documentElement).appendChild(style);
    }
    var overlay = document.getElementById('ann-export-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ann-export-overlay';
      overlay.setAttribute('data-export-comments', '');
      (document.body || document.documentElement).appendChild(overlay);
    }
    return overlay;
  }

  function localRect(overlay, el) {
    var r = el.getBoundingClientRect();
    var o = overlay.getBoundingClientRect();
    return [r.left - o.left, r.top - o.top, r.width, r.height];
  }

  function resolveSelector(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function placeBox(overlay, rect, className) {
    var frame = document.createElement('div');
    frame.className = className;
    frame.style.left = rect[0] + 'px';
    frame.style.top = rect[1] + 'px';
    frame.style.width = rect[2] + 'px';
    frame.style.height = rect[3] + 'px';
    overlay.appendChild(frame);
  }

  function placeBadge(overlay, rect, n) {
    var pos = badgePositionForRect(rect, BADGE / 2);
    var badge = document.createElement('div');
    badge.className = 'ann-badge';
    badge.setAttribute('data-n', n);
    badge.textContent = String(n);
    badge.style.left = pos.left + 'px';
    badge.style.top = pos.top + 'px';
    overlay.appendChild(badge);
  }

  function paint() {
    if (!document.body) return null;
    var overlay = ensureChrome();
    overlay.innerHTML = '';

    var baked = 0;
    var broken = 0;
    var maxBottom = 0;
    var maxRight = 0;
    var contentRight = 0;
    var anchors = [];

    function trackContentRight(overlay, el) {
      var parent = el.parentElement;
      if (!parent || parent === document.body) return;
      var pr = localRect(overlay, parent);
      contentRight = Math.max(contentRight, pr[0] + pr[2]);
    }

    annotations.forEach(function (a) {
      var sels = [];
      if (Array.isArray(a.targets) && a.targets.length) {
        a.targets.forEach(function (t) { if (t && t.selector) sels.push(t.selector); });
      }
      if (!sels.length && a.selector) sels.push(a.selector);

      var placed = 0;
      var frameClass = a.type === 'region' ? 'ann-frame' : 'ann-target';
      var firstRect = null;
      sels.forEach(function (sel) {
        var el = resolveSelector(sel);
        if (!el) return;
        var rect = expandRect(localRect(overlay, el));
        if (!rect[2] && !rect[3]) return;
        placeBox(overlay, rect, frameClass);
        placeBadge(overlay, rect, a.n);
        maxBottom = Math.max(maxBottom, rect[1] + rect[3] + BADGE);
        maxRight = Math.max(maxRight, rect[0] + rect[2]);
        trackContentRight(overlay, el);
        if (!firstRect) firstRect = rect;
        placed++;
      });

      if (!placed && a.type === 'region' && a.base && a.base.selector && Array.isArray(a.rect) && Array.isArray(a.base.rect)) {
        var baseEl = resolveSelector(a.base.selector);
        if (baseEl) {
          var now = localRect(overlay, baseEl);
          var br = a.base.rect;
          var rr = a.rect;
          var rect = expandRect([
            rr[0] + now[0] - br[0],
            rr[1] + now[1] - br[1],
            rr[2],
            rr[3],
          ]);
          placeBox(overlay, rect, 'ann-frame');
          placeBadge(overlay, rect, a.n);
          maxBottom = Math.max(maxBottom, rect[1] + rect[3] + BADGE);
          maxRight = Math.max(maxRight, rect[0] + rect[2]);
          trackContentRight(overlay, baseEl);
          firstRect = rect;
          placed++;
        }
      }

      if (placed) {
        baked++;
        if (bubbles && firstRect) anchors.push({ n: a.n, rect: firstRect });
      } else {
        broken++;
      }
    });

    if (bubbles && anchors.length) {
      var bubbleLeft = docW > 0
        ? docW + GUTTER_MARGIN
        : Math.max(contentRight, maxRight) + GUTTER_MARGIN;
      var bubbleNodes = {};
      var heights = {};
      anchors.forEach(function (an) {
        var a = annotations.filter(function (x) { return x.n === an.n; })[0];
        if (!a) return;
        var node = document.createElement('div');
        node.className = 'ann-bubble';
        node.setAttribute('data-n', an.n);
        node.innerHTML = bubbleInnerHtml(a);
        node.style.visibility = 'hidden';
        overlay.appendChild(node);
        var h = node.offsetHeight || 60;
        heights[an.n] = h;
        heights[String(an.n)] = h;
        bubbleNodes[an.n] = node;
      });
      var packed = packGutter(anchors, heights, { bubbleLeft: bubbleLeft, sortBy: 'n' });
      packed.forEach(function (p) {
        var node = bubbleNodes[p.n];
        if (!node) return;
        node.style.left = p.left + 'px';
        node.style.top = p.top + 'px';
        node.style.width = p.width + 'px';
        node.style.visibility = '';
        maxBottom = Math.max(maxBottom, p.top + p.height + BADGE);
      });
    }

    var scrollH = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
      maxBottom
    );
    overlay.style.height = scrollH + 'px';

    var result = { baked: baked, broken: broken, scrollHeight: scrollH };
    window.__EXPORT_BAKE_RESULT__ = result;
    return result;
  }

  function schedulePaint() {
    paint();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { paint(); }).catch(function () {});
    }
    setTimeout(paint, 50);
    setTimeout(paint, 300);
  }

  if (!defer) {
    paint();
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedulePaint);
  } else {
    schedulePaint();
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paint, 100);
  });
})();
`;
  return libs + '\n' + glue;
}

function stripAnnotateBootstrap(html) {
  return String(html || '')
    .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*annotate\.js[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*data-ios-annotate[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove only the inline <script> block that boots annotate.js.
    // Match each <script>…</script> individually (non-greedy stops at first </script>)
    // and drop it if its body references /annotate.js or the /sites/ injector's
    // __pinpointEntry marker — so adjacent inline scripts (charts, Sankey, etc.)
    // survive.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) =>
      /\/annotate\.js|__pinpointEntry/i.test(block) ? '' : block);
}

/**
 * Inject a self-relocating mark overlay into standalone HTML.
 * Positions are computed in the viewer's browser (load + resize), so they stay
 * aligned when `@media` / centering differ from the export bake viewport.
 * Strips the localhost annotate.js bootstrap; keeps a small inline placer only.
 */
export function injectCommentsExportHtml(sourceHtml, annotations) {
  const script = buildExportBakeScript(annotations, { defer: true, bubbles: true });
  const scriptBlock = `<script data-export-comments>\n${script}\n</script>`;
  let html = stripAnnotateBootstrap(sourceHtml);

  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${scriptBlock}\n</body>`);
  } else {
    html += scriptBlock;
  }
  return html;
}

/** @deprecated Use injectCommentsExportHtml — static absolute overlays drift across viewports. */
export function injectBakedCommentsHtml(sourceHtml, overlayHtml) {
  let html = stripAnnotateBootstrap(sourceHtml);
  const styleBlock = `<style data-export-comments>${exportMarkCss()}`
    + `body{position:relative;}`
    + `#ann-export-overlay{position:absolute;left:0;top:0;width:100%;pointer-events:none;z-index:2147483000;}`
    + `#ann-export-overlay .ann-target,#ann-export-overlay .ann-frame,`
    + `#ann-export-overlay .ann-badge{position:absolute;pointer-events:none;}`
    + `</style>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${styleBlock}\n`);
  }
  const overlay = String(overlayHtml || '');
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${overlay}\n</body>`);
  } else {
    html += overlay;
  }
  return html;
}

/* ---------- 阶段 5：doc 导出把 mention 的嵌入 frame 烤成静态图 ----------
 * 挂载点形态：<div data-pinpoint-frame="<pageId>/<screenId>"></div>（活文档里由
 * annotate client 水合为 iframe；导出/外发场景没有水合 —— annotate.js 被摘除，
 * 这里把挂载点换成 /api/export-image 渲的 2× PNG dataURL）。
 * 三种模式：html-full = 静态字符串换 <img>；html-no-css = 换文本引用（token
 * 友好，不塞 base64）；长图 = 渲染浏览器里运行时换图（buildMentionSwapScript）。 */

const MENTION_MOUNT_RE = /<div\b(?=[^>]*\bdata-pinpoint-frame\s*=\s*(["'])([^"']+)\1)[^>]*>\s*<\/div>/gi;

/** 解析文档源文件里的 mention 挂载点。value = "<pageId>/<screenId>"（screenId 可含 /）。 */
export function parseMentionMounts(html) {
  const out = [];
  const re = new RegExp(MENTION_MOUNT_RE.source, 'gi');
  let m;
  while ((m = re.exec(String(html || '')))) {
    const value = String(m[2] || '').trim();
    const slash = value.indexOf('/');
    if (slash <= 0 || slash === value.length - 1) continue;
    out.push({ value, pageId: value.slice(0, slash), screenId: value.slice(slash + 1), match: m[0] });
  }
  return out;
}

/** 静态替换挂载点。resolver(mount) → 替换 HTML 字符串；返回 null 保留原样。 */
export function replaceMentionMounts(html, resolver) {
  let replaced = 0;
  const out = String(html || '').replace(new RegExp(MENTION_MOUNT_RE.source, 'gi'), (full, q, value) => {
    const v = String(value || '').trim();
    const slash = v.indexOf('/');
    if (slash <= 0 || slash === v.length - 1) return full;
    const next = resolver({ value: v, pageId: v.slice(0, slash), screenId: v.slice(slash + 1), match: full });
    if (typeof next !== 'string') return full;
    replaced++;
    return next;
  });
  return { html: out, replaced };
}

/** 烤好的 frame 图 → <img>（html-full 用；自包含 dataURL，外发不依赖服务在线）。 */
export function mentionImgHtml(mount, img) {
  const alt = `@frame:${mount.value}${img.title ? ` · ${img.title}` : ''}`;
  return `<img src="${img.dataUrl}" width="${Math.round(img.width)}" height="${Math.round(img.height)}"`
    + ` alt="${escapeHtml(alt)}" data-pinpoint-frame-baked="${escapeHtml(mount.value)}"`
    + ` style="max-width:100%;height:auto">`;
}

/** html-no-css 的挂载点替代物：文本引用（模式定位是喂 AI，不塞 base64 大图）。 */
export function mentionTextMarker(mount, title) {
  const label = title ? `${title}（${mount.value}）` : mount.value;
  return `<p data-pinpoint-frame-ref="${escapeHtml(mount.value)}">[嵌入 Frame：${escapeHtml(label)} —— 静态图见 HTML 完整 / 长图导出]</p>`;
}

/**
 * 长图（image 模式）运行时换图脚本：在渲染浏览器里把挂载点换成 <img>。
 * annotate.js 在导出渲染中被 abort，挂载点此时还是空 div。
 */
export function buildMentionSwapScript(entries) {
  const payload = JSON.stringify(entries).replace(/<\//g, '<\\/');
  return `(function () {
  var entries = ${payload};
  entries.forEach(function (en) {
    document.querySelectorAll('[data-pinpoint-frame]').forEach(function (mount) {
      if (mount.getAttribute('data-pinpoint-frame') !== en.value) return;
      var img = document.createElement('img');
      img.src = en.dataUrl;
      img.width = en.width;
      img.height = en.height;
      img.setAttribute('alt', en.alt || ('@frame:' + en.value));
      img.setAttribute('data-pinpoint-frame-baked', en.value);
      img.style.cssText = 'display:block;max-width:100%;height:auto';
      mount.replaceWith(img);
    });
  });
})();`;
}
