import { defineConfig } from '@playwright/test';

import { E2E_DATA_DIR } from './e2e/env.js';

const E2E_PORT = Number(process.env.E2E_PORT || 5299);
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: E2E_BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev:app -- --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/health`,
    reuseExistingServer: false,
    env: {
      ...process.env,
      HTML_ANNOTATE_DATA_DIR: E2E_DATA_DIR,
      PREVIEW_TEMPLATE_ONLY: '1',
    },
  },
});
