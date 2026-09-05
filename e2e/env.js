import os from 'node:os';
import path from 'node:path';

// The e2e webServer origin. The extension content script matches the page
// origin against registry url entries exactly, so the fixture registry must
// name this precise origin (see e2e/global-setup.js).
export const E2E_PORT = Number(process.env.E2E_PORT || 5299);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// 阶段 4：url 条目代理的上游 fixture origin（e2e/proxy-upstream.js，
// playwright.config.js 模块作用域起服、写 registry 前必须拿到端口，用固定值）。
export const E2E_UPSTREAM_PORT = Number(process.env.E2E_UPSTREAM_PORT || E2E_PORT + 10);
export const E2E_UPSTREAM_ORIGIN = `http://127.0.0.1:${E2E_UPSTREAM_PORT}`;

// 每次运行一份固件：整套 e2e 状态挂在 E2E_PORT 下的一个目录里，所以
// `E2E_PORT=5399 npx playwright test` 和默认端口的那一轮互不覆盖。
// 不用 mkdtempSync 是因为这个模块被四个进程各加载一次（playwright.config
// 的 runner 与 worker、globalSetup、spec），随机名字四份对不上；端口是这四个
// 进程唯一共享的输入，一个端口一套固件，推导出来的路径必然一致。
export const E2E_FIXTURE_DIR = path.join(os.tmpdir(), `pinpoint-playwright-${E2E_PORT}`);

// 仓内产物目录（test-results / playwright-report）的后缀。默认端口那一轮不带
// 后缀，路径和以前一样；显式指定端口的那一轮才分家。
export const E2E_RUN_SLOT = process.env.E2E_PORT ? String(E2E_PORT) : '';

// E2E_DATA_DIR is the annotation data ROOT — entry buckets live under it
// (<root>/<entry-id>/). E2E_REGISTRY keeps e2e off the real machine registry.
export const E2E_DATA_DIR = path.join(E2E_FIXTURE_DIR, 'annotations');
export const E2E_REGISTRY = path.join(E2E_FIXTURE_DIR, 'registry.json');
