import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR } from './env.js';

// The e2e server runs with PREVIEW_TEMPLATE_ONLY=1 (playwright.config.js), so
// every assertion here targets template content only — instance-local pages and
// components are hidden and counts stay deterministic on any machine.

// 模板页（Component Library / Example Library / Example HTML）2026-09-04 起默认
// 不显示（ADR 0032，开关在预览设置）。本文件的断言就落在那三页上，所以进
// workbench 之前先把开关打开——init script 在页面脚本之前跑，合并写进同一份
// prefs，不动其它偏好。
async function seedTemplatePagesVisible(page) {
  await page.addInitScript(() => {
    try {
      const key = 'pinpoint-wb';
      const prefs = JSON.parse(localStorage.getItem(key) || '{}');
      prefs.showTemplatePages = true;
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch { /* 读不到 localStorage 时让断言自己失败，不在这里吞 */ }
  });
}

async function openWorkbench(page) {
  await seedTemplatePagesVisible(page);
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

// 「这页的标注」弹出列表（2026-09-04 评审板 H2，取代常驻右栏）：横条右端的计数
// 钮开合。断言列表内容前先开，断完再关 —— 列表不常驻是这一刀的产品语义。
async function openAnnList(page) {
  if (await page.locator('#wbann-count').getAttribute('aria-expanded') === 'true') return;
  await page.locator('#wbann-count').click();
  await expect(page.locator('#wbann-pop')).toBeVisible();
}

async function closeAnnList(page) {
  if (await page.locator('#wbann-count').getAttribute('aria-expanded') !== 'true') return;
  await page.locator('#wbann-count').click();
  await expect(page.locator('#wbann-pop')).toHaveCount(0);
}

// 画布批注三态（2026-09-04 起收在弹出列表的「···」溢出里；旧址是右栏底栏的
// dropdown）：off = 隐藏批注，inline = 叠在页面，chan = 右侧通道。选中一项
// Radix 自己关菜单，列表留着。
async function pickBubbleMode(page, mode) {
  await openAnnList(page);
  await page.locator('#wbann-more').click();
  await page.locator('#wbann-bubble-' + mode).click();
  await expect(page.locator('.wb-ann-more-menu')).toHaveCount(0);
}

// 当前的画布批注档位只在「···」菜单里显示（右栏常驻 dropdown 退役后没有别处
// 读得到它）—— 开菜单断言，再点触发钮关掉。这里不按 Esc：标注模式下 client 的
// Esc 链最后一档是「退出标注模式」，关个菜单会把模式一起关掉。
async function expectBubbleMode(page, label) {
  await openAnnList(page);
  await page.locator('#wbann-more').click();
  await expect(page.locator('#wbann-bubble-v')).toHaveText(label);
  await page.locator('#wbann-more').click();
  await expect(page.locator('.wb-ann-more-menu')).toHaveCount(0);
  await expect(page.locator('#wbann-pop')).toBeVisible();
}

// 左栏宽度（2026-08-16b 壳标 pill 紧凑断点）：#wbsplit 钉在浮动面板右缘，右拖 = 变宽。
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

// 几何断言（2026-08-17）：所有匹配元素都必须落在容器的横向可视盒内。
// Playwright 点击不检查祖先 overflow 裁剪，「能点到」证明不了「人能看到」——
// 布局断言必须比 bounding box。返回违规描述列表，空数组 = 通过。
async function withinContainerViolations(page, childSel, containerSel) {
  return page.evaluate(([c, p]) => {
    const parent = document.querySelector(p);
    if (!parent) return ['missing container ' + p];
    const pr = parent.getBoundingClientRect();
    const out = [];
    document.querySelectorAll(c).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5) {
        const label = el.getAttribute('data-vpage') ||
          el.getAttribute('data-entry') || el.tagName;
        out.push(label + ' right=' + Math.round(r.right) + ' container right=' + Math.round(pr.right));
      }
    });
    return out;
  }, [childSel, containerSel]);
}

/* 定位断言（2026-09-04 外壳重设计）：画布满铺整个视口，左栏玻璃面板与底部横条
   压在它上面 —— 「居中」是在**可用区**里居中，不是在 stage 视口里。可用区由两块
   chrome 的实际 bounding box 算出来（与 board-nav 的 chromeInsets 同一口径），
   所以这条断言同时守住「选中的 frame 不会藏在 chrome 底下」。 */
async function chromeInsets(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('#wbstage');
    const stageRect = stage.getBoundingClientRect();
    const side = document.querySelector('#wbside');
    const strip = document.querySelector('#wbstrip');
    const sideRect = side ? side.getBoundingClientRect() : null;
    const stripRect = strip ? strip.getBoundingClientRect() : null;
    return {
      left: sideRect && sideRect.width > 1 ? Math.max(0, sideRect.right - stageRect.left + 12) : 0,
      right: 0,
      top: 0,
      bottom: stripRect && stripRect.height > 1 ? Math.max(0, stageRect.bottom - stripRect.top + 12) : 0,
    };
  });
}

/* 列表开着时「定位」的到位判据（2026-09-04 H2 owner 批注 2）：目标不再居中 ——
   nudgeAwayFromPopover 把它推出列表遮挡区，居中断言与这条要求互斥。所以断的是
   「人看得见」：目标与列表矩形不相交、留在左栏右边、且还在横条上方的可见区里。
   全程比 bounding box（AGENTS 坑与约定：可见性断言不查视口）。 */
async function expectLocatedTarget(page, selector) {
  await expect.poll(() => page.evaluate((targetSelector) => {
    var target = document.querySelector(targetSelector);
    var pop = document.querySelector('#wbann-pop');
    var strip = document.querySelector('#wbstrip');
    if (!target || !pop || !strip) return null;
    var t = target.getBoundingClientRect();
    var p = pop.getBoundingClientRect();
    var st = strip.getBoundingClientRect();
    var side = document.querySelector('#wbside');
    var sr = side ? side.getBoundingClientRect() : null;
    var leftEdge = sr && sr.width > 1 ? sr.right : 0;
    return {
      clearOfList: !(t.right > p.left && t.left < p.right && t.bottom > p.top && t.top < p.bottom),
      rightOfPanel: t.left >= leftEdge - 1,
      onScreen: t.right > 0 && t.left < window.innerWidth && t.bottom > 0 && t.top < st.top
    };
  }, selector)).toEqual({ clearOfList: true, rightOfPanel: true, onScreen: true });
}

