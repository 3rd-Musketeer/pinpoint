/**
 * Annotation data root and per-entry buckets under ~/.pinpoint.
 * Registry entries own buckets: <root>/<entry-id>/ holds that entry's
 * annotation documents and images. PINPOINT_DATA_DIR overrides the
 * root wholesale (e2e points it at a temp dir).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PAGE_ID_PATTERN } from '../../shared/registry-ids.js';

export const DEFAULT_ENTRY = 'pinpoint';

export function dataRoot(env = process.env) {
  if (env.PINPOINT_DATA_DIR) return env.PINPOINT_DATA_DIR;
  return path.join(os.homedir(), '.pinpoint');
}

export function bucketDir(root, entryId) {
  return path.join(root, entryId);
}

/** 页 id 形状的桶目录在盘上。不合页 id 形状的 id（`..`、带 `/`）不拿去拼路径，答 false。
    整桶孤儿（页已不在、桶还在）靠它照样能读写：服务的桶校验与 CLI 的目标解析共用。 */
export function bucketOnDisk(root, entryId) {
  if (!PAGE_ID_PATTERN.test(String(entryId))) return false;
  try {
    return fs.statSync(bucketDir(root, String(entryId))).isDirectory();
  } catch {
    return false;
  }
}
