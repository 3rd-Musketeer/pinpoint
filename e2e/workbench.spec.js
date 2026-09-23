// Functional navigation checks final state; scroll-motion.spec.js covers real motion.
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';


import { E2E_DATA_DIR } from './env.js';

test.use({ reducedMotion: 'reduce' });
// Every story starts with its own empty ledger, independent of spec ordering.
test.beforeEach(() => fs.rm(E2E_DATA_DIR, {recursive:true, force:true}));

// The e2e server runs with PREVIEW_TEMPLATE_ONLY=1 (playwright.config.js), so
// every assertion here targets template content only — instance-local pages and
// components are hidden and counts stay deterministic on any machine.

async function openWorkbench(page) {
  // 深链显式钉 e2e-ios：无 ?page= 时工作台落 manifest.defaultPage（范例页），
  // 而本文件的画布 / 标注用例标的从来是 e2e-ios 的板——钉死基页，让用例不依赖
  // 默认页是哪一页。
  await page.goto('/index.html?page=e2e-ios');
  await page.waitForFunction(() => window.workbench && window.pinpoint?.getState().connected && !window.pinpoint.getState().routing);
}

async function saveAnnotation(page, target, comment) {
  await target.click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('#ann-input').fill(comment);
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
  await expect(page.locator('.wb-ann-more-menu [data-bubble]').filter({hasText:label}).locator('span')).toHaveText('✓');
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

/* 列表固定展开；实际标注目标可见且不被列表遮挡。 */
async function expectLocatedTarget(page) {
  await expect(page.locator('#ann-box')).toBeVisible();
  await expect(page.locator('#wbann-pop')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector('.ann-draft-target');
    const pop = document.querySelector('#wbann-pop');
    const strip = document.querySelector('#wbstrip');
    if (!target || !pop || !strip) return false;
    const t = target.getBoundingClientRect(), p = pop.getBoundingClientRect(), st = strip.getBoundingClientRect();
    const covered = t.right > p.left && t.left < p.right && t.bottom > p.top && t.top < p.bottom;
    return !covered && t.right > 0 && t.left < innerWidth && t.bottom > 0 && t.top < st.top;
  })).toBe(true);
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
  // pp2 切片 2：Component Library 系统页退役，清单里不再有系统行。
  // 2026-08-17g：行尾新增相对时间元素，标题断言收窄到 .wb-page-t。
  await expect(page.locator('#wbpages .wb-page-t')).toHaveText([
    'E2E iOS',
    'E2E Site',
    'E2E Proxy App',
    'E2E Dir',
    'E2E Dir iOS',
    'E2E Mention Doc',
    'E2E Mixed',
    'E2E Doc',
  ]);

  for (const [pageId, screenId] of [
    ['e2e-doc', 'report'],
    ['e2e-ios', 'home'],
    ['e2e-ios', 'timer'],
  ]) {
    await page.locator(`#wbpages [data-vpage="${pageId}"]`).click();
    await expect(page.locator(`#wb-board-panel [data-screen="${screenId}"]`)).toBeVisible();
    await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  }

  await page.evaluate(() => {
    window.workbench.setActivePage('e2e-doc');
    window.workbench.setActivePage('e2e-ios');
  });

  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-ios');
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pinpoint-wb')).activePageId)).toBe('e2e-ios');
});

test('Pages is one mixed list of untyped rows and no mode Seg', async ({ page }) => {
  await openWorkbench(page);

  // 模式 Seg 退役；本地页 + registry 条目混排（顺序 = 系统行 → _index → registry）。
  // 阶段 4：url 条目（E2E Site / E2E Proxy App）恒 doc 壳同列。
  // 阶段 5：e2e-mention 固件（doc 壳 mention 文档）追加在尾。
  // 阶段 6：e2e-mixed 固件（混合板）追加在尾。
  // 阶段 7：Page 去类型化 —— 行 = 纯标题（壳标 pill / data-page-mode 一并撤除）。
  // pp2 切片 2：Component Library 系统页退役，清单里不再有系统行。
  // 2026-08-17g：行尾新增相对时间元素，标题断言收窄到 .wb-page-t。
  await expect(page.locator('#wbboard-mode')).toHaveCount(0);
  await expect(page.locator('#wbpages .wb-page-t')).toHaveText([
    'E2E iOS',
    'E2E Site',
    'E2E Proxy App',
    'E2E Dir',
    'E2E Dir iOS',
    'E2E Mention Doc',
    'E2E Mixed',
    'E2E Doc',
  ]);

  // 类型信息只以图标出现，不再有 pill / data-page-mode。
  // 2026-09-05：每行一个类型图标（画布 / 文档 / 网页），数量 = 行数。
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await expect(page.locator('#wbpages .wb-page-kind')).toHaveCount(await page.locator('#wbpages .wb-page').count());
  await expect(page.locator('#wbpages .wb-page[data-page-mode]')).toHaveCount(0);

  // 点文档页 → stage 变阅读器；点回机壳页 → 画布回来。
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
  await expect(page.locator('#wb-board-panel .wb-doc-frame')).toHaveCount(1);
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-ios"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wbcanvas-tools')).toBeVisible();
});

