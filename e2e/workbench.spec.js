import fs from 'node:fs/promises';

import { expect, test } from '@playwright/test';

// The e2e server runs with PREVIEW_TEMPLATE_ONLY=1 (playwright.config.js), so
// every assertion here targets template content only — instance-local pages and
// components are hidden and counts stay deterministic on any machine.

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

async function saveAnnotation(page, target, comment) {
  await target.click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill(comment);
  await box.locator('#ann-save').click();
}

// 画布批注三态 dropdown（2026-08-15 右栏底栏，取代旧 评论/通道 双钮）：
// off = 隐藏批注，inline = 叠在页面，chan = 右侧通道。
async function pickBubbleMode(page, mode) {
  await page.locator('#wbann-bubble').click();
  await page.locator('#wbann-bubble-' + mode).click();
}

// 右栏宽度适配（2026-08-16 V2）：#wbannsplit 在 stage 与右栏之间，左拖 = 变宽。
async function annPanelWidth(page) {
  return page.locator('#wbann-side').evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

async function dragAnnSplitter(page, dx) {
  const box = await page.locator('#wbannsplit').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 12 });
  await page.mouse.up();
}

// 左栏宽度（2026-08-16b 壳标 pill 紧凑断点）：#wbsplit 在左栏右缘，右拖 = 变宽。
async function sideWidth(page) {
  return page.locator('#wbside').evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

async function dragSideSplitter(page, dx) {
  const box = await page.locator('#wbsplit').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 12 });
  await page.mouse.up();
}

async function readWbPrefs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pinpoint-wb')));
}

async function expectFocusedTarget(page, selector) {
  await expect.poll(() => page.evaluate((targetSelector) => {
    const stage = document.querySelector('#wbstage');
    const target = document.querySelector(targetSelector);
    if (!stage || !target) return Infinity;
    const stageRect = stage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width < 1 || targetRect.height < 1) return Infinity;
    const inset = 24;
    const expectedLeft = targetRect.width + inset * 2 <= stage.clientWidth
      ? (stage.clientWidth - targetRect.width) / 2
      : inset;
    const expectedTop = targetRect.height + inset * 2 <= stage.clientHeight
      ? (stage.clientHeight - targetRect.height) / 2
      : inset;
    return Math.max(
      Math.abs(targetRect.left - stageRect.left - expectedLeft),
      Math.abs(targetRect.top - stageRect.top - expectedTop),
    );
  }, selector)).toBeLessThan(4);
}

test('manifest navigation survives rapid page switches and persists the winner', async ({ page }) => {
  await openWorkbench(page);

  // Pages 单一列表（2026-08-16 阶段 2）：系统行 + 模板页 + registry 条目同列。
  // 阶段 4：url 条目也进列表（E2E Site / E2E Proxy App，恒 doc 壳）。
  // 阶段 5：e2e-mention 固件（doc 壳 mention 文档）追加在尾。
  // 行 = 壳标 pill（iOS/Doc 文字，2026-08-16b）+ 标题，两通道分别断言。
  await expect(page.locator('#wbpages .wb-page .wb-page-t')).toHaveText([
    'Component Library',
    'Example Library',
    'Example HTML',
    'E2E Site',
    'E2E Proxy App',
    'E2E Dir',
    'E2E Dir iOS',
    'E2E Mention Doc',
  ]);
  await expect(page.locator('#wbpages .wb-page .wb-page-kind-t')).toHaveText([
    'iOS', 'iOS', 'Doc', 'Doc', 'Doc', 'Doc', 'iOS', 'Doc',
  ]);

  for (const [pageId, screenId] of [
    ['components', 'button/catalog'],
    ['library', 'home'],
    ['library', 'timer'],
  ]) {
    await page.locator(`#wbpages [data-vpage="${pageId}"]`).click();
    await expect(page.locator(`#wb-board-panel [data-screen="${screenId}"]`)).toBeVisible();
    await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  }

  await page.evaluate(() => {
    window.workbench.setActivePage('components');
    window.workbench.setActivePage('library');
  });

  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('library');
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pinpoint-wb')).activePageId)).toBe('library');
});

test('Pages is one mixed list with per-page shell markers and no mode Seg', async ({ page }) => {
  await openWorkbench(page);

  // 模式 Seg 退役；本地页 + registry 条目混排（顺序 = 系统行 → _index → registry）。
  // 阶段 4：url 条目（E2E Site / E2E Proxy App）恒 doc 壳同列。
  // 阶段 5：e2e-mention 固件（doc 壳 mention 文档）追加在尾。
  // 行 = 壳标 pill + 标题（2026-08-16b），两通道分别断言。
  await expect(page.locator('#wbboard-mode')).toHaveCount(0);
  await expect(page.locator('#wbpages .wb-page .wb-page-t')).toHaveText([
    'Component Library',
    'Example Library',
    'Example HTML',
    'E2E Site',
    'E2E Proxy App',
    'E2E Dir',
    'E2E Dir iOS',
    'E2E Mention Doc',
  ]);
  await expect(page.locator('#wbpages .wb-page .wb-page-kind-t')).toHaveText([
    'iOS', 'iOS', 'Doc', 'Doc', 'Doc', 'Doc', 'iOS', 'Doc',
  ]);

  // 行内壳标 pill（2026-08-16b）：等宽 40px 图标+文字；图标保 .wb-page-ico 契约。
  await expect(page.locator('#wbpages [data-vpage="components"] .wb-page-ico')).toHaveCount(1);
  await expect(page.locator('#wbpages [data-vpage="library"][data-page-mode="ios"] .wb-page-ico')).toHaveCount(1);
  await expect(page.locator('#wbpages [data-vpage="doc-library"][data-page-mode="html"] .wb-page-ico')).toHaveCount(1);
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"][data-page-mode="html"] .wb-page-ico')).toHaveCount(1);
  await expect(page.locator('#wbpages [data-vpage="e2e-proxy"][data-page-mode="html"] .wb-page-ico')).toHaveCount(1);
  await expect(page.locator('#wbpages [data-vpage="e2e-dir-ios"][data-page-mode="ios"] .wb-page-ico')).toHaveCount(1);

  // 点文档页 → stage 变阅读器；点回机壳页 → 画布回来。
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  await expect(page.locator('#wb-board-panel .wb-doc-frame')).toHaveCount(1);
  await expect(page.locator('#wbcanvas-hud')).toBeHidden();
  await page.locator('#wbpages [data-vpage="library"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wbcanvas-hud')).toBeVisible();
});

test('HTML board fills the viewport, drops canvas chrome, and switches versions from the sidebar', async ({ page }) => {
  await openWorkbench(page);

  // 壳形态是页的属性：点文档页，stage 即阅读器。
  await page.locator('#wbpages [data-vpage="doc-library"]').click();

  // Document is hosted in an iframe, not inlined: its own <head>/<style> stay inside.
  const frame = page.locator('#wb-board-panel .wb-doc-stage .wb-doc-frame');
  await expect(frame).toHaveCount(1);
  await expect(page.frameLocator('#wb-board-panel .wb-doc-frame').locator('h1')).toHaveText('Sample Report');

  // Not a canvas: no zoom/pan HUD, and the doc matches the stage 1:1 so a report
  // renders at the reader's real window size.
  await expect(page.locator('#wbcanvas-hud')).toBeHidden();
  const [frameBox, stageBox] = await Promise.all([
    frame.boundingBox(),
    page.locator('#wbstage').boundingBox(),
  ]);
  expect(Math.round(frameBox.width)).toBe(Math.round(stageBox.width));
  expect(Math.round(frameBox.height)).toBe(Math.round(stageBox.height));

  // Versions live in the sidebar, one shown at a time.
  const versions = page.locator('#wbdoc-versions [data-doc-screen]');
  await expect(versions).toHaveCount(1);
  await expect(versions.first()).toHaveClass(/on/);

  await page.locator('#wbpages [data-vpage="library"]').click();
  await expect(page.locator('#wb-board-panel .wb-doc-frame')).toHaveCount(0);
  await expect(page.locator('#wbdoc-versions')).toBeHidden();
});

