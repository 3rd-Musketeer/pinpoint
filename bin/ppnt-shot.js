/**
 * ppnt shot / check --mode image 的渲染端（2026-09-22 切片 4）。
 *
 * 复用 /api/export-image 的渲染链：本模块只负责在 playwright 里打开 workbench、
 * 取快照（clone → 摘 script / data-export-ui → 带画布 token，与
 * scripts/export-preview.mjs 同一契约），--marks 时把 #n 序号钉烤进快照，然后
 * POST 给服务的渲染器出 PNG。不另起渲染实现；服务不在跑就报错指 ppnt start。
 */
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { frameInternalSelector } from '../src/shared/frame-anchor.js';

export const PIN_CSS = 'position:absolute;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#0a84ff;color:#fff;font:700 11px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4);';

/**
 * 渲染一组图。jobs = [{ kind:'frame'|'section'|'page', screenId?, sectionId?,
 * out, scale, marks }]；marks = [{ n, screenId, selector }]（selector 是账本里
 * 存的画布 cssPath，Node 侧先归一成帧内链）。返回 [{ out, width, height }]；
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
      const internal = frameInternalSelector(mark.selector) || (/^#/.test(mark.selector) ? mark.selector : null);
      return { n: mark.n, screenId: mark.screenId, internal };
    }).filter((mark) => mark.internal),
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

/** 快照（export-preview 同契约）+ 序号钉 overlay。 */
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
        try {
          el = mark.internal === ':scope' ? scope : scope.querySelector(mark.internal);
        } catch (e) { el = null; }
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
