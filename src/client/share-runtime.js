/**
 * 离线分享 HTML（<page>__interactive.html）的画布运行时。
 *
 * 分享页用的是 workbench 的外壳（.wb → .wb-stage → .wb-library，ADR 0033），但
 * 没有 React、没有模块、没有服务：本文件是一个经典脚本，由
 * src/server/lib/offline-page-export.js 读成文本内联进导出文件（与 frame-boot.js
 * 同一做法）。禁止 import；正文不能出现 script 结束标签（内联守卫会拒绝）。
 *
 * 语义对齐 src/workbench/stage.js 与 src/workbench/lib/board-navigation.js：
 * - 普通滚轮 = 滚动；ctrl/meta + 滚轮（触控板捏合）= 围绕光标缩放，步进 0.92 /
 *   1.08，zoom 轴 0.5–5，视觉缩放 = zoom × 0.5（ADR 0025 基准）。
 * - 空格 + 左键拖、中键拖 = 任意位置平移；无修饰的左键拖只在空白画布上平移，
 *   机身 / 按钮 / 链接里不抢。
 * - 大纲点击与 ‹ › = 把目标居中到可用区（视口减掉面板与横条的占位）。
 * - 首次进入：第一个 section 按可用宽度适配，放得下就 100%。
 * - 窄屏（≤ 760px）：面板默认收起、打开时是整宽的浮层；帧竖排、按视口宽度适配；
 *   单指滚动走原生。
 *
 * 纯函数（clampZoom / focusScrollForRect / usableViewport / fitZoomForWidth /
 * formatZoomLabel）挂在 window.__pinpointShare 上，供单测在 vm 里直接调用。
 */