test('HTML board sidebar exports full HTML, no-css HTML, and long PNG', async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  await expect(page.locator('#wbdoc-versions [data-doc-export]')).toBeVisible();

  await page.locator('#wbdoc-versions [data-doc-export]').click();
  const dialog = page.locator('dialog.wb-export-dialog', { hasText: '导出文档' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[name="comments"]')).toBeVisible();
  const pickMode = (mode) => dialog.locator(`label.wb-export-option:has([name="mode"][value="${mode}"])`).click();
  const tokens = dialog.locator('[data-export-tokens]');
  await expect(tokens).toBeVisible();
  await expect(tokens.locator('.wb-export-token')).toHaveCount(3);
  await expect(tokens).toContainText('Gemini');
  await expect(tokens).toContainText('OpenAI');
  await expect(tokens).toContainText('Anthropic');

  const downloadFull = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const full = await downloadFull;
  expect(full.suggestedFilename()).toBe('doc-library__sample-report.html');
  const fullText = await fs.readFile(await full.path(), 'utf8');
  expect(fullText).toMatch(/<!doctype html>/i);
  expect(fullText).toMatch(/<style/i);

  await pickMode('html-no-css');
  await expect(tokens.locator('.wb-export-token')).toHaveCount(3);
  const downloadNoCss = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const noCss = await downloadNoCss;
  expect(noCss.suggestedFilename()).toBe('doc-library__sample-report.no-css.html');
  const noCssText = await fs.readFile(await noCss.path(), 'utf8');
  expect(noCssText).toMatch(/Sample Report/);
  expect(noCssText).not.toMatch(/<style/i);

  await pickMode('image');
  await expect(tokens.locator('.wb-export-token')).toHaveCount(3, { timeout: 30_000 });
  await expect(tokens).toContainText('Gemini');
  const downloadPng = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const png = await downloadPng;
  expect(png.suggestedFilename()).toBe('doc-library__sample-report@2x.png');
  const pngBuf = await fs.readFile(await png.path());
  expect(pngBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
});

test('HTML board exports with comments: mark boxes HTML, no-css text, and long PNG', async ({ page }) => {
  test.setTimeout(90_000);
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  const doc = page.frameLocator('#wb-board-panel .wb-doc-frame');
  await expect(doc.locator('h1')).toHaveText('Sample Report');

  await expect.poll(() => page.evaluate(() => !!(
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint
  ))).toBe(true);
  await page.locator('#wbann-toggle').click();
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().mode
  ))).toBe(true);
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.clear();
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(0);

  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    function clickEl(sel, text) {
      const el = d.querySelector(sel);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true,
        clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2), button: 0 };
      el.dispatchEvent(new w.MouseEvent('mousedown', at));
      el.dispatchEvent(new w.MouseEvent('mouseup', at));
      const ta = d.querySelector('textarea');
      ta.value = text;
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      [...d.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
    }
    clickEl('h1', '导出评论 h1');
    clickEl('#s2', '导出评论 #s2');
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(2);
  // Export reads the on-disk store — wait until the save has landed.
  await expect.poll(async () => page.evaluate(async () => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const path = w.location.pathname;
    const f = decodeURIComponent(path.split('/').pop() || 'index.html');
    let h = 0;
    for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
    const pageKey = (f + '~' + h.toString(36)).replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 80);
    const res = await fetch('/annotations/' + encodeURIComponent(pageKey));
    if (!res.ok) return 0;
    const doc = await res.json();
    return Array.isArray(doc.annotations) ? doc.annotations.length : 0;
  })).toBe(2);

  await page.locator('#wbdoc-versions [data-doc-export]').click();
  const dialog = page.locator('dialog.wb-export-dialog', { hasText: '导出文档' });
  await expect(dialog).toBeVisible();
  await dialog.locator('[name="comments"]').check();
  await expect(dialog.locator('[data-export-status]')).toContainText('标注框');

  // B': HTML full with baked mark boxes + badges
  const downloadFull = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const full = await downloadFull;
  expect(full.suggestedFilename()).toBe('doc-library__sample-report.comments.html');
  const fullText = await fs.readFile(await full.path(), 'utf8');
  expect(fullText).toMatch(/data-export-comments/);
  expect(fullText).toMatch(/var defer = true/);
  expect(fullText).toMatch(/var bubbles = true/);
  expect(fullText).toMatch(/导出评论 h1/);
  expect(fullText).toMatch(/导出评论 #s2/);
  // Bubble rendering libs are inlined.
  expect(fullText).toMatch(/bubbleInnerHtml/);
  expect(fullText).toMatch(/packGutter/);
  expect(fullText).not.toMatch(/padding-right:\s*264px/);
  // Localhost annotate bootstrap stripped (placer script may mention annotate.js in comments).
  expect(fullText).not.toMatch(/src\s*=\s*["'][^"']*annotate\.js/i);
  expect(fullText).not.toMatch(/data-ios-annotate/);
  expect(fullText).not.toMatch(/<div\b[^>]*\bid\s*=\s*["']ann-export-overlay["']/i);

  // Wide window: deferred placer follows layout (@media padding-left etc.).
  const exportPage = await page.context().newPage();
  await exportPage.setViewportSize({ width: 1400, height: 900 });
  await exportPage.setContent(fullText, { waitUntil: 'load' });
  await expect.poll(() => exportPage.evaluate(() => (
    document.querySelectorAll('#ann-export-overlay .ann-target').length
  ))).toBeGreaterThanOrEqual(1);
  // Bubbles must also render in the deferred HTML.
  await expect.poll(() => exportPage.evaluate(() => (
    document.querySelectorAll('#ann-export-overlay .ann-bubble').length
  ))).toBeGreaterThanOrEqual(1);
  const align = await exportPage.evaluate(() => {
    const h1 = document.querySelector('h1');
    const box = document.querySelector('#ann-export-overlay .ann-target');
    if (!h1 || !box) return null;
    const a = h1.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const pad = 4;
    return {
      dx: Math.round(b.left - (a.left - pad)),
      dy: Math.round(b.top - (a.top - pad)),
      dw: Math.round(b.width - (a.width + pad * 2)),
      dh: Math.round(b.height - (a.height + pad * 2)),
    };
  });
  await exportPage.close();
  expect(align).toBeTruthy();
  expect(Math.abs(align.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(align.dy)).toBeLessThanOrEqual(2);
  expect(Math.abs(align.dw)).toBeLessThanOrEqual(2);
  expect(Math.abs(align.dh)).toBeLessThanOrEqual(2);

  // C: no-css with text comments section
  await dialog.locator('label.wb-export-option:has([name="mode"][value="html-no-css"])').click();
  await expect(dialog.locator('[data-export-status]')).toContainText('评论列表');
  const downloadNoCss = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const noCss = await downloadNoCss;
  expect(noCss.suggestedFilename()).toBe('doc-library__sample-report.comments.no-css.html');
  const noCssText = await fs.readFile(await noCss.path(), 'utf8');
  expect(noCssText).toMatch(/id="comments"/);
  expect(noCssText).toMatch(/导出评论 h1/);
  expect(noCssText).toMatch(/导出评论 #s2/);

  // A': long PNG with gutter for sidebar bubbles
  await dialog.locator('label.wb-export-option:has([name="mode"][value="image"])').click();
  await expect(dialog.locator('[data-export-tokens] .wb-export-token')).toHaveCount(3, { timeout: 45_000 });
  const downloadPng = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const png = await downloadPng;
  expect(png.suggestedFilename()).toBe('doc-library__sample-report@2x.comments.png');
  const pngBuf = await fs.readFile(await png.path());
  expect(pngBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  // PNG IHDR width is big-endian at bytes 16..19; comments export is 1184 * 2 = 2368.
  const width = pngBuf.readUInt32BE(16);
  expect(width).toBe(2368);
});

test('doc annotate layer stays pinned to the viewport after the document scrolls', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();

  const doc = page.frameLocator('#wb-board-panel .wb-doc-frame');
  await expect(doc.locator('h1')).toHaveText('Sample Report');
  // The document wires annotate itself (localhost only) — no workbench stage inside the iframe.
  // Authors do not stamp wb-html-surface; plain docs treat body as the hit surface.
  await expect.poll(() => page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    return !!(w && w.pinpoint);
  })).toBe(true);
  expect(await page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame')
      .contentDocument.querySelectorAll('.wb-html-surface').length
  ))).toBe(0);

  // Scroll first and let the scroll settle, the way a reader actually does it —
  // hovering in the same synchronous block measures a pre-scroll layout.
  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    w.pinpoint.setMode(true);
    w.document.documentElement.style.scrollBehavior = 'auto';
    w.document.documentElement.scrollTop = 800;
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.scrollY
  ))).toBe(800);

  const out = await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    const ov = d.getElementById('ann-overlay');
    const el = d.elementFromPoint(300, 300);
    el.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 300 }));
    const ghost = d.querySelector('#ann-hover-layer > *');
    const g = ghost && ghost.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    return {
      scrollY: w.scrollY,
      overlayPosition: w.getComputedStyle(ov).position,
      overlayY: Math.round(ov.getBoundingClientRect().y),
      targetY: Math.round(t.y),
      ghostY: g ? Math.round(g.y) : null,
      ghostBottom: g ? Math.round(g.bottom) : null,
      ghostW: g ? Math.round(g.width) : 0,
      winH: w.innerHeight,
    };
  });
  expect(out.scrollY).toBeGreaterThan(0);
  // With no workbench stage the overlay must be pinned to the viewport. Left as
  // position:absolute it anchors at the document origin, is only one screen tall,
  // and clips everything below the fold — which reads as "annotate does nothing".
  expect(out.overlayPosition).toBe('fixed');
  expect(out.overlayY).toBe(0);
  expect(out.ghostW).toBeGreaterThan(0);
  expect(Math.abs(out.ghostY - out.targetY)).toBeLessThanOrEqual(2);   // tracks the element
  expect(out.ghostBottom).toBeGreaterThan(0);                          // and intersects the viewport
  expect(out.ghostY).toBeLessThan(out.winH);
});

