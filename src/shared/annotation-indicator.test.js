import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotationMatchesIndicator,
  formatAnnotationIndicator,
  formatFrameIndicator,
  formatPageIndicator,
  formatSectionIndicator,
  indicatorForAnnotation,
  isLegalMarkTransition,
  isLegalTransition,
  nextTargetRef,
  normalizeAnnotation,
  normalizeDoc,
  parseIndicator,
  removeTargetContentRef,
  targetContentToDisplay,
  targetContentToStorage,
} from './annotation-indicator.js';

test('formats short hierarchical indicators', () => {
  assert.equal(formatPageIndicator('demo-app'), '@page:demo-app');
  assert.equal(formatSectionIndicator('demo-app', 'inbox'), '@section:demo-app/inbox');
  assert.equal(formatFrameIndicator('demo-app', 'today'), '@frame:demo-app/today');
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
    pageId: 'demo-app',
    section: 'inbox',
    screenId: 'today',
  };
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@a:ab12cd')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@page:demo-app')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@section:demo-app/inbox')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@frame:demo-app/today')), true);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@section:demo-app/other')), false);
  assert.equal(annotationMatchesIndicator(a, parseIndicator('@page:library')), false);
});

test('scope match rejects annotations missing pageId (no soft match)', () => {
  const legacy = { id: 'zz99aa', section: 'inbox', screenId: 'today' };
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@a:zz99aa')), true);
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@page:demo-app')), false);
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@section:demo-app/inbox')), false);
  assert.equal(annotationMatchesIndicator(legacy, parseIndicator('@frame:demo-app/today')), false);
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

test('normalizeAnnotation drops retired response data', () => {
  const annotation = normalizeAnnotation({
    id: 'ab12cd',
    content: '原标注',
    reply: { content: '  已修改  ', author: 'agent' },
  });
  assert.equal(annotation.reply, undefined);
});

test('isLegalTransition：owner 三态入 close，close 撤销回原态；升档只经 mark 端点', () => {
  // owner 完成：open / check / done 任一态单击入 close（2026-09-23 放开）。
  assert.equal(isLegalTransition('open', 'close'), true);
  assert.equal(isLegalTransition('check', 'close'), true);
  assert.equal(isLegalTransition('done', 'close'), true);
  // close 撤销 / 重新打开：回关闭前的原态，三种都放行。
  assert.equal(isLegalTransition('close', 'open'), true);
  assert.equal(isLegalTransition('close', 'check'), true);
  assert.equal(isLegalTransition('close', 'done'), true);
  // 恒等恒真。
  for (const status of ['open', 'check', 'done', 'close']) {
    assert.equal(isLegalTransition(status, status), true);
  }
  // 升档与无编辑降档仍拒：check / done 只经 mark 端点（R14）。
  assert.equal(isLegalTransition('open', 'check'), false);
  assert.equal(isLegalTransition('open', 'done'), false);
  assert.equal(isLegalTransition('check', 'done'), false);
  assert.equal(isLegalTransition('check', 'open'), false);
  assert.equal(isLegalTransition('done', 'open'), false);
  assert.equal(isLegalTransition('done', 'check'), false);
});

test('isLegalMarkTransition：mark 端点仍只收 open / check → check / done，不收 close', () => {
  assert.equal(isLegalMarkTransition('open', 'check'), true);
  assert.equal(isLegalMarkTransition('open', 'done'), true);
  assert.equal(isLegalMarkTransition('check', 'done'), true);
  assert.equal(isLegalMarkTransition('done', 'done'), false);
  assert.equal(isLegalMarkTransition('done', 'close'), false);
  assert.equal(isLegalMarkTransition('close', 'open'), false);
});

test('normalizeDoc 只认 annotations（旧 marks 键由 migrate-ledgers.mjs 迁净）', () => {
  const doc = normalizeDoc({
    page: 'index.html',
    revision: 3,
    annotations: [{ n: 1, content: 'hi', section: 'a' }],
  });
  assert.equal(doc.revision, 3);
  assert.equal(doc.annotations.length, 1);
  assert.equal(doc.annotations[0].content, 'hi');
  assert.equal(doc.marks, undefined);
  assert.deepEqual(normalizeDoc({ marks: [{ n: 1 }] }).annotations, [], '旧键不再被读');
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

test('normalizeTargetRefs 透传 target 的 ppId，非法值摘掉（决定 #15）', () => {
  const normalized = normalizeAnnotation({
    type: 'element',
    targets: [
      { selector: '#first', text: 'First', ppId: 'home.jsx:9@1' },
      { selector: '#second', text: 'Second', ppId: '' },
      { selector: '#third', text: 'Third', ppId: 42 },
    ],
  });
  assert.deepEqual(normalized.targets, [
    { ref: 'i1', selector: '#first', text: 'First', ppId: 'home.jsx:9@1' },
    { ref: 'i2', selector: '#second', text: 'Second' },
    { ref: 'i3', selector: '#third', text: 'Third' },
  ]);
  // 顶层只镜像 selector / text；ppId 属于 target，不出兼容镜像。
  assert.equal(normalized.ppId, undefined);
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
