import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from './env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default function globalSetup() {
  fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
  // Registry fixture: the pinpoint dir entry plus one url entry naming the
  // e2e webServer origin (extension.spec.js injects through it). E2E never
  // reads the real machine registry (HTML_ANNOTATE_REGISTRY is set in
  // playwright.config.js).
  fs.writeFileSync(E2E_REGISTRY, JSON.stringify({
    version: 1,
    entries: [
      { id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: ROOT },
      { id: 'e2e-site', title: 'E2E Site', kind: 'url', url: E2E_BASE_URL },
    ],
  }, null, 2));
}
