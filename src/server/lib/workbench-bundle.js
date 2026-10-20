import fs from 'node:fs';
import path from 'node:path';
import { resolveContainedFile } from './servable-file.js';

export function workbenchMode({ root, env = process.env }) {
  const mode = env.PINPOINT_WORKBENCH_MODE || (fs.existsSync(path.join(root, '.tmp/workbench-dist/enabled')) ? 'bundle' : 'dev');
  if (!['dev', 'bundle'].includes(mode)) throw new Error(`PINPOINT_WORKBENCH_MODE 必须是 dev 或 bundle，收到 ${mode}`);
  return mode;
}

export function createWorkbenchBundleHandler({ root, dist = process.env.PINPOINT_WORKBENCH_DIST || path.join(root, '.tmp/workbench-dist') }) {
  // 启动时固定本版壳页；后续构建或发布不会让在跑的旧服务读到新 HTML。
  let html;
  try { html = fs.readFileSync(path.join(dist, 'index.html')); }
  catch (error) { throw new Error(`工作台产物不可读，请先运行 npm run build:workbench：${error.message}`); }
  return (req, res, shell = false) => {
    const pathname = req.url.split('?')[0];
    const asset = pathname.startsWith('/workbench/assets/');
    if (!shell && !asset) return false;
    res.setHeader('Cache-Control', shell ? 'no-store' : 'public, max-age=31536000, immutable');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end();
      return true;
    }
    let body = html;
    if (!shell) {
      let rel;
      try { rel = decodeURIComponent(pathname.slice('/workbench/'.length)); } catch { rel = ''; }
      const found = /^assets\/[\w-]+-[\w-]+\.(js|css)$/.test(rel) && resolveContainedFile(dist, rel, { index: false });
      if (!found || !found.file) {
        res.statusCode = 404;
        res.setHeader('Cache-Control', 'no-store');
        res.end('workbench asset not found');
        return true;
      }
      body = fs.readFileSync(found.file);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', shell ? 'text/html; charset=utf-8' : (pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'));
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
