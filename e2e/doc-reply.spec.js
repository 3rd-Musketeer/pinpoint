import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY, E2E_SITES_DIR } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// 文档页标注的线程（2026-10-14 owner：改完只能写 check，说不了改了什么）。
// 存量 html 页（kind dir、board html、条目全是 HTML 文档，锚点是 cssPath + 引文）上标一条，
// agent 用 ppnt mark … --note 一步回复并写状态，回复出现在工作台的标注列表和标注卡里，
// owner 之后再编辑这条，回复也不丢。固件是 tabs-doc-site 的一份副本，id 只给本 spec 用。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_ID = 'e2e-doc-reply';
const SITE = path.join(E2E_SITES_DIR, 'doc-reply-site');
const BUCKET = path.join(E2E_DATA_DIR, PAGE_ID);
const DOC_FRAME = '#wb-board-panel iframe.wb-doc-frame[src$="/v1.html"]';
const NOTE = '标题缩成了“文档一”，见第一版';

async function ppnt(args) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

function ledgerRows() {
  if (!fs.existsSync(BUCKET)) return [];
  return fs.readdirSync(BUCKET)
    .filter((name) => name.endsWith('.json') && name !== '_seq.json')
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8')).annotations || []);
}

test.beforeEach(async ({ request }) => {
  fs.rmSync(SITE, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'e2e', 'tabs-doc-site'), SITE, { recursive: true });
  fs.rmSync(BUCKET, { recursive: true, force: true });
  appendRegistryEntry({ id: PAGE_ID, title: 'E2E Doc Reply', kind: 'dir', path: SITE, board: 'html' });
  await request.post('/registry/reload');
});

test.afterEach(async ({ page, request }) => {
  await closeSettled(page);
  await restoreRegistryFixture(request);
  fs.rmSync(BUCKET, { recursive: true, force: true });
  fs.rmSync(SITE, { recursive: true, force: true });
});

test('文档页标注：mark --note 一步回复并写 check，回复出现在工作台列表和标注卡里，owner 再编辑也不丢', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/index.html?page=${PAGE_ID}`);
  await page.waitForFunction(() => window.workbench);
  const doc = page.frameLocator(DOC_FRAME);
  await expect(doc.locator('#doc-title')).toHaveText('文档 v1');

  await test.step('owner 在文档上标一条', async () => {
    await page.locator('#wbside-toggle').click();
    await page.locator('#wbann-toggle').click();
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    await doc.locator('#doc-title').click();
    const box = doc.locator('#ann-box');
    await expect(box).toBeVisible();
    await box.locator('#ann-input').fill('标题太长');
    await box.locator('#ann-close').click();
    await expect(box).toBeHidden();
    await expect.poll(() => ledgerRows().map((row) => row.n)).toEqual([1]);
    await page.locator('#wbann-toggle').click();
  });

  await test.step('agent：comments 读到它，mark --note 回复并写 check', async () => {
    const queue = await ppnt(['comments', PAGE_ID]);
    expect(queue.code, queue.stderr).toBe(0);
    expect(queue.stdout).toMatch(/\[#1\] .*标题太长/);
    const marked = await ppnt(['mark', PAGE_ID, '#1', 'check', '--note', NOTE]);
    expect(marked.code, marked.stdout + marked.stderr).toBe(0);
    expect(marked.stdout.trim()).toBe(`#1 → check，线程里回了：${NOTE}`);
    const [row] = ledgerRows();
    expect(row.status).toBe('check');
    expect(row.messages.map((m) => [m.who, m.text])).toEqual([['agent', NOTE]]);
    // comments 把回复列在这一条下面，下一个 agent 知道已经说过什么。
    const after = await ppnt(['comments', PAGE_ID, '--status', 'all']);
    expect(after.stdout).toMatch(new RegExp(`agent（[^）]+）：${NOTE}`));
  });

  await test.step('工作台：不刷新，标注列表的这一行下面出现回复；点开标注卡也看得到', async () => {
    await page.locator('#wbann-count').click();
    const reply = page.locator('#wbann-list .wb-ann-item[data-ann-n="1"] .wb-ann-reply');
    await expect(reply).toHaveText(`agent：${NOTE}`);
    await expect(page.locator('#wbann-list .wb-ann-item[data-ann-n="1"]')).toHaveAttribute('data-ann-status', 'check');
    await page.locator('#wbann-list .wb-ann-item-main[data-ann-n="1"]').click();
    const thread = doc.locator('#ann-box #ann-thread .ann-reply');
    await expect(thread).toHaveCount(1);
    await expect(thread).toContainText(NOTE);
    await expect(thread.locator('.who')).toHaveText('agent');
  });

  await test.step('owner 改了这条：状态回 open，回复还在', async () => {
    const input = doc.locator('#ann-box #ann-input');
    await input.focus();
    await page.keyboard.press('End');
    await page.keyboard.type('，再短一点');
    await doc.locator('#ann-box #ann-close').click();
    await expect.poll(() => ledgerRows()[0] && ledgerRows()[0].content).toContain('再短一点');
    const [row] = ledgerRows();
    expect(row.status).toBe('open');
    expect(row.messages.map((m) => m.text)).toEqual([NOTE]);
  });
});
