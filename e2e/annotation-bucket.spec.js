import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR } from './env.js';

// Annotation documents must land in the pinpoint entry bucket
// (<E2E_DATA_DIR>/pinpoint/), never flat in the data root.

const BUCKET = path.join(E2E_DATA_DIR, 'pinpoint');

function bucketJsonFiles() {
  if (!fs.existsSync(BUCKET)) return [];
  return fs.readdirSync(BUCKET).filter((name) => name.endsWith('.json'));
}

// Leave no on-disk marks behind: other specs hydrate the same bucket.
test.afterEach(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test('saved annotations land in the pinpoint entry bucket', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.iOSAnnotate);
  await page.evaluate(() => window.iOSAnnotate.setMode(true));

  const target = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell').first();
  await target.click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill('bucket check');
  await box.locator('#ann-save').click();

  await expect.poll(() => bucketJsonFiles().length).toBe(1);
  const doc = JSON.parse(fs.readFileSync(path.join(BUCKET, bucketJsonFiles()[0]), 'utf8'));
  expect(doc.annotations.map((a) => a.content)).toContain('bucket check');
  // The data root itself must stay clean — everything lives under an entry bucket.
  expect(fs.readdirSync(E2E_DATA_DIR).filter((name) => name.endsWith('.json'))).toEqual([]);
});
