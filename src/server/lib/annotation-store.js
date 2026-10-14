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
import { CANVAS_LEDGER, PROSE_LEDGER } from '../../shared/project-ids.js';

export { annotationSlug };

export { normalizeAnnotation, normalizeDoc, annotationsFromDoc };

/** 画布账本的固定名（storage-unify）：一页的画布 + mention 帧标注住
 *  `<pageId>/@canvas.json`。`@` 不在 annotationSlug 的保字符集里，所以这个
 * 名字走专用通道（ledgerKey），绝不过 slug —— 过了会变成 `_canvas.json`，
 * 客户端（PAGE='@canvas'）与服务端各写一个文件。
 *  正文评论账本（pp3）：一篇 article 的正文评论住在这篇的桶
 *  `<articlePageId>/@prose.json`，和画布的 `@canvas.json` 同桶、同一套 #n，同样不过 slug。
 *  两个名字定义在 src/shared/project-ids.js。 */
export { CANVAS_LEDGER, PROSE_LEDGER };

const FIXED_LEDGERS = new Set([CANVAS_LEDGER, PROSE_LEDGER]);

/** 原始 page 串 → 账本 doc key：固定名账本（@canvas、@prose）原样保留，其余走
 * annotationSlug。路由层（GET /annotations/<page>）与 store 内部必须同用这一条，
 * 否则 '@canvas' 会在路由处被 slug 成 '_canvas' 而读不到文件。 */
export function ledgerKey(raw) {
  const s = String(raw ?? '');
  return FIXED_LEDGERS.has(s) ? s : annotationSlug(s);
}

/** 线程消息的作者：owner 在页面上写，agent 只经 /reply 端点写。 */
export const MESSAGE_AUTHORS = new Set(['owner', 'agent']);

/** targets 的稳定指纹（编辑目标判定用：选择器集合变了才算改了目标）。 */
function targetsFingerprint(annotation) {
  const list = Array.isArray(annotation && annotation.targets) && annotation.targets.length
    ? annotation.targets
    : (annotation && annotation.selector ? [{ selector: annotation.selector }] : []);
  return list.map((target) => `${target.ref || ''}${target.selector || ''}`).join('') || '';
}

/** 正文评论里 owner 写的部分（引文 + owner 的回复）的指纹：变了算 owner 编辑，
    状态回 open。agent 的回复不算（它只经 /reply 写，且不改状态）。 */
function ownerThreadFingerprint(annotation) {
  const quote = annotation && annotation.quote && typeof annotation.quote === 'object' ? String(annotation.quote.exact || '') : '';
  const messages = Array.isArray(annotation && annotation.messages) ? annotation.messages : [];
  const owner = messages.filter((m) => m && m.who !== 'agent').map((m) => String(m.text ?? ''));
  return JSON.stringify([quote, owner]);
}

/**
 * 盘上有、这次保存的行里没有的 agent 消息补回去（按 who + text + at 认同一条），保持盘上的先后。
 * 没有要补的返回 null。
 */
export function keepAgentMessages(diskMessages, incoming) {
  const disk = Array.isArray(diskMessages) ? diskMessages : [];
  const next = Array.isArray(incoming) ? incoming.slice() : [];
  const same = (a, b) => a && b && a.who === b.who && a.text === b.text && a.at === b.at;
  const missing = disk.filter((m) => m && m.who === 'agent' && !next.some((n) => same(n, m)));
  if (!missing.length) return null;
  const out = [];
  for (const m of disk) {
    if (next.some((n) => same(n, m)) || missing.includes(m)) out.push(next.find((n) => same(n, m)) || m);
  }
  for (const m of next) if (!out.some((o) => same(o, m))) out.push(m);
  return out;
}

/** 写账本时桶目录不见了（`ppnt remove` / prune 删了它，或 `ppnt rename` 把它挪走了）。
    这次写什么都没落盘：临时文件已清掉，旧账本（若还在）原样。路由回 503 bucket_gone。 */
export class BucketGoneError extends Error {
  constructor(dataDir, cause) {
    super(`标注桶 ${dataDir} 在写入途中被删除或移走，这次没写`);
    this.name = 'BucketGoneError';
    this.code = 'bucket_gone';
    this.cause = cause;
  }
}

