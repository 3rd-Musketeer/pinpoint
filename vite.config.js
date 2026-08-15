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
import componentsBoard from './server/components-board.js';
import templateOnlyPlugin from './server/template-only.js';
import { createRegistryStore } from './server/lib/registry-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// One live registry view shared by every consumer (annotate API / sites
// serving / doc export): POST /registry/reload swaps the snapshot once and
// all of them see it — no restart after `pinpoint add`.
const registryStore = createRegistryStore({ root: ROOT });

export default defineConfig({
  plugins: [react(), tailwindcss(), templateOnlyPlugin(), annotateApi({ registry: registryStore }), sitesApi({ registry: registryStore }), frameApi({ registry: registryStore }), frameNotesApi(), exportImageApi(), exportDocApi({ registry: registryStore }), componentsBoard(), previewHmr()],
  server: {
    port: Number(process.env.PORT) || 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
});
