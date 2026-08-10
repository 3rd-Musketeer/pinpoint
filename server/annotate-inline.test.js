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
} from '../lib/annotation-indicator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'client', 'annotate.js');
const INLINED_LIBS = [
  path.join(ROOT, 'lib', 'annotation-indicator.js'),
  path.join(ROOT, 'client', 'lib', 'annotate-hit-test.js'),
  path.join(ROOT, 'lib', 'annotation-slug.js'),
  path.join(ROOT, 'lib', 'annotate-page-key.js'),
  path.join(ROOT, 'lib', 'annotate-clip.js'),
  path.join(ROOT, 'lib', 'annotate-bubble.js'),
  path.join(ROOT, 'lib', 'ann-row.js'),
];
const INLINED_CSS = [
  { name: 'ANN_LIST_CSS', path: path.join(ROOT, 'lib', 'ann-list.css') },
];

// Mirror the serve-time inliner in server/annotate-api.js: strip ESM `export `
// and inline the libs into the annotate IIFE after 'use strict';. Stylesheets
// land as JSON-quoted JS string constants.
function buildServedBundle() {
  const annotateSrc = fs.readFileSync(SCRIPT, 'utf8');
  const libSrc = INLINED_LIBS.map((p) => fs.readFileSync(p, 'utf8').replace(/^export /gm, '')).join('\n');
  const cssSrc = INLINED_CSS.map((c) => `var ${c.name} = ${JSON.stringify(fs.readFileSync(c.path, 'utf8'))};`).join('\n');
  const marker = "'use strict';";
  const at = annotateSrc.indexOf(marker);
  assert.notEqual(at, -1, 'annotate.js IIFE marker not found');
  return annotateSrc.slice(0, at + marker.length) + '\n' + libSrc + '\n' + cssSrc + annotateSrc.slice(at + marker.length);
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
  assert.match(bundle, /function pageKeyFromPathname/, 'pageKeyFromPathname inlined');
  assert.match(bundle, /function bubbleInnerHtml/, 'bubbleInnerHtml inlined');
  assert.match(bundle, /function intersectRects/, 'intersectRects inlined');
  assert.match(bundle, /function clipByRects/, 'clipByRects inlined');
  assert.match(bundle, /function annRowModel/, 'annRowModel inlined');
  assert.match(bundle, /function annRowCap/, 'annRowCap inlined');
  assert.match(bundle, /function annMarkBroken/, 'annMarkBroken inlined');
  assert.doesNotMatch(bundle, /export function formatPageIndicator/);
  assert.doesNotMatch(bundle, /export function pickContained/);
  assert.doesNotMatch(bundle, /export function annotationSlug/);
  assert.doesNotMatch(bundle, /export function pageKeyFromPathname/);
  assert.doesNotMatch(bundle, /export function intersectRects/);
  assert.doesNotMatch(bundle, /export function annRowModel/);
});

test('served /annotate.js injects the shared list CSS as a JS string constant', () => {
  const bundle = buildServedBundle();
  assert.match(bundle, /var ANN_LIST_CSS = "/, 'ANN_LIST_CSS constant injected');
  // The constant carries the shared row rules for both consumer scopes, and
  // the client <style> block references it (single-file client, no request).
  assert.match(bundle, /#wbann-list \.wb-ann-item/, 'workbench scope in the CSS payload');
  assert.match(bundle, /#ann-sidebar \.wb-ann-item--broken/, 'client scope in the CSS payload');
  assert.match(bundle, /ANN_LIST_CSS,/, 'style array consumes ANN_LIST_CSS');
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
  assert.equal(formatPageIndicator('demo-app'), '@page:demo-app');
  assert.equal(formatSectionIndicator('demo-app', 'inbox'), '@section:demo-app/inbox');
  assert.equal(formatFrameIndicator('demo-app', 'today'), '@frame:demo-app/today');
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
