// 浏览器端：画布浮层（CanvasOverlay.astro 的空壳）。契约在 site/README.md「画布浮层」。
// 从文章进画布都不跳页：顶栏“画布视图”、卡片“打开画布”、右栏的画布标注卡片，都在文章上开
// 整张画布（一份嵌入版工作台，可标注、平移、缩放），关掉回到原来的滚动位置。
// 点帧定位并选中；右栏标注定位到画布或 HTML 活卡片里的钉子。
// 地址：#canvas=<节 id>[&frame=<帧 id>][&ann=<#n>]。打开时 pushState 一条，后退就关；
// 直接带 hash 打开文章时关闭只去掉 hash，不离开文章。
// 画布里换了节（平移、大纲）用 replaceState 跟着换 #canvas=，不多压历史。
// 修饰键 / 中键点这些入口：照常走链接（顶栏和卡片按钮在新标签页开整页画布，右栏卡片在新标签页开带浮层的文章）。
import { canvasViewHref } from '../../../src/shared/workbench-url.js';
import { layers } from './layers.js';
import { canvasHash, parseCanvasHash } from '../../../src/shared/canvas-hash.js';
import { embedCanvasSrc, embedMessage, entrySection, overlayDocNext, overlayPhaseNext, prewarmSection } from './canvas-overlay.js';
import { OV_CLOSE_MS, OV_EASE, OV_OPEN_MS, OV_REDUCED_MS, OV_SCALE, overlayOrigin } from './overlay-motion.js';

// 等工作台装好、标注账本水合完的上限：到点还没好就只开着画布，不再定位。
// 等待本身是消息驱动的（工作台主动报就绪），这是上限不是轮询间隔。
const READY_WAIT_MS = 20_000;
const SECTION_SETTLE_MS = 300;

const ENTRY_SELECTOR = '[data-pp-frame-open], [data-pp-open], #btn-canvas, a[data-pp-canvas-link]';

/**
 * 卡片盒子算不算「已开始装」（预热门只等开始装了的盒子出结果）：
 * 摆好 / 失败（data-fitted / data-failed）、shadow 帧排上了队（data-cc-started）、
 * iframe 真的开始加载（非 lazy，或文档已离开 about:blank）。横着滚出 Chromium 懒加载
 * 阈值的 doc 帧永远停在 about:blank（实测阈值 ~5400px，r5 T2）——只凭「DOM 里有 iframe」
 * 算开始，预热门就永不打开，与上面声明的意图相反。
 */
