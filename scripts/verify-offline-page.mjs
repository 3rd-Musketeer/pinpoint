#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { chromium, webkit } from '@playwright/test';

const artifact = path.resolve(process.argv[2] || '');
const outputRoot = path.resolve(process.argv[3] || '.tmp/offline-page-proof');
if (!fs.existsSync(artifact)) {
  console.error('usage: node scripts/verify-offline-page.mjs <artifact.html> [screenshots-dir]');
  process.exit(2);
}

const targets = [
  { name: 'chromium', browserType: chromium },
  { name: 'webkit', browserType: webkit },
];
const expectedSections = Number(process.env.EXPECT_SECTIONS || 0);
const expectedFrames = Number(process.env.EXPECT_FRAMES || 0);

for (const target of targets) {
  const browser = await target.browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const escapedNetwork = [];
  await context.route(/^https?:\/\//, async (route) => {
    escapedNetwork.push(route.request().url());
    await route.abort('internetdisconnected');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(new URL(`file://${artifact}`).href, { waitUntil: 'load' });
  await page.waitForTimeout(250);

  const sectionCount = await page.locator('.share-section').count();
  const frameCount = await page.locator('.share-frame-viewport').count();
  if (expectedSections && sectionCount !== expectedSections) throw new Error(`${target.name}: expected ${expectedSections} sections, got ${sectionCount}`);
  if (expectedFrames && frameCount !== expectedFrames) throw new Error(`${target.name}: expected ${expectedFrames} frames, got ${frameCount}`);

  const outDir = path.join(outputRoot, `${target.name}-desktop-1440x900`);
  fs.mkdirSync(outDir, { recursive: true });
  const frames = page.locator('.share-frame-viewport');
  for (let index = 0; index < frameCount; index += 1) {
    const frame = frames.nth(index);
    const id = (await frame.getAttribute('id') || `frame-${index + 1}`).replace(/^frame-/, '');
    await frame.screenshot({ path: path.join(outDir, `${String(index + 1).padStart(2, '0')}-${id}.png`) });
    const stage = frame.locator('.ios-stage');
    if (await stage.count()) {
      const box = await stage.boundingBox();
      if (!box || box.width < 190 || box.height < 430) {
        throw new Error(`${target.name}/${id}: collapsed iOS stage ${JSON.stringify(box)}`);
      }
    }
  }

  const range = page.locator('#frame-range-choice');
  if (await range.count()) {
    const before = await range.locator('[data-selection-summary]').textContent();
    await range.locator('[data-select-all]').evaluate((button) => button.click());
    const after = await range.locator('[data-selection-summary]').textContent();
    if (!before || !after || before === after) throw new Error(`${target.name}: range-choice interaction did not update`);
  }
  const center = page.locator('#frame-shared-center');
  if (await center.count()) {
    await center.locator('button[data-panel="received"]').evaluate((button) => button.click());
    if (await center.locator('.sm-panel[data-panel="received"]').getAttribute('hidden') !== null) {
      throw new Error(`${target.name}: shared-center tab interaction did not update`);
    }
  }
  if (escapedNetwork.length) throw new Error(`${target.name}: network escaped: ${escapedNetwork.join(', ')}`);
  if (errors.length) throw new Error(`${target.name}: browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ browser: target.name, viewport: 'desktop-1440x900', sections: sectionCount, frames: frameCount, screenshots: frameCount, networkRequests: 0, errors: 0 }));
  await browser.close();
}