async function expectFocusedTarget(page, selector) {
  await expect.poll(() => page.evaluate((targetSelector) => {
    const stage = document.querySelector('#wbstage');
    const target = document.querySelector(targetSelector);
    if (!stage || !target) return Infinity;
    const stageRect = stage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width < 1 || targetRect.height < 1) return Infinity;
    const side = document.querySelector('#wbside');
    const strip = document.querySelector('#wbstrip');
    const sideRect = side ? side.getBoundingClientRect() : null;
    const stripRect = strip ? strip.getBoundingClientRect() : null;
    const insetLeft = sideRect && sideRect.width > 1
      ? Math.max(0, sideRect.right - stageRect.left + 12) : 0;
    const insetBottom = stripRect && stripRect.height > 1
      ? Math.max(0, stageRect.bottom - stripRect.top + 12) : 0;
    const usableW = Math.max(1, stage.clientWidth - insetLeft);
    const usableH = Math.max(1, stage.clientHeight - insetBottom);
    const inset = 24;
    const expectedLeft = insetLeft + (targetRect.width + inset * 2 <= usableW
      ? (usableW - targetRect.width) / 2
      : inset);
    const expectedTop = targetRect.height + inset * 2 <= usableH
      ? (usableH - targetRect.height) / 2
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
  // 阶段 6：e2e-mixed 固件（混合板：画布 + 两个文档条目）追加在尾。
  // 阶段 7：Page 去类型化 —— 行只剩标题，壳标 pill 撤除（类型信息下移到
  // 「内容」区产物条目的 tag）。
  // 2026-08-17g：行尾新增相对时间元素，标题断言收窄到 .wb-page-t。
  await expect(page.locator('#wbpages .wb-page-t')).toHaveText([
    'Component Library',
    'Example Library',
    'Example HTML',
    'E2E Site',
    'E2E Proxy App',
    'E2E Dir',
    'E2E Dir iOS',
    'E2E Mention Doc',
    'E2E Mixed',
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

test('Pages is one mixed list of untyped rows and no mode Seg', async ({ page }) => {
  await openWorkbench(page);

  // 模式 Seg 退役；本地页 + registry 条目混排（顺序 = 系统行 → _index → registry）。
  // 阶段 4：url 条目（E2E Site / E2E Proxy App）恒 doc 壳同列。
  // 阶段 5：e2e-mention 固件（doc 壳 mention 文档）追加在尾。
  // 阶段 6：e2e-mixed 固件（混合板）追加在尾。
  // 阶段 7：Page 去类型化 —— 行 = 纯标题（壳标 pill / data-page-mode 一并撤除）。
  // 2026-08-17g：行尾新增相对时间元素，标题断言收窄到 .wb-page-t。
  await expect(page.locator('#wbboard-mode')).toHaveCount(0);
  await expect(page.locator('#wbpages .wb-page-t')).toHaveText([
    'Component Library',
    'Example Library',
    'Example HTML',
    'E2E Site',
    'E2E Proxy App',
    'E2E Dir',
    'E2E Dir iOS',
    'E2E Mention Doc',
    'E2E Mixed',
  ]);

  // 类型信息只以图标出现，不再有 pill / data-page-mode。
  // 2026-09-05：每行一个类型图标（画布 / 文档 / 网页），数量 = 行数。
  await expect(page.locator('#wbpages .wb-page-kind')).toHaveCount(await page.locator('#wbpages .wb-page').count());
  await expect(page.locator('#wbpages .wb-page[data-page-mode]')).toHaveCount(0);

  // 点文档页 → stage 变阅读器；点回机壳页 → 画布回来。
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  await expect(page.locator('#wb-board-panel .wb-doc-frame')).toHaveCount(1);
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  await page.locator('#wbpages [data-vpage="library"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wbcanvas-tools')).toBeVisible();
});

test('HTML board fills the viewport, drops canvas chrome, and collapses the contents section (2026-08-16f 阶段 7)', async ({ page }) => {
  await openWorkbench(page);

  // 壳形态是选中条目的属性：点文档页（单 doc 条目），stage 即阅读器。
  await page.locator('#wbpages [data-vpage="doc-library"]').click();

  // Document is hosted in an iframe, not inlined: its own <head>/<style> stay inside.
  const frame = page.locator('#wb-board-panel .wb-doc-stage .wb-doc-frame');
  await expect(frame).toHaveCount(1);
  await expect(page.frameLocator('#wb-board-panel .wb-doc-frame').locator('h1')).toHaveText('Sample Report');

  // Not a canvas: no zoom/pan HUD, and the doc matches the stage 1:1 so a report
  // renders at the reader's real window size.
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  const [frameBox, stageBox] = await Promise.all([
    frame.boundingBox(),
    page.locator('#wbstage').boundingBox(),
  ]);
  expect(Math.round(frameBox.width)).toBe(Math.round(stageBox.width));
  expect(Math.round(frameBox.height)).toBe(Math.round(stageBox.height));

  // 阶段 7 坍缩：纯单 doc 屏页（无画布、无草稿、非网页）整个「内容」区不出现。
  await expect(page.locator('#wbcontents')).toHaveCount(0);

  // 纯画布页：「内容」区在、frame 树在，但条目行坍缩（无多余「画布」行）。
  await page.locator('#wbpages [data-vpage="library"]').click();
  await expect(page.locator('#wb-board-panel .wb-doc-frame')).toHaveCount(0);
  await expect(page.locator('#wbcontents')).toBeVisible();
  await expect(page.locator('#wbcontents [data-entry]')).toHaveCount(0);
  await expect(page.locator('#wboutline [data-ol-frame]')).not.toHaveCount(0);
});

test('doc entry rows export full HTML, no-css HTML, and long PNG (2026-08-16f 阶段 7)', async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkbench(page);
  // 多文档页（e2e-dir，cards + doc 两个产物条目）：「内容」区出产物组条目行，
  // doc 导出入口 = 条目行右键菜单（2026-08-17 hover icon 钮退役）。
  await page.locator('#wbpages [data-vpage="e2e-dir"]').click();
  await expect(page.locator('#wbcontents [data-entry="doc"]')).toBeVisible();
  await page.locator('#wbcontents [data-entry="doc"]').click({ button: 'right' });
  await page.locator('[data-entry-export="doc"]').click();
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
  expect(full.suggestedFilename()).toBe('e2e-dir__doc.html');
  const fullText = await fs.readFile(await full.path(), 'utf8');
  expect(fullText).toMatch(/<!doctype html>/i);
  expect(fullText).toMatch(/<style/i);

  await pickMode('html-no-css');
  await expect(tokens.locator('.wb-export-token')).toHaveCount(3);
  const downloadNoCss = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const noCss = await downloadNoCss;
  expect(noCss.suggestedFilename()).toBe('e2e-dir__doc.no-css.html');
  const noCssText = await fs.readFile(await noCss.path(), 'utf8');
  expect(noCssText).toMatch(/E2E dir-site doc/);
  expect(noCssText).not.toMatch(/<style/i);

  await pickMode('image');
  await expect(tokens.locator('.wb-export-token')).toHaveCount(3, { timeout: 30_000 });
  await expect(tokens).toContainText('Gemini');
  const downloadPng = page.waitForEvent('download');
  await dialog.locator('[data-export-download]').click();
  const png = await downloadPng;
  expect(png.suggestedFilename()).toBe('e2e-dir__doc@2x.png');
  const pngBuf = await fs.readFile(await png.path());
  expect(pngBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
});

test('sidebar rows expose locator copy / rename / export via right-click menu (2026-08-17)', async ({ page, context }) => {
  // 行级动作全部在右键菜单（行尾 hover 钮已退役）：Pages 行 = 复制 @page +
  // 重命名（系统页无重命名）；产物 doc 条目 = 复制 @frame + 导出；画布条目 =
  // 复制 @page；frame 树行 = 复制 @frame。复制项点击后菜单保持打开并显示
  // 「已复制 <全文>」（行上无可见元素，菜单是复制反馈的唯一落点）。
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await expect(page.locator('#wbcontents [data-entry="spec"]')).toBeVisible();
  const readClip = () => page.evaluate(() => navigator.clipboard.readText());

  // Page 行：复制 @page；同一开着的菜单里再点重命名 → 行内输入框出现
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click({ button: 'right' });
  const pageCopy = page.locator('[data-copy-page="e2e-mixed"]');
  await expect(pageCopy).toBeVisible();
  // 几何断言：菜单必须真的渲染在视口内（DOM 存在 ≠ 肉眼可见 —— 全局 popper
  // 置惰规则曾把菜单压到 body 末尾、视口之外，DOM 断言全绿；2026-08-17 实测）。
  const vp = page.viewportSize();
  const menuBox = await page.locator('[role="menu"]').boundingBox();
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(vp.width);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(vp.height);
  await pageCopy.click();
  await expect(pageCopy).toContainText('已复制 @page:e2e-mixed');
  await expect.poll(readClip).toBe('@page:e2e-mixed');
  await page.locator('[data-rename-page="e2e-mixed"]').click();
  await expect(page.locator('.wb-page-rename')).toBeVisible();
  await page.keyboard.press('Escape');

  // 系统页（Component Library，id = components）：复制项在、重命名项不在
  await page.locator('#wbpages [data-vpage="components"]').click({ button: 'right' });
  await expect(page.locator('[data-copy-page="components"]')).toBeVisible();
  await expect(page.locator('[data-rename-page]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 产物 doc 条目：复制 @frame 后菜单仍开着，同菜单点「导出…」开对话框
  await page.locator('#wbcontents [data-entry="spec"]').click({ button: 'right' });
  await page.locator('[data-copy-frame="e2e-mixed/spec"]').click();
  await expect.poll(readClip).toBe('@frame:e2e-mixed/spec');
  await page.locator('[data-entry-export="spec"]').click();
  const dialog = page.locator('dialog.wb-export-dialog', { hasText: '导出文档' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-export-target-label]')).toHaveText('e2e-mixed / 设计说明');
  await dialog.locator('.wb-export-close').click();

  // 画布条目：复制 @page（画布 = 页面默认视图，@frame 语法不覆盖它）
  await page.locator('#wbcontents [data-entry="@canvas"]').click({ button: 'right' });
  await page.locator('[data-copy-page="e2e-mixed"]').click();
  await expect.poll(readClip).toBe('@page:e2e-mixed');
  await page.keyboard.press('Escape');

  // frame 树行：复制 @frame
  await page.locator('#wboutline [data-ol-frame="home"]').click({ button: 'right' });
  await page.locator('[data-copy-frame="e2e-mixed/home"]').click();
  await expect.poll(readClip).toBe('@frame:e2e-mixed/home');
  await page.keyboard.press('Escape');
});

test('doc entry exports with comments: mark boxes HTML, no-css text, and long PNG (2026-08-16f 阶段 7)', async ({ page }) => {
  test.setTimeout(90_000);
  // 多文档页 e2e-dir 的产物条目行承载导出钮；bucket（e2e-dir）与 dir-entry.spec
  // 共享，前后都清一遍，避免跨文件串味。
  const bucket = path.join(E2E_DATA_DIR, 'e2e-dir');
  await fs.rm(bucket, { recursive: true, force: true });
  try {
    await openWorkbench(page);
    await page.locator('#wbpages [data-vpage="e2e-dir"]').click();
    // 选中 doc 条目（阅读器显示 doc.html）；doc 屏 iframe 选择器要按屏 scoped
    // （同板多 doc 屏都在 DOM，非选中屏被条目显隐收起）。
    await page.locator('#wbcontents [data-entry="doc"]').click();
    const DOC_FRAME = '#wb-board-panel [data-screen="doc"] .wb-doc-frame';
    const doc = page.frameLocator(DOC_FRAME);
    await expect(doc.locator('#doc-title')).toHaveText('E2E dir-site doc');

    await expect.poll(() => page.evaluate((sel) => !!(
      document.querySelector(sel).contentWindow.pinpoint
    ), DOC_FRAME)).toBe(true);
    await page.locator('#wbann-toggle').click();
    await expect.poll(() => page.evaluate((sel) => (
      document.querySelector(sel).contentWindow.pinpoint.getState().mode
    ), DOC_FRAME)).toBe(true);
    await page.evaluate((sel) => {
      document.querySelector(sel).contentWindow.pinpoint.clear();
    }, DOC_FRAME);
    await expect.poll(() => page.evaluate((sel) => (
      document.querySelector(sel).contentWindow.pinpoint.getState().count
    ), DOC_FRAME)).toBe(0);

    await page.evaluate((sel) => {
      const w = document.querySelector(sel).contentWindow;
      const d = w.document;
      function clickEl(targetSel, text) {
        const el = d.querySelector(targetSel);
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
      clickEl('#doc-title', '导出评论 doc-title');
      clickEl('#doc-target', '导出评论 doc-target');
    }, DOC_FRAME);
    await expect.poll(() => page.evaluate((sel) => (
      document.querySelector(sel).contentWindow.pinpoint.getState().count
    ), DOC_FRAME)).toBe(2);
    // Export reads the on-disk store — wait until the save has landed.
    // bucket = registry entry id（e2e-dir），不是默认的 pinpoint。
    await expect.poll(async () => page.evaluate(async (sel) => {
      const w = document.querySelector(sel).contentWindow;
      const path = w.location.pathname;
      const f = decodeURIComponent(path.split('/').pop() || 'index.html');
      let h = 0;
      for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
      const pageKey = (f + '~' + h.toString(36)).replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 80);
      const res = await fetch('/annotations/' + encodeURIComponent(pageKey) + '?entry=e2e-dir');
      if (!res.ok) return 0;
      const doc = await res.json();
      return Array.isArray(doc.annotations) ? doc.annotations.length : 0;
    }, DOC_FRAME)).toBe(2);

    // 条目行右键菜单开导出对话框（2026-08-17 hover icon 钮退役）
    await page.locator('#wbcontents [data-entry="doc"]').click({ button: 'right' });
    await page.locator('[data-entry-export="doc"]').click();
    const dialog = page.locator('dialog.wb-export-dialog', { hasText: '导出文档' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-export-target-label]')).toHaveText('e2e-dir / Doc');
    await dialog.locator('[name="comments"]').check();
    await expect(dialog.locator('[data-export-status]')).toContainText('标注框');

    // B': HTML full with baked mark boxes + badges
    const downloadFull = page.waitForEvent('download');
    await dialog.locator('[data-export-download]').click();
    const full = await downloadFull;
    expect(full.suggestedFilename()).toBe('e2e-dir__doc.comments.html');
    const fullText = await fs.readFile(await full.path(), 'utf8');
    expect(fullText).toMatch(/data-export-comments/);
    expect(fullText).toMatch(/var defer = true/);
    expect(fullText).toMatch(/var bubbles = true/);
    expect(fullText).toMatch(/导出评论 doc-title/);
    expect(fullText).toMatch(/导出评论 doc-target/);
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
    expect(noCss.suggestedFilename()).toBe('e2e-dir__doc.comments.no-css.html');
    const noCssText = await fs.readFile(await noCss.path(), 'utf8');
    expect(noCssText).toMatch(/id="comments"/);
    expect(noCssText).toMatch(/导出评论 doc-title/);
    expect(noCssText).toMatch(/导出评论 doc-target/);

    // A': long PNG with gutter for sidebar bubbles
    await dialog.locator('label.wb-export-option:has([name="mode"][value="image"])').click();
    await expect(dialog.locator('[data-export-tokens] .wb-export-token')).toHaveCount(3, { timeout: 45_000 });
    const downloadPng = page.waitForEvent('download');
    await dialog.locator('[data-export-download]').click();
    const png = await downloadPng;
    expect(png.suggestedFilename()).toBe('e2e-dir__doc@2x.comments.png');
    const pngBuf = await fs.readFile(await png.path());
    expect(pngBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    // PNG IHDR width is big-endian at bytes 16..19; comments export is 1184 * 2 = 2368.
    const width = pngBuf.readUInt32BE(16);
    expect(width).toBe(2368);
  } finally {
    await fs.rm(bucket, { recursive: true, force: true });
  }
});

test('doc annotate layer stays pinned to the viewport after the document scrolls', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="doc-library"]').click();

  const doc = page.frameLocator('#wb-board-panel .wb-doc-frame');
  await expect(doc.locator('h1')).toHaveText('Sample Report');
  // The document wires annotate itself (localhost only) — no workbench stage inside the iframe.
  // Plain docs carry no board chrome to keep unselectable — the whole body is the
  // hit surface. (The wb-html-surface opt-in went away with the web shell; the
  // client's dead branches for it were removed on 2026-09-04, see BACKLOG.)
  await expect.poll(() => page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    return !!(w && w.pinpoint);
  })).toBe(true);

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

  // 一次 elementFromPoint + mousemove 采样是几何量测，全量负载下 ghost 可能还没
  // 落位（BACKLOG「frame 菜单 hit-test 的套件内 flake」同类：裸 expect 无 poll）。
  // 整个采样连同判据放进 expect.poll —— 失败即重采，不是重跑一遍断言。
  // With no workbench stage the overlay must be pinned to the viewport. Left as
  // position:absolute it anchors at the document origin, is only one screen tall,
  // and clips everything below the fold — which reads as "annotate does nothing".
  const sampleGhost = () => page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    const d = w.document;
    const ov = d.getElementById('ann-overlay');
    const el = d.elementFromPoint(300, 300);
    if (!el || !ov) return { ready: false };
    el.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 300 }));
    const ghost = d.querySelector('#ann-hover-layer > *');
    const g = ghost && ghost.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    return {
      ready: true,
      scrolled: w.scrollY > 0,
      overlayPosition: w.getComputedStyle(ov).position,
      overlayY: Math.round(ov.getBoundingClientRect().y),
      tracksTarget: !!g && Math.abs(Math.round(g.y) - Math.round(t.y)) <= 2,
      ghostVisible: !!g && Math.round(g.width) > 0 &&
        Math.round(g.bottom) > 0 && Math.round(g.y) < w.innerHeight,
    };
  });
  await expect.poll(sampleGhost, { timeout: 15000 }).toEqual({
    ready: true,
    scrolled: true,
    overlayPosition: 'fixed',
    overlayY: 0,
    tracksTarget: true,
    ghostVisible: true,
  });
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
  // 模式两段（2026-09-04 裁决 7，取代 ADR 0011 单钮）：选中 = 实心 accent + aria-pressed
  await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#wbann-interact')).toHaveAttribute('aria-pressed', 'false');

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
  await openAnnList(page);
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await expect(page.locator('#wbann-list')).toContainText('sidebar sync check');
  await closeAnnList(page);
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
  await openAnnList(page);
  await expect(page.locator('#wbann-list')).not.toContainText('锚点失效');
  await closeAnnList(page);

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
  // 「···」里的当前档位跟着走。
  await expectBubbleMode(page, '叠在页面');

  // Toggling off hides the bubbles.
  await pickBubbleMode(page, 'off');
  await expect.poll(() => page.evaluate(() => {
    const d = document.querySelector('#wb-board-panel .wb-doc-frame').contentDocument;
    return d.querySelectorAll('#ann-bubbles .ann-bubble').length;
  })).toBe(0);
  await expectBubbleMode(page, '隐藏批注');
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
  await expectBubbleMode(page, '叠在页面');

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
  await expectBubbleMode(page, '右侧通道');

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

test('board load failure panel offers a way home and an in-place retry (2026-09-04 错误面板)', async ({ page }) => {
  let broken = true;
  await page.route('**/previews/library/board.json', async (route) => {
    if (!broken) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  });

  await openWorkbench(page);
  const panel = page.locator('#wb-board-panel .wb-screen-err');
  await expect(panel).toBeVisible();
  // 说明保留出处与原因，动作固定两个
  await expect(panel.locator('.wb-screen-err-src')).toContainText('/previews/library/board.json');
  await expect(panel.locator('[data-err-home]')).toHaveText('回到 Pages');
  await expect(panel.locator('[data-err-retry]')).toHaveText('重试');

  // 「回到 Pages」= 落到一个能打开的页 + 左栏展开（折叠着也要看得见 Pages）
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeHidden();
  await panel.locator('[data-err-home]').click();
  await expect(page.locator('#wbside')).toBeVisible();
  await expect(page.locator('#wb-board-panel [data-screen="button/catalog"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('components');

  // 回到坏页 → 面板重现；修好后「重试」原地把板拉回来，不用刷新整页
  await page.locator('#wbpages [data-vpage="library"]').click();
  await expect(panel).toBeVisible();
  broken = false;
  await panel.locator('[data-err-retry]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
});

test('?page= 指向不存在的页 → 显式面板，地址栏留着坏 id（2026-09-04 深链失效）', async ({ page }) => {
  await page.goto('/index.html?page=does-not-exist');
  await page.waitForFunction(() => window.workbench && window.pinpoint);

  const panel = page.locator('#wb-board-panel .wb-screen-err');
  await expect(panel.locator('.wb-screen-err-title')).toHaveText('页面不存在');
  await expect(panel.locator('.wb-screen-err-src')).toHaveText('?page=does-not-exist');
  await expect(panel.locator('.wb-screen-err-why')).toContainText('does-not-exist');
  // 地址栏不被规范化：坏的是哪个 id 必须一直看得见
  expect(page.url()).toContain('page=does-not-exist');
  // 左栏照常渲染，别的页都还能点（本用例不经 openWorkbench，模板页默认藏着 ——
  // 拿一个 registry 条目页断言，与模板页开关无关）
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
  // 肉眼可见：面板要落在**可用区**里（板面有 3200px 画布留白，不特判就跑到视口外
  // 三千像素；2026-09-04 起还要让开压在画布上的左栏与横条）
  expect(await page.evaluate(() => {
    const a = document.querySelector('#wb-board-panel .wb-screen-err').getBoundingClientRect();
    const b = document.getElementById('wbstage').getBoundingClientRect();
    const side = document.getElementById('wbside').getBoundingClientRect();
    const strip = document.getElementById('wbstrip').getBoundingClientRect();
    return a.left >= side.right && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= strip.top;
  })).toBe(true);

  await panel.locator('[data-err-home]').click();
  await expect(page.locator('#wb-board-panel [data-screen="button/catalog"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('components');
  await expect.poll(() => page.url()).toContain('page=components');
});

test('深链失效面板的「重试」：页面清单里出现了那个 id 就直接打开它', async ({ page }) => {
  let hidden = true;
  await page.route('**/previews/_index.json', async (route) => {
    if (!hidden) {
      await route.fallback();
      return;
    }
    // doc-library 暂时不在清单里 —— 等价于「这个 id 还没登记」
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ defaultPage: 'library', pages: [{ id: 'library', title: 'Example Library', mode: 'ios' }] }),
    });
  });

  await page.goto('/index.html?page=doc-library');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  const panel = page.locator('#wb-board-panel .wb-screen-err');
  await expect(panel.locator('.wb-screen-err-title')).toHaveText('页面不存在');
  expect(page.url()).toContain('page=doc-library');

  hidden = false;
  await panel.locator('[data-err-retry]').click();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('doc-library');
  await expect(page.locator('#wb-board-panel .wb-doc-frame').first()).toBeVisible();
  // 落到真实页后地址栏恢复同步
  await expect.poll(() => page.url()).toContain('page=doc-library');
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

test('previews 完整文档 serve 即注入 annotate 客户端，fragment 不注入（2026-08-17e 契约统一）', async ({ page }) => {
  // 完整文档：注入（手工注入段已从模板退役，注入只能来自服务端中间件）
  const doc = await page.request.get('/previews/doc-library/sample-report.html');
  expect(doc.ok()).toBeTruthy();
  const docHtml = await doc.text();
  expect(docHtml).toContain('<script src="/annotate.js"></script>');
  expect(docHtml).not.toContain('__pinpointEntry'); // 账本 ENTRY 保持缺省 pinpoint
  // ?annotate=off：导出管线的豁免口
  const off = await page.request.get('/previews/doc-library/sample-report.html?annotate=off');
  expect(await off.text()).not.toContain('/annotate.js');
  // fragment（画布内联原料）不注入
  const fragment = await page.request.get('/previews/library/home.html');
  expect(await fragment.text()).not.toContain('/annotate.js');
});

test('doc iframe 重载后标注桥自动重绑（2026-08-17e）', async ({ page }) => {
  await page.goto('/index.html?page=doc-library');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  const frame = page.locator('.wb-doc-frame');
  await expect(frame).toBeVisible();
  await page.waitForFunction(() => {
    const f = document.querySelector('.wb-doc-frame');
    return f && f.contentWindow && f.contentWindow.pinpoint;
  });

  // 强制 iframe 重载（等价 HMR 后的文档刷新），客户端换成新实例
  await page.evaluate(() => {
    const f = document.querySelector('.wb-doc-frame');
    f.src = f.src;
  });
  await page.waitForFunction(() => {
    const f = document.querySelector('.wb-doc-frame');
    return f && f.contentWindow && f.contentWindow.pinpoint;
  });

  // 桥持续轮询并重绑：侧栏模式切换驱动的是新客户端
  await page.locator('#wbann-toggle').click();
  await page.waitForFunction(() => {
    const f = document.querySelector('.wb-doc-frame');
    return f && f.contentWindow && f.contentWindow.pinpoint
      && f.contentWindow.pinpoint.getState().mode === true;
  });
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
  // 图纸内容永随（decisions 2026-08-15d）：图注（引用号 B2 + 屏名）与尺寸行随导出；
  // note 已收编右栏 detail 面板（2026-08-17），不再上画布、不进导出。
  expect(snapshot.html).toContain('wb-cap-ref');
  expect(snapshot.html).toContain('B2');
  expect(snapshot.html).toContain('wb-screen-dim');
  expect(snapshot.html).not.toContain('wb-detail');

  const response = await page.request.post('/api/export-image', { data: snapshot });
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toBe('image/png');
  expect(response.headers()['x-export-width']).toBe('1068');
  // 2226 → 2182：2026-09-04 E1 把引用号与屏名并成一行，图注少一行 22px（×2 = 44）。
  expect(response.headers()['x-export-height']).toBe('2182');
  const body = await response.body();
  expect(body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test('Section export always carries captions (图纸内容永随；note 已收编右栏)', async ({ page }) => {
  await openWorkbench(page);
  await expect(page.locator('#wb-board-panel .wb-lib-item[data-ann-section="brew-flow"]')).toBeVisible();

  const explained = await page.evaluate(() => window.workbench.exportSnapshot({
    kind: 'section', sectionId: 'brew-flow', format: 'png', scale: 1, background: 'white',
  }));
  expect(explained.html).toContain('wb-lib-cap');
  expect(explained.html).toContain('wb-screen-cap');
  expect(explained.html).toContain('wb-screen-dim');
  // 干净画面语义已拆除（decisions 2026-08-15d）：不再有 clean-row 覆写
  expect(explained.html).not.toContain('wb-export-clean-row');
});

test('every Frame exposes a title menu (export entry retired to the HUD picker)', async ({ page }) => {
  await openWorkbench(page);
  const frame = page.locator('#wb-board-panel [data-screen="home"]');
  const trigger = frame.locator('.wb-frame-menu-trigger');
  // 2026-09-04 E1：「···」常态收起（尺寸行同理），hover 这一帧才现 —— 它仍在
  // DOM 与 tab 序里（opacity，不是 display/visibility），覆盖见下面那条几何用例。
  await expect(trigger).toBeAttached();
  await frame.locator('.wb-screen-cap').hover();
  await expect.poll(() => page.evaluate(
    () => Number(getComputedStyle(document.querySelector('[data-screen="home"] .wb-frame-menu-shell')).opacity)
  )).toBeGreaterThan(0.5);

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

test('Detail 面板：选中 frame 展示 note，编辑保存走共享 revision（2026-08-17 选中模型）', async ({ page }) => {
  const initial = '场景：会议刚刚结束。';
  const revised = '场景：会议刚刚结束。\n交互：点击 Suggested Prompt。';
  let savedBody = null;

  await page.route('**/previews/library/board.json', async (route) => {
    const response = await route.fetch();
    const board = await response.json();
    board.sections[0].screens[0].note = initial; // home / home
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
  // note 不再渲染上画布
  await expect(page.locator('#wb-board-panel [data-frame-note]')).toHaveCount(0);
  // 未选中时 detail 面板不渲染
  await expect(page.locator('#wbdetail')).toHaveCount(0);

  // 点图注选中 frame → detail 面板展示 note
  await page.locator('#wb-board-panel [data-screen="home"] .wb-screen-cap').click();
  const detail = page.locator('#wbdetail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-detail-kind', 'frame');
  await expect(detail.locator('[data-detail-note-text]')).toHaveText(initial);
  // 画布选中态 class 同步
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toHaveClass(/wb-sel/);

  await detail.locator('[data-detail-note-edit]').click();
  await detail.locator('[data-detail-note-input]').fill(revised);
  await detail.locator('[data-detail-note-save]').click();
  await expect(detail.locator('[data-detail-note-text]')).toHaveText(revised);
  expect(savedBody).toEqual({ note: revised, baseRevision: 'revision-1' });
});

test('Detail 面板：section note 走 /api/section-notes（2026-08-17 section note 落地）', async ({ page }) => {
  const initial = '整组图例：直通带 = 照常。';
  const revised = '整组图例：直通带 = 照常；斜带 = 挤占。';
  let savedBody = null;

  await page.route('**/previews/library/board.json', async (route) => {
    const response = await route.fetch();
    const board = await response.json();
    board.sections[1].note = initial; // brew-flow
    await route.fulfill({ response, json: board });
  });
  await page.route('**/api/section-notes/library/brew-flow', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { pageId: 'library', sectionId: 'brew-flow', note: initial, revision: 'revision-1' } });
      return;
    }
    savedBody = route.request().postDataJSON();
    await route.fulfill({ json: { pageId: 'library', sectionId: 'brew-flow', note: revised, revision: 'revision-2' } });
  });

  await openWorkbench(page);
  // 点 section 大标题 → section detail
  await page.locator('#wb-board-panel .wb-lib-item[data-ann-section="brew-flow"] > .wb-lib-cap').click();
  const detail = page.locator('#wbdetail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-detail-kind', 'section');
  await expect(detail.locator('[data-detail-note-text]')).toHaveText(initial);
  await expect(page.locator('#wb-board-panel .wb-lib-item[data-ann-section="brew-flow"]')).toHaveClass(/wb-sel/);

  await detail.locator('[data-detail-note-edit]').click();
  await detail.locator('[data-detail-note-input]').fill(revised);
  await detail.locator('[data-detail-note-save]').click();
  await expect(detail.locator('[data-detail-note-text]')).toHaveText(revised);
  expect(savedBody).toEqual({ note: revised, baseRevision: 'revision-1' });
});

test('画布点选模型：原型内部不动选中、板空白清选中（2026-08-17 选中模型）', async ({ page }) => {
  await openWorkbench(page);
  const detail = page.locator('#wbdetail');
  await expect(detail).toHaveCount(0);

  // frame 树行点击（既有链路）同样驱动 detail 面板
  await page.locator('#wboutline [data-ol-frame="recipe"]').click();
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-detail-kind', 'frame');
  await expect(detail.locator('[data-detail-title]')).toHaveText('参数（内联脚本）');

  // 原型内部点击 = 原型交互，选中不变
  await page.locator('#wb-board-panel [data-screen="recipe"] [data-ratio-cycle]').click();
  await expect(detail).toHaveAttribute('data-detail-kind', 'frame');

  // 板空白（面板留白）= 清选中
  await page.locator('#wb-board-panel').click({ position: { x: 10, y: 10 } });
  await expect(detail).toHaveCount(0);
  await expect(page.locator('#wb-board-panel .wb-sel')).toHaveCount(0);
});

test('persistent canvas toolbar supports continuous section nav and layered minimap', async ({ page }) => {
  await openWorkbench(page);
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  // 钉住 100% 缩放：本用例的 scrollTop 阈值断言依赖 zoom=1 的几何
  // （2026-08-16 起首访默认缩放 50%，HUD label 单击 = 重置为 100%）。
  await page.locator('#wbzoom-label').click();

  const toolbar = page.locator('#wbcanvas-tools');
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
    '首页',
    '冲一杯',
    '锁屏 → 消息 → 回复',
    '锁屏通知',
    '冲煮完成卡两案',
    '设置',
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

  // 停靠几何：面板刚开、小地图刚重绘，全量负载下这一帧可能还没落定
  // （BACKLOG「workbench.spec.js:1045 全量 flake」）。判据整体进 expect.poll，
  // 采样与断言同一帧，失败即重采。
  await expect.poll(() => page.evaluate(() => {
    const navigatorRect = document.querySelector('#wbsection-nav').getBoundingClientRect();
    const minimapRect = document.querySelector('#wbminimap').getBoundingClientRect();
    const stripRect = document.querySelector('#wbstrip').getBoundingClientRect();
    const close = (a, b, tolerance) => Math.abs(a - b) < tolerance;
    return {
      stacked: navigatorRect.bottom <= minimapRect.top,
      // 2026-09-04：dock 仍贴画布右下角，但改为浮在底部横条正上方
      rightAligned: close(navigatorRect.right, minimapRect.right, 0.5) &&
        close(minimapRect.right, window.innerWidth - 12, 0.5),
      aboveStrip: minimapRect.bottom <= stripRect.top,
      sameWidth: close(navigatorRect.width, minimapRect.width, 0.05),
      toolOrder: [...document.querySelectorAll('#wbcanvas-tools .wb-toolbar-tool-btn')].map((button) => button.id),
    };
  }), { timeout: 15000 }).toEqual({
    stacked: true,
    rightAligned: true,
    aboveStrip: true,
    sameWidth: true,
    toolOrder: ['wbsection-nav-toggle', 'wbminimap-toggle'],
  });

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

  await openAnnList(page);
  await page.locator('#wbann-list .wb-ann-item-main').click();
  await page.waitForTimeout(350); // prove no earlier section-scroll animation can pull focus away
  // 列表开着时的到位判据（居中会与「让开列表」互斥，见 expectLocatedTarget）
  await expectLocatedTarget(page, '[data-screen="settings"] .ios-stage');
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
    const strip = document.querySelector('#wbstrip').getBoundingClientRect();
    const stage = document.querySelector('#wbstage');
    return {
      insideBottom: composer.bottom <= wrap.bottom,
      aboveHud: composer.bottom <= strip.top,
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

  // 2026-09-04 起画布满铺，composer 不再被两侧栏挤窄 —— 要让「窄视口钳位 →
  // 拉宽回弹」成立，窄档必须窄过 composer 的 720 上限。
  await page.setViewportSize({ width: 560, height: 700 });
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

  const scrolledTo = await page.evaluate(() => {
    const app = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-app');
    app.scrollTop += 120;
    return app.scrollTop;
  });

  // 滚动落定先于几何断言（BACKLOG「:1716 全量 flake」）：mark 的重算挂在滚动
  // 事件上，滚动本身还在途时量到的是旧几何。先 poll 滚动位置生效，再 poll 几何，
  // 并把几何窗口放宽 —— 全量负载下 5s 默认窗口不够。
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#wb-board-panel [data-screen="settings"] .ios-app').scrollTop
  ))).toBe(scrolledTo);

  await expect.poll(() => page.evaluate((prev) => {
    const target = document.querySelector('#wb-board-panel [data-screen="settings"] .ios-cell');
    const mark = document.querySelector('.ann-target');
    if (!target || !mark || getComputedStyle(mark).display === 'none') return Infinity;
    const targetDelta = target.getBoundingClientRect().top - prev.targetTop;
    const markDelta = mark.getBoundingClientRect().top - prev.markTop;
    return Math.abs(markDelta - targetDelta);
  }, before), { timeout: 15000 }).toBeLessThan(3);

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
  await expect(recipe.locator('.wb-screen-cap .wb-cap-title')).toHaveText('参数（内联脚本）');
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
  await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');

  // 在 settings（F1）上落一条标注 → 大纲徽标计数 + 右栏按 frame 分组（eyebrow = 引用号 + 屏名）
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'outline sync mark');
  await expect(outline.locator('[data-ol-frame="settings"] .ol-n')).toHaveText('1');
  // 计数钉在横条右端（H2 的入口）；列表不常驻，点它才开
  await expect(page.locator('#wbann-count')).toHaveText('1');
  await expect(page.locator('#wbann-pop')).toHaveCount(0);
  await openAnnList(page);
  await expect(page.locator('#wbann-status')).toHaveText('1');
  await expect(page.locator('#wbann-status')).toHaveAttribute('title', '共 1 条');
  // 行 cap = 引用号 + 屏名（H2「A1 Today」的形；分组 eyebrow 随右栏退役）
  await expect(page.locator('#wbann-list .wb-ann-cap')).toHaveText(['F1 settings']);

  // 标注行 → 定位 + 焦点双向同步：行 on、大纲行 on、画布聚焦到 owning frame
  await page.locator('#wbstage').evaluate((stage) => stage.scrollTo({ top: 0, left: 0 }));
  await page.locator('#wbann-list .wb-ann-item-main').click();
  await expectLocatedTarget(page, '[data-screen="settings"] .ios-stage');
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveClass(/wb-ann-item--on/);
  await expect(outline.locator('[data-ol-frame="settings"]')).toHaveClass(/on/);
  // 行尾「定位」是同一个动作的第二个入口（hover 才现，几何上在行内）
  const goBtn = page.locator('#wbann-list [data-ann-go="1"]');
  await page.locator('#wbann-list .wb-ann-item').hover();
  await expect(goBtn).toBeVisible();
  await goBtn.click();
  await expectLocatedTarget(page, '[data-screen="settings"] .ios-stage');

  // Esc 关列表；再点计数钮开回来
  await page.keyboard.press('Escape');
  await expect(page.locator('#wbann-pop')).toHaveCount(0);
  await openAnnList(page);

  // 左栏折叠 / 复开：唯一入口是横条左端的 Pages 开关（画布两缘浮钮已退役）
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeHidden();
  await expect(page.locator('#wbstrip')).toBeVisible();
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeVisible();

  // 清空 = 两段确认（收在「···」里）：首击 armed（确认清空），再击才执行
  await page.locator('#wbann-more').click();
  await page.locator('#wbann-clear').click();
  await expect(page.locator('#wbann-clear')).toHaveText('确认清空');
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await page.locator('#wbann-clear').click();
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await page.keyboard.press('Escape');
});

test('浮动外壳几何：面板 / 横条 / 弹出列表都在视口内且互不压盖（2026-09-04 G1 + G1b）', async ({ page }) => {
  await openWorkbench(page);
  // Playwright 的 toBeVisible / click 不查视口（AGENTS「坑与约定」），所以这条
  // 用例全程比 bounding box。
  const rects = () => page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { side: g('#wbside'), strip: g('#wbstrip'), pop: g('#wbann-pop'),
      vw: window.innerWidth, vh: window.innerHeight };
  });

  const a = await rects();
  // 面板：四缘距视口 12px，下沿停在横条上方 12px（G1b）
  expect(Math.round(a.side.left)).toBe(12);
  expect(Math.round(a.side.top)).toBe(12);
  expect(Math.round(a.strip.bottom)).toBe(a.vh - 12);
  expect(Math.round(a.side.bottom)).toBe(Math.round(a.strip.top) - 12);
  // 横条居中且整条在视口内
  expect(Math.abs((a.strip.left + a.strip.right) / 2 - a.vw / 2)).toBeLessThan(2);
  expect(a.strip.left).toBeGreaterThan(0);
  expect(a.strip.right).toBeLessThan(a.vw);
  // 面板与横条不重叠（横条永远整条可见）
  expect(a.side.bottom).toBeLessThanOrEqual(a.strip.top);

  // 弹出列表贴横条右端、落在横条上方，整块在视口内
  await openAnnList(page);
  const b = await rects();
  expect(Math.abs(b.pop.right - b.strip.right)).toBeLessThan(2);
  expect(b.pop.bottom).toBeLessThanOrEqual(b.strip.top);
  expect(Math.round(b.pop.width)).toBe(280);
  expect(b.pop.top).toBeGreaterThan(0);
  await closeAnnList(page);

  // 收起左栏：面板退场，横条与它的 Pages 开关照旧在视口内
  await page.locator('#wbside-toggle').click();
  // 面板收起是 width 过渡（--wb-dur），点完立刻量还在半路上 —— poll 到位。
  await expect.poll(async () => Math.round((await rects()).side.width)).toBe(0);
  const c = await rects();
  expect(Math.round(c.strip.bottom)).toBe(c.vh - 12);
  expect(c.strip.left).toBeGreaterThan(0);
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeVisible();

  // 阅读器形态（owner 2026-09-05 裁决，取代 09-04 的「stage 让开左栏与横条」）：
  // 文档 1:1 铺满整个视口，玻璃面板与横条压在文档上，和画布页一模一样 ——
  // 文档底下不露画布。判据：doc iframe 矩形 = 视口；面板与横条的矩形都落在
  // 它里面；面板中心 elementFromPoint 命中的是面板自己（浮在文档之上）。
  await page.locator('#wbpages [data-vpage="doc-library"]').click();
  await expect(page.locator('#wb-board-panel .wb-doc-frame')).toHaveCount(1);
  const docGeom = () => page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) };
    };
    const doc = r('#wb-board-panel .wb-doc-frame');
    const side = r('#wbside');
    const strip = r('#wbstrip');
    const inside = (a) => a.left >= doc.left && a.top >= doc.top && a.right <= doc.right && a.bottom <= doc.bottom;
    const sideEl = document.querySelector('#wbside');
    const hit = side.right > side.left
      ? document.elementFromPoint((side.left + side.right) / 2, (side.top + side.bottom) / 2)
      : null;
    return {
      doc, sideWidth: side.right - side.left, vw: window.innerWidth, vh: window.innerHeight,
      sideInside: inside(side), stripInside: inside(strip),
      panelAboveDoc: !!hit && sideEl.contains(hit),
    };
  });
  await expect.poll(docGeom).toMatchObject({ sideInside: true, stripInside: true, panelAboveDoc: true });
  const d = await docGeom();
  expect(d.doc).toEqual({ left: 0, top: 0, right: d.vw, bottom: d.vh });
  expect(d.sideWidth).toBeGreaterThan(0);

  // 收起面板：文档矩形不变（本来就满铺，没有东西要收回来），横条仍在文档上。
  await page.locator('#wbside-toggle').click();
  await expect.poll(async () => (await docGeom()).sideWidth).toBe(0);
  const e = await docGeom();
  expect(e.doc).toEqual({ left: 0, top: 0, right: e.vw, bottom: e.vh });
  expect(e.stripInside).toBe(true);
});

