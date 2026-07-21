/* ============================================================================
   iOS Preview Kit — optional interactions. Zero dependencies.
   Include once, anywhere:  <script src="ios-kit.js"></script>
   Everything is event-delegated on document, so it also picks up markup you
   add later. Re-runnable / idempotent. The switch is pure CSS (no JS needed).

   Data-attribute API
     autoFit ..... <div class="ios-stage" data-fit> scales its .ios-device to fit
                   workbench sets data-canvas-zoom on <html>: fit | 0.75 | 1 | 1.25 …
     tabs ........ <button class="ios-tab" data-tab="home">  →  shows [data-tab-page="home"]
                   (scoped to the nearest .ios-screen)
     sheet ....... [data-sheet-open="detail"]  opens  #detail.ios-sheet (+ its backdrop)
                   [data-sheet-close] or backdrop click / Esc closes
     segmented ... clicks inside .ios-segmented move the .on class; fires
                   'ios:segment' {detail:{value}} on the .ios-segmented element
     clock ....... .ios-sb-time / .ios-lock-clock — live by default; workbench
                   data-clock-mode=fixed + data-clock-fixed on <html>, or per-element data-time

   Product gestures (tear calendar, decks, …) live in screen HTML / sidecar .js
   via workbench data-preview-script / data-preview-mount — not in this file.
   ========================================================================= */
