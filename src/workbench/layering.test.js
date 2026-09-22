// 层级阶梯守卫（ADR 0034，docs/design.md “层级”一节）。三件事：
//  a. 外壳源码里每一处 z-index 值和 Tailwind z-* 类都必须走 --wb-z 阶梯；不走的要在下面的
//     允许名单里写明是谁、为什么。名单里的每一条都必须真的命中，过期的条目一样报错。
//  b. index.html 里 .wb 必须 isolation:isolate（R1）；.wb-stage-wrap 不许带任何会造堆叠上下文的
//     属性（R2）。
//  c. src/client/annotate.js 里 var(--wb-z-*, N) 的兜底数必须与 wb-tokens.css 的 token 同值，
//     引用到的 token 必须真实存在。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 扫描范围：外壳（index.html）、workbench 源码（生成物 wb-tokens.css 与测试文件除外）、
// 注入端 client、双端共享的气泡样式、离线导出的烘焙 CSS。
function workbenchSources() {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx|css)$/.test(name)) continue;
      if (name === 'wb-tokens.css' || name.endsWith('.test.js')) continue;
      out.push(path.relative(ROOT, full));
    }
  })(path.join(ROOT, 'src', 'workbench'));
  return out.sort();
}

const SCANNED = [
  'index.html',
  ...workbenchSources(),
  'src/client/annotate.js',
  'src/shared/annotate-bubble.js',
];

