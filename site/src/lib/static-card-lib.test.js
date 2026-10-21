import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_BOOT_MARKER,
  absolutizeAttrValue,
  absolutizeSrcset,
  classifyFrameScript,
  cssHazard,
  importNeedsFrame,
  parseCssImports,
  resolveCssImports,
  rewriteCssUrls,
  rewriteRootSelector,
  rootCompoundHazard,
} from './static-card-lib.js';

test('classifyFrameScript：ios-kit 与内联 frame-boot 是 boot，预览脚本与来路不明的脚本不是', () => {
  assert.equal(classifyFrameScript({ src: '/kits/ios/ios-kit.js' }), 'boot');
  assert.equal(classifyFrameScript({ src: 'http://127.0.0.1:7400/kits/ios/ios-kit.js' }), 'boot');
  assert.equal(classifyFrameScript({ src: '/api/frame-boot.js' }), 'boot');
  assert.equal(classifyFrameScript({ src: 'https://outside.invalid/api/frame-boot.js' }), 'other');
  assert.equal(classifyFrameScript({ src: '//other-host/api/frame-boot.js' }), 'other');
  assert.equal(classifyFrameScript({ src: 'http://127.0.0.1:8110/api/frame-boot.js' }), 'other');
  assert.equal(classifyFrameScript({ text: `/**\n * ${FRAME_BOOT_MARKER}（阶段 5）。*/` }), 'boot');
  assert.equal(classifyFrameScript({ src: '/api/frame-boot.js', text: 'console.log(1)' }), 'boot');
  assert.equal(classifyFrameScript({ src: '/api/frame-boot.js', attrs: 'data-preview-script' }), 'preview');
  assert.equal(classifyFrameScript({ src: '/api/not-frame-boot.js', text: FRAME_BOOT_MARKER }), 'other');
  assert.equal(classifyFrameScript({ attrs: 'type="text/x-pinpoint-preview" data-preview-script="true"' }), 'preview');
  assert.equal(classifyFrameScript({ attrs: 'data-preview-mount' }), 'preview');
  assert.equal(classifyFrameScript({ src: '/sites/demo_page/timer.js' }), 'other');
  assert.equal(classifyFrameScript({ text: 'console.log(1)' }), 'other');
});

test('cssHazard：视口类 media query / 视口单位 / position:fixed 留 iframe；prefers-* 与注释不算', () => {
  assert.equal(cssHazard('@media (max-width: 600px) { .a { color: red } }'), 'media-viewport');
  assert.equal(cssHazard('@media screen and (min-width: 400px) and (max-width: 700px) {}'), 'media-viewport');
  assert.equal(cssHazard('@media (orientation: landscape) {}'), 'media-viewport');
  assert.equal(cssHazard('@media (min-aspect-ratio: 1/1) {}'), 'media-viewport');
  assert.equal(cssHazard('@media (prefers-reduced-motion: reduce) {}'), null);
  assert.equal(cssHazard('@media (prefers-color-scheme: dark) {}'), null);
  assert.equal(cssHazard('@media print {}'), null);
  assert.equal(cssHazard('.a { width: 100vw }'), 'viewport-unit');
  assert.equal(cssHazard('.a { height: calc(100dvh - 10px) }'), 'viewport-unit');
  assert.equal(cssHazard('.a { top: 2svmin }'), 'viewport-unit');
  assert.equal(cssHazard('.a { width: 100% }'), null);
  assert.equal(cssHazard('.a { position: fixed; top: 0 }'), 'fixed-position');
  assert.equal(cssHazard('.a { position: sticky }'), null);
  assert.equal(cssHazard('/* @media (max-width: 1px) {} */ .a { color: red }'), null);
});

test('rewriteCssUrls：相对地址按 base 绝对化，data:/http/绝对路径/fragment 不动', () => {
  const base = 'http://x/sites/demo_page/';
  assert.equal(rewriteCssUrls('.a{background:url(img/a.png)}', base), '.a{background:url("http://x/sites/demo_page/img/a.png")}');
  assert.equal(rewriteCssUrls(".a{background:url('a b.png')}", base), '.a{background:url("http://x/sites/demo_page/a%20b.png")}');
  assert.equal(rewriteCssUrls('.a{background:url(data:image/png;base64,AA)}', base), '.a{background:url(data:image/png;base64,AA)}');
  assert.equal(rewriteCssUrls('.a{background:url(/kits/x.png)}', base), '.a{background:url(/kits/x.png)}');
  assert.equal(rewriteCssUrls('.a{src:url("https://cdn.x/a.woff2")}', base), '.a{src:url("https://cdn.x/a.woff2")}');
});

