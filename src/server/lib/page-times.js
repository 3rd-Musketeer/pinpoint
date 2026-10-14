import fs from 'node:fs';
import path from 'node:path';
import { contentMtimeMs } from './content-mtime.js';

/**
 * 一个桶目录里各账本的时间 → { pageId: ms }。
 *
 * 桶 = 页：桶里的账本整体属于这个页，各账本 updated_at 一律记给桶 id，
 * 取最近一次。rename 只改桶名，页时间不断档。
 */
export function annotationPageTimes(dataDir, pageId) {
  const times = {};
  if (!fs.existsSync(dataDir)) return times;
  for (const file of fs.readdirSync(dataDir)) {
    if (!file.endsWith('.json') || file === '_seq.json') continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      const value = Date.parse(doc.updated_at);
      if (Number.isFinite(value) && value > 0) times[pageId] = Math.max(times[pageId] || 0, value);
    } catch { /* A broken ledger does not fabricate a timestamp. */ }
  }
  return times;
}

export function collectPageTimes({ entries, root, dataRoot, localIds }) {
  const out = {};
  for (const id of localIds) out[id] = { addedAt: null, mtime: contentMtimeMs({ kind: 'dir', path: path.join(root, 'content/previews', id) }), annotatedAt: null };
  for (const entry of entries) if (entry.id !== 'pinpoint') out[entry.id] = { addedAt: entry.addedAt || null, mtime: contentMtimeMs(entry), annotatedAt: null };
  // 桶 = 页：每个页读自己的桶；挂靠条目（entry.page）的桶也读，随后并进宿主页。
  const readIds = new Set([...Object.keys(out)]);
  for (const entry of entries) if (entry.id !== 'pinpoint') readIds.add(entry.id);
  for (const id of readIds) {
    const times = annotationPageTimes(path.join(dataRoot, id), id);
    for (const [hit, at] of Object.entries(times)) if (out[hit]) out[hit].annotatedAt = Math.max(out[hit].annotatedAt || 0, at);
  }
  for (const entry of entries) if (entry.page && out[entry.page] && out[entry.id]) {
    for (const key of ['mtime', 'annotatedAt']) out[entry.page][key] = Math.max(out[entry.page][key] || 0, out[entry.id][key] || 0) || null;
  }
  return out;
}