test('左栏 splitter 拖宽 / 折叠偏好在浮动面板上照旧（ADR 0016 左栏那一半）', async ({ page }) => {
  await openWorkbench(page);
  const split = page.locator('#wbsplit');
  expect(await sideWidth(page)).toBe(250);
  await expect(split).toHaveAttribute('aria-valuemin', '200');
  await expect(split).toHaveAttribute('aria-valuemax', '480');
  await expect(split).toHaveAttribute('aria-valuenow', '250');

  // splitter 钉在面板右缘：拖它 = 改面板宽度
  await dragSideSplitter(page, 90);
  expect(await sideWidth(page)).toBe(340);
  await expect(split).toHaveAttribute('aria-valuenow', '340');
  await expect.poll(async () => (await readWbPrefs(page)).sideWidth).toBe(340);

  // 键盘步进：ArrowLeft 收窄 16，Shift 一步 40
  await split.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => sideWidth(page)).toBe(324);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => sideWidth(page)).toBe(364);

  // 双击折叠、单击复开，偏好落盘
  await split.dblclick();
  await expect(page.locator('#wbside')).toBeHidden();
  await expect.poll(async () => (await readWbPrefs(page)).sideCollapsed).toBe(true);
  await split.click();
  await expect(page.locator('#wbside')).toBeVisible();
  await expect.poll(() => sideWidth(page)).toBe(364);

  // reload 后宽度保持，splitter 仍贴在面板右缘
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect.poll(() => sideWidth(page)).toBe(364);
  expect(await page.evaluate(() => {
    const side = document.querySelector('#wbside').getBoundingClientRect();
    const bar = document.querySelector('#wbsplit').getBoundingClientRect();
    return Math.abs((bar.left + bar.right) / 2 - side.right) < 4;
  })).toBe(true);
  await dragSideSplitter(page, -114);
  expect(await sideWidth(page)).toBe(250);
});

