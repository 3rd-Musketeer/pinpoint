/**
 * /api/frame 渲染端点的组装库（阶段 5：文档 mention 活 frame）。
 *
 * 解析 pageId + screenId → frame 目标（previews 模板页 / components 系统板 /
 * registry dir·file·url 条目），然后：
 * - fragment 屏（ios app/lock、comp）→ 组装完整自包含 HTML 文档（fragment +
 *   机壳 + ios-kit + frame-boot + annotate 注入），机壳与画布装载共享
 *   src/shared/frame-shell.js —— 两端 stage 以下 DOM 链逐字节同构，锚点归一才成立；
 * - doc 壳屏（完整文档 / 合成板 / url 条目）→ 不重包装，由端点 302 到该屏
 *   自己的 URL（同文档同 pathname → 标注天然落同一个按路径分的账本）。
 *
 * 导出烤图复用本库的 frameExportSnapshot（/api/export-image 同款快照负载）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expandIncludeRefs,
  wrapCompStage,
  wrapFragmentForLibrary,
  wrapPhoneShell,
} from '../../shared/frame-shell.js';
import { applyIncludeSlots } from '../../workbench/lib/include-slots.js';
import { boardRefs } from '../../workbench/lib/board-refs.js';
import { escHtml } from '../../workbench/lib/esc-html.js';
import { synthesizeBoard } from './synth-board.js';
import { templateOnly } from '../template-only.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONTENT_ROOT = path.join(ROOT, 'content');
const PREVIEWS_ROOT = path.join(CONTENT_ROOT, 'previews');
const COMPONENTS_ROOT = path.join(CONTENT_ROOT, 'kits', 'ios', 'components');

export class FrameDocError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FrameDocError';
    this.code = code; // 'bad_request' | 'unknown_page' | 'unknown_screen'
  }
}

const PAGE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
// screenId 允许 components 的 comp/variant 形态（与 export-contract 同口径）。
const SCREEN_ID_RE = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;
const COMPONENTS_ID = 'components';

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Workbench Pages 清单的服务端镜像：模板 _index.json + 实例 _index.local.json。 */
function previewManifestPages() {
  const base = readJsonSafe(path.join(PREVIEWS_ROOT, '_index.json'));
  const pages = Array.isArray(base && base.pages) ? base.pages.slice() : [];
  if (!templateOnly()) {
    const local = readJsonSafe(path.join(PREVIEWS_ROOT, '_index.local.json'));
    if (local && Array.isArray(local.pages)) pages.push(...local.pages);
  }
  return pages;
}

/** 壳归一：legacy "web" 值与 html 模式同落 doc（与 preview-contracts validateShell 的归一同义）。 */
function normalizeShell(shell, mode) {
  const s = shell || (mode === 'html' ? 'doc' : 'app');
  return s === 'web' ? 'doc' : s;
}

function findScreen(board, screenId) {  const refs = boardRefs(board);
  const sections = Array.isArray(board.sections) ? board.sections : [];
  for (const sec of sections) {
    const screens = Array.isArray(sec.screens) ? sec.screens : [];
    for (const raw of screens) {
      const sc = typeof raw === 'string' ? { id: raw } : raw;
      if (!sc || sc.id !== screenId) continue;
      return {
        screen: sc,
        section: sec.id || '',
        sectionLabel: sec.title || sec.id || '',
        sectionShell: sec.shell || '',
        ref: refs.byFrame[sec.id + '\0' + sc.id] || '',
      };
    }
  }
  return null;
}

function resolveSiteEntry(registry, entryId) {
  const entry = registry && typeof registry.resolve === 'function' ? registry.resolve(entryId) : null;
  return entry || null;
}

/** sites/<id>/<rest> → 磁盘绝对路径（dir/file 条目；containment 校验）。 */
function siteSrcToAbsPath(src, registry) {
  const id = String(src).split('/')[1];
  const entry = resolveSiteEntry(registry, id);
  if (!entry || (entry.kind !== 'dir' && entry.kind !== 'file')) {
    throw new FrameDocError('unknown_page', `unknown site entry: ${id}`);
  }
  let rest;
  try {
    rest = decodeURIComponent(String(src).split('/').slice(2).join('/'));
  } catch {
    throw new FrameDocError('unknown_screen', `file not found: ${src}`);
  }
  if (entry.kind === 'file') {
    if (rest !== path.basename(entry.path)) throw new FrameDocError('unknown_screen', `file not found: ${src}`);
    return path.resolve(entry.path);
  }
  const base = path.resolve(entry.path);
  const abs = path.resolve(base, rest);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new FrameDocError('bad_request', 'path traversal is not allowed');
  }
  return abs;
}

