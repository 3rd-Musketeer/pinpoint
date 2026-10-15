import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import contentRoutes from './content-routes.js';
import frameApi from './frame-api.js';
import { createPreviewInjectHandler } from './preview-inject.js';
import { createSitesHandler } from './sites-api.js';
import { createProjectsHandler } from './projects-api.js';

export const SAFE = 'SAFE_CONTENT_P1a';
export const SECRET = 'ADJACENT_SECRET_P1a';
export const jsx = (text) => `export default function View() {\n  return <div>${text}</div>;\n}\n`;
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export async function fixture(t, { article = false, template = false, alias = false, files, board } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-source-boundary-'));
  const data = path.join(root, 'data');
  const previous = process.env.PINPOINT_DATA_DIR;
  process.env.PINPOINT_DATA_DIR = data;
  const project = path.join(root, 'project');
  const page = article ? path.join(project, 'docs/pinpoint/articles/demo')
    : template ? path.join(root, 'content/previews/demo') : path.join(root, 'legacy');
  write(path.join(page, 'board.json'), JSON.stringify(board || { sections: [{ id: 's', shell: 'app', screens: ['view'] }] }));
  if (article) {
    write(path.join(project, 'docs/pinpoint/project.json'), '{"id":"demo"}');
    write(path.join(page, 'index.mdx'), '<Section id="s" title="S">\n<Canvas frames={["view"]} />\n<Figure src="figures/view.jsx" />\n</Section>');
  }
  for (const [rel, text] of Object.entries(files || {})) write(path.join(page, rel), text);
  const aliasPath = path.join(root, 'registered-alias');
  if (alias) fs.symlinkSync(article ? project : page, aliasPath);
  const registry = { entries: [{ id: 'legacy', kind: 'dir', path: alias && !article ? aliasPath : page }], projects: article ? [{ id: 'demo', path: alias ? aliasPath : project }] : [] };
  registry.resolve = (id) => registry.entries.find((entry) => entry.id === id);
  const sites = createSitesHandler({ registry });
  const projects = createProjectsHandler({ registry });
  let frame;
  frameApi({ registry }).configureServer({ middlewares: { use(fn) { frame = fn; } } });
  let content;
  contentRoutes().configureServer({ config: { root }, middlewares: { use(fn) { content = fn; } } });
  const preview = createPreviewInjectHandler({ root: path.join(root, 'content') });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/projects')) return projects(req, res, () => { res.statusCode = 404; res.end(); });
      if (url.pathname === '/api/frame') return await frame(req, res, () => { res.statusCode = 404; res.end(); });
      if (await sites(req, res, url.pathname)) return;
      if (preview(req, res, url.pathname, url.search.slice(1))) return;
      await content(req, res, () => {
        const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
        res.end(fs.readFileSync(file));
      });
    } catch (error) { res.statusCode = 500; res.end(String(error.message)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.PINPOINT_DATA_DIR;
    else process.env.PINPOINT_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const get = async (url) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: res.status, text: await res.text() };
  };
  const replace = (rel, text) => {
    const file = path.join(page, rel);
    const before = fs.statSync(file);
    const outside = path.join(root, 'outside', rel);
    write(outside, text);
    fs.utimesSync(outside, before.atime, before.mtime);
    fs.unlinkSync(file);
    fs.symlinkSync(outside, file);
  };
  return { root, page, project, data, get, replace };
}
