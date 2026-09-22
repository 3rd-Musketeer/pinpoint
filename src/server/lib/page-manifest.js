/**
 * 本地 manifest 页 id 名单（tracked `content/previews/_index.json`；
 * `_index.local.json` 覆盖机制已于 pp2 切片 3 退役，与 workbench 的
 * loadPageManifest 同源）。
 *
 * 两处消费者：CLI 的 `--page` / `pinpoint folder move` 校验归属目标，服务端的
 * 文件夹写接口判断一个 id 是 registry 条目还是模板页（模板页不在登记表里，
 * 但照样要能拖进夹）。
 *
 * 文件损坏时返回 []——诚实的空名单让写入被拒，比静默写坏 registry 好。
 */
import fs from 'node:fs';
import path from 'node:path';

export function localManifestPageIds(root) {
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
