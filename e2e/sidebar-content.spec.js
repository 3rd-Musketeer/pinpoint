import { expect, test } from '@playwright/test';

// 左栏内容（2026-09-04 切片 ②，评审板 C1 + ADR 0031/0032）：搜索、「最近」段、
// 文件夹（建 / 改名 / 折叠 / 拖放入夹出夹 / 夹内重排 / 删夹不删页）、模板页开关、
// 搬进预览设置的「预览主题」。
//
// 文件夹的写落在 e2e 固件登记表上（PINPOINT_REGISTRY 指 tmpdir，见
// playwright.config.js），不碰这台机器上真的那一份。每个用例自己收尾：
// `PUT /registry/folders {folders: []}` 一次原子写就把所有页释放回散页区
// （删夹不删页），后面的 spec 因此看到的仍是固件原样。手动 order 只在夹内生效，
// 所以残留的 order 字段不会改变散页区的书写顺序。

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
}

// 模板页默认不显示；断言那三页时先把预览设置里的开关打开（init script 在页面
// 脚本之前跑，合并写进同一份 prefs）。
async function seedTemplatePagesVisible(page) {
  await page.addInitScript(() => {
    try {
      const key = 'pinpoint-wb';
      const prefs = JSON.parse(localStorage.getItem(key) || '{}');
      prefs.showTemplatePages = true;
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch { /* 读不到 localStorage 时让断言自己失败，不在这里吞 */ }
  });
}

async function resetFolders(request) {
  const response = await request.put('/registry/folders', { data: { folders: [] } });
  expect(response.ok()).toBeTruthy();
}

function pageIds(page, selector) {
  return page.locator(selector).evaluateAll((els) => els.map((el) => el.getAttribute('data-vpage')));
}

test.afterEach(async ({ request }) => {
  await resetFolders(request);
});

test('搜索框：打字即筛跨段、⌘K 聚焦、Esc 清空', async ({ page }) => {
  await seedTemplatePagesVisible(page);
  await openWorkbench(page);

  const input = page.locator('#wbsearch-input');
  await expect(input).toHaveAttribute('placeholder', '搜索页面');

  // ⌘K 把焦点送进搜索框（画布上按也管用 —— 监听挂在 window 上）。
  await page.locator('#wbstage').click({ position: { x: 900, y: 300 } });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(input).toBeFocused();

  // 标题子串：只剩 E2E Mixed 一行。
  await input.fill('mixed');
  await expect(page.locator('#wbpages .wb-page')).toHaveCount(1);
  await expect(page.locator('#wbpages .wb-page-t')).toHaveText(['E2E Mixed']);

  // id 子串同样命中（标题里没有 "doc-library" 这个词）。
  await input.fill('doc-library');
  await expect(page.locator('#wbpages .wb-page-t')).toHaveText(['Example HTML']);

  // Esc 清空并交还焦点，列表整份回来。
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page.locator('#wbpages .wb-page')).toHaveCount(9);
});

test('「最近」段：打开过的页最新在前，空则整段不出', async ({ page }) => {
  await openWorkbench(page);

  // 首访只记了默认页一条，`最近` 已经在了；打开两页后是最新在前。
  await page.locator('#wbpages [data-vpage="e2e-dir"]').click();
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await expect(page.locator('#wbrecent [data-recent-page="e2e-mixed"]')).toBeVisible();
  const recent = await page.locator('#wbrecent .wb-recent')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-recent-page')));
  expect(recent.slice(0, 2)).toEqual(['e2e-mixed', 'e2e-dir']);
  expect(recent.length).toBeLessThanOrEqual(5);
  // 行尾是「打开时刻」的相对时间，不是内容 mtime —— 刚点的那一行必然是「刚刚」。
  await expect(page.locator('#wbrecent [data-recent-page="e2e-mixed"] .wb-row-m')).toHaveText('刚刚');

  // 记录清空 → 整段不出（空段不留一个孤零零的段头）。
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
    prefs.recentPages = [];
    localStorage.setItem('pinpoint-wb', JSON.stringify(prefs));
  });
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbrecent')).toHaveCount(0);
});

