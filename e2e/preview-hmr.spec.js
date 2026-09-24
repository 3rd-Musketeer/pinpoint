import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR, E2E_SITES_DIR } from './env.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// 审计 B1 的端到端：dev server 里 preview-hmr 盯着登记过的 dir 条目，改一屏
// 源码 → 只重编该屏 → preview:update → 画板重摆出新内容；改共享组件 →
// 两屏都重编都更新。这里守的是「画面到达」这一层；「只重编该屏」的产物判据
// （没点名的屏 dist 不重写）在 src/server/preview-hmr.test.js 有逐字对应的单测。
// e2e-hmr 不进共享 registry 固件（pp2-build.spec.js 同理由），自己登记自己清理。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_SRC = path.join(ROOT, 'e2e', 'hmr-site');
const SITE_DIR = path.join(E2E_SITES_DIR, 'hmr-site');
const DIST_ENTRY = path.join(E2E_DATA_DIR, 'dist', 'e2e-hmr');

const ALPHA_V2 = [
  "import { Chip } from './components/Chip.jsx';",
  '',
  'export default function Alpha() {',
  '  return (',
  '    <div className="ios-app">',
  '      <div className="ios-page" style={{ padding: \'24px\' }}>',
  '        <h1 data-alpha>hmr-site alpha v2</h1>',
  '        <Chip label="chip v1" />',
  '      </div>',
  '    </div>',
  '  );',
  '}',
  '',
].join('\n');

const CHIP_V2 = 'export function Chip({ label }) {\n  return <span className="e2e-chip" data-chip>{label}·改</span>;\n}\n';

test.beforeEach(async ({ request }) => {
  // 固件拷贝从源刷新：上一轮写进拷贝里的 v2 不许漏到这一轮。
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.cpSync(SITE_SRC, SITE_DIR, { recursive: true });
  appendRegistryEntry({ id: 'e2e-hmr', title: 'E2E HMR', kind: 'dir', path: SITE_DIR, board: 'ios' });
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.rmSync(DIST_ENTRY, { recursive: true, force: true });
  await restoreRegistryFixture(request);
});

async function openBoard(page) {
  await page.goto('/index.html?page=e2e-hmr');
  await page.waitForFunction(() => window.workbench && window.pinpoint && window.pinpoint.getState().connected);
}

test('改一屏或改共享组件：画板收到 preview:update 后重摆出新内容', async ({ page }) => {
  test.setTimeout(60_000);
  await openBoard(page);
  // 首次访问触发懒编译：两屏的 dist 与 build.json 就位，画面是 v1。
  const alpha = page.locator('#wb-board-panel [data-screen="alpha"]');
  const beta = page.locator('#wb-board-panel [data-screen="beta"]');
  await expect(alpha).toContainText('hmr-site alpha v1');
  await expect(beta).toContainText('hmr-site beta v1');

  // 改一屏：不等手刷就看到 v2，没点名的 beta 纹丝不动。
  fs.writeFileSync(path.join(SITE_DIR, 'alpha.jsx'), ALPHA_V2);
  await expect(alpha).toContainText('hmr-site alpha v2');
  await expect(beta).toContainText('hmr-site beta v1');

  // 改共享组件：组件在两屏的 deps 里，两屏都进重编名单，preview:update 后两帧都出新。
  fs.writeFileSync(path.join(SITE_DIR, 'components', 'Chip.jsx'), CHIP_V2);
  await expect(alpha).toContainText('chip v1·改');
  await expect(beta).toContainText('chip v1·改');
});
