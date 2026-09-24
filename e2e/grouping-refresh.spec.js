import fs from 'node:fs';

import { E2E_REGISTRY } from './env.js';

import { expect, test } from '@playwright/test';

// 分组类 registry 写不整板重装（2026-09-24 审计 B2）：拖页入夹 / 折叠 / 改名 /
// 排序只动分组与顺序，服务端广播带 scope=grouping，工作台只重拉清单刷新左栏 ——
// 当前画板不重挂、文档页 iframe 不重载。条目类变更（CLI 写文件 + reload）照旧整板重摆。
// 两条用例合一，正好构成「分组写不重装、条目写重装」的正反对照。
//
// 「没重装」的正向信号：window.workbench.mountGeneration()（stage.js 暴露的
// mount 会话代号，每次整板重装 begin() 递增）+ 探针 —— 往 iframe 的
// contentWindow 和板内 .wb-screen 元素上各挂一个探针，整板重装走
// panel.innerHTML 整替换，两个探针都会丢。左栏更新（说明广播已落地、旧实现
// 此刻早已开始重装）之后验代号与探针，不再靠固定等待猜「没发生重装」。

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
}

async function openDocPage(page) {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click();
  const frame = page.locator('#wb-board-panel [data-screen="report"] iframe.wb-doc-frame');
  // 等真实文档加载完再挂探针：挂早了会被随后的文档替换洗掉，判据就假了。
  await expect(page.frameLocator('#wb-board-panel [data-screen="report"] iframe.wb-doc-frame').locator('h1'))
    .toHaveText('Sample Report');
  await page.evaluate(() => {
    document.querySelector('#wb-board-panel [data-screen="report"] iframe.wb-doc-frame').contentWindow.__probe = true;
    document.querySelector('#wb-board-panel .wb-screen').__probe = true;
  });
  return { frame, generation: await page.evaluate(() => window.workbench.mountGeneration()) };
}

async function expectBoardAlive(page, generation) {
  expect(await page.evaluate(() => window.workbench.mountGeneration())).toBe(generation);
  const alive = await page.evaluate(() => {
    const frame = document.querySelector('#wb-board-panel [data-screen="report"] iframe.wb-doc-frame');
    const screen = document.querySelector('#wb-board-panel .wb-screen');
    return {
      iframe: !!(frame && frame.contentWindow && frame.contentWindow.__probe),
      board: !!(screen && screen.__probe),
    };
  });
  expect(alive).toEqual({ iframe: true, board: true });
}

test.afterEach(async ({ request }) => {
  const response = await request.put('/registry/folders', { data: { folders: [] } });
  expect(response.ok()).toBeTruthy();
});

test('分组写只刷左栏板不重装；条目写照旧整板重摆', async ({ page, request }) => {
  const raw = fs.readFileSync(E2E_REGISTRY, 'utf8');
  const { frame, generation } = await openDocPage(page);

  // 夹操作从「另一个客户端」发起：这条广播到的是没发起写的工作台，
  // 夹行出现 = grouping 广播把左栏刷过了；代号与探针不变 = 板没跟着重装。
  await request.put('/registry/folders', { data: { folders: [{ id: 'f1', name: '在做' }] } });
  const folder = page.locator('#wbpages [data-folder="f1"]');
  await expect(folder).toBeVisible();
  await expectBoardAlive(page, generation);

  // 拖一页进夹（UI 路径）：行当场缩进，登记表长出 folder 字段。
  await page.dragAndDrop('#wbpages [data-vpage="e2e-dir"]', '#wbpages [data-folder="f1"]');
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"]')).toHaveClass(/ind/);
  await expectBoardAlive(page, generation);

  // 折叠 / 展开（各一次分组写）：孩子收起再回来，板照旧不动。
  await folder.click();
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"]')).toHaveCount(0);
  await folder.click();
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"]')).toBeVisible();
  await expectBoardAlive(page, generation);

  // 当前页自己被移进夹：选中态跟着页走（行挪进夹里仍然是 on），板不重装。
  await page.locator('#wbpages [data-vpage="e2e-doc"]').click({ button: 'right' });
  await page.locator('[data-move-to-folder="f1"]').click();
  const moved = page.locator('#wbpages [data-vpage="e2e-doc"]');
  await expect(moved).toHaveClass(/ind/);
  await expect(moved).toHaveAttribute('data-state', 'on');
  await expect(frame).toBeVisible();
  await expectBoardAlive(page, generation);

  // ── 条目类变更（CLI 同款路径：直接改登记表文件再 POST /registry/reload）：
  //     左栏出改名、挂载代号前进、iframe 换新 window（旧探针不在新 iframe 里）。
  const data = JSON.parse(raw);
  data.entries.find((entry) => entry.id === 'e2e-dir').title = 'E2E Dir 改名';
  fs.writeFileSync(E2E_REGISTRY, JSON.stringify(data, null, 2));
  const response = await request.post('/registry/reload');
  expect(response.ok()).toBeTruthy();

  await expect(page.locator('#wbpages [data-vpage="e2e-dir"] .wb-page-t')).toHaveText('E2E Dir 改名');
  await expect.poll(() => page.evaluate(() => window.workbench.mountGeneration())).toBeGreaterThan(generation);
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector('#wb-board-panel [data-screen="report"] iframe.wb-doc-frame');
    const screen = document.querySelector('#wb-board-panel .wb-screen');
    return {
      iframe: !!(frame && frame.contentWindow && frame.contentWindow.__probe),
      board: !!(screen && screen.__probe),
    };
  })).toEqual({ iframe: false, board: false });

  // 固件恢复：登记表文件写回原样并 reload，同轮后面的 spec 看到的还是原样。
  fs.writeFileSync(E2E_REGISTRY, raw);
  expect((await request.post('/registry/reload')).ok()).toBeTruthy();
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"] .wb-page-t')).toHaveText('E2E Dir');
});