test('模板页默认藏起来，设置里的开关打开它；当前页是模板页时照旧显示', async ({ page }) => {
  await openWorkbench(page);

  // 默认页就是 library（一个模板页）—— 它留着，另外两个模板页不出。
  await expect(page.locator('#wbpages [data-vpage="library"]')).toBeVisible();
  await expect(page.locator('#wbpages [data-vpage="components"]')).toHaveCount(0);
  await expect(page.locator('#wbpages [data-vpage="doc-library"]')).toHaveCount(0);

  // 切到别的页 → 连 library 也退场。
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await expect(page.locator('#wbpages [data-vpage="library"]')).toHaveCount(0);

  // 预览设置里的开关。
  await page.locator('#wbgear').click();
  await page.locator('#showtemplates [data-show-templates="on"]').click();
  await page.locator('[data-wb-back]').click();
  await expect(page.locator('#wbpages [data-vpage="components"]')).toBeVisible();
  await expect(page.locator('#wbpages [data-vpage="doc-library"]')).toBeVisible();

  // 落 prefs，reload 后保持。
  await expect.poll(() =>
    page.evaluate(() => JSON.parse(localStorage.getItem('pinpoint-wb')).showTemplatePages),
  ).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbpages [data-vpage="components"]')).toBeVisible();
});

test('预览主题搬进预览设置：切的是被预览页面的主题', async ({ page }) => {
  await openWorkbench(page);

  // 左栏 footer 已取消，分段只在设置视图里。
  await expect(page.locator('#wbfoot')).toHaveCount(0);
  await page.locator('#wbgear').click();
  const seg = page.locator('#wbsettings #wbtheme');
  await expect(seg).toBeVisible();

  await seg.locator('[data-theme="dark"]').click();
  await expect(page.locator('#wb-board-panel .ios-root').first()).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() =>
    page.evaluate(() => JSON.parse(localStorage.getItem('pinpoint-wb')).theme),
  ).toBe('dark');

  await seg.locator('[data-theme="light"]').click();
  await expect(page.locator('#wb-board-panel .ios-root').first()).toHaveAttribute('data-theme', 'light');
});

test('文件夹：新建 → 改名 → 拖进 → 折叠记住 → 拖出 → 删夹不删页', async ({ page }) => {
  await openWorkbench(page);

  // 新建：段尾那一行；建完当场进行内改名。
  await page.locator('#wbpages [data-new-folder]').click();
  const folder = page.locator('#wbpages [data-folder="folder-1"]');
  await expect(folder).toBeVisible();
  await page.locator('.wb-folder-rename').fill('在做');
  await page.locator('.wb-folder-rename').press('Enter');
  await expect(folder.locator('.wb-folder-t')).toHaveText('在做');

  // 拖一个页进夹：行缩进到夹下面，散页区里没有它了。
  await page.dragAndDrop('#wbpages [data-vpage="e2e-mixed"]', '#wbpages [data-folder="folder-1"]');
  const inFolder = page.locator('#wbpages [data-vpage="e2e-mixed"]');
  await expect(inFolder).toHaveClass(/ind/);
  await expect(page.locator('#wbpages .wb-loose [data-vpage="e2e-mixed"]')).toHaveCount(0);
  // 写的是登记表：条目自己长出 folder 字段。
  const entry = await page.evaluate(async () => {
    const data = await fetch('/registry').then((r) => r.json());
    return data.entries.find((e) => e.id === 'e2e-mixed');
  });
  expect(entry.folder).toBe('folder-1');

  // 折叠：孩子收起来，折叠状态写进登记表 —— reload 后仍然是收着的。
  await folder.click();
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toHaveCount(0);
  await expect.poll(async () =>
    (await page.evaluate(() => fetch('/registry').then((r) => r.json()))).folders[0].collapsed,
  ).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbpages [data-folder="folder-1"]')).toHaveAttribute('data-state', 'collapsed');
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toHaveCount(0);
  await page.locator('#wbpages [data-folder="folder-1"]').click();
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();

  // 拖回散页区：条目的 folder 字段没了。
  await page.dragAndDrop('#wbpages [data-vpage="e2e-mixed"]', '#wbpages [data-vpage="e2e-dir"]');
  await expect(page.locator('#wbpages .wb-loose [data-vpage="e2e-mixed"]')).toHaveCount(1);

  // 删夹不删页：夹里的页退回散页区，一个也不少。
  await page.dragAndDrop('#wbpages [data-vpage="e2e-dir"]', '#wbpages [data-folder="folder-1"]');
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"]')).toHaveClass(/ind/);
  await page.locator('#wbpages [data-folder="folder-1"]').click({ button: 'right' });
  await page.locator('[data-remove-folder="folder-1"]').click();
  await expect(page.locator('#wbpages [data-folder="folder-1"]')).toHaveCount(0);
  await expect(page.locator('#wbpages .wb-loose [data-vpage="e2e-dir"]')).toHaveCount(1);
  await expect(page.locator('#wbpages .wb-page')).toHaveCount(7);
});