/* 右栏（标注工作台）随 2026-09-04 外壳重设计整栏退役 —— 宽度拖拽 / 双击复位 /
   宽度偏好 / 280 紧凑断点 / 折叠浮钮五条用例随功能一起删除（ADR 0016 右栏那一半
   作废）。它承过的三件事在新外壳里各有归宿，都已另有用例覆盖：
     · 栏宽偏好 → 左栏 splitter 用例（见上「ADR 0016 左栏那一半」）；
     · 折叠 / 复开 → 横条左端的 Pages 开关（上一条主用例 + 几何用例）；
     · 标注列表的可读性 → 弹出列表的几何与行内容用例（下方 wb-ann-item 几何断言）。 */

test('弹出列表：定位不被自己盖住、行几何在卡内（2026-09-04 H2 owner 批注 2）', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'popover geometry mark');
  await openAnnList(page);
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);

  // 行整行落在卡内（点得到 ≠ 人看得见 —— 比 bounding box）
  expect(await withinContainerViolations(page, '#wbann-list .wb-ann-item', '#wbann-pop')).toEqual([]);

  // 「定位」之后：被定位的 frame 不落在列表矩形里（owner 批注 2 的第二条）——
  // nudgeAwayFromPopover 把画布横向推开。层级那一半（批注 2 的第一条）在下一条
  // 用例里断（点亮源用 hover，比定位的 3s 窗口稳）。
  await page.locator('#wbann-list .wb-ann-item-main').click();
  await expectLocatedTarget(page, '[data-screen="settings"] .ios-stage');

  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await closeAnnList(page);
});

