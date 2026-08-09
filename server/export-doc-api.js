import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { projectDataDir } from './lib/annotate-data-dir.js';
import { pageKeyFromPathname } from '../lib/annotate-page-key.js';
import { annotationSlug, createAnnotationStore } from './lib/annotation-store.js';
import {
  buildExportBakeScript,
  formatCommentsTextSection,
  injectCommentsExportHtml,
  prepareExportAnnotations,
} from './lib/export-doc-bake.js';
import {
  ExportDocContractError,
  EXPORT_DOC_W,
  exportDocFilename,
  exportDocMime,
  stripDocumentCss,
  validateExportDocRequest,
  validateExportDocTokenRequest,
} from './lib/export-doc-contract.js';
import { estimateImageTokens } from './lib/export-doc-image-tokens.js';
import { estimateDocTokens } from './lib/export-doc-tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PREVIEWS_ROOT = path.join(ROOT, 'previews');
const MAX_RENDER_EDGE = 16384;

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ExportDocContractError('request', 'body is too large'));
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

function resolveDocFile(src) {
  const abs = path.resolve(ROOT, src);
  const previewsRoot = path.resolve(PREVIEWS_ROOT);
  if (abs !== previewsRoot && !abs.startsWith(previewsRoot + path.sep)) {
    throw new ExportDocContractError('src', 'must resolve under previews/');
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new ExportDocContractError('src', `file not found: ${src}`);
  }
  return abs;
}

/** Resolve annotation page key for a previews/-relative src. */
export function annotationPageKeyForSrc(src) {
  const normalized = String(src || '').replace(/^\/+/, '');
  return annotationSlug(pageKeyFromPathname('/' + normalized));
}

