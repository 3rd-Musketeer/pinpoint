import { parseReqUrl } from './lib/req-url.js';
/**
 * /sites/<entry-id>/ — one URL space for every registry entry:
 *
 * - `dir` entries: read-only static serving of the registered directory.
 * - `file` entries: exactly the one registered file, under both
 *   `/sites/<id>/` and `/sites/<id>/<basename>`; everything else 404s, so
 *   sibling files in the same directory stay unreachable.
 * - `url` entries (阶段 4): same-origin path-prefix proxy to the registered
 *   origin (server/lib/site-proxy.js) — HTML/CSS rewritten onto the prefix,
 *   rebase bootstrap + annotate client injected into HTML, WS upgrades
 *   forwarded (createSiteUpgradeHandler). All methods pass through (the app
 *   behind the proxy has its own API); dir/file stay GET/HEAD-only.
 *
 * The registry is the whitelist: only registered entries are served. For a
 * `dir` entry every resolved path (textual and real, i.e. symlink-safe) must
 * stay inside the entry directory. Entries without their own board.json get a
 * synthesized doc board at `/sites/<id>/board.json` (see lib/synth-board.js —
 * for url entries the synthesized board always wins, shadowing any upstream
 * board.json), so every registered site page opens readable in the workbench.
 * HTML responses (GET, without
 * ?annotate=off) get the annotate client injected — "登记过才注入": opening
 * the same content via file:// or a self-started server serves the identical
 * bytes with zero annotation surface. ?annotate=off opts a single request out
 * (export paths and the workbench's inline fragment loader use it; on url
 * entries it drops only the annotate client — the rebase bootstrap stays,
 * see lib/site-proxy.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotateSnippet, injectAnnotateClient } from './lib/annotate-snippet.js';
import {
  boardScreenIds,
  screenIdFromRel,
  serveBoardJsonWithDist,
  serveDistScreenResponse,
} from './lib/page-compiler.js';
import { loadRegistry } from './lib/registry.js';
import { createSiteUpgradeHandler, proxySiteRequest } from './lib/site-proxy.js';
import { synthesizeBoard } from './lib/synth-board.js';

export { annotateSnippet, injectAnnotateClient };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

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

  /** 桶 = 页：条目的标注桶 id（挂靠条目 → 宿主页 id，其余 → 自己的 id）。 */
  function pageBucketOf(entry) {
    return entry.page || entry.id;
  }

  // 磁盘没有 board.json 时合成 doc 阅读板（file 单屏；dir 顶层 *.html 一屏
  // 一版本；url 单屏代理页）——磁盘文件永远优先（dir 分支只在 resolve 落空后
  // 走到），url 条目无磁盘概念、合成板直接遮蔽上游自己的 board.json。合成的
  // 是 JSON 数据响应，不走 annotate 注入（注入只作用于 HTML 内容）。
  function sendSynthesizedBoard(req, res, entry) {
    const board = synthesizeBoard(entry);
    if (!board) return false;
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

  return async function handleSites(req, res, urlPath) {
    if (!urlPath.startsWith('/sites/')) return false;

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
    if (!entry) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }

    // kind "url"（阶段 4）：同源路径前缀代理，方法/头/body 全透传。
    if (entry.kind === 'url') {
      if (rel === 'board.json' && (req.method === 'GET' || req.method === 'HEAD')
        && sendSynthesizedBoard(req, res, entry)) {
        return true;
      }
      proxySiteRequest(req, res, entry);
      return true;
    }

    if (entry.kind !== 'dir' && entry.kind !== 'file') {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return true;
    }

    const query = parseReqUrl(req).query;

    // pp2（2026-09-22 切片 1）：dir 条目的「屏」从 dist 出 —— board.json 里的
    // screenId 对应的 <id>.html 读 <dataRoot>/dist/<entry>/（懒编译兜底）；
    // 编译失败的屏 500 带错误文本（工作台的 .wb-screen-err 面板吃非 200）。
    // 非屏路径（css / js / 图片 / 非屏 html）仍走下面的源目录静态服务。
    if (entry.kind === 'dir') {
      const pageDir = path.resolve(entry.path);
      const screenId = screenIdFromRel(rel);
      if (screenId) {
        const ids = boardScreenIds(pageDir);
        if (ids && ids.has(screenId)) {
          return serveDistScreenResponse(req, res, {
            entryId: entry.id,
            pageDir,
            urlBase: `/sites/${entry.id}/`,
            kind: 'dir',
          }, screenId, {
            // storage-unify：注入的 entry = 这条内容属于哪一页（挂靠条目给宿主页 id）。
            inject: query.get('annotate') === 'off' ? null : (html) => injectAnnotateClient(html, pageBucketOf(entry)),
          });
        }
      }
      // board.json：磁盘有板时附带 dist: { builtAt, stale }（工作台先不消费）。
      if (rel === 'board.json' && serveBoardJsonWithDist(req, res, entry.id, pageDir)) {
        return true;
      }
    }

    const file = entry.kind === 'file'
      ? resolveRegisteredFile(entry, rel)
      : resolveFileWithin(path.resolve(entry.path), rel || 'index.html');

    if (!file && rel === 'board.json' && sendSynthesizedBoard(req, res, entry)) {
      return true;
    }

    if (!file) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }

    const isHtml = mimeFor(file) === 'text/html';
    let body = fs.readFileSync(file);
    if (isHtml && query.get('annotate') !== 'off') {
      body = Buffer.from(injectAnnotateClient(body.toString('utf8'), pageBucketOf(entry)), 'utf8');
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
  const registry = options.registry || loadRegistry({ root: ROOT });
  const handleSites = createSitesHandler({ ...options, registry });
  const handleUpgrade = createSiteUpgradeHandler({ registry });
  return {
    name: 'sites-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = parseReqUrl(req).pathname;
        if (await handleSites(req, res, urlPath)) return;
        next();
      });
      // WS 兜底：/sites/<id>/ 的 upgrade 转发到 url 条目的目标 origin（路径
      // 去前缀回写）。非 /sites/ 路径与 dir/file 条目不碰 socket —— vite HMR
      // 等其它 upgrade listener 照常工作。
      if (server.httpServer) server.httpServer.on('upgrade', handleUpgrade);
    },
  };
}
