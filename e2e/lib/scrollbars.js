// 隐藏式滚动条（docs/design.md“滚动条”）的共用量法。
// Playwright 默认带 --hide-scrollbars；fixtures.js 的 scrollbarsBrowser 在 worker 级共享不带它的浏览器。
import { chromium, expect } from '@playwright/test';

export const launchWithScrollbars = () => chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

/** 容器与这一方向的浮条：是否溢出、原生条占的宽（y）/ 高（x）、浮条是否显示与它的几何。 */
export function scrollbarState(page, selector, axis) {
  return page.evaluate(([sel, ax]) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const bar = document.querySelector(`[data-pp-osb="${ax}"]`);
    const cs = bar && getComputedStyle(bar);
    const b = bar && bar.getBoundingClientRect();
    return {
      overflow: ax === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth,
      native: ax === 'y' ? el.offsetWidth - el.clientWidth - el.clientLeft * 2 : el.offsetHeight - el.clientHeight - el.clientTop * 2,
      // shown：完全显出（淡入走完）；hidden：完全收起（淡出走完，visibility 也落到 hidden）。
      shown: !!bar && bar.hasAttribute('data-on') && cs.visibility === 'visible' && Number(cs.opacity) === 1,
      hidden: !bar || (cs.visibility === 'hidden' && Number(cs.opacity) === 0),
      bar: b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null,
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      pos: ax === 'y' ? el.scrollTop : el.scrollLeft,
    };
  }, [selector, axis]);
}

/**
 * 一个容器的整套断言：平时浮条不显示、原生条不占宽；指针停到容器上浮条出现、贴在容器内缘、6px；
 * 滚轮照常滚；指针离开后浮条收起。away = 指针停放的、不在任何滚动容器上的点。
 */
export async function expectHiddenScrollbar(page, selector, axis, { away = { x: 2, y: 2 }, shot } = {}) {
  await page.mouse.move(away.x, away.y);
  await expect.poll(async () => (await scrollbarState(page, selector, axis)).hidden, { timeout: 5000 }).toBe(true);
  const idle = await scrollbarState(page, selector, axis);
  expect(idle.overflow).toBe(true);
  expect(idle.native).toBe(0);
  if (shot) await page.screenshot({ path: shot.idle });

  const { box } = idle;
  // 横向：停在容器下半；纵向：停在中间。
  const at = { x: box.x + box.w / 2, y: axis === 'x' ? box.y + box.h * 0.75 : box.y + box.h / 2 };
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await scrollbarState(page, selector, axis)).shown, { timeout: 5000 }).toBe(true);
  const hover = await scrollbarState(page, selector, axis);
  if (axis === 'y') {
    expect(hover.bar.w).toBe(6);
    expect(hover.bar.x + hover.bar.w).toBeLessThanOrEqual(box.x + box.w);
    expect(hover.bar.x + hover.bar.w).toBeGreaterThan(box.x + box.w - 12);
    expect(hover.bar.y).toBeGreaterThanOrEqual(box.y);
    expect(hover.bar.y + hover.bar.h).toBeLessThanOrEqual(box.y + box.h);
  } else {
    expect(hover.bar.h).toBe(6);
    expect(hover.bar.y + hover.bar.h).toBeLessThanOrEqual(box.y + box.h);
    expect(hover.bar.y + hover.bar.h).toBeGreaterThan(box.y + box.h - 12);
    expect(hover.bar.x).toBeGreaterThanOrEqual(box.x);
    expect(hover.bar.x + hover.bar.w).toBeLessThanOrEqual(box.x + box.w);
  }
  expect(hover.native).toBe(0);
  if (shot) await page.screenshot({ path: shot.hover });

  // 仍可滚：滚轮滚得动，浮条跟着走。
  await page.mouse.wheel(axis === 'x' ? 240 : 0, axis === 'y' ? 240 : 0);
  await expect.poll(async () => (await scrollbarState(page, selector, axis)).pos).toBeGreaterThan(hover.pos);
  await expect.poll(async () => {
    const s = await scrollbarState(page, selector, axis);
    return axis === 'y' ? s.bar.y : s.bar.x;
  }).toBeGreaterThan(axis === 'y' ? hover.bar.y : hover.bar.x);

  await page.mouse.move(away.x, away.y);
  await expect.poll(async () => (await scrollbarState(page, selector, axis)).hidden, { timeout: 5000 }).toBe(true);
}
