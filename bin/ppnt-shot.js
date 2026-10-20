/**
 * ppnt shot / check --mode image 的渲染端（2026-09-22 切片 4）。
 *
 * 复用 /api/export-image 的渲染链：本模块只负责在 playwright 里打开 workbench、
 * 取快照（clone → 摘 script / data-export-ui → 带画布 token，渲染端同一份
 * 契约），--marks 时把 #n 序号钉烤进快照，然后
 * POST 给服务的渲染器出 PNG。不另起渲染实现；服务不在跑就报错指 ppnt start。
 */
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { frameInternalSelector } from '../src/shared/frame-anchor.js';
import { WORKBENCH_PATH } from '../src/shared/workbench-url.js';

const PIN_CSS = 'position:absolute;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#0a84ff;color:#fff;font:700 11px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4);';

/**
 * 渲染一组画布视图上的图。jobs = [{ kind:'frame'|'section'|'page', screenId?, sectionId?,
 * out, scale, marks }]；marks 是账本行（带 targets）。锚点解析走页面里
 * window.pinpoint.resolveMarkTarget（决定 #15：ppId 优先，cssPath 兜底），
 * 帧内相对链作旧路兜底。返回 [{ out, width, height }]；
 * 服务不在跑 / 渲染失败抛错；锚点解析不到的钉安静跳过（失效 ≠ 不能出图）。
 */
/** 服务不在跑时的那句话：隔离运行（设了 PINPOINT_ORIGIN）不能 `ppnt start`，要去起那个服务。 */
export function serviceDownMessage(origin, env = process.env) {
  return env.PINPOINT_ORIGIN
    ? `截图要 pinpoint 服务在跑：PINPOINT_ORIGIN=${origin} 那个服务没答，先把它起起来（docs/registry.md“隔离运行”）。`
    : `截图要 pinpoint 服务在跑（${origin}），先 \`ppnt start\`。`;
}

