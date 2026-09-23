import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const SCRIPT = new URL('./migrate-ledgers.mjs', import.meta.url).pathname;

/** 旧形态账本：result / marks / comment / group / groupLabel / [@m:] 全占齐。 */
function seedLedger(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bucket-a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bucket-a', 'index.html.json'), JSON.stringify({
    page: 'index.html', path: '/index.html', revision: 3,
    marks: [
      { id: 'a1', n: 1, comment: '带结果 [@m:zz99aa]', group: 'inbox', groupLabel: 'Inbox', result: { operations: [] } },
      { id: 'a2', n: 2, comment: '没结果', section: 'keep' },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'registry.json'), '{"version":1,"entries":[]}');
  return dir;
}

test('migrate-ledgers：dry-run 不写盘；--apply 备份后全形态迁净', async (t) => {
  const dir = seedLedger(t);
  const ledger = path.join(dir, 'bucket-a', 'index.html.json');
  const before = fs.readFileSync(ledger, 'utf8');

  const dry = await execFileP('node', [SCRIPT], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(dry.stdout, /dry-run：2 个账本里 1 个待迁（marks × 2、result × 1、comment × 2、group × 1、groupLabel × 1、mention × 1）/);
  assert.equal(fs.readFileSync(ledger, 'utf8'), before, 'dry-run 一个字节都不写');

  const applied = await execFileP('node', [SCRIPT, '--apply'], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(applied.stdout, /已备份到/);
  const doc = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.equal(doc.marks, undefined, 'marks 键已改名 annotations');
  assert.deepEqual(doc.annotations, [
    { id: 'a1', n: 1, status: 'done', content: '带结果 [@a:zz99aa]', section: 'inbox' },
    { id: 'a2', n: 2, content: '没结果', section: 'keep' },
  ]);
  // registry.json 不是账本，原样保留；备份完整。
  assert.equal(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'), '{"version":1,"entries":[]}');
  assert.ok(fs.existsSync(path.join(dir, 'migrations', '2026-09-22-ledgers', 'bucket-a', 'index.html.json')));

  // 幂等：再跑一遍没有可迁的。
  const again = await execFileP('node', [SCRIPT], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(again.stdout, /0 个待迁（无）/);
});

test('migrate-ledgers：build-notes 页的账本不因文件名前缀被吞（R9 口径延续）', async (t) => {
  const dir = seedLedger(t);
  fs.writeFileSync(path.join(dir, 'bucket-a', 'build-notes.json'), JSON.stringify({
    page: 'build-notes', revision: 1,
    annotations: [{ id: 'b1', n: 1, content: '结果在 build 页', result: { operations: [] } }],
  }));
  fs.mkdirSync(path.join(dir, 'bucket-a', 'dist', 'build-notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bucket-a', 'dist', 'build-notes', 'build.json'), '{"builtAt":1}');
  const out = await execFileP('node', [SCRIPT], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(out.stdout, /build-notes\.json result:1/);
  assert.doesNotMatch(out.stdout, /dist/);
});
