/**
 * 工作台住在 /workbench/（ADR 0044）：/workbench/ 改写成仓库根的 index.html 交给 vite；
 * 旧地址（根 /index.html、带工作台参数的根 /）404。判定在 lib/workbench-routes.js；
 * 插件排在插件链最前面，文章代理（/ 是 blog 首页）看到的已经是判定之后的请求。
 */
import { routeWorkbenchRequest } from './lib/workbench-routes.js';
import { createWorkbenchBundleHandler } from './lib/workbench-bundle.js';

export function createWorkbenchHandler({ bundle = null } = {}) {
  return function handleWorkbench(req, res) {
    const route = routeWorkbenchRequest(req.method, req.url);
    if (bundle && bundle(req, res, route?.action === 'rewrite')) return true;
    if (!route) return false;
    if (route.action === 'rewrite') {
      req.url = route.url;
      return false;
    }
    if (route.action === 'notFound') {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('404 not found: 旧的工作台地址已退役，工作台在 /workbench/\n');
      return true;
    }
    res.statusCode = 302;
    res.setHeader('Location', route.location);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return true;
  };
}

export default function workbenchRoutes({ root, mode = 'dev', dist } = {}) {
  return {
    name: 'workbench-routes',
    configureServer(server) {
      const bundle = mode === 'bundle' ? createWorkbenchBundleHandler({ root, dist }) : null;
      const handle = createWorkbenchHandler({ bundle });
      server.middlewares.use((req, res, next) => {
        if (handle(req, res)) return;
        next();
      });
    },
  };
}
