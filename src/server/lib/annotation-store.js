import { changedAnnotationPages } from './page-times.js';
import fs from 'node:fs';
import path from 'node:path';

import {
  annotationsFromDoc,
  isLegalMarkTransition,
  isLegalTransition,
  normalizeAnnotation,
  normalizeDoc,
} from '../../shared/annotation-indicator.js';
import { annotationSlug } from '../../shared/annotation-slug.js';

export { annotationSlug };

export { normalizeAnnotation, normalizeDoc, annotationsFromDoc };

/** targets 的稳定指纹（编辑目标判定用：选择器集合变了才算改了目标）。 */
function targetsFingerprint(annotation) {
  const list = Array.isArray(annotation && annotation.targets) && annotation.targets.length
    ? annotation.targets
    : (annotation && annotation.selector ? [{ selector: annotation.selector }] : []);
  return list.map((target) => `${target.ref || ''}${target.selector || ''}`).join('') || '';
}

export function createAnnotationStore(options) {
  const dataDir = options.dataDir;
  const now = options.now || (() => new Date());
  let tempSequence = 0;

  function jsonPathFor(page) {
    return path.join(dataDir, `${annotationSlug(page)}.json`);
  }

  // `_seq.json`（{ next }）：标注对外序号 #n 的按桶单调计数器，跨账本唯一、永不复用。
  function seqPath() {
    return path.join(dataDir, '_seq.json');
  }

  function readSeq() {
    try {
      const raw = JSON.parse(fs.readFileSync(seqPath(), 'utf8'));
      return Number.isInteger(raw.next) && raw.next >= 1 ? raw.next : 1;
    } catch {
      return 1;
    }
  }

  function writeSeq(next) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(seqPath(), JSON.stringify({ next }, null, 2) + '\n');
  }

  /** 桶内全部账本现有 max(n) + 1（M3）：_seq.json 被删或损坏时 readSeq 回落 1，
      没有这个地板，新标注会从 #1 重新起号撞存量，「永不复用」破。读不出的
      损坏账本跳过（readDoc 同样把它当空文档，桶内可读状态不含它）。 */
  function bucketFloor() {
    let names;
    try {
      names = fs.readdirSync(dataDir);
    } catch {
      return 1;
    }
    let max = 0;
    for (const name of names) {
      if (!name.endsWith('.json') || name === '_seq.json') continue;
      let doc;
      try {
        doc = normalizeDoc(JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')), name.replace(/\.json$/, ''));
      } catch {
        continue;
      }
      for (const row of doc.annotations) {
        if (Number.isInteger(row.n) && row.n > max) max = row.n;
      }
    }
    return max + 1;
  }

  /** 缺 n 的标注按数组顺序（= 创建顺序）补号；返回 { annotations, assigned }。
      起点 = _seq.next 与桶级地板取大者（M3）。 */
  function assignNumbers(annotations) {
    const missing = annotations.filter((a) => !Number.isInteger(a && a.n));
    if (!missing.length) return { annotations, assigned: 0 };
    let next = Math.max(readSeq(), bucketFloor());
    const out = annotations.map((a) => (Number.isInteger(a && a.n) ? a : { ...a, n: next++ }));
    writeSeq(next);
    return { annotations: out, assigned: missing.length };
  }

  function emptyDoc(page) {
    const slug = annotationSlug(page);
    return {
      page: slug,
      path: '',
      updated_at: null,
      revision: 0,
      annotations: [],
    };
  }

  // Shape returned to the API：新写与广播只带 annotations（旧 marks 键由
  // scripts/migrate-ledgers.mjs 一次性迁净）。
  function asDoc(doc) {
    const annotations = Array.isArray(doc.annotations) ? doc.annotations : [];
    return {
      page: doc.page,
      path: doc.path || '',
      updated_at: doc.updated_at || null,
      page_updated_at: doc.page_updated_at,
      revision: doc.revision,
      annotations,
    };
  }

  function readDoc(page) {
    const safePage = annotationSlug(page);
    const file = jsonPathFor(safePage);
    if (!fs.existsSync(file)) return emptyDoc(safePage);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const normalized = normalizeDoc(raw, safePage);
      const parsedRevision = Number(raw.revision);
      const revision = Number.isInteger(parsedRevision) && parsedRevision >= 0
        ? parsedRevision
        : (normalized.annotations.length ? 1 : 0);
      // 旧标注没有 n 的，首次读到时按创建顺序补号并写回（补号本身不改 revision）。
      const numbered = assignNumbers(normalized.annotations);
      if (numbered.assigned) {
        writeDoc(safePage, {
          path: normalized.path,
          updated_at: normalized.updated_at,
          revision,
          annotations: numbered.annotations,
        });
      }
      return asDoc({
        ...normalized,
        page_updated_at: raw.page_updated_at,
        revision,
        annotations: numbered.annotations,
      });
    } catch {
      return emptyDoc(safePage);
    }
  }

  function writeDoc(page, doc) {
    const safePage = annotationSlug(page);
    fs.mkdirSync(dataDir, { recursive: true });
    const annotations = (Array.isArray(doc.annotations) ? doc.annotations : [])
      .map(normalizeAnnotation);
    const output = {
      page: safePage,
      path: doc.path || '',
      updated_at: doc.updated_at || now().toISOString(),
      revision: doc.revision,
      page_updated_at: doc.page_updated_at,
      annotations,
    };
    const destination = jsonPathFor(safePage);
    const temp = `${destination}.tmp-${process.pid}-${++tempSequence}`;
    let fd;
    try {
      fd = fs.openSync(temp, 'w', 0o600);
      fs.writeFileSync(fd, JSON.stringify(output, null, 1));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, destination);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return asDoc(output);
  }

  function referencedImages(annotations) {
    const files = new Set();
    for (const item of annotations) {
      if (!item || !Array.isArray(item.images)) continue;
      for (const image of item.images) {
        if (image && typeof image.file === 'string') files.add(path.basename(image.file));
      }
    }
    return files;
  }

  function collectUnusedImages(page, annotations) {
    const safePage = annotationSlug(page);
    const imagesDir = path.join(dataDir, 'images');
    if (!fs.existsSync(imagesDir)) return;
    const keep = referencedImages(annotations);
    for (const name of fs.readdirSync(imagesDir)) {
      if (!name.startsWith(`${safePage}-`) || keep.has(name)) continue;
      const file = path.join(imagesDir, name);
      if (fs.statSync(file).isFile()) fs.unlinkSync(file);
    }
  }

  function save(input) {
    const safePage = annotationSlug(input.page ?? 'index');
    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      return { status: 400, error: 'invalid_base_revision', doc: readDoc(safePage) };
    }
    const disk = readDoc(safePage);
    if (disk.revision !== input.baseRevision) {
      return { status: 409, error: 'revision_conflict', doc: disk };
    }
    const list = Array.isArray(input.annotations) ? input.annotations : [];
    // byId 只索引带 id 的存量行：没有 id 的行无从比对，一律当新标注（M1）。
    const byId = new Map(disk.annotations.filter((a) => a.id).map((a) => [a.id, a]));
    const annotations = [];
    for (const raw of list) {
      const a = normalizeAnnotation(raw);
      const before = a.id ? byId.get(a.id) : null;
      if (!before) {
        // 新标注恒为 open（客户端声明什么都不算）；#n 一律由服务端从 _seq.json
        // 取号，客户端带来的 n 直接忽略（M1）。客户端的 nextN 只是保存应答回来
        // 前的临时显示——取号权在服务端，「按桶单调、跨账本唯一、永不复用」
        // 才守得住；客户端猜的号在多账本桶里必撞。
        a.status = 'open';
        delete a.n;
      } else {
        // 沿用旧号（review R3）：重存既有标注缺 n 时绝不重新取号 —— #n 是对外
        // 引用（entry#12），非工作台写入方（CLI、直 POST /save 的 agent）不该
        // 因为没带 n 就把既有引用烧悬空。
        if (Number.isInteger(before.n) && !Number.isInteger(a.n)) a.n = before.n;
        const edited = a.content !== before.content || targetsFingerprint(a) !== targetsFingerprint(before);
        if (edited) {
          // owner 编辑正文或目标 → 保存时状态回 open（服务端强制，与客户端一致）。
          a.status = 'open';
        } else if (!isLegalTransition(before.status, a.status)) {
          return { status: 409, error: 'illegal_transition', detail: `${before.status} → ${a.status}（check / done 只经 /status 端点）`, doc: disk };
        }
      }
      annotations.push(a);
    }
    const pageTimes = { ...(disk.page_updated_at || {}) };
    if (!disk.page_updated_at) {
      const ids = [...new Set(disk.annotations.map(a => a.pageId || options.pageId).filter(Boolean))];
      const previousAt = Date.parse(disk.updated_at);
      if (ids.length === 1 && Number.isFinite(previousAt)) pageTimes[ids[0]] = previousAt;
    }
    for (const id of changedAnnotationPages(disk.annotations, annotations, options.pageId)) pageTimes[id] = now().getTime();
    const doc = writeDoc(safePage, {
      page_updated_at: pageTimes,
      path: input.path || disk.path || '',
      updated_at: input.updated_at || now().toISOString(),
      revision: disk.revision + 1,
      annotations: assignNumbers(annotations).annotations,
    });
    collectUnusedImages(safePage, annotations);
    return { status: 200, doc };
  }

  /** ppnt mark 的后端：open / check → check / done（带一行 note）。 */
  function setStatus(input) {
    const safePage = annotationSlug(input.page ?? 'index');
    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      return { status: 400, error: 'invalid_base_revision', doc: readDoc(safePage) };
    }
    const disk = readDoc(safePage);
    if (disk.revision !== input.baseRevision) {
      return { status: 409, error: 'revision_conflict', doc: disk };
    }
    const wanted = String(input.status || '');
    if (wanted !== 'check' && wanted !== 'done') {
      return { status: 400, error: 'invalid_status', detail: 'status 端点只写 check / done', doc: disk };
    }
    const index = disk.annotations.findIndex((a) => a.id === input.id || (Number.isInteger(input.id) && a.n === input.id) || String(a.n) === String(input.id));
    if (index < 0) return { status: 404, error: 'annotation_not_found', doc: disk };
    const before = disk.annotations[index];
    if (!isLegalMarkTransition(before.status, wanted)) {
      return { status: 409, error: 'illegal_transition', detail: `${before.status} → ${wanted}`, doc: disk };
    }
    const annotations = disk.annotations.slice();
    annotations[index] = {
      ...before,
      status: wanted,
      ...(typeof input.note === 'string' && input.note ? { note: input.note } : {}),
    };
    const doc = writeDoc(safePage, {
      path: disk.path || '',
      updated_at: now().toISOString(),
      revision: disk.revision + 1,
      annotations,
    });
    return { status: 200, doc, annotation: annotations[index] };
  }

  function listDocs() {
    const output = {};
    if (!fs.existsSync(dataDir)) return output;
    for (const name of fs.readdirSync(dataDir).sort()) {
      // _seq.json 是 #n 的桶级计数器，不是账本（R6）：泄进聚合视图会多出
      // 一个 page:'_seq' 的空文档。
      if (!name.endsWith('.json') || name === '_seq.json') continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
        const slug = name.replace(/\.json$/, '');
        output[name] = asDoc({
          ...normalizeDoc(raw, slug),
          revision: Number.isInteger(Number(raw.revision)) && Number(raw.revision) >= 0
            ? Number(raw.revision)
            : normalizeDoc(raw, slug).revision,
        });
      } catch { /* skip corrupt documents in the aggregate view */ }
    }
    return output;
  }

  function imagePath(name) {
    return path.join(dataDir, 'images', annotationSlug(name));
  }

  function writeImage(page, extension, bytes) {
    const safePage = annotationSlug(page);
    const imagesDir = path.join(dataDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const name = `${safePage}-${now().getTime()}-${++tempSequence}.${extension}`;
    const file = path.join(imagesDir, name);
    fs.writeFileSync(file, bytes);
    return { file: name, path: file };
  }

  return {
    dataDir,
    emptyDoc,
    imagePath,
    jsonPathFor,
    listDocs,
    readDoc,
    save,
    setStatus,
    writeImage,
  };
}
