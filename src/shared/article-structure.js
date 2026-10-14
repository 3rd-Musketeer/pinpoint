/**
 * 文章正文（index.mdx）的节与画布结构（docs/projects.md“画布视图”）：<Section> 与 <Canvas>
 * 在 mdast 里在哪、属于哪一节、第几节。只走树，不解析、不校验，各方自己报错：
 *
 * - 服务端的文章画布（src/server/lib/article-canvas.js）：派生 board、画布错误；
 * - 站点的 remark 步骤（src/shared/remark-pinpoint.js）：节标题的字母、给 Canvas 注入 section；
 * - ann-query：正文评论的引文落在哪一节（经 article-canvas.js 的 articleSectionSpans）。
 *
 * 三处用同一个走法，节怎么数、字母怎么编不会分叉。<Figure>（正文里的图）也在这里数：articleFigures
 * 给出全部 <Figure> 的正文顺序，服务端的解析和站点的 remark 步骤按同一个序号对上同一个图。树是 remark-parse + remark-mdx 的 mdast
 * （@astrojs/mdx 用的也是它），节点带 position。叶子模块：只 import 同为叶子的 project-ids.js。
 */
import { sectionLetter } from './project-ids.js';

export function isJsxElement(node, name) {
  return Boolean(node) && (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === name;
}

export function jsxAttribute(node, name) {
  return ((node && node.attributes) || []).find((a) => a.type === 'mdxJsxAttribute' && a.name === name);
}

/** 字符串属性：undefined = 没写；{ value } = 字面量；{ expression: attr } = 写成了 {…} 表达式。 */
export function literalAttribute(node, name) {
  const attr = jsxAttribute(node, name);
  if (!attr) return undefined;
  return typeof attr.value === 'string' ? { value: attr.value } : { expression: attr };
}

export function* descendants(node) {
  for (const child of (node && node.children) || []) {
    yield child;
    yield* descendants(child);
  }
}

/**
 * mdast → 按正文顺序的结构项：
 *   { kind: 'section', node, index, letter, canvases: [Canvas 节点…], nested: [套在里面的 Section 节点…] }
 *   { kind: 'stray-canvas', node }   写在任何 <Section> 外的 <Canvas>
 * index 是第几个 <Section>（0 起，所有 Section 一起数，纯文字的、写坏的也占），letter = sectionLetter(index)：
 * 正文节标题与画布编号同一个字母。一个 <Section> 里面的东西都归它（canvases、nested 按深度优先序），
 * 不再往里找下一节；套在里面的 Section 只列进 nested，不占序号。
 */
export function articleStructure(tree) {
  const items = [];
  let index = 0;
  const visit = (node) => {
    for (const child of (node && node.children) || []) {
      if (isJsxElement(child, 'Section')) {
        const canvases = [];
        const nested = [];
        for (const inner of descendants(child)) {
          if (isJsxElement(inner, 'Section')) nested.push(inner);
          else if (isJsxElement(inner, 'Canvas')) canvases.push(inner);
        }
        items.push({ kind: 'section', node: child, index, letter: sectionLetter(index), canvases, nested });
        index += 1;
        continue;
      }
      if (isJsxElement(child, 'Canvas')) {
        items.push({ kind: 'stray-canvas', node: child });
        continue;
      }
      visit(child);
    }
  };
  visit(tree);
  return items;
}

/**
 * 正文里全部 <Figure>，按正文顺序：[{ node, index, section }]。index 从 0 数，写坏的也占；
 * section 是它所在的 <Section> 节点（套着的取最外层，和 articleStructure 一致），写在节外的是 null。
 * 图可以写在节里，也可以写在节外（开头的导语）。
 */
export function articleFigures(tree) {
  const figures = [];
  const visit = (node, section) => {
    for (const child of (node && node.children) || []) {
      if (isJsxElement(child, 'Figure')) {
        figures.push({ node: child, index: figures.length, section });
        continue;
      }
      visit(child, section || (isJsxElement(child, 'Section') ? child : null));
    }
  };
  visit(tree, null);
  return figures;
}
