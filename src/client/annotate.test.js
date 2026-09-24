import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// F2 磨砂玻璃的两端对账（design.md「材质」）：client 是注进任意页面的单文件，
// 读不到 workbench 的 --wb-*，所以玻璃配方在 annotate.js 里是字面量。这里把那
// 四个数与 wb-tokens.css 逐个比对 —— 双端材质不许分家（曾由 e2e/dir-entry 的
// 计算样式用例对账，2026-09-08 精简后改在这里守）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = fs.readFileSync(path.join(__dirname, 'annotate.js'), 'utf8');
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
