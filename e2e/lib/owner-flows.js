import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect } from './fixtures.js';
import { E2E_DATA_DIR } from '../env.js';
import { closeSettled } from '../ledger-settle.js';
import { waitNoReload } from '../site-settle.js';
import { proseSettled } from './prose.js';
import { OWNER_ARTICLE, OWNER_PAGE, OWNER_FRAMES, frameId, sectionId } from './owner-fixture.js';

export async function seedOwner(request) {
  for (const ledger of ['@canvas', '@prose']) {
    const doc = await (await request.get(`/annotations/${ledger}?entry=${OWNER_PAGE}`)).json();
    const annotations = ledger === '@prose' ? [] : Array.from({ length: 24 }, (_, i) => {
      const screen = frameId(i + 2);
      return { id: `owner-seed-${i}`, screenId: screen, status: 'open', content: `检查流程 ${i + 2}`, messages: [],
        // 全局 selector 与 frame 内 selector 各一半，覆盖 K1 的两个锚点形状。
        targets: [{ ref: 'i1', selector: i % 2 ? '[data-owner-action]' : `[data-screen="${screen}"] [data-owner-action]`, text: `确认流程 ${i + 2}` }] };
    });
    const saved = await request.post('/save', { data: { entry: OWNER_PAGE, page: ledger, path: '/', baseRevision: doc.revision, annotations } });
    expect(saved.ok(), await saved.text()).toBe(true);
  }
}

export async function openOwnerArticle(page) {
  await page.goto(OWNER_ARTICLE);
  await expect(page.locator('#article .prose h1')).toHaveText('Owner 大文章验收', { timeout: 150_000 });
  await waitNoReload(page);
  await proseSettled(page);
  await expect(page.locator('[data-pp-canvas]')).toHaveCount(12);
  await expect(page.locator('.pp-thread[data-kind="canvas"]')).toHaveCount(24);
}

export async function boardReady(scope) {
  await expect(scope.locator('.wb-screen')).toHaveCount(OWNER_FRAMES, { timeout: 30_000 });
  await expect(scope.locator('[data-owner-heading]')).toHaveCount(OWNER_FRAMES);
  await scope.waitForFunction(() => window.workbench?.whenPreviewsSettled() && window.pinpoint?.getState().connected);
  await expect(scope.locator('.wb-screen-err, .wb-asset-err')).toHaveCount(0);
}

export async function openOwnerBoard(page, overlay = false) {
  if (!overlay) {
    await page.goto(`/workbench/?page=${OWNER_PAGE}`);
    await boardReady(page);
    return page;
  }
  await openOwnerArticle(page);
  await page.locator('[data-pp-section="part-1"] [data-pp-open]').click();
  await expect(page.locator('dialog[data-pp-overlay]')).toHaveAttribute('open', '');
  const handle = await page.locator('iframe.ov-canvas').elementHandle();
  const scope = await handle.contentFrame();
  await boardReady(scope);
  return scope;
}

export async function focusOwnerFrame(scope, n = 1) {
  await scope.evaluate(([section, frame]) => window.workbench.focusFrame(section, frame, { smooth: false }), [sectionId(n), frameId(n)]);
  const screen = scope.locator(`.wb-screen[data-screen="${frameId(n)}"]`);
  await expect.poll(() => screen.locator('[data-owner-action]').evaluate(el => {
    const a = el.getBoundingClientRect();
    const b = document.querySelector('#wbstage').getBoundingClientRect();
    return a.width > 0 && a.height > 0 && a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
  })).toBe(true);
  return screen;
}

export function ownerLedger(ledger = '@canvas') {
  return JSON.parse(fs.readFileSync(path.join(E2E_DATA_DIR, OWNER_PAGE, `${ledger}.json`), 'utf8')).annotations;
}

export async function ownerCleanup(page) { await closeSettled(page); }

export async function metric(testInfo, name, values) {
  const data = { name, ...values, loadavg: execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim() };
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
  console.log(`OWNER_METRIC ${JSON.stringify(data)}`);
}
