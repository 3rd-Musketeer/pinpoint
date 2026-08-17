import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import annotateApi from './server/annotate-api.js';
import sitesApi from './server/sites-api.js';
import frameApi from './server/frame-api.js';
import frameNotesApi from './server/frame-notes-api.js';
import exportImageApi from './server/export-image-api.js';
import exportDocApi from './server/export-doc-api.js';
import previewHmr from './server/preview-hmr.js';
import previewInject from './server/preview-inject.js';
import componentsBoard from './server/components-board.js';
import templateOnlyPlugin from './server/template-only.js';
import { createRegistryStore } from './server/lib/registry-store.js';

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
  plugins: [react(), tailwindcss(), templateOnlyPlugin(), annotateApi({ registry: registryStore }), sitesApi({ registry: registryStore }), frameApi({ registry: registryStore }), frameNotesApi({ registry: registryStore }), exportImageApi(), exportDocApi({ registry: registryStore }), componentsBoard(), previewInject(), hmr],
  server: {
    port: Number(process.env.PORT) || 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
});
