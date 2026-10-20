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
