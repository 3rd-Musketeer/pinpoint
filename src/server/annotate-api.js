import { collectPageTimes } from './lib/page-times.js';
import { collectOrphanCounts } from './lib/orphans.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bucketDir, dataRoot, DEFAULT_ENTRY } from './lib/annotate-data-dir.js';
import { parseReqUrl } from './lib/req-url.js';
import { ledgerKey, createAnnotationStore } from './lib/annotation-store.js';
import { manifestPageIds } from './lib/page-manifest.js';
import { loadRegistry } from './lib/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '..');
const SCRIPT = path.join(SRC, 'client', 'annotate.js');
// pp2 状态机端点：/annotations/<page>/<id|#n>/status
const STATUS_ROUTE = /^\/annotations\/([^/]+)\/([^/]+)\/status$/;
const INLINED_LIBS = [
  path.join(SRC, 'shared', 'annotation-indicator.js'),
  path.join(SRC, 'client', 'lib', 'annotate-hit-test.js'),
  path.join(SRC, 'shared', 'annotation-slug.js'),
  path.join(SRC, 'shared', 'annotate-page-key.js'),
  path.join(SRC, 'shared', 'annotate-clip.js'),
  path.join(SRC, 'workbench', 'lib', 'esc-html.js'),
  path.join(SRC, 'shared', 'annotate-bubble.js'),
  path.join(SRC, 'shared', 'ann-row.js'),
  path.join(SRC, 'shared', 'frame-anchor.js'),
  path.join(SRC, 'shared', 'ann-ppid.js'),
];
// Stylesheets injected into the bundle as JS string constants (the client must
// stay a single self-contained file — no runtime requests). annotate.js
// references the constant in its <style> block; index.html links the same CSS.
// Keep the mirror in src/server/annotate-inline.test.js in sync.
const INLINED_CSS = [
  { name: 'ANN_LIST_CSS', path: path.join(SRC, 'shared', 'ann-list.css') },
];

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();
let heartbeatTimer = null;

let cachedScript = null;
let cachedMtime = 0;
function readAnnotateJs() {
  const annotateStat = fs.statSync(SCRIPT);
  const mtimes = INLINED_LIBS.map((p) => fs.statSync(p).mtimeMs)
    .concat(INLINED_CSS.map((c) => fs.statSync(c.path).mtimeMs));
  const mtime = Math.max(annotateStat.mtimeMs, ...mtimes);
  if (cachedScript && mtime === cachedMtime) return cachedScript;
  const annotateSrc = fs.readFileSync(SCRIPT, 'utf8');
  // Inline SSOT libs into the IIFE so the browser script and the node-tested
  // libs share one implementation. Strip ESM `export ` keywords and `import`
  // lines（被引的库也在名单里、先于引用方内联，作用域共享）；这些文件是纯
  // 函数 + 顶层常量。Stylesheets land as JS string constants (JSON-quoted),
  // referenced by the client's <style> block.
  const libSrc = INLINED_LIBS.map((p) => fs.readFileSync(p, 'utf8').replace(/^import[^\n]*$\n?/gm, '').replace(/^export /gm, '')).join('\n');
  const cssSrc = INLINED_CSS.map((c) => `var ${c.name} = ${JSON.stringify(fs.readFileSync(c.path, 'utf8'))};`).join('\n');
  const marker = "'use strict';";
  const at = annotateSrc.indexOf(marker);
  const out = at < 0
    ? annotateSrc
    : annotateSrc.slice(0, at + marker.length) +
      '\n  /* inlined from lib/ — single source of truth */\n  ' +
      libSrc + '\n' + cssSrc +
      annotateSrc.slice(at + marker.length);
  cachedScript = Buffer.from(out, 'utf8');
  cachedMtime = mtime;
  return cachedScript;
}

// Extension-injected clients call this API cross-origin (e.g. from
// https://my-todos.localhost to https://pinpoint.localhost). No credentials
// are involved, so a plain `*` preflight contract covers every route.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
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
// ('pinpoint', historical behavior); an explicit but unknown id is a loud 400 —
// misconfiguration must not silently land in the wrong bucket. 桶 = 页之后，
// 合法 id 不止 registry 条目：本地 manifest 页（content/previews/_index.json，
// 没有条目可以登记）的桶同样是页桶，经 localIds 放行。
export function resolveRequestEntry(registry, raw, localIds = []) {
  const id = raw === undefined || raw === null || raw === '' ? DEFAULT_ENTRY : String(raw);
  const known = id === DEFAULT_ENTRY || registry.resolve(id) != null || localIds.includes(id);
  return known ? { entry: id } : { entry: id, unknown: true };
}

