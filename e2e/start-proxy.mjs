import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { startProxyUpstream } from './proxy-upstream.js';
import { writeRegistryFixture, copySiteFixtures } from './registry-fixture.js';

// Extension tests need full Chromium; ordinary tests also need headless shell.
try {
  if (!fs.existsSync(chromium.executablePath())) throw new Error('Full Chromium is missing');
  const browser = await chromium.launch({ headless: true });
  await browser.close();
} catch (error) {
  console.error('Playwright Chromium is unavailable. Run: npx playwright install chromium\n' + error.message);
  process.exit(1);
}
copySiteFixtures();
writeRegistryFixture();
const server = startProxyUpstream();
server.on('error', error => { console.error(error); process.exit(1); });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