async function serviceUp(origin) {
  try {
    const response = await fetch(`${origin}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function renderShots({ origin, pageId, jobs, env = process.env }) {
  if (!(await serviceUp(origin))) throw new Error(serviceDownMessage(origin, env));
  const prepared = jobs.map((job) => ({
    ...job,
    marks: (job.marks || []).map((mark) => {
      const target = Array.isArray(mark.targets) && mark.targets[0] ? mark.targets[0] : null;
      const selector = target ? target.selector : mark.selector;
      const internal = frameInternalSelector(selector) || (/^#/.test(selector || '') ? selector : null);
      return {
        n: mark.n,
        screenId: mark.screenId,
        internal,
        target: target ? { selector: target.selector, text: target.text || '', ppId: target.ppId || '' } : null,
      };
    }).filter((mark) => mark.internal || (mark.target && mark.target.ppId)),
  }));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1100 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    await page.goto(`${origin}${WORKBENCH_PATH}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.workbench);
    await page.evaluate((id) => window.workbench.setActivePage(id), pageId);
    await page.waitForFunction((id) => window.workbench.activePageId() === id && document.querySelector('#wb-board-panel .wb-lib-item'), pageId);
    await waitForQuiet(page);
    for (const job of prepared) {
      // 页 tab（ADR 0041）：工作台只挂活动 tab，拍之前切到目标所在的 tab 并等板重挂完。
      if (job.tabId) {
        await page.evaluate((id) => window.workbench.setActiveTab(id), job.tabId);
        await page.waitForFunction((id) => window.workbench.activeTabId() === id && document.querySelector('#wb-board-panel .wb-lib-item'), job.tabId);
        await waitForQuiet(page);
      }
      const snapshot = await buildSnapshot(page, job);
      const response = await context.request.post(`${origin}/api/export-image`, { data: snapshot });
      if (!response.ok()) {
        throw new Error(`导出失败（${response.status()}）：${await response.text()}`);
      }
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      fs.writeFileSync(job.out, await response.body());
      const headers = response.headers();
      // --json 的 shots[].width / height 是数字（另两条截图路径都出数字）；HTTP 头是字符串，转掉（CLI 排查 #12）。
      results.push({
        out: job.out,
        label: job.label || '',
        width: Number(headers['x-export-width'] ?? 0),
        height: Number(headers['x-export-height'] ?? 0),
        ...(snapshot.errorPanel ? { errorPanel: snapshot.errorPanel } : {}),
      });
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return results;
}

/** 帧的 sidecar 是异步挂载的（模块链 + 绘制都要时间）：等页面资源安静两拍再开拍，
   否则第一份快照可能拍到还没上色的 canvas。资源计数连续两轮不再增长即视为安静；
   SSE 是长连接但不产生新的 resource 条目，不影响。 */
async function waitForQuiet(page, { timeout = 4000, interval = 150 } = {}) {
  const start = Date.now();
  let last = -1;
  for (;;) {
    const count = await page.evaluate(() => performance.getEntriesByType('resource').length);
    if (count === last && count > 0) break;
    last = count;
    if (Date.now() - start > timeout) break;
    await page.waitForTimeout(interval);
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** 快照（/api/export-image 同契约）+ 序号钉 overlay。 */
async function buildSnapshot(page, job) {
  return page.evaluate(({ job, pinCss }) => {
    const panel = document.getElementById('wb-board-panel');
    const target = job.kind === 'page'
      ? panel.querySelector('.wb-library')
      : job.kind === 'section'
        ? panel.querySelector(`.wb-lib-item[data-ann-section="${CSS.escape(job.sectionId)}"]`)
        : panel.querySelector(`[data-screen="${CSS.escape(job.screenId)}"]`);
    if (!target) throw new Error(`找不到要拍的 ${job.kind}`);
    // R5 B3：编译失败的帧画着 .wb-screen-err 错误面板（外层 .wb-screen 照带
    // data-screen，按选择器找得到）。拍下它再报成功，agent 就把「加载失败」
    // 当验收证据了——检出文本带回，调用方按错误算。
    const errPanel = target.querySelector('.wb-screen-err');
    // 序号钉：锚点还活着的标注，按元素位置烤进快照（stage 内相对链解析）。
    let overlay = '';
    if (job.marks && job.marks.length) {
      const box = target.getBoundingClientRect();
      const pins = [];
      for (const mark of job.marks) {
        let scope = target;
        if (mark.screenId) {
          const frame = target.matches('.wb-screen') ? target : target.querySelector(`.wb-screen[data-screen="${CSS.escape(mark.screenId)}"]`);
          if (!frame) continue;
          scope = frame.querySelector('.ios-stage, .wb-comp-stage, .wb-html-stage') || frame;
        }
        let el = null;
        // 决定 #15：target 带 ppId 时先走页面里 annotate 实例的同一条解析
        //（ppId 优先、帧 stage 内择近），cssPath 链只在它缺席 / 落空时兜底。
        if (mark.target && mark.target.ppId && window.pinpoint && typeof window.pinpoint.resolveMarkTarget === 'function') {
          el = window.pinpoint.resolveMarkTarget(mark.target, mark.screenId || '');
        }
        if (!el && mark.internal) {
          try {
            el = mark.internal === ':scope' ? scope : scope.querySelector(mark.internal);
          } catch (e) { el = null; }
        }
        if (!el || !el.getBoundingClientRect) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) continue;
        pins.push({ n: mark.n, x: rect.left - box.left, y: rect.top - box.top });
      }
      if (pins.length) {
        overlay = '<div style="position:absolute;inset:0;pointer-events:none;z-index:9">'
          + pins.map((pin) => `<span style="${pinCss}left:${Math.max(0, pin.x - 9)}px;top:${Math.max(0, pin.y - 9)}px">#${pin.n}</span>`).join('')
          + '</div>';
      }
    }
    const clone = target.cloneNode(true);
    clone.querySelectorAll('script,[data-export-ui]').forEach((node) => node.remove());
    clone.removeAttribute('data-export-ui');
    // 运行时 canvas 的位图不随克隆走（出图里全空白）：原位换成活页位图的
    // dataURL 图片，尺寸照布局尺寸（offsetWidth/Height，不吃画布缩放）。
    // toDataURL 会抛的（跨域污染）canvas 跳过，出图保持空白，与现状一致。
    const cloneCanvases = clone.querySelectorAll('canvas');
    target.querySelectorAll('canvas').forEach((live, i) => {
      const twin = cloneCanvases[i];
      if (!twin) return;
      let url = '';
      try { url = live.toDataURL('image/png'); } catch { return; }
      const img = document.createElement('img');
      for (const attr of twin.attributes) img.setAttribute(attr.name, attr.value);
      img.setAttribute('width', String(Math.max(1, live.offsetWidth)));
      img.setAttribute('height', String(Math.max(1, live.offsetHeight)));
      img.style.width = `${live.offsetWidth}px`;
      img.style.height = `${live.offsetHeight}px`;
      img.src = url;
      twin.replaceWith(img);
    });
    if (overlay) {
      clone.style.position = 'relative';
      clone.insertAdjacentHTML('afterbegin', overlay);
    }
    const TOKEN_NAMES = [
      '--wb-phone-w', '--wb-phone-h', '--wb-cap-section', '--wb-cap-screen', '--wb-cap-note', '--wb-cap-gap', '--wb-cap-ref',
      '--wb-fg', '--wb-muted', '--wb-faint', '--wb-side', '--wb-line', '--wb-hover', '--wb-accent',
    ];
    const computed = getComputedStyle(panel.querySelector('.wb-library'));
    const tokens = {};
    TOKEN_NAMES.forEach((name) => {
      const value = computed.getPropertyValue(name).trim();
      if (value) tokens[name] = value;
    });
    const section = job.kind === 'page' ? null : target.closest('.wb-lib-item');
    const screen = job.kind === 'frame' ? target : null;
    // 板级装载把帧里只有 @import 的 <style>（board assets.css、文章的 article.css、
    // 作者手写的页 CSS）去重后提到 .wb-library 开头（src/workbench/lib/hoist-imports.js），
    // 帧 / 节的克隆里就没有它们了。把画布上实际生效的这几条带进快照，出图与画布同一套样式；
    // 整页快照的 target 就是 .wb-library，本来就带着。
    const hoisted = job.kind === 'page'
      ? ''
      : [...panel.querySelector('.wb-library').children]
        .filter((node) => node.tagName === 'STYLE')
        .map((node) => node.outerHTML)
        .join('');
    return {
      kind: job.kind === 'page' ? 'section' : job.kind,
      pageId: window.workbench.activePageId(),
      sectionId: (section && (section.getAttribute('data-ann-section') || section.getAttribute('data-ann-group')))
        || (job.kind === 'page' ? 'board' : ''),
      screenId: screen ? screen.getAttribute('data-screen') : '',
      format: 'png',
      scale: job.scale,
      background: 'canvas',
      tokens,
      html: hoisted + clone.outerHTML,
      ...(errPanel ? { errorPanel: (errPanel.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200) } : {}),
    };
  }, { job, pinCss: PIN_CSS });
}

/**
 * 拍正文里的一个图（ppnt shot <project>/<article> --figure，docs/projects.md“图”）：直接打开图页
 * /api/frame?page=&figure=&embed=figure&theme=，浅色、深色各拍一张图的根元素，正文栏宽 760。
 * 等图页的启动脚本做完（html[data-figure-ready]）再拍；页面报错、控制台报错、图页写下的错误
 * 都收进 errors。返回 [{ theme, out, width, height, errors }]。服务不在跑时抛错。
 */
export async function renderFigureShots({ origin, pageId, figureId, outBase, scale = 1, width = 760, env = process.env }) {
  if (!(await serviceUp(origin))) throw new Error(serviceDownMessage(origin, env));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: scale, colorScheme: theme, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error.message || error)));
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      const url = `${origin}/api/frame?page=${encodeURIComponent(pageId)}&figure=${encodeURIComponent(figureId)}&embed=figure&theme=${theme}`;
      const response = await page.goto(url, { waitUntil: 'load' });
      const root = page.locator('[data-pp-figure-root]');
      if (!(await root.count())) {
        const body = await response.text();
        let detail = body;
        try { detail = JSON.parse(body).message || body; } catch { /* not JSON */ }
        await context.close();
        throw new Error(`图页打不开（${response.status()}）：${detail}`);
      }
      await page.waitForSelector('html[data-figure-ready]', { timeout: 10_000 }).catch(() => errors.push('图页 10 秒内没有跑完启动脚本'));
      await waitForQuiet(page);
      const figureError = await page.evaluate(() => document.documentElement.dataset.figureError || '');
      if (figureError && !errors.includes(figureError)) errors.unshift(figureError);
      const out = theme === 'light' ? `${outBase}.png` : `${outBase}-dark.png`;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await root.screenshot({ path: out });
      const box = await root.boundingBox();
      results.push({ theme, out, width: Math.round(box.width * scale), height: Math.round(box.height * scale), errors: [...new Set(errors)] });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** 文章页正文结尾的标记（site/src/pages/[project]/[article]/index.astro）。 */
const ARTICLE_END_SELECTOR = '[data-pp-article-end]';

/** PNG 头里的宽高（IHDR 紧跟签名）。 */
function pngSize(buffer) {
  if (!buffer || buffer.length < 24) return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * 等文章页能读：200 就绪；503 是“站点启动中”页（服务按需拉起 Astro，几秒）或刚写好的文章“内容同步中”，继续等；
 * 404 在刚登记的文章上可能短暂出现，最多等 10 秒；502 是站点起不来，直接报（带页面里的原因）。
 */
export async function waitArticleReady(request, url, { timeoutMs, pollMs = 500 }) {
  const started = Date.now();
  let last = '';
  for (;;) {
    let status = 0;
    let text = '';
    try {
      const response = await request.get(url, { failOnStatusCode: false, timeout: 15000 });
      status = response.status();
      if (status !== 200) text = await response.text();
    } catch (error) {
      last = error.message;
    }
    if (status === 200) return;
    if (status === 502) {
      const reason = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
      throw new Error(`文章站点起不来（502）：${reason}`);
    }
    if (status === 500) throw new Error(`文章页 ${url} 返回 500：正文多半渲染出错，跑 ppnt check 看是哪一行`);
    if (status && status !== 503 && !(status === 404 && Date.now() - started < 10000)) {
      throw new Error(`文章页 ${url} 返回 ${status}`);
    }
    if (status) last = `HTTP ${status}${status === 503 ? '（站点启动中）' : ''}`;
    if (Date.now() - started > timeoutMs) throw new Error(`等文章页就绪超时（${Math.round(timeoutMs / 1000)} 秒，最后一次 ${last || '没有响应'}）：${url}；ppnt status 看文章站点那一行，--timeout 可以放宽`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * 在一个文档里把懒加载的图片和 iframe 改成立即加载，等它们 load（或 error）完，最多等到 deadline。
 * 在页面里跑（frame.evaluate），只看这一层文档；嵌在里面的 iframe 由 settleLazyContent 逐层再跑一遍。
 * scope 是选择器时只管它里面的元素。返回到时还没加载完的元素（`img <src>` / `iframe <src>`）。
 */
async function settleDocumentInPage({ deadline, scope }) {
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return [];
  const describe = (el) => `${el.tagName.toLowerCase()} ${el.getAttribute('src') || el.currentSrc || ''}`.trim().slice(0, 200);
  const images = [];
  for (const img of root.querySelectorAll('img')) {
    if (img.loading === 'lazy') img.loading = 'eager';
    // 懒加载还没开始的图 complete 是 false；改成 eager 后马上开始取。
    if (img.getAttribute('src') || img.getAttribute('srcset')) images.push(img);
  }
  const frames = [];
  for (const frame of root.querySelectorAll('iframe')) {
    const src = frame.getAttribute('src');
    if (!src && !frame.hasAttribute('srcdoc')) continue;
    if (frame.loading === 'lazy') {
      frame.loading = 'eager';
      // 改 loading 不一定触发加载：还停在初始 about:blank 时重设 src 让它马上开始。
      let blank = false;
      try { blank = !frame.contentDocument || frame.contentDocument.URL === 'about:blank'; } catch { blank = false; }
      if (blank && src) frame.setAttribute('src', src);
    }
    frames.push(frame);
  }
  // 同源 iframe 轮询它自己的文档（Chromium 里懒加载改 eager 后 iframe 元素上的 load 事件不一定派发）；
  // 跨源的读不到，交给调用方按 Playwright 的 frame 等 load。
  const frameReady = (frame) => {
    try {
      const doc = frame.contentDocument;
      return !doc || (doc.URL !== 'about:blank' && doc.readyState === 'complete');
    } catch {
      return true;
    }
  };
  const imageReady = (img) => img.complete;
  for (;;) {
    const pending = [...images.filter((img) => !imageReady(img)), ...frames.filter((frame) => !frameReady(frame))];
    if (!pending.length) break;
    if (Date.now() >= deadline) return pending.map(describe);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (document.fonts && document.fonts.ready && Date.now() < deadline) {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())))]);
  }
  return [];
}

/** 整页从上到下滚一遍再回顶（按 IntersectionObserver 懒加载的页面靠这个开始取图），最多 80 屏。 */
async function scrollThrough(frame, deadline) {
  await frame.evaluate(async ({ deadline }) => {
    const el = document.scrollingElement || document.documentElement;
    const step = Math.max(200, window.innerHeight);
    const frameTick = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));
    for (let y = 0, i = 0; y < el.scrollHeight && i < 80 && Date.now() < deadline; y += step, i += 1) {
      window.scrollTo(0, y);
      await frameTick();
    }
    window.scrollTo(0, 0);
    await frameTick();
  }, { deadline }).catch(() => {});
}