(function () {
  'use strict';

  var BASE_SCALE = 0.5;
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 5;
  var ZOOM_STEP_OUT = 0.92;
  var ZOOM_STEP_IN = 1.08;
  var FOCUS_INSET = 24;
  var CHROME_GAP = 12;
  var MOBILE_QUERY = '(max-width: 760px)';

  // ── 纯函数 ────────────────────────────────────────────────────────────────

  function clampZoom(z) {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(z) || 1));
    return Math.round(z * 100) / 100;
  }

  function formatZoomLabel(z) {
    var n = Math.round(Number(z) * 100);
    if (!isFinite(n)) n = 100;
    return n + '%';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /** 可用区 = 视口减掉四边占位；至少 1px，chrome 比视口还宽时不出负数。 */
  function usableViewport(viewport) {
    var insets = viewport.insets || {};
    var left = insets.left || 0;
    var right = insets.right || 0;
    var top = insets.top || 0;
    var bottom = insets.bottom || 0;
    return {
      left: left,
      top: top,
      width: Math.max(1, viewport.width - left - right),
      height: Math.max(1, viewport.height - top - bottom)
    };
  }

  function focusAxis(start, size, viewportSize, inset) {
    if (size + inset * 2 <= viewportSize) return start + size / 2 - viewportSize / 2;
    return start - inset;
  }

  /** 放得下就居中，放不下就让起点贴可用区的左上；结果换回 scroll 坐标并夹进滚动范围。 */
  function focusScrollForRect(rect, viewport, options) {
    var inset = options && options.inset != null ? options.inset : FOCUS_INSET;
    var maxLeft = Math.max(0, viewport.scrollWidth - viewport.width);
    var maxTop = Math.max(0, viewport.scrollHeight - viewport.height);
    var usable = usableViewport(viewport);
    return {
      left: clamp(focusAxis(rect.left, rect.width, usable.width, inset) - usable.left, 0, maxLeft),
      top: clamp(focusAxis(rect.top, rect.height, usable.height, inset) - usable.top, 0, maxTop)
    };
  }

  /**
   * 让一块 layoutWidth（transform 前的布局宽，board 单位）在 availableWidth 里放下的
   * zoom 轴值：放得下就 1，放不下就缩，最低 ZOOM_MIN。
   */
  function fitZoomForWidth(layoutWidth, availableWidth, options) {
    var inset = options && options.inset != null ? options.inset : FOCUS_INSET;
    var maxZoom = options && options.maxZoom != null ? options.maxZoom : 1;
    var room = availableWidth - inset * 2;
    if (!(layoutWidth > 0) || !(room > 0)) return clampZoom(maxZoom);
    return clampZoom(Math.min(maxZoom, room / (layoutWidth * BASE_SCALE)));
  }

  window.__pinpointShare = {
    BASE_SCALE: BASE_SCALE,
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    clampZoom: clampZoom,
    formatZoomLabel: formatZoomLabel,
    usableViewport: usableViewport,
    focusScrollForRect: focusScrollForRect,
    fitZoomForWidth: fitZoomForWidth
  };

  // ── DOM 运行时 ────────────────────────────────────────────────────────────

  function boot() {
    var root = document.getElementById('wbroot');
    var stage = document.getElementById('wbstage');
    var wrap = stage && stage.querySelector('.wb-zoom-wrap');
    var lib = wrap && wrap.querySelector('.wb-library');
    if (!root || !stage || !wrap || !lib) return;

    var side = document.getElementById('wbside');
    var strip = document.getElementById('wbstrip');
    var toggleBtn = document.getElementById('wbside-toggle');
    var prevBtn = document.getElementById('wbnav-prev');
    var nextBtn = document.getElementById('wbnav-next');
    var posEl = document.getElementById('wbsection-nav-position');
    var zoomBtn = document.getElementById('wbzoom-label');
    var recenterBtn = document.getElementById('wbrecenter');
    var outline = document.getElementById('wboutline');
    var mobileMq = typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null;

    var zoom = 1;
    var frames = [];   // { id, screenId, sectionId, screen, node, link }
    var sections = []; // { id, node, link, frames }
    var current = -1;

    function isMobile() {
      return !!(mobileMq && mobileMq.matches);
    }

    // ── 模型：section / frame 与大纲行的对应 ──
    function collect() {
      sections = [];
      frames = [];
      var items = lib.querySelectorAll('.wb-lib-item[data-ann-section]');
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var sectionId = item.getAttribute('data-ann-section') || '';
        var section = {
          id: sectionId,
          node: item,
          link: outline ? outline.querySelector('.ol-sec[data-ol-section="' + cssEscape(sectionId) + '"]') : null,
          frames: []
        };
        sections.push(section);
        var screens = item.querySelectorAll('.wb-screen[data-screen]');
        for (var j = 0; j < screens.length; j++) {
          var screen = screens[j];
          var screenId = screen.getAttribute('data-screen') || '';
          var frame = {
            id: screen.id,
            screenId: screenId,
            sectionId: sectionId,
            screen: screen,
            node: screen.querySelector('.ios-stage, .wb-comp-stage, .wb-doc-stage') || screen,
            link: outline ? outline.querySelector('.ol-row[data-ol-frame="' + cssEscape(screenId) + '"][data-ol-section="' + cssEscape(sectionId) + '"]') : null
          };
          section.frames.push(frame);
          frames.push(frame);
        }
      }
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/["\\]/g, '\\$&');
    }

    // ── 几何 ──
    function stageRectFor(node) {
      var stageRect = stage.getBoundingClientRect();
      var rect = node.getBoundingClientRect();
      return {
        left: rect.left - stageRect.left + stage.scrollLeft,
        top: rect.top - stageRect.top + stage.scrollTop,
        width: rect.width,
        height: rect.height
      };
    }

    /** .wb-sec-row 里的 .wb-screen 是 display:contents（没有盒子）：帧的矩形取三个
        子块（图注 / 机身 / 尺寸行）的并集。 */
    function frameRect(frame) {
      var kids = frame.screen.children;
      var out = null;
      for (var i = 0; i < kids.length; i++) {
        var r = stageRectFor(kids[i]);
        if (r.width < 1 && r.height < 1) continue;
        if (!out) { out = r; continue; }
        var right = Math.max(out.left + out.width, r.left + r.width);
        var bottom = Math.max(out.top + out.height, r.top + r.height);
        out.left = Math.min(out.left, r.left);
        out.top = Math.min(out.top, r.top);
        out.width = right - out.left;
        out.height = bottom - out.top;
      }
      return out || stageRectFor(frame.node);
    }

    /** chrome 占位：量实际 bounding box，面板收起 / 窄屏整宽都自动跟上。 */
    function chromeInsets() {
      var out = { left: 0, right: 0, top: 0, bottom: 0 };
      var stageRect = stage.getBoundingClientRect();
      if (side && !root.classList.contains('wb-side-collapsed') && !isMobile()) {
        var sr = side.getBoundingClientRect();
        if (sr.width > 1) out.left = Math.max(0, sr.right - stageRect.left + CHROME_GAP);
      }
      if (strip) {
        var tr = strip.getBoundingClientRect();
        if (tr.height > 1) out.bottom = Math.max(0, stageRect.bottom - tr.top + CHROME_GAP);
      }
      return out;
    }

    function viewportMetrics() {
      return {
        width: stage.clientWidth,
        height: stage.clientHeight,
        scrollWidth: stage.scrollWidth,
        scrollHeight: stage.scrollHeight,
        insets: chromeInsets()
      };
    }

    function scrollStageTo(target, smooth) {
      if (smooth && typeof stage.scrollTo === 'function') {
        stage.scrollTo({ left: target.left, top: target.top, behavior: 'smooth' });
      } else {
        stage.scrollLeft = target.left;
        stage.scrollTop = target.top;
      }
    }

    // ── 缩放 ──
    /** 视觉缩放 = zoom × BASE。@property --wb-board-zoom 是 inherits:false，写在
        :root 上到不了 .wb-library —— 与 boot-prefs.syncBoardZoomLayout 一样直接写在
        库元素上；:root 上也写一份给读数。transform 不改布局，外层 wrap 的尺寸要
        按缩放后的值钉住，滚动范围才对。 */
    function applyZoom(next) {
      zoom = clampZoom(next);
      document.documentElement.style.setProperty('--wb-board-zoom', String(zoom));
      lib.style.setProperty('--wb-board-zoom', String(zoom));
      var z = zoom * BASE_SCALE;
      wrap.style.width = Math.ceil(lib.offsetWidth * z) + 'px';
      wrap.style.height = Math.ceil(lib.offsetHeight * z) + 'px';
      if (zoomBtn) zoomBtn.textContent = formatZoomLabel(zoom);
    }

    function zoomAround(next, clientX, clientY) {
      var oldZ = zoom;
      next = clampZoom(next);
      if (next === oldZ) return;
      var rect = stage.getBoundingClientRect();
      var mx = clientX - rect.left;
      var my = clientY - rect.top;
      var wr = wrap.getBoundingClientRect();
      var originX = stage.scrollLeft + (wr.left - rect.left);
      var originY = stage.scrollTop + (wr.top - rect.top);
      var localX = stage.scrollLeft + mx - originX;
      var localY = stage.scrollTop + my - originY;
      var ratio = next / oldZ;
      applyZoom(next);
      stage.scrollLeft = originX + localX * ratio - mx;
      stage.scrollTop = originY + localY * ratio - my;
    }

    stage.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAround(zoom * (e.deltaY > 0 ? ZOOM_STEP_OUT : ZOOM_STEP_IN), e.clientX, e.clientY);
    }, { passive: false });

    // ── 平移 ──
    (function wirePan() {
      var pan = null;
      var suppressClick = false;
      var spaceDown = false;
      var moveRaf = 0;
      var nextScroll = null;

      function isTypingTarget(el) {
        if (!el || !el.closest) return false;
        return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      }

      function flush() {
        if (moveRaf) cancelAnimationFrame(moveRaf);
        moveRaf = 0;
        if (!nextScroll) return;
        stage.scrollLeft = nextScroll.left;
        stage.scrollTop = nextScroll.top;
        nextScroll = null;
      }

      function syncSpaceCursor() {
        stage.classList.toggle('wb-space-pan', spaceDown && !(pan && pan.moved));
      }

      function endPan(e) {
        if (!pan) return;
        flush();
        var moved = pan.moved;
        pan = null;
        stage.classList.remove('wb-panning');
        document.body.classList.remove('wb-panning');
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', endPan, true);
        if (e && e.type === 'mouseup') { e.preventDefault(); e.stopPropagation(); }
        syncSpaceCursor();
        if (moved) {
          suppressClick = true;
          setTimeout(function () { suppressClick = false; }, 0);
        }
      }

      function onMove(e) {
        if (!pan) return;
        var dx = e.clientX - pan.x;
        var dy = e.clientY - pan.y;
        if (!pan.moved && (dx * dx + dy * dy) < 16) return;
        if (!pan.moved) {
          pan.moved = true;
          stage.classList.add('wb-panning');
          document.body.classList.add('wb-panning');
          syncSpaceCursor();
        }
        e.preventDefault();
        e.stopPropagation();
        nextScroll = { left: pan.sl - dx, top: pan.st - dy };
        if (!moveRaf) moveRaf = requestAnimationFrame(flush);
      }

      function startPan(e) {
        pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, moved: false };
        syncSpaceCursor();
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', endPan, true);
      }

      document.addEventListener('keydown', function (e) {
        if (e.code !== 'Space' && e.key !== ' ') return;
        if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        if (e.repeat) return;
        spaceDown = true;
        syncSpaceCursor();
      }, true);

      document.addEventListener('keyup', function (e) {
        if (e.code !== 'Space' && e.key !== ' ') return;
        if (!isTypingTarget(e.target)) e.preventDefault();
        spaceDown = false;
        syncSpaceCursor();
      }, true);

      window.addEventListener('blur', function () {
        endPan();
        spaceDown = false;
        syncSpaceCursor();
      });

      window.addEventListener('mousedown', function (e) {
        if (!stage.contains(e.target) || isTypingTarget(e.target)) return;
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          startPan(e);
          return;
        }
        if (e.button !== 0) return;
        if (spaceDown) {
          e.preventDefault();
          e.stopPropagation();
          startPan(e);
          return;
        }
        // 无空格：只在空白画布上平移，不抢机身 / 按钮 / 链接的交互。
        if (e.target.closest('.ios-stage, .wb-comp-stage, .wb-doc-stage, .wb-screen-err, button, a')) return;
        startPan(e);
      }, true);

      stage.addEventListener('auxclick', function (e) {
        if (e.button === 1) e.preventDefault();
      });

      window.addEventListener('click', function (e) {
        if (!suppressClick) return;
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      }, true);
    })();

    // ── 面板 ──
    function setSideCollapsed(on) {
      root.classList.toggle('wb-side-collapsed', !!on);
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', on ? 'false' : 'true');
        var label = on ? '展开 Pages 面板' : '收起 Pages 面板';
        toggleBtn.setAttribute('aria-label', label);
        toggleBtn.title = label;
        var icons = toggleBtn.querySelectorAll('[data-icon]');
        for (var i = 0; i < icons.length; i++) {
          icons[i].hidden = icons[i].getAttribute('data-icon') !== (on ? 'open' : 'close');
        }
      }
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        setSideCollapsed(!root.classList.contains('wb-side-collapsed'));
      });
    }

    // ── 定位 ──
    function setCurrent(index, options) {
      if (!frames.length) { current = -1; return; }
      index = Math.max(0, Math.min(frames.length - 1, index));
      current = index;
      var frame = frames[index];
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].link) frames[i].link.classList.toggle('on', i === index);
      }
      for (var j = 0; j < sections.length; j++) {
        if (sections[j].link) sections[j].link.classList.toggle('on', sections[j].id === frame.sectionId);
      }
      if (posEl) posEl.textContent = (index + 1) + ' / ' + frames.length;
      if (options && options.hash && frame.id && history.replaceState) {
        history.replaceState(null, '', '#' + frame.id);
      }
    }

    function focusFrame(index, options) {
      if (!frames.length) return;
      index = Math.max(0, Math.min(frames.length - 1, index));
      var frame = frames[index];
      scrollStageTo(focusScrollForRect(frameRect(frame), viewportMetrics(), { inset: FOCUS_INSET }), options && options.smooth);
      setCurrent(index, { hash: true });
      if (options && options.flash) {
        frame.node.classList.remove('wb-frame-flash');
        void frame.node.offsetWidth;
        frame.node.classList.add('wb-frame-flash');
      }
    }

    function focusSection(section, options) {
      if (section.frames.length) {
        focusFrame(frames.indexOf(section.frames[0]), options);
        return;
      }
      scrollStageTo(focusScrollForRect(stageRectFor(section.node), viewportMetrics(), { inset: FOCUS_INSET }), options && options.smooth);
      if (section.id && history.replaceState) history.replaceState(null, '', '#section-' + section.id);
    }

    function frameIndexById(id) {
      for (var i = 0; i < frames.length; i++) if (frames[i].id === id) return i;
      return -1;
    }

    function sectionById(id) {
      for (var i = 0; i < sections.length; i++) if (sections[i].id === id) return sections[i];
      return null;
    }

    if (outline) {
      outline.addEventListener('click', function (e) {
        var link = e.target.closest && e.target.closest('a[href^="#"]');
        if (!link || !outline.contains(link)) return;
        e.preventDefault();
        var id = decodeURIComponent(link.getAttribute('href').slice(1));
        if (link.classList.contains('ol-sec')) {
          var section = sectionById(link.getAttribute('data-ol-section') || '');
          if (section) focusSection(section, { smooth: true, flash: true });
        } else {
          var index = frameIndexById(id);
          if (index >= 0) focusFrame(index, { smooth: true, flash: true });
        }
        if (isMobile()) setSideCollapsed(true);
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', function () { focusFrame(current - 1, { smooth: true, flash: true }); });
    if (nextBtn) nextBtn.addEventListener('click', function () { focusFrame(current + 1, { smooth: true, flash: true }); });

    // 滚动时把「当前帧」跟到离可用区中心最近的那一帧（大纲高亮 + n / N 读数）。
    var scrollRaf = 0;
    stage.addEventListener('scroll', function () {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(function () {
        scrollRaf = 0;
        if (!frames.length) return;
        var usable = usableViewport(viewportMetrics());
        var cx = stage.scrollLeft + usable.left + usable.width / 2;
        var cy = stage.scrollTop + usable.top + usable.height / 2;
        var best = -1;
        var bestDistance = Infinity;
        for (var i = 0; i < frames.length; i++) {
          var r = frameRect(frames[i]);
          var dx = r.left + r.width / 2 - cx;
          var dy = r.top + r.height / 2 - cy;
          var d = dx * dx + dy * dy;
          if (d < bestDistance) { bestDistance = d; best = i; }
        }
        if (best >= 0 && best !== current) setCurrent(best);
      });
    }, { passive: true });

    // ── 缩放读数 / 回中 ──
    if (zoomBtn) {
      zoomBtn.addEventListener('click', function () {
        var rect = stage.getBoundingClientRect();
        var usable = usableViewport(viewportMetrics());
        zoomAround(1, rect.left + usable.left + usable.width / 2, rect.top + usable.top + usable.height / 2);
      });
    }

    /** 回中 = 回到首次进入的视图：第一个 section 按可用宽度适配（放得下就 100%），
        再把这个 section 定位到可用区（放得下居中，放不下贴左上）。 */
    function fitFirstSection(options) {
      var first = sections[0];
      var usable = usableViewport(viewportMetrics());
      var smooth = !!(options && options.smooth);
      if (isMobile()) {
        // 窄屏：帧竖排，一帧就是一列 —— 按库的整宽适配到视口宽，边距归零。
        applyZoom(fitZoomForWidth(lib.offsetWidth, usable.width, { inset: 0, maxZoom: ZOOM_MAX }));
        scrollStageTo({ left: 0, top: 0 }, smooth);
        setCurrent(0);
        return;
      }
      var target = first ? first.node : lib;
      // .wb-lib-item 是 max-content 宽；库两侧各 24px padding 一起算进去。
      var layoutWidth = first ? first.node.offsetWidth + 48 : lib.offsetWidth;
      applyZoom(fitZoomForWidth(layoutWidth, usable.width, { inset: FOCUS_INSET, maxZoom: 1 }));
      scrollStageTo(focusScrollForRect(stageRectFor(target), viewportMetrics(), { inset: FOCUS_INSET }), smooth);
      setCurrent(0);
    }

    if (recenterBtn) recenterBtn.addEventListener('click', function () { fitFirstSection({ smooth: true }); });

    // ── 首次进入 ──
    function initialView() {
      collect();
      if (isMobile()) setSideCollapsed(true);
      applyZoom(1);
      var hash = decodeURIComponent((location.hash || '').slice(1));
      var wanted = hash ? frameIndexById(hash) : -1;
      var wantedSection = hash && hash.indexOf('section-') === 0 ? sectionById(hash.slice('section-'.length)) : null;
      fitFirstSection();
      if (wanted >= 0) focusFrame(wanted, { flash: !isMobile() });
      else if (wantedSection) focusSection(wantedSection, { flash: !isMobile() });
    }

    var resizeRaf = 0;
    var wasMobile = isMobile();
    window.addEventListener('resize', function () {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = 0;
        applyZoom(zoom);
        var nowMobile = isMobile();
        if (nowMobile !== wasMobile) {
          wasMobile = nowMobile;
          setSideCollapsed(nowMobile);
          fitFirstSection();
        }
      });
    });

    initialView();
    // 预览脚本与 iOS kit 可能在挂载后改变内容高度：一帧后再钉一次 wrap 尺寸。
    requestAnimationFrame(function () { applyZoom(zoom); });
    window.addEventListener('load', function () {
      setTimeout(function () { applyZoom(zoom); }, 80);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
