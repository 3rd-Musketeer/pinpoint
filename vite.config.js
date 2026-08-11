import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import annotateApi from './server/annotate-api.js';
import sitesApi from './server/sites-api.js';
import frameNotesApi from './server/frame-notes-api.js';
import exportImageApi from './server/export-image-api.js';
import exportDocApi from './server/export-doc-api.js';
import previewHmr from './server/preview-hmr.js';
import componentsBoard from './server/components-board.js';
import templateOnlyPlugin from './server/template-only.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), templateOnlyPlugin(), annotateApi(), sitesApi(), frameNotesApi(), exportImageApi(), exportDocApi(), componentsBoard(), previewHmr()],
  server: {
    port: Number(process.env.PORT) || 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
});
