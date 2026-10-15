// 浏览器端：画布浮层（CanvasOverlay.astro 的空壳 + 卡片的 data-*）。契约在 site/README.md「画布浮层」。
// 点卡片里的帧 → 浮层打开这一节的全部帧，帧是可交互的 iframe（卡片里的缩略图仍不可交互）。
// 地址：#overlay=<节 id>[&frame=<帧 id>]。点帧时 pushState 一条，后退就关；直接带这个 hash 打开页面也会打开浮层，
// 这时关闭只把 hash 换掉（replaceState），不后退离开文章。换节用 replaceState，不多压历史。
import { shellBox } from './canvas-card.js';
import { docFrameFailed, failNote, measureStage, placeFrame, setCardDocWidth } from './canvas-card-client.js';
import { installLayerKeys, layers } from './layers.js';
import { naturalBox, neighborSection, overlayHash, overlayScale, parseOverlayHash } from './canvas-overlay.js';

const FLASH_MS = 1600;
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function initCanvasOverlay() {
  const dlg = document.querySelector('[data-pp-overlay]');
  // 有帧的卡片才进浮层（只有错误、没有帧的卡片不算“有画布的节”）。
  const cards = [...document.querySelectorAll('[data-pp-canvas]')].filter((c) => c.querySelector('.cc-frame'));
  if (!dlg || !cards.length) return;
  const $ = (sel) => dlg.querySelector(sel);
  const el = {
    num: $('[data-ov-num]'), title: $('[data-ov-title]'), meta: $('[data-ov-meta]'),
    prev: $('[data-ov-prev]'), next: $('[data-ov-next]'), canvas: $('[data-ov-canvas]'), close: $('[data-ov-close]'),
    strip: $('[data-ov-strip]'), width: $('[data-ov-width]'),
  };
  const ids = cards.map((c) => c.dataset.ppSection);
  const cardOf = (id) => cards.find((c) => c.dataset.ppSection === id) || null;

  // state：{ section, origin, trigger, pushed, frames: [{ fig, box, iframe, natural, m }], userScrolled, cleanups }
  let state = null;
  let pendingRefocus = null;

  const framesOf = (card) => [...card.querySelectorAll('.cc-frame')].map((fig) => ({
    id: fig.dataset.screen, title: fig.dataset.title || fig.dataset.screen,
    src: fig.dataset.src || '', shell: fig.dataset.shell || '', missing: fig.hasAttribute('data-missing'),
  }));

  // ---- 尺寸：所有帧同一个缩放（canvas-overlay.js overlayScale），不超过真实大小 ----
  function layout() {
    if (!state) return;
    const cs = getComputedStyle(el.strip);
    const cap = state.frames[0]?.fig.querySelector('.cap');
    const capH = cap ? cap.offsetHeight + parseFloat(getComputedStyle(cap).marginBottom || '0') : 0;
    const availWidth = el.strip.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availHeight = el.strip.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - capH;
    const boxes = state.frames.map((f) => (f.m ? { width: f.m.width, height: f.m.height } : f.natural));
    const scale = overlayScale({ boxes, availWidth, availHeight });
    state.scale = scale;
    for (const f of state.frames) {
      f.fig.style.setProperty('--ov-w', `${Math.round((f.m ? f.m.width : f.natural.width) * scale)}px`);
      if (f.natural.height === null) {
        // 文档帧（HTML 帧）：页面宽度不变，盒子占满可用高度，iframe 的视口高 = 可用高 / 缩放，页面在 iframe 里滚动。
        f.box.style.width = `${Math.round(f.natural.width * scale)}px`;
        f.box.style.height = `${Math.round(availHeight)}px`;
        if (f.iframe) {
          f.iframe.style.width = `${f.natural.width}px`;
          f.iframe.style.height = `${Math.round(availHeight / scale)}px`;
          f.iframe.style.transform = `scale(${scale})`;
        }
        continue;
      }
      if (f.m && f.iframe) {
        placeFrame(f.iframe, f.box, f.m, scale);
        if (f.m.radius) f.fig.style.setProperty('--ov-r', `${(f.m.radius * scale).toFixed(1)}px`);
        continue;
      }
      f.box.style.width = `${Math.round(f.natural.width * scale)}px`;
      f.box.style.height = `${Math.round(f.natural.height * scale)}px`;
      if (f.iframe) {
        f.iframe.style.width = `${f.natural.width}px`;
        f.iframe.style.height = `${f.natural.height}px`;
        f.iframe.style.transform = `scale(${scale})`;
      }
    }
    el.strip.dataset.scale = scale.toFixed(4);
    el.strip.style.setProperty('--ov-s', String(scale));
  }

  function centerOn(fig) {
    if (!fig) return;
    const s = el.strip;
    s.scrollLeft = Math.max(0, fig.offsetLeft - (s.clientWidth - fig.offsetWidth) / 2);
  }

  // 焦点在帧里时按键进不了本文档：Esc 和左右键转发过来（编辑框里的左右键留给帧）。
  function forwardKeys(iframe) {
    try {
      iframe.contentWindow.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.(EDITABLE))) onKey(e);
      });
    } catch { /* cross-origin */ }
  }

  // 文档帧没有机壳可量：只看有没有打开（JSON 错误页算失败），按键照样转发。
  function watchDocFrame(f) {
    const { iframe, box } = f;
    iframe.addEventListener('load', () => {
      const failed = docFrameFailed(iframe);
      if (failed) failNote(box, failed.detail);
      else box.dataset.fitted = '1';
      forwardKeys(iframe);
    });
  }

  function watchFrame(f) {
    if (f.natural.height === null) {
      watchDocFrame(f);
      return;
    }
    const { iframe, box } = f;
    let ro = null;
    const measure = () => {
      if (!state || !state.frames.includes(f)) return;
      const m = measureStage(iframe, { device: true });
      if (!m) return;
      if (m.failed) { failNote(box, m.detail); return; }
      const changed = !f.m || f.m.width !== m.width || f.m.height !== m.height || f.m.x !== m.x || f.m.y !== m.y;
      f.m = m;
      box.dataset.fitted = '1';
      if (!ro && m.stage && iframe.contentWindow?.ResizeObserver) {
        // 帧里交互可能改变组件台的大小（展开、换态）：跟着重排。
        ro = new iframe.contentWindow.ResizeObserver(() => measure());
        ro.observe(m.stage);
        state.cleanups.push(() => ro.disconnect());
      }
      if (changed) {
        layout();
        if (!state.userScrolled && state.focusFig) centerOn(state.focusFig);
      }
    };
    const onLoad = () => {
      measure(); setTimeout(measure, 300); setTimeout(measure, 1200);
      forwardKeys(iframe);
    };
    iframe.addEventListener('load', onLoad);
  }

  // ---- 渲染一节 ----
  function render(sectionId, frameId) {
    const card = cardOf(sectionId);
    for (const fn of state.cleanups) fn();
    state.cleanups = [];
    state.section = sectionId;
    state.userScrolled = false;
    const d = card.dataset;
    el.num.textContent = d.num || '';
    el.title.textContent = d.title || sectionId;
    el.meta.textContent = d.meta || '';
    el.canvas.href = d.href || '/workbench/';
    dlg.dataset.ppSection = sectionId;
    const prev = neighborSection(ids, sectionId, -1);
    const next = neighborSection(ids, sectionId, 1);
    const label = (id) => { const c = cardOf(id); return c ? `${c.dataset.num || ''} ${c.dataset.title || id}`.trim() : ''; };
    el.prev.disabled = !prev;
    el.next.disabled = !next;
    el.prev.setAttribute('aria-label', prev ? `上一节：${label(prev)}` : '上一节');
    el.next.setAttribute('aria-label', next ? `下一节：${label(next)}` : '下一节');
    el.prev.title = el.prev.getAttribute('aria-label');
    el.next.title = el.next.getAttribute('aria-label');

    // 页面宽度切换：这一节有文档帧才出现，状态就是卡片的 data-doc-width。
    el.width.hidden = !d.docWidth;
    syncWidthButtons(d.docWidth);

    el.strip.replaceChildren();
    state.frames = framesOf(card).map((info) => {
      const fig = document.createElement('figure');
      fig.className = 'ov-frame';
      fig.dataset.screen = info.id;
      if (info.shell) fig.dataset.shell = info.shell;
      // 图注只有帧 id（文章页不出画布字母 B1，和卡片一样）。
      const cap = document.createElement('figcaption');
      cap.className = 'cap';
      const id = document.createElement('b');
      id.textContent = info.id;
      cap.append(id);
      const sb = shellBox(info.shell, card.dataset.docWidth);
      const box = document.createElement('div');
      box.className = `ov-box ${sb.mode}${info.missing ? ' missing' : ''}`;
      // 外壳管阴影和高亮，盒子管裁切（手机帧用 clip-path，会把盒子自己的阴影也裁掉）。
      const shellEl = document.createElement('div');
      shellEl.className = `ov-shell ${sb.mode}`;
      shellEl.append(box);
      fig.append(cap, shellEl);
      const f = { info, fig, box, iframe: null, natural: naturalBox(sb), m: null };
      if (info.missing) {
        const ph = document.createElement('div');
        ph.className = 'ph';
        ph.textContent = `缺帧 ${info.id}`;
        box.append(ph);
      } else {
        const iframe = document.createElement('iframe');
        iframe.title = info.title;
        // 文档帧在浮层里整页可滚；机壳帧量好尺寸，不滚。
        if (sb.mode !== 'doc') iframe.setAttribute('scrolling', 'no');
        iframe.src = info.src;
        box.append(iframe);
        f.iframe = iframe;
        watchFrame(f);
      }
      el.strip.append(fig);
      return f;
    });
    layout();
    const focus = state.frames.find((f) => f.info.id === frameId) || null;
    state.focusFig = focus ? focus.fig : null;
    el.strip.scrollLeft = 0;
    if (focus) {
      centerOn(focus.fig);
      focus.fig.classList.add('flash');
      const t = setTimeout(() => focus.fig.classList.remove('flash'), FLASH_MS);
      state.cleanups.push(() => clearTimeout(t));
    }
  }

  function syncWidthButtons(key) {
    for (const button of el.width.querySelectorAll('[data-width]')) {
      button.setAttribute('aria-pressed', button.dataset.width === key ? 'true' : 'false');
    }
  }

  // 换宽度：只改文档帧的宽度、重排，不重载 iframe（页面里的滚动位置和交互状态留着）。
  function applyDocWidth(key) {
    if (!state) return;
    syncWidthButtons(key);
    for (const f of state.frames) {
      if (f.natural.height !== null || f.info.shell !== 'doc') continue;
      f.natural = naturalBox(shellBox('doc', key));
    }
    layout();
    if (state.focusFig) centerOn(state.focusFig);
  }

  // ---- 打开 / 关闭 ----
  function open(sectionId, { frame = '', trigger = null, pushed = false } = {}) {
    if (!cardOf(sectionId)) return false;
    if (!state) {
      layers.dismiss('popup');
      state = { section: '', origin: sectionId, trigger, pushed, frames: [], cleanups: [], userScrolled: false, focusFig: null, scale: 1 };
      state.release = layers.push('overlay', () => close());
      document.documentElement.classList.add('pp-ov-lock');
      dlg.showModal();
      window.addEventListener('resize', layout);
    }
    render(sectionId, frame);
    el.strip.focus({ preventScroll: true });
    return true;
  }

  // 关闭后焦点回到点开它的那一帧；换过节就回到当前节卡片里的那一帧（第一帧），页面随之滚到那张卡片。
  function returnTarget(s) {
    if (s.trigger && s.section === s.origin && s.trigger.isConnected) return s.trigger;
    const card = cardOf(s.section);
    return card?.querySelector(`.cc-frame[data-screen="${CSS.escape(s.focusFig?.dataset.screen || '')}"] .cc-hit`)
      || card?.querySelector('.cc-hit') || null;
  }

  function teardown() {
    const s = state;
    state = null;
    s.release?.();
    for (const fn of s.cleanups) fn();
    window.removeEventListener('resize', layout);
    dlg.close();
    el.strip.replaceChildren();
    delete dlg.dataset.ppSection;
    document.documentElement.classList.remove('pp-ov-lock');
    const target = returnTarget(s);
    target?.focus({ preventScroll: s.section === s.origin });
    return { s, target };
  }

  function close({ fromHistory = false } = {}) {
    if (!state) return;
    const { s, target } = teardown();
    if (fromHistory) return;
    if (s.pushed) {
      // 后退会恢复点开时的滚动位置；换过节时回来再把焦点那张卡片滚进视口。
      pendingRefocus = s.section === s.origin ? null : target;
      history.back();
    } else {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }

  function go(step) {
    if (!state) return;
    const id = neighborSection(ids, state.section, step);
    if (!id) return;
    history.replaceState(history.state, '', overlayHash(id));
    render(id, '');
  }

  function onKey(e) {
    if (!state) return;
    // 帧里转发来的 Esc（本文档的 Esc 由弹层栈在捕获阶段处理，到不了这里）。
    if (e.key === 'Escape') { layers.escape(e); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (e.target?.closest?.(EDITABLE)) return;
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  // ---- 事件 ----
  document.addEventListener('click', (e) => {
    const hit = e.target.closest?.('[data-pp-frame-open]');
    if (!hit || state) return;
    // 修饰键 / 中键：照常在新标签页打开同一个浮层地址。
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const card = hit.closest('[data-pp-canvas]');
    const section = card?.dataset.ppSection;
    if (!section || !cardOf(section)) return;
    e.preventDefault();
    const frame = hit.closest('.cc-frame')?.dataset.screen || '';
    history.pushState(history.state, '', overlayHash(section, frame));
    open(section, { frame, trigger: hit, pushed: true });
  });

  // 焦点困在浮层里：Tab 走到首尾的哨兵就绕回另一头（帧 iframe 也算一站，进去以后是帧自己的 Tab 序）。
  const stops = () => [...dlg.querySelectorAll('.ov-head button:not([disabled]), .ov-head a[href], .ov-strip iframe')];
  dlg.addEventListener('focusin', (e) => {
    const guard = e.target.dataset?.ovGuard;
    if (!guard) return;
    const list = stops();
    (guard === 'end' ? list[0] : list[list.length - 1])?.focus();
  });
  installLayerKeys();
  dlg.addEventListener('keydown', onKey);
  // 原生 Esc（cancel）也走同一条关闭路径，好让地址和焦点一起复原。
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // 点到面板外的暗色区域（dialog 自己或它的 ::backdrop）关闭。
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  el.close.addEventListener('click', () => close());
  el.prev.addEventListener('click', () => go(-1));
  el.width.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-width]');
    const card = state && cardOf(state.section);
    if (button && card) setCardDocWidth(card, button.dataset.width);
  });
  // 卡片的宽度改了（浮层头的切换，或卡片头的切换）：浮层开着这一节时跟着换。
  document.addEventListener('pp:doc-width', (e) => {
    if (state && e.target === cardOf(state.section)) applyDocWidth(e.detail.width);
  });
  el.next.addEventListener('click', () => go(1));
  const userScroll = () => { if (state) state.userScrolled = true; };
  for (const type of ['wheel', 'touchstart', 'pointerdown']) el.strip.addEventListener(type, userScroll, { passive: true });

  window.addEventListener('hashchange', () => {
    if (pendingRefocus) {
      const t = pendingRefocus;
      pendingRefocus = null;
      t.focus({ preventScroll: true });
      t.closest('.canvas-card')?.scrollIntoView({ block: 'center' });
    }
    const h = parseOverlayHash(location.hash);
    if (h && cardOf(h.section)) {
      // 前进键、地址栏改 hash：浮层有上一条历史可退。
      if (!state) open(h.section, { frame: h.frame, pushed: true });
      else if (state.section !== h.section) render(h.section, h.frame);
    } else if (state) {
      close({ fromHistory: true });
    }
  });

  // 直接带 #overlay= 打开页面（分享的链接）。
  const initial = parseOverlayHash(location.hash);
  if (initial) open(initial.section, { frame: initial.frame, pushed: false });

  // e2e / 调试用的只读状态。
  window.pinpointOverlay = { state: () => (state ? { section: state.section, scale: state.scale, frames: state.frames.map((f) => f.info.id), docWidth: cardOf(state.section)?.dataset.docWidth || '' } : null) };
}
