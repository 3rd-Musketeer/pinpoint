// 浏览器端：画布浮层（CanvasOverlay.astro 的空壳）。契约在 site/README.md「画布浮层」。
// 从文章进画布都不跳页：顶栏“画布视图”、卡片“打开画布”、右栏的画布标注卡片，都在文章上开
// 整张画布（一份嵌入版工作台，可标注、平移、缩放），关掉回到原来的滚动位置。
// 卡片里点某一帧是单帧预览（owner 2026-10-15：“现在点击文章内嵌的画布没有预览功能了？直接进画布？”）：
// 同一个浮层、同一份工作台，workbench.setSolo 只留这一帧——HTML 帧直接是它的页面浮层，iOS / 组件帧放大装下；
// 头部“看整张画布”切回整张画布并停在这一帧。HTML 帧上的画布标注也走预览（那一页里定位钉子）。
// 地址：#canvas=<节 id>[&frame=<帧 id>][&view=frame][&ann=<#n>]。打开时 pushState 一条，后退就关；直接带这个 hash
// 打开文章（刷新、分享的链接）也会打开浮层，这时关闭只把 hash 换掉（replaceState），不后退离开文章。
// 画布里换了节（平移、大纲）用 replaceState 跟着换 #canvas=，不多压历史。旧地址 #overlay= 照样认。
// 修饰键 / 中键点这些入口：照常走链接（顶栏和卡片按钮在新标签页开整页画布，右栏卡片在新标签页开带浮层的文章）。
import { canvasHref } from './canvas-card.js';
import { installLayerKeys, layers } from './layers.js';
import { FRAME_VIEW, canvasHash, embedCanvasSrc, embedMessage, entrySection, parseCanvasHash } from './canvas-overlay.js';

// 等工作台装好、标注账本水合完的上限：到点还没好就只开着画布，不再定位。
const READY_WAIT_MS = 20_000;
const POLL_MS = 100;
const SECTION_SETTLE_MS = 300;

const ENTRY_SELECTOR = '[data-pp-frame-open], [data-pp-open], #btn-canvas, a[data-pp-canvas-link]';

