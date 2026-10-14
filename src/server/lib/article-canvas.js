/**
 * 从文章正文（index.mdx）读出画布结构（docs/projects.md「画布视图」）。
 *
 * 只解析不渲染：用站点同一套 MDX 解析（unified + remark-parse + remark-mdx，
 * @astrojs/mdx 也是它），读顶层的 <Section id title> 和节里的
 * <Canvas frames={["帧 id", …]} shell="…" />。frames 只认字面量数组，每一项是字面量字符串，或
 * `{ id: "帧 id", src: "相对 project 根的路径.html" }`（project 根下的 HTML 帧）；shell 只认字面量字符串。
 * 其他写法都是错误，不猜。
 *
 * 纯函数（帧的源文件、帧级 shell、project 根下的文件由调用方的 frameSource / frameShell / rootFrame 回答；
 * 读盘的那一组由 frameFileReaders(文章目录) 给）：
 *   parseArticleCanvas(text, { frameSource, frameShell, rootFrame }) → { sections, errors }
 *   sections = [{ id, title, articleLetter, shell?, frameShells?, frameSrc?, frames: [帧 id…] }]，
 *   按正文顺序，只含有 Canvas 且至少一帧可用的节。frameShells = { 帧 id: shell }，只含
 *   帧文件里写了 `export const shell = "…"` 的帧（盖过这一节的 shell），和没写 <Canvas shell> 的节里的
 *   HTML 帧（doc）。frameSrc = { 帧 id: src }，只含 project 根下的 HTML 帧。
 *   errors = [{ code, message, line?, section?, frame?, figure? }]：message 以“第 N 行：”开头；属于某
 *   一节的带 section（节 id），属于某一帧的再带 frame。code 是错误的种类（不显示），
 *   listProjects 再给它加上 path（src/shared/project-errors.js）。
 *
 * 正文里的图（<Figure src="figures/<图 id>.jsx" caption="…" />，docs/projects.md“图”）也在这里读：
 *   figures = [{ index, line, section?, id?, caption? }]，按正文顺序，每个 <Figure> 一项，写坏的也在
 *   （没有 id）：站点按 index 把它对到页面上的那个图，错误就显示在图的位置。图的错误 code 以
 *   figure_ 开头，带 line，属于某一节的带 section，认得出 id 的带 figure。
 */
import fs from 'node:fs';
import path from 'node:path';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

import { articleFigures, articleStructure, jsxAttribute, literalAttribute } from '../../shared/article-structure.js';
import { CANVAS_SHELLS, FIGURE_DIR, FIGURE_SRC_PATTERN, FRAME_ID_PATTERN as FRAME_ID, HTML_FRAME_SRC_PATTERN, SECTION_ID_PATTERN as SECTION_ID, parseFrameSrc } from '../../shared/project-ids.js';
import { parseFrontmatter } from './frontmatter.js';

const processor = unified().use(remarkParse).use(remarkMdx);

/** 图的错误种类：src 写错、caption 不是字面量、不认识的属性、同一个图用了两次、源文件不在。
    站点把它们显示在图的位置，不进画布卡片和页顶错误条（isFigureError）。 */
const FIGURE_ERROR_CODES_LIST = ['figure_src', 'figure_caption', 'figure_prop', 'figure_duplicate', 'figure_missing'];
/** <Figure> 认的属性。 */
const FIGURE_PROPS = new Set(['src', 'caption']);

/** parseArticleCanvas 报的错误种类（error.code）。listProjects 把它们和 frontmatter 等错误放在一起，
    articleCanvas 靠它分出哪些是画布错误。 */
export const CANVAS_ERROR_CODES = Object.freeze(new Set([
  'mdx_parse', 'section_nested', 'canvas_outside_section', 'section_id', 'section_duplicate', 'section_title',
  'canvas_multiple', 'canvas_shell', 'canvas_frames', 'canvas_empty',
  'frame_cross_page', 'frame_id', 'frame_duplicate', 'frame_missing', 'frame_shell', 'frame_source', 'frame_src',
  ...FIGURE_ERROR_CODES_LIST,
]));

const FRAME_SHELL_DECL = /^export\s+(?:(?:const|let|var)\s+shell\b|\{[^}]*\bshell\b)/;
const FRAME_SHELL_LITERAL = /^export\s+const\s+shell\s*=\s*(?:"([^"\\]*)"|'([^'\\]*)')\s*;?\s*(?:\/\/.*)?$/;

