/**
 * pp2 页编译器（2026-09-22 切片 1）：页目录源码 → dist 静态 HTML 帧。
 *
 * 输入（页目录 = registry dir 条目的 path，或 content/previews/<pageId>）：
 * - 每个 screen 按 <screenId>.jsx → <screenId>.html 的顺序找源码；都没有则该屏报
 *   “源码不存在”，其余屏照常编译。
 * - .jsx 帧：esbuild（jsx automatic + jsxDev + 我们的 pp-jsx-runtime）转 cjs bundle，
 *   new Function 就地求值后 renderToString 成 HTML 片段；相对 import 走 esbuild
 *   默认解析。
 * - .html 帧：原样保留。
 * - board.json 顶层 assets: { css?: [], js?: [] } 注入每帧：css 在帧开头
 *   `<style>@import …`，js 在帧末尾 `<script type="module" data-preview-script …>`；
 *   存量帧手写了同 URL 行的不重复注入。
 *
 * lint（编译失败，报文件与行）：import preact/hooks、onX 属性、fetch(、帧文件顶层
 * 有 import / export default 之外的语句。实现是 esbuild metafile + 文本扫描，不引 parser。
 *
 * 输出：<distRoot>/<entryId>/<screenId>.html + build.json
 *   { builtAt, sources: { [screen]: { file, mtimeMs } }, errors: { [screen]: message } }。
 * distRoot 默认 <dataRoot()>/dist（PINPOINT_DATA_DIR 可改，e2e 走临时目录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import { dataRoot } from './annotate-data-dir.js';
import { readBoard } from './board-file.js';
import { manifestPageIds } from './page-manifest.js';
import { __ppWrapComponent } from './pp-jsx-runtime.js';
import { PAGE_ID_PATTERN } from './registry.js';
import { COMP_NAME_PATTERN } from '../../workbench/lib/preview-contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
// pinpoint/kit 的落点（pp2 切片 2）：kit 的 10 个系统组件的 JSX 印章住这里。
const KIT_JSX = path.join(ROOT, 'content', 'kits', 'ios', 'jsx');
const KIT_JSX_INDEX = path.join(KIT_JSX, 'index.js');

export function defaultDistRoot(env = process.env) {
  return path.join(dataRoot(env), 'dist');
}

/** 页 id → 编译目标。registry dir 条目（磁盘有 board.json）优先，其次模板页。 */
export function resolvePageTarget(pageRef, { registry = null, root = ROOT } = {}) {
  if (typeof pageRef !== 'string' || !PAGE_ID_PATTERN.test(pageRef)) return null;
  const entry = registry
    ? (typeof registry.resolve === 'function'
      ? registry.resolve(pageRef)
      : ((registry.entries || []).find((row) => row && row.id === pageRef) || null))
    : null;
  if (entry && entry.kind === 'dir' && typeof entry.path === 'string') {
    const pageDir = path.resolve(entry.path);
    if (fs.existsSync(path.join(pageDir, 'board.json'))) {
      return { entryId: entry.id, pageDir, urlBase: `/sites/${entry.id}/`, kind: 'dir' };
    }
  }
  const pageDir = path.join(root, 'content', 'previews', pageRef);
  if (fs.existsSync(path.join(pageDir, 'board.json'))) {
    return { entryId: pageRef, pageDir, urlBase: `/previews/${pageRef}/`, kind: 'template' };
  }
  return null;
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

function screenIdsFromBoard(board) {
  if (!board || !Array.isArray(board.sections)) return null;
  const ids = new Set();
  for (const section of board.sections) {
    for (const screen of (section && section.screens) || []) {
      const id = typeof screen === 'string' ? screen : screen && screen.id;
      if (typeof id === 'string' && PAGE_ID_PATTERN.test(id)) ids.add(id);
    }
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
  // 组件文件里是命名导出函数（export function Badge），放行一切 export。
  // 帧文件（pp2 切片 2）再放行 function Name( 开头的函数声明 —— 帧内小组件；
  // const / let / 表达式语句仍然禁止。
  const exportOk = entry ? /^export\s+default\b/ : /^export\b/;
  const exportLabel = entry ? 'export default' : 'export';
  const functionOk = entry ? /^function\s+[A-Za-z_$]/ : /$./;
  let depthB = 0;
  let depthP = 0;
  let depthK = 0;
  let mode = null; // 'import' | 'export' | 'function'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const atTop = depthB === 0 && depthP === 0 && depthK === 0;

    if (/\bfrom\s*['"]preact\/hooks['"]/.test(trimmed)) {
      errors.push({ line: i + 1, message: `${file}:${i + 1}: 禁止 import preact/hooks（组件是印章：无状态无副作用）` });
    }
    const onMatch = line.match(/\s(on[A-Z][A-Za-z0-9]*)\s*=/);
    if (onMatch) {
      errors.push({ line: i + 1, message: `${file}:${i + 1}: 禁止事件属性 ${onMatch[1]}（状态即帧，交互走 sidecar）` });
    }
    if (/\bfetch\s*\(/.test(line)) {
      errors.push({ line: i + 1, message: `${file}:${i + 1}: 禁止 fetch（编译期渲染，没有数据请求）` });
    }

    if (!mode && atTop && trimmed
      && !/^import\b/.test(trimmed)
      && !exportOk.test(trimmed)
      && !functionOk.test(trimmed)
      && !/^\/\//.test(trimmed) && !/^\/\*/.test(trimmed) && !/^\*/.test(trimmed) && !/^\*\//.test(trimmed)) {
      errors.push({ line: i + 1, message: `${file}:${i + 1}: 顶层只允许 import、${exportLabel}${entry ? ' 和函数声明' : ''}（组件是印章，没有顶层逻辑）` });
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

// 帧 bundle（cjs）里仅有的三个外部 require，映射回进程里已加载的模块 —— 帧与
// 编译器共享同一个 preact / 运行时实例（vnode 鸭子类型跨实例不兼容），也不再
// 需要 file URL external 的插件。
import * as preactModule from 'preact';
import * as preactJsxDevRuntime from 'preact/jsx-dev-runtime';
import * as ppRuntimeModule from './pp-jsx-runtime.js';

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
function evaluateFrameBundle(code) {
  const mod = { exports: {} };
  const require = (id) => {
    if (!(id in REQUIRE_MAP)) throw new Error(`帧 bundle 出现未映射的 require：${id}`);
    return REQUIRE_MAP[id];
  };
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
  return mod.exports;
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
function depRecordsFromInputs(target, inputs, exclude) {
  const skipped = new Set(exclude);
  const out = [];
  for (const input of Object.keys(inputs)) {
    if (skipped.has(input)) continue;
    const abs = path.resolve(target.pageDir, input);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    out.push({ file: path.relative(target.pageDir, abs).split(path.sep).join('/'), mtimeMs: stat.mtimeMs });
  }
  return out;
}

async function compileJsxScreen(target, screenId, file) {
  let built;
  try {
    built = await esbuild.build({
      entryPoints: [file],
      absWorkingDir: target.pageDir,
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      jsx: 'automatic',
      jsxDev: true,
      jsxImportSource: 'pp-jsx-runtime',
      external: ['preact', 'preact/jsx-dev-runtime', 'pp-jsx-runtime/jsx-dev-runtime'],
      metafile: true,
      logLevel: 'silent',
      plugins: [kitJsxPlugin()],
    });
  } catch (error) {
    return { ok: false, error: formatBuildFailure(error) };
  }
  const lintErrors = [];
  for (const input of Object.keys(built.metafile.inputs)) {
    if (!/\.jsx$/.test(input)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(target.pageDir, input), 'utf8');
    } catch {
      continue;
    }
    lintErrors.push(...lintStampSource(text, input, { entry: input === file }));
  }
  if (lintErrors.length) {
    return { ok: false, error: lintErrors.map((row) => row.message).join('\n') };
  }
  try {
    const mod = evaluateFrameBundle(built.outputFiles[0].text);
    if (!mod || typeof mod.default !== 'function') {
      return { ok: false, error: `${file}: 帧文件必须默认导出一个返回 JSX 的函数` };
    }
    return {
      ok: true,
      html: renumberPpIds(renderToString(h(__ppWrapComponent(mod.default), {})), { pageDir: target.pageDir }),
      deps: depRecordsFromInputs(target, built.metafile.inputs, [file]),
    };
  } catch (error) {
    return { ok: false, error: `${file}: ${String((error && error.message) || error)}` };
  }
}

function compileHtmlScreen(target, screenId, file) {
  let html;
  try {
    html = fs.readFileSync(path.join(target.pageDir, file), 'utf8');
  } catch (error) {
    return { ok: false, error: `${file}: ${String((error && error.message) || error)}` };
  }
  return { ok: true, html };
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

/** board.json 的 screen 条目序列（编译用）：{ id, comp?, props? }，按 id 去重保序。 */
export function screenEntriesFromBoard(board) {
  if (!board || !Array.isArray(board.sections)) return [];
  const seen = new Set();
  const entries = [];
  for (const section of board.sections) {
    for (const screen of (section && section.screens) || []) {
      const raw = typeof screen === 'string' ? { id: screen } : screen;
      if (!raw || typeof raw.id !== 'string' || !PAGE_ID_PATTERN.test(raw.id)) continue;
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      const entry = { id: raw.id };
      // comp section 的 variants 墙（pp2 切片 2）：comp = 组件名，props 只允许 JSON 值
      // （board.json 本身是 JSON，天然满足；非对象的 props 按空对象处理）。
      if (typeof raw.comp === 'string' && raw.comp) {
        if (!COMP_NAME_PATTERN.test(raw.comp)) {
          // 编译侧与 workbench 的 preview-contracts 同一条 comp 名规则：不合法的
          // 名不进路径拼接（`../../x` 会指到页外）也不进生成的 import 代码，
          // 屏级报错，其余屏照常。
          entry.compError = `comp 名不合法："${raw.comp}"（必须匹配 ${COMP_NAME_PATTERN}）`;
        } else {
          entry.comp = raw.comp;
          entry.props = raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props) ? raw.props : {};
        }
      }
      entries.push(entry);
    }
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
  const sourceRecord = (file) => ({ file, mtimeMs: fs.statSync(path.join(target.pageDir, file)).mtimeMs });
  if (entry.comp) {
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
  // 帧的 import 依赖（页内组件 / kit 印章）一并记进 sources（review R2）。
  if (result.ok && result.deps && source) source = { ...source, deps: result.deps };
  if (result.ok) result.html = injectAssets(result.html, options.assets || {}, target.urlBase);
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
      source: null,
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
  let built;
  try {
    built = await esbuild.build({
      stdin: { contents: virtual, sourcefile: '__comp__.jsx', resolveDir: target.pageDir, loader: 'jsx' },
      absWorkingDir: target.pageDir,
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      jsx: 'automatic',
      jsxDev: true,
      jsxImportSource: 'pp-jsx-runtime',
      external: ['preact', 'preact/jsx-dev-runtime', 'pp-jsx-runtime/jsx-dev-runtime'],
      metafile: true,
      logLevel: 'silent',
      plugins: [kitJsxPlugin()],
    });
  } catch (error) {
    return { result: { ok: false, error: formatBuildFailure(error) }, source: null };
  }
  const lintErrors = [];
  for (const input of Object.keys(built.metafile.inputs)) {
    if (!/\.jsx$/.test(input)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(target.pageDir, input), 'utf8');
    } catch {
      continue;
    }
    lintErrors.push(...lintStampSource(text, input, { entry: false }));
  }
  if (lintErrors.length) {
    return { result: { ok: false, error: lintErrors.map((row) => row.message).join('\n') }, source: null };
  }
  try {
    const mod = evaluateFrameBundle(built.outputFiles[0].text);
    if (typeof mod.__picked !== 'function') {
      return {
        result: { ok: false, error: `${id}: 组件 ${comp} 在 ${sourceDesc} 里没有命名导出或默认导出` },
        source: null,
      };
    }
    const html = renumberPpIds(renderToString(h(__ppWrapComponent(mod.default), {})), { pageDir: target.pageDir });
    const sourceRel = path.relative(target.pageDir, sourceAbs).split(path.sep).join('/');
    const deps = depRecordsFromInputs(target, built.metafile.inputs, ['__comp__.jsx', sourceRel]);
    return {
      result: { ok: true, html },
      source: { file: sourceRel, mtimeMs: fs.statSync(sourceAbs).mtimeMs, ...(deps.length ? { deps } : {}) },
    };
  } catch (error) {
    return { result: { ok: false, error: `${sourceDesc}: ${String((error && error.message) || error)}` }, source: null };
  }
}

export function readBuildJson(distRoot, entryId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(distRoot, entryId, 'build.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 编译一整页 → 写 dist（writeDist=false 时只算不写，ppnt render 用）。
 * onlyScreen（CLI --screen，单个）与 onlyScreens（watch/HMR 增量，审计 B1）
 * 都走「只编挑中的屏 + 合并既有 build.json」的路径，其余屏的产物与记录原样保留。
 * 返回 { entryId, ok, builtAt, ms, screens: [{ id, ok, ms, error? }], partial, totalScreens, error? }；
 * partial = 只编了挑中的屏，totalScreens = 板上的屏数（CLI 打「增量 M/N 屏」用）。
 */
export async function compilePage(target, options = {}) {
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
  try {
    board = JSON.parse(fs.readFileSync(path.join(target.pageDir, 'board.json'), 'utf8'));
  } catch (error) {
    return { entryId: target.entryId, ok: false, builtAt: null, ms: 0, screens: [], error: `board.json 读取失败：${(error && error.message) || error}` };
  }
  const ids = screenEntriesFromBoard(board);
  const assets = board.assets && typeof board.assets === 'object' ? board.assets : {};
  const picked = onlyScreens ? ids.filter((entry) => onlyScreens.includes(entry.id)) : ids;
  const screens = [];
  const sources = {};
  const errors = {};
  const htmls = {};
  for (const entry of picked) {
    const row = await compileScreen(target, entry, { assets });
    screens.push({ id: entry.id, ok: row.ok, ms: row.ms, ...(row.ok ? {} : { error: row.error }) });
    if (row.source) sources[entry.id] = row.source;
    if (row.ok) htmls[entry.id] = row.html;
    else errors[entry.id] = row.error;
  }
  // 浮点历元毫秒：与 stat 的 mtimeMs（亚毫秒浮点）同精度，stale 比较才不吃截断亏。
  const builtAt = performance.timeOrigin + performance.now();
  if (writeDist) {
    const outDir = path.join(distRoot, target.entryId);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [id, html] of Object.entries(htmls)) {
      fs.writeFileSync(path.join(outDir, `${id}.html`), html);
    }
    // 失败屏的旧产物必须删掉（review R1）：否则改坏一帧后 serve 拿改坏前的
    // 画面顶班，错误面板、stale、mention 全部零信号。删了文件还不够 —— 读取侧
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
      mergedSources = { ...(old.sources || {}), ...sources };
      mergedErrors = { ...(old.errors || {}) };
      for (const entry of picked) {
        if (errors[entry.id]) mergedErrors[entry.id] = errors[entry.id];
        else delete mergedErrors[entry.id];
      }
    }
    fs.writeFileSync(path.join(outDir, 'build.json'), JSON.stringify({
      builtAt,
      sources: mergedSources,
      errors: mergedErrors,
    }, null, 2) + '\n');
  }
  return {
    entryId: target.entryId,
    ok: screens.every((row) => row.ok),
    builtAt,
    ms: Math.round((performance.now() - started) * 10) / 10,
    screens,
    partial: Boolean(onlyScreens),
    totalScreens: ids.length,
  };
}

/** 编译单屏但不落 dist（ppnt render）。 */
export async function renderScreenHtml(target, screenId) {
  let board;
  try {
    board = JSON.parse(fs.readFileSync(path.join(target.pageDir, 'board.json'), 'utf8'));
  } catch (error) {
    return { ok: false, error: `board.json 读取失败：${(error && error.message) || error}` };
  }
  const assets = board.assets && typeof board.assets === 'object' ? board.assets : {};
  const entry = screenEntriesFromBoard(board).find((row) => row.id === screenId) || { id: screenId };
  const row = await compileScreen(target, entry, { assets });
  return row.ok ? { ok: true, html: row.html } : { ok: false, error: row.error };
}

/** 全量编译（服务启动 probe）。页与页并行，单页失败不拖垮其他页。 */
export async function buildAllPages(options = {}) {
  const targets = listCompileTargets(options);
  const results = await Promise.all(targets.map(async (target) => {
    try {
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
    错误面板已如实表达这个状态，dist 并没有落后于什么。 */
export function distStatus(entryId, pageDir, { distRoot = defaultDistRoot() } = {}) {
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
  if (!stale && newerThanBuild(path.join(pageDir, 'board.json'))) stale = true;
  return { builtAt: build.builtAt, stale };
}

/* ---- serve 层响应（sites-api 与 content-routes 共用） ---- */

/** rel 路径 → 屏 id（屏源码恒在页目录顶层，单段 <id>.html 才算）。 */
export function screenIdFromRel(rel) {
  const match = String(rel || '').match(/^([a-zA-Z0-9_-]+)\.html$/);
  return match ? match[1] : null;
}

/**
 * 读一屏 dist（unbuilt 时懒编译一次）：ok → html；否则 error 文本。
 * serve 层（500 上面板）与 /api/frame（500 frame_failed）共用同一条路。
 */
export async function loadDistScreenHtml(target, screenId) {
  let result = readDistScreen(target.entryId, screenId);
  if (result.kind === 'unbuilt') {
    try {
      await compilePage(target);
    } catch { /* 编译异常已进 build.json / 下面按状态报错 */ }
    result = readDistScreen(target.entryId, screenId);
  }
  if (result.kind === 'ok') return { ok: true, html: result.html };
  return {
    ok: false,
    error: result.kind === 'error' ? result.message : `屏未编译：ppnt build ${target.entryId}`,
  };
}

/**
 * 从 dist 出一屏（GET/HEAD）。unbuilt 时懒编译一次（pinpoint add 的新条目、
 * 服务没跑过全量的首请求），编译失败 / 未编译的屏 500 带错误文本 —— 工作台
 * 的 .wb-screen-err 面板吃非 200 状态。
 * inject(html) → html：annotate 注入由调用方决定（/sites/ 全量注入；/previews/
 * 只对 doctype 整文档注入）。
 */
export async function serveDistScreenResponse(req, res, target, screenId, { inject = null } = {}) {
  const result = await loadDistScreenHtml(target, screenId);
  if (result.ok) {
    let body = Buffer.from(result.html, 'utf8');
    if (inject) body = Buffer.from(inject(body.toString('utf8')), 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', String(body.length));
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(body);
    return true;
  }
  const body = Buffer.from(result.error, 'utf8');
  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}

/** board.json 响应附带 dist: { builtAt, stale }；磁盘没板 / 板坏时回落原样字节。 */
export function serveBoardJsonWithDist(req, res, entryId, pageDir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(pageDir, 'board.json'), 'utf8');
  } catch {
    return false;
  }
  let text = raw;
  try {
    const board = JSON.parse(raw);
    text = `${JSON.stringify({ ...board, dist: distStatus(entryId, pageDir) }, null, 2)}\n`;
  } catch { /* 板坏了也照原样吐，workbench 的契约校验会报出真正的问题 */ }
  const body = Buffer.from(text, 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}
