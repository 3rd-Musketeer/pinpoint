/** 服务端共用的只读 fs 小谓词：出错（不存在 / 权限）一律按「没有」答。 */
import fs from 'node:fs';

export function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
