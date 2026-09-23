import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const SCRIPT = new URL('./migrate-ledgers.mjs', import.meta.url).pathname;

async function run(dir, ...args) {
  return execFileP('node', [SCRIPT, ...args], { env: { ...process.env, PINPOINT_DATA_DIR: dir } });
}

/** migrations/ 下唯一的备份目录名（目录带时分秒，G6）。 */
function backupDirOf(dir) {
  const entries = fs.readdirSync(path.join(dir, 'migrations'));
  assert.equal(entries.length, 1, `恰一个备份目录，实际：${entries.join('、')}`);
  return entries[0];
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
  assert.ok(fs.existsSync(path.join(dir, 'migrations', backupDirOf(dir), 'bucket-a', 'index.html.json')));

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
  assert.match(out.stdout, /host\/ ← 迁入 2 行/, '每页报迁入行数（G4）');
  assert.match(out.stdout, /site\/ ← 迁入 1 行/);
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

  // host：@canvas 只收画布行（r1 冲突保留目标行）；r3 无 pageId、按账本路径
  // 归页（挂靠条目 draft → 宿主页 host），落到 <页>/<原账本名>.json 保留表面
  // 绑定；x~3.json 整本并进来（r5 已改号）；图片两侧都到。
  const hostCanvas = JSON.parse(fs.readFileSync(path.join(dir, 'host', '@canvas.json'), 'utf8'));
  assert.deepEqual(hostCanvas.annotations.map((r) => [r.id, r.content]), [
    ['r1', 'host 已有的同 id 行'],
  ]);
  assert.equal(hostCanvas.page, '@canvas');
  const hostPathLedger = JSON.parse(fs.readFileSync(path.join(dir, 'host', 'wr~2.json'), 'utf8'));
  assert.deepEqual(hostPathLedger.annotations.map((r) => [r.id, r.n]), [['r3', 3]]);
  assert.equal(hostPathLedger.path, '/sites/draft/x.html', '表面绑定跟着账本走');
  const hostDoc = JSON.parse(fs.readFileSync(path.join(dir, 'host', 'x~3.json'), 'utf8'));
  assert.equal(hostDoc.annotations[0].id, 'r5');
  assert.ok(hostDoc.annotations[0].n > 9, '撞车的 #3 已重新取号（接在桶内 max 后）');
  assert.ok(fs.existsSync(path.join(dir, 'host', 'images', 'x~3-1-1.png')));

  // site：r2 带 pageId，迁入新建的 @canvas。
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

test('storage-unify：坏 JSON 账本原样保留，清理阶段跳过（G7）', async (t) => {
  const dir = seedLedger(t);
  const brokenPath = path.join(dir, 'bucket-a', 'broken.json');
  const broken = '{"annotations": [ {"id": "x"'; // 截断的 JSON
  fs.writeFileSync(brokenPath, broken);
  const otherBucket = path.join(dir, 'bucket-b');
  fs.mkdirSync(otherBucket, { recursive: true });
  fs.writeFileSync(path.join(otherBucket, 'broken.json'), broken);

  const out = await run(dir, '--apply');
  assert.match(out.stderr, /跳过坏账本/);
  assert.equal(fs.readFileSync(brokenPath, 'utf8'), broken, '有别的变更也不顺手删坏账本');
  assert.equal(fs.readFileSync(path.join(otherBucket, 'broken.json'), 'utf8'), broken, '无变更的桶同样不动');
});

test('storage-unify：备份目录带时分秒，已存在就拒绝（G6）', async (t) => {
  const dir = seedLedger(t);
  await run(dir, '--apply');
  assert.match(backupDirOf(dir), /-\d{2}-\d{2}-\d{2}-storage-unify$/, '目录名含时分秒');

  // 再来一遍有活干的迁移：备份目录已存在（同名即拒）→ 退 1，不动盘。
  fs.mkdirSync(path.join(dir, 'migrations', `${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}-storage-unify`), { recursive: true });
  const ledger = path.join(dir, 'bucket-a', 'index.html.json');
  fs.writeFileSync(ledger, JSON.stringify({
    page: 'index.html', path: '/index.html', revision: 9,
    marks: [{ id: 'z1', n: 1, comment: '新形态前的行' }],
  }));
  await assert.rejects(() => run(dir, '--apply'), /备份目录已存在/, '同名备份目录在，拒绝执行');
  assert.match(fs.readFileSync(ledger, 'utf8'), /"marks"/, '拒绝后盘未动');
});

test('storage-unify：挂靠桶并入宿主无撞号不改号（G2）', async (t) => {
  const dir = seedUnify(t);
  // 宿主桶只占 #5（r1 那条同 id 行照旧冲突保留，不参与计数），挂靠账本的 #1
  // 独占：并进去不许「撞自己」改号。
  const canvas = JSON.parse(fs.readFileSync(path.join(dir, 'host', '@canvas.json'), 'utf8'));
  canvas.annotations.push({ id: 'host5', n: 5, pageId: 'host', status: 'open', content: '宿主行' });
  fs.writeFileSync(path.join(dir, 'host', '@canvas.json'), JSON.stringify(canvas));
  const draftLedger = JSON.parse(fs.readFileSync(path.join(dir, 'draft', 'x~3.json'), 'utf8'));
  draftLedger.annotations = [{ id: 'r5', n: 1, status: 'open', content: '挂靠文档行（唯一号 #1）' }];
  fs.writeFileSync(path.join(dir, 'draft', 'x~3.json'), JSON.stringify(draftLedger));

  const out = await run(dir, '--apply');
  assert.match(out.stdout, /重号 0 条/, '无撞号就无改号');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'host', 'x~3.json'), 'utf8'));
  assert.equal(doc.annotations[0].n, 1, '宿主 #5 + 挂靠 #1 → 仍是 #1');
  const afterCanvas = JSON.parse(fs.readFileSync(path.join(dir, 'host', '@canvas.json'), 'utf8'));
  assert.deepEqual(afterCanvas.annotations.map((r) => r.n), [9, 5], '宿主桶原有号原样');
});