test('HTML board: sidebar drives the document annotate instance and lists its marks', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  await expect(page.frameLocator('#wb-board-panel .wb-doc-frame').locator('h1')).toHaveText('Sample Report');

  const docState = () => page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const st = w.pinpoint.getState();
    return { mode: st.mode, count: st.count, toolbar: w.document.getElementById('ann-toolbar').style.display };
  });
  await expect.poll(() => page.evaluate(() => !!(
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint
  ))).toBe(true);

  // Embedded: the sidebar is the control surface, so the document hides its own toolbar.
  expect((await docState()).toolbar).toBe('none');
  expect((await docState()).mode).toBe(false);

  // The sidebar toggle must reach the iframe's instance, not the parent's — two
  // disconnected instances is what made "annotate mode does nothing" from the sidebar.
  await page.locator('#wbann-toggle').click();
  await expect.poll(async () => (await docState()).mode).toBe(true);
  await expect(page.locator('#wbann-toggle')).toHaveClass(/on/);
  // 模式单钮（2026-08-15）：标注中 = 实心 accent on 态
  await expect(page.locator('#wbann-toggle .wb-tool-label')).toHaveText('标注中');

  // Prior tests may have left marks on the shared on-disk doc.
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.clear();
  });
  await expect.poll(async () => (await docState()).count).toBe(0);

  // A mark made in the document must appear in the sidebar list. On a plain
  // document every mark belongs to the page — the workbench page/canvas filters
  // do not apply, and applying them made count read 0 with marks on screen.
  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    const el = d.querySelector('h1');
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: Math.round(r.x + 8), clientY: Math.round(r.y + 8), button: 0 };
    el.dispatchEvent(new w.MouseEvent('mousedown', at));
    el.dispatchEvent(new w.MouseEvent('mouseup', at));
    const ta = d.querySelector('textarea');
    ta.value = 'sidebar sync check';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    [...d.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
  });

  await expect.poll(async () => (await docState()).count).toBe(1);
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await expect(page.locator('#wbann-list')).toContainText('sidebar sync check');
});

test('HTML board: annotations redraw when an interactive view hides and returns', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  await expect(page.frameLocator('#wb-board-panel .wb-doc-frame').locator('h1')).toHaveText('Sample Report');
  await expect.poll(() => page.evaluate(() => !!(
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint
  ))).toBe(true);

  await page.locator('#wbann-toggle').click();
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.clear();
  });

  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    const el = d.querySelector('h1');
    const r = el.getBoundingClientRect();
    const at = {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(r.x + 8),
      clientY: Math.round(r.y + 8),
      button: 0,
    };
    el.dispatchEvent(new w.MouseEvent('mousedown', at));
    el.dispatchEvent(new w.MouseEvent('mouseup', at));
    const ta = d.querySelector('textarea');
    ta.value = 'interactive view redraw';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    [...d.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
  });

  const docState = () => page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    return w.pinpoint.getState();
  });
  const docTargetCount = () => page.evaluate(() => {
    const d = document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument;
    return d.querySelectorAll('#ann-marks .ann-target').length;
  });

  await expect.poll(docTargetCount).toBe(1);
  await expect.poll(async () => (await docState()).countLive).toBe(1);

  // Product navigation commonly uses hidden/class changes without scroll or
  // resize. The mark remains persisted but leaves the canvas while its target
  // is off-view; it must not be mislabeled as a broken selector.
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument.querySelector('h1').hidden = true;
  });
  await expect.poll(docTargetCount).toBe(0);
  await expect.poll(async () => (await docState()).countHidden).toBe(1);
  expect((await docState()).countBroken).toBe(0);
  await expect(page.locator('#wbann-list')).not.toContainText('锚点失效');

  // Returning to the prior product view is enough; no manual scroll, resize,
  // or pinpoint.render() call should be required.
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument.querySelector('h1').hidden = false;
  });
  await expect.poll(docTargetCount).toBe(1);
  await expect.poll(async () => (await docState()).countLive).toBe(1);
});

test('HTML board: annotations on SVG elements are not falsely broken', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  await expect(page.frameLocator('#wb-board-panel .wb-doc-frame').locator('h1')).toHaveText('Sample Report');

  await expect.poll(() => page.evaluate(() => !!(
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint
  ))).toBe(true);

  // Sidebar drives the iframe instance.
  await page.locator('#wbann-toggle').click();
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().mode
  ))).toBe(true);

  // SVG elements have no offsetParent; the old probe falsely read them as hidden
  // and showed 锚点失效 even though the hover box drew fine. The SVG chart sits at
  // the bottom of a tall doc, so scroll it into view first, then hover an SVG
  // <text> — the ghost must render (also proves the plain-doc surface fallback
  // makes body the hit surface so SVG children are selectable).
  const hover = await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    const el = [...d.querySelectorAll('#sample-chart text')].find((t) => /峰值/.test(t.textContent));
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new w.MouseEvent('mousemove', {
      bubbles: true, clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2),
    }));
    const ghost = d.querySelector('#ann-hover-layer > *');
    const g = ghost && ghost.getBoundingClientRect();
    return { ghostW: g ? Math.round(g.width) : 0, ghostHidden: ghost ? ghost.hidden : null };
  });
  expect(hover.ghostW).toBeGreaterThan(0);
  expect(hover.ghostHidden).toBe(false);

  // Click the SVG <text> and confirm the composer treats it as a live target:
  // no 锚点失效 banner, no broken pill.
  const out = await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    const el = [...d.querySelectorAll('#sample-chart text')].find((t) => /峰值/.test(t.textContent));
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true,
      clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2), button: 0 };
    el.dispatchEvent(new w.MouseEvent('mousedown', at));
    el.dispatchEvent(new w.MouseEvent('mouseup', at));
    const box = d.getElementById('ann-box');
    const pill = box && box.querySelector('.ann-target-pill');
    return {
      boxOpen: !!box,
      brokenText: /锚点失效/.test(box ? (box.textContent || '') : ''),
      pillBroken: pill ? pill.classList.contains('broken') : null,
      pillLabel: pill ? pill.textContent : null,
    };
  });
  expect(out.boxOpen).toBe(true);
  expect(out.brokenText).toBe(false);
  expect(out.pillBroken).toBe(false);
  expect(out.pillLabel).toContain('indicator');
});

test('HTML board: "render comments" toggle draws content bubbles on the canvas', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  const doc = page.frameLocator('#wb-board-panel .wb-doc-frame');
  await expect(doc.locator('h1')).toHaveText('Sample Report');

  // Seed two annotations on visible elements so bubbles have live anchors.
  await expect.poll(() => page.evaluate(() => !!(
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint
  ))).toBe(true);
  await page.locator('#wbann-toggle').click();
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().mode
  ))).toBe(true);
  // Prior tests in this suite save marks to the same on-disk doc; clear them so
  // the bubble count assertion is exact.
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.clear();
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(0);
  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    function clickEl(sel) {
      const el = d.querySelector(sel);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true,
        clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2), button: 0 };
      el.dispatchEvent(new w.MouseEvent('mousedown', at));
      el.dispatchEvent(new w.MouseEvent('mouseup', at));
      const ta = d.querySelector('textarea');
      ta.value = '评论内容 ' + sel;
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      [...d.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
    }
    clickEl('h1');
    clickEl('#s2');
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(2);

  // Toggle "render comments" from the sidebar; bubbles must appear in the doc overlay.
  // （2026-08-15：旧 #wbann-comments 钮并入「画布批注」dropdown，选「叠在页面」= on）
  await pickBubbleMode(page, 'inline');
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().renderComments
  ))).toBe(true);

  const out = await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    const bubbles = [...d.querySelectorAll('#ann-bubbles .ann-bubble')];
    const connectors = d.querySelectorAll('.ann-connector line');
    return {
      bubbleCount: bubbles.length,
      ns: bubbles.map((b) => b.getAttribute('data-n')),
      hasContent: bubbles.some((b) => /评论内容/.test(b.textContent || '')),
      connectorCount: connectors.length,
    };
  });
  expect(out.bubbleCount).toBe(2);
  expect(out.hasContent).toBe(true);
  // Live comment view has no connector lines — numbers match pin badges.
  expect(out.connectorCount).toBe(0);
  // Sidebar dropdown reflects the on state.
  await expect(page.locator('#wbann-bubble-v')).toHaveText('叠在页面');

  // Toggling off hides the bubbles.
  await pickBubbleMode(page, 'off');
  await expect.poll(() => page.evaluate(() => {
    const d = document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument;
    return d.querySelectorAll('#ann-bubbles .ann-bubble').length;
  })).toBe(0);
  await expect(page.locator('#wbann-bubble-v')).toHaveText('隐藏批注');
});

