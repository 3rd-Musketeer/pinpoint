import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;
const RESOURCE_ATTRS = new Set(['src', 'poster']);

export class OfflinePageExportError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'OfflinePageExportError';
    this.code = code;
    this.detail = detail;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeInlineScript(source) {
  return String(source).replace(/<\/script/gi, '<\\/script');
}

function escapeInlineStyle(source) {
  return String(source).replace(/<\/style/gi, '<\\/style');
}

function inside(root, candidate) {
  const base = path.resolve(root);
  const file = path.resolve(candidate);
  return file === base || file.startsWith(base + path.sep);
}

function splitSuffix(ref) {
  const text = String(ref || '').trim();
  const hashAt = text.indexOf('#');
  return hashAt < 0
    ? { resource: text, suffix: '' }
    : { resource: text.slice(0, hashAt), suffix: text.slice(hashAt) };
}

function mimeFor(file, header = '') {
  const declared = String(header || '').split(';')[0].trim().toLowerCase();
  if (declared) return declared;
  const ext = path.extname(String(file || '')).toLowerCase();
  return ({
    '.avif': 'image/avif', '.css': 'text/css', '.gif': 'image/gif', '.html': 'text/html',
    '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript',
    '.json': 'application/json', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
    '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
    '.webm': 'video/webm', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  })[ext] || 'application/octet-stream';
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function dataUrl(bytes, mime, suffix = '') {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}${suffix}`;
}

async function replaceAsync(text, pattern, replacer) {
  const matches = [...String(text).matchAll(pattern)];
  if (!matches.length) return String(text);
  let cursor = 0;
  let output = '';
  for (const match of matches) {
    output += String(text).slice(cursor, match.index);
    output += await replacer(...match);
    cursor = match.index + match[0].length;
  }
  return output + String(text).slice(cursor);
}

function portablePreviewScript(source, label) {
  const text = String(source);
  const blocked = [
    [/\bfetch\s*\(/, 'fetch'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\s*\(/, 'WebSocket'],
    [/\bEventSource\s*\(/, 'EventSource'],
    [/\bimport\s*\(/, 'dynamic import'],
    [/\bimport\s+(?:[\w*{]|['"])/, 'module import'],
  ];
  const hit = blocked.find(([pattern]) => pattern.test(text));
  if (hit) {
    throw new OfflinePageExportError(
      'runtime_network',
      `${label}: preview script uses unsupported ${hit[1]}; offline export requires a bundled, service-free interaction`,
      { label, dependency: hit[1] },
    );
  }
  if (/<\/script/i.test(text)) {
    throw new OfflinePageExportError('unsafe_script', `${label}: preview script contains </script>`, { label });
  }
  return text;
}

function approvalMap(approvals) {
  if (approvals == null) return null;
  if (!Array.isArray(approvals)) {
    throw new OfflinePageExportError('bad_approvals', 'approvals must be an array');
  }
  return new Map(approvals.map((item) => [String(item && item.url || ''), String(item && item.sha256 || '')]));
}

function assetContext(options) {
  const entryRoot = path.resolve(options.entryRoot);
  const pinpointRoot = path.resolve(options.pinpointRoot);
  const registry = options.registry;
  const approvals = approvalMap(options.approvals);
  const remote = new Map();
  const cache = new Map();
  const ownerRoots = new Map();
  const fetchRemote = options.fetchRemote || globalThis.fetch;

  function localRef(ref, baseFile) {
    const raw = splitSuffix(ref);
    let file;
    let ownerRoot;
    if (raw.resource.startsWith('/sites/')) {
      const match = raw.resource.match(/^\/sites\/([^/]+)\/(.*)$/);
      if (!match) throw new OfflinePageExportError('bad_asset_url', `invalid asset URL: ${ref}`, { ref });
      const ownerId = match[1];
      let rest;
      try { rest = decodeURIComponent(match[2]); }
      catch { throw new OfflinePageExportError('bad_asset_url', `invalid asset URL: ${ref}`); }

      if (ownerId === options.entryId) {
        ownerRoot = entryRoot;
        file = path.resolve(ownerRoot, rest);
      } else {
        const owner = registry && typeof registry.resolve === 'function' ? registry.resolve(ownerId) : null;
        if (!owner) {
          throw new OfflinePageExportError(
            'asset_owner_missing',
            `找不到资源所属的页面：${ownerId}`,
            { ref, ownerId },
          );
        }
        if (owner.kind === 'dir') {
          ownerRoot = path.resolve(owner.path);
          file = path.resolve(ownerRoot, rest);
        } else if (owner.kind === 'file') {
          ownerRoot = path.dirname(path.resolve(owner.path));
          file = path.resolve(ownerRoot, rest);
          if (file !== path.resolve(owner.path)) {
            throw new OfflinePageExportError(
              'asset_missing',
              `页面 ${ownerId} 没有这个资源：${ref}`,
              { ref, ownerId },
            );
          }
        } else {
          throw new OfflinePageExportError(
            'runtime_network',
            `资源来自在线网页，当前无法保存为离线文件：${ref}`,
            { ref, ownerId },
          );
        }
      }
      if (!inside(ownerRoot, file)) {
        throw new OfflinePageExportError('asset_escape', `asset escapes registered entry: ${ref}`, { ref });
      }
      ownerRoots.set(file, ownerRoot);
    } else if (raw.resource.startsWith('/kits/') || raw.resource.startsWith('/workbench/')) {
      // URL 是契约，磁盘位置不是：/kits/ 住 content/，/workbench/ 住 src/。
      const rel = raw.resource.startsWith('/kits/')
        ? path.join('content', raw.resource.slice(1))
        : path.join('src', raw.resource.slice(1));
      ownerRoot = pinpointRoot;
      file = path.resolve(pinpointRoot, rel);
      if (!inside(ownerRoot, file)) {
        throw new OfflinePageExportError('asset_escape', `asset escapes Pinpoint root: ${ref}`, { ref });
      }
      ownerRoots.set(file, ownerRoot);
    } else if (raw.resource.startsWith('/')) {
      throw new OfflinePageExportError('unknown_absolute_asset', `unsupported absolute asset URL: ${ref}`, { ref });
    } else {
      file = path.resolve(path.dirname(baseFile), raw.resource);
      const resolvedBase = path.resolve(baseFile);
      ownerRoot = ownerRoots.get(resolvedBase)
        || (inside(entryRoot, resolvedBase) ? entryRoot : null)
        || (inside(pinpointRoot, resolvedBase) ? pinpointRoot : null);
      if (!ownerRoot) {
        throw new OfflinePageExportError('asset_escape', `cannot resolve asset owner: ${ref}`, { ref, baseFile });
      }
      if (!inside(ownerRoot, file)) {
        throw new OfflinePageExportError('asset_escape', `asset escapes owner directory: ${ref}`, { ref });
      }
      ownerRoots.set(file, ownerRoot);
    }
    return { kind: 'local', file, ownerRoot, suffix: raw.suffix, identity: file };
  }

  function resolveRef(ref, baseFile) {
    const text = String(ref || '').trim();
    if (!text || text.startsWith('data:') || text.startsWith('blob:') || text.startsWith('#')) {
      return { kind: 'passthrough', value: text };
    }
    if (/^https:\/\//i.test(text)) {
      const absolute = /^https:\/\//i.test(String(baseFile || '')) ? new URL(text, baseFile).href : text;
      return { kind: 'remote', url: absolute, suffix: splitSuffix(absolute).suffix, identity: splitSuffix(absolute).resource };
    }
    if (/^http:\/\//i.test(text) || /^\/\//.test(text)) {
      throw new OfflinePageExportError('insecure_remote', `only HTTPS resources can be embedded: ${text}`, { ref: text });
    }
    if (/^https:\/\//i.test(String(baseFile || ''))) {
      const absolute = new URL(text, baseFile).href;
      return { kind: 'remote', url: absolute, suffix: splitSuffix(absolute).suffix, identity: splitSuffix(absolute).resource };
    }
    return localRef(text, baseFile);
  }

  async function read(ref, baseFile) {
    const resolved = resolveRef(ref, baseFile);
    if (resolved.kind === 'passthrough') return resolved;
    if (cache.has(resolved.identity)) return { ...cache.get(resolved.identity), suffix: resolved.suffix };

    if (resolved.kind === 'local') {
      if (!fs.existsSync(resolved.file) || !fs.statSync(resolved.file).isFile()) {
        throw new OfflinePageExportError('asset_missing', `asset not found: ${ref}`, { ref, file: resolved.file });
      }
      let realFile;
      let realOwnerRoot;
      try {
        realFile = fs.realpathSync(resolved.file);
        realOwnerRoot = fs.realpathSync(resolved.ownerRoot);
      } catch {
        throw new OfflinePageExportError('asset_missing', `asset not found: ${ref}`, { ref, file: resolved.file });
      }
      if (!inside(realOwnerRoot, realFile)) {
        throw new OfflinePageExportError('asset_escape', `asset escapes owner directory: ${ref}`, { ref });
      }
      const bytes = fs.readFileSync(resolved.file);
      if (bytes.length > MAX_RESOURCE_BYTES) {
        throw new OfflinePageExportError('asset_too_large', `asset exceeds 25 MB: ${ref}`, { ref, size: bytes.length });
      }
      const result = { kind: 'local', bytes, mime: mimeFor(resolved.file), base: resolved.file, identity: resolved.identity };
      cache.set(resolved.identity, result);
      return { ...result, suffix: resolved.suffix };
    }

    if (typeof fetchRemote !== 'function') {
      throw new OfflinePageExportError('remote_unavailable', `cannot fetch remote resource: ${resolved.identity}`);
    }
    let response;
    try { response = await fetchRemote(resolved.identity); }
    catch (error) {
      throw new OfflinePageExportError('remote_fetch_failed', `failed to fetch ${resolved.identity}: ${error.message || error}`);
    }
    if (!response || !response.ok) {
      throw new OfflinePageExportError('remote_fetch_failed', `failed to fetch ${resolved.identity}: HTTP ${response && response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESOURCE_BYTES) {
      throw new OfflinePageExportError('asset_too_large', `remote asset exceeds 25 MB: ${resolved.identity}`, { url: resolved.identity, size: bytes.length });
    }
    const digest = sha256(bytes);
    const mime = mimeFor(resolved.identity, response.headers && response.headers.get('content-type'));
    const item = { url: resolved.identity, origin: new URL(resolved.identity).origin, size: bytes.length, sha256: digest, mime };
    remote.set(resolved.identity, item);
    if (approvals && approvals.get(resolved.identity) !== digest) {
      const code = approvals.has(resolved.identity) ? 'remote_changed' : 'remote_unapproved';
      throw new OfflinePageExportError(code, `${resolved.identity}: remote resource is not approved at this exact digest`, item);
    }
    const result = { kind: 'remote', bytes, mime, base: resolved.identity, identity: resolved.identity };
    cache.set(resolved.identity, result);
    return { ...result, suffix: resolved.suffix };
  }

  return { read, remote };
}