/**
 * 截图前的就绪规则（HTML 帧、文章页、画布卡片共用）：顶层文档和每一层嵌套 iframe 里的懒加载图片、
 * iframe 都改成立即加载，逐层等它们 load 完；可选先把顶层整页滚一遍。整个过程以 timeoutMs 为上限，
 * 到时还没加载完的照常截，返回它们的描述（调用方打一行“注意”）。scope 只限定顶层文档里的范围。
 * → { pending: string[] }
 */
async function settleLazyContent(page, { timeoutMs = 15000, scope = null, scroll = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  const pending = [];
  const settleFrame = async (frame, frameScope) => {
    try {
      pending.push(...await frame.evaluate(settleDocumentInPage, { deadline, scope: frameScope }));
    } catch (error) {
      // 帧在等的途中导航或卸载了：不算失败，下一轮按新的帧列表再来。
      if (!/detached|destroyed|closed/i.test(String(error && error.message))) throw error;
    }
  };
  await settleFrame(page.mainFrame(), scope);
  if (scroll) {
    await scrollThrough(page.mainFrame(), deadline);
    await settleFrame(page.mainFrame(), scope);
  }
  // 嵌套的 iframe 逐层处理：上一层放开了懒加载，这一层才有文档可等。层数有上限，防自引用的页。
  const settled = new Set([page.mainFrame()]);
  let layer = [page.mainFrame()];
  for (let depth = 0; depth < 4 && layer.length && Date.now() < deadline; depth += 1) {
    const next = [];
    for (const parent of layer) {
      for (const child of parent.childFrames()) {
        if (settled.has(child)) continue;
        if (parent === page.mainFrame() && scope) {
          const inside = await child.frameElement().then((el) => el.evaluate((node, sel) => !!node.closest(sel), scope)).catch(() => false);
          if (!inside) continue;
        }
        settled.add(child);
        next.push(child);
      }
    }
    for (const child of next) {
      // 跨源的帧在页面里读不到 readyState，这里按 Playwright 的帧再等一次 load（同源的已经等过，立即返回）。
      await child.waitForLoadState('load', { timeout: Math.max(1, deadline - Date.now()) }).catch(() => {});
      await settleFrame(child, null);
    }
    layer = next;
  }
  await waitForQuiet(page);
  return { pending: [...new Set(pending)] };
}

/** 文章页上的画布卡片是懒加载 iframe，卡片里的 HTML 帧又可能嵌着懒加载的 iframe：整页截图前都放开、等完。 */
async function settleArticlePage(page, scope = null) {
  return settleLazyContent(page, { scope });
}

/** 页面在 evaluate / 截图途中自己导航了（503 页的自动刷新、站点重编后的整页重载）。 */
export function isNavigationRace(error) {
  return /Execution context was destroyed|frame was detached|Target page, context or browser has been closed|navigation/i.test(String(error && error.message));
}

/**
 * 打开文章页并截一张，页面中途导航时重新等就绪、重开再截，最多 3 次。
 * 第一次读一篇刚写的文章时，站点可能在页面打开后重编并整页重载，截图会撞上这次导航。
 */
async function shootArticleJob(page, request, job, { timeoutMs, reload }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      if (reload || attempt > 1) {
        await waitArticleReady(request, job.url, { timeoutMs });
        const response = await page.goto(job.url, { waitUntil: 'load' });
        if (response && response.status() === 503) {
          // 就绪探测和打开之间站点又在重启：等它重新答 200。
          await waitArticleReady(request, job.url, { timeoutMs });
          await page.goto(job.url, { waitUntil: 'load' });
        }
      }
      return await shootLoadedArticle(page, request, job, { timeoutMs });
    } catch (error) {
      if (attempt >= 3 || !isNavigationRace(error)) throw error;
      await page.waitForLoadState('load').catch(() => {});
    }
  }
}

