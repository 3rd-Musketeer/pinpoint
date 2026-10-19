import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_BOOT_MARKER,
  absolutizeAttrValue,
  absolutizeSrcset,
  classifyFrameScript,
  cssHazard,
  importNeedsFrame,
  resolveCssImports,
  rewriteCssUrls,
  rewriteRootSelector,
} from './static-card-lib.js';

test('classifyFrameScript：ios-kit 与内联 frame-boot 是 boot，预览脚本与来路不明的脚本不是', () => {
  assert.equal(classifyFrameScript({ src: '/kits/ios/ios-kit.js' }), 'boot');
  assert.equal(classifyFrameScript({ src: 'http://127.0.0.1:7400/kits/ios/ios-kit.js' }), 'boot');
  assert.equal(classifyFrameScript({ text: `/**\n * ${FRAME_BOOT_MARKER}（阶段 5）。*/` }), 'boot');
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
  assert.equal(rewriteRootSelector(':root{--a:1} .x:root{y:2}'), ':host{--a:1} .x:host{y:2}');
  assert.equal(rewriteRootSelector('.rooty{a:1}'), '.rooty{a:1}');
});

test('resolveCssImports：递归展开 @import，带条件的包 @media，循环引用跳过', async () => {
  const base = 'http://x/sites/demo_page/';
  const texts = new Map([
    ['http://x/sites/demo_page/a.css', '@import url("b.css"); .a{x:1}'],
    ['http://x/sites/demo_page/b.css', '@import "a.css"; .b{y:2}'], // 循环回 a.css
    ['http://x/sites/demo_page/c.css', '.c{z:3}'],
  ]);
  const fetchText = async (href, seen) => resolveCssImports(texts.get(href), href, fetchText, seen);
  const out = await resolveCssImports(`@import url("a.css");@import "c.css" screen and (max-width: 600px);`, base, fetchText);
  assert.equal(out, ' .b{y:2} .a{x:1}@media screen and (max-width: 600px){.c{z:3}}');
  const seen2 = new Set();
  const again = await resolveCssImports('@import url("a.css");@import url("a.css");', base, fetchText, seen2);
  assert.equal((again.match(/\.a\{x:1\}/g) || []).length, 1); // 同一趟重复地址只展开一次
});

test('resolveCssImports：@import 带 layer() / supports() 不包进 @media，返回 null 让整帧退回 iframe', async () => {
  const base = 'http://x/sites/demo_page/';
  const fetched = [];
  const fetchText = async (href) => { fetched.push(href); return '.a{x:1}'; };
  assert.equal(importNeedsFrame(''), false);
  assert.equal(importNeedsFrame('screen and (max-width: 600px)'), false);
  assert.equal(importNeedsFrame('layer(kit)'), true);
  assert.equal(importNeedsFrame('supports(display: grid)'), true);
  // 不取被引用的表，也不产出 @media layer(...) 这种非法 CSS。
  assert.equal(await resolveCssImports('@import url("a.css") layer(kit);', base, fetchText), null);
  assert.equal(await resolveCssImports('@import "a.css" supports(display: flex);', base, fetchText), null);
  assert.deepEqual(fetched, []);
  // 被展开的表自己带这种 import，外层一并退回。
  const nested = new Map([['http://x/sites/demo_page/a.css', '@import "b.css" layer(x);']]);
  const fetchNested = async (href, seen) => resolveCssImports(nested.get(href), href, fetchNested, seen);
  assert.equal(await resolveCssImports('@import url("a.css");', base, fetchNested), null);
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
