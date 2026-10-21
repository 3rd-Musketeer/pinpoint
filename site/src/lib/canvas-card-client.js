// 浏览器端：画布卡片的帧显示与未处理标注数。卡片的数据全在 [data-pp-canvas] 的 data-* 上（Canvas.astro）。
//
// 静态帧（无运行时脚本、CSS 不依赖帧视口）不建 iframe：取编译好的帧 HTML，挂进卡片里的
// shadow root；样式按 URL 共享 constructed stylesheet（Vite 的 CSS 带 ?direct 取）。留 iframe
// 的情况：帧有运行时脚本（data-preview-script / data-preview-mount 或来路不明的 <script>）、
// HTML 帧（doc 壳）、CSS 命中判据（static-card-lib.js cssHazard）；此时用取回的 HTML 填
// srcdoc iframe，不重复请求。静态挂载中途失败自动回退 iframe（原始地址）。
import {
  absolutizeAttrValue,
  absolutizeSrcset,
  classifyFrameScript,
  cssHazard,
  resolveCssImports,
  rewriteCssUrls,
  rewriteRootSelector,
  rootCompoundHazard,
} from './static-card-lib.js';
import { badgeText, docWidthKey, pendingCount, shellBox } from './canvas-card.js';
import { pageKeyFromPathname } from '../../../src/shared/annotate-page-key.js';
import { ledgerFrameRows } from '../../../src/shared/ledger-frames.js';
import { latestLedgerDocument, readLedgerDocument } from '../../../src/client/lib/ledger-reader.js';

// 帧文档是 /api/frame?…&embed=card：服务端不出图注，机壳带 data-pp-stage（phone / comp / doc），手机机身带 data-pp-device
// （src/server/lib/frame-doc.js markEmbedStage，契约在 docs/projects.md「给站点卡片的接口」）。这里只认 data-pp-stage，
// 不认工作台的 class 名。同源，iframe 的 contentDocument 可读；shadow root 直接查。
const STAGE = '[data-pp-stage]';

/** 错误页（404 / 500 的 JSON 体）里服务端写的说明；不是 JSON 就空串。 */
function errorDetail(doc) {
  try { return JSON.parse(doc.body.textContent || '').message || ''; } catch { return ''; }
}

/**
 * 量一个同源帧 iframe 里的机壳盒子。
 * → { x, y, width, height }（iframe 文档坐标，未缩放）；还没渲染出来 → null；
 * 页面不是嵌入帧页（404 / 500 的 JSON，或缺 data-pp-stage）→ { failed: true, detail }。
 */
function measureStage(iframe) {
  let doc;
  try { doc = iframe.contentDocument; } catch { return null; }
  if (!doc?.body) return null;
  const stage = doc.querySelector(STAGE);
  if (!stage) {
    if (doc.readyState !== 'complete') return null;
    let detail = errorDetail(doc);
    if (!detail && doc.documentElement.dataset.ppEmbed) detail = '帧页没有 data-pp-stage';
    return { failed: true, detail };
  }
  const r = stage.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  return { x: r.left + doc.defaultView.scrollX, y: r.top + doc.defaultView.scrollY, width: r.width, height: r.height };
}

/** 把 iframe 摆成只露出机壳 / 组件台、按 scale 缩放；外层盒子取缩放后的尺寸。 */
function placeFrame(iframe, box, m, scale) {
  iframe.style.width = `${Math.ceil(m.x + m.width)}px`;
  iframe.style.height = `${Math.ceil(m.y + m.height)}px`;
  iframe.style.transform = `scale(${scale}) translate(${-m.x}px, ${-m.y}px)`;
  box.style.width = `${Math.round(m.width * scale)}px`;
  box.style.height = `${Math.round(m.height * scale)}px`;
}

/** 一帧有了结果（摆好或失败）：浮层预热等视口里的卡片都有结果再开始（E2），预热那边自己判断够不够。
    iframe 帧和 shadow 帧走同一个信号。 */