async function inlineCss(css, baseFile, ctx, stack = new Set()) {
  let output = await replaceAsync(
    css,
    /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?\s*;/gi,
    async (full, quote, ref) => {
      const resource = await ctx.read(ref, baseFile);
      if (resource.kind === 'passthrough') {
        throw new OfflinePageExportError('unsupported_css_import', `cannot inline CSS import: ${ref}`);
      }
      if (!/text\/css/i.test(resource.mime) && !/\.css(?:$|[?#])/i.test(ref)) {
        throw new OfflinePageExportError('unsupported_css_import', `CSS import is not CSS: ${ref}`);
      }
      if (stack.has(resource.identity)) {
        throw new OfflinePageExportError('css_import_cycle', `CSS import cycle: ${ref}`);
      }
      const next = new Set(stack);
      next.add(resource.identity);
      return inlineCss(resource.bytes.toString('utf8'), resource.base, ctx, next);
    },
  );
  output = await replaceAsync(output, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, async (full, quote, ref) => {
    const resource = await ctx.read(ref.trim(), baseFile);
    if (resource.kind === 'passthrough') return full;
    return `url("${dataUrl(resource.bytes, resource.mime, resource.suffix)}")`;
  });
  return output;
}

async function inlinePreviewScripts(html, baseFile, ctx) {
  return replaceAsync(
    html,
    /<script\b([^>]*)>\s*<\/script>/gi,
    async (full, attrs) => {
      if (!/\bdata-preview-script\b/i.test(attrs)) return full;
      const src = attrs.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i);
      if (!src) return full;
      const ref = src[2];
      const resource = await ctx.read(ref, baseFile);
      if (resource.kind === 'passthrough') {
        throw new OfflinePageExportError('preview_script_missing', `cannot inline preview script: ${ref}`);
      }
      const source = portablePreviewScript(resource.bytes.toString('utf8'), ref);
      return `<script${attrs.replace(src[0], '')}>${source}</script>`;
    },
  );
}

async function inlineStyleBlocks(html, baseFile, ctx) {
  let output = await replaceAsync(html, /<style\b([^>]*)>([\s\S]*?)<\/style>/gi, async (full, attrs, css) => {
    return `<style${attrs}>${await inlineCss(css, baseFile, ctx)}</style>`;
  });
  output = await replaceAsync(
    output,
    /<link\b([^>]*\brel\s*=\s*(["'])stylesheet\2[^>]*)\bhref\s*=\s*(["'])([^"']+)\3([^>]*)>/gi,
    async (full, before, relQuote, hrefQuote, ref) => {
      const resource = await ctx.read(ref, baseFile);
      if (resource.kind === 'passthrough') throw new OfflinePageExportError('stylesheet_missing', `cannot inline stylesheet: ${ref}`);
      const css = await inlineCss(resource.bytes.toString('utf8'), resource.base, ctx);
      return `<style>${css}</style>`;
    },
  );
  return output;
}

async function inlineElementAssets(html, baseFile, ctx) {
  let output = await replaceAsync(
    html,
    /<(img|source|video|audio)\b([^>]*?)\b(src|poster)\s*=\s*(["'])([^"']+)\4([^>]*)>/gi,
    async (full, tag, before, attr, quote, ref, after) => {
      if (!RESOURCE_ATTRS.has(attr.toLowerCase())) return full;
      const resource = await ctx.read(ref, baseFile);
      if (resource.kind === 'passthrough') return full;
      return `<${tag}${before}${attr}=${quote}${dataUrl(resource.bytes, resource.mime, resource.suffix)}${quote}${after}>`;
    },
  );
  output = await replaceAsync(output, /\b(srcset|imagesrcset)\s*=\s*(["'])([^"']+)\2/gi, async (full, attr, quote, value) => {
    const items = value.split(',').map((item) => item.trim()).filter(Boolean);
    const inlined = [];
    for (const item of items) {
      const match = item.match(/^(\S+)(\s+.+)?$/);
      const resource = await ctx.read(match[1], baseFile);
      const url = resource.kind === 'passthrough' ? match[1] : dataUrl(resource.bytes, resource.mime, resource.suffix);
      inlined.push(url + (match[2] || ''));
    }
    return `${attr}=${quote}${inlined.join(', ')}${quote}`;
  });
  return output;
}

function assertNoRuntimeUrls(html) {
  const bad = String(html).match(/\b(?:src|poster|srcset|imagesrcset|href|action|formaction)\s*=\s*(["'])(https?:\/\/|\/\/|\/(?:sites|kits|workbench|api)\/)/i);
  if (bad) {
    throw new OfflinePageExportError('runtime_network', `offline export contains runtime navigation or request: ${bad[2]}`);
  }
}

function assertPortableInlineScripts(html) {
  const scripts = [...String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    if (/\btype\s*=\s*(["'])application\/(?:ld\+)?json\1/i.test(script[1])) continue;
    portablePreviewScript(script[2], 'inline script');
  }
}

export async function bundleHtmlAssets(html, options) {
  if (!options || !options.baseFile || !options.entryRoot || !options.entryId || !options.pinpointRoot) {
    throw new OfflinePageExportError('bad_options', 'baseFile, entryRoot, entryId, and pinpointRoot are required');
  }
  const ctx = assetContext(options);
  let output = await inlinePreviewScripts(String(html), options.baseFile, ctx);
  output = await inlineStyleBlocks(output, options.baseFile, ctx);
  output = await inlineElementAssets(output, options.baseFile, ctx);
  assertNoRuntimeUrls(output);
  assertPortableInlineScripts(output);
  return {
    html: output,
    remoteResources: [...ctx.remote.values()].sort((a, b) => a.url.localeCompare(b.url)),
  };
}

const PANEL_ICON_CLOSE = '<svg data-icon="close" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>';
const PANEL_ICON_OPEN = '<svg data-icon="open" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>';
const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

/* 分享壳自己的补充样式。外壳（.wb / .wb-side / .wb-strip / .wb-stage / .wb-library /
   .wb-outline …）的几何与材质全部来自内联的 index.html 样式与 wb-tokens.css（ADR 0033）；
   这里只补 workbench 里由 React 组件的 Tailwind 类提供、导出里没有的那几条，以及窄屏适配。 */
const SHARE_CSS = `
html{height:100%}
#wbside .wb-head{height:auto;padding:14px 14px 8px}
#wbside .share-title{margin:0;min-width:0;flex:1;font:var(--wb-t-title) var(--wb-font);letter-spacing:-.01em;color:var(--wb-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wbside .wb-side-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding-bottom:22px}
#wbside .wb-outline{margin:0 var(--wb-pad)}
#wbside .wb-outline a{text-decoration:none;box-sizing:border-box;color:inherit}
#wbside .wb-outline .ol-sec{color:var(--wb-fg)}
#wbside .wb-outline .ol-sec.on{color:var(--wb-accent)}
#wbside .wb-outline .ol-sec-t{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wb-strip .share-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;min-width:28px;padding:0 8px;border:0;border-radius:var(--wb-r-2);background:transparent;color:var(--wb-muted);font:var(--wb-w-semibold) 12px/1 var(--wb-font);cursor:pointer;transition:color var(--wb-dur) var(--wb-ease),background-color var(--wb-dur) var(--wb-ease)}
.wb-strip .share-btn:hover{background:var(--wb-hover);color:var(--wb-fg)}
.wb-strip .share-btn--icon{width:28px;padding:0}
.wb-strip .share-btn svg{display:block;pointer-events:none}
.wb-strip .share-btn svg[hidden]{display:none}
.wb-strip .wb-strip-title{max-width:220px;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:var(--wb-w-semibold);letter-spacing:-.01em}
.wb-strip .share-nav{display:inline-flex;align-items:center;gap:2px}
.wb-strip .share-pos{min-width:46px;padding:0 6px;text-align:center;font-family:var(--wb-font-mono);font-size:12px;font-weight:var(--wb-w-semibold);font-variant-numeric:tabular-nums;color:var(--wb-fg)}
.wb-strip .share-zoom{min-width:52px;font-variant-numeric:tabular-nums;color:var(--wb-fg)}
@media (max-width:760px){
  .wb-side{left:var(--wb-chrome-gap);right:var(--wb-chrome-gap);width:auto}
  .wb.wb-side-collapsed .wb-side{width:auto;opacity:0;pointer-events:none}
  .wb-panel{--wb-board-pad:0px;min-width:0}
  .wb-library{padding:16px 24px 120px}
  .wb-sec-row{display:flex;flex-direction:column;align-items:flex-start;gap:calc(var(--wb-cap-gap) * 2)}
  .wb-sec-row .wb-screen{display:flex}
  .wb-library .wb-screen-dim{opacity:1}
  .wb-strip .wb-strip-title{max-width:34vw}
  .wb-strip .share-desktop{display:none}
}
`;

function outlineHtml(sections) {
  return sections.map((section) => {
    const sectionId = escapeHtml(section.id);
    const rows = section.screens.map((screen) =>
      `<a class="ol-row" href="#frame-${escapeHtml(screen.id)}" data-ol-frame="${escapeHtml(screen.id)}" data-ol-section="${sectionId}" title="${escapeHtml(screen.ref)} ${escapeHtml(screen.title || screen.id)}">` +
      '<span class="spine" aria-hidden="true"></span>' +
      `<span class="no">${escapeHtml(screen.ref)}</span>` +
      `<span class="nm">${escapeHtml(screen.title || screen.id)}</span></a>`,
    ).join('');
    return `<div class="ol" data-ol-section="${sectionId}">` +
      `<a class="ol-sec" href="#section-${sectionId}" data-ol-section="${sectionId}" title="${escapeHtml(section.ref)} ${escapeHtml(section.title || section.id)}">` +
      `<span class="ol-L">${escapeHtml(section.ref)}</span>` +
      `<span class="ol-sec-t">${escapeHtml(section.title || section.id)}</span></a>${rows}</div>`;
  }).join('');
}

/* 画布 = workbench 的 .wb-library：section 是 .wb-lib-item（data-ann-section 与
   screen-load.buildBoardHtml 同名），帧是 offline-page-builder.frameHtml 产出的 .wb-screen
   （id="frame-<screenId>"）；.wb-sec-row 的三行网格由内联样式提供。 */
function boardHtml(sections) {
  return sections.map((section) => {
    const sectionId = escapeHtml(section.id);
    const title = escapeHtml(section.title || section.id);
    const frames = section.screens.map((screen) => screen.html).join('');
    return `<article class="wb-lib-item" id="section-${sectionId}" data-ann-section="${sectionId}" data-ann-section-label="${title}">` +
      `<h2 class="wb-lib-cap" title="${title}">` +
      (section.ref ? `<span class="wb-cap-ref wb-cap-ref--section">${escapeHtml(section.ref)}</span>` : '') +
      `${title}</h2>` +
      `<div class="wb-sec-body wb-sec-row">${frames}</div></article>`;
  }).join('');
}

function stripHtml(title, frameCount) {
  return '<div class="wb-strip wb-glass" id="wbstrip">' +
    `<button type="button" class="share-btn share-btn--icon wb-side-toggle" id="wbside-toggle" aria-expanded="true" aria-controls="wbside" aria-label="收起 Pages 面板" title="收起 Pages 面板">${PANEL_ICON_CLOSE}${PANEL_ICON_OPEN}</button>` +
    `<span class="wb-strip-title" id="wbstrip-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>` +
    '<span class="wb-strip-div" aria-hidden="true"></span>' +
    '<div class="share-nav" id="wbsection-nav-wrap">' +
    `<button type="button" class="share-btn share-btn--icon" id="wbnav-prev" title="上一帧" aria-label="上一帧">${CHEVRON_LEFT}</button>` +
    `<span class="share-pos" id="wbsection-nav-position" aria-live="polite">${frameCount ? '1 / ' + frameCount : '0 / 0'}</span>` +
    `<button type="button" class="share-btn share-btn--icon" id="wbnav-next" title="下一帧" aria-label="下一帧">${CHEVRON_RIGHT}</button>` +
    '</div>' +
    '<span class="wb-strip-div share-desktop" aria-hidden="true"></span>' +
    '<button type="button" class="share-btn share-zoom share-desktop" id="wbzoom-label" title="重置为 100%">100%</button>' +
    '<button type="button" class="share-btn share-desktop" id="wbrecenter" title="回到画布内容">回中</button>' +
    '</div>';
}

export function buildOfflineShareHtml(options) {
  const sections = Array.isArray(options.sections) ? options.sections : [];
  const frameCount = sections.reduce((sum, section) => sum + section.screens.length, 0);
  const title = escapeHtml(options.title);
  return `<!doctype html>
<html lang="zh-CN" data-annotate="off" data-offline-page="${escapeHtml(options.pageId)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${escapeInlineStyle(options.workbenchCss || '')}\n${escapeInlineStyle(options.iosCss || '')}\n${SHARE_CSS}</style></head>
<body><div class="wb" id="wbroot" data-section-count="${sections.length}" data-frame-count="${frameCount}">
<div class="wb-stage-wrap"><main class="wb-stage" id="wbstage" aria-label="画布"><div class="wb-panel" id="wb-board-panel"><div class="wb-zoom-wrap"><div class="wb-library">${boardHtml(sections)}</div></div></div></main></div>
<aside class="wb-side wb-glass" id="wbside" aria-label="原型大纲"><div class="wb-head"><h1 class="share-title" title="${title}">${title}</h1></div><div class="wb-side-body"><div class="wb-side-scroll"><nav class="wb-outline" id="wboutline" aria-label="大纲">${outlineHtml(sections)}</nav></div></div></aside>
${stripHtml(options.title, frameCount)}
</div>
<script>${escapeInlineScript(options.iosKitJs || '')}</script>
<script>${escapeInlineScript(options.frameBootJs || '')}</script>
<script>${escapeInlineScript(options.shareRuntimeJs || '')}</script>
</body></html>`;
}
