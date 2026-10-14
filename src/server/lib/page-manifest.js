/**
 * 本地 manifest 页 id 名单（tracked `content/previews/_index.json`；
 * `_index.local.json` 覆盖机制已于 pp2 切片 3 退役，与 workbench 的
 * loadPageManifest 同源）。
 *
 * 消费者：CLI 与服务端认模板页的标注桶（模板页不在登记表里，但也是页桶）。
 *
 * 文件损坏时返回 []。
 */
import fs from 'node:fs';
import path from 'node:path';

export function manifestPageIds(root) {
  const file = path.join(root, 'content', 'previews', '_index.json');
  if (!fs.existsSync(file)) return [];
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc && Array.isArray(doc.pages)) {
      return doc.pages.map((page) => page && page.id).filter((id) => typeof id === 'string');
    }
    return []; // 存在的 manifest 损坏 = 诚实空列表（workbench 同样会报错）
  } catch {
    return [];
  }
}
