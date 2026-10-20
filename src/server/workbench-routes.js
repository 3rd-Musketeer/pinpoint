/**
 * 工作台住在 /workbench/（ADR 0044）：旧地址 302 过去，/workbench/ 改写成仓库根的
 * index.html 交给 vite。判定在 lib/workbench-routes.js；插件排在插件链最前面，
 * 文章代理（不带参数的 / 是 blog 首页）看到的已经是跳转之后的请求。
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