function cardSettled(box, how) {
  box.dataset[how] = '1';
  document.dispatchEvent(new CustomEvent('pp:canvas-card-fitted'));
}

/** 预览加载失败的说明层。 */
function failNote(box, detail) {
  if (box.querySelector('.ph')) return;
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = detail ? `预览加载失败：${detail}` : '预览加载失败';
  box.appendChild(ph);
  cardSettled(box, 'failed');
}

/** 文档帧（HTML 帧）的页面没有机壳可量：加载出来的是 JSON（404 / 500）或空文档时算失败。 */
function docFrameFailed(iframe) {
  let doc;
  try { doc = iframe.contentDocument; } catch { return null; }
  if (!doc || doc.readyState !== 'complete' || doc.URL === 'about:blank') return null;
  if (/json/.test(doc.contentType || '')) return { detail: errorDetail(doc) || '文档打不开' };
  return false;
}

/** 卡片里的文档帧按页面宽度摆：iframe 的布局宽高就是那个视口（第一屏），整体按卡片缩放。 */
function placeDocFrame(fig, key) {
  const box = fig.querySelector('.cc-box.doc');
  const iframe = box && box.querySelector('iframe');
  if (!box) return;
  const view = shellBox('doc', key);
  box.style.width = `${Math.round(view.width * view.scale)}px`;
  box.style.height = `${Math.round(view.height * view.scale)}px`;
  if (iframe) {
    iframe.style.width = `${view.width}px`;
    iframe.style.height = `${view.height}px`;
    iframe.style.transform = `scale(${view.scale})`;
  }
}

/** 卡片的页面宽度（手机 / 桌面）：写在卡片的 data-doc-width 上，卡片头的切换改它。 */
function setCardDocWidth(card, key) {
  const next = docWidthKey(key);
  card.dataset.docWidth = next;
  for (const button of card.querySelectorAll('[data-pp-width] [data-width]')) {
    button.setAttribute('aria-pressed', button.dataset.width === next ? 'true' : 'false');
  }
  for (const fig of card.querySelectorAll('.cc-frame[data-shell="doc"]')) placeDocFrame(fig, next);
}

function watchDocFrame(iframe) {
  const box = iframe.parentElement;
  const check = () => {
    const failed = docFrameFailed(iframe);
    if (failed) failNote(box, failed.detail);
    else if (failed === false) cardSettled(box, 'fitted');
  };
  iframe.addEventListener('load', check);
  check();
}

/* ---- 静态卡片（shadow root） ---- */

// Vite 的 CSS 普通 fetch 会拿到 JS 模块；?direct 取回 CSS 原文（静态文件服务忽略这个参数）。
const directUrl = (url) => url + (url.includes('?') ? '&' : '?') + 'direct';

// CSS 原文按 URL 共用（97 张卡片的 kit / article.css 只取一次）。
// 只缓存原文请求：@import 展开每一趟按自己的地址链做（resolveCssImports），不共享别的趟
// 未完成的展开 —— 共享它，循环 import 的两张表会互等，卡片永远停在空壳。
const rawCssCache = new Map();
/** 非 2xx 与网络层失败都 reject，缓存条目随之清掉：一次瞬时失败（dev 重编窗口的 5xx / 404）
    不放大到全页会话的空表（r5 B3）；永久缺失的表（wb-tokens 经 SPA 回退）只是每张卡多取一次。 */
