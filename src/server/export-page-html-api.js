import { ContractError } from '../workbench/lib/preview-contracts.js';
import { buildOfflinePage } from './lib/offline-page-builder.js';
import { OfflinePageExportError } from './lib/offline-page-export.js';

function readBody(req, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new OfflinePageExportError('request_too_large', 'request body is too large'));
        req.destroy && req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const buffer = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(buffer.length));
  res.end(buffer);
}

function errorStatus(error) {
  if (error instanceof OfflinePageExportError || error instanceof ContractError || error instanceof SyntaxError) return 400;
  return 500;
}

export function createExportPageHtmlHandler(options = {}) {
  const builder = options.builder || buildOfflinePage;
  const registry = options.registry;
  const fetchRemote = options.fetchRemote;
  return async function exportPageHtmlHandler(req, res, urlPath) {
    const scan = urlPath === '/api/export-page-html/scan';
    const download = urlPath === '/api/export-page-html';
    if ((!scan && !download) || req.method !== 'POST') return false;
    try {
      const body = JSON.parse(await readBody(req));
      const result = await builder({
        pageId: body && body.pageId,
        approvals: scan ? undefined : (body.approvals || []),
        registry,
        fetchRemote,
      });
      if (scan) {
        sendJson(res, 200, {
          pageId: result.pageId,
          title: result.title,
          filename: result.filename,
          sectionCount: result.sectionCount,
          frameCount: result.frameCount,
          remoteResources: result.remoteResources,
        });
        return true;
      }
      const buffer = Buffer.from(result.html, 'utf8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('X-Export-Sections', String(result.sectionCount));
      res.setHeader('X-Export-Frames', String(result.frameCount));
      res.setHeader('X-Export-Remote-Resources', String(result.remoteResources.length));
      res.end(buffer);
    } catch (error) {
      const status = errorStatus(error);
      sendJson(res, status, {
        error: status === 400 ? (error.code || 'invalid_offline_page_export') : 'offline_page_export_failed',
        message: String(error && error.message || error),
        detail: error && error.detail || undefined,
      });
    }
    return true;
  };
}

export default function exportPageHtmlApi(options = {}) {
  const handler = createExportPageHtmlHandler(options);
  return {
    name: 'export-page-html-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        if (!(await handler(req, res, urlPath))) next();
      });
    },
  };
}
