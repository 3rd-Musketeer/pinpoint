/**
 * code excerpt（决定 #19，实现从简）：标注锚点 → 源码元素摘录。
 *
 * 两条路：
 * - 编译页：dist HTML 里解析出锚点元素，读它的 data-pp-id="文件:行@k" → 打开
 *   源文件取「包含该行的最小完整 JSX 元素」（标签配平，找不准退化 ±3 行）。
 *   锚点落在组件（data-pp-comp，非帧根）内部时给两段：帧里的实例行 + 组件
 *   定义里的元素。
 * - 存量 HTML 页：锚点只有 cssPath —— dist HTML 里按链解析出元素，取它的
 *   outerHTML，行号指 dist 文件本身。
 *
 * 折叠规则（超预算时先折内部再砍兄弟）：主体超 15 行只留开标签 / 锚点行 /
 * 闭标签；前后各保留一个兄弟，折叠成开标签一行 + …；行号左缀，锚点行前加 >。
 * 预算约 300 token（4 字符 ≈ 1 token）。
 *
 * HTML 解析只服务 renderToString 产物与手写静态片段（属性带引号、标签配平），
 * 不做容错 HTML；配不上就安安静静摘不出，调用方降级。
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style']);

/**
 * 静态 HTML → 树。节点 = { tag, attrs, text, children, parent, start, end }
 * （start/end 为整元素在原文里的字符区间）。解析失败返回 null。
 */
export function parseHtmlFragment(html) {
  const text = String(html || '');
  const root = { tag: '#root', attrs: {}, text: '', children: [], parent: null, start: 0, end: text.length };
  const stack = [root];
  let i = 0;
  const fail = () => null;
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open < 0) break;
    if (stack[stack.length - 1] === root && open > i) {
      // 根层裸文本：忽略（片段应是单根或注释/样式行）
    }
    // <!-- comments -->
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open);
      if (close < 0) return fail();
      i = close + 3;
      continue;
    }
    // <!doctype …>
    if (text.startsWith('<!', open)) {
      const close = text.indexOf('>', open);
      if (close < 0) return fail();
      i = close + 1;
      continue;
    }
    const close = text.indexOf('>', open);
    if (close < 0) return fail();
    const inner = text.slice(open + 1, close);
    if (inner.startsWith('/')) {
      const tag = inner.slice(1).trim().toLowerCase();
      let index = stack.length - 1;
      while (index > 0 && stack[index].tag !== tag) index -= 1;
      if (index === 0) return fail(); // 闭标签没有对应的开标签
      stack[index].end = close + 1;
      stack.length = index;
      i = close + 1;
      continue;
    }
    const tagMatch = inner.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!tagMatch) return fail();
    const tag = tagMatch[1].toLowerCase();
    const selfClosing = inner.endsWith('/') || VOID_TAGS.has(tag);
    const attrs = {};
    for (const attr of inner.matchAll(/([a-zA-Z_:@][\w.:@-]*)\s*=\s*"([^"]*)"/g)) {
      attrs[attr[1]] = attr[2];
    }
    for (const attr of inner.matchAll(/\s([a-zA-Z_:@][\w.:@-]*)(?=[\s/]|$)/g)) {
      if (!(attr[1] in attrs)) attrs[attr[1]] = '';
    }
    const node = { tag, attrs, text: '', children: [], parent: stack[stack.length - 1], start: open, end: close + 1 };
    stack[stack.length - 1].children.push(node);
    if (selfClosing) {
      i = close + 1;
      continue;
    }
    if (RAW_TEXT_TAGS.has(tag)) {
      const rawClose = text.indexOf(`</${tag}`, close + 1);
      if (rawClose < 0) return fail();
      node.text = text.slice(close + 1, rawClose);
      const rawEnd = text.indexOf('>', rawClose);
      if (rawEnd < 0) return fail();
      node.end = rawEnd + 1;
      i = rawEnd + 1;
      continue;
    }
    stack.push(node);
    i = close + 1;
  }
  if (stack.length !== 1) return null; // 残缺标签
  if (!root.children.length) return null; // 裸文本 / 空：不是元素片段
  return root;
}

