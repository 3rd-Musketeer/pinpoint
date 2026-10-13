import fs from 'node:fs';

import { E2E_DATA_DIR, E2E_SITE_PORT } from './env.js';
import { killSiteOrphans } from './site-orphans.js';

// The registry fixture is written from the dedicated upstream webServer before Vite starts
// (e2e/registry-fixture.js) — the webServer reads it at boot, which happens
// before this globalSetup. Here we reset the annotation data root and stop an
// orphaned article site from an earlier run on this run's site port (the
// service has not started its own yet: it starts on the first article request).
export default async function globalSetup() {
  fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
  await killSiteOrphans(E2E_SITE_PORT);
}
