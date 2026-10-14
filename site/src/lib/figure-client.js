// 浏览器端：正文里的图（Figure.astro）。iframe 是同源的图页（/api/frame?…&embed=figure）。
// 图页自己报高度（postMessage { source: 'pp-figure', type: 'size' | 'error' | 'ready' }），这里照着设
// iframe 高度，没有滚动条；深浅色由图页自己跟外层 <html data-theme> 走。
// 状态写在 <figure data-pp-figure> 上：data-state = loading | ready | error，出错时 data-error 是原因；
// 定过高度后 data-sized="1"。图页加载不出来（404、网络）时在图的位置写“图加载失败”。

function figureOf(source) {
  for (const iframe of document.querySelectorAll('[data-pp-figure] iframe')) {
    if (iframe.contentWindow === source) return iframe;
  }
  return null;
}

function showError(fig, message) {
  fig.dataset.state = 'error';
  fig.dataset.error = message;
}

function setHeight(iframe, height) {
  if (!(Number.isFinite(height) && height > 0)) return;
  iframe.style.height = `${Math.ceil(height)}px`;
  iframe.closest('[data-pp-figure]').dataset.sized = '1';
}

function onMessage(event) {
  if (event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== 'pp-figure') return;
  const iframe = figureOf(event.source);
  if (!iframe) return;
  const fig = iframe.closest('[data-pp-figure]');
  if (data.type === 'size') setHeight(iframe, data.height);
  else if (data.type === 'error') showError(fig, String(data.message || ''));
  else if (data.type === 'ready' && fig.dataset.state !== 'error') fig.dataset.state = 'ready';
}

/**
 * 同源，直接读一次图页：量高度、读状态。图页在本脚本跑起来之前就把消息发完了（缓存命中）时，
 * 消息已经错过，靠这里补上。→ 读到图页了没有（还是 about:blank、或不是图页时 false）。
 */
function sync(iframe) {
  let doc = null;
  try { doc = iframe.contentDocument; } catch { /* not same-origin */ }
  const root = doc?.querySelector('[data-pp-figure-root]');
  if (!root) return false;
  setHeight(iframe, root.getBoundingClientRect().height);
  const fig = iframe.closest('[data-pp-figure]');
  const html = doc.documentElement;
  if (html.dataset.figureError) showError(fig, html.dataset.figureError);
  else if (html.dataset.figureReady && fig.dataset.state !== 'error') fig.dataset.state = 'ready';
  return true;
}

function watchLoad(iframe) {
  const fig = iframe.closest('[data-pp-figure]');
  sync(iframe);
  iframe.addEventListener('load', () => {
    if (sync(iframe)) return; // 之后的变化图页自己会报
    let detail = '';
    try { detail = JSON.parse(iframe.contentDocument?.body?.textContent || '').message || ''; } catch { /* not JSON */ }
    showError(fig, `图加载失败${detail ? `：${detail}` : ''}`);
    const note = document.createElement('div');
    note.className = 'pp-fig-errors';
    note.setAttribute('role', 'alert');
    note.textContent = fig.dataset.error;
    iframe.replaceWith(note);
  });
}

export function initFigures() {
  const iframes = [...document.querySelectorAll('[data-pp-figure] iframe')];
  if (!iframes.length) return;
  window.addEventListener('message', onMessage);
  for (const iframe of iframes) watchLoad(iframe);
  // 兜底：消息和 load 都错过了的图，过一会儿再读一次。
  const late = () => {
    for (const iframe of iframes) {
      const fig = iframe.closest('[data-pp-figure]');
      if (iframe.isConnected && fig && (!fig.dataset.sized || fig.dataset.state === 'loading')) sync(iframe);
    }
  };
  for (const ms of [300, 1200, 3000]) setTimeout(late, ms);
}