function rawCssStrict(url) {
  if (!rawCssCache.has(url)) {
    const pending = fetch(directUrl(url)).then((res) => {
      if (!res.ok) throw new Error(`CSS ${res.status}`);
      return res.text();
    });
    pending.catch(() => { if (rawCssCache.get(url) === pending) rawCssCache.delete(url); });
    rawCssCache.set(url, pending);
  }
  return rawCssCache.get(url);
}
/**
 * <link> 指向的一张表展开成 constructed stylesheet 可用的文本。null：这张表展开不出合法 CSS
 * （@import 带 layer() / supports()、循环 import），引用它的帧退回 iframe（各帧各自退回）。
 * 入口表自己取不到时按空表兑现（不回退 iframe，与 <link> 失败一致），且这条失败不进缓存。
 * @import 的子表取不到时同样按空表兑现、该趟展开作废不缓存（r4 review 建议 2）——
 * 以「缺一张子表」的展开结果按入口表 URL 缓存，会把一次瞬时失败放大到全页会话。
 * 结果按 URL 缓存给后面的卡片：每个缓存项是从这张表起的一整趟展开，里面只等原文请求
 * （rawCss），从不等别的缓存项，所以不会互等。
 */
const sheetTextCache = new Map();
/** 恢复补刷的文本捷径：已挂上、且这次 HTML 与上次相同，才留 DOM、不清样式缓存。
 *  外壳摘要写在链接上，摘要变了 HTML 就不同。点名强刷不走这里。 */
export function frameHtmlUnchanged(state, text, force) {
  return !force && !!state.settled && text === state.text;
}

/** 恢复补刷对一张静态卡的决定：HTML 未变留 DOM；变了清样式缓存并重挂。 */
export function staticCardRecovery(state, text, force) {
  return frameHtmlUnchanged(state, text, force) ? 'keep' : 'remount';
}

export function sheetText(url) {
  if (!sheetTextCache.has(url)) {
    const pending = rawCssStrict(url).then(
      (text) => cssFromText(text, url, [url], rawCssStrict).catch(() => {
        sheetTextCache.delete(url);
        return '';
      }),
      () => { sheetTextCache.delete(url); return ''; },
    );
    pending.catch(() => { if (sheetTextCache.get(url) === pending) sheetTextCache.delete(url); });
    sheetTextCache.set(url, pending);
  }
  return sheetTextCache.get(url);
}

// @import 递归展开（constructed stylesheet 不许带 @import）后，url() 按本表自己的 base 改写、
// :root 搬到 :host。被展开的文本已按自己的 base 处理过，外层再改写到绝对地址是空操作。
// 复合 :root（.x:root、:root[data-theme]）重写后不生效：整帧退回 iframe，在那里原样求值。
async function cssFromText(text, base, path, fetchText) {
  const out = await resolveCssImports(text, base, fetchText, path);
  if (out == null || rootCompoundHazard(out)) return null; // 展开不出合法 CSS：整帧退回 iframe
  return rewriteRootSelector(rewriteCssUrls(out, base));
}

// constructed stylesheet 按文本共用：同一篇卡片的帧内容相同，全部卡片只构造一份。
const sheetCache = new Map();
function sheetFor(text) {
  if (!sheetCache.has(text)) sheetCache.set(text, (async () => {
    const sheet = new CSSStyleSheet();
    await sheet.replace(text);
    return sheet;
  })());
  return sheetCache.get(text);
}

// host 的继承边界：all:initial 挡住文章页的字体 / 颜色 / color-scheme；布局由挂载时内联写。
let hostSheet = null;
function hostResetSheet() {
  if (!hostSheet) {
    hostSheet = new CSSStyleSheet();
    hostSheet.replaceSync(':host{all:initial;display:block;position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}');
  }
  return hostSheet;
}

// ios-kit 在文章页加载一次：sprite（#ios-kit-chrome）克隆进每个 shadow root，refresh(root)
// 填状态栏 / 锁屏墙纸 / 时钟。kit 在 loopback 上自注入标注客户端（injectAnnotate），只认两个退出：
// <html data-annotate="off">，或 window.__pinpoint 已在。后者只在服务端注入了正文评论客户端时才在，
// ?annotate=off 的文章页两个守卫都落空，kit 会在文章页上再起一份完整标注客户端、写进默认桶。
// data-annotate 文章页的正文评论客户端和站点脚本都不读（frame-doc 的注释：这个属性只挡 kit 自注入），
// 设上它不影响正文评论。必须在插入 kit 脚本之前设：kit 同步 boot，onload 时注入已经发生。
let kitPromise = null;
function ensureKit() {
  if (window.iOSKit) return Promise.resolve();
  if (!kitPromise) {
    document.documentElement.setAttribute('data-annotate', 'off');
    kitPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = '/kits/ios/ios-kit.js';
      el.onload = resolve;
      el.onerror = () => reject(new Error('ios-kit.js 加载失败'));
      document.head.append(el);
    });
  }
  return kitPromise;
}

