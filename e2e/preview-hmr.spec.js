import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';

import { E2E_DATA_DIR, E2E_SITES_DIR } from './env.js';
import { ROOT } from './lib/cli.js';
import { openWorkbenchConnected } from './lib/workbench.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// 审计 B1 的端到端：dev server 里 preview-hmr 盯着登记过的 dir 条目，改一屏
// 源码 → 只重编该屏 → preview:update → 画板重摆出新内容；改共享组件 →
// 两屏都重编都更新。这里守的是「画面到达」这一层；「只重编该屏」的产物判据
// （没点名的屏 dist 不重写）在 src/server/preview-hmr.test.js 有逐字对应的单测。
// e2e-hmr 不进共享 registry 固件（pp2-build.spec.js 同理由），自己登记自己清理。
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
  await openWorkbenchConnected(page, 'page=e2e-hmr');
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

// S2/F2 的计数证明：preview:update 带屏清单后，工作台按屏重摆 —— 改一个帧源码，
// 屏幕 HTML 只拉点名的那一屏、board.json 没人拉（整板没重装）、mountGeneration
// 不变、别的屏连 DOM 节点都是原来那个。审计 K3 的旧路径是整板重拉（97 屏全作废）。
test('增量重摆：只重拉点名的屏，不整板重装（S2/F2 计数证明）', async ({ page }) => {
  test.setTimeout(60_000);
  await openBoard(page);
  const alpha = page.locator('#wb-board-panel [data-screen="alpha"]');
  const beta = page.locator('#wb-board-panel [data-screen="beta"]');
  await expect(alpha).toContainText('hmr-site alpha v1');
  await expect(beta).toContainText('hmr-site beta v1');

  // 计数窗口从 v1 落定后开始：记 mountGeneration、给 beta 的 DOM 节点打标记，
  // 收集此后发向这一页的全部请求。
  const gen0 = await page.evaluate(() => window.workbench.mountGeneration());
  await beta.evaluate((el) => el.setAttribute('data-e2e-keep', '1'));
  const fetched = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/sites/e2e-hmr/')) fetched.push(url.pathname + url.search);
  });

  fs.writeFileSync(path.join(SITE_DIR, 'alpha.jsx'), ALPHA_V2);
  await expect(alpha).toContainText('hmr-site alpha v2');

  expect(fetched.filter((url) => url.includes('.html'))).toEqual(['/sites/e2e-hmr/alpha.html?annotate=off']);
  expect(fetched.some((url) => url.endsWith('/board.json'))).toBe(false);
  expect(await page.evaluate(() => window.workbench.mountGeneration())).toBe(gen0);
  await expect(beta).toHaveAttribute('data-e2e-keep', '1');
  await expect(beta).toContainText('hmr-site beta v1');
});

// 按屏重摆换上的是 screenContentHtml 的原始产物（data-theme="light" + screen-only）。
// 整板装载时 afterMount 的 syncPanelPrefs 按偏好改写；按屏这条路漏了它，换上的屏
// 回到默认主题和默认机壳，和旁边没重摆的屏对不上（S2 review 必须修 M1）。
const rootState = (page, id) => page.locator(`#wb-board-panel [data-screen="${id}"] .ios-root`).evaluate((r) => ({
  theme: r.getAttribute('data-theme'),
  screenOnly: r.classList.contains('screen-only'),
}));

test('深色 + 机壳偏好：按屏重摆与重置后，换上的屏与旁边的屏外观一致', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const cur = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
    localStorage.setItem('pinpoint-wb', JSON.stringify({ ...cur, theme: 'dark', frame: 'device' }));
  });
  await openBoard(page);
  const alpha = page.locator('#wb-board-panel [data-screen="alpha"]');
  await expect(alpha).toContainText('hmr-site alpha v1');
  const before = { alpha: await rootState(page, 'alpha'), beta: await rootState(page, 'beta') };
  expect(before.alpha).toEqual({ theme: 'dark', screenOnly: false });
  expect(before.beta).toEqual(before.alpha);

  fs.writeFileSync(path.join(SITE_DIR, 'alpha.jsx'), ALPHA_V2);
  await expect(alpha).toContainText('hmr-site alpha v2');
  expect(await rootState(page, 'alpha')).toEqual(await rootState(page, 'beta'));

  // 重置走同一条换内容的路，换回的是记下的原始 HTML，偏好也要补上。
  await alpha.hover();
  await alpha.locator('.wb-frame-menu-trigger').click();
  await alpha.locator('[data-frame-reset]').click();
  await expect(alpha).toContainText('hmr-site alpha v2');
  expect(await rootState(page, 'alpha')).toEqual(await rootState(page, 'beta'));
});

