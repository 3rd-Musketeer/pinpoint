import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import annotateApi from './src/server/annotate-api.js';
import sitesApi from './src/server/sites-api.js';
import frameApi from './src/server/frame-api.js';
import projectsApi from './src/server/projects-api.js';
import canvasDiagnosticsApi from './src/server/canvas-diagnostics-api.js';
import exportImageApi from './src/server/export-image-api.js';
import exportPageHtmlApi from './src/server/export-page-html-api.js';
import previewHmr from './src/server/preview-hmr.js';
import previewInject from './src/server/preview-inject.js';
import contentRoutes from './src/server/content-routes.js';
import articleProxy from './src/server/article-proxy.js';
import workbenchRoutes from './src/server/workbench-routes.js';
import loopbackListener from './src/server/loopback-listener.js';
import { createRegistryStore } from './src/server/lib/registry-store.js';
import { WORKBENCH_DEPS, viteCacheDir } from './src/server/lib/vite-deps.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// One live registry view shared by every consumer (annotate API / sites
// serving / doc export): POST /registry/reload swaps the snapshot once and
// all of them see it — no restart after `pinpoint add`.
const registryStore = createRegistryStore({ root: ROOT });
const hmr = previewHmr({ registry: registryStore });
// 条目增删（pinpoint add / POST /registry/reload）后同步仓外 watch 集合。
const reloadRegistry = registryStore.reload.bind(registryStore);
registryStore.reload = () => {
  const snapshot = reloadRegistry();
  hmr.syncWatcher();
  return snapshot;
};

// pp3：/<project>/… 文章同源代理到按需拉起的 Astro 开发服务器（站点状态进 /health）。
const articles = articleProxy({ registry: registryStore, root: ROOT });

export default defineConfig({
  // 每个实例自己的依赖缓存，不共用 node_modules/.vite（src/server/lib/vite-deps.js 写了为什么）。
  cacheDir: viteCacheDir({ root: ROOT }),
  // 工作台的第三方依赖启动时一次预构建齐，不等运行时发现新依赖再重建 deps/、换 chunk 名。
  optimizeDeps: { include: WORKBENCH_DEPS },
  // workbenchRoutes 排最前：旧地址先 302 到 /workbench/，不带参数的 / 才轮到文章代理（blog 首页，ADR 0044）。
  plugins: [workbenchRoutes(), react(), tailwindcss(), articles, annotateApi({ registry: registryStore, root: ROOT, siteStatus: () => articles.devServer.snapshot() }), sitesApi({ registry: registryStore }), frameApi({ registry: registryStore }), projectsApi({ registry: registryStore }), canvasDiagnosticsApi(), exportImageApi(), exportPageHtmlApi({ registry: registryStore }), previewInject(), hmr, contentRoutes(), loopbackListener()],
  server: {
    port: Number(process.env.PORT) || 5199,
    strictPort: true,
    host: '127.0.0.1',
    // .tmp/ 放一次性产物，其中 just preview 的数据快照会被服务自己写（账本、dist），
    // 监听它会让每次保存都触发整页刷新。
    // e2e 的 test-results-* / playwright-report-* 每条用例都写文件，同样不该进 watch。
    watch: { ignored: [path.join(ROOT, '.tmp') + '/**', path.join(ROOT, 'test-results*') + '/**', path.join(ROOT, 'playwright-report*') + '/**'] },
  },
});
