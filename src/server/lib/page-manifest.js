/**
 * 本地 manifest 页 id 名单（`content/previews/_index.local.json` 优先，缺失
 * 回落 tracked `_index.json`；与 workbench 的 loadPageManifest 同源）。
 *
 * 两处消费者：CLI 的 `--page` / `pinpoint folder move` 校验归属目标，服务端的
 * 文件夹写接口判断一个 id 是 registry 条目还是模板页（Component Library 等
 * 不在登记表里，但照样要能拖进夹）。
 *
 * 文件损坏时返回 []——诚实的空名单让写入被拒，比静默写坏 registry 好。
 */
import fs from 'node:fs';
import path from 'node:path';

export function localManifestPageIds(root) {
  for (const name of ['_index.local.json', '_index.json']) {
    const file = path.join(root, 'content', 'previews', name);
    if (!fs.existsSync(file)) continue;
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
  return [];
}
