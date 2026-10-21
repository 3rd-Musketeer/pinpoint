/**
 * pp2 页编译器（2026-09-22 切片 1）：页目录源码 → dist 静态 HTML 帧。
 *
 * 输入（页目录 = registry dir 条目的 path，或 content/previews/<pageId>）：
 * - 每个 screen 按 <screenId>.jsx → <screenId>.html 的顺序找源码；都没有则该屏报
 *   “源码不存在”，其余屏照常编译。
 * - .jsx 帧：esbuild（jsx automatic + jsxDev + 我们的 pp-jsx-runtime）转 cjs bundle，
 *   new Function 就地求值后 renderToString 成 HTML 片段；相对 import 走 esbuild
 *   默认解析。
 * - .html 帧：原样保留。文章的 HTML 帧（本篇目录下的 <帧 id>.html，或 project 根下 src 指的文件）
 *   也原样进 dist，不注入 assets。
 * - board.json 顶层 assets: { css?: [], js?: [] } 注入每帧：css 在帧开头
 *   `<style>@import …`，js 在帧末尾 `<script type="module" data-preview-script …>`；
 *   存量帧手写了同 URL 行的不重复注入。
 *
 * lint（编译失败，报文件与行）：import preact/hooks、onX 属性、fetch(、帧文件顶层
 * 有 import / export default / export const shell / 函数声明之外的语句。实现是 esbuild metafile + 文本扫描，不引 parser。
 *
 * 输出：<distRoot>/<entryId>/<screenId>.html + build.json
 *   { builtAt, tool, sources: { [screen]: { file, mtimeMs } }, errors: { [screen]: message } }。
 *   tool 是编译器版本章（compilerStamp）：跳过 fresh 页的判定靠它分辨「dist 是这份编译器编的」。
 * distRoot 默认 <dataRoot()>/dist（PINPOINT_DATA_DIR 可改，e2e 走临时目录）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import esbuild from 'esbuild';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import { dataRoot } from './annotate-data-dir.js';
import { articleComponentCandidates, articleHtmlFrameFile, deriveArticleBoard } from './article-board.js';
import { readTargetBoard, resolvePageTarget } from './board-source.js';
import { listArticleTargets } from './page-resolve.js';
import { readBoard } from './board-file.js';
import { containedSource, requireSource, sourceBoundaryPlugin } from './compiler-source.js';
import { sendCacheable } from './http-respond.js';
import { requestSignal, waitForRequest } from './request-signal.js';
import { resolveContainedFile } from './servable-file.js';
import { screenEntries } from '../../shared/board-screens.js';
import { flattenTabs } from '../../workbench/lib/board-tabs.js';
import { manifestPageIds } from './page-manifest.js';
import { __ppWrapComponent } from './pp-jsx-runtime.js';
import { FIGURE_ID_PATTERN, SCREEN_ID_PATTERN } from '../../shared/project-ids.js';
import { COMP_NAME_PATTERN, ContractError, findRetiredVariantGroup, retiredVariantsMessage, validateBoardTabs } from '../../workbench/lib/preview-contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
// pinpoint/kit 的落点（pp2 切片 2）：kit 的 10 个系统组件的 JSX 印章住这里。
const KIT_JSX = path.join(ROOT, 'content', 'kits', 'ios', 'jsx');
const KIT_JSX_INDEX = path.join(KIT_JSX, 'index.js');
// 图的小运行时（docs/projects.md“图”）：图的 .jsx 和 sidecar 都写 `import … from 'pinpoint/figure'`。
// 编译期由 figureHelperPlugin 指到这个文件；浏览器里由图页的 import map 指到 /kits/figure/figure.js。
const FIGURE_HELPER = path.join(ROOT, 'content', 'kits', 'figure', 'figure.js');
const COMPILER_ROOTS = [KIT_JSX, path.dirname(FIGURE_HELPER)];

export function defaultDistRoot(env = process.env) {
  return path.join(dataRoot(env), 'dist');
}

/** 读 board 失败时的说法：文章画布读的是 index.mdx。 */
function boardReadError(target, error) {
  const file = target && target.kind === 'article' ? 'index.mdx' : 'board.json';
  return `${file} 读取失败：${(error && error.message) || error}`;
}

/** 文章画布编译时写进 dist 的派生 board（<dist>/<页 id>/board.json）；没有返回 null。 */
export function readDistBoard(distRoot, entryId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(distRoot, entryId, 'board.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** 可编译页 id 清单（CLI 报错时列给用户的）。 */
export function listPageIds({ registry = null, root = ROOT } = {}) {
  const ids = new Set();
  for (const entry of (registry && registry.entries) || []) {
    if (entry.kind !== 'dir' || typeof entry.path !== 'string') continue;
    if (fs.existsSync(path.join(path.resolve(entry.path), 'board.json'))) ids.add(entry.id);
  }
  for (const id of manifestPageIds(root)) {
    if (fs.existsSync(path.join(root, 'content', 'previews', id, 'board.json'))) ids.add(id);
  }
  for (const target of listArticleTargets(registry)) ids.add(target.entryId);
  return [...ids].sort();
}

/** 服务启动全量编译的目标清单：所有有 board.json 的 dir 条目 + 模板页。 */
export function listCompileTargets({ registry = null, root = ROOT, templateOnly = false } = {}) {
  const targets = [];
  const seen = new Set();
  for (const entry of (registry && registry.entries) || []) {
    if (entry.kind !== 'dir' || typeof entry.path !== 'string') continue;
    const target = resolvePageTarget(entry.id, { registry, root });
    if (target && !seen.has(target.entryId)) {
      seen.add(target.entryId);
      targets.push(target);
    }
  }
  const manifestIds = templateOnly
    ? trackedManifestPageIds(root)
    : manifestPageIds(root);
  for (const id of manifestIds) {
    if (seen.has(id)) continue;
    const target = resolvePageTarget(id, { registry: null, root });
    if (target) {
      seen.add(id);
      targets.push(target);
    }
  }
  for (const target of listArticleTargets(registry)) {
    if (seen.has(target.entryId)) continue; // 与模板页撞名：模板页优先（listProjects 记了错误）
    seen.add(target.entryId);
    targets.push(target);
  }
  return targets;
}

function trackedManifestPageIds(root) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'content', 'previews', '_index.json'), 'utf8'));
    if (doc && Array.isArray(doc.pages)) {
      return doc.pages.map((page) => page && page.id).filter((id) => typeof id === 'string');
    }
  } catch { /* 缺失/损坏 = 没有模板页可编 */ }
  return [];
}

/** board.json 里的 screen id 集合（serve 层判「这个 .html 是不是屏」用）；读不到返回 null。 */
export function boardScreenIds(pageDir) {
  const board = readBoard(pageDir);
  return board ? screenIdsFromBoard(board) : null;
}

function screenIdsFromBoard(rawBoard) {
  const board = flattenTabs(rawBoard);
  if (!board || !Array.isArray(board.sections)) return null;
  const ids = new Set();
  for (const { screen } of screenEntries(board)) {
    if (SCREEN_ID_PATTERN.test(screen.id)) ids.add(screen.id);
  }
  return ids;
}

/* ---- lint：文本扫描，不引 parser ---- */

/**
 * 帧/组件源码的四条禁令。返回 [{ line, message }]。
 * 顶层语句判定按行扫 + {} () [] 深度：深度 0 的行只许是空行、注释、import、
 * export default；import / export default 开启的语句延续到深度归零为止。
 */
