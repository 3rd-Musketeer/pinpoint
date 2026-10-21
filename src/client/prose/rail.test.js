// C3：一次 placeCards 里多条已关闭、未展开的正文评论共用一份正文索引。
// 索引在排版函数返回后丢掉；下一次排版按当时的 DOM 重建。几何仍按这份索引的
// 引文位置排，不因少建索引而改 top。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const calls = { builds: 0, indexes: [] };
globalThis.__railTextIndexCalls = calls;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.endsWith('/prose/rail.js') && specifier === './text-index.js') {
      return { url: 'stub:prose/text-index.js', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'stub:prose/text-index.js') {
      return {
        format: 'module',
        source: `
          const c = globalThis.__railTextIndexCalls;
          export function buildTextIndex() {
            c.builds += 1;
            return c.indexes[c.builds - 1];
          }
          export function offsetsToSegments(start, end, index) {
            const hit = index.segments[start];
            return hit ? [hit] : [];
          }
        `,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

function parseFragment(html) {
  const root = { children: [], childNodes: [] };
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let match;
  while ((match = re.exec(html))) {
    const name = match[1];
    if (html[match.index + 1] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    const attrRe = /([\w:-]+)(?:="([^"]*)")?/g;
    let attr;
    while ((attr = attrRe.exec(match[2] || ''))) attrs[attr[1]] = attr[2] ?? '';
    const node = el(name, attrs);
    const parent = stack[stack.length - 1];
    node.parentElement = parent.nodeType ? parent : null;
    parent.childNodes.push(node);
    parent.children.push(node);
    if (!match[0].endsWith('/>')) stack.push(node);
  }
  return root.children;
}

function el(tag, attrs, children) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    style: {},
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    offsetHeight: 28,
    childNodes: [],
    children: [],
    parentElement: null,
    isConnected: true,
    attributes: {},
    className: '',
  };
  node.setAttribute = (name, value) => { node.attributes[name] = String(value); };
  node.getAttribute = name => (Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null);
  node.appendChild = child => {
    child.parentElement = node;
    node.childNodes.push(child);
    if (child.nodeType === 1) node.children.push(child);
    return child;
  };
  node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
  node.querySelectorAll = selector => {
    const out = [];
    function walk(current) {
      for (const child of current.children) {
        if (matches(child, selector)) out.push(child);
        walk(child);
      }
    }
    // :scope > .pp-thread 只取直接子卡片，不把后代算进去。
    if (selector.startsWith(':scope > ')) {
      const rest = selector.slice(':scope > '.length);
      return node.children.filter(child => matches(child, rest));
    }
    walk(node);
    return out;
  };
  node.classList = {
    add(name) {
      const names = classList(node);
      if (!names.includes(name)) node.className = [...names, name].join(' ');
    },
    remove(name) {
      node.className = classList(node).filter(item => item !== name).join(' ');
    },
    contains(name) { return classList(node).includes(name); },
  };
  node.focus = () => { globalThis.document.activeElement = node; };
  node.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 });
  Object.defineProperty(node, 'innerHTML', {
    get() { return node._html || ''; },
    set(html) {
      node._html = String(html);
      node.childNodes = [];
      node.children = [];
      for (const child of parseFragment(html)) node.appendChild(child);
    },
  });
  if (attrs) {
    if (attrs.class) node.className = attrs.class;
    for (const [name, value] of Object.entries(attrs)) {
      if (name !== 'class') node.setAttribute(name, value);
    }
  }
  for (const child of children || []) node.appendChild(child);
  return node;
}

function classList(node) {
  return node.className ? node.className.split(/\s+/).filter(Boolean) : [];
}

function matches(node, selector) {
  return selector.split(',').some(part => matchesOne(node, part.trim()));
}

function matchesOne(node, selector) {
  if (!selector) return false;
  let rest = selector;
  if (/^[a-z][\w-]*$/i.test(rest)) return node.tagName === rest.toUpperCase();
  const chunks = rest.split(/(?=[.\[])/);
  if (!chunks[0] || chunks[0].startsWith('.') || chunks[0].startsWith('[')) {
    // 没有标签，从 class / 属性开始。
  } else if (node.tagName !== chunks[0].toUpperCase()) {
    return false;
  }
  const start = chunks[0] && !chunks[0].startsWith('.') && !chunks[0].startsWith('[') ? 1 : 0;
  for (let i = start; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.startsWith('.')) {
      if (!classList(node).includes(chunk.slice(1))) return false;
    } else if (chunk.startsWith('[')) {
      const body = chunk.slice(1, -1);
      const eq = body.indexOf('=');
      if (eq < 0) {
        if (!Object.prototype.hasOwnProperty.call(node.attributes, body)) return false;
      } else {
        const name = body.slice(0, eq);
        const value = body.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (node.getAttribute(name) !== value) return false;
      }
    } else {
      return false;
    }
  }
  return chunks.length > start || /^[a-z]/i.test(selector);
}

