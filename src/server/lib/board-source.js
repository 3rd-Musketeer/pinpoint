/**
 * 页 id → target → board 的唯一判定（S2，r2-consistency D2：此前 frame-doc 三分支、
 * page-compiler 的 resolvePageTarget / readTargetBoard、sites-api 与 synth-board 的
 * 散落组合各写一份）。
 *
 *   resolveBoardSource(pageId, { registry, root }) → source | null
 *
 * source 是三种来源（同一接口的三个实现）：
 *   dir / file  registry 条目：板读条目目录的 board.json（读不到且目录顶层有 *.html
 *               或 file 条目时另有合成板，见 synth-board.js）；有板才可编译（target）。
 *   template    模板页：content/previews/<id>/board.json 在盘上即成来源；清单
 *               （_index.json）里的条目在 manifest 上（frame-doc 只认清单页，要它的 mode）。
 *   article     文章画布页 <project>_<article>：板由 index.mdx 派生（article-board.js，
 *               带按输入 stat 的缓存），恒可编译。
 *
 * source = {
 *   kind: 'dir' | 'file' | 'template' | 'article',
 *   entry,                  // registry 条目（dir / file），否则 null
 *   pageDir,                // 页目录；file 条目为 null
 *   urlBase,                // 帧资源 URL 前缀
 *   mode,                   // 'ios' | 'html'：归一壳的缺省判定用（frame-doc）
 *   listed,                 // 模板页在清单（_index.json）上；其他 kind 恒 false
 *   target,                 // 编译目标（page-compiler 消费的形状）；无板 dir / file 为 null
 *   readBoard(),            // → 板（磁盘原样 / 派生 / 合成，不摊平 tabs）；读不到 → null
 * }
 *
 * 「页 id 是什么 / 桶活不活」的判定在 page-resolve.js（resolvePage / pageIdIsLive）——
 * 那里含没有板的页（清单页、无板条目）；这里只答「board 从哪来、能不能编」。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { deriveArticleBoard } from './article-board.js';
import { readBoardRaw } from './board-file.js';
import { requireSource } from './compiler-source.js';
import { manifestPages } from './page-manifest.js';
import { resolveArticleTarget } from './page-resolve.js';
import { registryEntry } from './registry.js';
import { resolveContainedFile } from './servable-file.js';
import { synthesizeBoard } from './synth-board.js';
import { PAGE_ID_PATTERN } from '../../shared/registry-ids.js';
import { entryBoardMode } from '../../workbench/lib/preview-contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

function entrySource(entry) {
  const pageDir = entry.kind === 'dir' ? path.resolve(entry.path) : null;
  const urlBase = `/sites/${entry.id}/`;
  return {
    kind: entry.kind,
    entry,
    pageDir,
    urlBase,
    mode: entryBoardMode(entry),
    listed: false,
    target: pageDir && fs.existsSync(path.join(pageDir, 'board.json'))
      ? { entryId: entry.id, pageDir, urlBase, kind: 'dir' }
      : null,
    // 磁盘没板（或板坏了）时回落合成板：dir / file 的合成板此前是单独的 synthBoard()，
    // 唯一调用形状是 readBoard() || synthBoard()，收成这一处。
    readBoard() {
      return (pageDir ? readBoardRaw(pageDir) : null) || synthesizeBoard(entry);
    },
  };
}

function templateSource(pageId, pageDir, manifest) {
  return {
    kind: 'template',
    entry: null,
    pageDir,
    urlBase: `/previews/${pageId}/`,
    mode: manifest && manifest.mode === 'html' ? 'html' : 'ios',
    listed: !!manifest,
    target: { entryId: pageId, pageDir, urlBase: `/previews/${pageId}/`, kind: 'template' },
    readBoard() {
      return readBoardRaw(pageDir);
    },
  };
}

function articleSource(target) {
  return {
    kind: 'article',
    entry: null,
    pageDir: target.pageDir,
    urlBase: target.urlBase,
    mode: 'ios',
    listed: false,
    target,
    readBoard() {
      try {
        return deriveArticleBoard(target).board;
      } catch {
        return null;
      }
    },
  };
}

/**
 * 页 id → board 来源。优先序与 page-resolve 的 resolvePage 一致：registry 条目 →
 * 模板页 → 文章画布。条目在登记即来源（无板 dir / file 条目 target 为 null、
 * 板靠合成），不再回落模板页判一个同名的 previews 目录。
 */
export function resolveBoardSource(pageId, { registry = null, root = ROOT } = {}) {
  if (typeof pageId !== 'string' || !PAGE_ID_PATTERN.test(pageId)) return null;
  const entry = registryEntry(registry, pageId);
  if (entry && (entry.kind === 'dir' || entry.kind === 'file') && typeof entry.path === 'string') {
    return entrySource(entry);
  }
  const previewsRoot = path.join(root, 'content', 'previews');
  if (resolveContainedFile(previewsRoot, `${pageId}/board.json`, { index: false }).file) {
    const manifest = manifestPages(root).find((page) => page && page.id === pageId) || null;
    return templateSource(pageId, path.join(previewsRoot, pageId), manifest);
  }
  const target = resolveArticleTarget(registry, pageId);
  return target ? articleSource(target) : null;
}

/** 页 id → 编译目标（page-compiler / preview-hmr / CLI 消费）；不可编译（无板 dir / file / 不是页）→ null。 */
export function resolvePageTarget(pageRef, { registry = null, root = ROOT } = {}) {
  const source = resolveBoardSource(pageRef, { registry, root });
  return source ? source.target : null;
}

/**
 * 编译目标的 board 原文（不摊平 tabs）：dir / 模板页读页目录的 board.json，
 * 文章画布从 index.mdx 派生（带缓存）。读不到 / 坏 JSON 抛错（编译要响，
 * 容忍 null 的消费方走 source.readBoard()）。
 */
export function readTargetBoard(target, input = null) {
  if (target && target.kind === 'article') return deriveArticleBoard(target).board;
  const file = fs.realpathSync(requireSource(target, 'board.json'));
  const mtimeMs = fs.statSync(file).mtimeMs;
  const bytes = fs.readFileSync(file);
  const board = JSON.parse(bytes.toString('utf8'));
  if (input) Object.assign(input, { file: 'board.json', mtimeMs, realpath: fs.realpathSync(file), sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  return board;
}
