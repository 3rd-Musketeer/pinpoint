/**
 * pp3 M1：从文章正文（index.mdx）读出画布结构（docs/projects.md「文章的画布」）。
 *
 * 只解析不渲染：用站点同一套 MDX 解析（unified + remark-parse + remark-mdx，
 * @astrojs/mdx 也是它），读顶层的 <Section id title> 和节里的
 * <Canvas frames={["帧 id", …]} shell="…" />。frames 只认字面量数组、元素只认字面量
 * 字符串；shell 只认字面量字符串。其他写法都是错误，不猜。
 *
 * 纯函数（帧文件存不存在由调用方的 frameExists 回答）：
 *   parseArticleCanvas(text, { frameExists }) → { sections, errors }
 *   sections = [{ id, title, articleLetter, shell?, frames: [帧 id…] }]，按正文顺序，
 *   只含有 Canvas 且至少一帧可用的节。errors = [{ message, line?, section?, frame? }]：
 *   message 以“第 N 行：”开头；属于某一节的带 section（节 id），属于某一帧的再带 frame。
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

import { sectionLetter } from '../../workbench/lib/board-refs.js';
import { parseFrontmatter } from './projects.js';

// 与站点 remark-pinpoint 的 Section id 规则一致；帧 id 与 screen id 契约一致。
const SECTION_ID = /^[a-zA-Z0-9_-]+$/;
const FRAME_ID = /^[a-zA-Z0-9_-]+$/;
// board 的 shell 取值（docs/board-schema.md）。
export const CANVAS_SHELLS = Object.freeze(['app', 'lock', 'doc', 'comp']);

const processor = unified().use(remarkParse).use(remarkMdx);

function isJsx(node, name) {
  return node && (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === name;
}

function attrOf(node, name) {
  return (node.attributes || []).find((a) => a.type === 'mdxJsxAttribute' && a.name === name);
}

/** 字符串属性：undefined = 没写；{ value } = 字面量；{ error } = 别的写法。 */
function literalString(node, name) {
  const attr = attrOf(node, name);
  if (!attr) return undefined;
  if (typeof attr.value === 'string') return { value: attr.value };
  return { error: `${name} 必须是字面量字符串（写成 ${name}="…"）` };
}

/** frames={[...]} → { frames } 或 { error }。只认字面量数组 + 字面量字符串。 */
function literalFrames(node) {
  const attr = attrOf(node, 'frames');
  if (!attr) return { error: '缺 frames（写成 frames={["帧 id", …]}）' };
  const program = attr.value && attr.value.data && attr.value.data.estree;
  const statement = program && program.body && program.body.length === 1 ? program.body[0] : null;
  const expression = statement && statement.type === 'ExpressionStatement' ? statement.expression : null;
  if (!expression || expression.type !== 'ArrayExpression') {
    return { error: 'frames 必须是字面量数组（写成 frames={["帧 id", …]}），不能是变量或表达式' };
  }
  const frames = [];
  for (const element of expression.elements) {
    if (!element || element.type !== 'Literal' || typeof element.value !== 'string') {
      return { error: 'frames 的每一项必须是字面量字符串（"帧 id"）' };
    }
    frames.push(element.value);
  }
  return { frames };
}

function* childrenDeep(node) {
  for (const child of node.children || []) {
    yield child;
    yield* childrenDeep(child);
  }
}

