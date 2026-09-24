import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR, E2E_REGISTRY, E2E_SITES_DIR } from './env.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// 决定 #15：编译页标注锚到 data-pp-id。固件 anchor-site 的被标注元素住在
// 页内组件 components/Blurb.jsx（ppId = 组件文件:行@1，不随帧文件改结构漂），
// 帧文件 anchor.jsx 承担「帧顶插元素 + 组件外包一层」的重构 —— cssPath 的
// 子链从此解析不到原元素，ppId 仍指它。
// 全链分五拍：UI 建标注（取值存 ppId，selector 带机壳四层）→ 磁盘摘 ppId 模拟
// 存量行 → 客户端兜底解析 + CLI locate 都仍命中（剥机壳兜底）→ owner 编辑保存
// 自然补回（迁移）→ 重构重编重载，标注仍锚原元素、画布无幽灵框。
// 存量行的兜底两拍原是独立用例（2026-09-23 cli-legacy-anchor），与摘 ppId 之后的
// 状态完全重合，合并后少一次建标注 + 一次开板。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_SRC = path.join(ROOT, 'e2e', 'anchor-site');
const SITE_DIR = path.join(E2E_SITES_DIR, 'anchor-site');
const LEDGER = path.join(E2E_DATA_DIR, 'e2e-anchor', '@canvas.json');
const DIST_ENTRY = path.join(E2E_DATA_DIR, 'dist', 'e2e-anchor');
const BLURB_PP_ID = 'components/Blurb.jsx:2@1';
const RESTRUCTURED_FRAME = [
  "import { Blurb } from './components/Blurb.jsx';",
  '',
  'export default function Anchor() {',
  '  return (',
  '    <div className="ios-app">',
  '      <div className="ios-page" style={{ padding: \'24px\' }}>',
  '        <div className="e2e-banner">顶部横幅</div>',
  '        <h1>锚点固件</h1>',
  '        <div className="e2e-wrap"><Blurb /></div>',
  '        <p data-tail>帧内尾部段</p>',
  '      </div>',
  '    </div>',
  '  );',
  '}',
  '',
].join('\n');

async function ppnt(args, { expectFail = false } = {}) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (!expectFail) throw error;
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

function readLedger() {
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

const waitForSave = (page) => page.waitForResponse((r) =>
  new URL(r.url()).pathname === '/save' && r.request().method() === 'POST' && r.ok());

async function openBoard(page) {
  await page.goto('/index.html?page=e2e-anchor');
  await page.waitForFunction(() => window.workbench && window.pinpoint && window.pinpoint.getState().connected);
}

async function ppntBuild() {
  const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), 'build', 'e2e-anchor'], {
    cwd: ROOT,
    env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY },
  });
  if (!stdout.includes('anchor')) throw new Error(`ppnt build 没编 anchor 屏：${stdout}${stderr}`);
}

test.beforeEach(async ({ request }) => {
  appendRegistryEntry({ id: 'e2e-anchor', title: 'E2E Anchor', kind: 'dir', path: SITE_DIR, board: 'ios' });
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  // 固件与固件产物都自己收走：anchor-site 拷贝恢复原样、dist 删掉（下次访问
  // 懒编译补回）、页桶整目录清掉，不留给共享固件断言的 spec。
  fs.cpSync(SITE_SRC, SITE_DIR, { recursive: true });
  fs.rmSync(DIST_ENTRY, { recursive: true, force: true });
  fs.rmSync(path.dirname(LEDGER), { recursive: true, force: true });
  await restoreRegistryFixture(request);
});

