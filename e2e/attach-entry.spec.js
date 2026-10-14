import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR, E2E_REGISTRY } from './env.js';
import { ppnt } from './lib/cli.js';
import { ledgerNames } from './lib/ledger.js';
import { openWorkbench } from './lib/workbench.js';
import { writeRegistryFixture } from './registry-fixture.js';

// 阶段 8（2026-08-16f 产物与草稿模型收官）：CLI 归属 —— `pinpoint add <path>
// --page <pageId> --draft` 把 file/dir 条目 attach 到既有 Page：不再自成 Pages
// 行，而是作为目标页「内容」区的 doc 条目（--draft 落草稿组）；删掉 attach
// 条目后侧栏不留死行。目标页 = 固件 registry 的 e2e-dir（CLI 可解析性校验认
// registry 条目 id）。storage-unify：标注落宿主页的桶（e2e-dir），挂靠条目自己
// 没有桶 —— 账本仍按 /sites/<挂靠 id>/ 路径分。

const ATTACHED_ID = 'e2e-cli-draft';
const HOST_PAGE = 'e2e-dir';
const BUCKET = path.join(E2E_DATA_DIR, HOST_PAGE);

const FRAME = '#wb-board-panel [data-screen="' + ATTACHED_ID + '"] iframe.wb-doc-frame';

function restoreRegistry() {
  writeRegistryFixture();
  // 桶 = 页：本 spec 往 e2e-dir 桶里写的只有挂靠条目自己的账本，清桶清的是
  // 这个页自己的残余，不碰别人的桶。
  fs.rmSync(BUCKET, { recursive: true, force: true });
}

test('pinpoint add --page --draft：attach 条目进目标页草稿组，全链路复用 doc 管线', async ({ page }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-e2e-attach-'));
  const file = path.join(tmp, 'Button Draft.html');
  fs.writeFileSync(file, '<!doctype html><html><body><h1 id="draft-title">E2E attached draft</h1></body></html>');
  try {
    await ppnt([
      'add', file,
      '--id', ATTACHED_ID, '--title', 'E2E 归属草稿', '--page', 'e2e-dir', '--draft',
      '--registry', E2E_REGISTRY,
    ]);

    await openWorkbench(page);

    // Pages 不新增行：attach 条目没有自己的页面行。
    await expect(page.locator('.wb-page[data-vpage="' + ATTACHED_ID + '"]')).toHaveCount(0);
    await expect(page.locator('.wb-page[data-vpage="e2e-dir"]')).toHaveCount(1);

    // e2e-dir 是纯文档页，没有画布，大纲条不渲染。三条条目的顺序是
    // Cards → Doc → 挂靠草稿；默认落在 Cards，步进两次到达草稿。
    await page.locator('.wb-page[data-vpage="e2e-dir"]').click();
    await expect(page.locator('#wbtabbar')).toHaveCount(0);
    await expect(page.locator('#wbentry-position')).toHaveText('1 / 3');
    await page.locator('#wbentry-next').click();
    await page.locator('#wbentry-next').click();
    await expect(page.locator('#wbentry-position')).toHaveText('3 / 3');
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe(ATTACHED_ID);

    // 合成 doc 屏 iframe 从 /sites/<attachedId>/ 加载。
    const frame = page.locator(FRAME);
    await expect(frame).toHaveAttribute('src', /^sites\/e2e-cli-draft\/Button%20Draft\.html$/);
    await expect(page.frameLocator(FRAME).locator('#draft-title')).toHaveText('E2E attached draft');
    expect(await page.locator('#wbroot').getAttribute('data-page-mode')).toBe('html');

    // 标注：侧栏驱动模式，标注落宿主页桶（账本 path = /sites/ 路径）。
    const inFrame = (fn) => page.evaluate(({ sel, code }) => {
      const f = document.querySelector(sel);
      const w = f && f.contentWindow;
      if (!w || !w.pinpoint) return null;
      return Function('w', `return (${code})(w)`)(w);
    }, { sel: FRAME, code: fn });
    await expect.poll(() => inFrame('(w) => !!w.pinpoint')).toBe(true);
    // storage-unify：注入的 entry = 宿主页 id（桶 = 页），不再是挂靠条目自己的 id。
    await expect.poll(() => inFrame('(w) => w.__pinpointEntry')).toBe(HOST_PAGE);
    await page.locator('#wbann-toggle').click();
    await expect.poll(() => inFrame('(w) => w.pinpoint.getState().mode')).toBe(true);
    expect(await inFrame(`(w) => {
      const d = w.document;
      const el = d.querySelector('#draft-title');
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: Math.round(r.x + 8), clientY: Math.round(r.y + 8), button: 0 };
      el.dispatchEvent(new w.MouseEvent('mousedown', at));
      el.dispatchEvent(new w.MouseEvent('mouseup', at));
      const ta = d.querySelector('#ann-input');
      ta.value = 'attached draft mark';
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      d.querySelector('#ann-close').click();
      return true;
    }`)).toBe(true);
    // 宿主页桶里，这本账本的 path 指向挂靠条目的 /sites/ URL（页面 key 按路径分）。
    const minePaths = () => ledgerNames(BUCKET).filter((name) => {
      const doc = JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8'));
      return doc.path === '/sites/e2e-cli-draft/Button Draft.html';
    });
    await expect.poll(() => minePaths().length).toBe(1);
    const ledger = JSON.parse(fs.readFileSync(path.join(BUCKET, minePaths()[0]), 'utf8'));
    // 账本 doc.path 存 decode 后的 pathname（annotate client 契约）；iframe src 与
    // page key 里的文件名仍是 percent-encode 规范形（synth-board 同例）。
    expect(ledger.path).toBe('/sites/e2e-cli-draft/Button Draft.html');
    expect(ledger.annotations.map((a) => a.content)).toContainEqual(expect.stringContaining('attached draft mark'));
    await page.locator('#wbann-count').click();
    await expect(page.locator('#wbann-list')).toContainText('attached draft mark');
    await page.locator('#wbann-count').click();

    // 悬空处理：删掉 attach 条目（恢复固件 + reload），合成屏消失，选中回到默认的 Cards。
    restoreRegistry();
    await page.request.post('/registry/reload');
    await expect(page.locator('#wb-board-panel [data-screen="' + ATTACHED_ID + '"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('cards');
    await expect(page.locator('#wbentry-position')).toHaveText('1 / 2');
  } finally {
    restoreRegistry();
    fs.rmSync(tmp, { recursive: true, force: true });
    await page.request.post('/registry/reload').catch(() => {});
  }
});