// 状态栏 / 锁屏时钟：iframe 里每个帧文档各自按分钟走，shadow 里没有文档级调度，由这里
// 一分钟统一拨一次（kit 的 tick 认 data-time 与 data-clock-mode，语义不变）。
const tickRoots = new Set();
let tickTimer = null;
function ensureTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    for (const root of tickRoots) {
      if (!root.host.isConnected) { tickRoots.delete(root); continue; }
      try { window.iOSKit.tick(root); } catch { tickRoots.delete(root); }
    }
    if (!tickRoots.size) { clearInterval(tickTimer); tickTimer = null; }
  }, 60_000);
}

/** 帧文档里的运行时脚本：预览脚本 / 来路不明的脚本 → 留 iframe；ios-kit 与 frame-boot 由卡片侧接管。 */
function scriptHazard(doc) {
  if (doc.querySelector('[data-preview-mount]')) return 'preview';
  for (const s of doc.querySelectorAll('script')) {
    const kind = classifyFrameScript({
      src: s.getAttribute('src') || '',
      attrs: s.getAttributeNames().join(' '),
      text: s.textContent || '',
    });
    if (kind !== 'boot') return kind;
  }
  return null;
}

/** 回退 iframe：属性与 SSR 一致；srcdoc 用已取回的 HTML（不重复请求），否则走原始地址。 */
function fallbackFrame(host, box, { srcdoc = null, src = null, title = '' }) {
  const iframe = document.createElement('iframe');
  iframe.tabIndex = -1;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('scrolling', 'no');
  iframe.title = title;
  iframe.dataset.ccFallback = '1';
  const scale = Number(box.dataset.scale) || 1;
  iframe.style.width = `${host.dataset.ccW}px`;
  iframe.style.height = `${host.dataset.ccH}px`;
  iframe.style.transform = `scale(${scale})`;
  iframe.addEventListener('load', () => { measureFallback(iframe, box); });
  if (srcdoc != null) iframe.srcdoc = srcdoc; else iframe.src = src;
  host.replaceWith(iframe);
}

// 回退帧的尺寸直接量：load（子资源齐）→ 帧文档字体就绪 → frame-boot 跑完（有预览脚本时）
// → rAF 后量。量不出（stage 还没内容）就再量；量到了也照量 —— 带裸脚本的帧在 load 后才
// 注入内容（r5 B5，固件帧 slowinject/late.jsx），只量一次会把后长出来的部分裁在初始盒子里。
// 节奏：量一次，需要时相对推迟 300、再 1200 ms（最多三次）；每次量前还等字体与
// frame-boot，实际时点晚于旧实现的绝对 0 / 300 / 1200 ms（旧实现如此，2026-10-19 重构时只剩一次）。
const FRAME_BOOT_WAIT_MS = 3000;
const FALLBACK_MEASURE_DELAYS = [300, 1200];

/** 等 root 的 data-frame-boot="done"，到点没来就放行，按当时的尺寸量。 */
export function waitForFrameBoot(root, { timeout = FRAME_BOOT_WAIT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!root || root.dataset.frameBoot === 'done') return Promise.resolve();
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      if (root.dataset.frameBoot === 'done') { mo.disconnect(); clearTimer(timer); resolve(); }
    });
    const timer = setTimer(() => { mo.disconnect(); resolve(); }, timeout);
    mo.observe(root, { attributes: true, attributeFilter: ['data-frame-boot'] });
    if (root.dataset.frameBoot === 'done') { mo.disconnect(); clearTimer(timer); resolve(); }
  });
}

