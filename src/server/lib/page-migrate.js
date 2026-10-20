/**
 * pp3：把一个存量页迁成一篇 article（docs/projects.md「从存量页迁移」）。
 * owner 定的口径：存量 page = 一篇 article；board 的每个 section 成为正文的一节，
 * 节里一个 <Canvas>。
 *
 * 三步，CLI（bin/cli/migrate.js）按顺序调：
 *   planPageMigration({ pageId, projectRoot, articleId?, registry })
 *     → plan：要写的文件、index.mdx、警告与拦截问题。只读：旧页用编译器编进临时
 *       dist（拿每帧的 HTML 和 import 依赖），算完删掉。
 *   writeMigration(plan)：建文章目录、写文件。目录已在就拒绝。
 *   verifyMigration(plan)：从新写的 index.mdx 派生 board，逐帧编译（临时 dist），
 *     与旧页的渲染逐行比。
 *
 * 旧页一个字节都不动，也不取消登记；标注不迁（桶 = 页 id，新文章是新桶）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENTRY_ID_PATTERN } from '../../shared/registry-ids.js';
import { boardRefs } from '../../workbench/lib/board-refs.js';
import { flattenTabs, hasRawTabs } from '../../workbench/lib/board-tabs.js';
import { COMP_NAME_PATTERN, entryBoardMode, legacyShell } from '../../workbench/lib/preview-contracts.js';
import { ARTICLE_ASSET_FILES, deriveArticleBoard } from './article-board.js';
import { resolveArticleTarget } from './page-resolve.js';
import { readFrameShell } from './article-canvas.js';
import { collectHtmlFrameAssets } from './html-frame-assets.js';
import { compilePage, readBuildJson } from './page-compiler.js';
import { readTargetBoard, resolvePageTarget } from './board-source.js';
import { manifestPageIds } from './page-manifest.js';
import {
  articlePageId,
  CANVAS_SHELLS,
  SCREEN_ID_PATTERN as FRAME_ID,
  RESERVED_ARTICLE_IDS,
  SECTION_ID_PATTERN as SECTION_ID,
} from '../../shared/project-ids.js';
import { PROJECT_CONTENT_DIR, readProjectJson } from './projects.js';
import { formatProjectError } from '../../shared/project-errors.js';
import { isFile } from './fs-utils.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KITS_DIR = path.join(REPO_ROOT, 'content', 'kits');

// 文本文件：做 URL 改写；其他文件逐字节复制。
const TEXT_EXTS = new Set(['.jsx', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.css', '.svg', '.html', '.htm', '.txt', '.md']);
const SCRIPT_EXTS = new Set(['.jsx', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
// 帧 / 组件 / css 里引用、要搬进 assets/ 的静态文件。
const STATIC_EXTS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.pdf']);

export class MigrateError extends Error {}

const posix = path.posix;
const toPosix = (p) => p.split(path.sep).join('/');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function filesUnder(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...filesUnder(full));
    else if (item.isFile()) out.push(full);
  }
  return out;
}

function within(base, p) {
  return p === base || p.startsWith(base + path.sep);
}

/**
 * 页内相对路径越没越出页目录（xreview B）：文本上带 `..` 或绝对路径，或者 realpath（symlink 的真实落点）
 * 不在页目录的 realpath 里。在页内返回 null，越界返回接在路径后面的说明。文件不在盘上时只看文本，
 * “不存在”由调用方另报。
 */
function pageEscape(pageReal, pageDir, rel) {
  const norm = posix.normalize(toPosix(rel));
  if (posix.isAbsolute(norm) || norm === '..' || norm.startsWith('../')) return ' 在页目录外';
  let real;
  try {
    real = fs.realpathSync(path.join(pageDir, norm));
  } catch {
    return null;
  }
  return within(pageReal, real) ? null : ` 的真实位置在页目录外（${real}）`;
}

/** 文章目录内的相对路径越没越出文章目录：越界返回 true。 */
function articleEscape(articleDir, rel) {
  const base = path.resolve(articleDir);
  const to = path.resolve(base, rel);
  return to === base || !within(base, to);
}

/** 相对 url：没有协议、不以 / # 开头、不是 data:。 */
function isRelativeUrl(url) {
  return !!url && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url);
}

