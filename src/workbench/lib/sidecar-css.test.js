import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cssImportUrls,
  isRelativeAssetUrl,
  rebaseAssetUrl,
  rewriteFragmentAssetUrls,
} from './sidecar-css.js';

const BASE = '/sites/chat-cards/';

test('isRelativeAssetUrl separates relative urls from absolute and protocol ones', () => {
  assert.equal(isRelativeAssetUrl('./mc.css'), true);
  assert.equal(isRelativeAssetUrl('mc.css'), true);
  assert.equal(isRelativeAssetUrl('sub/mc.css'), true);
  assert.equal(isRelativeAssetUrl('/sites/chat-cards/mc.css'), false);
  assert.equal(isRelativeAssetUrl('https://example.com/mc.css'), false);
  assert.equal(isRelativeAssetUrl('//example.com/mc.css'), false);
  assert.equal(isRelativeAssetUrl('data:text/css,a{}'), false);
  assert.equal(isRelativeAssetUrl(''), false);
  assert.equal(isRelativeAssetUrl(null), false);
});

test('rebaseAssetUrl applies the JS sidecar rule and leaves absolute urls alone', () => {
  assert.equal(rebaseAssetUrl('./mc.css', BASE), '/sites/chat-cards/mc.css');
  assert.equal(rebaseAssetUrl('mc.css', BASE), '/sites/chat-cards/mc.css');
  assert.equal(rebaseAssetUrl('/sites/other/mc.css', BASE), '/sites/other/mc.css');
  assert.equal(rebaseAssetUrl('https://cdn.test/mc.css', BASE), 'https://cdn.test/mc.css');
});

test('rewriteFragmentAssetUrls rebases @import inside <style> in every spelling', () => {
  const html = [
    '<style>',
    '@import url("./mc.css");',
    "@import url('sub/b.css');",
    '@import url(c.css);',
    '@import "d.css";',
    '@import url("/sites/chat-cards/keep.css");',
    '@import url("https://cdn.test/keep.css");',
    '</style>',
  ].join('\n');
  const out = rewriteFragmentAssetUrls(html, BASE);
  assert.ok(out.includes('@import url("/sites/chat-cards/mc.css");'));
  assert.ok(out.includes("@import url('/sites/chat-cards/sub/b.css');"));
  assert.ok(out.includes('@import url(/sites/chat-cards/c.css);'));
  assert.ok(out.includes('@import "/sites/chat-cards/d.css";'));
  assert.ok(out.includes('@import url("/sites/chat-cards/keep.css");'));
  assert.ok(out.includes('@import url("https://cdn.test/keep.css");'));
});

test('rewriteFragmentAssetUrls keeps the media-query tail of an @import', () => {
  const out = rewriteFragmentAssetUrls('<style>@import url("./p.css") screen and (min-width:400px);</style>', BASE);
  assert.equal(out, '<style>@import url("/sites/chat-cards/p.css") screen and (min-width:400px);</style>');
});

test('rewriteFragmentAssetUrls rebases stylesheet links and ignores other links', () => {
  const html =
    '<link rel="stylesheet" href="./mc.css">' +
    '<link rel="preload" as="image" href="./hero.png">' +
    '<link rel="stylesheet" href="/sites/chat-cards/keep.css">';
  const out = rewriteFragmentAssetUrls(html, BASE);
  assert.ok(out.includes('<link rel="stylesheet" href="/sites/chat-cards/mc.css">'));
  assert.ok(out.includes('<link rel="preload" as="image" href="./hero.png">'));
  assert.ok(out.includes('<link rel="stylesheet" href="/sites/chat-cards/keep.css">'));
});

test('rewriteFragmentAssetUrls leaves markup outside <style> untouched', () => {
  const html = '<div class="ios-app">@import url("./nope.css")</div><style>@import url("./yes.css");</style>';
  const out = rewriteFragmentAssetUrls(html, BASE);
  assert.ok(out.includes('<div class="ios-app">@import url("./nope.css")</div>'));
  assert.ok(out.includes('@import url("/sites/chat-cards/yes.css");'));
});

test('rewriteFragmentAssetUrls is a no-op without html or base', () => {
  assert.equal(rewriteFragmentAssetUrls('', BASE), '');
  assert.equal(rewriteFragmentAssetUrls('<style>@import "x.css";</style>', ''), '<style>@import "x.css";</style>');
});

test('cssImportUrls lists every imported url in source order', () => {
  const css = '@import url("/sites/a/one.css");\n@import \'two.css\';\n@import url(three.css) print;';
  assert.deepEqual(cssImportUrls(css), ['/sites/a/one.css', 'two.css', 'three.css']);
  assert.deepEqual(cssImportUrls(''), []);
  assert.deepEqual(cssImportUrls(null), []);
});
