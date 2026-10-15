/* 文章页右栏里穿插的画布标注读的那几本账本（src/client/prose-comments.js）。
 * 一篇文章一张画布（2026-10-15）：画布上的帧标注在 @canvas；HTML 帧是一整页文档，它的标注在同桶里
 * 那一页自己的账本里（账本名 = 页面在服务上的地址 pageKeyFromPathname，iframe 里的标注客户端按它
 * 命名）。这里把它们合成一份：rows() 是全部的行，HTML 帧账本里的行补上 screenId = 那一帧（拷贝，不改
 * 盘上的行）；状态改动按行 id 回到它所在的那一本；SSE 推送按账本名（原名或落盘的 slug）分给对应的那本。
 * 每本仍是一个 createOpsLedger（409 重放、离开页面补发都不变）。 */

import { createOpsLedger } from './ops-ledger.js';
import { pageKeyFromPathname } from '../../shared/annotate-page-key.js';
import { annotationSlug } from '../../shared/annotation-slug.js';
import { CANVAS_LEDGER } from '../../shared/project-ids.js';

/**
 * options：server、entry、maxConflicts、onChange 同 createOpsLedger；
 * pages：[{ id: 帧 id, url: 那一页在服务上的地址 }]（文章里 HTML 帧的卡片给的 data-doc-url）。
 * make：换掉 createOpsLedger（测试用）。
 */
export function createCanvasLedgers(options) {
  var make = options.make || createOpsLedger;
  var books = [];
  var seen = {};
  function add(name, frame) {
    if (!name || seen[name]) return;
    seen[name] = true;
    books.push({
      name: name,
      slug: annotationSlug(name),
      frame: frame || '',
      ops: make({
        server: options.server, entry: options.entry, ledger: name, maxConflicts: options.maxConflicts,
        // 画布与页面的账本都是工作台写的，这里只改状态，path 原样带回去。
        path: function (disk) { return disk; },
        onChange: options.onChange,
      }),
    });
  }
  add(CANVAS_LEDGER, '');
  (options.pages || []).forEach(function (page) {
    if (page && page.id && page.url) add(pageKeyFromPathname(page.url), page.id);
  });

  function bookOfRow(id) {
    for (var i = 0; i < books.length; i++) {
      var rows = books[i].ops.rows();
      for (var j = 0; j < rows.length; j++) if (rows[j] && String(rows[j].id) === String(id)) return books[i];
    }
    return null;
  }

  return {
    /** 账本名（GET /annotations/<名>）。 */
    names: function () { return books.map(function (b) { return b.name; }); },
    /** 全部的行；HTML 帧账本里没写 screenId 的行补上那一帧。 */
    rows: function () {
      var out = [];
      books.forEach(function (b) {
        b.ops.rows().forEach(function (row) {
          out.push(b.frame && row && !row.screenId ? Object.assign({}, row, { screenId: b.frame }) : row);
        });
      });
      return out;
    },
    /** 水合：name 那本拿到磁盘上的一版。 */
    accept: function (name, doc) {
      books.forEach(function (b) { if (b.name === name) b.ops.accept(doc); });
    },
    /** SSE 推送：认得这本账本就交给它，返回 true。 */
    remote: function (doc) {
      if (!doc) return false;
      var hit = false;
      books.forEach(function (b) {
        if (doc.page === b.name || doc.page === b.slug) { b.ops.remote(doc); hit = true; }
      });
      return hit;
    },
    /** 改一条的状态：回到它所在的那一本。找不到这一行就不写。 */
    enqueue: function (op) {
      var book = op && op.id != null ? bookOfRow(op.id) : null;
      if (book) book.ops.enqueue(op);
      return !!book;
    },
    flushOnLeave: function () { books.forEach(function (b) { b.ops.flushOnLeave(); }); },
    settled: function () { return books.every(function (b) { return b.ops.settled(); }); },
    error: function () {
      for (var i = 0; i < books.length; i++) { var e = books[i].ops.error(); if (e) return e; }
      return '';
    },
  };
}
