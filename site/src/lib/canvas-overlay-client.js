// 浏览器端：画布浮层（CanvasOverlay.astro 的空壳）。契约在 site/README.md「画布浮层」。
// 从文章进画布都不跳页：顶栏“画布视图”、卡片“打开画布”、右栏的画布标注卡片，都在文章上开
// 整张画布（一份嵌入版工作台，可标注、平移、缩放），关掉回到原来的滚动位置。
// 点帧定位并选中；右栏标注定位到画布或 HTML 活卡片里的钉子。
// 地址：#canvas=<节 id>[&frame=<帧 id>][&ann=<#n>]。打开时 pushState 一条，后退就关；
// 直接带 hash 打开文章时关闭只去掉 hash，不离开文章。
// 画布里换了节（平移、大纲）用 replaceState 跟着换 #canvas=，不多压历史。旧地址 #overlay= 照样认。
// 修饰键 / 中键点这些入口：照常走链接（顶栏和卡片按钮在新标签页开整页画布，右栏卡片在新标签页开带浮层的文章）。
import { canvasHref } from './canvas-card.js';
import { installLayerKeys, layers } from './layers.js';
import { canvasHash, embedCanvasSrc, embedMessage, entrySection, parseCanvasHash } from './canvas-overlay.js';
import { OV_CLOSE_MS, OV_EASE, OV_OPEN_MS, OV_REDUCED_MS, OV_SCALE, overlayOrigin } from './overlay-motion.js';

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
    kind: $('[data-ov-kind]'), num: $('[data-ov-num]'), title: $('[data-ov-title]'),
    canvas: $('[data-ov-canvas]'), close: $('[data-ov-close]'), body: $('[data-ov-body]'),
    panel: dlg.querySelector('.ov-panel'), status: $('[data-ov-status]'),
  };
  const ids = cards.map((c) => c.dataset.ppSection);
  const order = [...document.querySelectorAll('section.sec[id]')].map((s) => s.id);
  const cardOf = (id) => cards.find((c) => c.dataset.ppSection === id) || null;

  // state：{ section, frame, trigger, pushed, scrollX, scrollY, release }；iframe 关了也留着（再开不用重装工作台）。
  let state = null;
  let iframe = null;
  let navigation = 0;   // 每次打开 / 换落点加一：上一次还在等工作台的定位作废
  let openEpoch = 0;    // 每次打开加一，关闭再加一：进行中的加载态观察作废

  const frameOf = (sectionId, frameId) => (frameId
    ? [...(cardOf(sectionId)?.querySelectorAll('.cc-frame[data-screen]') || [])].find((f) => f.dataset.screen === frameId) || null
    : null);

  function setHeader(sectionId) {
    const card = cardOf(sectionId);
    el.kind.textContent = '画布';
    el.num.textContent = card?.dataset.num || '';
    el.title.textContent = card?.dataset.title || sectionId;
    el.canvas.href = canvasHref(pageId, sectionId);
    dlg.dataset.ppSection = sectionId;
  }

  // ---- 嵌入的工作台 ----
  // 文档本身没装上（网络失败，页跨域读不了）才由这里显示「重试」。记在每次 load 上，不靠轮询撞中间态：
  // 重试后立刻又失败、失败后关掉再开，都能认出来。
  let frameFailed = false;
  let loadGen = 0;
  const frameDead = () => {
    try { void iframe.contentWindow.location.href; return false; }
    catch { return true; }
  };
  const noteLoad = () => {
    frameFailed = false;
    const gen = ++loadGen;
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      if (gen !== loadGen) return;
      // load 要等模块脚本结束。跨域错误页，或文档装上了却没有工作台，都是确定失败。
      // 模块还扣着时 load 没到，不在这里判，准备态一直留着。
      frameFailed = frameDead() || !workbenchOf();
    };
    iframe.addEventListener('load', onLoad);
  };

  function ensureFrame(sectionId) {
    if (iframe) return false;
    iframe = document.createElement('iframe');
    iframe.className = 'ov-canvas';
    iframe.title = '画布';
    iframe.src = embedCanvasSrc(pageId, sectionId);
    noteLoad();
    el.body.append(iframe);
    return true;
  }

  // 失败页不是同源的，读 contentWindow 的属性会抛 SecurityError。读不到就当还没装好。
  const frameWin = () => { try { return iframe?.contentWindow || null; } catch { return null; } };
  const workbenchOf = () => { try { return frameWin()?.workbench || null; } catch { return null; } };

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
    if (!(await until(() => workbenchOf()?.activePageId?.() === pageId, nav))) return false;
    // whenBoardSettled 在板换过一次时接着等新的那个；false = 还没有会话，重取再等。
    for (let i = 0; i < 50; i += 1) {
      if (nav !== navigation) return false;
      if (await frameWin().workbench.whenBoardSettled()) return true;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return false;
  }

  // 准备态一直留到两个就绪信号都到。只有确定的失败才换成重试：文档加载失败（frameFailed），
  // 或工作台自己画出了错误面板。显示重试之后也不停，就绪信号一到就收起，不靠时长猜。
  async function watchReady(epoch) {
    while (epoch === openEpoch && state) {
      let ownError = false;
      let bootError = '';
      try {
        ownError = !!frameWin()?.document?.querySelector('[data-err-panel]');
        bootError = frameWin()?.__wbBootError || '';
      } catch { ownError = false; }
      if (ownError) { showStatus(''); }
      else if (frameFailed || bootError) { showStatus('retry'); }
      const wb = workbenchOf();
      if (wb && !ownError) {
        const gen = loadGen;
        const board = await Promise.race([
          wb.whenBoardSettled().then((ok) => ({ ok })),
          // 重试换了文档，上一份永不返回的 Promise 不能卡住这次。
          // 等待期间入口模块失败（__wbBootError），或重试换了文档、旧文档的 workbench 被新的取代，都要放手重看。
          new Promise((resolve) => {
            const bootFailed = () => { try { return !!frameWin()?.__wbBootError; } catch { return false; } };
            const watch = () => {
              if (loadGen !== gen || epoch !== openEpoch || workbenchOf() !== wb || bootFailed()) resolve('stop');
              else setTimeout(watch, 100);
            };
            setTimeout(watch, 100);
          }),
        ]);
        if (board === 'stop') continue;
        const previews = await wb.whenPreviewsSettled();
        if (epoch !== openEpoch || !state || loadGen !== gen) continue;
        if (board.ok && previews) { showStatus(''); return; }
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  // 定位：节 → 帧（定位并选中）→ 钉子。
  async function land({ section, frame, ann, fresh }, nav) {
    navigation = nav;
    if (!(await boardReady(nav))) { landed(nav, ''); return; }
    if (document.activeElement === el.close) iframe.focus({ preventScroll: true });
    const wb = frameWin().workbench;
    // 一篇文章一张画布（2026-10-15）：上回在画布里开着某一页（页面浮层），这回先关掉回画布。
    if (typeof wb.pageOpen === 'function' && wb.pageOpen()) wb.closePage();
    if (!fresh && !frame && ann == null) await wb.focusSection(section);
    if (nav !== navigation) return;
    if (frame) await wb.focusFrame(section, frame, { smooth: !fresh });
    const at = frame ? `frame:${frame}` : 'section';
    if (ann == null) { landed(nav, at); return; }
    // HTML 帧的钉子在活卡片自己的客户端里；不打开页面浮层。
    const html = !!frameOf(section, frame)?.hasAttribute('data-doc-url');
    await toMark(nav, () => html ? wb.cardAnnotateApi(frame) : frameWin().pinpoint, ann, at);
  }

  // 等目标账本水合、认得 #n，再走客户端的定位与打开流程。
  async function toMark(nav, annApi, ann, fallback) {
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

  // ---- 加载态 ----
  // mode：'' 收起；'loading' 正在准备；'retry' 同处换成重试。
  let shown = '';
  function showStatus(mode) {
    const s = el.status;
    if (!s || mode === shown) return;
    shown = mode;
    if (!mode) { s.hidden = true; s.replaceChildren(); return; }
    s.hidden = false;
    s.replaceChildren();
    if (mode === 'loading') { s.textContent = '正在准备画布…'; return; }
    s.append('画布没有准备好');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn ov-retry';
    retry.textContent = '重试';
    retry.addEventListener('click', () => {
      if (!state || !iframe) return;
      // 先清掉旧文档的失败痕迹、换新代次，再开始观察：否则第一次观察会读到旧的失败又显示重试。
      try { delete iframe.contentWindow.__wbBootError; } catch { /* 失败页读不到，换文档后自然没了 */ }
      noteLoad();
      iframe.src = embedCanvasSrc(pageId, state.section);
      showStatus('loading');
      const nav = ++navigation;
      watchReady(++openEpoch);
      land({ section: state.section, frame: state.frame, ann: null, fresh: true }, nav);
    });
    s.append(retry);
  }

  // ---- 转场 ----
  // 缩放只作用在 .ov-panel 上，不作用在工作台的 .wb-stage-wrap。途中再关从当前呈现值反向，不锁关闭按钮。
  let playing = null;
  let closing = false;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const presented = () => {
    const cs = getComputedStyle(el.panel);
    const m = new DOMMatrix(cs.transform);
    return { opacity: cs.opacity, transform: reduced() ? 'none' : `scale(${m.a || 1})` };
  };
  const play = (show, ms) => {
    // 还在播的（退出途中再开）从当前呈现值起。播完的 fill 停在收起的样子，再开要从 0 走。
    const from = el.panel.getAnimations().some((a) => a.playState === 'running') ? presented() : null;
    playing?.cancel();
    const fade = reduced();
    const end = { opacity: show ? 1 : 0, transform: fade ? 'none' : `scale(${show ? 1 : OV_SCALE})` };
    const start = from || { opacity: show ? 0 : 1, transform: fade ? 'none' : `scale(${show ? OV_SCALE : 1})` };
    playing = el.panel.animate([start, end], { duration: fade ? OV_REDUCED_MS : ms, easing: OV_EASE, fill: 'both' });
    return playing.finished.catch(() => {});
  };

  // ---- 打开 / 关闭 ----
  function open(sectionId, { frame = '', ann = null, trigger = null, pushed = false } = {}) {
    if (!cardOf(sectionId)) return false;
    lastLanding = '';
    if (!state) {
      layers.dismiss('popup');
      state = { section: sectionId, trigger, pushed, scrollX: window.scrollX, scrollY: window.scrollY };
      state.release = layers.push('overlay', () => close());
      document.documentElement.classList.add('pp-ov-lock');
      const r = trigger?.getBoundingClientRect();
      el.panel.style.transformOrigin = overlayOrigin(r ? r.top + r.height / 2 : innerHeight / 2, innerHeight);
      closing = false;
      dlg.showModal();
      play(true, OV_OPEN_MS);
    } else if (closing) {
      // 退出还没播完就再开：从当前呈现值反向，不从 0 重播。
      closing = false;
      play(true, OV_OPEN_MS);
    } else {
      state.section = sectionId;
    }
    state.frame = frame;
    // 定位落定之前，工作台装载、滚动途中报来的节不算数（不然 #canvas= 会先被换成路过的节）。
    state.landed = false;
    setHeader(sectionId);
    const fresh = ensureFrame(sectionId);
    const nav = navigation + 1;
    // 每次打开都重新观察：上次没就绪就关了，iframe 还在，这次就绪了也要收起准备态。
    // 失败页再开时不换导航，保留上次记下的失败，直接显示重试。
    if (frameFailed) showStatus('retry');
    else if (!workbenchOf()) showStatus('loading');
    watchReady(++openEpoch);
    // 工作台还没装好时焦点留在关闭钮：空文档收不到按键，Esc 到不了浮层。装好后 land 再把焦点交进去。
    if (workbenchOf()) iframe.focus({ preventScroll: true });
    else el.close.focus({ preventScroll: true });
    land({ section: sectionId, frame, ann, fresh }, nav);
    return true;
  }

  function teardown() {
    const s = state;
    state = null;
    closing = false;
    navigation += 1;
    openEpoch += 1;
    s.release?.();
    dlg.close();
    // 动画留着：fill:both 停在收起的样子，途中再开时 play 从它的当前值接着走。
    playing = null;
    delete dlg.dataset.ppSection;
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
  function finishClose(fromHistory) {
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

  // 退出 100ms，从当前呈现值反向，途中可打断（再开把 closing 清掉，播完不再关）。
  // 后退已经把浮层收掉了，不再补一段看不见的动画。
  function close({ fromHistory = false } = {}) {
    if (!state || closing) return;
    // 后退已经把浮层收掉了，不再补一段看不见的动画。减少动态效果走 80ms 淡出。
    if (fromHistory) { finishClose(true); return; }
    closing = true;
    play(false, OV_CLOSE_MS).then(() => { if (closing) finishClose(false); });
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

  /** 点了哪个入口 → { section, frame, ann }；不是入口 → null。点帧带帧落点，“打开画布”带节落点。 */
  function targetOf(hit) {
    if (hit.matches('[data-pp-canvas-link]')) return parseCanvasHash(new URL(hit.href, location.href).hash);
    if (hit.id === 'btn-canvas') return { section: entrySection(ids, order, currentSection()), frame: '', ann: null };
    const section = hit.closest('[data-pp-canvas]')?.dataset.ppSection || '';
    const frame = hit.matches('[data-pp-frame-open]') ? hit.closest('.cc-frame')?.dataset.screen || '' : '';
    return { section, frame, ann: null };
  }

  document.addEventListener('click', (e) => {
    const hit = e.target.closest?.(ENTRY_SELECTOR);
    if (!hit || state) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const t = targetOf(hit);
    if (!t || !cardOf(t.section)) return;
    e.preventDefault();
    history.pushState(history.state, '', canvasHash(t.section, { frame: t.frame, ann: t.ann }));
    open(t.section, { frame: t.frame, ann: t.ann, trigger: hit, pushed: true });
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
      if (!state || !state.landed || !cardOf(section) || section === state.section) return;
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
      if (!state) open(h.section, { frame: h.frame, ann: h.ann, pushed: true });
      else if (h.section !== state.section || h.frame || h.ann != null) open(h.section, { frame: h.frame, ann: h.ann });
    } else if (state) {
      close({ fromHistory: true });
    }
  });

  // 直接带 #canvas= 打开文章（刷新、分享的链接）。
  const initial = parseCanvasHash(location.hash);
  if (initial && cardOf(initial.section)) {
    if (location.hash.startsWith('#overlay=')) history.replaceState(history.state, '', canvasHash(initial.section, initial));
    open(initial.section, { frame: initial.frame, ann: initial.ann, pushed: false });
  }

  // e2e / 调试用的只读状态。
  window.pinpointOverlay = {
    state: () => (state ? { section: state.section, frame: state.frame, pushed: state.pushed, landing: lastLanding } : null),
    frame: () => iframe,
  };
}
