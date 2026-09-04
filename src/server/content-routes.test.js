import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteContentUrl } from './content-routes.js';

test('rewriteContentUrl maps the served URL prefixes onto their disk location', () => {
  assert.equal(rewriteContentUrl('/kits/ios/ios-kit.css'), '/content/kits/ios/ios-kit.css');
  assert.equal(rewriteContentUrl('/previews/_index.json'), '/content/previews/_index.json');
  assert.equal(rewriteContentUrl('/lib/ann-list.css'), '/src/shared/ann-list.css');
  assert.equal(rewriteContentUrl('/panel.html'), '/src/pages/panel.html');
  assert.equal(rewriteContentUrl('/starter.html'), '/src/pages/starter.html');
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
