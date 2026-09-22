import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ancestorsOf,
  foldHtmlElement,
  foldRange,
  jsxElementRange,
  parseHtmlFragment,
  renderExcerpt,
  resolveSelectorChain,
  siblingHints,
} from './ann-excerpt.js';

const FRAGMENT = [
  '<div class="ios-app" data-pp-id="home.jsx:3@1" data-pp-comp="Home">',
  '  <nav class="ios-nav" data-pp-id="home.jsx:4@1" data-pp-comp="Nav">',
  '    <button class="ios-cell" data-pp-id="home.jsx:5@1">早</button>',
  '    <button class="ios-cell" data-pp-id="home.jsx:6@1">午</button>',
  '    <button class="ios-cell" data-pp-id="home.jsx:7@1">晚</button>',
  '  </nav>',
  '  <img src="a.png" data-pp-id="home.jsx:8@1" />',
  '</div>',
].join('\n');

describe('parseHtmlFragment', () => {
  test('配平树：标签 / 属性 / 自闭合 / 区间', () => {
    const tree = parseHtmlFragment(FRAGMENT);
    assert.ok(tree);
    const app = tree.children[0];
    assert.equal(app.tag, 'div');
    assert.equal(app.attrs['data-pp-comp'], 'Home');
    const nav = app.children.find((child) => child.tag === 'nav');
    assert.equal(nav.children.length, 3);
    const img = app.children.find((child) => child.tag === 'img');
    assert.ok(img, '自闭合 img 在树里');
    const source = FRAGMENT.slice(app.start, app.end);
    assert.ok(source.startsWith('<div'));
    assert.ok(source.endsWith('</div>'));
  });

  test('残缺输入返回 null', () => {
    assert.equal(parseHtmlFragment('<div><span>不闭'), null);
    assert.equal(parseHtmlFragment('裸文本'), null);
  });

  test('script / style 原文不被当标签', () => {
    const tree = parseHtmlFragment('<div><style>a>b{}</style><p>ok</p></div>');
    assert.equal(tree.children[0].children[0].tag, 'style');
    assert.equal(tree.children[0].children[0].text, 'a>b{}');
  });
});

describe('resolveSelectorChain', () => {
  test('tag.cls:nth-of-type 链逐段走', () => {
    const tree = parseHtmlFragment(FRAGMENT);
    const cell = resolveSelectorChain(tree, 'div.ios-app:nth-of-type(1) > nav.ios-nav:nth-of-type(1) > button.ios-cell:nth-of-type(2)');
    assert.ok(cell);
    assert.equal(cell.attrs['data-pp-id'], 'home.jsx:6@1');
  });

  test('无 nth 的段取首个匹配', () => {
    const tree = parseHtmlFragment(FRAGMENT);
    const nav = resolveSelectorChain(tree, 'nav.ios-nav');
    assert.equal(nav.attrs['data-pp-comp'], 'Nav');
  });

  test('#id 段与找不到都安分', () => {
    const tree = parseHtmlFragment('<div><span id="x" class="c">t</span></div>');
    assert.equal(resolveSelectorChain(tree, '#x').tag, 'span');
    assert.equal(parseHtmlFragment === null, false);
    const miss = parseHtmlFragment(FRAGMENT);
    assert.equal(resolveSelectorChain(miss, 'section.nothing'), null);
  });
});

describe('ancestorsOf / siblingHints', () => {
  test('祖先链与前后兄弟开标签', () => {
    const tree = parseHtmlFragment(FRAGMENT);
    const cells = tree.children[0].children[0].children;
    assert.deepEqual(ancestorsOf(cells[1]).map((node) => node.tag), ['div', 'nav']);
    const hints = siblingHints(cells[1], FRAGMENT);
    assert.equal(hints.length, 2);
    assert.equal(hints[0].where, 'before');
    assert.ok(hints[0].text.startsWith('<button class="ios-cell"'));
    assert.ok(!hints[0].text.includes('</button>'), '兄弟只留开标签');
    // 首个元素没有 before 兄弟。
    assert.deepEqual(siblingHints(cells[0], FRAGMENT).map((h) => h.where), ['after']);
  });
});

