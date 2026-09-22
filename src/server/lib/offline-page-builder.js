import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { boardRefs } from '../../workbench/lib/board-refs.js';
import { escHtml } from '../../workbench/lib/esc-html.js';
import { validateBoard } from '../../workbench/lib/preview-contracts.js';
import {
  assembleFrameContent,
  neutralizePreviewScripts,
  readWorkbenchInlineStyles,
  resolveFrameTarget,
} from './frame-doc.js';
import {
  OfflinePageExportError,
  buildOfflineShareHtml,
  bundleHtmlAssets,
} from './offline-page-export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PAGE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function readText(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

// 经典脚本内联进 <script>（与 frame-boot 同一做法），正文里不能有 </script。
function readInlineScript(relative) {
  const source = readText(relative);
  if (/<\/script/i.test(source)) {
    throw new OfflinePageExportError('unsafe_script', `${relative} must not contain </script>`);
  }
  return source;
}

function resolvePage(pageId, registry) {
  if (!PAGE_ID_RE.test(String(pageId || ''))) {
    throw new OfflinePageExportError('bad_page', `invalid page id: ${pageId}`);
  }
  const entry = registry && typeof registry.resolve === 'function' ? registry.resolve(pageId) : null;
  if (!entry) throw new OfflinePageExportError('unknown_page', `unknown registry page: ${pageId}`);
  if (entry.kind !== 'dir' || entry.board !== 'ios') {
    throw new OfflinePageExportError('unsupported_page', `${pageId}: offline HTML V1 supports registry dir entries with board "ios" only`);
  }
  const root = path.resolve(entry.path);
  const boardFile = path.join(root, 'board.json');
  if (!fs.existsSync(boardFile)) {
    throw new OfflinePageExportError('board_missing', `${pageId}: board.json not found`);
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(boardFile, 'utf8')); }
  catch (error) { throw new OfflinePageExportError('board_invalid', `${pageId}: ${error.message || error}`); }
  const board = validateBoard(raw, { pageId, defaultShell: 'app' });
  for (const section of board.sections) {
    if (section.layout !== 'row') {
      throw new OfflinePageExportError('unsupported_layout', `${pageId}/${section.id}: V1 requires row sections`);
    }
    for (const screen of section.screens) {
      if (screen.shell !== 'app' && screen.shell !== 'lock') {
        throw new OfflinePageExportError('unsupported_screen', `${pageId}/${screen.id}: V1 supports app/lock Frames only`);
      }
    }
  }
  return { entry, root, board };
}

function frameHtml(screen, target, body, ref) {
  const cap = '<div class="wb-screen-cap">' +
    (ref ? `<span class="wb-cap-ref">${escHtml(ref)}</span>` : '') +
    `<span class="wb-cap-title" title="${escHtml(screen.title || screen.id)}">${escHtml(screen.title || screen.id)}</span>` +
    '</div>';
  // id="frame-<screenId>" 是大纲链接与深链的锚（ADR 0033）；class 与画布的 .wb-screen 同名。
  return `<div class="wb-screen" id="frame-${escHtml(screen.id)}" data-screen="${escHtml(screen.id)}">${cap}${body}<div class="wb-screen-dim">402 × 874</div></div>`;
}

function uniqueRemote(items) {
  const byUrl = new Map();
  items.forEach((item) => {
    const previous = byUrl.get(item.url);
    if (previous && previous.sha256 !== item.sha256) {
      throw new OfflinePageExportError('remote_changed', `${item.url}: bytes changed while preparing export`, item);
    }
    byUrl.set(item.url, item);
  });
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

function cacheRemoteResponses(fetchRemote = globalThis.fetch) {
  const cache = new Map();
  return async function cachedFetch(url) {
    if (!cache.has(url)) {
      cache.set(url, Promise.resolve(fetchRemote(url)).then(async (response) => ({
        status: response.status,
        headers: [...response.headers.entries()],
        bytes: Buffer.from(await response.arrayBuffer()),
      })));
    }
    const cached = await cache.get(url);
    return new Response(cached.bytes, { status: cached.status, headers: cached.headers });
  };
}

export async function buildOfflinePage(options = {}) {
  const { pageId, registry } = options;
  const resolved = resolvePage(pageId, registry);
  const refs = boardRefs(resolved.board);
  const fetchRemote = cacheRemoteResponses(options.fetchRemote);
  const allRemote = [];
  const sections = [];

  for (const section of resolved.board.sections) {
    const screens = [];
    for (const screen of section.screens) {
      const target = resolveFrameTarget(pageId, screen.id, { registry });
      if (target.kind !== 'fragment') {
        throw new OfflinePageExportError('unsupported_screen', `${pageId}/${screen.id}: expected an iOS fragment`);
      }
      const bundled = await bundleHtmlAssets(await assembleFrameContent(target), {
        // pp2：dist 屏的资源引用以页目录为基准（dist 在 ~/.pinpoint 下，相对引用
        // 按源目录语义解读）；磁盘屏照旧以自己的文件位置为基准。
        baseFile: target.distTarget
          ? path.join(target.distTarget.pageDir, `${target.screenId}.html`)
          : target.fragmentPath,
        entryRoot: resolved.root,
        entryId: pageId,
        pinpointRoot: ROOT,
        registry,
        approvals: options.approvals,
        fetchRemote,
      });
      allRemote.push(...bundled.remoteResources);
      const ref = refs.byFrame[section.id + '\0' + screen.id] || '';
      screens.push({
        id: screen.id,
        title: screen.title || screen.id,
        ref,
        html: frameHtml(screen, target, neutralizePreviewScripts(bundled.html), ref),
      });
    }
    sections.push({
      id: section.id,
      title: section.title || section.id,
      ref: refs.bySection[section.id] || '',
      screens,
    });
  }

  const remoteResources = uniqueRemote(allRemote);
  const title = resolved.entry.title || pageId;
  return {
    pageId,
    title,
    filename: `${pageId}__interactive.html`,
    sectionCount: sections.length,
    frameCount: sections.reduce((sum, section) => sum + section.screens.length, 0),
    remoteResources,
    html: buildOfflineShareHtml({
      pageId,
      title,
      sections,
      workbenchCss: readText('src/workbench/wb-tokens.css') + '\n' + readWorkbenchInlineStyles(),
      iosCss: readText('content/kits/ios/ios-kit.css'),
      iosKitJs: readText('content/kits/ios/ios-kit.js'),
      frameBootJs: readInlineScript('src/client/frame-boot.js'),
      shareRuntimeJs: readInlineScript('src/client/share-runtime.js'),
    }),
  };
}
