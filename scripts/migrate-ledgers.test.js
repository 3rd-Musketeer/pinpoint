import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const SCRIPT = new URL('./migrate-ledgers.mjs', import.meta.url).pathname;
const BACKUP_DIR = `${new Date().toISOString().slice(0, 10)}-storage-unify`;

async function run(dir, ...args) {
  return execFileP('node', [SCRIPT, ...args], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
}

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

  const dry = await run(dir);
  assert.match(dry.stdout, /形态：1 个账本里 1 个待迁（marks × 2、result × 1、comment × 2、group × 1、groupLabel × 1、mention × 1）/);
  assert.match(dry.stdout, /归桶（storage-unify）：0 行迁入/);
  assert.equal(fs.readFileSync(ledger, 'utf8'), before, 'dry-run 一个字节都不写');

  const applied = await run(dir, '--apply');
  assert.match(applied.stdout, /已备份到/);
  const doc = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.equal(doc.marks, undefined, 'marks 键已改名 annotations');
  assert.deepEqual(doc.annotations, [
    { id: 'a1', n: 1, status: 'done', content: '带结果 [@a:zz99aa]', section: 'inbox' },
    { id: 'a2', n: 2, content: '没结果', section: 'keep' },
  ]);
  // registry.json 不是账本，原样保留；备份完整。
  assert.equal(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'), '{"version":1,"entries":[]}');
  assert.ok(fs.existsSync(path.join(dir, 'migrations', BACKUP_DIR, 'bucket-a', 'index.html.json')));

  // 幂等：再跑一遍没有可迁的。
  const again = await run(dir);
  assert.match(again.stdout, /形态：1 个账本里 0 个待迁（无）/);
  assert.match(again.stdout, /归桶（storage-unify）：0 行迁入/);
});

test('migrate-ledgers：build-notes 页的账本不因文件名前缀被吞（R9 口径延续）', async (t) => {
  const dir = seedLedger(t);
  fs.writeFileSync(path.join(dir, 'bucket-a', 'build-notes.json'), JSON.stringify({
    page: 'build-notes', revision: 1,
    annotations: [{ id: 'b1', n: 1, content: '结果在 build 页', result: { operations: [] } }],
  }));
  fs.mkdirSync(path.join(dir, 'bucket-a', 'dist', 'build-notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bucket-a', 'dist', 'build-notes', 'build.json'), '{"builtAt":1}');
  const out = await run(dir);
  assert.match(out.stdout, /build-notes\.json result:1/);
  assert.doesNotMatch(out.stdout, /dist/);
});

/* ---- storage-unify：拆分 / 合并 / 改号 / 图片 / 幂等 ---- */

function seedUnify(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-unify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({
    version: 1,
    entries: [
      { id: 'pinpoint', kind: 'dir', path: dir },
      { id: 'host', kind: 'dir', path: path.join(dir, 'host-site') },
      { id: 'site', kind: 'dir', path: path.join(dir, 'site-site') },
      { id: 'draft', kind: 'file', path: path.join(dir, 'host-site', 'x.html'), page: 'host' },
    ],
  }));
  // pinpoint 桶：两条按 pageId 拆（各带图片）、一条按 pathname 找页、一条孤儿。
  fs.mkdirSync(path.join(dir, 'pinpoint', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pinpoint', 'index~1.json'), JSON.stringify({
    page: 'index~1', path: '/index.html', revision: 5, updated_at: '2026-09-01T00:00:00.000Z',
    annotations: [
      { id: 'r1', n: 1, pageId: 'host', screenId: 'home', status: 'open', content: 'host 行', images: [{ file: 'img-host.png' }] },
      { id: 'r2', n: 2, pageId: 'site', screenId: 'home', status: 'open', content: 'site 行' },
    ],
  }));
  // r3 与 r4 分开两本：pathname 解析按账本的 path 走，混在一本里就一起找到页了。
  fs.writeFileSync(path.join(dir, 'pinpoint', 'wr~2.json'), JSON.stringify({
    page: 'wr~2', path: '/sites/draft/x.html', revision: 1, updated_at: '2026-09-02T00:00:00.000Z',
    annotations: [{ id: 'r3', n: 3, status: 'open', content: '按路径找到挂靠条目' }],
  }));
  fs.writeFileSync(path.join(dir, 'pinpoint', 'wr~4.json'), JSON.stringify({
    page: 'wr~4', path: '/nowhere/x.html', revision: 1, updated_at: '2026-09-02T00:00:00.000Z',
    annotations: [{ id: 'r4', n: 4, status: 'open', content: '孤儿行' }],
  }));
  fs.writeFileSync(path.join(dir, 'pinpoint', 'images', 'img-host.png'), 'pin');
  fs.writeFileSync(path.join(dir, 'pinpoint', 'images', 'img-stale.png'), 'stale');
  // host 桶已有 @canvas：一条与 r1 同 id 不同内容（冲突保留目标）、一条占 #9。
  fs.mkdirSync(path.join(dir, 'host'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'host', '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 2, updated_at: '2026-08-31T00:00:00.000Z',
    annotations: [
      { id: 'r1', n: 9, pageId: 'host', screenId: 'home', status: 'done', content: 'host 已有的同 id 行' },
    ],
  }));
  // 挂靠条目自己的桶：整桶并进 host，#1 与 host 现有号撞车要改号。
  fs.mkdirSync(path.join(dir, 'draft', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'draft', 'x~3.json'), JSON.stringify({
    page: 'x~3', path: '/sites/draft/x.html', revision: 1, updated_at: '2026-09-03T00:00:00.000Z',
    annotations: [{ id: 'r5', n: 3, status: 'open', content: '挂靠文档行（与 r3 的 #3 撞车）' }],
  }));
  fs.writeFileSync(path.join(dir, 'draft', 'images', 'x~3-1-1.png'), 'draft-img');
  return dir;
}

