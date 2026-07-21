import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { annotationSlug, createAnnotationStore } from '../lib/annotation-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'annotate.js');
const INLINED_LIBS = [
  path.join(ROOT, 'lib', 'annotation-indicator.js'),
  path.join(ROOT, 'lib', 'annotate-hit-test.js'),
  path.join(ROOT, 'lib', 'annotation-slug.js'),
];
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.html-annotate');

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

function broadcastAnnotations(doc) {
  const annotations = Array.isArray(doc.annotations) ? doc.annotations : [];
  const payload = JSON.stringify({
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

export function createAnnotateHandler(options = {}) {
  const dataDir = options.dataDir || process.env.HTML_ANNOTATE_DATA_DIR || DEFAULT_DATA_DIR;
  const store = options.store || createAnnotationStore({ dataDir });

  return async function handleAnnotate(req, res, urlPath) {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.statusCode = 204;
      res.end();
      return true;
    }

    if (req.method === 'GET' && urlPath === '/annotate.js') {
      sendBytes(res, 200, readAnnotateJs(), 'application/javascript');
      return true;
    }

    if (req.method === 'GET' && urlPath === '/health') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'GET' && urlPath === '/events') return handleSse(req, res);

    if (req.method === 'GET' && urlPath === '/annotations') {
      sendJson(res, 200, store.listDocs());
      return true;
    }

    if (req.method === 'GET' && urlPath.startsWith('/annotations/')) {
      const page = annotationSlug(decodeURIComponent(urlPath.slice('/annotations/'.length)));
      sendJson(res, 200, store.readDoc(page));
      return true;
    }

    if (req.method === 'GET' && urlPath.startsWith('/images/')) {
      const name = annotationSlug(decodeURIComponent(urlPath.slice('/images/'.length)));
      const file = store.imagePath(name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        sendBytes(res, 200, fs.readFileSync(file), mimeFor(name));
      } else {
        sendJson(res, 404, { error: 'not found' });
      }
      return true;
    }

    if (req.method !== 'POST' || (urlPath !== '/save' && urlPath !== '/image')) return false;

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_json' });
      return true;
    }

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
      broadcastAnnotations(result.doc);
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
