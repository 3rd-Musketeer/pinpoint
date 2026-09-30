// Local, bounded metadata only. No annotation text, HTML, URLs, or remote upload.
const KEY = 'pinpoint-canvas-diagnostics-v1';
const LIMIT = 720;
export function startCanvasDiagnostics(stage, pageId) {
  let previous = null;
  try { previous = JSON.parse(sessionStorage.getItem(KEY))?.current || null; } catch {}
  const current = { started: new Date().toISOString(), userAgent: navigator.userAgent, events: [] };
  let lastActivity = 0, lastFrame = 0, lastSample = 0, maxGap = 0, raf = 0, persistTimer = 0;
  let input = 'unknown', space = false;
  const removers = [];
  const session = crypto.randomUUID();
  let pending = [], uploadTimer = 0, uploading = false, stopped = false;
  function scheduleUpload() {
    if (!uploadTimer && !stopped) uploadTimer = setTimeout(flush, 2000);
  }
  async function flush() {
    uploadTimer = 0;
    if (uploading || !pending.length) return;
    uploading = true;
    const batch = pending.splice(0, 24);
    try {
      const response = await fetch('/api/canvas-diagnostics', {method:'POST',
        headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(5000), keepalive:true,
        body:JSON.stringify({session,started:current.started,events:batch})});
      if (!response.ok) throw new Error('diagnostics unavailable');
    } catch { pending = [...batch, ...pending].slice(-120); }
    finally { uploading = false; if (pending.length) scheduleUpload(); }
  }
  function finalUpload() {
    if (!pending.length) return;
    const batch = pending.slice(-24);
    const accepted = navigator.sendBeacon('/api/canvas-diagnostics', new Blob([
      JSON.stringify({session,started:current.started,events:batch})
    ],{type:'application/json'}));
    if (accepted) pending = [];
  }
  function persist() {
    clearTimeout(persistTimer); persistTimer = 0;
    try { sessionStorage.setItem(KEY, JSON.stringify({previous, current})); } catch {}
  }
  function record(type, data = {}) {
    const event = {at:Date.now(), ms: Math.round(performance.now()), type, ...data};
    current.events.push(event);
    pending.push(event);
    if (pending.length > 120) pending.splice(0,pending.length-120);
    scheduleUpload();
    if (current.events.length > LIMIT) current.events.splice(0, current.events.length - LIMIT);
    if (!persistTimer) persistTimer = setTimeout(() => { persistTimer = 0; if (!raf) persist(); }, 2000);
  }
  function geometry(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return {rect: [r.x,r.y,r.width,r.height].map(Math.round), display:s.display,
      visibility:s.visibility, opacity:s.opacity, transform:s.transform,
      contentVisibility:s.contentVisibility, contain:s.contain};
  }
  // 长帧归因：Chrome 的 long-animation-frame（带脚本归属）与 longtask。只留计数 / 毫秒 / 脚本文件名，
  // 不带 URL 查询、不带页面内容。不支持的浏览器静默跳过。
  let frames = 0, loaf = 0, loafMax = 0, loafBlock = 0, loafScript = '', longTasks = 0, longTaskMax = 0;
  function scriptName(url) { return String(url || '').split('?')[0].split('/').pop().slice(0, 60); }
  function observe(type, onEntry) {
    try {
      const po = new PerformanceObserver(list => list.getEntries().forEach(onEntry));
      po.observe({type, buffered:false});
      removers.push(() => po.disconnect());
    } catch {}
  }
  observe('long-animation-frame', e => {
    loaf++; loafBlock += e.blockingDuration || 0;
    if (e.duration > loafMax) {
      loafMax = e.duration;
      const top = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
      loafScript = top ? scriptName(top.sourceURL) + ':' + String(top.invoker || top.entryType || '').slice(0, 40) : 'no-script';
    }
  });
  observe('longtask', e => { longTasks++; if (e.duration > longTaskMax) longTaskMax = e.duration; });
  function sample() {
    const ann = window.pinpoint?.perfDrain?.() || {n:0, sum:0, max:0, full:0};
    const wrap = stage.querySelector('.wb-zoom-wrap');
    record('viewport', {page:pageId(), input, scroll:[stage.scrollLeft,stage.scrollTop],
      extent:[stage.scrollWidth,stage.scrollHeight], viewport:[stage.clientWidth,stage.clientHeight],
      dpr:devicePixelRatio, maxFrameGap:Math.round(maxGap), hidden:document.hidden,
      wrap:geometry(wrap), panel:geometry(document.getElementById('wb-board-panel')),
      frames, loaf, loafMax:Math.round(loafMax), loafBlock:Math.round(loafBlock), loafScript,
      longTasks, longTaskMax:Math.round(longTaskMax),
      annN:ann.n, annSum:Math.round(ann.sum), annMax:Math.round(ann.max), annFull:ann.full,
      zoom:Number(document.documentElement.getAttribute('data-canvas-zoom')) || 1,
      marks:window.pinpoint?.marks?.length ?? 0});
    maxGap = 0; frames = 0; loaf = 0; loafMax = 0; loafBlock = 0; loafScript = ''; longTasks = 0; longTaskMax = 0;
  }
  function tick(now) {
    frames++;
    if (lastFrame) maxGap = Math.max(maxGap, now-lastFrame);
    lastFrame = now;
    if (now-lastSample >= 250) { sample(); lastSample = now; }
    if (now-lastActivity < 500) raf = requestAnimationFrame(tick);
    else { raf = 0; lastFrame = 0; sample(); persist(); }
  }
  function activity() {
    lastActivity = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function listen(target, name, fn) {
    target.addEventListener(name,fn,{passive:true});
    removers.push(()=>target.removeEventListener(name,fn));
  }
  listen(stage,'wheel',e=>{input=e.ctrlKey?'wheel-zoom':'wheel';activity();});
  listen(stage,'pointerdown',e=>{input=e.button===1?'middle':space?'space':'pointer';activity();});
  listen(document,'keydown',e=>{if(e.code==='Space'&&!e.target.closest?.('input,textarea,[contenteditable]')){space=true;input='space';}});
  listen(document,'keyup',e=>{if(e.code==='Space')space=false;});
  listen(window,'blur',()=>{space=false;});
  listen(stage,'scroll',activity);
  listen(window,'resize',()=>{record('resize');activity();});
  listen(document,'visibilitychange',()=>{record('visibility',{hidden:document.hidden});persist();});
  // Error text may contain user content. Keep only the error category and count.
  listen(window,'error',e=>record('error',{name:e.error?.name||'Error',line:e.lineno,column:e.colno}));
  listen(window,'unhandledrejection',()=>record('unhandledrejection'));
  listen(window,'pagehide',()=>{persist();finalUpload();});
  record('start'); activity();
  const api = {
    snapshot() { sample(); persist(); return JSON.parse(JSON.stringify({version:1,previous,current})); },
    download() {
      record('incident');
      const url=URL.createObjectURL(new Blob([JSON.stringify(api.snapshot(),null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`pinpoint-diagnostics-${Date.now()}.json`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    },
    stop() {stopped=true;clearTimeout(uploadTimer);cancelAnimationFrame(raf);removers.forEach(fn=>fn());persist();finalUpload();}
  };
  return api;
}