/**
 * 帧文件的帧级 shell：顶层一行 `export const shell = "comp";`，值只认字面量字符串
 * （与 <Canvas shell> 同一条规则）。只读文本，不执行帧；顶层的判定与编译器 lint
 * 同一套（按行扫 + {} () [] 深度）。
 * → undefined（没写）| { value, line } | { error, line }（line 是帧文件里的行号）。
 */
export function readFrameShell(text) {
  const lines = String(text || '').split('\n');
  let depth = 0;
  let found;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (depth === 0 && FRAME_SHELL_DECL.test(trimmed)) {
      if (found) return { error: '写了不止一个 shell 导出', line: i + 1 };
      const m = trimmed.match(FRAME_SHELL_LITERAL);
      found = m
        ? { value: m[1] ?? m[2], line: i + 1 }
        : { error: 'shell 必须写成一行 export const shell = "…"（字面量字符串）', line: i + 1 };
    }
    for (const ch of lines[i]) {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
  }
  return found;
}

/**
 * 读盘的 frameSource / frameShell / rootFrame / figureExists：
 * - 帧 = 文章目录下的 `<帧 id>.jsx` 或 `<帧 id>.html`（HTML 帧，docs/projects.md“HTML 帧”）；
 * - rootFrame(src) 答 `{ id, src }` 写法的 HTML 帧：src 相对 project 根，或 `<source 名>:<路径>` 相对
 *   project.json 登记的 source 目录（sources = { 名: 绝对目录 }）；解析后（含 symlink）必须仍在那个目录下，
 *   且是一个文件；
 * - 图 = figures/<图 id>.jsx。
 * projectRoot 缺省是文章目录往上四层（<根>/docs/pinpoint/articles/<文章>）。
 */
export function frameFileReaders(articleDir, { projectRoot = path.resolve(articleDir, '..', '..', '..', '..'), sources = {} } = {}) {
  const isFile = (file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  const jsx = (frame) => path.join(articleDir, `${frame}.jsx`);
  const html = (frame) => path.join(articleDir, `${frame}.html`);
  return {
    figureExists: (figure) => isFile(path.join(articleDir, FIGURE_DIR, `${figure}.jsx`)),
    frameSource: (frame) => {
      const found = [];
      if (isFile(jsx(frame))) found.push({ kind: 'jsx', file: jsx(frame) });
      if (isFile(html(frame))) found.push({ kind: 'html', file: html(frame) });
      if (!found.length) return null;
      return found.length > 1 ? { ...found[0], both: true } : found[0];
    },
    frameShell: (frame) => {
      let text;
      try {
        text = fs.readFileSync(jsx(frame), 'utf8');
      } catch {
        return undefined;
      }
      return readFrameShell(text);
    },
    rootFrame: (src) => resolveRootFrame(projectRoot, src, sources),
  };
}

/**
 * `{ id, src }` 写法的 HTML 帧文件：→ { file, base } | { error, missing? }。base 是这一帧所在的可服务目录
 * （project 根或那个 source 目录）。src 是相对 project 根的路径，或 `<source 名>:<路径>`（相对 sources[名]）；
 * 路径不能以 / 开头，不能有 `..`、`.` 开头的段（隐藏文件）、反斜杠，要以 .html / .htm 结尾；解析后的真实路径
 * （跟 symlink）必须在 base 的真实路径下。
 */
export function resolveRootFrame(projectRoot, src, sources = {}) {
  const value = String(src || '');
  const { source, path: rel } = parseFrameSrc(value);
  const segments = rel.split('/');
  if (!HTML_FRAME_SRC_PATTERN.test(rel) || rel.includes('\\') || rel.includes('\0')
    || segments.some((seg) => !seg || seg === '..' || seg.startsWith('.'))) {
    return { error: `src 要写成相对 project 根的 HTML 文件路径（"skill/preview.html"），或 "<source 名>:<路径>"（"skill:preview.html"，source 在 project.json 的 sources 里登记）；路径不能以 / 开头，不能有 ..、隐藏目录，以 .html 结尾：${JSON.stringify(value)}` };
  }
  if (source && !Object.prototype.hasOwnProperty.call(sources || {}, source)) {
    const known = Object.keys(sources || {});
    return { error: `src ${JSON.stringify(value)} 用的 source "${source}" 没有在 project.json 的 sources 里登记（已登记：${known.length ? known.join('、') : '无'}）` };
  }
  const where = source ? `source ${source}` : 'project 根';
  const root = path.resolve(source ? sources[source] : projectRoot);
  const abs = path.resolve(root, ...segments);
  let realRoot;
  let real;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return { error: `${where}不存在：${root}`, missing: true };
  }
  try {
    real = fs.realpathSync(abs);
  } catch {
    return { error: `src 指的文件不存在：${value}（${where} ${root}）`, missing: true };
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    return { error: `src 指到了${where}外面：${value}（实际是 ${real}，${where} ${realRoot}）` };
  }
  try {
    if (!fs.statSync(real).isFile()) return { error: `src 不是一个文件：${value}`, missing: true };
  } catch {
    return { error: `src 指的文件不存在：${value}`, missing: true };
  }
  return { file: abs, base: root };
}

