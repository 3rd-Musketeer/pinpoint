// 浏览器端：画布卡片的帧尺寸与未处理标注数。卡片的数据全在 [data-pp-canvas] 的 data-* 上（Canvas.astro）。
import { canvasLedgerUrl, docWidthKey, openCount, shellBox } from './canvas-card.js';

// 帧 iframe 是 /api/frame?…&embed=card：服务端不出图注，机壳带 data-pp-stage（phone / comp / doc），手机机身带 data-pp-device
// （src/server/lib/frame-doc.js markEmbedStage，契约在 docs/projects.md「给站点卡片的接口」）。这里只认这两个属性，
// 不认工作台的 class 名。同源，contentDocument 可读。
const STAGE = '[data-pp-stage]';
const DEVICE = '[data-pp-device]';

/**
 * 量一个同源帧 iframe 里的机壳盒子（卡片和画布浮层共用）。
 * → { x, y, width, height, radius, stage }（iframe 文档坐标，未缩放）；还没渲染出来 → null；
 * 页面不是嵌入帧页（404 / 500 的 JSON，或缺 data-pp-stage）→ { failed: true, detail }。
 * `device: true`（浮层用）：手机帧量机身而不是带留白的机壳，radius 是机身圆角；同时在帧里给机身
 * 加同样圆角的 clip-path：帧里带 backdrop-filter 的导航栏在缩放后的 iframe 里会越出机身圆角（Chromium），
 * 机身自己是 overflow:visible，外层盒子的 overflow / clip-path 都裁不住它。
 */
export function measureStage(iframe, { device = false } = {}) {
  let doc;
  try { doc = iframe.contentDocument; } catch { return null; }
  if (!doc?.body) return null;
  const stage = doc.querySelector(STAGE);
  if (!stage) {
    if (doc.readyState !== 'complete') return null;
    let detail = '';
    try { detail = JSON.parse(doc.body.textContent || '').message || ''; } catch { /* not JSON */ }
    if (!detail && doc.documentElement.dataset.ppEmbed) detail = '帧页没有 data-pp-stage';
    return { failed: true, detail };
  }
  const body = (device && stage.dataset.ppStage === 'phone' && stage.querySelector(DEVICE)) || stage;
  const r = body.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  let radius = 0;
  if (body !== stage) {
    radius = parseFloat(doc.defaultView.getComputedStyle(body).borderTopLeftRadius) || 0;
    if (radius && !body.style.clipPath) body.style.clipPath = `inset(0 round ${radius}px)`;
  }
  return { x: r.left + doc.defaultView.scrollX, y: r.top + doc.defaultView.scrollY, width: r.width, height: r.height, radius, stage: body };
}

/** 把 iframe 摆成只露出机壳 / 组件台、按 scale 缩放；外层盒子取缩放后的尺寸。 */
export function placeFrame(iframe, box, m, scale) {
  iframe.style.width = `${Math.ceil(m.x + m.width)}px`;
  iframe.style.height = `${Math.ceil(m.y + m.height)}px`;
  iframe.style.transform = `scale(${scale}) translate(${-m.x}px, ${-m.y}px)`;
  box.style.width = `${Math.round(m.width * scale)}px`;
  box.style.height = `${Math.round(m.height * scale)}px`;
}

/** 预览加载失败的说明层（卡片与浮层同一句）。 */
export function failNote(box, detail) {
  if (box.querySelector('.ph')) return;
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = detail ? `预览加载失败：${detail}` : '预览加载失败';
  box.appendChild(ph);
  box.dataset.failed = '1';
}