export function lintStampSource(text, file = '<source>', { entry = false } = {}) {
  const errors = [];
  const lines = String(text).split('\n');
  // 顶层允许的形态：import 一定放行；export 在帧文件（entry）里只许 default 那一个，
  // 外加帧级 shell 声明 `export const shell = "…"`（文章画布静态读它，见
  // article-canvas.js 的 readFrameShell；值写坏由那里报）；
  // 组件文件里是命名导出函数（export function Badge），放行一切 export。
  // 帧文件（pp2 切片 2）再放行 function Name( 开头的函数声明 —— 帧内小组件；
  // 其他 const / let / 表达式语句仍然禁止。
  const exportOk = entry ? /^export\s+(?:default\b|const\s+shell\b)/ : /^export\b/;
  const exportLabel = entry ? 'export default、export const shell' : 'export';
  const functionOk = entry ? /^function\s+[A-Za-z_$]/ : /$./;
  let depthB = 0;
  let depthP = 0;
  let depthK = 0;
  let mode = null; // 'import' | 'export' | 'function'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const atTop = depthB === 0 && depthP === 0 && depthK === 0;

    // code：错误种类（ppnt check 的诊断带它）；text：不带文件前缀的那句话；message：带 `文件:行:` 前缀，编译失败时原样拼进错误。
    const report = (code, text) => errors.push({ code, line: i + 1, text, message: `${file}:${i + 1}: ${text}` });
    if (/\bfrom\s*['"]preact\/hooks['"]/.test(trimmed)) {
      report('lint_hooks', '禁止 import preact/hooks（组件是印章：无状态无副作用）');
    }
    const onMatch = line.match(/\s(on[A-Z][A-Za-z0-9]*)\s*=/);
    if (onMatch) {
      report('lint_event_attr', `禁止事件属性 ${onMatch[1]}（状态即帧，交互走 sidecar）`);
    }
    if (/\bfetch\s*\(/.test(line)) {
      report('lint_fetch', '禁止 fetch（编译期渲染，没有数据请求）');
    }

    if (!mode && atTop && trimmed
      && !/^import\b/.test(trimmed)
      && !exportOk.test(trimmed)
      && !functionOk.test(trimmed)
      && !/^\/\//.test(trimmed) && !/^\/\*/.test(trimmed) && !/^\*/.test(trimmed) && !/^\*\//.test(trimmed)) {
      report('lint_top_level', `顶层只允许 import、${exportLabel}${entry ? ' 和函数声明' : ''}（组件是印章，没有顶层逻辑）`);
    }
    if (!mode && atTop) {
      if (/^import\b/.test(trimmed)) mode = 'import';
      else if (exportOk.test(trimmed)) mode = 'export';
      else if (functionOk.test(trimmed)) mode = 'function';
    }
    for (const ch of line) {
      if (ch === '{') depthB += 1;
      else if (ch === '}') depthB -= 1;
      else if (ch === '(') depthP += 1;
      else if (ch === ')') depthP -= 1;
      else if (ch === '[') depthK += 1;
      else if (ch === ']') depthK -= 1;
    }
    if (mode && depthB === 0 && depthP === 0 && depthK === 0) mode = null;
  }
  return errors;
}

/* ---- 单屏编译 ---- */

/**
 * data-pp-id 的 @n 按文档顺序重编（2026-09-22 review 1-1，owner 决定）：运行时按
 * 创建顺序发号（嵌套同行时父元素反而靠后），这里对 renderToString 的输出字符串扫
 * 一遍 data-pp-id="文件:行@k"，同一 文件:行 按出现先后从 1 重排 —— 字符串本身就是
 * 文档顺序；preact 会把文本里的 " 转义成 &quot;，属性值不会误匹配。
 * 后缀 @：# 只留给标注序号（review R7），DOM 锚点与对话引用不再共用符号。
 * 文件部分顺带归一（pp2 切片 2）：页外文件（kit JSX）按 esbuild 给的是 ../../ 链，
 * 落在仓内就改写成仓相对（content/kits/ios/jsx/Bubble.jsx），锚点可读、跨页稳定。
 */
export function renumberPpIds(html, { pageDir = null } = {}) {
  const counts = new Map();
  return String(html).replace(/data-pp-id="([^"]+?:\d+)@\d+"/g, (all, key) => {
    let normalized = key;
    if (pageDir && key.startsWith('../')) {
      const cut = key.lastIndexOf(':');
      const abs = path.resolve(pageDir, key.slice(0, cut));
      if (abs === ROOT || abs.startsWith(ROOT + path.sep)) {
        normalized = `${path.relative(ROOT, abs).split(path.sep).join('/')}${key.slice(cut)}`;
      }
    }
    const n = (counts.get(normalized) || 0) + 1;
    counts.set(normalized, n);
    return `data-pp-id="${normalized}@${n}"`;
  });
}

function kitJsxPlugin() {
  return {
    name: 'pp2-kit',
    setup(build) {
      build.onResolve({ filter: /^pinpoint\/kit$/ }, () => ({ path: KIT_JSX_INDEX }));
    },
  };
}

/**
 * 文章画布的组件解析：本篇帧里写 `./components/<Name>.jsx`，本篇 components/ 没有就
 * 落到 pinpoint/kit 的同名印章。没有 project 这一层（ADR 0045）。只接本篇目录顶层文件（帧）发出的这种 import，和
 * figures/ 下的图发出的 `../components/<Name>.jsx`。
 */
