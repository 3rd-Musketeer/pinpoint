/**
 * Annotation data root and per-entry buckets under ~/.html-annotate.
 * Registry entries own buckets: <root>/<entry-id>/ holds that entry's
 * annotation documents and images. HTML_ANNOTATE_DATA_DIR overrides the
 * root wholesale (e2e points it at a temp dir).
 */
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ENTRY = 'pinpoint';

export function dataRoot(env = process.env) {
  return env.HTML_ANNOTATE_DATA_DIR || path.join(os.homedir(), '.html-annotate');
}

export function bucketDir(root, entryId) {
  return path.join(root, entryId);
}