/** 字符串属性：undefined = 没写；{ value } = 字面量；{ error } = 别的写法。 */
function literalString(node, name) {
  const attr = literalAttribute(node, name);
  if (!attr || 'value' in attr) return attr;
  return { error: `${name} 必须是字面量字符串（写成 ${name}="…"）` };
}

/** 对象写法 `{ id: "…", src: "…" }` 的属性：只认 id、src 两个键，值都是字面量字符串。→ { id, src } 或 { error }。 */
function literalFrameObject(expression) {
  const out = {};
  for (const prop of expression.properties) {
    const key = prop.type === 'Property' && !prop.computed && prop.key
      ? (prop.key.type === 'Identifier' ? prop.key.name : prop.key.value)
      : null;
    if (key !== 'id' && key !== 'src') return { error: 'frames 里的对象只写 id 和 src 两项（写成 { id: "帧 id", src: "相对 project 根的路径.html" }）' };
    if (!prop.value || prop.value.type !== 'Literal' || typeof prop.value.value !== 'string') {
      return { error: `frames 里对象的 ${key} 必须是字面量字符串` };
    }
    out[key] = prop.value.value;
  }
  if (typeof out.id !== 'string' || typeof out.src !== 'string') return { error: 'frames 里的对象要同时写 id 和 src（{ id: "帧 id", src: "相对 project 根的路径.html" }）' };
  return out;
}

/**
 * frames={[...]} → { frames: [{ id, src? }] } 或 { error }。只认字面量数组；每一项是字面量字符串（"帧 id"，
 * 本篇目录下的帧），或 `{ id, src }`（project 根下的 HTML 帧，docs/projects.md“HTML 帧”）。
 */
function literalFrames(node) {
  const attr = jsxAttribute(node, 'frames');
  if (!attr) return { error: '缺 frames（写成 frames={["帧 id", …]}）' };
  const program = attr.value && attr.value.data && attr.value.data.estree;
  const statement = program && program.body && program.body.length === 1 ? program.body[0] : null;
  const expression = statement && statement.type === 'ExpressionStatement' ? statement.expression : null;
  if (!expression || expression.type !== 'ArrayExpression') {
    return { error: 'frames 必须是字面量数组（写成 frames={["帧 id", …]}），不能是变量或表达式' };
  }
  const frames = [];
  for (const element of expression.elements) {
    if (element && element.type === 'ObjectExpression') {
      const item = literalFrameObject(element);
      if (item.error) return item;
      frames.push(item);
      continue;
    }
    if (!element || element.type !== 'Literal' || typeof element.value !== 'string') {
      return { error: 'frames 的每一项必须是字面量字符串（"帧 id"），或 { id: "帧 id", src: "相对 project 根的路径.html" }' };
    }
    frames.push({ id: element.value });
  }
  return { frames };
}

/**
 * 整份 index.mdx（含 frontmatter）→ { tree, lineOffset } 或 { error, lineOffset }。
 * lineOffset = body 前面有几行 frontmatter：节点的行号加上它对到整份文件。
 */
function parseBody(text) {
  const fm = parseFrontmatter(text);
  const source = String(text || '').replace(/^﻿/, '');
  const lineOffset = fm.body === source ? 0 : source.slice(0, source.length - fm.body.length).split('\n').length - 1;
  try {
    return { tree: processor.parse(fm.body), lineOffset };
  } catch (error) {
    return { error, lineOffset };
  }
}

