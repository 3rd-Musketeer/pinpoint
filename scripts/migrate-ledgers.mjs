#!/usr/bin/env node
/**
 * 账本迁移（一支脚本两个阶段，dry-run 默认，--apply 才落盘）：
 *
 * 阶段 A · 形态（2026-09-22 pp2 切片 3/4）：
 *   `result`        → `status: "done"`
 *   `marks`         → `annotations`
 *   `comment`       → `content`、`group` → `section`（`groupLabel` 弃）
 *   `[@m:id]`       → `[@a:id]`
 *
 * 阶段 B · 归桶（2026-09-23 storage-unify：桶 = 页）：
 *   - `pinpoint` 桶的账本按行上的 pageId 拆进 `<pageId>/@canvas.json`
 *     （pageId 挂在别页条目上时并进宿主页）；没有 pageId 的行按账本 pathname
 *     找页（`/previews/<p>/` → p；`/sites/<id>/` → 该条目所属页），找不到报为
 *     孤儿、列清单、留在原处不自动删。
 *   - 挂靠条目（entry.page）自己的桶整桶并进宿主页的桶。
 *   - 迁入目标已有账本就合并：按 id 去重，同 id 不同内容报冲突、保留目标行。
 *   - 桶内重号（合并后 #n 撞车）：后到的行重新取号，打印 `旧号 → 新号` 对照表。
 *   - 被行引用的 images/ 文件跟着行搬；每个桶重算 `_seq.json` = 桶内 max(n)+1。
 *
 * 用法：node scripts/migrate-ledgers.mjs [--apply]
 *
 * 数据根 = dataRoot()（PINPOINT_DATA_DIR 可覆盖）；registry 取
 * PINPOINT_REGISTRY，否则数据根下的 registry.json，否则默认 ~/.pinpoint/registry.json
 * （临时副本验证时三样都在副本里）。--apply 前整根备份到
 * <dataRoot>/migrations/<日期>-storage-unify/。真实账本的迁移由 owner 指定的
 * 人跑；本脚本不给「静默跳过」留后门（排除 migrations / dist / render 等非账本
 * 目录）。幂等：第二遍 0 变更。
 */
import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../src/server/lib/annotate-data-dir.js';
import { loadRegistry } from '../src/server/lib/registry.js';

const APPLY = process.argv.includes('--apply');
const CANVAS_FILE = '@canvas.json';
const CANVAS_KEY = '@canvas';
// 数据根下不是页桶的目录（服务自己的产物 / 日志 / 备份）。
const NON_BUCKET_DIRS = new Set(['migrations', 'dist', 'render', 'check', 'shot', 'logs', 'diagnostics']);

const root = dataRoot();

/* ---- 阶段 A：形态迁移（纯变换，无 IO） ---- */

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

/* ---- 磁盘模型：全量读进内存，两个阶段都在模型上跑，--apply 一次写净 ---- */

function isLedgerFile(name) {
  return name.endsWith('.json') && name !== '_seq.json';
}

/** { buckets: Map<桶名, { ledgers: Map<文件名, doc>, images: string[] }> } */
function readModel() {
  const buckets = new Map();
  if (!fs.existsSync(root)) return { buckets };
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || NON_BUCKET_DIRS.has(entry.name)) continue;
    const bucketPath = path.join(root, entry.name);
    const ledgers = new Map();
    for (const name of fs.readdirSync(bucketPath).sort()) {
      if (!isLedgerFile(name)) continue;
      try {
        ledgers.set(name, JSON.parse(fs.readFileSync(path.join(bucketPath, name), 'utf8')));
      } catch {
        console.error(`  跳过坏账本：${path.join(bucketPath, name)}`);
      }
    }
    const imagesDir = path.join(bucketPath, 'images');
    const images = fs.existsSync(imagesDir)
      ? fs.readdirSync(imagesDir).filter((name) => fs.statSync(path.join(imagesDir, name)).isFile())
      : [];
    buckets.set(entry.name, { ledgers, images });
  }
  return { buckets };
}