export function createAnnotateHandler(options = {}) {
  const root = options.dataRoot || dataRoot();
  // The repo this service serves from (vite.config passes its own root).
  // Reported on /health so the CLI can catch a service running out of a stale
  // or foreign directory. Not to be confused with `root` above = data root.
  const serviceRoot = options.root || ROOT;
  const registry = options.registry || loadRegistry({ root: ROOT });
  const stores = options.stores || new Map();
  // Direct loopback origin the annotate API is actually bound to (bypassing
  // any TLS proxy such as portless). The browser extension injects the
  // annotate client from this origin because Chromium applies the default
  // extension CSP to content-script-injected scripts — a policy that
  // whitelists http://localhost:* / http://127.0.0.1:* but not remote https
  // origins. String or lazy resolver; null when the server is not listening.
  const directOrigin = options.directOrigin || (() => null);
  const resolveDirectOrigin = typeof directOrigin === 'function' ? directOrigin : () => directOrigin;
  // After a successful POST /registry/reload — the vite plugin wires this to
  // an HMR `registry:update` event so open workbenches refresh their Pages.
  const onRegistryReload = options.onRegistryReload || (() => {});

  function storeFor(entryId) {
    if (!stores.has(entryId)) {
      // 桶 = 页：桶 id 就是页 id，账本整体属于这个页 —— 不再对 pinpoint 特判
      // null（那层逐页映射 page_updated_at 已随桶 = 页退役，见 annotation-store）。
      stores.set(entryId, createAnnotationStore({ dataDir: bucketDir(root, entryId) }));
    }
    return stores.get(entryId);
  }

  // GET /registry 的完整载荷，也是三个文件夹写接口的应答（写完立刻把重载后的
  // 登记表整份还回去，调用方不必再打一次 GET）。
  function registryPayload() {
    const localIds = manifestPageIds(serviceRoot);
    const pageTimes = collectPageTimes({ entries: registry.entries, root: serviceRoot, dataRoot: root, localIds });
    // storage-unify：每页的孤儿账本数（表面已不存在的账本；页信息面板显示，
    // 清理只经 ppnt prune）。
    const orphanCounts = collectOrphanCounts({ entries: registry.entries, dataRoot: root, localIds, root: serviceRoot });
    for (const [id, count] of Object.entries(orphanCounts)) {
      if (pageTimes[id]) pageTimes[id].orphans = count;
    }
    return {
      pageTimes,
      ok: registry.ok,
      path: registry.path,
      // 2026-08-17g：dir/file 条目附内容 mtime（ms epoch；url 条目与缺失
      // 路径无此字段）—— workbench Pages 的「最近更新」排序与行内时间显示
      // 的唯一来源。语义 = 内容文件改动，与标注活动无关。
      entries: registry.entries.map((entry) => {
        return { ...entry, ...pageTimes[entry.id] };
      }),
      // 分组层（2026-09-04）：folders = owner 建的一层夹；pageFolders /
      // pageOrder 只装「不是 registry 条目」的 manifest 页（条目自己的归属
      // 与手动次序写在条目的 folder / order 字段上）。
      folders: registry.folders || [],
      pageFolders: registry.pageFolders || {},
      pageOrder: registry.pageOrder || {},
      errors: registry.errors,
      warnings: registry.warnings,
      service: { directOrigin: resolveDirectOrigin() },
    };
  }

  // /health 与 reload 应答里的 registry 摘要：这里的 entries / folders /
  // pageFolders 都是**数量**（完整清单走 GET /registry）。
  function registrySummary(snapshot) {
    return {
      ok: snapshot.ok,
      path: snapshot.path,
      entries: snapshot.entries.length,
      folders: (snapshot.folders || []).length,
      pageFolders: Object.keys(snapshot.pageFolders || {}).length,
      errors: snapshot.errors,
      warnings: snapshot.warnings,
    };
  }

  // 文件夹写接口认识的 id：registry 条目 + 本地 manifest 页（Component
  // Library 等模板页不在登记表里，但一样能拖进夹）。
  function knownPageIds() {
    return manifestPageIds(serviceRoot);
  }

  /**
   * PUT /registry/folders · /registry/entries/:id/folder · /registry/order。
   * 三条都是「校验 → 一次原子写 → reload → 广播 registry:update → 还回完整
   * /registry 载荷」。任何未知 id / 未知文件夹都是 400，登记表一个字节不动。
   */
  async function handleRegistryWrite(req, res, urlPath) {
    if (typeof registry.setFolders !== 'function') {
      sendJson(res, 409, { error: 'registry_not_writable' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_json' });
      return true;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'bad_request', message: '请求体必须是对象' });
      return true;
    }
    const attach = urlPath.match(/^\/registry\/entries\/([^/]+)\/folder$/);
    try {
      if (urlPath === '/registry/folders') {
        registry.setFolders(body.folders);
      } else if (urlPath === '/registry/order') {
        registry.setOrder(body.ids, { pageIds: knownPageIds() });
      } else if (attach) {
        const id = decodeURIComponent(attach[1]);
        registry.setEntryFolder(id, { folder: body.folder ?? null, order: body.order }, { pageIds: knownPageIds() });
      } else {
        return false;
      }
    } catch (error) {
      sendJson(res, 400, { error: 'bad_request', message: error.message });
      return true;
    }
    onRegistryReload(registrySummary(registry));
    sendJson(res, 200, registryPayload());
    return true;
  }

  // Shared entry gate: resolve the request's target entry or answer the loud
  // 400. Returns the entry id, or null after sending the rejection.
  function entryOrReject(res, raw) {
    const target = resolveRequestEntry(registry, raw, knownPageIds());
    if (target.unknown) {
      sendJson(res, 400, { error: 'unknown_entry', entry: target.entry });
      return null;
    }
    return target.entry;
  }

  return async function handleAnnotate(req, res, urlPath) {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.statusCode = 204;
      res.end();
      return true;
    }

    // urlPath has the query stripped by the caller; req.url keeps it.
    const query = parseReqUrl(req).query;

    if (req.method === 'GET' && urlPath === '/annotate.js') {
      sendBytes(res, 200, readAnnotateJs(), 'application/javascript');
      return true;
    }

    if (req.method === 'GET' && urlPath === '/health') {
      // dataDir stays the default bucket path so existing `jq -r .dataDir`
      // consumers keep working; dataRoot + registry carry the new model.
      sendJson(res, 200, {
        ok: true,
        // root = the repository this service is actually running out of.
        // `pinpoint status` compares it with the CLI's own repo root: a long
        // lived vite that survived a directory move keeps the absolute paths
        // it resolved at boot, so "process alive, wrong root" is a real and
        // otherwise invisible failure mode (docs/debugging.md, 2026-09-04).
        root: serviceRoot,
        dataDir: bucketDir(root, DEFAULT_ENTRY),
        dataRoot: root,
        registry: registrySummary(registry),
      });
      return true;
    }

    if (req.method === 'GET' && urlPath === '/registry') {
      sendJson(res, 200, registryPayload());
      return true;
    }

    // 分组层的写接口（workbench 的文件夹操作；CLI 仍是文件直写 + reload）。
    if (req.method === 'PUT' && urlPath.startsWith('/registry/')) {
      return handleRegistryWrite(req, res, urlPath);
    }

    if (req.method === 'GET' && urlPath === '/events') return handleSse(req, res);

    if (req.method === 'GET' && urlPath === '/annotations') {
      // Debug aggregate: flatten every bucket into [{entry, page, ...}]. 桶 = 页：
      // registry 条目 + manifest 模板页都是页桶，都在列。
      const docs = [];
      const seen = new Set();
      for (const id of [...registry.entries.map((entry) => entry.id), ...knownPageIds()]) {
        if (seen.has(id)) continue;
        seen.add(id);
        for (const doc of Object.values(storeFor(id).listDocs())) {
          docs.push({ entry: id, ...doc });
        }
      }
      sendJson(res, 200, docs);
      return true;
    }

    if (req.method === 'GET' && urlPath.startsWith('/annotations/')) {
      const entryId = entryOrReject(res, query.get('entry'));
      if (!entryId) return true;
      const page = ledgerKey(decodeURIComponent(urlPath.slice('/annotations/'.length)));
      sendJson(res, 200, storeFor(entryId).readDoc(page));
      return true;
    }

    if (req.method === 'GET' && urlPath.startsWith('/images/')) {
      const entryId = entryOrReject(res, query.get('entry'));
      if (!entryId) return true;
      const name = decodeURIComponent(urlPath.slice('/images/'.length));
      const file = storeFor(entryId).imagePath(name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        sendBytes(res, 200, fs.readFileSync(file), mimeFor(name));
      } else {
        sendJson(res, 404, { error: 'not found' });
      }
      return true;
    }

    if (req.method !== 'POST' || !(['/save', '/image', '/registry/reload'].includes(urlPath) || STATUS_ROUTE.test(urlPath))) return false;

    // pp2 状态机：ppnt mark 的后端 —— open / check → check / done（带 note）。
    if (req.method === 'POST' && STATUS_ROUTE.test(urlPath)) {
      const parts = urlPath.match(STATUS_ROUTE);
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'bad_json' });
        return true;
      }
      const entryId = entryOrReject(res, body.entry);
      if (!entryId) return true;
      const rawId = decodeURIComponent(parts[2]);
      const numeric = /^[1-9][0-9]*$/.test(rawId) ? Number(rawId) : rawId;
      const result = storeFor(entryId).setStatus({
        page: decodeURIComponent(parts[1]),
        id: numeric,
        status: body.status,
        note: typeof body.note === 'string' ? body.note : undefined,
        baseRevision: body.baseRevision,
      });
      if (result.status !== 200) {
        sendJson(res, result.status, { error: result.error, detail: result.detail, ...result.doc });
        return true;
      }
      broadcastAnnotations(result.doc, entryId);
      sendJson(res, 200, { revision: result.doc.revision, annotation: result.annotation });
      return true;
    }

    // Re-read the registry file and swap the shared in-memory snapshot, so a
    // `pinpoint add` takes effect for serving / injection / bucket routing
    // without a server restart. Only a live registry-store is reloadable; a
    // static snapshot (tests) answers 409.
    if (urlPath === '/registry/reload') {
      if (typeof registry.reload !== 'function') {
        sendJson(res, 409, { error: 'registry_not_reloadable' });
        return true;
      }
      const next = registry.reload();
      const summary = registrySummary(next);
      onRegistryReload(summary);
      sendJson(res, 200, summary);
      return true;
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_json' });
      return true;
    }

    const entryId = entryOrReject(res, body.entry);
    if (!entryId) return true;
    const store = storeFor(entryId);

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
      broadcastAnnotations(result.doc, entryId);
      const count = (result.doc.annotations || []).length;
      sendJson(res, 200, {
        saved: store.jsonPathFor(result.doc.page),
        count,
        revision: result.doc.revision,
        // M1：#n 由服务端发，应答把带号的行带回，客户端按 id 认领覆盖本地的
        // 临时号（nextN 只是显示占位）。
        annotations: result.doc.annotations,
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
  let httpServer = null;
  let viteServer = null;
  const directOrigin = options.directOrigin || (() => {
    const address = httpServer && typeof httpServer.address === 'function' ? httpServer.address() : null;
    if (!address || typeof address !== 'object') return null; // not listening yet
    const loopback = ['::', '0.0.0.0', '::1', 'localhost'].includes(address.address) ? '127.0.0.1' : address.address;
    return `http://${loopback}:${address.port}`;
  });
  const onRegistryReload = options.onRegistryReload || ((summary) => {
    // Tell open workbenches the registry changed; stage.js invalidates its
    // registry-sites query and re-pulls the page manifest off this event.
    if (viteServer) viteServer.ws.send({ type: 'custom', event: 'registry:update', data: summary });
  });
  const handleAnnotate = createAnnotateHandler({ ...options, directOrigin, onRegistryReload });
  return {
    name: 'annotate-api',
    configureServer(server) {
      httpServer = server.httpServer;
      viteServer = server;
      server.middlewares.use(async (req, res, next) => {
        const urlPath = parseReqUrl(req).pathname;
        if (await handleAnnotate(req, res, urlPath)) return;
        next();
      });
    },
  };
}
