import { test, expect } from '@playwright/test';
import { seedTemplatePagesVisible } from './workbench-helpers.js';

test.beforeEach(async ({ page }) => {
  await seedTemplatePagesVisible(page);
  await page.goto('/index.html?page=library&mode=ios');
  // afterMount wires navigation and applies the initial viewport after scripts.
  // Starting a spring at HTML insertion time races that legitimate first focus.
  await page.waitForFunction(() => window.workbench && document.querySelector('#wbsection-nav .wb-section-nav-item'));
  await page.evaluate(() => window.workbench.whenScrollSettled());
});

test('frame focus moves through intermediate positions and settles on the instant target', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const s = document.getElementById('wbstage'), wb = window.workbench;
    const group = document.querySelector('[data-screen="settings"]').closest('.wb-lib-item').dataset.annSection;
    wb.focusFrame(group, 'settings', { smooth: false });
    const target = { left: s.scrollLeft, top: s.scrollTop };
    await wb.scrollTo({ left: target.left, top: 0 }, { smooth: false });
    wb.focusFrame(group, 'settings');
    const start = s.scrollTop;
    const samples = [];
    let done = false;
    const settled = wb.whenScrollSettled().then(value => { done = true; return value; });
    while (!done) { await new Promise(requestAnimationFrame); samples.push(s.scrollTop); }
    return { start, target, samples, complete: await settled, inner: document.querySelector('.wb-zoom-wrap').scrollTop };
  });
  expect(result.start).toBe(0);
  expect(result.complete).toBe(true);
  expect(result.samples.some(y => y > 0 && y < result.target.top - 2)).toBe(true);
  expect(Math.abs(result.samples.at(-1) - result.target.top)).toBeLessThanOrEqual(1);
  expect(result.samples.every((y, i, a) => !i || y >= a[i - 1])).toBe(true);
  expect(result.inner).toBe(0);
});

test('retarget continues from the current position and cancels the previous completion', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const s = document.getElementById('wbstage'), wb = window.workbench;
    await wb.scrollTo({ top: 0 }, { smooth: false });
    const old = wb.scrollTo({ top: 2000 });
    for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
    const before = s.scrollTop;
    const next = wb.scrollTo({ top: 100 });
    const after = s.scrollTop;
    return { before, after, old: await old, next: await next, final: s.scrollTop };
  });
  expect(result.before).toBeGreaterThan(0);
  expect(result.after).toBe(result.before);
  expect(result.old).toBe(false);
  expect(result.next).toBe(true);
  expect(result.final).toBe(100);
});

for (const input of ['pointerdown', 'keydown']) {
  test(`${input} immediately takes control of an animated scroll`, async ({ page }) => {
    const result = await page.evaluate(async input => {
      const s = document.getElementById('wbstage'), wb = window.workbench;
      await wb.scrollTo({ top: 0 }, { smooth: false });
      const moving = wb.scrollTo({ top: 2000 });
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      if (input === 'pointerdown') s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      else s.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
      const stopped = s.scrollTop;
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      return { complete: await moving, stopped, final: s.scrollTop };
    }, input);
    expect(result.complete).toBe(false);
    expect(result.final).toBe(result.stopped);
  });
}

test('reduced motion positions immediately without a delayed follow-up', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const result = await page.evaluate(async () => {
    const wb = window.workbench, s = document.getElementById('wbstage');
    const promise = wb.scrollTo({ top: 2000 });
    return { immediate: s.scrollTop, complete: await promise };
  });
  expect(result.immediate).toBe(2000);
  expect(result.complete).toBe(true);
});

test('changing reduced motion during navigation settles and preserves completion', async ({ page }) => {
  await page.evaluate(() => {
    window.workbench.scrollTo({ top: 0 }, { smooth: false });
    window.motionCompletion = window.workbench.scrollTo({ top: 2000 });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => window.motionCompletion)).toBe(true);
  await expect(page.locator('#wbstage')).toHaveJSProperty('scrollTop', 2000);
});

test('a real wheel gesture cancels navigation without the spring taking control again', async ({ page }) => {
  await page.evaluate(() => {
    window.workbench.scrollTo({ top: 0 }, { smooth: false });
    window.motionCompletion = window.workbench.scrollTo({ top: 2000 });
  });
  await page.mouse.move(1100, 300);
  await page.mouse.wheel(0, 100);
  expect(await page.evaluate(() => window.motionCompletion)).toBe(false);
  await page.waitForTimeout(200);
  const stopped = await page.locator('#wbstage').evaluate(el => el.scrollTop);
  await page.waitForTimeout(200);
  await expect(page.locator('#wbstage')).toHaveJSProperty('scrollTop', stopped);
});
