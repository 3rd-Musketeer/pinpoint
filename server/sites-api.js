/**
 * /sites/<entry-id>/ — read-only static serving of registry `dir` entries.
 *
 * The registry is the whitelist: only registered dir entries are served, and
 * every resolved path (textual and real, i.e. symlink-safe) must stay inside
 * the entry directory. HTML responses (GET, without ?annotate=off) get the
 * annotate client injected — "登记过才注入": opening the same directory via
 * file:// or a self-started server serves the identical bytes with zero
 * annotation surface. ?annotate=off opts a single request out (export paths
 * and the workbench's inline fragment loader use it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from './lib/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

function mimeFor(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

function contentType(name) {
  const mime = mimeFor(name);
  return /^(text\/|application\/(json|javascript)|image\/svg)/.test(mime)
    ? `${mime}; charset=utf-8`
    : mime;
}

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** The injection contract: one inline entry marker + the client bundle tag. */
export function annotateSnippet(entryId) {
  return `<script>window.__pinpointEntry='${entryId}'</script><script src="/annotate.js"></script>`;
}

export function injectAnnotateClient(html, entryId) {
  const snippet = annotateSnippet(entryId);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}

/** Containment check: `p` is `base` itself or lives under it. */
function within(base, p) {
  return p === base || p.startsWith(base + path.sep);
}

/**
 * Resolve `rel` inside `base` to an existing regular file, or null.
 * `..` traversal is rejected textually; symlink escapes are rejected by
 * realpath containment. Directories fall through to their index.html.
 */
function resolveFileWithin(base, rel) {
  if (rel.includes('\0')) return null;
  const abs = path.resolve(base, rel);
  if (!within(base, abs)) return null;
  let realBase;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    return null; // entry dir missing — 404, registry warning already logged it
  }
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  if (!within(realBase, real)) return null;
  let stat = fs.statSync(real);
  if (stat.isDirectory()) {
    try {
      real = fs.realpathSync(path.join(real, 'index.html'));
    } catch {
      return null;
    }
    if (!within(realBase, real)) return null;
    stat = fs.statSync(real);
  }
  return stat.isFile() ? real : null;
}

export function createSitesHandler(options = {}) {
  const registry = options.registry || loadRegistry({ root: ROOT });

  return async function handleSites(req, res, urlPath) {
    if (!urlPath.startsWith('/sites/')) return false;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return true;
    }

    const rest = urlPath.slice('/sites/'.length);
    const slash = rest.indexOf('/');
    const rawId = slash < 0 ? rest : rest.slice(0, slash);
    const rawPath = slash < 0 ? '' : rest.slice(slash + 1);

    let id;
    let rel;
    try {
      id = decodeURIComponent(rawId);
      rel = decodeURIComponent(rawPath);
    } catch {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }

    const entry = id && registry.resolve(id);
    if (!entry || entry.kind !== 'dir') {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }

    const file = resolveFileWithin(path.resolve(entry.path), rel || 'index.html');
    if (!file) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }

    const query = new URL(req.url || '/', 'http://sites.local').searchParams;
    const isHtml = mimeFor(file) === 'text/html';
    let body = fs.readFileSync(file);
    if (isHtml && query.get('annotate') !== 'off') {
      body = Buffer.from(injectAnnotateClient(body.toString('utf8'), entry.id), 'utf8');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType(file));
    res.setHeader('Content-Length', String(body.length));
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(body);
    return true;
  };
}

export default function sitesApi(options = {}) {
  const handleSites = createSitesHandler(options);
  return {
    name: 'sites-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        if (await handleSites(req, res, urlPath)) return;
        next();
      });
    },
  };
}