test('storage-unify：跟行走的数据图按新账本 key 改名，行引用同步改（G5）', async (t) => {
  const dir = seedUnify(t);
  // pinpoint 的画布行带图（名字前缀 = pinpoint 桶里的老账本 key）：迁进 site
  // 的 @canvas 后按 @canvas- 前缀改名，collectUnusedImages / prune 才回收得到。
  const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'pinpoint', 'index~1.json'), 'utf8'));
  const row = ledger.annotations.find((r) => r.id === 'r2');
  row.images = [{ file: 'index~1-2-1.png' }];
  // 同一账本里两行引用同一张源图：只搬一份、共用一个新名。
  ledger.annotations.push({ ...row, id: 'r2b', n: 7 });
  fs.writeFileSync(path.join(dir, 'pinpoint', 'index~1.json'), JSON.stringify(ledger));
  fs.writeFileSync(path.join(dir, 'pinpoint', 'images', 'index~1-2-1.png'), 'pin-img');

  const out = await run(dir, '--apply');
  assert.match(out.stdout, /图片：pinpoint\/images\/index~1-2-1\.png → site\/images\/@canvas-index~1-2-1\.png/);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'site', '@canvas.json'), 'utf8'));
  for (const id of ['r2', 'r2b']) {
    const moved = doc.annotations.find((r) => r.id === id);
    assert.equal(moved.images[0].file, '@canvas-index~1-2-1.png', `${id} 的引用跟着改名`);
  }
  assert.equal(fs.readdirSync(path.join(dir, 'site', 'images')).filter((n) => n.includes('index~1')).length, 1, '同源图只搬一份');
});

/* ---- K1：/previews/ 表面已不存在的账本（真实数据形状）→ 孤儿、原地不动 ---- *//** 真实 ~/.pinpoint 的 pinpoint 桶形状：wr-w29 / wr-w30 归到模板页 weekly-review、
    sheet 归到 sheet-rev，两页都不存在（registry 只有 weekly-review 这个 dir 条目，
    它的表面是 /sites/weekly-review/，与 /previews/ 无关；manifest 不含这些页）。 */
function seedGonePreviews(t, previewsRoot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-gone-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({
    version: 1,
    entries: [
      { id: 'pinpoint', kind: 'dir', path: dir },
      { id: 'weekly-review', kind: 'dir', path: path.join(dir, 'weekly-review-site') },
    ],
  }));
  const ledger = (name, ledgerPath, ns, startAt) => fs.writeFileSync(path.join(dir, 'pinpoint', name), JSON.stringify({
    page: name.replace(/\.json$/, ''), path: ledgerPath, revision: 56,
    updated_at: startAt,
    annotations: Array.from({ length: ns }, (_, i) => ({
      id: `g${i + 1}`, n: i + 1, type: 'element', status: 'open', content: `行 ${i + 1}`,
    })),
  }));
  fs.mkdirSync(path.join(dir, 'pinpoint'), { recursive: true });
  ledger('wr-w29.html_173ikfh.json', '/previews/weekly-review/wr-w29.html', 48, '2026-07-29T08:23:47.615Z');
  ledger('wr-w30.html_1hii93r.json', '/previews/weekly-review/wr-w30.html', 18, '2026-07-29T08:38:37.917Z');
  ledger('sheet.html_1umsrux.json', '/previews/sheet-rev/sheet.html', 1, '2026-08-15T06:37:29.634Z');
  // 副本仓根：manifest 只认 example（weekly-review / sheet-rev 都不在）。
  fs.mkdirSync(path.join(previewsRoot, 'content', 'previews'), { recursive: true });
  fs.writeFileSync(path.join(previewsRoot, 'content', 'previews', '_index.json'), JSON.stringify({ defaultPage: '', pages: [{ id: 'example' }] }));
  return dir;
}