/** 正文 → 画布结构。text 是整份 index.mdx（含 frontmatter）。 */
export function parseArticleCanvas(text, { frameExists = () => true } = {}) {
  const errors = [];
  const fm = parseFrontmatter(text);
  // body 前面有几行 frontmatter：报错的行号对到整份文件。
  const source = String(text || '').replace(/^﻿/, '');
  const lineOffset = fm.body === source ? 0 : source.slice(0, source.length - fm.body.length).split('\n').length - 1;
  const lineOf = (node) => (node && node.position ? node.position.start.line + lineOffset : null);
  const at = (node) => (lineOf(node) ? `第 ${lineOf(node)} 行` : '');
  // 错误对象：message 自带行号前缀（listProjects 原样当字符串用）；line、section、frame 给卡片定位。
  const report = (node, message, extra = {}) => {
    const line = lineOf(node);
    errors.push({ message, ...(line ? { line } : {}), ...extra });
  };
  let tree;
  try {
    tree = processor.parse(fm.body);
  } catch (error) {
    const line = error && error.line ? `第 ${error.line + lineOffset} 行：` : '';
    return {
      sections: [],
      errors: [{ message: `MDX 解析失败，画布读不出来：${line}${(error && (error.reason || error.message)) || error}`, ...(error && error.line ? { line: error.line + lineOffset } : {}) }],
    };
  }

  const sections = [];
  const seenSections = new Set();
  const seenFrames = new Map(); // 帧 id → 第一次出现的节 id
  let sectionIndex = 0;

  const visit = (node, inSection) => {
    for (const child of node.children || []) {
      if (isJsx(child, 'Section')) {
        if (inSection) {
          report(child, `${at(child)}：<Section> 不能套在另一个 <Section> 里`);
          continue;
        }
        handleSection(child);
        continue;
      }
      if (isJsx(child, 'Canvas')) {
        report(child, `${at(child)}：<Canvas> 必须写在 <Section> 里（画布按节排开）`);
        continue;
      }
      visit(child, inSection);
    }
  };

  const handleSection = (node) => {
    const articleLetter = sectionLetter(sectionIndex);
    sectionIndex += 1;
    const id = literalString(node, 'id');
    if (!id || id.error || !SECTION_ID.test(id.value)) {
      report(node, `${at(node)}：<Section> 需要字面量 id，且匹配 ${SECTION_ID}`);
      return;
    }
    if (seenSections.has(id.value)) {
      report(node, `${at(node)}：重复的 <Section id="${id.value}">（节 id 在一篇文章里唯一）`);
      return;
    }
    seenSections.add(id.value);
    const title = literalString(node, 'title');
    if (title && title.error) report(node, `${at(node)}：<Section id="${id.value}"> 的 ${title.error}`, { section: id.value });
    const canvases = [];
    for (const child of childrenDeep(node)) {
      if (isJsx(child, 'Section')) report(child, `${at(child)}：<Section> 不能套在另一个 <Section> 里`);
      else if (isJsx(child, 'Canvas')) canvases.push(child);
    }
    if (!canvases.length) return;
    if (canvases.length > 1) {
      report(canvases[1], `${at(canvases[1])}：<Section id="${id.value}"> 里有 ${canvases.length} 个 <Canvas>，一节最多一个（只用第一个）`, { section: id.value });
    }
    const canvas = canvases[0];
    const where = `${at(canvas)}：<Section id="${id.value}"> 的 <Canvas>`;
    const shell = literalString(canvas, 'shell');
    if (shell && shell.error) {
      report(canvas, `${where} ${shell.error}`, { section: id.value });
      return;
    }
    if (shell && !CANVAS_SHELLS.includes(shell.value)) {
      report(canvas, `${where} shell 只能是 ${CANVAS_SHELLS.join(' / ')}：${JSON.stringify(shell.value)}`, { section: id.value });
      return;
    }
    const parsed = literalFrames(canvas);
    if (parsed.error) {
      report(canvas, `${where} ${parsed.error}`, { section: id.value });
      return;
    }
    const frames = [];
    for (const frame of parsed.frames) {
      if (frame.includes('/')) {
        report(canvas, `${where} 引用了别的页的帧 "${frame}"：不支持跨页引用，先把帧迁进本篇目录（articles/<文章>/<帧 id>.jsx），再写 "${frame.slice(frame.lastIndexOf('/') + 1)}"`, { section: id.value, frame });
        continue;
      }
      if (!FRAME_ID.test(frame)) {
        report(canvas, `${where} 帧 id 不合法 "${frame}"（必须匹配 ${FRAME_ID}，即本篇目录下 <帧 id>.jsx 的文件名）`, { section: id.value, frame });
        continue;
      }
      if (seenFrames.has(frame)) {
        report(canvas, `${where} 帧 "${frame}" 已经在 <Section id="${seenFrames.get(frame)}"> 里用过（一帧在画布上只出现一次）`, { section: id.value, frame });
        continue;
      }
      seenFrames.set(frame, id.value);
      if (!frameExists(frame)) report(canvas, `${where} 帧 "${frame}" 没有源文件（本篇目录下缺 ${frame}.jsx）`, { section: id.value, frame });
      frames.push(frame);
    }
    if (!frames.length) {
      if (!parsed.frames.length) report(canvas, `${where} 没有帧（frames 是空数组）`, { section: id.value });
      return;
    }
    const section = { id: id.value, title: (title && title.value) || id.value, articleLetter, frames };
    if (shell) section.shell = shell.value;
    sections.push(section);
  };

  visit(tree, false);
  return { sections, errors };
}