/**
 * 正文里每个 <Section> 占的行（整份文件的行号，1 起）：[{ id, startLine, endLine }]，按正文顺序；
 * id 只取字面量（写成表达式的节没有 id）。MDX 解析不了时是 []。ann-query 用它判断引文落在哪一节。
 */
export function articleSectionSpans(text) {
  const { tree, lineOffset } = parseBody(text);
  if (!tree) return [];
  const spans = [];
  for (const item of articleStructure(tree)) {
    const position = item.kind === 'section' && item.node.position;
    const id = item.kind === 'section' ? literalAttribute(item.node, 'id') : undefined;
    if (!position || !id || !('value' in id)) continue;
    spans.push({ id: id.value, startLine: position.start.line + lineOffset, endLine: position.end.line + lineOffset });
  }
  return spans;
}

/**
 * 正文的全部节，宽松读（`ppnt show` 列节、`ppnt check` 找全部帧用）：
 *   articleOutline(text) → [{ n, letter, id, title, line, frames: [帧 id…], sources?, canvas }]
 * sources = { 帧 id: src }，只含写成 `{ id, src }` 的帧（project 根下的 HTML 帧，src 相对 project 根）。
 * n 是文章页的节号（1 起），letter 是画布编号的节字母，两者按同一顺序数（纯文字的节也占）。
 * 和 parseArticleCanvas 不同，这里不因写法错误丢掉节：shell 写错、帧 id 不合法的节照样列出它
 * 字面上写的帧（frames 只收字面量字符串），所以被布局错误挡在画布外的帧也能拿去编译。
 * id / title 不是字面量时是 null；canvas = 这一节有没有 <Canvas>。MDX 解析不了时是 []。
 */
export function articleOutline(text) {
  const { tree, lineOffset } = parseBody(text);
  if (!tree) return [];
  const rows = [];
  for (const item of articleStructure(tree)) {
    if (item.kind !== 'section') continue;
    const id = literalAttribute(item.node, 'id');
    const title = literalAttribute(item.node, 'title');
    const frames = [];
    const sources = {};
    for (const canvas of item.canvases) {
      const listed = literalFrames(canvas);
      for (const frame of listed.frames || []) {
        if (frames.includes(frame.id)) continue;
        frames.push(frame.id);
        if (frame.src !== undefined) sources[frame.id] = frame.src;
      }
    }
    const idValue = id && 'value' in id ? id.value : null;
    rows.push({
      n: item.index + 1,
      letter: item.letter,
      id: idValue,
      title: title && 'value' in title ? title.value : idValue,
      line: item.node.position ? item.node.position.start.line + lineOffset : null,
      frames,
      ...(Object.keys(sources).length ? { sources } : {}),
      canvas: item.canvases.length > 0,
    });
  }
  return rows;
}

