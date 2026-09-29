import assert from 'node:assert/strict';
import test from 'node:test';

import { hoistImportOnlyStyles } from './hoist-imports.js';

test('hoistImportOnlyStyles keeps one copy of identical import-only styles at the front', () => {
  const imp = '<style>@import url("/sites/p/p.css");</style>';
  const other = '<style>@import url("/sites/p/q.css");</style>';
  const own = '<style>.a{color:red}</style>';
  const out = hoistImportOnlyStyles('<div>' + imp + 'A</div><div>' + imp + own + 'B</div>' + other);
  assert.equal(out, imp + other + '<div>A</div><div>' + own + 'B</div>');
});
