#!/usr/bin/env node
/**
 * pp2 标注状态机 · 存量迁移（2026-09-22）：把各桶账本里带 `result` 字段的标注
 * 迁成 `status: "done"` 并删除 `result` 字段（蓝框执行结果指示已随切片 3 退役）。
 *
 * 用法：node scripts/migrate-annotation-status.mjs [--apply]
 *
 * 默认是 dry-run：只打印每个账本要改多少条，不写盘。`--apply` 才落盘；
 * 落盘前先把整个数据根复制备份到 ~/.pinpoint/migrations/2026-09-22-status/。
 * 数据根 = dataRoot()（PINPOINT_DATA_DIR 可覆盖）——先在临时副本上验证再动真账本。
 */
import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../src/server/lib/annotate-data-dir.js';

const BACKUP_ROOT = path.join(dataRoot(), 'migrations', '2026-09-22-status');
const APPLY = process.argv.includes('--apply');

function isLedger(name) {
  return name.endsWith('.json') && name !== '_seq.json' && !name.startsWith('build');
}

function migrateDoc(doc) {
  const annotations = Array.isArray(doc && doc.annotations) ? doc.annotations : (Array.isArray(doc && doc.marks) ? doc.marks : null);
  if (!annotations) return { doc, changed: 0 };
  let changed = 0;
  const out = annotations.map((a) => {
    if (!a || typeof a !== 'object' || !a.result) return a;
    changed += 1;
    const next = { ...a, status: 'done' };
    delete next.result;
    return next;
  });
  return { doc: { ...doc, annotations: out }, changed };
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
let annotations = 0;
const plan = [];
for (const file of ledgerFiles(root)) {
  files += 1;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  const { doc: next, changed } = migrateDoc(doc);
  if (!changed) continue;
  touched += 1;
  annotations += changed;
  plan.push({ file, next, changed });
}

console.log(`${APPLY ? '迁移' : 'dry-run'}：${files} 个账本里 ${touched} 个带 result，共 ${annotations} 条待迁`);
for (const row of plan) console.log(`  ${path.relative(root, row.file)} × ${row.changed}`);
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
