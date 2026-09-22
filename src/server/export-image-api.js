import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReqUrl } from './lib/req-url.js';

import { chromium } from '@playwright/test';

import {
  ExportContractError,
  exportFilename,
  exportMime,
  validateExportRequest,
} from './lib/export-contract.js';
import { readWorkbenchInlineStyles } from './lib/frame-doc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MAX_RENDER_EDGE = 16384;

// index.html 内联样式由 frame-doc 统一读取（/api/frame 嵌入页共用同一 SSOT）。
function workbenchCss() {
  return `${fs.readFileSync(path.join(ROOT, 'content', 'kits', 'ios', 'ios-kit.css'), 'utf8')}\n${readWorkbenchInlineStyles()}`;
}

function readBody(req, maxBytes = 13 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ExportContractError('request', 'body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function exportCss(request) {
  const background = request.background === 'transparent'
    ? 'transparent'
    : request.background === 'white' ? '#fff' : '#faf8f4';
  const padding = request.kind === 'frame' ? 48 : 56;
  return `
    html,body{margin:0!important;width:max-content!important;height:max-content!important;min-width:0!important;min-height:0!important;overflow:visible!important;background:transparent!important}
    body{display:block!important;padding:0!important;color:#1d1d1f!important}
    #wb-export-root{display:inline-block!important;box-sizing:border-box!important;padding:${padding}px!important;background:${background}!important;color:#1d1d1f!important}
    #wb-export-content{display:block!important;width:max-content!important;min-width:0!important}
    #wb-export-content>.wb-screen{display:flex!important}
    #wb-export-content>.wb-lib-item{position:relative!important}
    #wb-export-root,#wb-export-root *{animation:none!important;transition:none!important;caret-color:transparent!important}
    #wb-export-root [data-export-ui]{display:none!important}
  `;
}

function shellHtml(request, origin) {
  const tokenStyle = Object.entries(request.tokens)
    .map(([key, value]) => `${key}:${String(value).replace(/[;{}]/g, '')}`)
    .join(';');
  return `<!doctype html><html data-annotate="off"><head><meta charset="utf-8"><base href="${origin}/"><style>${workbenchCss()}</style><style>${exportCss(request)}</style></head><body><main id="wb-export-root" style="${tokenStyle}"><div id="wb-export-content">${request.html}</div></main><script>
    document.querySelectorAll('[data-export-scroll-top]').forEach(function(el){el.scrollTop=Number(el.dataset.exportScrollTop)||0;el.scrollLeft=Number(el.dataset.exportScrollLeft)||0});
  <\/script></body></html>`;
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.complete
      ? Promise.resolve()
      : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export function createExportRenderer(options = {}) {
  let browserPromise = null;
  const launch = options.launch || (() => chromium.launch({ headless: true }));

  async function getBrowser() {
    if (!browserPromise) browserPromise = launch();
    return browserPromise;
  }

  async function render(request, origin) {
    const browser = await getBrowser();
    const context = await browser.newContext({
      deviceScaleFactor: request.scale,
      viewport: { width: 1920, height: 1080 },
      colorScheme: 'light',
    });
    const page = await context.newPage();
    try {
      await page.setContent(shellHtml(request, origin), { waitUntil: 'load' });
      await waitForAssets(page);
      const box = await page.locator('#wb-export-root').boundingBox();
      if (!box || box.width < 1 || box.height < 1) throw new Error('export target has no visible bounds');
      const pixelWidth = Math.ceil(box.width * request.scale);
      const pixelHeight = Math.ceil(box.height * request.scale);
      if (pixelWidth > MAX_RENDER_EDGE || pixelHeight > MAX_RENDER_EDGE) {
        const hint = request.scale === 2 ? ' Retry at 1x.' : '';
        throw new ExportContractError('target', `rendered image ${pixelWidth}×${pixelHeight} exceeds ${MAX_RENDER_EDGE}px.${hint}`);
      }
      const client = await context.newCDPSession(page);
      const result = await client.send('Page.captureScreenshot', {
        format: request.format,
        quality: request.format === 'webp' ? 86 : undefined,
        fromSurface: true,
        captureBeyondViewport: true,
        optimizeForSpeed: false,
        clip: { x: box.x, y: box.y, width: Math.ceil(box.width), height: Math.ceil(box.height), scale: 1 },
      });
      return { buffer: Buffer.from(result.data, 'base64'), pixelWidth, pixelHeight };
    } finally {
      await context.close();
    }
  }

  async function close() {
    if (!browserPromise) return;
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
  }

  return { render, close };
}

function requestOrigin(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  return `${protocol}://${req.headers.host || '127.0.0.1:5199'}`;
}

function sendExportError(res, error) {
  const status = error instanceof ExportContractError || error instanceof SyntaxError ? 400 : 500;
  sendJson(res, status, { error: status === 400 ? 'invalid_export' : 'export_failed', message: String(error && error.message || error) });
}

async function handleExportImage(req, res, renderer) {
  const request = validateExportRequest(JSON.parse(await readBody(req)));
  const result = await renderer.render(request, requestOrigin(req));
  res.statusCode = 200;
  res.setHeader('Content-Type', exportMime(request.format));
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(request)}"`);
  res.setHeader('Content-Length', String(result.buffer.length));
  res.setHeader('X-Export-Width', String(result.pixelWidth));
  res.setHeader('X-Export-Height', String(result.pixelHeight));
  res.end(result.buffer);
}

export default function exportImageApi(options = {}) {
  const renderer = options.renderer || createExportRenderer(options);
  return {
    name: 'export-image-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = parseReqUrl(req).pathname;
        if (req.method !== 'POST') return next();
        try {
          if (urlPath === '/api/export-image') return await handleExportImage(req, res, renderer);
          return next();
        } catch (error) {
          sendExportError(res, error);
        }
      });
      server.httpServer?.once('close', () => { renderer.close().catch(() => {}); });
    },
  };
}
