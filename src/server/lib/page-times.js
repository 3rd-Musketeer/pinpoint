import path from 'node:path';
import { contentMtimeMs } from './content-mtime.js';
import { readBucketLedgers } from './orphans.js';

/**
 * 一个桶目录里各账本的时间 → { pageId: ms }。
 *
 * 桶 = 页：桶里的账本整体属于这个页，各账本 updated_at 一律记给桶 id，
 * 取最近一次。rename 只改桶名，页时间不断档。
 */
/** ledgers 给了就用它（调用方已经读过这只桶），否则自己读。坏账本不造时间。 */
export function annotationPageTimes(dataDir, pageId, ledgers = null) {
  const times = {};
  for (const { doc } of ledgers || readBucketLedgers(dataDir)) {
    const value = Date.parse(doc && doc.updated_at);
    if (Number.isFinite(value) && value > 0) times[pageId] = Math.max(times[pageId] || 0, value);
  }
  return times;
}

/** ledgersOf(pageId) 给了，各页的时间从这份已读账本派生，不再自己读桶。 */
export function collectPageTimes({ entries, root, dataRoot, localIds, ledgersOf = null }) {
  const out = {};
  for (const id of localIds) out[id] = { addedAt: null, mtime: contentMtimeMs({ kind: 'dir', path: path.join(root, 'content/previews', id) }), annotatedAt: null };
  for (const entry of entries) if (entry.id !== 'pinpoint') out[entry.id] = { addedAt: entry.addedAt || null, mtime: contentMtimeMs(entry), annotatedAt: null };
  // 桶 = 页：每个页读自己的桶。
  for (const id of Object.keys(out)) {
    const times = annotationPageTimes(path.join(dataRoot, id), id, ledgersOf ? ledgersOf(id) : null);
    for (const [hit, at] of Object.entries(times)) if (out[hit]) out[hit].annotatedAt = Math.max(out[hit].annotatedAt || 0, at);
  }
  return out;
}