async function shootLoadedArticle(page, request, job, { timeoutMs }) {
  fs.mkdirSync(path.dirname(job.out), { recursive: true });
  let buffer;
  let pending = [];
  if (job.kind === 'article-section') {
    const selector = `section[data-section="${job.sectionId.replace(/"/g, '\\"')}"]`;
    const section = page.locator(selector);
    if (!(await section.count())) {
      // 刚改过 index.mdx 时站点可能还在重编，拿到的是旧页或没渲染完的页：等一会儿、重载一次再判。
      await waitArticleReady(request, job.url, { timeoutMs });
      await page.goto(job.url, { waitUntil: 'load' });
      await page.locator(selector).first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
    }
    if (!(await section.count())) {
      throw new Error(`文章页上没有节 ${job.sectionId}（${job.url}）：正文可能没渲染完，ppnt check 看有没有正文渲染错误`);
    }
    await section.scrollIntoViewIfNeeded();
    ({ pending } = await settleArticlePage(page, selector));
    buffer = await section.screenshot({ path: job.out });
  } else {
    ({ pending } = await settleArticlePage(page));
    buffer = await page.screenshot({ path: job.out, fullPage: true });
  }
  const size = pngSize(buffer);
  // 站点在正文结尾放了 [data-pp-article-end]：没有它，说明正文渲染中途出错、响应断在半篇。
  const truncated = !(await page.locator(ARTICLE_END_SELECTOR).count());
  return {
    out: job.out,
    label: job.label || '',
    width: size.width,
    height: size.height,
    ...(truncated ? { truncated: true } : {}),
    ...(pending.length ? { pending } : {}),
  };
}

