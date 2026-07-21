import { defineConfig } from 'vite';
import annotateApi from './plugins/annotate-api.js';
import previewHmr from './plugins/preview-hmr.js';
import componentsBoard from './plugins/components-board.js';
import templateOnlyPlugin from './plugins/template-only.js';

export default defineConfig({
  plugins: [templateOnlyPlugin(), annotateApi(), componentsBoard(), previewHmr()],
  server: {
    port: Number(process.env.PORT) || 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
});
