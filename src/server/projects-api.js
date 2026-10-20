/**
 * GET /api/projects        → listProjects(registry)（数组，docs/projects.md）
 * GET /api/projects/<id>   → findProject(registry, id)，没登记 404
 * GET /api/projects/<id>/articles/<article>/canvas → articleCanvas(registry, id, article)
 *   （pp3：文章画布的节、帧、编号与这篇的布局错误；project 没登记 404）
 * pp3：Astro 站点与工作台读登记的 project 用它；布局错误在每个 project 的
 * errors 里，不是 HTTP 错误。每次请求都重读盘，文章增删不用 reload。
 */
import { articleCanvas } from './lib/article-board.js';
import { rejectWrite, sendJson } from './lib/http-respond.js';
import { findProject, listProjects } from './lib/projects.js';
import { parseReqUrl } from './lib/req-url.js';

// 每次请求都重读盘，应答不许缓存（缓存策略表在 S3 才收，这里保持现状）。
const sendFreshJson = (res, status, body) => sendJson(res, status, body, { cacheControl: 'no-cache' });

export function createProjectsHandler({ registry }) {
  return (req, res, next) => {
    const urlPath = parseReqUrl(req).pathname;
    if (urlPath !== '/api/projects' && !urlPath.startsWith('/api/projects/')) return next();
    if (rejectWrite(req, res)) return;
    if (urlPath === '/api/projects' || urlPath === '/api/projects/') {
      sendFreshJson(res, 200, listProjects(registry));
      return;
    }
    const canvas = urlPath.match(/^\/api\/projects\/([^/]+)\/articles\/([^/]+)\/canvas\/?$/);
    if (canvas) {
      let projectId;
      let articleId;
      try {
        projectId = decodeURIComponent(canvas[1]);
        articleId = decodeURIComponent(canvas[2]);
      } catch {
        sendFreshJson(res, 400, { error: 'bad_request', message: 'bad request' });
        return;
      }
      if (!findProject(registry, projectId)) {
        sendFreshJson(res, 404, { error: 'not_found', message: `project 没登记：${projectId}` });
        return;
      }
      sendFreshJson(res, 200, articleCanvas(projectId, articleId, { registry }));
      return;
    }
    let id;
    try {
      id = decodeURIComponent(urlPath.slice('/api/projects/'.length).replace(/\/$/, ''));
    } catch {
      // 坏的百分号编码不表达任何一条合法路径：400，不落进 connect 的 500
      //（pp3 review 余项 14，与上面 canvas 路由同一写法）。
      sendFreshJson(res, 400, { error: 'bad_request', message: 'bad request' });
      return;
    }
    const project = findProject(registry, id);
    if (!project) {
      sendFreshJson(res, 404, { error: 'not_found', message: `project 没登记：${id}` });
      return;
    }
    sendFreshJson(res, 200, project);
  };
}

export default function projectsApi(options = {}) {
  return {
    name: 'projects-api',
    configureServer(server) {
      server.middlewares.use(createProjectsHandler({ registry: options.registry }));
    },
  };
}
