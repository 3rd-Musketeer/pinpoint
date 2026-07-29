/**
 * Per-project annotation data directory under ~/.html-annotate.
 * Pure path helpers so annotate-api and export-doc-api share one location.
 * The workbench page key is always /index.html, so a shared ~/.html-annotate
 * would mix documents across clones on the same machine.
 */
import path from 'node:path';
import os from 'node:os';

export function projectDirName(root) {
  const r = String(root || '');
  let h = 0;
  for (let i = 0; i < r.length; i++) h = (h * 31 + r.charCodeAt(i)) >>> 0;
  return path.basename(r) + '-' + h.toString(36);
}

export function projectDataDir(root) {
  return path.join(os.homedir(), '.html-annotate', projectDirName(root));
}
