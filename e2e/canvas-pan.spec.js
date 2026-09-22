import { test, expect } from '@playwright/test';

const cellSelector = '[data-screen="settings"] .ios-cell';

async function openCanvas(page, count = 0) {
  // Synthetic ledgers never write the user's data, even when a test edits a mark.
  await page.route('**/annotations/**', route => route.fulfill({ json: {
    revision: 1,
    annotations: Array.isArray(count) ? count : Array.from({ length: count }, (_, i) => ({
      id: `pan-fixture-${i}`, n: i + 1, type: 'element', pageId: 'e2e-ios',
      screenId: 'settings', content: `Pan annotation ${i + 1}`,
      targets: [{ ref: 'i1', selector: `${cellSelector}:nth-child(${i % 3 + 1})`, text: 'Cell' }],
    })),
  } }));
  // R4 起锚点几何也会 debounce 落盘（recordLastRect → persist）：默认把 /save 也
  // 拦在页面里（假账本桶），不写真实 e2e 数据目录 —— 后面的 scroll-motion 等
  // 用例直接读真桶。返回捕获的保存列表，要断言保存行为的用例先等它 settle。
  let revision = 1;
  const saves = [];
  await page.route('**/save', async route => {
    saves.push(route.request().postDataJSON());
    revision += 1;
    await route.fulfill({ json: { ok: true, revision } });
  });
  await page.goto('/index.html?page=e2e-ios');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator(cellSelector).first()).toBeVisible();
  await page.locator(cellSelector).first().scrollIntoViewIfNeeded();
  await page.waitForFunction(expected => window.pinpoint.getState().countAll === expected, Array.isArray(count) ? count.length : count);
  await page.evaluate(() => window.workbench.whenScrollSettled());
  return saves;
}

for (const mode of [false, true]) for (const button of ['middle', 'space']) {
  test(`canvas pans over content with ${button}, annotation mode ${mode}`, async ({ page }) => {
    await openCanvas(page);
    await page.evaluate(mode => window.pinpoint.setMode(mode), mode);
    const box = await page.locator(cellSelector).first().boundingBox();
    const before = await page.locator('#wbstage').evaluate(s => [s.scrollLeft, s.scrollTop]);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    if (button === 'space') await page.keyboard.down('Space');
    await page.mouse.down({ button: button === 'space' ? 'left' : button });
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 70, { steps: 8 });
    await page.mouse.up({ button: button === 'space' ? 'left' : button });
    if (button === 'space') await page.keyboard.up('Space');
    await expect.poll(() => page.locator('#wbstage').evaluate(s => [s.scrollLeft, s.scrollTop]))
      .toEqual([before[0] + 120, before[1] + 70]);
    await expect(page.locator('#ann-box')).toHaveCount(0);
    await expect(page.locator('#ann-lasso')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.pinpoint.getState().mode)).toBe(mode);
  });
}

for (const count of [200, 1000]) test(`${count} annotation pan reuses geometry instead of measuring every mark every frame`, async ({ page }) => {
  await openCanvas(page, count);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  const sample = await page.evaluate(async () => {
    const stage = document.querySelector('#wbstage');
    const sx = stage.scrollLeft, sy = stage.scrollTop;
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () { reads++; return original.call(this); };
    const times = [];
    try {
      await new Promise(resolve => {
        let i = 0;
        function step(t) {
          times.push(t);
          stage.scrollLeft = sx + i * 2;
          stage.scrollTop = sy + i;
          if (++i < 60) requestAnimationFrame(step);
          else requestAnimationFrame(resolve);
        }
        requestAnimationFrame(step);
      });
    } finally { Element.prototype.getBoundingClientRect = original; }
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    return { reads, p95: gaps[Math.floor(gaps.length * .95)], max: gaps.at(-1) };
  });
  const after = await cdp.send('Performance.getMetrics');
  const delta = name => after.metrics.find(m => m.name === name).value - before.metrics.find(m => m.name === name).value;
  console.log(JSON.stringify({ count, ...sample, layouts: delta('LayoutCount'), layoutMs: delta('LayoutDuration') * 1000 }));
  // Deterministic work budgets; frame-time measurements are reported, not a flaky CI gate.
  expect(sample.reads).toBeLessThan(1200);
  expect(delta('LayoutCount')).toBeLessThan(120);
});

