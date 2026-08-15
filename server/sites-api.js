/**
 * /sites/<entry-id>/ — read-only static serving of registry `dir` entries,
 * plus single-file serving of registry `file` entries.
 *
 * The registry is the whitelist: only registered entries are served. For a
 * `dir` entry every resolved path (textual and real, i.e. symlink-safe) must
 * stay inside the entry directory; for a `file` entry only the registered
 * file itself is served — under both `/sites/<id>/` and
 * `/sites/<id>/<basename>`, everything else 404s, so sibling files in the
 * same directory stay unreachable. Entries without their own board.json get a
 * synthesized doc board at `/sites/<id>/board.json` (see lib/synth-board.js),
 * so every registered site page opens readable in the workbench. HTML
 * responses (GET, without
 * ?annotate=off) get the annotate client injected — "登记过才注入": opening
 * the same content via file:// or a self-started server serves the identical
 * bytes with zero annotation surface. ?annotate=off opts a single request out
 * (export paths and the workbench's inline fragment loader use it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from './lib/registry.js';
import { synthesizeBoard } from './lib/synth-board.js';

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

/**
 * Resolve a registered single file (`file` entry) for the request path, or
 * null. Exactly two spellings reach the file: `/sites/<id>/` (empty rel) and
 * `/sites/<id>/<basename>`. The equality check is the whole guard — any
 * traversal or sibling name simply never matches. A symlinked registered
 * path is fine: the registry whitelists this exact file.
 */
function resolveRegisteredFile(entry, rel) {
  if (rel.includes('\0')) return null;
  if (rel !== '' && rel !== path.basename(entry.path)) return null;
  let real;
  try {
    real = fs.realpathSync(entry.path);
  } catch {
    return null; // registered file missing — 404, registry warning already logged it
  }
  return fs.statSync(real).isFile() ? real : null;
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
    if (!entry || (entry.kind !== 'dir' && entry.kind !== 'file')) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }

    const file = entry.kind === 'file'
      ? resolveRegisteredFile(entry, rel)
      : resolveFileWithin(path.resolve(entry.path), rel || 'index.html');

    // 磁盘没有 board.json 时合成 doc 阅读板（file 单屏；dir 顶层 *.html 一屏
    // 一版本）——磁盘文件永远优先，合成只在 resolve 落空后发生。合成的是
    // JSON 数据响应，不走 annotate 注入（注入只作用于 HTML 内容）。
    if (!file && rel === 'board.json') {
      const board = synthesizeBoard(entry);
      if (board) {
        const body = Buffer.from(JSON.stringify(board, null, 2) + '\n', 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(body.length));
        if (req.method === 'HEAD') {
          res.end();
          return true;
        }
        res.end(body);
        return true;
      }
    }

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
