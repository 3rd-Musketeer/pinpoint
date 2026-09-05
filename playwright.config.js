import { defineConfig } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_PORT, E2E_REGISTRY, E2E_RUN_SLOT } from './e2e/env.js';
import { startProxyUpstream } from './e2e/proxy-upstream.js';
import { writeRegistryFixture } from './e2e/registry-fixture.js';

// The webServer reads PINPOINT_REGISTRY once at boot — and boots before
// globalSetup — so the fixture must be on disk before the server starts.
// 阶段 4：代理上游 fixture 同样要在写 registry 之前起（registry 里的
// e2e-proxy 条目指向它的固定端口 origin）。
startProxyUpstream();
writeRegistryFixture();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  globalSetup: './e2e/global-setup.js',
  // 产物目录也按端口分家：两轮并发跑时，共用的 test-results/ 会让两边同时写
  // 同一个 trace zip，报错是「file data stream has unexpected number of bytes」
  // 这种读起来完全不像并发的样子（2026-09-05 实测）。默认端口保持原路径。
  outputDir: E2E_RUN_SLOT ? `test-results-${E2E_RUN_SLOT}` : 'test-results',
  reporter: [['html', {
    outputFolder: E2E_RUN_SLOT ? `playwright-report-${E2E_RUN_SLOT}` : 'playwright-report',
  }]],
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
      PINPOINT_DATA_DIR: E2E_DATA_DIR,
      PINPOINT_REGISTRY: E2E_REGISTRY,
      PREVIEW_TEMPLATE_ONLY: '1',
    },
  },
});