/**
 * 文章页截图（ppnt shot <project>/<article> [§n]）。jobs = [{ kind: 'article' | 'article-section',
 * url, sectionId?, out, label, scale }]。先等服务、再等文章页就绪（见 waitArticleReady），
 * 截整页或 <section data-section="<节 id>"> 那一块。返回 [{ out, label, width, height, truncated? }]：
 * 页面里没有正文结尾标记（ARTICLE_END_SELECTOR）时 truncated = true。
 */
export async function renderArticleShots({ origin, jobs, timeoutMs = 60000, env = process.env }) {
  if (!(await serviceUp(origin))) throw new Error(serviceDownMessage(origin, env));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const scale = (jobs[0] && jobs[0].scale) || 1;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    let loadedUrl = null;
    for (const job of jobs) {
      const reload = loadedUrl !== job.url;
      results.push(await shootArticleJob(page, context.request, job, { timeoutMs, reload }));
      loadedUrl = job.url;
    }
    await context.close();

  } finally {
    await browser.close();
  }
  return results;
}

/**
 * 文章的文档帧（HTML 帧，docs/projects.md“HTML 帧”）：截图逐帧取完整页面，直接打开它自己的地址（`?annotate=off`），
 * 按手机宽度 402（画布视图的手机屏宽）拍整页。jobs = [{ url, out, label, scale, marks }]；marks 是账本行，钉按行上第一个目标的
 * 选择器（文档标注的锚点就是整页的选择器加文字）落在元素左上角，找不到的安静跳过。
 * 截之前按 settleLazyContent 等懒加载的 iframe 和图片（含嵌套）加载完。
 * 返回 [{ out, label, width, height, pending? }]：pending 是到时仍没加载完的元素。
 */
