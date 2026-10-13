// 浏览器端：画布卡片的帧尺寸与未处理标注数。卡片的数据全在 [data-pp-canvas] 的 data-* 上（Canvas.astro）。
import { canvasLedgerUrl, openCount } from './canvas-card.js';

// /api/frame 的页面里带着自己的图注（.wb-screen-cap），卡片外面已经有一份，进 iframe 后藏掉，
// 再量机壳 / 组件台的盒子：iframe 只露出这一块。手机缩到固定宽（data-fit-width），其他机壳按 data-scale 用自己的盒子。
// 同源，contentDocument 可读。
const STAGE = '.ios-stage, .wb-comp-stage, .wb-doc-stage';

function fitFrame(iframe) {
  const box = iframe.parentElement;
  const measure = () => {
    let doc;
    try { doc = iframe.contentDocument; } catch { return; }
    if (!doc?.body) return;
    if (!doc.getElementById('pp-card-style')) {
      const style = doc.createElement('style');
      style.id = 'pp-card-style';
      style.textContent = '.wb-screen > .wb-screen-cap { display:none !important; }';
      doc.head.appendChild(style);
    }
    const stage = doc.querySelector(STAGE);
    if (!stage) {
      // 端点答的不是帧页（404 / 500 的 JSON）：盖一层说明，不去量错误文本。
      if (!doc.querySelector('.wb-screen') && !box.querySelector('.ph')) {
        let detail = '';
        try { detail = JSON.parse(doc.body.textContent || '').message || ''; } catch { /* not JSON */ }
        const ph = document.createElement('div');
        ph.className = 'ph';
        ph.textContent = detail ? `预览加载失败：${detail}` : '预览加载失败';
        box.appendChild(ph);
        box.dataset.failed = '1';
      }
      return;
    }
    const r = stage.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const scale = Number(box.dataset.fitWidth) ? Number(box.dataset.fitWidth) / r.width : Number(box.dataset.scale) || 1;
    const x = r.left + doc.defaultView.scrollX;
    const y = r.top + doc.defaultView.scrollY;
    iframe.style.width = `${Math.ceil(x + r.width)}px`;
    iframe.style.height = `${Math.ceil(y + r.height)}px`;
    iframe.style.transform = `scale(${scale}) translate(${-x}px, ${-y}px)`;
    box.style.width = `${Math.round(r.width * scale)}px`;
    box.style.height = `${Math.round(r.height * scale)}px`;
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
  refreshBadges(cards);
  // 从画布页回来时重读一次（那边可能刚处理完标注）。
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadges(cards); });
}
