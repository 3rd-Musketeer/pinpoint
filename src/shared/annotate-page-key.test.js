import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageKeyFromPathname } from './annotate-page-key.js';

test('pageKeyFromPathname matches the historic annotate.js formula', () => {
  const pathname = '/previews/doc-library/sample-report.html';
  let h = 0;
  for (let i = 0; i < pathname.length; i++) h = (h * 31 + pathname.charCodeAt(i)) >>> 0;
  const expected = 'sample-report.html~' + h.toString(36);
  assert.equal(pageKeyFromPathname(pathname), expected);
});

test('same filename under different directories yields different keys', () => {
  const a = pageKeyFromPathname('/previews/a/report.html');
  const b = pageKeyFromPathname('/previews/b/report.html');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('report.html~'));
  assert.ok(b.startsWith('report.html~'));
});

test('empty / missing pathname falls back to index.html', () => {
  assert.ok(pageKeyFromPathname('').startsWith('index.html~'));
  assert.ok(pageKeyFromPathname('/').startsWith('index.html~'));
});
