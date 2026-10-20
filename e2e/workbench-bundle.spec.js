import { expect, test } from './lib/fixtures.js';
import { openWorkbenchConnected } from './lib/workbench.js';

test('打包工作台：真实页面只取 hash 入口、保留失败通知与无缓存壳页 @bundle-entry', async ({ page, request }) => {
  test.skip(process.env.PINPOINT_WORKBENCH_MODE !== 'bundle', '打包模式专用契约');
  const scripts = [];
  page.on('request', req => { if (req.resourceType() === 'script') scripts.push(new URL(req.url()).pathname); });
  await openWorkbenchConnected(page, 'page=example');
  await expect(page.locator('#wb-board-panel .wb-screen').first()).toBeVisible();
  // 禁的是工作台源码与开发依赖入口；Vite 事件 client 的 env.mjs 是独立运行时，并非工作台模块。
  expect(scripts.filter(p => /^\/(src|node_modules)\//.test(p))).toEqual([]);
  expect(scripts.filter(p => p.startsWith('/workbench/assets/'))).toHaveLength(1);
  const shell = await request.get('/workbench/?page=example&embed=overlay&gen=12');
  expect(shell.headers()['cache-control']).toBe('no-store');
  expect(await shell.text()).toContain('onerror="window.__wbBootFail(this.src)"');
  for (const url of scripts.filter(p => p.startsWith('/workbench/assets/'))) {
    const asset = await request.get(url);
    expect(asset.headers()['cache-control']).toContain('immutable');
  }
  const missing = await request.get('/workbench/assets/missing-deadbeef.js');
  expect(missing.status()).toBe(404);
  // 真正使 hash 入口失败，检查父页面收到原来的 boot-error + 文档代次。
  await page.route('**/workbench/assets/*.js', route => route.abort('failed'));
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    window.addEventListener('message', e => {
      if (e.source === iframe.contentWindow && e.data?.type === 'boot-error') window.__bundleBootError = e.data;
    });
    iframe.src = '/workbench/?page=example&embed=overlay&gen=12';
    document.body.append(iframe);
  });
  await expect.poll(() => page.evaluate(() => window.__bundleBootError)).toMatchObject({ source: 'pinpoint-workbench', type: 'boot-error', gen: 12 });
});