/** 正文 → 画布结构。text 是整份 index.mdx（含 frontmatter）。 */
export function parseArticleCanvas(text, {
  frameExists = () => true,
  frameSource = (frame) => (frameExists(frame) ? { kind: 'jsx' } : null),
  frameShell = () => undefined,
  rootFrame = () => ({ file: '' }),
  figureExists = () => true,
} = {}) {
  const errors = [];
  const parsed = parseBody(text);
  const { lineOffset } = parsed;
  const lineOf = (node) => (node && node.position ? node.position.start.line + lineOffset : null);
  const at = (node) => (lineOf(node) ? `第 ${lineOf(node)} 行` : '');
  // 错误对象：message 自带行号前缀（显示时原样用）；line、section、frame 给卡片定位。
  const report = (code, node, message, extra = {}) => {
    const line = lineOf(node);
    errors.push({ code, message, ...(line ? { line } : {}), ...extra });
  };
  const { tree } = parsed;
  if (!tree) {
    const { error } = parsed;
    const line = error && error.line ? `第 ${error.line + lineOffset} 行：` : '';
    return {
      sections: [],
      figures: [],
      errors: [{ code: 'mdx_parse', message: `MDX 解析失败，画布读不出来：${line}${(error && (error.reason || error.message)) || error}`, ...(error && error.line ? { line: error.line + lineOffset } : {}) }],
    };
  }

  const sections = [];
  const seenSections = new Set();
  const seenFrames = new Map(); // 帧 id → 第一次出现的节 id

  // 节怎么数、字母怎么编在 src/shared/article-structure.js（站点的 remark 步骤用同一个）。
  const handleSection = ({ node, letter: articleLetter, canvases, nested }) => {
    const id = literalString(node, 'id');
    if (!id || id.error || !SECTION_ID.test(id.value)) {
      report('section_id', node, `${at(node)}：<Section> 需要字面量 id，且匹配 ${SECTION_ID}`);
      return;
    }
    if (seenSections.has(id.value)) {
      report('section_duplicate', node, `${at(node)}：重复的 <Section id="${id.value}">（节 id 在一篇文章里唯一）`);
      return;
    }
    seenSections.add(id.value);
    const title = literalString(node, 'title');
    if (title && title.error) report('section_title', node, `${at(node)}：<Section id="${id.value}"> 的 ${title.error}`, { section: id.value });
    for (const child of nested) report('section_nested', child, `${at(child)}：<Section> 不能套在另一个 <Section> 里`);
    if (!canvases.length) return;
    if (canvases.length > 1) {
      report('canvas_multiple', canvases[1], `${at(canvases[1])}：<Section id="${id.value}"> 里有 ${canvases.length} 个 <Canvas>，一节最多一个（只用第一个）`, { section: id.value });
    }
    const canvas = canvases[0];
    const where = `${at(canvas)}：<Section id="${id.value}"> 的 <Canvas>`;
    const shell = literalString(canvas, 'shell');
    if (shell && shell.error) {
      report('canvas_shell', canvas, `${where} ${shell.error}`, { section: id.value });
      return;
    }
    if (shell && !CANVAS_SHELLS.includes(shell.value)) {
      report('canvas_shell', canvas, `${where} shell 只能是 ${CANVAS_SHELLS.join(' / ')}：${JSON.stringify(shell.value)}`, { section: id.value });
      return;
    }
    const parsed = literalFrames(canvas);
    if (parsed.error) {
      report('canvas_frames', canvas, `${where} ${parsed.error}`, { section: id.value });
      return;
    }
    const frames = [];
    const frameShells = {};
    const frameSrc = {};
    for (const item of parsed.frames) {
      const frame = item.id;
      if (item.src === undefined && frame.includes('/')) {
        report('frame_cross_page', canvas, `${where} 引用了别的页的帧 "${frame}"：不支持跨页引用，先把帧迁进本篇目录（articles/<文章>/<帧 id>.jsx），再写 "${frame.slice(frame.lastIndexOf('/') + 1)}"`, { section: id.value, frame });
        continue;
      }
      if (!FRAME_ID.test(frame)) {
        report('frame_id', canvas, `${where} 帧 id 不合法 "${frame}"（必须匹配 ${FRAME_ID}，即本篇目录下 <帧 id>.jsx 或 <帧 id>.html 的文件名）`, { section: id.value, frame });
        continue;
      }
      if (seenFrames.has(frame)) {
        report('frame_duplicate', canvas, `${where} 帧 "${frame}" 已经在 <Section id="${seenFrames.get(frame)}"> 里用过（一帧在画布上只出现一次）`, { section: id.value, frame });
        continue;
      }
      seenFrames.set(frame, id.value);
      // HTML 帧（本篇目录下的 <帧 id>.html，或 project 根下的 { id, src }）缺省是整份文档：没写 <Canvas shell> 时用 doc。
      const htmlShell = () => {
        if (!shell) frameShells[frame] = 'doc';
      };
      if (item.src !== undefined) {
        const local = frameSource(frame);
        if (local) {
          report('frame_source', canvas, `${where} 帧 id "${frame}" 和本篇目录下的 ${frame}.${local.kind} 重名（帧 id 在一篇文章里唯一，换一个 id）`, { section: id.value, frame });
          continue;
        }
        const found = rootFrame(item.src);
        if (found.error) {
          report(found.missing ? 'frame_missing' : 'frame_src', canvas, `${where} 帧 "${frame}" 的 ${found.error}`, { section: id.value, frame });
          if (!found.missing) continue;
        }
        frameSrc[frame] = item.src;
        htmlShell();
        frames.push(frame);
        continue;
      }
      const source = frameSource(frame);
      if (!source) {
        report('frame_missing', canvas, `${where} 帧 "${frame}" 没有源文件（本篇目录下缺 ${frame}.jsx 或 ${frame}.html）`, { section: id.value, frame });
      } else if (source.both) {
        report('frame_source', canvas, `${where} 帧 "${frame}" 同时有 ${frame}.jsx 和 ${frame}.html（留一个；现在用的是 ${frame}.jsx）`, { section: id.value, frame });
      }
      if (source && source.kind === 'html' && !source.both) {
        htmlShell();
      } else if (source) {
        // 帧级 shell：写坏了照样进画布（用这一节的 shell），错误带节和帧。
        const own = frameShell(frame);
        const inFile = own && own.line ? `（${frame}.jsx 第 ${own.line} 行）` : '';
        if (own && own.error) {
          report('frame_shell', canvas, `${where} 帧 "${frame}" 的 ${own.error}${inFile}`, { section: id.value, frame });
        } else if (own && !CANVAS_SHELLS.includes(own.value)) {
          report('frame_shell', canvas, `${where} 帧 "${frame}" 的 shell 只能是 ${CANVAS_SHELLS.join(' / ')}：${JSON.stringify(own.value)}${inFile}`, { section: id.value, frame });
        } else if (own) {
          frameShells[frame] = own.value;
        }
      }
      frames.push(frame);
    }
    if (!frames.length) {
      if (!parsed.frames.length) report('canvas_empty', canvas, `${where} 没有帧（frames 是空数组）`, { section: id.value });
      return;
    }
    const section = { id: id.value, title: (title && title.value) || id.value, articleLetter, frames };
    if (shell) section.shell = shell.value;
    if (Object.keys(frameShells).length) section.frameShells = frameShells;
    if (Object.keys(frameSrc).length) section.frameSrc = frameSrc;
    sections.push(section);
  };

  for (const item of articleStructure(tree)) {
    if (item.kind === 'stray-canvas') report('canvas_outside_section', item.node, `${at(item.node)}：<Canvas> 必须写在 <Section> 里（画布按节排开）`);
    else handleSection(item);
  }
  const figures = parseFigures(tree, { at, lineOf, report, figureExists });
  return { sections, figures, errors };
}

