import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { boardRefs } from '../../workbench/lib/board-refs.js';
import { readBoard } from './board-file.js';
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
  if (!fs.existsSync(path.join(root, 'board.json'))) {
    throw new OfflinePageExportError('board_missing', `${pageId}: board.json not found`);
  }
  const parsed = readBoard(root);
  if (!parsed) throw new OfflinePageExportError('board_invalid', `${pageId}: board.json 不是合法 JSON`);
  const validated = validateBoard(parsed, { pageId, defaultShell: 'app' });
  // 导出的是画布：doc 帧不在导出范围内（与导出对话框的计数同一口径），
  // 整个 Section 都是 doc 帧时连 Section 一起略过。
  const sections = [];
  for (const section of validated.sections) {
    const screens = section.screens.filter((screen) => screen.shell !== 'doc');
    if (!screens.length) continue;
    if (section.layout !== 'row') {
      throw new OfflinePageExportError('unsupported_layout', `${pageId}/${section.id}: V1 requires row sections`);
    }
    for (const screen of screens) {
      if (screen.shell !== 'app' && screen.shell !== 'lock') {
        throw new OfflinePageExportError('unsupported_screen', `${pageId}/${screen.id}: V1 supports app/lock Frames only`);
      }
    }
    sections.push({ ...section, screens });
  }
  return { entry, root, board: { ...validated, sections } };
}

// 导出剥内部锚点（review R8）：data-pp-id / data-pp-comp 是标注锚与源码文件名，
// 只活在 pinpoint 里 —— handoff 出去的 HTML 不带页内文件名与机器地址。
function stripPpAnchors(html) {
  return String(html).replace(/ data-pp-(?:id|comp)="[^"]*"/g, '');
}

function frameHtml(screen, target, body, ref, selected = false) {
  // 变体（lib/board-variants.js）：图注带组名；分享页全部变体都展开，评审者选中的那个加 wb-var-sel 高亮
  // （样式在 index.html，与工作台画布同一份）。
  const title = screen.variantOf
    ? (screen.groupTitle || screen.variantOf) + (screen.title ? ` · ${screen.title}` : '')
    : (screen.title || screen.id);
  const cap = '<div class="wb-screen-cap">' +
    (ref ? `<span class="wb-cap-ref">${escHtml(ref)}</span>` : '') +
    `<span class="wb-cap-title" title="${escHtml(title)}">${escHtml(title)}</span>` +
    '</div>';
  // id="frame-<screenId>" 是大纲链接与深链的锚（ADR 0033）；class 与画布的 .wb-screen 同名。
  const cls = selected ? 'wb-screen wb-var-sel' : 'wb-screen';
  return `<div class="${cls}" id="frame-${escHtml(screen.id)}" data-screen="${escHtml(screen.id)}">${cap}${body}<div class="wb-screen-dim">402 × 874</div></div>`;
}

/** 每个变体组选中的变体 id：评审者在工作台选的（variantSelection，键 = 段 id + NUL + 组 id），没选过就是第一个。 */
function selectedVariants(section, variantSelection) {
  const first = new Map();
  for (const screen of section.screens) {
    if (screen.variantOf && !first.has(screen.variantOf)) first.set(screen.variantOf, screen.id);
  }
  const chosen = new Map();
  for (const [groupId, firstId] of first) {
    const want = variantSelection && variantSelection[`${section.id}\0${groupId}`];
    const valid = section.screens.some((screen) => screen.variantOf === groupId && screen.id === want);
    chosen.set(groupId, valid ? want : firstId);
  }
  return chosen;
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
    const chosen = selectedVariants(section, options.variantSelection);
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
        html: frameHtml(screen, target, neutralizePreviewScripts(stripPpAnchors(bundled.html)), ref, !!screen.variantOf && chosen.get(screen.variantOf) === screen.id),
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