/** registry 的页归属映射：条目 id → 它所属的页 id（挂靠条目给宿主页，其余自己）。 */
function pageMap() {
  const registryPath = process.env.PINPOINT_REGISTRY
    || (fs.existsSync(path.join(root, 'registry.json')) ? path.join(root, 'registry.json') : null);
  const registry = loadRegistry({ root, path: registryPath || undefined, log: () => {} });
  const map = new Map();
  for (const entry of registry.entries) map.set(entry.id, entry.page || entry.id);
  return (id) => map.get(id) || id; // 不在登记表里的 id 按页 id 原样用（manifest 页）
}

const annotationsOf = (doc) => (Array.isArray(doc.annotations) ? doc.annotations : []);

/** 一行引用的图片文件名。 */
function rowImages(row) {
  const out = [];
  for (const image of (row && Array.isArray(row.images) && row.images) || []) {
    if (image && typeof image.file === 'string') out.push(path.basename(image.file));
  }
  return out;
}

const laterOf = (a, b) => {
  const ta = Date.parse(a || '');
  const tb = Date.parse(b || '');
  if (!Number.isFinite(ta)) return b || a || null;
  if (!Number.isFinite(tb)) return a || null;
  return ta >= tb ? a : b;
};

/* ---- 阶段 B：归桶（桶 = 页） ---- */

