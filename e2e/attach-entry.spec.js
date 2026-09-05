import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from './env.js';
import { writeRegistryFixture } from './registry-fixture.js';

// 阶段 8（2026-08-16f 产物与草稿模型收官）：CLI 归属 —— `pinpoint add <path>
// --page <pageId> --draft` 把 file/dir 条目 attach 到既有 Page：不再自成 Pages
// 行，而是作为目标页「内容」区的 doc 条目（--draft 落草稿组）；标注落草稿自己的
// entry 桶，导出走条目行 hover 钮；删掉 attach 条目后侧栏不留死行。
// 目标页 = 固件 registry 的 e2e-dir（CLI 可解析性校验认 registry 条目 id）。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATTACHED_ID = 'e2e-cli-draft';
const BUCKET = path.join(E2E_DATA_DIR, ATTACHED_ID);
const execFileP = promisify(execFile);

const FRAME = '#wb-board-panel [data-screen="' + ATTACHED_ID + '"] iframe.wb-doc-frame';

function bucketDocs() {
  if (!fs.existsSync(BUCKET)) return [];
  return fs.readdirSync(BUCKET).filter((name) => name.endsWith('.json'));
}

function restoreRegistry() {
  writeRegistryFixture();
  fs.rmSync(BUCKET, { recursive: true, force: true });
}

