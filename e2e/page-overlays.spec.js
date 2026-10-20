import { expect, test } from './lib/fixtures.js';
import { closeSettled } from './ledger-settle.js';
import { openWorkbench } from './lib/workbench.js';

const PAGE_ID = 'e2e-html_pages';
const overlayFrame = (id) => `[data-page-screen="${id}"] iframe.wb-doc-frame`;

test.afterEach(async ({ page }) => { await closeSettled(page); });

test('连续开关四个全页共享 SSE，同源请求继续完成，浮层收到其他窗口更新', async ({ page, request }) => {
  await page.addInitScript(() => {
    const Native = window.EventSource;
    window.__eventStreams = 0;
    window.EventSource = class extends Native {
      constructor(...args) { super(...args); window.__eventStreams++; }
      close() { window.__eventStreams--; super.close(); }
    };
  });
  await openWorkbench(page, `page=${PAGE_ID}`);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled())).toBe(true);
  const baseline = await page.evaluate(() => window.__eventStreams);
  expect(baseline).toBeLessThanOrEqual(2);
  for (const id of ['long-page', 'catalog', 'widget', 'catalog-2']) {
    await page.evaluate(id => window.workbench.openPage(id), id);
    await expect.poll(() => page.locator(overlayFrame(id)).evaluate(el => !!el.contentWindow.pinpoint?.getState().connected)).toBe(true);
    const streams = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).reduce((n, f) => n + (f.contentWindow.__eventStreams || 0), window.__eventStreams));
    expect(streams).toBe(baseline);
    expect(await page.evaluate(async () => (await fetch('/health', { signal: AbortSignal.timeout(2000) })).status)).toBe(200);
    await page.evaluate(() => window.workbench.closePage());
  }
  await page.evaluate(() => window.workbench.openPage('long-page'));
  await expect.poll(() => page.locator(overlayFrame('long-page')).evaluate(el => !!el.contentWindow.pinpoint?.getState().connected)).toBe(true);
  const frame = page.frameLocator(overlayFrame('long-page'));
  const { entry, ledger } = await page.locator(overlayFrame('long-page')).evaluate(el => ({ entry: el.contentWindow.pinpoint.entry, ledger: el.contentWindow.pinpoint.pageMarks[0]?.page }));
  const docPath = `/sites/${PAGE_ID}/long-page.html`;
  const { pageKeyFromPathname } = await import('../src/shared/annotate-page-key.js');
  const key = ledger || pageKeyFromPathname(docPath);
  const doc = await (await request.get(`/annotations/${key}?entry=${entry}`)).json();
  const res = await request.post('/save', { data: { page: key, entry, path: docPath, baseRevision: doc.revision,
    annotations: [...doc.annotations, { id: 'p3-shared', type: 'element', content: '共享连接更新', status: 'open', targets: [{ ref: 'i1', selector: '#top-title', text: '标题' }] }] } });
  expect(res.ok()).toBe(true);
  await expect.poll(() => page.locator(overlayFrame('long-page')).evaluate(el => el.contentWindow.pinpoint.annotations.some(a => a.id === 'p3-shared'))).toBe(true);
  const n = (await res.json()).annotations.find(a => a.id === 'p3-shared').n;
  await expect(frame.locator('.ann-badge').filter({ hasText: new RegExp(`^${n}$`) })).toBeVisible();
});

test('页面浮层最多保留两份最近文档，淘汰先等标注落盘，等待时重新打开的文档仍保留', async ({ page, request }) => {
  await openWorkbench(page, `page=${PAGE_ID}`);
  // 页面卡片在板上，owner 打不开还没落定的板里的页：先等板落定再 openPage（第一条用例同）。
  // 不等时浮层里的标注客户端偶尔连不上（基线 39ccd5e 上也会挂）。
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled())).toBe(true);
  const open = async id => {
    await page.evaluate(id => window.workbench.openPage(id), id);
    await expect.poll(() => page.locator(overlayFrame(id)).evaluate(el => !!el.contentWindow.pinpoint?.getState().connected)).toBe(true);
  };
  await open('long-page');
  const doc = page.frameLocator(overlayFrame('long-page'));
  await doc.locator('body').evaluate(() => window.pinpoint.setMode(true));
  await doc.locator('#top-title').click();
  await doc.locator('#ann-input').fill('淘汰前保存的标注');
  let release, saving = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/save', async route => { saving = true; await gate; await route.continue(); });
  try {
    await doc.locator('#ann-close').click();
    await expect.poll(() => saving).toBe(true);
    expect(await doc.locator('body').evaluate(() => window.pinpoint.getState())).toMatchObject({ syncing: true, unsynced: true });
    await doc.locator('body').evaluate(() => window.pinpoint.setMode(false));
    await page.evaluate(() => window.workbench.closePage());
    for (const id of ['catalog', 'widget']) { await open(id); await page.evaluate(() => window.workbench.closePage()); }
    // 第一份文档的保存还在途，它必须仍活着。
    await expect(page.locator(overlayFrame('long-page'))).toHaveAttribute('src', /long-page/);
    // 重新打开会刷新 LRU；迟到的淘汰任务不能卸掉正在看的文档。
    await open('long-page');
    release();
    await expect.poll(() => doc.locator('body').evaluate(() => window.pinpoint.getState().syncing)).toBe(false);
    await expect(page.locator(overlayFrame('long-page'))).toHaveAttribute('src', /long-page/);
    await page.evaluate(() => window.workbench.closePage());
    for (const id of ['catalog', 'widget', 'catalog-2']) { await open(id); await page.evaluate(() => window.workbench.closePage()); }
    await expect.poll(() => page.locator('[data-page-screen] iframe[src]').count()).toBe(2);
    await expect(page.locator(overlayFrame('widget'))).toHaveAttribute('src', /./);
    await expect(page.locator(overlayFrame('catalog-2'))).toHaveAttribute('src', /./);
    await expect(page.locator(overlayFrame('long-page'))).not.toHaveAttribute('src', /./);
    const { pageKeyFromPathname } = await import('../src/shared/annotate-page-key.js');
    const key = pageKeyFromPathname(`/sites/${PAGE_ID}/long-page.html`);
    const saved = await (await request.get(`/annotations/${key}?entry=${PAGE_ID}`)).json();
    expect(saved.annotations.some(a => a.content?.includes('淘汰前保存的标注'))).toBe(true);
  } finally { release(); }
});