function articleComponentsPlugin(target, resolutions = null) {
  return {
    name: 'pp3-article-components',
    setup(build) {
      // esbuild 给的 resolveDir 是真实路径（macOS 的 /var → /private/var），两边都取 realpath 再比。
      const real = (dir) => {
        try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
      };
      const pageDir = real(target.pageDir);
      const figureDir = path.join(pageDir, 'figures');
      build.onResolve({ filter: /^\.\.?\/components\/[A-Za-z_$][A-Za-z0-9_$]*(?:\.jsx)?$/ }, (args) => {
        const from = real(args.resolveDir);
        const up = args.path.startsWith('../');
        if (up ? from !== figureDir : from !== pageDir) return undefined;
        const name = args.path.replace(/^\.\.?\/components\//, '').replace(/\.jsx$/, '');
        const candidates = articleComponentCandidates(target, name, KIT_JSX);
        const hit = candidates.find((file) => fs.existsSync(file));
        // 只记 resolved 文件不够：缺失的高优先级候选出现时，原 kit 文件并没有变。
        if (resolutions) resolutions.push({
          candidates: candidates.map(file => path.relative(target.pageDir, file)),
          selected: hit ? path.relative(target.pageDir, hit) : null,
        });
        // 先判文本来源，不能先 realpath 后把越界的 symlink 当成另一个合法根的文件。
        if (!hit) return undefined;
        const checked = requireSource(target, hit, COMPILER_ROOTS);
        const rel = path.relative(target.pageDir, checked);
        return { path: rel.startsWith(`..${path.sep}`) ? checked : path.resolve(pageDir, rel) };
      });
    },
  };
}

function figureHelperPlugin() {
  return {
    name: 'pp3-figure-helper',
    setup(build) {
      build.onResolve({ filter: /^pinpoint\/figure$/ }, () => ({ path: FIGURE_HELPER }));
    },
  };
}

function pluginsFor(target, inputs = null, resolutions = null) {
  const plugins = target && target.kind === 'article' ? [articleComponentsPlugin(target, resolutions), kitJsxPlugin(), figureHelperPlugin()] : [kitJsxPlugin()];
  return [...plugins, sourceBoundaryPlugin(target, COMPILER_ROOTS, inputs)];
}

// 帧 bundle（cjs）里仅有的三个外部 require，映射回进程里已加载的模块 —— 帧与
// 编译器共享同一个 preact / 运行时实例（vnode 鸭子类型跨实例不兼容），也不再
// 需要 file URL external 的插件。
import * as preactModule from 'preact';
import * as preactJsxDevRuntime from 'preact/jsx-dev-runtime';
import * as ppRuntimeModule from './pp-jsx-runtime.js';
import { isFile as isFileSync } from './fs-utils.js';

const REQUIRE_MAP = {
  preact: preactModule,
  'preact/jsx-dev-runtime': preactJsxDevRuntime,
  'pp-jsx-runtime/jsx-dev-runtime': ppRuntimeModule,
};

/**
 * cjs bundle 就地求值（2026-09-22 review 1-3）：new Function 的函数对象用完即可被
 * GC 回收；此前的 data: URL import 每编一屏往 Node 的 ESM 缓存塞一个永不回收的
 * 模块，--watch 与 dev server 长跑会无限增长。
 */
// <script> / <style> 是 raw text 元素：body 里的实体浏览器不解码，字符串子节点
// 被 renderToString 转义后就是静默 SyntaxError（R4 B5 发现：内联脚本挂掉零信号）。
// 渲染后把这两类元素的 body 解回原文；普通元素的转义不动（HTML 语义照旧）。
const ENTITY_DECODE = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&amp;': '&' };

function unescapeRawTextElements(html) {
  return html.replace(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi, (whole, tag, body) => {
    const decoded = decodeEntities(body);
    return decoded === body ? whole : whole.replace(body, () => decoded);
  });
}

function decodeEntities(text) {
  return String(text).replace(/&(?:lt|gt|quot|#39|#039|amp);/g, (entity) => ENTITY_DECODE[entity]);
}

/** renderToString + pp-id 重编号 + raw text 还原：三处 JSX 帧渲染（帧 / comp / 图）共用。 */
function renderFrameHtml(vnode, pageDir) {
  return unescapeRawTextElements(renumberPpIds(renderToString(vnode), { pageDir }));
}

function evaluateFrameBundle(code) {
  const mod = { exports: {} };
  const require = (id) => {
    if (!(id in REQUIRE_MAP)) throw new Error(`帧 bundle 出现未映射的 require：${id}`);
    return REQUIRE_MAP[id];
  };
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
  return mod.exports;
}

/** esbuild 失败 → 诊断对象 [{ code: 'compile', file, line, message }]（file 按 absWorkingDir 解析成绝对路径）。 */
function buildFailureDiagnostics(error, cwd) {
  const rows = (error && error.errors) || [];
  if (!rows.length) return [{ code: 'compile', file: null, line: null, message: String((error && error.message) || error) }];
  return rows.map((row) => ({
    code: 'compile',
    file: row.location ? path.resolve(cwd, row.location.file) : null,
    line: row.location ? row.location.line : null,
    message: row.text,
  }));
}

function formatBuildFailure(error) {
  const rows = (error && error.errors) || [];
  if (!rows.length) return String((error && error.message) || error);
  return rows.map((row) => {
    const loc = row.location;
    return loc ? `${loc.file}:${loc.line}: ${row.text}` : row.text;
  }).join('\n');
}

/**
 * metafile inputs → 依赖记录（review R2）：帧 import 的页内组件与 kit 印章在
 * 编译期定型，不记进 sources 的话 kit 改动后 distStatus 恒报 fresh。页内文件记
 * 相对路径，页外（kit）记 ../ 链 —— distStatus 用 pageDir join 解析两者。
 */
function depRecordsFromInputs(target, metaInputs, exclude, inputs = null) {
  const skipped = new Set(exclude);
  const out = [];
  for (const input of Object.keys(metaInputs)) {
    if (skipped.has(input)) continue;
    const abs = path.resolve(fs.realpathSync(target.pageDir), input);
    const consumed = inputs?.get(abs)?.record;
    if (consumed) {
      out.push({ file: path.relative(fs.realpathSync(target.pageDir), abs).split(path.sep).join('/'), ...consumed });
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(requireSource(target, abs, COMPILER_ROOTS));
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    out.push({ file: path.relative(fs.realpathSync(target.pageDir), abs).split(path.sep).join('/'), ...(inputs?.get(abs)?.record || { mtimeMs: stat.mtimeMs }) });
  }
  return out;
}

/** 只认证有解析证据的 import；默认 resolver 的扩展探测/目录/包解析继续保守。 */
function importsStable(target, metaInputs, resolutions) {
  const base = fs.realpathSync(target.pageDir);
  return Object.entries(metaInputs).every(([importer, input]) => Array.isArray(input.imports) && input.imports.every((item) => {
    if (item.external) return Object.hasOwn(REQUIRE_MAP, item.path);
    if (typeof item.original !== 'string' || typeof item.path !== 'string') return false;
    const selected = path.resolve(base, item.path);
    if (item.original === 'pinpoint/kit') return selected === KIT_JSX_INDEX;
    if (item.original === 'pinpoint/figure') return selected === FIGURE_HELPER;
    if (!/^\.\.?\//.test(item.original)) return false;
    const requested = path.resolve(path.dirname(path.resolve(base, importer)), item.original);
    // metafile 证明实际读入的是显式扩展文件；身份/存在性仍由原输入门核对。
    if (/\.(?:jsx?|tsx?|[mc][jt]s|json|css)$/.test(item.original) && requested === selected) return true;
    // 既有文章组件插件确实记过该 import 的候选及选择，不能借别的 import 的记录兜底。
    return resolutions.some(({ candidates, selected: picked }) => picked && candidates?.length
      && path.resolve(base, candidates[0]) === requested
      && (path.resolve(target.pageDir, picked) === selected || path.resolve(base, picked) === selected));
  }));
}

async function compileJsxScreen(target, screenId, file) {
  const inputs = new Map();
  const resolutions = [];
  const failed = (row) => ({
    ...row, resolutions,
  });
  let built;
  try {
    built = await esbuild.build({
      entryPoints: [file],
      absWorkingDir: fs.realpathSync(target.pageDir),
      bundle: true,
      preserveSymlinks: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      jsx: 'automatic',
      jsxDev: true,
      jsxImportSource: 'pp-jsx-runtime',
      external: ['preact', 'preact/jsx-dev-runtime', 'pp-jsx-runtime/jsx-dev-runtime'],
      metafile: true,
      logLevel: 'silent',
      plugins: pluginsFor(target, inputs, resolutions),
    });
  } catch (error) {
    return failed({ ok: false, error: formatBuildFailure(error), diagnostics: buildFailureDiagnostics(error, target.pageDir) });
  }
  const lintErrors = [];
  for (const input of Object.keys(built.metafile.inputs)) {
    if (!/\.jsx$/.test(input)) continue;
    let text;
    try {
      text = inputs.get(path.resolve(fs.realpathSync(target.pageDir), input))?.contents.toString('utf8') ?? fs.readFileSync(requireSource(target, input, COMPILER_ROOTS), 'utf8');
    } catch {
      continue;
    }
    lintErrors.push(...lintStampSource(text, input, { entry: input === file })
      .map((row) => ({ ...row, file: path.resolve(target.pageDir, input) })));
  }
  if (lintErrors.length) {
    return failed({
      ok: false,
      error: lintErrors.map((row) => row.message).join('\n'),
      diagnostics: lintErrors.map((row) => ({ code: row.code, file: row.file, line: row.line, message: row.text })),
    });
  }
  const entryFile = path.resolve(target.pageDir, file);
  try {
    const mod = evaluateFrameBundle(built.outputFiles[0].text);
    if (!mod || typeof mod.default !== 'function') {
      const message = '帧文件必须默认导出一个返回 JSX 的函数';
      return failed({ ok: false, error: `${file}: ${message}`, diagnostics: [{ code: 'frame_export', file: entryFile, line: null, message }] });
    }
    return {
      ok: true,
      html: renderFrameHtml(h(__ppWrapComponent(mod.default), {}), target.pageDir),
      input: { ...inputs.get(path.resolve(fs.realpathSync(target.pageDir), file))?.record, importsStable: importsStable(target, built.metafile.inputs, resolutions) },
      deps: depRecordsFromInputs(target, built.metafile.inputs, [file], inputs),
      resolutions,
    };
  } catch (error) {
    const message = String((error && error.message) || error);
    return failed({ ok: false, error: `${file}: ${message}`, diagnostics: [{ code: 'frame_render', file: entryFile, line: null, message }] });
  }
}

function compileHtmlScreen(target, screenId, file) {
  let html;
  let input;
  try {
    // 显式登记的 source 只供 HTML 帧使用；JSX import 不因此获得跨根权限。
    const source = fs.realpathSync(requireSource(target, file, Object.values(target.sources || {})));
    const mtimeMs = fs.statSync(source).mtimeMs;
    const bytes = fs.readFileSync(source);
    html = bytes.toString('utf8');
    input = { mtimeMs, realpath: fs.realpathSync(source), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), importsStable: true };
  } catch (error) {
    return { ok: false, error: `${file}: ${String((error && error.message) || error)}` };
  }
  return { ok: true, html, input };
}

/** board.json assets 注入：css 帧开头 / js 帧末尾。assets 数组先自去重（R10），
    再按「帧里已有同 URL 行」去重。 */
export function injectAssets(html, assets, urlBase) {
  const list = (value) => [...new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [])];
  const cssLines = list(assets && assets.css)
    .map((href) => `${urlBase}${href}`)
    .filter((url) => !html.includes(url))
    .map((url) => `<style>@import url("${url}");</style>`);
  const jsLines = list(assets && assets.js)
    .map((src) => `${urlBase}${src}`)
    .filter((url) => !html.includes(url))
    .map((url) => `<script type="module" data-preview-script src="${url}"></script>`);
  return (cssLines.length ? `${cssLines.join('\n')}\n` : '')
    + html
    + (jsLines.length ? `\n${jsLines.join('\n')}` : '');
}

/** board.json 的 screen 条目序列（编译用）：{ id, comp?, props? }，按 id 去重保序。
    遍历只有一处（shared/board-screens.js 的 screenEntries，tabs 在里面摊平）；
    这里只剩编译侧自己的归一：id 合法性过滤与 comp 条目校验。 */
export function screenEntriesFromBoard(rawBoard) {
  const entries = [];
  for (const { screen } of screenEntries(rawBoard)) {
    if (!SCREEN_ID_PATTERN.test(screen.id)) continue;
    const entry = { id: screen.id };
    // 文章画布上 project 根下的 HTML 帧（docs/projects.md“HTML 帧”）：src 指到源文件。
    if (typeof screen.src === 'string' && screen.src) entry.src = screen.src;
    // comp section 的 variants 墙（pp2 切片 2）：comp = 组件名，props 只允许 JSON 值
    // （board.json 本身是 JSON，天然满足；非对象的 props 按空对象处理）。
    if (typeof screen.comp === 'string' && screen.comp) {
      if (!COMP_NAME_PATTERN.test(screen.comp)) {
        // 编译侧与 workbench 的 preview-contracts 同一条 comp 名规则：不合法的
        // 名不进路径拼接（`../../x` 会指到页外）也不进生成的 import 代码，
        // 屏级报错，其余屏照常。
        entry.compError = `comp 名不合法："${screen.comp}"（必须匹配 ${COMP_NAME_PATTERN}）`;
      } else {
        entry.comp = screen.comp;
        entry.props = screen.props && typeof screen.props === 'object' && !Array.isArray(screen.props) ? screen.props : {};
      }
    }
    entries.push(entry);
  }
  return entries;
}

async function compileScreen(target, entry, options = {}) {
  const started = performance.now();
  const screenId = entry.id;
  if (entry.compError) {
    return { ok: false, error: `${screenId}: ${entry.compError}`, ms: 0, source: null };
  }
  const jsxFile = `${screenId}.jsx`;
  const htmlFile = `${screenId}.html`;
  let result;
  let source = null;
  const sourceRecord = (file) => ({ file, mtimeMs: fs.statSync(requireSource(target, file)).mtimeMs });
  // 文章的 HTML 帧（本篇目录下的 <帧 id>.html 或 project 根下的 src）：整份文档原样进 dist，
  // 不注入 article.css / article.js（注在 <!doctype> 前面会把文档打进怪异模式）。
  const articleHtml = target.kind === 'article' ? articleHtmlFrameFile(target, entry) : null;
  try {
    if (target.kind === 'article' && entry.src && !articleHtml) {
      result = { ok: false, error: `${screenId}: 源码不存在（${entry.src}）` };
    } else if (articleHtml) {
      const rel = path.relative(target.pageDir, articleHtml).split(path.sep).join('/');
      source = { file: rel, mtimeMs: fs.statSync(articleHtml).mtimeMs };
      result = compileHtmlScreen(target, screenId, rel);
      if (result.ok) result.document = true;
    } else if (entry.comp) {
      const found = await compileCompScreen(target, entry, options);
      result = found.result;
      source = found.source;
    } else if (fs.existsSync(path.join(target.pageDir, jsxFile))) {
      source = sourceRecord(jsxFile);
      result = await compileJsxScreen(target, screenId, jsxFile);
    } else if (fs.existsSync(path.join(target.pageDir, htmlFile))) {
      source = sourceRecord(htmlFile);
      result = compileHtmlScreen(target, screenId, htmlFile);
    } else {
      result = { ok: false, error: `${screenId}: 源码不存在（既没有 ${jsxFile} 也没有 ${htmlFile}）` };
    }
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  // 帧的 import 依赖（页内组件 / kit 印章）一并记进 sources（review R2）。
  if (result.input && source) source = { ...source, ...result.input };
  if (result.deps && source) source = { ...source, deps: result.deps };
  if (result.resolutions && source) source = { ...source, resolutions: result.resolutions };
  if (result.ok && !result.document) result.html = injectAssets(result.html, options.assets || {}, target.urlBase);
  return {
    ...result,
    ms: Math.round((performance.now() - started) * 10) / 10,
    source,
  };
}

/**
 * comp 屏（variants 墙的一格）：生成一个虚拟帧 `<Name {...props} />` 渲染。
 * 组件先在页目录 components/<Name>.jsx（命名导出 Name 或默认导出）找，没有再回
 * pinpoint/kit（content/kits/ios/jsx/<Name>.jsx）。虚拟帧走 esbuild stdin，不进 lint；
 * 组件文件本身照常过 lint（非 entry）。
 */
async function compileCompScreen(target, entry, { kitJsx = KIT_JSX } = {}) {
  const inputs = new Map();
  const resolutions = [];
  const { id, comp, props } = entry;
  const pageComp = path.join(target.pageDir, 'components', `${comp}.jsx`);
  const kitComp = path.join(kitJsx, `${comp}.jsx`);
  let importPath;
  let sourceAbs;
  let sourceDesc;
  if (fs.existsSync(pageComp)) {
    importPath = `./components/${comp}.jsx`;
    sourceAbs = pageComp;
    sourceDesc = `components/${comp}.jsx`;
  } else if (fs.existsSync(kitComp)) {
    importPath = 'pinpoint/kit';
    sourceAbs = kitComp;
    sourceDesc = 'pinpoint/kit';
  } else {
    return {
      result: { ok: false, error: `${id}: 找不到组件 ${comp}（页内 components/${comp}.jsx 与 pinpoint/kit 都没有）` },
      source: { file: `components/${comp}.jsx`, mtimeMs: null, resolutions: [{
        candidates: [pageComp, kitComp].map(file => path.relative(target.pageDir, file)), selected: null,
      }] },
    };
  }
  const virtual = [
    `import * as __M from ${JSON.stringify(importPath)};`,
    `const __C = __M[${JSON.stringify(comp)}] || __M.default;`,
    `export const __picked = __C;`,
    `const __props = ${JSON.stringify(props || {})};`,
    'export default function __CompScreen() {',
    '  return <__C {...__props} />;',
    '}',
    '',
  ].join('\n');
  const sourceRel = path.relative(target.pageDir, sourceAbs).split(path.sep).join('/');
  resolutions.push({ candidates: [pageComp, kitComp].map(file => path.relative(target.pageDir, file)), selected: sourceRel });
  const sourceMtime = fs.statSync(sourceAbs).mtimeMs;
  const failed = (result) => ({ result, source: {
    file: sourceRel, mtimeMs: sourceMtime, resolutions,
  } });
  let built;
  try {
    built = await esbuild.build({
      stdin: { contents: virtual, sourcefile: '__comp__.jsx', resolveDir: fs.realpathSync(target.pageDir), loader: 'jsx' },
      absWorkingDir: fs.realpathSync(target.pageDir),
      bundle: true,
      preserveSymlinks: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      jsx: 'automatic',
      jsxDev: true,
      jsxImportSource: 'pp-jsx-runtime',
      external: ['preact', 'preact/jsx-dev-runtime', 'pp-jsx-runtime/jsx-dev-runtime'],
      metafile: true,
      logLevel: 'silent',
      plugins: pluginsFor(target, inputs, resolutions),
    });
  } catch (error) {
    return failed({ ok: false, error: formatBuildFailure(error) });
  }
  const lintErrors = [];
  for (const input of Object.keys(built.metafile.inputs)) {
    if (!/\.jsx$/.test(input)) continue;
    let text;
    try {
      text = inputs.get(path.resolve(fs.realpathSync(target.pageDir), input))?.contents.toString('utf8') ?? fs.readFileSync(requireSource(target, input, COMPILER_ROOTS), 'utf8');
    } catch {
      continue;
    }
    lintErrors.push(...lintStampSource(text, input, { entry: false }));
  }
  if (lintErrors.length) {
    return failed({ ok: false, error: lintErrors.map((row) => row.message).join('\n') });
  }
  try {
    const mod = evaluateFrameBundle(built.outputFiles[0].text);
    if (typeof mod.__picked !== 'function') {
      return failed({ ok: false, error: `${id}: 组件 ${comp} 在 ${sourceDesc} 里没有命名导出或默认导出` });
    }
    const html = renderFrameHtml(h(__ppWrapComponent(mod.default), {}), target.pageDir);
    const deps = depRecordsFromInputs(target, built.metafile.inputs, ['__comp__.jsx', sourceRel], inputs);
    return {
      result: { ok: true, html },
      source: { file: sourceRel, ...((inputs.get(path.resolve(sourceAbs)) || inputs.get(path.resolve(fs.realpathSync(target.pageDir), sourceRel)))?.record || { mtimeMs: sourceMtime }), importsStable: importsStable(target, built.metafile.inputs, resolutions), resolutions, ...(deps.length ? { deps } : {}) },
    };
  } catch (error) {
    return failed({ ok: false, error: `${sourceDesc}: ${String((error && error.message) || error)}` });
  }
}

export function readBuildJson(distRoot, entryId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(distRoot, entryId, 'build.json'), 'utf8'));
  } catch {
    return null;
  }
}

// 编译器版本章（skipFresh 的安全网）：build.json 的 sources 只记页源码的 mtime，
// 编译器自己（或 esbuild 版本）变了输出跟着变，源码 mtime 却不动 —— 没有这个章，
// 「dist 已是最新就跳过」的启动判定会让所有页永远吃上一版编译器的产物。章 = 从
// page-compiler.js 出发的相对 import 闭包 + kit 印章目录 + 图运行时的 mtime+size
// 哈希，连同 esbuild 版本。进程内缓存：服务进程的编译器代码不会中途变。
let compilerStampCache = null;
export function compilerStamp() {
  if (compilerStampCache) return compilerStampCache;
  const files = new Set();
  const walk = (file) => {
    if (files.has(file)) return;
    files.add(file);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const match of text.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      try {
        walk(fs.realpathSync(new URL(match[1], pathToFileURL(file))));
      } catch { /* 闭包里缺一个模块不挡章 */ }
    }
  };
  walk(path.resolve(__dirname, 'page-compiler.js'));
  const addTree = (dir) => {
    let rows;
    try {
      rows = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const row of rows) {
      const file = path.join(dir, row.name);
      if (row.isDirectory()) addTree(file);
      else walk(file);
    }
  };
  addTree(KIT_JSX);
  walk(FIGURE_HELPER);
  const hash = crypto.createHash('sha1');
  for (const file of [...files].sort()) {
    hash.update(path.relative(ROOT, file));
    try {
      const stat = fs.statSync(file);
      hash.update(`:${stat.mtimeMs}:${stat.size}`);
    } catch {
      hash.update(':gone');
    }
  }
  hash.update(`:esbuild:${esbuild.version}`);
  compilerStampCache = hash.digest('hex').slice(0, 16);
  return compilerStampCache;
}