async function alignmentError(page) {
  return page.evaluate(selector => {
    const target = document.querySelector(selector).getBoundingClientRect();
    const mark = document.querySelector('#ann-marks .ann-target').getBoundingClientRect();
    return Math.max(Math.abs(mark.left + 4 - target.left), Math.abs(mark.top + 4 - target.top));
  }, `${cellSelector}:nth-child(1)`);
}

test('cached marks stay aligned through pan, viewport exit/reentry, resize and content changes', async ({ page }) => {
  await openCanvas(page, 1);
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  const origin = await page.locator('#wbstage').evaluate(s => [s.scrollLeft, s.scrollTop]);
  await page.locator('#wbstage').evaluate(s => { s.scrollLeft += 130; s.scrollTop += 60; });
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  await page.locator('#wbstage').evaluate(s => { s.scrollLeft = 0; s.scrollTop = 0; });
  await expect(page.locator('#ann-marks .ann-badge')).toBeHidden();
  await page.locator('#wbstage').evaluate((s, xy) => { s.scrollLeft = xy[0]; s.scrollTop = xy[1]; }, origin);
  await expect(page.locator('#ann-marks .ann-badge')).toBeVisible();
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  await page.locator(cellSelector).first().evaluate(el => { el.style.marginTop = '50px'; });
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath('canvas-alignment.png') });
});

test('space in composer types normally; navigation preserves the draft and clears on blur', async ({ page }) => {
  await openCanvas(page);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator(cellSelector).first().click();
  const input = page.locator('#ann-input');
  await input.fill('draft');
  await input.press('Space');
  await expect(input).toContainText('draft');
  // Explicit navigation outside the composer does not cancel or save the draft.
  const box = await page.locator(cellSelector).nth(2).boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x - 50, box.y - 30, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up({ button: 'middle' });
  await expect(input).toContainText('draft');
  await expect(page.locator('body')).not.toHaveClass(/wb-panning/);
  await expect.poll(() => page.evaluate(() => window.pinpoint.hasActiveDraft())).toBe(true);
});

test('zoom invalidates cached geometry and preserves screen-size annotation borders', async ({ page }) => {
  await openCanvas(page, 1);
  for (const control of ['#wbzoom-in', '#wbzoom-out', '#wbzoom-label']) {
    await page.locator(control).click();
    await page.locator(cellSelector).first().scrollIntoViewIfNeeded();
    await expect(page.locator('#ann-marks .ann-target')).toBeVisible();
    await expect.poll(() => alignmentError(page)).toBeLessThan(2);
    await expect(page.locator('#ann-marks .ann-target')).toHaveCSS('border-top-width', '2px');
    await expect(page.locator('#ann-marks .ann-badge')).toHaveCSS('width', '22px');
  }
});

test('scrolling one phone remeasures that frame only', async ({ page }) => {
  const annotations = ['settings', 'home'].map((screenId, i) => ({
    id: `frame-scroll-${i}`, n: i + 1, type: 'element', pageId: 'e2e-ios', screenId,
    targets: [{ ref: 'i1', selector: `[data-screen="${screenId}"] .ios-stage`, text: screenId }],
    content: screenId,
  }));
  annotations[0].targets[0].selector = `${cellSelector}:nth-child(1)`;
  await openCanvas(page, annotations);
  await page.locator('[data-screen="settings"] .ios-app').evaluate(app => {
    const pad = document.createElement('div'); pad.style.height = '1200px'; app.appendChild(pad);
  });
  await page.waitForTimeout(300);
  const reads = await page.evaluate(async () => {
    const original = Element.prototype.getBoundingClientRect;
    let home = 0, settings = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.closest('[data-screen="home"]')) home++;
      if (this.closest('[data-screen="settings"]')) settings++;
      return original.call(this);
    };
    try {
      document.querySelector('[data-screen="settings"] .ios-app').scrollTop = 60;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally { Element.prototype.getBoundingClientRect = original; }
    return { home, settings };
  });
  expect(reads.home).toBe(0);
  expect(reads.settings).toBeGreaterThan(0);
});

