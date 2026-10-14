/**
 * /api/frame 渲染端点的组装库（阶段 5：文档 mention 活 frame）。
 *
 * 解析 pageId + screenId → frame 目标（previews 模板页 / registry dir·file·url
 * 条目），然后：
 * - fragment 屏（ios app/lock、comp）→ 组装完整自包含 HTML 文档（fragment +
 *   机壳 + ios-kit + frame-boot + annotate 注入），机壳与画布装载共享
 *   src/shared/frame-shell.js —— 两端 stage 以下 DOM 链逐字节同构，锚点归一才成立；
 * - doc 壳屏（完整文档 / 合成板 / url 条目）→ 不重包装，由端点 302 到该屏
 *   自己的 URL（同文档同 pathname → 标注天然落同一个按路径分的账本）。
 *
 * pp2（2026-09-22 review 1-4）：页内 board 屏（previews 页与有板 dir 条目、无 src
 * 的屏）改从 dist 出（target.distTarget，unbuilt 懒编译，编译失败 500）——.jsx 屏
 * 从此可以被 mention；kit 组件屏与 src 屏（外链 / 合成板）仍磁盘直读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  wrapCompStage,
  wrapFragmentForLibrary,
  wrapPhoneShell,
} from '../../shared/frame-shell.js';
import { boardRefs } from '../../workbench/lib/board-refs.js';
import { entryBoardMode, legacyShell } from '../../workbench/lib/preview-contracts.js';
import { escHtml } from '../../workbench/lib/esc-html.js';
import { readBoard } from './board-file.js';
import { annotateClientSrc } from './annotate-bundle.js';
import { loadDistScreenHtml, readTargetBoard } from './page-compiler.js';
import { resolvePage } from './page-resolve.js';
import { registryEntry } from './registry.js';
import { flattenTabs } from '../../workbench/lib/board-tabs.js';
import { ENTRY_OR_ARTICLE_ID_PATTERN } from '../../shared/project-ids.js';
import { synthesizeBoard } from './synth-board.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONTENT_ROOT = path.join(ROOT, 'content');
const PREVIEWS_ROOT = path.join(CONTENT_ROOT, 'previews');

export class FrameDocError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FrameDocError';
    this.code = code; // 'bad_request' | 'unknown_page' | 'unknown_screen'
  }
}

const SCREEN_ID_RE = /^[a-zA-Z0-9_-]+$/;

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Workbench Pages 清单的服务端镜像：模板 _index.json（_index.local.json 已于 pp2 切片 3 退役）。 */
function previewManifestPages() {
  const base = readJsonSafe(path.join(PREVIEWS_ROOT, '_index.json'));
  return Array.isArray(base && base.pages) ? base.pages.slice() : [];
}

