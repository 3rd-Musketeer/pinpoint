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
 *   - `pinpoint` 桶的账本按行拆：带 pageId 的画布行进 `<pageId>/@canvas.json`
 *     （pageId 挂在别页条目上时并进宿主页）；没有 pageId 的行按账本 pathname
 *     归页，迁到 `<页>/<原账本文件名>.json` 保留表面绑定 —— @canvas 只收画布行。
 *     归到的页不在 registry 与 manifest 里（`/previews/<p>/` 查 manifest、
 *     `/sites/<id>/` 查 registry）就算孤儿：留在原处、列清单、不建新桶。
 *   - 挂靠条目（entry.page）自己的桶整桶并进宿主页的桶。
 *   - 迁入目标已有账本就合并：按 id 去重，同 id 不同内容报冲突、保留目标行。
 *   - 桶内重号（合并后 #n 撞车）：后到的行重新取号，打印 `旧号 → 新号` 对照表。
 *   - 被行引用的 images/ 文件跟着行搬，账本名变了图片跟着改名（前缀 = 新账本
 *     key，collectUnusedImages 与 prune 的按前缀回收才找得到）；每个桶重算
 *     `_seq.json` = 桶内 max(n)+1。
 *
 * 用法：node scripts/migrate-ledgers.mjs [--apply]
 *
 * 数据根 = dataRoot()（PINPOINT_DATA_DIR 可覆盖）；registry 取
 * PINPOINT_REGISTRY，否则数据根下的 registry.json，否则默认 ~/.pinpoint/registry.json
 * （临时副本验证时三样都在副本里）；本地模板页名单读仓库的
 * content/previews/_index.json（PINPOINT_PREVIEWS_ROOT 可指向副本仓根，测试用）。
 * --apply 前整根备份到 <dataRoot>/migrations/<日期>-<时分秒>-storage-unify/
 * （目录已存在就拒绝，不覆盖已有备份）。真实账本的
 * 迁移由 owner 指定的人跑；本脚本不给「静默跳过」留后门（排除 migrations /
 * dist / render 等非账本目录）。幂等：第二遍 0 变更。
 */
import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../src/server/lib/annotate-data-dir.js';
import { manifestPageIds } from '../src/server/lib/page-manifest.js';
import { loadRegistry } from '../src/server/lib/registry.js';

const APPLY = process.argv.includes('--apply');
const CANVAS_FILE = '@canvas.json';
const CANVAS_KEY = '@canvas';
// 数据根下不是页桶的目录（服务自己的产物 / 日志 / 备份）。
const NON_BUCKET_DIRS = new Set(['migrations', 'dist', 'render', 'check', 'shot', 'logs', 'diagnostics']);

const root = dataRoot();
// 仓库根：本地模板页名单的来源（CLI 与服务同用这一份）。测试拿 PINPOINT_PREVIEWS_ROOT
// 指向副本仓根，跟 PINPOINT_DATA_DIR / PINPOINT_REGISTRY 配套。
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PREVIEWS_ROOT = process.env.PINPOINT_PREVIEWS_ROOT || REPO_ROOT;

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

/** { buckets: Map<桶名, { ledgers: Map<文件名, doc>, images: string[] }>,
    badLedgers: Map<桶名, Set<文件名>>（解析失败的账本，落盘时原样保留）。 } */
function readModel() {
  const buckets = new Map();
  const badLedgers = new Map();
  if (!fs.existsSync(root)) return { buckets, badLedgers };
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || NON_BUCKET_DIRS.has(entry.name)) continue;
    const bucketPath = path.join(root, entry.name);
    const ledgers = new Map();
    const bad = new Set();
    for (const name of fs.readdirSync(bucketPath).sort()) {
      if (!isLedgerFile(name)) continue;
      try {
        ledgers.set(name, JSON.parse(fs.readFileSync(path.join(bucketPath, name), 'utf8')));
      } catch {
        bad.add(name);
        console.error(`  跳过坏账本：${path.join(bucketPath, name)}`);
      }
    }
    const imagesDir = path.join(bucketPath, 'images');
    const images = fs.existsSync(imagesDir)
      ? fs.readdirSync(imagesDir).filter((name) => fs.statSync(path.join(imagesDir, name)).isFile())
      : [];
    buckets.set(entry.name, { ledgers, images });
    if (bad.size) badLedgers.set(entry.name, bad);
  }
  return { buckets, badLedgers };
}

