import os from 'node:os';
import path from 'node:path';

// The e2e webServer origin. The extension content script matches the page
// origin against registry url entries exactly, so the fixture registry must
// name this precise origin (see e2e/global-setup.js).
export const E2E_PORT = Number(process.env.E2E_PORT || 5299);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// 阶段 4：url 条目代理的上游 fixture origin（e2e/proxy-upstream.js，
// 独立 webServer 启动；registry 与上游共享这个端口）。
export const E2E_UPSTREAM_PORT = Number(process.env.E2E_UPSTREAM_PORT || E2E_PORT + 10);
export const E2E_UPSTREAM_ORIGIN = `http://127.0.0.1:${E2E_UPSTREAM_PORT}`;

// pp3：服务按需拉起的文章站点（真 Astro 开发服务器）的端口。每轮 e2e 一个，
// 落在本组端口段里（e2e-parallel 每组占 20 个端口，+0 服务、+10 上游）；不能用
// 缺省 4530——那里若有 owner 自己的站点在答，服务会直接当 external 用它。
export const E2E_SITE_PORT = Number(process.env.E2E_SITE_PORT || E2E_PORT + 5);

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

export const E2E_SITES_DIR = path.join(E2E_FIXTURE_DIR, 'sites');

// 站点的 Astro 缓存（content layer 数据、vite 依赖预构建）按轮分家：两组并行时
// 两个 Astro 进程读的是不同 registry，共用 site/.astro-cache 会互相覆盖。
export const E2E_SITE_CACHE = path.join(E2E_FIXTURE_DIR, 'site-cache');
