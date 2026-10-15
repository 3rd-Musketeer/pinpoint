import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// F2 磨砂玻璃的两端对账（design.md「材质」）：client 是注进任意页面的单文件，
// 读不到 workbench 的 --wb-*，所以玻璃配方在 annotate-css.js 里是字面量。这里把那
// 四个数与 wb-tokens.css 逐个比对 —— 双端材质不许分家（曾由 e2e/dir-entry 的
// 计算样式用例对账，2026-09-08 精简后改在这里守）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = fs.readFileSync(path.join(__dirname, 'annotate-css.js'), 'utf8');
const tokens = fs.readFileSync(path.join(__dirname, '..', 'workbench', 'wb-tokens.css'), 'utf8');

function tokenValue(name) {
  const match = tokens.match(new RegExp(name + ':([^;]+);'));
  assert.ok(match, `wb-tokens.css 定义 ${name}`);
  // token 源里逗号后带空格，client 字面量不带 —— 比对语义值，不比排版。
  return match[1].replace(/,\s*/g, ',');
}

test('注入端 F2 玻璃字面量与 wb-tokens.css 同值', () => {
  const rule = client.match(/#ann-sidebar,#ann-toolbar\{[^}]+\}/);
  assert.ok(rule, '#ann-sidebar/#ann-toolbar 的玻璃规则在场');
  const css = rule[0];

  // ① 白 88%：--wb-glass 的 fallback。
  const glass = tokenValue('--wb-glass');
  assert.ok(css.includes(`var(--wb-glass,${glass})`), `--wb-glass fallback = ${glass}`);
  // ② blur 档：backdrop-filter 与 -webkit- 前缀共用 --wb-glass-blur 同值。
  const blur = tokenValue('--wb-glass-blur');
  assert.ok(css.includes(`-webkit-backdrop-filter:${blur}`) && css.includes(`backdrop-filter:${blur}`),
    `backdrop-filter = ${blur}`);
  // ③ 圆角 14：--wb-r-glass 这一档。
  const radius = tokenValue('--wb-r-glass');
  assert.ok(css.includes(`border-radius:${radius}`), `玻璃圆角 = ${radius}`);
  // ④ 0.5px 上缘内高光（--wb-glass-hi）+ 外阴影与 --wb-sh-3 同值。
  const hi = tokenValue('--wb-glass-hi');
  const sh3 = tokenValue('--wb-sh-3');
  assert.ok(css.includes(`var(--wb-glass-hi,${hi})`), `上缘高光 fallback = ${hi}`);
  assert.ok(css.includes(`,${sh3};`), `外阴影 = --wb-sh-3（${sh3}）`);
});

// ---- 注入端钉值对账（ADR 0046）：注入端与工作台同一份 token 源 ----
// ① ann-tokens.js 的亮 / 暗钉值与 wb-tokens.css 的同名 token 同值（工作台写成 var 链的 hover / fill 不比）；
// ② 注入端源码里每个 var(--wb-* / --ann-*, 兜底) 的兜底都等于亮色钉值（z 阶梯归 layering.test.js）；
// ③ [data-ann-ui]、#ann-sidebar 与暗色段都由生成的声明串拼成，不再手写字面量。
import { ANN_TOKENS_LIGHT, ANN_TOKENS_DARK } from '../shared/ann-tokens.js';

const ROOT = path.join(__dirname, '..', '..');
const norm = (v) => v.trim().replace(/\s*,\s*/g, ',');
function wbBlock(css, dark) {
  const at = css.indexOf('@media (prefers-color-scheme: dark)');
  const part = dark ? css.slice(at) : css.slice(0, at);
  return Object.fromEntries([...part.matchAll(/(--(?:wb|ann)-[a-z0-9-]+):([^;]+);/g)].map((m) => [m[1], norm(m[2])]));
}

test('注入端钉值与 wb-tokens.css 同名 token 逐个同值（亮、暗）', () => {
  for (const [dark, pins] of [[false, ANN_TOKENS_LIGHT], [true, ANN_TOKENS_DARK]]) {
    const wb = wbBlock(tokens, dark);
    let compared = 0;
    for (const [name, value] of Object.entries(pins)) {
      if (!(name in wb) || wb[name].includes('var(')) continue;
      assert.equal(norm(value), wb[name], `${dark ? '暗' : '亮'} ${name}`);
      compared += 1;
    }
    assert.ok(compared >= (dark ? 20 : 30), `比对了 ${compared} 个`);
  }
  // 四态色亮暗都在两边。
  for (const s of ['open', 'check', 'done', 'close']) {
    for (const pins of [ANN_TOKENS_LIGHT, ANN_TOKENS_DARK]) {
      assert.ok(pins['--ann-st-' + s] && pins['--ann-st-' + s + '-fg'], s);
    }
  }
});

test('注入端源码里的 var() 兜底全部等于亮色钉值', () => {
  const files = ['src/client/annotate-css.js', 'src/client/annotate.js', 'src/shared/annotate-bubble.js', 'src/shared/ann-list.css', 'src/workbench/ann-bridge.js'];
  let checked = 0;
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/var\((--(?:wb|ann)-[a-z0-9-]+),/g)) {
      const name = m[1];
      if (name.startsWith('--wb-z-') || !(name in ANN_TOKENS_LIGHT)) continue;
      let depth = 1; let i = m.index + m[0].length;
      const start = i;
      while (depth) { if (src[i] === '(') depth += 1; else if (src[i] === ')') depth -= 1; i += 1; }
      assert.equal(norm(src.slice(start, i - 1)), norm(ANN_TOKENS_LIGHT[name]), `${rel}: var(${name}, …)`);
      checked += 1;
    }
  }
  assert.ok(checked >= 100, `检查了 ${checked} 处兜底`);
});

test('[data-ann-ui]、#ann-sidebar 与暗色段由生成的声明串拼成', () => {
  assert.match(client, /'\[data-ann-ui\]\{font-family:[^\n]*' \+ ANN_UI_LIGHT \+ '\}'/);
  assert.match(client, /'#ann-sidebar\{position:fixed;[^\n]*' \+ ANN_SIDEBAR_PINS \+ '\}'/);
  assert.match(client, /'@media \(prefers-color-scheme: dark\)\{\[data-ann-ui\],#ann-sidebar\{' \+ ANN_UI_DARK \+ '\}\}'/);
  assert.match(client, /':root\[data-theme="dark"\] :is\(\[data-ann-ui\],#ann-sidebar\)\{' \+ ANN_UI_DARK \+ '\}'/);
  assert.match(client, /':root\[data-theme="light"\] :is\(\[data-ann-ui\],#ann-sidebar\)\{' \+ ANN_UI_LIGHT \+ '\}'/);
  // 除了圈选琥珀（#f5a623）、白描边和白字，注入端样式里不再手写 hex 色值。
  const hexes = [...client.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0].toLowerCase())
    .filter((h) => !['#f5a623', '#fff', '#ffffff', '#000'].includes(h) && !Object.values(ANN_TOKENS_LIGHT).includes(h) && !Object.values(ANN_TOKENS_DARK).includes(h));
  assert.deepEqual([...new Set(hexes)], [], '手写的 hex');
});