/** → 'measured'（摆好并写了 fitted）、'failed'（错误页，确定的，不重测）、'pending'（还量不出）。 */
async function measureFallbackOnce(iframe, box, scale) {
  try { await iframe.contentDocument?.fonts?.ready; } catch { /* 字体集合不可达也照量 */ }
  const root = iframe.contentDocument?.documentElement;
  if (root && root.dataset.frameBoot !== 'done'
    && iframe.contentDocument.querySelector('script[data-preview-script], [data-preview-mount]')) {
    await waitForFrameBoot(root);
  }
  const m = measureStage(iframe);
  if (!m) return 'pending';
  if (m.failed) { failNote(box, m.detail); return 'failed'; }
  placeFrame(iframe, box, m, scale);
  cardSettled(box, 'fitted');
  return 'measured';
}

function measureFallback(iframe, box) {
  const scale = Number(box.dataset.scale) || 1;
  let i = 0;
  const run = () => {
    measureFallbackOnce(iframe, box, scale).then((outcome) => {
      if (outcome === 'failed' || i >= FALLBACK_MEASURE_DELAYS.length) return;
      setTimeout(run, FALLBACK_MEASURE_DELAYS[i]);
      i += 1;
    });
  };
  run();
}

/** 量 shadow 里的机壳：host 先取消缩放，机壳相对 host 的偏移即 iframe 文档坐标里的 x/y。 */
function placeHost(host, box, stage) {
  const scale = Number(box.dataset.scale) || 1;
  host.style.transform = 'none';
  const a = stage.getBoundingClientRect();
  const b = host.getBoundingClientRect();
  if (!(a.width > 0 && a.height > 0)) throw new Error('机壳还没渲染出来');
  const x = a.left - b.left;
  const y = a.top - b.top;
  host.style.width = `${Math.ceil(x + a.width)}px`;
  host.style.height = `${Math.ceil(y + a.height)}px`;
  host.style.transform = `scale(${scale}) translate(${-x}px, ${-y}px)`;
  box.style.width = `${Math.round(a.width * scale)}px`;
  box.style.height = `${Math.round(a.height * scale)}px`;
}

async function mountShadow(host, box, doc, base, sheets) {
  doc.querySelectorAll('script, base, title, meta').forEach((el) => el.remove());
  // 相对资源（图片 / srcset / poster / SVG image）按帧页的 base 绝对化；#c-chev 这类
  // 纯 fragment 的 sprite 引用不动（必须留在本树解析）。
  for (const el of doc.querySelectorAll('[src], [poster], [srcset], image[href], image[xlink\\:href]')) {
    for (const attr of ['src', 'poster', 'href', 'xlink:href']) {
      if (el.hasAttribute(attr)) el.setAttribute(attr, absolutizeAttrValue(el.getAttribute(attr), base));
    }
    if (el.hasAttribute('srcset')) el.setAttribute('srcset', absolutizeSrcset(el.getAttribute('srcset'), base));
  }
  // 缩略帧不接焦点、不进无障碍树、不可选字（iframe 是 tabindex -1 + aria-hidden；shadow 里的按钮
  // 和链接属于文章页，不设 inert 就能被 Tab 到）。点击由卡片的 .cc-hit 接收。
  host.inert = true;
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [hostResetSheet(), ...sheets];
  const htmlEl = doc.documentElement;
  // iframe 文档根的 UA 默认字形与继承边界；color-scheme 钉 light（iframe 不跟文章页主题）。
  htmlEl.style.cssText = 'font:16px "Times New Roman";color:black;color-scheme:light';
  host.style.background = box.classList.contains('natural') ? 'transparent' : '#fff';
  // 先摆出 iframe 的起始视口（SSR 盒子的未缩放尺寸），再按机壳量准。
  host.style.width = `${host.dataset.ccW}px`;
  host.style.height = `${host.dataset.ccH}px`;
  root.append(htmlEl);
  await ensureKit();
  const chrome = document.getElementById('ios-kit-chrome');
  if (!chrome) throw new Error('ios-kit chrome 未注入');
  root.prepend(chrome.cloneNode(true));
  window.iOSKit.refresh(root);
  // 液态玻璃滤镜按 id 引用，跨不过 shadow 边界：用到它的帧把滤镜克隆进自己的 root。
  if (root.querySelector('.ios-glass--liquid')) {
    const filter = window.iOSKit.ensureLiquidGlassFilter();
    if (filter) root.prepend(filter.parentElement.cloneNode(true));
  }
  tickRoots.add(root);
  ensureTicker();
  await document.fonts.ready;
  const stage = root.querySelector(STAGE);
  if (!stage) throw new Error('帧页没有 data-pp-stage');
  placeHost(host, box, stage);
  cardSettled(box, 'fitted');
  host.dataset.ccMounted = '1';
}

