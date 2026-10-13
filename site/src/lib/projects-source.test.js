import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects, registryPath } from './projects-source.js';

const FIX = fileURLToPath(new URL('../../fixtures/projects/', import.meta.url));

function tempRegistry(t, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-reg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  if (entries) fs.writeFileSync(file, JSON.stringify({ version: 1, entries }));
  return file;
}

test('registry path follows PINPOINT_REGISTRY, and a missing registry means no projects', async (t) => {
  const file = tempRegistry(t, null);
  assert.equal(registryPath({ PINPOINT_REGISTRY: file }), file);
  assert.match(registryPath({}), /\.pinpoint[\\/]registry\.json$/);
  const none = await loadProjects({ PINPOINT_REGISTRY: file });
  assert.deepEqual([none.projects, none.errors], [[], []]);
});

test('loadProjects reads through listProjects: titles, summary, concept name / slug / status / boundary', async (t) => {
  const file = tempRegistry(t, [
    { id: 'demo', kind: 'project', path: path.join(FIX, 'demo') },
    { id: 'other', kind: 'project', path: path.join(FIX, 'other') },
  ]);
  const { projects, errors } = await loadProjects({ PINPOINT_REGISTRY: file });
  assert.deepEqual(errors, []);
  assert.deepEqual(projects.map((p) => [p.id, p.title]), [['demo', 'Demo 项目'], ['other', 'Other 项目']]);
  const [demo, other] = projects;
  assert.deepEqual(demo.articles.map((a) => [a.id, a.title, a.summary]), [
    ['basics', '基础篇', '没有 section 的短文。'],
    ['payments', '浏览器任务里的付款', '走到付款这一步时，agent 停下来发确认卡，用户自己点最后一下。'],
  ]);
  assert.equal(demo.articles[1].file, path.join(demo.dir, 'articles', 'payments', 'index.mdx'));
  assert.deepEqual(demo.concepts.map((c) => [c.name, c.slug, c.status]), [['确认卡', '确认卡', '已固定']]);
  assert.match(demo.concepts[0].boundary, /^对外动作执行前/);
  assert.deepEqual(other.concepts.map((c) => [c.name, c.slug, c.status]), [['收款方', 'payee', '收敛中']]);
});

test('layout errors from listProjects carry the project id (the loaders file them per project)', async (t) => {
  const file = tempRegistry(t, [{ id: 'clash', kind: 'project', path: path.join(FIX, 'clash') }]);
  const { errors } = await loadProjects({ PINPOINT_REGISTRY: file });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^project "clash": 撞名 \[\[confirm-card\]\]/);
});
