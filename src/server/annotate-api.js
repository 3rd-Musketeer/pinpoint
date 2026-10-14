import { collectPageTimes } from './lib/page-times.js';
import { collectOrphanCounts } from './lib/orphans.js';
import { listArticleTargets, pageIdIsLive } from './lib/page-resolve.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bucketDir, bucketOnDisk, dataRoot, DEFAULT_ENTRY } from './lib/annotate-data-dir.js';
import { parseReqUrl } from './lib/req-url.js';
import { etagMatches } from './lib/etag.js';
import { BucketGoneError, ledgerKey, createAnnotationStore } from './lib/annotation-store.js';
import { manifestPageIds } from './lib/page-manifest.js';
import { loadRegistry } from './lib/registry.js';
import { listProjects } from './lib/projects.js';
import { formatProjectError } from '../shared/project-errors.js';
import { articlePageRows } from './lib/article-board.js';
import {
  ANNOTATE_BUNDLE_URL_RE,
  annotateBundleByHash,
  ensureAnnotateBundle,
} from './lib/annotate-bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '..');
// pp2 状态机端点：/annotations/<page>/<id|#n>/status
const STATUS_ROUTE = /^\/annotations\/([^/]+)\/([^/]+)\/status$/;
const REPLY_ROUTE = /^\/annotations\/([^/]+)\/([^/]+)\/reply$/;

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();
let heartbeatTimer = null;

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendBytes(res, code, data, contentType) {
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

// ---- /annotate.js · /annotate.<hash>.js（审计 B3）----------------------------
// 同一份构建产物两个地址：哈希地址 immutable 永久缓存（pinpoint 生成的注入点都
// 引用它）；老地址 ETag（内容哈希）+ no-cache + If-None-Match 304 —— 内容页里的
// 手写标签与跨域注入还走这里，每次刷新只付一次 revalidate。
// gzip / brotli 在构建期压好，按 Accept-Encoding 挑；HEAD 与 GET 走同一套头
// （HEAD 只回头），构建失败显式 500 带原因，绝不静默发旧版。

// 浏览器与 curl 的 Accept-Encoding 都不带 q 值，出现即支持；q=0 的怪请求落到
// identity 大文件，宁可浪费也不写一套 q 值解析。按逗号拆开精确匹配编码名
//（;q= 后缀剥掉）：子串匹配会把 xgzip 这类怪值误判成 gzip。
function pickAnnotateEncoding(acceptEncoding) {
  const offered = String(acceptEncoding || '')
    .toLowerCase()
    .split(',')
    .map((token) => token.split(';')[0].trim());
  if (offered.includes('br')) return 'br';
  if (offered.includes('gzip')) return 'gzip';
  return 'identity';
}

let lastLoggedBundleError = '';
function logBundleErrorOnce(error) {
  if (error.message === lastLoggedBundleError) return;
  lastLoggedBundleError = error.message;
  console.error('[annotate-bundle]', error.message);
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
// 没有条目可以登记）的桶同样是页桶，经 localIds 放行。pp3：一篇 article 的桶是
// 它的画布页 id `<project>_<article>`（src/shared/project-ids.js articlePageId，画布标注与正文评论
// 共用，common-m1.md §2），project 登记了、文章的 index.mdx 在盘上才算
// （page-resolve.js）；project id 本身不是桶。判定在 page-resolve.js 的 pageIdIsLive，
// prune 与孤儿报告用同一处。
// 页已不在、桶目录还在盘上（整桶孤儿：文章删了、条目撤了登记）也放行：孤儿照样能读、回复、
// 写状态，清理只经 prune（docs/annotation.md“孤儿”）。不新建这种桶，见 storeFor 的 mayCreateBucket。
export function resolveRequestEntry(registry, raw, localIds = [], { dataRoot: root = null } = {}) {
  const id = raw === undefined || raw === null || raw === '' ? DEFAULT_ENTRY : String(raw);
  const known = id === DEFAULT_ENTRY || pageIdIsLive(registry, id, { manifestIds: localIds })
    || (root !== null && bucketOnDisk(root, id));
  return known ? { entry: id } : { entry: id, unknown: true };
}


export function createAnnotateHandler(options = {}) {
  const root = options.dataRoot || dataRoot();
  // 构建产物的取用口。测试注入口（与 registry/stores 同一模式）；缺省走真构建。
  const ensureBundle = options.ensureAnnotateBundle || ensureAnnotateBundle;
  const bundleByHash = options.annotateBundleByHash || annotateBundleByHash;
  // The repo this service serves from (vite.config passes its own root).
  // Reported on /health so the CLI can catch a service running out of a stale
  // or foreign directory. Not to be confused with `root` above = data root.
  const serviceRoot = options.root || ROOT;
  const registry = options.registry || loadRegistry({ root: ROOT });
  const stores = options.stores || new Map();
  // After POST /registry/reload — the vite plugin wires this to an HMR
  // `registry:update` event so open workbenches refresh their Pages.
  const onRegistryReload = options.onRegistryReload || (() => {});
  // pp3：文章站点开发服务器的状态（article-proxy 的 devServer.snapshot），
  // /health 带出去给 `pinpoint status`；没接站点时不出这个字段。
  const siteStatus = options.siteStatus || null;

  function storeFor(entryId) {
    if (!stores.has(entryId)) {
      // 桶 = 页：桶 id 就是页 id，账本整体属于这个页。桶目录不在时只给 live 的页新建：
      // 整桶孤儿在盘上照样能写，被 prune 删掉以后迟到的写不把它重建出来（503 bucket_gone）。
      stores.set(entryId, createAnnotationStore({
        dataDir: bucketDir(root, entryId),
        mayCreateBucket: () => entryId === DEFAULT_ENTRY || pageIdIsLive(registry, entryId, { manifestIds: knownPageIds() }),
      }));
    }
    return stores.get(entryId);
  }

  // GET /registry 的完整载荷。
  function registryPayload() {
    const localIds = manifestPageIds(serviceRoot);
    const pageTimes = collectPageTimes({ entries: registry.entries, root: serviceRoot, dataRoot: root, localIds });
    // storage-unify：每页的孤儿账本数（表面已不存在的账本；页信息面板显示，
    // 清理只经 ppnt prune）。
    const articles = articlePageRows(registry);
    const orphanCounts = collectOrphanCounts({
      entries: registry.entries, dataRoot: root, localIds, root: serviceRoot, articleTargets: listArticleTargets(registry),
    });
    for (const [id, count] of Object.entries(orphanCounts)) {
      if (pageTimes[id]) pageTimes[id].orphans = count;
    }
    // 文章画布页不在 pageTimes 里：有孤儿时把行数挂在 articles 那一行上。
    for (const row of articles) if (orphanCounts[row.id]) row.orphans = orphanCounts[row.id];
    return {
      pageTimes,
      ok: registry.ok,
      path: registry.path,
      // 2026-08-17g：dir/file 条目附内容 mtime（ms epoch；缺失路径无此
      // 字段）—— workbench Pages 的「最近更新」排序与行内时间显示
      // 的唯一来源。语义 = 内容文件改动，与标注活动无关。
      entries: registry.entries.map((entry) => {
        return { ...entry, ...pageTimes[entry.id] };
      }),
      // pp3：文章画布页。工作台只用它认 `?page=<id>`，不列进左栏 Pages。
      articles,
      errors: registry.errors,
      warnings: registry.warnings,
    };
  }

  // /health 与 reload 应答里的 registry 摘要：entries / projects 都是**数量**
  // （完整清单走 GET /registry）。
  function registrySummary(snapshot) {
    return {
      ok: snapshot.ok,
      path: snapshot.path,
      entries: snapshot.entries.length,
      // kind "project" 的条目（pp3）不在 entries 里，单独计数。
      projects: (snapshot.projects || []).length,
      errors: snapshot.errors,
      warnings: snapshot.warnings,
    };
  }

  function projectHealth(snapshot) {
    const projects = listProjects(snapshot);
    return {
      count: projects.length,
      errors: projects.flatMap((project) => project.errors.map((problem) => `${project.id}: ${formatProjectError(problem)}`)),
    };
  }

  // 本地 manifest 页 id（模板页不在登记表里，但也是页桶）。
  function knownPageIds() {
    return manifestPageIds(serviceRoot);
  }


  // Shared entry gate: resolve the request's target entry or answer the loud
  // 400. Returns the entry id, or null after sending the rejection.
  function entryOrReject(res, raw) {
    const target = resolveRequestEntry(registry, raw, knownPageIds(), { dataRoot: root });
    if (target.unknown) {
      sendJson(res, 400, { error: 'unknown_entry', entry: target.entry });
      return null;
    }
    return target.entry;
  }

  async function serveAnnotateClient(req, res, urlPath) {
    res.setHeader('Vary', 'Accept-Encoding');
    let artifact = null;
    const hashMatch = urlPath !== '/annotate.js' ? urlPath.match(ANNOTATE_BUNDLE_URL_RE) : null;
    if (hashMatch) {
      artifact = bundleByHash(hashMatch[1]);
      if (!artifact) {
        // 进程重启会清掉内存里的历史产物；同内容构建出的哈希不变，重编一次
        // 就能对上缓存页带来的地址。还对不上就是真不认识的哈希，404。
        try {
          const fresh = await ensureBundle();
          if (fresh.hash === hashMatch[1]) artifact = fresh;
        } catch (error) {
          logBundleErrorOnce(error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(error.message);
          return;
        }
      }
      if (!artifact) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(`unknown annotate bundle: ${urlPath}`);
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      try {
        artifact = await ensureBundle();
      } catch (error) {
        logBundleErrorOnce(error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(error.message);
        return;
      }
      const etag = `"${artifact.hash}"`;
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('ETag', etag);
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.statusCode = 304;
        res.end();
        return;
      }
    }
    const encoding = pickAnnotateEncoding(req.headers['accept-encoding']);
    const body = encoding === 'br' ? artifact.br
      : encoding === 'gzip' ? artifact.gzip
      : Buffer.from(artifact.js, 'utf8');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Length', String(body.length));
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  // POST 体是 JSON 且带 entry：解析失败 400，entry 未知 400，都在这里答掉。
  async function readEntryBody(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_json' });
      return null;
    }
    const entryId = entryOrReject(res, body.entry);
    return entryId ? { body, entryId } : null;
  }

  // 路由表按声明顺序匹配，第一条命中即答；全不命中返回 false 交给下一个中间件。
  // match 是 [方法, 路径]：路径可为字符串（全等）、RegExp 或前缀函数。
  const GET_HEAD = ['GET', 'HEAD'];
  const routes = [
    {
      methods: GET_HEAD,
      match: (urlPath) => urlPath === '/annotate.js' || ANNOTATE_BUNDLE_URL_RE.test(urlPath),
      run: async ({ req, res, urlPath }) => { await serveAnnotateClient(req, res, urlPath); return true; },
    },
    {
      methods: ['GET'],
      match: '/health',
      run: ({ res }) => {
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
          // project 的布局错误（缺 project.json、撞名…）：`pinpoint status` 读这里。
          projects: projectHealth(registry),
          ...(siteStatus ? { site: siteStatus() } : {}),
        });
        return true;
      },
    },
    {
      methods: ['GET'],
      match: '/registry',
      run: ({ res }) => { sendJson(res, 200, registryPayload()); return true; },
    },
    {
      methods: ['GET'],
      match: '/events',
      run: ({ req, res }) => handleSse(req, res),
    },
    {
      methods: ['GET'],
      match: '/annotations',
      run: ({ res }) => {
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
      },
    },
    {
      methods: ['GET'],
      match: (urlPath) => urlPath.startsWith('/annotations/'),
      run: ({ res, urlPath, query }) => {
        const entryId = entryOrReject(res, query.get('entry'));
        if (!entryId) return true;
        const page = ledgerKey(decodeURIComponent(urlPath.slice('/annotations/'.length)));
        sendJson(res, 200, storeFor(entryId).readDoc(page));
        return true;
      },
    },
    {
      methods: ['GET'],
      match: (urlPath) => urlPath.startsWith('/images/'),
      run: ({ res, urlPath, query }) => {
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
      },
    },
    // pp2 状态机：ppnt mark 的后端 —— open / check → check / done。
    {
      methods: ['POST'],
      match: STATUS_ROUTE,
      run: async ({ req, res, urlPath }) => {
        const parts = urlPath.match(STATUS_ROUTE);
        const parsed = await readEntryBody(req, res);
        if (!parsed) return true;
        const { body, entryId } = parsed;
        const rawId = decodeURIComponent(parts[2]);
        const numeric = /^[1-9][0-9]*$/.test(rawId) ? Number(rawId) : rawId;
        const result = storeFor(entryId).setStatus({
          page: decodeURIComponent(parts[1]),
          id: numeric,
          status: body.status,
          baseRevision: body.baseRevision,
        });
        if (result.status !== 200) {
          sendJson(res, result.status, { error: result.error, detail: result.detail, ...result.doc });
          return true;
        }
        broadcastAnnotations(result.doc, entryId);
        sendJson(res, 200, { revision: result.doc.revision, annotation: result.annotation });
        return true;
      },
    },
    // ppnt reply 的后端 —— 往任何一条标注的线程追加一条 agent 消息，状态不动。
    {
      methods: ['POST'],
      match: REPLY_ROUTE,
      run: async ({ req, res, urlPath }) => {
        const parts = urlPath.match(REPLY_ROUTE);
        const parsed = await readEntryBody(req, res);
        if (!parsed) return true;
        const { body, entryId } = parsed;
        const rawId = decodeURIComponent(parts[2]);
        const result = storeFor(entryId).appendMessage({
          page: decodeURIComponent(parts[1]),
          id: /^[1-9][0-9]*$/.test(rawId) ? Number(rawId) : rawId,
          text: body.text,
          baseRevision: body.baseRevision,
        });
        if (result.status !== 200) {
          sendJson(res, result.status, { error: result.error, detail: result.detail, ...result.doc });
          return true;
        }
        broadcastAnnotations(result.doc, entryId);
        sendJson(res, 200, { revision: result.doc.revision, annotation: result.annotation, message: result.message });
        return true;
      },
    },
    // Re-read the registry file and swap the shared in-memory snapshot, so a
    // `pinpoint add` takes effect for serving / injection / bucket routing
    // without a server restart. Only a live registry-store is reloadable; a
    // static snapshot (tests) answers 409.
    {
      methods: ['POST'],
      match: '/registry/reload',
      run: ({ res }) => {
        if (typeof registry.reload !== 'function') {
          sendJson(res, 409, { error: 'registry_not_reloadable' });
          return true;
        }
        const next = registry.reload();
        const summary = registrySummary(next);
        onRegistryReload(summary);
        sendJson(res, 200, summary);
        return true;
      },
    },
    {
      methods: ['POST'],
      match: '/save',
      run: async ({ req, res }) => {
        const parsed = await readEntryBody(req, res);
        if (!parsed) return true;
        const { body, entryId } = parsed;
        const store = storeFor(entryId);
        const result = store.save({
          page: body.page,
          path: body.path,
          updated_at: body.updated_at,
          baseRevision: body.baseRevision,
          saveId: body.saveId,
          after: body.after,
          annotations: Array.isArray(body.annotations) ? body.annotations : body.marks,
        });
        if (result.status !== 200) {
          sendJson(res, result.status, { error: result.error, detail: result.detail, ...result.doc });
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
      },
    },
    {
      methods: ['POST'],
      match: '/image',
      run: async ({ req, res }) => {
        const parsed = await readEntryBody(req, res);
        if (!parsed) return true;
        const { body, entryId } = parsed;
        const data = String(body.data ?? '');
        const match = data.match(/^data:image\/(\w+);base64,(.+)$/s);
        if (!match) {
          sendJson(res, 400, { error: 'bad dataURL' });
          return true;
        }
        const extension = ['jpeg', 'jpg', 'webp', 'gif'].includes(match[1]) ? match[1] : 'png';
        let image;
        try {
          image = storeFor(entryId).writeImage(body.page ?? 'index', extension, Buffer.from(match[2], 'base64'));
        } catch (error) {
          if (!(error instanceof BucketGoneError)) throw error;
          sendJson(res, 503, { error: error.code, detail: error.message });
          return true;
        }
        sendJson(res, 200, image);
        return true;
      },
    },
  ];

  function pathMatches(match, urlPath) {
    if (typeof match === 'string') return urlPath === match;
    if (match instanceof RegExp) return match.test(urlPath);
    return match(urlPath);
  }

  return async function handleAnnotate(req, res, urlPath) {
    // urlPath has the query stripped by the caller; req.url keeps it.
    const query = parseReqUrl(req).query;
    const route = routes.find((r) => r.methods.includes(req.method) && pathMatches(r.match, urlPath));
    if (!route) return false;
    // 路由里抛出的错（比如写账本时桶目录正被删掉，rename 报 ENOENT）只让这一个请求 500，
    // 不能变成 unhandled rejection 把整个服务带走。
    try {
      return await route.run({ req, res, urlPath, query });
    } catch (error) {
      console.error(`[annotate-api] ${req.method} ${urlPath} failed:`, error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error', detail: String((error && error.message) || error) });
      else res.end();
      return true;
    }
  };
}

export default function annotateApi(options = {}) {
  let httpServer = null;
  let viteServer = null;
  const onRegistryReload = options.onRegistryReload || ((summary) => {
    // Tell open workbenches the registry changed; stage.js invalidates its
    // registry-sites query and re-pulls the page manifest off this event.
    if (viteServer) viteServer.ws.send({ type: 'custom', event: 'registry:update', data: summary });
  });
  const handleAnnotate = createAnnotateHandler({ ...options, onRegistryReload });
  return {
    name: 'annotate-api',
    configureServer(server) {
      httpServer = server.httpServer;
      viteServer = server;
      // 启动即构建一次，注入点从第一个页面起就能引用哈希地址；失败只落日志，
      // 不挡端口监听 —— 第一个 /annotate.js 请求会把原因带回给页面（500）。
      ensureAnnotateBundle().catch((error) => logBundleErrorOnce(error));
      server.middlewares.use(async (req, res, next) => {
        const urlPath = parseReqUrl(req).pathname;
        if (await handleAnnotate(req, res, urlPath)) return;
        next();
      });
    },
  };
}
