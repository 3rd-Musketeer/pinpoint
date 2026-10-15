import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './lib/fixtures.js';
import { E2E_DATA_DIR } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { dragSelect, proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';

const PROSE = 'e2e-prose_notes';
const HTML = 'e2e-html_pages';
const open = async (page, url) => {
  await page.goto(url);
  await expect(page.locator('[data-pp-article-end]')).toBeAttached({ timeout: 150_000 });
  await waitNoReload(page);
  await proseSettled(page);
};
const endpoint = (entry, ledger) => `/annotations/${encodeURIComponent(ledger)}?entry=${entry}`;
async function seed(request, entry, ledger, row) {
  const doc = await (await request.get(endpoint(entry, ledger))).json();
  const saved = await request.post('/save', { data: { entry, page: ledger, path: '/', baseRevision: doc.revision, annotations: [row] } });
  expect(saved.ok()).toBe(true);
}
test.beforeEach(() => {
  for (const id of [PROSE, HTML]) fs.rmSync(path.join(E2E_DATA_DIR, id), { recursive: true, force: true });
});
test.afterEach(async ({ page }) => { await closeSettled(page); });

test('共享 HTML 页：首读、SSE、关闭重读、close/reopen 的两个节计数一致，右栏只写一次', async ({ page, request }) => {
  test.setTimeout(180_000);
  await open(page, '/e2e-html/pages/');
  const url = await page.locator('.cc-frame[data-screen="catalog"]').getAttribute('data-doc-url');
  const ledger = pageKeyFromPathname(url);
  await seed(request, HTML, ledger, { id: 'alias', type: 'element', status: 'open', content: '共享 HTML 标注', targets: [], messages: [] });
  const badges = page.locator('[data-pp-section="pages"] [data-pp-badge], [data-pp-section="app"] [data-pp-badge]');
  await expect(badges).toHaveText(['1 条标注', '1 条标注']);
  await page.reload();
  await proseSettled(page);
  await expect(badges).toHaveText(['1 条标注', '1 条标注']);
  const doc = await (await request.get(endpoint(HTML, ledger))).json();
  const reply = await request.post(`/annotations/${encodeURIComponent(ledger)}/alias/reply`, {
    data: { entry: HTML, baseRevision: doc.revision, text: 'SSE 别名回复' },
  });
  expect(reply.ok()).toBe(true);
  await expect(page.getByText('SSE 别名回复', { exact: true })).toBeVisible();
  await expect(badges).toHaveText(['1 条标注', '1 条标注']);
  await page.evaluate(() => document.dispatchEvent(new Event('pp:canvas-overlay-closed')));
  await expect(badges).toHaveText(['1 条标注', '1 条标注']);
  const thread = page.locator('.pp-thread[data-kind="canvas"]');
  await expect(thread).toHaveCount(1);
  const saves = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/save') saves.push(r.postDataJSON()); });
  await thread.getByRole('button', { name: '完成', exact: true }).click();
  await proseSettled(page);
  await expect(badges).toHaveText(['', '']);
  expect(saves).toHaveLength(1);
  expect(saves[0].page).toBe(ledger);
  await thread.getByRole('button', { name: /已关闭/ }).click();
  await thread.getByRole('button', { name: '重新打开' }).click();
  await proseSettled(page);
  await expect(badges).toHaveText(['1 条标注', '1 条标注']);
});

test('真实 IME：SSE 到达时保留新评论和回复的组字节点、草稿及光标，确认后只发送汉字', async ({ page, context, request }, testInfo) => {
  test.setTimeout(180_000);
  await open(page, '/e2e-prose/notes/');
  await seed(request, PROSE, '@prose', { id: 'ime', type: 'prose', status: 'open', content: '已有评论',
    quote: { exact: '确认卡写清收款方' }, section: 'how', messages: [] });
  await expect(page.locator('.pp-thread[data-id="ime"]')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  for (const mode of ['draft', 'reply']) {
    if (mode === 'draft') {
      await dragSelect(page, '#why', '始终知道钱什么时候会被扣');
      await page.locator('.pp-selbtn').click();
    } else await page.locator('.pp-thread[data-id="ime"]').getByRole('button', { name: '回复', exact: true }).click();
    const area = page.locator(`textarea[data-reply="${mode === 'draft' ? '__draft' : 'ime'}"]`);
    await area.fill('前后');
    await area.evaluate((el) => { el.setSelectionRange(1, 1); window.__imeArea = el; });
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
    const doc = await (await request.get(endpoint(PROSE, '@prose'))).json();
    const text = '组字时 SSE ' + mode;
    const reply = await request.post('/annotations/%40prose/ime/reply', { data: { entry: PROSE, baseRevision: doc.revision, text } });
    expect(reply.ok()).toBe(true);
    await page.waitForFunction((text) => window.pinpointProse.rows().some((r) => r.messages?.some((m) => m.text === text)), text);
    await seed(request, PROSE, '@canvas', { id: 'ime-canvas', screenId: 'pay-card', content: '组字时画布更新 ' + mode, status: 'open' });
    await page.waitForFunction((mode) => window.pinpointProse.canvasRows().some((r) => r.content === '组字时画布更新 ' + mode), mode);
    expect(await page.evaluate(() => window.__imeArea.isConnected)).toBe(true);
    await cdp.send('Input.insertText', { text: '你好' });
    await expect(area).toHaveValue('前你好后');
    await expect(area).toBeFocused();
    expect(await area.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([3, 3]);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`IME-${mode}.png`) });
    await area.press('Enter');
    await proseSettled(page);
    const saved = await (await request.get(endpoint(PROSE, '@prose'))).json();
    const texts = saved.annotations.flatMap((r) => [r.content, ...(r.messages || []).map((m) => m.text)]);
    expect(texts.filter((s) => s === '前你好后')).toHaveLength(mode === 'draft' ? 1 : 2);
    expect(texts.some((s) => s?.includes('nihao'))).toBe(false);
  }
});