export const DOC_SHOT_WIDTH = 402;
export async function renderDocShots({ origin, jobs, env = process.env }) {
  if (!(await serviceUp(origin))) throw new Error(serviceDownMessage(origin, env));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const job of jobs) {
      const context = await browser.newContext({ viewport: { width: DOC_SHOT_WIDTH, height: 874 }, deviceScaleFactor: job.scale || 1, ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const url = new URL(job.url.split('/').map(encodeURIComponent).join('/'), origin);
      url.searchParams.set('annotate', 'off');
      const response = await page.goto(url.href, { waitUntil: 'load' });
      if (!response || !response.ok()) throw new Error(`文档帧 ${job.label || job.url} 打不开（${response ? response.status() : '没有响应'}）：${url.href}`);
      // 页面里嵌的 iframe、图片常是懒加载的（视口外不取），整页截图不会替它们滚到视口里：先放开、等完。
      const { pending } = await settleLazyContent(page, { scroll: true });
      const pins = (job.marks || []).map((mark) => {
        const target = Array.isArray(mark.targets) && mark.targets[0] ? mark.targets[0] : null;
        return { n: mark.n, selector: target ? target.selector : mark.selector, text: target ? target.text || '' : mark.text || '' };
      }).filter((pin) => pin.selector);
      if (pins.length) {
        await page.evaluate(({ pins, pinCss }) => {
          const layer = document.createElement('div');
          layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
          for (const pin of pins) {
            let el = null;
            try { el = document.querySelector(pin.selector); } catch { el = null; }
            if (!el) continue;
            const r = el.getBoundingClientRect();
            const dot = document.createElement('span');
            dot.style.cssText = `${pinCss}left:${Math.max(0, r.left + scrollX - 9)}px;top:${Math.max(0, r.top + scrollY - 9)}px`;
            dot.textContent = `#${pin.n}`;
            layer.appendChild(dot);
          }
          document.body.appendChild(layer);
        }, { pins, pinCss: PIN_CSS });
      }
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      const buffer = await page.screenshot({ path: job.out, fullPage: true });
      const size = pngSize(buffer);
      results.push({ out: job.out, label: job.label || '', width: size.width, height: size.height, ...(pending.length ? { pending } : {}) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}