async function mountCard(host, text, url) {
  const box = host.parentElement;
  const title = host.dataset.ccTitle || '';
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const base = new URL(doc.querySelector('base')?.getAttribute('href') || url, url).href;
  if (scriptHazard(doc)) return fallbackFrame(host, box, { srcdoc: text, title });
  const sheets = [];
  const variable = [];
  try {
    for (const el of doc.querySelectorAll('style, link[rel=stylesheet]')) {
      const cssText = el.tagName === 'LINK'
        ? await sheetText(new URL(el.getAttribute('href'), base).href)
        : await cssFromText(el.textContent, base, [], rawCssStrict);
      if (cssText == null) return fallbackFrame(host, box, { srcdoc: text, title }); // 展开不出合法 CSS
      sheets.push(sheetFor(cssText));
      if (el.closest('body')) variable.push(cssText); // 判据只扫帧自带的样式（head 是帧页固定 boilerplate）
      el.remove();
    }
  } catch {
    return fallbackFrame(host, box, { srcdoc: text, title }); // CSS 取不回：iframe 自己取
  }
  if (variable.map(cssHazard).find(Boolean)) return fallbackFrame(host, box, { srcdoc: text, title });
  try {
    await mountShadow(host, box, doc, base, await Promise.all(sheets));
  } catch (error) {
    console.error('[canvas-card] 静态挂载失败，回退 iframe', error);
    fallbackFrame(host, box, { src: url, title });
  }
}