function installDom() {
  const noop = () => {};
  globalThis.window = {
    matchMedia: query => ({
      matches: query.includes('min-width'),
      addEventListener: noop,
    }),
    scrollY: 0,
    innerHeight: 800,
    scrollBy: noop,
    addEventListener: noop,
    CSS: { escape: value => String(value) },
  };
  globalThis.CSS = globalThis.window.CSS;
  globalThis.cancelAnimationFrame = noop;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.document = {
    activeElement: null,
    createRange() {
      const range = {
        setStart(node) { range.node = node; },
        setEnd() {},
        getBoundingClientRect() { return range.node.rect; },
      };
      return range;
    },
  };
}

function segment(rect) {
  const node = { data: 'x', rect };
  return { entry: { node, map: [0, 1] }, from: 0, to: 1 };
}

function closedRow(id, n) {
  return {
    id,
    n,
    status: 'close',
    quote: { exact: '引文' + n },
    messages: [{ who: 'owner', at: '2026-10-21T00:00:00.000Z', text: '评' }],
  };
}

installDom();
const { createRail } = await import('./rail.js');

test('三条已关闭评论一次排版只建一次索引，几何按这份索引；DOM 变了下一次排版拿新索引', () => {
  const article = el('article');
  const rail = el('aside', { class: 'pp-rail' });
  const anchors = new Map([
    ['a', { start: 2, end: 4 }],
    ['b', { start: 10, end: 12 }],
    ['c', { start: 20, end: 22 }],
  ]);
  const state = {
    rows: [closedRow('a', 1), closedRow('b', 2), closedRow('c', 3)],
    anchors,
    cardOffsets: new Map(),
    replyOpen: new Set(),
    replyText: {},
    expanded: new Set(),
    editingId: null,
    editText: {},
    focusedId: null,
    draft: null,
    composingArea: null,
    railDirty: false,
  };
  const api = createRail({
    rail,
    root: article,
    state,
    sync: { canvas: null, connection: () => 'open', prose: { error: () => '' }, restoreText: {} },
    hooks: {
      canvasCards: () => [],
      orderKey: row => anchors.get(row.id).start,
      view: () => state,
    },
  });

  const first = {
    segments: {
      2: segment({ top: 100, bottom: 116, height: 16 }),
      10: segment({ top: 240, bottom: 256, height: 16 }),
      20: segment({ top: 400, bottom: 416, height: 16 }),
    },
  };
  const second = {
    segments: {
      2: segment({ top: 180, bottom: 196, height: 16 }),
      10: segment({ top: 320, bottom: 336, height: 16 }),
      20: segment({ top: 520, bottom: 536, height: 16 }),
    },
  };
  calls.builds = 0;
  calls.indexes = [first, second];

  api.renderRail();
  assert.equal(calls.builds, 1, '三条关闭卡共用一次排版里的一份索引');
  const tops = [...rail.querySelectorAll('.pp-thread')].map(card => card.style.top);
  // 锚点 100 / 240 / 400，卡片高 28，间距 14：互不碰撞，top 等于锚点。
  assert.deepEqual(tops, ['100px', '240px', '400px']);

  // 下一次排版读到另一份索引（正文 DOM 已变）。不能复用上一次留下的偏移。
  api.renderRail();
  assert.equal(calls.builds, 2, '另一次排版按当时的 DOM 重建索引');
  const next = [...rail.querySelectorAll('.pp-thread')].map(card => card.style.top);
  assert.deepEqual(next, ['180px', '320px', '520px']);
});

test('只有草稿时这一次排版不建正文索引，草稿仍按高亮定位', () => {
  const article = el('article');
  const draftMark = el('mark', { class: 'pp-hl draft' });
  draftMark.getBoundingClientRect = () => ({ top: 80, bottom: 96, height: 16, left: 0, right: 0, width: 10 });
  article.appendChild(draftMark);
  const rail = el('aside', { class: 'pp-rail' });
  const state = {
    rows: [],
    anchors: new Map(),
    cardOffsets: new Map(),
    replyOpen: new Set(),
    replyText: {},
    expanded: new Set(),
    editingId: null,
    editText: {},
    focusedId: null,
    draft: { start: 1, quote: { exact: '草稿' } },
    composingArea: null,
    railDirty: false,
  };
  const api = createRail({
    rail,
    root: article,
    state,
    sync: { canvas: null, connection: () => 'open', prose: { error: () => '' }, restoreText: {} },
    hooks: { canvasCards: () => [], orderKey: () => Infinity, view: () => state },
  });
  calls.builds = 0;
  calls.indexes = [];
  api.renderRail();
  assert.equal(calls.builds, 0, '草稿走 mark 几何，不建正文索引');
  const tops = [...rail.querySelectorAll('.pp-thread')].map(card => [card.getAttribute('data-id'), card.style.top]);
  assert.deepEqual(tops, [['__draft', '80px']]);
});
