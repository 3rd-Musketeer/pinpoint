import { defineConfig } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_PORT, E2E_REGISTRY, E2E_RUN_SLOT, E2E_SITE_CACHE, E2E_SITE_PORT, E2E_VITE_CACHE, E2E_WORKBENCH_DIST } from './e2e/env.js';
const workbenchMode = process.env.PINPOINT_WORKBENCH_MODE || 'dev';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
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
  webServer: [{
    // 固件（登记表与站点副本）先写好：服务启动时就读登记表（e2e/prepare-fixtures.mjs）。
    command: `node e2e/prepare-fixtures.mjs && ${workbenchMode === 'bundle' ? 'npm run build:workbench && ' : ''}npm run dev:app -- --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/health`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 3000 },
    env: {
      ...process.env,
      PINPOINT_DATA_DIR: E2E_DATA_DIR,
      PINPOINT_REGISTRY: E2E_REGISTRY,
      PREVIEW_TEMPLATE_ONLY: '1',
      // pp3：文章请求到来时服务拉起真 Astro 站点（缺省命令带 --ignore-lock）。
      // 端口、缓存按轮隔离；不继承外面设的 PINPOINT_SITE_CMD，测的就是缺省命令。
      PINPOINT_SITE_PORT: String(E2E_SITE_PORT),
      PINPOINT_SITE_CACHE: E2E_SITE_CACHE,
      PINPOINT_SITE_CMD: '',
      // 服务的 vite 依赖缓存按轮隔离（e2e/env.js），不和别的实例共用 deps/。
      PINPOINT_VITE_CACHE: E2E_VITE_CACHE,
      PINPOINT_WORKBENCH_MODE: workbenchMode,
      PINPOINT_WORKBENCH_DIST: E2E_WORKBENCH_DIST,
    },
  }],
});
