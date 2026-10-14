/**
 * remark pass for project content (articles .mdx, concepts .md):
 *
 * - `[[...]]` in text → <Ref raw from /> in MDX (resolved at render time, so a
 *   concept added later resolves without touching the article), or a
 *   placeholder span in .md that the concept page resolves (rawRefHtml).
 * - <Section id title> in MDX → gets `num` (1, 2 …) in document order;
 *   the list lands in frontmatter `sections` for the TOC. Missing / bad /
 *   duplicate ids and nested sections fail the build with the file path.
 * - <Canvas> inside a Section → gets `section="<that id>"` and that section's
 *   `num` (author-written values are replaced), so the card knows which canvas
 *   row it shows and which number to print. A Canvas outside any Section gets
 *   nothing; the card renders the error.
 * - <Figure> anywhere in the body → gets `n` (0, 1 …, every <Figure> in
 *   document order, broken ones too): the same index articleCanvas gives its
 *   `figures`, so the figure finds its source, caption and errors.
 *
 * The article shows numbers; the canvas, `ppnt` and annotation refs keep the
 * section letters (A1 is the canvas contract). Both come from the same walk
 * the service derives the canvas with (src/shared/article-structure.js):
 * section n here is letter sectionLetter(n - 1) there, so the TOC, the
 * headings and the cards cannot drift from the canvas rows.
 *
 * The current project id comes from <root>/docs/pinpoint/project.json above
 * the file, so the pass needs no registry.
 */
import fs from 'node:fs';
import path from 'node:path';
import { articleFigures, articleStructure, jsxAttribute } from '../../../src/shared/article-structure.js';
import { SECTION_ID_PATTERN as SECTION_ID } from '../../../src/shared/project-ids.js';
import { REF_RE, rawRefHtml } from './refs.js';

const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition', 'html', 'mdxJsxAttribute', 'mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm']);

const projectIdCache = new Map();
export function projectIdFor(file) {
  const parts = path.resolve(file).split(path.sep);
  for (let i = parts.length - 2; i > 0; i--) {
    if (parts[i] === 'pinpoint' && parts[i - 1] === 'docs') {
      const dir = parts.slice(0, i + 1).join(path.sep);
      if (!projectIdCache.has(dir)) {
        let id = null;
        try { id = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).id || null; } catch { /* not a project */ }
        projectIdCache.set(dir, id);
      }
      return projectIdCache.get(dir);
    }
  }
  return null;
}

function attr(node, name) {
  const a = jsxAttribute(node, name);
  if (!a) return undefined;
  return typeof a.value === 'string' ? a.value : null; // null = expression value
}

const setAttr = (node, name, value) => {
  node.attributes = (node.attributes || []).filter((a) => a.name !== name);
  if (value !== undefined) node.attributes.push({ type: 'mdxJsxAttribute', name, value });
};

/** <Section> numbers and the Canvas → section link (MDX only). → the TOC list. */
function markSections(tree, fail) {
  const sections = [];
  for (const item of articleStructure(tree)) {
    if (item.kind === 'stray-canvas') {
      setAttr(item.node, 'section', undefined);
      continue;
    }
    const id = attr(item.node, 'id');
    const title = attr(item.node, 'title');
    if (typeof id !== 'string' || !SECTION_ID.test(id)) fail(`<Section> needs a literal id matching ${SECTION_ID} (got ${JSON.stringify(id)})`);
    if (title === null) fail(`<Section id="${id}"> title must be a literal string`);
    if (sections.some((s) => s.id === id)) fail(`duplicate <Section id="${id}">`);
    if (item.nested.length) fail('<Section> cannot be nested inside another <Section>');
    const num = String(item.index + 1);
    sections.push({ id, title: title || id, num });
    setAttr(item.node, 'num', num);
    for (const canvas of item.canvases) {
      setAttr(canvas, 'section', id);
      setAttr(canvas, 'num', num);
    }
  }
  return sections;
}

function splitText(value, from, isMdx) {
  const out = [];
  let last = 0;
  for (const m of value.matchAll(REF_RE)) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    out.push(isMdx
      ? {
        type: 'mdxJsxTextElement',
        name: 'Ref',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'raw', value: m[1] },
          { type: 'mdxJsxAttribute', name: 'from', value: from || '' },
        ],
        children: [],
      }
      : { type: 'html', value: rawRefHtml(m[1], from || '') });
    last = m.index + m[0].length;
  }
  if (!out.length) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

export function remarkPinpoint() {
  return (tree, file) => {
    const filePath = file.path || file.history?.[0] || '';
    const isMdx = filePath.endsWith('.mdx');
    const from = filePath ? projectIdFor(filePath) : null;
    if (!from) return; // not project content: leave untouched
    const fail = (msg) => { throw new Error(`${filePath}: ${msg}`); };
    const sections = isMdx ? markSections(tree, fail) : [];
    if (isMdx) for (const figure of articleFigures(tree)) setAttr(figure.node, 'n', String(figure.index));

    // `[[ ]]` in text → <Ref> (MDX) or a placeholder span (.md).
    const walk = (node) => {
      if (!node.children) return;
      // Merge adjacent text nodes so a ref split by the parser is still seen.
      for (let i = node.children.length - 1; i > 0; i--) {
        const a = node.children[i - 1];
        const b = node.children[i];
        if (a.type === 'text' && b.type === 'text') { a.value += b.value; node.children.splice(i, 1); }
      }
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'text') {
          const parts = splitText(child.value, from, isMdx);
          if (parts) { node.children.splice(i, 1, ...parts); i += parts.length - 1; }
          continue;
        }
        if (SKIP.has(child.type)) continue;
        walk(child);
      }
    };
    walk(tree);

    if (isMdx) {
      file.data.astro ??= {};
      file.data.astro.frontmatter ??= {};
      file.data.astro.frontmatter.sections = sections;
    }
  };
}

export default remarkPinpoint;