test('storage-unify：/previews/ 已不存在的账本全部报孤儿、原地不动、不建新桶', async (t) => {
  const previewsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-repo-'));
  t.after(() => fs.rmSync(previewsRoot, { recursive: true, force: true }));
  const dir = seedGonePreviews(t, previewsRoot);
  const before = fs.readdirSync(path.join(dir, 'pinpoint')).filter((name) => name !== '_seq.json').sort().join(',');
  const snapshot = Object.fromEntries(fs.readdirSync(path.join(dir, 'pinpoint'))
    .filter((name) => name.endsWith('.json') && name !== '_seq.json')
    .map((name) => [name, fs.readFileSync(path.join(dir, 'pinpoint', name), 'utf8')]));

  async function runWithManifest(...args) {
    return execFileP('node', [SCRIPT, ...args], {
      env: { ...process.env, PINPOINT_DATA_DIR: dir, PINPOINT_PREVIEWS_ROOT: previewsRoot },
    });
  }

  const dry = await runWithManifest();
  assert.match(dry.stdout, /归桶（storage-unify）：0 行迁入 0 个页桶 · 3 本账本有孤儿行（不自动删）/);
  assert.match(dry.stdout, /pinpoint\/wr-w29\.html_173ikfh\.json：48 行（path=\/previews\/weekly-review\/wr-w29\.html 归到的模板页 weekly-review 不在 manifest 里）/);
  assert.match(dry.stdout, /pinpoint\/wr-w30\.html_1hii93r\.json：18 行（path=\/previews\/weekly-review\/wr-w30\.html 归到的模板页 weekly-review 不在 manifest 里）/);
  assert.match(dry.stdout, /pinpoint\/sheet\.html_1umsrux\.json：1 行（path=\/previews\/sheet-rev\/sheet\.html 归到的模板页 sheet-rev 不在 manifest 里）/);
  assert.doesNotMatch(dry.stdout, /weekly-review\/ ← 迁入/, '不建新桶');

  await runWithManifest('--apply');
  assert.equal(
    fs.readdirSync(path.join(dir, 'pinpoint')).filter((name) => name !== '_seq.json').sort().join(','),
    before,
    '原地不动（_seq 计数器除外，桶级 #n 水位本就要落）',
  );
  for (const [name, text] of Object.entries(snapshot)) {
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dir, 'pinpoint', name), 'utf8')),
      JSON.parse(text),
      `${name} 内容原样（行没动）`,
    );
  }
  assert.ok(!fs.existsSync(path.join(dir, 'weekly-review')), 'weekly-review 桶没有被造出来');
  assert.ok(!fs.existsSync(path.join(dir, 'sheet-rev')), 'sheet-rev 桶没有被造出来');
});

test('storage-unify：无 pageId 的行归到 manifest 页时落 <页>/<原账本名>.json，不进 @canvas', async (t) => {
  const previewsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-migrate-repo-'));
  t.after(() => fs.rmSync(previewsRoot, { recursive: true, force: true }));
  const dir = seedGonePreviews(t, previewsRoot);
  // 换成 manifest 里真实存在的页：行按路径归页，账本名原样保留。
  fs.writeFileSync(path.join(dir, 'pinpoint', 'doc.html_9zz.json'), JSON.stringify({
    page: 'doc.html_9zz', path: '/previews/example/report.html', revision: 3,
    updated_at: '2026-09-01T00:00:00.000Z',
    annotations: [{ id: 'p1', n: 1, type: 'element', status: 'open', content: '模板页文档行' }],
  }));

  const applied = await execFileP('node', [SCRIPT, '--apply'], {
    env: { ...process.env, PINPOINT_DATA_DIR: dir, PINPOINT_PREVIEWS_ROOT: previewsRoot },
  });
  assert.match(applied.stdout, /example\/ ← 迁入/);
  const moved = JSON.parse(fs.readFileSync(path.join(dir, 'example', 'doc.html_9zz.json'), 'utf8'));
  assert.deepEqual(moved.annotations.map((r) => [r.id, r.n]), [['p1', 1]], '不撞号不改号');
  assert.equal(moved.path, '/previews/example/report.html', '表面绑定保留');
  assert.ok(!fs.existsSync(path.join(dir, 'example', '@canvas.json')), '@canvas 只收画布行，不因路径行被造出来');
});
