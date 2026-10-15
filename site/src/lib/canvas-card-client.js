// 浏览器端：画布卡片的帧尺寸与未处理标注数。卡片的数据全在 [data-pp-canvas] 的 data-* 上（Canvas.astro）。
import { badgeText, canvasLedgerUrl, docWidthKey, pageLedgerName, pageLedgerUrl, pendingCount, shellBox } from './canvas-card.js';
import { ledgerFrameRows } from '../../../src/shared/ledger-frames.js';

// 帧 iframe 是 /api/frame?…&embed=card：服务端不出图注，机壳带 data-pp-stage（phone / comp / doc），手机机身带 data-pp-device
// （src/server/lib/frame-doc.js markEmbedStage，契约在 docs/projects.md「给站点卡片的接口」）。这里只认 data-pp-stage，
// 不认工作台的 class 名。同源，contentDocument 可读。
const STAGE = '[data-pp-stage]';

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
    let detail = '';
    try { detail = JSON.parse(doc.body.textContent || '').message || ''; } catch { /* not JSON */ }
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

/** 预览加载失败的说明层。 */
function failNote(box, detail) {
  if (box.querySelector('.ph')) return;
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = detail ? `预览加载失败：${detail}` : '预览加载失败';
  box.appendChild(ph);
  box.dataset.failed = '1';
}

/** 文档帧（HTML 帧）的页面没有机壳可量：加载出来的是 JSON（404 / 500）或空文档时算失败。 */
function docFrameFailed(iframe) {
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

async function readJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) return await res.json();
  } catch { /* no service behind this page */ }
  return null;
}

// HTML 帧（一篇文章一张画布，2026-10-15）：那一页的标注在它自己的账本里（canvas-card.js pageLedgerName），
// 一起读进来、记到那一帧上，卡片头的数含它们。
async function refreshBadges(cards) {
  await Promise.all([...byPage(cards)].map(async ([page, list]) => {
    const aliases = new Map();
    for (const fig of list.flatMap((card) => [...card.querySelectorAll('.cc-frame[data-doc-url]')])) {
      const key = pageLedgerName(fig.dataset.docUrl);
      if (!aliases.has(key)) aliases.set(key, { url: fig.dataset.docUrl, ids: [] });
      aliases.get(key).ids.push(fig.dataset.screen);
    }
    const pages = [...aliases.values()];
    const [doc, ...docs] = await Promise.all([readJson(canvasLedgerUrl(page)), ...pages.map((p) => readJson(pageLedgerUrl(page, p.url)))]);
    if (!doc && !docs.some(Boolean)) { paintBadges(list, page, null); return; }
    const annotations = [...((doc && doc.annotations) || []), ...docs.flatMap((d, i) => ledgerFrameRows(d, pages[i].ids))];
    paintBadges(list, page, { annotations });
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
  // 从画布页回来、画布浮层关上时重读一次（那边可能刚标过、处理完标注）。
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadges(cards); });
  document.addEventListener('pp:canvas-overlay-closed', () => refreshBadges(cards));
  document.addEventListener('pp:canvas-ledger', (e) => {
    const { entry, doc } = e.detail || {};
    const list = byPage(cards).get(entry);
    if (list && doc) paintBadges(list, entry, doc);
  });
}
