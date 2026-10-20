import { expect, test } from './lib/fixtures.js';
import { openWorkbench } from './lib/workbench.js';
import { closeSettled } from './ledger-settle.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';

const entry = 'e2e-html_pages';
const path = `/sites/${entry}/long-page.html`, key = pageKeyFromPathname(path);
const card = i => `[data-html-card][data-screen="save-${i}"] iframe.wb-html-card-frame`;

test.afterEach(async ({ page }) => { await closeSettled(page); });

test('活卡片 HTTP 500 后离开视野仍保留新稿，重试落盘后再卸载，重开读到新稿', async ({ page, request }) => {
  const read = async () => (await request.get(`/annotations/${key}?entry=${entry}`)).json();
  const initial = await read();
  const id = 'p3-card-http';
  const seeded = await request.post('/save', { data: { entry, page: key, path, baseRevision: initial.revision,
    annotations: [{ id, type: 'element', targets: [{ ref: 'i1', selector: '#top-title', text: '标题' }], content: '卡片磁盘旧稿', status: 'open' }] } });
  expect(seeded.ok()).toBe(true);
  await page.route(`**/sites/${entry}/board.json`, async route => {
    const board = await (await route.fetch()).json();
    board.sections = [{ id: 'save-check', title: '保存检查', letter: 'A', layout: 'row', screens:
      Array.from({ length: 10 }, (_, i) => ({ id: `save-${i}`, title: `页面 ${i}`, shell: 'doc', src: path })) }];
    await route.fulfill({ json: board });
  });
  await page.setViewportSize({ width: 640, height: 480 });
  await openWorkbench(page, `page=${entry}`);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled())).toBe(true);
  const focus = async i => {
    await page.evaluate(i => window.workbench.focusFrame('save-check', `save-${i}`, { smooth: false }), i);
    await expect(page.locator(card(i))).toHaveAttribute('data-live', 'on');
    await expect.poll(() => page.locator(card(i)).evaluate(f => !!f.contentWindow.pinpoint?.getState().connected)).toBe(true);
  };
  await focus(0);
  const first = page.locator(card(0));
  const inner = page.frameLocator(card(0));
  await expect.poll(() => first.evaluate(f => { const s = f.contentWindow.pinpoint.getState(); return !s.syncing && !s.lastRectPending; })).toBe(true);
  let failed = 0;
  await page.route('**/save', async route => { failed++; await route.fulfill({ status: 500, json: { error: 'write-failed' } }); });
  try {
    await first.evaluate((f, id) => f.contentWindow.pinpoint.openMark(f.contentWindow.pinpoint.annotations.find(a => a.id === id).n), id);
    await inner.locator('#ann-input').fill('卡片新稿不能丢');
    await inner.locator('#ann-close').click();
    await expect.poll(() => failed).toBeGreaterThan(0);
    await expect.poll(() => first.evaluate(f => f.contentWindow.pinpoint.getState().syncing)).toBe(false);
    for (let i = 1; i < 10; i++) await focus(i);
    await expect(first).toHaveAttribute('src', /long-page/);
    expect(await first.evaluate((f, id) => f.contentWindow.pinpoint.annotations.find(a => a.id === id).content, id)).toContain('卡片新稿不能丢');
    expect((await read()).annotations.find(a => a.id === id).content).toBe('卡片磁盘旧稿');
    await page.unroute('**/save');
    await first.evaluate(f => f.contentWindow.pinpoint.retrySync());
    await expect.poll(async () => (await read()).annotations.find(a => a.id === id).content).toContain('卡片新稿不能丢');
    await expect(first).not.toHaveAttribute('src', /./);
    await focus(0);
    expect(await first.evaluate((f, id) => f.contentWindow.pinpoint.annotations.find(a => a.id === id).content, id)).toContain('卡片新稿不能丢');
    await first.evaluate((f, id) => f.contentWindow.pinpoint.openMark(f.contentWindow.pinpoint.annotations.find(a => a.id === id).n), id);
    await expect(inner.locator('#ann-input')).toContainText('卡片新稿不能丢');
  } finally { await page.unroute('**/save'); }
});
