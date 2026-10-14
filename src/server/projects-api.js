/**
 * GET /api/projects        → listProjects(registry)（数组，docs/projects.md）
 * GET /api/projects/<id>   → findProject(registry, id)，没登记 404
 * GET /api/projects/<id>/articles/<article>/canvas → articleCanvas(registry, id, article)
 *   （pp3：文章画布的节、帧、编号与这篇的布局错误；project 没登记 404）
 * pp3：Astro 站点与工作台读登记的 project 用它；布局错误在每个 project 的
 * errors 里，不是 HTTP 错误。每次请求都重读盘，文章增删不用 reload。
 */
import { articleCanvas } from './lib/article-board.js';
import { findProject, listProjects } from './lib/projects.js';
import { parseReqUrl } from './lib/req-url.js';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(JSON.stringify(body));
}

export function createProjectsHandler({ registry }) {
  return (req, res, next) => {
    const urlPath = parseReqUrl(req).pathname;
    if (urlPath !== '/api/projects' && !urlPath.startsWith('/api/projects/')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (urlPath === '/api/projects' || urlPath === '/api/projects/') {
      sendJson(res, 200, listProjects(registry));
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
        sendJson(res, 400, { error: 'bad_request' });
        return;
      }
      if (!findProject(registry, projectId)) {
        sendJson(res, 404, { error: 'not_found', message: `project 没登记：${projectId}` });
        return;
      }
      sendJson(res, 200, articleCanvas(projectId, articleId, { registry }));
      return;
    }
    const id = decodeURIComponent(urlPath.slice('/api/projects/'.length).replace(/\/$/, ''));
    const project = findProject(registry, id);
    if (!project) {
      sendJson(res, 404, { error: 'not_found', message: `project 没登记：${id}` });
      return;
    }
    sendJson(res, 200, project);
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
