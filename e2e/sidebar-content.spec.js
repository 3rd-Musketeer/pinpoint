import { expect, test } from '@playwright/test';


// 左栏内容（2026-09-04 切片 ②，评审板 C1 + ADR 0031/0032）：搜索、「最近」段、
// 文件夹（建 / 改名 / 折叠 / 拖放入夹出夹 / 夹内重排 / 删夹不删页）、
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

test('查看信息显示所点页面的真实来源，区分目录与 URL', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openWorkbench(page);
  const registry = await (await request.get('/registry')).json();
  const directory = registry.entries.find(entry => entry.id === 'e2e-dir');
  const urlEntry = registry.entries.find(entry => entry.kind === 'url' && !entry.page);
  const dialog = page.getByRole('dialog', { name: '查看信息' });
  for (const [id, source, kind] of [
    ['e2e-dir', directory.path, '本地目录'],
    [urlEntry.id, urlEntry.url, 'URL 网页']
  ]) {
    await page.locator('#wbpages [data-vpage="' + id + '"]').click({ button: 'right' });
    await page.locator('[data-page-info="' + id + '"]').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('code')).toContainText(source);
    await expect(dialog).toContainText(kind);
    await expect(dialog.locator('dd').filter({ hasText: new RegExp('^' + id + '$') })).toHaveCount(1);
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await dialog.getByRole('button', { name: '复制', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(source);
    await dialog.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});

test('三个 icon tab 支持名称提示和键盘切换，只有页面 tab 提供新建', async ({ page }) => {
  await openWorkbench(page);
  const tabs = page.getByRole('tablist', { name: '侧栏视图' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(page.locator('#wbsearch')).toHaveCount(0);
  for (const name of ['页面', '大纲', '已归档']) {
    const tab = tabs.getByRole('tab', { name, exact: true });
    await expect(tab).toHaveAttribute('title', name);
    await expect(tab).toHaveText('');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.wb-side-toolbar [data-new-folder]')).toHaveCount(name === '页面' ? 1 : 0);
  }
  await tabs.getByRole('tab', { name: '已归档' }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '页面', exact: true })).toBeFocused();
  await tabs.getByRole('tab', { name: '页面', exact: true }).press('End');
  await expect(tabs.getByRole('tab', { name: '已归档' })).toBeFocused();
});

test('最近按三种变动时间排序，打开页面不会更新顺序', async ({ page, request }) => {
  await openWorkbench(page);
  const readIds = () => page.locator('#wbrecent [data-recent-page]').evaluateAll(els => els.map(el => el.dataset.recentPage));
  const before = await readIds();
  expect(before.length).toBeGreaterThan(0);
  await page.locator('#wbpages [data-vpage="e2e-dir"]').click();
  await expect.poll(readIds).toEqual(before);
  const registry = await (await request.get('/registry')).json();
  const expected = registry.entries.filter(e => !['pinpoint'].includes(e.id)).map(e => ({ id:e.id, at:Math.max(e.addedAt||0,e.mtime||0,e.annotatedAt||0) })).filter(e=>e.at).sort((a,b)=>b.at-a.at).slice(0,5).map(e=>e.id);
  expect(before).toEqual(expected);
  // Saving in another page's ledger must refresh Recent without reloading.
  const saved = await request.post('/save', { data: {
    entry: 'e2e-dir', page: 'recent-time-test', baseRevision: 0,
    annotations: [{ id: 'recent-time-mark', pageId: 'e2e-dir', comment: 'time test' }]
  } });
  expect(saved.ok()).toBeTruthy();
  const { revision } = await saved.json();
  await expect.poll(async () => (await readIds())[0]).toBe('e2e-dir');
  const after = await (await request.get('/registry')).json();
  expect(after.pageTimes['e2e-dir'].annotatedAt).toBeGreaterThan(0);
  const removed = await request.post('/save', { data: {
    entry: 'e2e-dir', page: 'recent-time-test', baseRevision: revision, annotations: []
  } });
  expect(removed.ok()).toBeTruthy();
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

test('页面 tab 新建：聚焦全选、Esc 保留文件夹', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 480 });
  await openWorkbench(page);
  const archive = page.getByRole('tab', { name: '已归档' });
  const create = page.locator('.wb-side-toolbar [data-new-folder]');
  await archive.click();
  await expect(page.getByRole('navigation', { name: '已归档页面' })).toBeVisible();
  await expect(create).toHaveCount(0);
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  const a = await archive.boundingBox();
  const c = await create.boundingBox();
  const scroll = await page.locator('#wbside-scroll').boundingBox();
  expect(Math.abs(a.y + a.height / 2 - c.y - c.height / 2)).toBeLessThan(1);
  expect(c.y + c.height).toBeLessThanOrEqual(scroll.y);
  expect(c.x).toBeGreaterThan(a.x + a.width);
  await create.click();
  const input = page.getByRole('textbox', { name: '重命名文件夹' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('新建文件夹');
  expect(await input.evaluate(el => el.selectionEnd - el.selectionStart)).toBe(5);
  const box = await input.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(scroll.y);
  expect(box.y + box.height).toBeLessThanOrEqual(scroll.y + scroll.height - 22);
  await input.fill('');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-folder="folder-1"]')).toHaveText('新建文件夹');
  const registry = await (await request.get('/registry')).json();
  expect(registry.folders).toContainEqual({ id: 'folder-1', name: '新建文件夹' });
  await page.reload();
  await expect(page.locator('[data-folder="folder-1"]')).toHaveText('新建文件夹');
});

test('文件夹：新建 → 改名 → 拖进 → 折叠记住 → 拖出 → 删夹不删页', async ({ page }) => {
  await openWorkbench(page);

  // 新建：页面工具栏入口；建完当场进行内改名。
  await page.locator('.wb-side-toolbar [data-new-folder]').click();
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
  // 8 registry 行 + 范例页（_index.json 的 manifest 行）= 9，一个不少。
  await expect(page.locator('#wbpages .wb-page')).toHaveCount(9);
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

// 页面行行首的类型图标（owner 2026-09-05 下午定的映射：画布 smartphone / 文档
// file-text / 网页 globe，每一行都有——上午撤掉是因为只给了两种、目录条目没有）。
// 横条的类型标用同一个图标，两处一致。


test('最近与 Pages 共用右键菜单，信息与归档作用于同一页', async ({ page }) => {
  await openWorkbench(page);
  const row = page.locator('#wbrecent [data-recent-page]').first();
  const id = await row.getAttribute('data-recent-page');
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  const labels = await menu.getByRole('menuitem').allTextContents();
  await page.locator('[data-page-info="' + id + '"]').click();
  const dialog = page.getByRole('dialog', { name: '查看信息' });
  await expect(dialog).toContainText(id);
  await dialog.press('Escape');
  await page.locator('#wbpages [data-vpage="' + id + '"]').click({ button: 'right' });
  await expect(menu).toBeVisible();
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual(labels);
  await page.keyboard.press('Escape');
  await row.click({ button: 'right' });
  await page.locator('[data-archive-page="' + id + '"]').click();
  await expect(page.locator('#wbrecent [data-recent-page="' + id + '"]')).toHaveCount(0);
  await expect(page.locator('#wbpages [data-vpage="' + id + '"]')).toHaveCount(0);
  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  await expect(page.locator('[data-vpage="' + id + '"]')).toBeVisible();
});
