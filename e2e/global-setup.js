import fs from 'node:fs';

import { E2E_DATA_DIR } from './env.js';

// The registry fixture is written from the dedicated upstream webServer before Vite starts
// (e2e/registry-fixture.js) — the webServer reads it at boot, which happens
// before this globalSetup. Here we only reset the annotation data root.
export default function globalSetup() {
  fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
}
