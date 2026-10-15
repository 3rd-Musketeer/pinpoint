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
    annotations: [...doc.annotations, { id: 'p3-shared', type: 'element', content: '共享连接更新', status: 'open', selector: '#top-title', text: '标题' }] } });
  expect(res.ok()).toBe(true);
  await expect.poll(() => page.locator(overlayFrame('long-page')).evaluate(el => el.contentWindow.pinpoint.annotations.some(a => a.id === 'p3-shared'))).toBe(true);
  const n = (await res.json()).annotations.find(a => a.id === 'p3-shared').n;
  await expect(frame.locator('.ann-badge').filter({ hasText: new RegExp(`^${n}$`) })).toBeVisible();
});

test('页面浮层最多保留两份最近文档，淘汰先等标注落盘，等待时重新打开的文档仍保留', async ({ page, request }) => {
  await openWorkbench(page, `page=${PAGE_ID}`);
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