function splitQuery(url) {
  const cut = url.search(/[?#]/);
  return cut < 0 ? [url, ''] : [url.slice(0, cut), url.slice(cut)];
}

/** 页内相对路径（posix），逃出页目录返回 null。 */
function pageRel(fromDirRel, ref) {
  const joined = posix.normalize(posix.join(fromDirRel || '.', ref));
  if (joined === '..' || joined.startsWith('../') || posix.isAbsolute(joined)) return null;
  return joined;
}

/** 静态 import / export from / import()（字面量）里的相对说明符。 */
function relativeImports(text) {
  const out = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"']+)\1/g;
  for (const m of String(text).matchAll(re)) out.push(m[2]);
  return out;
}

const RESOLVE_EXTS = ['', '.jsx', '.js', '.mjs', '.ts', '.tsx', '.json', '/index.jsx', '/index.js'];

function resolveImport(pageDir, fromRel, spec) {
  const base = pageRel(posix.dirname(fromRel), spec);
  if (base === null) return { outside: posix.join(posix.dirname(fromRel), spec) };
  for (const ext of RESOLVE_EXTS) {
    if (isFile(path.join(pageDir, base + ext))) return { rel: base + ext };
  }
  return { missing: base };
}

/** PascalCase 函数名（生成的 comp 帧用）。 */
function componentName(id) {
  const name = id.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z_$]/.test(name) ? name : `Frame${name}`;
}

const JSX_ATTR_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

/** comp 屏的 props → JSX 属性。字符串写成 name="…"，其他写成 name={JSON}。 */
function propsToJsx(props) {
  const parts = [];
  const rest = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (!JSX_ATTR_NAME.test(key)) {
      rest[key] = value;
      continue;
    }
    if (typeof value === 'string' && !/["{}<>\n\\&]/.test(value)) parts.push(`${key}="${value}"`);
    else if (value === true) parts.push(key);
    else parts.push(`${key}={${JSON.stringify(value)}}`);
  }
  if (Object.keys(rest).length) parts.push(`{...${JSON.stringify(rest)}}`);
  return parts.join(' ');
}

/** 组件文件有没有同名命名导出（没有就按默认导出 import，与编译器 `__M[Name] || __M.default` 同序）。 */
function hasNamedExport(text, name) {
  const n = escapeRe(name);
  return new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${n}\\b`).test(text)
    || new RegExp(`export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`).test(text);
}

/** comp 屏 → 一份帧文件：渲染那个组件、带那组 props。 */
export function compFrameSource({ id, comp, props, importPath, named, shell }) {
  const importLine = named
    ? `import { ${comp} } from '${importPath}';`
    : `import ${comp} from '${importPath}';`;
  const attrs = propsToJsx(props);
  // 帧函数名不能和 import 进来的组件同名（plan-schema → PlanSchema）。
  const fn = componentName(id) === comp ? `${comp}Frame` : componentName(id);
  return [
    importLine,
    ...(shell ? ['', `export const shell = ${JSON.stringify(shell)};`] : []),
    '',
    `export default function ${fn}() {`,
    `  return <${comp}${attrs ? ` ${attrs}` : ''} />;`,
    '}',
    '',
  ].join('\n');
}

/** MDX 属性值：不含 " 用双引号；含 " 不含 ' 用单引号；都含时把 " 写成实体。 */
function mdxAttr(value) {
  const s = String(value);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/"/g, '&quot;')}"`;
}

/** plan → index.mdx 全文（只放结构：frontmatter、节、画布，每节一行正文占位）。 */
export function buildArticleMdx(plan) {
  const lines = ['---', `title: ${JSON.stringify(plan.title)}`, 'summary: ""', '---', ''];
  let tab = null;
  for (const section of plan.sections) {
    if (section.tabTitle !== undefined && section.tabId !== tab) {
      tab = section.tabId;
      lines.push(`## ${section.tabTitle}`, '');
    }
    lines.push(`<Section id=${mdxAttr(section.id)} title=${mdxAttr(section.title)}>`, '{/* 正文 */}', '');
    if (section.frames.length) {
      const ids = section.frames.map((frame) => JSON.stringify(frame.id));
      const shell = section.canvasShell ? ` shell=${mdxAttr(section.canvasShell)}` : '';
      if (ids.length <= 4) lines.push(`<Canvas frames={[${ids.join(', ')}]}${shell} />`);
      else lines.push('<Canvas frames={[', ...ids.map((id) => `  ${id},`), `]}${shell} />`);
    }
    lines.push('</Section>', '');
  }
  return lines.join('\n');
}

/** 旧页的标题与模式（模式决定缺省壳：html 页的屏缺省是 doc）。 */
function legacyMeta(target, registry, root) {
  if (target.kind === 'template') {
    let page = null;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(root, 'content', 'previews', '_index.json'), 'utf8'));
      page = (doc.pages || []).find((row) => row && row.id === target.entryId) || null;
    } catch { /* 读不到：用 id */ }
    return { title: (page && page.title) || target.entryId, mode: (page && page.mode) || 'ios', source: target.pageDir };
  }
  const entries = (registry && registry.entries) || [];
  const entry = entries.find((row) => row && row.id === target.entryId) || null;
  return { title: (entry && entry.title) || target.entryId, mode: entryBoardMode(entry), source: target.pageDir };
}

/**
 * 编进临时 dist：拿每帧的 HTML（对比基线）和 build.json 的依赖记录。
 * 返回 { result, build, html: { 帧 id: html } }，临时目录当场删掉。
 */
async function compileToTemp(target) {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-'));
  try {
    const result = await compilePage(target, { distRoot });
    const build = readBuildJson(distRoot, target.entryId) || { sources: {}, errors: {} };
    const html = {};
    for (const row of result.screens || []) {
      if (!row.ok) continue;
      try {
        html[row.id] = fs.readFileSync(path.join(distRoot, target.entryId, `${row.id}.html`), 'utf8');
      } catch { /* 写失败：当没编出来 */ }
    }
    return { result, build, html };
  } finally {
    fs.rmSync(distRoot, { recursive: true, force: true });
  }
}

function isKitFile(abs) {
  return abs === KITS_DIR || abs.startsWith(KITS_DIR + path.sep);
}

/**
 * 迁移计划（只读）。拦截问题（缺源文件、页外依赖、HTML 帧引用页目录外的文件、id 撞…）进 problems，
 * 有一条 CLI 就不写；警告进 warnings，照写。参数错误、目标已存在等直接抛 MigrateError。
 */
