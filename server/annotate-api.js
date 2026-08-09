import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bucketDir, dataRoot, DEFAULT_ENTRY } from './lib/annotate-data-dir.js';
import { annotationSlug, createAnnotationStore } from './lib/annotation-store.js';
import { loadRegistry } from './lib/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'client', 'annotate.js');
const INLINED_LIBS = [
  path.join(ROOT, 'lib', 'annotation-indicator.js'),
  path.join(ROOT, 'client', 'lib', 'annotate-hit-test.js'),
  path.join(ROOT, 'lib', 'annotation-slug.js'),
  path.join(ROOT, 'lib', 'annotate-page-key.js'),
  path.join(ROOT, 'lib', 'annotate-clip.js'),
  path.join(ROOT, 'lib', 'annotate-bubble.js'),
];

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();
let heartbeatTimer = null;

let cachedScript = null;
let cachedMtime = 0;
function readAnnotateJs() {
  const annotateStat = fs.statSync(SCRIPT);
  const mtimes = INLINED_LIBS.map((p) => fs.statSync(p).mtimeMs);
  const mtime = Math.max(annotateStat.mtimeMs, ...mtimes);
  if (cachedScript && mtime === cachedMtime) return cachedScript;
  const annotateSrc = fs.readFileSync(SCRIPT, 'utf8');
  // Inline SSOT libs into the IIFE so the browser script and the node-tested
  // libs share one implementation. Strip ESM `export ` keywords; these files
  // are pure functions + top-level consts.
  const libSrc = INLINED_LIBS.map((p) => fs.readFileSync(p, 'utf8').replace(/^export /gm, '')).join('\n');
  const marker = "'use strict';";
  const at = annotateSrc.indexOf(marker);
  const out = at < 0
    ? annotateSrc
    : annotateSrc.slice(0, at + marker.length) +
      '\n  /* inlined from lib/ — single source of truth */\n  ' +
      libSrc +
      annotateSrc.slice(at + marker.length);
  cachedScript = Buffer.from(out, 'utf8');
  cachedMtime = mtime;
  return cachedScript;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, body) {
  cors(res);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendBytes(res, code, data, contentType) {
  cors(res);
  res.statusCode = code;
  res.setHeader(
    'Content-Type',
    contentType.startsWith('text/') || contentType === 'application/json'
      ? `${contentType}; charset=utf-8`
      : contentType,
  );
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function mimeFor(name) {
  const extension = path.extname(name).toLowerCase();
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[extension] || 'image/png';
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const res of sseClients) {
      try {
        res.write(': ping\n\n');
      } catch {
        sseClients.delete(res);
      }
    }
    if (!sseClients.size && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }, 15000);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function broadcastAnnotations(doc, entryId) {
  const annotations = Array.isArray(doc.annotations) ? doc.annotations : [];
  const payload = JSON.stringify({
    entry: entryId,
    page: doc.page,
    revision: doc.revision,
    annotations,
    updated_at: doc.updated_at,
  });
  const chunk = `event: annotations\ndata: ${payload}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(chunk);
    } catch {
      sseClients.delete(res);
    }
  }
}

function handleSse(req, res) {
  cors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  ensureHeartbeat();
  req.on('close', () => sseClients.delete(res));
  return true;
}

// Resolve the entry a request targets. A missing entry means the default
// ('pinpoint', historical behavior); an explicit but unregistered entry is a
// loud 400 — misconfiguration must not silently land in the wrong bucket.
export function resolveRequestEntry(registry, raw) {
  const id = raw === undefined || raw === null || raw === '' ? DEFAULT_ENTRY : String(raw);
  return registry.resolve(id) ? { entry: id } : { entry: id, unknown: true };
}

export function createAnnotateHandler(options = {}) {
  const root = options.dataRoot || dataRoot();
  const registry = options.registry || loadRegistry({ root: ROOT });
  const stores = options.stores || new Map();

  function storeFor(entryId) {
    if (!stores.has(entryId)) {
      stores.set(entryId, createAnnotationStore({ dataDir: bucketDir(root, entryId) }));
    }
    return stores.get(entryId);
  }

  return async function handleAnnotate(req, res, urlPath) {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.statusCode = 204;
      res.end();
      return true;
    }

    // urlPath has the query stripped by the caller; req.url keeps it.
    const query = new URL(req.url || '/', 'http://annotate.local').searchParams;

    if (req.method === 'GET' && urlPath === '/annotate.js') {
      sendBytes(res, 200, readAnnotateJs(), 'application/javascript');
      return true;
    }

    if (req.method === 'GET' && urlPath === '/health') {
      // dataDir stays the default bucket path so existing `jq -r .dataDir`
      // consumers keep working; dataRoot + registry carry the new model.
      sendJson(res, 200, {
        ok: true,
        dataDir: bucketDir(root, DEFAULT_ENTRY),
        dataRoot: root,
        registry: {
          ok: registry.ok,
          path: registry.path,
          entries: registry.entries.length,
          errors: registry.errors,
          warnings: registry.warnings,
        },
      });
      return true;
    }

    if (req.method === 'GET' && urlPath === '/registry') {
      sendJson(res, 200, {
        ok: registry.ok,
        path: registry.path,
        entries: registry.entries,
        errors: registry.errors,
        warnings: registry.warnings,
      });
      return true;
    }

    if (req.method === 'GET' && urlPath === '/events') return handleSse(req, res);

    if (req.method === 'GET' && urlPath === '/annotations') {
      // Debug aggregate: flatten every bucket into [{entry, page, ...}].
      const docs = [];
      for (const entry of registry.entries) {
        for (const doc of Object.values(storeFor(entry.id).listDocs())) {
          docs.push({ entry: entry.id, ...doc });
        }
      }
      sendJson(res, 200, docs);
      return true;
    }

    if (req.method === 'GET' && urlPath.startsWith('/annotations/')) {
      const target = resolveRequestEntry(registry, query.get('entry'));
      if (target.unknown) {
        sendJson(res, 400, { error: 'unknown_entry', entry: target.entry });
        return true;
      }
      const page = annotationSlug(decodeURIComponent(urlPath.slice('/annotations/'.length)));
      sendJson(res, 200, storeFor(target.entry).readDoc(page));
      return true;
    }

    if (req.method === 'GET' && urlPath.startsWith('/images/')) {
      const target = resolveRequestEntry(registry, query.get('entry'));
      if (target.unknown) {
        sendJson(res, 400, { error: 'unknown_entry', entry: target.entry });
        return true;
      }
      const name = annotationSlug(decodeURIComponent(urlPath.slice('/images/'.length)));
      const file = storeFor(target.entry).imagePath(name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        sendBytes(res, 200, fs.readFileSync(file), mimeFor(name));
      } else {
        sendJson(res, 404, { error: 'not found' });
      }
      return true;
    }

    if (req.method !== 'POST' || !['/save', '/image'].includes(urlPath)) return false;

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_json' });
      return true;
    }

    const target = resolveRequestEntry(registry, body.entry);
    if (target.unknown) {
      sendJson(res, 400, { error: 'unknown_entry', entry: target.entry });
      return true;
    }
    const store = storeFor(target.entry);

    if (urlPath === '/save') {
      const result = store.save({
        page: body.page,
        path: body.path,
        updated_at: body.updated_at,
        baseRevision: body.baseRevision,
        annotations: Array.isArray(body.annotations) ? body.annotations : body.marks,
      });
      if (result.status !== 200) {
        sendJson(res, result.status, { error: result.error, ...result.doc });
        return true;
      }
      broadcastAnnotations(result.doc, target.entry);
      const count = (result.doc.annotations || []).length;
      sendJson(res, 200, {
        saved: store.jsonPathFor(result.doc.page),
        count,
        revision: result.doc.revision,
      });
      return true;
    }

    const data = String(body.data ?? '');
    const match = data.match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!match) {
      sendJson(res, 400, { error: 'bad dataURL' });
      return true;
    }
    const extension = ['jpeg', 'jpg', 'webp', 'gif'].includes(match[1]) ? match[1] : 'png';
    const image = store.writeImage(body.page ?? 'index', extension, Buffer.from(match[2], 'base64'));
    sendJson(res, 200, image);
    return true;
  };
}

export default function annotateApi(options = {}) {
  const handleAnnotate = createAnnotateHandler(options);
  return {
    name: 'annotate-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        if (await handleAnnotate(req, res, urlPath)) return;
        next();
      });
    },
  };
}
