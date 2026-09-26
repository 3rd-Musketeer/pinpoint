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

export const PIN_CSS = 'position:absolute;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#0a84ff;color:#fff;font:700 11px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4);';

/**
 * 渲染一组图。jobs = [{ kind:'frame'|'section'|'page', screenId?, sectionId?,
 * out, scale, marks }]；marks 是账本行（带 targets）。锚点解析走页面里
 * window.pinpoint.resolveMarkTarget（决定 #15：ppId 优先，cssPath 兜底），
 * 帧内相对链作旧路兜底。返回 [{ out, width, height }]；
 * 服务不在跑 / 渲染失败抛错；锚点解析不到的钉安静跳过（失效 ≠ 不能出图）。
 */
export async function renderShots({ origin, pageId, jobs }) {
  let up = false;
  try {
    const response = await fetch(`${origin}/health`);
    up = response.ok;
  } catch {
    up = false;
  }
  if (!up) throw new Error(`渲染需要 pinpoint 服务在跑（${origin}），先 \`ppnt start\`。`);
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
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.workbench);
    await page.evaluate((id) => window.workbench.setActivePage(id), pageId);
    await page.waitForFunction((id) => window.workbench.activePageId() === id && document.querySelector('#wb-board-panel .wb-lib-item'), pageId);
    await waitForQuiet(page);
    for (const job of prepared) {
      const snapshot = await buildSnapshot(page, job);
      const response = await context.request.post(`${origin}/api/export-image`, { data: snapshot });
      if (!response.ok()) {
        throw new Error(`导出失败（${response.status()}）：${await response.text()}`);
      }
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      fs.writeFileSync(job.out, await response.body());
      const headers = response.headers();
      results.push({ out: job.out, width: headers['x-export-width'], height: headers['x-export-height'] });
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
      html: clone.outerHTML,
    };
  }, { job, pinCss: PIN_CSS });
}