export function boxStarted(box) {
  if (box.dataset.fitted === '1' || box.dataset.failed === '1') return true;
  if (box.querySelector('.cc-shadow[data-cc-started]')) return true;
  const iframe = box.querySelector('iframe');
  if (!iframe) return false;
  if (iframe.getAttribute('loading') !== 'lazy') return true;
  try { return !!iframe.contentDocument && iframe.contentDocument.URL !== 'about:blank'; }
  catch { return true; }
}

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

  // ---- 预热与停驻（E2）----
  // absent → warming → parked → open → parked。iframe 建好就一直在 dialog 的 .ov-body 里，
  // 永不移动：Chromium 里 iframe 换父节点就销毁文档重新导航，挪一次就是重装一次。
  // dialog 关着时 UA 样式是 display:none，里面的画布不排版（预热出来是空的），所以有了
  // iframe 之后关着的 dialog 带 data-ov-held：照常排版（与打开时同一套尺寸），但
  // visibility:hidden、不接点击、inert（不接焦点、不进无障碍树），见 site.css。
  // showModal / close 照旧，Esc、焦点归还、滚动锁都走原来的路。进出 top layer 不卸文档。
  // 生命周期是 overlayPhaseNext；这里只落属性和发给工作台的暂停 / 恢复。
  let phase = 'absent';

  function setPhase(event) {
    phase = overlayPhaseNext(phase, event);
  }

  function holdDialog(on) {
    dlg.toggleAttribute('data-ov-held', on);
    dlg.inert = on;
  }

  // 失败页不是同源的，读 contentWindow 的属性会抛 SecurityError。读不到就当还没装好。
  const frameWin = () => { try { return iframe?.contentWindow || null; } catch { return null; } };
  const workbenchOf = () => { try { return frameWin()?.workbench || null; } catch { return null; } };

  // 文章页 → 嵌入工作台（source 与工作台的消息分开，免得自己的回声被认成工作台的话）。
  function tellFrame(type) {
    const win = frameWin();
    if (!win) return;
    try { win.postMessage({ source: 'pinpoint-article', type }, location.origin); } catch { /* 文档正在换 */ }
  }

  const frameOf = (sectionId, frameId) => (frameId
    ? [...(cardOf(sectionId)?.querySelectorAll('.cc-frame[data-screen]') || [])].find((f) => f.dataset.screen === frameId) || null
    : null);

  // ---- 文档就绪（C1）----
  // 状态由工作台的主动消息推进（embed.js：ready / board-error；index.html 的入口
  // onerror：boot-error；本页的 load 判定跨域错误页与装上了却没有工作台的文档）。
  // 不再轮询 iframe、不按时长猜失败：模块还在加载就一直 'loading'。
  //   loading      等工作台的主动信号；
  //   ready        板和预览都落定 → 收起准备态、放行定位；
  //   board-error  工作台画了自己的错误面板 → 收起准备态让出面板，定位不跟它抢；
  //   retry        文档加载失败或入口脚本报了加载失败 → 显示「重试」。
  let docState = 'loading';
  let docGen = 0;       // 每次装 / 重试换文档 +1，随 src 传给工作台；消息按它核对归属，
                        // 重试后旧文档迟到的消息作废（代次语义从 until 时代保留）。
  let docWaiters = [];
  let autoReloads = 0;
  let reloadTimer = 0;
  const STATUS_TEXT = { loading: 'loading', ready: '', 'board-error': '', retry: 'retry' };

  function setDocState(next) {
    if (next === 'ready') {
      clearTimeout(reloadTimer);
      reloadTimer = 0;
      autoReloads = 0;
    }
    if (next === docState) return;
    docState = next;
    showStatus(STATUS_TEXT[next] ?? 'loading');
    const waiters = docWaiters;
    docWaiters = [];
    for (const wake of waiters) wake();
  }

  /** 状态下次变化（任何方向）。定位流程靠它睡觉，消息来了才醒。 */
  function docChanged() {
    return new Promise((resolve) => { docWaiters.push(resolve); });
  }

  const withDeadline = (value, ms) => Promise.race([
    Promise.resolve(value),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

  function setHeader(sectionId) {
    const card = cardOf(sectionId);
    el.kind.textContent = '画布';
    el.num.textContent = card?.dataset.num || '';
    el.title.textContent = card?.dataset.title || sectionId;
    el.canvas.href = canvasViewHref(pageId, sectionId);
    dlg.dataset.ppSection = sectionId;
  }

  // ---- 嵌入的工作台 ----
  // 文档本身没装上（网络失败，页跨域读不了）才由这里显示「重试」。load 监听常驻：iframe 里
  // 每换一份文档（重试换 src、dev 下 full-reload、右键「重新加载框架」）都重新判定一次。
  // 跨域错误页与「装上了却没有工作台」是这里仅有的两处本页判定的失败，其余失败都由工作台主动报。
  // 文档被换掉（pagehide）就退回 loading：旧文档报过的 ready 不能替新文档作数，新文档的
  // 就绪消息会重新推进状态机。只能挂在同源的、装上了的文档上，所以每次 load 挂一次。
  function reloadFrame() {
    // 自动与手动重试共用换文档路径；预热时没有 state，也必须能恢复。
    try { delete iframe.contentWindow.__wbBootError; } catch { /* 失败页读不到 */ }
    docGen += 1;
    const section = state?.section || new URL(iframe.src).searchParams.get('section');
    setPhase('discard');
    setDocState('loading');
    iframe.src = embedCanvasSrc(pageId, section, docGen);
    if (state) wakeFrame();
    else setPhase('prewarm');
  }

  function documentFailed() {
    // 同一文档可能先报 boot-error、再触发 load，不能算两次失败。
    if (reloadTimer || docState === 'retry') return;
    if (autoReloads >= 2) {
      setDocState('retry');
      if (phase === 'warming') setPhase('park');
      return;
    }
    autoReloads += 1;
    setDocState('loading');
    const gen = docGen;
    reloadTimer = setTimeout(() => {
      reloadTimer = 0;
      if (docGen === gen) reloadFrame();
    }, 100 * autoReloads);
  }

  const onFrameLoad = () => {
    // load 要等模块脚本结束。跨域错误页（href 读不到），或文档装上了却没有工作台，
    // 都是确定失败。模块还扣着时 load 没到，不在这里判，准备态一直留着。
    // about:blank 是刚建还没导航，不是失败页。
    // 浮层没开（预热）也走自动重装；预算耗尽才记为重试。
    let href = '';
    try { href = iframe.contentWindow.location.href; } catch { href = 'dead'; }
    if (!href || href === 'about:blank') return;
    if (!workbenchOf()) {
      documentFailed();
      return;
    }
    const gen = docGen;
    try {
      iframe.contentWindow.addEventListener('pagehide', () => {
        if (gen === docGen) setDocState('loading');
      }, { once: true });
    } catch { /* 读不到就等 load 判定 */ }
  };

  function ensureFrame(sectionId) {
    if (iframe) return false;
    iframe = document.createElement('iframe');
    iframe.className = 'ov-canvas';
    iframe.title = '画布';
    docGen += 1;
    iframe.src = embedCanvasSrc(pageId, sectionId, docGen);
    iframe.addEventListener('load', onFrameLoad);
    // 没开（预热）就让关着的 dialog 照常排版、不可见，iframe 一样装进 .ov-body。
    if (!state) { holdDialog(true); setPhase('prewarm'); }
    el.body.append(iframe);
    return true;
  }

  // 打开：工作台恢复。关闭中又打开也走这里。
  function wakeFrame() {
    if (phase !== 'open') {
      setPhase('open');
      tellFrame('resume');
    }
  }

  // 关掉：dialog 进停驻态（照常排版、不可见），工作台暂停。
  function parkFrame() {
    if (!iframe) return;
    holdDialog(true);
    if (phase === 'open') {
      setPhase('park');
      tellFrame('pause');
    }
  }

  async function boardReady(nav) {
    // 就绪由消息推进，这里等到状态离开 loading；上限 READY_WAIT_MS —— 到点只开着
    // 画布不再定位（site/README.md「画布浮层」）。retry / board-error 不定位。
    const deadline = Date.now() + READY_WAIT_MS;
    for (;;) {
      if (nav !== navigation || !state) return false;
      if (docState === 'ready') return true;
      if (docState !== 'loading') return false;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await Promise.race([docChanged(), new Promise((r) => setTimeout(r, remaining))]);
    }
  }

  // 定位：节 → 帧（定位并选中）→ 钉子。
  async function land({ section, frame, ann, fresh }, nav) {
    navigation = nav;
    if (!(await boardReady(nav))) { landed(nav, ''); return; }
    if (document.activeElement === el.close) iframe.focus({ preventScroll: true });
    // 就绪记的是文档消息；文档正在被换掉的那一瞬 workbench 可能已经不在，不定位。
    const wb = workbenchOf();
    if (!wb) { landed(nav, ''); return; }
    // 一篇文章一张画布（2026-10-15）：上回在画布里开着某一页（页面浮层），这回先关掉回画布。
    if (typeof wb.pageOpen === 'function' && wb.pageOpen()) wb.closePage();
    if (!fresh && !frame && ann == null) await wb.focusSection(section);
    if (nav !== navigation) return;
    if (frame) await wb.focusFrame(section, frame, { smooth: !fresh });
    const at = frame ? `frame:${frame}` : 'section';
    if (ann == null) { landed(nav, at); return; }
    // HTML 帧的钉子在活卡片自己的客户端里；不打开页面浮层。
    const html = !!frameOf(section, frame)?.hasAttribute('data-doc-url');
    const annApi = html
      ? () => wb.whenCardAnnotateReady(frame)
      : () => frameWin()?.pinpoint || null;
    await toMark(nav, annApi, ann, at);
  }

  // 等实例就绪（卡片客户端绑定完成 / 画布实例账本第一次落定，annotate 客户端的
  // whenReady），落定后行不在就是真不在 —— 替掉 marks 轮询。到点没就绪：只开着画布，
  // 不再定位。
  async function toMark(nav, annApi, ann, fallback) {
    const api = await withDeadline(annApi(), READY_WAIT_MS);
    if (nav !== navigation || !api || typeof api.goToMark !== 'function' || typeof api.whenReady !== 'function') {
      landed(nav, fallback);
      return;
    }
    await withDeadline(api.whenReady(), READY_WAIT_MS);
    if (nav !== navigation) return;
    if (!api.marks.some((m) => m.n === ann)) { landed(nav, fallback); return; }
    const done = await api.goToMark(ann);
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
      autoReloads = 0;
      reloadFrame();
      const nav = ++navigation;
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
      // 停驻态撤掉再进 top layer（inert 的 dialog 不接焦点）。
      holdDialog(false);
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
    // 预热的暂停可能早于工作台的监听：打开前再发一次，回执只在预热中收。
    if (phase === 'warming') tellFrame('pause');
    wakeFrame();
    const nav = navigation + 1;
    // 每次打开都按当前文档状态重新核对：ready 直接走；loading 显示准备态（等待由
    // 消息推进，不需要重新「观察」）；retry / board-error 保留上次记下的失败。
    if (docState !== 'ready') showStatus(STATUS_TEXT[docState] ?? 'loading');
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
    s.release?.();
    // 停驻态先挂上再关：close 之后 dialog 不会有一帧 display:none（不排版的画布量不到几何）。
    parkFrame();
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

  // 工作台嵌入版的消息：Esc 没被画布里的某一层接住 → 关；画布换了节 → 头部和地址
  // 跟着换；就绪三条 → 文档就绪状态机（C1）。就绪消息不要求浮层开着 —— 上次没就绪
  // 就关了，这次就绪了要记住，再开不再出准备态。
  window.addEventListener('message', (e) => {
    if (!iframe || e.source !== iframe.contentWindow || e.origin !== location.origin) return;
    const msg = embedMessage(e.data);
    if (!msg) return;
    if (msg.type === 'close') { if (state) close(); return; }
    if (msg.type === 'section') { if (state) followSection(msg.section); return; }
    // 停驻回执不看代次：只在预热中收成停驻。打开之后迟到的回执不把开着的浮层改回停驻。
    if (msg.type === 'parked') { if (phase === 'warming') setPhase('park'); return; }
    if (msg.gen !== docGen) return;
    if (msg.type === 'ready' && msg.pageId && msg.pageId !== pageId) return;
    if (msg.type === 'boot-error') { documentFailed(); return; }
    // 入口已确定失败时，板的迟到消息不能取消重装或提前收起准备态。
    if (reloadTimer && msg.type === 'board-error') return;
    setDocState(overlayDocNext(docState, msg));
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
  // Esc 由弹层栈处理（layers.js，加载时已装；浮层是栈里的 'overlay' 层）。
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

  // 直接带 #canvas= 打开文章（刷新、分享的链接）。深链落点不预热，直接打开。
  const initial = parseCanvasHash(location.hash);
  if (initial && cardOf(initial.section)) {
    open(initial.section, { frame: initial.frame, ann: initial.ann, pushed: false });
  }

  // ---- 预热 ----
  // 正文和视口里的卡片先完成，再在空闲时预建。卡片完成看 data-fitted / data-failed
  // （canvas-card-client.js 摆好机壳或失败才写）：视口里还有没摆好的，就先让给它。
  // hover / focus 画布入口提前开始，不等那一轮空闲。深链打开不走这里。
  let prewarmQueued = false;
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0;
  };
  function visibleSections() {
    return cards.filter(inView).map((card) => card.dataset.ppSection);
  }
  // 正文有了标题，视口里已经开始摆的卡片都摆好了。卡片是懒加载的：还没进入视口的
  // 不挡预热（否则首屏以下的卡片永远不摆，预热也永远不开始）。一张都还没开始摆，
  // 正文就绪就算数，预热从顶栏入口的那一节起。
  function articleSettled() {
    const prose = document.querySelector('#article .prose');
    if (!prose || !prose.textContent.trim()) return false;
    const boxes = cards.filter(inView).flatMap((card) => [...card.querySelectorAll('.cc-box')]);
    const started = boxes.filter(boxStarted);
    return started.every((box) => box.dataset.fitted === '1' || box.dataset.failed === '1');
  }
  function startPrewarm() {
    if (prewarmQueued || phase !== 'absent' || state) return;
    prewarmQueued = true;
    const section = prewarmSection(ids, visibleSections(), entrySection(ids, order, currentSection()));
    if (section) ensureFrame(section);
  }
  if (!initial) {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
    // 等卡片摆好的信号，不轮询：每摆好一帧发一次 pp:canvas-card-fitted。
    const onFitted = () => {
      if (phase !== 'absent' || state) { document.removeEventListener('pp:canvas-card-fitted', onFitted); return; }
      if (!articleSettled()) return;
      document.removeEventListener('pp:canvas-card-fitted', onFitted);
      idle(() => startPrewarm());
    };
    document.addEventListener('pp:canvas-card-fitted', onFitted);
    const hurry = (e) => {
      if (e.target.closest?.(ENTRY_SELECTOR)) startPrewarm();
    };
    document.addEventListener('pointerover', hurry, true);
    document.addEventListener('focusin', hurry);
  }

  // e2e / 调试用的只读状态。
  window.pinpointOverlay = {
    state: () => (state ? { section: state.section, frame: state.frame, pushed: state.pushed, landing: lastLanding } : null),
    frame: () => iframe,
    // 生命周期：absent / warming / parked / open（E2）。settled：正文和视口里的卡片
    // 都摆好了，预热允许开始（hover 可以提前，不看它）。
    phase: () => phase,
    settled: () => articleSettled(),
  };
}
