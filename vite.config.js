import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import annotateApi from './src/server/annotate-api.js';
import sitesApi from './src/server/sites-api.js';
import frameApi from './src/server/frame-api.js';
import canvasDiagnosticsApi from './src/server/canvas-diagnostics-api.js';
import exportImageApi from './src/server/export-image-api.js';
import exportPageHtmlApi from './src/server/export-page-html-api.js';
import previewHmr from './src/server/preview-hmr.js';
import previewInject from './src/server/preview-inject.js';
import contentRoutes from './src/server/content-routes.js';
import { createRegistryStore } from './src/server/lib/registry-store.js';

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

export default defineConfig({
  plugins: [react(), tailwindcss(), annotateApi({ registry: registryStore, root: ROOT }), sitesApi({ registry: registryStore }), frameApi({ registry: registryStore }), canvasDiagnosticsApi(), exportImageApi(), exportPageHtmlApi({ registry: registryStore }), previewInject(), hmr, contentRoutes()],
  server: {
    port: Number(process.env.PORT) || 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
});