test('HTML board: 评论 inline 模式 — 气泡渲染在 iframe overlay', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  const doc = page.frameLocator('#wb-board-panel .wb-doc-frame');
  await expect(doc.locator('h1')).toHaveText('Sample Report');

  await expect.poll(() => page.evaluate(() => !!(
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint
  ))).toBe(true);
  // Enter annotate mode so clicks open the composer.
  await page.locator('#wbann-toggle').click();
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().mode
  ))).toBe(true);
  // Clean slate, then seed two annotations with live anchors.
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.clear();
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(0);
  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    function clickEl(sel) {
      const el = d.querySelector(sel);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true,
        clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2), button: 0 };
      el.dispatchEvent(new w.MouseEvent('mousedown', at));
      el.dispatchEvent(new w.MouseEvent('mouseup', at));
      const ta = d.querySelector('textarea');
      ta.value = '评论 ' + sel;
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      [...d.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
    }
    clickEl('h1');
    clickEl('#s2');
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(2);

  // Turn on render comments; the bubble dropdown must read 叠在页面 (inline).
  // （2026-08-15：#wbann-channel 钮并入 dropdown，inline/sidebar 切换走选项）
  await pickBubbleMode(page, 'inline');
  await expect(page.locator('#wbann-bubble-v')).toHaveText('叠在页面');

  // Force a narrow viewport so the natural margins can't hold a 240px bubble.
  await page.setViewportSize({ width: 1024, height: 800 });

  // 右栏上线后（2026-08-15）iframe 只剩 ~465px 宽，文档回流变高：落点 #s2 时
  // h1 已滚出视口，其气泡按「离屏即隐藏」规矩不渲染。回到文档顶部让两个锚点
  // 都在视口内再数气泡。
  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    w.document.documentElement.style.scrollBehavior = 'auto';
    w.document.documentElement.scrollTop = 0;
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // inline: bubbles render in the iframe overlay (may overlap text in a narrow window).
  const outInline = await page.evaluate(() => {
    const d = document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument;
    const bubbles = [...d.querySelectorAll('#ann-bubbles .ann-bubble')].filter((b) => !b.hidden);
    return {
      bubbleCount: bubbles.length,
      hasContent: bubbles.some((b) => /评论 h1|评论 #s2/.test(b.textContent || '')),
      hasObjectObject: bubbles.some((b) => /\[object Object\]/.test(b.textContent || '')),
      // sidebar gutter must NOT be active in inline mode
      gutterWrap: document.querySelector('.wb-stage-wrap').getAttribute('data-ann-gutter'),
    };
  });
  expect(outInline.bubbleCount).toBe(2);
  expect(outInline.hasContent).toBe(true);
  expect(outInline.hasObjectObject).toBe(false);
  expect(outInline.gutterWrap).toBe(null);

  // Toggling 评论 off clears the iframe bubbles.
  await pickBubbleMode(page, 'off');
  await expect.poll(() => page.evaluate(() => {
    const d = document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument;
    return [...d.querySelectorAll('#ann-bubbles .ann-bubble')].filter((b) => !b.hidden).length;
  })).toBe(0);
});

test('HTML board: 评论 sidebar — bubbles render in a parent gutter outside the iframe, no squeeze', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  const doc = page.frameLocator('#wb-board-panel .wb-doc-frame');
  await expect(doc.locator('h1')).toHaveText('Sample Report');

  await expect.poll(() => page.evaluate(() => !!(
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint
  ))).toBe(true);
  await page.locator('#wbann-toggle').click();
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().mode
  ))).toBe(true);
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.clear();
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(0);
  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    function clickEl(sel) {
      const el = d.querySelector(sel);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true,
        clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2), button: 0 };
      el.dispatchEvent(new w.MouseEvent('mousedown', at));
      el.dispatchEvent(new w.MouseEvent('mouseup', at));
      const ta = d.querySelector('textarea');
      ta.value = '评论 ' + sel;
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      [...d.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
    }
    clickEl('h1');
    clickEl('#s2');
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().count
  ))).toBe(2);

  await pickBubbleMode(page, 'inline');
  // Cycle inline → sidebar（dropdown 选「右侧通道」，client 侧布局名仍叫 sidebar）。
  await pickBubbleMode(page, 'chan');
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().bubbleLayout
  ))).toBe('sidebar');
  await expect(page.locator('#wbann-bubble-v')).toHaveText('右侧通道');

  // 同 inline 用例：右栏收窄 iframe 后文档回流，先把文档滚回顶部让两个锚点
  // 都在视口内（离屏锚点的气泡按规矩不渲染）。
  await page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    w.document.documentElement.style.scrollBehavior = 'auto';
    w.document.documentElement.scrollTop = 0;
  });

  // Give the parent rAF loop a couple frames to render.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const out = await page.evaluate(() => {
    const f = document.querySelector('#wb-board-panel .wb-doc-frame');
    const d = f.contentDocument;
    const wrap = document.querySelector('.wb-stage-wrap');
    const go = document.getElementById('wb-ann-gutter');
    const page = d.querySelector('.page') || d.querySelector('main') || d.body;
    const pR = page.getBoundingClientRect();
    const ifR = f.getBoundingClientRect();
    const parentBubbles = go ? [...go.querySelectorAll('.ann-bubble')] : [];
    const parentLines = go ? go.querySelectorAll('line') : [];
    const iframeBubbles = [...d.querySelectorAll('#ann-bubbles .ann-bubble')].filter((b) => !b.hidden);
    let overlap = 0;
    parentBubbles.forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.right > pR.left + 2 && r.left < pR.right - 2) overlap++;
    });
    return {
      wrapGutter: wrap.getAttribute('data-ann-gutter'),
      gutterVisible: go ? go.style.display !== 'none' : false,
      parentBubbles: parentBubbles.length,
      parentLines: parentLines.length,
      iframeBubbles: iframeBubbles.length,
      hasRealContent: parentBubbles.some((b) => /评论 h1|评论 #s2/.test(b.textContent || '')),
      hasObjectObject: parentBubbles.some((b) => /\[object Object\]/.test(b.textContent || '')),
      iframeW: Math.round(ifR.width),
      pageW: Math.round(pR.width),
      overlap,
    };
  });
  // Gutter reserved on the stage wrap; bubbles live in the parent overlay, not the iframe.
  expect(out.wrapGutter).toBe('on');
  expect(out.gutterVisible).toBe(true);
  expect(out.parentBubbles).toBe(2);
  expect(out.parentLines).toBe(0);
  expect(out.iframeBubbles).toBe(0);
  // Content renders as real text, not [object Object].
  expect(out.hasRealContent).toBe(true);
  expect(out.hasObjectObject).toBe(false);
  // Bubbles sit in the gutter, not over the text.
  expect(out.overlap).toBe(0);

  // Cycling back to inline stops the gutter and brings iframe bubbles back.
  await pickBubbleMode(page, 'inline');
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow.pinpoint.getState().bubbleLayout
  ))).toBe('inline');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const back = await page.evaluate(() => {
    const d = document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument;
    const wrap = document.querySelector('.wb-stage-wrap');
    const go = document.getElementById('wb-ann-gutter');
    return {
      wrapGutter: wrap.getAttribute('data-ann-gutter'),
      gutterVisible: go ? go.style.display !== 'none' : false,
      parentBubbles: go ? go.querySelectorAll('.ann-bubble').length : 0,
      iframeBubbles: [...d.querySelectorAll('#ann-bubbles .ann-bubble')].filter((b) => !b.hidden).length,
    };
  });
  expect(back.wrapGutter).toBe(null);
  expect(back.gutterVisible).toBe(false);
  expect(back.parentBubbles).toBe(0);
  expect(back.iframeBubbles).toBe(2);
});

test('screen loader rejects a dev-server fallback document instead of nesting the workbench', async ({ page }) => {
  await page.route('**/previews/library/home.html', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>pinpoint</title></head><body><div id="wbroot" class="wb"><aside class="wb-side">Sidebar</aside></div></body></html>',
  }));

  await openWorkbench(page);

  const frame = page.locator('#wb-board-panel [data-screen="home"]');
  await expect(frame.locator('.wb-screen-err')).toContainText('full HTML document');
  await expect(frame.locator('#wbroot, .wb-side')).toHaveCount(0);
});

test('interactive frames: inline script (form A) and sidecar mount (form B) respond', async ({ page }) => {
  await openWorkbench(page);

  // Form A — recipe.html carries an inline data-preview-script that cycles the ratio chip.
  const ratio = page.locator('#wb-board-panel [data-screen="recipe"] [data-ratio]');
  await expect(ratio).toHaveText('1:15');
  await page.locator('#wb-board-panel [data-screen="recipe"] [data-ratio-cycle]').click();
  await expect(ratio).toHaveText('1:16');

  // Form B — timer.html marks data-preview-mount, so workbench imports timer.js.
  const timerRoot = page.locator('#wb-board-panel [data-screen="timer"] [data-preview-mount]');
  await expect(timerRoot).toHaveAttribute('data-timer-state', 'idle');
  const toggle = page.locator('#wb-board-panel [data-screen="timer"] [data-timer-toggle]');
  await toggle.click();
  await expect(timerRoot).toHaveAttribute('data-timer-state', 'running');
  await expect(toggle).toHaveText('暂停');
  await toggle.click();
  await expect(timerRoot).toHaveAttribute('data-timer-state', 'paused');
  await page.locator('#wb-board-panel [data-screen="timer"] [data-timer-reset]').click();
  await expect(timerRoot).toHaveAttribute('data-timer-state', 'idle');
});

