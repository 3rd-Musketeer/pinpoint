/**
 * The site's one door to the service's read side (common.md §3, common-m1.md §2):
 *
 *   loadProjects()                       → which projects are registered, read from disk
 *   articleCanvas(projectId, articleId)  → { pageId, sections: [{ id, title, letter, shell?, frames: [{ id, ref, missing? }] }], errors: [{ code, message, path?, line?, section?, frame? }] }
 *   articlePageId(projectId, articleId)  → `<project>_<article>`, the canvas page id (= annotation bucket)
 *
 * The registry path is resolved the way the pinpoint service does it:
 * PINPOINT_REGISTRY, else ~/.pinpoint/registry.json. Reading goes through the
 * same `loadRegistry` + `listProjects` (src/server/lib/projects.js) and
 * `articleCanvas` (src/server/lib/article-board.js) that the service and the
 * CLI use, so titles, summaries, concept name / slug / status / boundary, the
 * canvas and the layout errors are identical everywhere. Nothing else in the
 * site imports service code; pure rules (ids, refKey, section letters) come
 * from src/shared/.
 */
import { fileURLToPath } from 'node:url';
import { defaultRegistryPath, loadRegistry } from '../../../src/server/lib/registry.js';
import { listProjects } from '../../../src/server/lib/projects.js';
import { projectErrorLine } from './site-errors.js';

export { articleCanvas } from '../../../src/server/lib/article-board.js';
export { articlePageId } from '../../../src/shared/project-ids.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function registryPath(env = process.env) {
  return env.PINPOINT_REGISTRY || defaultRegistryPath();
}

/**
 * → { registryPath, projects, errors }. Each project carries its layout errors
 * from listProjects as objects (`p.errors`, src/shared/project-errors.js);
 * `errors` is the same list as printable lines (projectErrorLine).
 */
export async function loadProjects(env = process.env) {
  const file = registryPath(env);
  const registry = loadRegistry({ path: file, root: REPO_ROOT, log: () => {} });
  const projects = listProjects(registry);
  const errors = projects.flatMap((p) => p.errors.map((e) => projectErrorLine(p.id, e)));
  return { registryPath: file, projects, errors };
}
