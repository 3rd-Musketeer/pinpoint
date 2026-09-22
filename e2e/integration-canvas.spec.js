import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { E2E_DATA_DIR } from './env.js';
import { annotationSlug } from '../src/shared/annotation-slug.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';

const ledger = path.join(E2E_DATA_DIR, 'pinpoint', annotationSlug(pageKeyFromPathname('/index.html')) + '.json');
const read = () => JSON.parse(fs.readFileSync(ledger, 'utf8')).annotations;
async function open(page) {
  await page.addInitScript(() => {
    const p = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
    Object.assign(p, { zoomAxis: 2, sideCollapsed: true, pageViewports: { 'e2e-ios': { canvasZoom: '1.17' } } });
    localStorage.setItem('pinpoint-wb', JSON.stringify(p));
  });
  await page.goto('/index.html?page=e2e-ios&mode=ios');
  await page.waitForFunction(() => window.workbench && window.pinpoint?.getState().connected);
}
async function save(page, content) {
  await page.locator('#ann-input').fill(content);
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/save' && r.request().method() === 'POST' && r.ok()),
    page.locator('#ann-save').click(),
  ]);
  await expect(page.locator('#ann-box')).toBeHidden();
}
async function focus(page, screen) {
  await page.evaluate(screen => {
    const group = document.querySelector(`[data-screen="${screen}"]`).closest('.wb-lib-item').dataset.annSection;
    window.workbench.focusFrame(group, screen, { smooth: false });
  }, screen);
}
// lastRect 是「锚点最后位置」提示：随保存合并落盘（新建的标注要等下一次
// persist 才带上），重测又按复合坐标取整 —— 比对保存/重载保真时把它摘掉。
const stripLastRect = list => list.map(({ lastRect, ...rest }) => rest);

test('integrated navigation, pan, zoom and edits preserve persisted targets across reload and another browser context', async ({ page, browser }) => {
  fs.rmSync(ledger, { force: true });
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await otherContext.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await open(other);
    await focus(page, 'settings');
    await page.evaluate(() => window.pinpoint.setMode(true));
    await page.locator('[data-screen="settings"] .ios-cell').first().click();
    await save(page, 'integration original');
    const first = read()[0];
    expect(first.content).toContain('integration original');
    expect(fs.readdirSync(E2E_DATA_DIR).filter(name => name.endsWith('.json'))).toEqual([]);
    expect(first.id).toBeTruthy();
    expect(first.targets.length).toBeGreaterThan(0);
    await expect.poll(() => other.evaluate(() => window.pinpoint.marks.map(m => m.id))).toContain(first.id);
    await focus(page, 'home');
    await page.locator('#wbann-count').click();
    await page.locator('.wb-ann-item-main').click();
    await expect(page.locator('#ann-box')).toBeVisible();
    await page.keyboard.press('Escape');
    if (await page.locator('#wbann-count').getAttribute('aria-expanded') === 'true') await page.locator('#wbann-count').click();
    for (const method of ['middle', 'space']) {
      const box = await page.locator('[data-screen="settings"] .ios-cell').first().boundingBox();
      const before = await page.locator('#wbstage').evaluate(s => ({ left: s.scrollLeft, top: s.scrollTop }));
      await page.mouse.move(box.x + 50, box.y + 10);
      if (method === 'space') await page.keyboard.down('Space');
      await page.mouse.down({ button: method === 'middle' ? 'middle' : 'left' });
      await page.mouse.move(box.x - 30, box.y - 30, { steps: 8 });
      await page.mouse.up({ button: method === 'middle' ? 'middle' : 'left' });
      if (method === 'space') await page.keyboard.up('Space');
      await expect.poll(() => page.locator('#wbstage').evaluate(s => ({ left: s.scrollLeft, top: s.scrollTop }))).toEqual({ left: before.left + 80, top: before.top + 40 });
    }
    await page.locator('#wbzoom-in').click();
    await page.locator('#wbzoom-out').click();
    // R4 + §2b：创建后的首测量会把 lastRect（带 space 标记）debounce 落盘一次
    // —— 先等这次合法写盘 settle，再要求 pan / zoom 期间账本字节不动。
    await expect.poll(() => (read()[0].lastRect ? 1 : 0)).toBe(1);
    const settled = read()[0];
    expect(read()).toEqual([settled]);
    await page.evaluate(n => window.pinpoint.goToMark(n), first.n);
    await save(page, 'integration edited after pan and zoom');
    const edited = read()[0];
    expect(edited.id).toBe(first.id);
    expect(edited.targets).toEqual(first.targets);
    expect(edited.screenId).toBe(first.screenId);
    await expect.poll(() => other.evaluate(() => window.pinpoint.marks[0]?.content)).toBe(edited.content);
    await focus(page, 'home');
    await expect(page.locator('.wb-zoom-wrap')).toHaveJSProperty('scrollTop', 0);
    const target = page.locator('[data-screen="home"] .ios-device');
    const hit = await target.evaluate(el => { const r=el.getBoundingClientRect(); const x=r.left+r.width/2,y=Math.max(100,Math.min(innerHeight-150,r.top+r.height/2)); return {x,y,visible:el.contains(document.elementFromPoint(x,y))}; });
    expect(hit.visible).toBe(true);
    await page.mouse.click(hit.x, hit.y);
    await save(page, 'integration new mark in earlier section');
    const final = read();
    expect(final).toHaveLength(2);
    expect(stripLastRect(final.filter(m => m.id === first.id))).toEqual(stripLastRect([edited]));
    expect(final.find(m => m.id === first.id).lastRect).toEqual(edited.lastRect);
    await expect.poll(() => other.evaluate(() => window.pinpoint.marks.length)).toBe(2);
    const persisted = stripLastRect(final);
    const marksAfterReload = async context => {
      await context.reload();
      await expect.poll(() => context.evaluate(() => window.pinpoint?.marks?.length)).toBe(2);
      return context.evaluate(() => window.pinpoint.marks);
    };
    expect(stripLastRect(await marksAfterReload(page))).toEqual(persisted);
    expect(stripLastRect(await marksAfterReload(other))).toEqual(persisted);
    // R4 + §2b：reload 后活锚点重测会把 lastRect 补上 space 标记并 debounce 落盘
    // —— 除 lastRect 本身外，磁盘不再有别的变化。
    expect(stripLastRect(read())).toEqual(persisted);
    await page.screenshot({ path: test.info().outputPath('integrated-restored.png') });
  } finally {
    await otherContext.close();
    await page.close();
    fs.rmSync(ledger, { force: true });
  }
});

test('Escape cancels a queued annotation jump before it can reopen the composer', async ({ page }) => {
  fs.rmSync(ledger, { force: true });
  try {
    await open(page);
    await focus(page, 'settings');
    await page.evaluate(() => window.pinpoint.setMode(true));
    await page.locator('[data-screen="settings"] .ios-cell').first().click();
    await save(page, 'cancel pending navigation');
    await focus(page, 'home');
    const completed = await page.evaluate(async () => {
      const pending = window.pinpoint.goToMark(window.pinpoint.marks[0].n);
      // The jump queues two animation frames before creating its scroll motion.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return pending;
    });
    expect(completed).toBe(false);
    await expect(page.locator('#ann-box')).toBeHidden();
    expect(read()).toHaveLength(1);
  } finally {
    await page.close();
    fs.rmSync(ledger, { force: true });
  }
});
