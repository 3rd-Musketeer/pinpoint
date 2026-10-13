/**
 * The site's one door to "which projects are registered" (common.md §3).
 *
 * The registry path is resolved the way the pinpoint service does it:
 * PINPOINT_REGISTRY, else ~/.pinpoint/registry.json. Reading goes through the
 * same `loadRegistry` + `listProjects` (src/server/lib/projects.js) that the
 * service and the CLI use, so titles, summaries, concept name / slug / status /
 * boundary and the layout errors are identical everywhere. Nothing else in the
 * site imports registry or project code.
 */
import { fileURLToPath } from 'node:url';
import { defaultRegistryPath, loadRegistry } from '../../../src/server/lib/registry.js';
import { listProjects } from '../../../src/server/lib/projects.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function registryPath(env = process.env) {
  return env.PINPOINT_REGISTRY || defaultRegistryPath();
}

/**
 * → { registryPath, projects, errors }. `errors` carries the registry's own
 * errors plus each project's layout errors from listProjects; the site adds
 * its namespace check on top (loaders).
 */
export async function loadProjects(env = process.env) {
  const file = registryPath(env);
  const registry = loadRegistry({ path: file, root: REPO_ROOT, log: () => {} });
  const projects = listProjects(registry);
  const errors = [];
  for (const p of projects) for (const e of p.errors || []) errors.push(`project "${p.id}": ${e}`);
  return { registryPath: file, projects, errors };
}
