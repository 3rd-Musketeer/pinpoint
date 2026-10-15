// 浏览器端：深浅色切换、目录高亮、[[ ]] popup、wiki 抽屉。数据全在 .cref 的 data-* 上（refs.js refHtml）。

import { installLayerKeys, layers } from './layers.js';
import { installOverlayScrollbars } from '../../../src/client/overlay-scrollbar.js';

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

  const drawer = document.getElementById('drawer');
  const btn = document.getElementById('btn-wiki');
  btn?.addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
    btn.setAttribute('aria-expanded', String(!drawer.hidden));
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
