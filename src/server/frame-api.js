/**
 * GET /api/frame?page=<pageId>&screen=<screenId>[&ledger=<pathname>][&annotate=off]
 * 阶段 5：文档 mention 的活 frame 渲染端点。
 * fragment 屏 → 完整自包含 HTML（机壳 + ios-kit + frame-boot + annotate 注入，
 * 注入带 __pinpointFrame/__pinpointLedger —— frame 内标注与画布同账本）；
 * doc 壳屏 → 302 到该屏自己的 URL（同 pathname = 同账本，透传自然成立）。
 * 组装逻辑在 server/lib/frame-doc.js（机壳与画布共享 lib/frame-shell.js）。
 */
import { FrameDocError, framePageHtml, resolveFrameTarget } from './lib/frame-doc.js';

const LEDGER_RE = /^\/[\x20-\x7e]{0,200}$/;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default function frameApi(options = {}) {
  const registry = options.registry || null;
  return {
    name: 'frame-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        if (urlPath !== '/api/frame') return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method_not_allowed' });
          return;
        }
        const query = new URL(req.url || '/', 'http://frame.local').searchParams;
        const pageId = query.get('page') || '';
        const screenId = query.get('screen') || '';
        const rawLedger = query.get('ledger');
        const ledger = rawLedger && LEDGER_RE.test(rawLedger) ? rawLedger : '/index.html';
        const annotate = query.get('annotate') !== 'off';
        try {
          const target = resolveFrameTarget(pageId, screenId, { registry });
          if (target.kind === 'doc') {
            res.statusCode = 302;
            res.setHeader('Location', target.url);
            res.end();
            return;
          }
          const html = await framePageHtml(target, { ledger, annotate });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(html);
        } catch (error) {
          if (error instanceof FrameDocError) {
            sendJson(res, error.code === 'bad_request' ? 400 : 404, { error: error.code, message: error.message });
            return;
          }
          sendJson(res, 500, { error: 'frame_failed', message: String((error && error.message) || error) });
        }
      });
    },
  };
}