test('region and movement-arrow geometry translate together without rebuilding the arrow', async ({ page }) => {
  await openCanvas(page, [{
    id: 'region-pan', n: 1, type: 'region', pageId: 'e2e-ios', screenId: 'settings', content: 'Region and arrow',
    base: { selector: '[data-screen="settings"] .ios-stage', rect: [0, 0, 402, 874] },
    rect: [20, 180, 200, 70],
    move: { to_selector: `${cellSelector}:nth-child(2)`, to_rel: [.5, .5] },
  }]);
  await expect(page.locator('#ann-marks svg[data-arrow]')).toBeVisible();
  const before = await page.evaluate(() => {
    const frame = document.querySelector('#ann-marks .ann-frame');
    const arrow = document.querySelector('#ann-marks svg[data-arrow]');
    window.__panTestArrow = arrow;
    return { frame: frame.getBoundingClientRect().x, arrow: arrow.getBoundingClientRect().x };
  });
  await page.locator('#wbstage').evaluate(s => { s.scrollLeft += 50; });
  await expect.poll(() => page.evaluate(prev => {
    const frame = document.querySelector('#ann-marks .ann-frame');
    const arrow = document.querySelector('#ann-marks svg[data-arrow]');
    return { frame: Math.round(frame.getBoundingClientRect().x - prev.frame),
      arrow: Math.round(arrow.getBoundingClientRect().x - prev.arrow), same: window.__panTestArrow === arrow };
  }, before)).toEqual({ frame: -50, arrow: -50, same: true });
});

test('continuous zoom projects targets without resolving or measuring them and never saves annotations', async ({ page }) => {
  const saves = await openCanvas(page, 1000);
  // R4 的首测量 lastRect 落盘是一次合法保存：先等它 settle，清零后再数
  // zoom 期间的新保存 —— 断言的仍然是「zoom 不触发保存」本身。
  await expect.poll(() => saves.length).toBeGreaterThanOrEqual(1);
  saves.length = 0;
  const result = await page.evaluate(async () => {
    const stage = document.querySelector('#wbstage');
    const first = document.querySelector('#ann-marks .ann-target');
    const rect = Element.prototype.getBoundingClientRect;
    const query = Document.prototype.querySelector;
    let reads = 0, queries = 0;
    Element.prototype.getBoundingClientRect = function () { if (this.matches('.ios-cell')) reads++; return rect.call(this); };
    Document.prototype.querySelector = function (selector) { if (selector.includes('.ios-cell')) queries++; return query.call(this, selector); };
    try {
      for (let i = 0; i < 20; i++) {
        stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
          deltaY: i % 2 ? 100 : -100, clientX: 900, clientY: 450 }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    } finally { Element.prototype.getBoundingClientRect = rect; Document.prototype.querySelector = query; }
    return { reads, queries, same: first === document.querySelector('#ann-marks .ann-target') };
  });
  expect(result).toEqual({ reads: 0, queries: 0, same: true });
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  // debounce 600ms：等一个周期，确认 zoom 没排下任何新保存。
  await page.waitForTimeout(700);
  expect(saves).toEqual([]);
});

test('local content reflow preserves unrelated target geometry and updates the changed target', async ({ page }) => {
  await openCanvas(page, ['settings', 'home'].map((screenId, i) => ({
    id: `local-${i}`, n: i + 1, type: 'element', pageId: 'e2e-ios', screenId,
    targets: [{ ref: 'i1', selector: screenId === 'home' ? '[data-screen="home"] .ios-app' : `${cellSelector}:nth-child(1)`, text: screenId }], content: screenId,
  })));
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(2);
  const result = await page.evaluate(async () => {
    const original = Element.prototype.getBoundingClientRect;
    let unrelated = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.ios-app') && this.closest('[data-screen="home"]')) unrelated++;
      return original.call(this);
    };
    try {
      document.querySelector('[data-screen="settings"] .ios-cell').style.marginTop = '35px';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally { Element.prototype.getBoundingClientRect = original; }
    return unrelated;
  });
  expect(result).toBe(0);
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
});