export function initCanvasOverlay() {
  const dlg = document.querySelector('[data-pp-overlay]');
  const cards = [...document.querySelectorAll('[data-pp-canvas]')].filter((c) => c.dataset.page);
  if (!dlg || !cards.length) return;
  const pageId = cards[0].dataset.page;
  const $ = (sel) => dlg.querySelector(sel);
  const el = {
    kind: $('[data-ov-kind]'), num: $('[data-ov-num]'), title: $('[data-ov-title]'), frame: $('[data-ov-frame]'),
    full: $('[data-ov-full]'), canvas: $('[data-ov-canvas]'), close: $('[data-ov-close]'), body: $('[data-ov-body]'),
  };
  const ids = cards.map((c) => c.dataset.ppSection);
  const order = [...document.querySelectorAll('section.sec[id]')].map((s) => s.id);
  const cardOf = (id) => cards.find((c) => c.dataset.ppSection === id) || null;

  // state：{ section, frame, view, trigger, pushed, scrollX, scrollY, release }；iframe 关了也留着（再开不用重装工作台）。
  let state = null;
  let iframe = null;
  let navigation = 0;   // 每次打开 / 换落点加一：上一次还在等工作台的定位作废

  const frameOf = (sectionId, frameId) => (frameId
    ? [...(cardOf(sectionId)?.querySelectorAll('.cc-frame[data-screen]') || [])].find((f) => f.dataset.screen === frameId) || null
    : null);

  // 预览：只有卡片里真有这一帧才算（没有就开整张画布）。
  const previewOf = (sectionId, frameId, view) => (view === FRAME_VIEW && frameOf(sectionId, frameId) ? FRAME_VIEW : '');

  function setHeader(sectionId, view = '', frameId = '') {
    const card = cardOf(sectionId);
    const preview = view === FRAME_VIEW;
    el.kind.textContent = preview ? '预览' : '画布';
    el.num.textContent = card?.dataset.num || '';
    el.title.textContent = card?.dataset.title || sectionId;
    el.frame.textContent = preview ? frameId : '';
    el.frame.hidden = !preview;
    el.full.hidden = !preview;
    el.canvas.href = canvasHref(pageId, sectionId);
    dlg.dataset.ppSection = sectionId;
    if (preview) dlg.dataset.ovView = FRAME_VIEW;
    else delete dlg.dataset.ovView;
  }

  // ---- 嵌入的工作台 ----
  function ensureFrame(sectionId) {
    if (iframe) return false;
    iframe = document.createElement('iframe');
    iframe.className = 'ov-canvas';
    iframe.title = '画布';
    iframe.src = embedCanvasSrc(pageId, sectionId);
    el.body.append(iframe);
    return true;
  }

  const frameWin = () => { try { return iframe?.contentWindow || null; } catch { return null; } };

  /** 轮询直到 test() 为真；navigation 变了（关了 / 换了落点）或超时 → false。 */
  function until(test, nav) {
    const deadline = Date.now() + READY_WAIT_MS;
    return new Promise((resolve) => {
      const tick = () => {
        if (nav !== navigation || !state) { resolve(false); return; }
        let ok = false;
        try { ok = !!test(); } catch { ok = false; }
        if (ok) { resolve(true); return; }
        if (Date.now() > deadline) { resolve(false); return; }
        setTimeout(tick, POLL_MS);
      };
      tick();
    });
  }

  async function boardReady(nav) {
    if (!(await until(() => frameWin()?.workbench?.activePageId?.() === pageId, nav))) return false;
    // whenBoardSettled 在板换过一次时接着等新的那个；false = 还没有会话，重取再等。
    for (let i = 0; i < 50; i += 1) {
      if (nav !== navigation) return false;
      if (await frameWin().workbench.whenBoardSettled()) return true;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return false;
  }

  // 预览等工作台换到这一帧再露出来（data-ov-wait，site.css）。
  function reveal(nav) {
    if (nav === navigation) delete dlg.dataset.ovWait;
  }

  // 定位：预览 → 只留这一帧；否则节（第一次装载由地址里的 &section= 落点，再开时调 focusSection）→ 帧 → 钉子。
  async function land({ section, frame, ann, fresh, view }) {
    const nav = ++navigation;
    if (!(await boardReady(nav))) { reveal(nav); landed(nav, ''); return; }
    if (document.activeElement === el.close) iframe.focus({ preventScroll: true });
    const wb = frameWin().workbench;
    const solo = typeof wb.setSolo === 'function';
    if (view === FRAME_VIEW && solo) {
      const kind = wb.setSolo(section, frame);
      reveal(nav);
      if (kind) {
        const at = kind === 'page' ? `page:${frame}` : `frame:${frame}`;
        if (ann == null) { landed(nav, at); return; }
        await toMark(nav, wb, ann, kind === 'page', at);
        return;
      }
    }
    if (solo) wb.setSolo('');
    reveal(nav);
    // 一篇文章一张画布（2026-10-15）：上回在画布里开着某一页（页面浮层），这回先关掉回画布。
    if (typeof wb.pageOpen === 'function' && wb.pageOpen()) wb.closePage();
    if (!fresh && !frame && ann == null) await wb.focusSection(section);
    if (nav !== navigation) return;
    if (frame) await wb.focusFrame(section, frame, { smooth: !fresh });
    if (ann == null) { landed(nav, 'section'); return; }
    // HTML 帧上的标注在那一页里：先开它的页面浮层，钉子在那一页的标注客户端里找（旧地址，不带 view=frame）。
    const page = !!(frame && typeof wb.openPage === 'function' && wb.openPage(frame));
    await toMark(nav, wb, ann, page, page ? `page:${frame}` : 'section');
  }

  // 钉子：等标注客户端水合完这一页（page：页面浮层里那一页）的账本、认得这个 #n，再跳过去并打开它
  // （与列表点行同一条路）。找不到就停在 fallback。
  async function toMark(nav, wb, ann, page, fallback) {
    const annApi = () => {
      if (!page) return frameWin().pinpoint;
      const api = wb.annotateApi();
      return api && api !== frameWin().pinpoint ? api : null;
    };
    const markReady = () => {
      const api = annApi();
      if (!api || typeof api.goToMark !== 'function') return false;
      if (api.getState().routing) return false;
      return api.marks.some((m) => m.n === ann);
    };
    if (!(await until(markReady, nav))) { landed(nav, fallback); return; }
    const done = await annApi().goToMark(ann);
    landed(nav, done === false ? fallback : `ann:${ann}`);
  }

  // e2e / 调试：最后一次定位落到了哪里。
  let lastLanding = '';
  function landed(nav, what) {
    if (nav !== navigation) return;
    lastLanding = what;
    if (state) state.landed = true;
  }

  // ---- 打开 / 关闭 ----
  function open(sectionId, { frame = '', ann = null, view = '', trigger = null, pushed = false } = {}) {
    if (!cardOf(sectionId)) return false;
    lastLanding = '';
    const v = previewOf(sectionId, frame, view);
    if (!state) {
      layers.dismiss('popup');
      state = { section: sectionId, trigger, pushed, scrollX: window.scrollX, scrollY: window.scrollY };
      state.release = layers.push('overlay', () => close());
      document.documentElement.classList.add('pp-ov-lock');
      dlg.showModal();
    } else {
      state.section = sectionId;
    }
    state.frame = frame;
    state.view = v;
    // 定位落定之前，工作台装载、滚动途中报来的节不算数（不然 #canvas= 会先被换成路过的节）。
    state.landed = false;
    setHeader(sectionId, v, frame);
    if (v === FRAME_VIEW) dlg.dataset.ovWait = '';
    else delete dlg.dataset.ovWait;
    const fresh = ensureFrame(sectionId);
    // 工作台装好之前焦点留在文章页（关闭钮）：这时按 Esc 由文章页关浮层；装好后再把焦点交给画布（land）。
    if (fresh) el.close.focus({ preventScroll: true });
    else iframe.focus({ preventScroll: true });
    land({ section: sectionId, frame, ann, fresh, view: v });
    return true;
  }

  function teardown() {
    const s = state;
    state = null;
    navigation += 1;
    s.release?.();
    dlg.close();
    delete dlg.dataset.ppSection;
    delete dlg.dataset.ovView;
    delete dlg.dataset.ovWait;
    document.documentElement.classList.remove('pp-ov-lock');
    restore(s);
    if (s.trigger?.isConnected) s.trigger.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('pp:canvas-overlay-closed'));
    return s;
  }

  // 回到打开前的滚动位置（锁滚动、dialog、后退都不该让正文挪地方）。
  function restore(s) {
    if (window.scrollX !== s.scrollX || window.scrollY !== s.scrollY) window.scrollTo(s.scrollX, s.scrollY);
  }

  let pendingRestore = null;
  function close({ fromHistory = false } = {}) {
    if (!state) return;
    const s = teardown();
    if (fromHistory) return;
    if (s.pushed) {
      // 后退把 hash 换回打开前的样子；浏览器恢复那一条的滚动位置时，再按打开前的位置校一次。
      pendingRestore = s;
      history.back();
    } else {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }

  // ---- 入口 ----
  function currentSection() {
    const line = window.innerHeight * 0.35;
    let cur = order[0] || '';
    for (const id of order) {
      const sec = document.getElementById(id);
      if (sec && sec.getBoundingClientRect().top <= line) cur = id;
    }
    return cur;
  }

  /** 点了哪个入口 → { section, frame, view, ann }；不是入口 → null。卡片里点帧是预览，“打开画布”是整张画布。 */
  function targetOf(hit) {
    if (hit.matches('[data-pp-canvas-link]')) return parseCanvasHash(new URL(hit.href, location.href).hash);
    if (hit.id === 'btn-canvas') return { section: entrySection(ids, order, currentSection()), frame: '', view: '', ann: null };
    const section = hit.closest('[data-pp-canvas]')?.dataset.ppSection || '';
    const frame = hit.matches('[data-pp-frame-open]') ? hit.closest('.cc-frame')?.dataset.screen || '' : '';
    return { section, frame, view: frame ? FRAME_VIEW : '', ann: null };
  }

  document.addEventListener('click', (e) => {
    const hit = e.target.closest?.(ENTRY_SELECTOR);
    if (!hit || state) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const t = targetOf(hit);
    if (!t || !cardOf(t.section)) return;
    e.preventDefault();
    history.pushState(history.state, '', canvasHash(t.section, { frame: t.frame, ann: t.ann, view: t.view }));
    open(t.section, { frame: t.frame, ann: t.ann, view: t.view, trigger: hit, pushed: true });
  });

  // 预览头部的“看整张画布”：同一个浮层换成整张画布、停在这一帧；地址换掉 view=frame，不多压历史（后退照样关）。
  el.full.addEventListener('click', () => {
    if (!state || state.view !== FRAME_VIEW) return;
    const { section, frame } = state;
    history.replaceState(history.state, '', canvasHash(section, { frame }));
    open(section, { frame });
  });

  // 工作台嵌入版的消息：Esc 没被画布里的某一层接住 → 关；画布换了节 → 头部和地址跟着换。
  window.addEventListener('message', (e) => {
    if (!iframe || e.source !== iframe.contentWindow || e.origin !== location.origin) return;
    const msg = embedMessage(e.data);
    if (!msg || !state) return;
    if (msg.type === 'close') { close(); return; }
    if (msg.type === 'section') followSection(msg.section);
  });

  // 画布换了节：停稳 SECTION_SETTLE_MS 再跟（定位、平移途中路过的节不算），头部和 #canvas= 换成它。
  let sectionTimer = 0;
  function followSection(section) {
    clearTimeout(sectionTimer);
    sectionTimer = setTimeout(() => {
      if (!state || !state.landed || state.view === FRAME_VIEW || !cardOf(section) || section === state.section) return;
      state.section = section;
      setHeader(section);
      history.replaceState(history.state, '', canvasHash(section));
    }, SECTION_SETTLE_MS);
  }

  // 焦点困在浮层里：Tab 走到首尾的哨兵就绕回另一头（画布 iframe 也是一站，进去以后是工作台自己的 Tab 序）。
  const stops = () => [...dlg.querySelectorAll('.ov-head button:not([disabled]):not([hidden]), .ov-head a[href], .ov-body iframe')];
  dlg.addEventListener('focusin', (e) => {
    const guard = e.target.dataset?.ovGuard;
    if (!guard) return;
    const list = stops();
    (guard === 'end' ? list[0] : list[list.length - 1])?.focus();
  });
  installLayerKeys();
  // 原生 Esc（cancel）也走同一条关闭路径，好让地址、焦点和滚动位置一起复原。
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // 点到面板外的暗色区域（dialog 自己或它的 ::backdrop）关闭。
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  el.close.addEventListener('click', () => close());

  window.addEventListener('hashchange', () => {
    if (pendingRestore) {
      const s = pendingRestore;
      pendingRestore = null;
      restore(s);
    }
    const h = parseCanvasHash(location.hash);
    if (h && cardOf(h.section)) {
      // 前进键、地址栏改 hash：浮层有上一条历史可退。
      if (!state) open(h.section, { frame: h.frame, ann: h.ann, view: h.view, pushed: true });
      else if (h.section !== state.section || h.frame || h.ann != null || h.view !== state.view) open(h.section, { frame: h.frame, ann: h.ann, view: h.view });
    } else if (state) {
      close({ fromHistory: true });
    }
  });

  // 直接带 #canvas= 打开文章（刷新、分享的链接）。
  const initial = parseCanvasHash(location.hash);
  if (initial && cardOf(initial.section)) {
    if (location.hash.startsWith('#overlay=')) history.replaceState(history.state, '', canvasHash(initial.section, initial));
    open(initial.section, { frame: initial.frame, ann: initial.ann, view: initial.view, pushed: false });
  }

  // e2e / 调试用的只读状态。
  window.pinpointOverlay = {
    state: () => (state ? { section: state.section, frame: state.frame, view: state.view, pushed: state.pushed, landing: lastLanding } : null),
    frame: () => iframe,
  };
}
