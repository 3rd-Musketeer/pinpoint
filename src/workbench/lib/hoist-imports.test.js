import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOISTED_ATTR, SCREEN_IMPORTS_ATTR, hoistedKeys, hoistedStyleHtml, importStyleHtml,
  readScreenImports, splitImportOnlyStyles, syncHoistedStyles,
} from './hoist-imports.js';

const P = '@import url("/sites/p/p.css");';
const Q = '@import url("/sites/p/q.css");';
const R = '@import url(/sites/p/r.css);';

test('splitImportOnlyStyles：拆出 import-only 的 style，按首次出现去重，自带规则的 style 不动', () => {
  const own = '<style>.a{color:red}</style>';
  const out = splitImportOnlyStyles('<div><style> ' + P + ' </style>A' + own + '<style>' + P + '</style><style>' + Q + '</style></div>');
  assert.deepEqual(out.keys, [P, Q]);
  assert.equal(out.rest, '<div>A' + own + '</div>');
  assert.deepEqual(splitImportOnlyStyles('<p>无样式</p>'), { keys: [], rest: '<p>无样式</p>' });
});

test('hoistedKeys：板级一组按板上顺序首次出现去重，与整板装载的提升结果相同', () => {
  // 旧 hoistImportOnlyStyles 对整板字符串的结果：P、Q 各一份，按首次出现排在最前。
  assert.deepEqual(hoistedKeys([[P], [P], [Q]]), [P, Q]);
  assert.deepEqual(hoistedKeys([[], [Q, P], [R]]), [Q, P, R]);
});

test('hoistedKeys：所有权 —— 最后一个使用者删掉才撤销，旁屏在用的保留，新出现的照提', () => {
  const board = { a: [P, R], b: [P] };
  const keys = () => hoistedKeys([board.a, board.b]);
  assert.deepEqual(keys(), [P, R]);
  board.a = [];           // a 删掉两条：R 只有 a 用 → 撤销；P 还被 b 用 → 保留
  assert.deepEqual(keys(), [P]);
  board.b = [];           // 最后一个使用者也删了 → 撤销
  assert.deepEqual(keys(), []);
  board.b = [Q];          // 新出现的照提
  assert.deepEqual(keys(), [Q]);
});

test('importStyleHtml / hoistedStyleHtml 能被 split 认回（重置记下的初始 HTML 带着它们）', () => {
  assert.deepEqual(splitImportOnlyStyles(importStyleHtml(P) + '<p></p>').keys, [P]);
  // 板级那一组带标记，不会被当成帧里的 import 再拆一次。
  assert.deepEqual(splitImportOnlyStyles(hoistedStyleHtml(P)).keys, []);
});

// ---- syncHoistedStyles：最小的 DOM 替身，只实现它用到的几样 ----
class Node {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag;
    this.attrs = { ...attrs };
    this.textContent = text;
    this.parent = null;
    this.childNodes = [];
    this.ownerDocument = { createElement: (t) => new Node(t.toUpperCase()) };
  }
  get children() { return this.childNodes.slice(); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    const sib = this.parent.childNodes;
    return sib[sib.indexOf(this) + 1] || null;
  }
  hasAttribute(n) { return n in this.attrs; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  remove() { if (this.parent) { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); this.parent = null; } }
  append(child) { child.remove(); child.parent = this; this.childNodes.push(child); return child; }
  insertBefore(child, ref) {
    child.remove();
    child.parent = this;
    if (!ref) this.childNodes.push(child);
    else this.childNodes.splice(this.childNodes.indexOf(ref), 0, child);
    return child;
  }
  querySelectorAll(sel) {
    assert.equal(sel, '.wb-screen[' + SCREEN_IMPORTS_ATTR + ']');
    const out = [];
    const walk = (n) => n.childNodes.forEach((c) => { if (c.attrs.class === 'wb-screen' && c.hasAttribute(SCREEN_IMPORTS_ATTR)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
}

function boardWith(lists) {
  const lib = new Node('DIV');
  hoistedKeys(lists).forEach((k) => lib.append(new Node('STYLE', { [HOISTED_ATTR]: '' }, k)));
  const item = lib.append(new Node('ARTICLE'));
  const screens = lists.map((keys) => item.append(new Node('DIV', keys.length ? { class: 'wb-screen', [SCREEN_IMPORTS_ATTR]: JSON.stringify(keys) } : { class: 'wb-screen' })));
  return { lib, screens };
}
const hoisted = (lib) => lib.children.filter((c) => c.tagName === 'STYLE').map((c) => c.textContent);
function setImports(screen, keys) {
  if (keys.length) screen.setAttribute(SCREEN_IMPORTS_ATTR, JSON.stringify(keys));
  else delete screen.attrs[SCREEN_IMPORTS_ATTR];
}

test('syncHoistedStyles：按屏改清单后，板级一组与整板重装的结果一致，留下的元素不重建', () => {
  const { lib, screens } = boardWith([[P, R], [P]]);
  const keptP = lib.children[0];
  assert.deepEqual(hoisted(lib), [P, R]);

  setImports(screens[0], []);
  syncHoistedStyles(lib);
  assert.deepEqual(hoisted(lib), [P], 'R 只有第一屏用，删掉即撤销；P 旁屏在用，保留');
  assert.equal(lib.children[0], keptP, '保留的那条是原来的元素，不重新解析');

  setImports(screens[0], [Q]);
  syncHoistedStyles(lib);
  assert.deepEqual(hoisted(lib), hoistedKeys([[Q], [P]]), '新出现的照提，位置按板上顺序（第一屏在前）');
  assert.equal(lib.children[1], keptP);
  assert.equal(lib.children[2].tagName, 'ARTICLE', '板级样式都在 library 开头');

  setImports(screens[1], []);
  setImports(screens[0], []);
  syncHoistedStyles(lib);
  assert.deepEqual(hoisted(lib), []);
  assert.equal(keptP.parent, null, '最后一个使用者删掉后撤销');
});

test('syncHoistedStyles：不碰没有标记的 style；readScreenImports 对坏属性当没有', () => {
  const { lib, screens } = boardWith([[P]]);
  const foreign = lib.insertBefore(new Node('STYLE', {}, '.x{}'), lib.firstChild);
  setImports(screens[0], []);
  syncHoistedStyles(lib);
  assert.deepEqual(hoisted(lib), ['.x{}']);
  assert.equal(lib.firstChild, foreign);
  screens[0].setAttribute(SCREEN_IMPORTS_ATTR, '{坏');
  assert.deepEqual(readScreenImports(screens[0]), []);
  assert.deepEqual(readScreenImports(null), []);
});