test('Frame export snapshots current state and renders an isolated padded PNG', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wb-board-panel [data-screen="recipe"] [data-ratio-cycle]').click();

  const snapshot = await page.evaluate(() => window.workbench.exportSnapshot({
    kind: 'frame', sectionId: 'brew-flow', screenId: 'recipe', format: 'png', scale: 2, background: 'canvas',
  }));
  expect(snapshot.format).toBe('png');
  expect(snapshot.html).toContain('1:16');
  expect(snapshot.html).toContain('ios-stage');
  expect((snapshot.html.match(/ios-stage/g) || [])).toHaveLength(1);
  expect(snapshot.html).not.toContain('data-export-ui');
  expect(snapshot.html).not.toContain('wb-frame-note-edit');
  // 图纸内容永随（decisions 2026-08-15d）：图注（引用号 B2 + 屏名）与尺寸行随导出；
  // 空 Frame Note（占位文案）不是图纸内容，不进快照。
  expect(snapshot.html).toContain('wb-cap-ref');
  expect(snapshot.html).toContain('B2');
  expect(snapshot.html).toContain('wb-screen-dim');
  expect(snapshot.html).not.toContain('data-frame-note');

  const response = await page.request.post('/api/export-image', { data: snapshot });
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toBe('image/png');
  expect(response.headers()['x-export-width']).toBe('1068');
  expect(response.headers()['x-export-height']).toBe('2226');
  const body = await response.body();
  expect(body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test('Section export always carries captions and Frame Notes (图纸内容永随)', async ({ page }) => {
  const note = '场景：用户点开通知。\n交互：进入对应会话。';
  await page.route('**/previews/library/board.json', async (route) => {
    const response = await route.fetch();
    const board = await response.json();
    board.sections[1].screens[2].note = note; // brew-flow / timer
    await route.fulfill({ response, json: board });
  });
  await openWorkbench(page);
  await expect(page.locator('#wb-board-panel .wb-lib-item[data-ann-section="brew-flow"]')).toBeVisible();

  const explained = await page.evaluate(() => window.workbench.exportSnapshot({
    kind: 'section', sectionId: 'brew-flow', format: 'png', scale: 1, background: 'white',
  }));
  expect(explained.html).toContain('wb-lib-cap');
  expect(explained.html).toContain('wb-screen-cap');
  expect(explained.html).toContain('wb-screen-dim');
  expect(explained.html).toContain('data-frame-note');
  expect(explained.html).toContain('场景：用户点开通知。');
  expect(explained.html).not.toContain('wb-frame-note-edit');
  expect(explained.html).not.toContain('wb-frame-note-editor');
  // 干净画面语义已拆除（decisions 2026-08-15d）：不再有 clean-row 覆写
  expect(explained.html).not.toContain('wb-export-clean-row');

  // 空 note（占位）不进导出
  const plain = await page.evaluate(() => window.workbench.exportSnapshot({
    kind: 'section', sectionId: 'home', format: 'png', scale: 1, background: 'white',
  }));
  expect(plain.html).not.toContain('data-frame-note');
});

test('every Frame exposes a persistent title menu (export entry retired to the HUD picker)', async ({ page }) => {
  await openWorkbench(page);
  const frame = page.locator('#wb-board-panel [data-screen="home"]');
  const trigger = frame.locator('.wb-frame-menu-trigger');
  await expect(trigger).toBeVisible();
  expect(Number(await trigger.evaluate((element) => getComputedStyle(element).opacity))).toBeGreaterThan(0.5);

  await trigger.click();
  const menu = frame.locator('.wb-frame-menu');
  await expect(menu).toBeVisible();
  // decisions 2026-08-15d：菜单里的导出入口删除（唯一入口 = HUD「导出」→ picker），
  // 剩余项（复制 @frame）保留。旧用例的 elementFromPoint hit-test 是已知 flake，随重写收编。
  await expect(menu.locator('[data-frame-export]')).toHaveCount(0);
  await expect(menu.locator('[role="menuitem"]')).toHaveCount(1);
  await expect(menu.locator('[data-frame-copy]')).toContainText('复制 @frame');
  expect(await menu.evaluate((element) => {
    const style = getComputedStyle(element);
    const channels = style.backgroundColor.match(/[\d.]+/g) || [];
    return {
      alpha: channels.length > 3 ? Number(channels[3]) : 1,
      backdropFilter: style.backdropFilter,
    };
  })).toEqual({ alpha: 1, backdropFilter: 'none' });
});

test('Frame Note renders below a frame and inline edits use the shared revision', async ({ page }) => {
  const initial = '场景：会议刚刚结束。';
  const revised = '场景：会议刚刚结束。\n交互：点击 Suggested Prompt。';
  let savedBody = null;

  await page.route('**/previews/library/board.json', async (route) => {
    const response = await route.fetch();
    const board = await response.json();
    const home = board.sections[0].screens[0];
    home.note = initial;
    await route.fulfill({ response, json: board });
  });
  await page.route('**/api/frame-notes/library/home', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { pageId: 'library', screenId: 'home', note: initial, revision: 'revision-1' } });
      return;
    }
    savedBody = route.request().postDataJSON();
    await route.fulfill({ json: { pageId: 'library', screenId: 'home', note: revised, revision: 'revision-2' } });
  });

  await openWorkbench(page);
  const frame = page.locator('#wb-board-panel [data-screen="home"]');
  await expect(frame.locator('[data-frame-note-text]')).toHaveText(initial);
  await frame.locator('[data-frame-note-action="edit"]').click();
  await frame.locator('[data-frame-note-input]').fill(revised);
  await frame.locator('[data-frame-note-action="save"]').click();
  await expect(frame.locator('[data-frame-note-text]')).toHaveText(revised);
  expect(savedBody).toEqual({ note: revised, baseRevision: 'revision-1' });
});

test('persistent canvas toolbar supports continuous section nav and layered minimap', async ({ page }) => {
  await openWorkbench(page);
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  // 钉住 100% 缩放：本用例的 scrollTop 阈值断言依赖 zoom=1 的几何
  // （2026-08-16 起首访默认缩放 50%，HUD label 单击 = 重置为 100%）。
  await page.locator('#wbzoom-label').click();

  const toolbar = page.locator('#wbcanvas-hud');
  const minimapTool = page.locator('#wbminimap-wrap');
  const minimapToggle = page.locator('#wbminimap-toggle');
  const minimap = page.locator('#wbminimap');
  const navigatorToggle = page.locator('#wbsection-nav-toggle');
  const navigator = page.locator('#wbsection-nav');

  await expect(toolbar).toBeVisible();
  await expect(minimapTool).toBeVisible();
  await expect(minimap).toBeHidden();
  await expect(navigatorToggle).toBeVisible();
  await expect(navigatorToggle).toContainText('1 / 6');

  await navigatorToggle.click();
  await expect(navigator).toBeVisible();
  await expect(navigator.locator('.wb-section-nav-item')).toHaveCount(6);
  await expect(navigator.locator('.wb-section-nav-label')).toHaveText([
    '首页 · 卡片 / 列表 / Tab / Sheet',
    '冲一杯 · 三步流程',
    '锁屏 → 消息 → 回复',
    '锁屏 · 通知',
    'AB · 冲煮完成卡两案',
    '设置 · 分组列表',
  ]);
  await expect(minimap).toBeHidden();

  // Row screens use display:contents; navigation must target their concrete frame box.
  await navigator.locator('[data-nav-screen="msg-thread"]').click();
  await expectFocusedTarget(page, '[data-screen="msg-thread"] .ios-stage');
  await navigator.locator('[data-nav-screen="ab-b"]').click();
  await expectFocusedTarget(page, '[data-screen="ab-b"] .ios-stage');

  await navigator.locator('[data-nav-screen="settings"]').click();
  await expect(navigator).toBeVisible();
  await expectFocusedTarget(page, '[data-screen="settings"] .ios-stage');
  await expect.poll(() => page.locator('.wb-section-nav-item.on').getAttribute('data-nav-group')).toBe('settings');
  await expect.poll(() => page.locator('#wbstage').evaluate((stage) => stage.scrollTop)).toBeGreaterThan(3000);

  await navigator.locator('.wb-section-nav-section[data-nav-group="home"]').click();
  await expect(navigator).toBeVisible();
  await expectFocusedTarget(page, '#lib-home');
  await expect.poll(() => page.locator('.wb-section-nav-item.on').getAttribute('data-nav-group')).toBe('home');

  for (let i = 0; i < 4; i++) await page.locator('#wbzoom-out').click();
  await navigator.locator('[data-nav-screen="msg-reply"]').click();
  await expectFocusedTarget(page, '[data-screen="msg-reply"] .ios-stage');

  await minimapToggle.click();
  await expect(navigator).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(minimap).toHaveAttribute('data-minimap-levels', 'canvas section frame');
  await expect(minimap).toHaveAttribute('data-minimap-section-count', '6');
  await expect(minimap).toHaveAttribute('data-minimap-frame-count', '11');
  await expect(minimap.locator('canvas')).toBeVisible();
  await minimap.locator('canvas').click({ position: { x: 104, y: 66 } });
  await expect(minimap).toBeVisible();
  await expect(navigator).toBeVisible();

  const dockLayout = await page.evaluate(() => {
    const navigatorRect = document.querySelector('#wbsection-nav').getBoundingClientRect();
    const minimapRect = document.querySelector('#wbminimap').getBoundingClientRect();
    const toolbarRect = document.querySelector('#wbcanvas-hud').getBoundingClientRect();
    return {
      navigatorBottom: navigatorRect.bottom,
      navigatorRight: navigatorRect.right,
      navigatorWidth: navigatorRect.width,
      minimapTop: minimapRect.top,
      minimapRight: minimapRect.right,
      minimapWidth: minimapRect.width,
      toolbarRight: toolbarRect.right,
      toolOrder: [...document.querySelectorAll('#wbcanvas-hud .wb-toolbar-tool-btn')].map((button) => button.id),
    };
  });
  expect(dockLayout.navigatorBottom).toBeLessThanOrEqual(dockLayout.minimapTop);
  expect(dockLayout.navigatorRight).toBeCloseTo(dockLayout.minimapRight, 0);
  expect(dockLayout.navigatorWidth).toBeCloseTo(dockLayout.minimapWidth, 1);
  expect(dockLayout.minimapRight).toBeCloseTo(dockLayout.toolbarRight, 0);
  expect(dockLayout.toolOrder).toEqual(['wbsection-nav-toggle', 'wbminimap-toggle']);

  await page.locator('#wbzoom-label').click();
  await expect(navigator).toBeVisible();
  await expect(minimap).toBeVisible();

  await page.locator('#wbpages [data-vpage="components"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="button/catalog"]')).toBeVisible();
  await expect(navigator).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(page.locator('.wb-section-nav-item')).toHaveCount(10);
  await expect(navigatorToggle).toContainText('1 / 10');
  await expect(minimap).toHaveAttribute('data-minimap-section-count', '10');
  await expect(minimap).toHaveAttribute('data-minimap-frame-count', '12');
  await expect(toolbar).toBeVisible();

  await navigator.locator('[data-nav-screen="nav/large"]').click();
  await expectFocusedTarget(page, '[data-screen="nav/large"] .wb-comp-stage');

  for (const [pageId, screenId, frameSelector] of [
    ['library', 'timer', '.ios-stage'],
    ['components', 'bubble/outgoing', '.wb-comp-stage'],
  ]) {
    await page.locator(`#wbpages [data-vpage="${pageId}"]`).click();
    await expect(page.locator(`#wb-board-panel [data-screen="${screenId}"]`)).toBeVisible();
    const navTarget = navigator.locator(`[data-nav-screen="${screenId}"]`);
    await navTarget.scrollIntoViewIfNeeded();
    await navTarget.click();
    await expectFocusedTarget(page, `[data-screen="${screenId}"] ${frameSelector}`);
    await expect(navigator).toBeVisible();
    await expect(minimap).toBeVisible();
  }

  await navigatorToggle.click();
  await expect(navigator).toBeHidden();
  await expect(minimap).toBeVisible();
  await minimapToggle.click();
  await expect(minimap).toBeHidden();
});

