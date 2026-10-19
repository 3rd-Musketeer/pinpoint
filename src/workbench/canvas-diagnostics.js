// Local, bounded metadata only. No annotation text, HTML, URLs, or remote upload.
import { registerEmbedPark } from './embed-park.js';

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
  // 停驻（E2）：采样、长帧观察、活动监听和上传都停。已经排上的那一次照常送，
  // 剩下没送出的等恢复后再送。
  let paused = false;
  const parked = [];
  function scheduleUpload() {
    if (!uploadTimer && !stopped && !paused) uploadTimer = setTimeout(flush, 2000);
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
  let loaf = 0, loafMax = 0, loafScript = '', longTasks = 0;
  function scriptName(url) { return String(url || '').split('?')[0].split('/').pop().slice(0, 60); }
  function observe(type, onEntry, options) {
    try {
      const po = new PerformanceObserver(list => { if (!paused) list.getEntries().forEach(onEntry); });
      const opts = options || {type, buffered:false};
      po.observe(opts);
      removers.push(() => po.disconnect());
      parked.push({ stop: () => po.disconnect(), start: () => { try { po.observe(opts); } catch {} } });
    } catch {}
  }
  const recentLoaf = []; // 最近的长帧，给慢输入找同一时段的脚本归属
  observe('long-animation-frame', e => {
    recentLoaf.push(e);
    if (recentLoaf.length > 24) recentLoaf.shift();
    loaf++;
    if (e.duration > loafMax) {
      loafMax = e.duration;
      const top = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
      loafScript = top ? scriptName(top.sourceURL) + ':' + String(top.invoker || top.entryType || '').slice(0, 40) : 'no-script';
    }
  });
  observe('longtask', () => { longTasks++; });
  // 画布浮层是文章页里的 iframe，和文章页、正文帧卡片共用一个主线程：输入排队常常是被外面的长帧挡住的。
  // 同源时也看顶层窗口的长帧，归属里带上 top: 前缀。
  try {
    if (window.top !== window && window.top.PerformanceObserver) {
      const topPo = new window.top.PerformanceObserver(list => list.getEntries().forEach(e => {
        recentLoaf.push({ outer: true, startTime: e.startTime + (window.top.performance.timeOrigin - performance.timeOrigin), duration: e.duration,
          renderStart: e.renderStart ? e.renderStart + (window.top.performance.timeOrigin - performance.timeOrigin) : 0, scripts: e.scripts || [] });
        if (recentLoaf.length > 24) recentLoaf.shift();
      }));
      const topOpts = {type:'long-animation-frame', buffered:false};
      topPo.observe(topOpts);
      removers.push(() => topPo.disconnect());
      parked.push({ stop: () => topPo.disconnect(), start: () => { try { topPo.observe(topOpts); } catch {} } });
    }
  } catch {}
  // 慢输入（owner 2026-10-19：“在画布上标注的时候输入法输入简直卡爆了”）：按键、输入法组字、input 事件
  // 从发生到画出来超过 INPUT_LAG_MS 就记一条：分成排队（inputDelay）、处理（processing）、出帧（presentation），
  // 带同一时段长帧里最耗时的三段脚本（文件:函数:毫秒，含强制样式布局）。不记按键内容和目标文字。
  const INPUT_LAG_MS = 50;
  const INPUT_EVENTS = new Set(['keydown','keyup','keypress','beforeinput','input','compositionstart','compositionupdate','compositionend']);
  let lagBudget = 0, lagWindow = 0;
  function overlappingScripts(start, end) {
    const scripts = [];
    let render = 0;
    for (const f of recentLoaf) {
      if (f.startTime > end || f.startTime + f.duration < start) continue;
      if (f.renderStart) render = Math.max(render, f.startTime + f.duration - f.renderStart);
      for (const sc of f.scripts || []) scripts.push(f.outer ? { outer: true, sourceURL: sc.sourceURL, sourceFunctionName: sc.sourceFunctionName, invoker: sc.invoker, duration: sc.duration, forcedStyleAndLayoutDuration: sc.forcedStyleAndLayoutDuration } : sc);
      if (f.outer && !(f.scripts || []).length) scripts.push({ outer: true, sourceURL: 'no-script', invoker: 'render', duration: f.duration, forcedStyleAndLayoutDuration: 0 });
    }
    scripts.sort((a, b) => b.duration - a.duration);
    const top = scripts.slice(0, 3).map(sc => [(sc.outer ? 'top:' : '') + scriptName(sc.sourceURL), String(sc.sourceFunctionName || sc.invoker || '').slice(0, 40),
      Math.round(sc.duration), Math.round(sc.forcedStyleAndLayoutDuration || 0)].join(':')).join(' | ');
    return {scripts: top.slice(0, 240), render: Math.round(render)};
  }
  try {
    const po = new PerformanceObserver(list => list.getEntries().forEach(e => {
      if (!INPUT_EVENTS.has(e.name) || e.duration < INPUT_LAG_MS) return;
      const now = performance.now();
      if (now - lagWindow > 1000) { lagWindow = now; lagBudget = 0; }
      if (++lagBudget > 6) return; // 每秒最多记 6 条
      const t = e.target;
      const where = !t ? 'gone' : t.closest?.('#ann-box') ? 'composer' : t.closest?.('[data-ann-ui]') ? 'ann-ui' : 'page';
      const row = {page:pageId(), name:e.name, input:where, duration:Math.round(e.duration),
        inputDelay:Math.round(e.processingStart - e.startTime), processing:Math.round(e.processingEnd - e.processingStart),
        presentation:Math.round(e.startTime + e.duration - e.processingEnd),
        marks:window.pinpoint?.marks?.length ?? 0, frames:document.querySelectorAll('.wb-screen').length,
        zoom:Number(document.documentElement.getAttribute('data-canvas-zoom')) || 1};
      // 同一帧的长帧条目比事件条目晚到：等一会儿再找归属。
      setTimeout(() => record('input-lag', {...row, ...overlappingScripts(e.startTime, e.startTime + e.duration)}), 1200);
    }));
    const eventOpts = {type:'event', durationThreshold:INPUT_LAG_MS, buffered:false};
    po.observe(eventOpts);
    removers.push(() => po.disconnect());
    parked.push({ stop: () => po.disconnect(), start: () => { try { po.observe(eventOpts); } catch {} } });
  } catch {}
  function sample() {
    const annMax = window.pinpoint?.perfDrain?.() ?? 0; // 标注层本采样窗口内最慢的一帧同步耗时（ms）
    const wrap = stage.querySelector('.wb-zoom-wrap');
    record('viewport', {page:pageId(), input, scroll:[stage.scrollLeft,stage.scrollTop],
      extent:[stage.scrollWidth,stage.scrollHeight], viewport:[stage.clientWidth,stage.clientHeight],
      dpr:devicePixelRatio, maxFrameGap:Math.round(maxGap), hidden:document.hidden,
      wrap:geometry(wrap), panel:geometry(document.getElementById('wb-board-panel')),
      loaf, loafMax:Math.round(loafMax), loafScript, longTasks, annMax:Math.round(annMax),
      zoom:Number(document.documentElement.getAttribute('data-canvas-zoom')) || 1,
      marks:window.pinpoint?.marks?.length ?? 0});
    maxGap = 0; loaf = 0; loafMax = 0; loafScript = ''; longTasks = 0;
  }
  function tick(now) {
    if (lastFrame) maxGap = Math.max(maxGap, now-lastFrame);
    lastFrame = now;
    if (now-lastSample >= 250) { sample(); lastSample = now; }
    if (now-lastActivity < 500) raf = requestAnimationFrame(tick);
    else { raf = 0; lastFrame = 0; sample(); persist(); }
  }
  function activity() {
    if (paused) return;
    lastActivity = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function listen(target, name, fn) {
    const run = (e) => { if (!paused) fn(e); };
    target.addEventListener(name,run,{passive:true});
    removers.push(()=>target.removeEventListener(name,run));
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
  // 停驻期间不采样。恢复时补记一条 viewport：停驻里发生的事（比如 HMR 重摆了板）
  // 打开时的第一眼就进诊断，而不是要等下一次指针活动。
  registerEmbedPark({
    pause() {
      paused = true;
      cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
      parked.forEach(entry => entry.stop());
    },
    resume() {
      paused = false;
      parked.forEach(entry => entry.start());
      sample();
      if (pending.length) scheduleUpload();
    },
  });
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