/** registry 与 manifest 的页索引：pageOf = 条目 id → 所属页 id（挂靠条目给宿主页，
    其余自己）；registryIds = 登记过的条目 id；manifestIds = 本地模板页 id。
    「页真实存在」按这两个名单判 —— 名单兜底 `id → id` 会给死页造桶（K5）。 */
function pageIndex() {
  const registryPath = process.env.PINPOINT_REGISTRY
    || (fs.existsSync(path.join(root, 'registry.json')) ? path.join(root, 'registry.json') : null);
  const registry = loadRegistry({ root, path: registryPath || undefined, log: () => {} });
  const map = new Map();
  const registryIds = new Set();
  for (const entry of registry.entries) {
    map.set(entry.id, entry.page || entry.id);
    registryIds.add(entry.id);
  }
  const manifestIds = new Set(manifestPageIds(PREVIEWS_ROOT));
  const known = new Set([...map.values(), ...manifestIds]);
  return { pageOf: (id) => map.get(id) || id, registryIds, manifestIds, known };
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

function planStorageUnify(model, pageIndexValue, report) {
  const { buckets } = model;
  const { pageOf, registryIds, manifestIds, known } = pageIndexValue;
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

  /** 确保页桶存在；只要画布账本时走 canvas=true（@canvas 只收画布行，
      按路径归页的行落到 <页>/<原账本名>.json，不给他们造画布）。 */
  const ensureBucket = (page, ledger, canvas) => {
    if (!buckets.has(page)) buckets.set(page, { ledgers: new Map(), images: [] });
    const bucket = buckets.get(page);
    if (canvas && !bucket.ledgers.has(CANVAS_FILE)) {
      bucket.ledgers.set(CANVAS_FILE, { page: CANVAS_KEY, path: CANVAS_KEY, revision: 0, updated_at: null, annotations: [] });
    }
    if (!bucket.ledgers.has(ledger)) {
      bucket.ledgers.set(ledger, { page: ledger.replace(/\.json$/, ''), path: '', revision: 0, updated_at: null, annotations: [] });
    }
    return bucket.ledgers.get(ledger);
  };

  const movedImages = []; // { from, to, name, renamedTo? }
  const imageNames = new Map(); // 桶 → 已占图片名（含规划期新分配的）
  const allocatedRenames = new Map(); // from/to/name → 改后的名（同源图多行引用共用）
  const takenImageNames = (bucket) => {
    if (!imageNames.has(bucket)) imageNames.set(bucket, new Set(buckets.get(bucket) ? buckets.get(bucket).images : []));
    return imageNames.get(bucket);
  };
  /** 每页迁入行数（G4：只列页名看不出哪页收了多少）。 */
  const noteMove = (page, rows) => {
    report.moved.set(page, (report.moved.get(page) || 0) + rows);
    report.movedRows += rows;
  };
  /** 规划一张图片的搬运。ledgerKey = 目标账本 key：图片名前缀（= 老账本 key）
      与它对不上时改成名 `<key>-<原名>`（G5）——collectUnusedImages 与 prune
      都按「账本 key-」前缀回收图片，按原名搬进新桶的图永远收不回。 */
  const planImage = (from, to, name, ledgerKey) => {
    if (!ledgerKey || name.startsWith(`${ledgerKey}-`)) {
      movedImages.push({ from, to, name });
      return name;
    }
    const dedupeKey = `${from}\u0000${to}\u0000${name}`;
    let toName = allocatedRenames.get(dedupeKey);
    if (!toName) {
      const taken = takenImageNames(to);
      toName = `${ledgerKey}-${name}`;
      for (let i = 1; taken.has(toName); i += 1) toName = `${ledgerKey}-${i}-${name}`;
      taken.add(toName);
      allocatedRenames.set(dedupeKey, toName);
    }
    movedImages.push({ from, to, name, renamedTo: toName });
    return toName;
  };
  const noteImage = (row, fromBucket, toBucket, ledgerKey) => {
    for (const image of (row && Array.isArray(row.images) && row.images) || []) {
      if (!image || typeof image.file !== 'string') continue;
      const name = path.basename(image.file);
      const toName = planImage(fromBucket, toBucket, name, ledgerKey);
      if (toName !== name) image.file = image.file.slice(0, image.file.length - name.length) + toName;
    }
  };

  /** 去重合并：同 id 保留目标行、内容不同报冲突；重号重新取号。
      页时间随行走：目标账本的 updated_at 抬到源账本最近一次保存（splitPinpoint
      逐本 laterOf），page-times 读侧按 updated_at 记页时间，排序不断档。 */
  const mergeRow = (targetDoc, row, page, ledgerName, provenance) => {
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
      report.renumbers.push({ page, ledger: ledgerName, from: old, to: row.n });
    } else if (Number.isInteger(row.n)) {
      state.used.add(row.n);
      if (row.n > state.max) state.max = row.n;
    }
    targetDoc.annotations.push(row);
    return true;
  };

  /** 一行的归属：带 pageId 的画布行 → 那个页的 @canvas；无 pageId 的行按账本
      pathname 归页（`/previews/<p>/` 查 manifest、`/sites/<id>/` 查 registry，
      名单里没有 = 页已不存在）。返回 { page, ledger } 或 { reason }。 */
  const rowTarget = (row, doc, ledgerName) => {
    if (row && typeof row.pageId === 'string' && row.pageId) {
      const page = pageOf(row.pageId);
      if (!known.has(page)) return { reason: `pageId=${row.pageId} 的页不在 registry 与 manifest 里` };
      return { page, ledger: CANVAS_FILE };
    }
    let p;
    try { p = decodeURIComponent(String(doc.path || '')); } catch { p = String(doc.path || ''); }
    let m = p.match(/^\/previews\/([a-z0-9][a-z0-9-]*)\//);
    if (m) {
      if (!manifestIds.has(m[1])) return { reason: `path=${doc.path || '（空）'} 归到的模板页 ${m[1]} 不在 manifest 里` };
      return { page: m[1], ledger: ledgerName };
    }
    m = p.match(/^\/sites\/([a-z0-9][a-z0-9-]*)\//);
    if (m) {
      if (!registryIds.has(m[1])) return { reason: `path=${doc.path || '（空）'} 归到的条目 ${m[1]} 不在 registry 里` };
      return { page: pageOf(m[1]), ledger: ledgerName };
    }
    return { reason: `path=${doc.path || '（空）'} 解析不出页` };
  };

  /** pinpoint 桶：带 pageId 的行拆进各页 @canvas；无 pageId 的行整本归到
      `<页>/<原账本文件名>.json`（保留表面绑定）。归不到真实页的行算孤儿：
      留在原处、列清单，不建新桶。 */
  const splitPinpoint = () => {
    const bucket = buckets.get('pinpoint');
    if (!bucket) return;
    for (const [name, doc] of [...bucket.ledgers.entries()]) {
      const rows = annotationsOf(doc);
      const stay = [];
      const stayReasons = new Map();
      let touched = false;
      for (const row of rows) {
        const target = rowTarget(row, doc, name);
        if (target.reason) {
          stay.push(row);
          stayReasons.set(target.reason, (stayReasons.get(target.reason) || 0) + 1);
          continue;
        }
        const targetDoc = ensureBucket(target.page, target.ledger, target.ledger === CANVAS_FILE);
        // 新建的目标账本继承源账本的表面绑定（pathname）：孤儿判定与 prune 靠它。
        if (targetDoc.path === '' && doc.path) targetDoc.path = doc.path;
        if (mergeRow(targetDoc, row, target.page, target.ledger, `pinpoint/${name}`)) {
          touched = true;
          noteMove(target.page, 1);
          targetDoc.updated_at = laterOf(targetDoc.updated_at, doc.updated_at);
          noteImage(row, 'pinpoint', target.page, target.ledger.replace(/\.json$/, ''));
        }
      }
      const allStay = rows.length > 0 && stay.length === rows.length;
      if (!allStay) {
        if (stay.length) {
          doc.annotations = stay;
        } else if (Object.keys(doc.page_updated_at || {}).length) {
          // 行都走了但还带着存量逐页时间映射：留着喂读侧兼容（page-times 还认它）。
          doc.annotations = [];
        } else {
          bucket.ledgers.delete(name);
          report.removedLedgers.push(`pinpoint/${name}`);
        }
        if (stay.length) report.splitLedgers.push(`pinpoint/${name}`);
      }
      for (const [reason, count] of stayReasons) {
        report.orphans.push(`pinpoint/${name}：${count} 行（${reason}）`);
      }
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
      for (const name of bucket.images) planImage(bucketName, targetPage, name, null); // 整桶随走，名字不动
      for (const [name, doc] of bucket.ledgers) {
        const target = targetBucket.ledgers.get(name);
        if (!target) {
          // 先初始化宿主页的 used 集合再放入账本：放完再算，账本自己的号已在
          // 桶里，每行都「撞自己」无条件改号。先算再放，只有真撞号才改（G2）。
          usedN(targetPage);
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
          noteMove(targetPage, annotationsOf(doc).length);
          continue;
        }
        // 同名账本：按 id 去重合并，新行重号。
        for (const row of annotationsOf(doc)) {
          if (mergeRow(target, row, targetPage, name, `${bucketName}/${name}`)) {
            noteMove(targetPage, 1);
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
const pages = pageIndex();

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
  moved: new Map(),
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
planStorageUnify(model, pages, report);

// 孤儿清单由 splitPinpoint 在拆分时逐本记录（带原因）；pinpoint 桶外的行不判。

const formSummary = Object.entries(formTotals).map(([key, count]) => `${key} × ${count}`).join('、') || '无';
const storageChanged = report.movedRows + report.renumbers.length + report.conflicts.length + report.imageMoves.length
  + report.seqWrites.length + report.removedLedgers.length + report.bucketMerges.length + report.splitLedgers.length;
console.log(`形态：${formFiles} 个账本里 ${formTouched} 个待迁（${formSummary}）`);
for (const row of formPlan) {
  const detail = Object.entries(row.changes).map(([key, count]) => `${key}:${count}`).join(' ');
  console.log(`  ${path.relative(root, row.file)} ${detail}`);
}
console.log(`归桶（storage-unify）：${report.movedRows} 行迁入 ${report.moved.size} 个页桶 · ${report.orphans.length} 本账本有孤儿行（不自动删） · 重号 ${report.renumbers.length} 条 · 图片 ${report.imageMoves.length} 张 · _seq 重算 ${report.seqWrites.length} 桶`);
for (const [page, rows] of [...report.moved].sort(([a], [b]) => (a < b ? -1 : 1))) console.log(`  ${page}/ ← 迁入 ${rows} 行`);
for (const line of report.bucketMerges) console.log(`  桶合并：${line}`);
for (const line of report.splitLedgers) console.log(`  拆分：${line}（部分行迁出）`);
for (const line of report.removedLedgers) console.log(`  删除：${line}（行全部迁出）`);
for (const renumber of report.renumbers) console.log(`  重号：${renumber.page}/${renumber.ledger} #${renumber.from} → #${renumber.to}`);
for (const line of report.conflicts) console.log(`  冲突：${line}`);
for (const move of report.imageMoves) console.log(`  图片：${move.from}/images/${move.name} → ${move.to}/images/${move.renamedTo || move.name}`);
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

// 备份带时分秒：同一天第二次 --apply 不再往同一目录里覆盖（cpSync 同名覆盖
// 会污染第一遍的备份）。已存在就拒绝，不覆盖。
const BACKUP_ROOT = path.join(root, 'migrations', `${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}-storage-unify`);
if (fs.existsSync(BACKUP_ROOT)) {
  console.error(`错误：备份目录已存在，拒绝覆盖：${BACKUP_ROOT}（确要复跑请先移走它）`);
  process.exit(1);
}
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
  const to = path.join(root, move.to, 'images', move.renamedTo || move.name);
  if (!fs.existsSync(from) || fs.existsSync(to)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// 桶内容与模型对齐：模型里没有的账本文件删掉，有的（重）写；解析失败的
// 坏账本不在模型里，但那是用户数据 —— 原样保留（G7），不趁迁移顺手删；
// 点号开头的隐藏目录读侧就跳过，清理同样跳过 —— 不然它们不在模型里，
// 会被当成「整桶并走的桶」rm -rf（K9）。
for (const bucketName of fs.readdirSync(root, { withFileTypes: true })) {
  if (!bucketName.isDirectory() || bucketName.name.startsWith('.') || bucketName.name === 'migrations' || NON_BUCKET_DIRS.has(bucketName.name)) continue;
  if (!model.buckets.has(bucketName.name)) {
    // 整桶并走的挂靠桶：剩余内容（模型外文件，如 _seq.json）一并删除后移除目录；
    // 桶里有解析不了的坏账本时不能整目录删（G7），只清已迁走的账本，坏文件留底。
    const bad = model.badLedgers.get(bucketName.name) || new Set();
    if (bad.size) {
      for (const name of fs.readdirSync(path.join(root, bucketName.name))) {
        if (isLedgerFile(name) && !bad.has(name)) fs.rmSync(path.join(root, bucketName.name, name), { force: true });
      }
    } else {
      fs.rmSync(path.join(root, bucketName.name), { recursive: true, force: true });
    }
    continue;
  }
  const bad = model.badLedgers.get(bucketName.name) || new Set();
  for (const name of fs.readdirSync(path.join(root, bucketName.name))) {
    if (isLedgerFile(name) && !bad.has(name)) fs.rmSync(path.join(root, bucketName.name, name), { force: true });
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