test('cached anchor state distinguishes hidden, removed and restored content including selector attribute edits', async ({ page }) => {
  await openCanvas(page, [{ id: 'unique-anchor', n: 1, type: 'element', pageId: 'e2e-ios', screenId: 'settings',
    targets: [{ ref: 'i1', selector: '[data-screen="settings"] label.ios-cell:nth-of-type(1)', text: 'First label' }], content: 'State' }]);
  const cell = page.locator(cellSelector).first();
  await cell.evaluate(el => { window.__restoreCell = el; el.style.display = 'none'; });
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().countLive)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().countBroken)).toBe(0);
  await cell.evaluate(el => { el.style.display = ''; });
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().countLive)).toBe(1);
  await cell.evaluate(el => { el.classList.remove('ios-cell'); });
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().countBroken)).toBe(1);
  await page.evaluate(() => window.__restoreCell.classList.add('ios-cell'));
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().countLive)).toBe(1);
  await page.evaluate(() => { const el = window.__restoreCell; window.__restoreParent = el.parentNode; el.remove(); });
  // Removing the first nth-child makes its successor the live anchor; replacing the entire list must recover too.
  await page.evaluate(() => { window.__restoreParent.replaceChildren(window.__restoreCell); });
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  expect(await page.evaluate(() => window.pinpoint.annotations.length)).toBe(1);
});

test('a multi-frame annotation follows changes to its second target and keeps its arrow node on zoom', async ({ page }) => {
  await openCanvas(page, [{
    id: 'multi-frame', n: 1, type: 'element', pageId: 'e2e-ios', screenId: 'settings', content: 'Both frames',
    targets: [{ ref: 'i1', selector: `${cellSelector}:nth-child(1)`, text: 'settings' },
      { ref: 'i2', selector: '[data-screen="home"] .ios-stage', text: 'home' }],
    move: { to_selector: '[data-screen="home"] .ios-stage', to_rel: [.5, .5] },
  }]);
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(2);
  await page.evaluate(() => { window.__arrowIdentity = document.querySelector('#ann-marks svg[data-arrow]'); });
  await page.locator('[data-screen="home"] .ios-stage').evaluate(el => { el.style.marginLeft = '40px'; });
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector('[data-screen="home"] .ios-stage').getBoundingClientRect();
    const mark = document.querySelectorAll('#ann-marks .ann-target')[1].getBoundingClientRect();
    return Math.abs(mark.x + 4 - target.x);
  })).toBeLessThan(2);
  await page.locator('#wbzoom-in').click();
  await expect.poll(() => page.evaluate(() => window.__arrowIdentity === document.querySelector('#ann-marks svg[data-arrow]'))).toBe(true);
});

test('draft geometry is not translated twice during pan and zoom', async ({ page }) => {
  await openCanvas(page);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator(`${cellSelector} .ios-cell-title`).first().click();
  await page.locator('#ann-input').fill('keep draft');
  await page.locator('#wbstage').evaluate(s => { s.scrollLeft += 50; s.scrollTop += 20; });
  const error = () => page.evaluate(() => {
    const target = document.querySelector('[data-screen="settings"] .ios-cell-title').getBoundingClientRect();
    const mark = document.querySelector('.ann-draft-target').getBoundingClientRect();
    return Math.max(Math.abs(mark.left + 4 - target.left), Math.abs(mark.top + 4 - target.top));
  });
  await expect.poll(error).toBeLessThan(2);
  await page.locator('#wbzoom-in').click();
  await expect.poll(error).toBeLessThan(2);
  await expect(page.locator('#ann-input')).toContainText('keep draft');
});

