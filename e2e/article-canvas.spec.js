import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from './env.js';

// pp3 M1：每篇文章的画布 = 一个由 index.mdx 派生的页（docs/projects.md「文章的画布」）。
// 固件：常驻 project e2e-project（e2e/project-site/）的 commit-confirm：四个 Section，
// 有 Canvas 的三节 confirm（confirm-sheet、confirm-done）、variants（card-plain，shell comp）
// 与 mixed（mixed-phone 手机帧 + mixed-bare：帧文件自己 export const shell = "comp"），
// 帧用到本篇组件、project 共用组件和 kit，本篇有 article.css。
// 不经过 Astro：画布页只靠 pinpoint 服务与编译器。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_ID = 'e2e-project_commit-confirm';

async function ppnt(args) {
  const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
  });
  return { stdout, stderr };
}

test('文章画布：/api/frame、工作台 ?page=&section=、不进 Pages、ppnt list --frames / shot', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await test.step('/api/frame：文章帧 200，组件三层解析、article.css 注入', async () => {
    const res = await request.get(`/api/frame?page=${PAGE_ID}&screen=confirm-done&annotate=off`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-pp-comp="Banner">订单已提交');
    expect(html).toContain('data-pp-comp="Nav"');
    expect(html).toContain(`@import url("/sites/${PAGE_ID}/article.css")`);
    expect((await request.get(`/sites/${PAGE_ID}/article.css`)).status()).toBe(200);
    expect((await request.get(`/api/frame?page=${PAGE_ID}&screen=ghost`)).status()).toBe(404);
  });

  await test.step('画布结构端点：节字母 = 正文字母（纯文字的 why 占了 A），编号随之', async () => {
    const canvas = await (await request.get('/api/projects/e2e-project/articles/commit-confirm/canvas')).json();
    expect(canvas.pageId).toBe(PAGE_ID);
    expect(canvas.errors).toEqual([]);
    expect(canvas.sections.map((s) => [s.id, s.letter, s.shell || '', s.frames.map((f) => `${f.ref}:${f.id}${f.shell ? `(${f.shell})` : ''}`)])).toEqual([
      ['confirm', 'B', '', ['B1:confirm-sheet', 'B2:confirm-done']],
      ['variants', 'C', 'comp', ['C1:card-plain']],
      ['mixed', 'D', '', ['D1:mixed-phone', 'D2:mixed-bare(comp)']],
    ]);
    // 派生 board：帧级 shell 落在那一屏上，节本身没有 shell。
    const board = await (await request.get(`/sites/${PAGE_ID}/board.json`)).json();
    expect(board.sections.find((s) => s.id === 'mixed')).toMatchObject({ screens: [{ id: 'mixed-phone' }, { id: 'mixed-bare', shell: 'comp' }] });
    expect(board.sections.find((s) => s.id === 'mixed').shell).toBeUndefined();
    // /api/frame：裸组件帧进组件台，同一节的手机帧进机壳。
    const bare = await (await request.get(`/api/frame?page=${PAGE_ID}&screen=mixed-bare&annotate=off`)).text();
    expect(bare).toContain('wb-comp-stage');
    expect(bare).not.toContain('ios-stage');
    expect(await (await request.get(`/api/frame?page=${PAGE_ID}&screen=mixed-phone&annotate=off`)).text()).toContain('ios-stage');
  });

  await test.step('标注桶：画布页 id 是合法桶（卡片读 @canvas 账本），未知 id 仍 400', async () => {
    const ledger = await request.get(`/annotations/%40canvas?entry=${PAGE_ID}`);
    expect(ledger.status()).toBe(200);
    expect((await request.get('/annotations/%40canvas?entry=e2e-project_ghost')).status()).toBe(400);
  });

  await test.step('工作台 ?page=<画布页>&section=variants：落到那一节，帧真渲染，没有错误面板', async () => {
    await page.goto(`/index.html?page=${PAGE_ID}&section=variants`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect.poll(() => new URL(page.url()).searchParams.has('section')).toBe(false);
    expect(new URL(page.url()).searchParams.get('page')).toBe(PAGE_ID);
    await expect(page.locator('.wb-lib-item[data-ann-section="variants"]')).toHaveClass(/\bwb-sel\b/);
    await expect(page.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-confirm-card')).toBeVisible();
    await expect(page.locator('#wb-board-panel [data-screen="card-plain"] .e2e-confirm-card')).toBeVisible();
    // article.css 生效：确认卡的蓝边来自本篇的页级样式。
    await expect(page.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-confirm-card')).toHaveCSS('border-top-color', 'rgb(10, 132, 255)');
    await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
    await expect(page.getByText('页面不存在')).toHaveCount(0);
    // 画布图注的编号与正文节字母一致。
    await expect(page.locator('#wb-board-panel [data-screen="card-plain"] .wb-cap-ref')).toHaveText('C1');
  });

  await test.step('工作台混排节 mixed：手机帧带机壳，帧级 comp 的那一帧是裸组件，没有错误面板', async () => {
    await page.goto(`/index.html?page=${PAGE_ID}&section=mixed`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect(page.locator('.wb-lib-item[data-ann-section="mixed"]')).toHaveClass(/\bwb-sel\b/);
    const bare = page.locator('#wb-board-panel [data-screen="mixed-bare"]');
    const phone = page.locator('#wb-board-panel [data-screen="mixed-phone"]');
    await expect(bare.locator('.e2e-confirm-card')).toBeVisible();
    await expect(phone.locator('.e2e-confirm-card')).toBeVisible();
    await expect(bare).toHaveClass(/\bwb-screen--comp\b/);
    await expect(phone).not.toHaveClass(/\bwb-screen--comp\b/);
    await expect(bare.locator('.wb-screen-dim')).toHaveCount(0); // comp 画板不出尺寸行
    await expect(phone.locator('.wb-screen-dim')).toHaveCount(1);
    await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
    await expect(page.locator('#wb-board-panel [data-screen="mixed-bare"] .wb-cap-ref')).toHaveText('D2');
  });

  await test.step('左栏 Pages 不列画布页（它属于文章），别的页照常', async () => {
    await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
    await expect(page.locator(`#wbpages [data-vpage="${PAGE_ID}"]`)).toHaveCount(0);
    await expect(page.locator('#wbpages [data-vpage="e2e-project_takeover"]')).toHaveCount(0);
  });

  await test.step('ppnt list <画布页> --frames：编号 ↔ id ↔ 源文件', async () => {
    const { stdout } = await ppnt(['list', PAGE_ID, '--frames']);
    expect(stdout).toContain(`# ${PAGE_ID} · 画布帧`);
    expect(stdout).toMatch(/B1 {2}confirm-sheet +confirm-sheet\.jsx/);
    expect(stdout).toMatch(/C1 {2}card-plain +card-plain\.jsx/);
    expect(stdout).toContain('共 3 段 5 帧');
  });

  await test.step('ppnt shot B2 --page <画布页>：帧图落盘', async () => {
    const out = path.join(E2E_DATA_DIR, 'shot', PAGE_ID, 'confirm-done.png');
    const { stdout } = await ppnt(['shot', 'B2', '--page', PAGE_ID]);
    expect(stdout).toContain(out);
    const png = fs.readFileSync(out);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
