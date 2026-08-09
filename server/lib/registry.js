/**
 * Content registry: which entries may be reviewed through the annotate API.
 * Lives at ~/.html-annotate/registry.json (HTML_ANNOTATE_REGISTRY overrides;
 * e2e points it at a fixture). A missing file means a default pinpoint-only
 * registry. Malformed JSON or invalid entries must never crash the server —
 * log, fall back / skip, and expose the failure on the result (/health reads
 * it back out).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const KINDS = new Set(['dir', 'url']);

export function defaultRegistryPath() {
  return path.join(os.homedir(), '.html-annotate', 'registry.json');
}

export function defaultEntries(root) {
  return [{ id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: root }];
}

function validateEntry(raw, seen) {
  if (!raw || typeof raw !== 'object') return 'entry is not an object';
  if (typeof raw.id !== 'string' || !ENTRY_ID_PATTERN.test(raw.id)) {
    return `entry id must match ${ENTRY_ID_PATTERN}: ${JSON.stringify(raw.id)}`;
  }
  if (seen.has(raw.id)) return `duplicate entry id "${raw.id}"`;
  if (!KINDS.has(raw.kind)) return `entry "${raw.id}" kind must be "dir" or "url"`;
  if (raw.kind === 'dir' && typeof raw.path !== 'string') {
    return `entry "${raw.id}" kind "dir" requires a path`;
  }
  if (raw.kind === 'url' && typeof raw.url !== 'string') {
    return `entry "${raw.id}" kind "url" requires a url`;
  }
  return null;
}

function normalizeEntry(raw) {
  const entry = {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : raw.id,
    kind: raw.kind,
  };
  if (raw.kind === 'dir') entry.path = raw.path;
  else entry.url = raw.url;
  if (typeof raw.board === 'string') entry.board = raw.board;
  return entry;
}

export function loadRegistry(options = {}) {
  const root = options.root || process.cwd();
  const registryPath = options.path || process.env.HTML_ANNOTATE_REGISTRY || defaultRegistryPath();
  const log = options.log || ((message) => console.error(message));
  const errors = [];
  const warnings = [];

  function finish(entries) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return {
      ok: errors.length === 0,
      path: registryPath,
      entries,
      errors,
      warnings,
      resolve: (id) => byId.get(id) || null,
    };
  }

  function fallback(message) {
    errors.push(message);
    log(`[registry] ${message} — falling back to default entries`);
    return finish(defaultEntries(root));
  }

  if (!fs.existsSync(registryPath)) return finish(defaultEntries(root));

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    return fallback(`registry is not valid JSON: ${error.message}`);
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    return fallback('registry must be {"version":1,"entries":[...]}');
  }

  const seen = new Set();
  const entries = [];
  for (const raw of parsed.entries) {
    const problem = validateEntry(raw, seen);
    if (problem) {
      errors.push(problem);
      log(`[registry] skipping entry: ${problem}`);
      continue;
    }
    seen.add(raw.id);
    const entry = normalizeEntry(raw);
    if (entry.kind === 'dir' && !fs.existsSync(entry.path)) {
      // dir entries are only served in a later work package; keep the entry.
      warnings.push(`entry "${entry.id}" path does not exist: ${entry.path}`);
      log(`[registry] warning: ${warnings[warnings.length - 1]}`);
    }
    entries.push(entry);
  }
  return finish(entries);
}
