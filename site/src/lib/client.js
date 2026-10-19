// 浏览器端：深浅色切换、目录高亮、[[ ]] popup、wiki 面板。数据全在 .cref 的 data-* 上（refs.js refHtml）。

import { autoUpdate, computePosition, offset, shift } from '@floating-ui/dom';
import { layers } from './layers.js';
import { installOverlayScrollbars } from '../../../src/client/overlay-scrollbar.js';
import { escHtml as esc } from '../../../src/shared/esc-html.js';
import {
  placeWikiPanel, WIKI_CLOSE_MS, WIKI_EASE, WIKI_OPEN_MS, WIKI_OPEN_Y,
  WIKI_PANEL_GAP, WIKI_PANEL_MAX_H, WIKI_PANEL_MAX_VH, WIKI_REDUCED_MS,
} from './wiki-panel.js';
import { TOC_EASE, TOC_JUMP_GAP, TOC_OPEN_MS, TOC_OPEN_Y, TOC_REDUCED_MS, tocJumpScroll } from './toc-jump.js';

// [[ ]] popup 的时序（site/README.md「[[ ]] 引用」）：悬停 120 ms 打开，指针移进 popup 不关，离开两者 200 ms 后关。
const POP_OPEN_MS = 120;
export const POP_CLOSE_MS = 200;

// 目录入口的“当前节”显示。initTocEntry 装上，观察者每次换节时调。
let updateTocEntry = () => {};

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
  const sections = [...document.querySelectorAll('section.sec')];
  const markCurrent = (id) => {
    for (const a of links) a.classList.toggle('on', a.getAttribute('href') === `#${id}`);
    updateTocEntry();
  };
  // 观察带是视口中段（上 30% 到下 60%）。页顶时第一节还在带下面，带里没有任何节，
  // 观察者不会回调，当前节就停在跳走前的那一节。带空时取视口里最靠上的那一节。
  const inBand = new Set();
  const topmostVisible = () => {
    for (const s of sections) {
      if (s.getBoundingClientRect().bottom > 0) return s.id;
    }
    return null;
  };
  const syncFromScroll = () => {
    if (inBand.size && scrollY > 0) return;
    const id = topmostVisible();
    if (id) markCurrent(id);
  };
  if (links.length && sections.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (e.isIntersecting) { inBand.add(e.target); markCurrent(e.target.id); }
        else inBand.delete(e.target);
      }
      if (!inBand.size) syncFromScroll();
    }, { rootMargin: '-30% 0px -60% 0px' });
    sections.forEach((s) => io.observe(s));
    document.addEventListener('scroll', syncFromScroll, { passive: true });
    // scrollTo 不一定发 scroll 事件（已经在 0 时再滚到 0）。观察者的回调是异步的，等它先记带。
    requestAnimationFrame(() => requestAnimationFrame(syncFromScroll));
  }

  initRefPopups();
  initWikiPanel();
  initTocEntry(markCurrent);
}

