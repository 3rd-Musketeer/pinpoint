import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR } from './env.js';

// Registry `dir` entries are served read-only under /sites/<id>/ with the
// annotate client injected, and aggregate into the workbench as pages.

const BUCKET = path.join(E2E_DATA_DIR, 'e2e-dir');
const execFileP = promisify(execFile);

function bucketDocs() {
  if (!fs.existsSync(BUCKET)) return [];
  return fs.readdirSync(BUCKET).filter((name) => name.endsWith('.json'));
}

async function rawStatus(url) {
  const { stdout } = await execFileP('curl', ['-s', '--path-as-is', '-o', '/dev/null', '-w', '%{http_code}', url]);
  return Number(stdout.trim());
}

test.afterEach(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test('registry dir entry appears as a workbench page and renders from /sites/', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.iOSAnnotate);

  // The page is board "web" — the nav lists pages of the active board mode.
  await page.locator('#wbboard-mode [data-board-mode="web"]').click();
  const navBtn = page.locator('.wb-page[data-vpage="e2e-dir"]');
  await expect(navBtn).toBeVisible();
  await navBtn.click();

  // Web-shell fragment: fetched from /sites/ with annotate=off and inlined clean.
  const cards = page.locator('#wb-board-panel [data-screen="cards"]');
  await expect(cards).toContainText('fragment served from /sites/');
  await expect(cards.locator('script')).toHaveCount(0);

  // Doc-shell screen: iframe keeps the injected client so the doc annotates itself.
  const docFrame = page.locator('#wb-board-panel [data-screen="doc"] iframe.wb-doc-frame');
  await expect(docFrame).toHaveAttribute('src', /\/sites\/e2e-dir\/doc\.html$/);
});

test('/sites/<id>/ HTML injects the annotate client and saves into the entry bucket', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.iOSAnnotate);
  expect(await page.evaluate(() => window.__pinpointEntry)).toBe('e2e-dir');
  expect(await page.evaluate(() => !!window.__htmlAnnotate)).toBe(true);

  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  await page.locator('#doc-target').click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill('dir entry mark');
  await box.locator('#ann-save').click();

  await expect.poll(() => bucketDocs().length).toBe(1);
  const doc = JSON.parse(fs.readFileSync(path.join(BUCKET, bucketDocs()[0]), 'utf8'));
  expect(doc.path).toBe('/sites/e2e-dir/doc.html');
  expect(doc.annotations.map((a) => a.content)).toContain('dir entry mark');
});

test('?annotate=off serves the same page with zero annotation surface', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html?annotate=off');
  await expect(page.locator('#doc-title')).toHaveText('E2E dir-site doc');
  expect(await page.evaluate(() => !!window.__htmlAnnotate)).toBe(false);
  expect(await page.evaluate(() => window.__pinpointEntry || null)).toBe(null);
});

test('path traversal and unknown entries are rejected', async ({ page }) => {
  // Raw-path probes: HTTP clients normalize ../ (and %2e%2e) away before it
  // hits the wire, so traversal attempts must be sent with curl --path-as-is.
  for (const p of [
    '/sites/e2e-dir/%2e%2e/%2e%2e/etc/passwd',
    '/sites/e2e-dir/%2e%2e/env.js',
    '/sites/e2e-dir/../../etc/passwd',
  ]) {
    expect(await rawStatus(E2E_BASE_URL + p), p).toBe(404);
  }
  // Semantic rejections go through the normal client.
  for (const url of [
    '/sites/ghost/doc.html',
    '/sites/e2e-site/doc.html',
    '/sites/e2e-dir/missing.html',
  ]) {
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(404);
  }
});

test('doc export of a /sites/ page carries no annotate bootstrap', async ({ page }) => {
  for (const mode of ['html-full', 'html-no-css']) {
    const res = await page.request.post('/api/export-doc', {
      data: {
        mode,
        pageId: 'e2e-dir',
        screenId: 'doc',
        src: 'sites/e2e-dir/doc.html',
        comments: false,
      },
    });
    expect(res.status(), mode).toBe(200);
    const body = await res.text();
    expect(body, mode).not.toContain('__pinpointEntry');
    expect(body, mode).not.toContain('annotate.js');
    expect(body, mode).toContain('E2E dir-site doc');
  }

  // With comments on, the bake script replaces the live bootstrap entirely.
  // (The bake script inlines lib sources whose header comments mention
  // "/annotate.js", so this asserts the tag form, not the bare string.)
  const withComments = await page.request.post('/api/export-doc', {
    data: {
      mode: 'html-full',
      pageId: 'e2e-dir',
      screenId: 'doc',
      src: 'sites/e2e-dir/doc.html',
      comments: true,
    },
  });
  expect(withComments.status()).toBe(200);
  const baked = await withComments.text();
  expect(baked).not.toContain('__pinpointEntry');
  expect(baked).not.toMatch(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*annotate\.js/i);
  expect(baked).toContain('data-export-comments');
});
