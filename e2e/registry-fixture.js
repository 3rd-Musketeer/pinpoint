import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_BASE_URL, E2E_REGISTRY, E2E_SITES_DIR, E2E_UPSTREAM_ORIGIN } from './env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Registry fixture: the pinpoint dir entry, one url entry naming the e2e
// webServer origin (extension.spec.js injects through it), one url entry
// naming the proxy upstream fixture (e2e/proxy-upstream.js — url-entry.spec.js
// drives it through /sites/e2e-proxy/), and two dir
// entries backed by committed fixtures (dir-entry.spec.js):
//  - e2e-dir: no `board` field — dir entries default to the doc shell
//    (2026-08-16 阶段 2; its board.json keeps a legacy shell:"web" screen
//    to prove stale data lands on doc);
//  - e2e-dir-ios: board "ios" — covers the annotate=off fragment inline path.
// E2E never reads the real machine registry (PINPOINT_REGISTRY is set
// in playwright.config.js).
//
// Written by start-proxy.mjs before the workbench boots. Playwright webServer starts before
// globalSetup runs, and the annotate handler reads the registry once at boot —
// a globalSetup write would land too late (and a clean machine would boot with
// the default pinpoint-only registry).
export function writeRegistryFixture() {
  fs.mkdirSync(path.dirname(E2E_REGISTRY), { recursive: true });
  fs.writeFileSync(E2E_REGISTRY, JSON.stringify({
    version: 1,
    entries: [
      { id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: ROOT },
      // pp2 切片 3：library 模板页退役后的替代固件，也是 e2e 的默认页（第一条 site
      // 行 = 启动落点；url 代理页不能当默认页 —— 它会把 workbench 自己嵌进 iframe）。
      { id: 'e2e-ios', title: 'E2E iOS', kind: 'dir', path: path.join(E2E_SITES_DIR, 'ios-site'), board: 'ios' },
      { id: 'e2e-site', title: 'E2E Site', kind: 'url', url: E2E_BASE_URL },
      { id: 'e2e-proxy', title: 'E2E Proxy App', kind: 'url', url: E2E_UPSTREAM_ORIGIN },
      { id: 'e2e-dir', title: 'E2E Dir', kind: 'dir', path: path.join(E2E_SITES_DIR, 'dir-site') },
      { id: 'e2e-dir-ios', title: 'E2E Dir iOS', kind: 'dir', path: path.join(E2E_SITES_DIR, 'dir-site-ios'), board: 'ios' },
      // 阶段 5：mention 文档固件（doc 壳，正文里 mention library 的两个活 frame）。
      { id: 'e2e-mention', title: 'E2E Mention Doc', kind: 'dir', path: path.join(E2E_SITES_DIR, 'mention-site') },
      // 阶段 6：混合板固件（board:'ios' 页级缺省壳；board.json 里 2 个 app 屏 +
      // 1 个 product doc 屏 + 1 个 draft doc 屏）—— 画布条目 + 两个文档条目。
      { id: 'e2e-mixed', title: 'E2E Mixed', kind: 'dir', path: path.join(E2E_SITES_DIR, 'mixed-site'), board: 'ios' },
      // doc-library 的替代固件：单 doc 屏页（「内容」区坍缩断言依赖单屏形态）。
      { id: 'e2e-doc', title: 'E2E Doc', kind: 'dir', path: path.join(E2E_SITES_DIR, 'doc-site') },
      // pp2 切片 1 的 .jsx 帧固件（e2e/jsx-site/）不在共享固件里常驻 —— 多一条页会
      // 撞翻一批断言整份 Pages 清单的 spec；pp2-build.spec.js 自己登记自己清理。
    ],
  }, null, 2));
}

export function copySiteFixtures() {
  fs.rmSync(E2E_SITES_DIR, {recursive:true, force:true});
  for (const name of ['dir-site', 'dir-site-ios', 'mention-site', 'mixed-site', 'jsx-site', 'ios-site', 'doc-site', 'anchor-site', 'canvas-site']) {
    fs.cpSync(path.join(ROOT, 'e2e', name), path.join(E2E_SITES_DIR, name), {recursive:true});
  }
}

// 临时登记条目：pp-id-anchor / preview-hmr / pp2-build 三个 spec 各自往 registry
// 追加一条 dir 条目、用完恢复 —— 多一条页会撞翻断言整份 Pages 清单的 spec
// （workbench.spec.js 两处 toHaveText([...]) 与 sidebar-content.spec.js 的
// toHaveCount(9)），所以不进上面的共享固件。三个 spec 的登记 / 恢复共用这一对。
export function appendRegistryEntry(entry) {
  const doc = JSON.parse(fs.readFileSync(E2E_REGISTRY, 'utf8'));
  doc.entries.push(entry);
  fs.writeFileSync(E2E_REGISTRY, JSON.stringify(doc, null, 2));
}

// 恢复共享固件并让服务重读（afterEach 用；条目类写必须 reload 才生效）。
export async function restoreRegistryFixture(request) {
  writeRegistryFixture();
  await request.post('/registry/reload');
}