/**
 * 解析 mention 目标。返回两类之一：
 *   { kind: 'doc', url, pageId, screenId, title }                       — 端点 302
 *   { kind: 'fragment', pageId, screenId, title, shell, section, sectionLabel,
 *     ref, entry, baseUrl, fragmentPath }                                — 端点组装
 */
export function resolveFrameTarget(pageId, screenId, options = {}) {
  const registry = options.registry || null;
  if (!PAGE_ID_RE.test(String(pageId || ''))) {
    throw new FrameDocError('bad_request', `invalid page id "${pageId}"`);
  }
  if (!SCREEN_ID_RE.test(String(screenId || ''))) {
    throw new FrameDocError('bad_request', `invalid screen id "${screenId}"`);
  }

  // 1) Component Library 系统板
  if (pageId === COMPONENTS_ID) {
    const variantPath = path.resolve(COMPONENTS_ROOT, `${screenId}.html`);
    if (!variantPath.startsWith(COMPONENTS_ROOT + path.sep) || !fs.existsSync(variantPath)) {
      throw new FrameDocError('unknown_screen', `unknown component variant: ${screenId}`);
    }
    return {
      kind: 'fragment',
      pageId,
      screenId,
      title: screenId,
      shell: 'comp',
      section: '',
      sectionLabel: '',
      ref: '',
      entry: 'pinpoint',
      baseUrl: '/kits/ios/components/',
      fragmentPath: variantPath,
    };
  }

  // 2) previews 模板/实例页
  const pageEntry = previewManifestPages().find((p) => p && p.id === pageId) || null;
  if (pageEntry) {
    const board = readJsonSafe(path.join(PREVIEWS_ROOT, pageId, 'board.json'));
    if (!board) throw new FrameDocError('unknown_page', `page "${pageId}" has no board.json`);
    const hit = findScreen(board, screenId);
    if (!hit) throw new FrameDocError('unknown_screen', `unknown screen: ${pageId}/${screenId}`);
    const mode = pageEntry.mode === 'html' ? 'html' : 'ios';
    const shell = normalizeShell(hit.screen.shell || hit.sectionShell, mode);
    const baseUrl = `/previews/${pageId}/`;
    if (shell === 'doc') {
      return {
        kind: 'doc',
        url: docUrlForScreen(hit.screen, baseUrl),
        pageId,
        screenId,
        title: hit.screen.title || screenId,
      };
    }
    const src = hit.screen.src ? String(hit.screen.src) : '';
    let fragmentPath;
    if (src.startsWith('sites/')) {
      fragmentPath = siteSrcToAbsPath(src, registry);
    } else if (src) {
      const abs = path.resolve(CONTENT_ROOT, src);
      if (abs !== PREVIEWS_ROOT && !abs.startsWith(PREVIEWS_ROOT + path.sep)) {
        throw new FrameDocError('bad_request', 'screen src must resolve under previews/');
      }
      fragmentPath = abs;
    } else {
      fragmentPath = path.join(PREVIEWS_ROOT, pageId, `${screenId}.html`);
    }
    if (!fs.existsSync(fragmentPath) || !fs.statSync(fragmentPath).isFile()) {
      throw new FrameDocError('unknown_screen', `file not found: ${pageId}/${screenId}`);
    }
    return {
      kind: 'fragment',
      pageId,
      screenId,
      title: hit.screen.title || screenId,
      shell,
      section: hit.section,
      sectionLabel: hit.sectionLabel,
      ref: hit.ref,
      entry: 'pinpoint',
      baseUrl,
      fragmentPath,
    };
  }

  // 3) registry 条目（workbench 自己的 pinpoint 条目不成页，跳过）
  const entry = pageId === 'pinpoint' ? null : resolveSiteEntry(registry, pageId);
  if (!entry) throw new FrameDocError('unknown_page', `unknown page: ${pageId}`);
  const diskBoard = entry.kind === 'dir'
    ? readJsonSafe(path.join(path.resolve(entry.path), 'board.json'))
    : null;
  const board = diskBoard || synthesizeBoard(entry);
  if (!board) throw new FrameDocError('unknown_page', `page "${pageId}" has no readable board`);
  const hit = findScreen(board, screenId);
  if (!hit) throw new FrameDocError('unknown_screen', `unknown screen: ${pageId}/${screenId}`);
  const mode = entry.kind === 'dir' && entry.board === 'ios' ? 'ios' : 'html';
  const shell = normalizeShell(hit.screen.shell || hit.sectionShell, mode);
  const baseUrl = `/sites/${entry.id}/`;
  if (shell === 'doc') {
    return {
      kind: 'doc',
      url: docUrlForScreen(hit.screen, baseUrl),
      pageId,
      screenId,
      title: hit.screen.title || screenId,
    };
  }
  const src = hit.screen.src ? String(hit.screen.src) : '';
  const fragmentPath = src
    ? (src.startsWith('sites/') ? siteSrcToAbsPath(src, registry) : null)
    : path.join(path.resolve(entry.path), `${screenId}.html`);
  if (!fragmentPath || !fs.existsSync(fragmentPath) || !fs.statSync(fragmentPath).isFile()) {
    throw new FrameDocError('unknown_screen', `file not found: ${pageId}/${screenId}`);
  }
  return {
    kind: 'fragment',
    pageId,
    screenId,
    title: hit.screen.title || screenId,
    shell,
    section: hit.section,
    sectionLabel: hit.sectionLabel,
    ref: hit.ref,
    entry: entry.id,
    baseUrl,
    fragmentPath,
  };
}

