import { parseReqUrl } from './lib/req-url.js';
/**
 * GET /api/frame?page=<pageId>&screen=<screenId>[&annotate=off][&embed=card]
 * embed=card：文章正文缩略卡片用的嵌入页（不出图注，机壳带 data-pp-stage，不注入标注），见 docs/projects.md；
 *   画布浮层、活卡片与“全页”走工作台，不经这里。
 * GET /api/frame?page=<文章页 id>&figure=<图 id>&embed=figure[&theme=light|dark]：正文里的图
 *   （docs/projects.md“图”）。没有机壳、图注和标注客户端；过期就先重编；编译失败回 500，正文是同一个
 *   图页、图的位置写错误原因。figure 与 embed=figure 必须一起写。
 * POST /api/figure-error { page, figure, builtAt, message, line? }：图页报上来的运行错误，记在这一版的
 *   编译记录上（pinpoint list 列出），只收同源请求。
 * 单帧渲染端点（嵌入帧）：
 * fragment 屏 → 完整自包含 HTML（机壳 + ios-kit + frame-boot + annotate 注入，
 * 注入带 __pinpointFrame —— frame 内标注与画布同账本：storage-unify 起帧账本
 * 恒为所属页桶的 @canvas，不再跟顶层工作台 pathname 走，ledger 参数退役）；
 * doc 壳屏 → 302 到该屏自己的 URL（同 pathname = 同账本，透传自然成立）；annotate=off 与 embed=card
 * 时地址带上 annotate=off（正文缩略卡片里的 HTML 帧就是这样打开的）。
 * 组装逻辑在 src/server/lib/frame-doc.js（机壳与画布共享 src/shared/frame-shell.js）。
 */
import { FrameDocError, figurePageHtml, framePageHtml, resolveFigureTarget, resolveFrameTarget } from './lib/frame-doc.js';
import { defaultDistRoot, loadFigure, recordFigureRuntimeError } from './lib/page-compiler.js';

const EMBEDS = new Set(['card', 'figure']);

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default function frameApi(options = {}) {
  const registry = options.registry || null;
  const distRoot = () => options.distRoot || defaultDistRoot();

  async function serveFigure(res, pageId, figureId, theme) {
    let resolved;
    try {
      resolved = resolveFigureTarget(pageId, figureId, { registry });
    } catch (error) {
      if (error instanceof FrameDocError) {
        sendJson(res, error.code === 'bad_request' ? 400 : 404, { error: error.code, message: error.message });
        return;
      }
      throw error;
    }
    let loaded;
    try {
      loaded = await loadFigure(resolved.target, figureId, { distRoot: distRoot() });
    } catch (error) {
      loaded = { ok: false, error: String((error && error.message) || error), record: null };
    }
    res.statusCode = loaded.ok ? 200 : 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(figurePageHtml(resolved, loaded, { theme }));
  }

  async function recordFigureError(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') {
      sendJson(res, 403, { error: 'forbidden', message: 'same-origin only' });
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_request', message: 'JSON body expected' });
      return;
    }
    let resolved;
    try {
      resolved = resolveFigureTarget(body && body.page, body && body.figure, { registry });
    } catch (error) {
      sendJson(res, error instanceof FrameDocError && error.code === 'bad_request' ? 400 : 404, { error: 'unknown_figure', message: String(error.message || error) });
      return;
    }
    const recorded = typeof body.builtAt === 'number' && recordFigureRuntimeError(distRoot(), resolved.target.entryId, resolved.figureId, {
      builtAt: body.builtAt,
      message: body.message,
      line: body.line,
    });
    sendJson(res, 200, { recorded: Boolean(recorded) });
  }

  return {
    name: 'frame-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = parseReqUrl(req).pathname;
        if (urlPath === '/api/figure-error') {
          await recordFigureError(req, res);
          return;
        }
        if (urlPath !== '/api/frame') return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method_not_allowed' });
          return;
        }
        const query = parseReqUrl(req).query;
        const pageId = query.get('page') || '';
        const screenId = query.get('screen') || '';
        const annotate = query.get('annotate') !== 'off';
        const embed = query.get('embed') || '';
        if (embed && !EMBEDS.has(embed)) {
          sendJson(res, 400, { error: 'bad_request', message: `unknown embed "${embed}" (only "card" or "figure")` });
          return;
        }
        const figureId = query.get('figure');
        if ((figureId !== null) !== (embed === 'figure')) {
          sendJson(res, 400, { error: 'bad_request', message: 'figure=<图 id> and embed=figure go together' });
          return;
        }
        if (figureId !== null) {
          await serveFigure(res, pageId, figureId, query.get('theme') || '');
          return;
        }
        try {
          const target = resolveFrameTarget(pageId, screenId, { registry });
          if (target.kind === 'doc') {
            // 文档帧跳到它自己的地址；卡片、浮层（embed=card）和 annotate=off 带上 annotate=off，文档里不出标注面。
            const quiet = (!annotate || embed) && !/^https?:\/\//i.test(target.url);
            res.statusCode = 302;
            res.setHeader('Location', quiet ? `${target.url}${target.url.includes('?') ? '&' : '?'}annotate=off` : target.url);
            res.end();
            return;
          }
          const html = await framePageHtml(target, { annotate, embed });
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
