// 浏览器端：深浅色切换、目录高亮、[[ ]] popup、概念抽屉。数据全在 .cref 的 data-* 上（refs.js refHtml）。

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
      + `<a class="go" href="${esc(d.href)}">概念页 →</a>`;
  }
  return `<div class="k">${name}<span class="st">空 ref</span></div><div>还没有页。先在正文里用起来，边界清楚了再补页。</div>`
    + (d.project ? `<div class="used">在 project ${esc(d.project)} 里找不到“${esc(d.name)}”</div>` : '');
}

export function initSite() {
  const root = document.documentElement;

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

  let pop = null;
  const closePop = () => { pop?.remove(); pop = null; };
  const openPop = (el) => {
    closePop();
    pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = popHtml(el);
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect();
    pop.style.left = `${Math.max(12, Math.min(innerWidth - 312, r.left + scrollX))}px`;
    pop.style.top = `${r.bottom + scrollY + 8}px`;
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('.cref');
    if (!el) { if (pop && !e.target.closest('.pop')) closePop(); return; }
    // 修饰键点击照常打开链接；普通点击先看 popup。
    if (el.tagName === 'A' && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return;
    e.preventDefault();
    openPop(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePop();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('cref') && e.target.tagName !== 'A') { e.preventDefault(); openPop(e.target); }
  });

  const drawer = document.getElementById('drawer');
  const btn = document.getElementById('btn-concepts');
  btn?.addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
    btn.setAttribute('aria-expanded', String(!drawer.hidden));
  });
}