test('queued annotation saves survive own SSE, sync to another window, and clear through save', async ({ browser }) => {
  const context = await browser.newContext();
  const writer = await context.newPage();
  const observer = await context.newPage();
  await openWorkbench(writer);
  await openWorkbench(observer);

  let releaseFirstSave;
  let signalFirstSave;
  const firstSaveStarted = new Promise((resolve) => { signalFirstSave = resolve; });
  const releaseFirst = new Promise((resolve) => { releaseFirstSave = resolve; });
  let saveCount = 0;
  await writer.route('**/save', async (route) => {
    saveCount++;
    if (saveCount === 1) {
      signalFirstSave();
      await releaseFirst;
    }
    await route.continue();
  });

  await writer.evaluate(() => window.pinpoint.setMode(true));
  const cells = writer.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await saveAnnotation(writer, cells.nth(0), 'first queued mark');
  await firstSaveStarted;
  await saveAnnotation(writer, cells.nth(1), 'second queued mark');
  releaseFirstSave();

  await expect.poll(() => writer.evaluate(() => window.pinpoint.marks.length)).toBe(2);
  await expect.poll(() => observer.evaluate(() => window.pinpoint.marks.length)).toBe(2);

  await writer.reload();
  await writer.waitForFunction(() => window.pinpoint);
  await expect.poll(() => writer.evaluate(() => window.pinpoint.marks.length)).toBe(2);

  await writer.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => observer.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  const removedEndpoint = await writer.request.post('/clear', { data: { page: 'index' } });
  expect(removedEndpoint.status()).toBe(404);

  await context.close();
});

test('sidebar annotation navigation focuses the owning frame, not the comment anchor', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await page.evaluate(() => window.pinpoint.setMode(true));

  const target = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell').first();
  await target.scrollIntoViewIfNeeded();
  await saveAnnotation(page, target, '这个 cell 需要更清楚');
  await page.locator('#wbstage').evaluate((stage) => stage.scrollTo({ top: 0, left: 0 }));

  await page.locator('#wbann-list .wb-ann-item-main').click();
  await page.waitForTimeout(350); // prove no earlier section-scroll animation can pull focus away
  await expectFocusedTarget(page, '[data-screen="settings"] .ios-stage');
  await expect(page.locator('#ann-box')).toBeVisible();

  // A small anchor should remain away from viewport center when its full phone is focused.
  await expect.poll(() => page.evaluate(() => {
    const stage = document.querySelector('#wbstage').getBoundingClientRect();
    const cell = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-cell').getBoundingClientRect();
    return Math.abs((cell.top + cell.height / 2) - (stage.top + stage.height / 2));
  })).toBeGreaterThan(100);

  await page.evaluate(() => window.pinpoint.clear());
});

test('bottom composer keeps focus while canvas clicks attach and inline targets', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await page.evaluate(() => window.pinpoint.setMode(true));

  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).click();

  const box = page.locator('#ann-box');
  const textarea = box.locator('textarea');
  await expect(box).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(box.locator('.ann-target-pill')).toHaveCount(1);
  await expect(box.locator('#ann-target-mode-reference')).toHaveClass(/on/);

  const composerLayout = await page.evaluate(() => {
    const wrap = document.querySelector('.wb-stage-wrap').getBoundingClientRect();
    const composer = document.querySelector('#ann-box').getBoundingClientRect();
    const hud = document.querySelector('#wbcanvas-hud').getBoundingClientRect();
    const stage = document.querySelector('#wbstage');
    return {
      insideBottom: composer.bottom <= wrap.bottom,
      aboveHud: composer.bottom <= hud.top,
      scrollPaddingBottom: parseFloat(getComputedStyle(stage).scrollPaddingBottom),
      composerHeight: composer.height,
    };
  });
  expect(composerLayout.insideBottom).toBe(true);
  expect(composerLayout.aboveHud).toBe(true);
  expect(composerLayout.scrollPaddingBottom).toBeGreaterThan(composerLayout.composerHeight);

  await page.locator('#wbsection-nav-toggle').click();
  await expect(page.locator('#wbsection-nav')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const composer = document.querySelector('#ann-box').getBoundingClientRect();
    const dock = document.querySelector('#wbcanvas-dock').getBoundingClientRect();
    return composer.right <= dock.left;
  })).toBe(true);

  await textarea.fill('把颜色对齐');
  await textarea.evaluate((el) => el.setSelectionRange(0, 0));
  await cells.nth(1).click();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue('把颜色对齐');
  await expect(box.locator('.ann-target-pill')).toHaveCount(2);

  await box.locator('#ann-target-mode-inline').click();
  await expect(textarea).toBeFocused();
  await textarea.dispatchEvent('compositionstart');
  await cells.nth(2).click();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue('把颜色对齐');
  await textarea.dispatchEvent('compositionend');
  await expect(textarea).toHaveValue('[indicator 3] 把颜色对齐');
  await expect(box.locator('.ann-target-pill')).toHaveCount(3);

  await box.locator('#ann-save').click();
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks[0])).toMatchObject({
    content: '[@t:i3] 把颜色对齐',
    selector: expect.any(String),
    targets: [
      { ref: 'i1', selector: expect.any(String), text: expect.any(String) },
      { ref: 'i2', selector: expect.any(String), text: expect.any(String) },
      { ref: 'i3', selector: expect.any(String), text: expect.any(String) },
    ],
  });

  await page.locator('.ann-badge').first().click();
  await expect(box).toBeVisible();
  await expect(textarea).toHaveValue('[indicator 3] 把颜色对齐');
  await expect(box.locator('#ann-target-mode-inline')).toHaveClass(/on/);
  await expect(box.locator('.ann-target-pill')).toHaveCount(3);
});

