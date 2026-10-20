import assert from 'node:assert/strict';

export const workbenchMode = process.env.PINPOINT_WORKBENCH_MODE || 'dev';

// 从服务实际返回的壳页找入口，不能用 /src/ 的旧路径假装已经注入了 bundle 故障。
export function workbenchEntryPath(html, { mode = workbenchMode, part = 'main' } = {}) {
  const scripts = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g)]
    .map(match => new URL(match[1], 'http://localhost').pathname);
  if (mode === 'bundle') {
    const entries = scripts.filter(src => /^\/workbench\/assets\/[^/]+\.js$/.test(src));
    assert.equal(entries.length, 1, '打包壳页必须有且只有一个真实工作台入口');
    return entries[0];
  }
  const entry = part === 'stage' ? '/src/workbench/stage.js' : '/src/workbench/app/main.jsx';
  assert.ok(scripts.includes(entry), `开发壳页缺少入口 ${entry}`);
  return entry;
}

export async function interceptWorkbenchEntry(page, part, handler) {
  const response = await page.request.get('/workbench/');
  assert.ok(response.ok(), '先读取真实工作台壳页');
  const path = workbenchEntryPath(await response.text(), { part });
  const matches = url => url.pathname === path;
  let count = 0;
  await page.route(matches, route => { count++; return handler(route); });
  return { path, hits: () => count, unroute: () => page.unroute(matches) };
}