/**
 * 编译一整页 → 写 dist（writeDist=false 时只算不写，ppnt render 用）。
 * onlyScreen（CLI --frame，单个）与 onlyScreens（watch/HMR 增量，审计 B1）
 * 都走「只编挑中的屏 + 合并既有 build.json」的路径，其余屏的产物与记录原样保留。
 * 返回 { entryId, ok, builtAt, ms, screens: [{ id, ok, ms, error? }], figures: [{ id, ok, ms, error? }], partial, totalScreens, error? }；
 * figures 是文章正文里的图（整页编译时才有，见 compileArticleFigures）；
 * partial = 只编了挑中的屏，totalScreens = 板上的屏数（CLI 打「增量 M/N 屏」用）。
 */
// watcher 与按需出帧共用写入队列：同页的旧编译不能在新编译之后覆盖 dist。
// 不写 dist 的 render 保持独立，不同数据根（sandbox / 测试）也互不阻塞。
const pageCompilations = new Map();
const compilationKey = (target, distRoot) => path.join(path.resolve(distRoot), target.entryId);

export function compilePage(target, options = {}) {
  if (options.writeDist === false) return compilePageNow(target, options);
  const key = compilationKey(target, options.distRoot || defaultDistRoot());
  const previous = pageCompilations.get(key);
  const job = { options: { ...options }, started: false, interests: [options.signal || null], promise: null };
  const task = (previous?.promise || Promise.resolve()).catch(() => {}).then(() => {
    if (job.interests.every((signal) => signal?.aborted)) throw new DOMException('请求已断开', 'AbortError');
    job.started = true;
    return compilePageNow(target, job.options);
  });
  job.promise = task;
  pageCompilations.set(key, job);
  const clear = () => { if (pageCompilations.get(key) === job) pageCompilations.delete(key); };
  task.then(clear, clear);
  return task;
}

