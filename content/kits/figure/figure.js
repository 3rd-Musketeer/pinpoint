/**
 * pinpoint/figure：正文里的图（<Figure>）用的小工具，不依赖任何库（docs/projects.md“图”）。
 *
 * 两处都能 import：
 * - 图的 figures/<id>.jsx（编译期，算排版）：textWidth；
 * - 图的 sidecar figures/<id>.js（浏览器里）：steps，以及 textWidth。
 * 写法一样：`import { steps } from 'pinpoint/figure'`。编译器把它指到本文件，图页的 import map
 * 把它指到 /kits/figure/figure.js。模块顶层不碰 DOM：编译期在 Node 里求值。
 */

/** CJK 文字、全角标点按 1 个字号宽，其余字符按 0.58 个字号宽。SVG 里给文字留框、居中时用。 */
export function textWidth(text, fontSize = 13) {
  let em = 0;
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0);
    const wide = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0x3000 && code <= 0x303f);
    em += wide ? 1 : 0.58;
  }
  return Math.ceil(em * fontSize);
}

const LABELS = { prev: '上一步', next: '下一步', play: '播放', pause: '暂停', all: (n) => `共 ${n} 步`, hint: '点“播放”或“下一步”，一步一步看。' };

/**
 * 逐步演示：图里的元素写 data-step="n"（从 1 数，同一步可以有多个元素），这一步的说明写在其中一个
 * 元素的 data-note 上。steps(root) 在 root 末尾加一排控件（上一步 / 播放 / 下一步 / 步数）和说明行。
 *
 * - 第 0 步是全貌：全部元素照常显示。第 n 步时 root 带 class fig-stepping，每个 [data-step] 元素带
 *   is-past / is-now / is-future；figure.css 让还没到的隐藏、走过的变淡，is-now 的样子由图自己写。
 * - 这一步里带 data-travel 的 line / path / polyline：一个圆点沿它走一趟（WAAPI）。圆点用 root 里的
 *   [data-step-dot]，没有就在那张 svg 里补一个强调色的圆。
 * - 系统开了减少动态效果：不走圆点，不自动播放。
 * - options：autoplay（毫秒或 true；滚到眼前时从第 1 步自动播一遍）、interval（播放时每步停多久，缺省
 *   2000 ms）、labels（换控件和全貌提示上的字：prev、next、play、pause、all(n)、hint）。
 * - root.dataset.step 是当前步（0 是全貌），测试和截图读它。
 * 返回 unmount（sidecar 的 mount 直接 return 它）。
 */
export function steps(root, options = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const labels = { ...LABELS, ...(options.labels || {}) };
  const items = [...root.querySelectorAll('[data-step]')]
    .map((el) => ({ el, n: Number.parseInt(el.getAttribute('data-step'), 10) }))
    .filter((item) => Number.isInteger(item.n) && item.n > 0);
  const total = items.reduce((max, item) => Math.max(max, item.n), 0);
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const interval = Number(options.interval) || 2000;
  const autoplay = options.autoplay === true ? interval : Number(options.autoplay) || 0;

  const bar = doc.createElement('div');
  bar.className = 'fig-steps';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', '逐步演示');
  const button = (act, text) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.act = act;
    b.textContent = text;
    bar.append(b);
    return b;
  };
  const prevBtn = button('prev', labels.prev);
  const playBtn = button('play', labels.play);
  const nextBtn = button('next', labels.next);
  const count = doc.createElement('span');
  count.className = 'fig-count';
  bar.append(count);
  const note = doc.createElement('div');
  note.className = 'fig-note';
  note.setAttribute('aria-live', 'polite');
  root.append(bar, note);

  let current = 0;
  let timer = 0;
  let anim = null;
  let dot = null;

  const dotFor = (travel) => {
    if (dot && dot.isConnected) return dot;
    dot = root.querySelector('[data-step-dot]');
    if (!dot) {
      const svg = travel.ownerSVGElement;
      if (!svg) return null;
      dot = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '5');
      dot.setAttribute('fill', 'var(--fig-accent)');
      dot.setAttribute('data-step-dot', '');
      svg.append(dot);
    }
    dot.style.opacity = '0';
    return dot;
  };

  const travelAlong = (n) => {
    anim?.cancel();
    anim = null;
    if (reduce || n < 1) return;
    const travel = items.find((item) => item.n === n && item.el.matches('[data-travel]'))?.el
      || items.filter((item) => item.n === n).map((item) => item.el.querySelector('[data-travel]')).find(Boolean);
    if (!travel || typeof travel.getTotalLength !== 'function') return;
    const d = dotFor(travel);
    if (!d) return;
    const length = travel.getTotalLength();
    const frames = [];
    for (let k = 0; k <= 12; k++) {
      const p = travel.getPointAtLength((length * k) / 12);
      // transform 而不是 cx：Safari 不支持把 cx 当动画属性。圆本身画在原点。
      frames.push({ transform: `translate(${p.x}px, ${p.y}px)`, opacity: 1, offset: (k / 12) * 0.85 });
    }
    frames.push({ ...frames[frames.length - 1], opacity: 0, offset: 1 });
    d.removeAttribute('cx');
    d.removeAttribute('cy');
    anim = d.animate(frames, { duration: 750, easing: 'ease-in-out', fill: 'forwards' });
  };

  const show = (n) => {
    current = Math.max(0, Math.min(total, n));
    root.dataset.step = String(current);
    root.classList.toggle('fig-stepping', current > 0);
    for (const { el, n: k } of items) {
      el.classList.toggle('is-past', current > 0 && k < current);
      el.classList.toggle('is-now', current > 0 && k === current);
      el.classList.toggle('is-future', current > 0 && k > current);
    }
    count.textContent = current > 0 ? `${current} / ${total}` : labels.all(total);
    const noted = items.find((item) => item.n === current && item.el.hasAttribute('data-note'));
    note.textContent = current === 0 ? labels.hint : noted ? noted.el.getAttribute('data-note') : '';
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= total;
    travelAlong(current);
  };

  const stop = () => {
    win.clearInterval(timer);
    timer = 0;
    playBtn.textContent = labels.play;
    root.dataset.playing = '';
  };
  const play = (every = interval) => {
    stop();
    if (current >= total) show(0);
    playBtn.textContent = labels.pause;
    root.dataset.playing = '1';
    show(current + 1);
    timer = win.setInterval(() => (current >= total ? stop() : show(current + 1)), every);
  };

  const onClick = (event) => {
    const act = event.target.closest?.('button')?.dataset.act;
    if (!act) return;
    if (act === 'play') {
      if (timer) stop();
      else play();
      return;
    }
    stop();
    show(act === 'next' ? current + 1 : current - 1);
  };
  const onKey = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    stop();
    show(current + (event.key === 'ArrowRight' ? 1 : -1));
  };
  bar.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  show(0);

  let io = null;
  if (autoplay && !reduce && total && 'IntersectionObserver' in win) {
    io = new win.IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      io = null;
      if (current === 0 && !timer) play(autoplay);
    }, { threshold: 0.6 });
    io.observe(root);
  }

  return () => {
    stop();
    io?.disconnect();
    anim?.cancel();
    bar.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    bar.remove();
    note.remove();
  };
}
