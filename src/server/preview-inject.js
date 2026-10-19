/**
 * previews/ 全文档自动注入（2026-08-17 注入契约统一，decisions 08-17e）：
 * previews/ 与 /sites/ 对齐同一条「serve 即注入」契约——任何含 <!doctype 的
 * previews/**.html 响应都带 annotate 客户端，页面不再需要自己抄注入 IIFE
 * （历史故障：weekly-review 三草稿 / detail-panel-variants 等缺段静默无法标注，
 * 案例见 docs/debugging.md）。
 * 只拦完整文档：fragment（无 <!doctype）一律放行给 vite 静态服务，画布内联
 * 保持干净；?annotate=off 单请求豁免（导出管线）；已带手工注入段的页面跳过
 * （客户端 __pinpoint 防双载是第二道网）。
 * storage-unify：注入带 entry 标记 = 该 previews 页自己的 id（桶 = 页），与
 * /sites/ 完全同形。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotateInjection } from './lib/annotate-snippet.js';
import { boardScreenIds } from './lib/page-compiler.js';
import { sendCacheable } from './lib/http-respond.js';
import { resolveContainedFile } from './lib/servable-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = path.resolve(__dirname, '..', '..', 'content');
const ROUTE = /^\/previews\/(.+\.html)$/;
const SCREEN_RE = /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\.html$/;

export function createPreviewInjectHandler(options = {}) {
  const root = options.root || CONTENT_ROOT;
  const previewsRoot = path.join(root, 'previews');

  return function handlePreviewInject(req, res, urlPath) {
    if (req.method !== 'GET') return false;
    const match = urlPath.match(ROUTE);
    if (!match) return false;
    let rel;
    try { rel = decodeURIComponent(match[1]); } catch { return false; }
    // 注入判定走 annotateInjection（r2 D4 的归一入口）：off（导出管线）原样
    // 放行给 vite 静态服务，与从前同路径。entry = 路径第一段（页 id，模板页
    // 在清单里恒登记）。
    const inject = annotateInjection(req, rel.split('/')[0]);
    if (!inject) return false;
    if (!path.resolve(previewsRoot, rel).startsWith(path.resolve(previewsRoot) + path.sep)) return false;
    const found = resolveContainedFile(previewsRoot, rel, { index: false });
    if (found.reason === 'outside') {
      res.statusCode = 404;
      res.end('not found');
      return true;
    }
    // pp2：board 屏让给 content-routes 从 dist 出（doctype 的注入也在那边做），
    // 这里只管非屏的整文档 html（index.html 之类）。
    const screenRef = rel.match(SCREEN_RE);
    const pageId = rel.split('/')[0];
    // 不可读的板不能走非板文档注入分支。
    if (resolveContainedFile(previewsRoot, `${pageId}/board.json`, { index: false }).reason === 'outside') {
      res.statusCode = 404;
      res.end('not found');
      return true;
    }
    if (screenRef) {
      const ids = boardScreenIds(path.join(previewsRoot, screenRef[1]));
      if (ids && ids.has(screenRef[2])) return false;
    }
    if (!found.file) return false;
    let html;
    try {
      html = fs.readFileSync(found.file, 'utf8');
    } catch {
      return false;
    }
    if (!/<!doctype\b/i.test(html)) return false;
    if (html.includes('data-ios-annotate')) return false;
    // 注入后的整文档走策略表 frameHtml 行（no-cache + 内容 ETag）。
    return sendCacheable(req, res, Buffer.from(inject(html), 'utf8'), { policy: 'frameHtml', contentType: 'text/html; charset=utf-8' });
  };
}

export default function previewInject(options = {}) {
  const handle = createPreviewInjectHandler(options);
  return {
    name: 'preview-inject',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const parts = (req.url || '').split('?');
        if (handle(req, res, parts[0])) return;
        next();
      });
    },
  };
}
