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
      { id: 'e2e-site', title: 'E2E Site', kind: 'url', url: E2E_BASE_URL },
      { id: 'e2e-proxy', title: 'E2E Proxy App', kind: 'url', url: E2E_UPSTREAM_ORIGIN },
      { id: 'e2e-dir', title: 'E2E Dir', kind: 'dir', path: path.join(E2E_SITES_DIR, 'dir-site') },
      { id: 'e2e-dir-ios', title: 'E2E Dir iOS', kind: 'dir', path: path.join(E2E_SITES_DIR, 'dir-site-ios'), board: 'ios' },
      // 阶段 5：mention 文档固件（doc 壳，正文里 mention library 的两个活 frame）。
      { id: 'e2e-mention', title: 'E2E Mention Doc', kind: 'dir', path: path.join(E2E_SITES_DIR, 'mention-site') },
      // 阶段 6：混合板固件（board:'ios' 页级缺省壳；board.json 里 2 个 app 屏 +
      // 1 个 product doc 屏 + 1 个 draft doc 屏）—— 画布条目 + 两个文档条目。
      { id: 'e2e-mixed', title: 'E2E Mixed', kind: 'dir', path: path.join(E2E_SITES_DIR, 'mixed-site'), board: 'ios' },
    ],
  }, null, 2));
}

export function copySiteFixtures() {
  fs.rmSync(E2E_SITES_DIR, {recursive:true, force:true});
  for (const name of ['dir-site', 'dir-site-ios', 'mention-site', 'mixed-site']) {
    fs.cpSync(path.join(ROOT, 'e2e', name), path.join(E2E_SITES_DIR, name), {recursive:true});
  }
}
