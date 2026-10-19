/**
 * 本地 manifest 页（tracked `content/previews/_index.json`；
 * `_index.local.json` 覆盖机制已于 pp2 切片 3 退役，与 workbench 的
 * loadPageManifest 同源）。
 *
 * 消费者：CLI 与服务端认模板页的标注桶（模板页不在登记表里，但也是页桶）；
 * board-source 拿清单条目（frame-doc 的模板页要清单里的 mode）。
 *
 * 文件损坏时返回 []。
 */
import fs from 'node:fs';
import path from 'node:path';

/** _index.json 的 pages 数组（原样条目：{ id, title?, mode? }）；缺失 / 损坏 → []。 */
export function manifestPages(root) {
  const file = path.join(root, 'content', 'previews', '_index.json');
  if (!fs.existsSync(file)) return [];
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc && Array.isArray(doc.pages)) return doc.pages;
    return []; // 存在的 manifest 损坏 = 诚实空列表（workbench 同样会报错）
  } catch {
    return [];
  }
}

export function manifestPageIds(root) {
  return manifestPages(root).map((page) => page && page.id).filter((id) => typeof id === 'string');
}