function planStorageUnify(model, pageOf, report) {
  const { buckets } = model;
  const canvasOf = (page) => buckets.get(page).ledgers.get(CANVAS_FILE) || null;

  /** 桶内已占的 #n 集合与最大号（跨全部账本；随迁入动态更新）。 */
  const nState = new Map();
  const usedN = (bucket) => {
    if (!nState.has(bucket)) {
      const used = new Set();
      let max = 0;
      for (const doc of buckets.get(bucket).ledgers.values()) {
        for (const row of annotationsOf(doc)) {
          if (Number.isInteger(row.n)) {
            used.add(row.n);
            if (row.n > max) max = row.n;
          }
        }
      }
      nState.set(bucket, { used, max });
    }
    return nState.get(bucket);
  };
  const takeNumber = (bucket) => {
    const state = usedN(bucket);
    state.max += 1;
    while (state.used.has(state.max)) state.max += 1;
    state.used.add(state.max);
    return state.max;
  };

  /** 把一行并入目标桶的 @canvas 账本（page 桶须已存在或先 ensurePage）。 */
  const ensurePageBucket = (page) => {
    if (!buckets.has(page)) buckets.set(page, { ledgers: new Map(), images: [] });
    const bucket = buckets.get(page);
    if (!bucket.ledgers.has(CANVAS_FILE)) {
      bucket.ledgers.set(CANVAS_FILE, { page: CANVAS_KEY, path: CANVAS_KEY, revision: 0, updated_at: null, annotations: [] });
    }
    return bucket.ledgers.get(CANVAS_FILE);
  };

  const movedImages = []; // { from, to, name }
  const noteImage = (row, fromBucket, toBucket) => {
    for (const name of rowImages(row)) movedImages.push({ from: fromBucket, to: toBucket, name });
  };

  /** 去重合并：同 id 保留目标行、内容不同报冲突；重号重新取号。
      页时间随行走：@canvas 的 updated_at 抬到源账本最近一次保存（splitPinpoint
      逐本 laterOf），page-times 读侧按 updated_at 记页时间，排序不断档。 */
  const mergeRow = (targetDoc, row, page, provenance) => {
    const existing = annotationsOf(targetDoc).find((r) => r && r.id && row.id && r.id === row.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(row)) {
        report.conflicts.push(`${page}：行 ${row.id} 已存在且内容不同，保留目标行（来源 ${provenance}）`);
      }
      return false;
    }
    const state = usedN(page);
    if (Number.isInteger(row.n) && state.used.has(row.n)) {
      const old = row.n;
      row = { ...row, n: takeNumber(page) };
      report.renumbers.push({ page, ledger: targetDoc === canvasOf(page) ? CANVAS_FILE : targetDoc.page || '', from: old, to: row.n });
    } else if (Number.isInteger(row.n)) {
      state.used.add(row.n);
      if (row.n > state.max) state.max = row.n;
    }
    targetDoc.annotations.push(row);
    return true;
  };

  /** pinpoint 桶：按行拆进各页的 @canvas。 */
  const splitPinpoint = () => {
    const bucket = buckets.get('pinpoint');
    if (!bucket) return;
    for (const [name, doc] of [...bucket.ledgers.entries()]) {
      const rows = annotationsOf(doc);
      const stay = [];
      for (const row of rows) {
        let page = row && typeof row.pageId === 'string' && row.pageId ? pageOf(row.pageId) : null;
        if (!page) {
          page = pageFromPathname(String(doc.path || ''), pageOf);
        }
        if (!page) {
          stay.push(row);
          continue;
        }
        const target = ensurePageBucket(page);
        if (mergeRow(target, row, page, `pinpoint/${name}`)) {
          report.moved.add(page);
          report.movedRows += 1;
          target.updated_at = laterOf(target.updated_at, doc.updated_at);
          noteImage(row, 'pinpoint', page);
        }
      }
      if (stay.length === rows.length) continue; // 整本没动
      if (stay.length) {
        doc.annotations = stay;
      } else if (Object.keys(doc.page_updated_at || {}).length) {
        // 行都走了但还带着存量逐页时间映射：留着喂读侧兼容（page-times 还认它）。
        doc.annotations = [];
      } else {
        bucket.ledgers.delete(name);
        report.removedLedgers.push(`pinpoint/${name}`);
      }
      if (stay.length !== rows.length && stay.length) report.splitLedgers.push(`pinpoint/${name}`);
    }
    // pinpoint 桶里不再被任何行引用的图片清掉（跟行走的已记 movedImages）。
  };

  /** 挂靠条目（entry.page）的桶整桶并进宿主页。账本同名合并，图片全搬。 */
  const mergeAttached = () => {
    for (const [bucketName, bucket] of [...buckets.entries()]) {
      if (bucketName === 'pinpoint') continue;
      const targetPage = pageOf(bucketName);
      if (targetPage === bucketName) continue;
      const targetBucket = (() => {
        if (!buckets.has(targetPage)) buckets.set(targetPage, { ledgers: new Map(), images: [] });
        return buckets.get(targetPage);
      })();
      for (const name of bucket.images) movedImages.push({ from: bucketName, to: targetPage, name });
      for (const [name, doc] of bucket.ledgers) {
        const target = targetBucket.ledgers.get(name);
        if (!target) {
          targetBucket.ledgers.set(name, doc);
          for (const row of annotationsOf(doc)) {
            const state = usedN(targetPage);
            if (Number.isInteger(row.n)) {
              if (state.used.has(row.n)) {
                const old = row.n;
                row.n = takeNumber(targetPage);
                report.renumbers.push({ page: targetPage, ledger: name, from: old, to: row.n });
              } else {
                state.used.add(row.n);
                if (row.n > state.max) state.max = row.n;
              }
            }
          }
          report.moved.add(targetPage);
          report.movedRows += annotationsOf(doc).length;
          continue;
        }
        // 同名账本：按 id 去重合并，新行重号。
        for (const row of annotationsOf(doc)) {
          if (mergeRow(target, row, targetPage, `${bucketName}/${name}`)) {
            report.moved.add(targetPage);
            report.movedRows += 1;
          }
        }
        target.updated_at = laterOf(target.updated_at, doc.updated_at);
      }
      buckets.delete(bucketName);
      report.bucketMerges.push(`${bucketName} → ${targetPage}`);
    }
  };

  splitPinpoint();
  mergeAttached();

  // 阶段 B 收尾：图片搬运（去重）+ _seq 重算。挂靠桶的图片整桶随走（源桶已从
  // 模型删除）；pinpoint 桶只搬被行引用的，剩余的由落盘阶段清理。
  report.imageMoves = movedImages.filter((m, i, all) => m.from !== m.to
    && all.findIndex((x) => x.name === m.name && x.from === m.from && x.to === m.to) === i);
  for (const bucketName of [...buckets.keys()]) {
    if (!NON_BUCKET_DIRS.has(bucketName)) recomputeSeq(model, bucketName, report);
  }
}