/** `tag.cls:nth-of-type(n)` 段解析（annotate.cssPath 的段形）。 */
function segmentMatcher(segment) {
  const m = String(segment).trim().match(/^(?:#([A-Za-z][\w-]*)|([a-z][a-z0-9-]*)(?:\.([\w-]+))?(?::nth-of-type\((\d+)\))?)$/);
  if (!m) return null;
  if (m[1]) return { id: m[1] };
  return { tag: m[2] || '*', cls: m[3] || null, nth: m[4] ? Number(m[4]) : 0 };
}

function nodeMatches(node, matcher) {
  if (!node || node.tag === '#root') return false;
  if (matcher.id) return node.attrs.id === matcher.id;
  if (matcher.tag && matcher.tag !== '*' && node.tag !== matcher.tag) return false;
  if (matcher.cls && node.attrs.class !== undefined) {
    const classes = String(node.attrs.class).split(/\s+/);
    if (!classes.includes(matcher.cls)) return false;
  } else if (matcher.cls) {
    return false;
  }
  return true;
}

/**
 * `a > b > c` 链（cssPath 的形态）在树里解析；支持中间任意位置出现 `*`（cssPath
 * 不产 *，防御）。段可带 :nth-of-type(n)。返回节点或 null。
 */
export function resolveSelectorChain(root, chain) {
  const segments = String(chain || '').split('>').map((part) => part.trim()).filter(Boolean);
  if (!segments.length) return null;
  const matchers = segments.map(segmentMatcher);
  if (matchers.some((matcher) => !matcher)) return null;
  // 链的第一段从根的孩子们开始；后续段从当前节点的孩子们走（cssPath 是纯子链）。
  let candidates = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (nodeMatches(child, matchers[0])) candidates.push(child);
      walk(child);
    }
  };
  walk(root);
  const descend = (node, depth) => {
    if (depth === matchers.length) return node;
    let nth = 0;
    for (const child of node.children) {
      if (nodeMatches(child, matchers[depth])) {
        nth += 1;
        if (matchers[depth].nth && matchers[depth].nth !== nth) continue;
        const hit = descend(child, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const candidate of candidates) {
    const hit = descend(candidate, 1);
    if (hit) return hit;
  }
  return null;
}

/** 节点的所有祖先（根方向，不含 #root）。 */
export function ancestorsOf(node) {
  const out = [];
  for (let cur = node && node.parent; cur && cur.tag !== '#root'; cur = cur.parent) out.push(cur);
  return out.reverse();
}

/* ---- JSX 源码摘录 ---- */

/**
 * 找「包含 anchorLine（1 基）的最小完整 JSX 元素」：逐字符扫标签记栈，取包住
 * 该行的最内层标签区间。配不准（找不到 / 区间可疑地长）退化成 ±3 行。
 * 返回 { startLine, endLine }（1 基闭区间）。
 */
export function jsxElementRange(source, anchorLine) {
  const text = String(source || '');
  const lines = text.split('\n');
  if (anchorLine < 1 || anchorLine > lines.length) return null;
  const stack = [];
  let offset = 0;
  const starts = [];
  const ends = [];
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    for (let ci = 0; ci < line.length; ci += 1) {
      const ch = line[ci];
      if (ch === '<') {
        const rest = line.slice(ci);
        const tag = rest.match(/^<([A-Za-z][\w.-]*)/);
        if (tag) {
          const closeAt = rest.indexOf('>');
          if (closeAt >= 0) {
            const inner = rest.slice(1, closeAt);
            if (inner.endsWith('/')) {
              starts.push(li + 1);
              ends.push(li + 1);
            } else {
              stack.push(li + 1);
            }
            ci += closeAt;
          }
        } else if (/^<\//.test(rest)) {
          const closeAt = rest.indexOf('>');
          if (closeAt >= 0) {
            const open = stack.pop();
            if (open !== undefined) {
              starts.push(open);
              ends.push(li + 1);
            }
            ci += closeAt;
          }
        }
      }
    }
    offset += line.length + 1;
  }
  let best = null;
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i] <= anchorLine && anchorLine <= ends[i]) {
      const span = ends[i] - starts[i];
      if (best === null || span < best.end - best.start) best = { start: starts[i], end: ends[i] };
    }
  }
  if (best && best.end - best.start <= 200) return best;
  // 退化：±3 行。
  return {
    start: Math.max(1, anchorLine - 3),
    end: Math.min(lines.length, anchorLine + 3),
  };
}

/** 一个源码区间折成行列表：超 maxLines 只留首行 / 锚点行 / 末行，中间 … 。 */
export function foldRange(lines, anchorLine, { start, end }, maxLines = 15) {
  const out = [];
  const push = (no) => out.push({ no, text: lines[no - 1], anchor: no === anchorLine });
  if (end - start + 1 <= maxLines) {
    for (let no = start; no <= end; no += 1) push(no);
    return out;
  }
  push(start);
  const gapTop = anchorLine - start > 1;
  if (gapTop) out.push({ no: 0, text: '…' });
  push(anchorLine);
  if (end - anchorLine > 1) out.push({ no: 0, text: '…' });
  push(end);
  return out;
}

/** 兄弟折叠：前后各一个兄弟的开标签一行（属性截断）+ …。 */
export function siblingHints(node, html) {
  const hints = [];
  if (!node || !node.parent) return hints;
  const siblings = node.parent.children.filter((child) => child.tag !== '#root');
  const index = siblings.indexOf(node);
  const openTagOf = (sibling) => {
    const slice = String(html).slice(sibling.start, sibling.end);
    const head = slice.slice(0, slice.indexOf('>') + 1);
    return head.length > 100 ? `${head.slice(0, 97)}…>` : head;
  };
  if (index > 0) hints.unshift({ where: 'before', text: openTagOf(siblings[index - 1]) });
  if (index >= 0 && index < siblings.length - 1) hints.push({ where: 'after', text: openTagOf(siblings[index + 1]) });
  return hints;
}

/** HTML outerHTML 折叠（存量页路径）：与 foldRange 同规则，行号指 dist 文件。 */
export function foldHtmlElement(node, html, anchorLine) {
  const text = String(html);
  const lineOf = (offset) => text.slice(0, offset).split('\n').length;
  const startLine = lineOf(node.start);
  const endLine = lineOf(node.end - 1);
  const lines = text.split('\n');
  const elementLines = [];
  for (let no = startLine; no <= endLine; no += 1) elementLines.push(lines[no - 1]);
  const folded = foldRange(elementLines, anchorLine - startLine + 1, { start: 1, end: elementLines.length }, 15);
  return folded.map((row) => ({ no: row.no ? row.no + startLine - 1 : 0, text: row.text, anchor: row.anchor }));
}

/** 渲染一段摘录：面包屑一行 + 各段（文件名一行 + 行号体，锚点行 > 前缀）。 */
export function renderExcerpt({ breadcrumb = '', segments }) {
  const out = [];
  if (breadcrumb) out.push(breadcrumb);
  for (const segment of segments) {
    if (segment.file) out.push(segment.file);
    for (const row of segment.lines) {
      const mark = row.anchor ? '>' : ' ';
      out.push(`${row.no ? String(row.no).padStart(4) : '    '}${mark} ${row.text}`);
    }
  }
  return out;
}
