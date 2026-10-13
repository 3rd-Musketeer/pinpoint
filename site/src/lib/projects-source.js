/**
 * The site's one door to "which projects are registered" (common.md §3).
 *
 * The registry path is resolved the way the pinpoint service does it:
 * PINPOINT_REGISTRY, else ~/.pinpoint/registry.json.
 *
 * Package M0-A owns `src/server/lib/projects.js` (`listProjects(registry)`).
 * When that module exists it is used together with the real `loadRegistry`;
 * until then a local stub with the same output shape reads the raw registry
 * JSON (the pre-A `loadRegistry` drops `kind: "project"` entries). Nothing
 * else in the site imports registry or project code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultRegistryPath } from '../../../src/server/lib/registry.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_PROJECTS = path.join(REPO_ROOT, 'src/server/lib/projects.js');

export function registryPath(env = process.env) {
  return env.PINPOINT_REGISTRY || defaultRegistryPath();
}

/** Minimal frontmatter reader for the stub: only flat `key: value` lines. */
function frontmatterValue(file, key) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const line = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(fm[1]);
  if (!line) return null;
  return line[1].replace(/^(["'])(.*)\1$/, '$2');
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch { return []; }
}

/** Stub of M0-A's listProjects, same output shape (common.md §3). */
export function listProjectsStub(registry) {
  const out = [];
  for (const entry of registry.entries || []) {
    if (!entry || entry.kind !== 'project' || typeof entry.path !== 'string') continue;
    const root = entry.path;
    const dir = path.join(root, 'docs', 'pinpoint');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); } catch { /* id falls back to the entry */ }
    const id = typeof meta.id === 'string' ? meta.id : entry.id;
    const articles = listDirs(path.join(dir, 'articles'))
      .map((a) => ({ id: a, dir: path.join(dir, 'articles', a), file: path.join(dir, 'articles', a, 'index.mdx') }))
      .filter((a) => fs.existsSync(a.file))
      .map((a) => ({ ...a, title: frontmatterValue(a.file, 'title') || a.id }));
    let conceptFiles = [];
    try { conceptFiles = fs.readdirSync(path.join(dir, 'concepts')).filter((f) => f.endsWith('.md')).sort(); } catch { /* none */ }
    const concepts = conceptFiles.map((f) => {
      const file = path.join(dir, 'concepts', f);
      return { name: frontmatterValue(file, 'name') || f.replace(/\.md$/, ''), file };
    });
    out.push({ id, title: typeof meta.title === 'string' ? meta.title : (entry.title || id), root, dir, articles, concepts });
  }
  return out;
}

async function realModules() {
  if (!fs.existsSync(REAL_PROJECTS)) return null;
  const [projects, registry] = await Promise.all([
    import(pathToFileURL(REAL_PROJECTS).href),
    import('../../../src/server/lib/registry.js'),
  ]);
  return { listProjects: projects.listProjects, loadRegistry: registry.loadRegistry };
}

/**
 * → { registryPath, projects, errors }. `errors` carries what listProjects
 * reported (A's validation) plus registry read failures; the site adds its
 * own namespace check on top (site-data / loaders).
 */
export async function loadProjects(env = process.env) {
  const file = registryPath(env);
  const errors = [];
  const real = await realModules();
  let result;
  if (real) {
    const registry = real.loadRegistry({ path: file, root: REPO_ROOT, log: () => {} });
    result = real.listProjects(registry);
  } else {
    let doc = { entries: [] };
    if (fs.existsSync(file)) {
      try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { errors.push(`registry is not valid JSON: ${e.message}`); }
    }
    result = listProjectsStub(doc);
  }
  // Tolerate either a bare array or { projects, errors } from A.
  const projects = Array.isArray(result) ? result : (result?.projects || []);
  if (!Array.isArray(result) && Array.isArray(result?.errors)) errors.push(...result.errors.map(String));
  for (const p of projects) if (Array.isArray(p.errors)) errors.push(...p.errors.map(String));
  return { registryPath: file, projects, errors, source: real ? 'projects.js' : 'stub' };
}