test('composer moves only from its drag handle and stays fixed in the viewport', async ({ page }) => {
  await openWorkbench(page);
  // 双栏布局（2026-08-15）在默认 1280 宽下舞台只剩 ~715px，composer（max 720）
  // 几乎顶满，水平拖拽无可移动空间。拉宽视口让水平位移成立（后续窄视口钳位
  // 断言不受影响）。
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));

  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).click();
  const box = page.locator('#ann-box');
  const textarea = box.locator('textarea');
  const handle = box.locator('.ann-drag-handle');
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('aria-label', '拖动标注框');

  const before = await box.boundingBox();
  const handleRect = await handle.boundingBox();
  await page.mouse.move(handleRect.x + handleRect.width / 2, handleRect.y + handleRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleRect.x - 150, handleRect.y - 110, { steps: 6 });
  await page.mouse.up();

  const moved = await box.boundingBox();
  expect(Math.abs(moved.x - before.x)).toBeGreaterThan(80);
  expect(Math.abs(moved.y - before.y)).toBeGreaterThan(60);
  await expect(textarea).toBeFocused();

  const textareaRect = await textarea.boundingBox();
  await page.mouse.move(textareaRect.x + 30, textareaRect.y + 24);
  await page.mouse.down();
  await page.mouse.move(textareaRect.x + 100, textareaRect.y + 24, { steps: 4 });
  await page.mouse.up();
  const afterTextareaDrag = await box.boundingBox();
  expect(afterTextareaDrag.x).toBeCloseTo(moved.x, 0);
  expect(afterTextareaDrag.y).toBeCloseTo(moved.y, 0);

  await page.locator('#wbstage').evaluate((stage) => { stage.scrollTop += 300; });
  const afterCanvasScroll = await box.boundingBox();
  expect(afterCanvasScroll.x).toBeCloseTo(moved.x, 0);
  expect(afterCanvasScroll.y).toBeCloseTo(moved.y, 0);

  await textarea.fill('记住这个位置');
  await box.locator('#ann-save').click();
  await page.evaluate(() => window.pinpoint.openMark(window.pinpoint.marks[0].n));
  const reopened = await box.boundingBox();
  expect(reopened.x).toBeCloseTo(moved.x, 0);
  expect(reopened.y).toBeCloseTo(moved.y, 0);

  await page.setViewportSize({ width: 820, height: 700 });
  await expect.poll(() => page.evaluate(() => {
    const wrap = document.querySelector('.wb-stage-wrap').getBoundingClientRect();
    const composer = document.querySelector('#ann-box').getBoundingClientRect();
    return composer.left >= wrap.left + 11
      && composer.right <= wrap.right - 11
      && composer.top >= wrap.top + 11
      && composer.bottom <= wrap.bottom - 11;
  })).toBe(true);
  const narrow = await box.boundingBox();

  await page.setViewportSize({ width: 1280, height: 700 });
  await expect.poll(async () => (await box.boundingBox()).width).toBeGreaterThan(narrow.width + 100);
});

test('target pills locate, remove inline refs, and cancel existing edits', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await page.evaluate(() => window.pinpoint.setMode(true));

  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).click();
  const box = page.locator('#ann-box');
  const textarea = box.locator('textarea');
  await box.locator('.ann-target-pill').hover();
  await box.locator('.ann-target-remove').click();
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);

  await cells.nth(0).click();
  await box.locator('#ann-target-mode-inline').click();
  await textarea.fill('参考 ');
  await textarea.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await cells.nth(1).click();
  await expect(textarea).toHaveValue('参考 [indicator 2] ');

  const secondPill = box.locator('.ann-target-pill[data-target-ref="i2"]');
  await secondPill.hover();
  await expect(page.locator('.ann-hover-ghost')).not.toHaveAttribute('hidden', '');
  await secondPill.click();
  await expect(textarea).toBeFocused();
  await secondPill.locator('.ann-target-remove').click();
  await expect(textarea).toHaveValue('参考 ');
  await expect(box.locator('.ann-target-pill')).toHaveCount(1);

  await cells.nth(2).click();
  await expect(box.locator('.ann-target-pill[data-target-ref="i3"]')).toHaveCount(1);
  await expect(textarea).toHaveValue('参考 [indicator 3] ');
  await box.locator('.ann-target-pill[data-target-ref="i3"]').hover();
  await box.locator('.ann-target-pill[data-target-ref="i3"] .ann-target-remove').click();
  await expect(textarea).toHaveValue('参考 ');

  await textarea.fill('已保存');
  await box.locator('#ann-save').click();
  await page.locator('.ann-badge').first().click();
  await box.locator('.ann-target-pill').hover();
  await box.locator('.ann-target-remove').click();
  await expect(box).toBeVisible();
  await expect(box.locator('.ann-target-pill')).toHaveCount(1);
  await textarea.fill('不应保存');
  await box.locator('#ann-cancel').click();
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks[0].content)).toBe('已保存');

  await page.locator('.ann-badge').first().click();
  await textarea.fill('换页也不应保存');
  await page.evaluate(() => window.workbench.setActivePage('components'));
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks[0].content)).toBe('已保存');
});

test('frame scroll updates mark geometry and hides marks outside the phone clip', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));

  // Ensure the settings phone can scroll far enough for a top cell to leave the clip.
  await page.evaluate(() => {
    const app = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-app');
    if (!app) return;
    const pad = document.createElement('div');
    pad.setAttribute('data-e2e-scroll-pad', '');
    pad.style.height = '1200px';
    app.appendChild(pad);
  });

  const cell = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell').first();
  await cell.scrollIntoViewIfNeeded();
  await saveAnnotation(page, cell, '跟着滚');

  const badge = page.locator('.ann-badge').first();
  const frame = page.locator('.ann-target').first();
  await expect(badge).toBeVisible();
  await expect(frame).toBeVisible();

  const before = await page.evaluate(() => {
    const target = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-cell');
    const mark = document.querySelector('.ann-target');
    const b = document.querySelector('.ann-badge');
    return {
      targetTop: target.getBoundingClientRect().top,
      markTop: mark.getBoundingClientRect().top,
      badgeTop: parseFloat(b.style.top),
    };
  });

  await page.evaluate(() => {
    const app = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-app');
    app.scrollTop += 120;
  });

  await expect.poll(() => page.evaluate((prev) => {
    const target = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-cell');
    const mark = document.querySelector('.ann-target');
    if (!target || !mark || getComputedStyle(mark).display === 'none') return Infinity;
    const targetDelta = target.getBoundingClientRect().top - prev.targetTop;
    const markDelta = mark.getBoundingClientRect().top - prev.markTop;
    return Math.abs(markDelta - targetDelta);
  }, before)).toBeLessThan(3);

  // Scroll until the annotated cell is fully above the phone clip.
  await page.evaluate(() => {
    const app = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-app');
    app.scrollTop = app.scrollHeight;
  });

  await expect.poll(() => page.evaluate(() => {
    const mark = document.querySelector('.ann-target');
    const b = document.querySelector('.ann-badge');
    return getComputedStyle(mark).display === 'none'
      && getComputedStyle(b).display === 'none';
  })).toBe(true);

  // Sidebar still lists the mark (scrolled-out ≠ broken).
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(1);

  await page.evaluate(() => {
    const app = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-app');
    app.scrollTop = 0;
  });

  await expect.poll(() => page.evaluate(() => {
    const mark = document.querySelector('.ann-target');
    const b = document.querySelector('.ann-badge');
    return getComputedStyle(mark).display !== 'none'
      && getComputedStyle(b).display !== 'none';
  })).toBe(true);
});

test('sheet captions, outline tree, and right annotation panel (2026-08-15 侧栏重构)', async ({ page }) => {
  await openWorkbench(page);

  // 画布图注：section 字母 + frame 引用号两行，尺寸下置（402 × 874 = iPhone 16 Pro 逻辑分辨率）
  const recipe = page.locator('#wb-board-panel [data-screen="recipe"]');
  await expect(recipe.locator('.wb-screen-cap .wb-cap-ref')).toHaveText('B2');
  await expect(recipe.locator('.wb-screen-cap .wb-cap-title')).toHaveText('2 · 参数（内联脚本）');
  await expect(recipe.locator('.wb-screen-dim')).toHaveText('402 × 874');
  await expect(page.locator('#lib-brew-flow .wb-lib-cap .wb-cap-ref')).toHaveText('B');

  // 大纲：section → frame 树，引用号纯派生自 board 顺序
  const outline = page.locator('#wboutline');
  await expect(outline.locator('.ol')).toHaveCount(6);
  await expect(outline.locator('.ol-sec .ol-L')).toHaveText(['A', 'B', 'C', 'D', 'E', 'F']);
  await expect(outline.locator('[data-ol-frame="recipe"] .no')).toHaveText('B2');
  await expect(outline.locator('[data-ol-frame="msg-reply"] .no')).toHaveText('C3');

  // 点击大纲行 = 定位 frame + 机身 flash 环 + 行选中（flash 类同步打上，先断它再断滚动到位）
  await outline.locator('[data-ol-frame="msg-reply"]').click();
  await expect(page.locator('[data-screen="msg-reply"] .ios-stage')).toHaveClass(/wb-frame-flash/);
  await expectFocusedTarget(page, '[data-screen="msg-reply"] .ios-stage');
  await expect(outline.locator('[data-ol-frame="msg-reply"]')).toHaveClass(/on/);

  // 干净起点（共享落盘文档，前面的用例可能留标注）
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await expect(page.locator('#wbann-toggle .wb-tool-label')).toHaveText('标注中');

  // 在 settings（F1）上落一条标注 → 大纲徽标计数 + 右栏按 frame 分组（eyebrow = 引用号 + 屏名）
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'outline sync mark');
  await expect(outline.locator('[data-ol-frame="settings"] .ol-n')).toHaveText('1');
  await expect(page.locator('#wbann-count')).toHaveText('1');
  await expect(page.locator('#wbann-status')).toHaveText('共 1 条');
  await expect(page.locator('#wbann-list .wb-ann-group')).toHaveText(['F1 settings']);
  await expect(page.locator('#wbann-list .wb-ann-cap')).toHaveText(/^F1 \/ /);

  // 标注卡 → 定位 + 焦点双向同步：卡 on、大纲行 on、画布聚焦到 owning frame
  await page.locator('#wbstage').evaluate((stage) => stage.scrollTo({ top: 0, left: 0 }));
  await page.locator('#wbann-list .wb-ann-item-main').click();
  await expectFocusedTarget(page, '[data-screen="settings"] .ios-stage');
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveClass(/wb-ann-item--on/);
  await expect(outline.locator('[data-ol-frame="settings"]')).toHaveClass(/on/);

  // 右栏整栏折叠 → 画布右缘浮钮（带计数）；左栏折叠 → 左缘浮钮；双双复开
  await page.locator('#wbann-side-toggle').click();
  await expect(page.locator('#wbann-side')).toBeHidden();
  await expect(page.locator('#wbann-expand')).toBeVisible();
  await expect(page.locator('#wbann-expand-n')).toHaveText('1');
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeHidden();
  await expect(page.locator('#wbside-expand')).toBeVisible();
  await page.locator('#wbside-expand').click();
  await expect(page.locator('#wbside')).toBeVisible();
  await page.locator('#wbann-expand').click();
  await expect(page.locator('#wbann-side')).toBeVisible();

  // 清空 = 两段确认：首击 armed（确认清空），再击才执行
  await page.locator('#wbann-clear').click();
  await expect(page.locator('#wbann-clear')).toHaveText('确认清空');
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await page.locator('#wbann-clear').click();
  await expect(page.locator('#wbann-clear')).toHaveText('清空标注');
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
});