// 整板装载把帧里的 <style>@import</style> 提到 .wb-library 开头（lib/hoist-imports.js）；
// 按屏重摆与重置只换一帧的子节点，曾经不维护那一组：删掉的 import 继续生效，HMR 与刷新
// 出来的外观不同（final review M4）。这里用两屏共用一份 CSS、一屏独占一份的 HTML 屏，
// 断言计算样式与旁屏：每一步的结果都要等于刷新后整板装载的结果。
const HOIST_ID = 'e2e-hmr-hoist';
const HOIST_DIR = path.join(E2E_SITES_DIR, 'hmr-hoist-site');
const HOIST_FILES = {
  'board.json': JSON.stringify({ sections: [{ id: 'main', title: 'Hoist', layout: 'row', screens: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }] }] }),
  'shared.css': '[data-shared]{color:rgb(0,0,255)}',
  'only.css': '[data-own]{color:rgb(255,0,0)}',
  'added.css': '[data-own]{background-color:rgb(0,128,0)}',
  'one.html': '<div class="ios-app"><style>@import url(./shared.css);</style><style>@import url(./only.css);</style>'
    + '<div class="ios-page"><p data-own>one v1</p><p data-shared data-one-shared>one shared</p></div></div>',
  'two.html': '<div class="ios-app"><style>@import url(./shared.css);</style>'
    + '<div class="ios-page"><p data-shared data-two-shared>two shared</p></div></div>',
};

const hoistLook = (page) => page.evaluate(() => {
  const panel = document.querySelector('#wb-board-panel');
  const style = (sel) => {
    const el = panel.querySelector(sel);
    return el ? { color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor } : null;
  };
  return {
    own: style('[data-screen="one"] [data-own]'),
    oneShared: style('[data-screen="one"] [data-one-shared]'),
    twoShared: style('[data-screen="two"] [data-two-shared]'),
    hoisted: [...panel.querySelectorAll('.wb-library > style')].map((s) => s.textContent.trim()),
    inFrame: panel.querySelectorAll('.wb-screen style').length,
  };
});

test('按屏重摆维护板级提升的 import：删掉即撤销、旁屏在用的保留、新增的照提，与刷新一致', async ({ page, request }) => {
  test.setTimeout(90_000);
  fs.rmSync(HOIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(HOIST_DIR, { recursive: true });
  for (const [name, text] of Object.entries(HOIST_FILES)) fs.writeFileSync(path.join(HOIST_DIR, name), text);
  appendRegistryEntry({ id: HOIST_ID, title: 'E2E HMR Hoist', kind: 'dir', path: HOIST_DIR, board: 'ios' });
  await request.post('/registry/reload');
  try {
    const one = page.locator('#wb-board-panel [data-screen="one"]');
    const settled = () => page.waitForFunction(() => window.workbench.whenPreviewsSettled());
    const reloadLook = async (text) => {
      await page.reload();
      await page.waitForFunction(() => window.workbench && window.pinpoint?.getState().connected);
      await expect(one).toContainText(text);
      await settled();
      return hoistLook(page);
    };
    const BLUE = 'rgb(0, 0, 255)';

    await openWorkbenchConnected(page, 'page=' + HOIST_ID);
    await expect(one).toContainText('one v1');
    await settled();
    await expect.poll(async () => (await hoistLook(page)).own?.color).toBe('rgb(255, 0, 0)');
    const gen0 = await page.evaluate(() => window.workbench.mountGeneration());

    await test.step('一屏删掉两条 import：只有它用的撤销，旁屏还在用的保留', async () => {
      fs.writeFileSync(path.join(HOIST_DIR, 'one.html'),
        '<div class="ios-app"><div class="ios-page"><p data-own>one v2</p><p data-shared data-one-shared>one shared</p></div></div>');
      await expect(one).toContainText('one v2');
      // 走的是按屏重摆，不是整板重装。
      expect(await page.evaluate(() => window.workbench.mountGeneration())).toBe(gen0);
      const hmr = await hoistLook(page);
      expect(hmr.own.color).toBe('rgb(0, 0, 0)');
      expect(hmr.twoShared.color).toBe(BLUE);
      expect(hmr.oneShared.color).toBe(BLUE);
      expect(hmr.inFrame).toBe(0);
      expect(hmr).toEqual(await reloadLook('one v2'));
    });

    await test.step('一屏新增 import：照提到板级，旁屏不受影响', async () => {
      const gen = await page.evaluate(() => window.workbench.mountGeneration());
      fs.writeFileSync(path.join(HOIST_DIR, 'one.html'),
        '<div class="ios-app"><style>@import url(./added.css);</style><style>@import url(./shared.css);</style>'
        + '<div class="ios-page"><p data-own>one v3</p><p data-shared data-one-shared>one shared</p></div></div>');
      await expect(one).toContainText('one v3');
      expect(await page.evaluate(() => window.workbench.mountGeneration())).toBe(gen);
      await expect.poll(async () => (await hoistLook(page)).own.background).toBe('rgb(0, 128, 0)');
      const hmr = await hoistLook(page);
      expect(hmr.twoShared).toEqual({ color: BLUE, background: 'rgba(0, 0, 0, 0)' });
      expect(hmr.inFrame).toBe(0);
      expect(hmr).toEqual(await reloadLook('one v3'));
    });

    await test.step('整板装载后重置一帧：板级样式的所有权不丢', async () => {
      const before = await hoistLook(page);
      await one.locator('[data-own]').evaluate((el) => el.setAttribute('data-e2e-old', ''));
      await one.hover();
      await one.locator('.wb-frame-menu-trigger').click();
      await one.locator('[data-frame-reset]').click();
      await expect(one.locator('[data-e2e-old]')).toHaveCount(0);
      await expect(one).toContainText('one v3');
      expect(await hoistLook(page)).toEqual(before);
    });
  } finally {
    fs.rmSync(HOIST_DIR, { recursive: true, force: true });
    fs.rmSync(path.join(E2E_DATA_DIR, 'dist', HOIST_ID), { recursive: true, force: true });
  }
});