test('右下浮层槽一个位置两个住客：detail 与列表二选一、列表优先、Esc 关（2026-09-04）', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'dock slot mark');

  // 选中一个 frame → detail 进槽（ADR 0026 的面板，右栏退役后住这里）。
  // 图注要在交互模式下才点得到 —— 标注模式的 overlay 吃掉画布上的点击。
  await page.locator('#wbann-interact').click();
  await page.locator('#wb-board-panel [data-screen="home"] .wb-screen-cap').click();
  await expect(page.locator('#wbdetail')).toBeVisible();
  await expect(page.locator('#wbann-pop')).toHaveCount(0);
  const slot = await page.evaluate(() => {
    const card = document.querySelector('#wbdetail').closest('.wb-dock-card').getBoundingClientRect();
    const strip = document.querySelector('#wbstrip').getBoundingClientRect();
    return { rightAligned: Math.abs(card.right - strip.right) < 2, aboveStrip: card.bottom <= strip.top, width: Math.round(card.width) };
  });
  expect(slot).toEqual({ rightAligned: true, aboveStrip: true, width: 280 });

  // 列表优先：点计数钮，detail 让位（两者永不同时出现）
  await openAnnList(page);
  await expect(page.locator('#wbdetail')).toHaveCount(0);
  await expect(page.locator('#wbann-pop')).toBeVisible();

  // Esc 先关列表 —— 选中还在，所以 detail 回到槽里
  await page.keyboard.press('Escape');
  await expect(page.locator('#wbann-pop')).toHaveCount(0);
  await expect(page.locator('#wbdetail')).toBeVisible();

  // 再一次 Esc 清选中 → 槽空
  await page.keyboard.press('Escape');
  await expect(page.locator('#wbdetail')).toHaveCount(0);
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).not.toHaveClass(/wb-sel/);

  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
});

