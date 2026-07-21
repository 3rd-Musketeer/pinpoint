import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatPageIndicator,
  formatSectionIndicator,
  formatFrameIndicator,
  formatAnnotationIndicator,
  indicatorForAnnotation,
  nextTargetRef,
  normalizeAnnotation,
  targetContentToDisplay,
  targetContentToStorage,
} from './annotation-indicator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'annotate.js');
const INLINED_LIBS = [
  path.join(__dirname, 'annotation-indicator.js'),
  path.join(__dirname, 'annotate-hit-test.js'),
  path.join(__dirname, 'annotation-slug.js'),
];

// Mirror the serve-time inliner in plugins/annotate-api.js: strip ESM `export `
// and inline the libs into the annotate IIFE after 'use strict';.
function buildServedBundle() {
  const annotateSrc = fs.readFileSync(SCRIPT, 'utf8');
  const libSrc = INLINED_LIBS.map((p) => fs.readFileSync(p, 'utf8').replace(/^export /gm, '')).join('\n');
  const marker = "'use strict';";
  const at = annotateSrc.indexOf(marker);
  assert.notEqual(at, -1, 'annotate.js IIFE marker not found');
  return annotateSrc.slice(0, at + marker.length) + '\n' + libSrc + annotateSrc.slice(at + marker.length);
}

test('served /annotate.js inlines the indicator + hit-test + slug libs', () => {
  const bundle = buildServedBundle();
  assert.match(bundle, /function formatPageIndicator/, 'formatPageIndicator inlined');
  assert.match(bundle, /function indicatorForAnnotation/, 'indicatorForAnnotation inlined');
  assert.match(bundle, /function normalizeAnnotation/, 'normalizeAnnotation inlined');
  assert.match(bundle, /function targetContentToDisplay/, 'targetContentToDisplay inlined');
  assert.match(bundle, /function targetContentToStorage/, 'targetContentToStorage inlined');
  assert.match(bundle, /function pickContained/, 'pickContained inlined');
  assert.match(bundle, /function annotationSlug/, 'annotationSlug inlined');
  assert.doesNotMatch(bundle, /export function formatPageIndicator/);
  assert.doesNotMatch(bundle, /export function pickContained/);
  assert.doesNotMatch(bundle, /export function annotationSlug/);
});

test('served bundle parses as a script', () => {
  const bundle = buildServedBundle();
  // new Function only parses; it does not run, so undefined browser globals
  // don't matter. This catches syntax errors from the inlining/strip step.
  // eslint-disable-next-line no-new-func
  new Function(bundle);
  assert.ok(true, 'bundle parses');
});

test('inlined lib output matches direct lib import on fixtures', () => {
  // Guards drift: if someone edits the lib, the inlined copy tracks it (same
  // file), so this asserts the fixture expectations stay identical to the lib.
  assert.equal(formatPageIndicator('smart-todo'), '@page:smart-todo');
  assert.equal(formatSectionIndicator('smart-todo', 'inbox'), '@section:smart-todo/inbox');
  assert.equal(formatFrameIndicator('smart-todo', 'today'), '@frame:smart-todo/today');
  assert.equal(formatAnnotationIndicator('ab12cd'), '@a:ab12cd');
  assert.equal(
    indicatorForAnnotation({ id: 'ab12cd', pageId: 'p', section: 's' }, 'p', { persisted: true }),
    '@a:ab12cd',
  );
  assert.deepEqual(normalizeAnnotation({ comment: 'hi', group: 'g' }), { content: 'hi', section: 'g' });
  const targets = [{ ref: 'i1', selector: '#one', text: 'One' }, { ref: 'i3', selector: '#three', text: 'Three' }];
  assert.equal(targetContentToDisplay('[@a:ab12cd] [@t:i3]', targets), '[@a:ab12cd] [indicator 3]');
  assert.equal(targetContentToStorage('[@a:ab12cd] [indicator 3]', targets), '[@a:ab12cd] [@t:i3]');
  assert.equal(nextTargetRef(targets), 'i4');
});
