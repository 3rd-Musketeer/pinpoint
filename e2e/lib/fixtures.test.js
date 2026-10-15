import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import { isMultiReactSymptom, multiReactMessage, duplicateReactEvidence } from './fixtures.js';

test('多份 React 的症状：认 React 的三种报错，不认普通页面错误', () => {
  for (const text of [
    'Invalid hook call. Hooks can only be called inside of the body of a function component.',
    "TypeError: Cannot read properties of null (reading 'useState')",
    "Cannot read properties of null (reading 'useRef')",
    'You might have more than one copy of React in the same app',
  ]) assert.equal(isMultiReactSymptom(text), true, text);
  for (const text of ["Cannot read properties of null (reading 'style')", 'Failed to load resource: 404', 'ResizeObserver loop'])
    assert.equal(isMultiReactSymptom(text), false, text);
  assert.match(multiReactMessage(['Invalid hook call.']), /Hooks/);
});

test('一份 React 的非法 Hook 调用保留原错，不断言缓存被覆盖', () => {
  const samples = [];
  const original = console.error;
  console.error = (...args) => samples.push(args.join(' '));
  try { React.useState(0); } catch (error) { samples.push(error.message); }
  finally { console.error = original; }
  assert.ok(samples.some(isMultiReactSymptom));
  const message = multiReactMessage(samples);
  assert.doesNotMatch(message, /环境：|缓存被覆盖|不是这条用例的问题/);
  assert.match(message, /Hooks 用法/);
  assert.match(message, /useState/);
});

test('多份 React 诊断需要重复依赖 URL 或明确的重复实例报错', () => {
  const samples = ['Invalid hook call.'];
  assert.deepEqual(duplicateReactEvidence(samples, ['http://localhost/.vite/deps/react.js?v=a', 'http://localhost/.vite/deps/react-dom.js?v=b']), []);
  assert.deepEqual(duplicateReactEvidence(samples, ['http://localhost/.vite/deps/react.js?v=a', 'http://localhost/.vite/deps/react.js?v=a']), []);
  const evidence = duplicateReactEvidence(samples, ['http://localhost/.vite/deps/chunk-ABC.js?v=a', 'http://localhost/.vite/deps/chunk-ABC.js?v=b']);
  assert.equal(evidence.length, 1);
  assert.match(multiReactMessage(samples, evidence), /不同的 \?v=/);
  assert.match(multiReactMessage(samples, evidence), /cacheDir/);
  assert.equal(duplicateReactEvidence(['Detected more than one copy of React']).length, 1);
  assert.deepEqual(duplicateReactEvidence(['You might have more than one copy of React in the same app']), []);
});