test('夹内拖排序只在「默认」档写 order；右键菜单是拖放之外的第二条路', async ({ page }) => {
  await openWorkbench(page);

  // 用右键菜单把两个页放进新夹（同一套动作，不经过拖放）。
  await page.locator('#wbpages [data-vpage="e2e-dir"]').click({ button: 'right' });
  await page.locator('[data-new-folder-with="e2e-dir"]').click();
  await expect(page.locator('#wbpages [data-folder="folder-1"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"]')).toHaveClass(/ind/);

  await page.locator('#wbpages [data-vpage="e2e-mention"]').click({ button: 'right' });
  await page.locator('[data-move-to-folder="folder-1"]').click();
  await expect(page.locator('#wbpages [data-vpage="e2e-mention"]')).toHaveClass(/ind/);

  // 夹内顺序 = 登记表书写顺序（都还没有 order）。
  const inFolder = '#wbpages .wb-page.ind';
  expect(await pageIds(page, inFolder)).toEqual(['e2e-dir', 'e2e-mention']);

  // 「默认」档拖排序：把后面那个拖到前面那个上方 → 写 order。
  await page.dragAndDrop('#wbpages [data-vpage="e2e-mention"]', '#wbpages [data-vpage="e2e-dir"]', {
    targetPosition: { x: 60, y: 3 },
  });
  await expect.poll(() => pageIds(page, inFolder)).toEqual(['e2e-mention', 'e2e-dir']);
  const orders = await page.evaluate(async () => {
    const data = await fetch('/registry').then((r) => r.json());
    return Object.fromEntries(data.entries.filter((e) => e.folder).map((e) => [e.id, e.order]));
  });
  expect(orders).toEqual({ 'e2e-mention': 0, 'e2e-dir': 1 });

  // 「移出文件夹」把页放回散页区。
  await page.locator('#wbpages [data-vpage="e2e-mention"]').click({ button: 'right' });
  await page.locator('[data-move-out="e2e-mention"]').click();
  await expect(page.locator('#wbpages .wb-loose [data-vpage="e2e-mention"]')).toHaveCount(1);
});

// 页面行行首不放类型图标（owner 2026-09-05：「有的 item 有 icon，有的没有，
// icon 是什么意思呢」）。类型只在横条的类型标上出现；文件夹行的 chevron + 夹图标
// 是结构不是类型，不在这条里。
test('页面行没有类型图标：url 页与 dir 页的标题从同一处起，类型只在横条类型标上（2026-09-05）', async ({ page }) => {
  await openWorkbench(page);
  // 页面行 / 最近行不含任何 svg，也没有占位槽。
  await expect(page.locator('#wbpages .wb-page svg, #wbpages .wb-page .wb-row-slot, #wbside .wb-recent svg'))
    .toHaveCount(0);
  // 几何（AGENTS「坑与约定」：布局断言比 bounding box）：标题左缘 = 行左缘 + 29px
  // （8 内边距 + 评审板行首那一格 21 的留白），url 页（e2e-site）与 dir 页
  // （e2e-dir / e2e-mixed）一样。
  const offsets = await page.evaluate(() => Object.fromEntries(['e2e-site', 'e2e-dir', 'e2e-mixed'].map((id) => {
    const row = document.querySelector(`#wbpages [data-vpage="${id}"]`);
    const title = row.querySelector('.wb-row-t');
    return [id, Math.round(title.getBoundingClientRect().left - row.getBoundingClientRect().left)];
  })));
  expect(offsets).toEqual({ 'e2e-site': 29, 'e2e-dir': 29, 'e2e-mixed': 29 });
  // 类型仍看得见，只是搬到了横条：选中 url 页 → 类型标「网页」。
  await page.locator('#wbpages [data-vpage="e2e-site"]').click();
  await expect(page.locator('#wbstrip-kind')).toHaveText('网页');
});