test('rewriteRootSelector：:root 搬到 :host，:rootish 不动', () => {
  assert.equal(rewriteRootSelector(':root{--a:1} .x :root{y:2}'), ':host{--a:1} .x :host{y:2}');
  assert.equal(rewriteRootSelector('.rooty{a:1}'), '.rooty{a:1}');
});

test('rootCompoundHazard：复合或带祖先的 :root 命中（重写后不生效，整帧退回 iframe），单独的 :root 不命中', () => {
  // 命中：同复合的前缀 / 后缀、带祖先、伪类参数里。
  for (const css of [
    '.x:root{y:2}',
    'html:root{y:2}',
    ':root[data-theme="dark"]{--b:2}',
    ':root:hover{y:2}',
    '.x :root{y:2}',
    '@media (min-width: 1px) { .x:root{y:2} }',
    'a, .x:root{y:2}',
    ':not(:root){y:2}',
  ]) assert.equal(rootCompoundHazard(css), true, css);
  // 不命中：单独的 :root（选择器开始）、:rootish 单词，以及注释里的 :root 字样
  //（kit 样式头注释就有它，判据先剥注释，cssHazard 同一口径）。
  for (const css of [
    ':root{--a:1}',
    ':root .x{y:2}',
    '@media (min-width: 1px) { :root{--a:1} }',
    'a, :root{--a:1}',
    '\n:root{\n  --a:1\n}',
    '.rooty{a:1}',
    '/* :root[data-theme] 的变体在 :root 上，这里只是注释 */ :root{--a:1}',
  ]) assert.equal(rootCompoundHazard(css), false, css);
});

test('resolveCssImports：递归展开 @import，带条件的包 @media，被展开表的 url() 按它自己的地址改写', async () => {
  const base = 'http://x/sites/demo_page/';
  const texts = new Map([
    ['http://x/sites/demo_page/a.css', '@import url("sub/b.css"); .a{x:1}'],
    ['http://x/sites/demo_page/sub/b.css', '.b{background:url(i.png)}'],
    ['http://x/sites/demo_page/c.css', '.c{z:3}'],
  ]);
  const fetched = [];
  const fetchText = async (href) => { fetched.push(href); return texts.get(href); };
  const out = await resolveCssImports(`@import url("a.css");@import "c.css" screen and (max-width: 600px);`, base, fetchText);
  assert.equal(out, '.b{background:url("http://x/sites/demo_page/sub/i.png")} .a{x:1}@media screen and (max-width: 600px){.c{z:3}}');
  // fetchText 只给原文：展开由本函数自己递归，调用方不传展开结果。
  assert.deepEqual(fetched, ['http://x/sites/demo_page/a.css', 'http://x/sites/demo_page/sub/b.css', 'http://x/sites/demo_page/c.css']);
  // 同一层重复 import 不是循环：两次都展开（浏览器也两条都应用）。
  const again = await resolveCssImports('@import url("c.css");@import url("c.css");', base, fetchText);
  assert.equal(again, '.c{z:3}.c{z:3}');
  // 替换文本里的 $ 原样保留（不按 String.replace 的替换模式解释）。
  const dollar = await resolveCssImports('@import "d.css";', base, async () => '.d::after{content:"$&$1"}');
  assert.equal(dollar, '.d::after{content:"$&$1"}');
});

test('resolveCssImports：循环 import 按这一趟的地址链断开，返回 null 让整帧退回 iframe', async () => {
  const base = 'http://x/sites/demo_page/';
  const texts = new Map([
    ['http://x/sites/demo_page/a.css', '@import "./b.css"; .a{x:1}'],
    ['http://x/sites/demo_page/b.css', '@import "./a.css"; .b{y:2}'], // 循环回 a.css
    ['http://x/sites/demo_page/self.css', '@import "self.css";'],
    ['http://x/sites/demo_page/d.css', '@import "e.css"; @import "e.css";'],
    ['http://x/sites/demo_page/e.css', '.e{}'],
  ]);
  const fetchText = async (href) => texts.get(href);
  assert.equal(await resolveCssImports('@import "a.css";', base, fetchText), null);
  assert.equal(await resolveCssImports('@import "self.css";', base, fetchText), null);
  // 根表自己在链上（<link> 那张表从 [url] 起）：b 指回根也是循环。
  assert.equal(await resolveCssImports(texts.get(`${base}b.css`), `${base}b.css`, fetchText, [`${base}b.css`]), null);
  // 菱形（同一张表被两处引用、没有回到链上）不是循环。
  assert.equal(await resolveCssImports('@import "d.css";', base, fetchText), '.e{} .e{}');
});

