import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annMarkBroken,
  annMarkResolvable,
  annRowCap,
  annRowModel,
  annRowPreview,
  annRowTags,
  selectorExcerpt,
} from './ann-row.js';

test('selectorExcerpt keeps the last >-segment, trimmed and truncated', () => {
  assert.equal(selectorExcerpt('div.foo > span.bar'), 'span.bar');
  assert.equal(selectorExcerpt('  #solo  '), '#solo');
  assert.equal(selectorExcerpt('a > b > c', 2), 'c'.slice(0, 2));
  assert.equal(selectorExcerpt(''), '');
  assert.equal(selectorExcerpt(null), '');
  assert.equal(selectorExcerpt('x'.repeat(100)), 'x'.repeat(60));
});

test('annRowCap: region marks use the consumer label', () => {
  const mark = { type: 'region', text: 'ignored' };
  assert.equal(annRowCap(mark), '框选区域'); // client sidebar default
  assert.equal(annRowCap(mark, { region: '框选' }), '框选'); // workbench list
});

test('annRowCap: stored text wins and is truncated at textMax', () => {
  assert.equal(annRowCap({ text: 'hello' }), 'hello');
  assert.equal(annRowCap({ text: 'x'.repeat(50) }), 'x'.repeat(40));
  assert.equal(annRowCap({ text: 'x'.repeat(50) }, { textMax: 10 }), 'x'.repeat(10));
  // Whitespace-only text is truthy and stays (locks the current quirk).
  assert.equal(annRowCap({ text: '  ' }), '  ');
});

test('annRowCap: selector tail is the fallback, gated by selectorMax', () => {
  const mark = { selector: 'div.wrap > button.ok' };
  assert.equal(annRowCap(mark), 'button.ok');
  assert.equal(annRowCap({ selector: `'${'y'.repeat(70)}` }), `'${'y'.repeat(59)}`);
  // Workbench semantics: no selector fallback, straight to the element label.
  assert.equal(annRowCap(mark, { selectorMax: 0 }), '元素');
  assert.equal(annRowCap({}, { selectorMax: 0 }), '元素');
  assert.equal(annRowCap({ selector: ' > ' }), '元素'); // empty tail
});

test('annRowPreview trims and truncates; empty hides the line', () => {
  assert.equal(annRowPreview('  hello  '), 'hello');
  assert.equal(annRowPreview('x'.repeat(100)), 'x'.repeat(80));
  assert.equal(annRowPreview('x'.repeat(100), 5), 'xxxxx');
  assert.equal(annRowPreview(''), '');
  assert.equal(annRowPreview(null), '');
  assert.equal(annRowPreview(undefined), '');
});

test('annRowTags maps affordances to glyphs in a stable order', () => {
  assert.equal(annRowTags(null), '');
  assert.equal(annRowTags({}), '');
  assert.equal(annRowTags({ changeTo: 'x' }), '✎');
  assert.equal(annRowTags({ move: { to_point: [0, 0] } }), '↗');
  assert.equal(annRowTags({ images: ['a.png'] }), '🖼');
  assert.equal(annRowTags({ research: true }), '🔍');
  assert.equal(annRowTags({ mentions: ['ab12cd'] }), '@');
  assert.equal(
    annRowTags({ changeTo: 'x', move: {}, images: ['a'], research: true, mentions: ['m'] }),
    '✎ ↗ 🖼 🔍 @',
  );
  // Empty collections do not count.
  assert.equal(annRowTags({ images: [], mentions: [] }), '');
});

test('annMarkResolvable: element marks consult their normalized targets', () => {
  const seen = [];
  const has = (sel) => { seen.push(sel); return sel === '#live'; };
  const targets = [{ ref: 'i1', selector: '#dead' }, { ref: 'i2', selector: '#live' }];
  assert.equal(annMarkResolvable({ type: 'element' }, has, targets), true);
  assert.deepEqual(seen, ['#dead', '#live']);
  assert.equal(annMarkBroken({ type: 'element' }, has, targets), false);
  assert.equal(annMarkBroken({ type: 'element' }, () => false, targets), true);
  // No targets at all → broken.
  assert.equal(annMarkBroken({ type: 'element' }, has, []), true);
  assert.equal(annMarkBroken({ type: 'element' }, has, null), true);
  // Targets without a selector are skipped.
  assert.equal(annMarkBroken({ type: 'element' }, has, [{ ref: 'i1' }]), true);
});

test('annMarkResolvable: region/area marks use base then contains', () => {
  const has = (sel) => sel === '#base';
  assert.equal(annMarkResolvable({ base: { selector: '#base' } }, has), true);
  assert.equal(annMarkResolvable({ base: { selector: '#gone' } }, has), false);
  // contains is only consulted when base does not resolve.
  const mark = { base: { selector: '#gone' }, contains: [{ selector: '#a' }, { selector: '#base' }] };
  assert.equal(annMarkResolvable(mark, has), true);
  assert.equal(annMarkResolvable({ contains: [] }, has), false);
  assert.equal(annMarkResolvable({ contains: [null, {}] }, has), false);
  assert.equal(annMarkResolvable({}, has), false);
  assert.equal(annMarkBroken(null, has), true);
});

test('annRowModel assembles the shared row fields from mark + context', () => {
  const mark = { n: 3, text: 'target text', changeTo: 'x', mentions: ['m'] };
  // preview is the caller-final string — the model does not trim or truncate
  // (the workbench summary intentionally keeps its whitespace); callers that
  // want trim+truncate run annRowPreview first.
  assert.deepEqual(annRowModel(mark, { preview: annRowPreview('  note  '), broken: 1 }), {
    n: 3,
    cap: 'target text',
    preview: 'note',
    broken: true,
    tags: '✎ @',
  });
  // Workbench-flavoured cap options ride along in context.
  assert.equal(
    annRowModel({ n: 1, type: 'region' }, { cap: { region: '框选', selectorMax: 0 } }).cap,
    '框选',
  );
  // Defaults: empty preview, live row, no tags.
  assert.deepEqual(annRowModel({ n: 7, text: 't' }), {
    n: 7, cap: 't', preview: '', broken: false, tags: '',
  });
  assert.equal(annRowModel(null).n, 0);
});
