import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotationMatchesIndicator,
  formatAnnotationIndicator,
  formatFrameIndicator,
  formatPageIndicator,
  formatSectionIndicator,
  indicatorForAnnotation,
  nextTargetRef,
  normalizeAnnotation,
  normalizeDoc,
  parseIndicator,
  removeTargetContentRef,
  targetContentToDisplay,
  targetContentToStorage,
} from './annotation-indicator.js';

test('formats short hierarchical indicators', () => {
  assert.equal(formatPageIndicator('smart-todo'), '@page:smart-todo');
  assert.equal(formatSectionIndicator('smart-todo', 'inbox'), '@section:smart-todo/inbox');
  assert.equal(formatFrameIndicator('smart-todo', 'today'), '@frame:smart-todo/today');
  assert.equal(formatAnnotationIndicator('ab12cd'), '@a:ab12cd');
});

test('parses indicators and rejects junk', () => {
  assert.deepEqual(parseIndicator('@page:library'), { kind: 'page', pageId: 'library' });
  assert.deepEqual(parseIndicator('@section:library/msg-flow'), {
    kind: 'section',
    pageId: 'library',
    sectionId: 'msg-flow',
  });
  assert.deepEqual(parseIndicator('@frame:library/onboard'), {
    kind: 'frame',
    pageId: 'library',
    screenId: 'onboard',
  });
  assert.deepEqual(parseIndicator('@a:ab12cd'), { kind: 'annotation', id: 'ab12cd' });
  assert.equal(parseIndicator('@m:ab12cd'), null);
  assert.equal(parseIndicator('page:library'), null);
});

test('scope match filters annotations', () => {
  const a = {
    id: 'ab12cd',
    pageId: 'smart-todo',
    section: 'inbox',
    screenId: 'today',
  };
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@a:ab12cd')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@page:smart-todo')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@section:smart-todo/inbox')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@frame:smart-todo/today')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@section:smart-todo/other')), false);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@page:library')), false);
});

test('scope match rejects annotations missing pageId (no soft match)', () => {
  const legacy = { id: 'zz99aa', section: 'inbox', screenId: 'today' };
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@a:zz99aa')), true);
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@page:smart-todo')), false);
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@section:smart-todo/inbox')), false);
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@frame:smart-todo/today')), false);
});

test('indicatorForAnnotation prefers kind then @a; unsaved falls back to scope', () => {
  assert.equal(
    indicatorForAnnotation({ indicatorKind: 'page', pageId: 'library' }),
    '@page:library',
  );
  assert.equal(
    indicatorForAnnotation({
      indicatorKind: 'section',
      pageId: 'library',
      section: 'feed',
    }),
    '@section:library/feed',
  );
  assert.equal(
    indicatorForAnnotation({
      indicatorKind: 'frame',
      pageId: 'library',
      screenId: 'onboard',
    }),
    '@frame:library/onboard',
  );
  assert.equal(
    indicatorForAnnotation({ id: 'ab12cd', pageId: 'library', screenId: 'onboard' }),
    '@a:ab12cd',
  );
  assert.equal(
    indicatorForAnnotation(
      { id: 'ab12cd', pageId: 'library', section: 'feed', screenId: 'onboard' },
      '',
      { persisted: false },
    ),
    '@section:library/feed',
  );
  assert.equal(
    indicatorForAnnotation(
      { id: 'ab12cd', pageId: 'library', screenId: 'onboard' },
      '',
      { persisted: false },
    ),
    '@frame:library/onboard',
  );
});

test('normalizeAnnotation upgrades legacy fields and mentions', () => {
  const a = normalizeAnnotation({
    n: 1,
    id: 'ab12cd',
    comment: 'see [@m:zz99aa] please',
    group: 'inbox',
    groupLabel: 'Inbox',
    mentions: ['zz99aa'],
  });
  assert.equal(a.content, 'see [@a:zz99aa] please');
  assert.equal(a.section, 'inbox');
  assert.equal(a.sectionLabel, 'Inbox');
  assert.equal(a.comment, undefined);
  assert.equal(a.group, undefined);
  assert.deepEqual(a.mentions, ['zz99aa']);
});

test('normalizeDoc dual-reads marks and writes annotations shape', () => {
  const doc = normalizeDoc({
    page: 'index.html',
    revision: 3,
    marks: [{ n: 1, comment: 'hi', group: 'a', groupLabel: 'A' }],
  });
  assert.equal(doc.revision, 3);
  assert.equal(doc.annotations.length, 1);
  assert.equal(doc.annotations[0].content, 'hi');
  assert.equal(doc.annotations[0].section, 'a');
  assert.equal(doc.marks, undefined);
});

test('normalizeAnnotation upgrades element targets with stable refs and compatibility mirrors', () => {
  const single = normalizeAnnotation({
    type: 'element',
    selector: '#first',
    text: 'First',
  });
  assert.deepEqual(single.targets, [{ ref: 'i1', selector: '#first', text: 'First' }]);
  assert.equal(single.selector, '#first');
  assert.equal(single.text, 'First');

  const multi = normalizeAnnotation({
    type: 'element',
    selector: '#stale',
    text: 'Stale',
    targets: [
      { selector: '#first', text: 'First' },
      { ref: 'i7', selector: '#second', text: 'Second' },
      { selector: '#first', text: 'Duplicate' },
    ],
  });
  assert.deepEqual(multi.targets, [
    { ref: 'i1', selector: '#first', text: 'First' },
    { ref: 'i7', selector: '#second', text: 'Second' },
  ]);
  assert.equal(multi.selector, '#first');
  assert.equal(multi.text, 'First');
  assert.equal(nextTargetRef(multi.targets), 'i8');
});

test('target content converts display indicators without disturbing annotation mentions', () => {
  const targets = [
    { ref: 'i1', selector: '#first', text: 'First' },
    { ref: 'i4', selector: '#second', text: 'Second' },
  ];
  const stored = 'Use [@t:i1], align [@t:i4], keep [@a:ab12cd], and inspect [@t:i9].';
  const display = targetContentToDisplay(stored, targets);
  assert.equal(
    display,
    'Use [indicator 1], align [indicator 4], keep [@a:ab12cd], and inspect [missing indicator i9].',
  );
  assert.equal(targetContentToStorage(display, targets), stored);
});

test('removing a target strips only its inline references and never renumbers survivors', () => {
  const content = '[indicator 1] reference; align [indicator 4] and [indicator 4].';
  assert.equal(
    removeTargetContentRef(content, 'i4'),
    '[indicator 1] reference; align and.',
  );
  assert.equal(nextTargetRef([{ ref: 'i1' }, { ref: 'i4' }]), 'i5');
});