export async function planPageMigration({ pageId, projectRoot, articleId = null, registry = null, root = REPO_ROOT, cwd = process.cwd() }) {
  const target = resolvePageTarget(pageId, { registry, root });
  if (!target) throw new MigrateError(`找不到页：${pageId}（registry 的 dir 条目或模板页，要有 board.json）`);
  if (target.kind === 'article') throw new MigrateError(`${pageId} 已经是一篇文章的画布，不用迁移`);

  const rootAbs = path.resolve(cwd, projectRoot);
  const meta = readProjectJson(rootAbs);
  if (meta.errors.length) {
    throw new MigrateError(`${rootAbs} 不是可用的 project：${meta.errors.map(formatProjectError).join('；')}。先建 ${toPosix(path.join(PROJECT_CONTENT_DIR, 'project.json'))}（见 docs/projects.md），再迁移`);
  }
  const projectId = meta.json.id;
  const article = articleId || pageId;
  if (!ENTRY_ID_PATTERN.test(article) || RESERVED_ARTICLE_IDS.has(article)) {
    throw new MigrateError(`文章 id 不可用："${article}"（必须匹配 ${ENTRY_ID_PATTERN}，且不是 ${[...RESERVED_ARTICLE_IDS].join(' / ')}）${articleId ? '' : '；用 --article <id> 指定'}`);
  }
  const newPageId = articlePageId(projectId, article);
  if (manifestPageIds(root).includes(newPageId) || ((registry && registry.entries) || []).some((row) => row && row.id === newPageId)) {
    throw new MigrateError(`画布页 id ${newPageId} 和已有的页撞了；用 --article 换一个文章 id`);
  }
  const articleDir = path.join(rootAbs, PROJECT_CONTENT_DIR, 'articles', article);
  if (fs.existsSync(articleDir)) throw new MigrateError(`文章目录已存在：${articleDir}（不覆盖；换 --article 或先把它挪走）`);

  let rawBoard;
  try {
    rawBoard = readTargetBoard(target);
  } catch (error) {
    throw new MigrateError(`读不到 ${pageId} 的 board.json：${error.message}`);
  }
  const board = flattenTabs(rawBoard);
  if (!board || !Array.isArray(board.sections)) throw new MigrateError(`${pageId} 的 board.json 没有 sections`);
  const hasTabs = hasRawTabs(rawBoard);
  const tabTitles = new Map((board.tabs || []).map((tab) => [tab.id, tab.title]));
  const legacy = legacyMeta(target, registry, root);
  const pageShell = legacy.mode === 'html' ? 'doc' : 'app';
  const pageDir = target.pageDir;
  const pageReal = fs.realpathSync(pageDir);
  const compiled = await compileToTemp(target);

  const problems = [];
  const warnings = [];
  const files = new Map(); // 新相对路径 → { from?, content?, kind }
  const relMap = new Map(); // 旧页内相对路径 → 新相对路径（文章目录内）
  const urlPairs = []; // [旧串, 新串]：校验时把旧页 HTML 换成新地址再比
  const addFile = (rel, spec) => {
    const prev = files.get(rel);
    if (prev) {
      if ((prev.from && prev.from === spec.from) || (prev.content !== undefined && prev.content === spec.content)) return;
      problems.push(`两份文件都要写到 ${rel}（${prev.kind} 与 ${spec.kind}）`);
      return;
    }
    files.set(rel, spec);
  };
  // 要复制的页内源文件（相对页目录）：帧、组件与依赖、sidecar。保持相对位置，相对 import 不用改。
  const sourceFiles = new Map(); // rel → kind
  const queueSource = (rel, kind) => {
    if (!sourceFiles.has(rel)) sourceFiles.set(rel, kind);
  };
  const queueDeps = (records, who) => {
    for (const dep of records || []) {
      const abs = path.resolve(pageDir, dep.file);
      if (isKitFile(abs)) continue;
      const rel = toPosix(path.relative(pageDir, abs));
      if (rel.startsWith('../') || path.isAbsolute(rel)) {
        problems.push(`${who} 依赖页目录外的文件 ${abs}：相对 import 搬进文章目录会断，先把它挪进页目录或 kit`);
        continue;
      }
      queueSource(rel, rel.startsWith('components/') ? 'component' : 'dep');
    }
  };
  // 编不过的帧拿不到依赖记录：退回按文本扫相对 import。
  const scanDeps = (rel, who, seen = new Set()) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    let text;
    try {
      text = fs.readFileSync(path.join(pageDir, rel), 'utf8');
    } catch {
      return;
    }
    for (const spec of relativeImports(text)) {
      const hit = resolveImport(pageDir, rel, spec);
      if (hit.outside) {
        problems.push(`${who} 依赖页目录外的文件 ${spec}（在 ${rel}）：先把它挪进页目录或 kit`);
      } else if (hit.rel) {
        queueSource(hit.rel, hit.rel.startsWith('components/') ? 'component' : 'dep');
        scanDeps(hit.rel, who, seen);
      }
    }
  };

  const sections = [];
  const seenFrames = new Map();
  const htmlAssets = new Set(); // HTML 帧相对引用的文件（相对页目录），按原路径复制
  const shellAppends = new Map(); // 帧 rel → shell（复制时在文件末尾补一行 export const shell）
  let titled = 0;
  let columnSections = 0;
  for (const section of board.sections) {
    if (!section || typeof section !== 'object') continue;
    if (typeof section.id !== 'string' || !SECTION_ID.test(section.id)) {
      problems.push(`section id 不合文章的规则（${SECTION_ID}）：${JSON.stringify(section.id)}`);
      continue;
    }
    const title = String(section.title || section.id);
    if (section.layout === 'column') columnSections += 1;
    const sectionShell = legacyShell(section.shell, pageShell);
    if (!CANVAS_SHELLS.includes(sectionShell)) problems.push(`section ${section.id} 的 shell 文章不支持：${JSON.stringify(section.shell)}`);
    const out = {
      id: section.id,
      title,
      ...(hasTabs ? { tabId: section.tabId, tabTitle: tabTitles.get(section.tabId) || section.tabId } : {}),
      ...(sectionShell !== 'app' ? { canvasShell: sectionShell } : {}),
      frames: [],
    };
    // 先定整节最终的 <Canvas shell>（xreview I）。HTML 帧不能单帧写 shell，跟着 <Canvas shell> 走，没写时是 doc；
    // 旧页上不是 doc 的 HTML 帧把节的 shell 定成它的壳。下面 JSX / comp 帧按这个最终值决定要不要写帧级 shell，
    // 节末再核对每个 HTML 帧的原壳。
    const htmlFrameShell = (raw) => {
      const screen = typeof raw === 'string' ? { id: raw } : raw;
      if (!screen || typeof screen.id !== 'string' || !FRAME_ID.test(screen.id) || (typeof screen.comp === 'string' && screen.comp)) return null;
      if (isFile(path.join(pageDir, `${screen.id}.jsx`)) || !isFile(path.join(pageDir, `${screen.id}.html`))) return null;
      return legacyShell(screen.shell || section.shell, pageShell);
    };
    const htmlNonDoc = (section.screens || []).map(htmlFrameShell).find((shell) => shell && shell !== 'doc');
    if (htmlNonDoc) out.canvasShell = htmlNonDoc;
    for (const raw of section.screens || []) {
      const screen = typeof raw === 'string' ? { id: raw } : raw;
      if (!screen || typeof screen.id !== 'string' || !FRAME_ID.test(screen.id)) {
        problems.push(`section ${section.id} 里有不合法的帧 id：${JSON.stringify(screen && screen.id)}`);
        continue;
      }
      const id = screen.id;
      if (seenFrames.has(id)) {
        problems.push(`帧 ${id} 在 ${seenFrames.get(id)} 和 ${section.id} 两节里都有：文章里一帧只能出现一次`);
        continue;
      }
      seenFrames.set(id, section.id);
      if (screen.title) titled += 1;
      if (screen.role) warnings.push(`帧 ${id} 的 role "${screen.role}" 不带过来（文章画布没有这个字段）`);
      const shell = legacyShell(screen.shell || section.shell, pageShell);
      if (!CANVAS_SHELLS.includes(shell)) problems.push(`帧 ${id} 的 shell 文章不支持：${JSON.stringify(screen.shell)}`);
      const frame = { id, title: screen.title || '', legacyShell: shell, kind: 'frame' };
      if (typeof screen.comp === 'string' && screen.comp) {
        frame.kind = 'comp';
        if (!COMP_NAME_PATTERN.test(screen.comp)) {
          problems.push(`comp 屏 ${id} 的组件名不合法：${JSON.stringify(screen.comp)}`);
          continue;
        }
        const pageComp = path.join(pageDir, 'components', `${screen.comp}.jsx`);
        const kitComp = path.join(KITS_DIR, 'ios', 'jsx', `${screen.comp}.jsx`);
        let importPath;
        let named = true;
        if (isFile(pageComp)) {
          importPath = `./components/${screen.comp}.jsx`;
          named = hasNamedExport(fs.readFileSync(pageComp, 'utf8'), screen.comp);
          queueSource(`components/${screen.comp}.jsx`, 'component');
          const record = compiled.build.sources && compiled.build.sources[id];
          if (record && record.deps) queueDeps(record.deps, `comp 屏 ${id}`);
          else scanDeps(`components/${screen.comp}.jsx`, `comp 屏 ${id}`);
        } else if (isFile(kitComp)) {
          importPath = 'pinpoint/kit';
        } else {
          problems.push(`comp 屏 ${id} 的组件 ${screen.comp} 找不到（页内 components/ 与 kit 都没有）`);
          continue;
        }
        if (isFile(path.join(pageDir, `${id}.jsx`))) warnings.push(`页目录里有一份没用上的 ${id}.jsx，文章里的 ${id}.jsx 换成由 comp 屏生成的那份`);
        // 节是 comp 墙时这一帧也写明 comp（brief 定的）；单屏 shell 和节不同时也写。
        const frameShell = shell === 'comp' || shell !== (out.canvasShell || 'app') ? shell : undefined;
        if (frameShell) frame.frameShell = frameShell;
        const props = screen.props && typeof screen.props === 'object' && !Array.isArray(screen.props) ? screen.props : {};
        addFile(`${id}.jsx`, { kind: 'comp 帧', content: compFrameSource({ id, comp: screen.comp, props, importPath, named, shell: frameShell }) });
      } else {
        const jsx = `${id}.jsx`;
        if (!isFile(path.join(pageDir, jsx)) && isFile(path.join(pageDir, `${id}.html`))) {
          // HTML 帧（docs/projects.md“HTML 帧”）：同名复制进文章目录；它相对引用的文件按原相对路径一起复制，
          // 引用不用改。引用越出页目录的拦下，引用的文件不在盘上的记一条注意。
          const html = `${id}.html`;
          frame.html = true;
          queueSource(html, 'frame');
          const assets = collectHtmlFrameAssets(path.join(pageDir, html), { root: pageDir });
          // outside 与服务出文件同一条规则（lib/servable-file.js）：越出页目录（含 symlink 指出去）是 outside，
          // . 开头的隐藏文件、index.mdx 是 denied——搬进文章目录后服务也不出，一样拦下。
          for (const row of assets.outside) {
            // symlink 指出去时文本路径还在页内，补上真实位置（只是 /var → /private/var 这类根目录别名不算）。
            let moved = '';
            try {
              const real = fs.realpathSync(row.file);
              if (path.relative(fs.realpathSync(pageDir), real) !== path.relative(pageDir, row.file)) moved = `，真实位置 ${real}`;
            } catch { /* 显示用 */ }
            const at = `（${toPosix(path.relative(pageDir, row.from))} 第 ${row.line} 行 → ${row.file}${moved}）`;
            problems.push(row.reason === 'denied'
              ? `帧 ${id} 引用的 ${JSON.stringify(row.url)} 是 . 开头的隐藏文件或 index.mdx（或符号链接指向它们）${at}：迁成文章后服务不出，先改名`
              : `帧 ${id} 引用了页目录外的文件 ${JSON.stringify(row.url)}${at}：先把它挪进页目录`);
          }
          for (const row of assets.missing) {
            warnings.push(`帧 ${id} 引用的 ${JSON.stringify(row.url)} 不在盘上（${toPosix(path.relative(pageDir, row.from))} 第 ${row.line} 行）：照原样复制，引用还是断的`);
          }
          for (const row of assets.files) htmlAssets.add(toPosix(path.relative(pageDir, row.file)));
          out.frames.push(frame);
          continue;
        }
        if (!isFile(path.join(pageDir, jsx))) {
          problems.push(`帧 ${id} 没有源文件（页目录里既没有 ${jsx} 也没有 ${id}.html）`);
          continue;
        }
        queueSource(jsx, 'frame');
        const record = compiled.build.sources && compiled.build.sources[id];
        if (record && record.deps) queueDeps(record.deps, `帧 ${id}`);
        else scanDeps(jsx, `帧 ${id}`);
        if (isFile(path.join(pageDir, `${id}.js`))) {
          queueSource(`${id}.js`, 'sidecar');
          scanDeps(`${id}.js`, `帧 ${id} 的 sidecar`);
        }
        const own = readFrameShell(fs.readFileSync(path.join(pageDir, jsx), 'utf8'));
        const want = shell !== (out.canvasShell || 'app') ? shell : undefined;
        if (own && own.value) {
          if (own.value !== shell) warnings.push(`帧 ${id} 的文件里已经写了 export const shell = "${own.value}"，旧页按 "${shell}" 显示；文章用文件里的 "${own.value}"`);
          frame.frameShell = own.value;
        } else if (own && own.error) {
          problems.push(`帧 ${id} 的 export const shell 写法文章不认：${own.error}`);
        } else if (want) {
          frame.frameShell = want;
          frame.appendShell = true;
          shellAppends.set(jsx, want);
        }
      }
      out.frames.push(frame);
    }
    // 全是 HTML 帧的 doc 节：HTML 帧缺省就是 doc，<Canvas> 不必写 shell。
    if (out.canvasShell === 'doc' && out.frames.length && out.frames.every((frame) => frame.html)) delete out.canvasShell;
    // HTML 帧在文章里的壳 = <Canvas shell>，没写是 doc。和旧页的壳不同就拦下，写入前报（xreview I）。
    for (const frame of out.frames) {
      const after = out.canvasShell || 'doc';
      if (frame.html && after !== frame.legacyShell) {
        problems.push(`section ${section.id} 里的 HTML 帧 ${frame.id} 在旧页是 ${frame.legacyShell}，迁过去会按 ${after} 显示：HTML 帧不能单帧写 shell，跟着整节的 <Canvas shell> 走，先把壳不同的帧分到不同的 section`);
      }
    }
    if (!out.frames.length) warnings.push(`section ${section.id} 没有可迁的帧：正文里留这一节，不放画布`);
    sections.push(out);
  }
  if (titled) warnings.push(`${titled} 个帧标题不带过来：文章的帧没有标题字段，画布上显示帧 id`);
  if (columnSections) warnings.push(`${columnSections} 个 section 是 layout "column"：文章画布每节都是一行`);
  if (hasTabs) warnings.push('页 tab 摊平成正文的二级标题；编号改成全文统一的节字母（旧页每个 tab 各从 A 起）');

  // 页级资源：assets.css 合成 article.css（单个就是改名），assets.js → article.js。
  const assets = board.assets && typeof board.assets === 'object' ? board.assets : {};
  const cssList = [...new Set((Array.isArray(assets.css) ? assets.css : []).filter((x) => typeof x === 'string' && x))];
  const jsList = [...new Set((Array.isArray(assets.js) ? assets.js : []).filter((x) => typeof x === 'string' && x))];
  // 页级资源也走包含检查：越出页目录的既不读也不写（xreview B）。
  const pageAsset = (rel, field) => {
    const escape = pageEscape(pageReal, pageDir, rel);
    if (escape) problems.push(`board.assets.${field} 里的 ${rel}${escape}：先把它挪进页目录`);
    else if (!isFile(path.join(pageDir, rel))) problems.push(`board.assets.${field} 里的 ${rel} 不存在`);
    else return true;
    return false;
  };
  const cssOk = cssList.filter((rel) => pageAsset(rel, 'css'));
  for (const rel of cssOk) relMap.set(posix.normalize(rel), ARTICLE_ASSET_FILES.css);
  const jsOk = jsList.filter((rel) => pageAsset(rel, 'js'));
  let jsMode = null;
  if (jsList.length === 1 && jsOk.length === 1 && !jsList[0].includes('/')) {
    jsMode = 'rename';
    relMap.set(jsList[0], ARTICLE_ASSET_FILES.js);
  } else if (jsList.length) {
    jsMode = 'imports';
    for (const rel of jsOk) {
      queueSource(posix.normalize(rel), 'js');
      scanDeps(posix.normalize(rel), `board.assets.js ${rel}`);
    }
    if (jsList.length > 1) warnings.push(`board.assets.js 有 ${jsList.length} 个文件：原样复制，article.js 依次 import 它们`);
  }
  for (const rel of htmlAssets) {
    if (!sourceFiles.has(rel)) queueSource(rel, '资源');
  }
  for (const [rel] of sourceFiles) {
    if (!relMap.has(rel)) relMap.set(rel, rel);
  }
  for (const reserved of Object.values(ARTICLE_ASSET_FILES)) {
    if (sourceFiles.has(reserved) && relMap.get(reserved) === reserved) {
      problems.push(`页目录里的 ${reserved} 会占掉文章的固定资源文件名：先改名`);
    }
  }

  // 引用改写：页地址前缀（/sites/<页>/… 或 /previews/<页>/…）→ /sites/<画布页>/…；
  // 页内相对引用的静态文件搬进 assets/。
  const newBase = `/sites/${newPageId}/`;
  const staticTarget = (rel) => {
    if (relMap.has(rel)) return relMap.get(rel);
    const to = rel.startsWith('assets/') ? rel : `assets/${rel}`;
    relMap.set(rel, to);
    addFile(to, { kind: '资源', from: path.join(pageDir, rel) });
    return to;
  };
  // 拼出来的地址（`/sites/<页>/icons/${name}.svg`）：搬不了单个文件，整个目录搬进 assets/。
  const staticDir = (dirRel) => {
    const toDir = dirRel.startsWith('assets/') ? dirRel : `assets/${dirRel}`;
    for (const abs of filesUnder(path.join(pageDir, dirRel))) {
      const rel = toPosix(path.relative(pageDir, abs));
      if (!relMap.has(rel)) {
        relMap.set(rel, `${toDir}${rel.slice(dirRel.length)}`);
        addFile(relMap.get(rel), { kind: '资源', from: abs });
      }
    }
    return toDir;
  };
  const dynamicDirs = new Set();
  const missingRefs = new Set();
  const absRe = new RegExp(`${escapeRe(target.urlBase)}([^"'\`()\\s<>]*)`, 'g');
  const rewrite = (text, fileRel, { css = false } = {}) => {
    let out = text.replace(absRe, (all, rest) => {
      const [p, q] = splitQuery(rest);
      let decoded = p;
      try { decoded = decodeURI(p); } catch { /* 坏的转义：按原样 */ }
      const rel = pageRel('.', decoded || '.');
      if (!rel || rel === '.') return `${newBase}${rest}`;
      let to = rel;
      const dynamic = rel.indexOf('${');
      const dirRel = dynamic >= 0 ? rel.slice(0, rel.lastIndexOf('/', dynamic) + 1) : '';
      if (isFile(path.join(pageDir, rel))) to = staticTarget(rel);
      else if (dirRel && isDir(path.join(pageDir, dirRel))) {
        const toDir = staticDir(dirRel);
        to = `${toDir}${rel.slice(dirRel.length)}`;
        dynamicDirs.add(`${dirRel} → ${toDir}`);
        urlPairs.push([`${target.urlBase}${dirRel}`, `${newBase}${toDir}`]);
      } else missingRefs.add(`${target.urlBase}${rel}`);
      const next = `${newBase}${to}${q}`;
      urlPairs.push([all, next]);
      return next;
    });
    if (css) {
      // css 里的相对 url() / @import 相对 css 文件自己的位置。
      const fromDir = posix.dirname(fileRel);
      const newDir = posix.dirname(relMap.get(fileRel) || fileRel);
      const fix = (ref) => {
        const [p, q] = splitQuery(ref);
        if (!isRelativeUrl(p)) return null;
        const rel = pageRel(fromDir, p);
        if (!rel || !isFile(path.join(pageDir, rel))) return null;
        return posix.relative(newDir, staticTarget(rel)) + q;
      };
      out = out.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (all, quote, ref) => {
        const to = fix(ref);
        return to === null ? all : `url(${quote}${to}${quote})`;
      });
      out = out.replace(/(@import\s+)(['"])([^'"]+)\2/g, (all, lead, quote, ref) => {
        const to = fix(ref);
        return to === null ? all : `${lead}${quote}${to}${quote}`;
      });
    } else if (SCRIPT_EXTS.has(posix.extname(fileRel))) {
      // 帧 / 组件里写的相对静态文件：运行时按页地址解析（不是按文件位置），所以相对页根算。
      out = out.replace(/(["'])([^"'\n]+?)\1/g, (all, quote, ref) => {
        const [p, q] = splitQuery(ref);
        if (!isRelativeUrl(p) || p.startsWith('../') || !STATIC_EXTS.has(posix.extname(p).toLowerCase())) return all;
        const rel = pageRel('.', p);
        if (!rel || !isFile(path.join(pageDir, rel))) return all;
        const to = staticTarget(rel);
        const next = `${quote}${p.startsWith('./') ? './' : ''}${to}${q}${quote}`;
        if (next !== all) urlPairs.push([all, next]);
        return next;
      });
    }
    return out;
  };

  // 复制源文件（文本做改写；没改到的保持原样复制）。
  for (const [rel, kind] of sourceFiles) {
    const escape = pageEscape(pageReal, pageDir, rel);
    if (escape) {
      problems.push(`要复制的 ${rel}${escape}：先把它挪进页目录`);
      continue;
    }
    const from = path.join(pageDir, rel);
    const to = relMap.get(rel);
    if (!TEXT_EXTS.has(posix.extname(rel).toLowerCase())) {
      addFile(to, { kind, from });
      continue;
    }
    const text = fs.readFileSync(from, 'utf8');
    let next = rewrite(text, rel);
    if (shellAppends.has(rel)) {
      // 补在文件末尾：帧前面的行号不变，data-pp-id 和旧页一致。
      next = `${next.replace(/\n*$/, '\n')}\nexport const shell = ${JSON.stringify(shellAppends.get(rel))};\n`;
    }
    addFile(to, next === text ? { kind, from } : { kind, content: next, rewritten: true });
  }
  // article.css
  if (cssOk.length) {
    const parts = cssOk.map((rel) => ({
      rel,
      text: rewrite(fs.readFileSync(path.join(pageDir, rel), 'utf8'), posix.normalize(rel), { css: true }),
    }));
    let content;
    if (parts.length === 1) content = parts[0].text;
    else {
      // @import 只能在样式表开头：拼接时统一提到最前面。
      const imports = [];
      const bodies = parts.map(({ rel, text }) => `/* ${rel} */\n${text.replace(/@import\s+[^;]+;\s*/g, (rule) => {
        imports.push(rule.trim());
        return '';
      })}`);
      content = `${imports.length ? `${imports.join('\n')}\n\n` : ''}${bodies.join('\n\n')}`;
    }
    const single = parts.length === 1 && content === fs.readFileSync(path.join(pageDir, parts[0].rel), 'utf8');
    addFile(ARTICLE_ASSET_FILES.css, single ? { kind: 'article.css', from: path.join(pageDir, parts[0].rel), note: parts[0].rel } : { kind: 'article.css', content, note: cssList.join(' + ') });
    for (const rel of cssList) urlPairs.push([`${target.urlBase}${rel}`, `${newBase}${ARTICLE_ASSET_FILES.css}`]);
  }
  // article.js
  if (jsMode === 'rename') {
    const rel = jsList[0];
    const text = fs.readFileSync(path.join(pageDir, rel), 'utf8');
    const next = rewrite(text, rel);
    addFile(ARTICLE_ASSET_FILES.js, next === text ? { kind: 'article.js', from: path.join(pageDir, rel), note: rel } : { kind: 'article.js', content: next, note: rel });
    urlPairs.push([`${target.urlBase}${rel}`, `${newBase}${ARTICLE_ASSET_FILES.js}`]);
  } else if (jsMode === 'imports') {
    addFile(ARTICLE_ASSET_FILES.js, { kind: 'article.js', content: `${jsList.map((rel) => `import ${JSON.stringify(`./${posix.normalize(rel)}`)};`).join('\n')}\n`, note: jsList.join(' + ') });
    for (const rel of jsList) urlPairs.push([`${target.urlBase}${rel}`, `${newBase}${ARTICLE_ASSET_FILES.js}`]);
  }
  // 编译器注入的页级 css / js 行用页地址前缀：对比时一并换掉。
  urlPairs.push([target.urlBase, newBase]);
  for (const dir of dynamicDirs) warnings.push(`拼出来的资源地址只能整目录搬：${dir}`);
  for (const ref of missingRefs) warnings.push(`引用了页里不存在的文件 ${ref}：只换了地址前缀`);

  // 最后一道：计划里每份要复制的源文件都在页目录内（文本 + realpath），每个目标都在文章目录内。
  // 资源搬运（staticTarget / staticDir / article.css）在这里一并核对（xreview B）。
  for (const [rel, spec] of files) {
    if (articleEscape(articleDir, rel)) problems.push(`要写到 ${rel}：越出文章目录`);
    if (!spec.from) continue;
    const escape = pageEscape(pageReal, pageDir, path.relative(pageDir, spec.from));
    const message = `要复制的 ${toPosix(path.relative(pageDir, spec.from))}${escape}：先把它挪进页目录`;
    if (escape && !problems.includes(message)) problems.push(message);
  }

  const plan = {
    pageId,
    legacy: { kind: target.kind, dir: pageDir, title: legacy.title, urlBase: target.urlBase, html: compiled.html, errors: compiled.build.errors || {} },
    project: { id: projectId, root: rootAbs },
    articleId: article,
    articlePageId: newPageId,
    articleDir,
    title: legacy.title,
    sections,
    files,
    urlPairs,
    warnings,
    problems,
  };
  addFile('index.mdx', { kind: '正文', content: buildArticleMdx(plan) });
  return plan;
}

