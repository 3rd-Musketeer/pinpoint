import { parseReqUrl } from './lib/req-url.js';
/**
 * /sites/<entry-id>/ — one URL space for every registry entry:
 *
 * - `dir` entries: read-only static serving of the registered directory.
 * - `file` entries: exactly the one registered file, under both
 *   `/sites/<id>/` and `/sites/<id>/<basename>`; everything else 404s, so
 *   sibling files in the same directory stay unreachable.
 * - Both are GET/HEAD-only.
 * - Requests the browser marks `Sec-Fetch-Site: cross-site` get 403 (another site's page embedding or
 *   fetching our content); same-origin, same-site, none and a missing header pass.
 *
 * The registry is the whitelist: only registered entries are served. For a
 * `dir` entry every resolved path (textual and real, i.e. symlink-safe) must
 * stay inside the entry directory. Entries without their own board.json get a
 * synthesized doc board at `/sites/<id>/board.json` (see lib/synth-board.js),
 * so every registered site page opens readable in the workbench.
 * HTML responses (GET, without
 * ?annotate=off) get the annotate client injected — "登记过才注入": opening
 * the same content via file:// or a self-started server serves the identical
 * bytes with zero annotation surface. ?annotate=off opts a single request out
 * (export paths and the workbench's inline fragment loader use it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotateSnippet, injectAnnotateClient } from './lib/annotate-snippet.js';
import { articleHtmlFrameFile, deriveArticleBoard, frameSrcFromUrlPath } from './lib/article-board.js';
import { resolvePage } from './lib/page-resolve.js';
import { resolveContainedFile, resolveServableFile } from './lib/servable-file.js';
import {
  boardScreenIds,
  screenIdFromRel,
  serveBoardJsonWithDist,
  serveDistScreenResponse,
} from './lib/page-compiler.js';
import { loadRegistry } from './lib/registry.js';
import { synthesizeBoard } from './lib/synth-board.js';
import { parseFrameSrc } from '../shared/project-ids.js';

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

/**
 * Resolve `rel` inside `base` to an existing regular file, or null.
 * `..` traversal is rejected textually; symlink escapes are rejected by
 * realpath containment. Directories fall through to their index.html.
 */
function resolveFileWithin(base, rel) {
  return resolveContainedFile(base, rel).real || null;
}

/** 文章的三条出文件分支（文章目录、@root、@source）共用 resolveServableFile（lib/servable-file.js）。 */
function servable(base, rel) {
  return resolveServableFile(base, rel).real || null;
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
  return resolveContainedFile(entry.path, '', { index: false }).real || null;
}

export function createSitesHandler(options = {}) {
  const registry = options.registry || loadRegistry({ root: ROOT });

  // 磁盘没有 board.json 时合成 doc 阅读板（file 单屏；dir 顶层 *.html 一屏
  // 一版本）——磁盘文件永远优先（dir 分支只在 resolve 落空后走到）。合成的
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

  /**
   * 文章画布页：board.json 是从 index.mdx 现派生的板（附 dist 状态），JSX 帧从 dist 出、
   * HTML 帧从源文件出（标注桶 = 画布页 id），其余（article.css / article.js / assets/ /
   * 组件和 HTML 帧引用的资源）从文章目录只读静态出；project 根下的 HTML 帧和它引用的文件在
   * `@root/<路径>` 下（docs/projects.md“HTML 帧”）。三处出文件都经 resolveServableFile。
   */
  async function serveArticlePage(req, res, target, rel) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return true;
    }
    let board;
    try {
      board = deriveArticleBoard(target).board;
    } catch {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }
    if (rel === 'board.json') return serveBoardJsonWithDist(req, res, target.entryId, target.pageDir, { board });
    const query = parseReqUrl(req).query;
    const inject = query.get('annotate') === 'off' ? null : (html) => injectAnnotateClient(html, target.entryId);
    const screens = (board.sections || []).flatMap((section) => section.screens || []);
    // project 根和 source 目录下的文件（docs/projects.md“HTML 帧”）：/sites/<页 id>/@root/<路径>、
    // /sites/<页 id>/@source/<名>/<路径>。一个目录只在这篇有帧真的住在里面时开放（帧文件解析得到；
    // 缺文件的 { id, src } 帧不算）；帧本身注入标注客户端，其余文件（帧引用的样式、脚本、图片、内嵌的 HTML）原样出。
    const src = frameSrcFromUrlPath(target, rel);
    if (src !== null) {
      const { source, path: relPath } = parseFrameSrc(src);
      const rootScreens = screens.filter((screen) => screen.src && articleHtmlFrameFile(target, screen));
      const open = rootScreens.some((screen) => {
        const used = frameSrcFromUrlPath(target, screen.src);
        return used !== null && parseFrameSrc(used).source === source;
      });
      const base = source ? (target.sources || {})[source] : target.projectRoot;
      if (!open || !base) {
        sendJson(res, 404, { error: 'not found' });
        return true;
      }
      const frame = rootScreens.find((screen) => frameSrcFromUrlPath(target, screen.src) === src);
      const file = frame ? articleHtmlFrameFile(target, frame) : servable(base, relPath);
      if (!file) {
        sendJson(res, 404, { error: 'not found' });
        return true;
      }
      return sendFile(req, res, file, frame ? inject : null);
    }
    const screenId = screenIdFromRel(rel);
    const screen = screenId ? screens.find((entry) => entry.id === screenId && !entry.src) : null;
    if (screen) {
      // HTML 帧从源文件直接出（文档不经编译，改了就是新的）；JSX 帧从 dist 出。
      const htmlFile = articleHtmlFrameFile(target, screen);
      if (htmlFile) return sendFile(req, res, htmlFile, inject);
      return serveDistScreenResponse(req, res, target, screenId, { inject });
    }
    const file = rel ? servable(target.pageDir, rel) : null;
    if (!file) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }
    return sendFile(req, res, file, null);
  }

  /** 读盘出一个文件；inject 给了且是 HTML 时注入标注客户端。 */
  function sendFile(req, res, file, inject) {
    let body = fs.readFileSync(file);
    if (inject && mimeFor(file) === 'text/html') body = Buffer.from(inject(body.toString('utf8')), 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType(file));
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  return async function handleSites(req, res, urlPath) {
    if (!urlPath.startsWith('/sites/')) return false;

    // 别的站点的网页不能拿 /sites/ 的内容（iframe、<script>、fetch 都算）：浏览器标了 cross-site 的请求 403。
    // same-origin（工作台、画布视图、文章页的卡片）、same-site、none（地址栏、书签）和没有这个头的
    // （命令行工具、ppnt shot 的直接导航）照常出。
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
      sendJson(res, 403, { error: 'cross_site', message: '/sites/ 不给别的站点的页面用' });
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

    // /sites/<id>/ 只服务登记条目与文章画布页（pp3，<project>_<article>）；模板页不在这里。
    const page = resolvePage(registry, id);
    if (page && page.kind === 'article') return serveArticlePage(req, res, page.target, rel);
    const entry = page && page.kind === 'entry' ? page.entry : null;
    if (!entry) {
      sendJson(res, 404, { error: 'not found' });
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
            // storage-unify：注入的 entry = 这条内容属于哪一页。
            inject: query.get('annotate') === 'off' ? null : (html) => injectAnnotateClient(html, entry.id),
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
  const registry = options.registry || loadRegistry({ root: ROOT });
  const handleSites = createSitesHandler({ ...options, registry });
  return {
    name: 'sites-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = parseReqUrl(req).pathname;
        if (await handleSites(req, res, urlPath)) return;
        next();
      });
    },
  };
}