test('页面浮层持续 HTTP 500 时回收不能丢稿，恢复后重试落盘才允许回收', async ({ page, request }) => {
  const { pageKeyFromPathname } = await import('../src/shared/annotate-page-key.js');
  const path = `/sites/${PAGE_ID}/long-page.html`, key = pageKeyFromPathname(path);
  const read = async () => (await request.get(`/annotations/${key}?entry=${PAGE_ID}`)).json();
  const before = await read();
  const id = 'p3-round2-http';
  const seeded = await request.post('/save', { data: { entry: PAGE_ID, page: key, path, baseRevision: before.revision,
    annotations: [{ id, type: 'element', selector: '#top-title', text: '标题', content: '磁盘旧稿', status: 'open' }] } });
  expect(seeded.ok()).toBe(true);
  await openWorkbench(page, `page=${PAGE_ID}`);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled())).toBe(true);
  const open = async id => {
    await page.evaluate(id => window.workbench.openPage(id), id);
    await expect.poll(() => page.locator(overlayFrame(id)).evaluate(f => !!f.contentWindow.pinpoint?.getState().connected)).toBe(true);
  };
  await open('long-page');
  const inner = page.frameLocator(overlayFrame('long-page'));
  const state = () => inner.locator('body').evaluate(() => window.pinpoint.getState());
  await expect.poll(async () => { const s = await state(); return !s.syncing && !s.lastRectPending; }).toBe(true);
  let failed = 0;
  await page.route('**/save', async route => { failed++; await route.fulfill({ status: 500, json: { error: 'write-failed' } }); });
  try {
    await inner.locator('body').evaluate((_, id) => window.pinpoint.openMark(window.pinpoint.annotations.find(a => a.id === id).n), id);
    await inner.locator('#ann-input').fill('本次修改不能丢');
    await inner.locator('#ann-close').click();
    await expect.poll(() => failed).toBeGreaterThan(0);
    await expect.poll(async () => (await state()).syncing).toBe(false);
    await page.evaluate(() => window.workbench.closePage());
    // 只关浮层不触发回收时，同一实例的新稿也必须保留。
    await open('long-page');
    expect(await inner.locator('body').evaluate((_, id) => window.pinpoint.annotations.find(a => a.id === id).content, id)).toContain('本次修改不能丢');
    await page.evaluate(() => window.workbench.closePage());
    for (const id of ['catalog', 'widget']) { await open(id); await page.evaluate(() => window.workbench.closePage()); }
    expect((await read()).annotations.find(a => a.id === id).content).toBe('磁盘旧稿');
    await open('long-page');
    const content = await inner.locator('body').evaluate((_, id) => window.pinpoint.annotations.find(a => a.id === id)?.content, id);
    expect(content).toContain('本次修改不能丢');
    await inner.locator('body').evaluate((_, id) => window.pinpoint.openMark(window.pinpoint.annotations.find(a => a.id === id).n), id);
    await expect(inner.locator('#ann-input')).toContainText('本次修改不能丢');
    await inner.locator('#ann-close').click();
    expect(await state()).toMatchObject({ syncing: false, syncError: true, unsynced: true });
    await page.unroute('**/save');
    await inner.locator('body').evaluate(() => window.pinpoint.retrySync());
    await expect.poll(async () => { const s = await state(); return !s.syncing && !s.unsynced && !s.syncError; }).toBe(true);
    expect((await read()).annotations.find(a => a.id === id).content).toContain('本次修改不能丢');
    await page.evaluate(() => window.workbench.closePage());
    for (const id of ['catalog', 'widget']) { await open(id); await page.evaluate(() => window.workbench.closePage()); }
    await expect(page.locator(overlayFrame('long-page'))).not.toHaveAttribute('src', /./);
    await open('long-page');
    expect(await inner.locator('body').evaluate((_, id) => window.pinpoint.annotations.find(a => a.id === id).content, id)).toContain('本次修改不能丢');
  } finally { await page.unroute('**/save'); }
});
