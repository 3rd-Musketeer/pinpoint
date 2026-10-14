// 浏览器端：正文里的图（Figure.astro）。iframe 是同源的图页（/api/frame?…&embed=figure）。
// 图页自己报高度（postMessage { source: 'pp-figure', type: 'size' | 'error' | 'ready' }），这里照着设
// iframe 高度，没有滚动条；深浅色由图页自己跟外层 <html data-theme> 走。
// 状态写在 <figure data-pp-figure> 上：data-state = loading | ready | error，出错时 data-error 是原因。
// 图页加载不出来（404、网络）时在图的位置写“图加载失败”。

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

function onMessage(event) {
  if (event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== 'pp-figure') return;
  const iframe = figureOf(event.source);
  if (!iframe) return;
  const fig = iframe.closest('[data-pp-figure]');
  if (data.type === 'size' && Number.isFinite(data.height) && data.height > 0) {
    iframe.style.height = `${Math.ceil(data.height)}px`;
    fig.dataset.sized = '1';
  } else if (data.type === 'error') {
    showError(fig, String(data.message || ''));
  } else if (data.type === 'ready' && fig.dataset.state !== 'error') {
    fig.dataset.state = 'ready';
  }
}

/** 同源，直接量一次图的高度：图页在本脚本跑起来之前就报过高度时（缓存命中），消息已经错过了。 */
function measure(iframe) {
  let root = null;
  try { root = iframe.contentDocument?.querySelector('[data-pp-figure-root]'); } catch { /* not same-origin */ }
  const height = root ? Math.ceil(root.getBoundingClientRect().height) : 0;
  if (height > 0) {
    iframe.style.height = `${height}px`;
    iframe.closest('[data-pp-figure]').dataset.sized = '1';
  }
  return root;
}

function watchLoad(iframe) {
  const fig = iframe.closest('[data-pp-figure]');
  const settle = () => {
    const doc = iframe.contentDocument;
    if (doc?.documentElement.dataset.figureError) showError(fig, doc.documentElement.dataset.figureError);
    else if (doc?.documentElement.dataset.figureReady && fig.dataset.state !== 'error') fig.dataset.state = 'ready';
  };
  try { if (iframe.contentDocument?.readyState === 'complete' && measure(iframe)) settle(); } catch { /* not same-origin */ }
  iframe.addEventListener('load', () => {
    let doc = null;
    try { doc = iframe.contentDocument; } catch { /* not same-origin */ }
    if (doc && measure(iframe)) { settle(); return; } // 之后的变化图页自己会报
    let detail = '';
    try { detail = JSON.parse(doc?.body?.textContent || '').message || ''; } catch { /* not JSON */ }
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
}
