import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ARTICLE_PAGE_ID_PATTERN,
  articlePageId,
  CANVAS_LEDGER,
  CANVAS_SHELLS,
  ENTRY_OR_ARTICLE_ID_PATTERN,
  isReservedProjectId,
  isReservedSegment,
  isSectionLetter,
  parseArticlePageId,
  PROSE_LEDGER,
  refKey,
  RESERVED_ARTICLE_IDS,
  RESERVED_TOP_SEGMENTS,
  sectionLetter,
} from './project-ids.js';
import { ENTRY_ID_PATTERN, PAGE_ID_PATTERN } from './registry-ids.js';

test('project-ids is a leaf: imports nothing but the shared registry-ids leaf', () => {
  const source = fs.readFileSync(new URL('./project-ids.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./registry-ids.js']);
});

test('articlePageId / parseArticlePageId round-trip; bad parts throw; other shapes parse to null', () => {
  assert.equal(articlePageId('browser-use', 'flow'), 'browser-use_flow');
  assert.deepEqual(parseArticlePageId('browser-use_flow'), { projectId: 'browser-use', articleId: 'flow' });
  assert.throws(() => articlePageId('Bad', 'flow'), /ENTRY_ID_PATTERN|必须匹配/);
  assert.throws(() => articlePageId('a_b', 'flow'));
  for (const id of ['pinpoint', 'a_b_c', '_a', 'a_', 'A_b', '', null, undefined]) assert.equal(parseArticlePageId(id), null, String(id));
  // 文章页 id 永远不是条目 id，但仍是页 id。
  assert.ok(!ENTRY_ID_PATTERN.test('demo_flow') && PAGE_ID_PATTERN.test('demo_flow') && ARTICLE_PAGE_ID_PATTERN.test('demo_flow'));
});

test('ENTRY_OR_ARTICLE_ID_PATTERN = entry id or article page id', () => {
  for (const id of ['pinpoint', 'demo_flow', 'a-1_b-2']) assert.ok(ENTRY_OR_ARTICLE_ID_PATTERN.test(id), id);
  for (const id of ['a_b_c', 'Demo', '_x', 'x_', '']) assert.ok(!ENTRY_OR_ARTICLE_ID_PATTERN.test(id), id);
});

test('reserved segments: the table, the e2e artifact prefixes, and the article second segment', () => {
  for (const name of RESERVED_TOP_SEGMENTS) assert.ok(isReservedSegment(name) && isReservedProjectId(name), name);
  assert.ok(isReservedProjectId('test-results-5420') && isReservedProjectId('playwright-report'));
  assert.ok(!isReservedProjectId('browser-use') && !isReservedSegment('test-resultsx'));
  assert.deepEqual([...RESERVED_ARTICLE_IDS], ['concepts']);
});

test('refKey: NFC, trimmed, case-insensitive', () => {
  assert.equal(refKey('  Confirm-Card '), 'confirm-card');
  assert.equal(refKey('é'), refKey('é'));
});

test('section letters, shells and ledger names', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 701, 702].map(sectionLetter), ['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  assert.equal(sectionLetter(-3), 'A');
  assert.ok(isSectionLetter('AB') && !isSectionLetter('a') && !isSectionLetter('') && !isSectionLetter(1));
  assert.deepEqual(CANVAS_SHELLS, ['app', 'lock', 'doc', 'comp']);
  assert.ok(Object.isFrozen(CANVAS_SHELLS));
  assert.equal(CANVAS_LEDGER, '@canvas');
  assert.equal(PROSE_LEDGER, '@prose');
});
