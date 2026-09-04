import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { bucketDir, dataRoot, DEFAULT_ENTRY } from './lib/annotate-data-dir.js';
import { pageKeyFromPathname } from '../shared/annotate-page-key.js';
import { annotationSlug, createAnnotationStore } from './lib/annotation-store.js';
import { loadRegistry } from './lib/registry.js';
import { createExportRenderer } from './export-image-api.js';
import { frameExportSnapshot, resolveFrameTarget } from './lib/frame-doc.js';
import {
  buildExportBakeScript,
  buildMentionSwapScript,
  formatCommentsTextSection,
  injectCommentsExportHtml,
  mentionImgHtml,
  mentionTextMarker,
  parseMentionMounts,
  prepareExportAnnotations,
  replaceMentionMounts,
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
const ROOT = path.resolve(__dirname, '..', '..');
const CONTENT_ROOT = path.join(ROOT, 'content');
const PREVIEWS_ROOT = path.join(CONTENT_ROOT, 'previews');
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

function resolveDocFile(src, registry) {
  // Registry dir/file entries resolve through their registered path (read-only).
  if (src.startsWith('sites/')) {
    const id = src.split('/')[1];
    const entry = registry && registry.resolve(id);
    if (!entry || (entry.kind !== 'dir' && entry.kind !== 'file')) {
      throw new ExportDocContractError('src', `unknown site entry: ${id}`);
    }
    // Synthesized boards percent-encode the filename in src, so the browser
    // pathname and the annotation page-key hash agree; decode once here to get
    // back to the on-disk name.
    let rest;
    try {
      rest = decodeURIComponent(src.split('/').slice(2).join('/'));
    } catch {
      throw new ExportDocContractError('src', `file not found: ${src}`);
    }
    if (entry.kind === 'file') {
      // A file entry whitelists exactly one file — the registered path itself.
      if (rest !== path.basename(entry.path)) {
        throw new ExportDocContractError('src', `file not found: ${src}`);
      }
      if (!fs.existsSync(entry.path) || !fs.statSync(entry.path).isFile()) {
        throw new ExportDocContractError('src', `file not found: ${src}`);
      }
      return path.resolve(entry.path);
    }
    const base = path.resolve(entry.path);
    const abs = path.resolve(base, rest);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new ExportDocContractError('src', 'path traversal is not allowed');
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new ExportDocContractError('src', `file not found: ${src}`);
    }
    return abs;
  }
  const abs = path.resolve(CONTENT_ROOT, src);
  const previewsRoot = path.resolve(PREVIEWS_ROOT);
  if (abs !== previewsRoot && !abs.startsWith(previewsRoot + path.sep)) {
    throw new ExportDocContractError('src', 'must resolve under previews/');
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new ExportDocContractError('src', `file not found: ${src}`);
  }
  return abs;
}