test('ppId 锚：建标注带 ppId 与机壳 selector，摘掉后双端兜底仍命中，编辑补回、重编仍锚', async ({ page }) => {
  test.setTimeout(90_000);
  fs.rmSync(path.dirname(LEDGER), { recursive: true, force: true });

  // 1 ─ 建标注：点组件内元素，target 落盘带 ppId。cssPath 以画布 DOM 为根 ——
  //     机壳四层（ios-root > ios-device > ios-bezel > ios-screen）在链上，机壳往
  //     ios-screen 里插了 island / statusbar，片段顶层的 nth-of-type 是漂的。
  await openBoard(page);
  const blurb = page.locator('[data-screen="anchor"] [data-blurb]');
  await expect(blurb).toHaveText('组件里的锚点段');
  await page.evaluate(() => window.pinpoint.setMode(true));
  // 负载下首次点击可能落在画布重渲染的间隙被吞掉：composer 开不起来就重试点。
  await expect(async () => {
    await blurb.click();
    await expect(page.locator('#ann-box')).toBeVisible();
  }).toPass({ timeout: 20_000 });
  await page.locator('#ann-input').fill('这段文案改成两行');
  await Promise.all([waitForSave(page), page.locator('#ann-save').click()]);
  await expect(page.locator('#ann-box')).toBeHidden();
  const captured = readLedger().annotations;
  expect(captured).toHaveLength(1);
  expect(captured[0].targets[0].ppId).toBe(BLURB_PP_ID);
  expect(captured[0].targets[0].text).toBe('组件里的锚点段');
  expect(captured[0].targets[0].selector).toContain('p:nth-of-type(1)');
  expect(captured[0].targets[0].selector).toContain('div.ios-root:nth-of-type(1)');
  expect(captured[0].targets[0].selector).toContain('div.ios-bezel:nth-of-type(1)');
  expect(captured[0].targets[0].selector).toContain('div.ios-screen:nth-of-type(1)');

  // 2 ─ 存量行模拟：磁盘上摘掉 ppId（决定 #15 之前的行就长这样），重载水合。
  const onDisk = readLedger();
  delete onDisk.annotations[0].targets[0].ppId;
  fs.writeFileSync(LEDGER, JSON.stringify(onDisk));
  await openBoard(page);
  await expect(page.locator('#ann-box')).toBeHidden();
  expect(readLedger().annotations[0].targets[0].ppId).toBeUndefined();

  // 3 ─ 存量行的双端兜底：客户端 resolveMarkTarget（ppnt shot --marks 同一条
  //     路径）在工作台 DOM 里解析回原元素 —— 机壳只在画布缺，不缺；CLI locate
  //     面对没有机壳的 dist 片段，剥机壳、首段按 class 找，给出正确的 文件:行。
  //     先等水合完成（goToMark / 兜底解析都吃 marks，负载下 hydrate 会晚到）。
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(1);
  const pin = await page.evaluate(() => {
    const m = window.pinpoint.marks[0];
    const el = window.pinpoint.resolveMarkTarget(
      { selector: m.targets[0].selector, text: m.targets[0].text || '', ppId: '' },
      m.screenId || '',
    );
    return { hit: !!el, onBlurb: !!(el && el.hasAttribute && el.hasAttribute('data-blurb')) };
  });
  expect(pin.hit).toBe(true);
  expect(pin.onBlurb).toBe(true);
  const locate = await ppnt(['locate', '#1', '--page', 'e2e-anchor']);
  expect(locate.stdout).toContain('#1 → components/Blurb.jsx:2');

  // 4 ─ 迁移：owner 编辑保存自然补回 ppId。
  await page.evaluate(() => window.pinpoint.openMark(1));
  await expect(page.locator('#ann-box')).toBeVisible();
  await Promise.all([waitForSave(page), page.locator('#ann-save').click()]);
  await expect(page.locator('#ann-box')).toBeHidden();
  expect(readLedger().annotations[0].targets[0].ppId).toBe(BLURB_PP_ID);

  // 5 ─ 帧顶插元素 + 组件外包一层，CLI 重编（组件文件不动）；重载新 dist：
  //     标注锚在原元素上（ppId 直取），画布一个实框、零幽灵框。
  fs.writeFileSync(path.join(SITE_DIR, 'anchor.jsx'), RESTRUCTURED_FRAME);
  await ppntBuild();
  await openBoard(page);
  await expect(page.locator('[data-screen="anchor"] .e2e-banner')).toHaveText('顶部横幅');
  await expect(page.locator('[data-screen="anchor"] .e2e-wrap [data-blurb]')).toHaveText('组件里的锚点段');
  await page.waitForFunction(() => window.pinpoint.marks.length === 1);
  const state = await page.evaluate(() => {
    const m = window.pinpoint.marks[0];
    const anchor = window.pinpoint.resolveMarkAnchor(m);
    const el = anchor.el;
    return {
      broken: window.pinpoint.isMarkBroken(m),
      live: anchor.live,
      onBlurb: !!(el && el.hasAttribute('data-blurb')),
      inWrap: !!(el && el.closest('.e2e-wrap')),
      ppId: m.targets[0].ppId,
    };
  });
  expect(state.ppId).toBe(BLURB_PP_ID);
  expect(state.broken).toBe(false);
  expect(state.live).toBe(true);
  expect(state.onBlurb).toBe(true);
  expect(state.inWrap).toBe(true);

  // 画布侧：唯一的 .ann-target 套在被标注元素上（视口空间比对，与缩放无关），
  // 没有幽灵框（.ann-ghost-rect 只在锚点失效且有 lastRect 时出现）。
  const targetBox = page.locator('#ann-overlay .ann-target');
  await expect(targetBox).toHaveCount(1);
  await expect(page.locator('#ann-overlay .ann-ghost-rect')).toHaveCount(0);
  // 负载下两框可能恰逢重渲染摘除：拿到非空包围盒再比（断言本身不打折）。
  let mark, blurbRect;
  await expect.poll(async () => {
    [mark, blurbRect] = await Promise.all([targetBox.boundingBox(), blurb.boundingBox()]);
    return mark && blurbRect ? 1 : 0;
  }, { timeout: 15_000 }).toBe(1);
  const overlap = Math.max(0, Math.min(mark.x + mark.width, blurbRect.x + blurbRect.width) - Math.max(mark.x, blurbRect.x))
    * Math.max(0, Math.min(mark.y + mark.height, blurbRect.y + blurbRect.height) - Math.max(mark.y, blurbRect.y));
  expect(overlap / (mark.width * mark.height)).toBeGreaterThan(0.5);
});
