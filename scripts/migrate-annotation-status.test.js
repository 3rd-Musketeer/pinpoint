import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const SCRIPT = new URL('./migrate-annotation-status.mjs', import.meta.url).pathname;

function seedLedger(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bucket-a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bucket-a', 'index.html.json'), JSON.stringify({
    page: 'index.html', path: '/index.html', revision: 3,
    annotations: [
      { id: 'a1', n: 1, content: '带结果', result: { operations: [{ action: 'modify', targets: [] }], updatedAt: '2026-09-01T00:00:00Z' } },
      { id: 'a2', n: 2, content: '没结果' },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'registry.json'), '{"version":1,"entries":[]}');
  return dir;
}

test('migrate-annotation-status：dry-run 不写盘，--apply 备份后把 result 迁成 done', async (t) => {
  const dir = seedLedger(t);
  const ledger = path.join(dir, 'bucket-a', 'index.html.json');
  const before = fs.readFileSync(ledger, 'utf8');

  const dry = await execFileP('node', [SCRIPT], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(dry.stdout, /dry-run：2 个账本里 1 个带 result，共 1 条待迁/);
  assert.equal(fs.readFileSync(ledger, 'utf8'), before, 'dry-run 一个字节都不写');

  const applied = await execFileP('node', [SCRIPT, '--apply'], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(applied.stdout, /已备份到/);
  const doc = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.deepEqual(doc.annotations, [
    { id: 'a1', n: 1, content: '带结果', status: 'done' },
    { id: 'a2', n: 2, content: '没结果' },
  ]);
  // registry.json 不是账本，原样保留；备份完整。
  assert.equal(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'), '{"version":1,"entries":[]}');
  assert.ok(fs.existsSync(path.join(dir, 'migrations', '2026-09-22-status', 'bucket-a', 'index.html.json')));

  // 幂等：再跑一遍没有可迁的。
  const again = await execFileP('node', [SCRIPT], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(again.stdout, /0 个带 result，共 0 条待迁/);
});

test('migrate-annotation-status：build-notes 页的账本不因文件名前缀被吞（R9）', async (t) => {
  const dir = seedLedger(t);
  fs.writeFileSync(path.join(dir, 'bucket-a', 'build-notes.json'), JSON.stringify({
    page: 'build-notes', revision: 1,
    annotations: [{ id: 'b1', n: 1, content: '结果在 build 页', result: { operations: [] } }],
  }));
  // dist / render / migrations 目录里的 .json 一概不算账本。
  fs.mkdirSync(path.join(dir, 'bucket-a', 'dist', 'build-notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bucket-a', 'dist', 'build-notes', 'build.json'), '{"builtAt":1}');
  const out = await execFileP('node', [SCRIPT], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
  assert.match(out.stdout, /build-notes\.json × 1/);
  assert.doesNotMatch(out.stdout, /dist/);
});
