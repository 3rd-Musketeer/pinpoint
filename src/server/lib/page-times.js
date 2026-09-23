import fs from 'node:fs';
import path from 'node:path';
import { contentMtimeMs } from './content-mtime.js';
import { annotationsFromDoc } from '../../shared/annotation-indicator.js';

export function annotationPageTimes(dataDir, fallbackPageId) {
  const times = {};
  if (!fs.existsSync(dataDir)) return times;
  const take = (id, at) => { const value = typeof at === 'number' ? at : Date.parse(at); if (id && Number.isFinite(value) && value > 0) times[id] = Math.max(times[id] || 0, value); };
  for (const file of fs.readdirSync(dataDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      for (const [id, at] of Object.entries(doc.page_updated_at || {})) take(id, at);
      // A mixed legacy ledger cannot tell which page its last save changed.
      const ids = [...new Set(annotationsFromDoc(doc).map(a => a.pageId || fallbackPageId).filter(Boolean))];
      if (!doc.page_updated_at && ids.length === 1) take(ids[0], doc.updated_at);
      if (!doc.page_updated_at && !ids.length && fallbackPageId && doc.updated_at) take(fallbackPageId, doc.updated_at);
    } catch { /* A broken ledger does not fabricate a timestamp. */ }
  }
  return times;
}

export function collectPageTimes({ entries, root, dataRoot, localIds }) {
  const out = {};
  for (const id of localIds) out[id] = { addedAt: null, mtime: contentMtimeMs({ kind: 'dir', path: path.join(root, 'content/previews', id) }), annotatedAt: null };
  out.components = { addedAt: null, mtime: contentMtimeMs({ kind: 'dir', path: path.join(root, 'content/kits/ios/components') }), annotatedAt: null };
  for (const entry of entries) if (entry.id !== 'pinpoint') out[entry.id] = { addedAt: entry.addedAt || null, mtime: contentMtimeMs(entry), annotatedAt: null };
  for (const entry of entries) {
    const times = annotationPageTimes(path.join(dataRoot, entry.id), entry.id === 'pinpoint' ? null : entry.id);
    for (const [id, at] of Object.entries(times)) if (out[id]) out[id].annotatedAt = Math.max(out[id].annotatedAt || 0, at);
  }
  for (const entry of entries) if (entry.page && out[entry.page] && out[entry.id]) {
    for (const key of ['mtime', 'annotatedAt']) out[entry.page][key] = Math.max(out[entry.page][key] || 0, out[entry.id][key] || 0) || null;
  }
  return out;
}

export function changedAnnotationPages(before, after, fallbackPageId) {
  const previous = new Map(before.map(a => [a.id, a]));
  const next = new Map(after.map(a => [a.id, a]));
  const changed = new Set();
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const a = previous.get(id), b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a?.pageId || fallbackPageId) changed.add(a?.pageId || fallbackPageId);
    if (b?.pageId || fallbackPageId) changed.add(b?.pageId || fallbackPageId);
  }
  return [...changed];
}
