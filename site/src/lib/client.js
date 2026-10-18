// 浏览器端：深浅色切换、目录高亮、[[ ]] popup、wiki 面板。数据全在 .cref 的 data-* 上（refs.js refHtml）。

import { installLayerKeys, layers } from './layers.js';
import { installOverlayScrollbars } from '../../../src/client/overlay-scrollbar.js';
import {
  placeWikiPanel, WIKI_CLOSE_MS, WIKI_EASE, WIKI_OPEN_MS, WIKI_OPEN_Y,
  WIKI_PANEL_GAP, WIKI_PANEL_MAX_H, WIKI_PANEL_MAX_VH, WIKI_REDUCED_MS,
} from './wiki-panel.js';

// [[ ]] popup 的时序（site/README.md「[[ ]] 引用」）：悬停 120 ms 打开，指针移进 popup 不关，离开两者 200 ms 后关。
export const POP_OPEN_MS = 120;
export const POP_CLOSE_MS = 200;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function popHtml(el) {
  const d = el.dataset;
  const name = esc(el.textContent);
  if (d.kind === 'article') {
    return `<div class="k">${esc(d.title || d.name)}<span class="st">文章</span></div>`
      + (d.summary ? `<div>${esc(d.summary)}</div>` : '<div class="used">没有摘要</div>')
      + `<a class="go" href="${esc(d.href)}">读全文 →</a>`;
  }
  if (d.kind === 'concept') {
    let used = [];
    try { used = JSON.parse(d.used || '[]'); } catch { /* keep empty */ }
    const usedHtml = used.length
      ? used.map((a) => `<a href="${esc(a.href)}">${esc(a.title)}</a>`).join('、')
      : '还没有文章引用';
    return `<div class="k">${esc(d.name)}<span class="st${d.fixed ? ' ok' : ''}">${esc(d.status || '占位')}</span></div>`
      + (d.def ? `<div>${esc(d.def)}</div>` : '<div class="used">还没有定义</div>')
      + `<div class="used">用到它的文章：${usedHtml}</div>`
      + `<a class="go" href="${esc(d.href)}">wiki 词条 →</a>`;
  }
  return `<div class="k">${name}<span class="st">空 ref</span></div><div>还没有页。先在正文里用起来，边界清楚了再补页。</div>`
    + (d.project ? `<div class="used">在 project ${esc(d.project)} 里找不到“${esc(d.name)}”</div>` : '');
}

