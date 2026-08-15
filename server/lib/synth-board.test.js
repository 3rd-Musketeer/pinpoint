import assert from 'node:assert/strict';
import test from 'node:test';

import {
  siteFileSrc,
  synthesizeBoard,
  synthesizeDirBoard,
  synthesizeFileBoard,
} from './synth-board.js';

function fileEntry(extra = {}) {
  return { id: 'report', title: 'Report', kind: 'file', path: '/tmp/docs/My Report.html', ...extra };
}

function dirEntry(extra = {}) {
  return { id: 'site', title: 'Site', kind: 'dir', path: '/tmp/site', ...extra };
}

/** Fake readdir: names → Dirent-ish rows. */
function listDirOf(names) {
  return () => names.map((name) => ({ name, isFile: () => !name.endsWith('/') }));
}

test('synthesizeFileBoard: one doc screen whose src is the registered file, percent-encoded', () => {
  const board = synthesizeFileBoard(fileEntry());
  assert.deepEqual(board, {
    sections: [{
      id: 'main',
      title: 'Report',
      layout: 'column',
      shell: 'doc',
      screens: [{ id: 'index', title: 'Report', src: 'sites/report/My%20Report.html' }],
    }],
  });
});

test('synthesizeFileBoard: file 条目恒 doc —— board 字段不参与（手写 board ios 也合成）', () => {
  assert.ok(synthesizeFileBoard(fileEntry({ board: 'ios' })));
  assert.equal(synthesizeFileBoard(null), null);
  assert.equal(synthesizeFileBoard(dirEntry()), null);
});

test('synthesizeDirBoard: sorted top-level .html, slugged unique screen ids', () => {
  const board = synthesizeDirBoard(dirEntry(), listDirOf(['b.html', 'a b.html', 'a-b.html', 'notes.txt', 'sub/']));
  const screens = board.sections[0].screens;
  // 'a b.html' 与 'a-b.html' 折到同一 slug → 后者 -2；子目录与纯文本不进板
  assert.deepEqual(screens.map((s) => s.title), ['a b.html', 'a-b.html', 'b.html']);
  assert.deepEqual(screens.map((s) => s.id), ['a-b', 'a-b-2', 'b']);
  assert.deepEqual(screens.map((s) => s.src), ['sites/site/a%20b.html', 'sites/site/a-b.html', 'sites/site/b.html']);
});

test('synthesizeDirBoard: a filename that cannot slugify falls back to doc-N', () => {
  // 码位排序：图 U+56FE 在 报 U+62A5 前
  const board = synthesizeDirBoard(dirEntry(), listDirOf(['报表.html', '图表.html']));
  assert.deepEqual(board.sections[0].screens.map((s) => s.id), ['doc', 'doc-2']);
  assert.deepEqual(board.sections[0].screens.map((s) => s.src), [
    `sites/site/${encodeURIComponent('图表.html')}`,
    `sites/site/${encodeURIComponent('报表.html')}`,
  ]);
});

test('synthesizeDirBoard: no synthesis for ios-mode dirs, empty dirs, or missing dirs', () => {
  assert.equal(synthesizeDirBoard(dirEntry({ board: 'ios' }), listDirOf(['x.html'])), null);
  assert.equal(synthesizeDirBoard(dirEntry(), listDirOf(['notes.txt'])), null);
  assert.equal(synthesizeDirBoard(dirEntry(), () => { throw new Error('ENOENT'); }), null);
  assert.equal(synthesizeDirBoard(fileEntry(), listDirOf(['x.html'])), null, 'kind 不符');
});

test('synthesizeBoard dispatches by kind; url entries never synthesize', () => {
  assert.ok(synthesizeBoard(fileEntry()));
  assert.ok(synthesizeBoard(dirEntry(), listDirOf(['x.html'])));
  assert.equal(synthesizeBoard({ id: 'web', kind: 'url', url: 'https://web.localhost' }), null);
  assert.equal(synthesizeBoard(null), null);
});

test('siteFileSrc percent-encodes the filename', () => {
  assert.equal(siteFileSrc('x', 'plain.html'), 'sites/x/plain.html');
  assert.equal(siteFileSrc('x', 'A Page.html'), 'sites/x/A%20Page.html');
  assert.equal(siteFileSrc('x', 'a%20b.html'), 'sites/x/a%2520b.html', 'literal % double-encodes');
});