/**
 * 按计划写文件。先核对全部目标都在文章目录内，有一个越界就一个都不写；
 * 文章目录在写之前已存在就抛错；每个文件用不覆盖的方式写（已有就 EEXIST）。
 */
export function writeMigration(plan) {
  if (plan.problems.length) throw new MigrateError(`计划里有 ${plan.problems.length} 个问题，不写`);
  const outside = [...plan.files.keys()].filter((rel) => articleEscape(plan.articleDir, rel));
  if (outside.length) throw new MigrateError(`计划里的 ${outside.join('、')} 越出文章目录 ${plan.articleDir}，不写`);
  fs.mkdirSync(path.dirname(plan.articleDir), { recursive: true });
  try {
    fs.mkdirSync(plan.articleDir); // 不带 recursive：已存在就 EEXIST
  } catch (error) {
    if (error && error.code === 'EEXIST') throw new MigrateError(`文章目录已存在：${plan.articleDir}`);
    throw error;
  }
  const written = [];
  for (const [rel, spec] of [...plan.files].sort(([a], [b]) => a.localeCompare(b))) {
    const to = path.join(plan.articleDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (spec.content !== undefined) fs.writeFileSync(to, spec.content, { flag: 'wx' });
    else fs.copyFileSync(spec.from, to, fs.constants.COPYFILE_EXCL);
    written.push(rel);
  }
  return written;
}

/** 逐行比：不同的行数（长度不同的部分也算）。 */
export function diffLineCount(a, b) {
  const x = String(a).split('\n');
  const y = String(b).split('\n');
  let n = Math.abs(x.length - y.length);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n += 1;
  return n;
}

/** 旧页 HTML 换成新地址（只用于对比）。长的先换，免得前缀先吃掉。 */
function mapUrls(html, pairs) {
  let out = html;
  for (const [from, to] of [...pairs].sort((p, q) => q[0].length - p[0].length)) out = out.split(from).join(to);
  // 几份页级 css / js 合成了一份 article.css / article.js：注入行换完地址后会重复，只留第一行。
  const seen = new Set();
  return out.split('\n').filter((line) => {
    if (!/^<style>@import url\("[^"]+"\);<\/style>$|^<script type="module" data-preview-script src="[^"]+"><\/script>$/.test(line)) return true;
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  }).join('\n');
}

/**
 * 写完之后的校验：从新 index.mdx 派生 board（与服务同一条路），逐帧编译，与旧页比。
 * → { ok, errors: [正文 / 画布写法错误], rows: [{ ref, section, frame, kind, shell, legacyShell,
 *      compile: 'ok' | 错误, diff: 'same' | 'urls' | n 行 | null }] }
 * ok = 正文没有画布错误、每帧都编过、每帧 shell 与旧页一致。
 */
export async function verifyMigration(plan) {
  const registry = { entries: [], projects: [{ id: plan.project.id, kind: 'project', path: plan.project.root }] };
  const target = resolveArticleTarget(registry, plan.articlePageId);
  if (!target) return { ok: false, errors: [`读不到新文章：${plan.articleDir}/index.mdx`], rows: [] };
  const derived = deriveArticleBoard(target);
  const refs = boardRefs(derived.board);
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-'));
  let result;
  const html = {};
  try {
    result = await compilePage(target, { distRoot });
    for (const row of result.screens) {
      if (row.ok) html[row.id] = fs.readFileSync(path.join(distRoot, target.entryId, `${row.id}.html`), 'utf8');
    }
  } finally {
    fs.rmSync(distRoot, { recursive: true, force: true });
  }
  const compiledRows = new Map(result.screens.map((row) => [row.id, row]));
  const derivedShell = new Map();
  for (const section of derived.board.sections) {
    for (const screen of section.screens) derivedShell.set(screen.id, legacyShell(screen.shell || section.shell));
  }
  const rows = [];
  for (const section of plan.sections) {
    for (const frame of section.frames) {
      const compiled = compiledRows.get(frame.id);
      const shell = derivedShell.get(frame.id) || null;
      const before = plan.legacy.html[frame.id];
      const after = html[frame.id];
      let diff = null;
      if (before !== undefined && after !== undefined) {
        if (before === after) diff = 'same';
        else if (mapUrls(before, plan.urlPairs) === after) diff = 'urls';
        else diff = diffLineCount(mapUrls(before, plan.urlPairs), after);
      }
      rows.push({
        ref: refs.byFrame[`${section.id}\0${frame.id}`] || '',
        section: section.id,
        frame: frame.id,
        kind: frame.kind,
        shell,
        legacyShell: frame.legacyShell,
        compile: compiled ? (compiled.ok ? 'ok' : compiled.error) : '没进画布',
        legacyCompile: before !== undefined ? 'ok' : (plan.legacy.errors[frame.id] || '没编出来'),
        diff,
      });
    }
  }
  const errors = derived.errors.map((e) => e.message);
  const ok = !errors.length && rows.every((row) => row.compile === 'ok' && row.shell === row.legacyShell);
  return { ok, errors, rows };
}