test('resolveCssImports：@import 带 layer() / supports() 不包进 @media，返回 null 让整帧退回 iframe', async () => {
  const base = 'http://x/sites/demo_page/';
  const fetched = [];
  const fetchText = async (href) => { fetched.push(href); return '.a{x:1}'; };
  assert.equal(importNeedsFrame(''), false);
  assert.equal(importNeedsFrame('screen and (max-width: 600px)'), false);
  assert.equal(importNeedsFrame('layer(kit)'), true);
  assert.equal(importNeedsFrame('supports(display: grid)'), true);
  assert.equal(importNeedsFrame('layer'), true);
  assert.equal(importNeedsFrame('screen { x'), true);
  // 不取被引用的表，也不产出 @media layer(...) 这种非法 CSS。
  assert.equal(await resolveCssImports('@import url("a.css") layer(kit);', base, fetchText), null);
  assert.equal(await resolveCssImports('@import "a.css" supports(display: flex);', base, fetchText), null);
  assert.deepEqual(fetched, []);
  // 被展开的表自己带这种 import，外层一并退回。
  const nested = new Map([['http://x/sites/demo_page/a.css', '@import "b.css" layer(x);']]);
  assert.equal(await resolveCssImports('@import url("a.css");', base, async (href) => nested.get(href)), null);
});

test('parseCssImports：字符串、url("…")、无引号 url(…) 都认；注释、字符串里的 @import 字样不算', () => {
  const css = '@import url(./x.css);\n@IMPORT url( y.css ) print;@import"z.css";@import url(\'w.css\') screen and (width >= 600px);'
    + '/* @import "c.css"; */ .a::after{content:"@import \\"s.css\\";"} .b{background:url(i@import.png)}';
  const rows = parseCssImports(css);
  assert.deepEqual(rows.map((r) => [r.href, r.condition]), [
    ['./x.css', ''], ['y.css', 'print'], ['z.css', ''], ['w.css', 'screen and (width >= 600px)'],
  ]);
  assert.equal(css.slice(rows[0].start, rows[0].end), '@import url(./x.css);');
  assert.deepEqual(parseCssImports('.a{color:red}'), []);
});

test('parseCssImports：认不出的 @import 一律 null（整帧退回 iframe），不丢规则当成成功', () => {
  for (const css of [
    '@import url(./a.css) layer;', // 裸 layer
    '@import "a.css" layer(kit);',
    '@import url(a.css) supports(display:grid);',
    '@import "a.css" scope(.x);',
    '@import url(a b.css);', // 无引号 url 里有空白
    '@import url(a\\(b.css);', // 带转义
    '@import url("a.css" );x{}@import a.css;', // 第二条不是字符串也不是 url()
    '@import "a.css"', // 没有分号
    '@import "a.css" "b";', // 条件里有引号
    '@import',
  ]) assert.equal(parseCssImports(css), null, css);
});

test('resolveCssImports：无引号 url() 的 import 照样展开；认不出的 import 返回 null', async () => {
  const base = 'http://x/sites/demo_page/';
  const fetchText = async (href) => ({ [`${base}color.css`]: '[data-probe]{color:rgb(255,0,0)}' })[href];
  assert.equal(await resolveCssImports('@import url(./color.css);.a{}', base, fetchText), '[data-probe]{color:rgb(255,0,0)}.a{}');
  assert.equal(await resolveCssImports('@import url(./color.css) layer;', base, fetchText), null);
  // 被展开的表里藏着认不出的 import：外层一并 null。
  const nested = async (href) => (href.endsWith('a.css') ? '@import foo;' : '');
  assert.equal(await resolveCssImports('@import "a.css";', base, nested), null);
  // 注释与字符串原样保留，不吃掉其后的规则。
  assert.equal(await resolveCssImports('.q::after{content:"/*"} .r{}', base, fetchText), '.q::after{content:"/*"} .r{}');
});

test('absolutizeSrcset：候选地址绝对化，描述符保留', () => {
  const base = 'http://x/sites/demo_page/';
  assert.equal(absolutizeSrcset('a.png 1x, img/b.png 2x', base), 'http://x/sites/demo_page/a.png 1x, http://x/sites/demo_page/img/b.png 2x');
  assert.equal(absolutizeSrcset('/kits/a.png 1x', base), '/kits/a.png 1x');
  assert.equal(absolutizeSrcset('a.png', base), 'http://x/sites/demo_page/a.png');
});

test('absolutizeAttrValue：fragment 与 data: 不动（sprite 的 #c-chev 必须留在本树）', () => {
  const base = 'http://x/sites/demo_page/';
  assert.equal(absolutizeAttrValue('#c-chev', base), '#c-chev');
  assert.equal(absolutizeAttrValue('img/a.png', base), 'http://x/sites/demo_page/img/a.png');
  assert.equal(absolutizeAttrValue('data:image/png;base64,AA', base), 'data:image/png;base64,AA');
  assert.equal(absolutizeAttrValue('/kits/a.png', base), '/kits/a.png');
});