test('a hidden secondary target in another frame is restored by local style changes', async ({ page }) => {
  await openCanvas(page, [{ id: 'hidden-secondary', n: 1, type: 'element', pageId: 'e2e-ios', screenId: 'settings',
    targets: [{ ref: 'i1', selector: `${cellSelector}:nth-child(1)`, text: 'Settings' },
      { ref: 'i2', selector: '[data-screen="home"] .ios-app', text: 'Home' }], content: 'Two targets' }]);
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(2);
  await page.locator('[data-screen="home"] .ios-app').first().evaluate(el => { el.style.display = 'none'; });
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(1);
  await page.locator('[data-screen="home"] .ios-app').first().evaluate(el => { el.style.display = ''; });
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(2);
});

test('global stylesheet updates invalidate cached geometry', async ({ page }) => {
  await openCanvas(page, 1);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'geometry-style-test';
    style.textContent = '[data-screen="settings"] .ios-cell { margin-left: 24px !important; }';
    document.head.appendChild(style);
  });
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
  await page.locator('#geometry-style-test').evaluate(el => { el.textContent = '[data-screen="settings"] .ios-cell { margin-left: 44px !important; }'; });
  await expect.poll(() => alignmentError(page)).toBeLessThan(2);
});

test('saving one comment preserves unrelated geometry and sends one complete ledger update', async ({ page }) => {
  const startup = await openCanvas(page, 1000);
  // R4 的首测量 lastRect 落盘先走默认假桶（revision 1→2）；下面的 route 覆盖
  // 它之后，本用例自己的保存从头计数，baseRevision 是推进后的 2。
  await expect.poll(() => startup.length).toBeGreaterThanOrEqual(1);
  const saves = [];
  await page.route('**/save', async route => {
    saves.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, revision: 2 } });
  });
  await page.evaluate(() => window.pinpoint.openMark(1));
  await page.locator('#ann-input').fill('Updated comment');
  await page.waitForTimeout(200);
  const result = await page.evaluate(async () => {
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    const nodes = Array.from(document.querySelectorAll('#ann-marks .ann-target'));
    Element.prototype.getBoundingClientRect = function () { if (this.matches('.ios-cell')) reads++; return original.call(this); };
    try {
      document.querySelector('#ann-save').click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally { Element.prototype.getBoundingClientRect = original; }
    return { reads, retained: nodes.every(node => node.isConnected) };
  });
  expect(result.retained).toBe(true);
  expect(result.reads).toBeLessThan(10);
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].baseRevision).toBe(2);
  expect(saves[0].annotations).toHaveLength(1000);
  expect(saves[0].annotations[0].content).toBe('[@t:i1] Updated comment');
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(1000);
});


