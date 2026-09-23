#!/usr/bin/env node
/**
 * pp2 账本旧形态迁移（2026-09-22 切片 3/4）：一支脚本把所有桶里的账本迁到
 * 现行形态 ——
 *   `result`        → `status: "done"`（蓝框执行结果退役，切片 3）
 *   `marks`         → `annotations`（文档键改名）
 *   `comment`       → `content`
 *   `group`         → `section`（`groupLabel` 弃，不迁）
 *   `[@m:id]`       → `[@a:id]`（mention 语法改名，正文内替换）
 *
 * 用法：node scripts/migrate-ledgers.mjs [--apply]
 *
 * 默认 dry-run：只打印每个账本各类迁移多少条。`--apply` 才落盘；落盘前把整个
 * 数据根备份到 <dataRoot>/migrations/2026-09-22-ledgers/。数据根 = dataRoot()
 * （PINPOINT_DATA_DIR 可覆盖）—— 先在临时副本上验证再动真账本；真实账本的
 * 迁移由 owner 指定的人跑，本脚本不给「静默跳过」留后门（精确排除
 * `_seq.json` 与 dist / render / migrations 目录）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../src/server/lib/annotate-data-dir.js';

const BACKUP_ROOT = path.join(dataRoot(), 'migrations', '2026-09-22-ledgers');
const APPLY = process.argv.includes('--apply');

function isLedger(name) {
  return name.endsWith('.json') && name !== '_seq.json';
}

/** 单条标注的迁移；返回 { annotation, changes: {字段: 数} }。 */
function migrateAnnotation(raw) {
  const changes = {};
  const a = { ...raw };
  if (a.result) {
    a.status = 'done';
    delete a.result;
    changes.result = 1;
  }
  if (a.comment != null) {
    if (a.content == null) a.content = a.comment;
    else changes.commentDropped = 1; // 两者并存：content 优先，comment 弃（报数不静默）
    delete a.comment;
    changes.comment = (changes.comment || 0) + 1;
  }
  if (a.group != null) {
    if (a.section == null) a.section = a.group;
    delete a.group;
    changes.group = 1;
  }
  if (a.groupLabel != null) {
    delete a.groupLabel;
    changes.groupLabel = 1;
  }
  if (typeof a.content === 'string' && a.content.includes('[@m:')) {
    a.content = a.content.replace(/\[@m:([a-z0-9]+)\]/gi, '[@a:$1]');
    changes.mention = 1;
  }
  return { annotation: a, changes };
}

/** 一本文账本的迁移；返回 { doc, changes, touched }。 */
function migrateDoc(doc) {
  const hasMarks = Array.isArray(doc.marks);
  const hasAnnotations = Array.isArray(doc.annotations);
  if (!hasMarks && !hasAnnotations) return { doc, changes: {}, touched: false };
  const rows = hasAnnotations ? doc.annotations : doc.marks;
  const changes = {};
  if (hasMarks && !hasAnnotations) changes.marks = rows.length;
  const annotations = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      annotations.push(raw);
      continue;
    }
    const { annotation, changes: rowChanges } = migrateAnnotation(raw);
    for (const [key, count] of Object.entries(rowChanges)) changes[key] = (changes[key] || 0) + count;
    annotations.push(annotation);
  }
  const next = { ...doc, annotations };
  delete next.marks;
  const touched = Object.keys(changes).length > 0;
  return { doc: next, changes, touched };
}

function* ledgerFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'migrations' || entry.name === 'dist' || entry.name === 'render') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* ledgerFiles(p);
    else if (entry.isFile() && isLedger(entry.name)) yield p;
  }
}

const root = dataRoot();
let files = 0;
let touched = 0;
const totals = {};
const plan = [];
for (const file of ledgerFiles(root)) {
  files += 1;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  const { doc: next, changes, touched: hit } = migrateDoc(doc);
  if (!hit) continue;
  touched += 1;
  for (const [key, count] of Object.entries(changes)) totals[key] = (totals[key] || 0) + count;
  plan.push({ file, next, changes });
}

const summary = Object.entries(totals).map(([key, count]) => `${key} × ${count}`).join('、') || '无';
console.log(`${APPLY ? '迁移' : 'dry-run'}：${files} 个账本里 ${touched} 个待迁（${summary}）`);
for (const row of plan) {
  const detail = Object.entries(row.changes).map(([key, count]) => `${key}:${count}`).join(' ');
  console.log(`  ${path.relative(root, row.file)} ${detail}`);
}
if (!APPLY) {
  console.log('确认后用 --apply 落盘（会先整根备份）。');
  process.exit(0);
}

fs.mkdirSync(BACKUP_ROOT, { recursive: true });
for (const entry of fs.readdirSync(root)) {
  if (entry === 'migrations') continue;
  fs.cpSync(path.join(root, entry), path.join(BACKUP_ROOT, entry), { recursive: true });
}
console.log(`已备份到 ${BACKUP_ROOT}`);
for (const row of plan) {
  const temp = `${row.file}.tmp-migrate`;
  fs.writeFileSync(temp, JSON.stringify(row.next, null, 1) + '\n');
  fs.renameSync(temp, row.file);
}
console.log(`完成：${touched} 个账本已改写。`);
