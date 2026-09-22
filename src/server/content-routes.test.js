import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContentFile, rewriteContentUrl } from './content-routes.js';

test('rewriteContentUrl maps the served URL prefixes onto their disk location', () => {
  assert.equal(rewriteContentUrl('/kits/ios/ios-kit.css'), '/content/kits/ios/ios-kit.css');
  assert.equal(rewriteContentUrl('/previews/_index.json'), '/content/previews/_index.json');
  assert.equal(rewriteContentUrl('/lib/ann-list.css'), '/src/shared/ann-list.css');
  assert.equal(rewriteContentUrl('/panel.html'), '/src/pages/panel.html');
});

test('rewriteContentUrl keeps the query string and leaves unmapped URLs alone', () => {
  assert.equal(rewriteContentUrl('/kits/ios/ios-kit.js?t=1'), '/content/kits/ios/ios-kit.js?t=1');
  assert.equal(rewriteContentUrl('/panel.html?entry=demo'), '/src/pages/panel.html?entry=demo');
  assert.equal(rewriteContentUrl('/annotate.js'), '/annotate.js');
  assert.equal(rewriteContentUrl('/sites/demo/index.html'), '/sites/demo/index.html');
});

test('rewriteContentUrl does not project a traversal back under content/', () => {
  for (const url of [
    '/previews/../../package.json',
    '/previews/%2e%2e/%2e%2e/package.json',
    '/previews/%2E%2E/%2E%2E/package.json',
    '/kits/../../package.json',
    '/lib/%2e%2e/%2e%2e/package.json',
  ]) {
    assert.equal(rewriteContentUrl(url), url, url);
  }
});

test('rewriteContentUrl still maps a traversal that stays inside the prefix', () => {
  assert.equal(
    rewriteContentUrl('/previews/demo/../shared/screen.html'),
    '/content/previews/demo/../shared/screen.html',
  );
});

test('rewriteContentUrl passes through undecodable percent escapes untouched', () => {
  assert.equal(rewriteContentUrl('/previews/%zz/screen.html'), '/previews/%zz/screen.html');
});

test('rewriteContentUrl leaves percent encoding in the mapped remainder intact', () => {
  assert.equal(
    rewriteContentUrl('/previews/my%20page/screen.html'),
    '/content/previews/my%20page/screen.html',
  );
});

/* ---- 缺文件答真 404（2026-09-04；旧行为是掉进 vite 的 SPA fallback 拿 200 HTML） ---- */

function fakeDisk(entries) {
  return (diskPath) => entries[diskPath] || null;
}

test('resolveContentFile passes through anything the prefixes do not map', () => {
  const exists = fakeDisk({});
  assert.deepEqual(resolveContentFile('/annotate.js', exists), { action: 'pass', url: '/annotate.js' });
  assert.deepEqual(resolveContentFile('/sites/demo/x.css', exists), { action: 'pass', url: '/sites/demo/x.css' });
  // 归一后逃出前缀的穿越同样不归本插件管（rewriteContentUrl 已原样透传）
  assert.deepEqual(resolveContentFile('/previews/%2e%2e/%2e%2e/package.json', exists),
    { action: 'pass', url: '/previews/%2e%2e/%2e%2e/package.json' });
});

test('resolveContentFile serves an existing file and keeps the query string', () => {
  const exists = fakeDisk({ '/content/kits/ios/ios-kit.css': 'file', '/src/pages/panel.html': 'file' });
  assert.deepEqual(resolveContentFile('/kits/ios/ios-kit.css', exists),
    { action: 'serve', url: '/content/kits/ios/ios-kit.css' });
  assert.deepEqual(resolveContentFile('/kits/ios/ios-kit.css?t=42', exists),
    { action: 'serve', url: '/content/kits/ios/ios-kit.css?t=42' });
  assert.deepEqual(resolveContentFile('/panel.html?entry=demo', exists),
    { action: 'serve', url: '/src/pages/panel.html?entry=demo' });
});

test('resolveContentFile answers 404 for a missing file, naming the requested URL', () => {
  const exists = fakeDisk({ '/content/previews/library': 'dir' });
  assert.deepEqual(resolveContentFile('/previews/library/missing.json', exists),
    { action: 'notFound', url: '/previews/library/missing.json' });
  assert.deepEqual(resolveContentFile('/kits/nope.css', exists),
    { action: 'notFound', url: '/kits/nope.css' });
  assert.deepEqual(resolveContentFile('/lib/gone.css?t=1', exists),
    { action: 'notFound', url: '/lib/gone.css?t=1' });
});

test('resolveContentFile serves a directory only when it holds an index.html', () => {
  const withIndex = fakeDisk({
    '/content/previews/library': 'dir',
    '/content/previews/library/index.html': 'file',
  });
  assert.deepEqual(resolveContentFile('/previews/library/', withIndex),
    { action: 'serve', url: '/content/previews/library/' });
  const bare = fakeDisk({ '/content/previews/library': 'dir' });
  assert.deepEqual(resolveContentFile('/previews/library/', bare),
    { action: 'notFound', url: '/previews/library/' });
});