test('画布钉子常显高对比，评论卡 hover 钉子才出（2026-09-04 H owner 批注 1）', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'pin contrast mark');
  const badge = page.locator('#ann-marks .ann-badge').first();
  await expect(badge).toHaveCount(1);

  // 钉子：22px accent 实心圆 + 白字 + 白描边（高对比，常显不打折）
  const pin = await badge.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { w: cs.width, h: cs.height, radius: cs.borderRadius, color: cs.color, shadow: cs.boxShadow };
  });
  expect(pin.w).toBe('22px');
  expect(pin.h).toBe('22px');
  expect(pin.color).toBe('rgb(255, 255, 255)');
  expect(pin.shadow).toContain('rgb(255, 255, 255)');   // 2px 白描边

  // 交互模式下钉子照样在（常显）
  await page.locator('#wbann-interact').click();
  await expect(page.locator('#ann-marks .ann-badge')).toHaveCount(1);
  await page.locator('#wbann-toggle').click();

  // 评论卡：默认不显示，hover 钉子 120ms 后出现在钉子右侧，移开收起
  const bubble = page.locator('#ann-bubbles .ann-bubble').first();
  await expect(bubble).toHaveCount(1);
  await expect(bubble).not.toHaveClass(/ann-bubble--show/);
  await badge.hover();
  await expect(bubble).toHaveClass(/ann-bubble--show/);
  // 卡显示时整个 #ann-overlay 升到右下浮层槽（#wbdock）之上 —— owner 批注 2 的
  // 第一条：列表不许压住被点亮的气泡。
  expect(await page.evaluate(() => {
    const overlay = document.querySelector('#ann-overlay');
    const dock = document.getElementById('wbdock');
    return parseInt(getComputedStyle(overlay).zIndex, 10) > parseInt(getComputedStyle(dock).zIndex, 10);
  })).toBe(true);
  expect(await page.evaluate(() => {
    const b = document.querySelector('#ann-bubbles .ann-bubble').getBoundingClientRect();
    const p = document.querySelector('#ann-marks .ann-badge').getBoundingClientRect();
    return b.left >= p.left;                              // 卡在钉子右侧（够宽时不翻面）
  })).toBe(true);
  await page.locator('#wbstrip-title').hover();
  await expect(bubble).not.toHaveClass(/ann-bubble--show/);

  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
});