test('HTML board fills the viewport, drops canvas chrome, and collapses the contents section (2026-08-16f 阶段 7)', async ({ page }) => {
  await openWorkbench(page);

  // 壳形态是选中条目的属性：点文档页（单 doc 条目），stage 即阅读器。
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();

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
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-ios"]').click();
  await expect(page.locator('#wb-board-panel .wb-doc-frame')).toHaveCount(0);
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await expect(page.locator('#wbcontents')).toBeVisible();
  await expect(page.locator('#wbcontents [data-entry]')).toHaveCount(0);
  await expect(page.locator('#wboutline [data-ol-frame]')).not.toHaveCount(0);
});

test('sidebar rows expose locator copy / rename via right-click menu (2026-08-17)', async ({ page, context }) => {
  // 行级动作全部在右键菜单（行尾 hover 钮已退役）：Pages 行 = 复制 @page +
  // 重命名；产物 doc 条目 = 复制 @frame；画布条目 = 复制 @page；frame 树行 =
  // 复制 @frame。复制项点击后菜单保持打开并显示
  // 「已复制 <全文>」（行上无可见元素，菜单是复制反馈的唯一落点）。
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openWorkbench(page);
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await expect(page.locator('#wbcontents [data-entry="spec"]')).toBeVisible();
  const readClip = () => page.evaluate(() => navigator.clipboard.readText());

  // Page 行：复制 @page；同一开着的菜单里再点重命名 → 行内输入框出现
  await page.getByRole('tab', {name:'页面', exact:true}).click();
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

  // 产物 doc 条目：复制 @frame 后菜单仍开着（doc 导出对话框已随 pp2 切片 3 退役）
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await page.locator('#wbcontents [data-entry="spec"]').click({ button: 'right' });
  await page.locator('[data-copy-frame="e2e-mixed/spec"]').click();
  await expect.poll(readClip).toBe('@frame:e2e-mixed/spec');
  await page.keyboard.press('Escape');

  // 画布条目：复制 @page（画布 = 页面默认视图，@frame 语法不覆盖它）
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await page.locator('#wbcontents [data-entry="@canvas"]').click({ button: 'right' });
  await page.locator('[data-copy-page="e2e-mixed"]').click();
  await expect.poll(readClip).toBe('@page:e2e-mixed');
  await page.keyboard.press('Escape');

  // frame 树行：复制 @frame
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await page.locator('#wboutline [data-ol-frame="home"]').click({ button: 'right' });
  await page.locator('[data-copy-frame="e2e-mixed/home"]').click();
  await expect.poll(readClip).toBe('@frame:e2e-mixed/home');
  await page.keyboard.press('Escape');
  // Wait for the context menu to restore focus before opening the next menu.
  await expect(page.locator('#wboutline [data-ol-frame="home"]')).toBeFocused();
  const trigger = page.locator('[data-screen="home"] .wb-frame-menu-trigger');
  await trigger.press('Enter');
  const frameCopy = page.locator('[data-screen="home"] [data-frame-copy]');
  await expect(frameCopy).toBeVisible();
  await frameCopy.click();
  await expect.poll(readClip).toBe('@frame:e2e-mixed/home');

});

test('doc annotate layer stays pinned to the viewport after the document scrolls', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();

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
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
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
    const ta = d.querySelector('#ann-input');
    ta.value = 'sidebar sync check';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    d.querySelector('#ann-save').click();
  });

  await expect.poll(async () => (await docState()).count).toBe(1);
  await openAnnList(page);
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await expect(page.locator('#wbann-list')).toContainText('sidebar sync check');
  await closeAnnList(page);
});