// 账本与 _seq.json 的临时文件：<目标>.tmp-<pid>-<序号>。
const TEMP_NAME = /\.json\.tmp-(\d+)-\d+$/;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function createAnnotationStore(options) {
  const dataDir = options.dataDir;
  const now = options.now || (() => new Date());
  let tempSequence = 0;
  // 每本账本最后一次 /save 写出的 { revision, saveId }（只在内存里）：离开页面时的快照带
  // after = 在途那次的 saveId，在途那次先落盘时快照照样接上（见 save 的 after）。服务重启后
  // 记录没了，快照按普通 baseRevision 判，最坏回到 409。
  const lastSave = new Map();

  function jsonPathFor(page) {
    return path.join(dataDir, `${ledgerKey(page)}.json`);
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
    writeFileAtomic(seqPath(), JSON.stringify({ next }, null, 2) + '\n');
  }

  /** 遗留的临时文件：本进程的（写是同步的，进到这里时不可能有本进程在途的写）和已退出
      进程的。它们出现在两种情况：桶在 open 与 rename 之间被 `ppnt rename` 挪走，临时文件
      跟着桶搬到了新名下，旧路径上删不到；或写到一半进程死了。读侧本来就不认它们
      （只读 .json），这里顺手清掉，桶里不留垃圾。 */
  function sweepStaleTemps() {
    let names;
    try {
      names = fs.readdirSync(dataDir);
    } catch {
      return;
    }
    for (const name of names) {
      const match = name.match(TEMP_NAME);
      if (!match) continue;
      const pid = Number(match[1]);
      if (pid !== process.pid && processAlive(pid)) continue;
      try { fs.unlinkSync(path.join(dataDir, name)); } catch { /* 已被别处清掉 */ }
    }
  }

  /** 原子写：同目录临时文件 → fsync → rename。读者只会看到旧文件或新文件，不会读到半份。
      桶目录在这期间被删 / 被挪走（ENOENT）时清掉临时文件、抛 BucketGoneError；
      别的错清掉临时文件后原样抛。 */
  function writeFileAtomic(destination, text) {
    fs.mkdirSync(dataDir, { recursive: true });
    sweepStaleTemps();
    const temp = `${destination}.tmp-${process.pid}-${++tempSequence}`;
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, destination);
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* 已关 */ }
      }
      try { fs.unlinkSync(temp); } catch { /* 没建成，或随桶一起没了 / 被挪走 */ }
      if (error && error.code === 'ENOENT') throw new BucketGoneError(dataDir, error);
      throw error;
    }
  }

  /** 写入口（save / setStatus / appendMessage）共用：桶在写的途中没了 → 503 bucket_gone，
      不让它变成路由里的 500。 */
  function bucketGone(safePage, error) {
    if (!(error instanceof BucketGoneError)) throw error;
    return { status: 503, error: error.code, detail: error.message, doc: emptyDoc(safePage) };
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
    const slug = ledgerKey(page);
    return {
      page: slug,
      path: '',
      updated_at: null,
      revision: 0,
      annotations: [],
    };
  }

  // Shape returned to the API：新写与广播只带 annotations（磁盘上的账本只有
  // annotations 键）。
  function asDoc(doc) {
    const annotations = Array.isArray(doc.annotations) ? doc.annotations : [];
    return {
      page: doc.page,
      path: doc.path || '',
      updated_at: doc.updated_at || null,
      revision: doc.revision,
      annotations,
    };
  }

  function readDoc(page) {
    const safePage = ledgerKey(page);
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
        revision,
        annotations: numbered.annotations,
      });
    } catch {
      return emptyDoc(safePage);
    }
  }

  function writeDoc(page, doc) {
    const safePage = ledgerKey(page);
    const annotations = (Array.isArray(doc.annotations) ? doc.annotations : [])
      .map(normalizeAnnotation);
    const output = {
      page: safePage,
      path: doc.path || '',
      updated_at: doc.updated_at || now().toISOString(),
      revision: doc.revision,
      annotations,
    };
    writeFileAtomic(jsonPathFor(safePage), JSON.stringify(output, null, 1));
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
    const safePage = ledgerKey(page);
    const imagesDir = path.join(dataDir, 'images');
    const keep = referencedImages(annotations);
    // 账本已经写成，这里只是顺手清图：桶在这期间被删（ENOENT）就没有图可清。
    try {
      for (const name of fs.readdirSync(imagesDir)) {
        if (!name.startsWith(`${safePage}-`) || keep.has(name)) continue;
        const file = path.join(imagesDir, name);
        if (fs.statSync(file).isFile()) fs.unlinkSync(file);
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }

  function save(input) {
    const safePage = ledgerKey(input.page ?? 'index');
    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      return { status: 400, error: 'invalid_base_revision', doc: readDoc(safePage) };
    }
    const disk = readDoc(safePage);
    // after：客户端离开页面时，上一次保存还在路上，又改过一版。这份快照以 baseRevision 为底，
    // 声明“我接在 saveId = after 那次保存之后”。盘上正好是那次保存写出的下一版时照样落盘；
    // 快照先到时它按 baseRevision 落盘，在途那次随后 409。两份请求谁先到，盘上都是快照。
    const previous = lastSave.get(safePage);
    const followsInflight = typeof input.after === 'string' && input.after !== ''
      && previous && previous.saveId === input.after
      && previous.revision === disk.revision && disk.revision === input.baseRevision + 1;
    if (disk.revision !== input.baseRevision && !followsInflight) {
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
        const edited = a.content !== before.content
          || targetsFingerprint(a) !== targetsFingerprint(before)
          || ownerThreadFingerprint(a) !== ownerThreadFingerprint(before);
        if (edited) {
          // owner 编辑正文或目标 → 保存时状态回 open（服务端强制，与客户端一致）。
          a.status = 'open';
        } else if (!isLegalTransition(before.status, a.status)) {
          return { status: 409, error: 'illegal_transition', detail: `${before.status} → ${a.status}（check / done 只经 /status 端点）`, doc: disk };
        }
        // agent 的回复只经 /reply 写：客户端带来的快照比盘上旧、少了这几条时照留（不丢 agent 的话）。
        const merged = keepAgentMessages(before.messages, a.messages);
        if (merged) a.messages = merged;
      }
      annotations.push(a);
    }
    let doc;
    try {
      doc = writeDoc(safePage, {
        path: input.path || disk.path || '',
        updated_at: input.updated_at || now().toISOString(),
        revision: disk.revision + 1,
        annotations: assignNumbers(annotations).annotations,
      });
    } catch (error) {
      return bucketGone(safePage, error);
    }
    if (typeof input.saveId === 'string' && input.saveId) lastSave.set(safePage, { revision: doc.revision, saveId: input.saveId });
    else lastSave.delete(safePage);
    collectUnusedImages(safePage, annotations);
    return { status: 200, doc };
  }

  /** ppnt mark 的后端：open / check → check / done。 */
  function setStatus(input) {
    const safePage = ledgerKey(input.page ?? 'index');
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
    annotations[index] = { ...before, status: wanted };
    let doc;
    try {
      doc = writeDoc(safePage, {
        path: disk.path || '',
        updated_at: now().toISOString(),
        revision: disk.revision + 1,
        annotations,
      });
    } catch (error) {
      return bucketGone(safePage, error);
    }
    return { status: 200, doc, annotation: annotations[index] };
  }

  /** ppnt reply 的后端：往一条标注的线程末尾追加一条 agent 消息，状态不动。任何一种标注都有线程：
      正文评论、画布标注、文档页标注（docs/annotation.md“线程”）。 */
  function appendMessage(input) {
    const safePage = ledgerKey(input.page ?? 'index');
    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      return { status: 400, error: 'invalid_base_revision', doc: readDoc(safePage) };
    }
    const disk = readDoc(safePage);
    if (disk.revision !== input.baseRevision) {
      return { status: 409, error: 'revision_conflict', doc: disk };
    }
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) return { status: 400, error: 'empty_message', detail: '回复不能为空', doc: disk };
    const who = input.who || 'agent';
    if (!MESSAGE_AUTHORS.has(who)) return { status: 400, error: 'invalid_author', detail: `who 只能是 ${[...MESSAGE_AUTHORS].join(' / ')}`, doc: disk };
    const index = disk.annotations.findIndex((a) => a.id === input.id || (Number.isInteger(input.id) && a.n === input.id) || String(a.n) === String(input.id));
    if (index < 0) return { status: 404, error: 'annotation_not_found', doc: disk };
    const before = disk.annotations[index];
    const message = { who, text, at: now().toISOString() };
    const annotations = disk.annotations.slice();
    annotations[index] = { ...before, messages: [...(Array.isArray(before.messages) ? before.messages : []), message] };
    let doc;
    try {
      doc = writeDoc(safePage, {
        path: disk.path || '',
        updated_at: message.at,
        revision: disk.revision + 1,
        annotations,
      });
    } catch (error) {
      return bucketGone(safePage, error);
    }
    return { status: 200, doc, annotation: annotations[index], message };
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
    // 只取 basename 防穿越，不再 slug：图片名的前缀是账本 key（可能是 '@canvas'），
    // slug 会把 '@' 折成 '_' 而 404。
    return path.join(dataDir, 'images', path.basename(String(name)));
  }

  function writeImage(page, extension, bytes) {
    const safePage = ledgerKey(page);
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
    appendMessage,
    writeImage,
  };
}
