/**
 * Annotation data root and per-entry buckets under ~/.pinpoint.
 * Registry entries own buckets: <root>/<entry-id>/ holds that entry's
 * annotation documents and images. PINPOINT_DATA_DIR overrides the
 * root wholesale (e2e points it at a temp dir). The deprecated
 * HTML_ANNOTATE_DATA_DIR still wins over the default but logs a warning.
 */
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ENTRY = 'pinpoint';

export function dataRoot(env = process.env) {
  if (env.PINPOINT_DATA_DIR) return env.PINPOINT_DATA_DIR;
  if (env.HTML_ANNOTATE_DATA_DIR) {
    console.error('[annotate] HTML_ANNOTATE_DATA_DIR is deprecated; rename it to PINPOINT_DATA_DIR');
    return env.HTML_ANNOTATE_DATA_DIR;
  }
  return path.join(os.homedir(), '.pinpoint');
}

export function bucketDir(root, entryId) {
  return path.join(root, entryId);
}
