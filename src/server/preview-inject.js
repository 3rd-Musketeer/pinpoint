/**
 * previews/ 全文档自动注入（2026-08-17 注入契约统一，decisions 08-17e）：
 * previews/ 与 /sites/ 对齐同一条「serve 即注入」契约——任何含 <!doctype 的
 * previews/**.html 响应都带 annotate 客户端，页面不再需要自己抄注入 IIFE
 * （历史故障：weekly-review 三草稿 / detail-panel-variants 等缺段静默无法标注，
 * 案例见 docs/debugging.md）。
 * 只拦完整文档：fragment（无 <!doctype）一律放行给 vite 静态服务，画布内联
 * 保持干净；?annotate=off 单请求豁免（导出管线）；已带手工注入段的页面跳过
 * （客户端 __pinpoint 防双载是第二道网）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { injectAnnotateClientTag } from './lib/annotate-snippet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = path.resolve(__dirname, '..', '..', 'content');
const ROUTE = /^\/previews\/(.+\.html)$/;

export function createPreviewInjectHandler(options = {}) {
  const root = options.root || CONTENT_ROOT;
  const previewsRoot = path.join(root, 'previews');

  return function handlePreviewInject(req, res, urlPath, query) {
    if (req.method !== 'GET') return false;
    if (/(?:^|&)annotate=off(?:&|$)/.test(query || '')) return false;
    const match = urlPath.match(ROUTE);
    if (!match) return false;
    const file = path.join(previewsRoot, match[1]);
    if (!file.startsWith(previewsRoot + path.sep)) return false;
    let html;
    try {
      html = fs.readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    if (!/<!doctype\b/i.test(html)) return false;
    if (html.includes('data-ios-annotate')) return false;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(injectAnnotateClientTag(html));
    return true;
  };
}

export default function previewInject(options = {}) {
  const handle = createPreviewInjectHandler(options);
  return {
    name: 'preview-inject',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const parts = (req.url || '').split('?');
        if (handle(req, res, parts[0], parts[1] || '')) return;
        next();
      });
    },
  };
}
