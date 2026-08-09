import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_DATA_DIR, E2E_REGISTRY } from './env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default function globalSetup() {
  fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
  // Registry fixture: only the pinpoint entry, so e2e never reads the real
  // machine registry (HTML_ANNOTATE_REGISTRY is set in playwright.config.js).
  fs.writeFileSync(E2E_REGISTRY, JSON.stringify({
    version: 1,
    entries: [{ id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: ROOT }],
  }, null, 2));
}