// 允许名单：{ file, where: 命中行要匹配的正则, values: 允许的字面量, reason }。
// where 对着含 z-index 的那一行文本测，所以多行拼接的 CSS 字符串要写 z-index 所在的那一行。
const ALLOW = [
  // #ann-overlay / #ann-chrome 内部序：只在各自盒子内部比，不进阶梯（annotate.js 那段 CSS 开头有同一句注释）。
  // #ann-chrome 本身取 --wb-z-composer（2026-09-18），不在名单里。
  { file: 'src/client/annotate.js', where: /^\s*'#ann-marks,#ann-hover-layer\{/, values: ['1'], reason: 'overlay 内部序：钉子层 / hover 层' },
  { file: 'src/client/annotate.js', where: /^\s*'\.ann-hover-ghost\{/, values: ['1'], reason: 'overlay 内部序：hover ghost' },
  { file: 'src/client/annotate.js', where: /^\s*'\.ann-badge\{/, values: ['3'], reason: 'overlay 内部序：序号钉' },
  { file: 'src/client/annotate.js', where: /^\s*'\.ann-target\{/, values: ['1'], reason: 'overlay 内部序：命中框' },
  { file: 'src/client/annotate.js', where: /^\s*'\.ann-frame\{/, values: ['1'], reason: 'overlay 内部序：frame 框' },
  { file: 'src/client/annotate.js', where: /^\s*'\.ann-ghost-rect\{/, values: ['1'], reason: 'overlay 内部序：幽灵框（pp2 lastRect）' },
  { file: 'src/client/annotate.js', where: /^\s*'#ann-tip\{/, values: ['2'], reason: 'chrome 内部序：提示' },
  { file: 'src/client/annotate.js', where: /^\s*'#ann-box\{/, values: ['5'], reason: 'chrome 内部序：输入框' },
  { file: 'src/client/annotate.js', where: /^\s*'#ann-tools-menu\{/, values: ['6'], reason: 'chrome 内部序：输入框里的工具菜单' },
  { file: 'src/client/annotate.js', where: /^\s*'#ann-mention\{/, values: ['6'], reason: 'chrome 内部序：mention 下拉' },
  { file: 'src/client/annotate.js', where: /svg\.style\.cssText = 'position:absolute;pointer-events:none;z-index:2;'/, values: ['2'], reason: 'overlay 内部序：箭头 SVG' },
  // 客座层：注入到别人页面时和宿主竞争，workbench 里不出现；数字保留不动。
  { file: 'src/client/annotate.js', where: /^\s*'#ann-toolbar\{/, values: ['2147483646'], reason: '客座层：注入端工具条' },
  { file: 'src/client/annotate.js', where: /^\s*'#ann-sidebar\{/, values: ['2147483645'], reason: '客座层：注入端标注面板' },
  { file: 'src/client/annotate.js', where: /^\s*'#ann-toast\{/, values: ['2147483647'], reason: '客座层：关闭 / 撤销 toast（pp2）' },
  // 双端共享的气泡样式：气泡与导出序号只在 overlay 内部比。
  { file: 'src/shared/annotate-bubble.js', where: /pointer-events:auto;z-index:3;overflow:hidden;\}/, values: ['3'], reason: 'overlay 内部序：.ann-bubble 评论卡' },
  // 组件内部序：分段控件焦点项压过相邻项的边，不与外壳比。
  { file: 'src/workbench/app/ui/toggle-group.jsx', where: /focus:z-10 focus-visible:z-10/, values: ['10'], reason: '组件内部序：toggle-group 焦点项' },
];

const TOKEN_REF = /^var\(--wb-z-[a-z0-9-]+(?:,\s*\d+)?\)$/;
const TW_TOKEN_REF = /^\(--wb-z-[a-z0-9-]+\)$/;

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

// 去掉块注释；行注释只去整行是注释的那种（字符串里的 // 不能碰）。
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

// 找出一个文件里所有 z-index 声明与 Tailwind z-* 类，返回 { line, value, raw }。
function zOccurrences(text) {
  const clean = stripComments(text);
  const lines = clean.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/z-index\s*:\s*([^;}'"`]+)/g)) {
      out.push({ line: lines[i], lineNo: i + 1, value: m[1].trim(), raw: m[0], kind: 'css' });
    }
    // Tailwind：z-50 / z-[60] / z-(--wb-z-float) / focus:z-10；前面不能是字母、数字或 -
    //（排除 --wb-z-float 这种 token 名本身）。
    for (const m of line.matchAll(/(?<![\w-])(?:[\w-]+:)*z-(\[[^\]]*\]|\([^)]*\)|\d+|auto)/g)) {
      out.push({ line: lines[i], lineNo: i + 1, value: m[1], raw: m[0], kind: 'tw' });
    }
  });
  return out;
}

function isTokenRef(occ) {
  if (occ.kind === 'css') return TOKEN_REF.test(occ.value);
  return TW_TOKEN_REF.test(occ.value);
}

function literalOf(occ) {
  // 允许名单比对用的数字：z-[60] → 60，z-10 → 10，z-index:5 → 5
  return occ.value.replace(/^\[|\]$/g, '');
}

test('layering: every z-index / z-* in the shell goes through --wb-z tokens or is allow-listed', () => {
  const hitEntries = new Set();
  const violations = [];
  for (const file of SCANNED) {
    for (const occ of zOccurrences(read(file))) {
      if (isTokenRef(occ)) continue;
      const entry = ALLOW.find((e) => e.file === file && e.where.test(occ.line) && e.values.includes(literalOf(occ)));
      if (entry) { hitEntries.add(entry); continue; }
      violations.push(`${file}:${occ.lineNo} ${occ.raw}`);
    }
  }
  assert.deepEqual(violations, [], '不走 --wb-z 阶梯又不在允许名单里的 z 值（新元素先挑 token，见 docs/design.md “层级”）');
  const stale = ALLOW.filter((e) => !hitEntries.has(e)).map((e) => `${e.file} ${e.where}`);
  assert.deepEqual(stale, [], '允许名单里没命中的条目（代码已改，名单要跟着删）');
});

test('layering: every referenced --wb-z token is defined in wb-tokens.css', () => {
  const tokens = ladderTokens();
  const missing = [];
  for (const file of SCANNED) {
    for (const m of read(file).matchAll(/--wb-z-[a-z0-9-]+/g)) {
      if (!tokens.has(m[0])) missing.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

// ── b. R1 / R2 ──
function styleRules(html) {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const clean = stripComments(styles);
  const rules = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return rules;
}

function declarations(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return { prop: d.slice(0, i).trim().toLowerCase().replace(/^-webkit-/, ''), value: d.slice(i + 1).trim().toLowerCase() };
  });
}

// 选择器的主体（最后一个复合选择器）是不是 .wb-stage-wrap
function subjectIsStageWrap(selector) {
  return selector.split(',').some((s) => {
    const compounds = s.trim().split(/[\s>+~]+/).filter(Boolean);
    return /\.wb-stage-wrap(?![\w-])/.test(compounds[compounds.length - 1] || '');
  });
}

const STACKING_PROPS = new Set([
  'z-index', 'transform', 'filter', 'backdrop-filter', 'isolation', 'will-change', 'perspective',
  'mix-blend-mode', 'clip-path',
]);

test('layering R1: .wb is an isolated stacking context', () => {
  const rules = styleRules(read('index.html')).filter((r) => r.selector === '.wb');
  assert.ok(rules.length >= 1, 'index.html has a bare .wb rule');
  const isolated = rules.some((r) => declarations(r.body).some((d) => d.prop === 'isolation' && d.value === 'isolate'));
  assert.ok(isolated, '.wb must declare isolation:isolate');
});

test('layering R2: .wb-stage-wrap never becomes a stacking context', () => {
  const rules = styleRules(read('index.html')).filter((r) => subjectIsStageWrap(r.selector));
  assert.ok(rules.length >= 1, 'index.html has a .wb-stage-wrap rule');
  const offenders = [];
  for (const r of rules) {
    for (const d of declarations(r.body)) {
      if (STACKING_PROPS.has(d.prop) || d.prop.startsWith('mask')) offenders.push(`${r.selector} { ${d.prop}:${d.value} }`);
      if (d.prop === 'opacity' && d.value !== '1') offenders.push(`${r.selector} { opacity:${d.value} }`);
      if (d.prop === 'contain' && /paint|layout|strict|content/.test(d.value)) offenders.push(`${r.selector} { contain:${d.value} }`);
    }
  }
  assert.deepEqual(offenders, [], '.wb-stage-wrap 一旦成为堆叠上下文，它的孩子就无法与 .wb-side / .wb-strip 交错');
});

// ── c. 兜底值 = token 值 ──
function ladderTokens() {
  const css = read('src/workbench/wb-tokens.css');
  const map = new Map();
  for (const m of css.matchAll(/(--wb-z-[a-z0-9-]+)\s*:\s*(\d+)\s*;/g)) map.set(m[1], m[2]);
  return map;
}

test('layering: annotate.js var(--wb-z-*, N) fallbacks equal the token values', () => {
  const tokens = ladderTokens();
  assert.ok(tokens.size >= 10, 'ladder present in wb-tokens.css');
  const refs = [...read('src/client/annotate.js').matchAll(/var\((--wb-z-[a-z0-9-]+)\s*,\s*(\d+)\)/g)];
  assert.ok(refs.length >= 2, 'annotate.js references at least --wb-z-marks and --wb-z-marks-active with fallbacks');
  for (const [, name, fallback] of refs) {
    assert.equal(fallback, tokens.get(name), `${name} fallback ${fallback} must equal token value ${tokens.get(name)}`);
  }
  const names = new Set(refs.map((r) => r[1]));
  assert.ok(names.has('--wb-z-marks') && names.has('--wb-z-marks-active'));
});