// 画布标签的三档字 + 「···」的落位（2026-09-04 评审板 E1，owner「这个可以」）。
// 字号断言比的是画布坐标里的 CSS px：画布基准 scale 0.5，所以区头 26 = 观感 13、
// 屏名 24 = 12、引用号 21 = 10.5。
test('画布标签三档字，「···」跟在屏名后面而不是钉在行尾（2026-09-04 E1）', async ({ page }) => {
  await openWorkbench(page);
  const frame = page.locator('#wb-board-panel [data-screen="home"]');
  const cap = frame.locator('.wb-screen-cap');

  const type = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const resolve = (token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const tokens = { fg: resolve('--wb-fg'), muted: resolve('--wb-muted'), accent: resolve('--wb-accent') };
    probe.remove();
    const read = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return {
        size: Math.round(parseFloat(style.fontSize)),
        weight: style.fontWeight,
        color: style.color,
        mono: /mono|Menlo|Consolas|ui-monospace/i.test(style.fontFamily),
      };
    };
    return {
      tokens,
      section: read('#lib-home .wb-lib-cap'),
      sectionRef: read('#lib-home .wb-lib-cap .wb-cap-ref--section'),
      name: read('[data-screen="home"] .wb-cap-title'),
      ref: read('[data-screen="home"] .wb-cap-ref'),
    };
  });
  expect(type.section).toMatchObject({ size: 26, weight: '600', color: type.tokens.fg });
  expect(type.name).toMatchObject({ size: 24, weight: '500', color: type.tokens.muted });
  expect(type.ref).toMatchObject({ size: 21, color: type.tokens.accent, mono: true });
  expect(type.sectionRef).toMatchObject({ size: 21, color: type.tokens.accent, mono: true });
  // 区头的 A 和区名同一行（引用号是行内元素，不再自己占一行）
  expect(await page.evaluate(() => {
    const head = document.querySelector('#lib-home .wb-lib-cap');
    const ref = head.querySelector('.wb-cap-ref--section').getBoundingClientRect();
    return Math.abs(ref.top - head.getBoundingClientRect().top) < ref.height;
  })).toBe(true);

  // 「···」是 caption 那条 flex 的末位：紧跟屏名，右边还剩大半行 —— 它曾经钉在
  // 438px 宽标签行的最右角（padding-right:40px + right:0），离标题老远。
  await cap.hover();
  const geo = await page.evaluate(() => {
    const capNode = document.querySelector('[data-screen="home"] .wb-screen-cap');
    const r = (node) => node.getBoundingClientRect();
    return {
      cap: r(capNode),
      title: r(capNode.querySelector('.wb-cap-title')),
      shell: r(capNode.querySelector('.wb-frame-menu-shell')),
    };
  });
  expect(geo.shell.left).toBeGreaterThanOrEqual(geo.title.right - 1);
  expect(geo.shell.right).toBeLessThanOrEqual(geo.cap.right);
  // 「贴着标签」的判据：到标题的距离远小于到行尾的距离
  expect(geo.shell.left - geo.title.right).toBeLessThan(geo.cap.right - geo.shell.right);

  // 常态收起、hover 才现；键盘照样够得着（focus 也点亮，且它一直在 tab 序里）
  const shellOpacity = () => page.evaluate(
    () => getComputedStyle(document.querySelector('[data-screen="home"] .wb-frame-menu-shell')).opacity
  );
  await page.locator('#wbstrip-title').hover();
  await expect.poll(shellOpacity).toBe('0');
  await frame.locator('.wb-frame-menu-trigger').focus();
  await expect.poll(shellOpacity).toBe('1');
  expect(await page.evaluate(
    () => document.activeElement === document.querySelector('[data-screen="home"] .wb-frame-menu-trigger')
  )).toBe(true);
});

test('尺寸行只在这一帧 hover 或选中时出，且出没不推版面（2026-09-04 E1）', async ({ page }) => {
  await openWorkbench(page);
  const opacity = (screenId) => page.evaluate(
    (id) => getComputedStyle(document.querySelector(`[data-screen="${id}"] .wb-screen-dim`)).opacity,
    screenId,
  );
  const homeCap = page.locator('#wb-board-panel [data-screen="home"] .wb-screen-cap');

  // 常态：一行都不出（「尺寸行常驻太吵」）
  await page.locator('#wbstrip-title').hover();
  await expect.poll(() => opacity('home')).toBe('0');
  await expect.poll(() => opacity('beans')).toBe('0');

  // 行高留着：opacity 不是 display —— hover 前后 frame 的高度一模一样
  const heightOf = () => page.evaluate(
    () => document.querySelector('[data-screen="home"] .wb-screen-dim').getBoundingClientRect().height
  );
  const idleHeight = await heightOf();
  expect(idleHeight).toBeGreaterThan(0);

  // hover 只点亮这一帧
  await homeCap.hover();
  await expect.poll(() => opacity('home')).toBe('1');
  await expect.poll(() => opacity('beans')).toBe('0');
  expect(await heightOf()).toBeCloseTo(idleHeight, 1);

  // 选中：鼠标移开也留着（选中是持久态，hover 不是）
  await homeCap.click();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toHaveClass(/wb-sel/);
  await page.locator('#wbstrip-title').hover();
  await expect.poll(() => opacity('home')).toBe('1');
  await expect.poll(() => opacity('beans')).toBe('0');
});

