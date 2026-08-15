import os from 'node:os';
import path from 'node:path';

// E2E_DATA_DIR is the annotation data ROOT — entry buckets live under it
// (<root>/<entry-id>/). E2E_REGISTRY keeps e2e off the real machine registry.
export const E2E_DATA_DIR = path.join(os.tmpdir(), 'pinpoint-playwright-annotations');
export const E2E_REGISTRY = path.join(os.tmpdir(), 'pinpoint-playwright-registry.json');

// The e2e webServer origin. The extension content script matches the page
// origin against registry url entries exactly, so the fixture registry must
// name this precise origin (see e2e/global-setup.js).
export const E2E_PORT = Number(process.env.E2E_PORT || 5299);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// 阶段 4：url 条目代理的上游 fixture origin（e2e/proxy-upstream.js，
// playwright.config.js 模块作用域起服、写 registry 前必须拿到端口，用固定值）。
export const E2E_UPSTREAM_PORT = Number(process.env.E2E_UPSTREAM_PORT || 5309);
export const E2E_UPSTREAM_ORIGIN = `http://127.0.0.1:${E2E_UPSTREAM_PORT}`;