test('right splitter drags the annotation panel within 260–440, with keyboard steps', async ({ page }) => {
  await openWorkbench(page);
  const panel = page.locator('#wbann-side');
  const split = page.locator('#wbannsplit');
  await expect(panel).toBeVisible();
  expect(await annPanelWidth(page)).toBe(308);
  await expect(split).toHaveAttribute('aria-valuemin', '260');
  await expect(split).toHaveAttribute('aria-valuemax', '440');
  await expect(split).toHaveAttribute('aria-valuenow', '308');

  // 左拖 = 变宽（右栏锚右缘）：308 + 200 = 508 → clamp 440
  await dragAnnSplitter(page, -200);
  expect(await annPanelWidth(page)).toBe(440);
  await expect(split).toHaveAttribute('aria-valuenow', '440');

  // 右拖 400：440 - 400 = 40 → clamp 260，落盘偏好同步
  await dragAnnSplitter(page, 400);
  expect(await annPanelWidth(page)).toBe(260);
  await expect(split).toHaveAttribute('aria-valuenow', '260');
  await expect.poll(async () => (await readWbPrefs(page)).annPanelWidth).toBe(260);

  // 键盘：ArrowLeft = 变宽 16，Shift+ArrowLeft = 40；ArrowRight = 收窄
  await split.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => annPanelWidth(page)).toBe(276);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => annPanelWidth(page)).toBe(316);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => annPanelWidth(page)).toBe(300);
  await expect.poll(async () => (await readWbPrefs(page)).annPanelWidth).toBe(300);
});

test('annotation panel crosses the 280 compact breakpoint both ways', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'compact breakpoint mark');
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);

  const panel = page.locator('#wbann-side');
  const cap = page.locator('#wbann-list .wb-ann-cap');
  const bubbleLabel = page.locator('#wbann-bubble .wb-ann-bubble-lbl');
  const textLineClamp = () => page.evaluate(
    () => getComputedStyle(document.querySelector('#wbann-list .wb-ann-text')).webkitLineClamp
  );
  await expect(panel).not.toHaveClass(/compact/);
  await expect(cap).toBeVisible();
  await expect(bubbleLabel).toBeVisible();
  await expect.poll(textLineClamp).toBe('2');

  // 308 → 右拖 40 = 268 < 280：藏 cap、文本单行 truncate、dropdown 藏「画布批注」文案
  await dragAnnSplitter(page, 40);
  expect(await annPanelWidth(page)).toBe(268);
  await expect(panel).toHaveClass(/compact/);
  await expect(cap).toBeHidden();
  await expect(bubbleLabel).toBeHidden();
  await expect(page.locator('#wbann-bubble-v')).toBeVisible();
  await expect.poll(textLineClamp).toBe('1');

  // 拖回 ≥280 自动恢复
  await dragAnnSplitter(page, -80);
  expect(await annPanelWidth(page)).toBe(348);
  await expect(panel).not.toHaveClass(/compact/);
  await expect(cap).toBeVisible();
  await expect(bubbleLabel).toBeVisible();
  await expect.poll(textLineClamp).toBe('2');

  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
});

test('double-clicking the right splitter resets the panel to the 308 default', async ({ page }) => {
  await openWorkbench(page);
  await dragAnnSplitter(page, -120);
  expect(await annPanelWidth(page)).toBe(428);
  await page.locator('#wbannsplit').dblclick();
  await expect.poll(() => annPanelWidth(page)).toBe(308);
  await expect(page.locator('#wbannsplit')).toHaveAttribute('aria-valuenow', '308');
  await expect.poll(async () => (await readWbPrefs(page)).annPanelWidth).toBe(308);
});

test('annotation panel width preference survives a reload', async ({ page }) => {
  await openWorkbench(page);
  await dragAnnSplitter(page, -72);
  expect(await annPanelWidth(page)).toBe(380);
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect.poll(() => annPanelWidth(page)).toBe(380);
  await expect(page.locator('#wbannsplit')).toHaveAttribute('aria-valuenow', '380');
});

test('dragging the right splitter while collapsed expands the panel and follows the pointer', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbann-side-toggle').click();
  await expect(page.locator('#wbann-side')).toBeHidden();

  // 折叠 = 宽 0；左拖 50 → 取消折叠，从 0 跟手 → clamp 260
  await dragAnnSplitter(page, -50);
  await expect(page.locator('#wbann-side')).toBeVisible();
  expect(await annPanelWidth(page)).toBe(260);
  await expect.poll(async () => (await readWbPrefs(page)).annPanelCollapsed).toBe(false);
  await expect.poll(async () => (await readWbPrefs(page)).annPanelWidth).toBe(260);
});

test('first visit lands focused on the first frame at the 50% default zoom', async ({ page }) => {
  // 2026-08-16 TODO 小修（owner 拍板）：首访（无 pageViewports 存档）切页/首屏
  // 直接聚焦第一个 section 的第一个 frame；默认缩放 50%；回访仍恢复存档视口。
  await openWorkbench(page);
  await expect(page.locator('#wbzoom-label')).toHaveText('50%');
  // 第一个 section = home，第一帧 = home 屏：首访即居中，不再停在板原点
  await expectFocusedTarget(page, '[data-screen="home"] .ios-stage');
  await expect.poll(() => page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--wb-board-zoom').trim()
  )).toBe('0.5');

  // 回访语义不变：手动挪走再切回，恢复的是存档位置而不是首访聚焦
  await page.locator('#wbzoom-label').click(); // 100%（存档 zoom=1）
  await page.locator('#wbpages [data-vpage="components"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="button/catalog"]')).toBeVisible();
  await page.locator('#wbpages [data-vpage="library"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wbzoom-label')).toHaveText('100%');
});

test('left sidebar kind pill collapses to icon-only below 230 and restores', async ({ page }) => {
  await openWorkbench(page);
  const side = page.locator('#wbside');
  const kindText = page.locator('#wbpages [data-vpage="library"] .wb-page-kind-t');

  // 默认 250：pill = 图标 + 文字，等宽 40px
  expect(await sideWidth(page)).toBe(250);
  await expect(side).not.toHaveClass(/compact/);
  await expect(kindText).toBeVisible();
  const fullWidths = await page.locator('#wbpages .wb-page-kind').evaluateAll(
    (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  expect(new Set(fullWidths).size).toBe(1);
  expect(fullWidths[0]).toBe(40);

  // 左拖 120：250 - 120 = 130 → clamp 200 < 230，pill 收 20px 纯图标块
  await dragSideSplitter(page, -120);
  expect(await sideWidth(page)).toBe(200);
  await expect(side).toHaveClass(/compact/);
  await expect(kindText).toBeHidden();
  const compactWidths = await page.locator('#wbpages .wb-page-kind').evaluateAll(
    (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  expect(new Set(compactWidths).size).toBe(1);
  expect(compactWidths[0]).toBe(20);

  // 拖回 300 ≥ 230 自动恢复；reload 后偏好保持
  await dragSideSplitter(page, 100);
  expect(await sideWidth(page)).toBe(300);
  await expect(side).not.toHaveClass(/compact/);
  await expect(kindText).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect.poll(async () => (await readWbPrefs(page)).sideWidth).toBe(300);
  await expect(side).not.toHaveClass(/compact/);
  await expect(page.locator('#wbpages [data-vpage="library"] .wb-page-kind-t')).toBeVisible();
});
