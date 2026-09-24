import { test, expect } from '@playwright/test';

import { maybeThrottle } from './cpu-throttle.js';

// 七条都是纯 API 调用、不写账本也不改 DOM（emulateMedia 例外），共用一次
// 装载：beforeAll 开页；beforeEach 把 reduced-motion 和滚动位置都收回起点 ——
// emulateMedia 粘在共用页面上，复位放在公共前置里每条用例都不依赖用例顺序
// （要 reduce 的用例自己再显式切）。
// 装载从 7 次降到 1 次，过去「第一条撞冷启动」的随机超时随之收敛成一次；
// 就绪信号与 workbench.spec 同款 whenBoardSettled，单独放宽超时 —— 冷装载
// （vite transform + 板挂载）不该被 30s 的用例全局上限掐死（校准 run1:97）。
test.describe.configure({ mode: 'serial' });

let page;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  page = await context.newPage();
  await maybeThrottle(page);
  await page.goto('/index.html?page=e2e-ios&mode=ios');
  // afterMount wires navigation and applies the initial viewport in the geometry
  // batch (board DOM in; independent of preview-script imports). Starting a spring
  // at HTML insertion time races that legitimate first focus.
  await page.waitForFunction(() => window.workbench && document.querySelector('#wbsection-nav .wb-section-nav-item'));
  // shell 就绪 ≠ 板就绪：navigator / 首访聚焦在挂载会话的几何批里才落定。
  await page.waitForFunction(() => window.workbench.whenBoardSettled().then((ok) => ok === true), { timeout: 60_000 });
  await page.evaluate(() => window.workbench.whenScrollSettled());
});

test.afterAll(async () => {
  if (page && !page.isClosed()) await page.context().close();
});

test.beforeEach(async () => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // scrollStageTo 开头先 cancelStageScroll：前一条残留的动画不会带进下一条。
  await page.evaluate(() => window.workbench.scrollTo({ top: 0 }, { smooth: false }));
});

test('frame focus moves through intermediate positions and settles on the instant target', async () => {
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

test('retarget continues from the current position and cancels the previous completion', async () => {
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
  test(`${input} immediately takes control of an animated scroll`, async () => {
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

test('reduced motion positions immediately without a delayed follow-up', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const result = await page.evaluate(async () => {
    const wb = window.workbench, s = document.getElementById('wbstage');
    const promise = wb.scrollTo({ top: 2000 });
    return { immediate: s.scrollTop, complete: await promise };
  });
  expect(result.immediate).toBe(2000);
  expect(result.complete).toBe(true);
});

test('changing reduced motion during navigation settles and preserves completion', async () => {
  // 本条的命题是「弹簧在飞时切 reduce」：起飞前必须真的是 no-preference，
  // 否则 scrollStageTo 直接走即时落位分支（scroll-motion.js:27-29），不注册
  // onReduced，动画根本不存在，断言全部瞬时满足 —— 整条恒真。复位虽已在
  // beforeEach，这里点名写出来。
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    window.workbench.scrollTo({ top: 0 }, { smooth: false });
    window.motionCompletion = window.workbench.scrollTo({ top: 2000 });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => window.motionCompletion)).toBe(true);
  await expect(page.locator('#wbstage')).toHaveJSProperty('scrollTop', 2000);
});

test('a real wheel gesture cancels navigation without the spring taking control again', async () => {
  // 上一条把 reduced-motion 切成了 reduce（emulateMedia 粘在共用页面上）：
  // 这条要弹簧动画先跑起来，先复位。
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    window.workbench.scrollTo({ top: 0 }, { smooth: false });
    window.motionCompletion = window.workbench.scrollTo({ top: 2000 });
  });
  await page.mouse.move(1100, 300);
  await page.mouse.wheel(0, 100);
  expect(await page.evaluate(() => window.motionCompletion)).toBe(false);
  // 「之后没有再动」不靠固定等待：先轮询到滚轮自己的原生滚动停住（连续
  // 两帧位置相等 —— 取消后弹簧不得接管，若又动起来这里就等不到），再确认
  // 没有 active 动画（空闲时 whenScrollSettled 是已兑现的 promise，与下一个
  // rAF 竞速必赢）。
  await expect.poll(() => page.evaluate(async () => {
    const s = document.getElementById('wbstage');
    const a = s.scrollTop;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return s.scrollTop === a;
  })).toBe(true);
  const idledBeforeNextFrame = await page.evaluate(() => Promise.race([
    window.workbench.whenScrollSettled().then(() => true),
    new Promise(resolve => requestAnimationFrame(() => resolve(false))),
  ]));
  expect(idledBeforeNextFrame).toBe(true);
});