function createDocImageRenderer(options = {}) {
  let browserPromise = null;
  const launch = options.launch || (() => chromium.launch({ headless: true }));

  async function getBrowser() {
    if (!browserPromise) browserPromise = launch();
    return browserPromise;
  }

  async function openDocPage(request, origin, bakeOptions) {
    const comments = !!(request.comments && bakeOptions && bakeOptions.annotations);
    const viewportWidth = request.viewportWidth || EXPORT_DOC_W;
    const browser = await getBrowser();
    const context = await browser.newContext({
      deviceScaleFactor: request.scale,
      viewport: { width: viewportWidth, height: 1200 },
      colorScheme: 'light',
    });
    const page = await context.newPage();
    // Keep the live annotate editor out of delivery exports.
    await page.route('**/annotate.js', (route) => route.abort());
    const url = `${origin}/${request.src}`;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    let bakeResult = null;
    if (comments) {
      const script = buildExportBakeScript(bakeOptions.annotations, {
        bubbles: true,
        docW: EXPORT_DOC_W,
      });
      await page.addScriptTag({ content: script });
      bakeResult = await page.evaluate(() => window.__EXPORT_BAKE_RESULT__ || null);
      // Let overlay height settle before screenshot / HTML capture.
      await page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
    }

    const scrollHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    ));
    const pixelWidth = Math.ceil(viewportWidth * request.scale);
    const pixelHeight = Math.ceil(scrollHeight * request.scale);
    return { context, page, pixelWidth, pixelHeight, bakeResult, viewportWidth };
  }

  async function measure(request, origin, bakeOptions) {
    const { context, pixelWidth, pixelHeight, bakeResult } = await openDocPage(request, origin, bakeOptions);
    try {
      return { pixelWidth, pixelHeight, bakeResult };
    } finally {
      await context.close();
    }
  }

  async function render(request, origin, bakeOptions) {
    const { context, page, pixelWidth, pixelHeight, bakeResult } = await openDocPage(request, origin, bakeOptions);
    try {
      if (pixelWidth > MAX_RENDER_EDGE || pixelHeight > MAX_RENDER_EDGE) {
        const hint = request.scale === 2 ? ' Retry at 1x.' : '';
        throw new ExportDocContractError(
          'target',
          `rendered image ${pixelWidth}×${pixelHeight} exceeds ${MAX_RENDER_EDGE}px.${hint}`,
        );
      }
      const buffer = await page.screenshot({
        type: request.format,
        fullPage: true,
        quality: request.format === 'webp' ? 86 : undefined,
      });
      return { buffer, pixelWidth, pixelHeight, bakeResult };
    } finally {
      await context.close();
    }
  }

  async function bakeHtmlOverlay(request, origin, bakeOptions) {
    const imageRequest = {
      ...request,
      mode: 'image',
      format: 'png',
      scale: 1,
      viewportWidth: EXPORT_DOC_W,
      comments: true,
    };
    const { context, page, bakeResult } = await openDocPage(imageRequest, origin, bakeOptions);
    try {
      const overlayHtml = await page.evaluate(() => {
        const overlay = document.getElementById('ann-export-overlay');
        const style = document.querySelector('style[data-export-comments]');
        return {
          overlay: overlay ? overlay.outerHTML : '',
          style: style ? style.textContent : '',
        };
      });
      return { ...overlayHtml, bakeResult };
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

  return { render, measure, bakeHtmlOverlay, close };
}

export default function exportDocApi(options = {}) {
  const renderer = options.renderer || createDocImageRenderer(options);
  const dataDir = options.dataDir || process.env.HTML_ANNOTATE_DATA_DIR || projectDataDir(ROOT);
  const store = options.store || createAnnotationStore({ dataDir });
  const tokenCache = new Map();

  function readAnnotationsForSrc(src) {
    const pageKey = annotationPageKeyForSrc(src);
    const doc = store.readDoc(pageKey);
    return Array.isArray(doc.annotations) ? doc.annotations : [];
  }

  function tokensForHtml(src, mode, comments) {
    const filePath = resolveDocFile(src);
    const stat = fs.statSync(filePath);
    const key = `${src}\0${mode}\0${comments ? 1 : 0}\0${stat.mtimeMs}\0${stat.size}`;
    if (tokenCache.has(key)) return tokenCache.get(key);
    let html = fs.readFileSync(filePath, 'utf8');
    if (mode === 'html-no-css') html = stripDocumentCss(html);
    if (comments) {
      if (mode === 'html-no-css') {
        html += '\n' + formatCommentsTextSection(readAnnotationsForSrc(src));
      } else {
        // Approximate: source + baked comment text (positions ignored for token estimate).
        html += '\n' + formatCommentsTextSection(readAnnotationsForSrc(src));
      }
    }
    const estimate = estimateDocTokens(html, mode);
    tokenCache.set(key, estimate);
    if (tokenCache.size > 32) {
      const oldest = tokenCache.keys().next().value;
      tokenCache.delete(oldest);
    }
    return estimate;
  }

  async function tokensForImage(request, origin) {
    const filePath = resolveDocFile(request.src);
    const stat = fs.statSync(filePath);
    const anns = request.comments ? readAnnotationsForSrc(request.src) : [];
    const key = [
      request.src, 'image', request.comments ? 1 : 0, request.viewportWidth, request.scale,
      stat.mtimeMs, stat.size, anns.length,
    ].join('\0');
    if (tokenCache.has(key)) return tokenCache.get(key);
    const size = await renderer.measure({
      src: request.src,
      scale: request.scale,
      viewportWidth: request.viewportWidth,
      format: 'png',
      comments: !!request.comments,
    }, origin, request.comments ? { annotations: anns } : null);
    const estimate = estimateImageTokens(size.pixelWidth, size.pixelHeight);
    tokenCache.set(key, estimate);
    if (tokenCache.size > 32) {
      const oldest = tokenCache.keys().next().value;
      tokenCache.delete(oldest);
    }
    return estimate;
  }

  return {
    name: 'export-doc-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        if (urlPath === '/api/export-doc-tokens' && req.method === 'POST') {
          try {
            const request = validateExportDocTokenRequest(JSON.parse(await readBody(req)));
            if (request.mode === 'image') {
              const protocol = req.headers['x-forwarded-proto'] || 'http';
              const origin = `${protocol}://${req.headers.host || '127.0.0.1:5199'}`;
              sendJson(res, 200, await tokensForImage(request, origin));
            } else {
              sendJson(res, 200, tokensForHtml(request.src, request.mode, request.comments));
            }
          } catch (error) {
            const status = error instanceof ExportDocContractError || error instanceof SyntaxError ? 400 : 500;
            sendJson(res, status, {
              error: status === 400 ? 'invalid_export_doc_tokens' : 'export_doc_tokens_failed',
              message: String(error && error.message || error),
            });
          }
          return;
        }
        if (urlPath !== '/api/export-doc' || req.method !== 'POST') return next();
        try {
          const request = validateExportDocRequest(JSON.parse(await readBody(req)));
          const filePath = resolveDocFile(request.src);
          const filename = exportDocFilename(request);
          const annotations = request.comments ? readAnnotationsForSrc(request.src) : [];
          const bakeOptions = request.comments ? { annotations } : null;

          if (request.mode === 'html-no-css') {
            let html = stripDocumentCss(fs.readFileSync(filePath, 'utf8'));
            if (request.comments) html += '\n' + formatCommentsTextSection(annotations);
            const buffer = Buffer.from(html, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', exportDocMime(request));
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', String(buffer.length));
            if (request.comments) {
              res.setHeader('X-Export-Comments', String(prepareExportAnnotations(annotations).length));
            }
            res.end(buffer);
            return;
          }

          if (request.mode === 'html-full') {
            let html = fs.readFileSync(filePath, 'utf8');
            if (request.comments) {
              // Place marks in the viewer's browser so @media / centering match.
              // (Static absolute coords from a 920 Playwright bake drift on wide windows.)
              html = injectCommentsExportHtml(html, annotations);
              res.setHeader('X-Export-Comments', String(prepareExportAnnotations(annotations).length));
            }
            const buffer = Buffer.from(html, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', exportDocMime(request));
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', String(buffer.length));
            res.end(buffer);
            return;
          }

          // image mode
          const protocol = req.headers['x-forwarded-proto'] || 'http';
          const origin = `${protocol}://${req.headers.host || '127.0.0.1:5199'}`;
          const imageRequest = {
            ...request,
            viewportWidth: request.viewportWidth || EXPORT_DOC_W,
          };
          const result = await renderer.render(imageRequest, origin, bakeOptions);
          res.statusCode = 200;
          res.setHeader('Content-Type', exportDocMime(request));
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', String(result.buffer.length));
          res.setHeader('X-Export-Width', String(result.pixelWidth));
          res.setHeader('X-Export-Height', String(result.pixelHeight));
          if (result.bakeResult) {
            res.setHeader('X-Export-Comments', String(result.bakeResult.baked || 0));
            res.setHeader('X-Export-Comments-Broken', String(result.bakeResult.broken || 0));
          }
          res.end(result.buffer);
        } catch (error) {
          const status = error instanceof ExportDocContractError || error instanceof SyntaxError ? 400 : 500;
          sendJson(res, status, {
            error: status === 400 ? 'invalid_export_doc' : 'export_doc_failed',
            message: String(error && error.message || error),
          });
        }
      });
      server.httpServer?.once('close', () => { renderer.close().catch(() => {}); });
    },
  };
}