function docUrlForScreen(screen, baseUrl) {
  const src = screen.src ? String(screen.src) : '';
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('/')) return src;
  if (src) return '/' + src;
  // 合成板的 src 恒存在；手写板缺 src 时按页面 baseUrl + id 兜底。
  return `${baseUrl}${encodeURIComponent(screen.id)}.html`;
}

function readIncludeFragment(component, variant) {
  const file = path.join(COMPONENTS_ROOT, component, `${variant}.html`);
  if (!file.startsWith(COMPONENTS_ROOT + path.sep)) return Promise.resolve(null);
  return Promise.resolve(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
}

/** fragment 屏内容：磁盘读取 → include 展开 → 机壳包装（与画布同一份 lib）。 */
export async function assembleFrameContent(target) {
  const raw = fs.readFileSync(target.fragmentPath, 'utf8');
  let html = await expandIncludeRefs(raw, readIncludeFragment, applyIncludeSlots);
  if (target.shell === 'comp') html = wrapFragmentForLibrary(html);
  return target.shell === 'comp' ? wrapCompStage(html) : wrapPhoneShell(html, target.shell);
}

function frameCaptionHtml(target) {
  return '<div class="wb-screen-cap">' +
    (target.ref ? '<span class="wb-cap-ref">' + escHtml(target.ref) + '</span>' : '') +
    '<span class="wb-cap-title">' + escHtml(target.title || target.screenId) + '</span>' +
    '</div>';
}

/** 预览脚本改写成惰性标签：完整文档里原生 <script> 会立刻执行（root 未定义），
 *  契约执行权交给 client/frame-boot.js。 */
export function neutralizePreviewScripts(html) {
  return String(html).replace(/<script\b([^>]*)>/gi, (full, attrs) => {
    if (!/\bdata-preview-script\b/.test(attrs)) return full;
    const cleaned = String(attrs)
      .replace(/\btype\s*=\s*(["'])([\s\S]*?)\1/i, (m, q, v) =>
        ` data-preview-kind="${String(v).toLowerCase() === 'module' ? 'module' : 'classic'}"`)
      .replace(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i, (m, q, v) =>
        ` data-preview-src="${String(v).replace(/"/g, '&quot;')}"`);
    return `<script type="text/x-pinpoint-preview"${cleaned}>`;
  });
}

/** 导出快照里脚本一律摘除（与画布 cleanExportClone 同约）。 */
export function stripScripts(html) {
  return String(html).replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

/** index.html 的内联 <style> 块（机壳/图注/画布样式）—— frame 页与导出渲染共用。 */
export function readWorkbenchInlineStyles() {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...index.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
}

// frame-boot 必须内联：经 vite 静态服务会被 import-analysis 注入 /@vite/client
// 静态 import（经典脚本直接 SyntaxError），内联既免疫转换也让 frame 页自包含。
let frameBootCache = null;
function frameBootSource() {
  if (frameBootCache) return frameBootCache;
  const src = fs.readFileSync(path.join(ROOT, 'src', 'client', 'frame-boot.js'), 'utf8');
  if (/<\/script/i.test(src)) throw new FrameDocError('bad_request', 'frame-boot.js must not contain </script>');
  frameBootCache = src;
  return src;
}

// 画布 frame 的视觉 token：.wb-library 块的几何档（index.html 内联样式）+
// wb-tokens.css :root 的色档。与 workbench/export-core.js EXPORT_TOKEN_NAMES 同名单。
const FRAME_TOKEN_SOURCES = [
  { file: path.join(ROOT, 'index.html'), names: ['--wb-phone-w', '--wb-phone-h', '--wb-cap-section', '--wb-cap-screen', '--wb-cap-note', '--wb-cap-gap', '--wb-cap-ref'] },
  { file: path.join(ROOT, 'src', 'workbench', 'wb-tokens.css'), names: ['--wb-fg', '--wb-muted', '--wb-faint', '--wb-side', '--wb-line', '--wb-hover', '--wb-accent'] },
];

/** 抽各 token 在文件里的首个定义值（index.html 里 .wb-library 块先于 doc 覆写块）。 */
export function frameTokens() {
  const tokens = {};
  for (const source of FRAME_TOKEN_SOURCES) {
    let text = '';
    try { text = fs.readFileSync(source.file, 'utf8'); } catch { continue; }
    for (const name of source.names) {
      const m = text.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`));
      if (m) tokens[name] = m[1].trim();
    }
  }
  return tokens;
}

function frameTokensStyle() {
  const decl = Object.entries(frameTokens()).map(([k, v]) => `${k}:${v}`).join(';');
  return decl ? `body{${decl}}` : '';
}

/**
 * 组装 /api/frame 的完整自包含 HTML 文档。
 * data-annotate="off" 只挡 ios-kit 的自注入；annotate 注入由本函数显式完成
 * （带 __pinpointFrame/__pinpointLedger），opts.annotate=false 时完全不出标注面。
 */
export async function framePageHtml(target, opts = {}) {
  const annotate = opts.annotate !== false;
  // 预览脚本惰性化：完整文档里原生 <script> 会立刻执行（root 未定义），契约执行
  // 权交给 client/frame-boot.js（与画布 innerHTML 不执行语义对齐）。
  const wrapped = neutralizePreviewScripts(await assembleFrameContent(target));
  const frameIdentity = {
    pageId: target.pageId,
    screenId: target.screenId,
    section: target.section || '',
    sectionLabel: target.sectionLabel || '',
  };
  const inject = annotate
    ? `<script>window.__pinpointEntry=${JSON.stringify(target.entry)};` +
      `window.__pinpointFrame=${JSON.stringify(frameIdentity).replace(/<\//g, '<\\/')};` +
      `window.__pinpointLedger=${JSON.stringify(opts.ledger || '/index.html')}</script>` +
      '<script src="/annotate.js" async></script>'
    : '';
  return `<!doctype html>
<html data-annotate="off">
<head>
<meta charset="utf-8">
<base href="${escHtml(target.baseUrl)}">
<title>${escHtml(target.title || target.screenId)}</title>
<link rel="stylesheet" href="/workbench/wb-tokens.css">
<link rel="stylesheet" href="/kits/ios/ios-kit.css">
<style>${readWorkbenchInlineStyles()}</style>
<style>
/* 覆盖 index.html 内联样式里的 workbench 壳 body 规则（100vh + overflow:hidden
   会把 frame 页裁死、撑不出真实内容高度 —— 父级 autosize 依赖 scrollHeight）。 */
html,body{margin:0;padding:0;background:transparent;height:auto;overflow:visible}
${frameTokensStyle()}
.wb-screen{margin:0}
</style>
</head>
<body>
<div class="wb-screen" data-screen="${escHtml(target.screenId)}">
${frameCaptionHtml(target)}
${wrapped}
</div>
<script src="/kits/ios/ios-kit.js"></script>
<script>${frameBootSource()}</script>
${inject}
</body>
</html>`;
}

/** 文档导出烤图用的 /api/export-image 快照负载（PNG 2×，白底 —— 文档语境）。 */
export async function frameExportSnapshot(target) {
  const wrapped = stripScripts(await assembleFrameContent(target));
  const dimHtml = target.shell === 'app' || target.shell === 'lock'
    ? '<div class="wb-screen-dim">402 × 874</div>'
    : '';
  const html = '<div class="wb-screen" data-screen="' + escHtml(target.screenId) + '">' +
    frameCaptionHtml(target) + wrapped + dimHtml + '</div>';
  return {
    kind: 'frame',
    pageId: target.pageId,
    sectionId: target.section || 'main',
    screenId: target.screenId,
    format: 'png',
    scale: 2,
    background: 'white',
    includeNotes: false,
    tokens: frameTokens(),
    html,
  };
}
