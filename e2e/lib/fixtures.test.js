import assert from 'node:assert/strict';
import test from 'node:test';

import { isMultiReactSymptom, multiReactMessage } from './fixtures.js';

test('多份 React 的症状：认 React 的三种报错，不认普通页面错误', () => {
  for (const text of [
    'Invalid hook call. Hooks can only be called inside of the body of a function component.',
    "TypeError: Cannot read properties of null (reading 'useState')",
    "Cannot read properties of null (reading 'useRef')",
    'You might have more than one copy of React in the same app',
  ]) assert.equal(isMultiReactSymptom(text), true, text);
  for (const text of ["Cannot read properties of null (reading 'style')", 'Failed to load resource: 404', 'ResizeObserver loop'])
    assert.equal(isMultiReactSymptom(text), false, text);
  assert.match(multiReactMessage(['Invalid hook call.']), /^环境：vite 依赖缓存被覆盖/);
});
