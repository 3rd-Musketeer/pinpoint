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
      file = path.resolve(pinpointRoot, raw.resource.slice(1));
      if (!inside(pinpointRoot, file)) {
        throw new OfflinePageExportError('asset_escape', `asset escapes Pinpoint root: ${ref}`, { ref });
      }
      ownerRoots.set(file, pinpointRoot);
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

function shareRuntime() {
  return `(function(){
    function sizeFrames(){document.querySelectorAll('.share-frame-viewport').forEach(function(v){var n=v.firstElementChild;if(!n)return;v.style.width=Math.ceil(n.offsetWidth*.5)+'px';v.style.height=Math.ceil(n.offsetHeight*.5)+'px';});}
    document.querySelectorAll('.share-outline a').forEach(function(a){a.addEventListener('click',function(e){var id=a.getAttribute('href').slice(1);var target=document.getElementById(id);if(!target)return;e.preventDefault();target.scrollIntoView({behavior:'smooth',block:'start',inline:'start'});history.replaceState(null,'','#'+id);document.querySelectorAll('.share-outline a').forEach(function(x){x.classList.toggle('on',x===a);});});});
    window.addEventListener('load',function(){requestAnimationFrame(function(){sizeFrames();setTimeout(sizeFrames,80);});});
  })();`;
}

export function buildOfflineShareHtml(options) {
  const sections = Array.isArray(options.sections) ? options.sections : [];
  const frameCount = sections.reduce((sum, section) => sum + section.screens.length, 0);
  const outline = sections.map((section) => {
    const screens = section.screens.map((screen) =>
      `<a class="share-outline-frame" href="#frame-${escapeHtml(screen.id)}"><span>${escapeHtml(screen.ref)}</span>${escapeHtml(screen.title || screen.id)}</a>`,
    ).join('');
    return `<div class="share-outline-section"><a href="#section-${escapeHtml(section.id)}"><span>${escapeHtml(section.ref)}</span>${escapeHtml(section.title || section.id)}</a>${screens}</div>`;
  }).join('');
  const content = sections.map((section) => {
    const screens = section.screens.map((screen) =>
      `<article class="share-frame-viewport" id="frame-${escapeHtml(screen.id)}"><div class="wb-library share-frame-scale">${screen.html}</div></article>`,
    ).join('');
    return `<section class="share-section" id="section-${escapeHtml(section.id)}"><h2><span>${escapeHtml(section.ref)}</span>${escapeHtml(section.title || section.id)}</h2><div class="share-frame-row">${screens}</div></section>`;
  }).join('');
  const shareCss = `
html,body{margin:0;min-height:100%;overflow:visible;background:var(--wb-stage-bg,#faf8f4);color:var(--wb-fg,#1c2024);font-family:var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif)}
*{box-sizing:border-box}.share-app{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:100vh}.share-outline{position:sticky;top:0;height:100vh;overflow:auto;padding:18px 14px;background:var(--wb-side,#f6f6f7);box-shadow:8px 0 28px rgba(0,0,0,.06);z-index:5}.share-outline h1{margin:0 0 18px;font-size:15px;line-height:1.3}.share-outline-section{display:flex;flex-direction:column;gap:2px;margin-bottom:13px}.share-outline a{display:flex;align-items:baseline;gap:8px;min-height:28px;padding:5px 7px;border-radius:6px;color:var(--wb-muted,#6b6b70);font-size:12px;font-weight:600;text-decoration:none}.share-outline a:hover,.share-outline a.on{background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg,#1c2024)}.share-outline a>span{width:22px;flex:none;color:var(--wb-accent,#5b7fa6);font-family:var(--wb-font-mono,ui-monospace,monospace);font-size:10px}.share-outline-frame{padding-left:17px!important;font-weight:500!important}.share-main{min-width:0;padding:32px 32px 72px;background-color:var(--wb-stage-bg,#faf8f4);background-image:linear-gradient(rgba(91,127,166,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(91,127,166,.08) 1px,transparent 1px);background-size:24px 24px}.share-section{scroll-margin-top:24px;margin:0 0 34px}.share-section>h2{display:flex;align-items:baseline;gap:10px;margin:0 0 14px;font-size:17px;line-height:1.25}.share-section>h2 span{color:var(--wb-accent,#5b7fa6);font-family:var(--wb-font-mono,ui-monospace,monospace);font-size:12px;letter-spacing:.08em}.share-frame-row{display:flex;align-items:flex-start;gap:14px;overflow-x:auto;overscroll-behavior-x:contain;padding:0 0 14px;scrollbar-width:thin}.share-frame-viewport{position:relative;flex:none;width:219px;height:500px;scroll-margin:24px;overflow:visible}.wb-library.share-frame-scale{display:block;width:438px;min-width:0;padding:0;transform:scale(.5);transform-origin:0 0}.share-frame-scale>.wb-screen{margin:0}@media(max-width:760px){.share-app{grid-template-columns:190px minmax(0,1fr)}.share-outline{padding:14px 10px}.share-main{padding:24px 20px 56px}}
`;
  return `<!doctype html>
<html lang="zh-CN" data-annotate="off" data-offline-page="${escapeHtml(options.pageId)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title>
<style>${escapeInlineStyle(options.workbenchCss || '')}\n${escapeInlineStyle(options.iosCss || '')}\n${shareCss}</style></head>
<body><div class="share-app" data-section-count="${sections.length}" data-frame-count="${frameCount}"><aside class="share-outline" aria-label="原型大纲"><h1>${escapeHtml(options.title)}</h1>${outline}</aside><main class="share-main">${content}</main></div>
<script>${escapeInlineScript(options.iosKitJs || '')}</script>
<script>${escapeInlineScript(options.frameBootJs || '')}</script>
<script>${escapeInlineScript(shareRuntime())}</script>
</body></html>`;
}