async function compilePageNow(target, options = {}) {
  const distRoot = options.distRoot || defaultDistRoot();
  const onlyScreen = options.onlyScreen || null;
  // 空数组按全编处理（review 建议 2）：[] 是 truthy，放进增量分支就是一屏不编、
  // 只刷新 builtAt —— 正是 recompile-plan 用「空批全编」专门防的假 fresh。
  const onlyScreens = onlyScreen
    ? [onlyScreen]
    : (Array.isArray(options.onlyScreens) && options.onlyScreens.length ? options.onlyScreens : null);
  const writeDist = options.writeDist !== false;
  const started = performance.now();
  let board;
  let boardInput = target.kind === 'article' ? null : {};
  let boardMtimeMs = null;
  try {
    board = readTargetBoard(target, boardInput);
    boardMtimeMs = boardInput?.mtimeMs ?? null;
  } catch (error) {
    return { entryId: target.entryId, ok: false, builtAt: null, ms: 0, screens: [], error: boardReadError(target, error) };
  }
  // 页 tab 的形状错（sections 与 tabs 并存、空 tab、重复 tab id）：编不了，报与工作台同一句话。
  try {
    validateBoardTabs(board);
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return { entryId: target.entryId, ok: false, builtAt: null, ms: 0, screens: [], error: `board.json 无效：${error.message}` };
  }
  const retiredGroup = findRetiredVariantGroup(board);
  if (retiredGroup) {
    return { entryId: target.entryId, ok: false, builtAt: null, ms: 0, screens: [], error: `board.json 无效：${retiredVariantsMessage(retiredGroup)}` };
  }
  const ids = screenEntriesFromBoard(board);
  const assets = board.assets && typeof board.assets === 'object' ? board.assets : {};
  const picked = onlyScreens ? ids.filter((entry) => onlyScreens.includes(entry.id)) : ids;
  const screens = [];
  const sources = {};
  const errors = {};
  const htmls = {};
  // 屏间并行：compileScreen 各自独立（自己的 esbuild.build + 同步求值），页与页在
  // buildAllPages 已并行，大页（30 jsx 屏）曾是启动与整页重编的尾屏。顺序按 picked
  // 保住，行序与串行一致。
  const rows = await Promise.all(picked.map((entry) => compileScreen(target, entry, { assets })));
  for (let i = 0; i < picked.length; i++) {
    const row = rows[i];
    const entry = picked[i];
    screens.push({ id: entry.id, ok: row.ok, ms: row.ms, ...(row.ok ? {} : { error: row.error }) });
    if (row.source) sources[entry.id] = row.source;
    if (row.ok) htmls[entry.id] = row.html;
    else errors[entry.id] = row.error;
  }
  // 正文里的图（docs/projects.md“图”）：整页编译时一起编，各自落 <dist>/<页>/figures/，不进 build.json，
  // 增量编译（只编挑中的屏）不碰图。图也会在 /api/frame 被请求时按需重编（loadFigure）。
  const figures = target.kind === 'article' && !onlyScreens
    ? await compileArticleFigures(target, { distRoot, writeDist })
    : [];
  // writeDist=false（ppnt render）不落盘，builtAt 占位（不参与任何比较）。
  let builtAt = Date.now();
  if (writeDist) {
    const outDir = path.join(distRoot, target.entryId);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [id, html] of Object.entries(htmls)) {
      fs.writeFileSync(path.join(outDir, `${id}.html`), html);
    }
    // 文章画布的 board 是派生物：写进编译产物，从不写回源目录（common-m1.md §2）。
    if (target.kind === 'article') fs.writeFileSync(path.join(outDir, 'board.json'), `${JSON.stringify(board, null, 2)}\n`);
    // 失败屏的旧产物必须删掉（review R1）：否则改坏一帧后 serve 拿改坏前的
    // 画面顶班，错误面板、stale、嵌入帧全部零信号。删了文件还不够 —— 读取侧
    // （readDistScreen）也改成 errors 优先，旧状态下的孤儿文件同样不能顶班。
    for (const screen of screens) {
      if (screen.ok) continue;
      const staleFile = path.join(outDir, `${screen.id}.html`);
      if (fs.existsSync(staleFile)) fs.unlinkSync(staleFile);
    }
    // 单屏/多屏增量编译：合并既有 build.json，没重编的屏记录原样保留。
    let mergedSources = sources;
    let mergedErrors = errors;
    if (onlyScreens) {
      const old = readBuildJson(distRoot, target.entryId) || {};
      // 单屏编译不能替未编兄弟认证新版板（assets/props 可能还留在旧产物中）。
      if (boardInput && (old.tool !== compilerStamp() || old.boardInput?.sha256 !== boardInput.sha256 || old.boardInput?.realpath !== boardInput.realpath)) boardInput = null;
      mergedSources = { ...(old.sources || {}), ...sources };
      mergedErrors = { ...(old.errors || {}) };
      for (const entry of picked) {
        if (errors[entry.id]) mergedErrors[entry.id] = errors[entry.id];
        else delete mergedErrors[entry.id];
      }
    }
    // builtAt = build.json 自己的 mtime（写两遍：先占位，stat 到 mtime 再写真值）。
    // stale 比较拿它跟 stat 的 mtimeMs 比，两者必须同钟同精度：
    //   - performance.timeOrigin + now() 是单调钟，NTP 步进/回拨让它跟文件 mtime
    //     差出毫秒——正方向 fresh 页误判 stale（BACKLOG 两条偶挂单测的根因），
    //     反方向真改过的源被判 fresh 吃旧产物（R5b 三）；
    //   - Date.now() 是墙钟但整毫秒，同一毫秒内后写的源 mtimeMs 带亚毫秒浮点、
    //     严大于整数 builtAt——「写源 → 快编译完 → 查 stale」高频误报（第三轮
    //     实测 30-60%）。fs 自己的时间戳两边都对齐：APFS 125µs 一格是这套比较
    //     能达到的分辨率上限。
    const buildPath = path.join(outDir, 'build.json');
    fs.writeFileSync(buildPath, JSON.stringify({
      builtAt: 0,
      boardMtimeMs,
      ...(boardInput ? { boardInput } : {}),
      tool: compilerStamp(),
      sources: mergedSources,
      errors: mergedErrors,
    }, null, 2) + '\n');
    builtAt = fs.statSync(buildPath).mtimeMs;
    fs.writeFileSync(buildPath, JSON.stringify({
      builtAt,
      boardMtimeMs,
      ...(boardInput ? { boardInput } : {}),
      tool: compilerStamp(),
      sources: mergedSources,
      errors: mergedErrors,
    }, null, 2) + '\n');
  }
  return {
    entryId: target.entryId,
    ok: screens.every((row) => row.ok) && figures.every((row) => row.ok),
    builtAt,
    ms: Math.round((performance.now() - started) * 10) / 10,
    screens,
    figures,
    partial: Boolean(onlyScreens),
    totalScreens: ids.length,
    // 请求返回此 ticket 的字节，不能等下一代写盘后再读 dist，把完成边界推向未来。
    ...(options.includeFrames ? { frames: Object.fromEntries(picked.map((entry, i) => [entry.id, rows[i]])) } : {}),
  };
}

