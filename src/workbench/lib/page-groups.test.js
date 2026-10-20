import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAGE_KIND_ICONS,
  pageKindKey
} from './page-groups.js';

test('pageKindKey：画布 / 文档二分，每种都有图标', () => {
  assert.equal(pageKindKey({ id: 'x', kind: 'dir', mode: 'ios' }), 'canvas');
  assert.equal(pageKindKey({ id: 'x', kind: 'dir', mode: 'html' }), 'doc');
  assert.equal(pageKindKey({ id: 'x', kind: 'file', mode: 'html' }), 'doc');
  assert.equal(pageKindKey({ id: 'library', mode: 'ios' }), 'canvas');
  assert.equal(pageKindKey({ id: 'doc-library', mode: 'html' }), 'doc');
  for (const k of ['canvas', 'doc']) assert.ok(PAGE_KIND_ICONS[k]);
});