(function () {
  'use strict';

  /* ---- responsive auto-fit: scale .ios-device to fill its .ios-stage ------ */
  function fit(stage) {
    var device = stage.querySelector('.ios-device');
    if (!device) return;
    var prev = device.style.getPropertyValue('--ios-scale');
    device.style.setProperty('--ios-scale', '1');            // measure at 1x
    var w = device.offsetWidth, h = device.offsetHeight;
    if (!w || !h) { if (prev) device.style.setProperty('--ios-scale', prev); return; }
    var padX = 8, padY = 8;
    var mode = document.documentElement.getAttribute('data-canvas-zoom') || 'fit';
    var k;
    if (mode === 'fit') {
      k = Math.min((stage.clientWidth - padX) / w, (stage.clientHeight - padY) / h);
      var max = parseFloat(stage.getAttribute('data-fit-max')) || 1.2;
      k = Math.max(0.2, Math.min(k, max));
    } else {
      k = Math.max(0.25, Math.min(parseFloat(mode) || 1, 2.5));
    }
    device.style.setProperty('--ios-scale', k.toFixed(4));
  }
  function fitAll(root) {
    var stages = root ? root.querySelectorAll('.ios-stage[data-fit]') : document.querySelectorAll('.ios-stage[data-fit]');
    stages.forEach(function (s) {
      if (!root && s.closest('.wb-panel[hidden]')) return;
      fit(s);
    });
  }

  var ro = 'ResizeObserver' in window ? new ResizeObserver(function (entries) {
    entries.forEach(function (e) { fit(e.target); });
  }) : null;
  function observeStages(root) {
    if (!ro) return;
    (root || document).querySelectorAll('.ios-stage[data-fit]').forEach(function (s) {
      if (observedStages && observedStages.has(s)) return;
      ro.observe(s);
      if (observedStages) observedStages.add(s);
    });
  }

  /* ---- tabs ---------------------------------------------------------------- */
  function switchTab(btn) {
    var id = btn.getAttribute('data-tab');
    var screen = btn.closest('.ios-screen') || document;
    screen.querySelectorAll('[data-tab]').forEach(function (t) { t.classList.toggle('on', t === btn); });
    screen.querySelectorAll('[data-tab-page]').forEach(function (p) {
      p.hidden = p.getAttribute('data-tab-page') !== id;
    });
  }

  /* ---- sheets -------------------------------------------------------------- */
  function openSheet(id, root) {
    var sheet = (root || document).querySelector('#' + CSS.escape(id) + '.ios-sheet, .ios-sheet#' + CSS.escape(id));
    if (!sheet) sheet = document.getElementById(id);
    if (!sheet) return;
    var scope = sheet.closest('.ios-screen') || document;
    var backdrop = scope.querySelector('.ios-sheet-backdrop');
    if (backdrop) backdrop.classList.add('open');
    sheet.classList.add('open');
  }
  function closeSheet(scope) {
    scope = scope || document;
    scope.querySelectorAll('.ios-sheet.open').forEach(function (s) { s.classList.remove('open'); });
    scope.querySelectorAll('.ios-sheet-backdrop.open').forEach(function (b) { b.classList.remove('open'); });
  }

  /* ---- segmented ----------------------------------------------------------- */
  function moveSegment(btn) {
    var seg = btn.closest('.ios-segmented');
    if (!seg) return;
    seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === btn); });
    seg.dispatchEvent(new CustomEvent('ios:segment', {
      detail: { value: btn.getAttribute('data-value') || btn.textContent.trim() }, bubbles: true
    }));
  }

  /* ---- live clocks (status bar + lock screen) ----------------------------- */
  function formatTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    return h + ':' + (m < 10 ? '0' + m : m);
  }
  function setClock(el, live) {
    var root = document.documentElement;
    if (root.getAttribute('data-clock-mode') === 'fixed') {
      el.textContent = root.getAttribute('data-clock-fixed') || '9:41';
      return;
    }
    if (el.hasAttribute('data-time')) { el.textContent = el.getAttribute('data-time'); return; }
    el.textContent = live;
  }
  function tick(root) {
    var live = formatTime(new Date());
    (root || document).querySelectorAll('.ios-sb-time, .ios-lock-clock').forEach(function (el) {
      setClock(el, live);
    });
  }
  var clockScheduled = false;
  function scheduleClock() {
    if (clockScheduled) return;
    clockScheduled = true;
    tick();
    var now = new Date();
    var ms = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    setTimeout(function () {
      tick();
      setInterval(tick, 60000);
    }, ms);
  }

  var booted = false;
  var observedStages = typeof WeakSet === 'function' ? new WeakSet() : null;

  /* ---- chrome sprite — SF Symbols paths for nav (sfsym). Status bar glyphs are
     self-contained SVGs (ink-tight viewBox + inline paths) — nesting <use> against
     square SF canvases was crushing the battery into a hairline. ------------ */
  var CHROME = '<svg id="ios-kit-chrome" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'
    + '<symbol id="c-chev" viewBox="0 0 13 13"><path fill="currentColor" d="M9.9431 6.9553 C9.9431 6.8079 9.8842 6.6724 9.7722 6.5663 L5.104 1.9923 C4.9979 1.8921 4.8682 1.8391 4.7149 1.8391 C4.4143 1.8391 4.1786 2.0689 4.1786 2.3755 C4.1786 2.5228 4.2375 2.6584 4.3318 2.7586 L8.6228 6.9553 L4.3318 11.152 C4.2375 11.2522 4.1786 11.3819 4.1786 11.5351 C4.1786 11.8416 4.4143 12.0715 4.7149 12.0715 C4.8682 12.0715 4.9979 12.0184 5.104 11.9123 L9.7722 7.3443 C9.8842 7.2323 9.9431 7.1026 9.9431 6.9553 Z"/></symbol>'
    + '<symbol id="c-back" viewBox="0 0 20 20"><path fill="currentColor" d="M3.5 10.0235 C3.5 10.2677 3.5879 10.4825 3.7734 10.6681 L11.5176 18.2364 C11.6836 18.4122 11.8984 18.5001 12.1523 18.5001 C12.6601 18.5001 13.0508 18.1192 13.0508 17.6114 C13.0508 17.3575 12.9434 17.1427 12.7871 16.9767 L5.6777 10.0235 L12.7871 3.0704 C12.9434 2.9044 13.0508 2.6798 13.0508 2.4356 C13.0508 1.9278 12.6601 1.547 12.1523 1.547 C11.8984 1.547 11.6836 1.6349 11.5176 1.8009 L3.7734 9.379 C3.5879 9.5548 3.5 9.7794 3.5 10.0235 Z"/></symbol>'
    + '<symbol id="c-search" viewBox="0 0 16 16"><path fill="currentColor" d="M1.6 7.0563 C1.6 9.8063 3.8375 12.0438 6.5875 12.0438 C7.675 12.0438 8.6687 11.6938 9.4875 11.1063 L12.5625 14.1875 C12.7062 14.3313 12.8937 14.4 13.0937 14.4 C13.5187 14.4 13.8125 14.0813 13.8125 13.6625 C13.8125 13.4625 13.7375 13.2813 13.6062 13.15 L10.55 10.075 C11.1937 9.2375 11.575 8.1938 11.575 7.0563 C11.575 4.3063 9.3375 2.0688 6.5875 2.0688 C3.8375 2.0688 1.6 4.3063 1.6 7.0563 Z M2.6687 7.0563 C2.6687 4.8938 4.425 3.1375 6.5875 3.1375 C8.75 3.1375 10.5062 4.8938 10.5062 7.0563 C10.5062 9.2188 8.75 10.975 6.5875 10.975 C4.425 10.975 2.6687 9.2188 2.6687 7.0563 Z"/></symbol>'
    + '</defs></svg>';
  /* sfsym cellularbars / wifi / battery.100percent — ink-tight viewBoxes, ~iOS optical size */
  var SB_GLYPHS = ''
    + '<svg width="21" height="13" viewBox="0.9 2.7 10.2 7.2" fill="currentColor" aria-hidden="true">'
    + '<path opacity=".35" d="M9.5859 9.6667 L10.5312 9.6667 C10.7773 9.6667 10.9375 9.4948 10.9375 9.2409 L10.9375 3.3112 C10.9375 3.0573 10.7773 2.8855 10.5312 2.8855 L9.5859 2.8855 C9.3398 2.8855 9.1758 3.0573 9.1758 3.3112 L9.1758 9.2409 C9.1758 9.4948 9.3398 9.6667 9.5859 9.6667 Z"/>'
    + '<path d="M6.8594 9.6667 L7.8008 9.6667 C8.0469 9.6667 8.2109 9.4948 8.2109 9.2409 L8.2109 4.8542 C8.2109 4.6003 8.0469 4.4284 7.8008 4.4284 L6.8594 4.4284 C6.6172 4.4284 6.4492 4.6003 6.4492 4.8542 L6.4492 9.2409 C6.4492 9.4948 6.6172 9.6667 6.8594 9.6667 Z"/>'
    + '<path d="M4.1367 9.6667 L5.0781 9.6667 C5.3242 9.6667 5.4883 9.4948 5.4883 9.2409 L5.4883 6.2683 C5.4883 6.0144 5.3242 5.8425 5.0781 5.8425 L4.1367 5.8425 C3.8906 5.8425 3.7266 6.0144 3.7266 6.2683 L3.7266 9.2409 C3.7266 9.4948 3.8906 9.6667 4.1367 9.6667 Z"/>'
    + '<path d="M1.4102 9.6667 L2.3516 9.6667 C2.5977 9.6667 2.7617 9.4948 2.7617 9.2409 L2.7617 7.487 C2.7617 7.2331 2.5977 7.0651 2.3516 7.0651 L1.4102 7.0651 C1.1641 7.0651 1 7.2331 1 7.487 L1 9.2409 C1 9.4948 1.1641 9.6667 1.4102 9.6667 Z"/>'
    + '</svg>'
    + '<svg width="19" height="13" viewBox="1.0 3.1 13.4 9.8" fill="currentColor" aria-hidden="true">'
    + '<path d="M1.9716 7.2614 C2.0852 7.3693 2.2443 7.3693 2.3523 7.2557 C3.75 5.7727 5.5909 4.9886 7.6534 4.9886 C9.7273 4.9886 11.5795 5.7784 12.9659 7.2614 C13.0682 7.3636 13.2216 7.358 13.3352 7.25 L14.1193 6.4659 C14.2216 6.3636 14.2159 6.2386 14.1364 6.1421 C12.8011 4.4943 10.2898 3.2841 7.6534 3.2841 C5.0227 3.2841 2.5 4.4943 1.1705 6.1421 C1.0909 6.2386 1.0909 6.3636 1.1875 6.4659 Z"/>'
    + '<path d="M4.3295 9.6364 C4.4545 9.7557 4.608 9.7386 4.7216 9.6136 C5.4034 8.858 6.517 8.3068 7.6534 8.3125 C8.8011 8.3068 9.9148 8.875 10.608 9.6307 C10.7102 9.75 10.8523 9.7443 10.9773 9.6307 L11.8579 8.7557 C11.9489 8.6648 11.9602 8.5398 11.875 8.4375 C11.017 7.3864 9.4261 6.5966 7.6534 6.5966 C5.8807 6.5966 4.2898 7.3864 3.4318 8.4375 C3.3466 8.5398 3.3523 8.6534 3.4489 8.7557 Z"/>'
    + '<path d="M7.6534 12.7273 C7.7784 12.7273 7.8864 12.6705 8.1079 12.4545 L9.4943 11.125 C9.5795 11.0398 9.6023 10.9148 9.5227 10.8125 C9.1534 10.3352 8.4545 9.9205 7.6534 9.9205 C6.8295 9.9205 6.1307 10.3523 5.7614 10.8466 C5.7045 10.9375 5.7273 11.0398 5.8182 11.125 L7.1989 12.4545 C7.4204 12.6648 7.5284 12.7273 7.6534 12.7273 Z"/>'
    + '</svg>'
    + '<svg width="29" height="13.5" viewBox="0.8 4.0 11.3 5.3" fill="currentColor" aria-hidden="true">'
    + '<path fill-opacity=".35" d="M2.8856 9.1591 L8.782 9.1591 C9.4234 9.1591 9.9635 9.0991 10.3461 8.7165 C10.7287 8.3339 10.785 7.8013 10.785 7.1599 L10.785 6.0834 C10.785 5.442 10.7287 4.9093 10.3461 4.5268 C9.9635 4.1442 9.4234 4.0841 8.782 4.0841 L2.8781 4.0841 C2.2479 4.0841 1.7078 4.1442 1.3252 4.5268 C0.9426 4.9093 0.8864 5.4457 0.8864 6.0721 L0.8864 7.1599 C0.8864 7.8013 0.9426 8.3339 1.3252 8.7165 C1.7078 9.0991 2.2479 9.1591 2.8856 9.1591 Z M2.7843 8.5552 C2.398 8.5552 1.9929 8.5027 1.7641 8.2776 C1.539 8.0488 1.4903 7.6475 1.4903 7.2611 L1.4903 5.9896 C1.4903 5.5958 1.539 5.1944 1.7641 4.9656 C1.9929 4.7368 2.4017 4.688 2.7956 4.688 L8.887 4.688 C9.2733 4.688 9.6784 4.7406 9.9035 4.9656 C10.1323 5.1944 10.1811 5.592 10.1811 5.9783 L10.1811 7.2611 C10.1811 7.6475 10.1323 8.0488 9.9035 8.2776 C9.6784 8.5027 9.2733 8.5552 8.887 8.5552 Z"/>'
    + '<path d="M2.5855 8.1201 L9.0858 8.1201 C9.3446 8.1201 9.4946 8.0826 9.5997 7.9776 C9.7009 7.8725 9.7422 7.7225 9.7422 7.4637 L9.7422 5.7795 C9.7422 5.5207 9.7009 5.3707 9.5997 5.2657 C9.4946 5.1607 9.3409 5.1231 9.0858 5.1231 L2.5968 5.1231 C2.3267 5.1231 2.1729 5.1607 2.0716 5.2657 C1.9666 5.3707 1.9291 5.5245 1.9291 5.787 L1.9291 7.4637 C1.9291 7.7225 1.9666 7.8725 2.0716 7.9776 C2.1767 8.0826 2.3305 8.1201 2.5855 8.1201 Z"/>'
    + '<path fill-opacity=".4" d="M11.2951 7.5912 C11.5914 7.5725 11.989 7.1936 11.989 6.6197 C11.989 6.0496 11.5914 5.6708 11.2951 5.652 Z"/>'
    + '</svg>';
  function injectChrome() {
    if (document.getElementById('ios-kit-chrome')) return;
    if (!document.body) return;
    var d = document.createElement('div'); d.innerHTML = CHROME;
    document.body.insertBefore(d.firstChild, document.body.firstChild);
  }
  function fillStatusBars(root) {
    (root || document).querySelectorAll('.ios-sb-icons').forEach(function (n) {
      if (n.children.length && n.getAttribute('data-ios-sb') !== '1') return;
      n.innerHTML = SB_GLYPHS;
      n.setAttribute('data-ios-sb', '1');
    });
  }

  /* ---- annotation review loop (annotate.js) ---------------------------------
     On localhost only, pull in /annotate.js from the same unified preview
     server. Silent no-op if the server isn't running, so previews are
     unaffected; never injected when served from a real host, so shared/exported
     copies don't phone home. Opt out with <html data-annotate="off">. --------- */
  function injectAnnotate() {
    var h = location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1' && h !== '::1') return;   // local only
    if (document.documentElement.getAttribute('data-annotate') === 'off') return;
    if (window.__htmlAnnotate || document.querySelector('script[data-ios-annotate]')) return;
    var s = document.createElement('script');
    s.src = '/annotate.js';
    s.async = true;
    s.setAttribute('data-ios-annotate', '');
    (document.body || document.documentElement).appendChild(s);
  }

  /* ---- one delegated click handler ---------------------------------------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-tab],[data-sheet-open],[data-sheet-close],.ios-segmented button');
    if (!el) {
      if (e.target.classList && e.target.classList.contains('ios-sheet-backdrop'))
        closeSheet(e.target.closest('.ios-screen') || document);
      return;
    }
    if (el.hasAttribute('data-tab')) return switchTab(el);
    if (el.hasAttribute('data-sheet-open')) return openSheet(el.getAttribute('data-sheet-open'), document);
    if (el.hasAttribute('data-sheet-close')) return closeSheet(el.closest('.ios-screen') || document);
    if (el.matches('.ios-segmented button')) return moveSegment(el);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(document); });

  function lockFontClass() {
    var f = document.documentElement.getAttribute('data-lock-font') || 'helvetica';
    return 'ios-lock-wallpaper wb-lock-font-' + f;
  }
  function fillLockWallpaper(root) {
    (root || document).querySelectorAll('.ios-lockscreen').forEach(function (el) {
      // Wallpaper wordmark: per-screen data-lock-word > global <html data-lock-word> > default.
      var word = el.getAttribute('data-lock-word')
        || document.documentElement.getAttribute('data-lock-word') || 'HELLO';
      var w = el.querySelector('.ios-lock-wallpaper');
      if (!w) {
        w = document.createElement('div');
        w.setAttribute('aria-hidden', 'true');
        el.insertBefore(w, el.firstChild);
      }
      w.textContent = word;
      w.className = lockFontClass();
    });
  }

  function ensureLiquidGlassFilter() {
    var id = 'ios-liquid-glass-filter';
    var existing = document.getElementById(id);
    if (existing) return existing;
    // Glass is disabled under prefers-reduced-transparency (see ios-kit.css);
    // skip injecting the refraction filter so there's nothing to animate.
    var reduceTransparency = window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
    if (reduceTransparency) return null;
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var svgHost = document.createElementNS(SVG_NS, 'svg');
    svgHost.setAttribute('aria-hidden', 'true');
    svgHost.setAttribute('focusable', 'false');
    svgHost.setAttribute('width', '0');
    svgHost.setAttribute('height', '0');
    svgHost.classList.add('ios-liquid-glass-filter-root');

    var filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '-20%');
    filter.setAttribute('y', '-20%');
    filter.setAttribute('width', '140%');
    filter.setAttribute('height', '140%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    var turbulence = document.createElementNS(SVG_NS, 'feTurbulence');
    turbulence.setAttribute('type', 'fractalNoise');
    turbulence.setAttribute('baseFrequency', '0.008');
    turbulence.setAttribute('numOctaves', '2');
    turbulence.setAttribute('seed', '7');
    turbulence.setAttribute('result', 'noise');
    if (!reduceMotion) {
      var animate = document.createElementNS(SVG_NS, 'animate');
      animate.setAttribute('attributeName', 'baseFrequency');
      animate.setAttribute('dur', '7s');
      animate.setAttribute('values', '0.008;0.0132;0.008');
      animate.setAttribute('repeatCount', 'indefinite');
      turbulence.appendChild(animate);
    }

    var displacement = document.createElementNS(SVG_NS, 'feDisplacementMap');
    displacement.setAttribute('in', 'SourceGraphic');
    displacement.setAttribute('in2', 'noise');
    displacement.setAttribute('scale', '18');
    displacement.setAttribute('xChannelSelector', 'R');
    displacement.setAttribute('yChannelSelector', 'G');

    filter.appendChild(turbulence);
    filter.appendChild(displacement);
    svgHost.appendChild(filter);
    document.body.prepend(svgHost);
    return filter;
  }

  function ensureLiquidGlassIfNeeded(root) {
    var scope = root || document;
    if (scope.querySelector('.ios-glass--liquid')) ensureLiquidGlassFilter();
  }

  function refresh(root) {
    root = root || document;
    fillStatusBars(root);
    fillLockWallpaper(root);
    tick(root);
    // fit/observe only matter for standalone data-fit stages; board phones strip
    // data-fit, so skip those full-document passes when scoped to a panel.
    if (root === document) {
      fitAll();
      observeStages();
    }
    ensureLiquidGlassIfNeeded(root);
  }
  function boot() {
    if (booted) return refresh();
    booted = true;
    injectChrome();
    injectAnnotate();
    scheduleClock();
    refresh();
  }

  /* ---- boot ---------------------------------------------------------------- */
  function init() { boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Do not pass the ResizeEvent into fitAll: it is not a queryable DOM root.
  window.addEventListener('resize', function () { fitAll(); });

  window.iOSKit = { fit: fit, fitAll: fitAll, openSheet: openSheet, closeSheet: closeSheet,
                    fillStatusBars: fillStatusBars, tick: tick, refresh: refresh, init: init,
                    ensureLiquidGlassFilter: ensureLiquidGlassFilter };
})();
