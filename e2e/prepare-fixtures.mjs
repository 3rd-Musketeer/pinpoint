import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { writeRegistryFixture, copySiteFixtures } from './registry-fixture.js';

// 跑在 dev server 那条 webServer 命令的前半段（playwright.config.js）：Playwright 先起
// webServer 再跑 globalSetup，而服务启动时就读登记表，所以固件要在这里写好。
// 先确认 Playwright 的 Chromium 可执行文件在：缺了的话现在就报，不等到第一条用例。
try {
  if (!fs.existsSync(chromium.executablePath())) throw new Error('Full Chromium is missing');
} catch (error) {
  console.error('Playwright Chromium is unavailable. Run: npx playwright install chromium\n' + error.message);
  process.exit(1);
}
copySiteFixtures();
writeRegistryFixture();
