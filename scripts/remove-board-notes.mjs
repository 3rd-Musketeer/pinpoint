import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Explicit board files only; no registry traversal or migration during server startup.
export function removeBoardNotes(file, { backupDir } = {}) {
  file = path.resolve(file);
  const original = fs.readFileSync(file, 'utf8');
  const board = JSON.parse(original);
  let count = 0;
  for (const section of board.sections || []) {
    if (Object.hasOwn(section, 'note')) { delete section.note; count++; }
    for (const screen of section.screens || []) {
      if (screen && typeof screen === 'object' && Object.hasOwn(screen, 'note')) {
        delete screen.note;
        count++;
      }
    }
  }
  const result = { file, count, applied: false };
  if (!backupDir || !count) return result;
  const hash = crypto.createHash('sha256').update(original).digest('hex');
  const key = crypto.createHash('sha256').update(file).digest('hex').slice(0, 16);
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${key}-${hash}.json`);
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
  if (fs.readFileSync(backup, 'utf8') !== original) throw new Error(`Backup mismatch: ${backup}`);
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error(`Board changed during migration: ${file}`);
  const temp = `${file}.remove-board-notes-${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(board, null, 2) + '\n', {flag:'wx', mode:fs.statSync(file).mode});
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return { ...result, applied: true, backup };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let backupDir;
  if (args[0] === '--backup-dir') {
    args.shift();
    backupDir = args.shift();
    if (!backupDir) throw new Error('Missing backup directory');
  }
  if (!args.length || args.some(arg => arg.startsWith('--'))) throw new Error('Usage: node scripts/remove-board-notes.mjs [--backup-dir DIR] BOARD.json ... (without backup-dir: dry run)');
  for (const file of args) console.log(JSON.stringify(removeBoardNotes(file, {backupDir})));
}
