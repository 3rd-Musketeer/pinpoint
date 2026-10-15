/** 破坏性操作共用的空桶判定：完整读取文件后计数，无法判定就保留并报错。 */
import fs from 'node:fs';
import path from 'node:path';

import { CliError } from './core.js';

export function checkedBucketRowCount(bucket) {
  let inspecting = bucket;
  try {
    let stat;
    try { stat = fs.lstatSync(bucket); } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
    if (!stat.isDirectory()) throw new Error('桶路径不是普通目录');
    let rows = 0;
    const ledgerKeys = [];
    let imageDir = null;
    for (const item of fs.readdirSync(bucket, { withFileTypes: true })) {
      inspecting = path.join(bucket, item.name);
      if (item.name === 'images' && item.isDirectory()) { imageDir = inspecting; continue; }
      if (!item.isFile() || !item.name.endsWith('.json')) throw new Error('未知文件或目录');
      const doc = JSON.parse(fs.readFileSync(inspecting, 'utf8'));
      if (item.name === '_seq.json') {
        if (!doc || !Number.isSafeInteger(doc.next) || doc.next < 1) throw new Error('序号文件结构异常');
      } else {
        if (!doc || !Array.isArray(doc.annotations)) throw new Error('账本 annotations 必须是数组');
        ledgerKeys.push(item.name.slice(0, -5));
        rows += doc.annotations.length;
      }
    }
    if (imageDir) {
      for (const image of fs.readdirSync(imageDir, { withFileTypes: true })) {
        inspecting = path.join(imageDir, image.name);
        // 图片必须能归到已完整读过的账本，且符合 writeImage 的文件名结构。
        const owned = ledgerKeys.some((key) => image.name.startsWith(`${key}-`)
          && /^\d+-\d+\.(png|jpg|jpeg|gif|webp)$/.test(image.name.slice(key.length + 1)));
        if (!image.isFile() || !owned) {
          throw new Error('图片文件无法确认归属');
        }
      }
    }
    return rows;
  } catch (error) {
    throw new CliError(`无法确认标注桶 ${bucket} 为空，保留原文件：${inspecting}：${error.message}`);
  }
}
