/**
 * Server-side helpers for baking annotation marks + comment bubbles into doc exports.
 * Paints the same yellow boxes + orange number badges as the live annotate overlay,
 * plus sidebar comment bubbles (content + reply) in a right gutter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { targetContentToDisplay } from './annotation-indicator.js';
import { bubbleCss } from './annotate-bubble.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BAKE_LIBS = [
  'annotate-clip.js',
  'annotate-bubble.js',
  'annotate-bubble-layout.js',
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
    'box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;z-index:3;}',
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
      reply: a.reply && a.reply.content
        ? {
            content: String(a.reply.content),
            author: a.reply.author === 'user' ? 'user' : 'agent',
          }
        : null,
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
    const reply = a.reply
      ? ` — ${a.reply.author === 'agent' ? 'Agent' : 'User'}: ${escapeHtml(a.reply.content)}`
      : '';
    return `<li>#${escapeHtml(a.n)}${anchor}: ${escapeHtml(a.content)}${reply}</li>`;
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
    // and drop it only if its body references /annotate.js — so adjacent inline
    // scripts (charts, Sankey, etc.) survive.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) =>
      /\/annotate\.js/i.test(block) ? '' : block);
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
