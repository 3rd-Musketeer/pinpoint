// 正文表格的外层：<table> 包进 <div class="pp-table-scroll">（站点 markdown 与 MDX 都过这一道，astro.config 的 rehypePlugins）。
// 外层让表格可以宽过正文行宽、放不下时横向滚动（site.css“表格”）；整列都是数字的列给 th / td 加 class="num"，右对齐。
// 不依赖 unist-util-visit：hast 是普通对象树，递归走一遍。

const NUMERIC = /^[-+−]?[\d,.]+\s*(%|ms|s|px|k|K|M|×|x|倍|个|次|条|字|元|万)?$/;

function text(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  return (node.children || []).map(text).join('');
}

const elements = (node, tag) => (node.children || []).filter((c) => c.type === 'element' && (!tag || c.tagName === tag));

function rows(table) {
  const out = [];
  for (const part of elements(table)) {
    if (part.tagName === 'tr') out.push(part);
    else if (['thead', 'tbody', 'tfoot'].includes(part.tagName)) out.push(...elements(part, 'tr'));
  }
  return out;
}

function addClass(node, cls) {
  const props = node.properties || (node.properties = {});
  const cur = Array.isArray(props.className) ? props.className : props.className ? String(props.className).split(/\s+/) : [];
  if (!cur.includes(cls)) props.className = [...cur, cls];
}

/** 整列（表体里非空的格）都是数字的列号。 */
export function numericColumns(table) {
  const body = rows(table).filter((tr) => elements(tr, 'td').length);
  const cols = new Map();
  for (const tr of body) {
    elements(tr).forEach((cell, i) => {
      const t = text(cell).trim();
      if (!t) return;
      const ok = NUMERIC.test(t);
      cols.set(i, (cols.get(i) ?? true) && ok);
    });
  }
  return [...cols].filter(([, ok]) => ok).map(([i]) => i);
}

function walk(node) {
  const kids = node.children || [];
  for (let i = 0; i < kids.length; i += 1) {
    const child = kids[i];
    // MDX 里表格常在 <Section> 这类 JSX 元素（mdxJsxFlowElement）里面：任何带 children 的节点都往下走。
    if (child.type === 'element' && child.tagName === 'table') {
      const nums = numericColumns(child);
      if (nums.length) for (const tr of rows(child)) elements(tr).forEach((cell, j) => { if (nums.includes(j)) addClass(cell, 'num'); });
      const parentIsWrap = node.type === 'element' && (node.properties?.className || []).includes?.('pp-table-scroll');
      if (!parentIsWrap) kids[i] = { type: 'element', tagName: 'div', properties: { className: ['pp-table-scroll'] }, children: [child] };
      continue;
    }
    if (child.children) walk(child);
  }
}

export function rehypeTableScroll() {
  return (tree) => { walk(tree); };
}