test('HTML board: annotations redraw when an interactive view hides and returns', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
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
    const ta = d.querySelector('#ann-input');
    ta.value = 'interactive view redraw';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    d.querySelector('#ann-save').click();
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
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
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
    const pill = box && box.querySelector('.ann-inline-target');
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
  expect(out.pillLabel).toContain('峰值');
});

test('HTML board: "render comments" toggle draws content bubbles on the canvas', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
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
      const ta = d.querySelector('#ann-input');
      ta.value = '评论内容 ' + sel;
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      d.querySelector('#ann-save').click();
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
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
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
      const ta = d.querySelector('#ann-input');
      ta.value = '评论 ' + sel;
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      d.querySelector('#ann-save').click();
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
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
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
      const ta = d.querySelector('#ann-input');
      ta.value = '评论 ' + sel;
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      d.querySelector('#ann-save').click();
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
  // 坏页是 e2e-doc：「回到 Pages」落默认页（清单第一行 e2e-site，好的），两头互不干扰。
  await page.route('**/sites/e2e-doc/board.json', async (route) => {
    if (!broken) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  });

  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
  const panel = page.locator('#wb-board-panel .wb-screen-err');
  await expect(panel).toBeVisible();
  // 说明保留出处与原因，动作固定两个
  await expect(panel.locator('.wb-screen-err-src')).toContainText('/sites/e2e-doc/board.json');
  await expect(panel.locator('[data-err-home]')).toHaveText('回到 Pages');
  await expect(panel.locator('[data-err-retry]')).toHaveText('重试');

  // 「回到 Pages」= 落到一个能打开的页（默认页 = 清单第一行）+ 左栏展开（折叠着也要看得见 Pages）
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeHidden();
  await panel.locator('[data-err-home]').click();
  await expect(page.locator('#wbside')).toBeVisible();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-ios');

  // 回到坏页 → 面板重现；修好后「重试」原地把板拉回来，不用刷新整页
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
  await expect(panel).toBeVisible();
  broken = false;
  await panel.locator('[data-err-retry]').click();
  await expect(page.locator('#wb-board-panel [data-screen="report"]')).toBeVisible();
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
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-ios');
  await expect.poll(() => page.url()).toContain('page=e2e-ios');
});

test('深链失效面板的「重试」：页面清单里出现了那个 id 就直接打开它', async ({ page }) => {
  let hidden = true;
  await page.route('**/registry', async (route) => {
    if (!hidden) {
      await route.fallback();
      return;
    }
    // e2e-doc 暂时不在登记表里 —— 等价于「这个 id 还没登记」
    const response = await route.fetch();
    const doc = await response.json();
    doc.entries = doc.entries.filter((e) => e.id !== 'e2e-doc');
    await route.fulfill({ response, json: doc });
  });

  await page.goto('/index.html?page=e2e-doc');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  const panel = page.locator('#wb-board-panel .wb-screen-err');
  await expect(panel.locator('.wb-screen-err-title')).toHaveText('页面不存在');
  expect(page.url()).toContain('page=e2e-doc');

  hidden = false;
  await panel.locator('[data-err-retry]').click();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-doc');
  await expect(page.locator('#wb-board-panel .wb-doc-frame').first()).toBeVisible();
  // 落到真实页后地址栏恢复同步
  await expect.poll(() => page.url()).toContain('page=e2e-doc');
});

test('screen loader rejects a dev-server fallback document instead of nesting the workbench', async ({ page }) => {
  await page.route('**/sites/e2e-ios/home.html*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>pinpoint</title></head><body><div id="wbroot" class="wb"><aside class="wb-side">Sidebar</aside></div></body></html>',
  }));

  await openWorkbench(page);

  const frame = page.locator('#wb-board-panel [data-screen="home"]');
  await expect(frame.locator('.wb-screen-err')).toContainText('full HTML document');
  await expect(frame.locator('#wbroot, .wb-side')).toHaveCount(0);
});

