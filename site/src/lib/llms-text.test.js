import test from 'node:test';
import assert from 'node:assert/strict';
import { stripEsm } from './llms-text.js';

test('stripEsm：单行 import 与 export 剥掉，正文和 [[ ]] 原样保留', () => {
  const mdx = 'import Chart from "./components/Chart.jsx";\n\n# 标题\n\n见 [[confirm-card]]，正文第一段；这里有分号也不影响。\n\nexport const shell = "app";\n';
  assert.equal(stripEsm(mdx), '# 标题\n\n见 [[confirm-card]]，正文第一段；这里有分号也不影响。');
});

test('stripEsm：多行命名 import 全段剥掉，不留中间行（回归：单行正则留下 "Nav," 与 "} from …" 残行）', () => {
  const mdx = 'import {\n  Nav,\n  Bubble,\n} from "pinpoint/kit";\n\n# 标题\n\n正文。\n';
  assert.equal(stripEsm(mdx), '# 标题\n\n正文。');
});

test('stripEsm：一段 import 里没有分号，只吃第一行，不吃后面的正文', () => {
  const mdx = 'import x from "y"\n\n正文里有个分号；后面还有一段。\n';
  assert.equal(stripEsm(mdx), '正文里有个分号；后面还有一段。');
});

test('stripEsm：import 无引号无空格的写法也认；行首是 imports 的英文句子不动', () => {
  assert.equal(stripEsm('import{Nav}from"pinpoint/kit";\n\n正文。'), '正文。');
  assert.equal(stripEsm('imports are common in MDX; really.\n\n正文。'), 'imports are common in MDX; really.\n\n正文。');
});

test('stripEsm：空输入与无 ESM 的正文原样（trim 后）返回', () => {
  assert.equal(stripEsm(''), '');
  assert.equal(stripEsm(null), '');
  assert.equal(stripEsm('\n正文。\n'), '正文。');
});

test('stripEsm：ASI import（行末无分号）不越过空行吃正文（r4 review 修复轮）', () => {
  // 旧修法（整篇找分号）把「正文第一段」「第二段有个分号; 在这里」连段吃掉，只剩第三段。
  const mdx = 'import x from "y"\n\n正文第一段。\n\n第二段有个分号; 在这里。\n\n第三段。\n';
  assert.equal(stripEsm(mdx), '正文第一段。\n\n第二段有个分号; 在这里。\n\n第三段。');
});

test('stripEsm：连续两条 ASI import，空行后的正文带 ASCII 分号原样保留', () => {
  const mdx = 'import a from "1"\nimport b from "2"\n\n正文; 有分号。\n';
  assert.equal(stripEsm(mdx), '正文; 有分号。');
});

test('stripEsm：代码围栏里的 import 原样保留，是示例不是模块声明（r4 review 建议 4）', () => {
  const mdx = '# 用法\n\n```jsx\nimport {\n  Nav\n} from "kit";\n\nconst x = 1;\n```\n\n正文。\n';
  assert.equal(stripEsm(mdx), '# 用法\n\n```jsx\nimport {\n  Nav\n} from "kit";\n\nconst x = 1;\n```\n\n正文。');
  // 单行、~~~ 围栏、未闭合的围栏同样保留。
  assert.equal(stripEsm('```js\nimport x from "y";\n```\n正文。'), '```js\nimport x from "y";\n```\n正文。');
  assert.equal(stripEsm('~~~\nimport x from "y";\n~~~\n正文。'), '~~~\nimport x from "y";\n~~~\n正文。');
  assert.equal(stripEsm('```jsx\nimport x from "y";\n\nnever closed'), '```jsx\nimport x from "y";\n\nnever closed');
  // 围栏外的 import 照剥。
  assert.equal(stripEsm('import x from "y";\n\n```jsx\nimport z from "z";\n```\n\n正文。'), '```jsx\nimport z from "z";\n```\n\n正文。');
});
