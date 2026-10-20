// B9：标注框里中文后接 @ 不弹引用候选。触发规则抽成 mentionContextAt 纯函数
// 单测；只留 mention.js 自己，四个依赖换成空替身（它们各自拉 CSS，node 装不下）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const STUBS = {
  'anchor.js': `export function markElementTargets() { return []; }`,
  'composer.js': `export function closeMention() {}`,
  'floating.js': `export function computePosition() {}
export function offset() {}
export function shift() {}`,
  'marks.js': `export function annotationContent() { return ''; }
export function annotationSectionLabel() { return ''; }
export function contentToDisplay() { return ''; }
export function ensureMarkId() {}`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.endsWith('/annotate/mention.js') && specifier.startsWith('./')) {
      const name = specifier.slice(2);
      if (STUBS[name]) return { url: 'stub:mention/' + name, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:mention/')) {
      return { format: 'module', source: STUBS[url.slice('stub:mention/'.length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { mentionContextAt } = await import('./mention.js');

test('汉字后接 @ 触发候选：query 是 @ 后到光标的连续非空白（B9）', () => {
  // 「改这里」后敲 @：start 指向 @，query 空。
  assert.deepEqual(mentionContextAt('改这里@', 4), { start: 3, end: 4, query: '' });
  // 接着敲 11：候选拿 "11" 当过滤词，替换范围是 @11 整段。
  assert.deepEqual(mentionContextAt('改这里@11', 6), { start: 3, end: 6, query: '11' });
  // 光标移走（@ 前面）不触发。
  assert.equal(mentionContextAt('改这里@11', 3), null);
});

test('行首、空白、全角标点后接 @ 都触发', () => {
  assert.deepEqual(mentionContextAt('@', 1), { start: 0, end: 1, query: '' });
  assert.deepEqual(mentionContextAt('look @', 6), { start: 5, end: 6, query: '' });
  assert.deepEqual(mentionContextAt('这里，@', 4), { start: 3, end: 4, query: '' });
  assert.deepEqual(mentionContextAt('第一行\n@', 7), { start: 6, end: 7, query: '' });
});

test('ASCII 词字符后接 @ 不触发：email@host 不误弹，@ 连 @ 也不弹', () => {
  assert.equal(mentionContextAt('mail me at user@example.com', 27), null);
  assert.equal(mentionContextAt('abc@', 4), null);
  assert.equal(mentionContextAt('1@', 2), null);
  assert.equal(mentionContextAt('@@', 2), null);
});