/* ---- 图：正文里的 <Figure>（docs/projects.md“图”） ---- */

/** 图的源文件（相对文章目录）：图本身，和可选的 sidecar 脚本、样式。 */
export function figureFiles(id) {
  return { jsx: `figures/${id}.jsx`, js: `figures/${id}.js`, css: `figures/${id}.css` };
}

function figureDistPaths(distRoot, entryId, id) {
  const dir = path.join(distRoot, entryId, 'figures');
  return { dir, html: path.join(dir, `${id}.html`), record: path.join(dir, `${id}.json`) };
}


/** 图的编译记录 <dist>/<页>/figures/<图>.json；没有或坏了返回 null。 */
export function readFigureRecord(distRoot, entryId, id) {
  try {
    return JSON.parse(fs.readFileSync(figureDistPaths(distRoot, entryId, id).record, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 编译一个图（不落盘）：figures/<id>.jsx 按帧的同一套规则编（esbuild + lint 四禁 + 渲染成 HTML，
 * 组件和 pinpoint/kit 照帧的解析序；图里写 ../components/X.jsx），sidecar figures/<id>.js 在
 * 编译期只查语法（运行在浏览器里，见 frame-doc.js 的 figurePageHtml）。
 * → { ok, html?, error?, diagnostics?, sources: [{ file, mtimeMs }], script, css, usesKit, ms }
 *   sources 是判断要不要重编的全部输入（图、它 import 的文件、sidecar、样式），路径相对文章目录。
 *   失败时 diagnostics 是 ppnt check 用的 [{ code, file（绝对路径）, line, message }]，code 同帧
 *   （compile、lint_*），只有默认导出和渲染两种是 figure_export / figure_render。
 */
export async function compileFigure(target, id) {
  const started = performance.now();
  const files = figureFiles(id);
  const abs = (rel) => path.join(target.pageDir, rel);
  const script = isFileSync(abs(files.js));
  const css = isFileSync(abs(files.css));
  const finish = (row) => ({ script, css, usesKit: false, sources: [], ...row, ms: Math.round((performance.now() - started) * 10) / 10 });
  const one = (code, file, message) => [{ code, file, line: null, message }];
  if (!FIGURE_ID_PATTERN.test(String(id || ''))) {
    const message = `图 id 不合法：${JSON.stringify(id)}`;
    return finish({ ok: false, error: message, diagnostics: one('figure_src', null, message) });
  }
  if (!isFileSync(abs(files.jsx))) {
    return finish({ ok: false, error: `${files.jsx}: 源文件不存在`, diagnostics: one('figure_missing', abs(files.jsx), '源文件不存在') });
  }
  try {
    for (const rel of [files.jsx, ...(script ? [files.js] : []), ...(css ? [files.css] : [])]) requireSource(target, rel);
  } catch (error) {
    return finish({ ok: false, error: error.message, diagnostics: one('figure_src', null, error.message) });
  }
  const record = (rel) => ({ file: rel, mtimeMs: fs.statSync(requireSource(target, rel)).mtimeMs });
  const sources = [record(files.jsx)];
  if (script) sources.push(record(files.js));
  if (css) sources.push(record(files.css));
  let built;
  try {
    built = await esbuild.build({
      entryPoints: [files.jsx],
      absWorkingDir: fs.realpathSync(target.pageDir),
      bundle: true,
      preserveSymlinks: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      jsx: 'automatic',
      jsxDev: true,
      jsxImportSource: 'pp-jsx-runtime',
      external: ['preact', 'preact/jsx-dev-runtime', 'pp-jsx-runtime/jsx-dev-runtime'],
      metafile: true,
      logLevel: 'silent',
      plugins: pluginsFor(target),
    });
  } catch (error) {
    return finish({ ok: false, error: formatBuildFailure(error), diagnostics: buildFailureDiagnostics(error, target.pageDir), sources });
  }
  const deps = depRecordsFromInputs(target, built.metafile.inputs, [files.jsx]);
  sources.push(...deps);
  const lintErrors = [];
  for (const input of Object.keys(built.metafile.inputs)) {
    if (!/\.jsx$/.test(input)) continue;
    let text;
    try {
      text = fs.readFileSync(requireSource(target, input, COMPILER_ROOTS), 'utf8');
    } catch {
      continue;
    }
    lintErrors.push(...lintStampSource(text, input, { entry: input === files.jsx })
      .map((row) => ({ ...row, file: path.resolve(target.pageDir, input) })));
  }
  if (lintErrors.length) {
    return finish({
      ok: false,
      error: lintErrors.map((row) => row.message).join('\n'),
      diagnostics: lintErrors.map((row) => ({ code: row.code, file: row.file, line: row.line, message: row.text })),
      sources,
    });
  }
  const kitDir = fs.realpathSync(KIT_JSX);
  const usesKit = Object.keys(built.metafile.inputs).some((input) => {
    const file = path.resolve(target.pageDir, input);
    return file === kitDir || file.startsWith(kitDir + path.sep) || file.startsWith(KIT_JSX + path.sep);
  });
  let html;
  try {
    const mod = evaluateFrameBundle(built.outputFiles[0].text);
    if (!mod || typeof mod.default !== 'function') {
      const message = '图文件必须默认导出一个返回 JSX 的函数';
      return finish({ ok: false, error: `${files.jsx}: ${message}`, diagnostics: one('figure_export', abs(files.jsx), message), sources, usesKit });
    }
    html = renderFrameHtml(h(__ppWrapComponent(mod.default), {}), target.pageDir);
  } catch (error) {
    const message = String((error && error.message) || error);
    return finish({ ok: false, error: `${files.jsx}: ${message}`, diagnostics: one('figure_render', abs(files.jsx), message), sources, usesKit });
  }
  if (script) {
    try {
      await esbuild.transform(fs.readFileSync(requireSource(target, files.js), 'utf8'), { loader: 'js', format: 'esm', sourcefile: files.js, logLevel: 'silent' });
    } catch (error) {
      return finish({ ok: false, error: formatBuildFailure(error), diagnostics: buildFailureDiagnostics(error, target.pageDir), sources, usesKit });
    }
  }
  return finish({ ok: true, html, sources, usesKit });
}

/** 落盘：<dist>/<页>/figures/<图>.html（失败时删掉旧的）+ <图>.json（编译记录）。返回记录。 */
function writeFigure(distRoot, entryId, id, result) {
  const paths = figureDistPaths(distRoot, entryId, id);
  fs.mkdirSync(paths.dir, { recursive: true });
  if (result.ok) fs.writeFileSync(paths.html, result.html);
  else if (fs.existsSync(paths.html)) fs.unlinkSync(paths.html);
  const record = {
    // 墙钟（与页的 builtAt 同钟域）；图的新鲜判定按 sources 的 mtime 对账，不靠它。
    builtAt: Date.now(),
    ok: result.ok,
    ...(result.ok ? {} : { error: result.error }),
    sources: result.sources,
    script: result.script,
    css: result.css,
    usesKit: result.usesKit,
  };
  fs.writeFileSync(paths.record, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** 记录还代表盘上的源码吗：每个输入的 mtime 没变，sidecar 与样式没有新增或删掉。 */
export function figureRecordFresh(target, id, record) {
  if (!record || typeof record.builtAt !== 'number' || !Array.isArray(record.sources)) return false;
  const files = figureFiles(id);
  if (Boolean(record.script) !== isFileSync(path.join(target.pageDir, files.js))) return false;
  if (Boolean(record.css) !== isFileSync(path.join(target.pageDir, files.css))) return false;
  return record.sources.every((source) => {
    try {
      return fs.statSync(requireSource(target, source.file, COMPILER_ROOTS)).mtimeMs === source.mtimeMs;
    } catch {
      return false;
    }
  });
}

/**
 * 读一个图的编译结果，记录过期或没有就先编（/api/frame 与 ppnt 共用）。
 * → { ok: true, html, record } | { ok: false, error, record }
 */
export async function loadFigure(target, id, { distRoot = defaultDistRoot() } = {}) {
  let record = readFigureRecord(distRoot, target.entryId, id);
  const paths = figureDistPaths(distRoot, target.entryId, id);
  if (!figureRecordFresh(target, id, record) || (record.ok && !fs.existsSync(paths.html))) {
    record = writeFigure(distRoot, target.entryId, id, await compileFigure(target, id));
  }
  if (!record.ok) return { ok: false, error: record.error || '编译失败', record };
  return { ok: true, html: fs.readFileSync(paths.html, 'utf8'), record };
}

/** 本篇正文里的图（认得出 id、源文件在的）全部重编。→ [{ id, ok, ms, error? }] */
async function compileArticleFigures(target, { distRoot = defaultDistRoot(), writeDist = true } = {}) {
  let figures = [];
  try {
    figures = deriveArticleBoard(target).figures;
  } catch {
    return [];
  }
  const rows = [];
  for (const figure of figures) {
    if (!figure.id || !isFileSync(path.join(target.pageDir, figureFiles(figure.id).jsx))) continue;
    const result = await compileFigure(target, figure.id);
    if (writeDist) writeFigure(distRoot, target.entryId, figure.id, result);
    rows.push({ id: figure.id, ok: result.ok, ms: result.ms, ...(result.ok ? {} : { error: result.error }) });
  }
  return rows;
}

/**
 * 浏览器里跑图时出的错（图页的启动脚本报上来，POST /api/figure-error）：只记在“这一版”上——
 * builtAt 对得上当前记录才写，重编会换掉记录，旧的运行错误跟着消失。→ 写了没有。
 */
export function recordFigureRuntimeError(distRoot, entryId, id, { builtAt, message, line = null }) {
  const record = readFigureRecord(distRoot, entryId, id);
  if (!record || record.builtAt !== builtAt || !record.ok) return false;
  if (record.runtimeError) return true; // 只留这一版第一次出的错
  record.runtimeError = { message: String(message || '').slice(0, 2000), ...(Number.isInteger(line) && line > 0 ? { line } : {}) };
  fs.writeFileSync(figureDistPaths(distRoot, entryId, id).record, `${JSON.stringify(record, null, 2)}\n`);
  return true;
}

/**
 * 本篇图的编译错误与运行错误，写成 project 错误对象（docs/projects.md“图”的错误一节），
 * `pinpoint list <project>` 用。compile: true 时过期的图先重编（和 /api/frame 同一条路），
 * 否则只读已有记录。静态的写法错误（src、缺文件）不在这里，listProjects 已经有了。
 */
export async function figureDistErrors(target, { distRoot = defaultDistRoot(), compile = true } = {}) {
  let figures = [];
  try {
    figures = deriveArticleBoard(target).figures;
  } catch {
    return [];
  }
  const errors = [];
  const where = `articles/${target.articleId}/index.mdx`;
  for (const figure of figures) {
    if (!figure.id || !isFileSync(path.join(target.pageDir, figureFiles(figure.id).jsx))) continue;
    const loaded = compile
      ? await loadFigure(target, figure.id, { distRoot })
      : (() => { const record = readFigureRecord(distRoot, target.entryId, figure.id); return { ok: !record || record.ok, error: record && record.error, record }; })();
    const at = figure.line ? `第 ${figure.line} 行：` : '';
    const base = { path: where, figure: figure.id, ...(figure.line ? { line: figure.line } : {}), ...(figure.section ? { section: figure.section } : {}) };
    if (!loaded.ok) {
      errors.push({ code: 'figure_compile', message: `${at}<Figure> 图 "${figure.id}" 编译失败：${loaded.error}`, ...base });
    } else if (loaded.record && loaded.record.runtimeError) {
      const run = loaded.record.runtimeError;
      const inFile = run.line ? `（${figureFiles(figure.id).js} 第 ${run.line} 行）` : '';
      errors.push({ code: 'figure_runtime', message: `${at}<Figure> 图 "${figure.id}" 在浏览器里运行出错：${run.message}${inFile}`, ...base });
    }
  }
  return errors;
}

/**
 * 编译一帧、不落 dist，诊断与产物一起给（ppnt check）：
 * → { ok, html?, diagnostics: [{ code, file, line, message }] }。
 * 成功时 html 是注入 assets 后的产物，给机壳契约与 sidecar 挂载点用；失败时
 * diagnostics 带 lint / 编译错误。帧不必在板上（被布局错误挡在画布外的帧也能编）；
 * 板读不到时按没有资源的单帧编。
 */
export async function compileScreenChecked(target, screenId) {
  let assets = {};
  try {
    const board = readTargetBoard(target);
    if (board.assets && typeof board.assets === 'object') assets = board.assets;
  } catch { /* 板坏：照样编这一帧，板的错误由调用方另报 */ }
  const row = await compileScreen(target, { id: screenId }, { assets });
  if (row.ok) return { ok: true, html: row.html, diagnostics: [] };
  return { ok: false, diagnostics: row.diagnostics || [{ code: 'compile', file: null, line: null, message: row.error }] };
}

/** 编译单屏但不落 dist（ppnt render）。 */
export async function renderScreenHtml(target, screenId) {
  let board;
  try {
    board = readTargetBoard(target);
  } catch (error) {
    return { ok: false, error: boardReadError(target, error) };
  }
  const assets = board.assets && typeof board.assets === 'object' ? board.assets : {};
  const entry = screenEntriesFromBoard(board).find((row) => row.id === screenId) || { id: screenId };
  const row = await compileScreen(target, entry, { assets });
  return row.ok ? { ok: true, html: row.html } : { ok: false, error: row.error };
}

/**
 * 这页的 dist 是否不用重编（buildAllPages 的 skipFresh 用）：build.json 在、是这份
 * 编译器编的（tool 章）、distStatus 不 stale。文章页传现派生的板 —— 派生板与 dist
 * 里那份一致、正文又没改画布结构时才算 fresh（distStatus 对文章不看 index.mdx 的
 * mtime，改正文不等于改画布）。
 */
export function distIsFresh(target, { distRoot = defaultDistRoot() } = {}) {
  const build = readBuildJson(distRoot, target.entryId);
  if (!build || build.tool !== compilerStamp()) return false;
  let board = null;
  if (target.kind === 'article') {
    try {
      board = readTargetBoard(target);
    } catch {
      return false; // 板派生不出来：照常重编，让编译报出板的错误
    }
  }
  return !distStatus(target.entryId, target.pageDir, { distRoot, board }).stale;
}

/** 全量编译（服务启动）。页与页并行，单页失败不拖垮其他页；skipFresh 时 dist 已是
    最新的页整页跳过（审计 B5 的另一半：改动过的页才付编译钱），结果带 skipped: true。 */
export async function buildAllPages(options = {}) {
  const targets = listCompileTargets(options);
  const results = await Promise.all(targets.map(async (target) => {
    try {
      if (options.skipFresh && distIsFresh(target, options)) {
        return { entryId: target.entryId, ok: true, builtAt: null, ms: 0, screens: [], figures: [], skipped: true };
      }
      return await compilePage(target, options);
    } catch (error) {
      return { entryId: target.entryId, ok: false, builtAt: null, ms: 0, screens: [], error: String((error && error.message) || error) };
    }
  }));
  return results;
}

/* ---- serve 层读取 ---- */

/**
 * 从 dist 读一屏：
 *   ok      → { kind:'ok', html }
 *   error   → build.json 记录了编译错误（serve 500 带这段文本）
 *   unbuilt → 这页从没编过（serve 层懒编译一次再读）
 *   stale   → 编过、但这屏既无产物也无错误记录（dist 落后于 board 的状态）
 */
export function readDistScreen(entryId, screenId, { distRoot = defaultDistRoot() } = {}) {
  // build.json.errors 优先于磁盘文件（review R1）：错误记录在案时旧产物（含
  // 历史遗留的孤儿文件）不得顶班，agent 看到的必须与源码状态一致。
  const build = readBuildJson(distRoot, entryId);
  if (build && build.errors && build.errors[screenId]) return { kind: 'error', message: build.errors[screenId] };
  const file = path.join(distRoot, entryId, `${screenId}.html`);
  if (fs.existsSync(file)) return { kind: 'ok', html: fs.readFileSync(file, 'utf8') };
  if (!build) return { kind: 'unbuilt' };
  return { kind: 'stale' };
}

/** board 响应附带的 dist 状态：builtAt + stale。stale 的判据：
    ① 有源码记录的屏编译失败（源码在、产物没了，失败重编虽刷新 builtAt，
    产物并不代表源码 —— review R1）；② 任一源文件 / 依赖 mtime 晚于 builtAt。
    「源码不存在」的屏（板里挂了、文件从来没有）没有源码记录，不算 stale ——
    错误面板已如实表达这个状态，dist 并没有落后于什么。
    文章画布（给了 board = 现派生的板）不看 index.mdx 的 mtime（改正文不等于改画布），
    而是比现派生的板与 dist 里那份是否相同。 */
export function distStatus(entryId, pageDir, { distRoot = defaultDistRoot(), board = null } = {}) {
  const build = readBuildJson(distRoot, entryId);
  if (!build || typeof build.builtAt !== 'number') return { builtAt: null, stale: true };
  const sources = build.sources || {};
  let stale = Object.keys(build.errors || {}).some((id) => sources[id]);
  const newerThanBuild = (file) => {
    try {
      return fs.statSync(file).mtimeMs > build.builtAt;
    } catch {
      return true; // 源文件消失也算过期
    }
  };
  for (const record of Object.values(sources)) {
    if (record && typeof record.file === 'string' && newerThanBuild(path.join(pageDir, record.file))) {
      stale = true;
      break;
    }
    // R2：帧 import 的组件依赖（页内 components/ 与 kit）也参与 stale 判定。
    for (const dep of (record && record.deps) || []) {
      if (dep && typeof dep.file === 'string' && newerThanBuild(path.join(pageDir, dep.file))) {
        stale = true;
        break;
      }
    }
    if (stale) break;
  }
  if (!stale) {
    if (board) stale = JSON.stringify(readDistBoard(distRoot, entryId)) !== JSON.stringify(board);
    else if (newerThanBuild(path.join(pageDir, 'board.json'))) stale = true;
  }
  return { builtAt: build.builtAt, stale };
}

/* ---- serve 层响应（sites-api 与 content-routes 共用） ---- */

/** rel 路径 → 屏 id（屏源码恒在页目录顶层，单段 <id>.html 才算）。 */
export function screenIdFromRel(rel) {
  const match = String(rel || '').match(/^([a-zA-Z0-9_-]+)\.html$/);
  return match ? match[1] : null;
}

/**
 * 读一屏当前源码代次的 dist：等在飞编译，输入过期就按需重编后读取。
 * serve 层（500 上面板）与 /api/frame（500 frame_failed）共用同一条路。
 */
export async function loadDistScreenHtml(target, screenId, { signal } = {}) {
  signal?.throwIfAborted();
  const distRoot = defaultDistRoot();
  const key = compilationKey(target, distRoot);
  const discard = () => fs.rmSync(path.join(distRoot, target.entryId, `${screenId}.html`), { force: true });
  let entry;
  let board;
  let primary = null;
  try {
    board = readTargetBoard(target);
    entry = screenEntriesFromBoard(board).find((item) => item.id === screenId);
    if (!entry) throw new Error(`板里没有帧：${screenId}`);
    // 当前源码的优先级也要查：不能只检查旧记录，遗漏新出现的 JSX / 本篇组件。
    if (entry.src) {
      if (!articleHtmlFrameFile(target, entry)) throw new Error(`源码不在登记根内或不存在：${screenId}`);
    } else {
      primary = entry.comp ? `components/${entry.comp}.jsx`
        : fs.existsSync(path.join(target.pageDir, `${screenId}.jsx`)) ? `${screenId}.jsx` : `${screenId}.html`;
      if (!entry.comp || fs.existsSync(path.join(target.pageDir, primary))) requireSource(target, primary);
      else primary = null; // kit 组件没有本篇文件，由 source / deps 记录校验。
    }
  } catch (error) {
    discard();
    return { ok: false, error: error.message };
  }
  const build = readBuildJson(distRoot, target.entryId);
  const source = build?.sources?.[screenId];
  const roots = [...COMPILER_ROOTS, ...Object.values(target.sources || {})];
  const invalid = source && [source, ...(source.deps || [])].some((record) => !containedSource(target, record.file, roots).file);
  const resolutionChanged = source?.resolutions?.some(({ candidates, selected }) => (
    (candidates.find(file => fs.existsSync(path.resolve(target.pageDir, file))) || null) !== selected
  ));
  const changed = (record) => {
    try { return fs.statSync(path.resolve(target.pageDir, record.file)).mtimeMs !== record.mtimeMs; }
    catch { return record.mtimeMs !== null; }
  };
  // builtAt 是整页最后一拍的时间，增量编译别帧会刷新它；逐项对比输入代次才能守住本帧。
  const boardChanged = target.kind === 'article'
    ? JSON.stringify(readDistBoard(distRoot, target.entryId)) !== JSON.stringify(board)
    : build?.boardMtimeMs !== fs.statSync(path.join(target.pageDir, 'board.json')).mtimeMs;
  const all = !build || build.tool !== compilerStamp() || boardChanged;
  const result = readDistScreen(target.entryId, screenId);
  // 失败只作诊断，不作负缓存：未解析 import 的完整候选由 esbuild 决定。
  if (all || invalid || resolutionChanged || !source || (primary && source.file !== primary)
    || [source, ...(source.deps || [])].some(changed) || result.kind !== 'ok') {
    // 进入时满足输入就直接返回，否则只申请一次随后开始的 ticket，不追赶后继保存。
    const queued = pageCompilations.get(key);
    let task;
    if (queued && !queued.started) {
      const opts = queued.options;
      const selected = opts.onlyScreen ? [opts.onlyScreen] : opts.onlyScreens;
      if (all || !selected) { delete opts.onlyScreen; delete opts.onlyScreens; }
      else { delete opts.onlyScreen; opts.onlyScreens = [...new Set([...selected, screenId])]; }
      opts.includeFrames = true;
      queued.interests.push(signal || null);
      task = queued.promise;
    } else {
      task = compilePage(target, { ...(all ? {} : { onlyScreen: screenId }), includeFrames: true, signal });
    }
    const compiled = await waitForRequest(task, signal);
    if (compiled.error) return { ok: false, error: compiled.error };
    const frame = compiled.frames?.[screenId];
    return frame?.ok ? { ok: true, html: frame.html } : { ok: false, error: frame?.error || '板里没有帧：' + screenId };
  }
  return result.kind === 'error' ? { ok: false, error: result.message } : { ok: true, html: result.html };
}

/**
 * 从 dist 出一屏（GET/HEAD）。过期或 unbuilt 时按需编译，编译失败 / 未编译的屏 500 带错误文本（no-cache）
 * —— 工作台的 .wb-screen-err 面板吃非 200 状态。
 * inject(html) → html：annotate 注入由调用方决定（annotateInjection，/sites/
 * 全量注入；/previews/ 只对 doctype 整文档注入）。
 * 缓存走策略表 distScreen 行（S3 / 审计 K2c）：no-cache + 注入后字节的 ETag，
 * reload / HMR 重取时 304——ETag 是最终字节的哈希，重编后内容一变必然 200 新内容。
 */
export async function serveDistScreenResponse(req, res, target, screenId, { inject = null } = {}) {
  const lifetime = requestSignal(req, res);
  let result;
  try {
    result = await loadDistScreenHtml(target, screenId, { signal: lifetime.signal });
    if (lifetime.signal.aborted) return true;
  } catch (error) {
    if (lifetime.signal.aborted) return true;
    throw error;
  } finally {
    lifetime.dispose();
  }
  if (result.ok) {
    let body = Buffer.from(result.html, 'utf8');
    if (inject) body = Buffer.from(inject(body.toString('utf8')), 'utf8');
    return sendCacheable(req, res, body, { policy: 'distScreen', contentType: 'text/html; charset=utf-8' });
  }
  const body = Buffer.from(result.error, 'utf8');
  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  // 出帧错误应答的头只有一种：no-cache、不带 ETag（review 建议 3，与图页编译
  // 失败的 500 一致）。错误态之后会变好（修好源码重编），任何一层都不许把
  // 「这一屏是坏的」存下来；错误文本每次都可能是别的，验证器没有意义。
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}

/** board.json 响应附带 dist: { builtAt, stale }；磁盘没板 / 板坏时回落原样字节。
    给了 board（文章画布现派生的板）时直接吐它。缓存走策略表 boardJson 行
    （no-cache + 内容 ETag；dist 状态一变内容变、ETag 跟着变）。 */
export function serveBoardJsonWithDist(req, res, entryId, pageDir, { board: derived = null } = {}) {
  let raw = null;
  if (!derived) {
    try {
      const found = resolveContainedFile(pageDir, 'board.json', { index: false });
      if (!found.file) return false;
      raw = fs.readFileSync(found.file, 'utf8');
    } catch {
      return false;
    }
  }
  let text = raw;
  try {
    const board = derived || JSON.parse(raw);
    text = `${JSON.stringify({ ...board, dist: distStatus(entryId, pageDir, derived ? { board: derived } : {}) }, null, 2)}\n`;
  } catch { /* 板坏了也照原样吐，workbench 的契约校验会报出真正的问题 */ }
  return sendCacheable(req, res, Buffer.from(text, 'utf8'), { policy: 'boardJson', contentType: 'application/json; charset=utf-8' });
}