test('ghost rect keeps the last known spot through pan and zoom after the target leaves the DOM', async ({page}) => {
  // R4：lastRect 现在会 debounce 落盘 —— 用一对有状态假路由（/save 合并进账本、
  // GET 回账本）从首次装载就接住本页，reload 后幽灵框必须还在原位（补回旧
  // result 用例被删掉的 reload 存活断言，蓝框退役后的等价物）。
  const ledger = {
    revision: 1,
    annotations: [{
      id: 'pan-fixture-0', n: 1, type: 'element', pageId: 'e2e-ios',
      screenId: 'settings', content: 'Pan annotation 1',
      targets: [{ ref: 'i1', selector: `${cellSelector}:nth-child(1)`, text: 'Cell' }],
    }],
  };
  await page.route('**/save', async route => {
    const body = route.request().postDataJSON();
    ledger.revision += 1;
    ledger.annotations = body.annotations;
    await route.fulfill({ json: { ok: true, revision: ledger.revision } });
  });
  await page.route('**/annotations/**', route => route.fulfill({ json: ledger }));
  await page.goto('/index.html?page=e2e-ios');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator(cellSelector).first()).toBeVisible();
  await page.locator(cellSelector).first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.pinpoint.getState().countAll === 1);
  await page.evaluate(() => window.workbench.whenScrollSettled());
  // lastRect 在锚点活着时已记下；目标离场后幽灵框钉在原位，pan / zoom 跟着投影走。
  // 比的是舞台绝对坐标（scrollLeft/Top 参与换算）：视口移动不算误差。
  const oldRect = await page.locator(`${cellSelector}:nth-child(1)`).first().boundingBox();
  // 比对基准 = 格子相对板上内容原点（zoom-wrap）的位置：视口平移与 zoom
  // 变换对这个量都是等比缩放，除回 zoom 即得板上内容坐标，pan / zoom 不变量。
  const oldRel = await page.evaluate((r) => {
    const wr = document.querySelector('#wb-board-panel .wb-zoom-wrap').getBoundingClientRect();
    return { x: r.x - wr.left, y: r.y - wr.top, w: r.width, h: r.height };
  }, oldRect);
  // 种子的锚 selector 是位置式的（.ios-cell:nth-child(1)）：只删命中的 3 格，
  // 后继 cell 会晋升成新的 first-child，锚点永远杀不死 —— 必须把 .ios-cell 清光。
  await page.locator(cellSelector).evaluateAll(els => els.forEach(el => el.remove()));
  const ghost = page.locator('.ann-ghost-rect');
  await expect(ghost).toHaveCount(1);
  const error = () => page.evaluate(old => {
    const wr = document.querySelector('#wb-board-panel .wb-zoom-wrap').getBoundingClientRect();
    const box = document.querySelector('.ann-ghost-rect').getBoundingClientRect();
    const zoom = Number(document.documentElement.getAttribute('data-canvas-zoom')) || 1;
    // 标记框四周外扩 MARK_BOX_PAD_PX=4（同 .ann-target），比对前先扣回去。
    const gx = (box.x + 4 - wr.left) / zoom, gy = (box.y + 4 - wr.top) / zoom;
    const gw = (box.width - 8) / zoom, gh = (box.height - 8) / zoom;
    return Math.max(Math.abs(old.x - gx), Math.abs(old.y - gy), Math.abs(old.w - gw), Math.abs(old.h - gh));
  }, oldRel);
  await expect.poll(error).toBeLessThan(8);
  await page.locator('#wbstage').evaluate(s => { s.scrollLeft += 100; s.scrollTop += 60; });
  await expect.poll(error).toBeLessThan(8);
  await page.locator('#wbzoom-in').click();
  await expect.poll(error).toBeLessThan(8);
  // reload 存活：等 lastRect 落进假账本，重载（DOM 恢复、锚点复活）后再把
  // 目标删掉 —— 幽灵框仍须出现在原位。lastRect 没落盘的话这里直接没有幽灵框。
  await expect.poll(() => Boolean(ledger.annotations[0] && ledger.annotations[0].lastRect)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await page.waitForFunction(() => window.pinpoint.getState().countAll === 1);
  await page.locator(cellSelector).evaluateAll(els => els.forEach(el => el.remove()));
  await expect(ghost).toHaveCount(1);
  await expect.poll(error).toBeLessThan(8);
  // §2b space 标记：画布端只消费 canvas 尺子的记录。注入 frame 后写的 doc 尺
  // 记录（mention 双端都会写同一条标注）不得在画布上画框；旧记录无 space 按
  // 当前端解释（保持既有行为）。挂一个无害 DOM 变更逼一次全量重测（几何
  // 缓存默认复用），幽灵框节点常驻、按可见性断言。
  const nudge = () => page.evaluate(tag => {
    const probe = document.createElement('div');
    probe.setAttribute('data-space-probe', tag);
    document.body.appendChild(probe);
    probe.remove();
  }, Date.now());
  await page.evaluate(() => {
    window.pinpoint.marks[0].lastRect = Object.assign({}, window.pinpoint.marks[0].lastRect, { space: 'doc' });
  });
  await nudge();
  await expect(ghost).toBeHidden();
  await page.evaluate(() => {
    delete window.pinpoint.marks[0].lastRect.space;
  });
  await nudge();
  await expect(ghost).toBeVisible();
});