test('doc iframe 重载后标注桥自动重绑（2026-08-17e）', async ({ page }) => {
  await page.goto('/index.html?page=e2e-doc');
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

test('/api/export-image renders an isolated padded PNG from a posted snapshot', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wb-board-panel [data-screen="recipe"] [data-ratio-cycle]').click();

  // workbench 侧的 exportSnapshot API 已随导出削减退役（pp2 切片 3）；端点
  // （ppnt shot 要用）继续吃契约快照 —— 这里按契约手工组一份。
  const snapshot = await page.evaluate(() => {
    const target = document.querySelector('#wb-board-panel [data-screen="recipe"]');
    const clone = target.cloneNode(true);
    clone.querySelectorAll('script,[data-export-ui]').forEach((node) => node.remove());
    return {
      kind: 'frame',
      pageId: 'e2e-ios',
      sectionId: 'brew-flow',
      screenId: 'recipe',
      format: 'png',
      scale: 2,
      background: 'canvas',
      tokens: {},
      html: clone.outerHTML,
    };
  });
  expect(snapshot.html).toContain('1:16');

  const response = await page.request.post('/api/export-image', { data: snapshot });
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toBe('image/png');
  expect(Number(response.headers()['x-export-width'])).toBeGreaterThan(0);
  expect(Number(response.headers()['x-export-height'])).toBeGreaterThan(0);
  const body = await response.body();
  expect(body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test('画布点选模型：原型内部不动选中、板空白清选中（2026-08-17 选中模型）', async ({ page }) => {
  await page.route('**/sites/e2e-ios/board.json', async route => {
    const response = await route.fetch(); const board = await response.json();
    board.sections[0].note = 'retired section';
    const first = board.sections[0].screens[0];
    board.sections[0].screens[0] = typeof first === 'string' ? { id: first, note: 'retired frame' } : { ...first, note: 'retired frame' };
    await route.fulfill({ response, json: board });
  });
  await openWorkbench(page);
  const section = page.locator('[data-ann-section="brew-flow"].wb-lib-item');
  await section.locator(':scope > .wb-lib-cap').click();
  await expect(section).toHaveClass(/wb-sel/);
  await page.getByRole('tab', { name: '大纲', exact: true }).click();
  await page.locator('[data-ol-section="brew-flow"] > .ol-sec').click();
  await expect(section).toHaveClass(/wb-sel/);
  await expect(page.locator('#wbdetail, [data-frame-note]')).toHaveCount(0);
  const detail = page.locator('#wbdetail');
  await expect(detail).toHaveCount(0);

  // frame 树行只定位、高亮，不再打开已退役的详情面板
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await page.locator('#wboutline [data-ol-frame="recipe"]').click();
  const selected = page.locator('#wb-board-panel [data-screen="recipe"]');
  await expect(selected).toHaveClass(/wb-sel/);
  await expect(detail).toHaveCount(0);

  // 原型内部点击 = 原型交互，选中不变
  await page.locator('#wb-board-panel [data-screen="recipe"] [data-ratio-cycle]').click();
  await expect(selected).toHaveClass(/wb-sel/);
  await expect(detail).toHaveCount(0);

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

  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(minimap).toHaveAttribute('data-minimap-section-count', '1');
  await expect(minimap).toHaveAttribute('data-minimap-frame-count', '2');
  await expect(toolbar).toBeVisible();

  // e2e-mixed 是单 section 板，导航自动收起；回 e2e-ios 先重新展开再继续点。
  await page.locator('#wbpages [data-vpage="e2e-ios"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await navigatorToggle.click();
  await expect(navigator).toBeVisible();

  for (const [pageId, screenId, frameSelector] of [
    ['e2e-ios', 'timer', '.ios-stage'],
    ['e2e-ios', 'beans', '.ios-stage'],
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

// The old reference-mode and draggable-composer stories are retired. Inline
// input and DOM-positioning coverage also runs in review-refinements.spec.js.
test('canvas multi-target pills preserve text and cancel edits without changing the saved annotation', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).click();
  const input = page.locator('#ann-input');
  await input.fill('已保存');
  await cells.nth(1).click();
  await expect(input.locator('[data-target-ref]')).toHaveCount(2);
  await page.locator('#ann-save').click();
  const saved = await page.evaluate(() => window.pinpoint.marks[0]);
  expect(saved.targets).toHaveLength(2);
  await page.evaluate(n => window.pinpoint.openMark(n), saved.n);
  await input.fill('不应保存');
  await page.locator('#ann-cancel').click();
  expect(await page.evaluate(() => window.pinpoint.marks[0])).toEqual(saved);
  await page.evaluate(n => window.pinpoint.openMark(n), saved.n);
  await input.fill('换页也不应保存');
  await page.evaluate(() => window.workbench.setActivePage('e2e-doc'));
  await expect(input).toHaveCount(0);
  expect(await page.evaluate(() => window.pinpoint.marks[0])).toEqual(saved);
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

  await page.getByRole('tab', {name:'大纲', exact:true}).click();
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
  await expectLocatedTarget(page);
  await expect(outline.locator('[data-ol-frame="settings"]')).toHaveClass(/on/);
  await page.locator('#ann-cancel').click();
  await openAnnList(page);
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveClass(/wb-ann-item--on/);
  await expect(page.locator('#wbann-list [data-ann-go]')).toHaveCount(0);
  await expect(page.locator('#wbann-list .wb-ann-delete')).toBeVisible();

  // 左栏折叠 / 复开：唯一入口是横条左端的 Pages 开关（画布两缘浮钮已退役）
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeHidden();
  await expect(page.locator('#wbstrip')).toBeVisible();
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbside')).toBeVisible();

  // 清空 = 两段确认（收在「···」里）：首击 armed（确认清空），再击才执行
  await page.locator('#wbann-more').click();
  await page.locator('#wbann-clear').click();
  await expect(page.locator('#wbann-clear')).toHaveText('确认清空标注（1）');
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
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
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

  // 整行点击后打开输入框，列表保持展开，实际目标仍在可见画布内。
  await page.locator('#wbann-list .wb-ann-item-main').click();
  await expectLocatedTarget(page);

  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await closeAnnList(page);
});

test('标注列表在底栏上方，Esc 关闭列表后清除选择', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'dock slot mark');

  await page.locator('#wbann-interact').click();
  const section = page.locator('#wb-board-panel .wb-lib-item[data-ann-section="brew-flow"]');
  await section.locator(':scope > .wb-lib-cap').click();
  await expect(page.locator('#wbdetail')).toHaveCount(0);
  await openAnnList(page);
  const slot = await page.evaluate(() => {
    const card = document.querySelector('#wbann-pop').getBoundingClientRect();
    const strip = document.querySelector('#wbstrip').getBoundingClientRect();
    return { rightAligned: Math.abs(card.right - strip.right) < 2, aboveStrip: card.bottom <= strip.top, width: Math.round(card.width) };
  });
  expect(slot).toEqual({ rightAligned: true, aboveStrip: true, width: 280 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#wbann-pop')).toHaveCount(0);
  await expect(page.locator('#wbdetail')).toHaveCount(0);
  await expect(section).toHaveClass(/wb-sel/);
  await page.keyboard.press('Escape');
  await expect(section).not.toHaveClass(/wb-sel/);

  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
});

test('文档形态的横条有条目步进：‹ n / N › 在本板条目间前后切换（2026-09-20）', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  // 画布条目选中时没有条目步进（画布有自己的帧导航）
  await expect(page.locator('#wbentry-nav')).toHaveCount(0);
  await page.getByRole('tab', { name: '大纲', exact: true }).click();
  await page.locator('#wbcontents [data-entry="spec"]').click();

  // 混合板三个条目：画布 → 设计说明 → 气泡三手感；选中第二个
  const nav = page.locator('#wbentry-nav');
  await expect(nav).toBeVisible();
  await expect(page.locator('#wbentry-position')).toHaveText('2 / 3');
  await page.locator('#wbentry-next').click();
  await expect(page.locator('#wbentry-position')).toHaveText('3 / 3');
  await expect(page.locator('#wbentry-next')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('draft-variants');
  await expect(page.locator('#wbcontents [data-entry="draft-variants"]')).toHaveAttribute('data-state', 'on');
  await page.locator('#wbentry-prev').click();
  await page.locator('#wbentry-prev').click();
  // 退回画布条目：形态切回画布，条目步进收起，画布工具那一段回来
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
  await expect(nav).toHaveCount(0);
  await expect(page.locator('#wbcanvas-tools')).toBeVisible();
});

test('钉子和命中框画在底部横条之下，横条永远在最上（2026-09-17）', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'under strip mark');

  // workbench 里 overlay 留在 .wb-stage-wrap 按 z-index 排，不进 top layer
  expect(await page.evaluate(() => {
    const overlay = document.querySelector('#ann-overlay');
    return { parent: overlay.parentElement.className, popover: overlay.matches(':popover-open') };
  })).toEqual({ parent: 'wb-stage-wrap', popover: false });

  // R1 / R2（ADR 0034）：.wb 是隔离的堆叠上下文；.wb-stage-wrap 不是堆叠上下文，
  // 它的孩子才能靠 --wb-z 阶梯与 .wb-side / .wb-strip 交错。
  expect(await page.evaluate(() => {
    const wrap = getComputedStyle(document.querySelector('.wb-stage-wrap'));
    const wb = getComputedStyle(document.querySelector('.wb'));
    return {
      wrapZIndex: wrap.zIndex, wrapTransform: wrap.transform, wrapFilter: wrap.filter,
      wrapBackdropFilter: wrap.backdropFilter, wrapOpacity: wrap.opacity, wrapIsolation: wrap.isolation,
      wrapContain: wrap.contain, wbIsolation: wb.isolation,
    };
  })).toEqual({
    wrapZIndex: 'auto', wrapTransform: 'none', wrapFilter: 'none', wrapBackdropFilter: 'none',
    wrapOpacity: '1', wrapIsolation: 'auto', wrapContain: 'none', wbIsolation: 'isolate',
  });

  // 把钉子滚到横条正后方：横条中心那一点命中的必须是横条，不是钉子
  await page.evaluate(() => {
    const badge = document.querySelector('#ann-marks .ann-badge').getBoundingClientRect();
    const strip = document.querySelector('#wbstrip').getBoundingClientRect();
    document.querySelector('#wbstage').scrollTop += (badge.top + badge.height / 2) - (strip.top + strip.height / 2);
  });
  await expect.poll(() => page.evaluate(() => {
    const badge = document.querySelector('#ann-marks .ann-badge').getBoundingClientRect();
    const strip = document.querySelector('#wbstrip').getBoundingClientRect();
    const cx = badge.left + badge.width / 2, cy = badge.top + badge.height / 2;
    if (cy < strip.top || cy > strip.bottom || cx < strip.left || cx > strip.right) return 'badge-not-behind-strip';
    const hit = document.elementFromPoint(cx, cy);
    return hit && hit.closest('#wbstrip') ? 'strip' : (hit ? hit.className : 'none');
  })).toBe('strip');

  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
});

// 命中分类：(x, y) 上最先吃到事件的是谁。overlay 本身 pointer-events:none，命中的只会是
// 气泡 / 钉子 / 输入框这些 pointer-events:auto 的孩子，或外壳的浮层。
function hitKindAt(page, point) {
  return page.evaluate(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return 'none';
    if (hit.closest('.ann-bubble')) return 'bubble';
    if (hit.closest('#ann-box')) return 'composer';
    if (hit.closest('#wbann-pop')) return 'list';
    if (hit.closest('#wbstrip')) return 'strip';
    if (hit.closest('[role="menu"]')) return 'menu';
    return hit.id || hit.className || hit.tagName;
  }, point);
}

// a 与 b 两个元素矩形交集的中心；不相交（或交集窄于 4px）返回 null。
function overlapCenter(page, selA, selB) {
  return page.evaluate(([a, b]) => {
    const ra = document.querySelector(a).getBoundingClientRect();
    const rb = document.querySelector(b).getBoundingClientRect();
    const l = Math.max(ra.left, rb.left), t = Math.max(ra.top, rb.top);
    const r = Math.min(ra.right, rb.right), btm = Math.min(ra.bottom, rb.bottom);
    return r - l > 4 && btm - t > 4 ? [(l + r) / 2, (t + btm) / 2] : null;
  }, [selA, selB]);
}

// 把钉子滚到 (x, y)，等 overlay 重排到位，再把鼠标放上去点亮气泡。
// 列表定位（整行点击）会把那条标注换成输入框，钉子和气泡都不在；点亮气泡只有 hover 这一条路。
async function parkBadgeAndHover(page, x, y) {
  await page.evaluate(([x, y]) => {
    const badge = document.querySelector('#ann-marks .ann-badge').getBoundingClientRect();
    const stage = document.querySelector('#wbstage');
    stage.scrollTop += (badge.top + badge.height / 2) - y;
    stage.scrollLeft += (badge.left + badge.width / 2) - x;
  }, [x, y]);
  await expect.poll(() => page.evaluate(([x, y]) => {
    const b = document.querySelector('#ann-marks .ann-badge').getBoundingClientRect();
    return Math.abs(b.left + b.width / 2 - x) < 2 && Math.abs(b.top + b.height / 2 - y) < 2;
  }, [x, y])).toBe(true);
  await page.mouse.move(x, y);
  await expect(page.locator('#ann-bubbles .ann-bubble--show')).toHaveCount(1);
}

test('点亮的气泡压过弹出列表，滚到横条后面则被横条压住（ADR 0031 批注 2 / ADR 0034）', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), 'bubble over list mark');
  await openAnnList(page);
  await expect(page.locator('#ann-marks .ann-badge')).toHaveCount(1);

  // 钉子停在列表卡左缘外 20px、卡的中线上：钉子本身露着能 hover，气泡（摆在钉子右边）伸到卡后面
  const pop = await page.locator('#wbann-pop').boundingBox();
  await parkBadgeAndHover(page, pop.x - 20, pop.y + pop.height / 2);

  // 抬升态 overlay 取 --wb-z-marks-active（50）：高于停靠槽 --wb-z-dock（30），低于横条 --wb-z-strip（60）
  expect(await page.evaluate(() => ({
    overlay: getComputedStyle(document.querySelector('#ann-overlay')).zIndex,
    dock: getComputedStyle(document.getElementById('wbdock')).zIndex,
    strip: getComputedStyle(document.getElementById('wbstrip')).zIndex,
  }))).toEqual({ overlay: '50', dock: '30', strip: '60' });

  // 气泡与列表卡相交处，命中的必须是气泡，不是列表卡
  const overList = await overlapCenter(page, '#ann-bubbles .ann-bubble--show', '#wbann-pop');
  expect(overList).not.toBeNull();
  expect(await hitKindAt(page, overList)).toBe('bubble');

  // 再把钉子停在横条左缘外 20px、横条中线上：气泡伸到横条后面，命中的必须是横条
  const strip = await page.locator('#wbstrip').boundingBox();
  await parkBadgeAndHover(page, strip.x - 20, strip.y + strip.height / 2);
  const overStrip = await overlapCenter(page, '#ann-bubbles .ann-bubble--show', '#wbstrip');
  expect(overStrip).not.toBeNull();
  expect(await hitKindAt(page, overStrip)).toBe('strip');

  await page.mouse.move(5, 5);
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await closeAnnList(page);
});

test('左栏行右键菜单 Portal 在外壳之上：菜单中心命中菜单（ADR 0034 float 档）', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click({ button: 'right' });
  const menu = page.locator('[role="menu"]');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(await hitKindAt(page, [box.x + box.width / 2, box.y + box.height / 2])).toBe('menu');
  expect(await menu.evaluate((m) => ({
    zIndex: getComputedStyle(m).zIndex, // Tailwind z-(--wb-z-float) 真的生成了
    portaled: !m.closest('.wb'),        // 在 body 上，不在 .wb 的隔离上下文里
  }))).toEqual({ zIndex: '100', portaled: true });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('写标注的输入框是外壳里最高的层：压过横条、列表卡与 section 导航（2026-09-18 owner 决定，ADR 0034）', async ({ page }) => {
  await openWorkbench(page);
  // 矮视口：输入框长到十行后停靠在底部，盒子必然压到横条、列表卡与右下导航上
  await page.setViewportSize({ width: 900, height: 380 });
  await page.evaluate(() => window.pinpoint.clear());
  await page.evaluate(() => window.pinpoint.setMode(true));
  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).scrollIntoViewIfNeeded();
  await saveAnnotation(page, cells.nth(0), Array.from({ length: 12 }, (_, i) => 'line ' + (i + 1)).join('\n'));
  await page.locator('#ann-marks .ann-badge').first().click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  // 输入框开着时再开列表卡与 section 导航。用程序点击：横条中段的钮此时在输入框后面，
  // 真实点击会被输入框吃掉（这正是本用例要证明的层级）。输入框不因这两下关闭。
  await page.evaluate(() => { document.getElementById('wbann-count').click(); document.getElementById('wbsection-nav-toggle').click(); });
  await expect(page.locator('#wbann-pop')).toBeVisible();
  await expect(page.locator('#wbsection-nav')).toBeVisible();
  await expect(box).toBeVisible();

  // 挂法：#ann-chrome 是 overlay 在 .wb-stage-wrap 里的兄弟，取 --wb-z-composer 70；横条 60；overlay 不再因输入框抬升
  expect(await page.evaluate(() => {
    const chrome = document.getElementById('ann-chrome');
    return {
      chromeParent: chrome.parentElement.className,
      chromeUi: chrome.hasAttribute('data-ann-ui'),
      boxInOverlay: !!document.querySelector('#ann-overlay #ann-box'),
      chromeZ: getComputedStyle(chrome).zIndex,
      stripZ: getComputedStyle(document.getElementById('wbstrip')).zIndex,
      overlayZ: getComputedStyle(document.getElementById('ann-overlay')).zIndex,
    };
  })).toEqual({ chromeParent: 'wb-stage-wrap', chromeUi: true, boxInOverlay: false, chromeZ: '70', stripZ: '60', overlayZ: '10' });

  // 输入框与横条 / 列表卡 / section 导航三块交集的中心，命中的都必须是输入框
  for (const sel of ['#wbstrip', '#wbann-pop', '#wbsection-nav']) {
    const point = await overlapCenter(page, '#ann-box', sel);
    expect(point, sel + ' overlaps the composer').not.toBeNull();
    await expect.poll(() => hitKindAt(page, point)).toBe('composer');
  }

  // 打开输入框就是要打字：键入到达输入区
  await page.keyboard.type(' typed');
  await expect.poll(() => page.evaluate(() => {
    const el = document.querySelector('#ann-box #ann-input');
    return (el.value !== undefined ? el.value : el.textContent).trim();
  })).toMatch(/ typed$/);

  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await closeAnnList(page);
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
    return p.pageViewports && p.pageViewports['e2e-ios'] && p.pageViewports['e2e-ios'].canvasZoom;
  }).toBe('1.1');
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="report"]')).toBeVisible();
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-ios"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeVisible();
  await expect(page.locator('#wbzoom-label')).toHaveText('110%');
});

