import fs from 'node:fs';
import path from 'node:path';
import { contentMtimeMs } from './content-mtime.js';
import { annotationsFromDoc } from '../../shared/annotation-indicator.js';

/**
 * 一个桶目录里各账本的时间 → { pageId: ms }。
 *
 * storage-unify（桶 = 页）后主规则：桶里的账本整体属于这个页，页时间 = 各账本
 * 最近一次保存（updated_at）。读侧兼容两条存量形态：
 * - `page_updated_at` 逐页映射（写侧已停写，见 annotation-store.save）：照读；
 * - 无映射的旧账本：行上 pageId 唯一时把 updated_at 记给那个页；一行 pageId
 *   都没有（含空账本）记给桶的 fallback 页。
 * 多页混合且无映射的旧画布账本归因不了，不造时间（与旧读侧同判）。
 */
export function annotationPageTimes(dataDir, fallbackPageId) {
  const times = {};
  if (!fs.existsSync(dataDir)) return times;
  const take = (id, at) => { const value = typeof at === 'number' ? at : Date.parse(at); if (id && Number.isFinite(value) && value > 0) times[id] = Math.max(times[id] || 0, value); };
  for (const file of fs.readdirSync(dataDir)) {
    if (!file.endsWith('.json') || file === '_seq.json') continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      for (const [id, at] of Object.entries(doc.page_updated_at || {})) take(id, at);
      const ids = [...new Set(annotationsFromDoc(doc).map(a => a.pageId).filter(Boolean))];
      if (ids.length === 1) take(ids[0], doc.updated_at);
      else if (!ids.length && fallbackPageId) take(fallbackPageId, doc.updated_at);
    } catch { /* A broken ledger does not fabricate a timestamp. */ }
  }
  return times;
}

export function collectPageTimes({ entries, root, dataRoot, localIds }) {
  const out = {};
  for (const id of localIds) out[id] = { addedAt: null, mtime: contentMtimeMs({ kind: 'dir', path: path.join(root, 'content/previews', id) }), annotatedAt: null };
  for (const entry of entries) if (entry.id !== 'pinpoint') out[entry.id] = { addedAt: entry.addedAt || null, mtime: contentMtimeMs(entry), annotatedAt: null };
  // 桶 = 页：每个页读自己的桶。pinpoint 桶仍读（存量画布账本的 page_updated_at
  // 映射 / 单页行还在那里，迁移前页时间不能断）；挂靠条目（entry.page）的旧桶
  // 也读，随后并进宿主页 —— 都是读侧兼容，迁移后这两个来源自然为空。
  const readIds = new Set([...Object.keys(out)]);
  for (const entry of entries) if (entry.id !== 'pinpoint') readIds.add(entry.id);
  for (const id of readIds) {
    const times = annotationPageTimes(path.join(dataRoot, id), id);
    for (const [hit, at] of Object.entries(times)) if (out[hit]) out[hit].annotatedAt = Math.max(out[hit].annotatedAt || 0, at);
  }
  const legacyPinpoint = annotationPageTimes(path.join(dataRoot, 'pinpoint'), null);
  for (const [hit, at] of Object.entries(legacyPinpoint)) if (out[hit]) out[hit].annotatedAt = Math.max(out[hit].annotatedAt || 0, at);
  for (const entry of entries) if (entry.page && out[entry.page] && out[entry.id]) {
    for (const key of ['mtime', 'annotatedAt']) out[entry.page][key] = Math.max(out[entry.page][key] || 0, out[entry.id][key] || 0) || null;
  }
  return out;
}
