/**
 * Stand-in for package E's `articleCanvas` / `articlePageId`
 * (src/server/lib/projects.js, common-m1.md §2). Only canvas-source.js imports
 * this file; when E lands, canvas-source.js switches its import and this file
 * goes away.
 *
 * Same return shape as E's contract, derived from what the site already sees in
 * the MDX: each <Section id title> in order (letter A, B … over all sections,
 * the same letters as the article headings), and its one
 * <Canvas frames={["<frame>", …]} shell?="…" />. Only sections with a Canvas
 * are listed. Errors carry the section id so the card can show them:
 *   - a frame written as "<page>/<screen>" (cross-page ref, not supported);
 *   - a frame with no <frame>.jsx in the article directory;
 *   - a second <Canvas> in one Section (a Canvas outside any Section is
 *     reported by the card itself);
 *   - `frames` / `shell` that are not literals.
 * The page id rule here is a placeholder; E owns the real one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createProcessor } from '@mdx-js/mdx';
import { loadProjects } from './projects-source.js';
import { sectionLetter } from './refs.js';

const FRAME_ID = /^[a-zA-Z0-9_-]+$/;

export function articlePageId(projectId, articleId) {
  return `${projectId}--${articleId}`;
}

const isJsx = (n) => n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement';
const attrOf = (node, name) => (node.attributes || []).find((a) => a.type === 'mdxJsxAttribute' && a.name === name);

/** `frames={["a", "b"]}` → ['a', 'b']; anything but an array of string literals → null. */
function literalStrings(attr) {
  const expr = attr?.value?.data?.estree?.body?.[0]?.expression;
  if (!expr || expr.type !== 'ArrayExpression') return null;
  const out = [];
  for (const el of expr.elements) {
    if (!el || el.type !== 'Literal' || typeof el.value !== 'string') return null;
    out.push(el.value);
  }
  return out;
}

/** Pure part: MDX source + article dir → { sections, errors }. */
export function canvasFromMdx(source, articleDir) {
  const tree = createProcessor().parse(source);
  const sections = [];
  const errors = [];
  let index = 0;
  const visit = (node, current) => {
    for (const child of node.children || []) {
      let here = current;
      if (isJsx(child) && child.name === 'Section') {
        const id = attrOf(child, 'id')?.value;
        const title = attrOf(child, 'title')?.value;
        here = { id, title: typeof title === 'string' && title ? title : id, letter: sectionLetter(index++), canvases: 0 };
      } else if (isJsx(child) && child.name === 'Canvas') {
        // Outside any Section the card itself says so (cardModel); no row here.
        if (current && ++current.canvases > 1) {
          errors.push({ section: current.id, message: `<Section id="${current.id}"> 里只能有一个 <Canvas>` });
        } else if (current) {
          const shellAttr = attrOf(child, 'shell');
          const shell = shellAttr && typeof shellAttr.value === 'string' ? shellAttr.value : undefined;
          if (shellAttr && shell === undefined) errors.push({ section: current.id, message: '<Canvas shell> 要写成字面字符串' });
          const ids = literalStrings(attrOf(child, 'frames'));
          if (!ids) errors.push({ section: current.id, message: '<Canvas frames> 要写成字符串数组，例如 frames={["ask", "confirm"]}' });
          const frames = [];
          for (const id of ids || []) {
            if (id.includes('/')) {
              errors.push({ section: current.id, frame: id, message: `帧 "${id}" 引用了别的页；先把帧迁进本篇目录` });
            } else if (!FRAME_ID.test(id) || !fs.existsSync(path.join(articleDir, `${id}.jsx`))) {
              errors.push({ section: current.id, frame: id, message: `找不到帧 "${id}"：本篇目录下没有 ${id}.jsx` });
            } else {
              frames.push({ id, ref: `${current.letter}${frames.length + 1}` });
            }
          }
          sections.push({ id: current.id, title: current.title, letter: current.letter, ...(shell ? { shell } : {}), frames });
        }
      }
      visit(child, here);
    }
  };
  visit(tree, null);
  return { sections, errors };
}

export async function articleCanvas(projectId, articleId) {
  const { projects } = await loadProjects();
  const article = projects.find((p) => p.id === projectId)?.articles.find((a) => a.id === articleId);
  if (!article) return { pageId: articlePageId(projectId, articleId), sections: [], errors: [{ section: null, message: `没有文章 ${projectId}/${articleId}` }] };
  const source = fs.readFileSync(article.file, 'utf8');
  return { pageId: articlePageId(projectId, articleId), ...canvasFromMdx(source, path.dirname(article.file)) };
}