// 与 iframe 的 loading="lazy" 同义：接近视口才装；一次 6 个（r3 原型的节奏）。
// 不用 IntersectionObserver：.cc-strip 横向 overflow 会裁掉后面的帧，IO 按裁剪算就永远不装，
// 而 Chrome 的懒加载 iframe 不看中间滚动容器的裁剪（a6d8d98 基线实测：被裁的帧照样加载）。
// 这里按 boundingClientRect（忽略裁剪）判断距离，与懒加载 iframe 的实际行为对齐。
function initStaticCards() {
  const states = [...document.querySelectorAll('.cc-shadow[data-cc-src], [data-pp-canvas] .cc-box.doc iframe')].map(host => ({
    host, template: host.cloneNode(true), fig: host.closest('.cc-frame'), box: host.parentElement,
    doc: host.tagName === 'IFRAME',
    running: false, settled: false, dirty: false, force: false, etag: '', text: '',
  }));
  if (!states.length) return;
  let active = 0;
  const pending = [];
  const replace = (state) => {
    if (!state.doc) {
      if (state.host.shadowRoot) tickRoots.delete(state.host.shadowRoot);
      state.host = state.template.cloneNode(true);
      state.box.replaceChildren(state.host);
    }
    state.host.dataset.ccStarted = '1';
    state.box.querySelector('.ph')?.remove();
    delete state.box.dataset.fitted;
    delete state.box.dataset.failed;
  };
  const refresh = async (state, force) => {
    const doc = state.doc ? state.host.contentDocument : null;
    const url = state.doc ? doc.URL : new URL(state.template.dataset.ccSrc, location.href).href;
    // 原生 HTML 的校验值必须来自实际导航，而不是在 load 后另取一份可能更新的源码。
    const timing = state.doc && state.host.contentWindow.performance.getEntriesByType('navigation')[0];
    const validator = state.doc ? timing?.serverTiming?.find(row => row.name === 'pp-etag') : null;
    const etag = state.doc ? (validator ? decodeURIComponent(validator.description) : '') : state.etag;
    const res = await fetch(url, { cache: 'no-store', headers: !force && etag ? { 'If-None-Match': etag } : {} });
    if (res.status === 304) return; // 不拆 DOM，也不失效样式缓存。
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (state.doc) {
      // 非 pinpoint 响应若没有导航校验值，比较真实文档；内容相同仍不重载。
      if (!force && !etag && new DOMParser().parseFromString(text, 'text/html').documentElement.isEqualNode(doc.documentElement)) return;
      replace(state);
      await new Promise(resolve => {
        state.host.addEventListener('load', resolve, { once: true });
        state.host.contentWindow.location.reload();
      });
    } else {
      if (staticCardRecovery(state, text, force) === 'keep') { state.etag = res.headers.get('ETag') || ''; return; }
      state.invalidateCss?.();
      if (state.settled) replace(state);
      await mountCard(state.host, text, url);
      state.etag = res.headers.get('ETag') || '';
      state.text = text;
    }
  };
  const pump = () => {
    while (active < 6 && pending.length) {
      const state = pending.shift();
      active++;
      state.dirty = false; // 入队后收到的信号由这次检查覆盖；开始后的新信号才需再检查。
      const force = state.force;
      state.force = false;
      refresh(state, force).catch(error => {
        if (!state.settled) failNote(state.box, error.message);
        else console.warn('[canvas-card] 保留当前卡片，更新检查失败', error);
      }).finally(() => {
        active--;
        state.running = false;
        state.settled = true;
        // 在飞时的完成信号只记一笔，当前挂载结束后再取；旧响应不能盖住后继代。
        if (state.dirty) check();
        pump();
      });
    }
  };
  const MARGIN = 8000; // 与 Chromium 懒加载 iframe 的最大距离一致，仍忽略中间容器的裁剪。
  const check = () => {
    for (const state of states) {
      const host = state.host;
      if (state.running || (host.dataset.ccStarted && !state.dirty) || !state.fig.isConnected) continue;
      const r = state.fig.getBoundingClientRect();
      if (r.bottom >= -MARGIN && r.top <= innerHeight + MARGIN && r.right >= -MARGIN && r.left <= innerWidth + MARGIN) {
        host.dataset.ccStarted = '1';
        state.running = true; // 包含已入队但尚未开始的卡片，避免重复入队。
        state.dirty = false;
        pending.push(state);
      }
    }
    pump();
  };
  let scheduled = false;
  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; check(); });
  };
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  addEventListener('resize', onScroll);
  document.addEventListener('pp:preview-update', ({ detail }) => {
    let cleared = false;
    const invalidateCss = () => {
      if (cleared) return;
      cleared = true;
      rawCssCache.clear();
      sheetTextCache.clear();
    };
    for (const state of states) {
      if (state.fig.closest('[data-page]')?.dataset.page !== detail.id
        || (detail.screens && !detail.screens.includes(state.fig.dataset.screen))) continue;
      state.invalidateCss = invalidateCss;
      // 点名的编译完成仍强刷（包括 HTML 字节没变的外链 CSS）；恢复补刷才走条件请求。
      if (state.running || state.settled) {
        state.force ||= !!detail.screens;
        state.dirty = true;
      }
      // 尚未加载的卡片不提前请求，首取自然满足新的输入代次。
    }
    check();
  });
  for (const state of states.filter(state => state.doc)) {
    // 初次加载仍交给浏览器原生 lazy；空白且尚未加载的 iframe 不因通知提前取帧。
    state.host.dataset.ccStarted = '1';
    state.settled = !!state.host.contentDocument && state.host.contentDocument.URL !== 'about:blank'
      && state.host.contentDocument.readyState === 'complete';
    state.host.addEventListener('load', () => { state.settled = true; });
  }
  check();
}