/** <Figure> 的写法检查。→ figures（每个 <Figure> 一项，见文件头）；错误经 report 记下。 */
function parseFigures(tree, { at, lineOf, report, figureExists }) {
  const figures = [];
  const seen = new Map(); // 图 id → 第一次出现的行
  for (const { node, index, section: sectionNode } of articleFigures(tree)) {
    const sectionId = sectionNode ? literalAttribute(sectionNode, 'id') : undefined;
    const section = sectionId && 'value' in sectionId && SECTION_ID.test(sectionId.value) ? sectionId.value : null;
    const line = lineOf(node);
    const figure = { index, ...(line ? { line } : {}), ...(section ? { section } : {}) };
    figures.push(figure);
    const where = `${at(node)}：<Figure>`;
    const extra = (more = {}) => ({ ...(section ? { section } : {}), ...more });
    for (const attr of node.attributes || []) {
      if (attr.type !== 'mdxJsxAttribute') {
        report('figure_prop', node, `${where} 不能用展开属性（{...x}），只写 src 和 caption`, extra());
      } else if (!FIGURE_PROPS.has(attr.name)) {
        report('figure_prop', node, `${where} 不认识属性 ${attr.name}（只有 src 和 caption）`, extra());
      }
    }
    const caption = literalString(node, 'caption');
    if (caption && caption.error) report('figure_caption', node, `${where} 的 ${caption.error}`, extra());
    else if (caption) figure.caption = caption.value;
    const src = literalString(node, 'src');
    if (!src) {
      report('figure_src', node, `${where} 缺 src（写成 src="figures/<图 id>.jsx"）`, extra());
      continue;
    }
    if (src.error) {
      report('figure_src', node, `${where} 的 ${src.error}`, extra());
      continue;
    }
    const match = src.value.match(FIGURE_SRC_PATTERN);
    if (!match) {
      report('figure_src', node, `${where} 的 src 只能写成 "figures/<图 id>.jsx"（图 id 匹配 ${FRAME_ID}）：${JSON.stringify(src.value)}`, extra());
      continue;
    }
    const id = match[1];
    if (seen.has(id)) {
      report('figure_duplicate', node, `${where} 图 "${id}" 在第 ${seen.get(id)} 行已经用过（一个图在一篇文章里只放一次）`, extra({ figure: id }));
      continue;
    }
    seen.set(id, line);
    figure.id = id;
    if (!figureExists(id)) report('figure_missing', node, `${where} 图 "${id}" 没有源文件（文章目录下缺 ${FIGURE_DIR}/${id}.jsx）`, extra({ figure: id }));
  }
  return figures;
}