test('pinpoint add --page --draft：attach 条目进目标页草稿组，全链路复用 doc 管线', async ({ page }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-e2e-attach-'));
  const file = path.join(tmp, 'Button Draft.html');
  fs.writeFileSync(file, '<!doctype html><html><body><h1 id="draft-title">E2E attached draft</h1></body></html>');
  try {
    await execFileP('node', [
      path.join(ROOT, 'bin', 'pinpoint.mjs'), 'add', file,
      '--id', ATTACHED_ID, '--title', 'E2E 归属草稿', '--page', 'e2e-dir', '--draft',
      '--registry', E2E_REGISTRY,
    ], { env: { ...process.env, PINPOINT_ORIGIN: E2E_BASE_URL } });

    await page.goto('/index.html');
    await page.waitForFunction(() => window.workbench && window.pinpoint);

    // Pages 不新增行：attach 条目没有自己的页面行。
    await expect(page.locator('.wb-page[data-vpage="' + ATTACHED_ID + '"]')).toHaveCount(0);
    await expect(page.locator('.wb-page[data-vpage="e2e-dir"]')).toHaveCount(1);

    // 目标页「内容」区：产物组仍是 e2e-dir 自己的两条，草稿组出 attach 条目（纯标题无 tag）。
    await page.locator('.wb-page[data-vpage="e2e-dir"]').click();
    const products = page.locator('#wbcontents [data-group="product"] [data-entry]');
    await expect(products.locator('.wb-entry-t')).toHaveText(['Cards', 'Doc']);
    await expect(page.locator('#wbcontents .wb-entry-group-head')).toHaveText(['产物', '草稿']);
    const draftRow = page.locator('#wbcontents [data-group="draft"] [data-entry="' + ATTACHED_ID + '"]');
    await expect(draftRow).toHaveCount(1);
    await expect(draftRow.locator('.wb-entry-t')).toHaveText('E2E 归属草稿');
    await expect(draftRow.locator('.wb-entry-tag')).toHaveCount(0);

    // 点条目进阅读器：合成 doc 屏 iframe 从 /sites/<attachedId>/ 加载。
    await draftRow.click();
    const frame = page.locator(FRAME);
    await expect(frame).toHaveAttribute('src', /^sites\/e2e-cli-draft\/Button%20Draft\.html$/);
    await expect(page.frameLocator(FRAME).locator('#draft-title')).toHaveText('E2E attached draft');
    expect(await page.locator('#wbroot').getAttribute('data-page-mode')).toBe('html');

    // 标注：侧栏驱动模式，标注落草稿自己的 entry 桶（账本 path = /sites/ 路径）。
    const inFrame = (fn) => page.evaluate(({ sel, code }) => {
      const f = document.querySelector(sel);
      const w = f && f.contentWindow;
      if (!w || !w.pinpoint) return null;
      return Function('w', `return (${code})(w)`)(w);
    }, { sel: FRAME, code: fn });
    await expect.poll(() => inFrame('(w) => !!w.pinpoint')).toBe(true);
    await expect.poll(() => inFrame('(w) => w.__pinpointEntry')).toBe(ATTACHED_ID);
    await page.locator('#wbann-toggle').click();
    await expect.poll(() => inFrame('(w) => w.pinpoint.getState().mode')).toBe(true);
    expect(await inFrame(`(w) => {
      const d = w.document;
      const el = d.querySelector('#draft-title');
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: Math.round(r.x + 8), clientY: Math.round(r.y + 8), button: 0 };
      el.dispatchEvent(new w.MouseEvent('mousedown', at));
      el.dispatchEvent(new w.MouseEvent('mouseup', at));
      const ta = d.querySelector('textarea');
      ta.value = 'attached draft mark';
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      [...d.querySelectorAll('button')].find((b) => /保存/.test(b.textContent)).click();
      return true;
    }`)).toBe(true);
    await expect.poll(() => bucketDocs().length).toBe(1);
    const ledger = JSON.parse(fs.readFileSync(path.join(BUCKET, bucketDocs()[0]), 'utf8'));
    // 账本 doc.path 存 decode 后的 pathname（annotate client 契约）；iframe src 与
    // page key 里的文件名仍是 percent-encode 规范形（synth-board 同例）。
    expect(ledger.path).toBe('/sites/e2e-cli-draft/Button Draft.html');
    expect(ledger.annotations.map((a) => a.content)).toContain('attached draft mark');
    await page.locator('#wbann-count').click();
    await expect(page.locator('#wbann-list')).toContainText('attached draft mark');
    await page.locator('#wbann-count').click();

    // 导出：草稿条目行右键菜单开对话框（目标标签 = 目标页 / 条目标题）。
    await draftRow.click({ button: 'right' });
    await page.locator('[data-entry-export="' + ATTACHED_ID + '"]').click();
    const dialog = page.locator('dialog.wb-export-dialog', { hasText: '导出文档' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-export-target-label]')).toHaveText('e2e-dir / E2E 归属草稿');
    await dialog.locator('.wb-export-close').click();

    // 悬空处理：删掉 attach 条目（恢复固件 + reload），侧栏草稿组消失、不留死行。
    restoreRegistry();
    await page.request.post('/registry/reload');
    await expect(page.locator('#wbcontents [data-entry="' + ATTACHED_ID + '"]')).toHaveCount(0);
    await expect(page.locator('#wbcontents [data-group="draft"]')).toHaveCount(0);
    await expect(products.locator('.wb-entry-t')).toHaveText(['Cards', 'Doc']);
  } finally {
    restoreRegistry();
    fs.rmSync(tmp, { recursive: true, force: true });
    await page.request.post('/registry/reload').catch(() => {});
  }
});

test('pinpoint add --page 的互斥守卫在 e2e 闭环同样响亮', async () => {
  // url 条目 + --page：CLI 直接拒（registry 不被写坏）。
  await expect(execFileP('node', [
    path.join(ROOT, 'bin', 'pinpoint.mjs'), 'add', 'https://example.localhost',
    '--page', 'e2e-dir', '--registry', E2E_REGISTRY,
  ], { env: { ...process.env, PINPOINT_ORIGIN: E2E_BASE_URL } })).rejects.toThrow();
  // 不可解析的目标页：同样拒。
  await expect(execFileP('node', [
    path.join(ROOT, 'bin', 'pinpoint.mjs'), 'add', path.join(ROOT, 'e2e', 'ext-fixture.html'),
    '--page', 'ghost-page', '--registry', E2E_REGISTRY,
  ], { env: { ...process.env, PINPOINT_ORIGIN: E2E_BASE_URL } })).rejects.toThrow();
});