describe('jsxElementRange / foldRange', () => {
  const JSX = [
    'export default function Home() {', // 1
    '  return (',                       // 2
    '    <div class="ios-app">',        // 3
    '      <nav class="ios-nav">',      // 4
    '        <button>早</button>',      // 5
    '        <button>午</button>',      // 6
    '      </nav>',                     // 7
    '    </div>',                       // 8
    '  );',                             // 9
    '}',                                // 10
  ].join('\n');

  test('锚点行取最小完整元素（同行嵌套取内层）', () => {
    assert.deepEqual(jsxElementRange(JSX, 6), { start: 6, end: 6 });
    assert.deepEqual(jsxElementRange(JSX, 4), { start: 4, end: 7 });
    assert.deepEqual(jsxElementRange(JSX, 3), { start: 3, end: 8 });
  });

  test('超 15 行折叠：首行 / 锚点行 / 末行 + …', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `第${i + 1}行`);
    const folded = foldRange(lines, 10, { start: 1, end: 20 }, 15);
    assert.deepEqual(folded.map((row) => row.text), ['第1行', '…', '第10行', '…', '第20行']);
    assert.equal(folded[2].anchor, true);
    // 不超限原样全出。
    const plain = foldRange(lines, 1, { start: 1, end: 5 }, 15);
    assert.equal(plain.length, 5);
  });

  test('行外锚点返回 null', () => {
    assert.equal(jsxElementRange(JSX, 99), null);
  });

  test('多行开标签跨行入栈（prettier 风格不再退化 ±3）', () => {
    const MULTILINE = [
      'export default function Home() {', // 1
      '  return (',                       // 2
      '    <Card',                        // 3
      '      title="长标题"',             // 4
      '      wide',                       // 5
      '    >',                           // 6
      '      <p>正文</p>',                // 7
      '    </Card>',                      // 8
      '  );',                             // 9
      '}',                                // 10
    ].join('\n');
    // 卡片元素 (3,8) 注册成功：锚在属性行也能拿到完整元素区间，而不是 ±3。
    assert.deepEqual(jsxElementRange(MULTILINE, 5), { start: 3, end: 8 });
    assert.deepEqual(jsxElementRange(MULTILINE, 7), { start: 7, end: 7 });
    // 自闭合同样支持跨行。
    const SPREAD = [
      'export default function Home() {', // 1
      '  return <Card',                   // 2
      '    {...props}',                   // 3
      '  />;',                            // 4
      '}',                                // 5
    ].join('\n');
    assert.deepEqual(jsxElementRange(SPREAD, 3), { start: 2, end: 4 });
  });

  test('同行比较文本不入栈：`{a<b && c>d}` 不再污染配对', () => {
    const POLLUTED = [
      'const ok = a<b && c>d;',   // 1 —— 老扫描器把 `<b` 压栈，`</p>` 错配给它
      'export default Home() {',  // 2
      '  return (',               // 3
      '    <div class="app">',    // 4
      '      <p>普通</p>',        // 5
      '    </div>',               // 6
      '  );',                     // 7
      '}',                        // 8
    ].join('\n');
    // 锚在 <p> 行：区间是 p 自己（老行为给出被污染的 (1,5)）。
    assert.deepEqual(jsxElementRange(POLLUTED, 5), { start: 5, end: 5 });
    assert.deepEqual(jsxElementRange(POLLUTED, 4), { start: 4, end: 6 });
    // 表达式括号里的比较同样不入栈。
    const EXPR = [
      'export default Home() {',                  // 1
      '  const pick = (x) => (x<a && x>b ? 1 : 0);', // 2
      '  return (',                               // 3
      '    <p>文字</p>',                          // 4
      '  );',                                     // 5
      '}',                                        // 6
    ].join('\n');
    assert.deepEqual(jsxElementRange(EXPR, 4), { start: 4, end: 4 });
  });
});

describe('foldHtmlElement / renderExcerpt', () => {
  test('outerHTML 折叠，行号指原文件', () => {
    const tree = parseHtmlFragment(FRAGMENT);
    const nav = tree.children[0].children[0];
    const folded = foldHtmlElement(nav, FRAGMENT, 4);
    assert.deepEqual(folded.map((row) => row.no), [2, 3, 4, 5, 6]);
    assert.equal(folded[2].anchor, true);
    assert.equal(folded[2].text, '    <button class="ios-cell" data-pp-id="home.jsx:6@1">午</button>');
  });

  test('renderExcerpt：面包屑 + 行号 + 锚点行 > 前缀', () => {
    const out = renderExcerpt({
      breadcrumb: 'Home > Nav',
      segments: [{ file: 'home.jsx', lines: [
        { no: 5, text: '<button>早</button>', anchor: true },
        { no: 0, text: '…' },
      ] }],
    });
    assert.deepEqual(out, ['Home > Nav', 'home.jsx', '   5> <button>早</button>', '      …']);
  });
});