// 切片 ③ 第 15 条的核查结论：选中本来就有 2px accent 实环 + 6px 淡晕，够看；
// hover 什么都没有，鼠标在哪一帧全靠猜 —— 所以补的是 hover 那一档（2px accent
// 30%），选中态照旧压过它。两者与标注的琥珀目标框天然分色：环是 accent、在机身
// 外缘，标注框是琥珀、在元素上。
test('画布 frame：hover 出淡 accent 环，选中压过它，都不与标注琥珀撞色（2026-09-04）', async ({ page }) => {
  await openWorkbench(page);
  const frame = page.locator('#wb-board-panel [data-screen="home"]');
  const stage = frame.locator('.ios-stage');
  // 环色不写字面 rgb：color-mix 的序列化形式不稳（同一个值在 rgba(...) 与
  // color(srgb ...) 之间飘），拿一个同样写法的探针元素比，比的是「就是 accent
  // 30%」而不是某一版 Chromium 的字符串。
  const ring = () => stage.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.outlineColor = 'color-mix(in srgb, var(--wb-accent) 30%, transparent)';
    document.body.appendChild(probe);
    const accent30 = getComputedStyle(probe).outlineColor;
    probe.remove();
    const style = getComputedStyle(node);
    return {
      width: style.outlineWidth,
      hovered: style.outlineColor === accent30,
      clear: /(^rgba\(0, 0, 0, 0\)$)|(\/ 0\))/.test(style.outlineColor),
      shadow: style.boxShadow,
    };
  });

  // 常态：环在，但是透明的（淡入淡出的是 outline-color，见 index.html 注释）
  await page.locator('#wbstrip-title').hover();
  await expect.poll(async () => (await ring()).clear).toBe(true);
  expect((await ring()).width).toBe('2px');

  // hover：2px accent 30%。过渡是 --wb-dur，断言要等它落定 —— 中途取到的是插值色。
  await stage.hover();
  await expect.poll(async () => (await ring()).hovered).toBe(true);
  expect((await ring()).width).toBe('2px');
  expect((await ring()).shadow).not.toContain('rgb(91, 127, 166)'); // 还不是选中

  // 选中：实心 accent 环接管，hover 的淡环让位（不叠两层）
  await frame.locator('.wb-screen-cap').click();
  await expect(frame).toHaveClass(/wb-sel/);
  await expect.poll(async () => (await ring()).clear).toBe(true);
  expect((await ring()).shadow).toContain('rgb(91, 127, 166)');

  // 标注模式下环照旧在，且与琥珀目标框分色（accent 环 ≠ 琥珀框）
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  await frame.locator('.ios-cell').first().click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  const target = await page.locator('.ann-target').first().evaluate(
    (node) => getComputedStyle(node).borderColor
  );
  expect(target).toContain('245, 166, 35');            // 琥珀
  expect((await ring()).shadow).toContain('rgb(91, 127, 166)'); // 机身仍是 accent
  await box.locator('#ann-cancel').click();
  await page.evaluate(() => window.pinpoint.setMode(false));
});

test('first visit lands focused on the first frame at the 100% default zoom (2026-08-17 基准重定标)', async ({ page }) => {
  // 2026-08-17 基准重定标（owner 决定）：视觉 = zoom × 0.5（0.5 烘进基准），
  // zoom 轴 100% = 舒适默认（= 旧轴 50% 的视觉）。首访（无 pageViewports 存档）
  // 切页/首屏直接聚焦第一个 section 的第一个 frame；回访仍恢复存档视口。
  await openWorkbench(page);
  await expect(page.locator('#wbzoom-label')).toHaveText('100%');
  // 第一个 section = home，第一帧 = home 屏：首访即居中，不再停在板原点
  await expectFocusedTarget(page, '[data-screen="home"] .ios-stage');
  await expect.poll(() => page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--wb-board-zoom').trim()
  )).toBe('1');

  // 回访语义不变：手动调走再切回，恢复的是存档位置而不是首访聚焦
  await page.locator('#wbzoom-in').click(); // 110%（存档 zoom=1.1）
  await expect(page.locator('#wbzoom-label')).toHaveText('110%');
  // zoom 落盘是 200ms 防抖：poll 回调必须容错返回 undefined 等收敛，直接链式
  // 取值会在存档未落时抛 TypeError（部分 Playwright 版本不重试非断言异常）
  await expect.poll(async () => {
    const p = await readWbPrefs(page);
    return p.pageViewports && p.pageViewports.library && p.pageViewports.library.canvasZoom;
  }).toBe('1.1');
  await page.locator('#wbpages [data-vpage="components"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="button/catalog"]')).toBeVisible();
  await page.locator('#wbpages [data-vpage="library"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wbzoom-label')).toHaveText('110%');
});

test('zoom axis migration doubles legacy saved viewports once (2026-08-17 基准重定标)', async ({ page }) => {
  // 旧轴存档（视觉 = zoom）：canvasZoom '0.5' 是当时的舒适默认。迁移应 ×2 成
  // 新轴 '1'（视觉不变 = HUD 100%），打 zoomAxis:2 标记防重跑。
  await page.addInitScript(() => {
    localStorage.setItem('pinpoint-wb', JSON.stringify({
      pageViewports: { library: { canvasZoom: '0.5', scrollLeft: 0, scrollTop: 0 } }
    }));
  });
  await openWorkbench(page);
  await expect(page.locator('#wbzoom-label')).toHaveText('100%');
  await expect.poll(async () => (await readWbPrefs(page)).zoomAxis).toBe(2);
  await expect.poll(async () => {
    const p = await readWbPrefs(page);
    return p.pageViewports && p.pageViewports.library && p.pageViewports.library.canvasZoom;
  }).toBe('1');
  // reload 不再翻倍
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbzoom-label')).toHaveText('100%');
  await expect.poll(async () => {
    const p = await readWbPrefs(page);
    return p.pageViewports && p.pageViewports.library && p.pageViewports.library.canvasZoom;
  }).toBe('1');
});

test('left sidebar hides entry type tags below 230 and restores (2026-08-16f 阶段 7)', async ({ page }) => {
  // 紧凑断点机制（boot-prefs applySideWidth → #wbside.compact）随 pill 退役改指
  // 产物条目的类型 tag：<230 整枚隐藏，只留标题；断点与宽度偏好行为不变。
  // 固件 = e2e-mixed（混合板，产物组有「画布/文档」两枚 tag）。
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await expect(page.locator('#wbcontents [data-entry="spec"]')).toBeVisible();
  const side = page.locator('#wbside');
  const tags = page.locator('#wbcontents .wb-entry-tag');

  // 默认 250：产物条目各带 tag（画布 + 文档）
  expect(await sideWidth(page)).toBe(250);
  await expect(side).not.toHaveClass(/compact/);
  await expect(tags).toHaveText(['画布', '文档']);

  // 左拖 120：250 - 120 = 130 → clamp 200 < 230，tag 整枚隐藏
  await dragSideSplitter(page, -120);
  expect(await sideWidth(page)).toBe(200);
  await expect(side).toHaveClass(/compact/);
  await expect(page.locator('#wbcontents .wb-entry-tag:visible')).toHaveCount(0);
  // 条目行本身仍在（坍缩的只是 tag，不是条目）
  await expect(page.locator('#wbcontents [data-entry="spec"]')).toBeVisible();

  // 拖回 300 ≥ 230 自动恢复；reload 后偏好保持
  await dragSideSplitter(page, 100);
  expect(await sideWidth(page)).toBe(300);
  await expect(side).not.toHaveClass(/compact/);
  await expect(tags).toHaveText(['画布', '文档']);
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect.poll(async () => (await readWbPrefs(page)).sideWidth).toBe(300);
  await expect(side).not.toHaveClass(/compact/);
  await expect(page.locator('#wbcontents [data-entry="spec"]')).toBeVisible();
});

test('sidebar rows stay within their panel at default and compact widths (2026-08-17 ScrollArea 内层修复)', async ({ page }) => {
  // Radix ScrollArea viewport 内层是内联 display:table，内容按自然宽排版、不随
  // 栏宽收缩，行尾 copy 钮被 #wbside 的 overflow-x:hidden 裁出栏外（实况：自然
  // 宽 274 > 栏宽 250）。index.html 已强制回 block；本用例用几何断言防回归——
  // 点击不查祖先裁剪（首轮排查「点得到但人看不到」的教训），必须比 bounding box。
  await openWorkbench(page);

  // 弹出列表（原右栏那一半）：播种一条标注，列表行整行在 280 卡内
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'geometry guard mark');
  await openAnnList(page);
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  expect(await withinContainerViolations(page, '#wbann-list .wb-ann-item', '#wbann-pop')).toEqual([]);
  await closeAnnList(page);
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await page.locator('#wbann-interact').click();

  // 左栏：混合板页（产物条目带 tag），默认 250 与紧凑 200 两档——
  // Page 行、内容区条目行全部在栏内（2026-08-17 行尾钮随右键菜单退役）
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await expect(page.locator('#wbcontents [data-entry="spec"]')).toBeVisible();
  expect(await sideWidth(page)).toBe(250);
  expect(await withinContainerViolations(page, '.wb-page-row', '#wbside')).toEqual([]);
  expect(await withinContainerViolations(page, '.wb-page', '#wbside')).toEqual([]);
  expect(await withinContainerViolations(page, '#wbcontents [data-entry]', '#wbside')).toEqual([]);

  await dragSideSplitter(page, -120);
  expect(await sideWidth(page)).toBe(200);
  await expect(page.locator('#wbside')).toHaveClass(/compact/);
  expect(await withinContainerViolations(page, '.wb-page-row', '#wbside')).toEqual([]);
  expect(await withinContainerViolations(page, '.wb-page', '#wbside')).toEqual([]);
  expect(await withinContainerViolations(page, '#wbcontents [data-entry]', '#wbside')).toEqual([]);
});
