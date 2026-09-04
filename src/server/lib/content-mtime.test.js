import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { contentMtimeMs } from './content-mtime.js';

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-mtime-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function setMtime(p, ms) {
  const date = new Date(ms);
  fs.utimesSync(p, date, date);
}

test('file 条目 = 文件自身 mtime；路径缺失 / url 条目 → null', () => {
  withTmpDir((dir) => {
    const file = path.join(dir, 'a.html');
    fs.writeFileSync(file, '<html></html>');
    const expected = fs.statSync(file).mtimeMs;
    assert.equal(contentMtimeMs({ kind: 'file', path: file }), expected);
  });
  assert.equal(contentMtimeMs({ kind: 'file', path: '/nonexistent/x.html' }), null);
  assert.equal(contentMtimeMs({ kind: 'url', url: 'https://example.com' }), null);
  assert.equal(contentMtimeMs(null), null);
});

test('dir 条目 = 递归最大 mtime；node_modules 与 dot 名被跳过', () => {
  withTmpDir((dir) => {
    const old = Date.parse('2026-01-01T00:00:00Z');
    const mid = Date.parse('2026-03-01T00:00:00Z');
    const newest = Date.parse('2026-06-01T00:00:00Z');

    const top = path.join(dir, 'index.html');
    fs.writeFileSync(top, 'a');
    setMtime(top, mid);

    const nested = path.join(dir, 'frames');
    fs.mkdirSync(nested);
    const deep = path.join(nested, 'card.html');
    fs.writeFileSync(deep, 'b');
    setMtime(deep, newest);

    // 这些里的"更新"不得参与：node_modules / dot 目录 / dot 文件
    const nm = path.join(dir, 'node_modules', 'pkg');
    fs.mkdirSync(nm, { recursive: true });
    const nmFile = path.join(nm, 'x.js');
    fs.writeFileSync(nmFile, 'c');
    const future = Date.parse('2027-01-01T00:00:00Z');
    setMtime(nmFile, future);
    const dotDir = path.join(dir, '.hidden');
    fs.mkdirSync(dotDir);
    const dotFile = path.join(dotDir, 'y.html');
    fs.writeFileSync(dotFile, 'd');
    setMtime(dotFile, future);
    const dotTop = path.join(dir, '.DS_Store');
    fs.writeFileSync(dotTop, 'e');
    setMtime(dotTop, future);

    // 其余目录/文件的 mtime 全部压到 old，保证断言只被 card.html 决定
    setMtime(nested, old);
    setMtime(nm, old);
    setMtime(path.join(dir, 'node_modules'), old);
    setMtime(dir, old);

    assert.equal(contentMtimeMs({ kind: 'dir', path: dir }), newest);
  });
});

test('dir 条目路径缺失 → null', () => {
  assert.equal(contentMtimeMs({ kind: 'dir', path: '/nonexistent/dir' }), null);
});
