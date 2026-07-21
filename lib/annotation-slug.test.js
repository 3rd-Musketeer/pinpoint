import assert from 'node:assert/strict';
import test from 'node:test';

import { annotationSlug } from './annotation-slug.js';

test('annotationSlug collapses consecutive non-word chars to one underscore', () => {
  // Bug fix: the old client regex lacked `+` and produced a__b while the
  // server produced a_b, drifting the SSE page key. Dashes/dots are kept.
  assert.equal(annotationSlug('a!!b'), 'a_b');
  assert.equal(annotationSlug('a!!?b'), 'a_b');
  assert.equal(annotationSlug('a--b'), 'a--b'); // - is in the kept set
});

test('annotationSlug keeps word/CJK/dot/dash and truncates to 80', () => {
  assert.equal(annotationSlug('today~abc123'), 'today_abc123');
  assert.equal(annotationSlug('概览.html'), '概览.html');
  const long = 'x'.repeat(120);
  assert.equal(annotationSlug(long).length, 80);
});

test('annotationSlug falls back to index only for empty input', () => {
  assert.equal(annotationSlug(''), 'index');
  assert.equal(annotationSlug('!!!'), '_'); // symbols collapse to one _ (truthy)
});

test('client PAGE format slugifies identically to the server', () => {
  // PAGE = filename + '~' + pathHash(base36). Single ~ → single _ both sides.
  const page = 'sparkle-postmeeting.html~abc12';
  assert.equal(annotationSlug(page), 'sparkle-postmeeting.html_abc12');
});