/** 壳归一（web→doc 与缺省壳的唯一定义在 preview-contracts.legacyShell）。 */
function normalizeShell(shell, mode) {
  return legacyShell(shell, mode === 'html' ? 'doc' : 'app');
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

/** sites/<id>/<rest> → 磁盘绝对路径（dir/file 条目；containment 校验）。 */
function siteSrcToAbsPath(src, registry) {
  const id = String(src).split('/')[1];
  const entry = registryEntry(registry, id);
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
  if (!ENTRY_OR_ARTICLE_ID_PATTERN.test(String(pageId || ''))) {
    throw new FrameDocError('bad_request', `invalid page id "${pageId}"`);
  }
  if (!SCREEN_ID_RE.test(String(screenId || ''))) {
    throw new FrameDocError('bad_request', `invalid screen id "${screenId}"`);
  }

  // 1) previews 模板/实例页
  const pageEntry = previewManifestPages().find((p) => p && p.id === pageId) || null;
  if (pageEntry) {
    const board = readBoard(path.join(PREVIEWS_ROOT, pageId));
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
    // pp2：页内 board 屏（无 src）→ dist（.jsx 屏也在此落地）。
    if (!src) {
      return {
        kind: 'fragment',
        pageId,
        screenId,
        title: hit.screen.title || screenId,
        shell,
        section: hit.section,
        sectionLabel: hit.sectionLabel,
        ref: hit.ref,
        // storage-unify：帧标注住所属页的桶、账本 @canvas（与画布同一本）。
        entry: pageId,
        baseUrl,
        distTarget: { entryId: pageId, pageDir: path.join(PREVIEWS_ROOT, pageId), urlBase: baseUrl, kind: 'template' },
      };
    }
    let fragmentPath;
    if (src.startsWith('sites/')) {
      fragmentPath = siteSrcToAbsPath(src, registry);
    } else {
      const abs = path.resolve(CONTENT_ROOT, src);
      if (abs !== PREVIEWS_ROOT && !abs.startsWith(PREVIEWS_ROOT + path.sep)) {
        throw new FrameDocError('bad_request', 'screen src must resolve under previews/');
      }
      fragmentPath = abs;
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
      entry: pageId,
      baseUrl,
      fragmentPath,
    };
  }

  // 2)、3) 经 resolvePage 判定；模板页在上面按清单先认了（要清单里的 mode）。
  const page = resolvePage(registry, pageId);
  // 2) 文章画布（pp3）：board 由 index.mdx 派生，屏从 dist 出，桶 = 画布页 id。
  const article = page && page.kind === 'article' ? page.target : null;
  if (article) {
    let board;
    try {
      board = flattenTabs(readTargetBoard(article));
    } catch {
      throw new FrameDocError('unknown_page', `page "${pageId}" has no readable board`);
    }
    const hit = findScreen(board, screenId);
    if (!hit) throw new FrameDocError('unknown_screen', `unknown screen: ${pageId}/${screenId}`);
    const shell = normalizeShell(hit.screen.shell || hit.sectionShell, 'ios');
    if (shell === 'doc') {
      return { kind: 'doc', url: docUrlForScreen(hit.screen, article.urlBase), pageId, screenId, title: hit.screen.title || screenId };
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
      entry: pageId,
      baseUrl: article.urlBase,
      distTarget: article,
    };
  }

  // 3) registry 条目（workbench 自己的 pinpoint 条目不成页，跳过）
  const entry = pageId === 'pinpoint' || !page || page.kind !== 'entry' ? null : page.entry;
  if (!entry) throw new FrameDocError('unknown_page', `unknown page: ${pageId}`);
  const diskBoard = entry.kind === 'dir' ? readBoard(path.resolve(entry.path)) : null;
  const board = diskBoard || synthesizeBoard(entry);
  if (!board) throw new FrameDocError('unknown_page', `page "${pageId}" has no readable board`);
  const hit = findScreen(board, screenId);
  if (!hit) throw new FrameDocError('unknown_screen', `unknown screen: ${pageId}/${screenId}`);
  const mode = entryBoardMode(entry);
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
  // pp2：有板 dir 条目的页内屏（无 src）→ dist；src 屏（外链 / 合成板）与
  // file 条目保留磁盘直读。storage-unify：fragment 帧的标注桶 = 帧所属的页，
  // 账本固定 @canvas —— 画布实例与 mention 实例读写
  // 同一本账，双向实时同步靠的就是这个同桶同账本。
  if (entry.kind === 'dir' && diskBoard && !src) {
    const pageDir = path.resolve(entry.path);
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
      distTarget: { entryId: entry.id, pageDir, urlBase: baseUrl, kind: 'dir' },
    };
  }
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

/** fragment 屏内容：dist（页内 board 屏）或磁盘（src 屏）读取 →
    机壳包装（与画布同一份 lib）。
    编译失败的屏抛普通 Error —— frame-api 落 500 frame_failed 带错误文本。 */
export async function assembleFrameContent(target) {
  let raw;
  if (target.distTarget) {
    const dist = await loadDistScreenHtml(target.distTarget, target.screenId);
    if (!dist.ok) throw new Error(dist.error);
    raw = dist.html;
  } else {
    raw = fs.readFileSync(target.fragmentPath, 'utf8');
  }
  if (target.shell === 'comp') raw = wrapFragmentForLibrary(raw);
  return target.shell === 'comp' ? wrapCompStage(raw) : wrapPhoneShell(raw, target.shell);
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

/** 嵌入模式（`/api/frame?…&embed=card`）给机壳打的标记：文章站点的卡片与画布浮层只认这两个属性，
 *  不认工作台的 class 名（docs/projects.md「给站点卡片的接口」）。 */
export const EMBED_STAGE_ATTR = 'data-pp-stage';
export const EMBED_DEVICE_ATTR = 'data-pp-device';
const STAGE_CLASSES = { 'ios-stage': 'phone', 'wb-comp-stage': 'comp', 'wb-doc-stage': 'doc' };

/** 在第一个机壳（ios-stage / wb-comp-stage / wb-doc-stage）上打 data-pp-stage="<种类>"，第一个 ios-device 上打 data-pp-device。
 *  只加属性，不改结构：stage 以下的 DOM 链仍与画布同构。 */
export function markEmbedStage(html) {
  let staged = false;
  let deviced = false;
  return String(html).replace(/<div\b([^>]*?)\bclass\s*=\s*(["'])([^"']*)\2([^>]*)>/gi, (full, pre, q, cls, post) => {
    const tokens = cls.split(/\s+/);
    let add = '';
    if (!staged) {
      const kind = tokens.map((t) => STAGE_CLASSES[t]).find(Boolean);
      if (kind) { staged = true; add += ` ${EMBED_STAGE_ATTR}="${kind}"`; }
    }
    if (!deviced && tokens.includes('ios-device')) { deviced = true; add += ` ${EMBED_DEVICE_ATTR}`; }
    return add ? `<div${pre}class=${q}${cls}${q}${post}${add}>` : full;
  });
}

/**
 * 组装 /api/frame 的完整自包含 HTML 文档。
 * data-annotate="off" 只挡 ios-kit 的自注入；annotate 注入由本函数显式完成
 * （带 __pinpointEntry=帧所属页 / __pinpointFrame=帧身份），opts.annotate=false
 * 时完全不出标注面。storage-unify：不再注入 __pinpointLedger —— 帧账本恒为
 * 所属页桶的 @canvas，客户端按 FRAME 身份自取，不再跟顶层工作台 pathname 走。
 */
export async function framePageHtml(target, opts = {}) {
  // embed: 'card'（文章站点的卡片与浮层）：不出图注，机壳打 data-pp-stage / data-pp-device，不注入标注客户端。
  const embed = opts.embed === 'card';
  const annotate = opts.annotate !== false && !embed;
  // 预览脚本惰性化：完整文档里原生 <script> 会立刻执行（root 未定义），契约执行
  // 权交给 client/frame-boot.js（与画布 innerHTML 不执行语义对齐）。
  const content = neutralizePreviewScripts(await assembleFrameContent(target));
  const wrapped = embed ? markEmbedStage(content) : content;
  const frameIdentity = {
    pageId: target.pageId,
    screenId: target.screenId,
    section: target.section || '',
    sectionLabel: target.sectionLabel || '',
  };
  const inject = annotate
    ? `<script>window.__pinpointEntry=${JSON.stringify(target.entry)};` +
      `window.__pinpointFrame=${JSON.stringify(frameIdentity).replace(/<\//g, '<\\/')}</script>` +
      `<script src="${annotateClientSrc()}" async></script>`
    : '';
  return `<!doctype html>
<html data-annotate="off"${embed ? ' data-pp-embed="card"' : ''}>
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
${embed ? '' : frameCaptionHtml(target)}
${wrapped}
</div>
<script src="/kits/ios/ios-kit.js"></script>
<script>${frameBootSource()}</script>
${inject}
</body>
</html>`;
}

/* ---- 图：正文里的 <Figure>（docs/projects.md“图”） ---- */

const FIGURE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** 页 id + 图 id → { target（文章的编译目标）, pageId, figureId }。图只属于文章；源文件不在就 404。 */
export function resolveFigureTarget(pageId, figureId, options = {}) {
  if (!ENTRY_OR_ARTICLE_ID_PATTERN.test(String(pageId || ''))) {
    throw new FrameDocError('bad_request', `invalid page id "${pageId}"`);
  }
  if (!FIGURE_ID_RE.test(String(figureId || ''))) {
    throw new FrameDocError('bad_request', `invalid figure id "${figureId}"`);
  }
  const page = resolvePage(options.registry || null, pageId);
  if (!page || page.kind !== 'article') throw new FrameDocError('unknown_page', `not an article page: ${pageId}（图只在文章里）`);
  const file = path.join(page.target.pageDir, 'figures', `${figureId}.jsx`);
  if (!fs.existsSync(file)) throw new FrameDocError('unknown_screen', `figure not found: ${pageId}/figures/${figureId}.jsx`);
  return { target: page.target, pageId, figureId };
}

const jsonInScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * 图页的启动脚本（内联 module）：把图的高度报给文章页（postMessage，文章页据此定 iframe 高度，
 * 没有滚动条）；跑 sidecar 的 mount(root)；捕获运行错误，写在图的位置、报给文章页、
 * 记到服务（POST /api/figure-error，只记这一版的第一次）。全部做完在 <html> 上打 data-figure-ready。
 */
function figureBootSource(info) {
  return `
const info = ${jsonInScript(info)};
const root = document.querySelector('[data-pp-figure-root]');
const post = (msg) => { try { if (parent !== window) parent.postMessage({ source: 'pp-figure', page: info.page, figure: info.id, ...msg }, location.origin); } catch {} };
const size = () => post({ type: 'size', height: Math.ceil(root.getBoundingClientRect().height) });
new ResizeObserver(size).observe(root);
size();
if (document.documentElement.dataset.figureError) post({ type: 'error', message: document.documentElement.dataset.figureError });
const where = (stack) => {
  const m = String(stack || '').match(new RegExp('figures/' + info.id + '\\\\.js(?:\\\\?[^:\\\\s]*)?:(\\\\d+)'));
  return m ? Number(m[1]) : null;
};
let failed = false;
const fail = (message, stack) => {
  const line = where(stack);
  const box = document.createElement('div');
  box.className = 'fig-error';
  box.setAttribute('role', 'alert');
  box.innerHTML = '<b>这个图运行出错</b>';
  box.append(String(message) + (line ? '（figures/' + info.id + '.js 第 ' + line + ' 行）' : ''));
  root.prepend(box);
  document.documentElement.dataset.figureError = String(message);
  post({ type: 'error', message: String(message), line });
  if (failed || !info.builtAt) return;
  failed = true;
  fetch('/api/figure-error', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: info.page, figure: info.id, builtAt: info.builtAt, message: String(message), line }) }).catch(() => {});
};
addEventListener('error', (e) => fail(e.message || 'Error', (e.error && e.error.stack) || (e.filename + ':' + e.lineno)));
addEventListener('unhandledrejection', (e) => fail((e.reason && e.reason.message) || String(e.reason), e.reason && e.reason.stack));
if (info.script) {
  try {
    const mod = await import(info.script);
    const mount = typeof mod.default === 'function' ? mod.default : mod.mount;
    if (typeof mount !== 'function') fail('figures/' + info.id + '.js 没有导出 mount(root)（写 export default function mount(root) { … }）');
    else await mount(root);
  } catch (error) {
    fail((error && error.message) || String(error), error && error.stack);
  }
}
document.documentElement.dataset.figureReady = '1';
size();
post({ type: 'ready' });
`;
}

function figureHead({ pageId, figureId, theme, links = [] }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/sites/${escHtml(pageId)}/">
<title>${escHtml(figureId)}</title>
<script type="importmap">{"imports":{"pinpoint/figure":"/kits/figure/figure.js"}}</script>
<link rel="stylesheet" href="/kits/figure/figure.css">
${links.join('\n')}
<script>
/* 深浅色跟着文章页：读外层 <html data-theme>，外层切换时跟着切；没有外层（单独打开、截图）时用 ?theme= 或系统设置。 */
(function () {
  var d = document.documentElement;
  if (parent === window) return;
  function sync() {
    try {
      var t = parent.document.documentElement.getAttribute('data-theme');
      if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t); else d.removeAttribute('data-theme');
    } catch (e) {}
  }
  sync();
  try { new parent.MutationObserver(sync).observe(parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) {}
})();
</script>`;
}

const themeAttr = (theme) => (theme === 'light' || theme === 'dark' ? ` data-theme="${theme}"` : '');

/**
 * 图页（/api/frame?page=<页>&figure=<图>&embed=figure）：没有机壳、没有图注、不注入标注客户端。
 * loaded 是 loadFigure 的结果（page-compiler.js）。编译失败时出同一个外壳，图的位置写错误原因
 * （调用方回 500）。opts.theme：light / dark，单独打开时用（嵌在文章页里时跟外层走）。
 */
export function figurePageHtml(resolved, loaded, opts = {}) {
  const { pageId, figureId } = resolved;
  const record = loaded.record || {};
  const version = (file) => {
    const source = (record.sources || []).find((row) => row.file === file);
    return source ? `?v=${Math.round(source.mtimeMs)}` : '';
  };
  const links = [];
  if (loaded.ok && record.usesKit) links.push('<link rel="stylesheet" href="/kits/ios/ios-kit.css">');
  if (loaded.ok && record.css) links.push(`<link rel="stylesheet" href="figures/${escHtml(figureId)}.css${version(`figures/${figureId}.css`)}">`);
  const info = {
    page: pageId,
    id: figureId,
    builtAt: loaded.ok ? record.builtAt || 0 : 0,
    // ./ 开头：import() 里不带 ./ 的相对路径算裸说明符，会去查 import map。
    script: loaded.ok && record.script ? `./figures/${figureId}.js${version(`figures/${figureId}.js`)}` : null,
  };
  const body = loaded.ok
    ? loaded.html
    : `<div class="fig-error" role="alert"><b>这个图编译失败</b>${escHtml(loaded.error || '')}</div>`;
  return `<!doctype html>
<html lang="zh-CN" data-annotate="off" data-pp-embed="figure"${themeAttr(opts.theme)}${loaded.ok ? '' : ` data-figure-error="${escHtml(loaded.error || '')}"`}>
<head>
${figureHead({ pageId, figureId, theme: opts.theme, links })}
</head>
<body>
<div class="pp-figure" data-pp-figure-root="${escHtml(figureId)}">
${body}
</div>
<script type="module">${figureBootSource(info).replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
}