test('storage-unify：dry-run 拆分/合并/改号/图片/孤儿清单齐全，不写盘', async (t) => {
  const dir = seedUnify(t);
  const before = fs.readdirSync(path.join(dir, 'pinpoint')).sort().join(',');
  const out = await run(dir);
  assert.match(out.stdout, /归桶（storage-unify）：3 行迁入 2 个页桶/);
  assert.match(out.stdout, /host\/ ← 迁入/);
  assert.match(out.stdout, /site\/ ← 迁入/);
  assert.match(out.stdout, /桶合并：draft → host/);
  assert.match(out.stdout, /冲突：host：行 r1 已存在且内容不同/);
  assert.match(out.stdout, /重号：host\/x~3\.json #3 → #\d+/);
  // 冲突行（r1）被目标行顶掉：它引用的图片不搬（保留目标行的世界）。
  assert.match(out.stdout, /图片：draft\/images\/x~3-1-1\.png → host\/images\/x~3-1-1\.png/);
  assert.doesNotMatch(out.stdout, /img-host/);
  assert.match(out.stdout, /孤儿（留在原处）：pinpoint\/wr~4\.json：1 行/);
  assert.equal(fs.readdirSync(path.join(dir, 'pinpoint')).sort().join(','), before, 'dry-run 不动盘');
});

test('storage-unify：--apply 落盘后形状正确，第二遍 0 变更', async (t) => {
  const dir = seedUnify(t);
  await run(dir, '--apply');

  // host：@canvas = 原 r1（目标行，冲突保留）+ r3（按路径迁入，号 3 不撞）；
  // x~3.json 整本并进来（r5 已改号）；图片两侧都到。
  const hostCanvas = JSON.parse(fs.readFileSync(path.join(dir, 'host', '@canvas.json'), 'utf8'));
  assert.deepEqual(hostCanvas.annotations.map((r) => [r.id, r.content]), [
    ['r1', 'host 已有的同 id 行'],
    ['r3', '按路径找到挂靠条目'],
  ]);
  assert.equal(hostCanvas.page, '@canvas');
  const hostDoc = JSON.parse(fs.readFileSync(path.join(dir, 'host', 'x~3.json'), 'utf8'));
  assert.equal(hostDoc.annotations[0].id, 'r5');
  assert.ok(hostDoc.annotations[0].n > 9, '撞车的 #3 已重新取号（接在桶内 max 后）');
  assert.ok(fs.existsSync(path.join(dir, 'host', 'images', 'x~3-1-1.png')));

  // site：r2 迁入新建的 @canvas。
  const siteCanvas = JSON.parse(fs.readFileSync(path.join(dir, 'site', '@canvas.json'), 'utf8'));
  assert.deepEqual(siteCanvas.annotations.map((r) => r.id), ['r2']);

  // pinpoint：只剩孤儿账本；不再被引用的图片清掉。
  const leftover = JSON.parse(fs.readFileSync(path.join(dir, 'pinpoint', 'wr~4.json'), 'utf8'));
  assert.deepEqual(leftover.annotations.map((r) => r.id), ['r4']);
  assert.ok(!fs.existsSync(path.join(dir, 'pinpoint', 'wr~2.json')), '行全部迁出的账本删除');
  assert.ok(!fs.existsSync(path.join(dir, 'pinpoint', 'index~1.json')), '行全部迁出的账本删除');
  assert.ok(!fs.existsSync(path.join(dir, 'pinpoint', 'images', 'img-stale.png')), '不再被引用的图片清掉');
  assert.ok(!fs.existsSync(path.join(dir, 'pinpoint', 'images', 'img-host.png')), '冲突行的图片随之退役');

  // 挂靠桶已并走；_seq 就位（host 的 max = 9 → next 10）。
  assert.ok(!fs.existsSync(path.join(dir, 'draft')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'host', '_seq.json'), 'utf8')).next, 11);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'site', '_seq.json'), 'utf8')).next, 3);

  // 幂等：第二遍 0 变更（孤儿清单是常驻信息，每遍都列，不算变更）。
  const again = await run(dir);
  assert.match(again.stdout, /归桶（storage-unify）：0 行迁入 0 个页桶 · 1 本账本有孤儿行（不自动删） · 重号 0 条 · 图片 0 张 · _seq 重算 0 桶/);
  await run(dir, '--apply');
  const hostCanvas2 = JSON.parse(fs.readFileSync(path.join(dir, 'host', '@canvas.json'), 'utf8'));
  assert.deepEqual(hostCanvas2, hostCanvas, '第二遍 --apply 后字节级不变');
});
