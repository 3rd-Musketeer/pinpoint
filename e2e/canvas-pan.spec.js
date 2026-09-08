import { test, expect } from '@playwright/test';
import { seedTemplatePagesVisible } from './workbench-helpers.js';

const cellSelector = '[data-screen="settings"] .ios-cell';

async function openCanvas(page, count = 0, withResults = false) {
  await seedTemplatePagesVisible(page);
  // Synthetic ledgers never write the user's data, even when a test edits a mark.
  await page.route('**/annotations/**', route => route.fulfill({ json: {
    revision: 1,
    annotations: Array.isArray(count) ? count : Array.from({ length: count }, (_, i) => ({
      id: `pan-fixture-${i}`, n: i + 1, type: 'element', pageId: 'library',
      screenId: 'settings', content: `Pan annotation ${i + 1}`,
      ...(withResults ? { result: { operations: [{action:'modify', targets:[{screenId:'settings', selector:`.ios-page > .ios-section:first-child .ios-cell:nth-child(${i % 3 + 1})`}]}] } } : {}),
      targets: [{ ref: 'i1', selector: `${cellSelector}:nth-child(${i % 3 + 1})`, text: 'Cell' }],
    })),
  } }));
  await page.goto('/index.html?page=library');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator(cellSelector).first()).toBeVisible();
  await page.locator(cellSelector).first().scrollIntoViewIfNeeded();
  await page.waitForFunction(expected => window.pinpoint.getState().countAll === expected, Array.isArray(count) ? count.length : count);
  await page.evaluate(() => window.workbench.whenScrollSettled());
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

for (const count of [200, 1000]) for (const withResults of [false, true]) test(`${count} annotation pan with results ${withResults} reuses geometry instead of measuring every mark every frame`, async ({ page }) => {
  await openCanvas(page, count, withResults);
  if (withResults) await expect(page.locator('.ann-result-target')).toHaveCount(count);
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
  console.log(JSON.stringify({ count, withResults, ...sample, layouts: delta('LayoutCount'), layoutMs: delta('LayoutDuration') * 1000 }));
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
    id: `frame-scroll-${i}`, n: i + 1, type: 'element', pageId: 'library', screenId,
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
    id: 'region-pan', n: 1, type: 'region', pageId: 'library', screenId: 'settings', content: 'Region and arrow',
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
  await openCanvas(page, 1000);
  const saves = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/save') saves.push(request.url()); });
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
  expect(saves).toEqual([]);
});

test('local content reflow preserves unrelated target geometry and updates the changed target', async ({ page }) => {
  await openCanvas(page, ['settings', 'home'].map((screenId, i) => ({
    id: `local-${i}`, n: i + 1, type: 'element', pageId: 'library', screenId,
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
  await openCanvas(page, [{ id: 'unique-anchor', n: 1, type: 'element', pageId: 'library', screenId: 'settings',
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
    id: 'multi-frame', n: 1, type: 'element', pageId: 'library', screenId: 'settings', content: 'Both frames',
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
  await openCanvas(page, [{ id: 'hidden-secondary', n: 1, type: 'element', pageId: 'library', screenId: 'settings',
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
  await openCanvas(page, 1000);
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
  expect(saves[0].baseRevision).toBe(1);
  expect(saves[0].annotations).toHaveLength(1000);
  expect(saves[0].annotations[0].content).toBe('[@t:i1] Updated comment');
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(1000);
});


test('result boxes stay on the reported DOM through pan, zoom, target replacement and reload', async ({page}) => {
  await openCanvas(page, 1, true);
  const error = () => page.evaluate(selector => {
    const target=document.querySelector(selector).getBoundingClientRect();
    const box=document.querySelector('.ann-result-target').getBoundingClientRect();
    return Math.max(Math.abs(target.left-box.left),Math.abs(target.top-box.top),Math.abs(target.width-box.width));
  }, `${cellSelector}:nth-child(1)`);
  await expect.poll(error).toBeLessThan(2);
  await page.locator('#wbstage').evaluate(s=>{s.scrollLeft+=100;s.scrollTop+=60;});
  await expect.poll(error).toBeLessThan(2);
  await page.locator('#wbzoom-in').click();
  await expect.poll(error).toBeLessThan(2);
  await page.locator(cellSelector).first().evaluate(el=>{const next=el.cloneNode(true);next.style.marginTop='25px';el.replaceWith(next);});
  await expect.poll(error).toBeLessThan(2);
  await page.reload();
  await expect(page.locator('.ann-result-target')).toHaveCount(1);
  await expect.poll(error).toBeLessThan(2);
});