/** pinpoint 账本没有 pageId 的行按 pathname 找页。 */
function pageFromPathname(pathname, pageOf) {
  let p;
  try { p = decodeURIComponent(String(pathname || '')); } catch { return null; }
  let m = p.match(/^\/previews\/([a-z0-9][a-z0-9-]*)\//);
  if (m) return m[1];
  m = p.match(/^\/sites\/([a-z0-9][a-z0-9-]*)\//);
  if (m) return pageOf(m[1]);
  return null;
}

/** 桶内 _seq.json = max(n)+1（只在值变化时记一笔）。 */
function recomputeSeq(model, bucketName, report) {
  const bucket = model.buckets.get(bucketName);
  if (!bucket) return;
  let max = 0;
  for (const doc of bucket.ledgers.values()) {
    for (const row of annotationsOf(doc)) {
      if (Number.isInteger(row.n) && row.n > max) max = row.n;
    }
  }
  const file = path.join(root, bucketName, '_seq.json');
  let current = null;
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')).next; } catch { /* 缺失/损坏都当无 */ }
  // 取 max(n)+1 与现有 next 的较大者：#n 永不复用，删过的号烧掉的计数不能倒退。
  const next = Math.max(max + 1, Number.isInteger(current) && current >= 1 ? current : 0);
  if (current === next) return;
  bucket.seq = next;
  report.seqWrites.push(`${bucketName}：${current == null ? '（无）' : current} → ${next}`);
}

/* ---- 主流程 ---- */

const model = readModel();
const pageOf = pageMap();

// 阶段 A：形态。
const formPlan = [];
let formFiles = 0;
let formTouched = 0;
const formTotals = {};
for (const [bucketName, bucket] of model.buckets) {
  for (const [name, doc] of bucket.ledgers) {
    formFiles += 1;
    const { doc: next, changes, touched } = migrateDoc(doc);
    if (!touched) continue;
    formTouched += 1;
    bucket.ledgers.set(name, next);
    for (const [key, count] of Object.entries(changes)) formTotals[key] = (formTotals[key] || 0) + count;
    formPlan.push({ file: path.join(root, bucketName, name), changes });
  }
}

// 阶段 A 不动没有 marks/annotations 键的账本；阶段 B 统一按 annotations 数组
// 操作，这里补齐缺的键（空数组）。
for (const bucket of model.buckets.values()) {
  for (const [name, doc] of bucket.ledgers) {
    if (!Array.isArray(doc.annotations)) doc.annotations = Array.isArray(doc.marks) ? doc.marks : [];
  }
}

// 阶段 B：归桶。
const report = {
  moved: new Set(),
  movedRows: 0,
  renumbers: [],
  conflicts: [],
  orphans: [],
  removedLedgers: [],
  splitLedgers: [],
  bucketMerges: [],
  imageMoves: [],
  seqWrites: [],
};
planStorageUnify(model, pageOf, report);

// 孤儿清单：pinpoint 桶里剩下的行（无 pageId、路径解析不出页）。
const leftover = model.buckets.get('pinpoint');
if (leftover) {
  for (const [name, doc] of leftover.ledgers) {
    const rows = annotationsOf(doc);
    const orphans = rows.filter((row) => row && !row.pageId);
    if (orphans.length) report.orphans.push(`pinpoint/${name}：${orphans.length} 行（无 pageId，path=${doc.path || '（空）'} 解析不出页）`);
  }
}

const formSummary = Object.entries(formTotals).map(([key, count]) => `${key} × ${count}`).join('、') || '无';
const storageChanged = report.movedRows + report.renumbers.length + report.conflicts.length + report.imageMoves.length
  + report.seqWrites.length + report.removedLedgers.length + report.bucketMerges.length + report.splitLedgers.length;
console.log(`形态：${formFiles} 个账本里 ${formTouched} 个待迁（${formSummary}）`);
for (const row of formPlan) {
  const detail = Object.entries(row.changes).map(([key, count]) => `${key}:${count}`).join(' ');
  console.log(`  ${path.relative(root, row.file)} ${detail}`);
}
console.log(`归桶（storage-unify）：${report.movedRows} 行迁入 ${report.moved.size} 个页桶 · ${report.orphans.length} 本账本有孤儿行（不自动删） · 重号 ${report.renumbers.length} 条 · 图片 ${report.imageMoves.length} 张 · _seq 重算 ${report.seqWrites.length} 桶`);
for (const page of [...report.moved].sort()) console.log(`  ${page}/ ← 迁入`);
for (const line of report.bucketMerges) console.log(`  桶合并：${line}`);
for (const line of report.splitLedgers) console.log(`  拆分：${line}（部分行迁出）`);
for (const line of report.removedLedgers) console.log(`  删除：${line}（行全部迁出）`);
for (const renumber of report.renumbers) console.log(`  重号：${renumber.page}/${renumber.ledger} #${renumber.from} → #${renumber.to}`);
for (const line of report.conflicts) console.log(`  冲突：${line}`);
for (const move of report.imageMoves) console.log(`  图片：${move.from}/images/${move.name} → ${move.to}/images/${move.name}`);
for (const line of report.seqWrites) console.log(`  _seq：${line}`);
for (const line of report.orphans) console.log(`  孤儿（留在原处）：${line}`);

if (!APPLY) {
  console.log('确认后用 --apply 落盘（会先整根备份）。');
  process.exit(0);
}
if (formTouched === 0 && storageChanged === 0) {
  console.log('没有可迁的，盘未动。');
  process.exit(0);
}

/* ---- 落盘：备份 → 写净 ---- */

const BACKUP_ROOT = path.join(root, 'migrations', `${new Date().toISOString().slice(0, 10)}-storage-unify`);
fs.mkdirSync(BACKUP_ROOT, { recursive: true });
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.name === 'migrations') continue;
  fs.cpSync(path.join(root, entry.name), path.join(BACKUP_ROOT, entry.name), { recursive: true });
}
console.log(`已备份到 ${BACKUP_ROOT}`);