test('zoom axis migration doubles legacy saved viewports once (2026-08-17 基准重定标)', async ({ page }) => {
  // 旧轴存档（视觉 = zoom）：canvasZoom '0.5' 是当时的舒适默认。迁移应 ×2 成
  // 新轴 '1'（视觉不变 = HUD 100%），打 zoomAxis:2 标记防重跑。
  await page.addInitScript(() => {
    localStorage.setItem('pinpoint-wb', JSON.stringify({
      pageViewports: { 'e2e-ios': { canvasZoom: '0.5', scrollLeft: 0, scrollTop: 0 } }
    }));
  });
  await openWorkbench(page);
  await expect(page.locator('#wbzoom-label')).toHaveText('100%');
  await expect.poll(async () => (await readWbPrefs(page)).zoomAxis).toBe(2);
  await expect.poll(async () => {
    const p = await readWbPrefs(page);
    return p.pageViewports && p.pageViewports['e2e-ios'] && p.pageViewports['e2e-ios'].canvasZoom;
  }).toBe('1');
  // reload 不再翻倍
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbzoom-label')).toHaveText('100%');
  await expect.poll(async () => {
    const p = await readWbPrefs(page);
    return p.pageViewports && p.pageViewports['e2e-ios'] && p.pageViewports['e2e-ios'].canvasZoom;
  }).toBe('1');
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
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await expect(page.locator('#wbcontents [data-entry="spec"]')).toBeVisible();
  expect(await sideWidth(page)).toBe(250);
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  expect(await withinContainerViolations(page, '.wb-page-row', '#wbside')).toEqual([]);
  expect(await withinContainerViolations(page, '.wb-page', '#wbside')).toEqual([]);
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  expect(await withinContainerViolations(page, '#wbcontents [data-entry]', '#wbside')).toEqual([]);

  await dragSideSplitter(page, -120);
  expect(await sideWidth(page)).toBe(200);
  await expect(page.locator('#wbside')).toHaveClass(/compact/);
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  expect(await withinContainerViolations(page, '.wb-page-row', '#wbside')).toEqual([]);
  expect(await withinContainerViolations(page, '.wb-page', '#wbside')).toEqual([]);
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  expect(await withinContainerViolations(page, '#wbcontents [data-entry]', '#wbside')).toEqual([]);
});
