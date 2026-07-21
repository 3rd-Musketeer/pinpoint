import fs from 'node:fs';
import path from 'node:path';

import {
  annotationsFromDoc,
  normalizeAnnotation,
  normalizeDoc,
} from './annotation-indicator.js';
import { annotationSlug } from './annotation-slug.js';

export { annotationSlug };

export { normalizeAnnotation, normalizeDoc, annotationsFromDoc };

export function createAnnotationStore(options) {
  const dataDir = options.dataDir;
  const now = options.now || (() => new Date());
  let tempSequence = 0;

  function jsonPathFor(page) {
    return path.join(dataDir, `${annotationSlug(page)}.json`);
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

  // Shape returned to the API. Disk reads dual-read legacy `marks` via
  // annotationsFromDoc; new writes and broadcasts carry `annotations` only.
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
      return asDoc({
        ...normalized,
        revision,
      });
    } catch {
      return emptyDoc(safePage);
    }
  }

  function writeDoc(page, doc) {
    const safePage = annotationSlug(page);
    fs.mkdirSync(dataDir, { recursive: true });
    const annotations = (Array.isArray(doc.annotations) ? doc.annotations : annotationsFromDoc(doc))
      .map(normalizeAnnotation);
    const output = {
      page: safePage,
      path: doc.path || '',
      updated_at: doc.updated_at || now().toISOString(),
      revision: doc.revision,
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
    const list = Array.isArray(input.annotations)
      ? input.annotations
      : (Array.isArray(input.marks) ? input.marks : []);
    const annotations = list.map(normalizeAnnotation);
    const doc = writeDoc(safePage, {
      path: input.path || disk.path || '',
      updated_at: input.updated_at || now().toISOString(),
      revision: disk.revision + 1,
      annotations,
    });
    collectUnusedImages(safePage, annotations);
    return { status: 200, doc };
  }

  function listDocs() {
    const output = {};
    if (!fs.existsSync(dataDir)) return output;
    for (const name of fs.readdirSync(dataDir).sort()) {
      if (!name.endsWith('.json')) continue;
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
    writeImage,
  };
}
