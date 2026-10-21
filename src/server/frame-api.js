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
 * fragment 屏 → 完整 HTML（机壳 + ios-kit 链接 + 共享外壳 CSS / frame-boot 链接 + annotate 注入，
 * 注入带 __pinpointFrame —— frame 内标注与画布同账本：storage-unify 起帧账本
 * 恒为所属页桶的 @canvas，不再跟顶层工作台 pathname 走，ledger 参数退役）；
 * doc 壳屏 → 302 到该屏自己的 URL（同 pathname = 同账本，透传自然成立）；annotate=off 与 embed=card
 * 时地址带上 annotate=off（正文缩略卡片里的 HTML 帧就是这样打开的）。
 * 组装逻辑在 src/server/lib/frame-doc.js（机壳与画布共享 src/shared/frame-shell.js）。
 */
import { FrameDocError, figurePageHtml, framePageHtml, resolveFigureTarget, resolveFrameTarget } from './lib/frame-doc.js';
import { annotateInjection } from './lib/annotate-snippet.js';
import { readBody, rejectWrite, sendCacheable, sendJson, sendMethodNotAllowed } from './lib/http-respond.js';
import { defaultDistRoot, loadFigure, recordFigureRuntimeError } from './lib/page-compiler.js';
import { requestSignal } from './lib/request-signal.js';

const EMBEDS = new Set(['card', 'figure']);

// POST /api/figure-error 的读体上限（http-respond 统一读体；保持原 64 KB）。
const FIGURE_ERROR_BODY_LIMIT = 64 * 1024;

export default function frameApi(options = {}) {
  const registry = options.registry || null;
  const distRoot = () => options.distRoot || defaultDistRoot();

  async function serveFigure(req, res, pageId, figureId, theme) {
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
    // 图页也是帧 HTML（策略表 frameHtml 行：no-cache + 内容 ETag，重编后 304 放行新内容）；
    // 编译失败那个 500 同样 no-cache、不带 ETag——出帧错误应答的头只有这一种
    // （review 建议 3：错误态会变好，每次重取就是要的行为，验证器没有意义）。
    const body = Buffer.from(figurePageHtml(resolved, loaded, { theme }), 'utf8');
    if (loaded.ok) return sendCacheable(req, res, body, { policy: 'frameHtml', contentType: 'text/html; charset=utf-8' });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function recordFigureError(req, res) {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST');
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') {
      sendJson(res, 403, { error: 'forbidden', message: 'same-origin only' });
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req, FIGURE_ERROR_BODY_LIMIT));
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
        if (rejectWrite(req, res)) return;
        const query = parseReqUrl(req).query;
        const pageId = query.get('page') || '';
        const screenId = query.get('screen') || '';
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
          await serveFigure(req, res, pageId, figureId, query.get('theme') || '');
          return;
        }
        const lifetime = requestSignal(req, res);
        try {
          const target = resolveFrameTarget(pageId, screenId, { registry });
          // 注入判定走 annotateInjection（r2 D4 的归一入口）：?annotate=off 豁免、
          // 页 id 为空不注入；embed=card 的形状开关在 framePageHtml 内（卡片不出标注面）。
          const annotate = annotateInjection(req, target.pageId) !== null;
          if (target.kind === 'doc') {
            // 文档帧跳到它自己的地址；卡片、浮层（embed=card）和 annotate=off 带上 annotate=off，文档里不出标注面。
            const quiet = (!annotate || embed) && !/^https?:\/\//i.test(target.url);
            res.statusCode = 302;
            res.setHeader('Location', quiet ? `${target.url}${target.url.includes('?') ? '&' : '?'}annotate=off` : target.url);
            res.end();
            return;
          }
          // 组装出的帧文档走策略表 frameHtml 行：no-cache + 最终字节的内容 ETag，
          // reload / HMR 重取时 304（审计 K6 建议 (a)）。
          const body = Buffer.from(await framePageHtml(target, { annotate, embed, signal: lifetime.signal }), 'utf8');
          if (lifetime.signal.aborted) return;
          sendCacheable(req, res, body, { policy: 'frameHtml', contentType: 'text/html; charset=utf-8' });
        } catch (error) {
          if (lifetime.signal.aborted) return;
          if (error instanceof FrameDocError) {
            sendJson(res, error.code === 'bad_request' ? 400 : 404, { error: error.code, message: error.message });
            return;
          }
          sendJson(res, 500, { error: 'frame_failed', message: String((error && error.message) || error) });
        } finally {
          lifetime.dispose();
        }
      });
    },
  };
}