/** 文档帧（HTML 帧）的页面没有机壳可量：加载出来的是 JSON（404 / 500）或空文档时算失败。 */
export function docFrameFailed(iframe) {
  let doc;
  try { doc = iframe.contentDocument; } catch { return null; }
  if (!doc || doc.readyState !== 'complete' || doc.URL === 'about:blank') return null;
  if (/json/.test(doc.contentType || '')) {
    let detail = '';
    try { detail = JSON.parse(doc.body.textContent || '').message || ''; } catch { /* not JSON */ }
    return { detail: detail || '文档打不开' };
  }
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

/**
 * 卡片的页面宽度（手机 / 桌面）：写在卡片的 data-doc-width 上，卡片头的切换和画布浮层都改它。
 * 改完通知浮层（事件 pp:doc-width），浮层开着这一节时跟着换。
 */
export function setCardDocWidth(card, key) {
  const next = docWidthKey(key);
  card.dataset.docWidth = next;
  for (const button of card.querySelectorAll('[data-pp-width] [data-width]')) {
    button.setAttribute('aria-pressed', button.dataset.width === next ? 'true' : 'false');
  }
  for (const fig of card.querySelectorAll('.cc-frame[data-shell="doc"]')) placeDocFrame(fig, next);
  card.dispatchEvent(new CustomEvent('pp:doc-width', { bubbles: true, detail: { width: next } }));
}

function watchDocFrame(iframe) {
  const box = iframe.parentElement;
  const check = () => {
    const failed = docFrameFailed(iframe);
    if (failed) failNote(box, failed.detail);
    else if (failed === false) box.dataset.fitted = '1';
  };
  iframe.addEventListener('load', check);
  check();
}

function fitFrame(iframe) {
  const box = iframe.parentElement;
  if (box.classList.contains('doc')) {
    watchDocFrame(iframe);
    return;
  }
  const measure = () => {
    const m = measureStage(iframe);
    if (!m) return;
    if (m.failed) { failNote(box, m.detail); return; }
    // 一张卡片里所有帧同一个缩放（canvas-card.js CARD_SCALE）：组件帧按自己的盒子 × 这个缩放，和手机帧可比。
    const scale = Number(box.dataset.scale) || 1;
    placeFrame(iframe, box, m, scale);
    box.dataset.fitted = '1';
  };
  const onLoad = () => { measure(); setTimeout(measure, 300); setTimeout(measure, 1200); };
  iframe.addEventListener('load', onLoad);
  // Already loaded before the script ran (cached frame).
  try { if (iframe.contentDocument?.readyState === 'complete' && iframe.contentDocument.body?.childElementCount) onLoad(); } catch { /* cross-origin: keep fixed box */ }
}

// 未处理标注数：读该桶的画布账本（只读接口），按本节的帧筛。拿不到（静态构建、桶未登记）就不显示。
async function refreshBadges(cards) {
  const byPage = new Map();
  for (const card of cards) {
    const page = card.dataset.page;
    if (!page) continue;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(card);
  }
  await Promise.all([...byPage].map(async ([page, list]) => {
    let doc = null;
    try {
      const res = await fetch(canvasLedgerUrl(page), { headers: { accept: 'application/json' } });
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) doc = await res.json();
    } catch { /* no service behind this page */ }
    for (const card of list) {
      const badge = card.querySelector('[data-pp-badge]');
      if (!badge) continue;
      const n = doc ? openCount(doc, page, (card.dataset.frames || '').split(' ').filter(Boolean)) : 0;
      badge.hidden = !(n > 0);
      badge.textContent = n > 0 ? `${n} 条未处理标注` : '';
    }
  }));
}

export function initCanvasCards() {
  const cards = [...document.querySelectorAll('[data-pp-canvas]')];
  if (!cards.length) return;
  for (const iframe of document.querySelectorAll('[data-pp-canvas] iframe')) fitFrame(iframe);
  for (const card of cards) {
    const seg = card.querySelector('[data-pp-width]');
    if (!seg) continue;
    seg.addEventListener('click', (e) => {
      const button = e.target.closest?.('[data-width]');
      if (button) setCardDocWidth(card, button.dataset.width);
    });
  }
  refreshBadges(cards);
  // 从画布页回来时重读一次（那边可能刚处理完标注）。
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadges(cards); });
}