export function initSite() {
  const root = document.documentElement;
  installOverlayScrollbars(document);

  document.getElementById('btn-theme')?.addEventListener('click', () => {
    const cur = root.getAttribute('data-theme');
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('pp-site-theme', next); } catch { /* per-viewer convenience only */ }
  });

  const links = [...document.querySelectorAll('#toc a')];
  if (links.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        for (const a of links) a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`);
      }
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('section.sec').forEach((s) => io.observe(s));
  }

  initRefPopups();
  initWikiPanel();
}

// wiki 面板：从 wiki 按钮右下角展开，接入弹层栈（Esc 只关最上层）。
// 静态列表仍是 Base.astro 里的 #drawer；头（标题 + 关闭按钮）在这里补，好让没有脚本时也不多一个关不掉的按钮。
function initWikiPanel() {
  const drawer = document.getElementById('drawer');
  const btn = document.getElementById('btn-wiki');
  if (!drawer || !btn) return;

  const head = document.createElement('div');
  head.className = 'drawer-head';
  head.innerHTML = '<h2 class="drawer-title">wiki</h2>'
    + '<button class="btn drawer-x" type="button" data-drawer-close aria-label="关闭 wiki">×</button>';
  drawer.prepend(head);
  // 面板在 DOM 里排在正文之后，从顶栏按钮按 Tab 到不了它。插到按钮后面，Tab 顺序才是入口 → 面板。
  btn.after(drawer);
  const closer = head.querySelector('[data-drawer-close]');

  let release = null;
  let playing = null;
  let closing = false;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const place = () => {
    const a = btn.getBoundingClientRect();
    const r = drawer.getBoundingClientRect();
    const topBar = document.querySelector('.top')?.getBoundingClientRect().bottom ?? a.bottom;
    const p = placeWikiPanel({
      anchor: { left: a.left, right: a.right, top: a.top, bottom: a.bottom, width: a.width },
      panelW: r.width, panelH: drawer.offsetHeight,
      viewportW: innerWidth, viewportH: innerHeight,
      maxH: Math.min(WIKI_PANEL_MAX_H, innerHeight * WIKI_PANEL_MAX_VH),
      // 面板顶至少在顶栏下沿：窄屏按钮换行时，按钮下 8px 仍可能压住同一行的关闭入口。
      minTop: topBar + WIKI_PANEL_GAP,
    });
    drawer.style.left = `${p.left}px`;
    drawer.style.top = `${p.top}px`;
    drawer.style.maxHeight = `${p.maxHeight}px`;
  };

  // 从当前呈现值走到目标。途中再点，取消进行中的动画，新动画从这一帧的值接着走，不从 0 重播。
  const presented = () => {
    const cs = getComputedStyle(drawer);
    return { opacity: cs.opacity, transform: `translateY(${new DOMMatrix(cs.transform).m42 || 0}px)` };
  };
  const play = (to, ms) => {
    const from = playing ? presented() : null;
    playing?.cancel();
    const fade = reduced();
    const end = { opacity: to ? 1 : 0, transform: fade ? 'none' : (to ? 'translateY(0px)' : `translateY(${WIKI_OPEN_Y}px)`) };
    const start = from && !fade
      ? from
      : { opacity: to ? 0 : 1, transform: fade ? 'none' : `translateY(${to ? WIKI_OPEN_Y : 0}px)` };
    playing = drawer.animate([start, end], { duration: fade ? WIKI_REDUCED_MS : ms, easing: WIKI_EASE, fill: 'both' });
    return playing.finished.catch(() => {});
  };

  const finishClose = () => {
    if (!closing) return;
    closing = false;
    release?.();
    release = null;
    drawer.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    playing = null;
    // 关闭后焦点一律回入口。点外部关闭时，这次点击已经把焦点带走了，也要拉回来。
    btn.focus();
  };

  const close = () => {
    if (drawer.hidden || closing) return;
    closing = true;
    const anim = play(false, WIKI_CLOSE_MS);
    // 动画被反向打断时 finished 拒绝；重新打开已经把 closing 清掉，这里不能再藏。
    anim.then(finishClose);
  };

  const open = () => {
    if (!drawer.hidden && !closing) return;
    const reversing = closing;
    closing = false;
    // 上次关闭的动画已经播完、fill: both 停在 opacity 0。不先清掉，面板在打开动画开始前接不到焦点。
    // 正在关闭的动画要留着：play 从它的当前呈现值接着走。
    if (!reversing) { playing?.cancel(); playing = null; }
    drawer.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    place();
    if (!release) release = layers.push('wiki', close);
    play(true, WIKI_OPEN_MS);
  };

  btn.addEventListener('click', () => { if (btn.getAttribute('aria-expanded') === 'true' && !closing) close(); else open(); });
  closer.addEventListener('click', close);
  document.addEventListener('pointerdown', (e) => {
    if (drawer.hidden) return;
    if (e.target === btn || btn.contains(e.target) || drawer.contains(e.target)) return;
    close();
  });
  window.addEventListener('resize', () => { if (!drawer.hidden) place(); });
  // Tab 进面板、再从末尾回到按钮：面板不是 dialog，浏览器不会自己困住焦点。
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || drawer.hidden) return;
    const items = [...drawer.querySelectorAll('a[href], button')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); btn.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); btn.focus(); }
  });
}

// [[ ]] popup：悬停或键盘聚焦打开；有目标页的 ref（article / concept）点击就去那一页，空 ref 点击打开 popup；
// 触屏没有悬停，点一下先开 popup（popup 里有去那一页的链接）。同时只有一个 popup，Esc 关闭（只关它，见 layers.js）。
function initRefPopups() {
  let pop = null;
  let owner = null;
  let openTimer = 0;
  let closeTimer = 0;
  let lastPointer = '';
  const clearTimers = () => { clearTimeout(openTimer); clearTimeout(closeTimer); openTimer = 0; closeTimer = 0; };

  let release = null;
  const closePop = () => {
    clearTimers();
    release?.();
    release = null;
    owner?.removeAttribute('aria-describedby');
    pop?.remove();
    pop = null;
    owner = null;
  };
  const openPop = (el) => {
    clearTimers();
    if (owner === el && pop) return;
    closePop();
    pop = document.createElement('div');
    pop.className = 'pop';
    pop.id = 'pp-ref-pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = popHtml(el);
    pop.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    pop.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') scheduleClose(); });
    // 挂在 body 上（不进 #article）：正文评论客户端监听 #article 的 DOM 变动，挂进去每次悬停都会整篇重画。
    document.body.appendChild(pop);
    release = layers.push('popup', closePop);
    owner = el;
    el.setAttribute('aria-describedby', pop.id);
    const r = el.getBoundingClientRect();
    pop.style.left = `${Math.max(12, Math.min(innerWidth - 312, r.left + scrollX))}px`;
    pop.style.top = `${r.bottom + scrollY + 8}px`;
  };
  const scheduleOpen = (el) => {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    openTimer = setTimeout(() => openPop(el), POP_OPEN_MS);
  };
  const scheduleClose = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closePop, POP_CLOSE_MS);
  };

  const crefOf = (t) => t?.closest?.('.cref') || null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = crefOf(e.target);
    if (!el || (el === owner && pop)) { if (el) clearTimeout(closeTimer); return; }
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    scheduleOpen(el);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const el = crefOf(e.target);
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    if (pop && e.relatedTarget && pop.contains(e.relatedTarget)) return;
    if (el === owner || openTimer) scheduleClose();
  });
  // 键盘聚焦（Tab）打开，焦点离开关闭；鼠标点击带来的聚焦不算。
  document.addEventListener('focusin', (e) => {
    const el = crefOf(e.target);
    if (el && el.matches(':focus-visible')) openPop(el);
  });
  document.addEventListener('focusout', (e) => {
    if (crefOf(e.target) && crefOf(e.target) === owner && !(pop && pop.contains(e.relatedTarget))) scheduleClose();
  });
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
  document.addEventListener('keydown', () => { lastPointer = ''; }, true);

  document.addEventListener('click', (e) => {
    const el = crefOf(e.target);
    if (!el) { if (pop && !e.target.closest?.('.pop')) closePop(); return; }
    const hasTarget = el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#';
    // 修饰键点击照常交给浏览器（新标签页）。
    if (hasTarget && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return;
    // 有目标页：鼠标 / 键盘点击就去；触屏第一下先开 popup，同一个 ref 再点一下才去。
    if (hasTarget && !(lastPointer === 'touch' && owner !== el)) { closePop(); return; }
    e.preventDefault();
    openPop(el);
  });
  // Esc 由弹层栈处理（layers.js）：popup 在最上面时只关它，并 preventDefault。
  installLayerKeys();
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && el.classList?.contains('cref') && el.tagName !== 'A') { e.preventDefault(); openPop(el); }
  });
}
