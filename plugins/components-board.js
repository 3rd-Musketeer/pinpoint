import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { templateOnly } from './template-only.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COMPONENTS = path.join(ROOT, 'components');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listComponentDirs() {
  if (!fs.existsSync(COMPONENTS)) return [];
  return fs.readdirSync(COMPONENTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name);
}

function loadMeta(id) {
  const metaPath = path.join(COMPONENTS, id, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = readJson(metaPath);
  meta.id = meta.id || id;
  meta.title = meta.title || id;
  meta.system = !!meta.system;
  meta.layout = meta.layout === 'column' ? 'column' : 'row';
  meta.variants = Array.isArray(meta.variants) ? meta.variants : [];
  return meta;
}

function orderedMetas() {
  const dirs = listComponentDirs();
  const indexPath = path.join(COMPONENTS, '_index.json');
  let order = [];
  if (fs.existsSync(indexPath)) {
    try {
      const idx = readJson(indexPath);
      order = Array.isArray(idx) ? idx : (idx.order || []);
    } catch (e) { /* ignore */ }
  }
  const seen = new Set();
  const metas = [];
  order.forEach((id) => {
    if (seen.has(id)) return;
    const m = loadMeta(id);
    if (m) { seen.add(id); metas.push(m); }
  });
  // Auto-discover components missing from _index.json (instance-local dirs);
  // template-only mode sticks to the tracked list so counts are deterministic.
  if (!templateOnly()) {
    dirs.sort().forEach((id) => {
      if (seen.has(id)) return;
      const m = loadMeta(id);
      if (m) { seen.add(id); metas.push(m); }
    });
  }
  // system primitives first, then product components (stable within each group by order)
  const sys = metas.filter((m) => m.system);
  const prod = metas.filter((m) => !m.system);
  return sys.concat(prod);
}

export function buildComponentsBoard() {
  const metas = orderedMetas();
  if (!metas.length) {
    return {
      title: 'Component Library',
      sections: [{
        id: '_empty',
        title: '暂无组件',
        layout: 'column',
        screens: [],
      }],
    };
  }
  return {
    title: 'Component Library',
    sections: metas.map((m) => ({
      id: m.id,
      title: m.title,
      layout: m.layout,
      shell: m.shell || 'app',
      screens: (m.variants.length ? m.variants : [{ id: 'catalog', title: 'Catalog' }]).map((v) => {
        const vid = typeof v === 'string' ? v : v.id;
        const title = typeof v === 'string' ? v : (v.title || v.id);
        const shell = typeof v === 'object' && v.shell ? v.shell : (m.shell || 'app');
        return {
          id: m.id + '/' + vid,
          title: title,
          shell: shell,
          src: 'components/' + m.id + '/' + vid + '.html',
        };
      }),
    })),
  };
}

export default function componentsBoard() {
  return {
    name: 'components-board',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (req.method === 'GET' && url === '/components/board.json') {
          try {
            const board = buildComponentsBoard();
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(board, null, 2));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: String(e) }));
          }
          return;
        }
        next();
      });
    },
  };
}
