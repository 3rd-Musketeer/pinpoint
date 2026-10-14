import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isClearableMark,
  isLegalMarkTransition,
  isLegalTransition,
  nextTargetRef,
  normalizeTargetRefs,
  normalizeAnnotation,
  normalizeDoc,
  parseIndicator,
  targetContentToDisplay,
  targetContentToStorage,
} from './annotation-indicator.js';

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

test('normalizeDoc 只认 annotations（磁盘上的账本没有旧 marks 键）', () => {
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

test('isClearableMark: 清空只带走未关闭的行，close 是执行历史留下来（决定 #11）', () => {
  assert.equal(isClearableMark({ status: 'open' }), true);
  assert.equal(isClearableMark({ status: 'check' }), true);
  assert.equal(isClearableMark({ status: 'done' }), true);
  assert.equal(isClearableMark({ status: 'close' }), false);
  assert.equal(isClearableMark({}), true, '缺省 open');
  assert.equal(isClearableMark(null), false, '非行不清');
});

test('normalizeTargetRefs keeps per-target screenId for cross-frame multi-select', () => {
  const out = normalizeTargetRefs([
    { ref: 'i1', selector: 'a', screenId: 'g3' },
    { ref: 'i2', selector: 'b', screenId: 'g4' },
    { ref: 'i3', selector: 'c' },
  ]);
  assert.deepEqual(out.map((t) => t.screenId), ['g3', 'g4', undefined]);
});