// 标注数：这一节画布上待验收的标注（open / check / done，canvas-card.js pendingCount）。读该桶的画布账本（只读接口），
// 按本节的帧筛；拿不到（静态构建、桶未登记）就不显示。注入的正文评论客户端也读这本账本、经 SSE 跟着改动，
// 它每拿到一版就发 pp:canvas-ledger（detail.doc），这里照着重算，不用再请求。
function paintBadges(list, page, doc) {
  for (const card of list) {
    const badge = card.querySelector('[data-pp-badge]');
    if (!badge) continue;
    const n = doc ? pendingCount(doc, page, (card.dataset.frames || '').split(' ').filter(Boolean)) : 0;
    badge.hidden = !(n > 0);
    badge.textContent = badgeText(n);
    badge.title = n > 0 ? `这一节画布上待验收的标注 ${n} 条` : '';
  }
}

function byPage(cards) {
  const map = new Map();
  for (const card of cards) {
    const page = card.dataset.page;
    if (!page) continue;
    if (!map.has(page)) map.set(page, []);
    map.get(page).push(card);
  }
  return map;
}

// HTML 帧（一篇文章一张画布，2026-10-15）：那一页的标注在它自己的账本里（src/shared/annotate-page-key.js
// pageKeyFromPathname），一起读进来、记到那一帧上，卡片头的数含它们。
export async function refreshBadges(cards, refresh = false) {
  await Promise.all([...byPage(cards)].map(async ([page, list]) => {
    const aliases = new Map();
    for (const fig of list.flatMap((card) => [...card.querySelectorAll('.cc-frame[data-doc-url]')])) {
      const key = pageKeyFromPathname(fig.dataset.docUrl);
      if (!aliases.has(key)) aliases.set(key, { url: fig.dataset.docUrl, ids: [] });
      aliases.get(key).ids.push(fig.dataset.screen);
    }
    const pages = [...aliases.values()];
    const names = ['@canvas', ...pages.map((p) => pageKeyFromPathname(p.url))];
    await Promise.all(names.map((name) => readLedgerDocument('', page, name, refresh).catch(() => null)));
    // 批次只负责等读取完成。某本先解析后还可能收到 SSE，绘制必须同步合并此刻的最新状态。
    const [doc, ...docs] = names.map((name) => latestLedgerDocument('', page, name));
    if (!doc && !docs.some(Boolean)) { paintBadges(list, page, null); return; }
    const annotations = [...((doc && doc.annotations) || []), ...docs.flatMap((d, i) => ledgerFrameRows(d, pages[i].ids))];
    paintBadges(list, page, { annotations });
  }));
}

export function initCanvasCards() {
  const cards = [...document.querySelectorAll('[data-pp-canvas]')];
  if (!cards.length) return;
  for (const iframe of document.querySelectorAll('[data-pp-canvas] .cc-box.doc iframe')) watchDocFrame(iframe);
  initStaticCards();
  for (const card of cards) {
    const seg = card.querySelector('[data-pp-width]');
    if (!seg) continue;
    seg.addEventListener('click', (e) => {
      const button = e.target.closest?.('[data-width]');
      if (button) setCardDocWidth(card, button.dataset.width);
    });
  }
  refreshBadges(cards);
  // 从画布页回来、画布浮层关上时重读一次（那边可能刚标过、处理完标注）。
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadges(cards, true); });
  document.addEventListener('pp:canvas-overlay-closed', () => refreshBadges(cards, true));
  document.addEventListener('pp:canvas-ledger', (e) => {
    const { entry, doc } = e.detail || {};
    const list = byPage(cards).get(entry);
    if (list && doc) paintBadges(list, entry, doc);
  });
}