// 窄屏目录入口：目录栏隐藏时（≤1180px），正文顶上一条单行“目录 n / N 标题”，
// 点开把现有的 #toc 当 popover 用，不另做一份目录。点一节滚到标题，落在顶栏和这条入口下面。
function initTocEntry(markCurrent) {
  const entry = document.querySelector('[data-toc-entry]');
  const nav = document.querySelector('[data-toc-nav]');
  const toggle = document.querySelector('[data-toc-toggle]');
  if (!entry || !nav || !toggle) return;
  const links = [...nav.querySelectorAll('#toc a')];
  if (!links.length) return;

  const collapsed = () => getComputedStyle(nav).display === 'none';
  const pos = entry.querySelector('[data-toc-pos]');
  const title = entry.querySelector('[data-toc-current]');

  const sync = () => {
    entry.hidden = !collapsed();
    if (entry.hidden && nav.classList.contains('toc-pop')) close();
    const current = links.find((a) => a.classList.contains('on')) || links[0];
    const n = links.indexOf(current) + 1;
    const nextPos = `${n} / ${links.length}`;
    const nextTitle = [...current.childNodes].filter((nd) => nd.nodeType === Node.TEXT_NODE).map((nd) => nd.textContent).join('').trim();
    // 文字没变不赋值：赋值会换掉文本节点，正文评论的观察器见到就重画，选区被清空。
    if (pos.textContent !== nextPos) pos.textContent = nextPos;
    if (title.textContent !== nextTitle) title.textContent = nextTitle;
  };
  updateTocEntry = sync;

  let release = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const play = (show) => {
    const fade = reduced();
    nav.getAnimations().forEach((a) => a.cancel());
    nav.animate(
      [
        { opacity: show ? 0 : 1, transform: fade ? 'none' : `translateY(${show ? TOC_OPEN_Y : 0}px)` },
        { opacity: show ? 1 : 0, transform: fade ? 'none' : `translateY(${show ? 0 : TOC_OPEN_Y}px)` },
      ],
      { duration: fade ? TOC_REDUCED_MS : TOC_OPEN_MS, easing: TOC_EASE, fill: 'both' },
    );
  };
  // 关闭动画 fill:both 会把 opacity 0 留在 nav 上。切回宽屏时目录栏复用同一个 nav，不取消就一直透明。
  const settle = () => {
    nav.getAnimations().forEach((a) => a.cancel());
    nav.style.left = '';
    nav.style.top = '';
  };
  const close = () => {
    if (!nav.classList.contains('toc-pop')) return;
    play(false);
    nav.classList.remove('toc-pop');
    settle();
    toggle.setAttribute('aria-expanded', 'false');
    release?.();
    release = null;
    if (document.activeElement && nav.contains(document.activeElement)) toggle.focus();
  };
  const open = () => {
    nav.classList.add('toc-pop');
    const r = entry.getBoundingClientRect();
    nav.style.left = `${Math.max(12, r.left)}px`;
    nav.style.top = `${r.bottom + 4}px`;
    toggle.setAttribute('aria-expanded', 'true');
    play(true);
    release = layers.push('toc', close);
    (links.find((a) => a.classList.contains('on')) || links[0]).focus();
  };

  toggle.addEventListener('click', () => { if (toggle.getAttribute('aria-expanded') === 'true') close(); else open(); });
  document.addEventListener('pointerdown', (e) => {
    if (!nav.classList.contains('toc-pop')) return;
    if (entry.contains(e.target) || nav.contains(e.target)) return;
    close();
  });
  // 点一节滚到标题，落在粘住的顶栏和这条入口下面。先收 popover 再量：开着时调同步会把入口隐掉，高度量成 0。
  // 滚完后的版面还会动（滚动条、评论栏），最多再补两帧。
  const jumpTo = (id) => {
    const sec = document.getElementById(id);
    if (!sec) return;
    const head = sec.querySelector('h2, h3') || sec;
    close();
    const stuckNow = () => document.querySelector('.top').getBoundingClientRect().bottom
      + (entry.hidden ? 0 : entry.getBoundingClientRect().height);
    document.documentElement.scrollTop = tocJumpScroll(scrollY + head.getBoundingClientRect().top, stuckNow());
    markCurrent(id);
    // 滚完后滚动条和评论栏还会改版面，最多再补两帧。
    let left = 2;
    const correct = () => {
      const delta = head.getBoundingClientRect().top - stuckNow() - TOC_JUMP_GAP;
      if (Math.abs(delta) > 1) document.documentElement.scrollTop += delta;
      if (--left > 0) requestAnimationFrame(correct);
    };
    requestAnimationFrame(correct);
    history.replaceState(null, '', `#${id}`);
  };
  nav.addEventListener('click', (e) => {
    const a = e.target.closest?.('#toc a');
    if (!a || !nav.classList.contains('toc-pop')) return;
    const id = a.getAttribute('href').slice(1);
    if (!document.getElementById(id)) return;
    e.preventDefault();
    jumpTo(id);
  });
  matchMedia('(max-width:1180px)').addEventListener('change', sync);
  sync();
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
  let stopFollow = null;
  const closePop = () => {
    clearTimers();
    stopFollow?.();
    stopFollow = null;
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
    // 定位（@floating-ui/dom，2026-10-19 C4）：bottom-start 贴引用左下、间距 8px，
    // 水平向视口收 12px 边距（同旧的 clamp(left, 12, vw-300-12)，popup 宽 300）。
    // 打开期间 autoUpdate 跟随引用（缩窗口、滚动容器、引用自身尺寸变化），closePop 停掉。
    const node = pop;
    stopFollow = autoUpdate(el, node, () => computePosition(el, node, {
      strategy: 'absolute',
      placement: 'bottom-start',
      middleware: [offset(8), shift({ padding: 12 })],
    }).then(({ x, y }) => {
      if (!node.isConnected) return;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
    }));
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
  // Esc 由弹层栈处理（layers.js，加载时已装）：popup 在最上面时只关它，并 preventDefault。
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && el.classList?.contains('cref') && el.tagName !== 'A') { e.preventDefault(); openPop(el); }
  });
}
