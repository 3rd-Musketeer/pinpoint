import { E2E_SITE_PORT } from './env.js';
import { killSiteOrphans } from './site-orphans.js';

// The service stops its article site on SIGTERM (stopOnSignals in
// src/server/lib/site-dev-server.js). If the site lost its service anyway
// (service crashed or was SIGKILLed mid-run), stop it here instead of leaving it
// for the next run.
export default async function globalTeardown() {
  await killSiteOrphans(E2E_SITE_PORT);
}