/** Registry entry whose bucket holds annotations for src (default: pinpoint). */
export function entryIdForSrc(src, registry) {
  if (!String(src).startsWith('sites/')) return DEFAULT_ENTRY;
  const id = String(src).split('/')[1];
  const entry = registry && registry.resolve(id);
  return entry && (entry.kind === 'dir' || entry.kind === 'file') ? id : DEFAULT_ENTRY;
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
    const mentions = bakeOptions && Array.isArray(bakeOptions.mentions) ? bakeOptions.mentions : [];
    const viewportWidth = request.viewportWidth || EXPORT_DOC_W;
    const browser = await getBrowser();
    const context = await browser.newContext({
      deviceScaleFactor: request.scale,
      viewport: { width: viewportWidth, height: 1200 },
      colorScheme: 'light',
    });
    const page = await context.newPage();
    // Keep the live annotate editor out of delivery exports: previews/ 与 /sites/
    // 都是 serve 即注入（2026-08-17 契约统一），渲染请求一律 ?annotate=off 豁免；
    // annotate.js route abort 留作第二道网。
    // 标注客户端不在 → mention 挂载点不水合（保持空 div），由下面的换图脚本烤入。
    await page.route('**/annotate.js', (route) => route.abort());
    const url = `${origin}/${request.src}?annotate=off`;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // 阶段 5：mention 的嵌入 frame 烤成静态图（2× PNG dataURL，导出即静态）。
    if (mentions.length) {
      await page.addScriptTag({ content: buildMentionSwapScript(mentions) });
      await page.evaluate(async () => {
        await Promise.all([...document.images].map((image) => image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          })));
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
    }

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
  // 阶段 5：mention 烤图复用 /api/export-image 的渲染器（同一套机壳快照管线），
  // 不起新管线；fragment 屏的快照负载由 server/lib/frame-doc.js 组装。
  const frameRenderer = options.frameRenderer || createExportRenderer(options);
  // Exported documents live under previews/ (pinpoint bucket) or, for
  // sites/<entry-id>/ srcs, in that registry entry's bucket.
  const root = options.dataRoot || dataRoot();
  const registry = options.registry || loadRegistry({ root: ROOT });
  const stores = new Map();
  stores.set(DEFAULT_ENTRY, options.store || createAnnotationStore({ dataDir: bucketDir(root, DEFAULT_ENTRY) }));
  const tokenCache = new Map();

  function storeFor(entryId) {
    if (!stores.has(entryId)) {
      stores.set(entryId, createAnnotationStore({ dataDir: bucketDir(root, entryId) }));
    }
    return stores.get(entryId);
  }

  function readAnnotationsForSrc(src) {
    const pageKey = annotationPageKeyForSrc(src);
    const doc = storeFor(entryIdForSrc(src, registry)).readDoc(pageKey);
    return Array.isArray(doc.annotations) ? doc.annotations : [];
  }

  // mention 挂载点 → 烤图（每个唯一 frame 值渲一次）。解析/渲染失败的挂载点
  // 不进 map（导出不断流，原样留空 div）。
  async function bakeMentionMap(html, origin, viewportWidth) {
    const mounts = parseMentionMounts(html);
    const values = [...new Set(mounts.map((m) => m.value))];
    const map = new Map();
    for (const value of values) {
      const slash = value.indexOf('/');
      const pageId = value.slice(0, slash);
      const screenId = value.slice(slash + 1);
      try {
        const target = resolveFrameTarget(pageId, screenId, { registry });
        if (target.kind === 'doc') {
          // doc 屏烤图复用文档长图渲染：/api/frame 302 到该屏自己的 URL。
          const result = await renderer.render({
            src: `api/frame?page=${encodeURIComponent(pageId)}&screen=${encodeURIComponent(screenId)}&annotate=off`,
            mode: 'image',
            format: 'png',
            scale: 2,
            viewportWidth,
            comments: false,
          }, origin, null);
          map.set(value, {
            dataUrl: `data:image/png;base64,${result.buffer.toString('base64')}`,
            width: result.pixelWidth / 2,
            height: result.pixelHeight / 2,
            title: target.title,
          });
        } else {
          const snapshot = await frameExportSnapshot(target);
          const result = await frameRenderer.render(snapshot, origin);
          map.set(value, {
            dataUrl: `data:image/png;base64,${result.buffer.toString('base64')}`,
            width: result.pixelWidth / 2,
            height: result.pixelHeight / 2,
            title: target.title,
          });
        }
      } catch {
        // unknown page/screen 或渲染失败：挂载点原样保留（活文档里本也是未水合态）。
      }
    }
    return map;
  }

  function mentionSwapEntries(map) {
    return [...map.entries()].map(([value, img]) => ({
      value,
      dataUrl: img.dataUrl,
      width: Math.round(img.width),
      height: Math.round(img.height),
      alt: `@frame:${value}${img.title ? ` · ${img.title}` : ''}`,
    }));
  }

  /** html-no-css 的挂载点 → 文本引用（顺带解析标题，失败用裸值）。 */
  function replaceMentionsWithTextMarkers(html) {
    return replaceMentionMounts(html, (mount) => {
      let title = '';
      try {
        const target = resolveFrameTarget(mount.pageId, mount.screenId, { registry });
        title = target.title || '';
      } catch { /* 未解析也出引用，标题缺省 */ }
      return mentionTextMarker(mount, title);
    });
  }

  function tokensForHtml(src, mode, comments) {
    const filePath = resolveDocFile(src, registry);
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
    const filePath = resolveDocFile(request.src, registry);
    const stat = fs.statSync(filePath);
    const anns = request.comments ? readAnnotationsForSrc(request.src) : [];
    const key = [
      request.src, 'image', request.comments ? 1 : 0, request.viewportWidth, request.scale,
      stat.mtimeMs, stat.size, anns.length,
    ].join('\0');
    if (tokenCache.has(key)) return tokenCache.get(key);
    const mentionMap = await bakeMentionMap(fs.readFileSync(filePath, 'utf8'), origin, request.viewportWidth || EXPORT_DOC_W);
    const size = await renderer.measure({
      src: request.src,
      scale: request.scale,
      viewportWidth: request.viewportWidth,
      format: 'png',
      comments: !!request.comments,
    }, origin, {
      annotations: request.comments ? anns : undefined,
      mentions: mentionSwapEntries(mentionMap),
    });
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
          const filePath = resolveDocFile(request.src, registry);
          const filename = exportDocFilename(request);
          const annotations = request.comments ? readAnnotationsForSrc(request.src) : [];

          if (request.mode === 'html-no-css') {
            let html = stripDocumentCss(fs.readFileSync(filePath, 'utf8'));
            // mention 挂载点 → 文本引用（本模式定位是喂 AI：不渲图、不塞 base64）
            html = replaceMentionsWithTextMarkers(html).html;
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
            // mention 挂载点 → 烤图 <img>（自包含 dataURL，外发不依赖服务在线）
            let framesBaked = 0;
            if (parseMentionMounts(html).length) {
              const protocol = req.headers['x-forwarded-proto'] || 'http';
              const origin = `${protocol}://${req.headers.host || '127.0.0.1:5199'}`;
              const baked = await bakeMentionMap(html, origin, EXPORT_DOC_W);
              const replaced = replaceMentionMounts(html, (mount) => {
                const img = baked.get(mount.value);
                return img ? mentionImgHtml(mount, img) : null;
              });
              html = replaced.html;
              framesBaked = replaced.replaced;
            }
            if (request.comments) {
              // Place marks in the viewer's browser so @media / centering match.
              // (Static absolute coords from a 920 Playwright bake drift on wide windows.)
              html = injectCommentsExportHtml(html, annotations);
              res.setHeader('X-Export-Comments', String(prepareExportAnnotations(annotations).length));
            }
            if (framesBaked) res.setHeader('X-Export-Frames', String(framesBaked));
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
          const mentionMap = await bakeMentionMap(fs.readFileSync(filePath, 'utf8'), origin, imageRequest.viewportWidth);
          const result = await renderer.render(imageRequest, origin, {
            annotations: request.comments ? annotations : undefined,
            mentions: mentionSwapEntries(mentionMap),
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', exportDocMime(request));
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', String(result.buffer.length));
          res.setHeader('X-Export-Width', String(result.pixelWidth));
          res.setHeader('X-Export-Height', String(result.pixelHeight));
          if (mentionMap.size) res.setHeader('X-Export-Frames', String(mentionMap.size));
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
      server.httpServer?.once('close', () => {
        renderer.close().catch(() => {});
        frameRenderer.close().catch(() => {});
      });
    },
  };
}