function writeLedger(bucketName, name, doc) {
  const dir = path.join(root, bucketName);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  const temp = `${target}.tmp-migrate`;
  fs.writeFileSync(temp, JSON.stringify(doc, null, 1) + '\n');
  fs.renameSync(temp, target);
}

// 图片先搬（挂靠桶随后要整目录删除，晚了源头就没了）。
for (const move of report.imageMoves) {
  const from = path.join(root, move.from, 'images', move.name);
  const to = path.join(root, move.to, 'images', move.name);
  if (!fs.existsSync(from) || fs.existsSync(to)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// 桶内容与模型对齐：模型里没有的账本文件删掉，有的（重）写。
for (const bucketName of fs.readdirSync(root, { withFileTypes: true })) {
  if (!bucketName.isDirectory() || bucketName.name === 'migrations' || NON_BUCKET_DIRS.has(bucketName.name)) continue;
  if (!model.buckets.has(bucketName.name)) {
    // 整桶并走的挂靠桶：剩余内容（模型外文件，如 _seq.json）一并删除后移除目录。
    fs.rmSync(path.join(root, bucketName.name), { recursive: true, force: true });
    continue;
  }
  for (const name of fs.readdirSync(path.join(root, bucketName.name))) {
    if (isLedgerFile(name)) fs.rmSync(path.join(root, bucketName.name, name), { force: true });
  }
}
for (const [bucketName, bucket] of model.buckets) {
  for (const [name, doc] of bucket.ledgers) writeLedger(bucketName, name, doc);
  if (bucket.seq != null) {
    fs.mkdirSync(path.join(root, bucketName), { recursive: true });
    fs.writeFileSync(path.join(root, bucketName, '_seq.json'), JSON.stringify({ next: bucket.seq }, null, 2) + '\n');
  }
}
// 源桶里不再被引用的图片：pinpoint 桶清一遍（挂靠桶已整目录删除）。
const pin = model.buckets.get('pinpoint');
if (pin) {
  const referenced = new Set();
  for (const doc of pin.ledgers.values()) {
    for (const row of annotationsOf(doc)) for (const name of rowImages(row)) referenced.add(name);
  }
  const imagesDir = path.join(root, 'pinpoint', 'images');
  if (fs.existsSync(imagesDir)) {
    for (const name of fs.readdirSync(imagesDir)) {
      if (!referenced.has(name) && fs.statSync(path.join(imagesDir, name)).isFile()) fs.unlinkSync(path.join(imagesDir, name));
    }
  }
}
console.log(`完成：形态 ${formTouched} 个账本改写；归桶 ${report.movedRows} 行、图片 ${report.imageMoves.length} 张、_seq ${report.seqWrites.length} 桶。`);
