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

test('canvas pans with middle drag and space+drag, in and out of annotation mode', async ({ page }) => {
  // 四种组合（中键/空格+左键 × 标注模式开/关）一次页面连做：每轮把手势目标
  // 格子滚回视口再拖（平移后格子会出视口，鼠标落到视口外就点不到东西），
  // 位移断言按「拖前位置 + 120/70」相对比，口径与拆分前一致。
  await openCanvas(page);
  for (const mode of [false, true]) for (const button of ['middle', 'space']) {
    await page.evaluate(mode => window.pinpoint.setMode(mode), mode);
    await page.locator(cellSelector).first().scrollIntoViewIfNeeded();
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
  }
});

test('1000 annotation pan reuses geometry instead of measuring every mark every frame', async ({ page }) => {
  // debugging.md 2026-09-07「输入次数少于全量刷新次数」指名的回归门：拦
  // 「pan 路径又挂回全量重测」。确定性计数门槛，与 200 条那条共用阈值 ——
  // 标注越少读数越少，1000 条能过是 200 条能过的必然结果，故只留这条。
  await openCanvas(page, 1000);
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
  console.log(JSON.stringify({ count: 1000, ...sample, layouts: delta('LayoutCount'), layoutMs: delta('LayoutDuration') * 1000 }));
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
  // 插 pad 触发该 frame 的重测（rAF 排程）：等 settings 的标注几何两次采样
  // 相等（= 排程的重测已落）再开始计数，计数里只剩滚动驱动的读取。
  await page.locator('[data-screen="settings"] .ios-app').evaluate(app => {
    const pad = document.createElement('div'); pad.style.height = '1200px'; app.appendChild(pad);
  });
  await expect.poll(() => page.evaluate(async () => {
    // 标注框在 #ann-marks 覆盖层里，不在 frame DOM 里；第一枚是 settings 的。
    const box = document.querySelector('#ann-marks .ann-target');
    const top = () => (box ? box.getBoundingClientRect().top : null);
    const before = top();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return before !== null && top() === before;
  })).toBe(true);
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
  // 断言的是「缩放零读数 / 零保存」，与账本规模无关，200 条足够。
  const saves = await openCanvas(page, 200);
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
  // 「zoom 不排保存」：触发一次真实保存，等它落进假桶，内容断言钉住这一条
  // 就是刚才的保存。
  await page.evaluate(() => window.pinpoint.openMark(1));
  await page.locator('#ann-input').fill('zoom 不触发保存');
  await page.locator('#ann-save').click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].annotations[0].content).toBe('[@t:i1] zoom 不触发保存');
  // 负断言要确定的观察窗：recordLastRect 的落盘是 trailing debounce（最后
  // 事件后 600ms 发火，src/client/annotate.js:3202-3208），poll 满足即停，
  // 兜不住「zoom 结束后才发火」的迟到保存。再来一段 zoom + 静默尾段当观察
  // 窗 —— zoom 段（20×2 rAF ≈ 640ms）盖过上一段 zoom 时代排下的挂账，尾段
  // （performance.now() 计时 ≥ 650ms，rAF 计步不用 sleep）给本段最后事件排下
  // 的 debounce 留足发火窗；zoom 路径若回归成「持续 dirty」，这里必见第 2 条。
  await page.evaluate(async () => {
    const stage = document.querySelector('#wbstage');
    for (let i = 0; i < 20; i++) {
      stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
        deltaY: i % 2 ? 100 : -100, clientX: 900, clientY: 450 }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const quietSince = performance.now();
    while (performance.now() - quietSince < 650) await new Promise(resolve => requestAnimationFrame(resolve));
  });
  expect(saves.length).toBe(1);
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
  // 位移走的是缓存投影：箭头节点原样复用。
  await expect.poll(() => page.evaluate(() => window.__arrowIdentity === document.querySelector('#ann-marks svg[data-arrow]'))).toBe(true);
  // 同一固件顺路守「另一 frame 里的第二目标 display:none → 恢复」的缓存计数：
  // 藏起后只剩 settings 一枚标注，恢复后两枚都回来（目标消失会拆掉箭头节点，
  // 恢复重建的是新节点 —— 所以「缩放不重建」的身份在恢复之后重新取）。
  await page.locator('[data-screen="home"] .ios-stage').evaluate(el => { el.style.display = 'none'; });
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(1);
  await page.locator('[data-screen="home"] .ios-stage').evaluate(el => { el.style.display = ''; });
  await expect(page.locator('#ann-marks .ann-target')).toHaveCount(2);
  await page.evaluate(() => { window.__arrowIdentity = document.querySelector('#ann-marks svg[data-arrow]'); });
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
  await expect(page.locator('#ann-input')).toContainText('Updated comment');
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
